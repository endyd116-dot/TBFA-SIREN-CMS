/**
 * Phase 25 — WBS 대시보드용 비매출 마일스톤 진행률 API
 * GET /api/workspace-milestone-progress?quarterId=N
 */
import { jsonRes } from "../../lib/kst";
import type { Context } from "@netlify/functions";
/* R35-GAP-P1-B-H1: requireAdmin → requireOperator (operator+admin 명세 정합) */
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/workspace-milestone-progress" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const member = auth.ctx.member as any;

  const url = new URL(req.url);
  const quarterIdParam = url.searchParams.get("quarterId");

  function jsonError(step: string, err: any) {
    return jsonRes({
      ok: false, error: "진행률 조회 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  // 활성 분기 조회
  let quarter: any;
  try {
    if (quarterIdParam) {
      const rows = await db.execute(sql`SELECT * FROM quarters WHERE id = ${Number(quarterIdParam)}`);
      quarter = (rows as any).rows?.[0] || (rows as any[])[0];
    } else {
      const rows = await db.execute(sql`
        SELECT * FROM quarters WHERE status = 'ACTIVE' ORDER BY year DESC, quarter DESC LIMIT 1
      `);
      quarter = (rows as any).rows?.[0] || (rows as any[])[0];
    }
  } catch (err) { return jsonError("select_quarter", err); }

  if (!quarter) {
    return jsonRes({ ok: true, data: { quarter: null, milestones: [], pendingCount: 0 } });
  }

  const milestoneRole = member.milestoneRole || member.milestone_role || null;
  if (!milestoneRole) {
    return jsonRes({ ok: true, data: { quarter, milestones: [], pendingCount: 0 } });
  }

  // 비매출 마일스톤 정의 조회
  let defs: any[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT id, code, name, threshold_value, threshold_unit, sort_order
      FROM milestone_definitions
      WHERE target_milestone_role = ${milestoneRole}
        AND category != 'REVENUE_LINKED'
        AND is_active = TRUE
      ORDER BY sort_order
    `);
    defs = (rows as any).rows || (rows as any[]);
  } catch (err) { return jsonError("select_defs", err); }

  // 각 마일스톤별 달성 카드 수
  const milestones: any[] = [];
  for (const def of defs) {
    let achieved = 0;
    try {
      const cntRows = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM workspace_tasks
        WHERE member_id = ${member.id}
          AND milestone_def_id = ${def.id}
          AND milestone_match_status IN ('auto', 'user')
          AND status = 'done'
          -- P2-19 fix: 완료시각(UTC)을 KST 날짜로 변환해 분기 경계 비교 (과거 9시간 밀려 분기 첫날 새벽·마지막날 오전 이후 완료분 누락)
          AND (completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date >= ${quarter.start_date}::date
          AND (completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date <= ${quarter.end_date}::date
      `);
      achieved = Number((cntRows as any).rows?.[0]?.cnt || (cntRows as any[])[0]?.cnt || 0);
    } catch { achieved = 0; }

    const target = Number(def.threshold_value || 0);
    const pct = target > 0 ? Math.min(Math.round((achieved / target) * 100), 100) : (achieved > 0 ? 100 : 0);
    milestones.push({
      defId: def.id, code: def.code, name: def.name,
      target, unit: def.threshold_unit || "건",
      achieved, pct,
    });
  }

  // 분류 대기 카드 수
  let pendingCount = 0;
  try {
    const pRows = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM workspace_tasks
      WHERE member_id = ${member.id}
        AND status = 'done'
        AND milestone_def_id IS NULL
        AND milestone_match_status IS NULL
        AND (completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date >= ${quarter.start_date}::date
    `);
    pendingCount = Number((pRows as any).rows?.[0]?.cnt || (pRows as any[])[0]?.cnt || 0);
  } catch { pendingCount = 0; }

  return jsonRes({
    ok: true,
    data: {
      quarter: { id: quarter.id, year: quarter.year, quarter: quarter.quarter, status: quarter.status },
      milestones,
      pendingCount,
    },
  });
}
