import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config = { path: "/api/milestone-nonrevenue*" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
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
      /* R29-GAP-P2-C BUG fix: sql.raw(q, params) 파라미터 미바인딩 → sql 템플릿 합성 */
      let baseSql = sql`
        SELECT nra.*, md.code, md.name as milestone_name, md.quarter_applicable,
               md.bonus_formula, md.target_milestone_role, md.non_revenue_category
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.submitted_by = ${admin.id}
      `;
      if (quarterId) baseSql = sql`${baseSql} AND nra.quarter_id = ${Number(quarterId)}`;
      baseSql = sql`${baseSql} ORDER BY nra.created_at DESC`;
      const rows = await db.execute(baseSql);
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
      /* R29-MS-GAP2-H: 결산 SUBMITTED/APPROVED/PAID 후 비매출 제출 차단 */
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

      /* R34-P1-B-6: quarterApplicable 검증 — sm-q1-*는 Q1, sm-q2-*는 Q2, 'ALL'·null은 분기 무관 */
      if (md.quarter_applicable && md.quarter_applicable !== "ALL") {
        const qInfo = await db.execute(sql`SELECT quarter FROM quarters WHERE id = ${Number(quarterId)}`);
        const qRow = (qInfo as any).rows?.[0] || (qInfo as any[])[0];
        if (qRow && `Q${qRow.quarter}` !== md.quarter_applicable) {
          return Response.json({
            ok: false,
            error: `이 마일스톤은 ${md.quarter_applicable} 전용입니다 (현재 분기 Q${qRow.quarter})`,
          }, { status: 400 });
        }
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
        link: "/cms-tbfa.html#milestone-review",
      }).catch(() => {});

      return Response.json({ ok: true, data: { achievement: formatAch(achievement) } }, { status: 201 });
    } catch (err) { return jsonError("insert", err); }
  }

  // ── POST /select — 분기 선택 (v4: 카테고리당 2개·분기 7개) ──
  if (req.method === "POST" && action === "select") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { quarterId, selectedIds } = body;
    if (!quarterId || !Array.isArray(selectedIds)) {
      return Response.json({ ok: false, error: "quarterId, selectedIds[] 필수" }, { status: 400 });
    }
    if (selectedIds.length > 7) {
      return Response.json({ ok: false, error: "분기당 비매출 보너스는 최대 7개까지만 선택 가능합니다" }, { status: 400 });
    }
    try {
      /* R32-P0-MS-C1 + R34-P1-B-8: sql 템플릿 + 단일 UPDATE로 원자화 (race 차단) */
      const ids = selectedIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
      if (ids.length > 0) {
        // VERIFIED + 본인 소유 사전 검증
        const checkRows = await db.execute(sql`
          SELECT id, status FROM non_revenue_achievements
          WHERE id = ANY(${ids}::int[]) AND submitted_by = ${admin.id}
        `);
        const items = (checkRows as any).rows || (checkRows as any[]);
        const notVerified = items.filter((i: any) => i.status !== "VERIFIED");
        if (notVerified.length > 0 || items.length !== ids.length) {
          return Response.json({ ok: false, error: "검증(VERIFIED) 완료된 본인 항목만 선택 가능합니다" }, { status: 400 });
        }
        /* v4 2단계: 카테고리당 최대 2개 (분기 7개는 위 길이 검증) */
        const catRows = await db.execute(sql`
          SELECT md.non_revenue_category AS cat, COUNT(*)::int AS cnt
          FROM non_revenue_achievements nra
          JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
          WHERE nra.id = ANY(${ids}::int[])
          GROUP BY md.non_revenue_category
          HAVING COUNT(*) > 2
        `);
        if (((catRows as any).rows || (catRows as any[])).length > 0) {
          return Response.json({ ok: false, error: "한 카테고리에서 최대 2개까지만 선택할 수 있습니다 (카테고리당 2개·분기 7개)" }, { status: 400 });
        }
      }

      // 단일 SQL 일괄 갱신 — 선택 ids는 입력 순서대로 selection_order(1..N), 나머지 false/NULL
      await db.execute(sql`
        UPDATE non_revenue_achievements
        SET is_selected_for_quarter = (id = ANY(${ids}::int[])),
            selection_order = CASE WHEN id = ANY(${ids}::int[]) THEN array_position(${ids}::int[], id) ELSE NULL END,
            updated_at = NOW()
        WHERE submitted_by = ${admin.id} AND quarter_id = ${Number(quarterId)}
      `);
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
    nonRevenueCategory: r.non_revenue_category ?? null,
  };
}
