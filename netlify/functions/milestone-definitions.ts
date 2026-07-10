import type { Context } from "@netlify/functions";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import { milestoneDefinitions } from "../../db/schema";
import { notifyMany } from "../../lib/notify";

export const config = { path: "/api/milestone-definitions*" };

export default async function handler(req: Request, _ctx: Context) {
  // P1-24 fix: 매출 입력·WBS 카드 생성 폼의 마일스톤 목록. 형제 API처럼 운영자 허용(GET은 본인 role로 강제 필터).
  //            쓰기(POST·PATCH·DELETE)는 아래에서 isSuperAdmin 재검사하므로 안전.
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
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

      /* 통합 라운드(2026-05-20): admin-milestone-definitions PUT의 "모든 어드민 알림"을
         통일 기준 API로 이식. 설정 화면 흡수 후에도 정의 변경 알림이 끊기지 않게 함.
         fire-and-forget — 알림 실패는 본 응답에 영향 없음. */
      try {
        const adminRows = await db.execute(sql`
          SELECT id FROM members WHERE type = 'admin' AND status = 'active'
        `);
        const adminIds = ((adminRows as any).rows || (adminRows as any[])).map((r: any) => r.id);
        notifyMany(adminIds, {
          recipientType: "admin",
          category: "milestone", severity: "info",
          title: `마일스톤 정의 변경: ${updated.name || ""}`,
          message: "성과 마일스톤 정의가 수정되었습니다. 확인해주세요.",
          link: "/cms-tbfa.html#milestone-review",
        }).catch(() => {});
      } catch { /* 알림 실패는 본 응답에 영향 없음 */ }

      return Response.json({ ok: true, data: { milestone: formatDef(updated) } });
    } catch (err) { return jsonError("update", err); }
  }

  // ── DELETE /:id — ?hard=1 영구삭제(이력 없을 때만) / 기본 비활성화(소프트삭제) ──
  if (req.method === "DELETE") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    /* ★ R32-P0-FIX-1: ?id= query fallback */
    const id = url.searchParams.get("id") || url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    const hard = url.searchParams.get("hard") === "1";
    try {
      if (hard) {
        /* 영구삭제: 매출/비매출 실적 참조가 있으면 과거 결산 보존을 위해 차단(비활성화만 가능).
           결산 스냅샷은 JSONB라 FK 무관·정의 삭제해도 과거 결산은 무손상. */
        const refRows = await db.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM revenue_entries WHERE milestone_definition_id = ${Number(id)})::int AS rev,
            (SELECT COUNT(*) FROM non_revenue_achievements WHERE milestone_definition_id = ${Number(id)})::int AS nonrev
        `);
        const ref: any = (refRows as any).rows?.[0] || (refRows as any[])[0] || {};
        const used = (Number(ref.rev) || 0) + (Number(ref.nonrev) || 0);
        if (used > 0) {
          return Response.json({
            ok: false,
            error: `실적·매출 이력(${used}건)이 있어 영구삭제할 수 없습니다. 비활성화만 가능합니다.`,
            refs: { revenue: Number(ref.rev) || 0, nonRevenue: Number(ref.nonrev) || 0 },
          }, { status: 409 });
        }
        await db.execute(sql`DELETE FROM milestone_definition_history WHERE definition_id = ${Number(id)}`);
        await db.execute(sql`DELETE FROM milestone_definitions WHERE id = ${Number(id)}`);
        return Response.json({ ok: true, hard: true });
      }
      await db.execute(sql`UPDATE milestone_definitions SET is_active = FALSE, updated_at = NOW() WHERE id = ${Number(id)}`);
      return Response.json({ ok: true });
    } catch (err) { return jsonError(hard ? "hard_delete" : "deactivate", err); }
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
    nonRevenueCategory: r.non_revenue_category ?? null,
  };
}
