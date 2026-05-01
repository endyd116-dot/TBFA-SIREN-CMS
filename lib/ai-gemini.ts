/**
 * Google Gemini API 래퍼 — STEP E-3
 *
 * 모델: gemini-2.0-flash (무료/저비용, 빠름)
 * 사용법:
 *   import { callGemini, callGeminiJSON } from "../../lib/ai-gemini";
 *   const text = await callGemini("질문...");
 *   const json = await callGeminiJSON("질문...", { temperature: 0.3 });
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiOptions {
  temperature?: number;       // 0.0 (일관) ~ 1.0 (창의), 기본 0.7
  maxOutputTokens?: number;   // 최대 출력 길이, 기본 1024
  systemInstruction?: string; // 시스템 프롬프트 (역할 지정)
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
}

/**
 * Gemini API 호출 (텍스트 응답)
 */
export async function callGemini(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<GeminiResult> {
  if (!GEMINI_API_KEY) {
    console.warn("[Gemini] GEMINI_API_KEY 환경변수가 설정되지 않음");
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
      topP: 0.95,
      topK: 40,
    },
  };

  if (opts.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: opts.systemInstruction }],
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[Gemini] API error", res.status, errText);
      return { ok: false, error: `API ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data: any = await res.json();

    /* 응답 추출 */
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.output ||
      "";

    if (!text) {
      console.warn("[Gemini] 빈 응답:", JSON.stringify(data).slice(0, 300));
      return { ok: false, error: "빈 응답" };
    }

    /* 토큰 사용량 (있으면) */
    const usage = data?.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount || 0,
          completionTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return { ok: true, text: text.trim(), usage };
  } catch (err: any) {
    console.error("[Gemini] 호출 예외:", err);
    return { ok: false, error: err?.message || "Unknown error" };
  }
}

/**
 * Gemini API 호출 → JSON 파싱
 * 프롬프트에 "JSON 형식으로 응답"을 명시해야 안정적
 */
export async function callGeminiJSON<T = any>(
  prompt: string,
  opts: GeminiOptions = {}
): Promise<{ ok: boolean; data?: T; error?: string; raw?: string }> {
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
    return { ok: true, data: parsed, raw: result.text };
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