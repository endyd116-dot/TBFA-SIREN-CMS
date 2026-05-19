import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-milestone-revenue*" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const admin = auth.ctx?.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "매출 검증 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const last = pathParts[pathParts.length - 1]; // verify | reject | or id
  const prev = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : null;
  /* ★ R29-MS-GAP1-I: PUT /:id 라우팅에서 마지막 세그먼트가 숫자 id면 그 id로,
     아니면 기존 액션 라우팅(/:id/verify, /:id/reject) 적용 */
  const lastIsNum = last && !isNaN(Number(last));
  const action = lastIsNum ? null : last;
  const id = lastIsNum ? last : prev;

  // ── GET PENDING 목록 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    const status = url.searchParams.get("status") || "PENDING";
    try {
      /* ★ R29-GAP-P2-C BUG fix: sql.raw(q, params) 파라미터 미바인딩 → sql 템플릿 합성 */
      let baseSql = sql`
        SELECT re.*, md.code, md.name as milestone_name, md.target_milestone_role,
               md.category as milestone_category, md.bonus_formula,
               m.name as entered_by_name
        FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        LEFT JOIN members m ON m.id = re.entered_by
        WHERE 1=1
      `;
      // 어드민은 본인 milestoneRole 담당만 조회
      if (admin.role !== "super_admin") {
        baseSql = sql`${baseSql} AND md.target_milestone_role = ${admin.milestoneRole}`;
      }
      if (status && status !== "ALL") baseSql = sql`${baseSql} AND re.status = ${status}`;
      if (quarterId) baseSql = sql`${baseSql} AND re.quarter_id = ${Number(quarterId)}`;
      baseSql = sql`${baseSql} ORDER BY re.created_at DESC LIMIT 200`;
      const rows = await db.execute(baseSql);
      const entries = ((rows as any).rows || (rows as any[])).map(formatEntry);
      return Response.json({ ok: true, data: { entries } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST /:id/verify ──
  if (req.method === "POST" && action === "verify" && id) {
    try {
      const rows = await db.execute(sql`
        SELECT re.*, md.target_milestone_role, md.name as milestone_name FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        WHERE re.id = ${Number(id)}
      `);
      const entry = (rows as any).rows?.[0] || rows[0];
      if (!entry) return Response.json({ ok: false, error: "항목 없음" }, { status: 404 });
      if (entry.target_milestone_role !== admin.milestoneRole && admin.role !== "super_admin") {
        return Response.json({ ok: false, error: "담당 영역이 아닙니다" }, { status: 403 });
      }
      await db.execute(sql`
        UPDATE revenue_entries SET status = 'VERIFIED', reviewed_by = ${admin.id},
          reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      // 입력자에게 검증 완료 알림 (fire-and-forget)
      createNotification({
        recipientId: entry.entered_by, recipientType: "admin",
        category: "milestone", severity: "info",
        title: `매출 검증 완료: ${entry.milestone_name}`,
        message: "입력하신 매출 항목이 검증 완료되었습니다.",
        link: "/admin#revenue-my",
      }).catch(() => {});
      return Response.json({ ok: true });
    } catch (err) { return jsonError("verify", err); }
  }

  // ── POST /:id/reject ──
  if (req.method === "POST" && action === "reject" && id) {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const rejectReason = body?.rejectReason || body?.reason || "";
    if (!rejectReason) return Response.json({ ok: false, error: "반려 사유를 입력하세요" }, { status: 400 });
    try {
      const rows = await db.execute(sql`
        SELECT re.entered_by, md.name as milestone_name FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        WHERE re.id = ${Number(id)}
      `);
      const entry = (rows as any).rows?.[0] || rows[0];
      await db.execute(sql`
        UPDATE revenue_entries SET status = 'REJECTED', reviewed_by = ${admin.id},
          reviewed_at = NOW(), reject_reason = ${rejectReason}, updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      // 입력자에게 반려 알림 (fire-and-forget)
      if (entry?.entered_by) {
        createNotification({
          recipientId: entry.entered_by, recipientType: "admin",
          category: "milestone", severity: "warning",
          title: `매출 검증 반려: ${entry.milestone_name || "마일스톤"}`,
          message: rejectReason,
          link: "/admin#revenue-my",
        }).catch(() => {});
      }
      return Response.json({ ok: true });
    } catch (err) { return jsonError("reject", err); }
  }

  // ── PUT /:id — EVENT_RANGE 금액 결정 저장 ──
  if (req.method === "PUT" && id && !isNaN(Number(id))) {
    /* ★ R29-MS-GAP1-A: EVENT_RANGE 금액 결정은 super_admin 전용 */
    if (admin.role !== "super_admin") {
      return Response.json({ ok: false, error: "EVENT_RANGE 금액 결정은 슈퍼어드민 전용입니다" }, { status: 403 });
    }
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { eventRangeAmount } = body;
    if (eventRangeAmount == null) return Response.json({ ok: false, error: "eventRangeAmount 필수" }, { status: 400 });
    try {
      /* ★ R29-MS-GAP1-I: bonus_formula의 minAmount~maxAmount 범위 검증 */
      const mdRows = await db.execute(sql`
        SELECT md.bonus_formula, md.name FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        WHERE re.id = ${Number(id)}
      `);
      const md = ((mdRows as any).rows?.[0] || (mdRows as any[])[0]) as any;
      if (!md) return Response.json({ ok: false, error: "매출 항목 없음" }, { status: 404 });
      const formula = md.bonus_formula || {};
      const isEventRange = formula?.type === "EVENT_RANGE" || formula?.formula_type === "EVENT_RANGE";
      if (isEventRange) {
        const minA = Number(formula.minAmount ?? formula.min ?? 0);
        const maxA = Number(formula.maxAmount ?? formula.max ?? 0);
        const amt  = Number(eventRangeAmount);
        if (maxA > 0 && (amt < minA || amt > maxA)) {
          /* ★ R34-P1-B-1: DB 단위는 원, 표시만 만원 변환 */
          return Response.json({
            ok: false,
            error: `범위 내 금액을 입력하세요 (${(minA/10000).toLocaleString()}~${(maxA/10000).toLocaleString()}만원)`
          }, { status: 400 });
        }
      }
      await db.execute(sql`
        UPDATE revenue_entries SET amount = ${String(eventRangeAmount)}, status = 'VERIFIED',
          reviewed_by = ${admin.id}, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("event_range", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드 또는 경로" }, { status: 405 });
}

function formatEntry(r: any) {
  return {
    id: r.id, milestoneDefinitionId: r.milestone_definition_id,
    milestoneCode: r.code, milestoneName: r.milestone_name,
    milestoneRole: r.target_milestone_role,
    /* ★ R29-GAP-P1-H4: EVENT_RANGE UI 분기 + 범위 라벨 노출 */
    milestoneCategory: r.milestone_category,
    bonusFormula: r.bonus_formula,
    quarterId: r.quarter_id, enteredBy: r.entered_by,
    enteredByName: r.entered_by_name,
    revenueDate: r.revenue_date, amount: r.amount, amountUnit: r.amount_unit,
    note: r.note, isCampaignRouted: r.is_campaign_routed,
    evidenceFiles: r.evidence_files || [],
    status: r.status, reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at, rejectReason: r.reject_reason,
    createdAt: r.created_at,
  };
}
