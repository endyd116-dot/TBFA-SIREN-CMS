/**
 * /api/admin-payroll
 *   GET  /api/admin-payroll?year=&month=                  월별 명세서 일람
 *   GET  /api/admin-payroll?id=N                          명세서 상세
 *   PATCH /api/admin-payroll?id=N    body { reviewNote?, status? }   수정
 *   POST /api/admin-payroll?id=N&action=approve           승인 (APPROVED)
 *   POST /api/admin-payroll?id=N&action=hold              보류 (HOLD)
 *   POST /api/admin-payroll?action=recalculate&year=&month=   월별 수동 재집계 (3일차에서 구현)
 *
 * 권한: super_admin 전용 (member.role === 'super_admin')
 * R37 1일차 — API 골격. 자동 집계·발송은 후속 일차에서 구현.
 */
import { db } from "../../db/index";
import { payrollSlips, payrollAudit, members } from "../../db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { calculatePayrollForMonth } from "../../lib/payroll-calc";

export const config = { path: "/api/admin-payroll" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 명세서 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const admin = (auth as any).ctx.member;

  const url = new URL(req.url);
  const method = req.method;
  const idParam = url.searchParams.get("id");
  const idNum = idParam ? Number(idParam) : null;

  // GET
  if (method === "GET") {
    // 상세
    if (idNum) {
      try {
        const [slip] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!slip) return jsonBadRequest("명세서를 찾을 수 없습니다");
        // 회원 이름 부가 정보
        let memberInfo: any = null;
        try {
          const [m] = await db.select({
            id: members.id, name: members.name, email: members.email,
            role: members.role, milestoneRole: members.milestoneRole,
          }).from(members).where(eq(members.id, Number(slip.memberUid))).limit(1);
          memberInfo = m ?? null;
        } catch (err) {
          console.warn("[admin-payroll] member lookup failed:", err);
        }

        // 수정 이력 (누가·무엇·사유·언제) — 보조 SELECT 실패 시 빈 배열
        let audit: any[] = [];
        try {
          const rows = await db.select()
            .from(payrollAudit)
            .where(eq(payrollAudit.slipId, idNum))
            .orderBy(desc(payrollAudit.createdAt))
            .limit(100);
          // changedBy(=관리자 members.id) → 이름 매핑
          const editorIds = Array.from(new Set(
            rows.map(r => Number(r.changedBy)).filter(n => !isNaN(n))
          ));
          let editorMap = new Map<number, string>();
          if (editorIds.length > 0) {
            try {
              const es = await db.select({ id: members.id, name: members.name })
                .from(members).where(inArray(members.id, editorIds));
              editorMap = new Map(es.map(e => [e.id, e.name]));
            } catch (err) {
              console.warn("[admin-payroll] audit editor lookup failed:", err);
            }
          }
          audit = rows.map(r => ({
            ...r,
            changedByName: editorMap.get(Number(r.changedBy)) ?? null,
          }));
        } catch (err) {
          console.warn("[admin-payroll] audit lookup failed:", err);
        }

        return jsonOk({ slip, member: memberInfo, audit });
      } catch (err) { return jsonError("select_slip_detail", err); }
    }

    // 일람
    try {
      const year = Number(url.searchParams.get("year") || 0);
      const month = Number(url.searchParams.get("month") || 0);
      if (!year || !month) return jsonBadRequest("year·month 필수");

      const rows = await db.select()
        .from(payrollSlips)
        .where(and(eq(payrollSlips.payYear, year), eq(payrollSlips.payMonth, month)))
        .orderBy(desc(payrollSlips.grossPay));

      // 회원 정보 separate query + Map (drizzle leftJoin 체인 금지 §6.3)
      const memberIds = Array.from(new Set(rows.map(r => Number(r.memberUid)).filter(n => !isNaN(n))));
      let memberMap = new Map<number, any>();
      if (memberIds.length > 0) {
        try {
          const ms = await db.select({
            id: members.id, name: members.name, email: members.email,
            role: members.role, milestoneRole: members.milestoneRole,
          }).from(members).where(inArray(members.id, memberIds));
          memberMap = new Map(ms.map(m => [m.id, m]));
        } catch (err) {
          console.warn("[admin-payroll] member batch lookup failed:", err);
        }
      }

      const enriched = rows.map(r => ({
        ...r,
        memberName: memberMap.get(Number(r.memberUid))?.name ?? null,
        memberEmail: memberMap.get(Number(r.memberUid))?.email ?? null,
        memberMilestoneRole: memberMap.get(Number(r.memberUid))?.milestoneRole ?? null,
      }));

      // 통계 카드용 카운트
      const counts = {
        DRAFT: 0, REVIEWED: 0, APPROVED: 0, SENT: 0, HOLD: 0, PAID: 0,
      };
      for (const r of rows) {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      }

      return jsonOk({ rows: enriched, counts, total: rows.length });
    } catch (err) { return jsonError("select_slips", err); }
  }

  // PATCH — 금액 직접편집·조정라인·검토메모·상태
  if (method === "PATCH") {
    if (!idNum) return jsonBadRequest("id 필수");
    let body: any;
    try { body = await req.json(); } catch { return jsonBadRequest("JSON 본문 필수"); }

    const MONEY_FIELDS = [
      "baseSalaryMonth", "overtimePay", "deductionUnpaid", "performanceBonus", "perfectBonus",
      "incomeTax", "localTax", "nationalPension", "healthInsurance", "longTermCare",
      "employmentInsurance", "otherDeduction",
    ];
    const SNAKE: Record<string, string> = {
      baseSalaryMonth: "base_salary_month", overtimePay: "overtime_pay", deductionUnpaid: "deduction_unpaid",
      performanceBonus: "performance_bonus", perfectBonus: "perfect_bonus",
      incomeTax: "income_tax", localTax: "local_tax", nationalPension: "national_pension",
      healthInsurance: "health_insurance", longTermCare: "long_term_care",
      employmentInsurance: "employment_insurance", otherDeduction: "other_deduction",
    };
    const isEdit = MONEY_FIELDS.some(f => f in body) || "adjustments" in body;

    try {
      const [cur] = await db.select().from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
      if (!cur) return jsonBadRequest("명세서를 찾을 수 없습니다");

      const update: any = { updatedAt: new Date() };
      const auditRows: Array<{ field: string; oldValue: string; newValue: string }> = [];

      if (isEdit) {
        const r2 = (n: number) => Math.round(n * 100) / 100;
        const next: Record<string, number> = {};
        for (const f of MONEY_FIELDS) {
          next[f] = (f in body) ? Number(body[f]) : Number((cur as any)[f] || 0);
          if (!Number.isFinite(next[f])) return jsonBadRequest(`${f} 숫자 오류`);
        }
        // 조정 라인 [{label, amount, kind:'ADD'|'DEDUCT', reason}]
        let adjustments: any[] = Array.isArray((cur as any).adjustments) ? (cur as any).adjustments : [];
        if ("adjustments" in body) {
          if (!Array.isArray(body.adjustments)) return jsonBadRequest("adjustments는 배열이어야 합니다");
          adjustments = body.adjustments.map((a: any) => ({
            label: String(a?.label || "").slice(0, 60),
            amount: Number(a?.amount) || 0,
            kind: a?.kind === "DEDUCT" ? "DEDUCT" : "ADD",
            reason: String(a?.reason || "").slice(0, 200),
          }));
        }
        const adjAdd = adjustments.filter(a => a.kind === "ADD").reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const adjDeduct = adjustments.filter(a => a.kind === "DEDUCT").reduce((s, a) => s + (Number(a.amount) || 0), 0);

        const grossPay = next.baseSalaryMonth + next.overtimePay - next.deductionUnpaid
          + next.performanceBonus + next.perfectBonus + adjAdd - adjDeduct;
        const totalDeduction = next.incomeTax + next.localTax + next.nationalPension
          + next.healthInsurance + next.longTermCare + next.employmentInsurance + next.otherDeduction;
        const netPay = grossPay - totalDeduction;

        for (const f of MONEY_FIELDS) {
          const oldV = Number((cur as any)[f] || 0);
          if (r2(oldV) !== r2(next[f])) {
            auditRows.push({ field: SNAKE[f], oldValue: String(r2(oldV)), newValue: String(r2(next[f])) });
          }
          update[f] = String(r2(next[f]));
        }
        if ("adjustments" in body) {
          const oldAdj = JSON.stringify((cur as any).adjustments || []);
          const newAdj = JSON.stringify(adjustments);
          if (oldAdj !== newAdj) auditRows.push({ field: "adjustments", oldValue: oldAdj.slice(0, 500), newValue: newAdj.slice(0, 500) });
          update.adjustments = adjustments;
        }
        update.grossPay = String(r2(grossPay));
        update.totalDeduction = String(r2(totalDeduction));
        update.netPay = String(r2(netPay));
        update.manuallyEdited = true;   // 재집계가 덮지 않도록 잠금
      }

      if (typeof body.reviewNote === "string") update.reviewNote = body.reviewNote;
      if (typeof body.status === "string") {
        const allowed = ["DRAFT", "REVIEWED", "APPROVED", "SENT", "HOLD"];
        if (!allowed.includes(body.status)) return jsonBadRequest("status 값 부적합 (PAID는 지급 확정 액션으로)");
        update.status = body.status;
        if (body.status === "REVIEWED") {
          update.reviewedBy = String(admin.id);
          update.reviewedAt = new Date();
        }
      }

      const [updated] = await db.update(payrollSlips).set(update)
        .where(eq(payrollSlips.id, idNum)).returning();
      if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");

      // 수정 이력 기록 (누가·무엇·사유)
      if (auditRows.length) {
        const reason = String(body.reason || "").slice(0, 200);
        try {
          await db.insert(payrollAudit).values(auditRows.map(a => ({
            slipId: idNum, changedBy: String(admin.id),
            field: a.field, oldValue: a.oldValue, newValue: a.newValue, reason,
          })));
        } catch (e) { console.warn("[admin-payroll] audit insert failed:", e); }
      }
      return jsonOk(updated);
    } catch (err) { return jsonError("update_slip", err); }
  }

  // POST — action 분기
  if (method === "POST") {
    const action = url.searchParams.get("action") || "";

    // 승인
    if (action === "approve") {
      if (!idNum) return jsonBadRequest("id 필수");
      try {
        const update: any = {
          status: "APPROVED",
          approvedBy: String(admin.id),
          approvedAt: new Date(),
          updatedAt: new Date(),
        };
        const [updated] = await db.update(payrollSlips).set(update)
          .where(eq(payrollSlips.id, idNum)).returning();
        if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
        return jsonOk(updated);
      } catch (err) { return jsonError("approve_slip", err); }
    }

    // 보류
    if (action === "hold") {
      if (!idNum) return jsonBadRequest("id 필수");
      let body: any = {};
      try { body = await req.json(); } catch { /* 본문 없어도 허용 */ }
      try {
        const update: any = { status: "HOLD", updatedAt: new Date() };
        if (typeof body.reviewNote === "string") update.reviewNote = body.reviewNote;
        const [updated] = await db.update(payrollSlips).set(update)
          .where(eq(payrollSlips.id, idNum)).returning();
        if (!updated) return jsonBadRequest("명세서를 찾을 수 없습니다");
        return jsonOk(updated);
      } catch (err) { return jsonError("hold_slip", err); }
    }

    // 지급 확정 (PAID·지급일·처리자 기록 — APPROVED/SENT에서만)
    if (action === "paid") {
      if (!idNum) return jsonBadRequest("id 필수");
      try {
        const [cur] = await db.select({ status: payrollSlips.status })
          .from(payrollSlips).where(eq(payrollSlips.id, idNum)).limit(1);
        if (!cur) return jsonBadRequest("명세서를 찾을 수 없습니다");
        if (!["APPROVED", "SENT"].includes(cur.status)) {
          return jsonBadRequest("승인(APPROVED) 또는 발송(SENT) 상태에서만 지급 확정 가능합니다");
        }
        const paidUpdate: any = {
          status: "PAID", paidBy: String(admin.id), paidAt: new Date(), updatedAt: new Date(),
        };
        const [updated] = await db.update(payrollSlips).set(paidUpdate)
          .where(eq(payrollSlips.id, idNum)).returning();
        return jsonOk(updated);
      } catch (err) { return jsonError("paid_slip", err); }
    }

    // 월별 수동 재집계 — lib/payroll-calc.ts 의 calculatePayrollForMonth 공유
    if (action === "recalculate") {
      const y = Number(url.searchParams.get("year") || 0);
      const m = Number(url.searchParams.get("month") || 0);
      if (!y || !m) return jsonBadRequest("year·month 필수");
      let body: any = {};
      try { body = await req.json(); } catch { /* 본문 없어도 허용 */ }
      const force = body?.force === true;
      try {
        const r = await calculatePayrollForMonth(y, m, { force });
        return jsonOk(r);
      } catch (err) { return jsonError("recalculate", err); }
    }

    return jsonBadRequest("action 값 부적합 (approve|hold|paid|recalculate)");
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
