import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-milestone-revenue" };

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
  const action = pathParts[pathParts.length - 1]; // verify | reject | or id
  const id = pathParts.length >= 3 ? pathParts[pathParts.length - 2] : null;

  // ── GET PENDING 목록 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    const status = url.searchParams.get("status") || "PENDING";
    try {
      let q = `
        SELECT re.*, md.code, md.name as milestone_name, md.target_milestone_role,
               m.name as entered_by_name
        FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        LEFT JOIN members m ON m.id = re.entered_by
        WHERE 1=1
      `;
      const params: any[] = [];
      // 어드민은 본인 milestoneRole 담당만 조회
      if (admin.role !== "super_admin") {
        params.push(admin.milestoneRole);
        q += ` AND md.target_milestone_role = $${params.length}`;
      }
      if (status && status !== "ALL") { params.push(status); q += ` AND re.status = $${params.length}`; }
      if (quarterId) { params.push(Number(quarterId)); q += ` AND re.quarter_id = $${params.length}`; }
      q += ` ORDER BY re.created_at DESC LIMIT 200`;
      const rows = await db.execute(sql.raw(q, params));
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
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { eventRangeAmount } = body;
    if (eventRangeAmount == null) return Response.json({ ok: false, error: "eventRangeAmount 필수" }, { status: 400 });
    try {
      await db.execute(sql`
        UPDATE revenue_entries SET amount = ${String(eventRangeAmount)}, updated_at = NOW()
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
