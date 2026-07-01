/**
 * GET /api/migrate-expenses-category-nullable        — 진단
 * GET /api/migrate-expenses-category-nullable?run=1  — 실행 (super_admin)
 *
 * 결재 최종 승인 시 생성되는 지출(expenses)은 예산 목(budget_account_id) 기준이라
 * 레거시 category_id를 채우지 않는다. 그런데 expenses.category_id가 아직 NOT NULL이라
 * INSERT가 실패(결재 승인 깨짐). budget_lines와 동일하게 nullable로 완화한다.
 *
 * + C: 직원(operator) '지출 결재 기안' 권한키 시드(operatorAllowed=true).
 *
 * 멱등: ALTER ... DROP NOT NULL · INSERT ON CONFLICT DO NOTHING. 기존 데이터 변경 없음.
 * 실행 후 schema expenses.categoryId nullable 반영 + 이 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-expenses-category-nullable" };
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
    const nullable = (await rows(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'expenses' AND column_name = 'category_id'
    `))[0]?.is_nullable;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        categoryIdNullable: nullable === "YES",
        plan: ["expenses.category_id NOT NULL 해제(결재 승인 지출은 예산 목 기준)"],
        hint: nullable === "YES" ? "이미 nullable — 실행 불필요" : "?run=1 로 실행 (super_admin 인증).",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    step = "alter";
    await db.execute(sql.raw(`ALTER TABLE expenses ALTER COLUMN category_id DROP NOT NULL;`));

    step = "seed_permission";
    // C: 직원(operator)이 '지출 결재 기안'을 올릴 수 있는 권한키. (결재·설정은 admin/이사장만 유지)
    await db.execute(sql.raw(`
      INSERT INTO role_permissions (feature_key, feature_label, category, admin_allowed, operator_allowed)
      VALUES ('finance_approval_submit', '지출 결재 기안 올리기', 'finance', TRUE, TRUE)
      ON CONFLICT (feature_key) DO NOTHING;
    `));

    step = "done";
    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      hint: "완료. 메인 채팅에 알려주세요 → schema 반영 + 결재 승인 정상화. 확인 후 이 파일 삭제.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "expenses category nullable 마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
