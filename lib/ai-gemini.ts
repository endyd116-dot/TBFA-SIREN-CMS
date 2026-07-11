// lib/ai-gemini.ts
/**
 * Google Gemini API 래퍼 (2026-05 v3.6 — 기능별 비용 집계·토글 통합)
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

/* 비용 최적화 정책 (월 $100 이내 목표)
 *   pro   (복잡 분석 — 일일 브리핑·주간 보고서·심층 추론):
 *           gemini-2.5-flash → gemini-3.1-flash-lite (폴백)
 *   flash (단순 작업 — 요약·평가·짧은 응답):
 *           gemini-3.1-flash-lite → gemini-2.5-flash-lite (폴백)
 *   = 비용 폭발 방지를 위해 가장 비싼 모델(2.5-flash)은 cron 깊은 분석에만,
 *     나머지(작업 요약·트리거 평가·AI 추출)는 모두 lite 사용.
 *   env로 override 가능. */
// 체인 기본값(Swain 확정·2026-06-10). env GEMINI_CHAIN_HIGH/LOW(콤마)로 전 사이트 일괄 override.
//   HIGH(pro·복잡): preview→3.1-lite→2.5-flash→3.5-flash / LOW(flash·간단): 2.5-lite→3.1-lite.
const DEFAULT_CHAIN_HIGH = "gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.5-flash";
const DEFAULT_CHAIN_LOW = "gemini-2.5-flash-lite,gemini-3.1-flash-lite";
function buildFallbackChain(mode: "pro" | "flash"): string[] {
  const raw = mode === "pro"
    ? (process.env.GEMINI_CHAIN_HIGH || DEFAULT_CHAIN_HIGH)
    : (process.env.GEMINI_CHAIN_LOW || DEFAULT_CHAIN_LOW);
  const chain = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return chain.length ? chain : [mode === "pro" ? PRO_MODEL : EFFECTIVE_FLASH];
}

/* B-9: 인라인 파일 정의 */
export interface InlineFile {
  data: string;        // base64 (data: prefix 없이)
  mimeType: string;    // 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
}

/* 2026-05-26: Files API로 업로드한 대용량 파일 참조(음성·영상 등 인라인 20MB 초과) */
export interface FilePart {
  fileUri: string;     // 'https://generativelanguage.googleapis.com/v1beta/files/xxx'
  mimeType: string;
}

export interface GeminiOptions {
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  mode?: "pro" | "flash";
  inlineFiles?: InlineFile[];
  /** 2026-05-26: Files API 업로드 파일 참조(대용량 음성·영상). inlineFiles와 별개. */
  fileParts?: FilePart[];
  /** Phase 1.5 — 어떤 AI 기능이 호출했는지 식별 (15개 feature_key 중 하나).
   *  생략하면 'unknown'으로 기록되며 토글·한도 적용 안 됨. 호출자가 명시할 것. */
  featureKey?: string;
  /** 운영자/사용자 식별 (admin-action 계열) */
  adminId?: number | null;
  /** ai_agent_chat용 — 대화 ID 연결 */
  conversationId?: number | null;
  /** 2026-05-26: fetch 타임아웃(ms). 미지정 시 8000(동기 함수 10초 한도 방어).
   *  background 함수(-background·15분 한도)의 무거운 호출(Vision OCR·사건 구조 추출)은
   *  8초가 턱없이 짧아 대량 abort 실패 → 호출처에서 넉넉히 지정(예: 60000~120000). */
  timeoutMs?: number;
  /** 2026-05-26: 운영자가 의도한 대량 background 작업(딥릴리프 일괄 추출·분류 등).
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
  /** Phase 1.5 — 어드민이 기능을 끄거나 한도를 넘긴 경우 true */
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

  /* v3.5 핵심: 파일을 먼저, 텍스트(질문)를 나중에 — Gemini 공식 권장 순서 */
  const parts: any[] = [];

  /* 2026-05-26: Files API 업로드 파일 참조(대용량 음성·영상) — 파일 먼저 */
  if (opts.fileParts && opts.fileParts.length > 0) {
    for (const fp of opts.fileParts) {
      parts.push({ fileData: { mimeType: fp.mimeType, fileUri: fp.fileUri } });
    }
  }

  if (opts.inlineFiles && opts.inlineFiles.length > 0) {
    for (const f of opts.inlineFiles) {
      /* v3.5: 'data:application/pdf;base64,XXX' prefix 자동 정리 */
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

    /* v3.5: 첨부 전송 직전 상세 진단 로그 */
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

  const _mode = opts.mode ?? "flash";
  const body: any = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      /* 적정 수준. pro=thinking ON이라 사고+답변 위해 최소 2048 확보(안 그러면 답변 잘림). */
      maxOutputTokens: _mode === "pro" ? Math.max(opts.maxOutputTokens ?? 2000, 2048) : (opts.maxOutputTokens ?? 2000),
      topP: 0.95,
      topK: 40,
      /* flash=사고 끄기(thinkingBudget 0·빠름·저비용). pro=모델 기본(사고 ON·정확). */
      ...(_mode === "flash" ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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
    /* 2026-05-17: Gemini API fetch에 timeout 명시. 옛 코드에 timeout 없어
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

  /* Phase 1.5 — featureKey 확인 + 어드민 토글·한도 체크 */
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
      /* Phase 1.5 — 성공 응답 직후 사용량 기록 (fire-and-forget) */
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
    /* 2026-05-26: 폴백 — 모델이 JSON 앞뒤에 설명·마크다운을 섞어 보내거나
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

/* =========================================================
   2026-05-26: Gemini Files API — 대용량 미디어(음성·영상) 업로드
   인라인 한도(~20MB) 초과 파일을 업로드(최대 2GB)하고 fileUri로 generateContent 참조.
   ========================================================= */
const GEMINI_FILE_BASE = "https://generativelanguage.googleapis.com";

export async function uploadToGeminiFiles(
  bytes: Buffer | Uint8Array,
  mimeType: string,
  displayName: string,
): Promise<{ ok: boolean; fileUri?: string; fileName?: string; error?: string }> {
  if (!GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY 미설정" };
  const numBytes = (bytes as any).length || (bytes as any).byteLength || 0;
  try {
    /* 1) resumable 업로드 시작 → 업로드 URL 수신 */
    const startRes = await fetch(`${GEMINI_FILE_BASE}/upload/v1beta/files?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(numBytes),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!startRes.ok) {
      return { ok: false, error: `start ${startRes.status}: ${(await startRes.text().catch(() => "")).slice(0, 150)}` };
    }
    const uploadUrl = startRes.headers.get("x-goog-upload-url") || startRes.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) return { ok: false, error: "업로드 URL 수신 실패" };

    /* 2) 바이트 업로드 + finalize */
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Length": String(numBytes),
      },
      body: bytes as any,
      signal: AbortSignal.timeout(300000), // 대용량 5분
    });
    if (!upRes.ok) return { ok: false, error: `upload ${upRes.status}` };
    const data: any = await upRes.json();
    const file = data?.file;
    if (!file?.uri || !file?.name) return { ok: false, error: "파일 메타 수신 실패" };

    /* 3) ACTIVE 될 때까지 폴링(미디어는 PROCESSING) — 최대 ~5분 */
    let state = file.state;
    let tries = 0;
    while (state === "PROCESSING" && tries < 100) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const pRes = await fetch(`${GEMINI_FILE_BASE}/v1beta/${file.name}?key=${GEMINI_API_KEY}`, { signal: AbortSignal.timeout(20000) });
        if (pRes.ok) { const pd: any = await pRes.json(); state = pd.state; }
      } catch (_) { /* 폴링 실패는 다음 회차 재시도 */ }
      tries++;
    }
    if (state !== "ACTIVE") return { ok: false, error: `파일 처리 상태=${state}`, fileName: file.name };
    return { ok: true, fileUri: file.uri, fileName: file.name };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 150) };
  }
}

export async function deleteGeminiFile(fileName: string): Promise<void> {
  if (!GEMINI_API_KEY || !fileName) return;
  try {
    await fetch(`${GEMINI_FILE_BASE}/v1beta/${fileName}?key=${GEMINI_API_KEY}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(20000),
    });
  } catch (_) { /* 정리 실패 무시 — Gemini 파일은 48h 자동 만료 */ }
}

export async function pingGemini(): Promise<boolean> {
  const r = await callGemini("Reply with only the word: pong", {
    temperature: 0,
    maxOutputTokens: 10,
    mode: "flash",
  });
  return r.ok && (r.text || "").toLowerCase().includes("pong");
}

/* =========================================================
   R43 (2026-05-29): Gemini Search Grounding 신규 래퍼
   - tools: [{ googleSearchRetrieval: {} }] 활성화
   - 응답 candidates[0].groundingMetadata.groundingChunks에서 출처 URL 추출
   - 기존 callGemini 미수정 (외부 검색 전용 신설)
   - featureKey 'martyrdom_ai_external' 표준 사용 (토글·월cap·surge·로깅)
   ========================================================= */
export interface GeminiCitation {
  uri: string;
  title?: string;
}

export interface GeminiSearchResult {
  ok: boolean;
  text?: string;
  citations?: GeminiCitation[];
  error?: string;
  disabled?: boolean;
  disabledReason?: "disabled" | "feature_budget_exceeded" | "monthly_budget_exceeded" | "surge_cooldown";
  modelUsed?: string;
}

export async function callGeminiWithSearch(
  prompt: string,
  opts: GeminiOptions = {},
): Promise<GeminiSearchResult> {
  if (!GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY not configured" };

  /* featureKey 게이트 (토글·월cap·surge) — callGemini와 동일 절차 */
  const featureKey = opts.featureKey || "unknown";
  if (!isKnownFeature(featureKey)) {
    console.warn(`[Gemini-search] 등록되지 않은 featureKey='${featureKey}'`);
  }
  const fc = await checkFeatureBeforeCall(featureKey, { skipSurge: opts.internalBulk });
  if (!fc.ok) {
    return { ok: false, disabled: true, disabledReason: fc.reason, error: fc.message || "AI 기능이 비활성화되었습니다." };
  }

  /* Search Grounding은 가장 안정적인 일반 flash 모델 1회 시도 — 폴백 chain 미사용
     (lite 모델은 tool calling 미지원 가능성·실패 시 그대로 에러 반환) */
  const model = opts.mode === "pro" ? PRO_MODEL : EFFECTIVE_FLASH;
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const body: any = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearchRetrieval: {} }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 2000,
      topP: 0.95,
      topK: 40,
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const callStart = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),  // 검색은 일반 호출보다 느림(기본 30초)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${errText.slice(0, 200)}`, modelUsed: model };
    }

    const data: any = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.output ||
      "";

    /* 출처 추출 — groundingMetadata.groundingChunks[].web.{uri,title} */
    const citations: GeminiCitation[] = [];
    const gm = data?.candidates?.[0]?.groundingMetadata;
    const chunks: any[] = gm?.groundingChunks || gm?.grounding_chunks || [];
    for (const c of chunks) {
      const web = c?.web || c?.retrievedContext || null;
      if (web?.uri) citations.push({ uri: String(web.uri), title: web.title ? String(web.title) : undefined });
    }

    /* 사용량 기록 (fire-and-forget) */
    const usage = data?.usageMetadata;
    if (usage) {
      try {
        await recordFeatureUsage({
          featureKey,
          model,
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0,
          adminId: opts.adminId ?? null,
          conversationId: opts.conversationId ?? null,
          durationMs: Date.now() - callStart,
          success: true,
        });
      } catch (_) { /* noop */ }
    }

    return { ok: true, text: (text || "").trim(), citations, modelUsed: model };
  } catch (err: any) {
    /* 실패도 기록 */
    try {
      await recordFeatureUsage({
        featureKey, model,
        inputTokens: 0, outputTokens: 0,
        adminId: opts.adminId ?? null,
        conversationId: opts.conversationId ?? null,
        durationMs: Date.now() - callStart,
        success: false,
        error: String(err?.message || err).slice(0, 200),
      });
    } catch (_) { /* noop */ }
    return { ok: false, error: String(err?.message || err).slice(0, 200), modelUsed: model };
  }
}