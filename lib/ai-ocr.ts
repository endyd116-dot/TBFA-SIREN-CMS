/**
 * lib/ai-ocr.ts — 자료 파일 텍스트 추출
 *
 * 지원 형식:
 *   텍스트 PDF          → pdf-parse (무료·로컬)
 *   Word docx           → mammoth   (무료·로컬)
 *   평문 txt·md·csv·rtf·카톡 export (.txt) → Buffer → UTF-8
 *   이미지·스캔PDF      → Gemini Vision OCR (기존 GEMINI_API_KEY 재사용)
 *
 * 원칙:
 *   - 실패 시 throw 금지 → { error } 반환 (업로드 유지·운영자 수동 입력 유도)
 *   - 빈 텍스트(< 10자) 도 { error } 처리 → extractStatus='failed' 로 간주
 */
import { inflateRawSync } from "zlib";
import { callGemini, uploadToGeminiFiles, deleteGeminiFile } from "./ai-gemini";

export interface OcrResult {
  text: string;
  method: "native_pdf" | "docx" | "doc" | "xlsx" | "hwp" | "hwpx" | "pptx" | "plain_text" | "gemini_ocr" | "gemini_audio" | "gemini_video" | "manual";
  error?: string;
}

/* 스캔·이미지 판별 — 텍스트 PDF여도 추출 결과가 너무 짧으면 OCR 재시도 */
const MIN_TEXT_LENGTH = 20;

/* Gemini OCR 지원 mimeType */
const GEMINI_OCR_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff",
  "application/pdf",
]);

/* 평문 처리 가능 확장자 */
const PLAIN_EXTS = new Set(["txt", "md", "csv", "tsv", "rtf", "log", "text", "json", "xml", "vtt", "srt"]);

/* 음성·영상 — Gemini 멀티모달 전사. ext→Gemini가 받는 mimeType 매핑(브라우저 mime이 불안정) */
const AUDIO_EXTS = new Set(["m4a", "mp3", "wav", "aac", "ogg", "oga", "flac", "aiff", "aif", "opus", "amr", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm", "avi", "mkv", "mpeg", "mpg", "3gp"]);
const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mp3", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/ogg", flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff",
  m4a: "audio/mp4", amr: "audio/amr", wma: "audio/x-ms-wma",
};
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  avi: "video/x-msvideo", mkv: "video/x-matroska", mpeg: "video/mpeg", mpg: "video/mpeg", "3gp": "video/3gpp",
};
function getExt(fileName: string): string {
  return (fileName.split(".").pop() || "").toLowerCase();
}

/**
 * 파일에서 텍스트 추출
 * @param base64  - 파일 내용 (base64, data: prefix 없이)
 * @param mimeType - MIME 타입
 * @param fileName - 원본 파일명 (확장자 분기용)
 */
export async function extractDocText({
  base64,
  mimeType,
  fileName,
}: {
  base64: string;
  mimeType: string;
  fileName: string;
}): Promise<OcrResult> {
  const ext = getExt(fileName);
  const mime = (mimeType || "").toLowerCase();

  /* ── 1. Word docx ── */
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
    return extractDocx(base64);
  }

  /* ── 1.1. 구형 Word doc (바이너리 OLE) — word-extractor ──
     브라우저가 .doc에 octet-stream을 보내는 경우가 많아 확장자 우선 판별. */
  if (ext === "doc" || mime === "application/msword") {
    return extractDoc(base64);
  }

  /* ── 1.5. 엑셀 (xlsx·xls) — 표 데이터를 텍스트(탭 구분)로 변환 ── */
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    ext === "xlsx" || ext === "xls"
  ) {
    return extractXlsx(base64);
  }

  /* ── 1.6. 한글 HWP (HWP5 바이너리) — 미리보기 텍스트(PrvText) 추출 ──
     브라우저가 .hwp에 octet-stream을 보내는 경우가 많아 확장자 우선 판별. */
  if (ext === "hwp" || mime === "application/x-hwp" || mime === "application/haansofthwp" || mime === "application/vnd.hancom.hwp") {
    return extractHwp(base64);
  }

  /* ── 1.7. 한글 HWPX (신형·OWPML ZIP) — 압축 해제 후 본문 텍스트 ── */
  if (ext === "hwpx" || mime === "application/hwp+zip" || mime === "application/vnd.hancom.hwpx") {
    return extractZipOffice(base64, "hwpx");
  }

  /* ── 1.8. PowerPoint pptx — 슬라이드 텍스트 ── */
  if (ext === "pptx" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return extractZipOffice(base64, "pptx");
  }

  /* ── 1.9·1.10. 음성·영상 — Gemini Files API 전사(대용량 허용) ──
     보통은 extract-background가 base64 변환 없이 bytes로 transcribeMedia를 직접 호출.
     이 분기는 base64 진입 시의 폴백(메모리 위해 디코드). */
  if (AUDIO_EXTS.has(ext) || mime.startsWith("audio/")) {
    return extractGeminiMediaBytes(Buffer.from(base64, "base64"), audioMimeCandidates(ext, mime), "audio");
  }
  if (VIDEO_EXTS.has(ext) || mime.startsWith("video/")) {
    return extractGeminiMediaBytes(Buffer.from(base64, "base64"), videoMimeCandidates(ext, mime), "video");
  }

  /* ── 2. 텍스트 PDF ── */
  if (mime === "application/pdf" || ext === "pdf") {
    const pdfResult = await extractPdf(base64);
    if (!pdfResult.error && pdfResult.text.length >= MIN_TEXT_LENGTH) {
      return pdfResult;
    }
    /* 스캔 PDF — 텍스트 부족 → Gemini OCR 재시도 */
    const ocrResult = await extractGeminiOcr(base64, "application/pdf", fileName);
    if (!ocrResult.error && ocrResult.text.length >= MIN_TEXT_LENGTH) return ocrResult;
    /* 둘 다 실패면 pdf 결과 (짧더라도) 우선 반환 */
    return pdfResult.error ? ocrResult : pdfResult;
  }

  /* ── 3. 평문 ── */
  if (
    PLAIN_EXTS.has(ext) ||
    mime.startsWith("text/") ||
    mime === "application/json"
  ) {
    return extractPlainText(base64, fileName);
  }

  /* ── 4. 이미지 → Gemini Vision OCR ── */
  if (mime.startsWith("image/") || GEMINI_OCR_MIMES.has(mime)) {
    return extractGeminiOcr(base64, mime, fileName);
  }

  /* ── 5. 미지원 형식 (구형 ppt·odt/ods·zip 등) — 업로드 거부 안 함, error 반환 ──
     자동 추출 가능: PDF·이미지·docx·doc·xlsx·hwp/hwpx·pptx·평문·음성·영상.
     불가(변환 권장): 구형 .ppt(바이너리)·.odt/.ods(오픈오피스)·.zip 등. */
  return {
    text: "",
    method: "manual",
    error: `자동 추출이 안 되는 형식(${ext || mime})입니다 — PDF로 변환 후 재업로드하거나, 화면에서 [텍스트 직접 입력]으로 내용을 넣어주세요.`,
  };
}

/* ─────────────────────────────── pdf-parse ─────────────────────────────── */
async function extractPdf(base64: string): Promise<OcrResult> {
  try {
    /* pdf-parse는 Node.js Buffer 입력 */
    const buffer = Buffer.from(base64, "base64");
    const pdfModule = await import("pdf-parse");
    const pdfParse: (buf: Buffer, opts?: any) => Promise<any> = (pdfModule as any).default ?? pdfModule;
    const data = await pdfParse(buffer, { max: 0 });
    const text = (data.text || "").trim();
    if (text.length < MIN_TEXT_LENGTH) {
      return { text, method: "native_pdf", error: "텍스트 추출 결과가 너무 짧습니다 (스캔본 가능성)" };
    }
    return { text, method: "native_pdf" };
  } catch (err: any) {
    return { text: "", method: "native_pdf", error: `PDF 추출 실패: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/* ─────────────────────────────── mammoth ─────────────────────────────── */
async function extractDocx(base64: string): Promise<OcrResult> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || "").trim();
    if (text.length < MIN_TEXT_LENGTH) {
      return { text, method: "docx", error: "docx 텍스트가 너무 짧습니다 (빈 문서 또는 이미지 전용)" };
    }
    return { text, method: "docx" };
  } catch (err: any) {
    return { text: "", method: "docx", error: `docx 추출 실패: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/* ─────────────────────────────── .doc (다형식) ───────────────────────────────
   ".doc" 확장자는 실제로 ① 정통 바이너리 워드(OLE2·D0CF) ② docx 위장(zip·PK)
   ③ "웹 페이지로 저장" HTML(종종 UTF-16) ④ RTF ⑤ 평문 등 여러 실체가 섞임.
   word-extractor는 OLE/zip만 읽으므로(그 외 "Unable to read this type of file"),
   매직·BOM을 직접 보고 형식별로 분기한다. */
async function extractDoc(base64: string): Promise<OcrResult> {
  const buffer = Buffer.from(base64, "base64");
  const magic = buffer.length >= 2 ? buffer.readUInt16BE(0) : 0;

  /* ① zip(PK) → docx 가 .doc 확장자로 위장 */
  if (magic === 0x504b) return extractDocx(base64);

  /* ② OLE2(0xD0CF) → 정통 바이너리 .doc → word-extractor */
  if (magic === 0xd0cf) {
    try {
      const mod: any = await import("word-extractor");
      const WordExtractor = mod.default ?? mod;
      const doc = await new WordExtractor().extract(buffer);   // Buffer 입력(임시파일 불필요)
      let text = String(doc.getBody?.() || "").trim();
      const foot = String(doc.getFootnotes?.() || "").trim();
      if (foot) text += "\n" + foot;
      text = text.trim();
      if (text.length < MIN_TEXT_LENGTH) {
        return { text, method: "doc", error: "doc 텍스트가 너무 짧습니다 (빈 문서·이미지 전용·PDF 변환 권장)" };
      }
      return { text, method: "doc" };
    } catch (err: any) {
      return { text: "", method: "manual", error: `doc 추출 실패: ${String(err?.message || err).slice(0, 150)} — docx/PDF 변환 또는 텍스트 직접 입력 권장` };
    }
  }

  /* ③④⑤ 그 외 — 인코딩(BOM) 감지 후 HTML/RTF/평문 처리 */
  const content = decodeTextByBom(buffer);
  const head = content.replace(/^﻿/, "").trimStart().slice(0, 400).toLowerCase();

  /* RTF */
  if (head.startsWith("{\\rtf")) {
    const text = stripRtf(content);
    if (text.length >= MIN_TEXT_LENGTH) return { text, method: "doc" };
  }
  /* HTML / XML (Word "웹 페이지로 저장"·Word2003 XML) */
  if (/^(<\?xml|<!doctype|<html|<w:|<o:|<body|<)/.test(head)) {
    const text = htmlToText(content);
    if (text.length >= MIN_TEXT_LENGTH) return { text, method: "doc" };
  }
  /* 평문 폴백 */
  const plain = content.replace(/ /g, "").trim();
  if (plain.length >= MIN_TEXT_LENGTH && (plain.match(/�/g)?.length || 0) < plain.length * 0.1) {
    return { text: plain, method: "doc" };
  }

  return { text: "", method: "manual", error: "doc 추출 실패: 지원되지 않는 .doc 내부 형식입니다 — docx/PDF로 변환 후 재업로드 또는 텍스트 직접 입력 권장" };
}

/* BOM으로 인코딩 판별해 문자열 디코드 (UTF-16LE/BE·UTF-8 BOM·기본 UTF-8) */
function decodeTextByBom(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");                     // UTF-16LE
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) { // UTF-16BE → swap
    const sw = Buffer.from(buffer.subarray(2));
    for (let i = 0; i + 1 < sw.length; i += 2) { const t = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = t; }
    return sw.toString("utf16le");
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf-8");                       // UTF-8 BOM
  }
  return buffer.toString("utf-8");
}

/* HTML → 텍스트 (스타일·스크립트·Word XML 아일랜드·주석 제거 후 태그 제거·엔티티 디코드) */
function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<xml[\s\S]*?<\/xml>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6]|td|th)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  s = decodeXmlEntities(s);
  s = s.replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  return s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* RTF → 텍스트 (유니코드 \uN 우선·destination 그룹 제거·컨트롤워드 제거) */
function stripRtf(rtf: string): string {
  let s = rtf;
  s = s.replace(/\{\\\*?\\(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|generator|listtable|listoverridetable|rsidtbl)[\s\S]*?\}/gi, " ");
  s = s.replace(/\\u(-?\d+)(?:\\?'[0-9a-fA-F]{2}|[^\\{} ])?/g, (_m, n) => {
    let code = parseInt(n, 10); if (code < 0) code += 65536; return String.fromCharCode(code);
  });
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\(par|pard|line|sect|page)\b ?/g, "\n").replace(/\\tab\b ?/g, "\t");
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  s = s.replace(/[{}]/g, "").replace(/\\\*/g, "").replace(/\\[^a-zA-Z]/g, "");
  return s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ─────────────────────────────── exceljs (xlsx) ─────────────────────────────── */
async function extractXlsx(base64: string): Promise<OcrResult> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const ExcelJS: any = await import("exceljs");
    const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook;
    const wb = new Workbook();
    await wb.xlsx.load(buffer);

    const lines: string[] = [];
    wb.eachSheet((sheet: any) => {
      if (sheet.rowCount === 0) return;
      lines.push(`# 시트: ${sheet.name}`);
      sheet.eachRow({ includeEmpty: false }, (row: any) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell: any) => {
          cells.push(cellToText(cell.value));
        });
        const line = cells.filter(Boolean).join("\t");
        if (line.trim()) lines.push(line);
      });
    });

    const text = lines.join("\n").trim();
    if (text.length < MIN_TEXT_LENGTH) {
      return { text, method: "xlsx", error: "엑셀 내용이 너무 짧습니다 (빈 시트)" };
    }
    return { text, method: "xlsx" };
  } catch (err: any) {
    /* .xls(구형 바이너리)는 exceljs 미지원 → 수동 입력 유도 */
    return { text: "", method: "xlsx", error: `엑셀 추출 실패: ${String(err?.message || err).slice(0, 200)} (xlsx 권장·또는 텍스트 직접 입력)` };
  }
}

/* 엑셀 셀 값 → 텍스트 (수식·날짜·하이퍼링크·리치텍스트 방어) */
function cellToText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;                          // hyperlink
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join("");
    if (v.result != null) return String(v.result);                          // formula
    if (v.formula) return String(v.formula);
  }
  return "";
}

/* ─────────────────────────────── 한글 HWP5 (cfb · PrvText) ─────────────────────────────── */
/* HWP5(.hwp)는 OLE 복합문서. 본문(BodyText)은 zlib+레코드 구조로 파싱이 복잡하므로,
   스펙상 항상 포함되는 'PrvText'(미리보기 텍스트·UTF-16LE) 스트림을 추출 → 분류·분석에 충분.
   (.hwpx는 ZIP 기반 별도 포맷 — 여기선 미지원, 미지원 형식 안내로 폴백) */
async function extractHwp(base64: string): Promise<OcrResult> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const CFB: any = await import("cfb");
    const container = CFB.read(buffer, { type: "buffer" });

    /* 1) 본문 전체(BodyText/Section*) 레코드 파싱 시도 */
    const body = extractHwpBodyText(container).trim();
    if (body.length >= MIN_TEXT_LENGTH) {
      return { text: body, method: "hwp" };
    }

    /* 2) 폴백 — PrvText(미리보기·문서 앞부분) */
    const entry = CFB.find(container, "PrvText") || CFB.find(container, "/PrvText");
    const prev = (entry && entry.content) ? Buffer.from(entry.content).toString("utf16le").trim() : "";
    const best = prev.length >= body.length ? prev : body;
    if (best.length >= MIN_TEXT_LENGTH) return { text: best, method: "hwp" };
    if (best.length > 0) return { text: best, method: "hwp", error: "HWP 추출 텍스트가 너무 짧습니다 (PDF 변환 권장)" };
    return { text: "", method: "manual", error: "HWP 본문/미리보기 추출 실패 — 암호 설정 문서일 수 있습니다. PDF로 변환 후 재업로드 또는 텍스트 직접 입력 권장" };
  } catch (err: any) {
    return { text: "", method: "manual", error: `HWP 추출 실패: ${String(err?.message || err).slice(0, 150)} — PDF 변환 또는 텍스트 직접 입력 권장` };
  }
}

/* HWP5 본문 추출 — BodyText/Section{N} 스트림을 (필요 시 raw-inflate) 후 레코드 파싱.
   FileHeader properties: bit0=압축 / bit1=암호화(암호화면 파싱 불가→빈 문자열로 PrvText 폴백). */
function extractHwpBodyText(container: any): string {
  try {
    const fileIndex: any[] = container.FileIndex || [];
    const fullPaths: string[] = container.FullPaths || [];

    /* 압축·암호 플래그 */
    let compressed = true;
    const fhIdx = fileIndex.findIndex((e, i) => /(^|\/)FileHeader$/i.test(fullPaths[i] || "") || /^FileHeader$/i.test(e?.name || ""));
    if (fhIdx >= 0 && fileIndex[fhIdx]?.content) {
      const fh = Buffer.from(fileIndex[fhIdx].content);
      if (fh.length >= 40) {
        const props = fh.readUInt32LE(36);
        compressed = (props & 0x01) === 0x01;
        if ((props & 0x02) === 0x02) return ""; // 암호화 — 폴백
      }
    }

    /* BodyText/Section0,1,... 수집·정렬 */
    const sections: { num: number; content: any }[] = [];
    for (let i = 0; i < fileIndex.length; i++) {
      const e = fileIndex[i];
      const path = fullPaths[i] || e?.name || "";
      const m = /(?:^|\/)Section(\d+)$/i.exec(path) || /^Section(\d+)$/i.exec(e?.name || "");
      if (m && e?.content) sections.push({ num: Number(m[1]), content: e.content });
    }
    sections.sort((a, b) => a.num - b.num);

    let text = "";
    for (const s of sections) {
      let raw = Buffer.from(s.content);
      if (compressed) {
        try { raw = inflateRawSync(raw); } catch { continue; }
      }
      text += parseHwpSectionRecords(raw);
    }
    return text;
  } catch { return ""; }
}

/* HWP5 레코드 스트림 파싱 — 헤더(4B: tag 10b·level 10b·size 12b, size=0xFFF면 다음 4B)에서
   HWPTAG_PARA_TEXT(67) 레코드만 모아 텍스트화. */
function parseHwpSectionRecords(buf: Buffer): string {
  const HWPTAG_PARA_TEXT = 67; // HWPTAG_BEGIN(0x10) + 51
  let out = "";
  let pos = 0;
  while (pos + 4 <= buf.length) {
    const header = buf.readUInt32LE(pos); pos += 4;
    const tagId = header & 0x3FF;
    let size = (header >> 20) & 0xFFF;
    if (size === 0xFFF) {
      if (pos + 4 > buf.length) break;
      size = buf.readUInt32LE(pos); pos += 4;
    }
    if (pos + size > buf.length) break;
    if (tagId === HWPTAG_PARA_TEXT) out += decodeHwpParaText(buf.subarray(pos, pos + size)) + "\n";
    pos += size;
  }
  return out;
}

/* PARA_TEXT 데이터(UTF-16LE wchar 배열) → 텍스트. 제어문자 폭 처리:
   8 wchar(인라인/확장) 컨트롤은 16바이트 건너뜀, 나머지 제어문자는 2바이트. */
function decodeHwpParaText(data: Buffer): string {
  const EIGHT_WIDE = new Set([1, 2, 3, 4, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
  let s = "";
  let i = 0;
  while (i + 1 < data.length) {
    const code = data.readUInt16LE(i);
    if (code >= 32) { s += String.fromCharCode(code); i += 2; continue; }
    if (code === 9) { s += "\t"; i += 2; continue; }
    if (code === 10 || code === 13) { s += "\n"; i += 2; continue; }
    if (EIGHT_WIDE.has(code)) { i += 16; continue; }  // 인라인/확장 컨트롤(8 wchar)
    i += 2;                                            // 그 외 1 wchar 컨트롤
  }
  return s;
}

/* ─────────────────────────────── HWPX·PPTX (ZIP+XML · fflate) ─────────────────────────────── */
/* OWPML(hwpx)·OOXML(pptx)은 ZIP 컨테이너. 본문 XML을 풀어 텍스트 런만 뽑는다. */
async function extractZipOffice(base64: string, kind: "hwpx" | "pptx"): Promise<OcrResult> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const fflate: any = await import("fflate");
    const files = fflate.unzipSync(new Uint8Array(buffer));
    const isTarget = kind === "hwpx"
      ? (n: string) => /(^|\/)section\d+\.xml$/i.test(n)            // Contents/section0.xml ...
      : (n: string) => /ppt\/slides\/slide\d+\.xml$/i.test(n);     // ppt/slides/slide1.xml ...
    const textTag = kind === "hwpx" ? "hp:t" : "a:t";

    const names = Object.keys(files).filter(isTarget).sort();
    let text = "";
    for (const n of names) {
      const xml = Buffer.from(files[n] as Uint8Array).toString("utf-8");
      text += " " + xmlTagText(xml, textTag);
    }
    text = decodeXmlEntities(text).replace(/\s+/g, " ").trim();

    if (text.length < MIN_TEXT_LENGTH) {
      return { text, method: kind, error: `${kind.toUpperCase()} 본문 텍스트가 너무 짧습니다 (PDF 변환 권장)` };
    }
    return { text, method: kind };
  } catch (err: any) {
    return { text: "", method: "manual", error: `${kind.toUpperCase()} 추출 실패: ${String(err?.message || err).slice(0, 150)} — PDF 변환 또는 텍스트 직접 입력 권장` };
  }
}

/* XML에서 특정 텍스트 태그 내용만 추출(없으면 전체 태그 제거 폴백) */
function xmlTagText(xml: string, tag: string): string {
  const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].replace(/<[^>]+>/g, ""));
  if (out.length === 0) return xml.replace(/<[^>]+>/g, " ");
  return out.join(" ");
}
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ─────────────────────────────── 음성·영상 (Gemini Files API · 대용량) ─────────────────────────────── */
/* 메모리 안전 상한(다운로드+업로드 버퍼) — 인라인 한도와 무관. 초과 시 분할 안내(OOM 방지). */
const MEDIA_BYTES_LIMIT = 350 * 1024 * 1024;
const AUDIO_PROMPT =
  "이 음성 녹음을 한국어로 가능한 한 정확히 전사(transcript)해 주세요.\n- 화자 구분이 가능하면 '화자1:', '화자2:' 로 표시\n- 들리지 않는 부분은 (불명) 으로 표기\n- 통화·면담·민원 등 정황이 드러나면 그대로 옮길 것\n전사 텍스트만 출력하세요.";
const VIDEO_PROMPT =
  "이 영상의 음성을 한국어로 전사하고, 화면의 중요한 시각 정보(장소·인물·자막·시각·행동)도 함께 텍스트로 정리해 주세요. 전사와 시각 요약만 출력하세요.";

/** 업로드 시점 미디어 여부 판별(확장자·MIME) — extract-background가 base64 변환 전에 분기용 */
export function isMediaFile(mimeType: string, fileName: string): boolean {
  const ext = getExt(fileName);
  const mime = (mimeType || "").toLowerCase();
  return AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext) || mime.startsWith("audio/") || mime.startsWith("video/");
}

/* Gemini에 보낼 전사 mimeType 후보(첫 후보 실패 시 차례로 재시도).
   m4a: 브라우저/매핑이 audio/mp4를 주는데 Gemini가 거부하는 경우가 있어, m4a=AAC 코덱이므로 audio/aac로 폴백.
   wma·amr 등도 미지원 가능 → 마지막으로 audio/mp3 시도(컨테이너 디코드 운에 맡김). */
function audioMimeCandidates(ext: string, mime: string): string[] {
  const primary = AUDIO_MIME[ext] || (mime.startsWith("audio/") ? mime : "audio/mp3");
  const list = [primary];
  if (ext === "m4a" || primary === "audio/mp4") { if (!list.includes("audio/aac")) list.push("audio/aac"); }
  if (ext === "wma" || ext === "amr") { if (!list.includes("audio/mp3")) list.push("audio/mp3"); }
  return list;
}
function videoMimeCandidates(ext: string, mime: string): string[] {
  return [VIDEO_MIME[ext] || (mime.startsWith("video/") ? mime : "video/mp4")];
}

/** 미디어 바이트 → 전사(Files API). extract-background에서 base64 변환 없이 직접 호출(메모리 절약). */
export async function transcribeMedia(bytes: Buffer, mimeType: string, fileName: string): Promise<OcrResult> {
  const ext = getExt(fileName);
  const mime = (mimeType || "").toLowerCase();
  const isAudio = AUDIO_EXTS.has(ext) || mime.startsWith("audio/");
  const kind: "audio" | "video" = isAudio ? "audio" : "video";
  const candidates = isAudio ? audioMimeCandidates(ext, mime) : videoMimeCandidates(ext, mime);
  return extractGeminiMediaBytes(bytes, candidates, kind);
}

async function extractGeminiMediaBytes(bytes: Buffer, mimeCandidates: string[], kind: "audio" | "video"): Promise<OcrResult> {
  const method: OcrResult["method"] = kind === "audio" ? "gemini_audio" : "gemini_video";
  const ko = kind === "audio" ? "음성" : "영상";
  const candidates = mimeCandidates.length ? mimeCandidates : [kind === "audio" ? "audio/mp3" : "video/mp4"];

  if (bytes.length > MEDIA_BYTES_LIMIT) {
    const mb = Math.round(bytes.length / 1024 / 1024);
    return { text: "", method: "manual", error: `${ko} 파일이 매우 큽니다(약 ${mb}MB) — 처리 메모리 한계로 자동 전사가 어렵습니다. 시간대로 분할해 업로드하거나 [텍스트 직접 입력]을 이용해주세요` };
  }

  /* 대용량은 Gemini Files API로 업로드(인라인 ~20MB 한도 우회·최대 2GB).
     업로드는 1회(첫 후보 mime)로 끝내고, 전사 호출만 후보 mime을 바꿔가며 재시도(같은 fileUri 재참조). */
  const up = await uploadToGeminiFiles(bytes, candidates[0], `martyrdom-${kind}-${Date.now()}`);
  if (!up.ok || !up.fileUri) {
    if (up.fileName) await deleteGeminiFile(up.fileName);
    return { text: "", method, error: `${ko} 처리 실패: ${up.error || "업로드 실패"} — mp3/wav/mp4 변환 또는 텍스트 직접 입력 권장` };
  }

  try {
    let lastErr = "응답 없음";
    for (const m of candidates) {
      const result = await callGemini(kind === "audio" ? AUDIO_PROMPT : VIDEO_PROMPT, {
        mode: "pro",
        featureKey: "martyrdom_ai",
        fileParts: [{ fileUri: up.fileUri, mimeType: m }],
        maxOutputTokens: 8192,
        timeoutMs: 180000,
        internalBulk: true,
      });
      if (result.ok && result.text && result.text.trim().length >= 5) {
        return { text: result.text.trim(), method };
      }
      if (result.ok) {
        /* 성공했으나 빈 결과 — 무음·잡음. mime 재시도해도 동일하므로 종료 */
        return { text: (result.text || "").trim(), method, error: "전사 결과가 비었습니다 (무음·잡음일 수 있음)" };
      }
      /* 실패(포맷 거부 등) → 다음 후보 mime으로 재시도 */
      lastErr = result.error || "응답 없음";
    }
    return { text: "", method, error: `${kind === "audio" ? "음성 전사" : "영상 분석"} 실패: ${lastErr} — 형식 미지원일 수 있어 mp3/wav/mp4 변환 또는 텍스트 직접 입력 권장` };
  } catch (err: any) {
    return { text: "", method, error: `미디어 처리 실패: ${String(err?.message || err).slice(0, 150)}` };
  } finally {
    if (up.fileName) await deleteGeminiFile(up.fileName); // Gemini 임시 파일 정리
  }
}

/* ─────────────────────────────── 평문 UTF-8 ─────────────────────────────── */
function extractPlainText(base64: string, fileName: string): OcrResult {
  try {
    const text = Buffer.from(base64, "base64").toString("utf-8").trim();
    if (text.length < MIN_TEXT_LENGTH) {
      return { text, method: "plain_text", error: "파일 내용이 너무 짧습니다" };
    }
    return { text, method: "plain_text" };
  } catch (err: any) {
    return { text: "", method: "plain_text", error: `텍스트 읽기 실패: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/* ─────────────────────────────── Gemini Vision OCR ─────────────────────────────── */
async function extractGeminiOcr(base64: string, mimeType: string, fileName: string): Promise<OcrResult> {
  try {
    const result = await callGemini(
      "이 파일(문서·이미지)에서 모든 텍스트를 정확하게 추출해주세요.\n" +
      "- 표·리스트·단락 구조를 최대한 유지\n" +
      "- 개인정보(이름·학교명 등)도 그대로 추출 (마스킹 금지)\n" +
      "- 텍스트가 없는 순수 사진이면 '(사진 — 텍스트 없음)' 으로 응답",
      {
        mode: "pro",
        featureKey: "martyrdom_ai",
        inlineFiles: [{ data: base64.replace(/^data:[^;]+;base64,/, ""), mimeType }],
        maxOutputTokens: 8192,
        /* 2026-05-26: 문서 전체 OCR은 8초 기본 타임아웃으로 자주 중단됨.
           background(-background·15분) 호출이므로 넉넉히(대용량 스캔 PDF 여유 180초). */
        timeoutMs: 180000,
        internalBulk: true, // 일괄 추출 자기차단(surge) 방지
      }
    );

    if (!result.ok || !result.text) {
      return { text: "", method: "gemini_ocr", error: `Gemini OCR 실패: ${result.error || "응답 없음"}` };
    }

    const text = result.text.trim();
    if (text === "(사진 — 텍스트 없음)" || text.length < 5) {
      return { text, method: "gemini_ocr", error: "이미지에 텍스트가 없습니다 (사진·그림 자료)" };
    }
    return { text, method: "gemini_ocr" };
  } catch (err: any) {
    return { text: "", method: "gemini_ocr", error: `Gemini OCR 호출 실패: ${String(err?.message || err).slice(0, 200)}` };
  }
}
