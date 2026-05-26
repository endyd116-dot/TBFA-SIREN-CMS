// lib/ai-gemini.ts
/**
 * Google Gemini API 래퍼 (★ 2026-05 v3.6 — 기능별 비용 집계·토글 통합)
 *
 * 모델 정책:
 *   1차 (디폴트): GEMINI_MODEL_PRO / FLASH (기본 gemini-3-flash)
 *   2차: gemini-3.0-flash
 *   3차: gemini-3.1-flash-lite-preview (단, 첨부 있으면 자동 스킵)
 *
 * v3.6 변경 (Phase 1.5):
 *   - GeminiOptions.featureKey 필수 — 어드민이 끈 기능이면 즉시 차단,
 *     성공 응답 직후 ai_usage_logs INSERT + ai_cost_summary UPSERT 자동
 *   - featureKey 누락 시 런타임 경고만 + "unknown" 폴백 (운영 깨짐 방지)
 *
 * v3.5 변경:
 *   - parts 순서: 파일 먼저, 텍스트 나중에 (Gemini 공식 권장)
 *   - base64 'data:' prefix 자동 정리 (방어 코드)
 *   - 첨부 전송 직전 진단 로그 강화
 */

import { checkFeatureBeforeCall, recordFeatureUsage, isKnownFeature } from "./ai-feature";
import { ensurePromptCache } from "./ai-prompt-cache";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PRO_MODEL = process.env.GEMINI_MODEL_PRO || "gemini-3-flash";
const FLASH_MODEL = process.env.GEMINI_MODEL_FLASH || "gemini-3-flash";

const LEGACY_MODEL = process.env.GEMINI_MODEL;
const EFFECTIVE_FLASH = LEGACY_MODEL && LEGACY_MODEL.includes("flash") ? LEGACY_MODEL : FLASH_MODEL;

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/* ★ 비용 최적화 정책 (월 $100 이내 목표)
 *   pro   (복잡 분석 — 일일 브리핑·주간 보고서·심층 추론):
 *           gemini-2.5-flash → gemini-3.1-flash-lite (폴백)
 *   flash (단순 작업 — 요약·평가·짧은 응답):
 *           gemini-3.1-flash-lite → gemini-2.5-flash-lite (폴백)
 *   = 비용 폭발 방지를 위해 가장 비싼 모델(2.5-flash)은 cron 깊은 분석에만,
 *     나머지(작업 요약·트리거 평가·AI 추출)는 모두 lite 사용.
 *   env로 override 가능. */
function buildFallbackChain(mode: "pro" | "flash"): string[] {
  const chain: string[] = [];
  const push = (m: string) => { if (m && !chain.includes(m)) chain.push(m); };

  if (mode === "pro") {
    push(PRO_MODEL);
    push("gemini-2.5-flash");
    push("gemini-3.1-flash-lite");
  } else {
    push(EFFECTIVE_FLASH);
    push("gemini-3.1-flash-lite");
    push("gemini-2.5-flash-lite");
  }
  return chain;
}

/* ★ B-9: 인라인 파일 정의 */
export interface InlineFile {
  data: string;        // base64 (data: prefix 없이)
  mimeType: string;    // 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
}

export interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  mode?: "pro" | "flash";
  inlineFiles?: InlineFile[];
  /** ★ Phase 1.5 — 어떤 AI 기능이 호출했는지 식별 (15개 feature_key 중 하나).
   *  생략하면 'unknown'으로 기록되며 토글·한도 적용 안 됨. 호출자가 명시할 것. */
  featureKey?: string;
  /** 운영자/사용자 식별 (admin-action 계열) */
  adminId?: number | null;
  /** ai_agent_chat용 — 대화 ID 연결 */
  conversationId?: number | null;
  /** ★ 2026-05-26: fetch 타임아웃(ms). 미지정 시 8000(동기 함수 10초 한도 방어).
   *  background 함수(-background·15분 한도)의 무거운 호출(Vision OCR·사건 구조 추출)은
   *  8초가 턱없이 짧아 대량 abort 실패 → 호출처에서 넉넉히 지정(예: 60000~120000). */
  timeoutMs?: number;
  /** ★ 2026-05-26: 운영자가 의도한 대량 background 작업(딥릴리프 일괄 추출·분류 등).
   *  true면 5분 비용 급증 cooldown(마이크로가드)을 면제 — 작업 자신의 비용 급증으로
   *  나머지 호출이 줄줄이 차단되는 자기차단 방지. (월 예산·기능 토글은 그대로 적용) */
  internalBulk?: boolean;
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
  /** ★ Phase 1.5 — 어드민이 기능을 끄거나 한도를 넘긴 경우 true */
  disabled?: boolean;
  /** disabled=true일 때 사유 */
  disabledReason?: "disabled" | "feature_budget_exceeded" | "monthly_budget_exceeded" | "surge_cooldown";
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

  /* ★ v3.5 핵심: 파일을 먼저, 텍스트(질문)를 나중에 — Gemini 공식 권장 순서 */
  const parts: any[] = [];

  if (opts.inlineFiles && opts.inlineFiles.length > 0) {
    for (const f of opts.inlineFiles) {
      /* ★ v3.5: 'data:application/pdf;base64,XXX' prefix 자동 정리 */
      let cleanData = f.data || "";
      const hadPrefix = cleanData.startsWith("data:");
      if (hadPrefix) {
        const idx = cleanData.indexOf(",");
        if (idx >= 0) cleanData = cleanData.slice(idx + 1);
      }
      parts.push({
        inlineData: {
          mimeType: f.mimeType,
          data: cleanData,
        },
      });
    }

    /* ★ v3.5: 첨부 전송 직전 상세 진단 로그 */
    console.info(`[Gemini-${modelName}] inlineFiles 전송:`,
      opts.inlineFiles.map((f, i) => ({
        idx: i,
        mimeType: f.mimeType,
        base64KB: Math.round((f.data?.length || 0) / 1024),
        prefixCleaned: (f.data || "").startsWith("data:"),
      }))
    );
  }

  /* 텍스트는 파일 뒤에 배치 */
  parts.push({ text: prompt });

  const body: any = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      /* 적정 수준 — 보수치(1024)에서 상향. 호출처에서 명시 시 그 값 우선. */
      maxOutputTokens: opts.maxOutputTokens ?? 2000,
      topP: 0.95,
      topK: 40,
    },
  };

  /* === Phase 4: Context Caching (systemInstruction이 있고 32k 이상이면) === */
  let cachedName: string | null = null;
  if (opts.systemInstruction) {
    cachedName = await ensurePromptCache({
      model: modelName,
      systemPrompt: opts.systemInstruction,
      tools: [],   // lib/ai-gemini는 tool calling 미사용 (admin-ai-agent만 별도 사용)
    });
  }

  if (cachedName) {
    body.cachedContent = cachedName;
    /* systemInstruction은 캐시에 포함됨 → body에 다시 안 넣음 */
  } else if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  try {
    /* ★ 2026-05-17: Gemini API fetch에 timeout 명시. 옛 코드에 timeout 없어
       API 응답 늦을 시 Netlify Functions 10초 한도까지 무한 대기 → 504.
       8초로 두면 폴백 chain의 첫 모델 시도 가능. */
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
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

  /* ★ Phase 1.5 — featureKey 확인 + 어드민 토글·한도 체크 */
  let featureKey = opts.featureKey || "";
  if (!featureKey) {
    console.warn(`[Gemini] featureKey 누락 — 'unknown'으로 기록. 호출 스택 확인 필요.`);
    featureKey = "unknown";
  } else if (!isKnownFeature(featureKey)) {
    console.warn(`[Gemini] 등록되지 않은 featureKey='${featureKey}' — 그대로 기록`);
  }

  const featureCheck = await checkFeatureBeforeCall(featureKey, { skipSurge: opts.internalBulk });
  if (!featureCheck.ok) {
    return {
      ok: false,
      disabled: true,
      disabledReason: featureCheck.reason,
      error: featureCheck.message || "AI 기능이 비활성화되었습니다.",
    };
  }

  const mode = opts.mode || "flash";
  const chain = buildFallbackChain(mode);
  let lastError = "";

  if (opts.inlineFiles && opts.inlineFiles.length > 0) {
    console.info(`[Gemini-${mode}] 첨부 파일 ${opts.inlineFiles.length}개 포함:`,
      opts.inlineFiles.map(f => f.mimeType).join(", "));
  }

  const callStart = Date.now();
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const result = await callSingleModel(model, prompt, opts);

    if (result.ok) {
      if (i > 0) {
        console.info(`[Gemini-${mode}] 폴백 #${i + 1} 성공: ${model} 사용 (1차 ${chain[0]} 실패)`);
      }
      /* ★ Phase 1.5 — 성공 응답 직후 사용량 기록 (fire-and-forget) */
      try {
        if (result.usage) {
          await recordFeatureUsage({
            featureKey,
            model: result.modelUsed || model,
            inputTokens: result.usage.promptTokens || 0,
            outputTokens: result.usage.completionTokens || 0,
            adminId: opts.adminId ?? null,
            conversationId: opts.conversationId ?? null,
            durationMs: Date.now() - callStart,
            success: true,
          });
        }
      } catch (_) { /* 기록 실패는 응답에 영향 없음 */ }
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
      lastError.includes("timed out") ||
      lastError.includes("abort") ||
      lastError.includes("Abort") ||
      lastError.includes("network");

    if (!isRetryable) break;
  }

  /* 실패도 기록 (success=false) — 비용 0이지만 호출 시도 카운트는 남김 */
  try {
    await recordFeatureUsage({
      featureKey,
      model: chain[chain.length - 1] || "unknown",
      inputTokens: 0, outputTokens: 0,
      adminId: opts.adminId ?? null,
      conversationId: opts.conversationId ?? null,
      durationMs: Date.now() - callStart,
      success: false,
      error: lastError.slice(0, 200),
    });
  } catch (_) { /* noop */ }

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
  } catch (_first) {
    /* ★ 2026-05-26: 폴백 — 모델이 JSON 앞뒤에 설명·마크다운을 섞어 보내거나
       앞쪽에 코드펜스가 없어 strip이 안 된 경우, 첫 { 부터 마지막 } 까지(또는 배열)
       만 추출해 재파싱. (딥릴리프 분류 "AI 응답 파싱 실패" 대량 발생 원인) */
    const m = cleaned.match(/[\{\[][\s\S]*[\}\]]/);
    if (m) {
      try {
        return { ok: true, data: JSON.parse(m[0]) as T, raw: result.text, modelUsed: result.modelUsed };
      } catch (_second) { /* 아래 실패 처리로 */ }
    }
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