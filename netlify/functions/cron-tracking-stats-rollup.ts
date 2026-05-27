// netlify/functions/cron-tracking-stats-rollup.ts
// Phase 10 R4 — 추적 통계 보정 롤업 (6시간마다)
//
// communication_send_tracking 이벤트 로그를 기반으로
// communication_send_recipients 의 open_count / click_count 를 재집계해서 보정.
//
// 목적:
//   - track-open/track-click 동시성 race로 누락된 카운터 보정
//   - 배치 보정으로 분석 정확도 향상

import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { schedule: "0 */6 * * *" };

export default async function handler(_req: Request) {
  const t0 = Date.now();
  let updatedRecipients = 0;

  try {
    /* 최근 24시간 내 추적 이벤트가 있는 수신자의 카운터 재집계·보정
       — 전체 롤업은 과부하 가능성 있으므로 최근 24h 윈도우만 처리 */
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    /* Q4-006: 최근 24h 내 추적 이벤트가 있는 수신자를 "보정 대상"으로 고르되,
       카운트는 그 수신자의 전체(시간 무관) 이벤트로 재집계한다. 이전엔 tracked_at>=since
       이벤트만 세어 절대 카운터에 SET → 윈도우 밖 오픈/클릭이 깎여 과소집계됐음. */
    const result: any = await db.execute(sql`
      UPDATE communication_send_recipients r
         SET open_count  = agg.open_count,
             click_count = agg.click_count,
             opened_at   = COALESCE(r.opened_at, agg.first_open),
             clicked_at  = COALESCE(r.clicked_at, agg.first_click),
             updated_at  = NOW()
        FROM (
          SELECT
            recipient_id,
            COUNT(*) FILTER (WHERE event_type = 'open')::int   AS open_count,
            COUNT(*) FILTER (WHERE event_type = 'click')::int  AS click_count,
            MIN(tracked_at) FILTER (WHERE event_type = 'open')  AS first_open,
            MIN(tracked_at) FILTER (WHERE event_type = 'click') AS first_click
          FROM communication_send_tracking
          WHERE recipient_id IN (
            SELECT DISTINCT recipient_id FROM communication_send_tracking WHERE tracked_at >= ${since}
          )
          GROUP BY recipient_id
        ) agg
       WHERE r.id = agg.recipient_id
         AND (r.open_count  <> agg.open_count
           OR r.click_count <> agg.click_count)
    `);
    updatedRecipients = result?.rowCount ?? result?.count ?? 0;

    /* 발송 작업의 success/failure 보정 — 최근 24h 내 활동이 있는 작업을 대상으로 고르되,
       카운트는 그 작업의 전체 수신자로 재집계한다(Q4-006 — 윈도우 슬라이스로 덮어쓰기 금지). */
    await db.execute(sql`
      UPDATE communication_send_jobs j
         SET success_count = sub.sent_count,
             failure_count = sub.failed_count,
             updated_at    = NOW()
        FROM (
          SELECT
            job_id,
            -- Q4-025: 정책 스킵(skipped)도 처리완료로 success_count에 포함(디스패처 success++와 정합)
            COUNT(*) FILTER (WHERE status IN ('sent','skipped'))::int AS sent_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
          FROM communication_send_recipients
          WHERE job_id IN (
            SELECT DISTINCT job_id FROM communication_send_recipients WHERE updated_at >= ${since}
          )
          GROUP BY job_id
        ) sub
       WHERE j.id = sub.job_id
         AND (j.success_count <> sub.sent_count
           OR j.failure_count <> sub.failed_count)
    `);

  } catch (err: any) {
    console.error("[cron-tracking-rollup] 실패", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "통계 롤업 실패",
        detail: String(err?.message || err).slice(0, 500),
        durationMs: Date.now() - t0,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(
    `[cron-tracking-rollup] done ${Date.now() - t0}ms — ` +
      `updatedRecipients=${updatedRecipients}`,
  );

  return new Response(
    JSON.stringify({ ok: true, durationMs: Date.now() - t0, updatedRecipients }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
