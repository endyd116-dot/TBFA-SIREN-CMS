/**
 * GET/POST/PUT/DELETE /api/admin-milestone-definitions
 * 마일스톤 정의 CRUD — super_admin 전용
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
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
  if (guardFailed(auth)) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용 기능입니다" }, { status: 403 });
  }

  /* ── GET: 전체 목록 또는 ?id=X&history=1 이력 조회 ── */
  if (req.method === "GET") {
    const url = new URL(req.url);
    const histId = url.searchParams.get("id");
    const history = url.searchParams.get("history");

    /* ★ R29-MS-GAP1-E: 변경 이력 조회 */
    if (histId && history === "1") {
      try {
        const rows = await db.execute(sql`
          SELECT h.*, m.name as changed_by_name
          FROM milestone_definition_history h
          LEFT JOIN members m ON m.id = h.changed_by
          WHERE h.definition_id = ${Number(histId)}
          ORDER BY h.changed_at DESC
          LIMIT 200
        `);
        return Response.json({ ok: true, data: { history: (rows as any).rows ?? rows } });
      } catch (err) { return jsonErr("history", err); }
    }

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
      /* ★ R29-GAP-P2-M2: 두 정의 API 응답 표준 통일 — { data: { milestones: [...] } }
         ★ R34-P1-B-12: snake_case 원본 유지 + camelCase 보조 키 동시 노출 (클라이언트 양쪽 호환) */
      const milestones = ((rows as any).rows ?? rows).map(addCamelKeys);
      return Response.json({ ok: true, data: { milestones } });
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
        ) RETURNING *
      `);
      const row = ((rows as any).rows ?? rows)[0];
      /* ★ R29-GAP-P2-M2: 단건 응답도 { data: { milestone: {...} } }로 통일 (id 키 호환 병행 유지)
         ★ R34-P1-B-12: camelCase 보조 키 추가 */
      return Response.json({ ok: true, id: row?.id, data: { milestone: addCamelKeys(row) } });
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
      /* ★ R29-MS-GAP1-E: 변경 이력 추적 — UPDATE 전 기존 값 조회 */
      const oldRows = await db.execute(sql`
        SELECT name, category, target_milestone_role, business_unit, revenue_source,
               threshold_enabled, threshold_value, threshold_unit,
               bonus_formula, quarter_applicable,
               is_shared_threshold, shared_threshold_group,
               is_active, effective_from, effective_to, sort_order
        FROM milestone_definitions WHERE id = ${id}
      `);
      const oldDef = ((oldRows as any).rows?.[0] || (oldRows as any[])[0]) as any;

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

      /* ★ R29-MS-GAP1-E: 필드별 변경 이력 INSERT */
      if (oldDef) {
        const fieldMap: Array<[string, any, any]> = [
          ["name", oldDef.name, body.name],
          ["category", oldDef.category, body.category],
          ["target_milestone_role", oldDef.target_milestone_role, body.targetMilestoneRole],
          ["business_unit", oldDef.business_unit, body.businessUnit || null],
          ["revenue_source", oldDef.revenue_source, body.revenueSource || null],
          ["threshold_enabled", oldDef.threshold_enabled, body.thresholdEnabled ?? false],
          ["threshold_value", oldDef.threshold_value, body.thresholdValue ?? null],
          ["threshold_unit", oldDef.threshold_unit, body.thresholdUnit || null],
          ["bonus_formula", JSON.stringify(oldDef.bonus_formula), formulaJson],
          ["quarter_applicable", oldDef.quarter_applicable, body.quarterApplicable || null],
          ["is_shared_threshold", oldDef.is_shared_threshold, body.isSharedThreshold ?? false],
          ["shared_threshold_group", oldDef.shared_threshold_group, body.sharedThresholdGroup || null],
          ["is_active", oldDef.is_active, body.isActive ?? true],
          ["effective_from", oldDef.effective_from, body.effectiveFrom || null],
          ["effective_to", oldDef.effective_to, body.effectiveTo || null],
          ["sort_order", oldDef.sort_order, body.sortOrder ?? 0],
        ];
        for (const [field, oldV, newV] of fieldMap) {
          const oldStr = oldV == null ? null : String(oldV);
          const newStr = newV == null ? null : String(newV);
          if (oldStr === newStr) continue;
          try {
            await db.execute(sql`
              INSERT INTO milestone_definition_history
                (definition_id, changed_by, field_name, old_value, new_value)
              VALUES (${id}, ${auth.ctx.member.id}, ${field}, ${oldStr}, ${newStr})
            `);
          } catch { /* 이력 기록 실패는 본 응답에 영향 없음 */ }
        }
      }

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

/* ★ R34-P1-B-12: snake_case 원본 + camelCase 보조 키 동시 노출 (양쪽 클라이언트 호환) */
function addCamelKeys(r: any) {
  if (!r) return r;
  return {
    ...r,
    targetMilestoneRole: r.target_milestone_role,
    businessUnit: r.business_unit,
    revenueSource: r.revenue_source,
    thresholdEnabled: r.threshold_enabled,
    thresholdValue: r.threshold_value,
    thresholdUnit: r.threshold_unit,
    bonusFormula: r.bonus_formula,
    quarterApplicable: r.quarter_applicable,
    isSharedThreshold: r.is_shared_threshold,
    sharedThresholdGroup: r.shared_threshold_group,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
