import type { Context } from "@netlify/functions";
/* ★ R35-GAP-P1-B-H1: operator+admin 명세 정합 — requireAdmin → requireOperator (operatorActive=true 일반 회원도 매출 입력) */
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/milestone-revenue*" };

export default async function handler(req: Request, _ctx: Context) {
  /* ★ R35-GAP-P1-B-H1: operator+admin 모두 허용 (명세 §0 정합).
     본인 milestoneRole 기준 필터로 권한 분리. super_admin은 전체 우회. */
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const member = auth.ctx.member as any;

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "매출 입력 오류", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000) }, { status: 500 });
  }

  const url = new URL(req.url);

  // ── GET 내역 조회 ──
  if (req.method === "GET") {
    const quarterId = url.searchParams.get("quarterId");
    try {
      /* ★ R29-GAP-P2-C BUG fix: sql.raw(q, params) 파라미터 미바인딩 → sql 템플릿 합성
         + milestone_definitions.amount_unit 컬럼 부재(threshold_unit만 존재)로 인한 SELECT 오류 제거.
         default_unit alias는 사용처 없음 → 안전 삭제. */
      let baseSql = sql`
        SELECT re.*, md.code, md.name as milestone_name, md.target_milestone_role
        FROM revenue_entries re
        JOIN milestone_definitions md ON md.id = re.milestone_definition_id
        WHERE re.entered_by = ${member.id}
      `;
      if (quarterId) baseSql = sql`${baseSql} AND re.quarter_id = ${Number(quarterId)}`;
      baseSql = sql`${baseSql} ORDER BY re.revenue_date DESC, re.created_at DESC LIMIT 200`;
      const rows = await db.execute(baseSql);
      const entries = ((rows as any).rows || (rows as any[])).map(formatEntry);
      return Response.json({ ok: true, data: { entries } });
    } catch (err) { return jsonError("select", err); }
  }

  // ── POST 입력 ──
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { milestoneDefinitionId, quarterId, revenueDate, amount, amountUnit,
            note, isCampaignRouted, evidenceFiles, revenueSource, businessUnit } = body;
    if (!milestoneDefinitionId || !quarterId || !revenueDate || amount == null) {
      return Response.json({ ok: false, error: "필수 필드 누락 (milestoneDefinitionId, quarterId, revenueDate, amount)" }, { status: 400 });
    }
    try {
      // 해당 분기가 ACTIVE 상태인지 확인
      const qRows = await db.execute(sql`SELECT status FROM quarters WHERE id = ${Number(quarterId)}`);
      const qStatus = ((qRows as any).rows?.[0] || (qRows as any[])[0])?.status;
      if (!qStatus) return Response.json({ ok: false, error: "존재하지 않는 분기" }, { status: 404 });
      if (qStatus !== "ACTIVE") return Response.json({ ok: false, error: "활성 분기에만 입력 가능합니다" }, { status: 400 });

      /* ★ R29-MS-GAP1-J/GAP2-H: 결산이 이미 SUBMITTED/APPROVED/PAID이면 매출 입력 차단 */
      const settleRows = await db.execute(sql`
        SELECT status FROM quarterly_settlements
        WHERE quarter_id = ${Number(quarterId)} AND member_id = ${member.id}
      `);
      const settleStatus = ((settleRows as any).rows?.[0] || (settleRows as any[])[0])?.status;
      if (settleStatus && ["SUBMITTED", "APPROVED", "PAID"].includes(settleStatus)) {
        return Response.json({
          ok: false,
          error: "결산이 제출된 분기에는 실적을 추가할 수 없습니다.",
        }, { status: 409 });
      }

      // 마일스톤 소유권 확인 (본인 milestoneRole과 일치)
      const mdRows = await db.execute(sql`
        SELECT id, code, name, target_milestone_role, bonus_formula
        FROM milestone_definitions
        WHERE id = ${Number(milestoneDefinitionId)} AND is_active = TRUE
      `);
      const md = (mdRows as any).rows?.[0] || (mdRows as any[])[0];
      if (!md) return Response.json({ ok: false, error: "존재하지 않는 마일스톤" }, { status: 404 });
      if (md.target_milestone_role !== member.milestoneRole && member.role !== "super_admin") {
        return Response.json({ ok: false, error: "본인 담당 마일스톤에만 입력 가능합니다" }, { status: 403 });
      }

      /* ★ R29-MS-GAP1-H: sm-001(직접 모집)은 후원자 경유 강제 false */
      let finalCampaignRouted = isCampaignRouted ?? false;
      if (md.code === "sm-001" && finalCampaignRouted === true) {
        return Response.json({ ok: false, error: "sm-001(직접 모집)은 후원자 경유 불가" }, { status: 400 });
      }

      /* ★ R29-MS-GAP1-H: 동일 분기 + 동일 마일스톤 + 동일 날짜 + 동일 금액 중복 차단 (PENDING/VERIFIED) */
      const dupRows = await db.execute(sql`
        SELECT id FROM revenue_entries
        WHERE milestone_definition_id = ${Number(milestoneDefinitionId)}
          AND quarter_id = ${Number(quarterId)}
          AND entered_by = ${member.id}
          AND revenue_date = ${revenueDate}
          AND amount = ${String(amount)}
          AND status IN ('PENDING', 'VERIFIED')
        LIMIT 1
      `);
      if (((dupRows as any).rows?.length || (dupRows as any[]).length) > 0) {
        return Response.json({ ok: false, error: "동일 분기·동일 마일스톤·동일 날짜·동일 금액 기록이 존재합니다" }, { status: 400 });
      }

      // 담당 어드민 조회 (같은 milestoneRole을 가진 admin)
      const adminRows = await db.execute(sql`
        SELECT id FROM members WHERE role = 'admin' AND milestone_role = ${md.target_milestone_role} LIMIT 1
      `);
      const adminId = ((adminRows as any).rows?.[0] || (adminRows as any[])[0])?.id ?? null;

      const insertRows = await db.execute(sql`
        INSERT INTO revenue_entries
          (milestone_definition_id, quarter_id, entered_by, responsible_admin_id,
           revenue_date, amount, amount_unit, note, is_campaign_routed, evidence_files)
        VALUES (
          ${Number(milestoneDefinitionId)}, ${Number(quarterId)}, ${member.id}, ${adminId},
          ${revenueDate}, ${String(amount)}, ${amountUnit || "원"},
          ${note ?? null}, ${finalCampaignRouted}, ${JSON.stringify(evidenceFiles || [])}
        )
        RETURNING *
      `);
      const entry = (insertRows as any).rows?.[0] || (insertRows as any[])[0];

      // 담당 어드민에게 검증 요청 알림 (fire-and-forget)
      if (adminId) {
        createNotification({
          recipientId: adminId, recipientType: "admin",
          category: "milestone", severity: "info",
          title: `매출 입력 검증 대기: ${md.name}`,
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
      const entry = (rows as any).rows?.[0] || (rows as any[])[0];
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
      const entry = (rows as any).rows?.[0] || (rows as any[])[0];
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
