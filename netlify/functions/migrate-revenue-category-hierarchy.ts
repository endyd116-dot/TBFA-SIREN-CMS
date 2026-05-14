/**
 * 매출 카테고리 2단계 계층 — revenue_categories 컬럼 추가
 *
 * GET /api/migrate-revenue-category-hierarchy           → 진단 (인증 불필요)
 * GET /api/migrate-revenue-category-hierarchy?run=1     → 컬럼 추가 + 시드 보호 (어드민 인증)
 *
 * 추가 컬럼:
 *  - parent_id integer            : 상위 카테고리 id (NULL = 대분류). 기존 6개 시드는 모두 NULL → 자동으로 대분류 승격.
 *  - is_system boolean NOT NULL   : true = 기본 시드(코드 변경·삭제 불가). 기존 6개 시드에 TRUE 부여.
 *
 * 멱등성: ADD COLUMN IF NOT EXISTS, UPDATE는 code 기준 — 반복 호출 안전.
 * 자기참조 FK는 두지 않음 (account_codes.parent_code 패턴과 동일 — API에서 실존 검증).
 * 호출 성공 후 즉시 파일 삭제할 것 (1회용 보안 원칙).
 */
import type { Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-revenue-category-hierarchy" };

/** 기존 평면 시드 6종 — is_system 보호 대상 */
const SEED_CODES = ["lecture", "govgrant", "corp_sponsor", "twork_on", "twork_si", "etc"];

export default async function handler(req: Request, _ctx: Context) {
  const url   = new URL(req.url);
  const doRun = url.searchParams.get("run") === "1";
  const sql   = neon(process.env.NETLIFY_DATABASE_URL!);

  // ── 진단 모드 ──────────────────────────────────────────
  if (!doRun) {
    const cols: any = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'revenue_categories'`;
    const colNames = (cols as any[]).map((c) => c.column_name);
    const [t] = await sql`SELECT COUNT(*) AS n FROM revenue_categories`;
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      currentColumns: colNames,
      hasParentId: colNames.includes("parent_id"),
      hasIsSystem: colNames.includes("is_system"),
      categoryCount: Number(t.n),
      hint: "?run=1 으로 parent_id·is_system 컬럼 추가 (어드민 인증 필요)",
    }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 인증 ──────────────────────────────────────────────
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  // ── Run 모드 ──────────────────────────────────────────
  try {
    await sql`ALTER TABLE revenue_categories ADD COLUMN IF NOT EXISTS parent_id integer`;
    await sql`ALTER TABLE revenue_categories ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false`;
    await sql`CREATE INDEX IF NOT EXISTS revenue_categories_parent_idx ON revenue_categories (parent_id)`;

    // 기존 6종 시드 보호 표시
    const upd: any = await sql`
      UPDATE revenue_categories SET is_system = TRUE
      WHERE code = ANY(${SEED_CODES}) AND is_system = FALSE`;
    const protectedCount = (upd as any)?.count ?? 0;

    const [t] = await sql`SELECT COUNT(*) AS n FROM revenue_categories`;
    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      message: `매출 카테고리 계층 컬럼 추가 완료 — parent_id·is_system 생성, 시드 보호 ${protectedCount}건 (전체 ${Number(t.n)}건)`,
      protectedCount, categoryCount: Number(t.n),
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그레이션 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
