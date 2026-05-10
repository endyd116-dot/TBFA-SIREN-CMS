// netlify/functions/migrate-notification-dispatch-logs.ts
// ★ 1회용 마이그레이션: notification_dispatch_logs 테이블 + 인덱스 4개 신설
//
// GET ?run=1 — requireAdmin 인증 후 실행
// GET (기본) — 진단 모드 (인증 불필요)
//
// 실행 후 즉시 이 파일 삭제 + 커밋 (1회용 보안 원칙)

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export default async (req: Request, ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 */
  if (!run) {
    const check: any = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'notification_dispatch_logs'
      ) AS exists
    `);
    const exists = (check.rows || check)?.[0]?.exists;
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      tableExists: exists,
      message: "?run=1 로 실행하세요 (어드민 로그인 필요)",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  /* 실행 모드 — 어드민 인증 */
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as any).res;

  const results: string[] = [];

  try {
    /* ① 테이블 생성 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS notification_dispatch_logs (
        id                  SERIAL PRIMARY KEY,
        notification_id     INTEGER,
        event_type          TEXT    NOT NULL,
        target_type         TEXT    NOT NULL,
        target_id           INTEGER NOT NULL,
        channel             TEXT    NOT NULL,
        status              TEXT    NOT NULL DEFAULT 'pending',
        attempt             INTEGER NOT NULL DEFAULT 0,
        provider_message_id TEXT,
        params_snapshot     JSONB,
        error               TEXT,
        latency_ms          INTEGER,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        next_retry_at       TIMESTAMPTZ,
        sent_at             TIMESTAMPTZ
      )
    `);
    results.push("테이블 생성 OK");

    /* ② 인덱스 — 사용자별 조회 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dispatch_logs_target_idx
        ON notification_dispatch_logs(target_type, target_id, created_at DESC)
    `);
    results.push("인덱스 1 (target) OK");

    /* ③ 인덱스 — 재시도 cron 폴링 (부분 인덱스) */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dispatch_logs_pending_retry_idx
        ON notification_dispatch_logs(status, next_retry_at)
        WHERE status = 'pending'
    `);
    results.push("인덱스 2 (pending retry 부분) OK");

    /* ④ 인덱스 — 이벤트별 통계 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dispatch_logs_event_type_idx
        ON notification_dispatch_logs(event_type, created_at DESC)
    `);
    results.push("인덱스 3 (event_type) OK");

    /* ⑤ 인덱스 — 채널별 성공률 */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS dispatch_logs_channel_status_idx
        ON notification_dispatch_logs(channel, status, created_at DESC)
    `);
    results.push("인덱스 4 (channel status) OK");

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[migrate-notification-dispatch-logs]", err);
    return new Response(JSON.stringify({
      ok: false,
      step: results[results.length - 1] || "init",
      error: String(err?.message || err).slice(0, 500),
      results,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config = {
  path: "/api/migrate-notification-dispatch-logs",
};
