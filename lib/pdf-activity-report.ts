// lib/pdf-activity-report.ts
// ★ Phase M-19-3 (Q68-b): 활동보고서 PDF 생성
// - 기존 lib/pdf-receipt.ts와 동일한 한글 폰트 패턴 사용
// - subset:false (CMAP 누락 방지)
// - ArrayBuffer 캐시 + 매번 새 Uint8Array 반환

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import type { ReportData } from "./report-data-collector";
import type { GeneratedReport } from "./ai-report-generator";

/* ───────── 폰트 캐시 (ArrayBuffer로 보관) ───────── */
let _fontBufferCache: ArrayBuffer | null = null;

async function loadKoreanFontBytes(): Promise<Uint8Array> {
  if (_fontBufferCache) {
    /* 매번 새 Uint8Array 반환 (pdf-lib mutate 방어) */
    return new Uint8Array(_fontBufferCache);
  }

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

/* ───────── 헬퍼 ───────── */
const COLORS = {
  brand: rgb(0.478, 0.122, 0.169),       // #7a1f2b
  brandDark: rgb(0.227, 0.051, 0.078),   // #3a0d14
  ink: rgb(0.094, 0.094, 0.094),         // #181818
  gray: rgb(0.42, 0.42, 0.42),           // #6b6b6b
  light: rgb(0.96, 0.96, 0.94),          // #f5f5f0
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
  const newPage = ctx.pdfDoc.addPage([595, 842]); // A4
  return {
    ...ctx,
    page: newPage,
    cursorY: ctx.height - ctx.margin,
    pageNum: ctx.pageNum + 1,
  };
}

/* 텍스트를 폭에 맞게 자동 줄바꿈 */
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

/* HTML 태그를 단순 텍스트로 변환 (PDF용) */
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\/?(p|h[1-6]|li|ul|ol)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|b|em|i)[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ───────── 텍스트 그리기 ───────── */
function drawText(
  ctx: PageContext,
  text: string,
  options: {
    size?: number;
    color?: any;
    indent?: number;
    lineHeight?: number;
    bold?: boolean;
  } = {}
): PageContext {
  const size = options.size || 11;
  const color = options.color || COLORS.ink;
  const indent = options.indent || 0;
  const lineHeight = options.lineHeight || size * 1.6;
  const maxWidth = ctx.width - ctx.margin * 2 - indent;

  const lines = wrapText(text, maxWidth, size, ctx.font);

  let context = ctx;
  for (const line of lines) {
    /* 페이지 넘침 체크 */
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

/* ───────── 섹션 제목 ───────── */
function drawSectionTitle(ctx: PageContext, title: string): PageContext {
  let c = ctx;

  /* 페이지 여백 체크 */
  if (c.cursorY < c.margin + 100) {
    c = createNewPage(c);
    drawPageHeader(c);
  }

  c = { ...c, cursorY: c.cursorY - 10 };

  /* 좌측 색상 막대 */
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

/* ───────── 통계 박스 (KPI 카드) ───────── */
function drawStatBox(
  ctx: PageContext,
  label: string,
  value: string,
  width: number,
  x: number,
): void {
  const boxHeight = 50;

  ctx.page.drawRectangle({
    x,
    y: ctx.cursorY - boxHeight + 5,
    width,
    height: boxHeight,
    color: COLORS.light,
    borderColor: COLORS.border,
    borderWidth: 1,
  });

  ctx.page.drawText(label, {
    x: x + 10,
    y: ctx.cursorY - 12,
    size: 9,
    font: ctx.font,
    color: COLORS.gray,
  });

  ctx.page.drawText(value, {
    x: x + 10,
    y: ctx.cursorY - 32,
    size: 14,
    font: ctx.font,
    color: COLORS.brandDark,
  });
}

/* ───────── 페이지 헤더 (협회명) ───────── */
function drawPageHeader(ctx: PageContext): void {
  ctx.page.drawText("(사)교사유가족협의회 활동보고서", {
    x: ctx.margin,
    y: ctx.height - 25,
    size: 9,
    font: ctx.font,
    color: COLORS.gray,
  });

  ctx.page.drawText(`Page ${ctx.pageNum}`, {
    x: ctx.width - ctx.margin - 50,
    y: ctx.height - 25,
    size: 9,
    font: ctx.font,
    color: COLORS.gray,
  });

  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.height - 32 },
    end: { x: ctx.width - ctx.margin, y: ctx.height - 32 },
    thickness: 0.5,
    color: COLORS.border,
  });
}

/* ───────── 메인 PDF 생성 ───────── */
export async function buildActivityReportPdf(opts: {
  data: ReportData;
  generated: GeneratedReport;
  orgInfo?: {
    name?: string;
    address?: string;
    phone?: string;
  };
}): Promise<Uint8Array> {
  const { data, generated } = opts;
  const orgInfo = opts.orgInfo || {};

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadKoreanFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  const A4_WIDTH = 595;
  const A4_HEIGHT = 842;
  const MARGIN = 50;

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  let ctx: PageContext = {
    pdfDoc,
    page,
    font,
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margin: MARGIN,
    cursorY: A4_HEIGHT - MARGIN,
    pageNum: 1,
  };

  drawPageHeader(ctx);

  /* ===== 표지 영역 ===== */
  ctx = { ...ctx, cursorY: ctx.cursorY - 80 };

  /* 제목 */
  ctx.page.drawText(generated.title, {
    x: MARGIN,
    y: ctx.cursorY,
    size: 22,
    font: ctx.font,
    color: COLORS.brandDark,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 36 };

  /* 부제 (기간) */
  ctx.page.drawText(
    `${data.period.label} · ${formatDate(data.period.startDate)} ~ ${formatDate(data.period.endDate)}`,
    {
      x: MARGIN,
      y: ctx.cursorY,
      size: 12,
      font: ctx.font,
      color: COLORS.gray,
    }
  );
  ctx = { ...ctx, cursorY: ctx.cursorY - 28 };

  /* 발행 정보 */
  ctx.page.drawText(`발행일: ${formatDate(generated.generatedAt)}`, {
    x: MARGIN,
    y: ctx.cursorY,
    size: 11,
    font: ctx.font,
    color: COLORS.ink,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 20 };

  ctx.page.drawText(`발행: ${orgInfo.name || "(사)교사유가족협의회"}`, {
    x: MARGIN,
    y: ctx.cursorY,
    size: 11,
    font: ctx.font,
    color: COLORS.ink,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 40 };

  /* 구분선 */
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY },
    end: { x: A4_WIDTH - MARGIN, y: ctx.cursorY },
    thickness: 1.5,
    color: COLORS.brand,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 24 };

  /* ===== 핵심 통계 KPI (4개 박스) ===== */
  ctx = drawSectionTitle(ctx, "📊 핵심 지표");

  const boxWidth = (A4_WIDTH - MARGIN * 2 - 24) / 4;
  drawStatBox(ctx, "총 모금액", fmtKRW(data.donations.totalAmount), boxWidth, MARGIN);
  drawStatBox(ctx, "후원자 수", `${data.donations.donorCount}명`, boxWidth, MARGIN + boxWidth + 8);
  drawStatBox(ctx, "신규 회원", `${data.members.newMembersCount}명`, boxWidth, MARGIN + (boxWidth + 8) * 2);
  drawStatBox(ctx, "지원 처리", `${data.support.byStatus.completed}건`, boxWidth, MARGIN + (boxWidth + 8) * 3);
  ctx = { ...ctx, cursorY: ctx.cursorY - 70 };

  /* ===== 인사말 ===== */
  ctx = drawSectionTitle(ctx, "📜 인사말");
  ctx = drawText(ctx, stripHtml(generated.greeting), { size: 11, lineHeight: 18 });
  ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

  /* ===== 핵심 성과 ===== */
  ctx = drawSectionTitle(ctx, "✨ 핵심 성과");
  ctx = drawText(ctx, stripHtml(generated.highlights), { size: 11, lineHeight: 18 });
  ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

  /* ===== 상세 분석 ===== */
  ctx = drawSectionTitle(ctx, "📊 상세 분석");
  ctx = drawText(ctx, stripHtml(generated.detailedAnalysis), { size: 10.5, lineHeight: 17 });
  ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

  /* ===== 트렌드 분석 ===== */
  ctx = drawSectionTitle(ctx, "📈 트렌드 분석");
  ctx = drawText(ctx, stripHtml(generated.trendAnalysis), { size: 11, lineHeight: 18 });
  if (data.donations.growthRate !== null) {
    ctx = { ...ctx, cursorY: ctx.cursorY - 8 };
    ctx = drawText(ctx,
      `※ 직전 동일 기간 대비: ${data.donations.growthRate > 0 ? "+" : ""}${data.donations.growthRate}%`,
      { size: 10, color: COLORS.gray, indent: 0 }
    );
  }
  ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

  /* ===== 향후 계획 ===== */
  ctx = drawSectionTitle(ctx, "🎯 향후 계획");
  ctx = drawText(ctx, stripHtml(generated.futureOutlook), { size: 11, lineHeight: 18 });
  ctx = { ...ctx, cursorY: ctx.cursorY - 16 };

  /* ===== 마치며 ===== */
  ctx = drawSectionTitle(ctx, "🙏 마치며");
  ctx = drawText(ctx, stripHtml(generated.conclusion), { size: 11, lineHeight: 18 });
  ctx = { ...ctx, cursorY: ctx.cursorY - 24 };

  /* ===== 부록: 도메인별 세부 통계 ===== */
  if (ctx.cursorY < MARGIN + 200) {
    ctx = createNewPage(ctx);
    drawPageHeader(ctx);
  }

  ctx = drawSectionTitle(ctx, "📋 부록 — 도메인별 통계");

  const appendixLines = [
    `▶ 후원: 총 ${data.donations.totalCount}건 / 평균 ${fmtKRW(data.donations.avgAmount)} / 최고 ${fmtKRW(data.donations.maxAmount)}`,
    `   - 정기 후원: ${data.donations.regularCount}건 / 일시 후원: ${data.donations.onetimeCount}건`,
    `   - 결제수단: 카드 ${fmtKRW(data.donations.byPayMethod.card)} / CMS ${fmtKRW(data.donations.byPayMethod.cms)} / 계좌이체 ${fmtKRW(data.donations.byPayMethod.bank)}`,
    "",
    `▶ 회원: 신규 ${data.members.newMembersCount}명 / 탈퇴 ${data.members.withdrawnCount}명 / 종료 시점 활성 ${data.members.totalMembersAtEnd}명`,
    `   - 후원회원 ${data.members.byCategory.sponsor}명 / 일반 ${data.members.byCategory.regular}명 / 유족 ${data.members.byCategory.family}명 / 기타 ${data.members.byCategory.etc}명`,
    `   - 회원 유지율: ${data.members.retentionRate !== null ? data.members.retentionRate + "%" : "—"}`,
    "",
    `▶ 유가족 지원: 총 ${data.support.totalCount}건 (긴급 ${data.support.urgentCount}건)`,
    `   - 완료: ${data.support.byStatus.completed}건 / 진행중: ${data.support.byStatus.in_progress}건`,
    `   - 평균 처리: ${data.support.avgProcessingDays !== null ? data.support.avgProcessingDays + "일" : "—"} / 완료율: ${data.support.completionRate !== null ? data.support.completionRate + "%" : "—"}`,
    `   - 카테고리: 심리 ${data.support.byCategory.counseling} / 법률 ${data.support.byCategory.legal} / 장학 ${data.support.byCategory.scholarship} / 기타 ${data.support.byCategory.other}`,
    "",
    `▶ 사이렌 (교원 전용):`,
    `   - 사건 제보: ${data.siren.incident.total}건 (정식 ${data.siren.incident.sirenRequested}건, 답변 ${data.siren.incident.responded}건, 위급 ${data.siren.incident.criticalHigh}건)`,
    `   - 악성민원: ${data.siren.harassment.total}건 (정식 ${data.siren.harassment.sirenRequested}건, 답변 ${data.siren.harassment.responded}건, 위급 ${data.siren.harassment.criticalHigh}건)`,
    `   - 법률 상담: ${data.siren.legal.total}건 (매칭 신청 ${data.siren.legal.sirenRequested}건, 매칭 완료 ${data.siren.legal.matched}건, 긴급 ${data.siren.legal.urgent}건)`,
    `   - 자유게시판: 게시글 ${data.siren.board.totalPosts}건 / 댓글 ${data.siren.board.totalComments}건 / 고정 ${data.siren.board.pinnedCount}건`,
    "",
    `▶ 캠페인: 활성 ${data.campaigns.activeCampaigns}개 / 종료 ${data.campaigns.closedCampaigns}개 / 누적 모금 ${fmtKRW(data.campaigns.totalRaised)}`,
  ];

  for (const line of appendixLines) {
    if (line === "") {
      ctx = { ...ctx, cursorY: ctx.cursorY - 8 };
      continue;
    }
    ctx = drawText(ctx, line, { size: 10, lineHeight: 15, color: COLORS.ink });
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
    thickness: 0.8,
    color: COLORS.border,
  });
  ctx = { ...ctx, cursorY: ctx.cursorY - 20 };

  const footerLines = [
    `본 보고서는 ${orgInfo.name || "(사)교사유가족협의회"}의 운영 데이터를 기반으로 자동 생성되었습니다.`,
    `발행일: ${formatDate(generated.generatedAt)} · AI 모델: ${generated.aiModel}`,
    orgInfo.address ? `주소: ${orgInfo.address}` : "",
    orgInfo.phone ? `연락처: ${orgInfo.phone}` : "",
  ].filter(Boolean);

  for (const line of footerLines) {
    ctx = drawText(ctx, line, { size: 9, lineHeight: 14, color: COLORS.gray });
  }

  /* ===== 모든 페이지에 헤더 추가 ===== */
  /* (이미 createNewPage에서 처리됨) */

  return await pdfDoc.save();
}