/**
 * Phase 25: workspace_tasks 마일스톤 연동 컬럼 추가 마이그레이션
 * GET ?run=1 : requireAdmin 후 실행
 * GET (기본) : 진단 모드
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-phase25-milestone-tasks" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  if (!url.searchParams.has("run")) {
    return Response.json({
      ok: true,
      info: "Phase 25: workspace_tasks 마일스톤 연동 컬럼 3개 추가. ?run=1 로 실행",
      columns: ["milestone_def_id", "milestone_match_status", "milestone_match_confidence"],
    });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const steps: string[] = [];

  function jsonError(step: string, err: any) {
    return Response.json({
      ok: false, error: "마이그레이션 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  try {
    await db.execute(sql`
      ALTER TABLE workspace_tasks
      ADD COLUMN IF NOT EXISTS milestone_def_id integer REFERENCES milestone_definitions(id) ON DELETE SET NULL
    `);
    steps.push("workspace_tasks.milestone_def_id 추가");
  } catch (err) { return jsonError("add_milestone_def_id", err); }

  try {
    await db.execute(sql`
      ALTER TABLE workspace_tasks
      ADD COLUMN IF NOT EXISTS milestone_match_status varchar(20)
    `);
    steps.push("workspace_tasks.milestone_match_status 추가 (auto|user|skipped|null)");
  } catch (err) { return jsonError("add_milestone_match_status", err); }

  try {
    await db.execute(sql`
      ALTER TABLE workspace_tasks
      ADD COLUMN IF NOT EXISTS milestone_match_confidence integer
    `);
    steps.push("workspace_tasks.milestone_match_confidence 추가 (0~100)");
  } catch (err) { return jsonError("add_milestone_match_confidence", err); }

  try {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS workspace_tasks_milestone_def_idx ON workspace_tasks(milestone_def_id)
    `);
    steps.push("인덱스 생성 (milestone_def_id)");
  } catch (err) { return jsonError("create_index", err); }

  return Response.json({ ok: true, steps });
}
