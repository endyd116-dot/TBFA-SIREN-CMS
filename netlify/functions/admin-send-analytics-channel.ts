// netlify/functions/admin-send-analytics-channel.ts
// Phase 10 R4 — 채널별 발송 비교 분석 (어드민)
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-send-analytics-channel" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate   = to   ? new Date(to)   : new Date();

  try {
    /* 채널별 상세 집계 */
    const channelRes: any = await db.execute(sql`
      SELECT
        r.channel,
        COUNT(*)::int                                          AS total_recipients,
        COUNT(*) FILTER (WHERE r.status = 'sent')::int        AS sent,
        COUNT(*) FILTER (WHERE r.status = 'failed')::int      AS failed,
        COUNT(*) FILTER (WHERE r.open_count > 0)::int         AS opened_unique,
        COUNT(*) FILTER (WHERE r.click_count > 0)::int        AS clicked_unique,
        COALESCE(SUM(r.open_count), 0)::int                   AS total_opens,
        COALESCE(SUM(r.click_count), 0)::int                  AS total_clicks,
        COUNT(DISTINCT r.job_id)::int                         AS job_count
      FROM communication_send_recipients r
      WHERE r.created_at >= ${fromDate} AND r.created_at <= ${toDate}
      GROUP BY r.channel
      ORDER BY sent DESC
    `);
    const rows = channelRes?.rows ?? channelRes ?? [];

    /* 채널별 오픈율·클릭률 계산 */
    const channels = rows.map((r: any) => {
      const sent = r.sent ?? 0;
      return {
        channel: r.channel,
        jobCount: r.job_count ?? 0,
        totalRecipients: r.total_recipients ?? 0,
        sent,
        failed: r.failed ?? 0,
        openedUnique: r.opened_unique ?? 0,
        clickedUnique: r.clicked_unique ?? 0,
        totalOpens: r.total_opens ?? 0,
        totalClicks: r.total_clicks ?? 0,
        openRate:  sent > 0 ? Math.round(((r.opened_unique ?? 0)  / sent) * 1000) / 10 : 0,
        clickRate: sent > 0 ? Math.round(((r.clicked_unique ?? 0) / sent) * 1000) / 10 : 0,
        deliveryRate: (r.total_recipients ?? 0) > 0
          ? Math.round((sent / (r.total_recipients ?? 1)) * 1000) / 10 : 0,
      };
    });

    /* 채널별 주간 추세 (최근 4주) */
    let weeklyTrend: any[] = [];
    try {
      const weekRes: any = await db.execute(sql`
        SELECT
          r.channel,
          DATE_TRUNC('week', r.created_at)::text AS week_start,
          COUNT(*) FILTER (WHERE r.status = 'sent')::int       AS sent,
          COUNT(*) FILTER (WHERE r.open_count > 0)::int        AS opened
        FROM communication_send_recipients r
        WHERE r.created_at >= ${fromDate} AND r.created_at <= ${toDate}
        GROUP BY r.channel, DATE_TRUNC('week', r.created_at)
        ORDER BY week_start ASC, r.channel ASC
        LIMIT 80
      `);
      weeklyTrend = weekRes?.rows ?? weekRes ?? [];
    } catch (e) { console.warn("[analytics-channel] weeklyTrend 실패", e); }

    return new Response(
      JSON.stringify({ ok: true, channels, weeklyTrend }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "채널별 분석 조회 실패",
        step: "aggregate", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
