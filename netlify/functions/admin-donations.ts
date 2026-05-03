/**
 * GET   /api/admin/donations      — 기부 내역 목록 + 통계
 * GET   /api/admin/donations?id=N — 단건 상세 (★ K-8 신규)
 * PATCH /api/admin/donations      — 영수증 일괄 발행 / 환불 / 취소 / 메모 / 일반 수정
 *
 * ★ K-8 PATCH 분기:
 * 1. body.ids[] 배열                 → 영수증 일괄 발행 (기존 호환)
 * 2. body.id + body.refundOne=true   → 단건 환불 (status=refunded)
 * 3. body.id + body.cancelOne=true   → 단건 취소 (status=cancelled)
 * 4. body.id + body.inlineMemoOnly   → 메모만 빠른 저장
 * 5. body.id + 일반 필드             → status/memo/campaignTag/isAnonymous 동시 변경
 *
 * 정책:
 * - 환불(refunded): 결제는 됐으나 사후 환불 처리 (PG사 환불은 별도 — 여기는 DB 상태만)
 * - 취소(cancelled): 결제 자체가 취소된 경우 (정기후원 자가 해지 등)
 * - 환불/취소 처리 시 이전 상태에 따라 검증
 *   * completed → refunded (정상 환불)
 *   * pending → cancelled (결제 전 취소)
 *   * 이미 refunded/cancelled/failed면 차단
 */
import { eq, desc, and, or, like, count, sql, inArray, gte } from "drizzle-orm";
import { db, donations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const idStr = url.searchParams.get("id");

      /* ★ K-8: 단건 상세 조회 */
      if (idStr) {
        const donationId = Number(idStr);
        if (!Number.isFinite(donationId)) return badRequest("유효하지 않은 ID");

        const [item] = await db
          .select()
          .from(donations)
          .where(eq(donations.id, donationId))
          .limit(1);

        if (!item) return notFound("후원 내역을 찾을 수 없습니다");
        return ok({ donation: item });
      }

      /* 목록 조회 */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 20));
      const status = url.searchParams.get("status");
      const type = url.searchParams.get("type");
      const q = (url.searchParams.get("q") || "").trim();

      const conditions: any[] = [];
      if (status && ["pending", "completed", "failed", "cancelled", "refunded"].includes(status)) {
        conditions.push(eq(donations.status, status as any));
      }
      if (type && ["regular", "onetime"].includes(type)) {
        conditions.push(eq(donations.type, type as any));
      }
      if (q && q.length >= 2) {
        const pattern = `%${q}%`;
        conditions.push(
          or(
            like(donations.donorName, pattern),
            like(donations.transactionId, pattern),
            like(donations.donorEmail, pattern),
            like(donations.receiptNumber, pattern),
          ),
        );
      }
      const where: any =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);

      /* 1. 총 개수 */
      const totalRows = await db.select({ total: count() }).from(donations).where(where as any);
      const total = Number(totalRows[0]?.total ?? 0);

      /* 2. 목록 */
      const list = await db
        .select()
        .from(donations)
        .where(where as any)
        .orderBy(desc(donations.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 3. 통계 */
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const todayRows = await db
        .select({ sum: sql<number>`COALESCE(SUM(${donations.amount}), 0)` })
        .from(donations)
        .where(and(eq(donations.status, "completed"), gte(donations.createdAt, todayStart)));

      const monthRows = await db
        .select({ sum: sql<number>`COALESCE(SUM(${donations.amount}), 0)` })
        .from(donations)
        .where(and(eq(donations.status, "completed"), gte(donations.createdAt, monthStart)));

      const failedRows = await db
        .select({ c: count() })
        .from(donations)
        .where(eq(donations.status, "failed"));

      const receiptPendingRows = await db
        .select({ c: count() })
        .from(donations)
        .where(and(eq(donations.status, "completed"), eq(donations.receiptIssued, false)));

      /* ★ K-8: 환불/취소 통계 추가 */
      const refundedRows = await db
        .select({ c: count() })
        .from(donations)
        .where(eq(donations.status, "refunded"));

      const cancelledRows = await db
        .select({ c: count() })
        .from(donations)
        .where(eq(donations.status, "cancelled"));

      return ok({
        list,
        stats: {
          today: Number(todayRows[0]?.sum ?? 0),
          month: Number(monthRows[0]?.sum ?? 0),
          failedCount: Number(failedRows[0]?.c ?? 0),
          receiptPendingCount: Number(receiptPendingRows[0]?.c ?? 0),
          refundedCount: Number(refundedRows[0]?.c ?? 0),
          cancelledCount: Number(cancelledRows[0]?.c ?? 0),
        },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }

    /* ===== PATCH ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      /* ───── 분기 1: 영수증 일괄 발행 (기존 호환) ───── */
      if (Array.isArray(body.ids)) {
        const ids: number[] = body.ids.map((n: any) => Number(n)).filter(Number.isFinite);
        if (ids.length === 0) return badRequest("ids 배열이 필요합니다");

        const result = await db
          .update(donations)
          .set({ receiptIssued: true, receiptIssuedAt: new Date() } as any)
          .where(and(inArray(donations.id, ids), eq(donations.status, "completed")))
          .returning({ id: donations.id });

        await logAdminAction(req, admin.uid, admin.name, "receipt_issue_bulk", {
          detail: { count: result.length, ids },
        });

        return ok({ issued: result.length }, `${result.length}건의 영수증이 발행되었습니다`);
      }

      /* ───── 단건 PATCH 공통: id 필수 ───── */
      if (!body.id) return badRequest("id 또는 ids가 필요합니다");

      const donationId = Number(body.id);
      if (!Number.isFinite(donationId)) return badRequest("유효하지 않은 ID");

      const [existing] = await db
        .select()
        .from(donations)
        .where(eq(donations.id, donationId))
        .limit(1);

      if (!existing) return notFound("후원 내역을 찾을 수 없습니다");

      /* ───── 분기 2: ★ K-8 단건 환불 ───── */
      if (body.refundOne === true) {
        /* 환불 가능 상태: completed만 */
        if (existing.status !== "completed") {
          return badRequest(
            existing.status === "refunded"
              ? "이미 환불 처리된 후원입니다"
              : existing.status === "cancelled"
                ? "취소된 후원은 환불할 수 없습니다 (이미 결제가 취소됨)"
                : `현재 상태(${existing.status})에서는 환불할 수 없습니다. 완료된 결제만 환불 가능합니다.`
          );
        }

        const refundReason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
        const now = new Date();
        const adminTag = `[환불 ${now.toISOString().slice(0, 10)} by ${admin.name || "관리자"}]`;
        const refundMemo = refundReason ? `${adminTag} ${refundReason}` : adminTag;
        const newMemo = existing.memo
          ? `${existing.memo}\n${refundMemo}`
          : refundMemo;

        const [updated] = await db
          .update(donations)
          .set({
            status: "refunded",
            memo: newMemo,
            updatedAt: now,
          } as any)
          .where(eq(donations.id, donationId))
          .returning({
            id: donations.id,
            status: donations.status,
            amount: donations.amount,
            donorName: donations.donorName,
          });

        await logAdminAction(req, admin.uid, admin.name, "donation_refund", {
          target: `D-${donationId}`,
          detail: {
            donorName: updated.donorName,
            amount: updated.amount,
            previousStatus: "completed",
            reasonProvided: !!refundReason,
          },
        });

        return ok(
          { donation: updated },
          `₩${(updated.amount || 0).toLocaleString()} 환불 처리되었습니다. (실제 PG사 환불은 별도 진행)`,
        );
      }

      /* ───── 분기 3: ★ K-8 단건 취소 ───── */
      if (body.cancelOne === true) {
        /* 취소 가능 상태: pending 또는 completed (관리자 강제 취소) */
        if (existing.status !== "pending" && existing.status !== "completed") {
          return badRequest(
            existing.status === "cancelled"
              ? "이미 취소된 후원입니다"
              : existing.status === "refunded"
                ? "환불 처리된 후원은 취소할 수 없습니다"
                : `현재 상태(${existing.status})에서는 취소할 수 없습니다.`
          );
        }

        const cancelReason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
        const now = new Date();
        const adminTag = `[관리자 취소 ${now.toISOString().slice(0, 10)} by ${admin.name || "관리자"}]`;
        const cancelMemo = cancelReason ? `${adminTag} ${cancelReason}` : adminTag;
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
            status: donations.status,
            amount: donations.amount,
            donorName: donations.donorName,
          });

        await logAdminAction(req, admin.uid, admin.name, "donation_cancel_admin", {
          target: `D-${donationId}`,
          detail: {
            donorName: updated.donorName,
            amount: updated.amount,
            previousStatus: existing.status,
            reasonProvided: !!cancelReason,
          },
        });

        return ok(
          { donation: updated },
          "후원이 취소 처리되었습니다",
        );
      }

      /* ───── 분기 4: ★ K-8 메모만 빠른 저장 ───── */
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

        await logAdminAction(req, admin.uid, admin.name, "donation_memo_update", {
          target: `D-${donationId}`,
          detail: { memoLength: memo.length },
        });

        return ok({ donation: updated }, "메모가 저장되었습니다");
      }

      /* ───── 분기 5: ★ K-8 일반 PATCH (memo / campaignTag / isAnonymous) ───── */
      const updatePayload: any = { updatedAt: new Date() };
      const changedFields: string[] = [];

      if (body.memo !== undefined) {
        updatePayload.memo = String(body.memo).slice(0, 2000);
        changedFields.push("memo");
      }
      if (body.campaignTag !== undefined) {
        updatePayload.campaignTag = body.campaignTag
          ? String(body.campaignTag).trim().slice(0, 50)
          : null;
        changedFields.push("campaignTag");
      }
      if (typeof body.isAnonymous === "boolean") {
        updatePayload.isAnonymous = body.isAnonymous;
        changedFields.push("isAnonymous");
      }
      /* receiptIssued 토글 (단건 영수증 미발행 처리 등) */
      if (typeof body.receiptIssued === "boolean") {
        updatePayload.receiptIssued = body.receiptIssued;
        if (body.receiptIssued) {
          updatePayload.receiptIssuedAt = new Date();
        } else {
          updatePayload.receiptIssuedAt = null;
        }
        changedFields.push("receiptIssued");
      }

      if (changedFields.length === 0) {
        return badRequest("변경할 항목이 없습니다");
      }

      const [updated] = await db
        .update(donations)
        .set(updatePayload)
        .where(eq(donations.id, donationId))
        .returning({
          id: donations.id,
          memo: donations.memo,
          campaignTag: donations.campaignTag,
          isAnonymous: donations.isAnonymous,
          receiptIssued: donations.receiptIssued,
          status: donations.status,
        });

      await logAdminAction(req, admin.uid, admin.name, "donation_update", {
        target: `D-${donationId}`,
        detail: { changedFields },
      });

      return ok({ donation: updated }, "후원 정보가 변경되었습니다");
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-donations]", err);
    return serverError("기부 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/donations" };