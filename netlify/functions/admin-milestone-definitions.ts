/**
 * GET/POST/PUT/DELETE /api/admin-milestone-definitions
 * 마일스톤 정의 CRUD — super_admin 전용
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyMany } from "../../lib/notify";

export const config = { path: "/api/admin-milestone-definitions" };

function jsonErr(step: string, err: any) {
  return Response.json({
    ok: false, error: "마일스톤 정의 오류", step,
    detail: String(err?.message || err).slice(0, 400),
  }, { status: 500 });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용 기능입니다" }, { status: 403 });
  }

  /* ── GET: 전체 목록 ── */
  if (req.method === "GET") {
    try {
      const rows = await db.execute(sql`
        SELECT id, code, name, category, target_milestone_role,
               business_unit, revenue_source,
               threshold_enabled, threshold_value, threshold_unit,
               bonus_formula, quarter_applicable,
               is_shared_threshold, shared_threshold_group,
               is_active, effective_from, effective_to, sort_order,
               created_at, updated_at
        FROM milestone_definitions
        ORDER BY sort_order, id
      `);
      return Response.json({ ok: true, data: (rows as any).rows ?? rows });
    } catch (err) { return jsonErr("select", err); }
  }

  /* ── POST: 신규 생성 ── */
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch {
      return Response.json({ ok: false, error: "요청 본문 파싱 실패" }, { status: 400 });
    }
    const { code, name, category, targetMilestoneRole,
            businessUnit, revenueSource,
            thresholdEnabled, thresholdValue, thresholdUnit,
            bonusFormula, quarterApplicable,
            isSharedThreshold, sharedThresholdGroup,
            effectiveFrom, effectiveTo, sortOrder } = body;

    if (!code || !name || !category || !targetMilestoneRole) {
      return Response.json({ ok: false, error: "code, name, category, targetMilestoneRole 필수" }, { status: 400 });
    }
    let formulaJson = "{}";
    try { formulaJson = JSON.stringify(typeof bonusFormula === "object" ? bonusFormula : JSON.parse(bonusFormula || "{}")); }
    catch { return Response.json({ ok: false, error: "bonusFormula가 유효한 JSON이 아닙니다" }, { status: 400 }); }

    try {
      const rows = await db.execute(sql`
        INSERT INTO milestone_definitions (
          code, name, category, target_milestone_role,
          business_unit, revenue_source,
          threshold_enabled, threshold_value, threshold_unit,
          bonus_formula, quarter_applicable,
          is_shared_threshold, shared_threshold_group,
          is_active, effective_from, effective_to, sort_order
        ) VALUES (
          ${code}, ${name}, ${category}, ${targetMilestoneRole},
          ${businessUnit || null}, ${revenueSource || null},
          ${thresholdEnabled ?? false}, ${thresholdValue ?? null}, ${thresholdUnit || null},
          ${formulaJson}::jsonb, ${quarterApplicable || null},
          ${isSharedThreshold ?? false}, ${sharedThresholdGroup || null},
          true, ${effectiveFrom || null}, ${effectiveTo || null}, ${sortOrder ?? 0}
        ) RETURNING id
      `);
      const id = ((rows as any).rows ?? rows)[0]?.id;
      return Response.json({ ok: true, id });
    } catch (err) { return jsonErr("insert", err); }
  }

  /* ── PUT: 수정 ── */
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch {
      return Response.json({ ok: false, error: "요청 본문 파싱 실패" }, { status: 400 });
    }
    const { id } = body;
    if (!id) return Response.json({ ok: false, error: "id 필수" }, { status: 400 });

    let formulaJson = "{}";
    try { formulaJson = JSON.stringify(typeof body.bonusFormula === "object" ? body.bonusFormula : JSON.parse(body.bonusFormula || "{}")); }
    catch { return Response.json({ ok: false, error: "bonusFormula가 유효한 JSON이 아닙니다" }, { status: 400 }); }

    try {
      await db.execute(sql`
        UPDATE milestone_definitions SET
          name                  = ${body.name},
          category              = ${body.category},
          target_milestone_role = ${body.targetMilestoneRole},
          business_unit         = ${body.businessUnit || null},
          revenue_source        = ${body.revenueSource || null},
          threshold_enabled     = ${body.thresholdEnabled ?? false},
          threshold_value       = ${body.thresholdValue ?? null},
          threshold_unit        = ${body.thresholdUnit || null},
          bonus_formula         = ${formulaJson}::jsonb,
          quarter_applicable    = ${body.quarterApplicable || null},
          is_shared_threshold   = ${body.isSharedThreshold ?? false},
          shared_threshold_group= ${body.sharedThresholdGroup || null},
          is_active             = ${body.isActive ?? true},
          effective_from        = ${body.effectiveFrom || null},
          effective_to          = ${body.effectiveTo || null},
          sort_order            = ${body.sortOrder ?? 0},
          updated_at            = now()
        WHERE id = ${id}
      `);

      // 모든 어드민에게 마일스톤 정의 변경 알림 (fire-and-forget)
      try {
        const adminRows = await db.execute(sql`
          SELECT id FROM members WHERE type = 'admin' AND status = 'active'
        `);
        const adminIds = ((adminRows as any).rows || (adminRows as any[])).map((r: any) => r.id);
        notifyMany(adminIds, {
          recipientType: "admin",
          category: "milestone", severity: "info",
          title: `마일스톤 정의 변경: ${body.name || ""}`,
          message: "성과 마일스톤 정의가 수정되었습니다. 확인해주세요.",
          link: "/admin#milestone-settings",
        }).catch(() => {});
      } catch { /* 알림 실패는 본 응답에 영향 없음 */ }

      return Response.json({ ok: true });
    } catch (err) { return jsonErr("update", err); }
  }

  /* ── DELETE: 삭제 ── */
  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return Response.json({ ok: false, error: "id 필수" }, { status: 400 });
    try {
      await db.execute(sql`DELETE FROM milestone_definitions WHERE id = ${Number(id)}`);
      return Response.json({ ok: true });
    } catch (err) { return jsonErr("delete", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}
