import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/milestone-definitions" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const admin = auth.ctx?.member as any;
  const isSuperAdmin = admin?.role === "super_admin";

  function jsonError(step: string, err: any) {
    return Response.json({
      ok: false, error: "마일스톤 정의 오류", step,
      detail: String(err?.message || err).slice(0, 500),
    }, { status: 500 });
  }

  const url = new URL(req.url);

  // ── GET 목록 ──
  if (req.method === "GET") {
    const role = url.searchParams.get("role");   // SM|PM|SI
    const cat  = url.searchParams.get("category"); // REVENUE_LINKED|NON_REVENUE
    try {
      let q = `SELECT * FROM milestone_definitions WHERE 1=1`;
      const params: any[] = [];
      if (role) { params.push(role); q += ` AND target_milestone_role = $${params.length}`; }
      if (cat)  { params.push(cat);  q += ` AND category = $${params.length}`; }
      if (url.searchParams.get("activeOnly") !== "0") q += ` AND is_active = TRUE`;
      q += ` ORDER BY sort_order, id`;
      const rows = await db.execute(sql.raw(q, params));
      const milestones = ((rows as any).rows || (rows as any[])).map(formatDef);
      return Response.json({ ok: true, data: { milestones } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST 신규 ──
  if (req.method === "POST") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { code, name, category, targetMilestoneRole, businessUnit, revenueSource,
            thresholdEnabled, thresholdValue, thresholdUnit, bonusFormula,
            quarterApplicable, isSharedThreshold, sharedThresholdGroup, sortOrder } = body;
    if (!code || !name || !category || !targetMilestoneRole || !bonusFormula) {
      return Response.json({ ok: false, error: "필수 필드 누락 (code, name, category, targetMilestoneRole, bonusFormula)" }, { status: 400 });
    }
    try {
      const rows = await db.execute(sql`
        INSERT INTO milestone_definitions
          (code, name, category, target_milestone_role, business_unit, revenue_source,
           threshold_enabled, threshold_value, threshold_unit, bonus_formula,
           quarter_applicable, is_shared_threshold, shared_threshold_group, sort_order)
        VALUES (
          ${code}, ${name}, ${category}, ${targetMilestoneRole}, ${businessUnit ?? null}, ${revenueSource ?? null},
          ${thresholdEnabled ?? false}, ${thresholdValue ?? null}, ${thresholdUnit ?? null}, ${JSON.stringify(bonusFormula)},
          ${quarterApplicable ?? null}, ${isSharedThreshold ?? false}, ${sharedThresholdGroup ?? null}, ${sortOrder ?? 0}
        )
        RETURNING *
      `);
      const def = ((rows as any).rows?.[0] || rows[0]);
      return Response.json({ ok: true, data: { milestone: formatDef(def) } }, { status: 201 });
    } catch (err: any) {
      if (err?.message?.includes("unique")) return Response.json({ ok: false, error: "이미 존재하는 코드입니다" }, { status: 409 });
      return jsonError("insert", err);
    }
  }

  // ── PATCH /:id ──
  if (req.method === "PATCH") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    const id = url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    try {
      const allowed = ["name","thresholdEnabled","thresholdValue","thresholdUnit","bonusFormula",
                       "quarterApplicable","isActive","effectiveFrom","effectiveTo","sortOrder","businessUnit","revenueSource"];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const key of allowed) {
        if (key in body) {
          const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
          const val = key === "bonusFormula" ? JSON.stringify(body[key]) : body[key];
          sets.push(`${col} = $${vals.push(val)}`);
        }
      }
      if (!sets.length) return Response.json({ ok: false, error: "변경 필드 없음" }, { status: 400 });
      sets.push(`updated_at = NOW()`);
      vals.push(Number(id));
      const q = `UPDATE milestone_definitions SET ${sets.join(",")} WHERE id = $${vals.length} RETURNING *`;
      const rows = await db.execute(sql.raw(q, vals));
      const updated = (rows as any).rows?.[0] || rows[0];
      if (!updated) return Response.json({ ok: false, error: "해당 마일스톤 없음" }, { status: 404 });
      return Response.json({ ok: true, data: { milestone: formatDef(updated) } });
    } catch (err) { return jsonError("update", err); }
  }

  // ── DELETE /:id (비활성화) ──
  if (req.method === "DELETE") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    const id = url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    try {
      await db.execute(sql`UPDATE milestone_definitions SET is_active = FALSE, updated_at = NOW() WHERE id = ${Number(id)}`);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("deactivate", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}

function formatDef(r: any) {
  return {
    id: r.id, code: r.code, name: r.name,
    category: r.category, targetMilestoneRole: r.target_milestone_role,
    businessUnit: r.business_unit, revenueSource: r.revenue_source,
    thresholdEnabled: r.threshold_enabled, thresholdValue: r.threshold_value,
    thresholdUnit: r.threshold_unit, bonusFormula: r.bonus_formula,
    quarterApplicable: r.quarter_applicable,
    isSharedThreshold: r.is_shared_threshold, sharedThresholdGroup: r.shared_threshold_group,
    isActive: r.is_active, effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    sortOrder: r.sort_order,
  };
}
