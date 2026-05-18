/**
 * Phase 25 — 분류 보류 중인 완료 카드 목록
 * GET /api/workspace-milestone-pending
 */
import type { Context } from "@netlify/functions";
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/workspace-milestone-pending" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;
  const member = auth.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({
      ok: false, error: "보류 목록 조회 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  // 활성 분기 시작일 이후 완료된 카드 중 미분류 목록
  let quarter: any;
  try {
    const qRows = await db.execute(sql`
      SELECT id, start_date FROM quarters WHERE status = 'ACTIVE' LIMIT 1
    `);
    quarter = (qRows as any).rows?.[0] || (qRows as any[])[0];
  } catch (err) { return jsonError("select_quarter", err); }

  const sinceDate = quarter?.start_date || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  let tasks: any[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT id, title, description, tags, completed_at
      FROM workspace_tasks
      WHERE member_id = ${member.id}
        AND status = 'done'
        AND milestone_def_id IS NULL
        AND (milestone_match_status IS NULL)
        AND completed_at IS NOT NULL
        AND completed_at >= ${sinceDate}
      ORDER BY completed_at DESC
      LIMIT 50
    `);
    tasks = (rows as any).rows || (rows as any[]);
  } catch (err) { return jsonError("select_tasks", err); }

  // 매칭에 쓸 비매출 마일스톤 목록
  const milestoneRole = member.milestoneRole || member.milestone_role || null;
  let defs: any[] = [];
  if (milestoneRole) {
    try {
      const rows = await db.execute(sql`
        SELECT id, code, name FROM milestone_definitions
        WHERE target_milestone_role = ${milestoneRole}
          AND category != 'REVENUE_LINKED'
          AND is_active = TRUE
        ORDER BY sort_order
      `);
      defs = (rows as any).rows || (rows as any[]);
    } catch { defs = []; }
  }

  return Response.json({
    ok: true,
    data: {
      tasks: tasks.map((t: any) => ({
        id: t.id, title: t.title,
        completedAt: t.completed_at,
        description: String(t.description || "").slice(0, 100),
      })),
      milestones: defs.map((d: any) => ({ id: d.id, code: d.code, name: d.name })),
    },
  });
}
