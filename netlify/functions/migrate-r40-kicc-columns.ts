/**
 * GET /api/migrate-r40-kicc-columns
 *
 * R40 토스→KICC 전면 교체 — 결제 컬럼을 PG 비종속(pg_*) 네이밍으로 rename.
 *
 *  - donations    : toss_payment_key→pg_tid, toss_order_id→pg_order_no
 *  - billing_logs : toss_payment_key→pg_tid, toss_order_id→pg_order_no,
 *                   toss_response_code→pg_response_code, toss_response_message→pg_response_message
 *  - billing_keys / billing_logs : pg_provider 컬럼 신규 추가 (기본값 'kicc')
 *  - 관련 인덱스도 pg_* 이름으로 정리
 *  - customer_key 는 보존 (KICC 비종속 내부 회원-스코프 식별자로 재활용)
 *
 * 모드:
 *   GET (기본)             : 진단 모드 (인증 불필요) — 현재 컬럼 상태 점검
 *   GET ?run=1             : requireAdmin 후 rename·add 실행 (비파괴, 멱등)
 *   GET ?run=1&purge=1     : 위 + 테스트 결제데이터 삭제 (★ 비가역 — 효성 데이터는 보존)
 *
 * 호출 성공 후 즉시 파일 삭제 (1회용 보안 원칙).
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-r40-kicc-columns" };

/* information_schema에서 컬럼 존재 여부 일괄 조회 */
async function columnState() {
  const res: any = await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_name IN ('donations','billing_logs','billing_keys')
      AND column_name IN (
        'toss_payment_key','toss_order_id','toss_response_code','toss_response_message',
        'pg_tid','pg_order_no','pg_response_code','pg_response_message','pg_provider'
      )
  `);
  const rows = Array.isArray(res) ? res : (res as any).rows || [];
  const map: Record<string, string[]> = { donations: [], billing_logs: [], billing_keys: [] };
  for (const r of rows) {
    (map[r.table_name] ||= []).push(r.column_name);
  }
  return map;
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const purge = url.searchParams.get("purge") === "1";

  /* ───────── 진단 모드 ───────── */
  if (!run) {
    const state = await columnState();
    const renamed =
      state.donations.includes("pg_tid") &&
      state.billing_logs.includes("pg_tid") &&
      state.billing_logs.includes("pg_response_code");
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnosis",
      columns: state,
      already_renamed: renamed,
      message: renamed
        ? "이미 pg_* 컬럼으로 rename 완료된 상태입니다"
        : "toss_* 컬럼 존재 — ?run=1 로 실행하세요 (테스트데이터 삭제까지 하려면 ?run=1&purge=1)",
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  /* ───────── 실행 모드 — 관리자 인증 ───────── */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    /* 1. 컬럼 rename (멱등 — 구 컬럼이 남아있을 때만 rename) */
    await db.execute(sql`
      DO $$
      BEGIN
        -- donations
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='donations' AND column_name='toss_payment_key') THEN
          ALTER TABLE donations RENAME COLUMN toss_payment_key TO pg_tid;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='donations' AND column_name='toss_order_id') THEN
          ALTER TABLE donations RENAME COLUMN toss_order_id TO pg_order_no;
        END IF;

        -- billing_logs
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='billing_logs' AND column_name='toss_payment_key') THEN
          ALTER TABLE billing_logs RENAME COLUMN toss_payment_key TO pg_tid;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='billing_logs' AND column_name='toss_order_id') THEN
          ALTER TABLE billing_logs RENAME COLUMN toss_order_id TO pg_order_no;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='billing_logs' AND column_name='toss_response_code') THEN
          ALTER TABLE billing_logs RENAME COLUMN toss_response_code TO pg_response_code;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='billing_logs' AND column_name='toss_response_message') THEN
          ALTER TABLE billing_logs RENAME COLUMN toss_response_message TO pg_response_message;
        END IF;
      END $$;
    `);

    /* 2. pg_provider 신규 추가 (donations 에는 이미 존재) */
    await db.execute(sql`ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS pg_provider varchar(30) DEFAULT 'kicc'`);
    await db.execute(sql`ALTER TABLE billing_logs ADD COLUMN IF NOT EXISTS pg_provider varchar(30) DEFAULT 'kicc'`);

    /* 3. 인덱스 이름 정리 (구 이름이 남아있을 때만 — 컬럼 rename 시 인덱스 정의는 따라가지만 이름은 유지됨) */
    await db.execute(sql`ALTER INDEX IF EXISTS donations_toss_payment_key_idx RENAME TO donations_pg_tid_idx`);
    await db.execute(sql`ALTER INDEX IF EXISTS donations_toss_order_id_idx RENAME TO donations_pg_order_no_idx`);

    /* 4. 테스트 결제데이터 삭제 (옵트인 — 비가역) */
    let purgeResult: Record<string, number> | null = null;
    if (purge) {
      const counts: Record<string, number> = {};
      const del = async (label: string, stmt: any) => {
        const r: any = await db.execute(stmt);
        counts[label] = typeof r?.rowCount === "number" ? r.rowCount : (r?.count ?? 0);
      };
      /* billing_logs.donation_id → donations FK(set null), 둘 다 전건 삭제하므로 순서 무관.
         효성(계좌이체) 후원은 보존 — donations 는 pg_provider='toss' 인 행만 삭제. */
      await del("billing_logs", sql`DELETE FROM billing_logs`);
      await del("card_expiry_alerts", sql`DELETE FROM card_expiry_alerts`);
      await del("donations_toss", sql`DELETE FROM donations WHERE pg_provider = 'toss'`);
      await del("billing_keys", sql`DELETE FROM billing_keys`);
      purgeResult = counts;
    }

    const state = await columnState();
    return new Response(JSON.stringify({
      ok: true,
      message: purge
        ? "컬럼 rename + pg_provider 추가 + 테스트 결제데이터 삭제 완료"
        : "컬럼 rename + pg_provider 추가 완료 (테스트데이터 삭제는 ?run=1&purge=1)",
      columns: state,
      purged: purgeResult,
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};
