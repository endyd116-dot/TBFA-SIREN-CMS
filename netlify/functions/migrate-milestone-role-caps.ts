/**
 * 1회용 마이그레이션: milestone_roles에 revenue_cap·non_revenue_cap 컬럼 추가 + 초기값 시드
 * GET ?run=1 → requireAdmin 후 실행 / GET 단독 → 진단(인증 불필요)
 * 호출 성공 후 즉시 파일 삭제 + 커밋
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-milestone-role-caps" };

const SEEDS = [
  { code: "PM", revenue_cap: 8_500_000, non_revenue_cap: 8_500_000 },
  { code: "SM", revenue_cap: 8_000_000, non_revenue_cap: 8_000_000 },
  { code: "SI", revenue_cap: 11_100_000, non_revenue_cap: 7_400_000 },
];

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // 진단 모드: 컬럼 존재 여부 확인
  if (!run) {
    try {
      const check = await db.execute(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'milestone_roles'
          AND column_name IN ('revenue_cap', 'non_revenue_cap')
      `);
      const cols = ((check as any).rows ?? check).map((r: any) => r.column_name);
      return Response.json({
        ok: true,
        mode: "diagnose",
        columns_exist: cols,
        ready_to_run: cols.length < 2,
        hint: "?run=1 + 어드민 로그인으로 실행",
      });
    } catch (err) {
      return Response.json({ ok: false, mode: "diagnose", error: String(err) }, { status: 500 });
    }
  }

  // 실행 모드
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const results: string[] = [];

  try {
    // 1. 컬럼 추가 (멱등)
    await db.execute(sql`
      ALTER TABLE milestone_roles
        ADD COLUMN IF NOT EXISTS revenue_cap NUMERIC,
        ADD COLUMN IF NOT EXISTS non_revenue_cap NUMERIC
    `);
    results.push("컬럼 추가 완료 (IF NOT EXISTS — 중복 무시)");

    // 2. 초기값 시드 (이미 값 있으면 스킵)
    for (const s of SEEDS) {
      await db.execute(sql`
        UPDATE milestone_roles
        SET revenue_cap     = COALESCE(revenue_cap,     ${s.revenue_cap}),
            non_revenue_cap = COALESCE(non_revenue_cap, ${s.non_revenue_cap})
        WHERE code = ${s.code}
      `);
      results.push(`${s.code}: revenue_cap=${s.revenue_cap} non_revenue_cap=${s.non_revenue_cap} (COALESCE — 기존값 보존)`);
    }

    return Response.json({ ok: true, results });
  } catch (err) {
    return Response.json({
      ok: false,
      error: "마이그레이션 실패",
      detail: String((err as any)?.message ?? err).slice(0, 500),
    }, { status: 500 });
  }
}
