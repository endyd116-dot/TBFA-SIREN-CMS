// netlify/functions/admin-experts.ts
// ★ Phase M-19-11: 전문가 회원 관리 (어드민 CRUD + 승인/반려)
//
// GET    /api/admin/experts           — 목록 (상태/유형 필터)
// GET    /api/admin/experts?id=N      — 단건 상세 (증빙 파일 포함)
// PATCH  /api/admin/experts           — 승인/반려/수정 (body: { id, action, ... })
// DELETE /api/admin/experts?id=N      — 프로필 삭제 (members 회원은 유지)
//
// 권한: super_admin 또는 'all' 카테고리 담당자

import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../../db";
import { expertProfiles, members, blobUploads } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import { createNotification } from "../../lib/notify";
import { sendEmail } from "../../lib/email";

function canManage(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories)
    ? adminMember.assignedCategories : [];
  return cats.includes("all");
}

const TYPE_LABELS: Record<string, string> = {
  lawyer: "⚖️ 변호사",
  counselor: "💗 심리상담사",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "반려",
  suspended: "정지",
  resigned: "사퇴",
};

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin, member: adminMember } = guard.ctx;

  if (!canManage(adminMember)) {
    return forbidden("전문가 관리 권한이 없습니다");
  }

  try {
    /* ═══ GET ═══ */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 단건 상세 */
      if (id) {
        const [row] = await db
          .select({
            profile: expertProfiles,
            memberName: members.name,
            memberEmail: members.email,
            memberPhone: members.phone,
            memberStatus: members.status,
          })
          .from(expertProfiles)
          .innerJoin(members, eq(expertProfiles.memberId, members.id))
          .where(eq(expertProfiles.id, Number(id)))
          .limit(1);

        if (!row) return notFound("전문가 프로필을 찾을 수 없습니다");

        /* 증빙 파일 정보 */
        let certificateInfo = null;
        if (row.profile.certificateBlobId) {
          const [f] = await db.select().from(blobUploads).where(eq(blobUploads.id, row.profile.certificateBlobId)).limit(1);
          if (f) {
            certificateInfo = {
              id: f.id,
              originalName: f.originalName,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              url: `/api/blob-image?id=${f.id}`,
            };
          }
        }

        /* 추가 자료 */
        const additionalDocs: any[] = [];
        const docIds = Array.isArray(row.profile.additionalDocs) ? row.profile.additionalDocs : [];
        for (const docId of docIds) {
          const [f] = await db.select().from(blobUploads).where(eq(blobUploads.id, Number(docId))).limit(1);
          if (f) {
            additionalDocs.push({
              id: f.id,
              originalName: f.originalName,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              url: `/api/blob-image?id=${f.id}`,
            });
          }
        }

        return ok({
          profile: {
            ...row.profile,
            typeLabel: TYPE_LABELS[row.profile.expertType],
            statusLabel: STATUS_LABELS[row.profile.expertStatus],
          },
          member: {
            name: row.memberName,
            email: row.memberEmail,
            phone: row.memberPhone,
            status: row.memberStatus,
          },
          certificate: certificateInfo,
          additionalDocs,
        });
      }

      /* 목록 */
      const status = url.searchParams.get("status");
      const type = url.searchParams.get("type");
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));

      const conds: any[] = [];
      if (status) conds.push(eq(expertProfiles.expertStatus, status as any));
      if (type) conds.push(eq(expertProfiles.expertType, type as any));
      const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

      const totalRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(expertProfiles)
        .where(where as any);
      const total = Number(totalRow[0]?.c ?? 0);

      const list = await db
        .select({
          id: expertProfiles.id,
          memberId: expertProfiles.memberId,
          expertType: expertProfiles.expertType,
          expertStatus: expertProfiles.expertStatus,
          specialty: expertProfiles.specialty,
          affiliation: expertProfiles.affiliation,
          yearsOfExperience: expertProfiles.yearsOfExperience,
          isMatchable: expertProfiles.isMatchable,
          approvedAt: expertProfiles.approvedAt,
          totalCasesHandled: expertProfiles.totalCasesHandled,
          createdAt: expertProfiles.createdAt,
          memberName: members.name,
          memberEmail: members.email,
        })
        .from(expertProfiles)
        .innerJoin(members, eq(expertProfiles.memberId, members.id))
        .where(where as any)
        .orderBy(desc(expertProfiles.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 상태별 통계 */
      const statsRow: any = await db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE expert_status = 'pending')::int AS pendingCount,
          COUNT(*) FILTER (WHERE expert_status = 'approved')::int AS approvedCount,
          COUNT(*) FILTER (WHERE expert_status = 'rejected')::int AS rejectedCount,
          COUNT(*) FILTER (WHERE expert_type = 'lawyer')::int AS lawyerCount,
          COUNT(*) FILTER (WHERE expert_type = 'counselor')::int AS counselorCount
        FROM expert_profiles
      `);
      const s: any = (statsRow.rows || statsRow || [{}])[0];

      return ok({
        list: list.map((r: any) => ({
          ...r,
          typeLabel: TYPE_LABELS[r.expertType],
          statusLabel: STATUS_LABELS[r.expertStatus],
        })),
        pagination: {
          page, limit, total,
          totalPages: Math.ceil(total / limit),
        },
        stats: {
          total: Number(s.total || 0),
          pending: Number(s.pendingCount || 0),
          approved: Number(s.approvedCount || 0),
          rejected: Number(s.rejectedCount || 0),
          lawyer: Number(s.lawyerCount || 0),
          counselor: Number(s.counselorCount || 0),
        },
      });
    }

    /* ═══ PATCH (승인/반려/수정) ═══ */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id 필요");

      const id = Number(body.id);
      const action = String(body.action || "");

      const [existing] = await db
        .select({
          profile: expertProfiles,
          memberName: members.name,
          memberEmail: members.email,
          memberId: members.id,
        })
        .from(expertProfiles)
        .innerJoin(members, eq(expertProfiles.memberId, members.id))
        .where(eq(expertProfiles.id, id))
        .limit(1);

      if (!existing) return notFound("전문가 프로필을 찾을 수 없습니다");

      /* ═══ 승인 ═══ */
      if (action === "approve") {
        if (existing.profile.expertStatus !== "pending") {
          return badRequest(`현재 상태(${existing.profile.expertStatus})에서는 승인할 수 없습니다`);
        }

        const now = new Date();
        const subtype = existing.profile.expertType === "lawyer" ? "lawyer" : "counselor";

        /* 프로필 승인 */
        await db.update(expertProfiles).set({
          expertStatus: "approved",
          approvedAt: now,
          reviewedBy: admin.uid,
          reviewedAt: now,
          isMatchable: true,
          adminMemo: body.memo ? String(body.memo).slice(0, 2000) : null,
          updatedAt: now,
        } as any).where(eq(expertProfiles.id, id));

        /* members 상태 활성화 */
        await db.update(members).set({
          status: "active",
          pendingExpertReview: false,
          memberSubtype: subtype,
          updatedAt: now,
        } as any).where(eq(members.id, existing.memberId));

        /* 사용자 알림 */
        try {
          await createNotification({
            recipientId: existing.memberId,
            recipientType: "user",
            category: "member",
            severity: "info",
            title: `✅ 전문가 회원 승인 완료`,
            message: `${existing.memberName}님의 ${TYPE_LABELS[existing.profile.expertType]} 회원 가입이 승인되었습니다.`,
            link: "/mypage.html",
            refTable: "expert_profiles",
            refId: id,
          });
        } catch (_) {}

        /* 승인 메일 */
        try {
          if (existing.memberEmail) {
            await sendEmail({
              to: existing.memberEmail,
              subject: `[교사유가족협의회] 전문가 회원 승인 완료`,
              html: `
                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px">
                  <h2 style="color:#7a1f2b">✅ 전문가 회원 승인 완료</h2>
                  <p>${existing.memberName}님, 안녕하세요.</p>
                  <p>${TYPE_LABELS[existing.profile.expertType]} 회원 가입이 승인되었습니다.</p>
                  <p>앞으로 협의회의 법률/심리 상담 매칭에 참여하실 수 있습니다.</p>
                  <p style="margin-top:30px">
                    <a href="${process.env.SITE_URL}/mypage.html" style="background:#7a1f2b;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">마이페이지 바로가기</a>
                  </p>
                </div>
              `,
            });
          }
        } catch (_) {}

        await logAdminAction(req, admin.uid, admin.name, "expert_approve", {
          target: `EP-${id}`,
          detail: { memberName: existing.memberName, expertType: existing.profile.expertType },
        });

        return ok({ id }, "전문가 회원이 승인되었습니다");
      }

      /* ═══ 반려 ═══ */
      if (action === "reject") {
        const reason = String(body.reason || "").trim();
        if (!reason) return badRequest("반려 사유를 입력해주세요");

        const now = new Date();

        await db.update(expertProfiles).set({
          expertStatus: "rejected",
          reviewedBy: admin.uid,
          reviewedAt: now,
          rejectedReason: reason.slice(0, 2000),
          updatedAt: now,
        } as any).where(eq(expertProfiles.id, id));

        await db.update(members).set({
          status: "active",
          pendingExpertReview: false,
          updatedAt: now,
        } as any).where(eq(members.id, existing.memberId));

        /* 사용자 알림 */
        try {
          await createNotification({
            recipientId: existing.memberId,
            recipientType: "user",
            category: "member",
            severity: "warning",
            title: `전문가 회원 신청 반려 안내`,
            message: reason.slice(0, 200),
            link: "/mypage.html",
          });
        } catch (_) {}

        await logAdminAction(req, admin.uid, admin.name, "expert_reject", {
          target: `EP-${id}`,
          detail: { reason: reason.slice(0, 300) },
        });

        return ok({ id }, "반려 처리되었습니다");
      }

      /* ═══ 일반 수정 ═══ */
      const updateData: any = { updatedAt: new Date() };
      if (body.isMatchable !== undefined) updateData.isMatchable = !!body.isMatchable;
      if (body.maxConcurrentCases !== undefined) updateData.maxConcurrentCases = Number(body.maxConcurrentCases) || 5;
      if (body.adminMemo !== undefined) updateData.adminMemo = body.adminMemo === null ? null : String(body.adminMemo).slice(0, 5000);

      await db.update(expertProfiles).set(updateData).where(eq(expertProfiles.id, id));

      await logAdminAction(req, admin.uid, admin.name, "expert_update", {
        target: `EP-${id}`,
        detail: { changedFields: Object.keys(updateData).filter(k => k !== "updatedAt") },
      });

      return ok({ id }, "수정되었습니다");
    }

    /* ═══ DELETE ═══ */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id = Number(url.searchParams.get("id"));
      if (!Number.isFinite(id)) return badRequest("id 필요");

      const [existing] = await db.select().from(expertProfiles).where(eq(expertProfiles.id, id)).limit(1);
      if (!existing) return notFound("프로필을 찾을 수 없습니다");

      await db.delete(expertProfiles).where(eq(expertProfiles.id, id));

      /* members는 유지 (회원 삭제 방지) */
      await db.update(members).set({
        pendingExpertReview: false,
        memberSubtype: null,
      } as any).where(eq(members.id, existing.memberId));

      await logAdminAction(req, admin.uid, admin.name, "expert_delete", {
        target: `EP-${id}`,
        detail: { memberId: existing.memberId, expertType: existing.expertType },
      });

      return ok({ deletedId: id }, "프로필이 삭제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-experts]", err);
    return serverError("전문가 관리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/experts" };