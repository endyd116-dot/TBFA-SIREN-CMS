/**
 * GET /api/migrate-pension-cap        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-pension-cap?run=1  — 실행 (어드민 인증)
 *
 * 급여 기준 설정(payroll_settings)에 '국민연금 기준소득월액 상한' 칸을 추가한다.
 *   pension_cap NUMERIC DEFAULT 6370000  (2025-07 ~ 2026-06 공단 고시 상한)
 *
 * 왜: 국민연금은 요율이 정률이지만 기준소득월액에 상한이 있어, 상한을 넘는 금액에는
 *     보험료를 매기지 않는다. 상한이 없던 동안에는 상여를 얹어 상한을 넘는 달에
 *     연금이 과다 공제됐다(예: 상여 500만 지급 시 99,064원 과다).
 *     상한액은 매년 7월 조정되므로 운영자가 급여 계산 기준 화면에서 직접 고친다.
 *
 * 멱등: ADD COLUMN IF NOT EXISTS + 기존 행이 비어 있을 때만 기본값 채움.
 * 호출 성공 후 즉시 파일 삭제 + commit (§6.8).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-pension-cap" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const DEFAULT_CAP = 6370000;

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const colRes: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'payroll_settings' AND column_name = 'pension_cap'
    `);
    const exists = ((colRes?.rows ?? colRes ?? []) as any[]).length > 0;

    if (!run) {
      return new Response(jsonKST({
        ok: true, mode: "diagnose",
        pension_cap_exists: exists,
        default_cap: DEFAULT_CAP,
        next: exists ? "이미 적용됨 — 실행 불필요" : "?run=1 로 호출하면 칸을 추가합니다 (어드민 로그인 필요)",
      }), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;

    step = "alter";
    /* DDL에는 값 바인딩($1)을 쓸 수 없다 — 반드시 리터럴로 넣는다.
       (drizzle sql`` 템플릿은 값을 파라미터로 보내므로 ALTER 문에서 문법 오류가 난다) */
    await db.execute(sql.raw(
      `ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS pension_cap NUMERIC DEFAULT ${DEFAULT_CAP}`
    ));

    step = "fill";
    await db.execute(sql`
      UPDATE payroll_settings SET pension_cap = ${DEFAULT_CAP} WHERE pension_cap IS NULL
    `);

    step = "verify";
    const after: any = await db.execute(sql`SELECT id, pension_cap FROM payroll_settings ORDER BY id`);
    return new Response(jsonKST({
      ok: true, mode: "run",
      applied: true,
      rows: (after?.rows ?? after ?? []),
      message: "국민연금 상한 칸이 추가됐습니다. 급여관리 → 급여 계산 기준에서 금액을 조정할 수 있습니다.",
    }), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "마이그레이션 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
