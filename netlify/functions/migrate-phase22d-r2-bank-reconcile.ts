/**
 * 1회용 마이그 — Phase 22-D-R2 통장거래내역 자동화
 *  · bank_transactions 컬럼 11개 추가 (§2.1)
 *  · counterparties 거래처 마스터 테이블 생성 (§2.2)
 *  · ai_tool_permissions에 bank_reconcile_summary 시드
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등 — IF NOT EXISTS / ON CONFLICT)
 *
 * 호출 성공 후 즉시 파일 삭제 + 커밋 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase22d-r2-bank-reconcile" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  const url   = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";

  // ── 진단 모드 ──────────────────────────────────────────────
  if (!doRun) {
    let cols: string[] = [];
    let hasCounterparties = false;
    let hasAiTool = false;
    try {
      const r: any = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'bank_transactions'`);
      cols = (r?.rows ?? r ?? []).map((x: any) => x.column_name);
      const t: any = await db.execute(sql`
        SELECT 1 FROM information_schema.tables WHERE table_name = 'counterparties' LIMIT 1`);
      hasCounterparties = (t?.rows ?? t ?? []).length > 0;
      const a: any = await db.execute(sql`
        SELECT 1 FROM ai_tool_permissions WHERE tool_name = 'bank_reconcile_summary' LIMIT 1`);
      hasAiTool = (a?.rows ?? a ?? []).length > 0;
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, mode: "diagnostic", error: String(e?.message).slice(0, 300) }),
        { status: 500, headers: JSON_HEADER });
    }
    const needCols = ["counterpart_account", "counterpart_bank", "counterpart_name", "txn_method",
      "memo", "cms_code", "counterparty_id", "donation_id", "other_revenue_id", "match_type", "dedup_hash"];
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      bankTxnColumnsPresent: needCols.filter(c => cols.includes(c)),
      bankTxnColumnsMissing: needCols.filter(c => !cols.includes(c)),
      counterpartiesTableExists: hasCounterparties,
      aiToolSeeded: hasAiTool,
      hint: "?run=1 으로 실행 (멱등)",
    }), { headers: JSON_HEADER });
  }

  // ── 인증 ──────────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const results: { step: string; result: string }[] = [];
  const exec = async (step: string, q: any) => {
    try { await db.execute(q); results.push({ step, result: "ok" }); }
    catch (e: any) { results.push({ step, result: String(e?.message).slice(0, 300) }); }
  };

  // ── §2.1 bank_transactions 컬럼 11개 추가 ────────────────────
  await exec("add_counterpart_account", sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS counterpart_account VARCHAR(50)`);
  await exec("add_counterpart_bank",    sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS counterpart_bank VARCHAR(50)`);
  await exec("add_counterpart_name",    sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS counterpart_name VARCHAR(200)`);
  await exec("add_txn_method",          sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS txn_method VARCHAR(50)`);
  await exec("add_memo",                sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS memo TEXT`);
  await exec("add_cms_code",            sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS cms_code VARCHAR(50)`);
  await exec("add_counterparty_id",     sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS counterparty_id INTEGER`);
  await exec("add_donation_id",         sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS donation_id INTEGER`);
  await exec("add_other_revenue_id",    sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS other_revenue_id INTEGER`);
  await exec("add_match_type",          sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS match_type VARCHAR(30)`);
  await exec("add_dedup_hash",          sql`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS dedup_hash VARCHAR(64)`);
  await exec("idx_dedup_hash",          sql`CREATE INDEX IF NOT EXISTS bank_txns_dedup_idx ON bank_transactions(dedup_hash)`);
  await exec("idx_match_type",          sql`CREATE INDEX IF NOT EXISTS bank_txns_match_type_idx ON bank_transactions(match_type)`);

  // ── §2.2 counterparties 거래처 마스터 ───────────────────────
  await exec("create_counterparties", sql`
    CREATE TABLE IF NOT EXISTS counterparties (
      id                     SERIAL PRIMARY KEY,
      name                   VARCHAR(200) NOT NULL,
      account_no             VARCHAR(50),
      bank_name              VARCHAR(50),
      default_match_type     VARCHAR(30),
      default_account_code   VARCHAR(20),
      default_budget_line_id INTEGER,
      txn_count              INTEGER DEFAULT 0,
      note                   TEXT,
      learned_by             INTEGER,
      created_at             TIMESTAMPTZ DEFAULT NOW(),
      updated_at             TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(account_no, name)
    )`);
  await exec("idx_counterparties_name", sql`CREATE INDEX IF NOT EXISTS counterparties_name_idx ON counterparties(name)`);
  await exec("idx_counterparties_acct", sql`CREATE INDEX IF NOT EXISTS counterparties_account_idx ON counterparties(account_no)`);

  // ── §6 ai_tool_permissions 시드 ─────────────────────────────
  await exec("seed_bank_reconcile_summary", sql`
    INSERT INTO ai_tool_permissions
      (tool_name, enabled, required_role, description, is_mutation, category)
    VALUES
      ('bank_reconcile_summary', TRUE, 'admin', '통장 입출금 대사 현황 요약 (입금 매칭/미확인, 출금 전표생성/대기, 묶음정산)', FALSE, 'finance')
    ON CONFLICT (tool_name) DO NOTHING`);

  const failed = results.filter(r => r.result !== "ok");
  return new Response(JSON.stringify({
    ok: failed.length === 0,
    mode: "executed",
    results,
    failedCount: failed.length,
    message: failed.length === 0
      ? "Phase 22-D-R2 마이그 완료 — bank_transactions 확장 + counterparties + AI 도구 시드"
      : `${failed.length}건 실패 — results 확인`,
  }, null, 2), { status: failed.length === 0 ? 200 : 500, headers: JSON_HEADER });
}
