/**
 * admin-martyrdom-publication-export — 발간물 HTML/PDF export (G1·P4)
 *
 * POST { id, format }    format: 'html' | 'pdf'
 *
 * 응답: { ok, fileName, mimeType, base64 }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { roleForbidden } from "../../lib/admin-role";
import { canAccess } from "../../lib/role-permission-check";
import { readFileSync } from "fs";
import { join } from "path";
import { PDFDocument, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const config = { path: "/api/admin-martyrdom-publication-export" };

/* 발간물 내보내기 쓰기 권한 — 권한 정책 관리에서 토글 (operator 허용 기본·메인 시드) */
const PUB_EXPORT_FEATURE = "martyrdom_pub_export";

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

/* 폰트 캐시 */
let _fontCache: ArrayBuffer | null = null;
function loadKoreanFont(): Uint8Array {
  if (!_fontCache) {
    const fontPath = join(process.cwd(), "assets", "fonts", "NotoSansKR-Regular.ttf");
    const buf = readFileSync(fontPath);
    _fontCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array((_fontCache as ArrayBuffer).slice(0));
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

/* HTML 태그 제거 + 간단한 구조 보존 */
function htmlToLines(html: string): Array<{ text: string; isH1: boolean; isH2: boolean; isH3: boolean }> {
  const lines: Array<{ text: string; isH1: boolean; isH2: boolean; isH3: boolean }> = [];
  const stripped = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");

  const h1Regex = /<h1[^>]*>(.*?)<\/h1>/gis;
  const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gis;
  const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gis;

  /* 섹션별로 파싱 */
  let cur = stripped;
  /* h1 제목 */
  const h1m = cur.match(/<h1[^>]*>(.*?)<\/h1>/is);
  if (h1m) {
    lines.push({ text: h1m[1].replace(/<[^>]+>/g, "").trim(), isH1: true, isH2: false, isH3: false });
    cur = cur.replace(h1m[0], "");
  }

  /* 나머지 블록 순서대로 */
  const blockRe = /<(h2|h3|p|ul)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(stripped)) !== null) {
    const tag = match[1].toLowerCase();
    const content = match[2].replace(/<[^>]+>/g, "").trim();
    if (!content) continue;
    if (tag === "h2") {
      lines.push({ text: content, isH1: false, isH2: true, isH3: false });
    } else if (tag === "h3") {
      lines.push({ text: content, isH1: false, isH2: false, isH3: true });
    } else {
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (t) lines.push({ text: t, isH1: false, isH2: false, isH3: false });
      }
    }
  }
  return lines;
}

async function buildPublicationPdf(pub: any): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  const font = await pdf.embedFont(loadKoreanFont(), { subset: false });

  const black = rgb(0, 0, 0);
  const brand = rgb(0.478, 0.122, 0.169);
  const gray  = rgb(0.4, 0.4, 0.4);

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const maxW = A4.w - MARGIN * 2;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - MARGIN;
    }
  }

  function drawLine(text: string, size: number, color = black, indent = 0) {
    const lines = wrapText(text, maxW - indent, size, font);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(line, { x: MARGIN + indent, y, size, font, color });
      y -= size + 4;
    }
  }

  const title = String(pub.title || "발간물");
  const contentHtml = String(pub.contentHtml || "");
  const blendRatio = pub.blendRatio || { self: 70, ai: 30 };
  const reidRisk   = String(pub.reidRisk || "low");

  /* 제목 */
  drawLine(title, 16, brand);
  y -= 8;
  drawLine(`자체 ${blendRatio.self}% · AI ${blendRatio.ai}% · 비식별화 처리 · 재식별 위험: ${reidRisk}`, 9, gray);
  y -= 12;

  /* 구분선 */
  ensureSpace(4);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: gray });
  y -= 16;

  /* 본문 파싱 */
  const sections = htmlToLines(contentHtml);
  for (const s of sections) {
    if (s.isH1) {
      y -= 4;
      drawLine(s.text, 14, brand);
      y -= 4;
    } else if (s.isH2) {
      y -= 8;
      drawLine(s.text, 12, brand);
      y -= 2;
    } else if (s.isH3) {
      y -= 4;
      drawLine(s.text, 11, black);
      y -= 2;
    } else {
      drawLine(s.text, 10, black);
    }
  }

  /* 면책 고지 */
  y -= 16;
  ensureSpace(20);
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: gray });
  y -= 12;
  drawLine("본 보고서는 AI 보조 초안입니다. 외부 발간 전 전문가 검수 필수.", 9, gray);

  return pdf.save();
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  /* R41 Q2-054: 내보내기 쓰기 권한 게이트 (미정의 키면 admin 허용 기본) */
  if (!(await canAccess(auth.ctx.member.role ?? "", PUB_EXPORT_FEATURE))) return roleForbidden("operator");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

  const id     = Number(body?.id || 0);
  const format = String(body?.format || "html").toLowerCase();
  if (!id) return badRequest("id 필수");
  if (!["html", "pdf"].includes(format)) return badRequest("format은 html|pdf");

  try {
    const r: any = await db.execute(sql.raw(`
      SELECT id, pub_type AS "pubType", title, content_html AS "contentHtml",
             blend_ratio AS "blendRatio", reid_risk AS "reidRisk", status
      FROM martyrdom_publications WHERE id = ${id} LIMIT 1
    `));
    const pub = (r?.rows ?? r ?? [])[0];
    if (!pub) return badRequest("발간물을 찾을 수 없습니다");

    const safeTitle = (pub.title || "발간물").replace(/[\/\\:*?"<>|]/g, "_");

    if (format === "html") {
      const htmlContent = String(pub.contentHtml || "<p>내용 없음</p>");
      const fullHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${safeTitle}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px}h1{color:#7a1e2b}h2{color:#7a1e2b}</style>
</head><body>${htmlContent}<hr><p style="color:#888;font-size:12px">본 보고서는 AI 보조 초안입니다. 외부 발간 전 전문가 검수 필수.</p></body></html>`;
      const base64 = Buffer.from(fullHtml).toString("base64");
      return new Response(jsonKST({
        ok: true,
        fileName: `${safeTitle}.html`,
        mimeType: "text/html",
        base64,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    /* PDF */
    const bytes = await buildPublicationPdf(pub);
    const base64 = Buffer.from(bytes).toString("base64");
    return new Response(jsonKST({
      ok: true,
      fileName: `${safeTitle}.pdf`,
      mimeType: "application/pdf",
      base64,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("export_publication", err);
  }
};
