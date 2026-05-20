/**
 * GET /api/payroll-my?year=
 *
 * 본인 월별 명세서 일람. status≥SENT(발송 완료·지급 완료 PAID)만 노출.
 * 권한: requireOperator (운영자 본인만).
 *
 * R37 1일차 — 골격 + 본 동작 (별도 5일차 로직 의존 없음).
 */
import { db } from "../../db/index";
import { payrollSlips } from "../../db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";

export const config = { path: "/api/payroll-my" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "본인 급여 명세서 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const me = (auth as any).ctx.member;

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : null;

  try {
    const conds = [
      eq(payrollSlips.memberUid, String(me.id)),
      inArray(payrollSlips.status, ["SENT", "PAID"]),
    ];
    if (year) conds.push(eq(payrollSlips.payYear, year));

    const rows = await db.select({
      id: payrollSlips.id,
      payYear: payrollSlips.payYear,
      payMonth: payrollSlips.payMonth,
      workingDays: payrollSlips.workingDays,
      workingMins: payrollSlips.workingMins,
      overtimeMins: payrollSlips.overtimeMins,
      paidLeaveDays: payrollSlips.paidLeaveDays,
      unpaidLeaveDays: payrollSlips.unpaidLeaveDays,
      perfectAttendance: payrollSlips.perfectAttendance,
      baseSalaryMonth: payrollSlips.baseSalaryMonth,
      overtimePay: payrollSlips.overtimePay,
      deductionUnpaid: payrollSlips.deductionUnpaid,
      performanceBonus: payrollSlips.performanceBonus,
      perfectBonus: payrollSlips.perfectBonus,
      grossPay: payrollSlips.grossPay,
      // 공제·실수령 (급여 고도화 2026-05-20)
      adjustments: payrollSlips.adjustments,
      incomeTax: payrollSlips.incomeTax,
      localTax: payrollSlips.localTax,
      nationalPension: payrollSlips.nationalPension,
      healthInsurance: payrollSlips.healthInsurance,
      longTermCare: payrollSlips.longTermCare,
      employmentInsurance: payrollSlips.employmentInsurance,
      otherDeduction: payrollSlips.otherDeduction,
      totalDeduction: payrollSlips.totalDeduction,
      netPay: payrollSlips.netPay,
      status: payrollSlips.status,
      sentAt: payrollSlips.sentAt,
      paidAt: payrollSlips.paidAt,
      pdfUrl: payrollSlips.pdfUrl,
    }).from(payrollSlips)
      .where(and(...conds))
      .orderBy(desc(payrollSlips.payYear), desc(payrollSlips.payMonth));

    return jsonOk({ rows, total: rows.length });
  } catch (err) { return jsonError("select_my_slips", err); }
}
