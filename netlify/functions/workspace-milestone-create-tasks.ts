/**
 * Phase 25 — 마일스톤 정의 → WBS 카드 자동 생성
 * POST /api/workspace-milestone-create-tasks
 * body: { milestoneDefId, count? }
 */
import type { Context } from "@netlify/functions";
/* R35-GAP-P1-B-H1: requireAdmin → requireOperator (operator+admin 명세 정합) */
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/workspace-milestone-create-tasks" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return Response.json({ ok: false, error: "POST only" }, { status: 405 });

  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const member = auth.ctx.member as any;

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  const milestoneDefId = Number(body?.milestoneDefId || 0);
  if (!milestoneDefId) return Response.json({ ok: false, error: "milestoneDefId 필수" }, { status: 400 });

  function jsonError(step: string, err: any) {
    return Response.json({
      ok: false, error: "카드 생성 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  // 마일스톤 정의 조회
  let def: any;
  try {
    const rows = await db.execute(sql`
      SELECT id, code, name, category, threshold_value, threshold_unit, target_milestone_role
      FROM milestone_definitions
      WHERE id = ${milestoneDefId} AND is_active = TRUE
    `);
    def = (rows as any).rows?.[0] || (rows as any[])[0];
  } catch (err) { return jsonError("select_def", err); }

  if (!def) return Response.json({ ok: false, error: "마일스톤을 찾을 수 없습니다" }, { status: 404 });

  // 카테고리 확인 (비매출만 카드 생성 가능)
  if (def.category === "REVENUE_LINKED") {
    return Response.json({ ok: false, error: "매출 마일스톤은 카드 자동 생성을 지원하지 않습니다" }, { status: 400 });
  }

  // 담당 역할 확인 (R35-GAP-P2-M3: super_admin은 milestoneRole=null이라도 모든 정의에 카드 생성 가능)
  const milestoneRole = member.milestoneRole || member.milestone_role || null;
  if (def.target_milestone_role !== milestoneRole && member.role !== "super_admin") {
    return Response.json({ ok: false, error: "본인 담당 마일스톤이 아닙니다" }, { status: 403 });
  }

  // 활성 분기 조회 (마감일 계산용)
  let quarter: any;
  try {
    const qRows = await db.execute(sql`
      SELECT id, end_date FROM quarters WHERE status = 'ACTIVE' LIMIT 1
    `);
    quarter = (qRows as any).rows?.[0] || (qRows as any[])[0];
  } catch { quarter = null; }

  const dueDate = quarter?.end_date || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // 생성할 카드 수 (명시적 count 또는 threshold_value 기준, 최대 10개)
  const count = Math.min(Number(body?.count || def.threshold_value || 1), 10);
  const force = body?.force === true;   // Q3-047 fix: 안내한 force=true를 실제 처리 (기존엔 미처리라 항상 409)

  // 이미 생성된 연결 카드 수 확인
  let existCount = 0;
  try {
    const eRows = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM workspace_tasks
      WHERE member_id = ${member.id}
        AND milestone_def_id = ${milestoneDefId}
        AND status != 'archived'
    `);
    existCount = Number((eRows as any).rows?.[0]?.cnt || (eRows as any[])[0]?.cnt || 0);
  } catch { existCount = 0; }

  if (existCount > 0 && !force) {
    return Response.json({
      ok: false,
      error: `이미 연결된 카드 ${existCount}개가 있습니다. 기존 카드를 먼저 완료하거나 추가 생성하려면 force=true를 전달하세요`,
      existCount,
    }, { status: 409 });
  }

  // 카드 생성
  const createdIds: number[] = [];
  const tag = `milestone:${def.code}`;

  for (let i = 0; i < count; i++) {
    const titleSuffix = count > 1 ? ` (${i + 1}/${count})` : "";
    try {
      const inserted = await db.execute(sql`
        INSERT INTO workspace_tasks
          (member_id, title, description, status, priority, due_date,
           tags, source_type, milestone_def_id, milestone_match_status,
           created_by_agent, created_at, updated_at)
        VALUES
          (${member.id},
           ${def.name + titleSuffix},
           ${"[마일스톤 연동] " + def.name + " 달성을 위한 업무 카드입니다.\n목표: " + (def.threshold_value || 1) + (def.threshold_unit || "건")},
           'todo', 'normal', ${dueDate},
           ${JSON.stringify([tag])}, 'milestone',
           ${milestoneDefId}, 'user',
           'milestone-create', NOW(), NOW())
        RETURNING id
      `);
      const newId = ((inserted as any).rows?.[0] || (inserted as any[])[0])?.id;
      if (newId) createdIds.push(newId);
    } catch (err) { return jsonError(`insert_card_${i}`, err); }
  }

  return Response.json({
    ok: true,
    message: `${def.name} 관련 카드 ${createdIds.length}개가 WBS에 추가되었습니다`,
    createdIds,
    milestoneName: def.name,
  });
}
