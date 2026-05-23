// netlify/functions/admin-billing-logs.ts
// ★ Phase 2 Step 5-A: 빌링 로그 관리 API
// GET ?list=1   : 로그 목록 (status/memberId/type 필터 + 페이지네이션)
// GET ?stats=1  : 빌링 통계 (최근 30일 성공률, 실패 사유 분포)
// POST action=retry      : 수동 재시도 (next_retry_at = NOW)
// POST action=manual_charge : 즉시 청구 (Phase 2 Step 5-A에서는 Stub)

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { billingLogs, billingKeys, members } from "../../db/schema";
import { eq, sql, and, desc, gte } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, badRequest, methodNotAllowed, serverError, notFound } from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const admin = guard.ctx.admin;
  const adminMember = guard.ctx.member;

  const url = new URL(req.url);
  const ipAddress = req.headers.get("x-forwarded-for") || "unknown";
  const userAgent = req.headers.get("user-agent") || "";

  try {
    /* ===== GET: 조회 ===== */
    if (req.method === "GET") {
      const listFlag = url.searchParams.get("list");
      const statsFlag = url.searchParams.get("stats");

      // 통계
      if (statsFlag === "1") {
        const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || "30"), 365));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const statsRes: any = await db.execute(sql`
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'success') AS success_count,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
            COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) AS total_amount
          FROM billing_logs
          WHERE requested_at >= ${startDate.toISOString()}::timestamp
        `);
        const row = (Array.isArray(statsRes) ? statsRes[0] : (statsRes as any).rows?.[0]) || {};

        // 실패 사유 Top 5
        const errorRes: any = await db.execute(sql`
          SELECT pg_response_code AS code, COUNT(*) AS cnt
          FROM billing_logs
          WHERE status = 'failed'
            AND requested_at >= ${startDate.toISOString()}::timestamp
            AND pg_response_code IS NOT NULL
          GROUP BY pg_response_code
          ORDER BY cnt DESC
          LIMIT 5
        `);
        const errorRows = (Array.isArray(errorRes) ? errorRes : (errorRes as any).rows) || [];

        const total = Number(row.total || 0);
        const successCount = Number(row.success_count || 0);
        const successRate = total > 0 ? (successCount / total * 100) : 0;

        return ok({
          periodDays: days,
          total,
          successCount,
          failedCount: Number(row.failed_count || 0),
          pendingCount: Number(row.pending_count || 0),
          totalAmount: Number(row.total_amount || 0),
          successRate: Math.round(successRate * 10) / 10,
          topErrors: errorRows.map((e: any) => ({
            code: e.code,
            count: Number(e.cnt),
          })),
        });
      }

      // 목록
      if (listFlag === "1") {
        const page = Number(url.searchParams.get("page") || "1");
        const pageSize = Math.min(Number(url.searchParams.get("pageSize") || "50"), 200);
        const status = url.searchParams.get("status") || "";
        const memberId = url.searchParams.get("memberId");
        const attemptType = url.searchParams.get("attemptType") || "";
        const offset = (page - 1) * pageSize;

        const conds: any[] = [];
        if (status) conds.push(eq(billingLogs.status, status));
        if (memberId) conds.push(eq(billingLogs.memberId, Number(memberId)));
        if (attemptType) conds.push(eq(billingLogs.attemptType, attemptType));
        const whereClause = conds.length > 0
          ? sql`${sql.join(conds, sql` AND `)}`
          : undefined;

        const query: any = db
          .select({
            id: billingLogs.id,
            memberId: billingLogs.memberId,
            memberName: members.name,
            memberEmail: members.email,
            billingKey: billingLogs.billingKey,
            attemptType: billingLogs.attemptType,
            attemptNumber: billingLogs.attemptNumber,
            amount: billingLogs.amount,
            status: billingLogs.status,
            pgOrderNo: billingLogs.pgOrderNo,
            pgTid: billingLogs.pgTid,
            pgResponseCode: billingLogs.pgResponseCode,
            pgResponseMessage: billingLogs.pgResponseMessage,
            donationId: billingLogs.donationId,
            requestedAt: billingLogs.requestedAt,
            completedAt: billingLogs.completedAt,
            nextRetryAt: billingLogs.nextRetryAt,
          })
          .from(billingLogs)
          .leftJoin(members, eq(members.id, billingLogs.memberId));

        const list: any = whereClause
          ? await query.where(whereClause).orderBy(desc(billingLogs.requestedAt)).limit(pageSize).offset(offset)
          : await query.orderBy(desc(billingLogs.requestedAt)).limit(pageSize).offset(offset);

        const countQ: any = whereClause
          ? db.select({ count: sql<number>`COUNT(*)::int` }).from(billingLogs).where(whereClause)
          : db.select({ count: sql<number>`COUNT(*)::int` }).from(billingLogs);
        const countRes: any = await countQ;
        const total = Number(countRes?.[0]?.count || 0);

        return ok({ list, page, pageSize, total });
      }

      return badRequest("list=1 또는 stats=1 파라미터 필요");
    }

    /* ===== POST: 수동 작업 ===== */
    if (req.method === "POST") {
      const body: any = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === "retry") {
        // 수동 재시도 — next_retry_at 을 NOW 로 당겨 다음 cron에서 처리되도록
        const logId = Number(body.logId);
        if (!logId) return badRequest("logId 필요");

        const [target] = await db.select().from(billingLogs).where(eq(billingLogs.id, logId)).limit(1);
        if (!target) return notFound("로그 없음");
        if (target.status !== "failed") return badRequest("실패 로그만 재시도 가능");
        if ((target.attemptNumber ?? 1) >= 3) return badRequest("3회 도달 — 재시도 불가");

        await db.update(billingLogs)
          .set({ nextRetryAt: new Date() } as any)
          .where(eq(billingLogs.id, logId));

        // members.next_billing_date 도 오늘로 당기기
        if (target.memberId) {
          const todayStr = new Date().toISOString().slice(0, 10);
          await db.execute(sql`
            UPDATE members
            SET next_billing_date = ${todayStr}::date,
                updated_at = NOW()
            WHERE id = ${target.memberId}
          `);
        }

        await logAudit({
          userId: admin.uid,
          userName: adminMember.name,
          userType: "admin",
          action: "billing_retry_manual",
          target: `billing_log:${logId}`,
          detail: `memberId:${target.memberId} amount:${target.amount}`,
          ipAddress,
          userAgent,
        });

        return ok({ retried: true, logId });
      }

      if (action === "manual_charge") {
        // 즉시 수동 청구는 Phase 2 Step 5-A 에서는 Stub
        // (실제 토스 API 호출은 cron 흐름에 위임 — next_billing_date 당김 방식으로)
        const memberId = Number(body.memberId);
        if (!memberId) return badRequest("memberId 필요");

        const todayStr = new Date().toISOString().slice(0, 10);
        await db.execute(sql`
          UPDATE members
          SET next_billing_date = ${todayStr}::date,
              updated_at = NOW()
          WHERE id = ${memberId}
            AND withdrawn_at IS NULL
        `);

        await logAudit({
          userId: admin.uid,
          userName: adminMember.name,
          userType: "admin",
          action: "billing_manual_charge_scheduled",
          target: `member:${memberId}`,
          detail: `scheduled for today (${todayStr}) — will be processed in next cron`,
          ipAddress,
          userAgent,
        });

        return ok({
          scheduled: true,
          memberId,
          nextBillingDate: todayStr,
          note: "다음 cron 실행 시 자동 청구됩니다 (KST 00:00 또는 수동 cron 트리거)",
        });
      }

      return badRequest(`알 수 없는 action: ${action}`);
    }

    return methodNotAllowed();
  } catch (error: any) {
    console.error("[admin-billing-logs] 오류:", error);
    return serverError(error?.message || "서버 오류");
  }
};

/* ★ P1-2 fix: 라우팅 경로 누락 → 클라이언트(/api/admin/billing-logs) 404 복구 */
export const config = { path: "/api/admin/billing-logs" };
