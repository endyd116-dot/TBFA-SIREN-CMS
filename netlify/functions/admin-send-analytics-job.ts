// netlify/functions/admin-send-analytics-job.ts
// Phase 10 R4 — 특정 발송 작업 상세 분석 (어드민)
//
// GET ?id=X

import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-send-analytics-job" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const jobId = Number(url.searchParams.get("id"));
  if (!jobId || isNaN(jobId)) {
    return new Response(jsonKST({ ok: false, error: "작업 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    /* 작업 기본 정보 */
    const jobRes: any = await db.execute(sql`
      SELECT j.id, j.name, j.channel, j.status,
             j.total_recipients, j.success_count, j.failure_count,
             j.started_at, j.completed_at, j.created_at,
             ct.name AS template_name,
             rg.name AS group_name
        FROM communication_send_jobs j
        LEFT JOIN communication_templates ct ON ct.id = j.template_id
        LEFT JOIN recipient_groups rg ON rg.id = j.recipient_group_id
       WHERE j.id = ${jobId}
       LIMIT 1
    `);
    const job = (jobRes?.rows ?? jobRes ?? [])[0];
    if (!job) {
      return new Response(jsonKST({ ok: false, error: "발송 작업을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }

    /* 수신자 상태 집계 */
    const statsRes: any = await db.execute(sql`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int          AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int        AS failed,
        COUNT(*) FILTER (WHERE status = 'pending')::int       AS pending,
        COUNT(*) FILTER (WHERE open_count > 0)::int           AS opened,
        COUNT(*) FILTER (WHERE click_count > 0)::int          AS clicked,
        COALESCE(SUM(open_count), 0)::int                     AS total_opens,
        COALESCE(SUM(click_count), 0)::int                    AS total_clicks
      FROM communication_send_recipients
      WHERE job_id = ${jobId}
    `);
    const stats = (statsRes?.rows ?? statsRes ?? [])[0] ?? {};
    const sent    = stats.sent ?? 0;
    const openRate  = sent > 0 ? Math.round(((stats.opened ?? 0) / sent) * 1000) / 10 : 0;
    const clickRate = sent > 0 ? Math.round(((stats.clicked ?? 0) / sent) * 1000) / 10 : 0;

    /* 추적 이벤트 시간별 분포 (오픈/클릭) */
    let trackingTimeline: any[] = [];
    try {
      const tlRes: any = await db.execute(sql`
        SELECT
          DATE_TRUNC('hour', tracked_at)::text AS hour,
          event_type,
          COUNT(*)::int AS count
        FROM communication_send_tracking
        WHERE job_id = ${jobId}
        GROUP BY DATE_TRUNC('hour', tracked_at), event_type
        ORDER BY hour ASC
        LIMIT 168
      `);
      trackingTimeline = tlRes?.rows ?? tlRes ?? [];
    } catch (e) { console.warn("[analytics-job] trackingTimeline 실패", e); }

    /* 실패 상위 오류 메시지 */
    let topErrors: any[] = [];
    try {
      const errRes: any = await db.execute(sql`
        SELECT error, COUNT(*)::int AS count
          FROM communication_send_recipients
         WHERE job_id = ${jobId} AND status = 'failed' AND error IS NOT NULL
         GROUP BY error
         ORDER BY count DESC
         LIMIT 5
      `);
      topErrors = errRes?.rows ?? errRes ?? [];
    } catch (e) { console.warn("[analytics-job] topErrors 실패", e); }

    return new Response(
      jsonKST({
        ok: true,
        job,
        analytics: {
          total: stats.total ?? 0,
          sent, failed: stats.failed ?? 0, pending: stats.pending ?? 0,
          opened: stats.opened ?? 0, clicked: stats.clicked ?? 0,
          totalOpens: stats.total_opens ?? 0, totalClicks: stats.total_clicks ?? 0,
          openRate, clickRate,
        },
        trackingTimeline,
        topErrors,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      jsonKST({
        ok: false, error: "작업 분석 조회 실패",
        step: "aggregate", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
