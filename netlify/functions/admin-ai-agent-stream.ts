/**
 * POST /api/admin-ai-agent-stream
 *
 * SSE 버전 admin-ai-agent — 응답을 실시간 스트리밍
 *
 * 이벤트 종류:
 *   - 'start'        : { conversationId }
 *   - 'stage'        : { message } — "🔍 정보 조회 중..." 같은 상태
 *   - 'tool_start'   : { name, args }
 *   - 'tool_done'    : { name, ok, _cached?, output? }
 *   - 'text'         : { text } — Gemini가 stream으로 보낸 텍스트 조각
 *   - 'approval'     : { toolName, args, preview }
 *   - 'done'         : { conversationId, toolCalls, pendingApproval, costWarning?, piiRedacted? }
 *   - 'error'        : { message }
 *
 * 클라이언트는 fetch + ReadableStream으로 처리 (EventSource는 POST 불가).
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { TOOL_DECLARATIONS, executeTool } from "../../lib/ai-agent-tools";

/* === Phase 1~4 비용 안전장치 === */
import { recordFeatureUsage, checkFeatureBeforeCall } from "../../lib/ai-feature";
import { checkMonthlyBudget } from "../../lib/ai-cost-monitor";
import { tryCacheGet, cacheSet, invalidateRelated } from "../../lib/ai-cache";
import { checkRateLimit } from "../../lib/ai-rate-limit";
import { ensurePromptCache } from "../../lib/ai-prompt-cache";

/* === Phase B AI 비서 설정 === */
import { getSystemPrompt, checkToolAllowed } from "../../lib/ai-agent-config";
import { maskPII } from "../../lib/pii-mask";

/* === SSE === */
import { createSSEStream, sseHeaders, type SSEWrite } from "../../lib/sse-writer";
import { streamGemini } from "../../lib/gemini-stream";

export const config = { path: "/api/admin-ai-agent-stream" };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL_CHAIN = ["gemini-3.1-flash-lite", "gemini-2.5-flash"];
const MAX_STEPS = 3;
const MAX_TOOLS_PER_CONV = 10;
const MAX_SAME_TOOL_CONSECUTIVE = 2;
const MAX_OUTPUT_TOKENS = 768;
const MAX_INPUT_TOKENS_PER_CONV = 50_000;
const AGENT_FEATURE_KEY = "ai_agent_chat";

interface GeminiContent { role: "user" | "model"; parts: any[] }

/** sse 응답 전 검증 단계에서 사용 — JSON 에러 응답 */
function jsonError(step: string, message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message, step }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return jsonError("method", "POST만 허용", 405);
  if (!GEMINI_API_KEY) return jsonError("config", "GEMINI_API_KEY 환경변수 없음", 500);

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;
  const adminRole = (auth as any).ctx?.admin?.role ?? null;

  /* 사전 검증 — SSE 시작 전에 JSON으로 거부 */
  const featureCheck = await checkFeatureBeforeCall(AGENT_FEATURE_KEY);
  if (!featureCheck.ok) return jsonError(featureCheck.reason || "feature_blocked", featureCheck.message || "차단", 429);
  const rl = await checkRateLimit(adminId);
  if (!rl.ok) return jsonError("rate_limit", rl.message || "rate limit", 429);

  let body: any = {};
  try { body = await req.json(); } catch { return jsonError("parse", "JSON 파싱 실패", 400); }
  const userMessage = String(body?.userMessage || "").trim();
  let conversationId = body?.conversationId ? Number(body.conversationId) : null;
  if (!userMessage && !body?.toolApproval) return jsonError("validate", "userMessage 필요", 400);

  /* 대화 로드/생성 */
  let messages: GeminiContent[] = [];
  if (conversationId) {
    const r: any = await db.execute(sql`
      SELECT messages FROM ai_agent_conversations WHERE id = ${conversationId} AND admin_id = ${adminId} LIMIT 1
    `).catch(() => null);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return jsonError("not_found", "대화 없음", 404);
    messages = Array.isArray(row.messages) ? row.messages : [];
  } else {
    const r: any = await db.execute(sql`
      INSERT INTO ai_agent_conversations (admin_id, title, messages)
      VALUES (${adminId}, ${userMessage.slice(0, 60) || "새 대화"}, '[]'::jsonb)
      RETURNING id
    `).catch(() => null);
    conversationId = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
  }

  /* 사용자 메시지 추가 */
  if (userMessage) messages.push({ role: "user", parts: [{ text: userMessage }] });

  const systemPrompt = await getSystemPrompt();

  /* === SSE 응답 시작 === */
  const stream = createSSEStream(async (write: SSEWrite) => {
    write("start", { conversationId });

    const executedTools: any[] = [];
    let pendingApproval: any = null;
    let finalReply = "";
    let totalToolCalls = 0;
    const recentToolNames: string[] = [];

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        /* Gemini stream 호출 — 모델 폴백 체인 (첫 모델 실패 시 다음) */
        let usedModel = MODEL_CHAIN[0];
        let usage: any = null;
        let stepParts: any[] = [];
        let stepText = "";
        let stepFnCalls: any[] = [];

        let success = false;
        let lastError = "";
        for (let m = 0; m < MODEL_CHAIN.length; m++) {
          usedModel = MODEL_CHAIN[m];
          try {
            const reqBody = {
              contents: messages,
              systemInstruction: { parts: [{ text: systemPrompt }] },
              tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
              generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
            };
            for await (const chunk of streamGemini(usedModel, reqBody, GEMINI_API_KEY)) {
              const cand = chunk.candidates?.[0];
              const parts = cand?.content?.parts || [];
              for (const p of parts) {
                if (typeof p.text === "string") {
                  write("text", { text: p.text });
                  stepText += p.text;
                } else if (p.functionCall) {
                  stepFnCalls.push(p);
                  stepParts.push(p);
                }
              }
              if (chunk.usageMetadata) usage = chunk.usageMetadata;
            }
            /* text는 마지막에 한 번에 part로 보관 (messages 저장용) */
            if (stepText) stepParts.unshift({ text: stepText });
            success = true;
            break;
          } catch (e: any) {
            lastError = String(e?.message || e);
            console.warn(`[ai-agent-stream] ${usedModel} 실패`, lastError.slice(0, 200));
            /* 다음 모델 폴백 케이스 — 503(과부하)·429(quota) 포함 */
            const isRetryable =
              lastError.includes("404") || lastError.includes("503") || lastError.includes("429") ||
              lastError.includes("NOT_FOUND") || lastError.includes("not supported") ||
              lastError.includes("UNAVAILABLE") || lastError.includes("high demand") ||
              lastError.includes("RESOURCE_EXHAUSTED");
            if (!isRetryable) break;
          }
        }
        if (!success) {
          write("error", { message: `Gemini 호출 실패: ${lastError.slice(0, 200)}` });
          break;
        }

        /* 비용 기록 */
        try {
          if (usage && (usage.promptTokenCount || usage.candidatesTokenCount)) {
            await recordFeatureUsage({
              featureKey: AGENT_FEATURE_KEY,
              adminId, conversationId,
              model: usedModel,
              inputTokens: Number(usage.promptTokenCount) || 0,
              outputTokens: Number(usage.candidatesTokenCount) || 0,
              cachedTokens: Number(usage.cachedContentTokenCount) || 0,
            });
          }
        } catch (_) {}

        if (stepText) finalReply += (finalReply ? "\n" : "") + stepText;

        /* AI 응답을 messages에 추가 */
        messages.push({ role: "model", parts: stepParts });

        if (stepFnCalls.length === 0) break;

        /* 도구 호출 처리 */
        const fnResponses: any[] = [];
        for (const fc of stepFnCalls) {
          const toolName = fc.functionCall?.name;
          const toolArgs = fc.functionCall?.args || {};

          recentToolNames.push(toolName);
          if (recentToolNames.length > MAX_SAME_TOOL_CONSECUTIVE + 1) recentToolNames.shift();
          const consec = recentToolNames.filter(n => n === toolName).length;
          if (consec > MAX_SAME_TOOL_CONSECUTIVE) {
            write("tool_done", { name: toolName, ok: false, error: `${consec}회 연속 호출 차단` });
            fnResponses.push({ functionResponse: { name: toolName, response: { output: { error: "연속 호출 차단" } } } });
            continue;
          }

          write("tool_start", { name: toolName, args: toolArgs });

          const allow = await checkToolAllowed(toolName, adminRole);
          let result: any;
          if (!allow.ok) {
            result = { ok: false, error: allow.message || "도구 차단" };
          } else {
            const cached = tryCacheGet(toolName, toolArgs);
            if (cached !== null) {
              result = { ok: true, output: cached, _cached: true };
            } else {
              result = await executeTool(toolName, toolArgs, adminId);
              if (result.ok && (result.output !== undefined || result.preview !== undefined)) {
                cacheSet(toolName, toolArgs, result.output ?? result.preview);
              }
              if (result.ok) invalidateRelated(toolName);
            }
          }

          write("tool_done", { name: toolName, ok: result.ok, _cached: result._cached, hasPreview: !!result.preview });
          totalToolCalls++;
          executedTools.push({ name: toolName, args: toolArgs, result });

          if (result.preview) {
            pendingApproval = { toolName, args: toolArgs, preview: result.preview };
            write("approval", pendingApproval);
          }

          fnResponses.push({
            functionResponse: {
              name: toolName,
              response: { output: result.ok ? (result.output ?? result.preview) : { error: result.error } },
            },
          });
        }
        messages.push({ role: "user", parts: fnResponses });
      }
    } catch (e: any) {
      write("error", { message: String(e?.message || e).slice(0, 500) });
    }

    /* 마스킹 적용된 최종 reply (위젯이 누적 텍스트 검증용으로 받음) */
    const piiResult = maskPII(finalReply);

    /* 저장 — 마스킹은 화면 표시용, 저장은 원본 */
    try {
      await db.execute(sql`
        UPDATE ai_agent_conversations
           SET messages = ${JSON.stringify(messages)}::jsonb, updated_at = NOW()
         WHERE id = ${conversationId}
      `);
    } catch (_) {}

    const budget = await checkMonthlyBudget();
    write("done", {
      conversationId,
      toolCalls: executedTools.map(t => ({ name: t.name, ok: t.result.ok })),
      pendingApproval,
      finalReply: piiResult.masked,
      piiRedacted: piiResult.redactCount,
      costWarning: budget.warn ? budget.message : undefined,
    });
  });

  return new Response(stream, { headers: sseHeaders() });
};
