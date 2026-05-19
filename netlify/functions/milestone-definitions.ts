import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import { milestoneDefinitions } from "../../db/schema";

export const config = { path: "/api/milestone-definitions*" };

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
      /* ★ R29-GAP-P2-C BUG fix: sql.raw(q, params) 파라미터 미바인딩 → sql 템플릿 합성 */
      let baseSql = sql`SELECT * FROM milestone_definitions WHERE 1=1`;
      /* ★ R29-MS-GAP1-A: 운영자(super_admin 외)는 본인 milestoneRole 기준으로 강제 필터.
         role 파라미터를 본인 외 값으로 보내도 본인 것만 반환. */
      if (!isSuperAdmin) {
        if (!admin?.milestoneRole) {
          return Response.json({ ok: true, data: { milestones: [] } });
        }
        baseSql = sql`${baseSql} AND target_milestone_role = ${admin.milestoneRole}`;
      } else if (role) {
        baseSql = sql`${baseSql} AND target_milestone_role = ${role}`;
      }
      if (cat) baseSql = sql`${baseSql} AND category = ${cat}`;
      if (url.searchParams.get("activeOnly") !== "0") baseSql = sql`${baseSql} AND is_active = TRUE`;
      baseSql = sql`${baseSql} ORDER BY sort_order, id`;
      const rows = await db.execute(baseSql);
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
      /* ★ R32-P0-MS-C3 BUG fix: sql.raw(q, params) 파라미터 미바인딩 → drizzle update().set() ORM
         ★ R34-P2-B-2: null·typeof 검증 추가 (NOT NULL constraint 위반 + jsonb 파싱 오류 사전 차단)
         ★ R34-P2-B-3: history INSERT 추가 (admin-milestone-definitions와 변경 이력 일관성 확보) */
      const allowed = ["name","thresholdEnabled","thresholdValue","thresholdUnit","bonusFormula",
                       "quarterApplicable","isActive","effectiveFrom","effectiveTo","sortOrder","businessUnit","revenueSource"];
      const patch: Record<string, any> = {};

      // R34-P2-B-2: name이 들어오면 빈 문자열·null 차단 (NOT NULL 필드)
      if ("name" in body) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          return Response.json({ ok: false, error: "name은 빈 문자열·null 불가" }, { status: 400 });
        }
        patch.name = body.name.trim();
      }
      // bonusFormula는 객체/JSON 문자열 모두 허용
      if ("bonusFormula" in body) {
        try {
          patch.bonusFormula = typeof body.bonusFormula === "object" && body.bonusFormula !== null
            ? body.bonusFormula
            : JSON.parse(String(body.bonusFormula || "{}"));
        } catch {
          return Response.json({ ok: false, error: "bonusFormula JSON 형식 오류" }, { status: 400 });
        }
      }
      // boolean 검증
      for (const k of ["thresholdEnabled", "isActive"]) {
        if (k in body) {
          if (typeof body[k] !== "boolean") {
            return Response.json({ ok: false, error: `${k}는 boolean이어야 합니다` }, { status: 400 });
          }
          patch[k] = body[k];
        }
      }
      // 그 외 allowed 키 — null/undefined/string/number 모두 허용 (DB가 nullable)
      for (const key of allowed) {
        if (key === "name" || key === "bonusFormula" || key === "thresholdEnabled" || key === "isActive") continue;
        if (key in body) patch[key] = body[key];
      }
      if (!Object.keys(patch).length) return Response.json({ ok: false, error: "변경 필드 없음" }, { status: 400 });

      // R34-P2-B-3: UPDATE 전 기존 값 조회 (history 비교용)
      const oldRows = await db.execute(sql`SELECT * FROM milestone_definitions WHERE id = ${Number(id)}`);
      const oldDef = (oldRows as any).rows?.[0] || (oldRows as any[])[0];
      if (!oldDef) return Response.json({ ok: false, error: "해당 마일스톤 없음" }, { status: 404 });

      patch.updatedAt = new Date();
      const updatedRows = await db.update(milestoneDefinitions)
        .set(patch)
        .where(eq(milestoneDefinitions.id, Number(id)))
        .returning({ id: milestoneDefinitions.id });
      if (!updatedRows?.length) return Response.json({ ok: false, error: "해당 마일스톤 없음" }, { status: 404 });

      // formatDef는 snake_case 접근이라 raw SELECT 재조회
      const rawRows = await db.execute(sql`SELECT * FROM milestone_definitions WHERE id = ${Number(id)}`);
      const updated = (rawRows as any).rows?.[0] || (rawRows as any[])[0];

      /* R34-P2-B-3: 변경 필드별 milestone_definition_history INSERT (admin-milestone-definitions와 동일 패턴) */
      const fieldMap: Array<[string, any, any]> = [
        ["name", oldDef.name, updated.name],
        ["threshold_enabled", oldDef.threshold_enabled, updated.threshold_enabled],
        ["threshold_value", oldDef.threshold_value, updated.threshold_value],
        ["threshold_unit", oldDef.threshold_unit, updated.threshold_unit],
        ["bonus_formula", JSON.stringify(oldDef.bonus_formula), JSON.stringify(updated.bonus_formula)],
        ["quarter_applicable", oldDef.quarter_applicable, updated.quarter_applicable],
        ["is_active", oldDef.is_active, updated.is_active],
        ["effective_from", oldDef.effective_from, updated.effective_from],
        ["effective_to", oldDef.effective_to, updated.effective_to],
        ["sort_order", oldDef.sort_order, updated.sort_order],
        ["business_unit", oldDef.business_unit, updated.business_unit],
        ["revenue_source", oldDef.revenue_source, updated.revenue_source],
      ];
      for (const [field, oldV, newV] of fieldMap) {
        const oldStr = oldV == null ? null : String(oldV);
        const newStr = newV == null ? null : String(newV);
        if (oldStr === newStr) continue;
        try {
          await db.execute(sql`
            INSERT INTO milestone_definition_history
              (definition_id, changed_by, field_name, old_value, new_value)
            VALUES (${Number(id)}, ${admin.id}, ${field}, ${oldStr}, ${newStr})
          `);
        } catch { /* 이력 INSERT 실패는 본 응답에 영향 없음 */ }
      }

      return Response.json({ ok: true, data: { milestone: formatDef(updated) } });
    } catch (err) { return jsonError("update", err); }
  }

  // ── DELETE /:id (비활성화) ──
  if (req.method === "DELETE") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    /* ★ R32-P0-FIX-1: ?id= query fallback */
    const id = url.searchParams.get("id") || url.pathname.split("/").pop();
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
