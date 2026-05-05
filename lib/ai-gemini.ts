/**
 * Google Gemini API 래퍼 (★ 2026-05 v3.4 — 첨부 파일 분석 추가)
 *
 * 모델 정책:
 *   1차 (디폴트): GEMINI_MODEL_PRO / FLASH (기본 gemini-3-flash)
 *   2차: gemini-3.0-flash
 *   3차: gemini-3.1-flash-lite-preview
 *
 * v3.4 추가:
 *   - inlineFiles 지원 (이미지 + PDF, base64 인라인)
 *   - Gemini 3.0+는 PDF 직접 분석 (페이지 OCR + 레이아웃 인식)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PRO_MODEL = process.env.GEMINI_MODEL_PRO || "gemini-3-flash";
const FLASH_MODEL = process.env.GEMINI_MODEL_FLASH || "gemini-3-flash";

const LEGACY_MODEL = process.env.GEMINI_MODEL;
const EFFECTIVE_FLASH = LEGACY_MODEL && LEGACY_MODEL.includes("flash") ? LEGACY_MODEL : FLASH_MODEL;

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function buildFallbackChain(mode: "pro" | "flash"): string[] {
  const chain: string[] = [];
  const push = (m: string) => { if (!chain.includes(m)) chain.push(m); };

  if (mode === "pro") {
    push(PRO_MODEL);
    push("gemini-3.0-flash");
    push("gemini-3.1-flash-lite-preview");
  } else {
    push(EFFECTIVE_FLASH);
    push("gemini-3.0-flash");
    push("gemini-3.1-flash-lite-preview");
  }
  return chain;
}

/* ★ B-9: 인라인 파일 정의 */
export interface InlineFile {
  data: string;        // base64 (data: prefix 없이)
  mimeType: string;    // 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
}

export interface InlineFile {
  data: string;      // base64
  mimeType: string;  // 'image/jpeg' | 'application/pdf' 등
}

export interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  mode?: "pro" | "flash";
  inlineFiles?: InlineFile[];
}

interface GeminiResult {
  ok: boolean;
  text?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  modelUsed?: string;
}

async function callSingleModel(
  modelName: string,
  prompt: string,
  opts: GeminiOptions
): Promise<GeminiResult> {
  if (!GEMINI_API_KEY) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const url = `${GEMINI_API_URL}/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  /* ★ B-9: 인라인 파일(이미지/PDF)을 parts에 포함 */
  const parts: any[] = [{ text: prompt }];
  if (opts.inlineFiles && opts.inlineFiles.length > 0) {
    for (const f of opts.inlineFiles) {
      parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
    }
  }

  const body: any = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 2000,
      topP: 0.95,
      topK: 40,
    },
  };

  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `${res.status}: ${errText.slice(0, 200)}`,
        modelUsed: modelName,
      };
    }

    const data: any = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.output ||
      "";

    if (!text) {
      return { ok: false, error: "빈 응답", modelUsed: modelName };
    }

    const usage = data?.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          completionTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return { ok: true, text: text.trim(), usage, modelUsed: modelName };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Unknown error",
      modelUsed: modelName,
    };
  }
}

export async function callGemini(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  if (!GEMINI_API_KEY) {
    console.warn("[Gemini] GEMINI_API_KEY 환경변수가 설정되지 않음");
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const mode = opts.mode || "flash";
  const chain = buildFallbackChain(mode);
  let lastError = "";

  /* ★ B-9: 첨부 파일 정보 로그 */
  if (opts.inlineFiles && opts.inlineFiles.length > 0) {
    console.info(`[Gemini-${mode}] 첨부 파일 ${opts.inlineFiles.length}개 포함:`,
      opts.inlineFiles.map(f => f.mimeType).join(", "));
  }

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const result = await callSingleModel(model, prompt, opts);

    if (result.ok) {
      if (i > 0) {
        console.info(`[Gemini-${mode}] 폴백 #${i + 1} 성공: ${model} 사용 (1차 ${chain[0]} 실패)`);
      }
      return result;
    }

    lastError = result.error || "Unknown";
    console.warn(`[Gemini-${mode}] ${i + 1}/${chain.length} ${model} 실패:`, lastError.slice(0, 120));

    const isRetryable =
      lastError.includes("503") ||
      lastError.includes("429") ||
      lastError.includes("404") ||
      lastError.includes("UNAVAILABLE") ||
      lastError.includes("NOT_FOUND") ||
      lastError.includes("timeout") ||
      lastError.includes("network");

    if (!isRetryable) break;
  }

  if (lastError.includes("503") || lastError.includes("UNAVAILABLE")) {
    return {
      ok: false,
      error: "AI 서비스가 일시적으로 과부하 상태입니다. 1~2분 후 다시 시도해주세요.",
    };
  }
  if (lastError.includes("429")) {
    return {
      ok: false,
      error: "AI 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
  if (lastError.includes("PERMISSION_DENIED") || lastError.includes("API key")) {
    return {
      ok: false,
      error: "AI 서비스 인증 오류가 발생했습니다. 관리자에게 문의해주세요.",
    };
  }

  return { ok: false, error: `AI 호출 실패: ${lastError.slice(0, 100)}` };
}

export async function callGeminiJSON<T = any>(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<{ ok: boolean; data?: T; error?: string; raw?: string; modelUsed?: string }> {
  const result = await callGemini(prompt, {
    temperature: 0.3,
    ...opts,
  });

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error };
  }

  let cleaned = result.text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(cleaned) as T;
    return { ok: true, data: parsed, raw: result.text, modelUsed: result.modelUsed };
  } catch (err: any) {
    console.error("[Gemini] JSON 파싱 실패:", cleaned.slice(0, 300));
    return {
      ok: false,
      error: "AI 응답 파싱 실패 — 다시 시도해주세요",
      raw: result.text,
    };
  }
}

export async function pingGemini(): Promise<boolean> {
  const r = await callGemini("Reply with only the word: pong", {
    temperature: 0,
    maxOutputTokens: 10,
    mode: "flash",
  });
  return r.ok && (r.text || "").toLowerCase().includes("pong");
}