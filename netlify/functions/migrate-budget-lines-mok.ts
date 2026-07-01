/**
 * GET /api/migrate-budget-lines-mok        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-budget-lines-mok?run=1  — 실행 (super_admin 인증)
 *
 * 배치 1 잔여 — 예산 편성을 '목(目)' 단위로 전환하기 위한 budget_lines 제약 변경.
 *   1) category_id NOT NULL 해제 (목 기반 라인은 category_id NULL)
 *   2) UNIQUE(plan_id, category_id) 제거 → 여러 목이 같은 관/카테고리에 속할 수 있으므로
 *   3) UNIQUE(plan_id, budget_account_id) 신설 (한 예산안에서 목당 1줄)
 *
 * 안전:
 *   - 기존 budget_lines 데이터 보존(컬럼·값 변경 없음, 제약만 조정)
 *   - budget_account_id는 이전 마이그(관-항-목)에서 각 관의 미분류 목으로 백필됨
 *   - 멱등: ALTER DROP NOT NULL·DROP INDEX IF EXISTS·CREATE UNIQUE INDEX IF NOT EXISTS
 *
 * 실행 성공 후: schema.ts categoryId nullable 반영 + 편성 API 목 기반 전환 + 이 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-budget-lines-mok" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

async function rows(q: string): Promise<any[]> {
  const r: any = await db.execute(sql.raw(q));
  return r?.rows ?? r ?? [];
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const notNull = (await rows(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'budget_lines' AND column_name = 'category_id'
    `))[0]?.is_nullable;
    const idxs = await rows(`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'budget_lines' AND indexname IN ('budget_lines_plan_cat_unique','budget_lines_plan_ba_unique')
    `);
    const idxNames = idxs.map((r: any) => r.indexname);
    const lineCount = (await rows(`SELECT COUNT(*)::int AS n FROM budget_lines`))[0]?.n || 0;
    const nullBa = (await rows(`SELECT COUNT(*)::int AS n FROM budget_lines WHERE budget_account_id IS NULL`))[0]?.n || 0;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        categoryIdNullable: notNull === "YES",
        indexes: idxNames,
        budgetLines: lineCount,
        budgetLinesWithoutMok: nullBa,
        plan: [
          "budget_lines.category_id NOT NULL 해제",
          "UNIQUE(plan_id, category_id) 제거",
          "UNIQUE(plan_id, budget_account_id) 신설",
        ],
        note: nullBa > 0 ? `목 미지정 라인 ${nullBa}건 존재(표준 4관 외 커스텀 카테고리 편성). NULL 허용 유니크라 충돌 없음.` : undefined,
        hint: "?run=1 로 실행 (super_admin 인증).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    step = "alter_nullable";
    await db.execute(sql.raw(`ALTER TABLE budget_lines ALTER COLUMN category_id DROP NOT NULL;`));

    step = "drop_old_unique";
    await db.execute(sql.raw(`DROP INDEX IF EXISTS budget_lines_plan_cat_unique;`));

    step = "add_new_unique";
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS budget_lines_plan_ba_unique
        ON budget_lines(plan_id, budget_account_id);
    `));

    step = "done";
    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      hint: "완료. 메인 채팅에 알려주세요 → schema categoryId nullable 반영 + 편성 API 목 기반 전환. 확인 후 이 파일 삭제.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "budget_lines 목 전환 마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
