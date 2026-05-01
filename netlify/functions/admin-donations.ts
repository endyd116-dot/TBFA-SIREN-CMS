/**
 * GET   /api/admin/donations  — 기부 내역 목록 + 통계
 * PATCH /api/admin/donations  — 영수증 일괄 발행
 */
import { eq, desc, and, or, like, count, sql, inArray, gte } from "drizzle-orm";
import { db, donations } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logAdminAction } from "../../lib/audit";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 20));
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");

      const conditions: any[] = [];
      if (status && ["pending", "completed", "failed", "cancelled", "refunded"].includes(status)) {
        conditions.push(eq(donations.status, status as any));
      }
      if (q) {
        conditions.push(or(like(donations.donorName, `%${q}%`), like(donations.transactionId, `%${q}%`)));
      }
      const where = conditions.length === 0 ? undefined :
        (conditions.length === 1 ? conditions[0] : and(...conditions));

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

      /* 3. 통계 — 단순 쿼리로 분리 (postgres-js 호환) */
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      // 금일 결제
      const todayRows = await db
        .select({ sum: sql<number>`COALESCE(SUM(${donations.amount}), 0)` })
        .from(donations)
        .where(and(eq(donations.status, "completed"), gte(donations.createdAt, todayStart)));

      // 금월 결제
      const monthRows = await db
        .select({ sum: sql<number>`COALESCE(SUM(${donations.amount}), 0)` })
        .from(donations)
        .where(and(eq(donations.status, "completed"), gte(donations.createdAt, monthStart)));

      // 실패 건
      const failedRows = await db
        .select({ c: count() })
        .from(donations)
        .where(eq(donations.status, "failed"));

      // 영수증 대기
      const receiptPendingRows = await db
        .select({ c: count() })
        .from(donations)
        .where(and(eq(donations.status, "completed"), eq(donations.receiptIssued, false)));

      return ok({
        list,
        stats: {
          today: Number(todayRows[0]?.sum ?? 0),
          month: Number(monthRows[0]?.sum ?? 0),
          failedCount: Number(failedRows[0]?.c ?? 0),
          receiptPendingCount: Number(receiptPendingRows[0]?.c ?? 0),
        },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }

    /* ===== PATCH (영수증 일괄 발행) ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const ids: number[] = Array.isArray(body.ids)
        ? body.ids.map((n: any) => Number(n)).filter(Number.isFinite)
        : [];
      if (ids.length === 0) return badRequest("ids 배열이 필요합니다");

      const result = await db
        .update(donations)
        .set({ receiptIssued: true, receiptIssuedAt: new Date() })
        .where(and(inArray(donations.id, ids), eq(donations.status, "completed")))
        .returning({ id: donations.id });

      await logAdminAction(req, admin.uid, admin.name, "receipt_issue_bulk", {
        detail: { count: result.length, ids },
      });

      return ok({ issued: result.length }, `${result.length}건의 영수증이 발행되었습니다`);
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-donations]", err);
    return serverError("기부 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin/donations" };