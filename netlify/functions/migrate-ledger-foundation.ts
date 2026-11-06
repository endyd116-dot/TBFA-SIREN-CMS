/**
 * GET /api/migrate-ledger-foundation            — 진단 (인증 불필요·읽기 전용)
 * GET /api/migrate-ledger-foundation?run=1      — 실행 (어드민 인증)
 * GET /api/migrate-ledger-foundation?cleanup=1  — 시험 연도(2099) 정리 (어드민 인증)
 *
 * 1단계 장부 뼈대(2026-11-06). 설계: docs/active/2026-11-06-ledger-foundation-design.md
 *   계정과목 확장·초기값, 사업·재원, 회계연도, 전표 머리표 확장, 분개 줄, 변경 이력, DB 안전장치.
 * 멱등: 다시 실행해도 안전. 호출 성공 후 파일 삭제 + commit (CLAUDE.md §6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-ledger-foundation" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

const STRUCTURE: string[] = [
  /* 1. 계정과목 확장 */
  `ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS kind VARCHAR(20)`,
  `ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS normal_side VARCHAR(6)`,
  `ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS statement_line VARCHAR(40)`,
  `ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS nature VARCHAR(20)`,
  `ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS default_function VARCHAR(20)`,
  `ALTER TABLE account_codes ADD COLUMN IF NOT EXISTS system_role VARCHAR(40)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_codes_system_role_uq
     ON account_codes (system_role) WHERE system_role IS NOT NULL`,

  /* 2. 사업·재원 */
  `CREATE TABLE IF NOT EXISTS ledger_programs (
     id SERIAL PRIMARY KEY,
     code VARCHAR(20) NOT NULL UNIQUE,
     name VARCHAR(120) NOT NULL,
     segment VARCHAR(10) NOT NULL DEFAULT 'public',
     charter_ref VARCHAR(30),
     disclosure_code VARCHAR(10),
     description TEXT,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ledger_programs_segment_ck CHECK (segment IN ('public','other'))
   )`,
  `CREATE TABLE IF NOT EXISTS ledger_funds (
     id SERIAL PRIMARY KEY,
     code VARCHAR(20) NOT NULL UNIQUE,
     name VARCHAR(120) NOT NULL,
     restricted BOOLEAN NOT NULL DEFAULT FALSE,
     is_system BOOLEAN NOT NULL DEFAULT FALSE,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  /* 3. 회계연도·마감 기준일 */
  `CREATE TABLE IF NOT EXISTS ledger_fiscal_years (
     year INTEGER PRIMARY KEY,
     start_date DATE NOT NULL,
     end_date DATE NOT NULL,
     closed_through DATE,
     status VARCHAR(10) NOT NULL DEFAULT 'open',
     closed_by INTEGER,
     closed_at TIMESTAMPTZ,
     note TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ledger_fiscal_years_status_ck CHECK (status IN ('open','closed')),
     CONSTRAINT ledger_fiscal_years_range_ck CHECK (start_date <= end_date)
   )`,

  /* 4. 전표 머리표 확장 */
  `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS voucher_type VARCHAR(20) NOT NULL DEFAULT 'expense'`,
  `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS source_type VARCHAR(30)`,
  `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS source_id VARCHAR(60)`,
  `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversal_of_id INTEGER REFERENCES vouchers(id)`,
  `ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS reversed_by_id INTEGER REFERENCES vouchers(id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vouchers_source_uq
     ON vouchers (source_type, source_id)
     WHERE source_type IS NOT NULL AND reversed_by_id IS NULL`,

  /* 5. 분개 줄 */
  `CREATE TABLE IF NOT EXISTS voucher_lines (
     id SERIAL PRIMARY KEY,
     voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
     line_no INTEGER NOT NULL,
     account_code VARCHAR(20) NOT NULL REFERENCES account_codes(code),
     debit BIGINT NOT NULL DEFAULT 0,
     credit BIGINT NOT NULL DEFAULT 0,
     function_code VARCHAR(20),
     program_id INTEGER REFERENCES ledger_programs(id),
     fund_id INTEGER REFERENCES ledger_funds(id),
     segment VARCHAR(10) NOT NULL DEFAULT 'public',
     memo VARCHAR(200),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT voucher_lines_amount_ck CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)),
     CONSTRAINT voucher_lines_function_ck CHECK (function_code IS NULL OR function_code IN ('service','admin','fundraising')),
     CONSTRAINT voucher_lines_segment_ck CHECK (segment IN ('public','other')),
     CONSTRAINT voucher_lines_no_uq UNIQUE (voucher_id, line_no)
   )`,
  `CREATE INDEX IF NOT EXISTS voucher_lines_voucher_idx ON voucher_lines (voucher_id)`,
  `CREATE INDEX IF NOT EXISTS voucher_lines_account_idx ON voucher_lines (account_code)`,
  `CREATE INDEX IF NOT EXISTS voucher_lines_program_idx ON voucher_lines (program_id)`,
  `CREATE INDEX IF NOT EXISTS voucher_lines_fund_idx ON voucher_lines (fund_id)`,

  /* 6. 변경 이력 — 지우지 않는다 */
  `CREATE TABLE IF NOT EXISTS ledger_history (
     id BIGSERIAL PRIMARY KEY,
     entity VARCHAR(30) NOT NULL,
     entity_id VARCHAR(40) NOT NULL,
     action VARCHAR(30) NOT NULL,
     actor_id INTEGER,
     actor_name VARCHAR(100),
     reason TEXT,
     before_data JSONB,
     after_data JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS ledger_history_entity_idx ON ledger_history (entity, entity_id, created_at)`,
];

const GUARDS: string[] = [
  `CREATE OR REPLACE FUNCTION ledger_voucher_guard() RETURNS trigger AS $$
   DECLARE
     dr BIGINT; cr BIGINT; cnt INTEGER; fy RECORD;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD.status = 'approved' THEN
         RAISE EXCEPTION '승인된 전표는 삭제할 수 없습니다. 반대 전표로 취소하세요.';
       END IF;
       RETURN OLD;
     END IF;

     IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
       IF NEW.status IS DISTINCT FROM OLD.status
          OR NEW.voucher_date IS DISTINCT FROM OLD.voucher_date
          OR NEW.fiscal_year IS DISTINCT FROM OLD.fiscal_year
          OR NEW.account_code IS DISTINCT FROM OLD.account_code
          OR NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.description IS DISTINCT FROM OLD.description
          OR NEW.voucher_type IS DISTINCT FROM OLD.voucher_type
          OR NEW.is_template IS DISTINCT FROM OLD.is_template THEN
         RAISE EXCEPTION '승인된 전표의 내용은 바꿀 수 없습니다. 반대 전표로 취소하세요.';
       END IF;
       RETURN NEW;
     END IF;

     IF NEW.status = 'approved' THEN
       IF NEW.is_template THEN
         RAISE EXCEPTION '반복 전표 틀은 승인할 수 없습니다.';
       END IF;
       SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
         INTO dr, cr, cnt FROM voucher_lines WHERE voucher_id = NEW.id;
       IF cnt < 2 OR dr = 0 OR dr <> cr THEN
         RAISE EXCEPTION '차변과 대변 합계가 맞지 않아 승인할 수 없습니다. (차변 %, 대변 %, 줄 %)', dr, cr, cnt;
       END IF;
       IF NEW.amount <> dr THEN
         RAISE EXCEPTION '전표 금액과 분개 합계가 다릅니다. (금액 %, 합계 %)', NEW.amount, dr;
       END IF;
       SELECT * INTO fy FROM ledger_fiscal_years WHERE NEW.voucher_date BETWEEN start_date AND end_date;
       IF NOT FOUND THEN
         RAISE EXCEPTION '장부 기간 밖의 날짜입니다: %', NEW.voucher_date;
       END IF;
       IF fy.status <> 'open' THEN
         RAISE EXCEPTION '결산이 끝난 회계연도입니다: %', fy.year;
       END IF;
       IF fy.closed_through IS NOT NULL AND NEW.voucher_date <= fy.closed_through THEN
         RAISE EXCEPTION '마감된 기간입니다: %까지 마감', fy.closed_through;
       END IF;
     END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS ledger_voucher_guard_trg ON vouchers`,
  `CREATE TRIGGER ledger_voucher_guard_trg
     BEFORE INSERT OR UPDATE OR DELETE ON vouchers
     FOR EACH ROW EXECUTE FUNCTION ledger_voucher_guard()`,

  `CREATE OR REPLACE FUNCTION ledger_line_guard() RETURNS trigger AS $$
   DECLARE st TEXT;
   BEGIN
     SELECT status INTO st FROM vouchers
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;
     IF st = 'approved' THEN
       RAISE EXCEPTION '승인된 전표의 분개는 바꿀 수 없습니다.';
     END IF;
     IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
     RETURN NEW;
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS ledger_line_guard_trg ON voucher_lines`,
  `CREATE TRIGGER ledger_line_guard_trg
     BEFORE INSERT OR UPDATE OR DELETE ON voucher_lines
     FOR EACH ROW EXECUTE FUNCTION ledger_line_guard()`,

  `CREATE OR REPLACE FUNCTION ledger_history_guard() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION '장부 변경 이력은 고치거나 지울 수 없습니다.';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS ledger_history_guard_trg ON ledger_history`,
  `CREATE TRIGGER ledger_history_guard_trg
     BEFORE UPDATE OR DELETE ON ledger_history
     FOR EACH ROW EXECUTE FUNCTION ledger_history_guard()`,
];

type Row = (string | null)[];

/* 기존 37개 — 코드, kind, normal_side, statement_line, nature, default_function */
const OLD_ACCOUNTS: Row[] = [
  ["401", "revenue", "credit", "business_revenue", null, null],
  ["4011", "revenue", "credit", "donation_individual", null, null],
  ["4012", "revenue", "credit", "grant", null, null],
  ["4013", "revenue", "credit", "membership_fee", null, null],
  ["4014", "revenue", "credit", "other_public_revenue", null, null],
  ["402", "revenue", "credit", "non_operating_revenue", null, null],
  ["4021", "revenue", "credit", "non_operating_revenue", null, null],
  ["4022", "revenue", "credit", "non_operating_revenue", null, null],
  ["4023", "revenue", "credit", "non_operating_revenue", null, null],
  ["501", "expense", "debit", "business_expense", null, null],
  ["5011", "expense", "debit", "business_expense", "personnel", null],
  ["5012", "expense", "debit", "business_expense", "personnel", null],
  ["5013", "expense", "debit", "business_expense", "personnel", null],
  ["5014", "expense", "debit", "business_expense", "personnel", null],
  ["502", "expense", "debit", "business_expense", null, null],
  ["5021", "expense", "debit", "business_expense", "other", "service"],
  ["5022", "expense", "debit", "business_expense", "other", "service"],
  ["5023", "expense", "debit", "business_expense", "distribution", "service"],
  ["5024", "expense", "debit", "business_expense", "distribution", "service"],
  ["5025", "expense", "debit", "business_expense", "other", "service"],
  ["503", "expense", "debit", "business_expense", null, null],
  ["5031", "expense", "debit", "business_expense", "facility", "admin"],
  ["5032", "expense", "debit", "business_expense", "other", "admin"],
  ["5033", "expense", "debit", "business_expense", "other", "admin"],
  ["5034", "expense", "debit", "business_expense", "facility", "admin"],
  ["5035", "expense", "debit", "business_expense", "facility", "admin"],
  ["5036", "expense", "debit", "business_expense", "other", "admin"],
  ["5037", "expense", "debit", "business_expense", "other", "admin"],
  ["5038", "expense", "debit", "business_expense", "other", "admin"],
  ["5039", "expense", "debit", "business_expense", "other", "admin"],
  ["5040", "expense", "debit", "business_expense", "other", "admin"],
  ["5043", "expense", "debit", "business_expense", "facility", "admin"],
  ["5044", "expense", "debit", "business_expense", "facility", "admin"],
  ["5045", "expense", "debit", "business_expense", "other", "admin"],
  ["504", "expense", "debit", "business_expense", null, null],
  ["5041", "expense", "debit", "business_expense", "other", "fundraising"],
  ["5042", "expense", "debit", "business_expense", "other", "fundraising"],
];

/* 신규 56개 — 코드, 이름, 상위, category, kind, normal_side, statement_line, nature, default_function, system_role */
const NEW_ACCOUNTS: Row[] = [
  ["101", "현금및현금성자산", null, "asset", "asset", "debit", "current_asset", null, null, null],
  ["1011", "현금", "101", "asset", "asset", "debit", "current_asset", null, null, null],
  ["1012", "보통예금(전용계좌)", "101", "asset", "asset", "debit", "current_asset", null, null, "cash_default"],
  ["1013", "보통예금(기타 계좌)", "101", "asset", "asset", "debit", "current_asset", null, null, null],
  ["102", "기타유동자산", null, "asset", "asset", "debit", "current_asset", null, null, null],
  ["1021", "단기금융상품", "102", "asset", "asset", "debit", "current_asset", null, null, null],
  ["1022", "미수금", "102", "asset", "asset", "debit", "current_asset", null, null, "receivable_default"],
  ["1023", "결제 정산 미수금", "102", "asset", "asset", "debit", "current_asset", null, null, "settlement_receivable"],
  ["1024", "미수수익", "102", "asset", "asset", "debit", "current_asset", null, null, null],
  ["1025", "선급금", "102", "asset", "asset", "debit", "current_asset", null, null, null],
  ["1026", "선급비용", "102", "asset", "asset", "debit", "current_asset", null, null, null],
  ["1027", "가지급금", "102", "asset", "asset", "debit", "suspense", null, null, null],
  ["103", "투자자산", null, "asset", "asset", "debit", "investment_asset", null, null, null],
  ["1031", "장기성예적금", "103", "asset", "asset", "debit", "investment_asset", null, null, null],
  ["104", "유형자산", null, "asset", "asset", "debit", "tangible_asset", null, null, null],
  ["1041", "차량운반구", "104", "asset", "asset", "debit", "tangible_asset", null, null, null],
  ["1042", "차량운반구 감가상각누계액", "104", "asset", "asset", "credit", "tangible_asset", null, null, null],
  ["1043", "비품", "104", "asset", "asset", "debit", "tangible_asset", null, null, null],
  ["1044", "비품 감가상각누계액", "104", "asset", "asset", "credit", "tangible_asset", null, null, null],
  ["105", "무형자산", null, "asset", "asset", "debit", "intangible_asset", null, null, null],
  ["1051", "컴퓨터소프트웨어", "105", "asset", "asset", "debit", "intangible_asset", null, null, null],
  ["106", "기타비유동자산", null, "asset", "asset", "debit", "other_noncurrent_asset", null, null, null],
  ["1061", "임차보증금", "106", "asset", "asset", "debit", "other_noncurrent_asset", null, null, null],
  ["201", "유동부채", null, "liability", "liability", "credit", "current_liability", null, null, null],
  ["2011", "미지급금", "201", "liability", "liability", "credit", "current_liability", null, null, "payable_default"],
  ["2012", "미지급비용", "201", "liability", "liability", "credit", "current_liability", null, null, null],
  ["2013", "예수금", "201", "liability", "liability", "credit", "current_liability", null, null, "withholding"],
  ["2014", "선수금", "201", "liability", "liability", "credit", "current_liability", null, null, null],
  ["2015", "가수금", "201", "liability", "liability", "credit", "suspense", null, null, null],
  ["2016", "단기차입금", "201", "liability", "liability", "credit", "current_liability", null, null, null],
  ["202", "비유동부채", null, "liability", "liability", "credit", "noncurrent_liability", null, null, null],
  ["2021", "장기차입금", "202", "liability", "liability", "credit", "noncurrent_liability", null, null, null],
  ["2022", "퇴직급여충당부채", "202", "liability", "liability", "credit", "noncurrent_liability", null, null, null],
  ["301", "기본순자산", null, "net_asset", "net_asset", "credit", "basic_net_asset", null, null, null],
  ["3011", "기본재산", "301", "net_asset", "net_asset", "credit", "basic_net_asset", null, null, null],
  ["302", "보통순자산", null, "net_asset", "net_asset", "credit", "ordinary_net_asset", null, null, null],
  ["3021", "잉여금", "302", "net_asset", "net_asset", "credit", "ordinary_net_asset", null, null, "opening_net_asset"],
  ["303", "순자산조정", null, "net_asset", "net_asset", "credit", "net_asset_adjustment", null, null, null],
  ["3031", "순자산조정", "303", "net_asset", "net_asset", "credit", "net_asset_adjustment", null, null, null],
  ["4015", "기부금수익(영리법인)", "401", "income", "revenue", "credit", "donation_corporate", null, null, null],
  ["4016", "기부금수익(모금단체·재단)", "401", "income", "revenue", "credit", "donation_org", null, null, null],
  ["4017", "기부금수익(기타)", "401", "income", "revenue", "credit", "donation_other", null, null, null],
  ["4024", "전기오류수정이익", "402", "income", "revenue", "credit", "non_operating_revenue", null, null, null],
  ["5015", "상여금", "501", "personnel", "expense", "debit", "business_expense", "personnel", null, null],
  ["5016", "교육훈련비", "501", "personnel", "expense", "debit", "business_expense", "personnel", null, null],
  ["5026", "법률자문비", "502", "program", "expense", "debit", "business_expense", "other", "service", null],
  ["5046", "용역비", "503", "admin_ops", "expense", "debit", "business_expense", "other", "admin", null],
  ["5047", "대손상각비", "503", "admin_ops", "expense", "debit", "business_expense", "other", "admin", null],
  ["505", "사업외비용", null, "non_operating", "expense", "debit", "non_operating_expense", null, null, null],
  ["5051", "이자비용", "505", "non_operating", "expense", "debit", "non_operating_expense", null, null, null],
  ["5052", "자산처분손실", "505", "non_operating", "expense", "debit", "non_operating_expense", null, null, null],
  ["5053", "기타의 대손상각비", "505", "non_operating", "expense", "debit", "non_operating_expense", null, null, null],
  ["5054", "전기오류수정손실", "505", "non_operating", "expense", "debit", "non_operating_expense", null, null, null],
  ["5055", "잡손실", "505", "non_operating", "expense", "debit", "non_operating_expense", null, null, null],
  ["506", "법인세비용", null, "non_operating", "expense", "debit", "income_tax", null, null, null],
  ["5061", "법인세비용", "506", "non_operating", "expense", "debit", "income_tax", null, null, null],
];

const RENAMES: [string, string, string][] = [
  ["4011", "후원금·기부금수익", "기부금수익(개인)"],
  ["5014", "일용·외주인건비", "일용인건비"],
];

/* 코드, 이름, 정관 근거, 공시 코드(초안), 설명 */
const PROGRAMS: Row[] = [
  ["P01", "교원 연수·세미나", "제4조 1호", "2300", "교원의 전문성 향상을 위한 연수와 세미나"],
  ["P02", "토크 콘서트·학술연구", "제4조 2호", "2400", "상호 존중의 학교 문화와 교육공동체 치유를 위한 토크 콘서트, 학술연구"],
  ["P03", "인식 개선 캠페인·소식지", "제4조 3호", "7100", "교육 인식 개선 캠페인, 회원 소통 간행물"],
  ["P04", "학교 안전사고 콘텐츠 연구", "제4조 4호", "2400", "학교 안전사고 대처 콘텐츠 연구"],
  ["P05", "유가족 지원", null, "4100", "유가족 심리상담, 법률, 생활 지원. 정관 제4조에 근거 없음"],
  ["P06", "순직 인정 지원", null, "7200", "순직 인정 신청 자료, 분석, 서면 지원. 정관 제4조에 근거 없음"],
  ["P07", "추모·장학", null, "2500", "추모 사업과 장학. 정관 제4조에 근거 없음"],
  ["P08", "교권 보호·제도 개선", null, "7100", "SIREN 신고, 교권 보호, 제도 개선. 정관 제4조에 근거 없음"],
];

const FUNDS: [string, string, boolean][] = [
  ["F01", "회비", false],
  ["F02", "기부금", false],
  ["F03", "지정 기부금", true],
  ["F04", "보조금", true],
  ["F05", "기타 수입", false],
];

const CLEANUP_YEAR = 2099;

async function scalar(q: any): Promise<number> {
  return Number(rowsOf(await db.execute(q))[0]?.n ?? 0);
}
async function tableExists(name: string): Promise<boolean> {
  return rowsOf(await db.execute(sql`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${name}
  `)).length > 0;
}
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
    const applied = await tableExists("voucher_lines");
    const kindColumn = await columnExists("account_codes", "kind");
    const diag: Record<string, unknown> = {
      voucher_lines: applied,
      account_codes_kind: kindColumn,
      account_codes: await scalar(sql`SELECT COUNT(*)::int AS n FROM account_codes`),
      vouchers_total: await scalar(sql`SELECT COUNT(*)::int AS n FROM vouchers`),
      vouchers_approved: await scalar(sql`SELECT COUNT(*)::int AS n FROM vouchers WHERE status = 'approved'`),
    };
    if (applied) {
      diag.voucher_lines_rows = await scalar(sql`SELECT COUNT(*)::int AS n FROM voucher_lines`);
      diag.fiscal_years = rowsOf(await db.execute(sql`SELECT year, start_date, end_date FROM ledger_fiscal_years ORDER BY year`));
      diag.programs = await scalar(sql`SELECT COUNT(*)::int AS n FROM ledger_programs`);
      diag.funds = await scalar(sql`SELECT COUNT(*)::int AS n FROM ledger_funds`);
      diag.cleanup_vouchers = await scalar(sql`SELECT COUNT(*)::int AS n FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR}`);
    }

    if (!run && !cleanup) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose", ...diag,
        hint: applied ? "이미 적용됨. 재실행해도 안전." : "?run=1 로 실행하세요.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as { ok: false; res: Response }).res;

    if (cleanup) {
      if (!applied) throw new Error("장부 표가 아직 없습니다");
      step = "cleanup";
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`ALTER TABLE vouchers DISABLE TRIGGER ledger_voucher_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE voucher_lines DISABLE TRIGGER ledger_line_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE ledger_history DISABLE TRIGGER ledger_history_guard_trg`));
        const before = Number(rowsOf(await tx.execute(sql`
          SELECT COUNT(*)::int AS n FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR}`))[0]?.n ?? 0);
        await tx.execute(sql`UPDATE vouchers SET reversed_by_id = NULL, reversal_of_id = NULL WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM bank_transactions WHERE txn_date >= ${`${CLEANUP_YEAR}-01-01`}`);
        await tx.execute(sql`DELETE FROM bank_imports WHERE period_from >= ${`${CLEANUP_YEAR}-01-01`}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'voucher'
          AND entity_id IN (SELECT id::text FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR})`);
        await tx.execute(sql`DELETE FROM vouchers WHERE fiscal_year = ${CLEANUP_YEAR}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity = 'fiscal_year' AND entity_id = ${String(CLEANUP_YEAR)}`);
        await tx.execute(sql`DELETE FROM ledger_history WHERE entity IN ('program','fund') AND reason = 'E2E 시험'`);
        await tx.execute(sql`DELETE FROM ledger_programs WHERE code LIKE 'T99%'`);
        await tx.execute(sql`DELETE FROM ledger_funds WHERE code LIKE 'T99%'`);
        await tx.execute(sql`DELETE FROM ledger_fiscal_years WHERE year = ${CLEANUP_YEAR}`);
        await tx.execute(sql.raw(`ALTER TABLE vouchers ENABLE TRIGGER ledger_voucher_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE voucher_lines ENABLE TRIGGER ledger_line_guard_trg`));
        await tx.execute(sql.raw(`ALTER TABLE ledger_history ENABLE TRIGGER ledger_history_guard_trg`));
        return { deletedVouchers: before };
      });
      return new Response(jsonKST({ ok: true, mode: "cleanup", ...result }, null, 2), { headers: JSON_HEADER });
    }

    step = "run";
    const summary = await db.transaction(async (tx) => {
      step = "structure";
      for (const q of STRUCTURE) await tx.execute(sql.raw(q));

      step = "seed_old_accounts";
      for (const [code, kind, normal, line, nature, fn] of OLD_ACCOUNTS) {
        await tx.execute(sql`
          UPDATE account_codes
             SET kind = ${kind}, normal_side = ${normal}, statement_line = ${line},
                 nature = ${nature}, default_function = ${fn}
           WHERE code = ${code}`);
      }
      for (const [code, from, to] of RENAMES) {
        await tx.execute(sql`UPDATE account_codes SET name = ${to} WHERE code = ${code} AND name = ${from}`);
      }

      step = "seed_new_accounts";
      for (const a of NEW_ACCOUNTS) {
        const [code, name, parent, category, kind, normal, line, nature, fn, role] = a;
        await tx.execute(sql`
          INSERT INTO account_codes
            (code, name, parent_code, category, kind, normal_side, statement_line, nature,
             default_function, system_role, is_active, sort_order)
          VALUES (${code}, ${name}, ${parent}, ${category}, ${kind}, ${normal}, ${line}, ${nature},
                  ${fn}, ${role}, TRUE, ${Number(String(code).padEnd(4, "0"))})
          ON CONFLICT (code) DO UPDATE SET
            kind = EXCLUDED.kind, normal_side = EXCLUDED.normal_side,
            statement_line = EXCLUDED.statement_line, nature = EXCLUDED.nature,
            default_function = EXCLUDED.default_function, system_role = EXCLUDED.system_role`);
      }

      step = "backfill_unknown_accounts";
      await tx.execute(sql`
        UPDATE account_codes SET
          kind = CASE WHEN category = 'income' THEN 'revenue' ELSE 'expense' END,
          normal_side = CASE WHEN category = 'income' THEN 'credit' ELSE 'debit' END,
          statement_line = CASE WHEN category = 'income' THEN 'business_revenue' ELSE 'business_expense' END,
          nature = CASE WHEN category = 'income' THEN NULL WHEN category = 'personnel' THEN 'personnel' ELSE 'other' END
        WHERE kind IS NULL`);
      await tx.execute(sql.raw(`ALTER TABLE account_codes ALTER COLUMN kind SET NOT NULL`));
      await tx.execute(sql.raw(`ALTER TABLE account_codes ALTER COLUMN normal_side SET NOT NULL`));
      await tx.execute(sql.raw(`ALTER TABLE account_codes ALTER COLUMN statement_line SET NOT NULL`));

      step = "seed_masters";
      let sort = 0;
      for (const [code, name, charter, disclosure, description] of PROGRAMS) {
        sort += 1;
        await tx.execute(sql`
          INSERT INTO ledger_programs (code, name, charter_ref, disclosure_code, description, sort_order)
          VALUES (${code}, ${name}, ${charter}, ${disclosure}, ${description}, ${sort})
          ON CONFLICT (code) DO NOTHING`);
      }
      sort = 0;
      for (const [code, name, restricted] of FUNDS) {
        sort += 1;
        await tx.execute(sql`
          INSERT INTO ledger_funds (code, name, restricted, is_system, sort_order)
          VALUES (${code}, ${name}, ${restricted}, TRUE, ${sort})
          ON CONFLICT (code) DO NOTHING`);
      }
      await tx.execute(sql`
        INSERT INTO ledger_fiscal_years (year, start_date, end_date, note) VALUES
          (2026, '2026-11-25', '2026-12-31', '숭고한 등불 시작일부터. 그 전 잔액은 개시 전표로 입력'),
          (2027, '2027-01-01', '2027-12-31', NULL)
        ON CONFLICT (year) DO NOTHING`);

      step = "guards";
      for (const q of GUARDS) await tx.execute(sql.raw(q));

      step = "summary";
      const count = async (q: any) => Number(rowsOf(await tx.execute(q))[0]?.n ?? 0);
      return {
        accounts: await count(sql`SELECT COUNT(*)::int AS n FROM account_codes`),
        leafAccounts: await count(sql`SELECT COUNT(*)::int AS n FROM account_codes a
          WHERE NOT EXISTS (SELECT 1 FROM account_codes c WHERE c.parent_code = a.code)`),
        programs: await count(sql`SELECT COUNT(*)::int AS n FROM ledger_programs`),
        funds: await count(sql`SELECT COUNT(*)::int AS n FROM ledger_funds`),
        fiscalYears: await count(sql`SELECT COUNT(*)::int AS n FROM ledger_fiscal_years`),
        guards: await count(sql`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'ledger_%' AND NOT tgisinternal`),
      };
    });

    return new Response(jsonKST({ ok: true, mode: "run", ...summary }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "장부 마이그레이션 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, null, 2), { status: 500, headers: JSON_HEADER });
  }
}
