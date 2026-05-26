/**
 * lib/martyrdom-export.ts — 순직 유족급여신청서 초안 내보내기 (G1·G4·§P3.2)
 *
 * exports:
 *   buildDraftHtml(caseId, outputId)     — 합본 HTML (PDF·docx·미리보기 공용 소스·운영자가 워드로 열어 수정)
 *   buildDraftPdf(caseId, outputId)      — pdf-lib + NotoSansKR (A4·섹션 순서·근거 각주)
 *   buildDraftDocx(caseId, outputId)     — docx 라이브러리 (제목·섹션 heading·본문 단락)
 *   buildCasePackageZip(caseId)          — fflate zipSync (자료 원문 + 분석 + 보고서)
 *
 * 모든 데이터는 raw SQL(sql.raw)로 로드 — 순직 모듈 schema 격리 원칙.
 */
import { PDFDocument, rgb, PDFFont, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { db } from "../db";
import { sql } from "drizzle-orm";

/* ============ 공통 데이터 로드 ============ */
export interface CaseInfo {
  id: number;
  caseNo: string;
  title: string;
  deceasedName: string | null;
  schoolName: string | null;
  position: string | null;
  deceasedAt: string | null;
}
export interface DraftSectionRow {
  id: number;
  sectionKey: string;
  title: string;
  content: string;
  ragSources: Array<{ title?: string; sourceRef?: string; snippet?: string }>;
  status: string;
  order: number;
  wordCount: number;
}

async function loadCaseInfo(caseId: number): Promise<CaseInfo | null> {
  const r: any = await db.execute(sql.raw(`
    SELECT id, case_no AS "caseNo", title, deceased_name AS "deceasedName",
           school_name AS "schoolName", position, deceased_at AS "deceasedAt"
    FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
  `));
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    caseNo: String(row.caseNo || `case-${caseId}`),
    title: String(row.title || ""),
    deceasedName: row.deceasedName ? String(row.deceasedName) : null,
    schoolName: row.schoolName ? String(row.schoolName) : null,
    position: row.position ? String(row.position) : null,
    deceasedAt: row.deceasedAt ? String(row.deceasedAt).slice(0, 10) : null,
  };
}

/* outputId 미지정 시 사건의 최신 'draft' 행 사용 */
async function resolveOutputId(caseId: number, outputId?: number): Promise<number | null> {
  if (outputId && outputId > 0) return outputId;
  const r: any = await db.execute(sql.raw(`
    SELECT id FROM martyrdom_ai_outputs
    WHERE case_id = ${caseId} AND output_type = 'draft'
    ORDER BY version DESC, id DESC LIMIT 1
  `));
  const row = (r?.rows ?? r ?? [])[0];
  return row ? Number(row.id) : null;
}

async function loadSections(outputId: number): Promise<DraftSectionRow[]> {
  const r: any = await db.execute(sql.raw(`
    SELECT id, section_key AS "sectionKey", title, content, rag_sources AS "ragSources",
           status, section_order AS "sectionOrder", word_count AS "wordCount"
    FROM martyrdom_draft_sections
    WHERE output_id = ${outputId}
    ORDER BY section_order ASC, id ASC
  `));
  return (r?.rows ?? r ?? []).map((row: any) => {
    let rag: any[] = [];
    if (row.ragSources) {
      try { rag = typeof row.ragSources === "string" ? JSON.parse(row.ragSources) : row.ragSources; } catch { rag = []; }
    }
    return {
      id: Number(row.id),
      sectionKey: String(row.sectionKey || ""),
      title: String(row.title || ""),
      content: String(row.content || ""),
      ragSources: Array.isArray(rag) ? rag : [],
      status: String(row.status || "pending"),
      order: Number(row.sectionOrder || 0),
      wordCount: Number(row.wordCount || 0),
    };
  });
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function todayKR(): string {
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/* ============ (1) buildDraftHtml ============ */
export async function buildDraftHtml(caseId: number, outputId?: number): Promise<string> {
  const info = await loadCaseInfo(caseId);
  const oid = await resolveOutputId(caseId, outputId);
  const sections = oid ? await loadSections(oid) : [];

  const metaParts: string[] = [];
  if (info?.deceasedName) metaParts.push(`고인: 故 ${esc(info.deceasedName)}`);
  if (info?.schoolName) metaParts.push(`소속: ${esc(info.schoolName)}`);
  if (info?.position) metaParts.push(`직위: ${esc(info.position)}`);
  if (info?.deceasedAt) metaParts.push(`사망일: ${esc(info.deceasedAt)}`);

  const sectionHtml = sections.map((sec, i) => {
    const body = esc(sec.content || "")
      .split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
    const sources = sec.ragSources.length
      ? `<div class="sources"><strong>근거 ${sec.ragSources.length}건</strong><ul>` +
        sec.ragSources.map(r => `<li>${esc(r.title || r.sourceRef || "")}${r.snippet ? ` — <span class="snip">${esc(String(r.snippet).slice(0, 120))}</span>` : ""}</li>`).join("") +
        `</ul></div>`
      : "";
    return `<section><h2>${i + 1}. ${esc(sec.title)}</h2>\n${body}\n${sources}</section>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>유족급여신청서 초안 - ${esc(info?.caseNo || "")}</title>
<style>
  body { font-family: "Malgun Gothic", "맑은 고딕", sans-serif; line-height: 1.8; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 40px 24px; }
  h1 { text-align: center; font-size: 22px; margin-bottom: 8px; }
  .meta { text-align: center; color: #555; font-size: 13px; margin-bottom: 4px; }
  .draft-banner { background: #fff3cd; border: 1px solid #ffc107; color: #856404; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin: 16px 0 24px; }
  section { margin-bottom: 28px; }
  h2 { font-size: 17px; border-left: 4px solid #7a1f2b; padding-left: 10px; margin: 24px 0 12px; }
  p { margin: 0 0 12px; text-align: justify; }
  .sources { background: #f6f6f4; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #555; margin-top: 10px; }
  .sources ul { margin: 6px 0 0; padding-left: 18px; }
  .snip { color: #888; }
  .footer { margin-top: 40px; text-align: center; color: #333; }
</style></head>
<body>
  <h1>유족급여신청서 (초안)</h1>
  ${info?.title ? `<div class="meta">${esc(info.title)}</div>` : ""}
  ${metaParts.length ? `<div class="meta">${metaParts.join(" · ")}</div>` : ""}
  <div class="draft-banner">⚠️ 본 문서는 AI가 생성한 <strong>전문가 검토용 초안</strong>입니다. 제출 전 반드시 전문가(노무사·변호사) 검토·교정이 필요합니다.</div>
  ${sectionHtml || "<p>(생성된 섹션이 없습니다. 목차 제안 후 본문을 생성하세요.)</p>"}
  <div class="footer">${todayKR()}<br>(사)교사유가족협의회</div>
</body></html>`;
}

/* ============ (2) buildDraftPdf — pdf-lib + NotoSansKR ============ */
let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const fontPath = join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf");
    const buf = readFileSync(fontPath);
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array(_fontCache.slice(0));
}

const A4 = { w: 595, h: 842 };
const MARGIN = 50;

function wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para.trim()) { lines.push(""); continue; }
    let cur = "";
    for (const ch of Array.from(para)) {
      const test = cur + ch;
      if (font.widthOfTextAtSize(test, fontSize) > maxWidth && cur.length > 0) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

export async function buildDraftPdf(caseId: number, outputId?: number): Promise<Uint8Array> {
  const info = await loadCaseInfo(caseId);
  const oid = await resolveOutputId(caseId, outputId);
  const sections = oid ? await loadSections(oid) : [];

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  const font = await pdf.embedFont(loadKoreanFont(), { subset: false });

  const black = rgb(0, 0, 0);
  const gray = rgb(0.42, 0.42, 0.42);
  const brand = rgb(0.478, 0.122, 0.169);
  const warn = rgb(0.52, 0.39, 0.02);

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const maxW = A4.w - MARGIN * 2;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 20) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - MARGIN;
    }
  };
  const drawLines = (text: string, size: number, color: any, lh = 0, indent = 0) => {
    const lineHeight = lh || size * 1.7;
    for (const line of wrapText(text, maxW - indent, size, font)) {
      ensure(lineHeight);
      if (line) page.drawText(line, { x: MARGIN + indent, y, size, font, color });
      y -= lineHeight;
    }
  };
  const center = (text: string, size: number, color: any) => {
    const tw = font.widthOfTextAtSize(text, size);
    ensure(size * 1.7);
    page.drawText(text, { x: (A4.w - tw) / 2, y, size, font, color });
    y -= size * 1.9;
  };

  /* 제목 */
  center("유족급여신청서 (초안)", 20, black);
  if (info?.title) center(info.title, 11, gray);
  const metaParts: string[] = [];
  if (info?.deceasedName) metaParts.push(`고인: 故 ${info.deceasedName}`);
  if (info?.schoolName) metaParts.push(info.schoolName);
  if (info?.position) metaParts.push(info.position);
  if (info?.deceasedAt) metaParts.push(`사망일 ${info.deceasedAt}`);
  if (metaParts.length) center(metaParts.join("  ·  "), 10, gray);
  y -= 6;

  /* 검토용 초안 배너 */
  drawLines("※ 본 문서는 AI가 생성한 전문가 검토용 초안입니다. 제출 전 반드시 전문가 검토·교정이 필요합니다.", 9, warn);
  y -= 10;

  if (sections.length === 0) {
    drawLines("(생성된 섹션이 없습니다. 목차 제안 후 본문을 생성하세요.)", 11, gray);
  }

  sections.forEach((sec, i) => {
    ensure(40);
    y -= 8;
    /* 섹션 제목 */
    ensure(24);
    page.drawRectangle({ x: MARGIN, y: y - 3, width: 4, height: 18, color: brand });
    page.drawText(`${i + 1}. ${sec.title}`, { x: MARGIN + 12, y, size: 14, font, color: brand });
    y -= 26;
    /* 본문 */
    drawLines(sec.content || "(미생성)", 11, black);
    /* 근거 각주 */
    if (sec.ragSources.length) {
      y -= 6;
      drawLines(`근거 ${sec.ragSources.length}건:`, 9, gray);
      sec.ragSources.forEach((r, k) => {
        drawLines(`  [${k + 1}] ${r.title || r.sourceRef || ""}`, 8.5, gray, 0, 10);
      });
    }
    y -= 8;
  });

  /* 푸터 */
  ensure(40);
  y -= 14;
  center(`${todayKR()}   (사)교사유가족협의회`, 10, gray);

  return pdf.save();
}

/* ============ (3) buildDraftDocx — docx 라이브러리 ============ */
export async function buildDraftDocx(caseId: number, outputId?: number): Promise<Uint8Array> {
  const info = await loadCaseInfo(caseId);
  const oid = await resolveOutputId(caseId, outputId);
  const sections = oid ? await loadSections(oid) : [];

  const children: Paragraph[] = [];

  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "유족급여신청서 (초안)", bold: true, size: 40 })],
  }));
  if (info?.title) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: info.title, color: "555555", size: 22 })] }));
  }
  const metaParts: string[] = [];
  if (info?.deceasedName) metaParts.push(`고인: 故 ${info.deceasedName}`);
  if (info?.schoolName) metaParts.push(info.schoolName);
  if (info?.position) metaParts.push(info.position);
  if (info?.deceasedAt) metaParts.push(`사망일 ${info.deceasedAt}`);
  if (metaParts.length) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: metaParts.join("  ·  "), color: "777777", size: 20 })] }));
  }
  children.push(new Paragraph({
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text: "※ 본 문서는 AI가 생성한 전문가 검토용 초안입니다. 제출 전 반드시 전문가 검토·교정이 필요합니다.", italics: true, color: "856404", size: 18 })],
  }));

  if (sections.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "(생성된 섹션이 없습니다.)", color: "888888" })] }));
  }

  sections.forEach((sec, i) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 320, after: 120 },
      children: [new TextRun({ text: `${i + 1}. ${sec.title}`, bold: true })],
    }));
    const body = sec.content || "(미생성)";
    for (const para of body.split(/\n{2,}/)) {
      if (!para.trim()) continue;
      children.push(new Paragraph({
        spacing: { after: 120, line: 360 },
        children: para.split(/\n/).map((ln, idx) =>
          new TextRun({ text: ln, break: idx > 0 ? 1 : undefined })),
      }));
    }
    if (sec.ragSources.length) {
      children.push(new Paragraph({
        spacing: { before: 80 },
        children: [new TextRun({ text: `근거 ${sec.ragSources.length}건: ` + sec.ragSources.map((r, k) => `[${k + 1}] ${r.title || r.sourceRef || ""}`).join("  "), color: "777777", size: 16 })],
      }));
    }
  });

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480 },
    children: [new TextRun({ text: `${todayKR()}   (사)교사유가족협의회`, color: "555555" })],
  }));

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

/* ============ (4) buildCasePackageZip — fflate zipSync ============ */
function safeName(s: string): string {
  return String(s || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

export async function buildCasePackageZip(caseId: number): Promise<Uint8Array> {
  const info = await loadCaseInfo(caseId);
  const files: Record<string, Uint8Array> = {};

  /* (a) 자료 원문 텍스트 */
  try {
    const docsRes: any = await db.execute(sql.raw(`
      SELECT id, file_name AS "fileName", doc_type AS "docType",
             doc_summary AS "docSummary", extracted_text AS "extractedText"
      FROM martyrdom_case_documents
      WHERE case_id = ${caseId} AND extracted_text IS NOT NULL
      ORDER BY created_at ASC
    `));
    let n = 0;
    for (const d of (docsRes?.rows ?? docsRes ?? [])) {
      n++;
      const fn = safeName(`${String(n).padStart(2, "0")}_${d.fileName || `doc${d.id}`}`);
      const header = `[자료유형] ${d.docType || "미분류"}\n[요약] ${d.docSummary || ""}\n[원본파일] ${d.fileName || ""}\n\n----- 추출 원문 -----\n\n`;
      files[`자료원문/${fn}.txt`] = strToU8(header + String(d.extractedText || ""));
    }
  } catch (e: any) { console.warn("[package] 자료 원문 로드 실패", e?.message); }

  /* (b) 분석 산출물 (전략·요건·준비도) */
  try {
    const types = [
      { t: "strategy", label: "전략분석" },
      { t: "criteria_check", label: "인정요건대조" },
      { t: "readiness", label: "보고서준비도" },
      { t: "golden", label: "골든타임제언" },
    ];
    for (const { t, label } of types) {
      const r: any = await db.execute(sql.raw(`
        SELECT content_json AS "contentJson" FROM martyrdom_ai_outputs
        WHERE case_id = ${caseId} AND output_type = '${t}'
        ORDER BY version DESC, id DESC LIMIT 1
      `));
      const row = (r?.rows ?? r ?? [])[0];
      if (row?.contentJson) {
        const json = typeof row.contentJson === "string" ? row.contentJson : JSON.stringify(row.contentJson, null, 2);
        files[`분석/${label}.json`] = strToU8(json);
      }
    }
  } catch (e: any) { console.warn("[package] 분석 산출물 로드 실패", e?.message); }

  /* (c) 보고서 (PDF·HTML) — 최신 draft 있으면 */
  try {
    const oid = await resolveOutputId(caseId);
    if (oid) {
      const sections = await loadSections(oid);
      if (sections.length > 0) {
        files["보고서/유족급여신청서_초안.pdf"] = await buildDraftPdf(caseId, oid);
        files["보고서/유족급여신청서_초안.html"] = strToU8(await buildDraftHtml(caseId, oid));
      }
    }
  } catch (e: any) { console.warn("[package] 보고서 생성 실패", e?.message); }

  /* (d) README */
  const readme = `사건 패키지 — ${info?.caseNo || `case-${caseId}`}\n` +
    `${info?.title || ""}\n` +
    (info?.deceasedName ? `고인: 故 ${info.deceasedName}\n` : "") +
    `생성일: ${todayKR()}\n\n` +
    `구성:\n- 자료원문/ : 업로드 자료 추출 텍스트\n- 분석/ : AI 전략·요건·준비도·골든타임 산출물(JSON)\n- 보고서/ : 유족급여신청서 초안(PDF·HTML)\n\n` +
    `※ 모든 AI 산출물은 전문가 검토용 초안입니다. 제출 전 전문가 검토·교정 필수.\n(사)교사유가족협의회`;
  files["README.txt"] = strToU8(readme);

  return zipSync(files, { level: 6 });
}
