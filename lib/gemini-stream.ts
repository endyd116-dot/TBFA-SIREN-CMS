/**
 * Gemini streamGenerateContent 호출 헬퍼 — SSE 응답 파싱
 *
 * Gemini는 streamGenerateContent?alt=sse 옵션으로 SSE 응답.
 * 각 chunk는 부분 candidates (텍스트 토큰들 또는 functionCall).
 *
 * 사용:
 *   for await (const chunk of streamGemini(model, body, GEMINI_API_KEY)) {
 *     // chunk.candidates[0].content.parts[]
 *   }
 *
 * 주의:
 *   - functionCall은 보통 마지막 chunk에 한꺼번에 옴 (token by token 아님)
 *   - 텍스트만 진짜 스트림됨
 *   - usageMetadata는 마지막 chunk에 포함
 */

export interface GeminiStreamChunk {
  candidates?: any[];
  usageMetadata?: any;
}

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export async function* streamGemini(
  model: string,
  body: any,
  apiKey: string,
  ttfbMs: number = 9000,
): AsyncGenerator<GeminiStreamChunk, void, void> {
  const url = `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  /* ★ 2026-06-01: TTFB(첫 토큰)까지만 타임아웃 보호. 기존 AbortSignal.timeout(8s)은
     요청 전체를 8초에 끊어 긴 답변이 생성 중 잘리는 문제 → 수동 컨트롤러로 변경해
     첫 청크 수신 시 타이머 해제. 이후엔 길게 생성돼도 안 끊김(스트림 정상).
     ttfbMs는 호출자가 모델별로 조정(느린 1순위엔 길게, 빠른 폴백엔 짧게). */
  const controller = new AbortController();
  let ttfbTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), ttfbMs);
  const clearTtfb = () => { if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null; } };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) { clearTtfb(); throw e; }

  if (!res.ok) {
    clearTtfb();
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini stream ${res.status}: ${errText.slice(0, 300)}`);
  }
  if (!res.body) {
    clearTtfb();
    throw new Error("Gemini stream — 응답 본문 없음");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      clearTtfb();   /* 첫 청크(또는 종료) 수신 — TTFB 달성, 타임아웃 해제 */
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /* SSE 메시지 분리 — 빈 줄(\n\n)이 구분자 */
      let sep;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const message = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        /* data: ... 라인만 추출 (event:·comment: 등 무시) */
        const dataLines = message
          .split("\n")
          .filter(l => l.startsWith("data:"))
          .map(l => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const dataText = dataLines.join("\n");
        if (dataText === "[DONE]") return;
        try {
          const parsed: GeminiStreamChunk = JSON.parse(dataText);
          yield parsed;
        } catch (e) {
          console.warn("[gemini-stream] JSON 파싱 실패", String(e).slice(0, 200), dataText.slice(0, 200));
        }
      }
    }
  } finally {
    clearTtfb();
    reader.releaseLock();
  }
}

/** 비스트리밍 generateContent — 스트리밍이 빈 응답(0청크)일 때 구제용.
 *  Netlify 런타임에서 streamGenerateContent가 빈 본문을 반환하는 환경 이슈 우회.
 *  반환: { parts, finishReason, usageMetadata } (parts는 text/functionCall 배열). */
export async function fetchGenerateContent(
  model: string,
  body: any,
  apiKey: string,
  timeoutMs: number = 14000,
): Promise<{ parts: any[]; finishReason: string; usageMetadata: any }> {
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`generateContent ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const cand = data?.candidates?.[0];
  return {
    parts: cand?.content?.parts || [],
    finishReason: String(cand?.finishReason || ""),
    usageMetadata: data?.usageMetadata || null,
  };
}

/** 모든 chunk를 합쳐 최종 응답으로 — non-stream과 동일한 형태 (편의용) */
export async function collectStreamGemini(
  model: string,
  body: any,
  apiKey: string,
): Promise<{ data: any; model: string }> {
  const merged: any = { candidates: [], usageMetadata: null };
  for await (const chunk of streamGemini(model, body, apiKey)) {
    if (chunk.candidates && chunk.candidates.length > 0) {
      const c = chunk.candidates[0];
      if (!merged.candidates[0]) merged.candidates[0] = { content: { parts: [] } };
      const parts = c.content?.parts || [];
      for (const p of parts) {
        if (p.text) {
          /* 마지막 part가 text면 append, 아니면 새 part */
          const last = merged.candidates[0].content.parts[merged.candidates[0].content.parts.length - 1];
          if (last && typeof last.text === "string") last.text += p.text;
          else merged.candidates[0].content.parts.push({ text: p.text });
        } else {
          merged.candidates[0].content.parts.push(p);
        }
      }
      if (c.finishReason) merged.candidates[0].finishReason = c.finishReason;
    }
    if (chunk.usageMetadata) merged.usageMetadata = chunk.usageMetadata;
  }
  return { data: merged, model };
}
