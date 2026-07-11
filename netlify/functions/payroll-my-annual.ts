/**
 * GET /api/payroll-my-annual?year=2026[&pdf=1]
 *
 * 직원 본인 연간 급여 요약 — 연말정산·대출 서류 등에 쓰는 1년치 한 장.
 * 교부된 명세서(발송·지급완료)만 합산한다. pdf=1 이면 PDF로 내려받는다.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { generatePayrollAnnualPdf } from "../../lib/payroll-pdf";

export const config = { path: "/api/payroll-my-annual" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADER });
}
function jsonStepErr(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "연간 급여 요약 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status: 500, headers: JSON_HEADER });
}

const n = (v: any) => Number(v ?? 0) || 0;

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const me = (auth as any).ctx.member;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || 0);
  if (!year) return jsonErr("year 필수");

  let list: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT pay_month, working_days, base_salary_month, performance_bonus, gross_pay,
             national_pension, health_insurance, long_term_care, employment_insurance,
             income_tax, local_tax, other_deduction, total_deduction, net_pay,
             status, ack_status, paid_at
        FROM payroll_slips
       WHERE member_uid = ${String(me.id)} AND pay_year = ${year} AND status IN ('SENT','PAID')
       ORDER BY pay_month
    `);
    list = ((r as any).rows ?? r ?? []) as any[];
  } catch (err) { return jsonStepErr("select_annual", err); }

  const months = list.map(s => ({
    month: Number(s.pay_month),
    workingDays: n(s.working_days),
    baseSalary: n(s.base_salary_month),
    performanceBonus: n(s.performance_bonus),
    grossPay: n(s.gross_pay),
    nationalPension: n(s.national_pension),
    healthInsurance: n(s.health_insurance),
    longTermCare: n(s.long_term_care),
    employmentInsurance: n(s.employment_insurance),
    incomeTax: n(s.income_tax),
    localTax: n(s.local_tax),
    otherDeduction: n(s.other_deduction),
    totalDeduction: n(s.total_deduction),
    netPay: n(s.net_pay),
    acknowledged: s.ack_status === "ACKNOWLEDGED",
    paidAt: s.paid_at,
  }));

  const sum = (k: string) => months.reduce((a, m: any) => a + n(m[k]), 0);
  const totals = {
    monthCount: months.length,
    workingDays: sum("workingDays"),
    baseSalary: sum("baseSalary"),
    performanceBonus: sum("performanceBonus"),
    grossPay: sum("grossPay"),
    nationalPension: sum("nationalPension"),
    healthInsurance: sum("healthInsurance"),
    longTermCare: sum("longTermCare"),
    employmentInsurance: sum("employmentInsurance"),
    incomeTax: sum("incomeTax"),
    localTax: sum("localTax"),
    otherDeduction: sum("otherDeduction"),
    totalDeduction: sum("totalDeduction"),
    netPay: sum("netPay"),
  };

  const member = {
    id: me.id, name: me.name, email: me.email,
    role: me.milestoneRole || me.role || null,
  };
  const org = {
    name: process.env.ORG_NAME || "(사)교사유가족협의회",
    regNo: process.env.ORG_REGISTRATION_NO || "",
    representative: process.env.ORG_REPRESENTATIVE || "",
  };

  /* PDF */
  if (url.searchParams.get("pdf") === "1") {
    if (months.length === 0) return jsonErr(`${year}년에 교부된 명세서가 없습니다`, 404);
    try {
      const bytes = await generatePayrollAnnualPdf({ year, member, org, months, totals });
      const filename = `급여내역서_${year}_${String(member.name || "직원").replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
      const encoded = encodeURIComponent(filename);
      return new Response(Buffer.from(bytes) as any, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, no-store",
        },
      });
    } catch (err) { return jsonStepErr("generate_annual_pdf", err); }
  }

  return jsonOk({ year, member, org, months, totals });
}
