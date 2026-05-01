/**
 * GET   /api/admin/donations           — 기부 내역 목록
 * PATCH /api/admin/donations           — 영수증 발행 처리 (단건 또는 일괄)
 */
import { eq, desc, and, or, like, count, sql, inArray } from "drizzle-orm";
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
      const where = conditions.length === 0 ? undefined : (conditions.length === 1 ? conditions[0] : and(...conditions));

      const [{ total }] = await db.select({ total: count() }).from(donations).where(where as any);

      const list = await db
        .select()
        .from(donations)
        .where(where as any)
        .orderBy(desc(donations.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 통계: 금일/금월/미납/영수증대기 */
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [stats] = await db
        .select({
          today: sql<number>`COALESCE(SUM(CASE WHEN ${donations.status}='completed' AND ${donations.createdAt} >= ${todayStart} THEN ${donations.amount} ELSE 0 END), 0)`,
          month: sql<number>`COALESCE(SUM(CASE WHEN ${donations.status}='completed' AND ${donations.createdAt} >= ${monthStart} THEN ${donations.amount} ELSE 0 END), 0)`,
          failedCount: sql<number>`COUNT(*) FILTER (WHERE ${donations.status}='failed')`,
          receiptPendingCount: sql<number>`COUNT(*) FILTER (WHERE ${donations.status}='completed' AND ${donations.receiptIssued}=false)`,
        })
        .from(donations);

      return ok({
        list,
        stats: {
          today: Number(stats?.today ?? 0),
          month: Number(stats?.month ?? 0),
          failedCount: Number(stats?.failedCount ?? 0),
          receiptPendingCount: Number(stats?.receiptPendingCount ?? 0),
        },
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      });
    }

    /* ===== PATCH (영수증 발행) ===== */
    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      /* ids 배열로 일괄 처리 또는 단건 */
      const ids: number[] = Array.isArray(body.ids) ? body.ids.map((n: any) => Number(n)).filter(Number.isFinite) : [];
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