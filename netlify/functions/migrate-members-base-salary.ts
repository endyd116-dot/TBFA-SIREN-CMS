/**
 * R32-P0-MS-C4: members 테이블에 base_salary 컬럼 추가 (1회용)
 *
 * GET /api/migrate-members-base-salary           진단 (인증 불필요)
 * GET /api/migrate-members-base-salary?run=1     어드민 인증 후 실행
 *
 * 결산 CSV 다운로드(admin-milestone-settlement-export)에서 m.base_salary SELECT
 * 컬럼 부재로 500 오류 → 컬럼 신설로 해결.
 * 호출 성공 후 즉시 파일 삭제 + 커밋.
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-members-base-salary" };

function jsonError(step: string, err: any) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "base_salary 컬럼 마이그 실패",
      step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 — 인증 불필요 */
  if (!run) {
    try {
      const { db } = await import("../../db");
      const { sql } = await import("drizzle-orm");
      const colCheck = await db.execute(sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'members' AND column_name = 'base_salary'
      `);
      const colRows = Array.isArray(colCheck) ? colCheck : ((colCheck as any)?.rows ?? []);
      const exists = colRows.length > 0;

      const memberCount = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM members`);
      const cntRows = Array.isArray(memberCount) ? memberCount : ((memberCount as any)?.rows ?? []);
      const totalMembers = cntRows[0]?.cnt ?? 0;

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          baseSalaryColumn: exists ? colRows[0] : null,
          exists,
          totalMembers,
          plan: exists
            ? "이미 존재 — run=1 호출해도 IF NOT EXISTS로 noop"
            : "ADD COLUMN base_salary numeric(15,2) DEFAULT 0 NOT NULL — 전체 회원 0원으로 초기화",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err) {
      return jsonError("diagnose", err);
    }
  }

  /* 실행 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    const { db } = await import("../../db");
    const { sql } = await import("drizzle-orm");

    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS base_salary numeric(15,2) DEFAULT 0 NOT NULL
    `);

    /* 검증 */
    const verify = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'members' AND column_name = 'base_salary'
    `);
    const verifyRows = Array.isArray(verify) ? verify : ((verify as any)?.rows ?? []);

    return new Response(
      JSON.stringify({
        ok: true,
        message: "members.base_salary 컬럼 추가 완료 (DEFAULT 0)",
        column: verifyRows[0] ?? null,
        nextSteps: [
          "schema.ts members 정의에 baseSalary 컬럼 추가 후 푸시",
          "본 마이그 파일 삭제 + 커밋",
          "실 운영 회원별 기본연봉은 추후 어드민 UI로 입력",
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return jsonError("alter", err);
  }
};
