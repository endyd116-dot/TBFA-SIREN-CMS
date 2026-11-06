/**
 * GET /api/admin-finance-report-pdf
 *   ?type=pl       + period|startDate|endDate  → 운영성과표 PDF (장부 기준)
 *   ?type=budget   + year                      → 예산 대비 실적표 PDF
 *   ?type=balance  + asOf                      → 재무상태표 PDF (장부 기준)
 *   ?type=cashflow + period|startDate|endDate  → 현금흐름표 PDF        (Phase 22-D-R3)
 *
 * Phase 22-B-R3 / 22-D-R3 — NPO 표준 회계 보고서 PDF 생성
 * pl-summary / budget-list / balance-sheet / cashflow 집계 로직 재사용 → pdf-lib A4 PDF
 * 한글 폰트: assets/fonts/NotoSansKR-Regular.ttf
 */
import { yearKST, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { sql } from "drizzle-orm";
import { buildBudgetReport } from "../../lib/finance-budget-report";
import { balanceSheet, operatingStatement, type StatementRow } from "../../lib/ledger-statements";
import { resolvePeriod } from "../../lib/period-filter";
import { PDFDocument, rgb, PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const config = { path: "/api/admin-finance-report-pdf" };

/* ─── 폰트 로딩 (캐시) ─── */
let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const buf = readFileSync(join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf"));
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
}

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "회계 보고서 PDF 생성 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")} 원`;

/* ═══════════════ 예산 대비 실적표 데이터 (budget-list 로직 재사용) ═══════════════ */
async function buildBudgetData(year: number) {
  let plan: any = null;
  const planRows: any = await db.execute(sql`
    SELECT id, fiscal_year, title, status, total_planned, approved_at
    FROM budget_plans WHERE fiscal_year = ${year} AND status = 'approved' LIMIT 1
  `);
  plan = (planRows?.rows ?? planRows ?? [])[0] ?? null;

  if (!plan) {
    return { noPlan: true, year };
  }

  const report = await buildBudgetReport(Number(plan.id), year);

  return {
    noPlan: false, year,
    planTitle: plan.title,
    items: report.items,
    totalPlanned: report.totalPlanned,
    totalExecuted: report.totalExecuted,
    totalRemaining: report.totalRemaining,
    executionRate: report.executionRate,
  };
}

/* ═══════════════ PDF 렌더 헬퍼 ═══════════════ */
interface DrawCtx {
  page: PDFPage;
  font: PDFFont;
  pdfDoc: PDFDocument;
  y: number;
  width: number;
  height: number;
  margin: number;
}

function newPage(ctx: DrawCtx): void {
  ctx.page = ctx.pdfDoc.addPage([595, 842]);
  ctx.y = ctx.height - ctx.margin;
}

function ensureSpace(ctx: DrawCtx, need: number): void {
  if (ctx.y - need < ctx.margin) newPage(ctx);
}

function text(ctx: DrawCtx, str: string, x: number, size: number, color = rgb(0, 0, 0)): void {
  ctx.page.drawText(str, { x, y: ctx.y, size, font: ctx.font, color });
}

function hr(ctx: DrawCtx, thickness = 0.8, color = rgb(0.5, 0.5, 0.5)): void {
  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.y },
    end: { x: ctx.width - ctx.margin, y: ctx.y },
    thickness, color,
  });
}

/* 우측 정렬 텍스트 */
function textRight(ctx: DrawCtx, str: string, rightX: number, size: number, color = rgb(0, 0, 0)): void {
  const w = ctx.font.widthOfTextAtSize(str, size);
  ctx.page.drawText(str, { x: rightX - w, y: ctx.y, size, font: ctx.font, color });
}

/* ═══════════════ 재무제표 PDF (장부 기준) ═══════════════ */
async function renderStatementPdf(
  pdfDoc: PDFDocument, font: PDFFont, title: string, subtitle: string, rows: StatementRow[], orgName: string
): Promise<void> {
  const ctx: DrawCtx = {
    page: pdfDoc.addPage([595, 842]), font, pdfDoc,
    y: 842 - 60, width: 595, height: 842, margin: 60,
  };
  const rightX = ctx.width - ctx.margin;
  const genAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const amount = (n: number) => (n === 0 ? "-" : n < 0 ? `(${Math.abs(n).toLocaleString("ko-KR")})` : n.toLocaleString("ko-KR"));

  text(ctx, orgName, ctx.margin, 11, rgb(0.3, 0.3, 0.3));
  ctx.y -= 26;
  text(ctx, title, ctx.margin, 18);
  ctx.y -= 18;
  text(ctx, subtitle, ctx.margin, 10, rgb(0.3, 0.3, 0.3));
  textRight(ctx, `생성일시: ${genAt}`, rightX, 9, rgb(0.5, 0.5, 0.5));
  ctx.y -= 10;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 20;
  textRight(ctx, "(단위: 원)", rightX, 9, rgb(0.4, 0.4, 0.4));
  ctx.y -= 16;

  for (const r of rows) {
    ensureSpace(ctx, 22);
    const strong = r.type !== "line";
    const size = strong ? 10.5 : 10;
    const color = strong ? rgb(0.05, 0.05, 0.05) : rgb(0.25, 0.25, 0.25);
    ctx.page.drawText(r.label, { x: ctx.margin + r.level * 12, y: ctx.y, size, font: ctx.font, color });
    if (r.type !== "head") textRight(ctx, amount(r.current.total), rightX, size, color);
    if (r.type === "total") {
      ctx.y -= 6;
      hr(ctx);
      ctx.y -= 10;
    }
    ctx.y -= 16;
  }

  ensureSpace(ctx, 30);
  ctx.y -= 6;
  text(ctx, "※ 장부의 승인 전표 기준입니다. 장부 시작일 이전 거래는 포함되지 않습니다.", ctx.margin, 8.5, rgb(0.5, 0.5, 0.5));
}

/* ═══════════════ 예산 대비 실적표 PDF ═══════════════ */
async function renderBudgetPdf(
  pdfDoc: PDFDocument, font: PDFFont,
  data: Awaited<ReturnType<typeof buildBudgetData>>,
  orgName: string
): Promise<void> {
  const ctx: DrawCtx = {
    page: pdfDoc.addPage([595, 842]), font, pdfDoc,
    y: 842 - 60, width: 595, height: 842, margin: 60,
  };
  const rightX = ctx.width - ctx.margin;
  const genAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  // 머리말
  text(ctx, orgName, ctx.margin, 11, rgb(0.3, 0.3, 0.3));
  ctx.y -= 26;
  text(ctx, "예산 대비 실적표 (Budget vs Actual)", ctx.margin, 18);
  ctx.y -= 18;
  text(ctx, `${data.year} 회계연도`, ctx.margin, 10, rgb(0.3, 0.3, 0.3));
  textRight(ctx, `생성일시: ${genAt}`, rightX, 9, rgb(0.5, 0.5, 0.5));
  ctx.y -= 10;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 28;

  if (data.noPlan) {
    text(ctx, `${data.year}년도 승인된 예산안이 없습니다.`, ctx.margin, 12, rgb(0.5, 0.1, 0.1));
    ctx.y -= 22;
    text(ctx, "예산안을 편성·승인 후 집행률 확인이 가능합니다.", ctx.margin, 10, rgb(0.4, 0.4, 0.4));
    return;
  }

  text(ctx, `승인 예산안: ${data.planTitle}`, ctx.margin, 10, rgb(0.3, 0.3, 0.3));
  ctx.y -= 26;

  // 테이블 컬럼 (계정과목 / 편성액 / 집행액 / 잔여액 / 집행률)
  const colName = ctx.margin;
  const colPlanned = 240;
  const colExecuted = 340;
  const colRemaining = 445;
  const colRate = rightX;

  // 헤더
  text(ctx, "계정과목", colName, 10, rgb(0.2, 0.2, 0.2));
  textRight(ctx, "편성액", colPlanned, 10, rgb(0.2, 0.2, 0.2));
  textRight(ctx, "집행액", colExecuted, 10, rgb(0.2, 0.2, 0.2));
  textRight(ctx, "잔여액", colRemaining, 10, rgb(0.2, 0.2, 0.2));
  textRight(ctx, "집행률", colRate, 10, rgb(0.2, 0.2, 0.2));
  ctx.y -= 8;
  hr(ctx);
  ctx.y -= 18;

  const fmt = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}`;

  for (const item of data.items!) {
    ensureSpace(ctx, 20);
    text(ctx, item.categoryName, colName, 10);
    textRight(ctx, fmt(item.plannedAmount), colPlanned, 10);
    textRight(ctx, fmt(item.executedAmount), colExecuted, 10);
    const remColor = item.remaining < 0 ? rgb(0.6, 0.1, 0.1) : rgb(0, 0, 0);
    textRight(ctx, fmt(item.remaining), colRemaining, 10, remColor);
    textRight(ctx, `${item.rate}%`, colRate, 10);
    ctx.y -= 19;
  }

  ctx.y -= 2;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 18;
  text(ctx, "합계", colName, 11, rgb(0.1, 0.1, 0.5));
  textRight(ctx, fmt(data.totalPlanned!), colPlanned, 11, rgb(0.1, 0.1, 0.5));
  textRight(ctx, fmt(data.totalExecuted!), colExecuted, 11, rgb(0.1, 0.1, 0.5));
  const totRemColor = data.totalRemaining! < 0 ? rgb(0.6, 0.1, 0.1) : rgb(0.1, 0.1, 0.5);
  textRight(ctx, fmt(data.totalRemaining!), colRemaining, 11, totRemColor);
  textRight(ctx, `${data.executionRate}%`, colRate, 11, rgb(0.1, 0.1, 0.5));
  ctx.y -= 22;
}

/* ═══════════════ 현금흐름표 데이터 (cashflow 로직 재사용) ═══════════════ */
const INCOME_LABEL: Record<string, string> = {
  donation: "후원금", donation_batch: "후원금 (묶음정산)", revenue: "후원 외 매출",
};
const EXPENSE_LABEL: Record<string, string> = { voucher: "전표 연결 지출" };

async function buildCashflowData(startDate: string, endDate: string) {
  let openingBalance = 0, hasOpeningData = false;
  {
    const r: any = await db.execute(sql`
      SELECT balance_after FROM bank_transactions
      WHERE txn_date < ${startDate} AND balance_after IS NOT NULL
      ORDER BY txn_date DESC, id DESC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) { openingBalance = Number(row.balance_after); hasOpeningData = true; }
  }

  const aggR: any = await db.execute(sql`
    SELECT txn_type, COALESCE(match_type, 'pending') AS match_type,
           COUNT(*) AS cnt, COALESCE(SUM(ABS(amount)), 0)::bigint AS total
    FROM bank_transactions
    WHERE txn_date >= ${startDate} AND txn_date <= ${endDate} AND status != 'ignored'
    GROUP BY txn_type, COALESCE(match_type, 'pending')
  `);
  const aggRows = (aggR?.rows ?? aggR ?? []) as any[];

  let closingBalance: number | null = null, hasClosingData = false;
  {
    const r: any = await db.execute(sql`
      SELECT balance_after FROM bank_transactions
      WHERE txn_date >= ${startDate} AND txn_date <= ${endDate} AND balance_after IS NOT NULL
      ORDER BY txn_date DESC, id DESC LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) { closingBalance = Number(row.balance_after); hasClosingData = true; }
  }

  const inflowByCategory: Array<{ label: string; amount: number }> = [];
  const outflowByCategory: Array<{ label: string; amount: number }> = [];
  let totalInflow = 0, totalOutflow = 0;
  for (const x of aggRows) {
    const amt = Number(x.total);
    const mt = x.match_type as string;
    if (x.txn_type === "credit") {
      totalInflow += amt;
      inflowByCategory.push({ label: INCOME_LABEL[mt] || (mt === "pending" ? "미분류 입금" : mt), amount: amt });
    } else {
      totalOutflow += amt;
      outflowByCategory.push({ label: EXPENSE_LABEL[mt] || (mt === "pending" ? "미분류 출금" : mt), amount: amt });
    }
  }
  inflowByCategory.sort((a, b) => b.amount - a.amount);
  outflowByCategory.sort((a, b) => b.amount - a.amount);
  const netCashFlow = totalInflow - totalOutflow;
  const finalClosing = hasClosingData ? closingBalance! : openingBalance + netCashFlow;

  return {
    startDate, endDate, openingBalance, hasOpeningData,
    totalInflow, inflowByCategory, totalOutflow, outflowByCategory,
    netCashFlow, closingBalance: finalClosing, closingIsEstimated: !hasClosingData,
  };
}

/* ═══════════════ 현금흐름표 PDF ═══════════════ */
async function renderCashflowPdf(
  pdfDoc: PDFDocument, font: PDFFont,
  data: Awaited<ReturnType<typeof buildCashflowData>>,
  periodLabel: string, orgName: string
): Promise<void> {
  const ctx: DrawCtx = {
    page: pdfDoc.addPage([595, 842]), font, pdfDoc,
    y: 842 - 60, width: 595, height: 842, margin: 60,
  };
  const rightX = ctx.width - ctx.margin;
  const genAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  text(ctx, orgName, ctx.margin, 11, rgb(0.3, 0.3, 0.3));
  ctx.y -= 26;
  text(ctx, "현금흐름표 (Statement of Cash Flows)", ctx.margin, 18);
  ctx.y -= 18;
  text(ctx, `기간: ${periodLabel}`, ctx.margin, 10, rgb(0.3, 0.3, 0.3));
  textRight(ctx, `생성일시: ${genAt}`, rightX, 9, rgb(0.5, 0.5, 0.5));
  ctx.y -= 10;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 28;

  // 기초 잔액
  text(ctx, "기초 잔액", ctx.margin, 12);
  textRight(ctx, won(data.openingBalance), rightX, 12);
  ctx.y -= 24;

  // 입금 합계
  text(ctx, "  입금 합계 (+)", ctx.margin, 11, rgb(0.1, 0.35, 0.1));
  textRight(ctx, won(data.totalInflow), rightX, 11, rgb(0.1, 0.35, 0.1));
  ctx.y -= 18;
  for (const c of data.inflowByCategory) {
    ensureSpace(ctx, 16);
    text(ctx, `      · ${c.label}`, ctx.margin, 9.5, rgb(0.35, 0.35, 0.35));
    textRight(ctx, won(c.amount), rightX, 9.5, rgb(0.35, 0.35, 0.35));
    ctx.y -= 15;
  }
  if (data.inflowByCategory.length === 0) {
    text(ctx, "      · (입금 내역 없음)", ctx.margin, 9.5, rgb(0.5, 0.5, 0.5));
    ctx.y -= 15;
  }
  ctx.y -= 6;

  // 출금 합계
  ensureSpace(ctx, 30);
  text(ctx, "  출금 합계 (−)", ctx.margin, 11, rgb(0.6, 0.1, 0.1));
  textRight(ctx, won(data.totalOutflow), rightX, 11, rgb(0.6, 0.1, 0.1));
  ctx.y -= 18;
  for (const c of data.outflowByCategory) {
    ensureSpace(ctx, 16);
    text(ctx, `      · ${c.label}`, ctx.margin, 9.5, rgb(0.35, 0.35, 0.35));
    textRight(ctx, won(c.amount), rightX, 9.5, rgb(0.35, 0.35, 0.35));
    ctx.y -= 15;
  }
  if (data.outflowByCategory.length === 0) {
    text(ctx, "      · (출금 내역 없음)", ctx.margin, 9.5, rgb(0.5, 0.5, 0.5));
    ctx.y -= 15;
  }
  ctx.y -= 8;

  // 순현금흐름
  ensureSpace(ctx, 50);
  hr(ctx);
  ctx.y -= 20;
  const ncColor = data.netCashFlow >= 0 ? rgb(0.1, 0.35, 0.1) : rgb(0.6, 0.1, 0.1);
  text(ctx, "순현금흐름 (입금 − 출금)", ctx.margin, 12, ncColor);
  textRight(ctx, won(data.netCashFlow), rightX, 12, ncColor);
  ctx.y -= 24;

  // 기말 잔액
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 20;
  text(ctx, `기말 잔액${data.closingIsEstimated ? " (추정)" : ""}`, ctx.margin, 13, rgb(0.1, 0.1, 0.5));
  textRight(ctx, won(data.closingBalance), rightX, 13, rgb(0.1, 0.1, 0.5));
  ctx.y -= 24;

  if (data.closingIsEstimated) {
    text(ctx, "※ 기말 잔액은 기간 내 통장 잔액 데이터가 없어 기초+순흐름으로 추정한 값입니다.", ctx.margin, 8.5, rgb(0.5, 0.5, 0.5));
  }
}

/* ═══════════════ 핸들러 ═══════════════ */
export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const orgName = process.env.ORG_NAME || "(사)교사유가족협의회";

  if (type !== "pl" && type !== "budget" && type !== "balance" && type !== "cashflow") {
    return new Response(jsonKST({
      ok: false, error: "type 파라미터는 pl, budget, balance, cashflow 중 하나여야 합니다",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let pdfBytes: Uint8Array;
  let fileName: string;

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });

    if (type === "pl") {
      const { startDate, endDate, period } = resolvePeriod({
        period: url.searchParams.get("period"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        fiscalYear: url.searchParams.get("fiscalYear"),
      });
      let data;
      try {
        data = await operatingStatement(startDate, endDate);
      } catch (err) {
        return jsonError("build_pl_data", err);
      }
      await renderStatementPdf(pdfDoc, font, "운영성과표", `${startDate} ~ ${endDate} (${period})`, data.rows, orgName);
      fileName = `운영성과표_${startDate}_${endDate}.pdf`;
    } else if (type === "budget") {
      const year = parseInt(url.searchParams.get("year") || String(yearKST()));
      let data;
      try {
        data = await buildBudgetData(year);
      } catch (err) {
        return jsonError("build_budget_data", err);
      }
      await renderBudgetPdf(pdfDoc, font, data, orgName);
      fileName = `예산대비실적표_${year}.pdf`;
    } else if (type === "balance") {
      const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const asOf = url.searchParams.get("asOf") || kstNow.toISOString().slice(0, 10);
      let data;
      try {
        data = await balanceSheet(asOf);
      } catch (err) {
        return jsonError("build_balance_data", err);
      }
      await renderStatementPdf(pdfDoc, font, "재무상태표", `${asOf} 현재`, data.rows, orgName);
      fileName = `재무상태표_${asOf}.pdf`;
    } else {
      // type === "cashflow"
      const { startDate, endDate, period } = resolvePeriod({
        period: url.searchParams.get("period"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        fiscalYear: url.searchParams.get("fiscalYear"),
      });
      let data;
      try {
        data = await buildCashflowData(startDate, endDate);
      } catch (err) {
        return jsonError("build_cashflow_data", err);
      }
      const periodLabel = `${startDate} ~ ${endDate} (${period})`;
      await renderCashflowPdf(pdfDoc, font, data, periodLabel, orgName);
      fileName = `현금흐름표_${startDate}_${endDate}.pdf`;
    }

    pdfBytes = await pdfDoc.save();
  } catch (err) {
    return jsonError("generate_pdf", err);
  }

  const encoded = encodeURIComponent(fileName);
  return new Response(Buffer.from(pdfBytes) as any, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      "Content-Length": String(pdfBytes.length),
    },
  });
}
