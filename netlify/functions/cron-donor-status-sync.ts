/**
 * netlify/functions/cron-donor-status-sync.ts
 * Phase 2 (마일스톤 #16 단계 C): 후원 분류 야간 동기화
 * Phase 3 (마일스톤 #16 단계 D) 정교화: hyosung_contracts.contract_status 직접 동기화 선행
 *
 * 매일 KST 03:00 (UTC 18:00) 실행 — 안전망:
 *   Step 1 (D5 추가): hyosung_contracts 테이블에서 최신 contract_status를
 *                     members.hyosung_contract_status에 일괄 동기화
 *   Step 2: members.donor_type / donor_channels / prospect_subtype 재평가 (bulk SQL)
 *
 * Step 1 이유: contracts 업로드 없이도 외부 변경이 있었을 때 members와 정합 보장.
 *             단, SIREN → 효성 방향 변경은 절대 없음 (SOT §10.2 일방향 흐름).
 *
 * netlify.toml 스케줄: "0 18 * * *"
 */

import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { reevaluateAllDonorTypes, type BulkReevaluateSummary } from "../../lib/donor-status";

export const config: Config = {
  schedule: "0 18 * * *", // UTC 18:00 = KST 03:00
};

export default async (_req: Request) => {
  const startedAt = new Date();
  console.log(`[cron-donor-status-sync] 시작 ${startedAt.toISOString()}`);

  /* ─────────────────────────────────────────────────────────
     Step 1 (D5): hyosung_contracts → members.hyosung_contract_status 동기화
     JOIN 조건: hyosung_contracts.member_no = members.hyosung_member_no
     방향: 효성 → SIREN (일방향, SIREN 고유 컬럼 보존)
     ───────────────────────────────────────────────────────── */
  let hyosungSyncCount = 0;
  try {
    const syncResult: any = await db.execute(sql`
      UPDATE members m
      SET
        hyosung_contract_status = (
          CASE hc.contract_status
            WHEN '사용' THEN 'active'
            WHEN '중지' THEN 'cancelled'
            WHEN '기간만료' THEN 'expired'
            ELSE hc.contract_status
          END
        ),
        hyosung_promise_day = COALESCE(hc.promise_day, m.hyosung_promise_day),
        hyosung_payment_method = COALESCE(hc.payment_method, m.hyosung_payment_method),
        hyosung_payment_tool = COALESCE(hc.payment_tool, m.hyosung_payment_tool),
        hyosung_bank_info = COALESCE(hc.payment_info, m.hyosung_bank_info),
        hyosung_synced_at = NOW(),
        updated_at = NOW()
      FROM hyosung_contracts hc
      WHERE hc.member_no = m.hyosung_member_no
        AND hc.contract_status IS NOT NULL
        AND (
          m.hyosung_contract_status IS DISTINCT FROM (
            CASE hc.contract_status
              WHEN '사용' THEN 'active'
              WHEN '중지' THEN 'cancelled'
              WHEN '기간만료' THEN 'expired'
              ELSE hc.contract_status
            END
          )
          OR m.hyosung_synced_at IS NULL
        )
    `);
    /* Drizzle raw execute 결과에서 rowCount 추출 */
    hyosungSyncCount =
      Number((syncResult as any)?.rowCount ?? (syncResult as any)?.count ?? 0);
    console.log(`[cron-donor-status-sync] Step 1 효성 동기화: ${hyosungSyncCount}건 갱신`);
  } catch (err: any) {
    /* Step 1 실패해도 Step 2는 계속 진행 (부분 실패 허용) */
    console.error(`[cron-donor-status-sync] Step 1 효성 동기화 오류:`, err?.message || err);
  }

  /* ─────────────────────────────────────────────────────────
     Step 2: 전체 후원 분류 재평가 (lib/donor-status.ts 단일 SQL)
     ───────────────────────────────────────────────────────── */
  let summary: BulkReevaluateSummary | null = null;
  try {
    summary = await reevaluateAllDonorTypes();
    const completedAt = new Date();

    const payload = {
      ok: true,
      hyosungSyncCount,
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
    console.error(`[cron-donor-status-sync] Step 2 치명적 오류:`, err);
    return new Response(
      JSON.stringify(
        {
          ok: false,
          hyosungSyncCount,
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
