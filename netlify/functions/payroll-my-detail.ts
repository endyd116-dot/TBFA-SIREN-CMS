/**
 * GET /api/payroll-my-detail?id=N
 *
 * 직원 본인 급여명세서 상세 — 서류 모달이 읽는 데이터.
 * 금액뿐 아니라 '어떻게 나온 금액인지(계산방법)'를 함께 준다 (근로기준법상 임금명세서 기재사항).
 *
 * - 본인 명세서만 (다른 직원 것은 조회 불가)
 * - 교부된 것(발송·지급완료)만 — 아직 검토 중인 초안은 보이지 않는다
 * - 처음 열어본 시각을 기록한다 (교부 증빙)
 * - 이미 서명했으면 서명 증적도 함께 준다
 */
import { isoUTC } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { buildPayrollBreakdown, positionLabelOf } from "../../lib/payroll-breakdown";

export const config = { path: "/api/payroll-my-detail" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADER });
}
function jsonStepErr(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "급여명세서 상세 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status: 500, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  const me = (auth as any).ctx.member;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || 0);
  if (!id) return jsonErr("id 필수");

  /* 1) 본인 명세서 + 교부된 것만 */
  let slip: any;
  try {
    const r: any = await db.execute(sql`
      SELECT * FROM payroll_slips
       WHERE id = ${id}
         AND member_uid = ${String(me.id)}
         AND status IN ('SENT', 'PAID')
       LIMIT 1
    `);
    slip = ((r as any).rows ?? r ?? [])[0];
    if (!slip) return jsonErr("명세서를 찾을 수 없습니다 (본인에게 교부된 명세서만 볼 수 있습니다)", 404);
  } catch (err) { return jsonStepErr("select_slip", err); }

  /* 2) 첫 열람 기록 — 교부 증빙 (실패해도 조회는 계속) */
  const wasFirstView = !slip.first_viewed_at;
  if (wasFirstView) {
    try {
      await db.execute(sql`
        UPDATE payroll_slips SET first_viewed_at = NOW(), updated_at = NOW()
         WHERE id = ${id} AND first_viewed_at IS NULL
      `);
      await db.execute(sql`
        INSERT INTO payroll_acknowledgments
          (slip_id, member_uid, document_version, action, document_r2_key, document_sha256, ip, user_agent)
        VALUES
          (${id}, ${String(me.id)}, ${Number(slip.document_version || 1)}, 'VIEWED',
           ${slip.document_r2_key ?? null}, ${slip.document_sha256 ?? null},
           ${req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for") ?? null},
           ${String(req.headers.get("user-agent") ?? "").slice(0, 500)})
      `);
    } catch (err) {
      console.warn("[payroll-my-detail] 열람 기록 실패(무시):", err);
    }
  }

  /* 3) 계산근거 — 저장된 스냅샷 기준 (여기서 새로 계산하지 않는다) */
  const camel = {
    ...slip,
    payYear: slip.pay_year, payMonth: slip.pay_month,
    workingDays: slip.working_days, workingMins: slip.working_mins, overtimeMins: slip.overtime_mins,
    lateCount: slip.late_count, absentCount: slip.absent_count,
    paidLeaveDays: slip.paid_leave_days, unpaidLeaveDays: slip.unpaid_leave_days,
    perfectAttendance: slip.perfect_attendance,
    baseSalaryMonth: slip.base_salary_month, overtimePay: slip.overtime_pay,
    deductionUnpaid: slip.deduction_unpaid, performanceBonus: slip.performance_bonus,
    perfectBonus: slip.perfect_bonus, grossPay: slip.gross_pay,
    nationalPension: slip.national_pension, healthInsurance: slip.health_insurance,
    longTermCare: slip.long_term_care, employmentInsurance: slip.employment_insurance,
    incomeTax: slip.income_tax, localTax: slip.local_tax,
    otherDeduction: slip.other_deduction, totalDeduction: slip.total_deduction, netPay: slip.net_pay,
    calculationSnapshot: slip.calculation_snapshot,
  };
  let breakdown: any;
  try { breakdown = buildPayrollBreakdown(camel); }
  catch (err) { return jsonStepErr("build_breakdown", err); }

  /* 4) 서명 증적 (있으면) — 보조 조회, 실패해도 빈 값으로 계속 */
  let signature: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, action, signature_type, signed_name, consent_items, created_at, ip, document_version
        FROM payroll_acknowledgments
       WHERE slip_id = ${id} AND action = 'ACKNOWLEDGED'
       ORDER BY created_at DESC LIMIT 1
    `);
    const row = ((r as any).rows ?? r ?? [])[0];
    if (row) {
      signature = {
        signedName: row.signed_name,
        signatureType: row.signature_type,
        consentItems: row.consent_items ?? [],
        signedAt: isoUTC(row.created_at),
        documentVersion: row.document_version,
      };
    }
  } catch (err) { console.warn("[payroll-my-detail] 서명 증적 조회 실패:", err); }

  /* 5) 이의제기 내역 (있으면) */
  let objection: any = null;
  try {
    const r: any = await db.execute(sql`
      SELECT id, reason, status, resolution_note, resolved_at, created_at
        FROM payroll_objections
       WHERE slip_id = ${id}
       ORDER BY created_at DESC LIMIT 1
    `);
    const row = ((r as any).rows ?? r ?? [])[0];
    if (row) {
      objection = {
        id: row.id, reason: row.reason, status: row.status,
        resolutionNote: row.resolution_note, resolvedAt: isoUTC(row.resolved_at), createdAt: isoUTC(row.created_at),
      };
    }
  } catch (err) { console.warn("[payroll-my-detail] 이의제기 조회 실패:", err); }

  /* 6) 협회 정보 (서류 머리말) */
  const org = {
    name: process.env.ORG_NAME || "(사)교사유가족협의회",
    regNo: process.env.ORG_REGISTRATION_NO || "",
    representative: process.env.ORG_REPRESENTATIVE || "",
    address: process.env.ORG_ADDRESS || "",
  };

  return jsonOk({
    slip: {
      id: slip.id,
      payYear: slip.pay_year,
      payMonth: slip.pay_month,
      status: slip.status,
      issuedAt: slip.issued_at ?? slip.sent_at,
      paidAt: isoUTC(slip.paid_at),
      documentVersion: Number(slip.document_version || 1),
      documentSha256: slip.document_sha256,
      ackStatus: slip.ack_status || "PENDING",
      ackAt: isoUTC(slip.ack_at),
      firstViewedAt: isoUTC(slip.first_viewed_at),
      hasSignedDocument: !!slip.signed_document_r2_key,
    },
    member: { id: me.id, name: me.name, email: me.email, role: positionLabelOf(me as any) },
    org,
    breakdown,
    signature,
    objection,
  });
}
