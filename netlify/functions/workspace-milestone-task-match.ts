/**
 * Phase 25 — 카드-마일스톤 매칭 수동 확정 / 스킵 API
 * POST /api/workspace-milestone-task-match
 * body: { taskId, milestoneDefId, action: 'confirm' | 'skip' }
 */
import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/workspace-milestone-task-match" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return jsonRes({ ok: false, error: "POST only" }, { status: 405 });

  // P1-22 fix: 형제 성과 API(pending·progress·done·create-tasks)와 동일하게 운영자 허용.
  //            아래 task.member_id === member.id 소유자 검증이 있어 IDOR 위험 없음.
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const member = auth.ctx.member as any;

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const taskId = Number(body?.taskId || 0);
  const action = String(body?.action || "");
  if (!taskId || !["confirm", "skip"].includes(action)) {
    return jsonRes({ ok: false, error: "taskId, action(confirm|skip) 필수" }, { status: 400 });
  }

  function jsonError(step: string, err: any) {
    return jsonRes({
      ok: false, error: "매칭 저장 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  // 카드 소유자 확인
  let task: any;
  try {
    const rows = await db.execute(sql`
      SELECT id, member_id, title, status FROM workspace_tasks WHERE id = ${taskId}
    `);
    task = (rows as any).rows?.[0] || (rows as any[])[0];
  } catch (err) { return jsonError("select_task", err); }

  if (!task) return jsonRes({ ok: false, error: "카드를 찾을 수 없습니다" }, { status: 404 });
  if (task.member_id !== member.id) return jsonRes({ ok: false, error: "권한 없음" }, { status: 403 });

  if (action === "skip") {
    try {
      await db.execute(sql`
        UPDATE workspace_tasks SET milestone_match_status = 'skipped', updated_at = NOW()
        WHERE id = ${taskId}
      `);
    } catch (err) { return jsonError("update_skip", err); }
    return jsonRes({ ok: true, message: "분류 제외로 처리되었습니다" });
  }

  // action === 'confirm'
  const milestoneDefId = Number(body?.milestoneDefId || 0);
  if (!milestoneDefId) return jsonRes({ ok: false, error: "milestoneDefId 필수" }, { status: 400 });

  // 마일스톤 정의 유효성 확인
  let def: any;
  try {
    const rows = await db.execute(sql`
      SELECT id, name, threshold_value, threshold_unit FROM milestone_definitions
      WHERE id = ${milestoneDefId} AND is_active = TRUE
    `);
    def = (rows as any).rows?.[0] || (rows as any[])[0];
  } catch (err) { return jsonError("select_def", err); }

  if (!def) return jsonRes({ ok: false, error: "유효한 마일스톤이 아닙니다" }, { status: 400 });

  // 수동 매칭 저장
  try {
    await db.execute(sql`
      UPDATE workspace_tasks
      SET milestone_def_id = ${milestoneDefId},
          milestone_match_status = 'user',
          milestone_match_confidence = 100,
          updated_at = NOW()
      WHERE id = ${taskId}
    `);
  } catch (err) { return jsonError("update_match", err); }

  // 목표 달성 체크 → 비매출 성과 자동 제출
  try {
    const qRows = await db.execute(sql`
      SELECT id, start_date, end_date FROM quarters WHERE status = 'ACTIVE' LIMIT 1
    `);
    const quarter = (qRows as any).rows?.[0] || (qRows as any[])[0];
    if (quarter) {
      const cntRows = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM workspace_tasks
        WHERE member_id = ${member.id}
          AND milestone_def_id = ${milestoneDefId}
          AND milestone_match_status IN ('auto', 'user')
          AND status = 'done'
          -- P2-19 fix: 완료시각(UTC)을 KST 날짜로 변환해 분기 경계 비교
          AND (completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date >= ${quarter.start_date}::date
          AND (completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date <= ${quarter.end_date}::date
      `);
      const achieved = Number((cntRows as any).rows?.[0]?.cnt || (cntRows as any[])[0]?.cnt || 0);
      const target = Number(def.threshold_value || 0);

      if (target > 0 && achieved >= target) {
        const existRows = await db.execute(sql`
          SELECT id FROM non_revenue_achievements
          WHERE submitted_by = ${member.id}
            AND milestone_definition_id = ${milestoneDefId}
            AND quarter_id = ${quarter.id}
            AND status != 'REJECTED'
          LIMIT 1
        `);
        const exists = (existRows as any).rows?.[0] || (existRows as any[])[0];
        if (!exists) {
          await db.execute(sql`
            INSERT INTO non_revenue_achievements
              (milestone_definition_id, quarter_id, submitted_by, achieved_date, description, status, created_at, updated_at)
            VALUES
              (${milestoneDefId}, ${quarter.id}, ${member.id}, NOW(),
               ${"WBS 카드 " + achieved + "건 완료로 자동 달성"},
               'PENDING', NOW(), NOW())
          `);
        }
      }
    }
  } catch (err) {
    console.warn("[milestone-task-match] 성과 자동 제출 실패:", err);
  }

  return jsonRes({ ok: true, message: `${def.name} 성과에 매칭되었습니다` });
}
