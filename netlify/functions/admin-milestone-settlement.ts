import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-milestone-settlement" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const admin = auth.ctx?.member as any;
  const isSuperAdmin = admin?.role === "super_admin";
  if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "결산 관리 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const action = pathParts[pathParts.length - 1];
  const idStr = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : null;

  // ── GET 전체 결산 목록 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    const status = url.searchParams.get("status");
    try {
      let q = `
        SELECT qs.*, q.year, q.quarter, m.name as member_name, m.milestone_role
        FROM quarterly_settlements qs
        JOIN quarters q ON q.id = qs.quarter_id
        LEFT JOIN members m ON m.id = qs.member_id
        WHERE 1=1
      `;
      const params: any[] = [];
      if (status && status !== "ALL") { params.push(status); q += ` AND qs.status = $${params.length}`; }
      if (quarterId) { params.push(Number(quarterId)); q += ` AND qs.quarter_id = $${params.length}`; }
      q += ` ORDER BY q.year DESC, q.quarter DESC, qs.submitted_at DESC LIMIT 100`;
      const rows = await db.execute(sql.raw(q, params));
      const settlements = ((rows as any).rows || (rows as any[])).map((r: any) => ({
        id: r.id, quarterId: r.quarter_id, memberId: r.member_id,
        memberName: r.member_name, milestoneRole: r.milestone_role,
        year: r.year, quarter: r.quarter,
        revenueLinkedTotal: r.revenue_linked_total,
        nonRevenueTotal: r.non_revenue_total, totalBonus: r.total_bonus,
        selfEvaluation: r.self_evaluation, status: r.status,
        submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        approvedAt: r.approved_at, paidAt: r.paid_at,
        calculationSnapshot: r.calculation_snapshot,
      }));
      return Response.json({ ok: true, data: { settlements } });
    } catch (err) { return jsonError("select", err); }
  }

  if (!idStr || isNaN(Number(idStr))) {
    return Response.json({ ok: false, error: "결산 ID 없음" }, { status: 400 });
  }
  const id = Number(idStr);

  const statusTransitions: Record<string, { from: string[]; to: string }> = {
    approve:  { from: ["SUBMITTED", "REVIEWED"], to: "APPROVED" },
    reject:   { from: ["SUBMITTED", "REVIEWED", "APPROVED"], to: "REJECTED" },
    paid:     { from: ["APPROVED"], to: "PAID" },
  };

  if (req.method === "POST" && action in statusTransitions) {
    const transition = statusTransitions[action];
    let body: any = {};
    try { body = await req.json(); } catch { /* optional body */ }
    try {
      const rows = await db.execute(sql`
        SELECT qs.status, qs.member_id, qs.total_bonus, q.year, q.quarter
        FROM quarterly_settlements qs
        JOIN quarters q ON q.id = qs.quarter_id
        WHERE qs.id = ${id}
      `);
      const settle = (rows as any).rows?.[0] || rows[0];
      if (!settle) return Response.json({ ok: false, error: "결산 없음" }, { status: 404 });
      if (!transition.from.includes(settle.status)) {
        return Response.json({ ok: false, error: `현재 상태(${settle.status})에서 ${action} 불가` }, { status: 400 });
      }
      const sets: Record<string, string> = {
        status: transition.to,
        reviewed_by: String(admin.id),
        reviewed_at: "NOW()",
        updated_at: "NOW()",
      };
      if (action === "approve") sets.approved_at = "NOW()";
      if (action === "paid") sets.paid_at = "NOW()";
      if (body?.reviewNote) sets.review_note = `'${body.reviewNote.replace(/'/g, "''")}'`;

      const setClauses = Object.entries(sets)
        .map(([k, v]) => `${k} = ${v.startsWith("NOW()") || v.startsWith("'") ? v : `'${v}'`}`)
        .join(", ");
      await db.execute(sql.raw(`UPDATE quarterly_settlements SET ${setClauses} WHERE id = ${id}`));

      // 해당 어드민에게 결산 처리 결과 알림 (fire-and-forget)
      if (settle.member_id && (action === "approve" || action === "reject")) {
        const periodLabel = `${settle.year}년 ${settle.quarter}분기`;
        const isApprove = action === "approve";
        createNotification({
          recipientId: settle.member_id, recipientType: "admin",
          category: "milestone", severity: isApprove ? "info" : "warning",
          title: isApprove ? `결산 승인 완료: ${periodLabel}` : `결산 반려: ${periodLabel}`,
          message: isApprove
            ? `총 변동급 ${Number(settle.total_bonus || 0).toLocaleString()}원이 승인되었습니다.`
            : body?.reviewNote || "결산이 반려되었습니다. 내용을 확인해주세요.",
          link: "/admin#settlement-my",
        }).catch(() => {});
      }

      return Response.json({ ok: true });
    } catch (err) { return jsonError(action, err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드 또는 경로" }, { status: 405 });
}
