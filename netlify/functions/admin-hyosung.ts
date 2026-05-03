/**
 * GET    /api/admin/hyosung           — 효성 CMS+ 정기 후원 목록
 * GET    /api/admin/hyosung?id=N      — 단건 상세
 * PATCH  /api/admin/hyosung           — 상태 변경 / 메모 / 효성 정보 업데이트
 *
 * ★ L-9 업데이트:
 * - markCompleted 시 hyosungMemberNo 필수 입력
 * - updateHyosungInfo 분기 추가 (효성 회원번호/계약번호 수정)
 * - 목록/상세에 hyosung_member_no 포함
 *
 * 용도:
 * - 사용자가 "정기 + 효성 CMS+" 신청한 건들을 관리자가 확인
 * - 관리자가 효성 CMS+에 수동 등록 후 "등록 완료" 처리
 *   * 이때 효성이 부여한 회원번호(예: 60)를 필수 입력
 *   * 이후 billing_update.csv 업로드 시 이 번호로 자동 매칭
 * - 해지 처리 (효성 측 해지 반영)
 *
 * 조회 조건:
 * - pgProvider = 'hyosung_cms' AND type = 'regular'
 *
 * 권한: 관리자/슈퍼관리자/운영자
 *
 * 상태 전환:
 * - pending → completed: 효성 등록 완료 (효성번호 필수 + 감사 메일 발송)
 * - pending → cancelled: 등록 취소 (사유 메모에 기록)
 * - completed → cancelled: 효성 측 해지 반영
 * - pending → failed: 등록 불가 (사유 필수)
 */
import { eq, desc, and, or, like, count, sql } from "drizzle-orm";
import { db, donations, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";
import { sendEmail, tplDonationThanks } from "../../lib/email";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  /* 관리자 인증 */
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const idStr = url.searchParams.get("id");

      /* ─── 단건 상세 ─── */
      if (idStr) {
        const donationId = Number(idStr);
        if (!Number.isFinite(donationId)) return badRequest("유효하지 않은 ID");

        const [row] = await db
          .select()
          .from(donations)
          .where(eq(donations.id, donationId))
          .limit(1);

        if (!row) return notFound("후원 정보를 찾을 수 없습니다");
        if (row.pgProvider !== "hyosung_cms") {
          return badRequest("효성 CMS+ 후원이 아닙니다");
        }

        /* 회원 정보 join */
        let member: any = null;
        if (row.memberId) {
          const [m] = await db
            .select({
              id: members.id,
              name: members.name,
              email: members.email,
              phone: members.phone,
              type: members.type,
              status: members.status,
              createdAt: members.createdAt,
            })
            .from(members)
            .where(eq(members.id, row.memberId))
            .limit(1);
          member = m || null;
        }

        return ok({ donation: row, member });
      }

      /* ─── 목록 ─── */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const status = url.searchParams.get("status") || "";
      const q = (url.searchParams.get("q") || "").trim();

      /* 기본 조건: 효성 CMS+ + 정기 후원 */
      const conditions: any[] = [
        eq(donations.pgProvider, "hyosung_cms"),
        eq(donations.type, "regular"),
      ];

      if (status && ["pending", "completed", "cancelled", "failed", "refunded"].includes(status)) {
        conditions.push(eq(donations.status, status as any));
      }

      if (q && q.length >= 2) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            like(donations.donorName, pattern),
            like(donations.donorEmail, pattern),
            like(donations.donorPhone, pattern),
            like(donations.memo, pattern),
          ),
        );
      }

      const where: any = and(...conditions);

      /* 총 개수 */
      const totalRows = await db
        .select({ total: count() })
        .from(donations)
        .where(where);
      const total = Number(totalRows[0]?.total ?? 0);

      /* 목록 (★ L-9: 효성 컬럼 3개 포함) */
      const list = await db
        .select({
          id: donations.id,
          memberId: donations.memberId,
          donorName: donations.donorName,
          donorPhone: donations.donorPhone,
          donorEmail: donations.donorEmail,
          amount: donations.amount,
          status: donations.status,
          payMethod: donations.payMethod,
          isAnonymous: donations.isAnonymous,
          memo: donations.memo,
          receiptIssued: donations.receiptIssued,
          receiptNumber: donations.receiptNumber,
          /* ★ L-9 추가 */
          hyosungMemberNo: donations.hyosungMemberNo,
          hyosungContractNo: donations.hyosungContractNo,
          hyosungBillNo: donations.hyosungBillNo,
          createdAt: donations.createdAt,
          updatedAt: donations.updatedAt,
        })
        .from(donations)
        .where(where)
        .orderBy(desc(donations.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 상태별 통계 */
      const statsRows = await db
        .select({
          status: donations.status,
          c: count(),
          sum: sql<number>`COALESCE(SUM(${donations.amount}), 0)`,
        })
        .from(donations)
        .where(
          and(
            eq(donations.pgProvider, "hyosung_cms"),
            eq(donations.type, "regular"),
          ),
        )
        .groupBy(donations.status);

      const stats: any = {
        pending: { count: 0, amount: 0 },
        completed: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
        failed: { count: 0, amount: 0 },
      };
      statsRows.forEach((r: any) => {
        if (stats[r.status]) {
          stats[r.status].count = Number(r.c);
          stats[r.status].amount = Number(r.sum);
        }
      });

      return ok({
        list,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats,
      });
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body?.id) return badRequest("id가 필요합니다");

      const donationId = Number(body.id);
      if (!Number.isFinite(donationId)) return badRequest("유효하지 않은 ID");

      /* 기존 행 조회 */
      const [existing] = await db
        .select()
        .from(donations)
        .where(eq(donations.id, donationId))
        .limit(1);

      if (!existing) return notFound("후원 정보를 찾을 수 없습니다");
      if (existing.pgProvider !== "hyosung_cms") {
        return badRequest("효성 CMS+ 후원이 아닙니다");
      }

      /* ───── 분기 1: 메모만 빠른 저장 ───── */
      if (body.inlineMemoOnly === true) {
        const memo = typeof body.memo === "string" ? body.memo.slice(0, 2000) : "";

        const [updated] = await db
          .update(donations)
          .set({ memo, updatedAt: new Date() } as any)
          .where(eq(donations.id, donationId))
          .returning({
            id: donations.id,
            memo: donations.memo,
          });

        await logAdminAction(req, admin.uid, admin.name, "hyosung_memo_update", {
          target: `D-${donationId}`,
          detail: { memoLength: memo.length },
        });

        return ok({ donation: updated }, "메모가 저장되었습니다");
      }

      /* ───── 분기 2: ★ L-9 효성 정보만 업데이트 (회원번호 수정 등) ───── */
      if (body.updateHyosungInfo === true) {
        const hyMemberNo = body.hyosungMemberNo != null
          ? Number(body.hyosungMemberNo)
          : null;
        const hyContractNo = typeof body.hyosungContractNo === "string"
          ? body.hyosungContractNo.trim().slice(0, 20)
          : null;

        if (hyMemberNo !== null && !Number.isFinite(hyMemberNo)) {
          return badRequest("효성 회원번호는 숫자만 입력 가능합니다");
        }
        if (hyMemberNo !== null && hyMemberNo <= 0) {
          return badRequest("효성 회원번호는 0보다 커야 합니다");
        }

        const updatePayload: any = {
          updatedAt: new Date(),
        };
        if (hyMemberNo !== null) updatePayload.hyosungMemberNo = hyMemberNo;
        if (hyContractNo !== null) updatePayload.hyosungContractNo = hyContractNo || null;

        const [updated] = await db
          .update(donations)
          .set(updatePayload)
          .where(eq(donations.id, donationId))
          .returning({
            id: donations.id,
            hyosungMemberNo: donations.hyosungMemberNo,
            hyosungContractNo: donations.hyosungContractNo,
          });

        await logAdminAction(req, admin.uid, admin.name, "hyosung_info_update", {
          target: `D-${donationId}`,
          detail: {
            hyosungMemberNo: hyMemberNo,
            hyosungContractNo: hyContractNo,
          },
        });

        return ok({ donation: updated }, "효성 정보가 업데이트되었습니다");
      }

      /* ───── 분기 3: 효성 등록 완료 처리 (pending → completed) ───── */
      if (body.markCompleted === true) {
        if (existing.status !== "pending") {
          return badRequest(
            `현재 상태(${existing.status})에서는 완료 처리할 수 없습니다. pending 상태만 가능합니다.`,
          );
        }

        /* ★ L-9: 효성 회원번호 필수 */
        const hyMemberNo = body.hyosungMemberNo != null
          ? Number(body.hyosungMemberNo)
          : null;
        if (hyMemberNo === null || !Number.isFinite(hyMemberNo) || hyMemberNo <= 0) {
          return badRequest(
            "효성 CMS+ 회원번호를 입력해 주세요 (예: 60). " +
            "이 번호로 향후 월별 수납 결과 CSV를 자동 매칭합니다.",
          );
        }

        /* 계약번호는 선택 (기본값 '001') */
        const hyContractNo = typeof body.hyosungContractNo === "string"
          ? body.hyosungContractNo.trim().slice(0, 20) || "001"
          : "001";

        const now = new Date();
        const adminTag = `[효성 등록 완료 ${now.toISOString().slice(0, 10)} by ${admin.name || "관리자"}] 회원번호: ${hyMemberNo}`;
        const completedMemo = body.reason
          ? `${adminTag} · ${String(body.reason).trim().slice(0, 300)}`
          : adminTag;
        const newMemo = existing.memo
          ? `${existing.memo}\n${completedMemo}`
          : completedMemo;

        const updatePayload: any = {
          status: "completed",
          memo: newMemo,
          receiptRequested: true,
          /* ★ L-9: 효성 매칭 정보 저장 */
          hyosungMemberNo: hyMemberNo,
          hyosungContractNo: hyContractNo,
          updatedAt: now,
        };

        const [updated] = await db
          .update(donations)
          .set(updatePayload)
          .where(eq(donations.id, donationId))
          .returning({
            id: donations.id,
            donorName: donations.donorName,
            donorEmail: donations.donorEmail,
            amount: donations.amount,
            type: donations.type,
            memberId: donations.memberId,
            status: donations.status,
            hyosungMemberNo: donations.hyosungMemberNo,
            hyosungContractNo: donations.hyosungContractNo,
          });

        /* 감사 메일 발송 (실패해도 처리는 성공) */
        let emailSent = false;
        try {
          if (updated.donorEmail) {
            const tpl = tplDonationThanks({
              donorName: updated.donorName,
              amount: updated.amount,
              donationType: "regular",
              payMethod: "cms",
              donationId: updated.id,
              donationDate: now,
              isMember: !!updated.memberId,
            });
            const mailResult = await sendEmail({
              to: updated.donorEmail,
              subject: tpl.subject,
              html: tpl.html,
            });
            emailSent = !!mailResult.ok;
          }
        } catch (mailErr) {
          console.error("[admin-hyosung] 감사 메일 예외:", mailErr);
        }

        await logAdminAction(req, admin.uid, admin.name, "hyosung_mark_completed", {
          target: `D-${donationId}`,
          detail: {
            donorName: updated.donorName,
            amount: updated.amount,
            hyosungMemberNo: hyMemberNo,
            hyosungContractNo: hyContractNo,
            emailSent,
            reasonProvided: !!body.reason,
          },
        });

        return ok(
          { donation: updated, emailSent },
          `효성 CMS+ 등록 완료 처리되었습니다 (회원번호: ${hyMemberNo})${emailSent ? " · 감사 메일 발송 완료" : ""}`,
        );
      }

      /* ───── 분기 4: 해지 처리 ───── */
      if (body.markCancelled === true) {
        if (existing.status === "cancelled") {
          return badRequest("이미 해지된 후원입니다");
        }
        if (existing.status === "failed") {
          return badRequest("실패한 후원은 해지할 수 없습니다");
        }

        const now = new Date();
        const reasonText = body.reason ? String(body.reason).trim().slice(0, 300) : "";
        const adminTag = `[효성 해지 ${now.toISOString().slice(0, 10)} by ${admin.name || "관리자"}]`;
        const cancelMemo = reasonText
          ? `${adminTag} ${reasonText}`
          : adminTag;
        const newMemo = existing.memo
          ? `${existing.memo}\n${cancelMemo}`
          : cancelMemo;

        const [updated] = await db
          .update(donations)
          .set({
            status: "cancelled",
            memo: newMemo,
            updatedAt: now,
          } as any)
          .where(eq(donations.id, donationId))
          .returning({
            id: donations.id,
            donorName: donations.donorName,
            status: donations.status,
            amount: donations.amount,
          });

        await logAdminAction(req, admin.uid, admin.name, "hyosung_mark_cancelled", {
          target: `D-${donationId}`,
          detail: {
            donorName: updated.donorName,
            amount: updated.amount,
            previousStatus: existing.status,
            reasonProvided: !!reasonText,
          },
        });

        return ok({ donation: updated }, "효성 CMS+ 후원이 해지 처리되었습니다");
      }

      /* ───── 분기 5: 실패 처리 (사유 필수) ───── */
      if (body.markFailed === true) {
        if (existing.status === "completed") {
          return badRequest("이미 완료된 후원은 실패 처리할 수 없습니다");
        }

        const reasonText = body.reason ? String(body.reason).trim().slice(0, 500) : "";
        if (!reasonText) {
          return badRequest("실패 처리 시 사유 입력이 필요합니다");
        }

        const now = new Date();
        const adminTag = `[효성 실패 ${now.toISOString().slice(0, 10)} by ${admin.name || "관리자"}]`;
        const failMemo = `${adminTag} ${reasonText}`;
        const newMemo = existing.memo
          ? `${existing.memo}\n${failMemo}`
          : failMemo;

        const [updated] = await db
          .update(donations)
          .set({
            status: "failed",
            failureReason: reasonText.slice(0, 500),
            memo: newMemo,
            updatedAt: now,
          } as any)
          .where(eq(donations.id, donationId))
          .returning({ id: donations.id, status: donations.status });

        await logAdminAction(req, admin.uid, admin.name, "hyosung_mark_failed", {
          target: `D-${donationId}`,
          detail: { reason: reasonText.slice(0, 200) },
        });

        return ok({ donation: updated }, "실패 처리되었습니다");
      }

      return badRequest(
        "처리할 작업을 지정해 주세요 (markCompleted/markCancelled/markFailed/inlineMemoOnly/updateHyosungInfo)",
      );
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-hyosung]", err);
    return serverError("효성 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/hyosung" };