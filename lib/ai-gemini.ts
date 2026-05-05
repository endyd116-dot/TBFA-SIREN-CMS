/**
 * Google Gemini API 래퍼 — STEP E-3 + 2026-05 강화 패치
 *
 * 모델: gemini-2.5-flash (기본) → 503 시 gemini-2.0-flash 폴백
 * 사용법:
 *   import { callGemini, callGeminiJSON } from "../../lib/ai-gemini";
 *   const text = await callGemini("질문...");
 *   const json = await callGeminiJSON("질문...", { temperature: 0.3 });
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL_PRIMARY = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_MODEL_FALLBACK1 = "gemini-2.0-flash";
const GEMINI_MODEL_FALLBACK2 = "gemini-1.5-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

interface GeminiResult {
  ok: boolean;
  text?: string;
  error?: string;
  modelUsed?: string;
  retried?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/* ─────────────────────────────────────────
   단일 호출 시도 (재시도 + 폴백 없는 raw 호출)
   ───────────────────────────────────────── */
async function callGeminiOnce(
  prompt: string,
  model: string,
  opts: GeminiOptions
): Promise<{ ok: boolean; text?: string; error?: string; statusCode?: number; usage?: any }> {
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const body: any = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
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
      console.error(`[Gemini ${model}] API error ${res.status}`, errText.slice(0, 300));
      return {
        ok: false,
        error: `API ${res.status}: ${errText.slice(0, 200)}`,
        statusCode: res.status,
      };
    }

    const data: any = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.output ||
      "";

    if (!text) {
      console.warn(`[Gemini ${model}] 빈 응답`);
      return { ok: false, error: "빈 응답" };
    }

    const usage = data?.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          completionTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return { ok: true, text: text.trim(), usage };
  } catch (err: any) {
    console.error(`[Gemini ${model}] 호출 예외:`, err);
    return { ok: false, error: err?.message || "Unknown error" };
  }
}

/* ─────────────────────────────────────────
   sleep 헬퍼
   ───────────────────────────────────────── */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini API 호출 (텍스트 응답)
 * - 503 (서비스 과부하) 시 자동 재시도 (3회, 1s/3s/5s backoff)
 * - 모든 재시도 실패 시 폴백 모델로 자동 전환
 */
export async function callGemini(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  if (!GEMINI_API_KEY) {
    console.warn("[Gemini] GEMINI_API_KEY 환경변수 미설정");
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const models = [GEMINI_MODEL_PRIMARY, GEMINI_MODEL_FALLBACK1, GEMINI_MODEL_FALLBACK2];
  const retryDelays = [1000, 3000, 5000]; // ms

  let lastError = "Unknown error";
  let totalRetries = 0;

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const model = models[mIdx];

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      const result = await callGeminiOnce(prompt, model, opts);

      if (result.ok) {
        if (mIdx > 0 || attempt > 0) {
          console.info(
            `[Gemini] 성공 (모델: ${model}, 시도: ${attempt + 1}/${retryDelays.length}, 폴백 단계: ${mIdx})`
          );
        }
        return {
          ok: true,
          text: result.text,
          modelUsed: model,
          retried: totalRetries,
          usage: result.usage,
        };
      }

      lastError = result.error || "Unknown";
      totalRetries++;

      /* 503 (서비스 과부하)이면 재시도, 그 외는 모델 전환 */
      const is503 = result.statusCode === 503;
      const is429 = result.statusCode === 429; // Rate limit
      const isRetriable = is503 || is429;

      if (!isRetriable) {
        /* 401/403/400 등은 재시도 무의미 → 즉시 다음 모델로 */
        console.warn(`[Gemini ${model}] 비-재시도 에러 (${result.statusCode}). 폴백 모델로 전환.`);
        break;
      }

      /* 재시도 가능한 에러 → backoff 후 재시도 */
      if (attempt < retryDelays.length - 1) {
        console.info(
          `[Gemini ${model}] 재시도 ${attempt + 1}/${retryDelays.length} (${retryDelays[attempt]}ms 대기)`
        );
        await sleep(retryDelays[attempt]);
      }
    }

    /* 마지막 모델이면 더 이상 폴백 없음 */
    if (mIdx === models.length - 1) break;

    console.warn(`[Gemini] ${model} 모든 재시도 실패. 폴백 모델 ${models[mIdx + 1]}로 전환.`);
  }

  /* 모든 모델 + 모든 재시도 실패 */
  console.error("[Gemini] 모든 모델 + 재시도 실패:", lastError);
  return {
    ok: false,
    error: `AI 서비스가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요. (${lastError.slice(0, 100)})`,
    retried: totalRetries,
  };
}

/**
 * Gemini API 호출 → JSON 파싱
 * 프롬프트에 "JSON 형식으로 응답"을 명시해야 안정적
 */
export async function callGeminiJSON<T = any>(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<{ ok: boolean; data?: T; error?: string; raw?: string; modelUsed?: string }> {
  /* JSON 응답엔 temperature 낮게 */
  const result = await callGemini(prompt, {
    temperature: 0.3,
    ...opts,
  });

  if (!result.ok || !result.text) {
    return { ok: false, error: result.error };
  }

  /* 마크다운 코드블록 제거 (```json ... ```) */
  let cleaned = result.text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(cleaned) as T;
    return { ok: true, data: parsed, raw: result.text, modelUsed: result.modelUsed };
  } catch (err: any) {
    console.error("[Gemini] JSON 파싱 실패:", cleaned.slice(0, 300));
    return {
      ok: false,
      error: "JSON 파싱 실패: " + (err?.message || "unknown"),
      raw: result.text,
    };
  }
}

/**
 * 헬스 체크 — API 키 + 모델 동작 확인용
 */
export async function pingGemini(): Promise<boolean> {
  const r = await callGemini("Reply with only the word: pong", {
    temperature: 0,
    maxOutputTokens: 10,
  });
  return r.ok && (r.text || "").toLowerCase().includes("pong");
}