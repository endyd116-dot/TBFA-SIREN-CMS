import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config = { path: "/api/milestone-nonrevenue" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const admin = auth.ctx?.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "비매출 성과 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const action = pathParts[pathParts.length - 1];

  // ── GET 목록 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    try {
      let q = `
        SELECT nra.*, md.code, md.name as milestone_name, md.quarter_applicable,
               md.bonus_formula, md.target_milestone_role
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.submitted_by = $1
      `;
      const params: any[] = [admin.id];
      if (quarterId) { params.push(Number(quarterId)); q += ` AND nra.quarter_id = $${params.length}`; }
      q += ` ORDER BY nra.created_at DESC`;
      const rows = await db.execute(sql.raw(q, params));
      const achievements = ((rows as any).rows || (rows as any[])).map(formatAch);
      return Response.json({ ok: true, data: { achievements } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST 제출 ──
  if (req.method === "POST" && action === "milestone-nonrevenue") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { milestoneDefinitionId, quarterId, achievedDate, description, evidenceFiles } = body;
    if (!milestoneDefinitionId || !quarterId || !achievedDate) {
      return Response.json({ ok: false, error: "필수 필드 누락" }, { status: 400 });
    }
    try {
      /* ★ R29-MS-GAP2-H: 결산 SUBMITTED/APPROVED/PAID 후 비매출 제출 차단 */
      const settleRows = await db.execute(sql`
        SELECT status FROM quarterly_settlements
        WHERE quarter_id = ${Number(quarterId)} AND member_id = ${admin.id}
      `);
      const settleStatus = ((settleRows as any).rows?.[0] || (settleRows as any[])[0])?.status;
      if (settleStatus && ["SUBMITTED", "APPROVED", "PAID"].includes(settleStatus)) {
        return Response.json({
          ok: false,
          error: "결산이 제출된 분기에는 실적을 추가할 수 없습니다.",
        }, { status: 409 });
      }

      // 마일스톤 소유권 확인
      const mdRows = await db.execute(sql`
        SELECT * FROM milestone_definitions
        WHERE id = ${Number(milestoneDefinitionId)} AND is_active = TRUE AND category = 'NON_REVENUE'
      `);
      const md = (mdRows as any).rows?.[0] || mdRows[0];
      if (!md) return Response.json({ ok: false, error: "존재하지 않는 비매출 마일스톤" }, { status: 404 });
      if (md.target_milestone_role !== admin.milestoneRole && admin.role !== "super_admin") {
        return Response.json({ ok: false, error: "본인 담당 마일스톤만 제출 가능" }, { status: 403 });
      }
      // bonusFormula에서 기본 보너스 금액 추출
      const formula = md.bonus_formula as any;
      const bonusAmount = formula?.type === "FLAT" ? String(formula.unitAmount || 0) : "0";

      const insertRows = await db.execute(sql`
        INSERT INTO non_revenue_achievements
          (milestone_definition_id, quarter_id, submitted_by, achieved_date,
           description, evidence_files, bonus_amount, status)
        VALUES (
          ${Number(milestoneDefinitionId)}, ${Number(quarterId)}, ${admin.id}, ${achievedDate},
          ${description ?? null}, ${JSON.stringify(evidenceFiles || [])}, ${bonusAmount}, 'PENDING'
        )
        RETURNING *
      `);
      const achievement = (insertRows as any).rows?.[0] || insertRows[0];

      // 슈퍼어드민 전체에게 검증 요청 알림 (fire-and-forget)
      notifyAllSuperAdmins({
        category: "milestone", severity: "info",
        title: `비매출 성과 검증 요청: ${md.name}`,
        message: `${admin.name || admin.email}의 성과 검증을 해주세요`,
        link: "/admin#nonrevenue-verify",
      }).catch(() => {});

      return Response.json({ ok: true, data: { achievement: formatAch(achievement) } }, { status: 201 });
    } catch (err) { return jsonError("insert", err); }
  }

  // ── POST /select — 분기 2개 선택 ──
  if (req.method === "POST" && action === "select") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { quarterId, selectedIds } = body;
    if (!quarterId || !Array.isArray(selectedIds)) {
      return Response.json({ ok: false, error: "quarterId, selectedIds[] 필수" }, { status: 400 });
    }
    if (selectedIds.length > 2) {
      return Response.json({ ok: false, error: "분기당 비매출 보너스는 최대 2개까지만 선택 가능합니다" }, { status: 400 });
    }
    try {
      // 선택 전 VERIFIED 확인
      if (selectedIds.length > 0) {
        const checkRows = await db.execute(sql.raw(
          `SELECT id, status FROM non_revenue_achievements WHERE id = ANY($1::int[]) AND submitted_by = $2`,
          [selectedIds, admin.id]
        ));
        const items = (checkRows as any).rows || (checkRows as any[]);
        const notVerified = items.filter((i: any) => i.status !== "VERIFIED");
        if (notVerified.length > 0) {
          return Response.json({ ok: false, error: "검증(VERIFIED) 완료된 항목만 선택 가능합니다" }, { status: 400 });
        }
      }
      // 기존 선택 초기화
      await db.execute(sql`
        UPDATE non_revenue_achievements SET is_selected_for_quarter = FALSE, selection_order = NULL
        WHERE submitted_by = ${admin.id} AND quarter_id = ${Number(quarterId)}
      `);
      // 새로 선택
      for (let i = 0; i < selectedIds.length; i++) {
        await db.execute(sql`
          UPDATE non_revenue_achievements
          SET is_selected_for_quarter = TRUE, selection_order = ${i + 1}
          WHERE id = ${Number(selectedIds[i])} AND submitted_by = ${admin.id}
        `);
      }
      return Response.json({ ok: true });
    } catch (err) { return jsonError("select", err); }
  }

  // ── PATCH /:id 수정 ──
  if (req.method === "PATCH") {
    const id = pathParts[pathParts.length - 1];
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    try {
      const rows = await db.execute(sql`SELECT submitted_by, status FROM non_revenue_achievements WHERE id = ${Number(id)}`);
      const ach = (rows as any).rows?.[0] || rows[0];
      if (!ach) return Response.json({ ok: false, error: "항목 없음" }, { status: 404 });
      if (ach.submitted_by !== admin.id) return Response.json({ ok: false, error: "본인 항목만 수정 가능" }, { status: 403 });
      if (ach.status === "VERIFIED") return Response.json({ ok: false, error: "검증 완료 항목은 수정 불가" }, { status: 400 });
      const { achievedDate, description, evidenceFiles } = body;
      await db.execute(sql`
        UPDATE non_revenue_achievements SET
          achieved_date = COALESCE(${achievedDate ?? null}, achieved_date),
          description = COALESCE(${description ?? null}, description),
          evidence_files = COALESCE(${evidenceFiles ? JSON.stringify(evidenceFiles) : null}::jsonb, evidence_files),
          updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("update", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}

function formatAch(r: any) {
  return {
    id: r.id, milestoneDefinitionId: r.milestone_definition_id,
    milestoneCode: r.code, milestoneName: r.milestone_name,
    quarterApplicable: r.quarter_applicable,
    quarterId: r.quarter_id, submittedBy: r.submitted_by,
    achievedDate: r.achieved_date, description: r.description,
    evidenceFiles: r.evidence_files || [],
    bonusAmount: r.event_range_amount ? String(r.event_range_amount) : String(r.bonus_amount || 0),
    eventRangeAmount: r.event_range_amount,
    isSelectedForQuarter: r.is_selected_for_quarter,
    selectionOrder: r.selection_order, status: r.status,
    reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, rejectReason: r.reject_reason,
    createdAt: r.created_at,
  };
}
