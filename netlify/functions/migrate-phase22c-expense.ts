/**
 * Phase 22-C 지출 관리 마이그레이션
 * GET /api/migrate-phase22c-expense       → 진단 (인증 불필요)
 * GET /api/migrate-phase22c-expense?run=1 → 어드민 인증 후 실행
 *
 * 호출 후 즉시 삭제할 것 (1회용)
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase22c-expense" };

export default async function handler(req: Request, ctx: Context) {
  const url    = new URL(req.url);
  const doRun  = url.searchParams.get("run") === "1";
  const sql    = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────────
  if (!doRun) {
    const [expCat] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'expense_categories'
      ) AS exists`;
    const [exp] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'expenses'
      ) AS exists`;
    const catCount = expCat.exists
      ? (await sql`SELECT COUNT(*) AS n FROM expense_categories`)[0].n
      : 0;
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      expense_categories: { exists: expCat.exists, seedCount: Number(catCount) },
      expenses:           { exists: exp.exists },
      hint: "?run=1 을 붙이면 실행 (어드민 로그인 필요)",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 실행 모드 ──────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const steps: string[] = [];

  try {
    // STEP 1 — expense_categories 테이블
    await sql`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id          SERIAL PRIMARY KEY,
        code        VARCHAR(32)  UNIQUE NOT NULL,
        name        VARCHAR(100) NOT NULL,
        description TEXT,
        is_system   BOOLEAN      NOT NULL DEFAULT false,
        sort_order  INTEGER      NOT NULL DEFAULT 0,
        is_active   BOOLEAN      NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS expense_categories_code_idx   ON expense_categories (code)`;
    await sql`CREATE INDEX IF NOT EXISTS expense_categories_active_idx  ON expense_categories (is_active)`;
    steps.push("expense_categories 테이블 + 인덱스 2개");

    // STEP 2 — expenses 테이블
    await sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id               SERIAL PRIMARY KEY,
        fiscal_year      INTEGER      NOT NULL,
        occurred_at      DATE         NOT NULL,
        category_id      INTEGER      NOT NULL REFERENCES expense_categories(id),
        amount           BIGINT       NOT NULL,
        payee_name       VARCHAR(200),
        description      TEXT,
        receipt_url      VARCHAR(500),
        status           VARCHAR(20)  NOT NULL DEFAULT 'draft',
        refund_amount    BIGINT       NOT NULL DEFAULT 0,
        recorded_by      INTEGER,
        recorded_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        approved_by      INTEGER,
        approved_at      TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS expenses_fy_idx        ON expenses (fiscal_year)`;
    await sql`CREATE INDEX IF NOT EXISTS expenses_category_idx  ON expenses (category_id)`;
    await sql`CREATE INDEX IF NOT EXISTS expenses_status_idx    ON expenses (status)`;
    await sql`CREATE INDEX IF NOT EXISTS expenses_occurred_idx  ON expenses (occurred_at)`;
    steps.push("expenses 테이블 + 인덱스 4개");

    // STEP 3 — expense_categories 시드 (NPO 표준 4분류)
    await sql`
      INSERT INTO expense_categories (code, name, description, is_system, sort_order)
      VALUES
        ('personnel',   '인건비',     '급여·퇴직금·복리후생비 등 인력 관련 비용',           true, 1),
        ('program',     '사업비',     '사업 수행에 직접 사용되는 비용',                       true, 2),
        ('admin_ops',   '관리운영비', '임차료·공과금·소모품 등 일반 운영 비용',               true, 3),
        ('fundraising', '모금비',     '후원자 모집·관리·감사 활동 관련 비용',                 true, 4)
      ON CONFLICT (code) DO NOTHING`;
    steps.push("expense_categories 시드 4개 (NPO 표준)");

    // STEP 4 — ai_tool_permissions 시드 (5개 도구)
    await sql`
      INSERT INTO ai_tool_permissions (tool_name, enabled, required_role, description, is_mutation, category)
      VALUES
        ('expense_categories_list', true, NULL,           '지출 카테고리 목록 조회',   false, 'finance'),
        ('expenses_list',           true, NULL,           '지출 항목 목록 조회',       false, 'finance'),
        ('expense_create',          true, NULL,           '지출 항목 신규 등록',       true,  'finance'),
        ('expense_approve',         true, 'super_admin',  '지출 항목 승인·반려',       true,  'finance'),
        ('expense_refund',          true, 'super_admin',  '지출 환불 기록',            true,  'finance')
      ON CONFLICT (tool_name) DO NOTHING`;
    steps.push("ai_tool_permissions 시드 5개");

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, steps,
      error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({
    ok: true, mode: "executed", adminUid: auth.ctx.adminId, steps,
    message: "Phase 22-C 마이그레이션 완료. 이 파일을 즉시 삭제하세요.",
  }), { headers: { "Content-Type": "application/json" } });
}
