// lib/payroll-pdf.ts
// R37 PDF 명세서 생성 — admin-payroll-pdf + payroll-my-pdf + 5일차 이메일 첨부 공유.
// 설계서 §5 — A4 1페이지 레이아웃.
// pdf-lib + @pdf-lib/fontkit + NotoSansKR (assets/fonts/NotoSansKR-Regular.ttf).

import { PDFDocument, rgb, PDFPage, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf"));
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
}

export interface PayrollSlipPdfInput {
  slip: {
    payYear: number;
    payMonth: number;
    workingDays: number | string;
    workingMins: number | string;
    overtimeMins: number | string;
    lateCount: number | string;
    absentCount: number | string;
    paidLeaveDays: number | string;
    unpaidLeaveDays: number | string;
    perfectAttendance: boolean;
    baseSalaryMonth: number | string;
    overtimePay: number | string;
    deductionUnpaid: number | string;
    performanceBonus: number | string;
    perfectBonus: number | string;
    grossPay: number | string;
    // 공제·실수령·조정 (급여 고도화 2026-05-20)
    adjustments?: Array<{ label?: string; amount?: number | string; kind?: string; reason?: string }> | null;
    incomeTax?: number | string;
    localTax?: number | string;
    nationalPension?: number | string;
    healthInsurance?: number | string;
    longTermCare?: number | string;
    employmentInsurance?: number | string;
    otherDeduction?: number | string;
    totalDeduction?: number | string;
    netPay?: number | string;
    status: string;
    sentAt?: Date | string | null;
    approvedAt?: Date | string | null;
    paidAt?: Date | string | null;
  };
  member: {
    name: string;
    email?: string | null;
    role?: string | null;
    milestoneRole?: string | null;
  };
  orgName?: string;
}

const won = (n: number | string) =>
  `${Math.round(Number(n || 0)).toLocaleString("ko-KR")} 원`;

const hours = (m: number | string) => {
  const n = Number(m || 0);
  const h = Math.floor(n / 60);
  const remain = n % 60;
  return remain === 0 ? `${h}시간` : `${h}시간 ${remain}분`;
};

interface DrawCtx {
  page: PDFPage;
  font: PDFFont;
  y: number;
  width: number;
  height: number;
  margin: number;
}

function text(ctx: DrawCtx, str: string, x: number, size: number, color = rgb(0, 0, 0)) {
  ctx.page.drawText(str, { x, y: ctx.y, size, font: ctx.font, color });
}
function textRight(ctx: DrawCtx, str: string, rightX: number, size: number, color = rgb(0, 0, 0)) {
  const w = ctx.font.widthOfTextAtSize(str, size);
  ctx.page.drawText(str, { x: rightX - w, y: ctx.y, size, font: ctx.font, color });
}
function hr(ctx: DrawCtx, thickness = 0.8, color = rgb(0.5, 0.5, 0.5)) {
  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.y },
    end: { x: ctx.width - ctx.margin, y: ctx.y },
    thickness, color,
  });
}

export async function generatePayrollSlipPdf(input: PayrollSlipPdfInput): Promise<Uint8Array> {
  const { slip, member } = input;
  const orgName = input.orgName || process.env.ORG_NAME || "(사)교사유가족협의회";

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);
  const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });

  const page = pdfDoc.addPage([595, 842]);   // A4
  const ctx: DrawCtx = {
    page, font,
    y: 842 - 60, width: 595, height: 842, margin: 60,
  };
  const rightX = ctx.width - ctx.margin;
  const issuedAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  // ── 머리말 ──
  text(ctx, orgName, ctx.margin, 11, rgb(0.3, 0.3, 0.3));
  ctx.y -= 30;
  text(ctx, "급여명세서", ctx.margin, 22);
  ctx.y -= 22;
  text(ctx, `${slip.payYear}년 ${String(slip.payMonth).padStart(2, "0")}월`,
       ctx.margin, 13, rgb(0.2, 0.2, 0.2));
  textRight(ctx, `발행일: ${issuedAt}`, rightX, 9, rgb(0.5, 0.5, 0.5));
  ctx.y -= 12;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 24;

  // ── 직원 정보 ──
  text(ctx, "성명", ctx.margin, 10, rgb(0.4, 0.4, 0.4));
  text(ctx, member.name, ctx.margin + 70, 11);
  textRight(ctx, member.email || "", rightX, 9.5, rgb(0.4, 0.4, 0.4));
  ctx.y -= 18;
  text(ctx, "직책", ctx.margin, 10, rgb(0.4, 0.4, 0.4));
  const role = member.milestoneRole || member.role || "-";
  text(ctx, role, ctx.margin + 70, 11);
  ctx.y -= 24;

  hr(ctx);
  ctx.y -= 22;

  // ── 근태 현황 ──
  text(ctx, "근태 현황", ctx.margin, 13, rgb(0.1, 0.1, 0.4));
  ctx.y -= 22;
  const labelX = ctx.margin + 16;
  const colA = labelX, colAVal = 250;
  const colB = 320, colBVal = rightX;

  const attRows: Array<[string, string, string, string]> = [
    ["출근 일수", `${slip.workingDays}일`, "총 근무", hours(slip.workingMins)],
    ["지각", `${slip.lateCount}회`, "결근", `${slip.absentCount}회`],
    ["유급 휴가", `${slip.paidLeaveDays}일`, "무급 휴가", `${slip.unpaidLeaveDays}일`],
    ["만근", slip.perfectAttendance ? "예" : "아니오", "", ""],
  ];
  /* 2026-06-03 일급제(B): 일급 산정 근거 + 미산입(무급) 일수 표기 */
  const _dv: any = ((slip as any).calculationSnapshot && (slip as any).calculationSnapshot.derived) || {};
  if (_dv.dailyWage != null) {
    const _biz = _dv.monthBusinessDays;
    const _pay = _dv.paidDays != null ? _dv.paidDays : slip.workingDays;
    attRows.push(["영업일수", _biz != null ? `${_biz}일` : "—", "일급", won(_dv.dailyWage)]);
    const _unpaid = _biz != null ? Math.max(0, _biz - _pay) : null;
    attRows.push(["지급일(출근+유급)", `${_pay}일`, "미산입(무급)", _unpaid != null ? `${_unpaid}일` : "—"]);
  }
  for (const [aLabel, aVal, bLabel, bVal] of attRows) {
    text(ctx, aLabel, colA, 10, rgb(0.4, 0.4, 0.4));
    textRight(ctx, aVal, colAVal, 10);
    text(ctx, bLabel, colB, 10, rgb(0.4, 0.4, 0.4));
    textRight(ctx, bVal, colBVal, 10);
    ctx.y -= 18;
  }
  ctx.y -= 6;
  hr(ctx);
  ctx.y -= 22;

  // ── 급여 구성 (지급 항목) ──
  text(ctx, "지급 항목", ctx.margin, 13, rgb(0.1, 0.1, 0.4));
  ctx.y -= 22;

  type Row = [string, string, "plus" | "minus" | "calc"];
  /* 2026-06-03: 출근일 기반 일급제 — 기본급=출근일×일급. 무급차감은 분모 처리로 항상 0이라
     0일 때 줄 숨김(혼란 방지). 라벨도 일급제 기준으로 정정. */
  const payRows: Row[] = [
    ["기본급(출근일 기반)", won(slip.baseSalaryMonth), "plus"],
  ];
  if (Number(slip.deductionUnpaid) > 0) payRows.push(["무급 차감", won(slip.deductionUnpaid), "minus"]);
  payRows.push(["성과 보너스", won(slip.performanceBonus), "plus"]);
  if (Number(slip.perfectBonus) > 0) payRows.push(["만근 보너스", won(slip.perfectBonus), "plus"]);
  // 조정 라인 (수기 가감)
  const adjList = Array.isArray(slip.adjustments) ? slip.adjustments : [];
  for (const a of adjList) {
    const isDeduct = a?.kind === "DEDUCT";
    const label = `조정: ${String(a?.label || "").slice(0, 30)}`;
    payRows.push([label, won(a?.amount), isDeduct ? "minus" : "plus"]);
  }
  for (const [label, val, kind] of payRows) {
    const sign = kind === "minus" ? "−" : "+";
    const color = kind === "minus" ? rgb(0.6, 0.1, 0.1) : rgb(0.1, 0.35, 0.1);
    text(ctx, `${sign}  ${label}`, labelX, 11, color);
    textRight(ctx, val, rightX, 11);
    ctx.y -= 18;
  }

  ctx.y -= 2;
  hr(ctx, 0.8, rgb(0.4, 0.4, 0.4));
  ctx.y -= 18;
  text(ctx, "세전 총액 (Gross Pay)", ctx.margin, 12, rgb(0.1, 0.1, 0.5));
  textRight(ctx, won(slip.grossPay), rightX, 12, rgb(0.1, 0.1, 0.5));
  ctx.y -= 24;

  // ── 공제 내역 ──
  text(ctx, "공제 항목", ctx.margin, 13, rgb(0.4, 0.1, 0.1));
  ctx.y -= 22;
  const dedRows: Array<[string, number | string]> = [
    ["국민연금",     slip.nationalPension ?? 0],
    ["건강보험",     slip.healthInsurance ?? 0],
    ["장기요양",     slip.longTermCare ?? 0],
    ["고용보험",     slip.employmentInsurance ?? 0],
    ["소득세",       slip.incomeTax ?? 0],
    ["지방소득세",   slip.localTax ?? 0],
  ];
  if (Number(slip.otherDeduction || 0) !== 0) dedRows.push(["기타 공제", slip.otherDeduction ?? 0]);
  for (const [label, val] of dedRows) {
    text(ctx, `−  ${label}`, labelX, 11, rgb(0.5, 0.15, 0.15));
    textRight(ctx, won(val), rightX, 11);
    ctx.y -= 18;
  }
  ctx.y -= 2;
  hr(ctx, 0.8, rgb(0.4, 0.4, 0.4));
  ctx.y -= 18;
  text(ctx, "공제 합계", ctx.margin, 12, rgb(0.4, 0.1, 0.1));
  textRight(ctx, won(slip.totalDeduction), rightX, 12, rgb(0.4, 0.1, 0.1));
  ctx.y -= 24;

  // ── 실수령액 ──
  hr(ctx, 1, rgb(0.1, 0.1, 0.1));
  ctx.y -= 22;
  text(ctx, "실수령액 (Net Pay)", ctx.margin, 14, rgb(0.05, 0.2, 0.05));
  textRight(ctx, won(slip.netPay), rightX, 16, rgb(0.05, 0.2, 0.05));
  ctx.y -= 28;

  // ── 안내 ──
  hr(ctx, 0.4, rgb(0.7, 0.7, 0.7));
  ctx.y -= 18;
  text(ctx, "※ 실수령액은 세전 총액에서 소득세·4대보험 등 공제를 차감한 금액입니다.", ctx.margin, 9, rgb(0.5, 0.5, 0.5));
  ctx.y -= 13;
  if (slip.approvedAt) {
    const d = new Date(slip.approvedAt as any).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    text(ctx, `※ 승인일: ${d}`, ctx.margin, 9, rgb(0.5, 0.5, 0.5));
    ctx.y -= 13;
  }
  if (slip.sentAt) {
    const d = new Date(slip.sentAt as any).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    text(ctx, `※ 발송일: ${d}`, ctx.margin, 9, rgb(0.5, 0.5, 0.5));
    ctx.y -= 13;
  }
  if (slip.paidAt) {
    const d = new Date(slip.paidAt as any).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    text(ctx, `※ 지급일: ${d}`, ctx.margin, 9, rgb(0.5, 0.5, 0.5));
    ctx.y -= 13;
  }

  return await pdfDoc.save();
}

export function payrollSlipFilename(slip: PayrollSlipPdfInput["slip"], memberName: string): string {
  const m = String(slip.payMonth).padStart(2, "0");
  const safeName = memberName.replace(/[\\/:*?"<>|]/g, "_");
  return `급여명세서_${slip.payYear}_${m}_${safeName}.pdf`;
}
