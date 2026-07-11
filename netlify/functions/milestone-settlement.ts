import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config = { path: "/api/milestone-settlement*" };

/* R35-GAP-P2-M5: 사용자 입력 오류(400)와 시스템 오류(500) 구분용 */
class SettlementBadRequest extends Error {
  constructor(message: string) { super(message); this.name = "SettlementBadRequest"; }
}

/* 비매출 분기 선택 한도 — 역할 캡은 DB(milestone_roles.revenue_cap·non_revenue_cap) 에서 동적 로드 */
/* 비매출 분기 선택 한도(v4): 분기 전체 최대 7개 (카테고리당 2개는 선택 시점 milestone-nonrevenue에서 enforce) */
const NON_REVENUE_MAX_PER_QUARTER = 7;

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "결산 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  // ── GET 내 결산 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    /* R29-GAP-P2-M3: memberId 파라미터 수용 (본인 결산 강제 — 다른 id는 무시) */
    const memberIdQ = url.searchParams.get("memberId");
    try {
      /* R29-GAP-P2-C BUG fix: sql.raw(q, params)는 drizzle에서 파라미터 바인딩 미지원 →
         sql 템플릿 합성으로 변경 (member_id·quarterId 안전 바인딩) */
      let baseSql = sql`
        SELECT qs.*, q.year, q.quarter, q.status as quarter_status
        FROM quarterly_settlements qs
        JOIN quarters q ON q.id = qs.quarter_id
        WHERE qs.member_id = ${admin.id}
      `;
      if (quarterId) baseSql = sql`${baseSql} AND qs.quarter_id = ${Number(quarterId)}`;
      baseSql = sql`${baseSql} ORDER BY q.year DESC, q.quarter DESC LIMIT 10`;
      const rows = await db.execute(baseSql);
      const settlements = ((rows as any).rows || (rows as any[])).map(formatSettle);
      /* R29-GAP-P2-M3: quarterId·memberId 둘 다 지정 시 단건 settlement 키 추가 */
      let settlement: any = null;
      const memberIdMatch = !memberIdQ || Number(memberIdQ) === Number(admin.id);
      if (quarterId && memberIdMatch) {
        settlement = settlements.find((s: any) =>
          Number(s.quarterId) === Number(quarterId)
        ) || null;
      }
      return Response.json({ ok: true, data: { settlements, settlement } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST /calculate — 자동 계산 ──
  if (req.method === "POST" && action === "calculate") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { quarterId } = body;
    if (!quarterId) return Response.json({ ok: false, error: "quarterId 필수" }, { status: 400 });
    try {
      const result = await calcSettlement(admin.id, Number(quarterId));
      return Response.json({ ok: true, data: result });
    } catch (err) {
      /* R35-GAP-P2-M5: 사용자 입력 오류는 400 분기 */
      if (err instanceof SettlementBadRequest) {
        return Response.json({ ok: false, error: err.message }, { status: 400 });
      }
      return jsonError("calculate", err);
    }
  }

  // ── POST /submit — 결산 제출 ──
  if (req.method === "POST" && action === "submit") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { quarterId, selfEvaluation } = body;
    if (!quarterId) return Response.json({ ok: false, error: "quarterId 필수" }, { status: 400 });
    try {
      const calc = await calcSettlement(admin.id, Number(quarterId));

      /* OP-026: 캡 정보 로드 실패 시 제출 차단(과지급 방지) — 일시 오류면 재시도 안내 */
      if ((calc as any).capLoadError) {
        return Response.json(
          { ok: false, error: "역할별 인센티브 상한 정보를 불러오지 못했습니다. 잠시 후 다시 제출해 주세요.", step: "cap_load" },
          { status: 503 }
        );
      }

      // UPSERT quarterly_settlements
      const existing = await db.execute(sql`
        SELECT id, status FROM quarterly_settlements
        WHERE member_id = ${admin.id} AND quarter_id = ${Number(quarterId)}
      `);
      const ex = (existing as any).rows?.[0] || existing[0];

      /* R34-P1-B-7: HOLD(자료 보완 요청) 상태에서도 재제출 허용 */
      if (ex && !["DRAFT", "REJECTED", "HOLD"].includes(ex.status)) {
        return Response.json({ ok: false, error: `현재 상태(${ex.status})에서는 재제출 불가입니다` }, { status: 400 });
      }

      /* R34-P1-B-8: UPSERT 원자화 — ON CONFLICT로 race 차단 (더블 클릭·동시 호출 시 UNIQUE 위반 500 방지) */
      const snapshot = JSON.stringify(calc);
      await db.execute(sql`
        INSERT INTO quarterly_settlements
          (quarter_id, member_id, revenue_linked_total, non_revenue_total, total_bonus,
           calculation_snapshot, self_evaluation, status, submitted_at, hold_reason)
        VALUES (
          ${Number(quarterId)}, ${admin.id},
          ${String(calc.revenueLinkedTotal)}, ${String(calc.nonRevenueTotal)}, ${String(calc.totalBonus)},
          ${snapshot}::jsonb, ${selfEvaluation ?? null}, 'SUBMITTED', NOW(), NULL
        )
        ON CONFLICT (quarter_id, member_id) DO UPDATE SET
          revenue_linked_total = EXCLUDED.revenue_linked_total,
          non_revenue_total    = EXCLUDED.non_revenue_total,
          total_bonus          = EXCLUDED.total_bonus,
          calculation_snapshot = EXCLUDED.calculation_snapshot,
          self_evaluation      = EXCLUDED.self_evaluation,
          status               = 'SUBMITTED',
          submitted_at         = NOW(),
          hold_reason          = NULL,
          updated_at           = NOW()
      `);
      // 슈퍼어드민 전체에게 결산 제출 알림 (fire-and-forget)
      notifyAllSuperAdmins({
        category: "milestone", severity: "info",
        title: `분기 결산 제출: ${admin.name || admin.email}`,
        message: `총 변동급 ${calc.totalBonus.toLocaleString()}원 결산이 제출되었습니다.`,
        link: "/cms-tbfa.html#milestone-review",
      }).catch(() => {});

      return Response.json({ ok: true, data: calc });
    } catch (err) {
      /* R35-GAP-P2-M5: 사용자 입력 오류는 400 분기 */
      if (err instanceof SettlementBadRequest) {
        return Response.json({ ok: false, error: err.message }, { status: 400 });
      }
      return jsonError("submit", err);
    }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드 또는 경로" }, { status: 405 });
}

async function calcSettlement(memberId: number, quarterId: number) {
  // 멤버 milestoneRole 조회
  const mRows = await db.execute(sql`SELECT milestone_role FROM members WHERE id = ${memberId}`);
  const milestoneRole = ((mRows as any).rows?.[0] || mRows[0])?.milestone_role;

  /* R29-MS-GAP1-F: 분기 시작일·종료일 기준 정의 격리.
     분기 중간에 정의가 변경되어도 해당 분기 결산에는 기존 공식 적용.
     - effectiveFrom <= 분기시작일 AND (effectiveTo IS NULL OR effectiveTo >= 분기시작일)
     - effectiveFrom/To 모두 NULL인 정의는 "항상 유효"로 처리 */
  const qRows = await db.execute(sql`SELECT start_date, end_date FROM quarters WHERE id = ${quarterId}`);
  const qRow = ((qRows as any).rows?.[0] || (qRows as any[])[0]) as any;
  const quarterStart = qRow?.start_date;

  // 담당 마일스톤 조회 (분기 시작 시점 유효한 정의만)
  const mdRows = await db.execute(sql`
    SELECT * FROM milestone_definitions
    WHERE target_milestone_role = ${milestoneRole}
      AND is_active = TRUE
      AND (effective_from IS NULL OR effective_from <= ${quarterStart})
      AND (effective_to IS NULL OR effective_to >= ${quarterStart})
    ORDER BY sort_order
  `);
  const milestones = (mdRows as any).rows || (mdRows as any[]);

  let revenueLinkedTotal = 0;
  const revenueBreakdown: any[] = [];

  // SI 공유 임계점 처리
  const sharedGroups: Record<string, { total: number; items: Array<{milestone:any;amount:number}> }> = {};
  for (const m of milestones.filter((m: any) => m.category === "REVENUE_LINKED" && m.is_shared_threshold)) {
    if (!sharedGroups[m.shared_threshold_group]) sharedGroups[m.shared_threshold_group] = { total: 0, items: [] };
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(amount),0) as total FROM revenue_entries
      WHERE milestone_definition_id = ${m.id} AND quarter_id = ${quarterId} AND status = 'VERIFIED'
    `);
    const amt = Number(((r as any).rows?.[0] || r[0])?.total || 0);
    sharedGroups[m.shared_threshold_group].total += amt;
    sharedGroups[m.shared_threshold_group].items.push({ milestone: m, amount: amt });
  }

  /* R35-GAP-P2-B: SI 공유 임계점 첫 항목을 milestone.id 오름차순으로 명시 정렬 (sort_order 변경 시 디버깅 혼란 차단) */
  for (const grp of Object.values(sharedGroups)) {
    grp.items.sort((a, b) => Number(a.milestone.id) - Number(b.milestone.id));
  }

  for (const m of milestones.filter((m: any) => m.category === "REVENUE_LINKED")) {
    let incentive = 0;
    let verifiedAmount = 0;

    if (m.is_shared_threshold && m.shared_threshold_group) {
      const grp = sharedGroups[m.shared_threshold_group];
      const grpItem = grp?.items.find((i: any) => i.milestone.id === m.id);
      verifiedAmount = grpItem?.amount || 0;
      if (grp?.items[0]?.milestone.id === m.id) {
        incentive = calcSISharedBonus(grp.items);
        revenueLinkedTotal += incentive;
      }
    } else {
      const r = await db.execute(sql`
        SELECT COALESCE(SUM(amount),0) as total FROM revenue_entries
        WHERE milestone_definition_id = ${m.id} AND quarter_id = ${quarterId} AND status = 'VERIFIED'
      `);
      verifiedAmount = Number(((r as any).rows?.[0] || r[0])?.total || 0);
      incentive = applyFormula(m.bonus_formula, m.threshold_enabled, Number(m.threshold_value || 0), verifiedAmount);
      revenueLinkedTotal += incentive;
    }

    revenueBreakdown.push({ code: m.code, name: m.name, verifiedAmount, incentive });
  }

  // 비매출 보너스 (선택된 2개)
  const nrRows = await db.execute(sql`
    SELECT nra.*, md.code, md.name AS milestone_name FROM non_revenue_achievements nra
    JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
    WHERE nra.submitted_by = ${memberId} AND nra.quarter_id = ${quarterId}
      AND nra.status = 'VERIFIED' AND nra.is_selected_for_quarter = TRUE
    ORDER BY nra.selection_order
  `);
  const selected = (nrRows as any).rows || (nrRows as any[]);
  /* R35-GAP-P2-M5: 사용자 입력 오류(400) 분기 — outer try/catch에서 status:400 분기 */
  if (selected.length > NON_REVENUE_MAX_PER_QUARTER) {
    throw new SettlementBadRequest(`선택된 비매출 항목이 ${NON_REVENUE_MAX_PER_QUARTER}개를 초과합니다 (마이페이지에서 다시 선택해주세요)`);
  }

  let nonRevenueTotal = 0;
  const nonRevenueBreakdown: any[] = [];
  for (const r of selected) {
    const bonus = Number(r.event_range_amount || r.bonus_amount || 0);
    nonRevenueTotal += bonus;
    nonRevenueBreakdown.push({ code: r.code, name: r.milestone_name, bonus, selectionOrder: r.selection_order });
  }

  /* v4 폴리시 P2: 캡 값을 DB에서 동적 로드 (null이면 무캡). 하드코딩 ROLE_CAPS 제거. */
  let revenueCap: number | null = null;
  let nonRevenueCap: number | null = null;
  let capLoadError = false;
  if (milestoneRole) {
    try {
      const capRows = await db.execute(sql`
        SELECT revenue_cap, non_revenue_cap
        FROM milestone_roles
        WHERE code = ${milestoneRole}
        LIMIT 1
      `);
      const capRow = ((capRows as any).rows?.[0] || (capRows as any[])[0]);
      if (capRow) {
        revenueCap = capRow.revenue_cap != null ? Number(capRow.revenue_cap) : null;
        nonRevenueCap = capRow.non_revenue_cap != null ? Number(capRow.non_revenue_cap) : null;
      }
    } catch {
      /* OP-026: 캡 로드 실패를 무캡(fail-open)으로 흘리면 상한 초과 변동급이 결산에 그대로 반영된다.
         실패를 플래그로 전파 → 제출 시점에서 fail-closed로 차단(캡 미설정 null과 일시 조회오류 구분). */
      capLoadError = true;
    }
  }

  const revenueRaw = revenueLinkedTotal;
  const nonRevenueRaw = nonRevenueTotal;
  if (revenueCap != null) revenueLinkedTotal = Math.min(revenueLinkedTotal, revenueCap);
  if (nonRevenueCap != null) nonRevenueTotal = Math.min(nonRevenueTotal, nonRevenueCap);

  return {
    memberId, quarterId, milestoneRole,
    revenueLinkedTotal, nonRevenueTotal, totalBonus: revenueLinkedTotal + nonRevenueTotal,
    revenueRaw, nonRevenueRaw,
    revenueCap, nonRevenueCap, capLoadError,
    revenueBreakdown, nonRevenueBreakdown,
  };
}

function applyFormula(formula: any, thresholdEnabled: boolean, thrVal: number, current: number): number {
  if (!formula) return 0;
  let base = current;
  if (thresholdEnabled) {
    const excess = current - thrVal;
    if (excess <= 0) return 0;
    base = excess;
  }
  switch (formula.type) {
    case "FLAT":    return Math.floor(base) * (formula.unitAmount || 0);
    case "PERCENT": return Math.round(base * (formula.rate || 0));
    case "BRACKET": {
      const brackets: Array<{min:number;max:number|null;amount:number}> = formula.brackets || [];
      const matched = brackets.sort((a, b) => b.min - a.min)
        .find(b => current >= b.min && (b.max == null || current <= b.max));
      return matched ? matched.amount : 0;
    }
    /* R33-FIX H2: EVENT_RANGE — 어드민이 결정한 amount 그대로 인센티브 처리 */
    case "EVENT_RANGE": return Math.floor(current);
    default: return 0;
  }
}

function calcSISharedBonus(items: Array<{milestone:any;amount:number}>): number {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const thrVal = Number(items[0]?.milestone.threshold_value || 30_000_000);
  const excess = total - thrVal;
  if (excess <= 0) return 0;
  let bonus = 0;
  for (const { milestone: m, amount } of items) {
    const channelExcess = excess * (amount / total);
    bonus += channelExcess * ((m.bonus_formula as any)?.rate || 0.05);
  }
  return Math.round(bonus);
}

function formatSettle(r: any) {
  return {
    id: r.id, quarterId: r.quarter_id, memberId: r.member_id,
    year: r.year, quarter: r.quarter, quarterStatus: r.quarter_status,
    revenueLinkedTotal: r.revenue_linked_total,
    nonRevenueTotal: r.non_revenue_total, totalBonus: r.total_bonus,
    calculationSnapshot: r.calculation_snapshot,
    selfEvaluation: r.self_evaluation, status: r.status,
    /* R35-GAP-P2-M1: 반려·HOLD 사유 응답에 포함 (UI 표시용) */
    reviewNote: r.review_note, holdReason: r.hold_reason,
    submittedAt: r.submitted_at, approvedAt: r.approved_at, paidAt: r.paid_at,
  };
}
