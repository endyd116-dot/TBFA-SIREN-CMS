// netlify/functions/cron-nurture-runner.ts
// ★ 2026-06-26 후원자 너처링 엔진 — 매일 1회 (KST 08:00 = UTC 23:00·:00 정렬)
//
// 활성 여정의 세그먼트 진입·전환종료·due 단계 발송·영구 규칙을 처리.
// 여정 is_active=false면 아무것도 안 함(기본 OFF). 실제 발송은 기존 발송 엔진 재사용.

import { jsonKST } from "../../lib/kst";
import { runNurture } from "../../lib/nurture-engine";

export const config = { schedule: "0 23 * * *" };

export default async function handler(_req: Request) {
  const t0 = Date.now();
  try {
    const summary = await runNurture();
    console.log(`[cron-nurture] done in ${Date.now() - t0}ms`, JSON.stringify(summary));
    return new Response(jsonKST({ ok: true, durationMs: Date.now() - t0, summary }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cron-nurture] 실패", err);
    return new Response(jsonKST({ ok: false, error: String(err?.message || err).slice(0, 500) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
