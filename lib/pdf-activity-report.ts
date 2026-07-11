// lib/pdf-activity-report.ts
// Phase M-19-3 (Q68-b): 활동보고서 PDF 생성
// C안 (2026-05): customContentHtml 옵션 + 이미지 임베드
//
// - 기존: data + generated → 7섹션 자동 그리기
// - 신규: customContentHtml 우선 → 사용자가 수정한 최종 HTML 그대로 그림 + 이미지 포함

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import type { ReportData } from "./report-data-collector";
import type { GeneratedReport } from "./ai-report-generator";

/* ───────── 폰트 캐시 ───────── */
let _fontBufferCache: ArrayBuffer | null = null;

async function loadKoreanFontBytes(): Promise<Uint8Array> {
  if (_fontBufferCache) return new Uint8Array(_fontBufferCache);

  const candidates = [
    path.join(process.cwd(), "assets/fonts/NotoSansKR-Regular.ttf"),
    path.resolve("./assets/fonts/NotoSansKR-Regular.ttf"),
    "/var/task/assets/fonts/NotoSansKR-Regular.ttf",
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        _fontBufferCache = ab;
        return new Uint8Array(ab);
      }
    } catch (_) {}
  }
  throw new Error("NotoSansKR 폰트 파일을 찾을 수 없습니다");
}

/* ───────── 색상 ───────── */
const COLORS = {
  brand: rgb(0.478, 0.122, 0.169),
  brandDark: rgb(0.227, 0.051, 0.078),
  ink: rgb(0.094, 0.094, 0.094),
  gray: rgb(0.42, 0.42, 0.42),
  light: rgb(0.96, 0.96, 0.94),
  border: rgb(0.85, 0.85, 0.85),
  white: rgb(1, 1, 1),
};

function fmtKRW(n: number): string {
  return "₩" + (n || 0).toLocaleString();
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

interface PageContext {
  pdfDoc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  width: number;
  height: number;
  margin: number;
  cursorY: number;
  pageNum: number;
}

function createNewPage(ctx: PageContext): PageContext {
  const newPage = ctx.pdfDoc.addPage([595, 842]);
  return {
    ...ctx,
    page: newPage,
    cursorY: ctx.height - ctx.margin,
    pageNum: ctx.pageNum + 1,
  };
}

function wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const paragraphs = text.split(/\n/);
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let current = "";
    const chars = Array.from(para);
    for (const ch of chars) {
      const test = current + ch;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth && current.length > 0) {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\/?(p|h[1-6]|li|ul|ol|div)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|b|em|i|span)[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function drawText(
  ctx: PageContext,
  text: string,
  options: { size?: number; color?: any; indent?: number; lineHeight?: number } = {}
): PageContext {
  const size = options.size || 11;
  const color = options.color || COLORS.ink;
  const indent = options.indent || 0;
  const lineHeight = options.lineHeight || size * 1.6;
  const maxWidth = ctx.width - ctx.margin * 2 - indent;

  const lines = wrapText(text, maxWidth, size, ctx.font);

  let context = ctx;
  for (const line of lines) {
    if (context.cursorY < context.margin + 50) {
      context = createNewPage(context);
      drawPageHeader(context);
    }
    if (line) {
      context.page.drawText(line, {
        x: context.margin + indent,
        y: context.cursorY,
        size,
        font: context.font,
        color,
      });
    }
    context = { ...context, cursorY: context.cursorY - lineHeight };
  }
  return context;
}

function drawSectionTitle(ctx: PageContext, title: string): PageContext {
  let c = ctx;
  if (c.cursorY < c.margin + 100) {
    c = createNewPage(c);
    drawPageHeader(c);
  }
  c = { ...c, cursorY: c.cursorY - 10 };
  c.page.drawRectangle({
    x: c.margin,
    y: c.cursorY - 4,
    width: 4,
    height: 22,
    color: COLORS.brand,
  });
  c.page.drawText(title, {
    x: c.margin + 12,
    y: c.cursorY,
    size: 16,
    font: c.font,
    color: COLORS.brandDark,
  });
  return { ...c, cursorY: c.cursorY - 30 };
}

function drawStatBox(
  ctx: PageContext, label: string, value: string, width: number, x: number,
): void {
  const boxHeight = 50;
  ctx.page.drawRectangle({
    x, y: ctx.cursorY - boxHeight + 5,
    width, height: boxHeight,
    color: COLORS.light,
    borderColor: COLORS.border,
    borderWidth: 1,
  });
  ctx.page.drawText(label, {
    x: x + 10, y: ctx.cursorY - 12,
    size: 9, font: ctx.font, color: COLORS.gray,
  });
  ctx.page.drawText(value, {
    x: x + 10, y: ctx.cursorY - 32,
    size: 14, font: ctx.font, color: COLORS.brandDark,
  });
}

function drawPageHeader(ctx: PageContext): void {
  ctx.page.drawText("(사)교사유가족협의회 활동보고서", {
    x: ctx.margin, y: ctx.height - 25,
    size: 9, font: ctx.font, color: COLORS.gray,
  });
  ctx.page.drawText(`Page ${ctx.pageNum}`, {
    x: ctx.width - ctx.margin - 50, y: ctx.height - 25,
    size: 9, font: ctx.font, color: COLORS.gray,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.height - 32 },
    end: { x: ctx.width - ctx.margin, y: ctx.height - 32 },
    thickness: 0.5, color: COLORS.border,
  });
}

/* ═══════════ 이미지 처리 (C안 신규) ═══════════ */

interface HtmlSegment {
  type: "text" | "image" | "heading";
  value?: string;
  src?: string;
  level?: number;
}

/* HTML을 텍스트/이미지/제목 단위로 분할 */
function parseHtmlSegments(html: string): HtmlSegment[] {
  if (!html) return [];

  const segments: HtmlSegment[] = [];
  const tokenRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>|<h([1-4])[^>]*>([\s\S]*?)<\/h\2>/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const text = stripHtml(html.slice(lastIndex, match.index));
      if (text) segments.push({ type: "text", value: text });
    }

    if (match[1]) {
      /* <img> */
      segments.push({ type: "image", src: match[1] });
    } else if (match[2]) {
      /* <h2~h4> */
      const lv = Number(match[2]);
      const headingText = stripHtml(match[3] || "");
      if (headingText) segments.push({ type: "heading", value: headingText, level: lv });
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < html.length) {
    const text = stripHtml(html.slice(lastIndex));
    if (text) segments.push({ type: "text", value: text });
  }

  return segments;
}

/* 이미지 src를 가져와서 bytes 반환 */
async function fetchImageBytes(src: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    /* 1. data URI */
    if (src.startsWith("data:")) {
      const m = src.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      const mime = m[1].toLowerCase();
      const bytes = Buffer.from(m[2], "base64");
      return { bytes: new Uint8Array(bytes), mime };
    }

    /* 2. 상대 경로 → 절대 URL 변환 */
    let url = src;
    if (src.startsWith("/")) {
      const siteUrl = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
      url = siteUrl.replace(/\/$/, "") + src;
    }

    /* 3. fetch (10초 타임아웃) */
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow", signal: ctrl.signal as any });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;

    const mime = (res.headers.get("content-type") || "image/jpeg").toLowerCase().split(";")[0].trim();
    const ab = await res.arrayBuffer();
    return { bytes: new Uint8Array(ab), mime };
  } catch (e) {
    console.warn("[pdf-activity] fetchImageBytes 실패:", src.slice(0, 80), (e as any)?.message);
    return null;
  }
}

/* PDF에 이미지 그리기 */
async function drawImage(ctx: PageContext, src: string): Promise<PageContext> {
  const fetched = await fetchImageBytes(src);
  if (!fetched) {
    /* 이미지 로드 실패 → placeholder 텍스트 */
    return drawText(ctx, "[이미지를 불러올 수 없습니다]", {
      size: 9, color: COLORS.gray, indent: 0,
    });
  }

  let embedded: PDFImage | null = null;
  try {
    if (fetched.mime.includes("png")) {
      embedded = await ctx.pdfDoc.embedPng(fetched.bytes);
    } else if (fetched.mime.includes("jpeg") || fetched.mime.includes("jpg")) {
      embedded = await ctx.pdfDoc.embedJpg(fetched.bytes);
    } else {
      /* webp 등 미지원 → 시도해보고 실패하면 jpg 시도 */
      try {
        embedded = await ctx.pdfDoc.embedJpg(fetched.bytes);
      } catch {
        try {
          embedded = await ctx.pdfDoc.embedPng(fetched.bytes);
        } catch {
          embedded = null;
        }
      }
    }
  } catch (e) {
    console.warn("[pdf-activity] embedImage 실패:", (e as any)?.message);
    embedded = null;
  }

  if (!embedded) {
    return drawText(ctx, "[이미지 형식 미지원]", {
      size: 9, color: COLORS.gray,
    });
  }

  /* 크기 계산 (페이지 폭 맞춤, 최대 350px 높이) */
  const maxW = ctx.width - ctx.margin * 2;
  const maxH = 350;
  const ratio = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
  const w = embedded.width * ratio;
  const h = embedded.height * ratio;

  let c = ctx;
  /* 페이지 넘침 */
  if (c.cursorY - h < c.margin + 50) {
    c = createNewPage(c);
    drawPageHeader(c);
  }

  c.page.drawImage(embedded, {
    x: c.margin + (maxW - w) / 2, /* 가운데 정렬 */
    y: c.cursorY - h,
    width: w,
    height: h,
  });

  return { ...c, cursorY: c.cursorY - h - 14 };
}

/* HTML 세그먼트들을 그리는 통합 함수 */
async function drawHtmlContent(ctx: PageContext, html: string): Promise<PageContext> {
  const segments = parseHtmlSegments(html);
  let c = ctx;

  for (const seg of segments) {
    if (seg.type === "text" && seg.value) {
      c = drawText(c, seg.value, { size: 11, lineHeight: 18 });
      c = { ...c, cursorY: c.cursorY - 6 };
    } else if (seg.type === "heading" && seg.value) {
      /* 제목은 크고 진한 색 */
      const size = seg.level === 2 ? 14 : seg.level === 3 ? 13 : 12;
      c = { ...c, cursorY: c.cursorY - 6 };
      if (c.cursorY < c.margin + 60) {
        c = createNewPage(c);
        drawPageHeader(c);
      }
      c.page.drawText(seg.value, {
        x: c.margin, y: c.cursorY,
        size, font: c.font, color: COLORS.brandDark,
      });
      c = { ...c, cursorY: c.cursorY - size * 1.6 };
    } else if (seg.type === "image" && seg.src) {
      c = await drawImage(c, seg.src);
    }
  }
  return c;
}

/* ═══════════ 메인 PDF 생성 ═══════════ */

export async function buildActivityReportPdf(opts: {
  data: ReportData;
  generated: GeneratedReport;
  orgInfo?: { name?: string; address?: string; phone?: string };
  /* C안 신규: 사용자가 수정한 최종 HTML이 있으면 이걸 우선 사용 */
  customContentHtml?: string;
}): Promise<Uint8Array> {
  const { data, generated } = opts;
  const orgInfo = opts.orgInfo || {};
  const customHtml = (opts.customContentHtml || "").trim();

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadKoreanFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  const A4_WIDTH = 595;
  const A4_HEIGHT = 842;
  const MARGIN = 50;

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let ctx: PageContext = {
    pdfDoc, page, font,
    width: A4_WIDTH, height: A4_HEIGHT, margin: MARGIN,
    cursorY: A4_HEIGHT - MARGIN,
    pageNum: 1,
  };

  drawPageHeader(ctx);

  /* ===== 표지 ===== */
  ctx = { ...ctx, cursorY: ctx.cursorY - 80 };
  ctx.page.drawText(generated.title, {
    x: MARGIN, y: ctx.cursorY,
    size: 22, font: ctx.font, color: COLORS.brandDark,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 36 };

  ctx.page.drawText(
    `${data.period.label} · ${formatDate(data.period.startDate)} ~ ${formatDate(data.period.endDate)}`,
    { x: MARGIN, y: ctx.cursorY, size: 12, font: ctx.font, color: COLORS.gray }
  );
  ctx = { ...ctx, cursorY: ctx.cursorY - 28 };

  ctx.page.drawText(`발행일: ${formatDate(generated.generatedAt)}`, {
    x: MARGIN, y: ctx.cursorY, size: 11, font: ctx.font, color: COLORS.ink,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 20 };

  ctx.page.drawText(`발행: ${orgInfo.name || "(사)교사유가족협의회"}`, {
    x: MARGIN, y: ctx.cursorY, size: 11, font: ctx.font, color: COLORS.ink,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 40 };

  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY },
    end: { x: A4_WIDTH - MARGIN, y: ctx.cursorY },
    thickness: 1.5, color: COLORS.brand,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 24 };

  /* ===== KPI 박스 ===== */
  ctx = drawSectionTitle(ctx, "핵심 지표");
  const boxWidth = (A4_WIDTH - MARGIN * 2 - 24) / 4;
  drawStatBox(ctx, "총 모금액", fmtKRW(data.donations.totalAmount), boxWidth, MARGIN);
  drawStatBox(ctx, "후원자 수", `${data.donations.donorCount}명`, boxWidth, MARGIN + boxWidth + 8);
  drawStatBox(ctx, "신규 회원", `${data.members.newMembersCount}명`, boxWidth, MARGIN + (boxWidth + 8) * 2);
  drawStatBox(ctx, "지원 처리", `${data.support.byStatus.completed}건`, boxWidth, MARGIN + (boxWidth + 8) * 3);
  ctx = { ...ctx, cursorY: ctx.cursorY - 70 };

  /* ═════════ 본문 분기 ═════════ */
  if (customHtml) {
    /* 사용자가 수정한 최종안 우선 — 이미지 포함 */
    ctx = drawSectionTitle(ctx, "보고서 본문");
    ctx = await drawHtmlContent(ctx, customHtml);
    ctx = { ...ctx, cursorY: ctx.cursorY - 16 };
  } else {
    /* AI 생성 7섹션 (기존 동작) */
    ctx = drawSectionTitle(ctx, "인사말");
    ctx = drawText(ctx, stripHtml(generated.greeting), { size: 11, lineHeight: 18 });
    ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

    ctx = drawSectionTitle(ctx, "핵심 성과");
    ctx = drawText(ctx, stripHtml(generated.highlights), { size: 11, lineHeight: 18 });
    ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

    ctx = drawSectionTitle(ctx, "상세 분석");
    ctx = drawText(ctx, stripHtml(generated.detailedAnalysis), { size: 10.5, lineHeight: 17 });
    ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

    ctx = drawSectionTitle(ctx, "트렌드 분석");
    ctx = drawText(ctx, stripHtml(generated.trendAnalysis), { size: 11, lineHeight: 18 });
    if (data.donations.growthRate !== null) {
      ctx = { ...ctx, cursorY: ctx.cursorY - 8 };
      ctx = drawText(ctx,
        `※ 직전 동일 기간 대비: ${data.donations.growthRate > 0 ? "+" : ""}${data.donations.growthRate}%`,
        { size: 10, color: COLORS.gray }
      );
    }
    ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

    ctx = drawSectionTitle(ctx, "향후 계획");
    ctx = drawText(ctx, stripHtml(generated.futureOutlook), { size: 11, lineHeight: 18 });
    ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

    ctx = drawSectionTitle(ctx, "마치며");
    ctx = drawText(ctx, stripHtml(generated.conclusion), { size: 11, lineHeight: 18 });
    ctx = { ...ctx, cursorY: ctx.cursorY - 24 };
  }

  /* ===== 부록 ===== */
  if (ctx.cursorY < MARGIN + 200) {
    ctx = createNewPage(ctx);
    drawPageHeader(ctx);
  }
  ctx = drawSectionTitle(ctx, "부록 — 도메인별 통계");

  const appendixLines = [
    `▶ 후원: 총 ${data.donations.totalCount}건 / 평균 ${fmtKRW(data.donations.avgAmount)} / 최고 ${fmtKRW(data.donations.maxAmount)}`,
    `   - 정기 ${data.donations.regularCount}건 / 일시 ${data.donations.onetimeCount}건`,
    `   - 결제수단: 카드 ${fmtKRW(data.donations.byPayMethod.card)} / CMS ${fmtKRW(data.donations.byPayMethod.cms)} / 계좌 ${fmtKRW(data.donations.byPayMethod.bank)}`,
    "",
    `▶ 회원: 신규 ${data.members.newMembersCount}명 / 탈퇴 ${data.members.withdrawnCount}명 / 활성 ${data.members.totalMembersAtEnd}명`,
    `   - 후원 ${data.members.byCategory.sponsor} / 일반 ${data.members.byCategory.regular} / 유족 ${data.members.byCategory.family} / 기타 ${data.members.byCategory.etc}`,
    `   - 유지율: ${data.members.retentionRate !== null ? data.members.retentionRate + "%" : "—"}`,
    "",
    `▶ 유가족 지원: 총 ${data.support.totalCount}건 (긴급 ${data.support.urgentCount}건)`,
    `   - 완료 ${data.support.byStatus.completed} / 진행중 ${data.support.byStatus.in_progress}`,
    `   - 평균 처리 ${data.support.avgProcessingDays !== null ? data.support.avgProcessingDays + "일" : "—"} / 완료율 ${data.support.completionRate !== null ? data.support.completionRate + "%" : "—"}`,
    "",
    `▶ 사이렌:`,
    `   - 사건 ${data.siren.incident.total}건 / 악성민원 ${data.siren.harassment.total}건 / 법률 ${data.siren.legal.total}건`,
    `   - 자유게시판: 글 ${data.siren.board.totalPosts} / 댓글 ${data.siren.board.totalComments}`,
    "",
    `▶ 캠페인: 활성 ${data.campaigns.activeCampaigns} / 종료 ${data.campaigns.closedCampaigns} / 누적 ${fmtKRW(data.campaigns.totalRaised)}`,
  ];

  for (const line of appendixLines) {
    if (line === "") {
      ctx = { ...ctx, cursorY: ctx.cursorY - 8 };
      continue;
    }
    ctx = drawText(ctx, line, { size: 10, lineHeight: 15 });
  }

  /* ===== 푸터 ===== */
  if (ctx.cursorY < MARGIN + 80) {
    ctx = createNewPage(ctx);
    drawPageHeader(ctx);
  }
  ctx = { ...ctx, cursorY: ctx.cursorY - 30 };
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY },
    end: { x: A4_WIDTH - MARGIN, y: ctx.cursorY },
    thickness: 0.8, color: COLORS.border,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 20 };

  const footerLines = [
    `본 보고서는 ${orgInfo.name || "(사)교사유가족협의회"}의 운영 데이터를 기반으로 자동 생성되었습니다.`,
    `발행일: ${formatDate(generated.generatedAt)} · AI 모델: ${generated.aiModel}${customHtml ? " (사람 검토 반영)" : ""}`,
    orgInfo.address ? `주소: ${orgInfo.address}` : "",
    orgInfo.phone ? `연락처: ${orgInfo.phone}` : "",
  ].filter(Boolean);

  for (const line of footerLines) {
    ctx = drawText(ctx, line, { size: 9, lineHeight: 14, color: COLORS.gray });
  }

  return await pdfDoc.save();
}