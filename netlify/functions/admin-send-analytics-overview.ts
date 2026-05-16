// netlify/functions/admin-send-analytics-overview.ts
// Phase 10 R4 — 발송 통계 개요 (어드민)
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// 응답:
// {
//   ok, overview: {
//     totalJobs, totalRecipients, delivered, openRate, clickRate,
//     byChannel: { email: {sent,opened,clicked}, sms: {...}, ... },
//     trend: [{ date, sent, opened, clicked }]  // 일별
//   }
// }

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-send-analytics-overview" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate   = to   ? new Date(to)   : new Date();

  try {
    /* 총 발송 작업 수 */
    const jobsRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total_jobs
        FROM communication_send_jobs
       WHERE created_at >= ${fromDate} AND created_at <= ${toDate}
         AND status IN ('completed','processing','failed')
    `);
    const totalJobs = ((jobsRes?.rows ?? jobsRes)[0] ?? {}).total_jobs ?? 0;

    /* 수신자 집계 */
    const recipientsRes: any = await db.execute(sql`
      SELECT
        COUNT(*)::int                                    AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int    AS delivered,
        COUNT(*) FILTER (WHERE open_count > 0)::int     AS opened,
        COUNT(*) FILTER (WHERE click_count > 0)::int    AS clicked
      FROM communication_send_recipients r
      JOIN communication_send_jobs j ON j.id = r.job_id
      WHERE r.created_at >= ${fromDate} AND r.created_at <= ${toDate}
        AND r.status IN ('sent','failed')
    `);
    const agg = (recipientsRes?.rows ?? recipientsRes ?? [])[0] ?? {};
    const totalRecipients = agg.total ?? 0;
    const delivered       = agg.delivered ?? 0;
    const opened          = agg.opened ?? 0;
    const clicked         = agg.clicked ?? 0;
    const openRate  = delivered > 0 ? Math.round((opened  / delivered) * 1000) / 10 : 0;
    const clickRate = delivered > 0 ? Math.round((clicked / delivered) * 1000) / 10 : 0;

    /* 채널별 집계 */
    let byChannel: Record<string, any> = {};
    try {
      const chRes: any = await db.execute(sql`
        SELECT
          r.channel,
          COUNT(*)::int                                    AS sent,
          COUNT(*) FILTER (WHERE r.open_count > 0)::int   AS opened,
          COUNT(*) FILTER (WHERE r.click_count > 0)::int  AS clicked
        FROM communication_send_recipients r
        JOIN communication_send_jobs j ON j.id = r.job_id
        WHERE r.created_at >= ${fromDate} AND r.created_at <= ${toDate}
          AND r.status = 'sent'
        GROUP BY r.channel
      `);
      for (const row of (chRes?.rows ?? chRes ?? [])) {
        byChannel[row.channel] = { sent: row.sent, opened: row.opened, clicked: row.clicked };
      }
    } catch (e) { console.warn("[analytics-overview] byChannel 실패", e); }

    /* 전송 성공률(deliveryRate) — totalRecipients 대비 delivered */
    const deliveryRate = totalRecipients > 0
      ? Math.round((delivered / totalRecipients) * 1000) / 10
      : 0;

    /* 일별 추세 (최대 60일) */
    let trend: any[] = [];
    try {
      const trendRes: any = await db.execute(sql`
        SELECT
          DATE(r.created_at)::text                         AS date,
          COUNT(*)::int                                    AS sent,
          COUNT(*) FILTER (WHERE r.open_count > 0)::int   AS opened,
          COUNT(*) FILTER (WHERE r.click_count > 0)::int  AS clicked
        FROM communication_send_recipients r
        WHERE r.created_at >= ${fromDate} AND r.created_at <= ${toDate}
          AND r.status = 'sent'
        GROUP BY DATE(r.created_at)
        ORDER BY DATE(r.created_at) ASC
        LIMIT 60
      `);
      trend = (trendRes?.rows ?? trendRes ?? []).map((r: any) => ({
        date: r.date, sent: r.sent, opened: r.opened, clicked: r.clicked,
      }));
    } catch (e) { console.warn("[analytics-overview] trend 실패", e); }

    /* ★ 2026-05-16: Top 발송 작업 (열람률 기준 상위 10) — 옛 코드 누락분 추가 */
    let topJobs: any[] = [];
    try {
      const topRes: any = await db.execute(sql`
        SELECT
          j.id,
          j.name                                                       AS job_name,
          j.channel,
          COUNT(r.*) FILTER (WHERE r.status = 'sent')::int             AS sent,
          COUNT(r.*) FILTER (WHERE r.open_count > 0)::int              AS opened
        FROM communication_send_jobs j
        LEFT JOIN communication_send_recipients r ON r.job_id = j.id
        WHERE j.created_at >= ${fromDate} AND j.created_at <= ${toDate}
        GROUP BY j.id, j.name, j.channel
        HAVING COUNT(r.*) FILTER (WHERE r.status = 'sent') > 0
        ORDER BY (CASE WHEN COUNT(r.*) FILTER (WHERE r.status = 'sent') > 0
                       THEN COUNT(r.*) FILTER (WHERE r.open_count > 0)::numeric
                            / COUNT(r.*) FILTER (WHERE r.status = 'sent')
                       ELSE 0 END) DESC,
                 sent DESC
        LIMIT 10
      `);
      topJobs = (topRes?.rows ?? topRes ?? []).map((r: any) => {
        const s = Number(r.sent ?? 0);
        const o = Number(r.opened ?? 0);
        return {
          jobId: r.id,
          jobName: r.job_name,
          channel: r.channel,
          sent: s,
          opened: o,
          openRate: s > 0 ? Math.round((o / s) * 1000) / 10 : 0,
        };
      });
    } catch (e) { console.warn("[analytics-overview] topJobs 실패", e); }

    /* ★ 2026-05-16: AI 트리거 효과 — triggered_by_auto_id 기준 집계
       (정확한 컬럼명: communication_send_jobs.triggered_by_auto_id +
       communication_auto_triggers.name) */
    let aiTriggerEffect: any[] = [];
    try {
      const triggerRes: any = await db.execute(sql`
        SELECT
          j.triggered_by_auto_id                                            AS trigger_id,
          COALESCE(MAX(t.name), '트리거 #' || j.triggered_by_auto_id::text) AS trigger_name,
          COUNT(r.*) FILTER (WHERE r.status = 'sent')::int                  AS sent,
          COUNT(r.*) FILTER (WHERE r.open_count > 0)::int                   AS opened
        FROM communication_send_jobs j
        LEFT JOIN communication_send_recipients r ON r.job_id = j.id
        LEFT JOIN communication_auto_triggers t ON t.id = j.triggered_by_auto_id
        WHERE j.created_at >= ${fromDate} AND j.created_at <= ${toDate}
          AND j.triggered_by_auto_id IS NOT NULL
        GROUP BY j.triggered_by_auto_id
        ORDER BY sent DESC
        LIMIT 10
      `);
      aiTriggerEffect = (triggerRes?.rows ?? triggerRes ?? []).map((r: any) => {
        const s = Number(r.sent ?? 0);
        const o = Number(r.opened ?? 0);
        return {
          triggerId: r.trigger_id,
          triggerName: r.trigger_name,
          sent: s,
          opened: o,
          openRate: s > 0 ? Math.round((o / s) * 1000) / 10 : 0,
        };
      });
    } catch (e) { console.warn("[analytics-overview] aiTriggerEffect 실패 (auto_triggers 테이블 부재 가능)", e); }

    return new Response(
      JSON.stringify({
        ok: true,
        overview: {
          totalJobs, totalRecipients, delivered, deliveryRate,
          openRate, clickRate,
          byChannel, trend, topJobs, aiTriggerEffect,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "발송 통계 조회 실패",
        step: "aggregate", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
