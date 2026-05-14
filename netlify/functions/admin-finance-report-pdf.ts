/**
 * GET /api/admin-finance-report-pdf
 *   ?type=pl     + period|startDate|endDate  → 운영성과표 PDF
 *   ?type=budget + year                      → 예산 대비 실적표 PDF
 *
 * Phase 22-B-R3 — NPO 표준 회계 보고서 PDF 생성
 * pl-summary / budget-list 집계 로직 재사용 → pdf-lib A4 PDF
 * 한글 폰트: assets/fonts/NotoSansKR-Regular.ttf
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { donations, otherRevenues, revenueCategories, expenses, expenseCategories } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { eq, and, sql } from "drizzle-orm";
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
  return new Response(JSON.stringify({
    ok: false, error: "회계 보고서 PDF 생성 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")} 원`;

/* ═══════════════ 운영성과표 데이터 (pl-summary 로직 재사용) ═══════════════ */
async function buildPlData(startDate: string, endDate: string, fiscalYear: number | null) {
  // 후원 gross
  let donationGross = 0, donationRefund = 0;
  try {
    const rows = await db
      .select({ total: sql<string>`COALESCE(SUM(${donations.amount}), 0)` })
      .from(donations)
      .where(and(
        eq(donations.status, "completed"),
        sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})::date BETWEEN ${startDate}::date AND ${endDate}::date`
      ));
    donationGross = Number(rows[0]?.total || 0);
  } catch (err) { console.warn("[report-pdf] 후원 집계 실패", err); }

  try {
    const rows = await db
      .select({ total: sql<string>`COALESCE(SUM(${donations.amount}), 0)` })
      .from(donations)
      .where(and(
        eq(donations.status, "refunded"),
        sql`COALESCE(${donations.hyosungPaidDate}, ${donations.createdAt})::date BETWEEN ${startDate}::date AND ${endDate}::date`
      ));
    donationRefund = Number(rows[0]?.total || 0);
  } catch (err) { console.warn("[report-pdf] 후원 환불 집계 실패", err); }

  // 후원 외 수입 카테고리
  const revCatMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db
      .select({ id: revenueCategories.id, code: revenueCategories.code, name: revenueCategories.name })
      .from(revenueCategories);
    for (const c of cats) revCatMap.set(c.id, { code: c.code, name: c.name });
  } catch (err) { console.warn("[report-pdf] 수입 카테고리 조회 실패", err); }

  let otherGross = 0, otherRefund = 0;
  const otherCatNetMap = new Map<number, { code: string; name: string; gross: number; refund: number }>();
  try {
    const rows = await db
      .select({
        categoryId: otherRevenues.categoryId,
        gross: sql<string>`COALESCE(SUM(${otherRevenues.amount}), 0)`,
        refund: sql<string>`COALESCE(SUM(${otherRevenues.refundAmount}), 0)`,
      })
      .from(otherRevenues)
      .where(and(
        eq(otherRevenues.status, "approved"),
        sql`${otherRevenues.recognizedAt}::date BETWEEN ${startDate}::date AND ${endDate}::date`
      ))
      .groupBy(otherRevenues.categoryId);
    for (const row of rows) {
      const g = Number(row.gross), r = Number(row.refund);
      otherGross += g; otherRefund += r;
      const cat = revCatMap.get(row.categoryId) || { code: String(row.categoryId), name: "기타" };
      if (!otherCatNetMap.has(row.categoryId)) {
        otherCatNetMap.set(row.categoryId, { code: cat.code, name: cat.name, gross: 0, refund: 0 });
      }
      const e = otherCatNetMap.get(row.categoryId)!;
      e.gross += g; e.refund += r;
    }
  } catch (err) { console.warn("[report-pdf] 후원 외 수입 집계 실패", err); }

  const otherByCategory = Array.from(otherCatNetMap.values())
    .map(c => ({ code: c.code, name: c.name, net: c.gross - c.refund }))
    .sort((a, b) => b.net - a.net);

  // 지출 카테고리
  const expCatMap = new Map<number, { code: string; name: string }>();
  try {
    const cats = await db
      .select({ id: expenseCategories.id, code: expenseCategories.code, name: expenseCategories.name })
      .from(expenseCategories);
    for (const c of cats) expCatMap.set(c.id, { code: c.code, name: c.name });
  } catch (err) { console.warn("[report-pdf] 지출 카테고리 조회 실패", err); }

  let expenseGross = 0, expenseRefund = 0;
  const expCatNetMap = new Map<number, { code: string; name: string; gross: number; refund: number }>();
  try {
    const conds: any[] = [
      eq(expenses.status, "approved"),
      sql`${expenses.occurredAt}::date BETWEEN ${startDate}::date AND ${endDate}::date`,
    ];
    if (fiscalYear !== null) conds.push(eq(expenses.fiscalYear, fiscalYear));
    const rows = await db
      .select({
        categoryId: expenses.categoryId,
        gross: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
        refund: sql<string>`COALESCE(SUM(${expenses.refundAmount}), 0)`,
      })
      .from(expenses)
      .where(and(...conds))
      .groupBy(expenses.categoryId);
    for (const row of rows) {
      const g = Number(row.gross), r = Number(row.refund);
      expenseGross += g; expenseRefund += r;
      const cat = expCatMap.get(row.categoryId) || { code: String(row.categoryId), name: "기타" };
      if (!expCatNetMap.has(row.categoryId)) {
        expCatNetMap.set(row.categoryId, { code: cat.code, name: cat.name, gross: 0, refund: 0 });
      }
      const e = expCatNetMap.get(row.categoryId)!;
      e.gross += g; e.refund += r;
    }
  } catch (err) { console.warn("[report-pdf] 지출 집계 실패", err); }

  const expenseByCategory = Array.from(expCatNetMap.values())
    .map(c => ({ code: c.code, name: c.name, total: c.gross - c.refund }))
    .sort((a, b) => b.total - a.total);

  const donationNet = donationGross - donationRefund;
  const otherNet = otherGross - otherRefund;
  const revenueTotal = donationNet + otherNet;
  const expenditureTotal = expenseGross - expenseRefund;

  return {
    donationNet, otherNet, otherByCategory,
    revenueTotal,
    expenseByCategory, expenditureTotal,
    netIncome: revenueTotal - expenditureTotal,
  };
}

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

  const lineRows: any = await db.execute(sql`
    SELECT bl.id, bl.category_id, bl.planned_amount,
           ec.code AS category_code, ec.name AS category_name
    FROM budget_lines bl
    JOIN expense_categories ec ON ec.id = bl.category_id
    WHERE bl.plan_id = ${Number(plan.id)}
    ORDER BY ec.sort_order, ec.id
  `);
  const lines = lineRows?.rows ?? lineRows ?? [];

  const execByCatId = new Map<number, number>();
  try {
    const execRows: any = await db.execute(sql`
      SELECT category_id, COALESCE(SUM(amount - refund_amount), 0)::bigint AS executed
      FROM expenses WHERE fiscal_year = ${year} AND status = 'approved'
      GROUP BY category_id
    `);
    for (const r of (execRows?.rows ?? execRows ?? [])) {
      execByCatId.set(Number(r.category_id), Number(r.executed));
    }
  } catch (err: any) { console.warn("[report-pdf] expenses 집계 실패", err?.message); }

  const items = lines.map((r: any) => {
    const planned = Number(r.planned_amount);
    const executed = execByCatId.get(Number(r.category_id)) ?? 0;
    return {
      categoryName: r.category_name,
      plannedAmount: planned,
      executedAmount: executed,
      remaining: planned - executed,
      rate: planned > 0 ? Math.round((executed / planned) * 100) : 0,
    };
  });

  const totalPlanned = items.reduce((s: number, i: any) => s + i.plannedAmount, 0);
  const totalExecuted = items.reduce((s: number, i: any) => s + i.executedAmount, 0);

  return {
    noPlan: false, year,
    planTitle: plan.title,
    items,
    totalPlanned, totalExecuted,
    totalRemaining: totalPlanned - totalExecuted,
    executionRate: totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0,
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

/* ═══════════════ 운영성과표 PDF ═══════════════ */
async function renderPlPdf(
  pdfDoc: PDFDocument, font: PDFFont,
  data: Awaited<ReturnType<typeof buildPlData>>,
  periodLabel: string, orgName: string
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
  text(ctx, "운영성과표 (Statement of Operations)", ctx.margin, 18);
  ctx.y -= 18;
  text(ctx, `기간: ${periodLabel}`, ctx.margin, 10, rgb(0.3, 0.3, 0.3));
  textRight(ctx, `생성일시: ${genAt}`, rightX, 9, rgb(0.5, 0.5, 0.5));
  ctx.y -= 10;
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 28;

  // Ⅰ. 사업수익
  text(ctx, "Ⅰ. 사업수익", ctx.margin, 13);
  ctx.y -= 22;
  text(ctx, "  1. 후원금수익", ctx.margin, 11);
  textRight(ctx, won(data.donationNet), rightX, 11);
  ctx.y -= 20;
  text(ctx, "  2. 사업수익 (후원 외)", ctx.margin, 11);
  textRight(ctx, won(data.otherNet), rightX, 11);
  ctx.y -= 18;
  for (const c of data.otherByCategory) {
    ensureSpace(ctx, 18);
    text(ctx, `      · ${c.name}`, ctx.margin, 9.5, rgb(0.35, 0.35, 0.35));
    textRight(ctx, won(c.net), rightX, 9.5, rgb(0.35, 0.35, 0.35));
    ctx.y -= 16;
  }
  ctx.y -= 4;
  hr(ctx);
  ctx.y -= 18;
  text(ctx, "  사업수익 계", ctx.margin, 11.5, rgb(0.1, 0.1, 0.5));
  textRight(ctx, won(data.revenueTotal), rightX, 11.5, rgb(0.1, 0.1, 0.5));
  ctx.y -= 32;

  // Ⅱ. 사업비용
  ensureSpace(ctx, 60);
  text(ctx, "Ⅱ. 사업비용", ctx.margin, 13);
  ctx.y -= 22;
  if (data.expenseByCategory.length === 0) {
    text(ctx, "  (집행 내역 없음)", ctx.margin, 10, rgb(0.5, 0.5, 0.5));
    ctx.y -= 18;
  }
  for (const c of data.expenseByCategory) {
    ensureSpace(ctx, 20);
    text(ctx, `  · ${c.name}`, ctx.margin, 11);
    textRight(ctx, won(c.total), rightX, 11);
    ctx.y -= 20;
  }
  ctx.y -= 4;
  hr(ctx);
  ctx.y -= 18;
  text(ctx, "  사업비용 계", ctx.margin, 11.5, rgb(0.5, 0.1, 0.1));
  textRight(ctx, won(data.expenditureTotal), rightX, 11.5, rgb(0.5, 0.1, 0.1));
  ctx.y -= 32;

  // Ⅲ. 운영성과
  ensureSpace(ctx, 40);
  hr(ctx, 1, rgb(0.2, 0.2, 0.2));
  ctx.y -= 22;
  const netColor = data.netIncome >= 0 ? rgb(0.1, 0.35, 0.1) : rgb(0.6, 0.1, 0.1);
  text(ctx, "Ⅲ. 운영성과 (Ⅰ − Ⅱ)", ctx.margin, 13, netColor);
  textRight(ctx, won(data.netIncome), rightX, 13, netColor);
  ctx.y -= 22;
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

/* ═══════════════ 핸들러 ═══════════════ */
export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const orgName = process.env.ORG_NAME || "(사)교사유가족협의회";

  if (type !== "pl" && type !== "budget") {
    return new Response(JSON.stringify({
      ok: false, error: "type 파라미터는 pl 또는 budget 이어야 합니다",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  let pdfBytes: Uint8Array;
  let fileName: string;

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit as any);
    const font = await pdfDoc.embedFont(loadKoreanFont(), { subset: false });

    if (type === "pl") {
      const { startDate, endDate, period, fiscalYear } = resolvePeriod({
        period: url.searchParams.get("period"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        fiscalYear: url.searchParams.get("fiscalYear"),
      });
      let data;
      try {
        data = await buildPlData(startDate, endDate, fiscalYear);
      } catch (err) {
        return jsonError("build_pl_data", err);
      }
      const periodLabel = `${startDate} ~ ${endDate} (${period})`;
      await renderPlPdf(pdfDoc, font, data, periodLabel, orgName);
      fileName = `운영성과표_${startDate}_${endDate}.pdf`;
    } else {
      const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));
      let data;
      try {
        data = await buildBudgetData(year);
      } catch (err) {
        return jsonError("build_budget_data", err);
      }
      await renderBudgetPdf(pdfDoc, font, data, orgName);
      fileName = `예산대비실적표_${year}.pdf`;
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
