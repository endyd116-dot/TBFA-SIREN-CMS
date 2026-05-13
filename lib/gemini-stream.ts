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
): AsyncGenerator<GeminiStreamChunk, void, void> {
  const url = `${GEMINI_API_URL}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini stream ${res.status}: ${errText.slice(0, 300)}`);
  }
  if (!res.body) {
    throw new Error("Gemini stream — 응답 본문 없음");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
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
    reader.releaseLock();
  }
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
