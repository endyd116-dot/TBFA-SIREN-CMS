/**
 * Phase 22-B-R2 마이그레이션 — 예산 편성 테이블 생성
 * GET /api/migrate-phase22b-r2-budget-plans          → 진단 (인증 불필요)
 * GET /api/migrate-phase22b-r2-budget-plans?run=1    → 어드민 인증 후 실행
 *
 * 생성:
 *  - budget_plans   (예산안 — 결재 단위, 연도당 1개 UNIQUE)
 *  - budget_lines   (예산안의 카테고리별 편성 행)
 *  - ai_tool_permissions: budget_plan_list / budget_plan_create / budget_plan_approve (3개 시드)
 *
 * 멱등성: IF NOT EXISTS + ON CONFLICT DO NOTHING
 * 호출 성공 후 즉시 파일 삭제할 것 (1회용 보안 원칙)
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-phase22b-r2-budget-plans" };

export default async function handler(req: Request, _ctx: Context) {
  const url   = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";
  const sql   = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────────
  if (!doRun) {
    const checks: Record<string, any> = {};
    try {
      const [bp] = await sql`
        SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'budget_plans'`;
      checks.budget_plans_exists = Number(bp.n) > 0;
    } catch { checks.budget_plans_exists = false; }
    try {
      const [bl] = await sql`
        SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'budget_lines'`;
      checks.budget_lines_exists = Number(bl.n) > 0;
    } catch { checks.budget_lines_exists = false; }
    try {
      const [tp] = await sql`
        SELECT COUNT(*) AS n FROM ai_tool_permissions
        WHERE tool_name LIKE 'budget_plan_%'`;
      checks.ai_tool_permissions_budget_plan_count = Number(tp.n);
    } catch { checks.ai_tool_permissions_budget_plan_count = "ai_tool_permissions 테이블 없음"; }
    try {
      const [ec] = await sql`
        SELECT COUNT(*) AS n FROM expense_categories WHERE is_active = TRUE`;
      checks.expense_categories_active = Number(ec.n);
    } catch { checks.expense_categories_active = "expense_categories 테이블 없음"; }

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
    // 1. budget_plans 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS budget_plans (
        id               SERIAL PRIMARY KEY,
        fiscal_year      INTEGER NOT NULL UNIQUE,
        title            TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'draft',
        total_planned    BIGINT NOT NULL DEFAULT 0,
        created_by       INTEGER,
        submitted_by     INTEGER,
        submitted_at     TIMESTAMPTZ,
        approved_by      INTEGER,
        approved_at      TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("budget_plans 테이블 생성 완료");

    // 2. budget_lines 테이블 생성
    await sql`
      CREATE TABLE IF NOT EXISTS budget_lines (
        id               SERIAL PRIMARY KEY,
        plan_id          INTEGER NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
        category_id      INTEGER NOT NULL REFERENCES expense_categories(id),
        planned_amount   BIGINT NOT NULL DEFAULT 0,
        prev_year_actual BIGINT NOT NULL DEFAULT 0,
        note             TEXT,
        UNIQUE(plan_id, category_id)
      )
    `;
    results.push("budget_lines 테이블 생성 완료");

    // 3. ai_tool_permissions 시드 (3개)
    const toolSeeds = [
      { name: "budget_plan_list",    desc: "연도별 예산안 목록·상태 조회",        role: "admin",       cat: "finance" },
      { name: "budget_plan_create",  desc: "차년도 예산안 생성 (dry-run 우선)",   role: "admin",       cat: "finance" },
      { name: "budget_plan_approve", desc: "예산안 승인 또는 반려 (dry-run 우선)", role: "super_admin", cat: "finance" },
    ];
    for (const t of toolSeeds) {
      await sql`
        INSERT INTO ai_tool_permissions (tool_name, description, required_role, enabled, category)
        VALUES (${t.name}, ${t.desc}, ${t.role}, TRUE, ${t.cat})
        ON CONFLICT (tool_name) DO NOTHING
      `;
    }
    results.push("ai_tool_permissions budget_plan_* 3개 시드 완료");

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      results,
      message: "Phase 22-B-R2 예산 편성 마이그레이션 완료. 파일을 즉시 삭제하세요.",
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
