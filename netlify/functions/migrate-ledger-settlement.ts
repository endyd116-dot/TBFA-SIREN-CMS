/**
 * GET /api/migrate-ledger-settlement            — 진단 (인증 불필요·읽기 전용)
 * GET /api/migrate-ledger-settlement?run=1      — 실행 (어드민 인증)
 * GET /api/migrate-ledger-settlement?cleanup=1  — 시험 데이터(2099·2100년) 정리 (어드민 인증)
 *
 * 3단계 결산과 2027 편성(2026-11-06). 설계: docs/active/2026-11-06-ledger-settlement-design.md
 * 설계도 대조 수정(로드맵 §7): 예산 원장, 지급 뒤 취소의 반환 상태.
 * 4단계 공통 결재 문서: docs/active/2026-11-06-approval-docs-design.md
 * 멱등: 다시 실행해도 안전. 호출 성공 후 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-ledger-settlement" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

const STRUCTURE: string[] = [
  /* 1. 결산 상태 */
  `CREATE TABLE IF NOT EXISTS ledger_settlements (
     year INTEGER PRIMARY KEY REFERENCES ledger_fiscal_years(year),
     status VARCHAR(20) NOT NULL DEFAULT 'draft',
     checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
     snapshot JSONB,
     locked_at TIMESTAMPTZ,
     locked_by INTEGER,
     locked_by_name VARCHAR(100),
     audited_on DATE,
     auditor_name VARCHAR(100),
     audit_opinion TEXT,
     board_on DATE,
     board_note TEXT,
     assembly_on DATE,
     assembly_note TEXT,
     submitted_on DATE,
     submitted_to VARCHAR(120),
     submitted_note TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ledger_settlements_status_ck CHECK (status IN
       ('draft','locked','audited','board_approved','assembly_approved','submitted'))
   )`,

  /* 2. 주석 문구 */
  `CREATE TABLE IF NOT EXISTS ledger_notes (
     year INTEGER NOT NULL,
     note_key VARCHAR(20) NOT NULL,
     body TEXT NOT NULL,
     updated_by INTEGER,
     updated_by_name VARCHAR(100),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (year, note_key)
   )`,

  /* 3. 사업 계획·실적 */
  `CREATE TABLE IF NOT EXISTS ledger_program_reports (
     year INTEGER NOT NULL,
     program_id INTEGER NOT NULL REFERENCES ledger_programs(id),
     plan_target VARCHAR(300),
     plan_period VARCHAR(100),
     plan_body TEXT,
     result_body TEXT,
     events INTEGER,
     beneficiaries INTEGER,
     updated_by INTEGER,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (year, program_id)
   )`,

  /* 4. 재산목록 */
  `CREATE TABLE IF NOT EXISTS ledger_property_items (
     id SERIAL PRIMARY KEY,
     year INTEGER NOT NULL,
     property_class VARCHAR(10) NOT NULL DEFAULT 'ordinary',
     account_code VARCHAR(20) NOT NULL REFERENCES account_codes(code),
     name VARCHAR(200) NOT NULL,
     detail VARCHAR(300),
     quantity VARCHAR(50),
     amount BIGINT NOT NULL DEFAULT 0,
     note VARCHAR(300),
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ledger_property_class_ck CHECK (property_class IN ('basic','ordinary'))
   )`,
  `CREATE INDEX IF NOT EXISTS ledger_property_year_idx ON ledger_property_items (year)`,

  /* 5. 공통비 배분 규칙 */
  `CREATE TABLE IF NOT EXISTS ledger_allocation_rules (
     id SERIAL PRIMARY KEY,
     name VARCHAR(120) NOT NULL UNIQUE,
     basis VARCHAR(300),
     lines JSONB NOT NULL DEFAULT '[]'::jsonb,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `ALTER TABLE ledger_staff_allocations ADD COLUMN IF NOT EXISTS rule_id INTEGER REFERENCES ledger_allocation_rules(id)`,

  /* 6. 수입 예산, 목 나누기, 전기이월 */
  `CREATE TABLE IF NOT EXISTS budget_revenue_lines (
     id SERIAL PRIMARY KEY,
     plan_id INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
     account_code VARCHAR(20) NOT NULL REFERENCES account_codes(code),
     fund_id INTEGER REFERENCES ledger_funds(id),
     planned_amount BIGINT NOT NULL DEFAULT 0,
     prev_year_actual BIGINT NOT NULL DEFAULT 0,
     note TEXT,
     CONSTRAINT budget_revenue_lines_uq UNIQUE (plan_id, account_code)
   )`,
  `CREATE TABLE IF NOT EXISTS budget_line_splits (
     id SERIAL PRIMARY KEY,
     line_id INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
     function_code VARCHAR(20),
     program_id INTEGER REFERENCES ledger_programs(id),
     fund_id INTEGER REFERENCES ledger_funds(id),
     amount BIGINT NOT NULL DEFAULT 0,
     note VARCHAR(200),
     CONSTRAINT budget_line_splits_function_ck CHECK (function_code IS NULL OR function_code IN ('service','admin','fundraising'))
   )`,
  `CREATE INDEX IF NOT EXISTS budget_line_splits_line_idx ON budget_line_splits (line_id)`,
  `ALTER TABLE budget_plans ADD COLUMN IF NOT EXISTS carry_in BIGINT NOT NULL DEFAULT 0`,

  /* 7. 예산 원장 (설계도 13쪽). 예약·집행·해제·환입을 지우지 않고 쌓는다 */
  `CREATE TABLE IF NOT EXISTS budget_ledger (
     id BIGSERIAL PRIMARY KEY,
     fiscal_year INTEGER NOT NULL,
     budget_account_id INTEGER,
     document_type VARCHAR(30) NOT NULL DEFAULT 'approval_request',
     document_id INTEGER NOT NULL,
     document_no VARCHAR(40),
     document_version INTEGER NOT NULL DEFAULT 1,
     txn_type VARCHAR(12) NOT NULL,
     amount BIGINT NOT NULL,
     reserved_before BIGINT NOT NULL DEFAULT 0,
     reserved_after BIGINT NOT NULL DEFAULT 0,
     executed_before BIGINT NOT NULL DEFAULT 0,
     executed_after BIGINT NOT NULL DEFAULT 0,
     paid_on DATE,
     actor_id INTEGER,
     actor_name VARCHAR(100),
     origin_id BIGINT REFERENCES budget_ledger(id),
     idempotency_key VARCHAR(80) NOT NULL,
     note VARCHAR(300),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT budget_ledger_idem_uq UNIQUE (idempotency_key),
     CONSTRAINT budget_ledger_type_ck CHECK (txn_type IN ('reserve','execute','release','refund','correction'))
   )`,
  `CREATE INDEX IF NOT EXISTS budget_ledger_account_idx ON budget_ledger (fiscal_year, budget_account_id)`,
  `CREATE INDEX IF NOT EXISTS budget_ledger_doc_idx ON budget_ledger (document_type, document_id)`,
  `CREATE OR REPLACE FUNCTION budget_ledger_guard() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION '예산 원장은 고치거나 지울 수 없습니다. 정정 거래로 처리하세요.';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS budget_ledger_guard_trg ON budget_ledger`,
  `CREATE TRIGGER budget_ledger_guard_trg BEFORE UPDATE OR DELETE ON budget_ledger
     FOR EACH ROW EXECUTE FUNCTION budget_ledger_guard()`,

  /* 8. 지급 뒤 취소의 반환 상태. 집행액은 실제 반환 확인 때만 줄인다 (설계도 10·11쪽) */
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS refund_status VARCHAR(10) NOT NULL DEFAULT 'none'`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS refund_confirmed_at TIMESTAMPTZ`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS refund_confirmed_by INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS paid_amount BIGINT`,

  /* ── 4단계 공통 결재 문서 ── */
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS doc_type VARCHAR(20) NOT NULL DEFAULT 'expense'`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS doc_no VARCHAR(30)`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS body TEXT`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS form_data JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS form_version INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS pay_method VARCHAR(20)`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS expense_kind VARCHAR(20)`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS budget_split_id INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(20) NOT NULL DEFAULT 'line'`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS substitute_basis_id INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS cancel_status VARCHAR(12) NOT NULL DEFAULT 'none'`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS cancel_requested_by INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS delete_status VARCHAR(12) NOT NULL DEFAULT 'none'`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS deleted_by INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS delete_reason TEXT`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS hold_reason TEXT`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS att_leave_request_id INTEGER`,
  `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS followup_due BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE approval_requests ALTER COLUMN budget_account_id DROP NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_doc_no_uq ON approval_requests (doc_no) WHERE doc_no IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS approval_requests_doc_type_idx ON approval_requests (doc_type, status)`,

  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'approval'`,
  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS step_type VARCHAR(10) NOT NULL DEFAULT 'approve'`,
  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS assignee_id INTEGER`,
  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(100)`,
  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS assignee_title VARCHAR(100)`,
  `DROP INDEX IF EXISTS approval_steps_req_step_uq`,
  `ALTER TABLE approval_request_steps DROP CONSTRAINT IF EXISTS approval_request_steps_request_id_step_index_key`,
  `ALTER TABLE approval_request_steps ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 0`,
  `CREATE UNIQUE INDEX IF NOT EXISTS approval_steps_doc_uq ON approval_request_steps (request_id, version, kind, round, step_index)`,
  `CREATE INDEX IF NOT EXISTS approval_steps_assignee_idx ON approval_request_steps (assignee_id, decision)`,

  `CREATE TABLE IF NOT EXISTS approval_settings (
     id INTEGER PRIMARY KEY DEFAULT 1,
     card_rule_effective_on DATE,
     card_rule_note TEXT,
     retention_years INTEGER,
     require_proposal BOOLEAN NOT NULL DEFAULT TRUE,
     proposal_min_amount BIGINT NOT NULL DEFAULT 0,
     updated_by_name VARCHAR(100),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT approval_settings_one CHECK (id = 1)
   )`,
  `INSERT INTO approval_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS approval_doc_versions (
     id SERIAL PRIMARY KEY,
     request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     snapshot JSONB NOT NULL,
     content_hash VARCHAR(64),
     submitted_by INTEGER,
     submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT approval_doc_versions_uq UNIQUE (request_id, version)
   )`,
  `CREATE TABLE IF NOT EXISTS approval_doc_references (
     id SERIAL PRIMARY KEY,
     request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
     target_id INTEGER NOT NULL REFERENCES approval_requests(id),
     target_version INTEGER,
     target_doc_no VARCHAR(30),
     ref_kind VARCHAR(10) NOT NULL DEFAULT 'related',
     created_by INTEGER,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT approval_doc_references_uq UNIQUE (request_id, target_id),
     CONSTRAINT approval_doc_references_kind_ck CHECK (ref_kind IN ('basis','related'))
   )`,
  `CREATE INDEX IF NOT EXISTS approval_doc_references_target_idx ON approval_doc_references (target_id)`,
  `CREATE TABLE IF NOT EXISTS approval_doc_files (
     id SERIAL PRIMARY KEY,
     request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
     version INTEGER NOT NULL DEFAULT 1,
     file_kind VARCHAR(20) NOT NULL DEFAULT 'attachment',
     blob_id INTEGER,
     blob_key VARCHAR(255),
     file_name VARCHAR(500) NOT NULL,
     mime_type VARCHAR(100),
     size_bytes INTEGER,
     sha256 VARCHAR(64),
     uploaded_by INTEGER,
     uploaded_by_name VARCHAR(100),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     removed_at TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS approval_doc_files_req_idx ON approval_doc_files (request_id)`,
  `CREATE TABLE IF NOT EXISTS approval_doc_watchers (
     request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
     member_id INTEGER NOT NULL,
     member_name VARCHAR(100),
     kind VARCHAR(10) NOT NULL DEFAULT 'reference',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (request_id, member_id)
   )`,
  `CREATE TABLE IF NOT EXISTS approval_doc_comments (
     id SERIAL PRIMARY KEY,
     request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
     member_id INTEGER,
     member_name VARCHAR(100),
     body TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS approval_doc_sequences (
     doc_type VARCHAR(20) NOT NULL,
     year INTEGER NOT NULL,
     last_no INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (doc_type, year)
   )`,
  `CREATE TABLE IF NOT EXISTS approval_saved_lines (
     id SERIAL PRIMARY KEY,
     owner_id INTEGER,
     name VARCHAR(120) NOT NULL,
     steps JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS approval_form_guides (
     id SERIAL PRIMARY KEY,
     doc_type VARCHAR(20) NOT NULL,
     version INTEGER NOT NULL,
     guide TEXT NOT NULL,
     created_by_name VARCHAR(100),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT approval_form_guides_uq UNIQUE (doc_type, version)
   )`,
  `CREATE TABLE IF NOT EXISTS approval_purge_grants (
     id SERIAL PRIMARY KEY,
     member_id INTEGER NOT NULL,
     member_name VARCHAR(100),
     granted_by INTEGER,
     granted_by_name VARCHAR(100),
     start_on DATE NOT NULL,
     end_on DATE NOT NULL,
     reason TEXT NOT NULL,
     revoked_at TIMESTAMPTZ,
     revoked_by_name VARCHAR(100),
     revoke_reason TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS approval_purge_log (
     id BIGSERIAL PRIMARY KEY,
     request_id INTEGER NOT NULL,
     doc_no VARCHAR(30),
     doc_type VARCHAR(20),
     actor_id INTEGER,
     actor_name VARCHAR(100),
     grant_id INTEGER,
     reason TEXT NOT NULL,
     scope JSONB NOT NULL DEFAULT '{}'::jsonb,
     result VARCHAR(20) NOT NULL DEFAULT 'done',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE OR REPLACE FUNCTION approval_purge_log_guard() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION '완전삭제 기록은 고치거나 지울 수 없습니다.';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS approval_purge_log_guard_trg ON approval_purge_log`,
  `CREATE TRIGGER approval_purge_log_guard_trg BEFORE UPDATE OR DELETE ON approval_purge_log
     FOR EACH ROW EXECUTE FUNCTION approval_purge_log_guard()`,
];

const CLEANUP_YEARS = [2099, 2100];
const TEST_PLAN = { year: 2027, total: 14788 };

async function tableExists(name: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${name}
  `)).length > 0;
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";
    const cleanup = url.searchParams.get("cleanup") === "1";

    step = "diag";
    const applied = await tableExists("ledger_settlements");
    const testPlan = rowsOf(await db.execute(sql`
      SELECT id, status, total_planned FROM budget_plans
       WHERE fiscal_year = ${TEST_PLAN.year} AND total_planned = ${TEST_PLAN.total}`));
    const diag: Record<string, unknown> = { applied, testPlans: testPlan.length };
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
        const years = sql`(${sql.join(CLEANUP_YEARS.map((y) => sql`${y}`), sql`, `)})`;
        await tx.execute(sql.raw(`ALTER TABLE vouchers DISABLE TRIGGER ledger_voucher_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE voucher_lines DISABLE TRIGGER ledger_line_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE ledger_history DISABLE TRIGGER ledger_history_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE budget_ledger DISABLE TRIGGER budget_ledger_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE approval_purge_log DISABLE TRIGGER approval_purge_log_guard_trg`));
        const count = async (q: any) => Number(rowsOf(await tx.execute(q))[0]?.n ?? 0);
        const vouchers = await count(sql`SELECT COUNT(*)::int AS n FROM vouchers WHERE fiscal_year IN ${years}`);
        const requests = await count(sql`SELECT COUNT(*)::int AS n FROM approval_requests WHERE fiscal_year IN ${years}`);

        await tx.execute(sql`DELETE FROM budget_ledger WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`DELETE FROM approval_purge_log WHERE request_id IN
          (SELECT id FROM approval_requests WHERE fiscal_year IN ${years})`);
        await tx.execute(sql`DELETE FROM approval_doc_references WHERE target_id IN
          (SELECT id FROM approval_requests WHERE fiscal_year IN ${years})`);
        await tx.execute(sql`DELETE FROM approval_saved_lines WHERE name LIKE '[점검]%'`);
        await tx.execute(sql`DELETE FROM approval_purge_grants WHERE reason LIKE '[점검]%'`);
        await tx.execute(sql`DELETE FROM ledger_settlements WHERE year IN ${years}`);
        await tx.execute(sql`DELETE FROM ledger_notes WHERE year IN ${years}`);
        await tx.execute(sql`DELETE FROM ledger_program_reports WHERE year IN ${years}`);
        await tx.execute(sql`DELETE FROM ledger_property_items WHERE year IN ${years}`);
        await tx.execute(sql`DELETE FROM budget_plans WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`UPDATE ledger_staff_allocations SET rule_id = NULL
          WHERE rule_id IN (SELECT id FROM ledger_allocation_rules WHERE name LIKE '[점검]%')`);
        await tx.execute(sql`DELETE FROM ledger_allocation_rules WHERE name LIKE '[점검]%'`);

        await tx.execute(sql`UPDATE vouchers SET reversed_by_id = NULL, reversal_of_id = NULL WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher'
          AND entity_id IN (SELECT id::text FROM vouchers WHERE fiscal_year IN ${years})`);
        await tx.execute(sql`DELETE FROM vouchers WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'approval'
          AND entity_id IN (SELECT id::text FROM approval_requests WHERE fiscal_year IN ${years})`);
        await tx.execute(sql`DELETE FROM approval_request_steps WHERE request_id IN
          (SELECT id FROM approval_requests WHERE fiscal_year IN ${years})`);
        await tx.execute(sql`DELETE FROM approval_requests WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`DELETE FROM expenses WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`DELETE FROM other_revenues WHERE fiscal_year IN ${years}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'fiscal_year' AND entity_id IN ('2099', '2100')`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'settlement' AND entity_id IN ('2099', '2100')`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher' AND reason = 'E2E 시험'`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'ledger_sync'`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher'
          AND entity_id NOT IN (SELECT id::text FROM vouchers)`);
        await tx.execute(sql`DELETE FROM ledger_fiscal_years WHERE year IN ${years}`);

        await tx.execute(sql.raw(`ALTER TABLE vouchers ENABLE TRIGGER ledger_voucher_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE voucher_lines ENABLE TRIGGER ledger_line_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE ledger_history ENABLE TRIGGER ledger_history_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE budget_ledger ENABLE TRIGGER budget_ledger_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE approval_purge_log ENABLE TRIGGER approval_purge_log_guard_trg`));
        return { vouchers, requests };
      });
      return new Response(jsonKST({ ok: true, mode: "cleanup", deletedVouchers: result.vouchers, deletedRequests: result.requests }, null, 2),
        { headers: JSON_HEADER });
    }

    step = "run";
    const result = await db.transaction(async (tx) => {
      for (const statement of STRUCTURE) await tx.execute(sql.raw(statement));

      /* 시험 예산안 삭제. 전표·거래처의 줄 연결을 먼저 끊는다 */
      const plans = rowsOf(await tx.execute(sql`
        SELECT id FROM budget_plans WHERE fiscal_year = ${TEST_PLAN.year} AND total_planned = ${TEST_PLAN.total}`));
      for (const p of plans) {
        const id = Number(p.id);
        await tx.execute(sql`UPDATE vouchers SET budget_line_id = NULL
          WHERE budget_line_id IN (SELECT id FROM budget_lines WHERE plan_id = ${id})`);
        await tx.execute(sql`UPDATE counterparties SET default_budget_line_id = NULL
          WHERE default_budget_line_id IN (SELECT id FROM budget_lines WHERE plan_id = ${id})`);
        await tx.execute(sql`DELETE FROM budget_plans WHERE id = ${id}`);
      }

      /* 이미 승인됐고 아직 지급 전인 결재는 예약 내역이 원장에 없으므로 시작 행을 남긴다 */
      const open = rowsOf(await tx.execute(sql`
        SELECT id, fiscal_year, budget_account_id, resolution_no, amount FROM approval_requests
         WHERE status = 'approved' AND payment_status = 'unpaid'`));
      for (const r of open) {
        await tx.execute(sql`
          INSERT INTO budget_ledger
            (fiscal_year, budget_account_id, document_id, document_no, txn_type, amount, idempotency_key, note, actor_name)
          VALUES (${Number(r.fiscal_year)}, ${r.budget_account_id}, ${Number(r.id)}, ${r.resolution_no}, 'reserve',
                  ${Number(r.amount)}, ${`reserve:approval:${r.id}`}, '원장 도입 시 이관', '시스템')
          ON CONFLICT (idempotency_key) DO NOTHING`);
      }
      /* 기존 지출 결재는 문서로 그대로 보인다. 번호와 상신 시각, 담당자를 채운다 */
      await tx.execute(sql`
        UPDATE approval_requests SET submitted_at = created_at WHERE submitted_at IS NULL AND status <> 'draft'`);
      const undated = rowsOf(await tx.execute(sql`
        SELECT id, fiscal_year FROM approval_requests WHERE doc_no IS NULL AND status <> 'draft' ORDER BY id`));
      for (const r of undated) {
        const year = Number(r.fiscal_year);
        const seq = rowsOf(await tx.execute(sql`
          INSERT INTO approval_doc_sequences (doc_type, year, last_no) VALUES ('expense', ${year}, 1)
          ON CONFLICT (doc_type, year) DO UPDATE SET last_no = approval_doc_sequences.last_no + 1
          RETURNING last_no`))[0];
        await tx.execute(sql`
          UPDATE approval_requests SET doc_no = ${`지출-${year}-${String(seq.last_no).padStart(4, "0")}`} WHERE id = ${Number(r.id)}`);
      }
      await tx.execute(sql`
        UPDATE approval_request_steps SET assignee_id = decided_by, assignee_name = decided_by_name
         WHERE assignee_id IS NULL AND decided_by IS NOT NULL`);
      return { deletedTestPlans: plans.length, openReservations: open.length, numberedDocs: undated.length };
    });

    return new Response(jsonKST({ ok: true, mode: "run", ...result }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "장부 결산 마이그레이션 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, null, 2), { status: 500, headers: JSON_HEADER });
  }
}
