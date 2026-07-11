// lib/payroll-pdf.ts
// 급여명세서 PDF — 관리자 다운로드 · 직원 다운로드 · 메일 첨부 · 서명본 증빙 공용.
//
// 2026-07-11 개정 (전자서명·증빙보관):
//   1) 계산방법 표기 — 근로기준법상 임금명세서는 금액뿐 아니라 '어떻게 나온 금액인지'를 적어야 한다.
//      숫자·문구는 lib/payroll-breakdown.ts 한 곳에서만 만든다 (화면과 PDF가 어긋나지 않도록).
//   2) 발행일 고정 — 과거엔 PDF를 만들 때마다 '지금' 시각을 찍어서 같은 명세서를 두 번 뽑으면
//      발행일이 달랐다. 이제 명세서에 기록된 교부일을 쓴다 (증빙 문서는 항상 같아야 한다).
//   3) 서명란 — 직원이 서명하면 서명 이미지·동의 항목·서명 시각을 문서에 찍어 '서명본'으로 보관한다.
//
// pdf-lib + @pdf-lib/fontkit + NotoSansKR (assets/fonts/NotoSansKR-Regular.ttf).

import { PDFDocument, rgb, PDFPage, PDFFont, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPayrollBreakdown, positionLabelOf } from "./payroll-breakdown";

/* ⚠️ 한글 폰트는 반드시 '통째로'(subset: false) 넣는다. 절대 subset: true로 바꾸지 말 것.
   PDF 라이브러리의 한글 폰트 부분추출(subset)이 글자 모양을 실제로 빠뜨린다 —
   2026-07-12 실측: 파일은 3MB→13KB로 줄지만 '급여명세서'가 '명세'로, '2,727,273'이 '2 727 273'으로
   보이는 등 글자가 통째로 사라진다(크롬 렌더 캡처로 확인).
   더 고약한 건 PDF에서 '텍스트 추출'은 멀쩡하게 된다는 점이다 — 텍스트 추출만으로 검증하면
   깨진 걸 못 잡는다. 폰트를 건드리면 반드시 눈으로 렌더 결과를 확인할 것.
   → 문서 1장 약 3MB. 급여 문서는 연간 수십 건이라 저장 비용은 무시할 수준이고, 정확성이 우선이다. */
let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf"));
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
}

export interface PayrollSignatureInput {
  /** 서명 이미지 PNG 바이트 (손글씨). 없으면 성명 입력 방식으로 간주 */
  imagePng?: Uint8Array | null;
  signedName: string;
  signedAt: Date | string;
  consentItems?: Array<{ text: string; agreed: boolean }>;
  ip?: string | null;
}

export interface PayrollSlipPdfInput {
  slip: any;                       // payroll_slips 행 (calculationSnapshot 포함)
  member: {
    id?: number | string;
    name: string;
    email?: string | null;
    /** 직책 (정책국장·사무국장 등) — 명세서에 찍히는 값 */
    position?: string | null;
    role?: string | null;
    milestoneRole?: string | null;
  };
  orgName?: string;
  /** 서명본 생성 시에만 전달 — 문서 하단에 서명란이 찍힌다 */
  signature?: PayrollSignatureInput | null;
}

const won = (n: number | string) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")} 원`;

const A4_W = 595, A4_H = 842, MARGIN = 60;

interface DrawCtx {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  y: number;
  width: number;
  margin: number;
}

/**
 * 글자를 하나씩, 실측 폭만큼 전진시키며 그린다.
 *
 * ⚠️ 이 함수를 거치지 않고 page.drawText(문장)을 그대로 쓰면 글자가 벌어진다.
 *   원인: 이 한글 폰트(글리프 2만5천 개)를 PDF에 통째로 임베드하면 글자별 폭 정보(/W)가
 *        제대로 실리지 않아, PDF 기본 폭(전각 1em)이 적용된다.
 *        → 숫자·공백이 눈에 띄게 벌어진다.
 *          실제: "kijs0726@gmail.com" → "kijs0 7 2 6 @gmail.com" / "지급 대상일" → "지급  대상일"
 *   해결: 글자 위치를 직접 지정하면 PDF의 폭 정보에 의존하지 않으므로 항상 정확히 붙는다.
 *        (폰트 부분추출(subset)로 /W를 줄이는 방법은 글자 모양이 통째로 사라져 쓸 수 없다 — 2026-07-12 실측)
 */
function drawRun(ctx: DrawCtx, str: string, x: number, y: number, size: number, color: RGB) {
  let cx = x;
  for (const ch of Array.from(String(str ?? ""))) {
    const w = ctx.font.widthOfTextAtSize(ch, size);
    if (ch.trim()) ctx.page.drawText(ch, { x: cx, y, size, font: ctx.font, color });
    cx += w;
  }
}
function text(ctx: DrawCtx, str: string, x: number, size: number, color: RGB = rgb(0, 0, 0)) {
  drawRun(ctx, str, x, ctx.y, size, color);
}
function textRight(ctx: DrawCtx, str: string, rightX: number, size: number, color: RGB = rgb(0, 0, 0)) {
  const s = String(str ?? "");
  const w = ctx.font.widthOfTextAtSize(s, size);
  drawRun(ctx, s, rightX - w, ctx.y, size, color);
}
/** ctx.y 가 아닌 임의의 y에 그릴 때 (서명란·여러 줄 계산방법 등) */
function textAt(ctx: DrawCtx, str: string, x: number, y: number, size: number, color: RGB = rgb(0, 0, 0)) {
  drawRun(ctx, str, x, y, size, color);
}
function hr(ctx: DrawCtx, thickness = 0.8, color: RGB = rgb(0.5, 0.5, 0.5)) {
  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.y },
    end: { x: ctx.width - ctx.margin, y: ctx.y },
    thickness, color,
  });
}
/** 남은 높이가 모자라면 새 페이지 (계산방법·서명란이 붙어 1페이지를 넘길 수 있다) */
function ensureSpace(ctx: DrawCtx, needed: number) {
  if (ctx.y - needed < ctx.margin) {
    ctx.page = ctx.doc.addPage([A4_W, A4_H]);
    ctx.y = A4_H - ctx.margin;
  }
}
/** 폭에 맞게 줄바꿈. 계산방법은 법정 기재사항이라 잘라내면 안 되므로 여러 줄로 흘린다. */
function wrapText(ctx: DrawCtx, str: string, size: number, maxW: number): string[] {
  const words = String(str ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.font.widthOfTextAtSize(next, size) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    /* 공백 없이 긴 덩어리는 글자 단위로 쪼갠다 */
    let chunk = w;
    while (ctx.font.widthOfTextAtSize(chunk, size) > maxW && chunk.length > 1) {
      let cut = chunk.length;
      while (cut > 1 && ctx.font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxW) cut--;
      lines.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
    }
    cur = chunk;
  }
  if (cur) lines.push(cur);
  return lines;
}

function kst(d: any): string {
  if (!d) return "";
  try { return new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }); } catch { return ""; }
}

export async function generatePayrollSlipPdf(input: PayrollSlipPdfInput): Promise<Uint8Array> {
  const { slip, member, signature } = input;
  const orgName = input.orgName || process.env.ORG_NAME || "(사)교사유가족협의회";
  const orgRegNo = process.env.ORG_REGISTRATION_NO || "";
  const orgRep = process.env.ORG_REPRESENTATIVE || "";

  const bd = buildPayrollBreakdown(slip);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);
  const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });

  const ctx: DrawCtx = {
    doc: pdfDoc,
    page: pdfDoc.addPage([A4_W, A4_H]),
    font,
    y: A4_H - MARGIN,
    width: A4_W,
    margin: MARGIN,
  };
  const rightX = A4_W - MARGIN;
  const labelX = MARGIN + 14;
  const methodX = MARGIN + 150;          // 계산방법 열 시작
  const GRAY = rgb(0.45, 0.45, 0.45);

  /* 교부일 — 문서마다 고정. 발송 전이면(관리자 미리보기) 오늘 날짜에 '(미교부)' 표시 */
  const issued = slip.issuedAt ?? slip.issued_at ?? slip.sentAt ?? slip.sent_at ?? null;
  const issuedText = issued ? kst(issued) : `${kst(new Date())} (교부 전 미리보기)`;
  const docVersion = Number(slip.documentVersion ?? slip.document_version ?? 1);

  /* ── 머리말 ── */
  text(ctx, orgName, MARGIN, 11, rgb(0.3, 0.3, 0.3));
  if (orgRegNo || orgRep) {
    textRight(ctx, [orgRegNo && `사업자번호 ${orgRegNo}`, orgRep && `대표 ${orgRep}`].filter(Boolean).join("  ·  "), rightX, 8.5, GRAY);
  }
  ctx.y -= 30;
  text(ctx, "급여명세서", MARGIN, 22);
  if (docVersion > 1) {
    text(ctx, `정정 ${docVersion}차`, MARGIN + 120, 11, rgb(0.7, 0.2, 0.2));
  }
  ctx.y -= 22;
  text(ctx, `${slip.payYear ?? slip.pay_year}년 ${String(slip.payMonth ?? slip.pay_month).padStart(2, "0")}월`, MARGIN, 13, rgb(0.2, 0.2, 0.2));
  textRight(ctx, `교부일: ${issuedText}`, rightX, 9, GRAY);
  ctx.y -= 12;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 24;

  /* ── 근로자 정보 ── */
  text(ctx, "성명", MARGIN, 10, GRAY);
  text(ctx, member.name, MARGIN + 70, 11);
  textRight(ctx, member.email || "", rightX, 9.5, GRAY);
  ctx.y -= 18;
  text(ctx, "직책", MARGIN, 10, GRAY);
  text(ctx, positionLabelOf(member), MARGIN + 70, 11);
  if (member.id != null) textRight(ctx, `사번 ${member.id}`, rightX, 9.5, GRAY);
  ctx.y -= 24;
  hr(ctx);
  ctx.y -= 22;

  /* ── 근태 근거 (2열) ── */
  text(ctx, "근태 집계", MARGIN, 13, rgb(0.1, 0.1, 0.4));
  ctx.y -= 20;
  const colBx = 320;
  const WARN = rgb(0.7, 0.35, 0.03);
  for (let i = 0; i < bd.attendance.length; i += 2) {
    ensureSpace(ctx, 20);
    const a = bd.attendance[i], b = bd.attendance[i + 1];
    text(ctx, a.label, labelX, 9.5, a.warn ? WARN : GRAY);
    textRight(ctx, a.value, 250, 10, a.warn ? WARN : rgb(0, 0, 0));
    if (b) {
      text(ctx, b.label, colBx, 9.5, b.warn ? WARN : GRAY);
      textRight(ctx, b.value, rightX, 10, b.warn ? WARN : rgb(0, 0, 0));
    }
    ctx.y -= 17;
  }
  /* 지급에서 빠지거나 줄어든 날이 있으면 이유를 전부 문서에 남긴다 — 직원이 왜 줄었는지 알 수 있어야 한다 */
  for (const w of bd.attendance.filter(a => a.warn)) {
    const note = `※ ${w.label} ${w.value} — ${w.hint ?? "지급 제외"}`;
    for (const line of wrapText(ctx, note, 8, A4_W - MARGIN * 2 - 16)) {
      ensureSpace(ctx, 14);
      text(ctx, line, labelX, 8, WARN);
      ctx.y -= 11;
    }
    ctx.y -= 2;
  }
  ctx.y -= 6;
  hr(ctx);
  ctx.y -= 22;

  /* 항목 한 줄 그리기 — 계산방법이 금액 칸을 침범하지 않도록 금액 폭을 실제로 재서 남는 만큼만 쓰고,
     넘치면 잘라내지 않고 아랫줄로 흘린다 (계산방법은 법정 기재사항이라 생략 불가). */
  const drawMoneyRow = (row: { label: string; method: string; amount: number; kind: string; taxFree?: boolean }, forceMinus = false) => {
    const minus = forceMinus || row.kind === "DEDUCT";
    const amt = won(row.amount);
    const amtW = ctx.font.widthOfTextAtSize(amt, 10.5);
    const availW = Math.max(90, rightX - amtW - 14 - methodX);
    const lines = wrapText(ctx, row.method, 8, availW);
    const rowH = Math.max(19, 6 + lines.length * 11);
    ensureSpace(ctx, rowH + 4);

    const color = minus ? rgb(0.55, 0.12, 0.12) : rgb(0.1, 0.35, 0.1);
    const label = `${minus ? "−" : "+"}  ${row.label}`;
    text(ctx, label, labelX, 10.5, color);
    if (row.taxFree) {
      const w = ctx.font.widthOfTextAtSize(label, 10.5);
      text(ctx, "[비과세]", labelX + w + 5, 7.5, rgb(0.1, 0.42, 0.63));
    }
    textRight(ctx, amt, rightX, 10.5);
    let ly = ctx.y;
    for (const l of lines) {
      textAt(ctx, l, methodX, ly, 8, GRAY);
      ly -= 11;
    }
    ctx.y -= rowH;
  };

  /* ── 지급 항목 + 계산방법 ── */
  ensureSpace(ctx, 60);
  text(ctx, "지급 항목", MARGIN, 13, rgb(0.1, 0.1, 0.4));
  text(ctx, "계산방법", methodX, 9, GRAY);
  ctx.y -= 20;
  for (const row of bd.earnings) drawMoneyRow(row);
  ctx.y -= 2;
  hr(ctx, 0.8, rgb(0.4, 0.4, 0.4));
  ctx.y -= 18;
  text(ctx, "세전 총액", MARGIN, 12, rgb(0.1, 0.1, 0.5));
  textRight(ctx, won(bd.grossPay), rightX, 12, rgb(0.1, 0.1, 0.5));
  ctx.y -= 16;

  /* 비과세 지급이 있으면 '보험료·세금을 매기는 기준 금액'을 밝힌다 —
     아래 공제 항목의 계산방법이 이 금액을 가리키므로, 이게 없으면 직원이 검산할 수 없다. */
  if (bd.nonTaxableTotal > 0) {
    ensureSpace(ctx, 20);
    text(ctx, `과세 대상액  (세전 총액 − 비과세 ${won(bd.nonTaxableTotal)})`, MARGIN + 2, 9.5, rgb(0.1, 0.42, 0.63));
    textRight(ctx, won(bd.taxableBase), rightX, 10, rgb(0.1, 0.42, 0.63));
    ctx.y -= 14;
  }
  ctx.y -= 10;

  /* ── 공제 항목 + 계산방법 ── */
  ensureSpace(ctx, 60);
  text(ctx, "공제 항목", MARGIN, 13, rgb(0.4, 0.1, 0.1));
  text(ctx, "계산방법", methodX, 9, GRAY);
  ctx.y -= 20;
  for (const row of bd.deductions) drawMoneyRow(row, true);
  ctx.y -= 2;
  hr(ctx, 0.8, rgb(0.4, 0.4, 0.4));
  ctx.y -= 18;
  text(ctx, "공제 합계", MARGIN, 12, rgb(0.4, 0.1, 0.1));
  textRight(ctx, won(bd.totalDeduction), rightX, 12, rgb(0.4, 0.1, 0.1));
  ctx.y -= 26;

  /* ── 실수령액 ── */
  ensureSpace(ctx, 50);
  hr(ctx, 1, rgb(0.1, 0.1, 0.1));
  ctx.y -= 22;
  text(ctx, "실수령액", MARGIN, 14, rgb(0.05, 0.2, 0.05));
  textRight(ctx, won(bd.netPay), rightX, 16, rgb(0.05, 0.2, 0.05));
  ctx.y -= 26;

  /* ── 안내 ── */
  ensureSpace(ctx, 40);
  hr(ctx, 0.4, rgb(0.7, 0.7, 0.7));
  ctx.y -= 16;
  text(ctx, "※ 실수령액 = 세전 총액 − 공제 합계. 위 계산방법은 급여 기준 설정값을 그대로 적용한 것입니다.", MARGIN, 8.5, GRAY);
  ctx.y -= 12;
  if (bd.basis.calculatedAt) {
    text(ctx, `※ 산출 기준 시각: ${kst(bd.basis.calculatedAt)}`, MARGIN, 8.5, GRAY);
    ctx.y -= 12;
  }
  const paidAt = slip.paidAt ?? slip.paid_at;
  if (paidAt) {
    text(ctx, `※ 지급일: ${kst(paidAt)}`, MARGIN, 8.5, GRAY);
    ctx.y -= 12;
  }

  /* ── 전자서명란 (서명본에만) ── */
  if (signature) {
    ensureSpace(ctx, 170);
    ctx.y -= 10;
    hr(ctx, 1, rgb(0.2, 0.2, 0.2));
    ctx.y -= 20;
    text(ctx, "수령 확인 및 이의 없음 동의", MARGIN, 12, rgb(0.1, 0.1, 0.1));
    ctx.y -= 18;

    const items = signature.consentItems?.length
      ? signature.consentItems
      : [{ text: "위 급여명세 내용을 확인하였습니다.", agreed: true },
         { text: "기재된 내용에 이의가 없음에 동의합니다.", agreed: true }];
    for (const it of items) {
      text(ctx, `${it.agreed ? "[v]" : "[ ]"}  ${it.text}`, labelX, 9.5, rgb(0.2, 0.2, 0.2));
      ctx.y -= 15;
    }
    ctx.y -= 8;

    /* 서명 이미지 (손글씨) 또는 성명 표기 */
    const sigBoxY = ctx.y - 56;
    ctx.page.drawRectangle({
      x: MARGIN, y: sigBoxY, width: A4_W - MARGIN * 2, height: 62,
      borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.8,
    });
    const innerY = sigBoxY + 42;
    textAt(ctx, "서명", MARGIN + 12, innerY, 9, GRAY);

    if (signature.imagePng && signature.imagePng.length > 0) {
      try {
        const png = await pdfDoc.embedPng(signature.imagePng);
        const maxW = 150, maxH = 46;
        const scale = Math.min(maxW / png.width, maxH / png.height, 1);
        ctx.page.drawImage(png, {
          x: MARGIN + 60, y: sigBoxY + 8,
          width: png.width * scale, height: png.height * scale,
        });
      } catch {
        textAt(ctx, signature.signedName, MARGIN + 60, innerY, 13);
      }
    } else {
      textAt(ctx, signature.signedName, MARGIN + 60, innerY, 13);
      textAt(ctx, "(성명 입력 방식 전자서명)", MARGIN + 60, innerY - 15, 7.5, GRAY);
    }

    textAt(ctx, `성명: ${signature.signedName}`, 330, innerY, 10);
    textAt(ctx, `서명일시: ${kst(signature.signedAt)}`, 330, innerY - 15, 8.5, GRAY);
    if (signature.ip) {
      textAt(ctx, `접속 IP: ${signature.ip}`, 330, innerY - 28, 7.5, GRAY);
    }
    ctx.y = sigBoxY - 16;

    text(ctx, "※ 본 서명은 전자문서 및 전자거래 기본법에 따른 전자적 의사표시로, 서면 서명과 동일한 효력을 가집니다.", MARGIN, 7.5, GRAY);
    ctx.y -= 11;
  }

  /* ── 문서 식별 (증빙 추적) ── */
  const slipId = slip.id;
  if (slipId != null) {
    ensureSpace(ctx, 20);
    text(ctx, `문서번호 PS-${slip.payYear ?? slip.pay_year}${String(slip.payMonth ?? slip.pay_month).padStart(2, "0")}-${slipId}-v${docVersion}`, MARGIN, 7.5, rgb(0.6, 0.6, 0.6));
  }

  return await pdfDoc.save();
}

/* ══════════════════════════════════════════════════════════════
   연간 급여내역서 — 연말정산·대출 서류용 1년치 한 장 (가로 A4)
   ══════════════════════════════════════════════════════════════ */
export interface PayrollAnnualPdfInput {
  year: number;
  member: { id?: number | string; name: string; email?: string | null; role?: string | null };
  org: { name: string; regNo?: string; representative?: string };
  months: Array<Record<string, any>>;
  totals: Record<string, any>;
}

export async function generatePayrollAnnualPdf(input: PayrollAnnualPdfInput): Promise<Uint8Array> {
  const { year, member, org, months, totals } = input;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);
  const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });

  const W = 842, H = 595;                     // A4 가로 (열이 많다)
  const M = 44;
  const ctx: DrawCtx = { doc: pdfDoc, page: pdfDoc.addPage([W, H]), font, y: H - M, width: W, margin: M };
  const GRAY = rgb(0.45, 0.45, 0.45);
  const rightEdge = W - M;

  text(ctx, org.name, M, 10, rgb(0.3, 0.3, 0.3));
  textRight(ctx, `발급일: ${kst(new Date())}`, rightEdge, 8.5, GRAY);
  ctx.y -= 26;
  text(ctx, `${year}년 급여내역서`, M, 20);
  ctx.y -= 18;
  text(ctx, `${member.name}  ·  ${member.role || "-"}${member.id != null ? `  ·  사번 ${member.id}` : ""}`, M, 10.5, rgb(0.3, 0.3, 0.3));
  ctx.y -= 10;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 18;

  /* 열 — 오른쪽 정렬 기준 x 좌표 */
  const cols: Array<{ label: string; key: string; x: number }> = [
    { label: "근무일", key: "workingDays",         x: 130 },
    { label: "기본급", key: "baseSalary",          x: 215 },
    { label: "성과급", key: "performanceBonus",    x: 292 },
    { label: "세전총액", key: "grossPay",          x: 380 },
    { label: "국민연금", key: "nationalPension",   x: 458 },
    { label: "건강보험", key: "healthInsurance",   x: 536 },
    { label: "고용보험", key: "employmentInsurance", x: 610 },
    { label: "소득세", key: "incomeTax",           x: 676 },
    { label: "공제계", key: "totalDeduction",      x: 740 },
    { label: "실수령", key: "netPay",              x: rightEdge },
  ];

  text(ctx, "월", M, 8.5, GRAY);
  for (const c of cols) textRight(ctx, c.label, c.x, 8.5, GRAY);
  ctx.y -= 6;
  hr(ctx, 0.6, rgb(0.75, 0.75, 0.75));
  ctx.y -= 14;

  const fmt = (v: any, key: string) =>
    key === "workingDays" ? `${Math.round(Number(v || 0))}일`
                          : Math.round(Number(v || 0)).toLocaleString("ko-KR");

  for (const m of months) {
    ensureSpace(ctx, 18);
    /* 아직 수령확인(서명)을 안 한 달은 월 옆에 표시 — 본인이 무엇을 남겼는지 바로 보이게 */
    text(ctx, `${String(m.month).padStart(2, "0")}월`, M, 9.5);
    if (!m.acknowledged) text(ctx, "미서명", M + 34, 7.5, rgb(0.72, 0.45, 0.05));
    for (const c of cols) {
      const isNet = c.key === "netPay";
      textRight(ctx, fmt(m[c.key], c.key), c.x, 9.5, isNet ? rgb(0.05, 0.35, 0.25) : rgb(0.1, 0.1, 0.1));
    }
    ctx.y -= 17;
  }

  ctx.y -= 2;
  hr(ctx, 1, rgb(0.4, 0.4, 0.4));
  ctx.y -= 16;
  text(ctx, `합계 (${totals.monthCount}개월)`, M, 10.5, rgb(0.1, 0.1, 0.4));
  for (const c of cols) {
    const isNet = c.key === "netPay";
    textRight(ctx, fmt(totals[c.key], c.key), c.x, 10.5, isNet ? rgb(0.05, 0.35, 0.25) : rgb(0.1, 0.1, 0.4));
  }
  ctx.y -= 26;

  hr(ctx, 0.4, rgb(0.8, 0.8, 0.8));
  ctx.y -= 14;
  text(ctx, "※ 교부된 급여명세서(발송·지급완료)만 합산한 금액입니다.", M, 8, GRAY);
  ctx.y -= 11;
  text(ctx, "※ 장기요양보험·지방소득세·기타공제는 '공제계'에 포함되어 있습니다.", M, 8, GRAY);
  ctx.y -= 11;
  if (org.regNo || org.representative) {
    text(ctx, [org.name, org.regNo && `사업자번호 ${org.regNo}`, org.representative && `대표 ${org.representative}`]
      .filter(Boolean).join("  ·  "), M, 8, GRAY);
  }

  return await pdfDoc.save();
}

export function payrollSlipFilename(slip: any, memberName: string, opts?: { signed?: boolean }): string {
  const y = slip.payYear ?? slip.pay_year;
  const m = String(slip.payMonth ?? slip.pay_month).padStart(2, "0");
  const v = Number(slip.documentVersion ?? slip.document_version ?? 1);
  const safeName = String(memberName || "직원").replace(/[\\/:*?"<>|]/g, "_");
  const suffix = opts?.signed ? "_서명본" : "";
  const ver = v > 1 ? `_정정${v}차` : "";
  return `급여명세서_${y}_${m}_${safeName}${ver}${suffix}.pdf`;
}
