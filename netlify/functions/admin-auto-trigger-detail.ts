// netlify/functions/admin-auto-trigger-detail.ts
// Phase 10 R4 — 자동 트리거 상세 + 최근 실행 이력 5건 (어드민)
//
// GET ?id=X

import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-auto-trigger-detail" };

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id || isNaN(id)) {
    return new Response(
      JSON.stringify({ ok: false, error: "트리거 ID(id)가 필요합니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const trigRes: any = await db.execute(sql`
      SELECT t.id, t.name, t.description, t.trigger_type, t.template_id,
             ct.name AS template_name, t.recipient_group_id,
             rg.name AS group_name,
             t.channel, t.delay_hours, t.is_active, t.cooldown_days,
             t.conditions, t.created_by, t.updated_by,
             t.created_at, t.updated_at, t.deleted_at
        FROM communication_auto_triggers t
        LEFT JOIN communication_templates ct ON ct.id = t.template_id
        LEFT JOIN recipient_groups rg ON rg.id = t.recipient_group_id
       WHERE t.id = ${id}
       LIMIT 1
    `);
    const trigger = (trigRes?.rows ?? trigRes ?? [])[0];
    if (!trigger) {
      return new Response(
        JSON.stringify({ ok: false, error: "트리거를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    /* 최근 실행 이력 5건 */
    let recentRuns: any[] = [];
    try {
      const runsRes: any = await db.execute(sql`
        SELECT id, job_id, triggered_at, member_count, status, error
          FROM communication_auto_trigger_runs
         WHERE trigger_id = ${id}
         ORDER BY triggered_at DESC
         LIMIT 5
      `);
      recentRuns = runsRes?.rows ?? runsRes ?? [];
    } catch (e) {
      console.warn("[admin-auto-trigger-detail] runs 조회 실패", e);
    }

    return new Response(
      JSON.stringify({ ok: true, trigger, recentRuns }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false, error: "트리거 상세 조회 실패",
        step: "select", detail: String(err?.message || err).slice(0, 500),
        stack: String(err?.stack || "").slice(0, 1000),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
