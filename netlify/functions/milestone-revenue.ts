import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/milestone-revenue" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const member = auth.ctx.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "매출 입력 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);

  // ── GET 내역 조회 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    const milestoneRole = member.milestoneRole;
    try {
      let q = `
        SELECT re.*, md.code, md.name as milestone_name, md.target_milestone_role,
               md.amount_unit as default_unit
        FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        WHERE re.entered_by = $1
      `;
      const params: any[] = [member.id];
      if (quarterId) { params.push(Number(quarterId)); q += ` AND re.quarter_id = $${params.length}`; }
      q += ` ORDER BY re.revenue_date DESC, re.created_at DESC LIMIT 200`;
      const rows = await db.execute(sql.raw(q, params));
      const entries = ((rows as any).rows || (rows as any[])).map(formatEntry);
      return Response.json({ ok: true, data: { entries } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST 입력 ──
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { milestoneDefinitionId, quarterId, revenueDate, amount, amountUnit,
            note, isCampaignRouted, evidenceFiles } = body;
    if (!milestoneDefinitionId || !quarterId || !revenueDate || amount == null) {
      return Response.json({ ok: false, error: "필수 필드 누락 (milestoneDefinitionId, quarterId, revenueDate, amount)" }, { status: 400 });
    }
    try {
      // 해당 분기가 ACTIVE 상태인지 확인
      const qRows = await db.execute(sql`SELECT status FROM quarters WHERE id = ${Number(quarterId)}`);
      const qStatus = ((qRows as any).rows?.[0] || qRows[0])?.status;
      if (!qStatus) return Response.json({ ok: false, error: "존재하지 않는 분기" }, { status: 404 });
      if (qStatus !== "ACTIVE") return Response.json({ ok: false, error: "활성 분기에만 입력 가능합니다" }, { status: 400 });

      // 마일스톤 소유권 확인 (본인 milestoneRole과 일치)
      const mdRows = await db.execute(sql`
        SELECT target_milestone_role FROM milestone_definitions
        WHERE id = ${Number(milestoneDefinitionId)} AND is_active = TRUE
      `);
      const md = (mdRows as any).rows?.[0] || mdRows[0];
      if (!md) return Response.json({ ok: false, error: "존재하지 않는 마일스톤" }, { status: 404 });
      if (md.target_milestone_role !== member.milestoneRole && member.role !== "super_admin") {
        return Response.json({ ok: false, error: "본인 담당 마일스톤에만 입력 가능합니다" }, { status: 403 });
      }

      // 담당 어드민 조회 (같은 milestoneRole을 가진 admin)
      const adminRows = await db.execute(sql`
        SELECT id FROM members WHERE role = 'admin' AND milestone_role = ${md.target_milestone_role} LIMIT 1
      `);
      const adminId = ((adminRows as any).rows?.[0] || adminRows[0])?.id ?? null;

      const insertRows = await db.execute(sql`
        INSERT INTO revenue_entries
          (milestone_definition_id, quarter_id, entered_by, responsible_admin_id,
           revenue_date, amount, amount_unit, note, is_campaign_routed, evidence_files)
        VALUES (
          ${Number(milestoneDefinitionId)}, ${Number(quarterId)}, ${member.id}, ${adminId},
          ${revenueDate}, ${String(amount)}, ${amountUnit || "원"},
          ${note ?? null}, ${isCampaignRouted ?? false}, ${JSON.stringify(evidenceFiles || [])}
        )
        RETURNING *
      `);
      const entry = (insertRows as any).rows?.[0] || insertRows[0];

      // 담당 어드민에게 검증 요청 알림 (fire-and-forget)
      if (adminId) {
        const mdNameRows = await db.execute(sql`SELECT name FROM milestone_definitions WHERE id = ${Number(milestoneDefinitionId)}`);
        const mdName = ((mdNameRows as any).rows?.[0] || mdNameRows[0])?.name || "마일스톤";
        createNotification({
          recipientId: adminId, recipientType: "admin",
          category: "milestone", severity: "info",
          title: `매출 입력 검증 대기: ${mdName}`,
          message: `${member.name || member.email}이 ${Number(amount).toLocaleString()}원 입력`,
          link: "/admin#revenue-verify",
        }).catch(() => {});
      }

      return Response.json({ ok: true, data: { entry: formatEntry(entry) } }, { status: 201 });
    } catch (err) { return jsonError("insert", err); }
  }

  // ── PATCH /:id 수정 (PENDING 상태만) ──
  if (req.method === "PATCH") {
    const id = url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    try {
      const rows = await db.execute(sql`
        SELECT id, status, entered_by FROM revenue_entries WHERE id = ${Number(id)}
      `);
      const entry = (rows as any).rows?.[0] || rows[0];
      if (!entry) return Response.json({ ok: false, error: "항목 없음" }, { status: 404 });
      if (entry.entered_by !== member.id && member.role !== "super_admin") {
        return Response.json({ ok: false, error: "본인 항목만 수정 가능" }, { status: 403 });
      }
      if (entry.status !== "PENDING") {
        return Response.json({ ok: false, error: "PENDING 상태에서만 수정 가능합니다" }, { status: 400 });
      }
      const { amount, amountUnit, revenueDate, note, isCampaignRouted, evidenceFiles } = body;
      await db.execute(sql`
        UPDATE revenue_entries SET
          amount = COALESCE(${amount != null ? String(amount) : null}, amount),
          amount_unit = COALESCE(${amountUnit ?? null}, amount_unit),
          revenue_date = COALESCE(${revenueDate ?? null}, revenue_date),
          note = COALESCE(${note ?? null}, note),
          is_campaign_routed = COALESCE(${isCampaignRouted ?? null}, is_campaign_routed),
          evidence_files = COALESCE(${evidenceFiles ? JSON.stringify(evidenceFiles) : null}::jsonb, evidence_files),
          updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("update", err); }
  }

  // ── DELETE /:id ──
  if (req.method === "DELETE") {
    const id = url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    try {
      const rows = await db.execute(sql`SELECT entered_by, status FROM revenue_entries WHERE id = ${Number(id)}`);
      const entry = (rows as any).rows?.[0] || rows[0];
      if (!entry) return Response.json({ ok: false, error: "항목 없음" }, { status: 404 });
      if (entry.entered_by !== member.id && member.role !== "super_admin") {
        return Response.json({ ok: false, error: "본인 항목만 삭제 가능" }, { status: 403 });
      }
      if (entry.status === "VERIFIED") {
        return Response.json({ ok: false, error: "검증 완료된 항목은 삭제할 수 없습니다" }, { status: 400 });
      }
      await db.execute(sql`DELETE FROM revenue_entries WHERE id = ${Number(id)}`);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("delete", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}

function formatEntry(r: any) {
  return {
    id: r.id, milestoneDefinitionId: r.milestone_definition_id,
    quarterId: r.quarter_id, enteredBy: r.entered_by,
    revenueDate: r.revenue_date, amount: r.amount, amountUnit: r.amount_unit,
    note: r.note, isCampaignRouted: r.is_campaign_routed,
    evidenceFiles: r.evidence_files || [],
    status: r.status, reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at, rejectReason: r.reject_reason,
    createdAt: r.created_at,
    milestoneName: r.milestone_name, milestoneCode: r.code,
  };
}
