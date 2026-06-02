/**
 * GET /api/admin-payroll-export?year=&month=
 *
 * 회계 시스템용 CSV export. UTF-8 BOM 포함 (한글 엑셀 호환).
 * 컬럼: 회원UID·이름·이메일·연도·월·근무일·총근무분·야근분·지각·결근·유급휴가·무급휴가·만근여부·
 *       월기본급·야근수당·무급차감·성과보너스·만근보너스·조정합계·세전총액·
 *       소득세·지방소득세·국민연금·건강보험·장기요양·고용보험·기타공제·공제합계·실수령액·상태·승인일·발송일·지급일
 *
 * R37 1일차 — 골격 + 실 CSV 출력 (외부 라이브러리 없이 직접 생성).
 * 권한: super_admin 전용.
 */
import { db } from "../../db/index";
import { payrollSlips, members } from "../../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-payroll-export" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "급여 CSV export 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}
function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return "\"" + s.replace(/"/g, "\"\"") + "\"";
  }
  return s;
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || 0);
  const month = Number(url.searchParams.get("month") || 0);
  if (!year || !month) {
    return new Response(JSON.stringify({ ok: false, error: "year·month 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rows = await db.select().from(payrollSlips)
      .where(and(eq(payrollSlips.payYear, year), eq(payrollSlips.payMonth, month)));

    // 회원 정보 separate query + Map
    const memberIds = Array.from(new Set(rows.map(r => Number(r.memberUid)).filter(n => !isNaN(n))));
    let memberMap = new Map<number, { name: string; email: string }>();
    if (memberIds.length > 0) {
      try {
        const ms = await db.select({
          id: members.id, name: members.name, email: members.email,
        }).from(members).where(inArray(members.id, memberIds));
        memberMap = new Map(ms.map(m => [m.id, { name: m.name, email: m.email }]));
      } catch (err) {
        console.warn("[admin-payroll-export] member lookup failed:", err);
      }
    }

    const header = [
      "회원UID", "이름", "이메일", "연도", "월",
      "근무일수", "총근무분", "지각횟수", "결근횟수",
      "유급휴가일", "무급휴가일", "만근여부",
      "기본급(출근일기반)", "성과보너스", "만근보너스", "조정합계", "세전총액",
      "소득세", "지방소득세", "국민연금", "건강보험", "장기요양", "고용보험", "기타공제", "공제합계", "실수령액",
      "상태", "승인일", "발송일", "지급일",
    ];
    const lines: string[] = [header.map(csvEscape).join(",")];
    for (const r of rows) {
      const m = memberMap.get(Number(r.memberUid));
      // 조정 라인 합계 (ADD − DEDUCT)
      const adj = Array.isArray(r.adjustments) ? (r.adjustments as any[]) : [];
      const adjNet = adj.reduce((s, a) =>
        s + (a?.kind === "DEDUCT" ? -(Number(a?.amount) || 0) : (Number(a?.amount) || 0)), 0);
      lines.push([
        r.memberUid, m?.name ?? "", m?.email ?? "", r.payYear, r.payMonth,
        r.workingDays, r.workingMins, r.lateCount, r.absentCount,
        r.paidLeaveDays, r.unpaidLeaveDays, r.perfectAttendance ? "Y" : "N",
        r.baseSalaryMonth, r.performanceBonus, r.perfectBonus, adjNet, r.grossPay,
        r.incomeTax, r.localTax, r.nationalPension, r.healthInsurance, r.longTermCare, r.employmentInsurance, r.otherDeduction, r.totalDeduction, r.netPay,
        r.status,
        r.approvedAt ? new Date(r.approvedAt as any).toISOString().slice(0, 10) : "",
        r.sentAt ? new Date(r.sentAt as any).toISOString().slice(0, 10) : "",
        r.paidAt ? new Date(r.paidAt as any).toISOString().slice(0, 10) : "",
      ].map(csvEscape).join(","));
    }

    const csv = "﻿" + lines.join("\r\n");
    const filename = `payroll-${year}-${String(month).padStart(2, "0")}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) { return jsonError("export_csv", err); }
}
