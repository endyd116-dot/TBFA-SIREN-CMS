/**
 * netlify/functions/cron-donor-status-sync.ts
 * ★ Phase 2 (마일스톤 #16 단계 C): 후원 분류 야간 동기화
 *
 * 매일 KST 03:00 (UTC 18:00) 실행 — 안전망:
 *   - 즉시 반영 후크가 누락된 케이스(특이 상황·수동 변경·외부 시스템 변경)를 매일 일괄 보정
 *   - members.donor_type / donor_channels / prospect_subtype / donor_evaluated_at 갱신
 *
 * 식별 기준은 lib/donor-status.ts reevaluateAllDonorTypes 단일 SQL 일괄 처리 (N+1 방지).
 *
 * netlify.toml 스케줄: "0 18 * * *"
 */

import type { Config } from "@netlify/functions";
import { reevaluateAllDonorTypes } from "../../lib/donor-status";

export const config: Config = {
  schedule: "0 18 * * *", // UTC 18:00 = KST 03:00
};

export default async (_req: Request) => {
  const startedAt = new Date();
  console.log(`[cron-donor-status-sync] 시작 ${startedAt.toISOString()}`);

  try {
    const summary = await reevaluateAllDonorTypes();
    const completedAt = new Date();

    const payload = {
      ok: true,
      summary,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };

    console.log(`[cron-donor-status-sync] 완료`, JSON.stringify(payload, null, 2));

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(`[cron-donor-status-sync] 치명적 오류:`, err);
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "후원 분류 동기화 실패",
          step: "reevaluateAllDonorTypes",
          detail: String(err?.message || err).slice(0, 500),
          stack: String(err?.stack || "").slice(0, 1000),
        },
        null,
        2,
      ),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
