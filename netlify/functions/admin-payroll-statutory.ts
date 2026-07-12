/**
 * /api/admin-payroll-statutory — 법정 신고 자료
 *
 *   GET ?type=ledger&year=&month=       임금대장 (근로기준법 §48) — 귀속월 기준
 *   GET ?type=withholding&year=&month=  원천징수이행상황신고 자료 — 지급일 기준
 *   GET ?type=annual&year=              연간 급여·공제 집계 (지급명세서·연말정산용)
 *   GET ?type=insurance&year=           4대보험 보수총액 (연간)
 *
 *   &format=csv  → 엑셀(CSV) 내려받기
 *   &format=pdf  → 임금대장 PDF (type=ledger 에서만)
 *
 * 주민등록번호는 다루지 않는다 — 신고서에 옮겨 적을 '숫자'만 만든다.
 * 권한: super_admin 전용 (급여 열람 = 최고 민감 정보)
 */
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import {
  payrollLedger, withholdingReport, annualSummary, insuranceBase, simplifiedStatement,
} from "../../lib/payroll-statutory";
import { generatePayrollLedgerPdf } from "../../lib/payroll-ledger-pdf";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-payroll-statutory" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "신고 자료 생성 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function jsonBadRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

/** 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인다 */
function csvResponse(filename: string, header: string[], body: (string | number)[][]) {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(esc).join(","), ...body.map((r) => r.map(esc).join(","))];
  const csv = "﻿" + lines.join("\r\n");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

const won = (v: any) => Math.round(Number(v || 0));
const hhmm = (mins: any) => {
  const m = Math.round(Number(mins || 0));
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
};

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = (auth as any).ctx.member;
  if (admin.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "ledger";
  const format = url.searchParams.get("format") || "json";
  const year = Number(url.searchParams.get("year") || 0);
  const month = Number(url.searchParams.get("month") || 0);
  const org = process.env.ORG_NAME || "(사)교사유가족협의회";

  if (!year) return jsonBadRequest("year 필수");

  try {
    /* ── 1. 임금대장 (귀속월) ── */
    if (type === "ledger") {
      if (!month) return jsonBadRequest("month 필수");
      const { slips, totals } = await payrollLedger(year, month);

      if (format === "pdf") {
        if (slips.length === 0) return jsonBadRequest("해당 월에 확정된 명세서가 없습니다");
        const bytes = await generatePayrollLedgerPdf({ year, month, slips, totals, orgName: org });
        try {
          await logAdminAction(req, Number(admin.id), String(admin.name), "payroll_ledger_export", {
            target: `LEDGER-${year}-${month}`, detail: { format: "pdf", count: slips.length },
          });
        } catch { /* 로그 실패가 서류 발급을 막지 않는다 */ }
        return new Response(Buffer.from(bytes), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`임금대장_${year}년${String(month).padStart(2, "0")}월.pdf`)}`,
          },
        });
      }

      if (format === "csv") {
        return csvResponse(
          `임금대장_${year}년${String(month).padStart(2, "0")}월.csv`,
          ["사번", "성명", "직책", "입사일", "근로일수", "근로시간", "연장근로",
           "기본급", "연장근로수당", "성과금", "만근수당", "조정(과세)", "조정(비과세)", "조정(차감)",
           "지급총액", "비과세", "과세대상액",
           "국민연금", "건강보험", "장기요양", "고용보험", "소득세", "지방소득세", "기타공제", "공제총액",
           "실지급액", "상태"],
          slips.map((s) => [
            s.memberUid, s.name, s.position, s.hireDate ?? "",
            s.workingDays, hhmm(s.workingMins), hhmm(s.overtimeMins),
            won(s.baseSalary), won(s.overtimePay), won(s.performanceBonus), won(s.perfectBonus),
            won(s.adjustTaxable), won(s.adjustNonTaxable), won(s.adjustDeduct),
            won(s.grossPay), won(s.nonTaxable), won(s.taxableBase),
            won(s.nationalPension), won(s.healthInsurance), won(s.longTermCare), won(s.employmentInsurance),
            won(s.incomeTax), won(s.localTax), won(s.otherDeduction), won(s.totalDeduction),
            won(s.netPay), s.status,
          ]),
        );
      }

      return jsonOk({ year, month, orgName: org, slips, totals });
    }

    /* ── 2. 원천징수이행상황신고 (지급일) ── */
    if (type === "withholding") {
      if (!month) return jsonBadRequest("month 필수");
      const rep = await withholdingReport(year, month);

      if (format === "csv") {
        return csvResponse(
          `원천징수_${year}년${String(month).padStart(2, "0")}월지급분.csv`,
          ["성명", "지급일", "귀속월", "총지급액(과세)", "소득세", "지방소득세"],
          [
            ...rep.detail.map((d) => [
              d.name,
              d.paidAt ? new Date(d.paidAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "",
              d.belongsTo, won(d.totalPaid), won(d.incomeTax), won(d.localTax),
            ]),
            ["합계", `인원 ${rep.headcount}명`, "", won(rep.totalPaid), won(rep.incomeTax), won(rep.localTax)],
          ],
        );
      }

      return jsonOk({ ...rep, orgName: org });
    }

    /* ── 3. 연간 급여·공제 집계 (지급명세서·연말정산) ── */
    if (type === "annual") {
      const a = await annualSummary(year);

      if (format === "csv") {
        return csvResponse(
          `연간급여집계_${year}년.csv`,
          ["사번", "성명", "직책", "입사일", "지급월수", "지급월",
           "지급총액", "비과세", "총급여(과세)",
           "국민연금", "건강보험", "장기요양", "고용보험", "소득세", "지방소득세", "실수령액"],
          [
            ...a.rows.map((r) => [
              r.memberUid, r.name, r.position, r.hireDate ?? "", r.months, r.monthList,
              won(r.grossPay), won(r.nonTaxable), won(r.taxableBase),
              won(r.nationalPension), won(r.healthInsurance), won(r.longTermCare), won(r.employmentInsurance),
              won(r.incomeTax), won(r.localTax), won(r.netPay),
            ]),
            ["", "합계", "", "", a.totals.months, "",
             won(a.totals.grossPay), won(a.totals.nonTaxable), won(a.totals.taxableBase),
             won(a.totals.nationalPension), won(a.totals.healthInsurance), won(a.totals.longTermCare),
             won(a.totals.employmentInsurance), won(a.totals.incomeTax), won(a.totals.localTax), won(a.totals.netPay)],
          ],
        );
      }

      return jsonOk({ year, orgName: org, ...a });
    }

    /* ── 5. 간이지급명세서(근로소득) — 반기 제출용 금액·근무기간
     *
     * 엑셀 파일은 여기서 만들지 않는다. 양식에 주민등록번호가 들어가는데,
     * 그 값이 서버를 거치면 로그·메모리·에러 리포트에 남을 수 있다.
     * → 화면(브라우저)이 국세청 양식(public/forms)을 직접 채워 내려받는다.
     *   이 API는 '금액과 근무기간'만 준다. 주민번호는 서버에 오지 않는다. */
    if (type === "simplified") {
      const half = Number(url.searchParams.get("half") || 1) === 2 ? 2 : 1;
      const d = await simplifiedStatement(year, half);
      return jsonOk({ ...d, orgName: org });
    }

    /* ── 4. 4대보험 보수총액 (연간) ── */
    if (type === "insurance") {
      const ins = await insuranceBase(year);

      if (format === "csv") {
        return csvResponse(
          `4대보험_보수총액_${year}년.csv`,
          ["사번", "성명", "입사일", "산정월수", "연간 보수총액(과세)", "월평균 보수"],
          [
            ...ins.rows.map((r) => [r.memberUid, r.name, r.hireDate ?? "", r.months, won(r.annualTaxable), won(r.monthlyAverage)]),
            ["", "합계", "", "", won(ins.total), ""],
          ],
        );
      }

      return jsonOk({ year, orgName: org, ...ins });
    }

    return jsonBadRequest("type은 ledger | withholding | simplified | annual | insurance 여야 합니다");
  } catch (err) {
    return jsonError(`build_${type}`, err);
  }
}
