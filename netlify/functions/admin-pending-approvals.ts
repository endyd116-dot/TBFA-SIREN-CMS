// netlify/functions/admin-pending-approvals.ts
// ★ Phase M-19-11 V2 STEP 4: 회원 가입 승인 대기 관리
//
// GET  /api/admin/pending-approvals?type=family|teacher|lawyer|counselor|all
//      → 승인 대기 회원 목록 (증빙 파일 메타 포함)
//
// POST /api/admin/pending-approvals
//      body: { memberId, action: 'approve'|'reject'|'reset', reason? }
//      → 승인/반려/재심사 되돌리기 처리
//
// 권한: super_admin only

import { eq, and, or, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { members, blobUploads } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import { sendEmail, tplMemberApproved, tplMemberRejected } from "../../lib/email";
import { createNotification } from "../../lib/notify";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

/* ───── 승인 대기 판정 조건 ───── */
function buildPendingCondition(typeFilter: string) {
  /* 기본: status='pending' AND certificate_blob_id IS NOT NULL */
  const base = and(
    eq(members.status, "pending"),
    sql`${members.certificateBlobId} IS NOT NULL`
  );

  if (typeFilter === "family") {
    return and(base, eq(members.type, "family"));
  }
  if (typeFilter === "teacher") {
    return and(base, eq(members.type, "volunteer"), eq(members.memberSubtype, "teacher"));
  }
  if (typeFilter === "lawyer") {
    return and(base, eq(members.type, "volunteer"), eq(members.memberSubtype, "lawyer"));
  }
  if (typeFilter === "counselor") {
    return and(base, eq(members.type, "volunteer"), eq(members.memberSubtype, "counselor"));
  }
  /* all (기본) */
  return and(
    base,
    or(
      eq(members.type, "family"),
      and(
        eq(members.type, "volunteer"),
        or(
          eq(members.memberSubtype, "teacher"),
          eq(members.memberSubtype, "lawyer"),
          eq(members.memberSubtype, "counselor"),
        )
      )
    )
  );
}

/* ───── subtype 라벨 ───── */
const SUBTYPE_LABEL: Record<string, string> = {
  family: "유가족",
  teacher: "교원",
  lawyer: "변호사",
  counselor: "심리상담사",
};

function getSubtypeKey(m: any): string {
  if (m.type === "family") return "family";
  if (m.type === "volunteer" && m.memberSubtype) return m.memberSubtype;
  return "unknown";
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  /* ===== 관리자 인증 ===== */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  /* super_admin만 가능 */
  if (adminMember.role !== "super_admin") {
    return forbidden("회원 승인은 슈퍼 관리자만 가능합니다");
  }

  try {
    /* ============================================================
       GET — 승인 대기 회원 목록
       ============================================================ */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const typeFilter = (url.searchParams.get("type") || "all").trim();

      const validTypes = ["family", "teacher", "lawyer", "counselor", "all"];
      if (!validTypes.includes(typeFilter)) {
        return badRequest(`유효하지 않은 타입: ${typeFilter}`);
      }

      const cond = buildPendingCondition(typeFilter);

      /* 회원 목록 조회 + 증빙 파일 LEFT JOIN */
      const list = await db
        .select({
          id: members.id,
          email: members.email,
          name: members.name,
          phone: members.phone,
          type: members.type,
          memberSubtype: members.memberSubtype,
          status: members.status,
          memo: members.memo,
          certificateBlobId: members.certificateBlobId,
          certificateUploadedAt: members.certificateUploadedAt,
          certificateRejectedReason: members.certificateRejectedReason,
          createdAt: members.createdAt,
          updatedAt: members.updatedAt,
          /* 증빙 파일 메타 */
          certBlobKey: blobUploads.blobKey,
          certOriginalName: blobUploads.originalName,
          certMimeType: blobUploads.mimeType,
          certSizeBytes: blobUploads.sizeBytes,
          certStorageProvider: blobUploads.storageProvider,
        })
        .from(members)
        .leftJoin(blobUploads, eq(members.certificateBlobId, blobUploads.id))
        .where(cond as any)
        .orderBy(desc(members.createdAt));

      /* 카테고리별 카운트 */
      const counts = {
        all: 0,
        family: 0,
        teacher: 0,
        lawyer: 0,
        counselor: 0,
      };

      const allRows: any = await db.execute(sql`
        SELECT 
          type,
          member_subtype,
          COUNT(*)::int AS cnt
        FROM members
        WHERE status = 'pending' 
          AND certificate_blob_id IS NOT NULL
          AND (
            type = 'family'
            OR (type = 'volunteer' AND member_subtype IN ('teacher', 'lawyer', 'counselor'))
          )
        GROUP BY type, member_subtype
      `);

      const countRows = Array.isArray(allRows) ? allRows : (allRows?.rows || []);
      for (const r of countRows as any[]) {
        const cnt = Number(r.cnt) || 0;
        counts.all += cnt;
        if (r.type === "family") counts.family += cnt;
        else if (r.type === "volunteer") {
          if (r.member_subtype === "teacher") counts.teacher += cnt;
          else if (r.member_subtype === "lawyer") counts.lawyer += cnt;
          else if (r.member_subtype === "counselor") counts.counselor += cnt;
        }
      }

      /* 응답 가공 */
      const enriched = list.map((m: any) => {
        const subtypeKey = getSubtypeKey(m);
        return {
          id: m.id,
          email: m.email,
          name: m.name,
          phone: m.phone,
          type: m.type,
          memberSubtype: m.memberSubtype,
          subtypeKey,
          subtypeLabel: SUBTYPE_LABEL[subtypeKey] || "기타",
          status: m.status,
          memo: m.memo,
          certificateRejectedReason: m.certificateRejectedReason,
          createdAt: m.createdAt,
          certificate: m.certBlobKey ? {
            blobId: m.certificateBlobId,
            originalName: m.certOriginalName,
            mimeType: m.certMimeType,
            sizeBytes: m.certSizeBytes,
            uploadedAt: m.certificateUploadedAt,
            storageProvider: m.certStorageProvider,
            /* 미리보기/다운로드 URL은 별도 R2 presign API 통해 발급 필요 */
            previewEndpoint: `/api/blob-download?id=${m.certificateBlobId}`,
          } : null,
        };
      });

      return ok({ list: enriched, counts });
    }

    /* ============================================================
       POST — 승인 / 반려 / 재심사 되돌리기
       ============================================================ */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const memberId = Number(body.memberId);
      const action = String(body.action || "").trim();
      const reason = body.reason ? String(body.reason).trim() : "";

      if (!Number.isInteger(memberId) || memberId < 1) {
        return badRequest("유효하지 않은 회원 ID입니다");
      }
      if (!["approve", "reject", "reset"].includes(action)) {
        return badRequest("action은 approve / reject / reset 중 하나여야 합니다");
      }

      /* 대상 회원 조회 */
      const [target] = await db
        .select()
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      if (!target) return notFound("회원을 찾을 수 없습니다");

      const subtypeKey = getSubtypeKey(target);
      const subtypeLabel = SUBTYPE_LABEL[subtypeKey] || "회원";

      /* ───────── 승인 처리 ───────── */
      if (action === "approve") {
        if (target.status !== "pending") {
          return badRequest(`승인 대기 상태가 아닙니다 (현재: ${target.status})`);
        }
        if (!target.certificateBlobId) {
          return badRequest("증빙 파일이 첨부되지 않은 회원입니다");
        }

        const now = new Date();
        const [updated] = await db
          .update(members)
          .set({
            status: "active",
            certificateVerifiedAt: now,
            certificateRejectedReason: null,
            secondaryVerified: true,
            secondaryVerifiedAt: now,
            secondaryVerifiedBy: admin.uid,
            pendingExpertReview: false,
            updatedAt: now,
          } as any)
          .where(eq(members.id, memberId))
          .returning();

        /* 감사 로그 */
        await logAdminAction(req, admin.uid, admin.name, "member_approve", {
          target: `M-${memberId}`,
          detail: { subtype: subtypeKey, email: target.email, name: target.name },
        });

        /* 인앱 알림 (회원 본인) */
        try {
          await createNotification({
            recipientId: memberId,
            recipientType: "user",
            category: "member",
            severity: "info",
            title: `🎉 ${subtypeLabel} 회원 가입이 승인되었습니다`,
            message: "이제 모든 서비스를 이용하실 수 있습니다.",
            link: "/mypage.html",
            refTable: "members",
            refId: memberId,
          });
        } catch (_) {}

        /* 이메일 발송 (agreeEmail=true 이고 이메일 있는 경우) */
        if (target.agreeEmail && target.email) {
          try {
            const { subject, html } = tplMemberApproved({
              userName: target.name,
              memberSubtype: subtypeKey,
              approvedAt: now,
            });
            await sendEmail({ to: target.email, subject, html });
          } catch (e) {
            console.warn("[admin-pending-approvals] 승인 메일 발송 실패:", e);
          }
        }

        return ok({ member: updated }, `${subtypeLabel} 회원이 승인되었습니다`);
      }

      /* ───────── 반려 처리 ───────── */
      if (action === "reject") {
        if (target.status !== "pending") {
          return badRequest(`승인 대기 상태가 아닙니다 (현재: ${target.status})`);
        }
        if (!reason || reason.length < 5) {
          return badRequest("반려 사유를 5자 이상 입력해주세요");
        }
        if (reason.length > 1000) {
          return badRequest("반려 사유는 1000자 이하여야 합니다");
        }

        const now = new Date();
        const [updated] = await db
          .update(members)
          .set({
            status: "suspended",
            certificateRejectedReason: reason,
            certificateVerifiedAt: null,
            secondaryVerified: false,
            secondaryVerifiedAt: null,
            secondaryVerifiedBy: null,
            pendingExpertReview: false,
            updatedAt: now,
          } as any)
          .where(eq(members.id, memberId))
          .returning();

        /* 감사 로그 */
        await logAdminAction(req, admin.uid, admin.name, "member_reject", {
          target: `M-${memberId}`,
          detail: { subtype: subtypeKey, email: target.email, name: target.name, reason },
        });

        /* 인앱 알림 */
        try {
          await createNotification({
            recipientId: memberId,
            recipientType: "user",
            category: "member",
            severity: "warning",
            title: `${subtypeLabel} 회원 신청이 반려되었습니다`,
            message: reason.slice(0, 100),
            link: "/mypage.html",
            refTable: "members",
            refId: memberId,
          });
        } catch (_) {}

        /* 이메일 발송 */
        if (target.agreeEmail && target.email) {
          try {
            const { subject, html } = tplMemberRejected({
              userName: target.name,
              memberSubtype: subtypeKey,
              rejectedReason: reason,
              rejectedAt: now,
            });
            await sendEmail({ to: target.email, subject, html });
          } catch (e) {
            console.warn("[admin-pending-approvals] 반려 메일 발송 실패:", e);
          }
        }

        return ok({ member: updated }, `${subtypeLabel} 회원 신청이 반려되었습니다`);
      }

      /* ───────── 재심사 되돌리기 (suspended → pending) ───────── */
      if (action === "reset") {
        if (target.status !== "suspended") {
          return badRequest(`반려된 회원만 재심사로 되돌릴 수 있습니다 (현재: ${target.status})`);
        }

        const now = new Date();
        const [updated] = await db
          .update(members)
          .set({
            status: "pending",
            certificateRejectedReason: null,
            updatedAt: now,
          } as any)
          .where(eq(members.id, memberId))
          .returning();

        await logAdminAction(req, admin.uid, admin.name, "member_reset_pending", {
          target: `M-${memberId}`,
          detail: { subtype: subtypeKey, email: target.email },
        });

        return ok({ member: updated }, "재심사 대기 상태로 되돌렸습니다");
      }

      return badRequest("알 수 없는 action");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-pending-approvals]", err);
    return serverError("회원 승인 처리 중 오류가 발생했습니다", err?.message);
  }
};

export const config = { path: "/api/admin/pending-approvals*" };