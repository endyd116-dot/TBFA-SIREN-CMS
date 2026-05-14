/**
 * Phase 22-D-R1 마이그레이션 — 전표 시스템 테이블 생성
 * GET /api/migrate-phase22d-voucher-schema          → 진단 (인증 불필요)
 * GET /api/migrate-phase22d-voucher-schema?run=1    → 어드민 인증 후 실행
 *
 * 생성:
 *  - account_codes     (계정과목 마스터, NPO 표준 18개 시드 포함)
 *  - vouchers          (전표 — draft→submitted→approved/rejected)
 *  - bank_imports      (통장 업로드 기록 — R2에서 기능 활성화)
 *  - bank_transactions (통장 거래 내역 — R2에서 기능 활성화)
 *  - ai_tool_permissions: account_codes_list / voucher_list / voucher_create / voucher_approve (4개 시드)
 *
 * 멱등성: IF NOT EXISTS + ON CONFLICT DO NOTHING
 * 호출 성공 후 즉시 파일 삭제할 것 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase22d-voucher-schema" };

export default async function handler(req: Request, _ctx: Context) {
  const url   = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";
  const sql   = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────────
  if (!doRun) {
    const checks: Record<string, any> = {};
    const tables = ["account_codes", "vouchers", "bank_imports", "bank_transactions"];
    for (const t of tables) {
      try {
        const [r] = await sql`
          SELECT COUNT(*) AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${t}`;
        checks[`${t}_exists`] = Number(r.n) > 0;
      } catch { checks[`${t}_exists`] = false; }
    }
    try {
      const [tp] = await sql`
        SELECT COUNT(*) AS n FROM ai_tool_permissions
        WHERE tool_name IN ('account_codes_list','voucher_list','voucher_create','voucher_approve')`;
      checks.ai_tool_permissions_voucher_count = Number(tp.n);
    } catch { checks.ai_tool_permissions_voucher_count = "ai_tool_permissions 테이블 없음"; }
    try {
      const [m] = await sql`SELECT COUNT(*) AS n FROM members WHERE type = 'admin' LIMIT 1`;
      checks.admin_members_exist = Number(m.n) > 0;
    } catch { checks.admin_members_exist = false; }

    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic", checks,
      hint: "?run=1 로 실행 (어드민 로그인 필요)",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 인증 ──────────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const results: string[] = [];

  try {
    // 1. account_codes 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS account_codes (
        id          SERIAL PRIMARY KEY,
        code        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        parent_code TEXT,
        category    TEXT NOT NULL,
        is_active   BOOLEAN DEFAULT TRUE,
        sort_order  INTEGER DEFAULT 0
      )
    `;
    results.push("account_codes 테이블 생성 완료");

    // 2. NPO 표준 18개 계정과목 시드
    const seeds = [
      { code: "501",  name: "인건비",          parent: null,  cat: "personnel",  ord: 10 },
      { code: "5011", name: "급여",             parent: "501", cat: "personnel",  ord: 11 },
      { code: "5012", name: "퇴직급여",         parent: "501", cat: "personnel",  ord: 12 },
      { code: "5013", name: "복리후생비",        parent: "501", cat: "personnel",  ord: 13 },
      { code: "502",  name: "사업비",            parent: null,  cat: "program",    ord: 20 },
      { code: "5021", name: "교육·상담비",       parent: "502", cat: "program",    ord: 21 },
      { code: "5022", name: "캠페인·행사비",     parent: "502", cat: "program",    ord: 22 },
      { code: "5023", name: "장학금",            parent: "502", cat: "program",    ord: 23 },
      { code: "503",  name: "관리운영비",        parent: null,  cat: "admin_ops",  ord: 30 },
      { code: "5031", name: "임차료",            parent: "503", cat: "admin_ops",  ord: 31 },
      { code: "5032", name: "통신비",            parent: "503", cat: "admin_ops",  ord: 32 },
      { code: "5033", name: "사무용품비",        parent: "503", cat: "admin_ops",  ord: 33 },
      { code: "5034", name: "공과금(광열수도)", parent: "503", cat: "admin_ops",  ord: 34 },
      { code: "5035", name: "차량유지비",        parent: "503", cat: "admin_ops",  ord: 35 },
      { code: "5036", name: "업무추진비",        parent: "503", cat: "admin_ops",  ord: 36 },
      { code: "504",  name: "모금비",            parent: null,  cat: "fundraising", ord: 40 },
      { code: "5041", name: "홍보비",            parent: "504", cat: "fundraising", ord: 41 },
      { code: "5042", name: "모금행사비",        parent: "504", cat: "fundraising", ord: 42 },
    ];
    for (const s of seeds) {
      await sql`
        INSERT INTO account_codes (code, name, parent_code, category, is_active, sort_order)
        VALUES (${s.code}, ${s.name}, ${s.parent}, ${s.cat}, TRUE, ${s.ord})
        ON CONFLICT (code) DO NOTHING
      `;
    }
    results.push(`account_codes NPO 표준 ${seeds.length}개 시드 완료`);

    // 3. vouchers 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS vouchers (
        id               SERIAL PRIMARY KEY,
        voucher_number   TEXT NOT NULL UNIQUE,
        voucher_date     DATE NOT NULL,
        fiscal_year      INTEGER NOT NULL,
        account_code     TEXT NOT NULL,
        account_name     TEXT NOT NULL,
        sub_account      TEXT,
        description      TEXT NOT NULL,
        payee_name       TEXT,
        amount           BIGINT NOT NULL,
        evidence_type    TEXT NOT NULL DEFAULT 'none',
        evidence_number  TEXT,
        evidence_url     TEXT,
        budget_line_id   INTEGER,
        expense_id       INTEGER REFERENCES expenses(id),
        bank_txn_id      INTEGER,
        is_template      BOOLEAN DEFAULT FALSE,
        template_name    TEXT,
        status           TEXT NOT NULL DEFAULT 'draft',
        rejection_reason TEXT,
        created_by       TEXT NOT NULL,
        submitted_at     TIMESTAMPTZ,
        approved_by      TEXT,
        approved_at      TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("vouchers 테이블 생성 완료");

    // 4. bank_imports 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS bank_imports (
        id             SERIAL PRIMARY KEY,
        filename       TEXT NOT NULL,
        bank_name      TEXT,
        period_from    DATE,
        period_to      DATE,
        total_rows     INTEGER DEFAULT 0,
        auto_matched   INTEGER DEFAULT 0,
        pending_review INTEGER DEFAULT 0,
        ignored_rows   INTEGER DEFAULT 0,
        imported_by    TEXT NOT NULL,
        imported_at    TIMESTAMPTZ DEFAULT NOW(),
        status         TEXT DEFAULT 'processing'
      )
    `;
    results.push("bank_imports 테이블 생성 완료");

    // 5. bank_transactions 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id                SERIAL PRIMARY KEY,
        import_id         INTEGER NOT NULL REFERENCES bank_imports(id),
        txn_date          DATE NOT NULL,
        amount            BIGINT NOT NULL,
        description       TEXT NOT NULL,
        counterpart       TEXT,
        balance_after     BIGINT,
        txn_type          TEXT NOT NULL,
        ai_account_code   TEXT,
        ai_budget_id      INTEGER,
        ai_confidence     NUMERIC(4,3),
        ai_reasoning      TEXT,
        status            TEXT DEFAULT 'pending',
        admin_account_code TEXT,
        admin_budget_id   INTEGER,
        voucher_id        INTEGER REFERENCES vouchers(id),
        confirmed_by      TEXT,
        confirmed_at      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("bank_transactions 테이블 생성 완료");

    // 6. ai_tool_permissions 시드 (4개)
    const toolSeeds = [
      { name: "account_codes_list", desc: "계정과목 목록 조회",             role: "admin",       cat: "finance" },
      { name: "voucher_list",       desc: "전표 목록 조회",                 role: "admin",       cat: "finance" },
      { name: "voucher_create",     desc: "전표 작성 (dry-run 우선)",       role: "admin",       cat: "finance" },
      { name: "voucher_approve",    desc: "전표 승인 또는 반려 (dry-run)",  role: "super_admin", cat: "finance" },
    ];
    for (const t of toolSeeds) {
      await sql`
        INSERT INTO ai_tool_permissions (tool_name, description, required_role, enabled, category)
        VALUES (${t.name}, ${t.desc}, ${t.role}, TRUE, ${t.cat})
        ON CONFLICT (tool_name) DO NOTHING
      `;
    }
    results.push("ai_tool_permissions voucher_* 4개 시드 완료");

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      results,
      message: "Phase 22-D-R1 전표 시스템 마이그레이션 완료. 파일을 즉시 삭제하세요.",
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패",
      completedSteps: results,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
