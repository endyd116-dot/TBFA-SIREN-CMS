// lib/payroll-ledger-pdf.ts
// 임금대장 PDF — 근로기준법 제48조 · 시행령 제27조 법정 기재사항.
//
// 사업주가 작성·보존(3년)해야 하는 서류다. 근로감독 나오면 이걸 본다.
// 법정 기재사항 (시행령 §27):
//   ① 성명 ② 근로자를 특정할 수 있는 정보(사번) ③ 고용연월일 ④ 종사하는 업무
//   ⑤ 임금·가족수당의 계산기초 ⑥ 근로일수 ⑦ 근로시간수 ⑧ 연장·야간·휴일근로 시간수
//   ⑨ 기본급·수당 등 임금의 내역별 금액 ⑩ 공제 항목별 금액과 총액
//
// ⚠️ 한글 폰트는 통째로(subset: false) 넣고, 글자는 하나씩 배치한다.
//    이유는 lib/payroll-pdf.ts 상단 주석 참고 (subset을 켜면 글자가 사라지고,
//    문장을 통째로 그리면 숫자·공백이 전각 폭으로 벌어진다 — 2026-07-12 실측).

import { PDFDocument, rgb, PDFPage, PDFFont, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StatutorySlip, LedgerTotals } from "./payroll-statutory";

let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf"));
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
}

export interface PayrollLedgerPdfInput {
  year: number;
  month: number;
  slips: StatutorySlip[];
  totals: LedgerTotals;
  orgName: string;
}

const A4L_W = 842, A4L_H = 595, MARGIN = 30;

interface Ctx { doc: PDFDocument; page: PDFPage; font: PDFFont; y: number }

/** 글자를 하나씩 실측 폭만큼 전진시키며 그린다 (문장 통째로 그리면 벌어진다) */
function run(ctx: Ctx, s: string, x: number, y: number, size: number, color: RGB) {
  let cx = x;
  for (const ch of Array.from(String(s ?? ""))) {
    const w = ctx.font.widthOfTextAtSize(ch, size);
    if (ch.trim()) ctx.page.drawText(ch, { x: cx, y, size, font: ctx.font, color });
    cx += w;
  }
}
function runRight(ctx: Ctx, s: string, rightX: number, y: number, size: number, color: RGB) {
  const str = String(s ?? "");
  run(ctx, str, rightX - ctx.font.widthOfTextAtSize(str, size), y, size, color);
}
function line(ctx: Ctx, y: number, x1: number, x2: number, thickness = 0.5, color: RGB = rgb(0.75, 0.75, 0.75)) {
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

const won = (v: any) => Math.round(Number(v || 0)).toLocaleString("ko-KR");
const hm = (mins: any) => {
  const m = Math.round(Number(mins || 0));
  return m > 0 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : "-";
};
const days = (v: any) => {
  const d = Number(v || 0);
  return Number.isInteger(d) ? String(d) : d.toFixed(2).replace(/0$/, "");
};

/* 열 정의 — 임금대장은 항목이 많아 가로 A4를 꽉 쓴다.
   지급 항목과 공제 항목을 색으로 갈라 눈이 헤매지 않게 한다. */
interface Col { key: string; label: string; w: number; align?: "l" | "r"; group?: "pay" | "ded" }
const COLS: Col[] = [
  { key: "name",                label: "성명",     w: 46, align: "l" },
  { key: "memberUid",           label: "사번",     w: 26 },
  { key: "position",            label: "직책",     w: 46, align: "l" },
  { key: "hireDate",            label: "입사일",   w: 50, align: "l" },
  { key: "workingDays",         label: "근로일",   w: 30 },
  { key: "workingMins",         label: "근로시간", w: 38 },
  { key: "overtimeMins",        label: "연장",     w: 30 },

  { key: "baseSalary",          label: "기본급",       w: 56, group: "pay" },
  { key: "overtimePay",         label: "연장수당",     w: 46, group: "pay" },
  { key: "performanceBonus",    label: "성과금",       w: 44, group: "pay" },
  { key: "adjustTaxable",       label: "수당(과세)",   w: 48, group: "pay" },
  { key: "adjustNonTaxable",    label: "수당(비과세)", w: 52, group: "pay" },
  { key: "grossPay",            label: "지급총액",     w: 58, group: "pay" },

  { key: "nationalPension",     label: "국민연금",   w: 46, group: "ded" },
  { key: "healthInsurance",     label: "건강보험",   w: 46, group: "ded" },
  { key: "longTermCare",        label: "장기요양",   w: 42, group: "ded" },
  { key: "employmentInsurance", label: "고용보험",   w: 42, group: "ded" },
  { key: "incomeTax",           label: "소득세",     w: 42, group: "ded" },
  { key: "localTax",            label: "지방세",     w: 38, group: "ded" },
  { key: "totalDeduction",      label: "공제총액",   w: 52, group: "ded" },

  { key: "netPay",              label: "실지급액",   w: 60 },
];

function cellText(s: StatutorySlip, key: string): string {
  switch (key) {
    case "name":         return s.name;
    case "memberUid":    return String(s.memberUid);
    case "position":     return s.position;
    case "hireDate":     return s.hireDate ?? "-";
    case "workingDays":  return days(s.workingDays);
    case "workingMins":  return hm(s.workingMins);
    case "overtimeMins": return hm(s.overtimeMins);
    default:             return won((s as any)[key]);
  }
}

export async function generatePayrollLedgerPdf(input: PayrollLedgerPdfInput): Promise<Uint8Array> {
  const { year, month, slips, totals, orgName } = input;
  const orgRegNo = process.env.ORG_REGISTRATION_NO || "";
  const orgRep = process.env.ORG_REPRESENTATIVE || "";

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as any);
  const font = await doc.embedFont(loadKoreanFont(), { subset: false });

  const ctx: Ctx = { doc, page: doc.addPage([A4L_W, A4L_H]), font, y: A4L_H - MARGIN };
  const GRAY = rgb(0.45, 0.45, 0.45);
  const rightEdge = A4L_W - MARGIN;

  /* 열 x 좌표 미리 계산 */
  const totalW = COLS.reduce((s, c) => s + c.w, 0);
  const scale = (A4L_W - MARGIN * 2) / totalW;      // 폭이 남거나 모자라면 균등 보정
  const xs: number[] = [];
  let cx = MARGIN;
  for (const c of COLS) { xs.push(cx); cx += c.w * scale; }
  const colEnd = (i: number) => xs[i] + COLS[i].w * scale;

  function header() {
    ctx.y = A4L_H - MARGIN;
    run(ctx, orgName, MARGIN, ctx.y, 9.5, rgb(0.3, 0.3, 0.3));
    runRight(ctx, [orgRegNo && `사업자번호 ${orgRegNo}`, orgRep && `대표 ${orgRep}`].filter(Boolean).join("  ·  "),
      rightEdge, ctx.y, 8, GRAY);
    ctx.y -= 22;

    run(ctx, `임금대장 — ${year}년 ${String(month).padStart(2, "0")}월`, MARGIN, ctx.y, 16, rgb(0, 0, 0));
    runRight(ctx, `근로기준법 제48조 · 작성일 ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`,
      rightEdge, ctx.y, 8, GRAY);
    ctx.y -= 14;
    line(ctx, ctx.y, MARGIN, rightEdge, 1, rgb(0.2, 0.2, 0.2));
    ctx.y -= 16;

    /* 지급·공제 묶음 띠 */
    const payFrom = xs[COLS.findIndex((c) => c.group === "pay")];
    const payTo = colEnd(COLS.map((c) => c.group).lastIndexOf("pay"));
    const dedFrom = xs[COLS.findIndex((c) => c.group === "ded")];
    const dedTo = colEnd(COLS.map((c) => c.group).lastIndexOf("ded"));
    ctx.page.drawRectangle({ x: payFrom - 2, y: ctx.y - 3, width: payTo - payFrom + 4, height: 13, color: rgb(0.94, 0.97, 0.94) });
    ctx.page.drawRectangle({ x: dedFrom - 2, y: ctx.y - 3, width: dedTo - dedFrom + 4, height: 13, color: rgb(0.99, 0.95, 0.93) });
    run(ctx, "지급 항목", payFrom + 2, ctx.y, 8, rgb(0.1, 0.45, 0.25));
    run(ctx, "공제 항목", dedFrom + 2, ctx.y, 8, rgb(0.65, 0.25, 0.15));
    ctx.y -= 14;

    /* 열 이름 */
    COLS.forEach((c, i) => {
      if (c.align === "l") run(ctx, c.label, xs[i], ctx.y, 7.5, rgb(0.25, 0.25, 0.25));
      else runRight(ctx, c.label, colEnd(i) - 2, ctx.y, 7.5, rgb(0.25, 0.25, 0.25));
    });
    ctx.y -= 6;
    line(ctx, ctx.y, MARGIN, rightEdge, 0.8, rgb(0.4, 0.4, 0.4));
    ctx.y -= 13;
  }

  header();

  for (const s of slips) {
    if (ctx.y < MARGIN + 60) {                       // 아랫단이 좁으면 다음 장
      ctx.page = doc.addPage([A4L_W, A4L_H]);
      header();
    }
    COLS.forEach((c, i) => {
      const v = cellText(s, c.key);
      const size = c.key === "netPay" || c.key === "grossPay" ? 8 : 7.5;
      const color = c.key === "netPay" ? rgb(0.06, 0.35, 0.32) : rgb(0.1, 0.1, 0.1);
      if (c.align === "l") run(ctx, v, xs[i], ctx.y, size, color);
      else runRight(ctx, v, colEnd(i) - 2, ctx.y, size, color);
    });
    ctx.y -= 5;
    line(ctx, ctx.y, MARGIN, rightEdge, 0.3, rgb(0.9, 0.9, 0.9));
    ctx.y -= 12;
  }

  /* 합계 */
  ctx.y -= 2;
  line(ctx, ctx.y + 8, MARGIN, rightEdge, 0.8, rgb(0.4, 0.4, 0.4));
  run(ctx, `합계 (${totals.count}명)`, MARGIN, ctx.y, 8.5, rgb(0, 0, 0));
  COLS.forEach((c, i) => {
    if (!c.group && c.key !== "netPay") return;
    const v = (totals as any)[c.key];
    if (v == null) return;
    runRight(ctx, won(v), colEnd(i) - 2, ctx.y, 8, c.key === "netPay" ? rgb(0.06, 0.35, 0.32) : rgb(0, 0, 0));
  });
  ctx.y -= 20;

  /* 꼬리말 — 무엇을 근거로 만든 숫자인지 남긴다 (감사 대비) */
  const notes = [
    "· 과세 대상액 = 지급총액 − 비과세 수당. 4대보험료와 소득세는 모두 과세 대상액을 기준으로 산정합니다.",
    "· 소득세는 근로소득 간이세액표(소득세법 시행령 별표2)에 따라, 지방소득세는 소득세의 10%로 산정합니다.",
    "· 근로일수는 실제 근무시간을 기준으로 환산합니다 (8시간 이상 1일 / 6~8시간 0.75일 / 4~6시간 0.5일 / 2~4시간 0.25일).",
    "· 본 대장은 근로기준법 제48조에 따라 3년간 보존합니다.",
  ];
  for (const t of notes) {
    run(ctx, t, MARGIN, ctx.y, 7, GRAY);
    ctx.y -= 10;
  }

  return await doc.save();
}
