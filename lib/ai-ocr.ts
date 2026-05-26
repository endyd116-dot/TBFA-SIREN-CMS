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
import { callGemini, uploadToGeminiFiles, deleteGeminiFile } from "./ai-gemini";

export interface OcrResult {
  text: string;
  method: "native_pdf" | "docx" | "xlsx" | "hwp" | "hwpx" | "pptx" | "plain_text" | "gemini_ocr" | "gemini_audio" | "gemini_video" | "manual";
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
     ★ 보통은 extract-background가 base64 변환 없이 bytes로 transcribeMedia를 직접 호출.
     이 분기는 base64 진입 시의 폴백(메모리 위해 디코드). */
  if (AUDIO_EXTS.has(ext) || mime.startsWith("audio/")) {
    const gmime = AUDIO_MIME[ext] || (mime.startsWith("audio/") ? mime : "audio/mp3");
    return extractGeminiMediaBytes(Buffer.from(base64, "base64"), gmime, "audio");
  }
  if (VIDEO_EXTS.has(ext) || mime.startsWith("video/")) {
    const gmime = VIDEO_MIME[ext] || (mime.startsWith("video/") ? mime : "video/mp4");
    return extractGeminiMediaBytes(Buffer.from(base64, "base64"), gmime, "video");
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

  /* ── 5. 미지원 형식 (구형 doc/ppt·odt/ods·zip 등) — 업로드 거부 안 함, error 반환 ──
     자동 추출 가능: PDF·이미지·docx·xlsx·hwp/hwpx·pptx·평문·음성·영상.
     불가(변환 권장): 구형 .doc/.ppt(바이너리)·.odt/.ods(오픈오피스)·.zip 등. */
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
    const entry = CFB.find(container, "PrvText") || CFB.find(container, "/PrvText");
    if (!entry || !entry.content) {
      return { text: "", method: "manual", error: "HWP 미리보기 텍스트(PrvText) 없음 — PDF로 변환 후 재업로드 또는 텍스트 직접 입력 권장" };
    }
    const text = Buffer.from(entry.content).toString("utf16le").trim();
    if (text.length < MIN_TEXT_LENGTH) {
      return { text, method: "hwp", error: "HWP 추출 텍스트가 너무 짧습니다 (PDF 변환 권장)" };
    }
    return { text, method: "hwp" };
  } catch (err: any) {
    return { text: "", method: "manual", error: `HWP 추출 실패: ${String(err?.message || err).slice(0, 150)} — PDF 변환 또는 텍스트 직접 입력 권장` };
  }
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

/** 미디어 바이트 → 전사(Files API). extract-background에서 base64 변환 없이 직접 호출(메모리 절약). */
export async function transcribeMedia(bytes: Buffer, mimeType: string, fileName: string): Promise<OcrResult> {
  const ext = getExt(fileName);
  const mime = (mimeType || "").toLowerCase();
  const isAudio = AUDIO_EXTS.has(ext) || mime.startsWith("audio/");
  const kind: "audio" | "video" = isAudio ? "audio" : "video";
  const gmime = isAudio
    ? (AUDIO_MIME[ext] || (mime.startsWith("audio/") ? mime : "audio/mp3"))
    : (VIDEO_MIME[ext] || (mime.startsWith("video/") ? mime : "video/mp4"));
  return extractGeminiMediaBytes(bytes, gmime, kind);
}

async function extractGeminiMediaBytes(bytes: Buffer, mimeType: string, kind: "audio" | "video"): Promise<OcrResult> {
  const method: OcrResult["method"] = kind === "audio" ? "gemini_audio" : "gemini_video";
  const ko = kind === "audio" ? "음성" : "영상";

  if (bytes.length > MEDIA_BYTES_LIMIT) {
    const mb = Math.round(bytes.length / 1024 / 1024);
    return { text: "", method: "manual", error: `${ko} 파일이 매우 큽니다(약 ${mb}MB) — 처리 메모리 한계로 자동 전사가 어렵습니다. 시간대로 분할해 업로드하거나 [텍스트 직접 입력]을 이용해주세요` };
  }

  /* 대용량은 Gemini Files API로 업로드(인라인 ~20MB 한도 우회·최대 2GB) */
  const up = await uploadToGeminiFiles(bytes, mimeType, `martyrdom-${kind}-${Date.now()}`);
  if (!up.ok || !up.fileUri) {
    if (up.fileName) await deleteGeminiFile(up.fileName);
    return { text: "", method, error: `${ko} 처리 실패: ${up.error || "업로드 실패"} — mp3/wav/mp4 변환 또는 텍스트 직접 입력 권장` };
  }

  try {
    const result = await callGemini(kind === "audio" ? AUDIO_PROMPT : VIDEO_PROMPT, {
      mode: "pro",
      featureKey: "martyrdom_ai",
      fileParts: [{ fileUri: up.fileUri, mimeType }],
      maxOutputTokens: 8192,
      timeoutMs: 180000,
      internalBulk: true,
    });
    if (!result.ok || !result.text) {
      return { text: "", method, error: `${kind === "audio" ? "음성 전사" : "영상 분석"} 실패: ${result.error || "응답 없음"} — 형식 미지원일 수 있어 mp3/wav/mp4 변환 또는 텍스트 직접 입력 권장` };
    }
    const text = result.text.trim();
    if (text.length < 5) {
      return { text, method, error: "전사 결과가 비었습니다 (무음·잡음일 수 있음)" };
    }
    return { text, method };
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
        /* ★ 2026-05-26: 문서 전체 OCR은 8초 기본 타임아웃으로 자주 중단됨.
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
