import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification, notifyAllSuperAdmins } from "../../lib/notify";

export const config = { path: "/api/admin-milestone-settlement*" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
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
    /* ★ R29-GAP-P2-M3: memberId 필터 + 단건 응답 키 */
    const memberIdQ = url.searchParams.get("memberId");
    try {
      /* ★ R29-GAP-P2-C BUG fix: sql.raw(q, params)는 drizzle에서 파라미터 바인딩 미지원 →
         sql 템플릿 합성으로 변경 (status·quarterId·memberId 동적 조건 안전 바인딩) */
      let baseSql = sql`
        SELECT qs.*, q.year, q.quarter, m.name as member_name, m.milestone_role
        FROM quarterly_settlements qs
        JOIN quarters q ON q.id = qs.quarter_id
        LEFT JOIN members m ON m.id = qs.member_id
        WHERE 1=1
      `;
      if (status && status !== "ALL") baseSql = sql`${baseSql} AND qs.status = ${status}`;
      if (quarterId) baseSql = sql`${baseSql} AND qs.quarter_id = ${Number(quarterId)}`;
      if (memberIdQ) baseSql = sql`${baseSql} AND qs.member_id = ${Number(memberIdQ)}`;
      baseSql = sql`${baseSql} ORDER BY q.year DESC, q.quarter DESC, qs.submitted_at DESC LIMIT 100`;
      const rows = await db.execute(baseSql);
      const settlements = ((rows as any).rows || (rows as any[])).map((r: any) => ({
        id: r.id, quarterId: r.quarter_id, memberId: r.member_id,
        memberName: r.member_name, milestoneRole: r.milestone_role,
        year: r.year, quarter: r.quarter,
        revenueLinkedTotal: r.revenue_linked_total,
        nonRevenueTotal: r.non_revenue_total, totalBonus: r.total_bonus,
        selfEvaluation: r.self_evaluation, status: r.status,
        holdReason: r.hold_reason,
        submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        approvedAt: r.approved_at, paidAt: r.paid_at,
        calculationSnapshot: r.calculation_snapshot,
      }));
      /* ★ R29-GAP-P2-M3: quarterId·memberId 둘 다 지정 시 단건 settlement 키, 아니면 null */
      let settlement: any = null;
      if (quarterId && memberIdQ) {
        settlement = settlements.find((s: any) =>
          Number(s.quarterId) === Number(quarterId) &&
          Number(s.memberId) === Number(memberIdQ)
        ) || null;
      }
      return Response.json({ ok: true, data: { settlements, settlement } });
    } catch (err) { return jsonError("select", err); }
  }

  if (!idStr || isNaN(Number(idStr))) {
    return Response.json({ ok: false, error: "결산 ID 없음" }, { status: 400 });
  }
  const id = Number(idStr);

  /* ★ R29-MS-GAP1-D: HOLD 트랜지션 추가 (SUBMITTED/REVIEWED → HOLD, HOLD → REVIEWED 복귀) */
  const statusTransitions: Record<string, { from: string[]; to: string }> = {
    approve:  { from: ["SUBMITTED", "REVIEWED", "HOLD"], to: "APPROVED" },
    reject:   { from: ["SUBMITTED", "REVIEWED", "APPROVED", "HOLD"], to: "REJECTED" },
    paid:     { from: ["APPROVED"], to: "PAID" },
    hold:     { from: ["SUBMITTED", "REVIEWED"], to: "HOLD" },
    resume:   { from: ["HOLD"], to: "REVIEWED" },
  };

  if (req.method === "POST" && action in statusTransitions) {
    const transition = statusTransitions[action];
    let body: any = {};
    try { body = await req.json(); } catch { /* optional body */ }
    try {
      const rows = await db.execute(sql`
        SELECT qs.status, qs.member_id, qs.total_bonus, q.year, q.quarter, m.milestone_role, m.name as member_name
        FROM quarterly_settlements qs
        JOIN quarters q ON q.id = qs.quarter_id
        LEFT JOIN members m ON m.id = qs.member_id
        WHERE qs.id = ${id}
      `);
      const settle = (rows as any).rows?.[0] || (rows as any[])[0];
      if (!settle) return Response.json({ ok: false, error: "결산 없음" }, { status: 404 });
      if (!transition.from.includes(settle.status)) {
        return Response.json({ ok: false, error: `현재 상태(${settle.status})에서 ${action} 불가` }, { status: 400 });
      }

      /* ★ R29-MS-GAP1-D: HOLD 시 사유 필수 */
      if (action === "hold" && !body?.holdReason?.trim()) {
        return Response.json({ ok: false, error: "HOLD 사유를 입력하세요" }, { status: 400 });
      }

      /* ★ R34-P1-B-13: sql.raw + escape 패턴 → sql 템플릿 합성 (R32-P0-C2·C3 동일 패턴 적용) */
      let updateSql = sql`UPDATE quarterly_settlements SET status = ${transition.to}, reviewed_by = ${admin.id}, reviewed_at = NOW(), updated_at = NOW()`;
      if (action === "approve") updateSql = sql`${updateSql}, approved_at = NOW()`;
      if (action === "paid")    updateSql = sql`${updateSql}, paid_at = NOW()`;
      if (action === "hold")    updateSql = sql`${updateSql}, hold_reason = ${String(body.holdReason)}`;
      if (action === "resume")  updateSql = sql`${updateSql}, hold_reason = NULL`;
      if (body?.reviewNote)     updateSql = sql`${updateSql}, review_note = ${String(body.reviewNote)}`;
      updateSql = sql`${updateSql} WHERE id = ${id}`;
      await db.execute(updateSql);

      const periodLabel = `${settle.year}년 ${settle.quarter}분기`;

      /* 알림 발송 (fire-and-forget) */
      if (action === "approve" || action === "reject") {
        if (settle.member_id) {
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
      }

      /* ★ R29-MS-GAP1-D: HOLD 시 운영자에게 자료 보완 요청 알림 */
      if (action === "hold" && settle.member_id) {
        createNotification({
          recipientId: settle.member_id, recipientType: "admin",
          category: "milestone", severity: "warning",
          title: `결산 보류 (자료 보완 요청): ${periodLabel}`,
          message: body?.holdReason || "추가 자료를 보완해 주세요.",
          link: "/admin#settlement-my",
        }).catch(() => {});
      }

      /* ★ R29-MS-GAP1-J: PAID 처리 시 어드민/운영자 양쪽 알림 */
      if (action === "paid") {
        // 운영자에게 지급 안내
        if (settle.member_id) {
          createNotification({
            recipientId: settle.member_id, recipientType: "admin",
            category: "milestone", severity: "info",
            title: `급여 지급 예정 안내: ${periodLabel}`,
            message: `${periodLabel} 결산이 승인되었습니다. 총 변동급 ${Number(settle.total_bonus || 0).toLocaleString()}원.`,
            link: "/admin#settlement-my",
          }).catch(() => {});
        }
        // 전체 슈퍼어드민에게 지급 처리 완료 알림
        notifyAllSuperAdmins({
          category: "milestone", severity: "info",
          title: `결산 지급 처리 완료: ${periodLabel}`,
          message: `${settle.member_name || "운영자"} (${settle.milestone_role || "-"}) 결산 PAID 처리됨.`,
          link: "/cms-tbfa.html#milestone-review",
        }).catch(() => {});

        /* ★ R29-MS-GAP1-G: PAID 후 다음 분기 자동 생성 */
        await ensureNextQuarter(settle.year, settle.quarter).catch((e: any) => {
          console.warn("[next-quarter-create]", e?.message);
        });

        /* ★ Q3-032 fix: PAID 시 해당 분기 3개월 급여 재집계 — 분기 성과급(/3 안분)이 앞 달 명세에도
           반영되도록. force=false라 확정(REVIEWED↑)·수동수정 명세는 보존(미반영). */
        try {
          const { calculatePayrollForMonth } = await import("../../lib/payroll-calc");
          const baseMonth = (Number(settle.quarter) - 1) * 3;
          for (let i = 1; i <= 3; i++) {
            await calculatePayrollForMonth(Number(settle.year), baseMonth + i, { force: false });
          }
        } catch (e: any) {
          console.warn("[settlement paid] 급여 재집계 트리거 실패:", e?.message);
        }
      }

      return Response.json({ ok: true });
    } catch (err) { return jsonError(action, err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드 또는 경로" }, { status: 405 });
}

/* ★ R29-MS-GAP1-G: 다음 분기 자동 생성 (UPCOMING)
   - 이미 존재하면 skip
   - startDate/endDate/settlementDate는 직전 분기 기준 90일 단위 자동 계산 */
async function ensureNextQuarter(year: number, quarter: number) {
  const nextQ = quarter === 4 ? 1 : quarter + 1;
  const nextY = quarter === 4 ? year + 1 : year;

  const existRows = await db.execute(sql`
    SELECT id FROM quarters WHERE year = ${nextY} AND quarter = ${nextQ} LIMIT 1
  `);
  if (((existRows as any).rows?.length || (existRows as any[]).length) > 0) return;

  /* 시작·종료·결산일 계산 (분기당 3개월) */
  const startMonth = (nextQ - 1) * 3 + 1;
  const startDate = `${nextY}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonthDate = new Date(nextY, startMonth + 2, 0); // 분기 마지막 달의 말일
  const endDate = `${nextY}-${String(endMonthDate.getMonth() + 1).padStart(2, "0")}-${String(endMonthDate.getDate()).padStart(2, "0")}`;
  /* ★ R34-P1-B-5: 결산일은 분기 종료일 + 14일 (UI 안내 "10~14일"과 정합) */
  const settleDt = new Date(endMonthDate);
  settleDt.setDate(settleDt.getDate() + 14);
  const settlementDate = `${settleDt.getFullYear()}-${String(settleDt.getMonth() + 1).padStart(2, "0")}-${String(settleDt.getDate()).padStart(2, "0")}`;

  await db.execute(sql`
    INSERT INTO quarters (year, quarter, start_date, end_date, settlement_date, status)
    VALUES (${nextY}, ${nextQ}, ${startDate}, ${endDate}, ${settlementDate}, 'UPCOMING')
    ON CONFLICT DO NOTHING
  `);

  await notifyAllSuperAdmins({
    category: "milestone", severity: "info",
    title: `다음 분기 자동 생성: ${nextY}년 Q${nextQ}`,
    message: `${startDate} ~ ${endDate} (결산일 ${settlementDate})`,
    link: "/admin#milestone-review",
  }).catch(() => {});
}
