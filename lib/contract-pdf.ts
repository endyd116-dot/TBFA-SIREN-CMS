// lib/contract-pdf.ts
// 전자 근로계약서 PDF — 작성 미리보기 · 발송본(회사 도장) · 완료본(회사 도장 + 직원 서명).
//
// 급여명세서 PDF(lib/payroll-pdf.ts)의 렌더 노하우를 그대로 따른다:
//  - 한글 폰트는 반드시 subset:false (부분추출하면 글자가 통째로 사라짐 — 2026-07-12 실측)
//  - drawRun: 글자를 하나씩 실측 폭만큼 전진시켜 그린다(통짜 임베드 시 /W 부재로 벌어지는 것 우회)
//  - 급여 헬퍼는 export가 아니라(검증된 코드 수정 회귀 방지) 여기에 필요한 것만 복제한다.
//
// pdf-lib + @pdf-lib/fontkit + NotoSansKR (assets/fonts/NotoSansKR-Regular.ttf).
// ⚠️ 이 모듈을 쓰는 netlify 함수는 netlify.toml included_files에 assets/fonts/** 등록 필수.

import { PDFDocument, rgb, PDFPage, PDFFont, RGB } from "pdf-lib";
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

const A4_W = 595, A4_H = 842, MARGIN = 56;

interface DrawCtx {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  y: number;
  width: number;
  margin: number;
}

/** 글자를 하나씩 실측 폭만큼 전진시켜 그린다(통짜 임베드 시 숫자·공백 벌어짐 우회). payroll-pdf와 동일. */
function drawRun(ctx: DrawCtx, str: string, x: number, y: number, size: number, color: RGB) {
  let cx = x;
  for (const ch of Array.from(String(str ?? ""))) {
    const w = ctx.font.widthOfTextAtSize(ch, size);
    if (ch.trim()) ctx.page.drawText(ch, { x: cx, y, size, font: ctx.font, color });
    cx += w;
  }
}
function textAt(ctx: DrawCtx, str: string, x: number, y: number, size: number, color: RGB = rgb(0, 0, 0)) {
  drawRun(ctx, str, x, y, size, color);
}
/** 가운데 정렬 */
function textCenter(ctx: DrawCtx, str: string, y: number, size: number, color: RGB = rgb(0, 0, 0)) {
  const s = String(str ?? "");
  const w = ctx.font.widthOfTextAtSize(s, size);
  drawRun(ctx, s, (A4_W - w) / 2, y, size, color);
}
function measure(ctx: DrawCtx, s: string, size: number): number {
  return ctx.font.widthOfTextAtSize(String(s ?? ""), size);
}
function ensureSpace(ctx: DrawCtx, needed: number) {
  if (ctx.y - needed < ctx.margin) {
    ctx.page = ctx.doc.addPage([A4_W, A4_H]);
    ctx.y = A4_H - ctx.margin;
  }
}
/** 폭에 맞춰 줄바꿈(공백 기준·긴 덩어리는 글자 단위). payroll-pdf와 동일. */
function wrapText(ctx: DrawCtx, str: string, size: number, maxW: number): string[] {
  const words = String(str ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.font.widthOfTextAtSize(next, size) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
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

export interface ContractPdfInput {
  contract: {
    id: number | string;
    title?: string;
    bodySnapshot: string;              // 치환 완료 본문 전문
    documentVersion?: number;
    status?: string;
    entityName: string;
    entityRepresentative?: string | null;
    entityBizNo?: string | null;
    entityAddress?: string | null;
    memberName: string;
    fields?: Record<string, any> | null;  // 생년월일·주소·연락처 등
    residentNo?: string | null;           // 복호화된 평문 — PDF에만 렌더(있을 때)
    companySignedAt?: Date | string | null;
    employeeSignedName?: string | null;
    employeeSignedAt?: Date | string | null;
    employeeSignIp?: string | null;
    employeeSignDevice?: string | null;
  };
  seal?: Uint8Array | null;              // 회사 도장 PNG
  employeeSignature?: Uint8Array | null; // 직원 서명 PNG
  /** true면 문서 배경에 옅은 '미완료/미리보기' 표시 */
  draftWatermark?: boolean;
}

export async function generateContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const { contract } = input;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(loadKoreanFont(), { subset: false });

  const page = doc.addPage([A4_W, A4_H]);
  const ctx: DrawCtx = { doc, page, font, y: A4_H - MARGIN, width: A4_W, margin: MARGIN };
  const contentW = A4_W - MARGIN * 2;
  const INK = rgb(0.13, 0.13, 0.13);
  const GRAY = rgb(0.45, 0.45, 0.45);

  /* 제목 */
  const title = contract.title || "근로계약서";
  textCenter(ctx, title, ctx.y - 6, 18, rgb(0.08, 0.08, 0.08));
  ctx.y -= 34;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4_W - MARGIN, y: ctx.y }, thickness: 1.2, color: rgb(0.2, 0.2, 0.2) });
  ctx.y -= 18;

  /* 본문 — body_snapshot을 줄 단위로 흘린다 */
  const lines = String(contract.bodySnapshot || "").split("\n");
  for (const raw of lines) {
    // 미치환 치환키({{생년월일}} 등 — 직원이 아직 안 채운 자리)는 밑줄로 표시
    const line = raw.replace(/\[\[SEAL:company\]\]/g, "").replace(/\{\{[^}]+\}\}/g, "____________").replace(/\s+$/g, "");
    const trimmed = line.trim();
    if (!trimmed) { ctx.y -= 7; continue; }  // 빈 줄 = 간격

    const isTitleLine = /^근\s*로\s*계\s*약\s*서$/.test(trimmed);
    if (isTitleLine) continue;  // 제목은 위에서 이미 그림

    const isArticle = /^제\s*\d+\s*조/.test(trimmed);
    const isSubhead = /^\[.+\]$/.test(trimmed);
    const isBullet = /^[①-⑳·▪-]/.test(trimmed);
    const size = isArticle ? 11.5 : (isSubhead ? 10.5 : 9.7);
    const color = (isArticle || isSubhead) ? rgb(0.08, 0.08, 0.08) : INK;
    const indent = isBullet ? 14 : (isSubhead ? 0 : 2);

    if (isArticle) { ensureSpace(ctx, 24); ctx.y -= 8; }        // 조 앞 간격
    else if (isSubhead) { ensureSpace(ctx, 18); ctx.y -= 4; }

    const wrapped = wrapText(ctx, trimmed, size, contentW - indent);
    for (let i = 0; i < wrapped.length; i++) {
      ensureSpace(ctx, size + 6);
      // 줄바꿈된 후속 줄은 한 단계 더 들여쓰기(가독성)
      const x = MARGIN + indent + (i > 0 && isBullet ? 12 : 0);
      textAt(ctx, wrapped[i], x, ctx.y, size, color);
      ctx.y -= size + 5;
    }
    if (isArticle) ctx.y -= 2;
  }

  /* ── 서명 블록 (회사 | 근로자 2열) ── */
  const f = contract.fields || {};
  const blockH = 190;
  ensureSpace(ctx, blockH);
  ctx.y -= 22;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4_W - MARGIN, y: ctx.y }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
  ctx.y -= 22;

  const colL = MARGIN;
  const colR = A4_W / 2 + 8;
  const top = ctx.y;
  const lh = 17;

  /* 좌: 회사 */
  textAt(ctx, "「회사」 (사업자)", colL, top, 10.5, rgb(0.08, 0.08, 0.08));
  textAt(ctx, `상호 : ${contract.entityName || ""}`, colL, top - lh, 9.5, INK);
  if (contract.entityBizNo) textAt(ctx, `사업자등록번호 : ${contract.entityBizNo}`, colL, top - lh * 2, 9.5, INK);
  if (contract.entityAddress) {
    const addrLines = wrapText(ctx, `소재지 : ${contract.entityAddress}`, 9.5, A4_W / 2 - MARGIN - 60);
    addrLines.forEach((al, i) => textAt(ctx, al, colL, top - lh * (3 + i), 9.5, INK));
  }
  const repY = top - lh * 5;
  textAt(ctx, `대표자 : ${contract.entityRepresentative || ""}`, colL, repY, 9.5, INK);
  const repW = measure(ctx, `대표자 : ${contract.entityRepresentative || ""}`, 9.5);
  /* 회사 도장 — 대표자명 옆에 겹쳐 찍는다 */
  if (input.seal && input.seal.length) {
    try {
      const img = await doc.embedPng(input.seal);
      const sz = 46;
      ctx.page.drawImage(img, { x: colL + repW + 8, y: repY - sz / 2 + 3, width: sz, height: sz });
    } catch { textAt(ctx, "(인)", colL + repW + 10, repY, 9.5, INK); }
  } else {
    textAt(ctx, "(인)", colL + repW + 10, repY, 9.5, INK);
  }
  if (contract.companySignedAt) textAt(ctx, `날인일 ${kst(contract.companySignedAt)}`, colL, top - lh * 7, 7.5, GRAY);

  /* 우: 근로자 */
  textAt(ctx, "「근로자」", colR, top, 10.5, rgb(0.08, 0.08, 0.08));
  textAt(ctx, `성명 : ${contract.memberName || f["성명"] || ""}`, colR, top - lh, 9.5, INK);
  const nameW = measure(ctx, `성명 : ${contract.memberName || f["성명"] || ""}`, 9.5);
  /* 직원 서명 — 성명 옆 */
  if (input.employeeSignature && input.employeeSignature.length) {
    try {
      const img = await doc.embedPng(input.employeeSignature);
      const w = 96, h = 40;
      ctx.page.drawImage(img, { x: colR + nameW + 8, y: top - lh - h / 2 + 4, width: w, height: h });
    } catch { textAt(ctx, "(서명)", colR + nameW + 10, top - lh, 9.5, INK); }
  } else {
    textAt(ctx, "(서명)", colR + nameW + 10, top - lh, 9.5, INK);
  }
  let ry = top - lh * 2;
  if (f["생년월일"]) { textAt(ctx, `생년월일 : ${f["생년월일"]}`, colR, ry, 9.5, INK); ry -= lh; }
  if (contract.residentNo) { textAt(ctx, `주민등록번호 : ${contract.residentNo}`, colR, ry, 9.5, INK); ry -= lh; }
  if (f["주소"]) {
    const al = wrapText(ctx, `주소 : ${f["주소"]}`, 9.5, A4_W - MARGIN - colR);
    al.forEach((l) => { textAt(ctx, l, colR, ry, 9.5, INK); ry -= lh; });
  }
  if (f["연락처"]) { textAt(ctx, `연락처 : ${f["연락처"]}`, colR, ry, 9.5, INK); ry -= lh; }
  if (contract.employeeSignedAt) textAt(ctx, `서명일 ${kst(contract.employeeSignedAt)}`, colR, ry, 7.5, GRAY);

  /* ── 하단 증적 메타(모든 페이지 아님·마지막만) ── */
  const metaY = MARGIN - 8;
  const parts: string[] = [];
  parts.push(`문서 #${contract.id}`);
  if (contract.documentVersion && contract.documentVersion > 1) parts.push(`정정 ${contract.documentVersion}차`);
  if (contract.employeeSignIp) parts.push(`서명IP ${contract.employeeSignIp}`);
  if (contract.employeeSignedName) parts.push(`서명자 ${contract.employeeSignedName}`);
  textAt(ctx, parts.join("   ·   "), MARGIN, metaY, 7, GRAY);

  /* draft 워터마크 */
  if (input.draftWatermark) {
    const wm = "미완료 · 미리보기";
    const wmSize = 44;
    const wmW = font.widthOfTextAtSize(wm, wmSize);
    ctx.page.drawText(wm, {
      x: (A4_W - wmW) / 2, y: A4_H / 2, size: wmSize, font,
      color: rgb(0.9, 0.9, 0.9), rotate: { type: "degrees", angle: 30 } as any,
    });
  }

  return await doc.save();
}

export function contractFilename(contract: { id: number | string; documentVersion?: number }, memberName: string): string {
  const safe = String(memberName || "직원").replace(/[^\w가-힣]/g, "");
  const ver = contract.documentVersion && contract.documentVersion > 1 ? `_${contract.documentVersion}차` : "";
  return `근로계약서_${safe}_${contract.id}${ver}.pdf`;
}
