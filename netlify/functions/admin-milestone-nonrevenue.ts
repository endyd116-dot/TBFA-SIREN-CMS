import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-milestone-nonrevenue*" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;
  const isSuperAdmin = admin?.role === "super_admin";
  if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "비매출 검증 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const action = pathParts[pathParts.length - 1];
  const idStr = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : null;

  // ── GET PENDING 목록 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    const status = url.searchParams.get("status") || "PENDING";
    try {
      /* ★ R29-GAP-P2-C BUG fix: sql.raw(q, params) 파라미터 미바인딩 → sql 템플릿 합성 */
      let baseSql = sql`
        SELECT nra.*, md.code, md.name as milestone_name, md.target_milestone_role,
               md.bonus_formula, m.name as submitted_by_name
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        LEFT JOIN members m ON m.id = nra.submitted_by
        WHERE 1=1
      `;
      if (status && status !== "ALL") baseSql = sql`${baseSql} AND nra.status = ${status}`;
      if (quarterId) baseSql = sql`${baseSql} AND nra.quarter_id = ${Number(quarterId)}`;
      baseSql = sql`${baseSql} ORDER BY nra.created_at DESC LIMIT 200`;
      const rows = await db.execute(baseSql);
      const achievements = ((rows as any).rows || (rows as any[])).map((r: any) => ({
        id: r.id, milestoneCode: r.code, milestoneName: r.milestone_name,
        milestoneRole: r.target_milestone_role,
        submittedBy: r.submitted_by, submittedByName: r.submitted_by_name,
        quarterId: r.quarter_id, achievedDate: r.achieved_date,
        description: r.description, evidenceFiles: r.evidence_files || [],
        bonusAmount: String(r.bonus_amount), eventRangeAmount: r.event_range_amount,
        bonusFormula: r.bonus_formula,
        isSelectedForQuarter: r.is_selected_for_quarter,
        status: r.status, reviewedAt: r.reviewed_at, rejectReason: r.reject_reason,
      }));
      return Response.json({ ok: true, data: { achievements } });
    } catch (err) { return jsonError("select", err); }
  }

  /* ★ R29-MS-GAP2-D: REVIEWED 중간 상태 (1차 검토 완료) — 2단계 UX */
  if (req.method === "POST" && action === "review" && idStr) {
    try {
      const rows = await db.execute(sql`
        SELECT nra.submitted_by, nra.status, md.name as milestone_name
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.id = ${Number(idStr)}
      `);
      const ach = (rows as any).rows?.[0] || (rows as any[])[0];
      if (!ach) return Response.json({ ok: false, error: "항목 없음" }, { status: 404 });
      if (ach.status !== "PENDING") {
        return Response.json({ ok: false, error: `현재 상태(${ach.status})에서 review 불가` }, { status: 400 });
      }
      await db.execute(sql`
        UPDATE non_revenue_achievements SET status = 'REVIEWED',
          reviewed_by = ${admin.id}, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${Number(idStr)}
      `);
      if (ach.submitted_by) {
        createNotification({
          recipientId: ach.submitted_by, recipientType: "admin",
          category: "milestone", severity: "info",
          title: `비매출 성과 검토 완료: ${ach.milestone_name || "마일스톤"}`,
          message: "1차 검토 완료. 최종 승인 대기 중입니다.",
          link: "/admin#nonrevenue-my",
        }).catch(() => {});
      }
      return Response.json({ ok: true });
    } catch (err) { return jsonError("review", err); }
  }

  // ── POST /:id/verify ──
  if (req.method === "POST" && action === "verify" && idStr) {
    try {
      const rows = await db.execute(sql`
        SELECT nra.submitted_by, nra.status, md.name as milestone_name
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.id = ${Number(idStr)}
      `);
      const ach = (rows as any).rows?.[0] || rows[0];
      /* ★ R29-MS-GAP2-D: PENDING 또는 REVIEWED에서만 VERIFIED 허용 */
      if (ach && !["PENDING", "REVIEWED"].includes(ach.status)) {
        return Response.json({ ok: false, error: `현재 상태(${ach.status})에서 verify 불가` }, { status: 400 });
      }
      await db.execute(sql`
        UPDATE non_revenue_achievements SET status = 'VERIFIED',
          reviewed_by = ${admin.id}, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${Number(idStr)}
      `);
      // 제출자에게 검증 완료 알림 (fire-and-forget)
      if (ach?.submitted_by) {
        createNotification({
          recipientId: ach.submitted_by, recipientType: "admin",
          category: "milestone", severity: "info",
          title: `비매출 성과 검증 완료: ${ach.milestone_name || "마일스톤"}`,
          message: "제출하신 비매출 성과가 검증 완료되었습니다.",
          link: "/admin#nonrevenue-my",
        }).catch(() => {});
      }
      return Response.json({ ok: true });
    } catch (err) { return jsonError("verify", err); }
  }

  // ── POST /:id/reject ──
  if (req.method === "POST" && action === "reject" && idStr) {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const rejectReason = body?.rejectReason || body?.reason || "";
    if (!rejectReason) return Response.json({ ok: false, error: "반려 사유 필수" }, { status: 400 });
    try {
      const rows = await db.execute(sql`
        SELECT nra.submitted_by, md.name as milestone_name
        FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.id = ${Number(idStr)}
      `);
      const ach = (rows as any).rows?.[0] || rows[0];
      await db.execute(sql`
        UPDATE non_revenue_achievements SET status = 'REJECTED',
          reviewed_by = ${admin.id}, reviewed_at = NOW(),
          reject_reason = ${rejectReason}, updated_at = NOW()
        WHERE id = ${Number(idStr)}
      `);
      // 제출자에게 반려 알림 (fire-and-forget)
      if (ach?.submitted_by) {
        createNotification({
          recipientId: ach.submitted_by, recipientType: "admin",
          category: "milestone", severity: "warning",
          title: `비매출 성과 검증 반려: ${ach.milestone_name || "마일스톤"}`,
          message: rejectReason,
          link: "/admin#nonrevenue-my",
        }).catch(() => {});
      }
      return Response.json({ ok: true });
    } catch (err) { return jsonError("reject", err); }
  }

  // ── PATCH /:id/event-range — EVENT_RANGE 금액 수동 설정 ──
  if (req.method === "PATCH" && action === "event-range" && idStr) {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { eventRangeAmount } = body;
    const amt = Number(eventRangeAmount);
    if (eventRangeAmount == null || !Number.isFinite(amt) || amt < 0) {
      return Response.json({ ok: false, error: "eventRangeAmount는 0 이상 숫자여야 합니다" }, { status: 400 });
    }
    try {
      /* ★ Q3-031 fix: 존재 확인 + bonus_formula의 minAmount~maxAmount 범위 검증 (매출 카운터파트와 동일 보호).
         기존엔 검증 없이 무조건 UPDATE라 0행도 ok:true(저장 오인)·범위 밖/음수도 정산에 반영됐다. */
      const mdRows = await db.execute(sql`
        SELECT md.bonus_formula FROM non_revenue_achievements nra
        JOIN milestone_definitions md ON md.id = nra.milestone_definition_id
        WHERE nra.id = ${Number(idStr)}
        LIMIT 1
      `);
      const md = ((mdRows as any).rows?.[0] || (mdRows as any[])[0]) as any;
      if (!md) return Response.json({ ok: false, error: "비매출 성과를 찾을 수 없습니다" }, { status: 404 });
      const formula = md.bonus_formula || {};
      const isEventRange = formula?.type === "EVENT_RANGE" || formula?.formula_type === "EVENT_RANGE";
      if (isEventRange) {
        const minA = Number(formula.minAmount ?? formula.min ?? 0);
        const maxA = Number(formula.maxAmount ?? formula.max ?? 0);
        if (maxA > 0 && (amt < minA || amt > maxA)) {
          return Response.json({ ok: false, error: `금액은 ${minA.toLocaleString()}~${maxA.toLocaleString()}원 범위여야 합니다` }, { status: 400 });
        }
      }
      await db.execute(sql`
        UPDATE non_revenue_achievements SET
          event_range_amount = ${String(amt)}, updated_at = NOW()
        WHERE id = ${Number(idStr)}
      `);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("event_range", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드 또는 경로" }, { status: 405 });
}
