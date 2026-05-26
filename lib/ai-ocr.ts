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
import { callGemini } from "./ai-gemini";

export interface OcrResult {
  text: string;
  method: "native_pdf" | "docx" | "plain_text" | "gemini_ocr" | "manual";
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
const PLAIN_EXTS = new Set(["txt", "md", "csv", "rtf", "log", "text"]);

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

  /* ── 5. 미지원 형식 (hwp·pptx 등) — 업로드 거부 안 함, error 반환 ── */
  return {
    text: "",
    method: "manual",
    error: `미지원 형식(${ext || mime}) — 워드/PDF 변환 후 재업로드 권장. 또는 화면에서 직접 텍스트 입력 가능`,
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
