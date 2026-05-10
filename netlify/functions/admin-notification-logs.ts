import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { requireAdmin } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-notification-logs" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET")
    return new Response(JSON.stringify({ ok: false, error: "GET only" }), { status: 405 });

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const channel = url.searchParams.get("channel");
  const status = url.searchParams.get("status");
  const eventType = url.searchParams.get("event_type");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = 50;
  const offset = (page - 1) * limit;

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  if (!from) fromDate.setHours(0, 0, 0, 0);
  if (to) toDate.setHours(23, 59, 59, 999);

  const filterChannel = channel && channel !== "all" ? channel : null;
  const filterStatus = status && status !== "all" ? status : null;
  const filterEvent = eventType && eventType !== "all" ? eventType : null;

  try {
    const itemsRes: any = await db.execute(sql`
      SELECT
        id, notification_id, event_type, target_type, target_id, channel, status,
        attempt, provider_message_id, error, latency_ms, created_at, sent_at, next_retry_at,
        params_snapshot
      FROM notification_dispatch_logs
      WHERE created_at >= ${fromDate.toISOString()}
        AND created_at <= ${toDate.toISOString()}
        AND (${filterChannel}::text IS NULL OR channel = ${filterChannel})
        AND (${filterStatus}::text IS NULL OR status = ${filterStatus})
        AND (${filterEvent}::text IS NULL OR event_type = ${filterEvent})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    const items = itemsRes?.rows ?? itemsRes;

    const totalRes: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM notification_dispatch_logs
      WHERE created_at >= ${fromDate.toISOString()}
        AND created_at <= ${toDate.toISOString()}
        AND (${filterChannel}::text IS NULL OR channel = ${filterChannel})
        AND (${filterStatus}::text IS NULL OR status = ${filterStatus})
        AND (${filterEvent}::text IS NULL OR event_type = ${filterEvent})
    `);
    const total = (totalRes?.rows ?? totalRes)[0]?.total || 0;

    /* 채널별 KPI (필터 무관, 같은 기간) */
    const kpiRes: any = await db.execute(sql`
      SELECT
        channel,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'dead')::int AS dead,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COALESCE(AVG(latency_ms) FILTER (WHERE status = 'sent'), 0)::int AS avg_latency_ms
      FROM notification_dispatch_logs
      WHERE created_at >= ${fromDate.toISOString()}
        AND created_at <= ${toDate.toISOString()}
      GROUP BY channel
    `);
    const byChannelRows = kpiRes?.rows ?? kpiRes;

    const byChannel: Record<string, any> = {
      inapp: { total: 0, sent: 0, failed: 0, dead: 0, pending: 0, successRate: 0, avgLatencyMs: 0 },
      email: { total: 0, sent: 0, failed: 0, dead: 0, pending: 0, successRate: 0, avgLatencyMs: 0 },
      sms:   { total: 0, sent: 0, failed: 0, dead: 0, pending: 0, successRate: 0, avgLatencyMs: 0 },
      kakao: { total: 0, sent: 0, failed: 0, dead: 0, pending: 0, successRate: 0, avgLatencyMs: 0 },
    };
    for (const r of byChannelRows) {
      const key = r.channel;
      if (!byChannel[key]) continue;
      byChannel[key] = {
        total: r.total,
        sent: r.sent,
        failed: r.failed,
        dead: r.dead,
        pending: r.pending,
        successRate: r.total > 0 ? Math.round((r.sent / r.total) * 1000) / 10 : 0,
        avgLatencyMs: r.avg_latency_ms,
      };
    }

    /* 실패 사유 상위 5 (failed + dead) */
    const errorsRes: any = await db.execute(sql`
      SELECT error, COUNT(*)::int AS count
      FROM notification_dispatch_logs
      WHERE created_at >= ${fromDate.toISOString()}
        AND created_at <= ${toDate.toISOString()}
        AND status IN ('failed', 'dead')
        AND error IS NOT NULL
      GROUP BY error
      ORDER BY count DESC
      LIMIT 5
    `);
    const topErrors = errorsRes?.rows ?? errorsRes;

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          items,
          total,
          page,
          totalPages: Math.ceil(total / limit),
          kpi: { byChannel, topErrors },
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "발송 로그 조회 실패", step: "query",
        detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
