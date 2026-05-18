/**
 * 1회용 마이그레이션: quarterly_settlements.hold_reason 컬럼 + milestone_definition_history 테이블 신설
 * R29-MS-GAP1 — 결산 HOLD 사유 저장 + 마일스톤 정의 변경 이력 보존
 *
 * 호출: https://tbfa.co.kr/api/migrate-ms-r29-hold-reason?run=1 (어드민 세션 필요)
 * 호출 성공 후 즉시 파일 삭제 + 커밋
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-ms-r29-hold-reason" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  if (!run) {
    return Response.json({
      ok: true,
      mode: "diagnostic",
      description: "결산 HOLD 사유 컬럼 + 마일스톤 정의 변경 이력 테이블 추가",
      run_url: `${url.origin}/api/migrate-ms-r29-hold-reason?run=1`,
      requires: "어드민 로그인 세션",
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
  }

  const steps: string[] = [];
  try {
    // 1. quarterly_settlements.hold_reason 컬럼 추가
    await db.execute(sql`
      ALTER TABLE quarterly_settlements
      ADD COLUMN IF NOT EXISTS hold_reason TEXT
    `);
    steps.push("quarterly_settlements.hold_reason: OK");

    // 2. milestone_definition_history 테이블 생성
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS milestone_definition_history (
        id            SERIAL PRIMARY KEY,
        definition_id INTEGER NOT NULL,
        changed_by    INTEGER NOT NULL,
        changed_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        field_name    VARCHAR(60) NOT NULL,
        old_value     TEXT,
        new_value     TEXT
      )
    `);
    steps.push("milestone_definition_history: OK");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ms_def_hist_def_idx
      ON milestone_definition_history(definition_id, changed_at DESC)
    `);
    steps.push("ms_def_hist_def_idx: OK");

    return Response.json({ ok: true, steps });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: "마이그레이션 실패",
      steps,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }
}
