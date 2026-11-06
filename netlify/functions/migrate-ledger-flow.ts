/**
 * GET /api/migrate-ledger-flow            — 진단 (인증 불필요·읽기 전용)
 * GET /api/migrate-ledger-flow?run=1      — 실행 (어드민 인증)
 * GET /api/migrate-ledger-flow?cleanup=1  — 시험 연도(2099) 정리 (어드민 인증)
 *
 * 2단계 돈의 흐름 연결(2026-11-06). 설계: docs/active/2026-11-06-ledger-flow-design.md
 * 멱등: 다시 실행해도 안전. 호출 성공 후 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-ledger-flow" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

const STRUCTURE: string[] = [
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS function_code VARCHAR(20)`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS program_id INTEGER REFERENCES ledger_programs(id)`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS fund_id INTEGER REFERENCES ledger_funds(id)`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS payment_status VARCHAR(10) NOT NULL DEFAULT 'none'`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS paid_at DATE`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS paid_by INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS bank_txn_id INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS pay_account_code VARCHAR(20)`,
  `CREATE INDEX IF NOT EXISTS approval_requests_payment_idx ON approval_requests (payment_status)`,

  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_code VARCHAR(20)`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS function_code VARCHAR(20)`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS program_id INTEGER REFERENCES ledger_programs(id)`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fund_id INTEGER REFERENCES ledger_funds(id)`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_txn_id INTEGER`,
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS pay_account_code VARCHAR(20)`,

  `ALTER TABLE revenue_categories ADD COLUMN IF NOT EXISTS account_code VARCHAR(20)`,
  `ALTER TABLE bank_imports ADD COLUMN IF NOT EXISTS account_code VARCHAR(20)`,

  `CREATE TABLE IF NOT EXISTS ledger_staff_allocations (
     member_id INTEGER PRIMARY KEY,
     function_code VARCHAR(20) NOT NULL DEFAULT 'admin',
     program_id INTEGER REFERENCES ledger_programs(id),
     fund_id INTEGER REFERENCES ledger_funds(id),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ledger_staff_function_ck CHECK (function_code IN ('service','admin','fundraising'))
   )`,
];

const REVENUE_ACCOUNTS: [string, string][] = [
  ["lecture", "4014"], ["govgrant", "4012"], ["corp_sponsor", "4015"],
  ["twork_on", "4014"], ["twork_si", "4014"], ["etc", "4022"],
];

/* 예산 목 코드 → 계정과목 */
const BUDGET_ACCOUNTS: [string, string][] = [
  ["1-1-01", "5011"], ["1-1-02", "5015"], ["1-1-03", "5011"], ["1-2-01", "5013"], ["1-2-02", "5013"], ["1-9-99", "5045"],
  ["2-1-01", "5021"], ["2-1-02", "5023"], ["2-1-03", "5024"], ["2-2-01", "5026"], ["2-2-02", "5022"], ["2-9-99", "5045"],
  ["3-1-01", "5031"], ["3-1-02", "5034"], ["3-1-03", "5033"], ["3-1-04", "5032"],
  ["3-2-01", "5039"], ["3-2-02", "5038"], ["3-9-99", "5045"],
  ["4-1-01", "5041"], ["4-1-02", "5042"], ["4-9-99", "5045"],
];

const CLEANUP_YEAR = 2099;

async function columnExists(table: string, column: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `)).length > 0;
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";
    const cleanup = url.searchParams.get("cleanup") === "1";

    step = "diag";
    const applied = await columnExists("approval_requests", "payment_status");
    const diag: Record<string, unknown> = {
      applied,
      approved_requests: Number(rowsOf(await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM approval_requests WHERE status = 'approved'`))[0]?.n ?? 0),
      budget_map_rows: Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM budget_account_code_map`))[0]?.n ?? 0),
    };
    if (!run && !cleanup) {
      return new Response(jsonKST({ ok: true, mode: "diagnose", ...diag, hint: applied ? "이미 적용됨" : "?run=1 로 실행하세요." }, null, 2),
        { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    if (cleanup) {
      step = "cleanup";
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`ALTER TABLE vouchers DISABLE TRIGGER ledger_voucher_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE voucher_lines DISABLE TRIGGER ledger_line_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE ledger_history DISABLE TRIGGER ledger_history_guard_trg`));
        const count = async (q: any) => Number(rowsOf(await tx.execute(q))[0]?.n ?? 0);
        const vouchers = await count(sql`SELECT COUNT(*)::int AS n FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR}`);
        const requests = await count(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`UPDATE vouchers SET reversed_by_id = NULL, reversal_of_id = NULL WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher'
          AND entity_id IN (SELECT id::text FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR})`);
        await tx.execute(sql`DELETE FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'approval'
          AND entity_id IN (SELECT id::text FROM approval_requests WHERE fiscal_year = ${CLEANUP_YEAR})`);
        await tx.execute(sql`DELETE FROM approval_request_steps WHERE request_id IN
          (SELECT id FROM approval_requests WHERE fiscal_year = ${CLEANUP_YEAR})`);
        await tx.execute(sql`DELETE FROM approval_requests WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM expenses WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM other_revenues WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'fiscal_year' AND entity_id = ${String(CLEANUP_YEAR)}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher' AND reason = 'E2E 시험'`);
        /* 장부 시작 전이라 지금까지의 반영 기록과 사라진 전표의 기록은 전부 시험분이다 */
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'ledger_sync'`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher'
          AND entity_id NOT IN (SELECT id::text FROM vouchers)`);
        await tx.execute(sql`DELETE FROM ledger_fiscal_years WHERE year = ${CLEANUP_YEAR}`);
        await tx.execute(sql.raw(`ALTER TABLE vouchers ENABLE TRIGGER ledger_voucher_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE voucher_lines ENABLE TRIGGER ledger_line_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE ledger_history ENABLE TRIGGER ledger_history_guard_trg`));
        return { deletedVouchers: vouchers, deletedRequests: requests };
      });
      return new Response(jsonKST({ ok: true, mode: "cleanup", ...result }, null, 2), { headers: JSON_HEADER });
    }

    step = "run";
    const summary = await db.transaction(async (tx) => {
      step = "structure";
      for (const q of STRUCTURE) await tx.execute(sql.raw(q));

      step = "backfill_requests";
      await tx.execute(sql`
        UPDATE approval_requests SET payment_status = 'paid'
         WHERE status = 'approved' AND expense_id IS NOT NULL AND payment_status = 'none'`);

      step = "seed_revenue_accounts";
      for (const [code, account] of REVENUE_ACCOUNTS) {
        await tx.execute(sql`
          UPDATE revenue_categories SET account_code = ${account} WHERE code = ${code} AND account_code IS NULL`);
      }

      step = "seed_budget_map";
      for (const [code, account] of BUDGET_ACCOUNTS) {
        await tx.execute(sql`
          INSERT INTO budget_account_code_map (budget_account_id, account_code)
          SELECT b.id, ${account} FROM budget_accounts b
           WHERE b.code = ${code}
             AND NOT EXISTS (SELECT 1 FROM budget_account_code_map m WHERE m.budget_account_id = b.id)`);
      }

      step = "bank_imports";
      await tx.execute(sql`
        UPDATE bank_imports
           SET account_code = CASE WHEN bank_name LIKE '%우리%' THEN '1012' ELSE '1013' END
         WHERE account_code IS NULL`);

      step = "summary";
      const count = async (q: any) => Number(rowsOf(await tx.execute(q))[0]?.n ?? 0);
      return {
        paidRequests: await count(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE payment_status = 'paid'`),
        revenueLinked: await count(sql`SELECT COUNT(*)::int AS n FROM revenue_categories WHERE account_code IS NOT NULL`),
        budgetLinked: await count(sql`SELECT COUNT(*)::int AS n FROM budget_account_code_map`),
      };
    });

    return new Response(jsonKST({ ok: true, mode: "run", ...summary }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그레이션 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, null, 2), { status: 500, headers: JSON_HEADER });
  }
}
