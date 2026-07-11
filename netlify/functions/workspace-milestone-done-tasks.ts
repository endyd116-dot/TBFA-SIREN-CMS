/**
 * Phase 25 — done 카드를 마일스톤별로 그룹핑해서 반환 (보관함 성과별 보기)
 * GET /api/workspace-milestone-done-tasks?quarterId=N
 */
import type { Context } from "@netlify/functions";
/* R35-GAP-P1-B-H1: requireAdmin → requireOperator (operator+admin 명세 정합) */
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/workspace-milestone-done-tasks" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const member = auth.ctx.member as any;

  const url = new URL(req.url);
  const quarterIdParam = url.searchParams.get("quarterId");

  function jsonError(step: string, err: any) {
    return Response.json({
      ok: false, error: "완료 카드 조회 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  // 분기 조회
  let quarter: any;
  try {
    if (quarterIdParam) {
      const rows = await db.execute(sql`SELECT id, year, quarter, start_date, end_date FROM quarters WHERE id = ${Number(quarterIdParam)}`);
      quarter = (rows as any).rows?.[0] || (rows as any[])[0];
    } else {
      const rows = await db.execute(sql`
        SELECT id, year, quarter, start_date, end_date FROM quarters WHERE status = 'ACTIVE' LIMIT 1
      `);
      quarter = (rows as any).rows?.[0] || (rows as any[])[0];
    }
  } catch (err) { return jsonError("select_quarter", err); }

  const sinceDate = quarter?.start_date || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const untilDate = quarter?.end_date || new Date().toISOString();

  // 완료 카드 전체 (이 분기 내)
  let tasks: any[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT t.id, t.title, t.completed_at, t.milestone_def_id, t.milestone_match_status, t.milestone_match_confidence,
             md.name as milestone_name, md.code as milestone_code
      FROM workspace_tasks t
      LEFT JOIN milestone_definitions md ON md.id = t.milestone_def_id
      WHERE t.member_id = ${member.id}
        AND t.status = 'done'
        -- P2-19 fix: 완료시각(UTC)을 KST 날짜로 변환해 분기 경계 비교 (마지막날 완료 카드 누락 방지)
        AND (t.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date >= ${sinceDate}::date
        AND (t.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date <= ${untilDate}::date
      ORDER BY t.completed_at DESC
      LIMIT 200
    `);
    tasks = (rows as any).rows || (rows as any[]);
  } catch (err) { return jsonError("select_tasks", err); }

  // 그룹핑
  const grouped: Record<number, { defId: number; name: string; code: string; tasks: any[] }> = {};
  const unmatched: any[] = [];
  const skipped: any[] = [];

  for (const t of tasks) {
    if (t.milestone_match_status === "skipped") {
      skipped.push({ id: t.id, title: t.title, completedAt: t.completed_at });
      continue;
    }
    if (t.milestone_def_id) {
      const key = t.milestone_def_id;
      if (!grouped[key]) {
        grouped[key] = { defId: key, name: t.milestone_name || "", code: t.milestone_code || "", tasks: [] };
      }
      grouped[key].tasks.push({
        id: t.id, title: t.title, completedAt: t.completed_at,
        matchStatus: t.milestone_match_status,
        confidence: t.milestone_match_confidence,
      });
    } else {
      unmatched.push({ id: t.id, title: t.title, completedAt: t.completed_at });
    }
  }

  return Response.json({
    ok: true,
    data: {
      quarter: quarter ? { id: quarter.id, year: quarter.year, quarter: quarter.quarter } : null,
      grouped: Object.values(grouped),
      unmatched,
      skipped,
    },
  });
}
