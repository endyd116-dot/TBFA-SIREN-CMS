// netlify/functions/cron-communication-send-dispatcher.ts
// Phase 10 R3 — 발송 큐 디스패처 (안전망 크론)
//
// 2026-06-25 DB 비용 절감(wake-on-demand): 기존 */10 상시 폴링이 Neon DB를 24/7 깨워
//   비용 폭증 → 이벤트 기반으로 전환.
//   - 즉시 발송: admin-send-job-create가 발송 큐 적재 직후 백그라운드 드레이너를 즉시 fire(지연 0).
//   - 이 크론(*/30)은 "안전망"으로만 — 예약 발송 도래분·실패 잔여·즉시-fire 누락분이 있을 때만
//     백그라운드 드레이너를 깨운다. 할 일이 없으면 가벼운 확인 1회 후 종료 → DB가 다시 잠.
//
// 실제 발송 로직은 lib/communication-dispatcher-core.ts(runDispatcher) + 백그라운드 함수가 수행.
// 원자적 claim으로 즉시-fire와 이 크론이 동시에 깨워도 중복/누락 0.

import { jsonKST } from "../../lib/kst";
import { hasDispatchWork, triggerDispatchBackground } from "../../lib/communication-dispatcher-core";

// 2026-06-25 DB 비용 절감 2차: 30분 → 1시간(:00 정렬·:30 wake 제거). 예약 발송만 최대 1시간 지연(즉시 발송은 이벤트로 무관).
export const config = { schedule: "0 * * * *" };

export default async function handler(_req: Request) {
  const t0 = Date.now();
  let fired = false;
  let bgStatus = 0;
  try {
    const work = await hasDispatchWork();
    if (work) {
      const bg = await triggerDispatchBackground();
      fired = bg.ok;
      bgStatus = bg.status;
      if (!bg.ok) {
        console.error("[cron-dispatcher] 백그라운드 드레이너 fire 실패", bg.status, bg.error);
      }
    }
    console.log(`[cron-dispatcher] done in ${Date.now() - t0}ms — work=${work} fired=${fired} bgStatus=${bgStatus}`);
    return new Response(
      jsonKST({ ok: true, durationMs: Date.now() - t0, work, fired, bgStatus }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[cron-dispatcher] 실패", err);
    return new Response(
      jsonKST({ ok: false, error: String(err?.message || err).slice(0, 300) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
