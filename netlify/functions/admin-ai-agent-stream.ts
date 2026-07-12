/**
 * POST /api/admin-ai-agent-stream
 *
 * SSE 버전 admin-ai-agent — 응답을 실시간 스트리밍
 *
 * 이벤트 종류:
 *   - 'start'        : { conversationId }
 *   - 'stage'        : { message } — "정보 조회 중..." 같은 상태
 *   - 'tool_start'   : { name, args }
 *   - 'tool_done'    : { name, ok, _cached?, output? }
 *   - 'text'         : { text } — Gemini가 stream으로 보낸 텍스트 조각
 *   - 'approval'     : { toolName, args, preview }
 *   - 'done'         : { conversationId, toolCalls, pendingApproval, costWarning?, piiRedacted? }
 *   - 'error'        : { message }
 *
 * 클라이언트는 fetch + ReadableStream으로 처리 (EventSource는 POST 불가).
 */

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { TOOL_DECLARATIONS, executeTool } from "../../lib/ai-agent-tools";
/* Q3-012/013: 비스트리밍(admin-ai-agent)의 동적 도구 로딩·입력 토큰 추정 헬퍼 재사용 (단일 출처) */
import { selectRelevantTools, estimateInputTokens } from "./admin-ai-agent";

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
import { streamGemini, fetchGenerateContent } from "../../lib/gemini-stream";
/* Q3-037: 비스트리밍과 동일한 RAG 격리 검색 주입 */
import { searchRag } from "../../lib/ai-embedding";

export const config = { path: "/api/admin-ai-agent-stream" };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
/* 2026-06-01: 의도별 모델 체인 — 변경(고성능)은 gemini-3.5-flash 1순위(Swain 요청),
   단순 조회는 lite 1순위(저렴·빠름). 비스트리밍(admin-ai-agent.ts)과 정책 일치.
   스트리밍은 지연 민감 → 체인 길이 2~3으로 짧게(폴백 누적 시간 억제). */
const HIGH_MODEL_CHAIN = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"];
/* LOW 1순위는 gemini-2.5-flash — 도구 호출 안정(lite는 7k 프롬프트+도구 declarations에
   빈 응답 빈발 → 평소 "처음엔 실패" 원인). lite는 저렴한 폴백으로 보존. 비스트리밍과 일치. */
const LOW_MODEL_CHAIN  = ["gemini-2.5-flash", "gemini-3.1-flash-lite"];
const HIGH_INTENT_RE = /(추가|등록|생성|만들|넣어|수정|변경|바꿔|고쳐|업데이트|삭제|지워|제거|없애|차단|해제|정지|발송|보내|환불|복구|롤백)/;
const MAX_STEPS = 4;
const MAX_TOOLS_PER_CONV = 20;
const MAX_SAME_TOOL_CONSECUTIVE = 2;
const MAX_OUTPUT_TOKENS = 1500;
const MAX_INPUT_TOKENS_PER_CONV = 100_000;
const AGENT_FEATURE_KEY = "ai_agent_chat";

interface GeminiContent { role: "user" | "model"; parts: any[] }

/** sse 응답 전 검증 단계에서 사용 — JSON 에러 응답 */
function jsonError(step: string, message: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: message, step }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return jsonError("method", "POST만 허용", 405);
  if (!GEMINI_API_KEY) return jsonError("config", "GEMINI_API_KEY 환경변수 없음", 500);

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;
  const adminRole = (auth as any).ctx?.member?.role ?? null; // R45 CLUSTER-1: DB 역할(도구 권한 판정·JWT 신뢰 금지)
  // R45 §4-AI: AI 비서 진입 권한(ai_agent_chat·운영자 허용·권한정책 토글)
  if (!(await canAccess(adminRole ?? "", "ai_agent_chat"))) {
    return jsonError("auth_role", "AI 비서 사용 권한이 없습니다", 403);
  }

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

  /* 2026-06-01 504 fix: RAG 임베딩 검색(외부 Gemini 호출·콜드스타트 시 수 초)은
     아래 SSE 스트림 시작 이후로 이동 → 인증 통과 즉시 연결을 열어 게이트웨이 504 방지.
     (기존엔 RAG·시스템프롬프트까지 끝낸 뒤에야 첫 바이트 전송 → 콜드스타트 첫 호출 504.) */

  const systemPrompt = await getSystemPrompt();

  /* Q3-013 fix: 동적 도구 로딩 — 의도 분류로 관련 도구만 전송 (비스트리밍과 동일).
     기존엔 매 호출 전체 도구(~131개) 선언을 보내 입력 토큰이 상시 폭증했다.
     selectRelevantTools: [] = 인사·단문(도구 0), null = 매칭없음(전체), string[] = 매칭 도구만. */
  const selectedToolNames = userMessage ? selectRelevantTools(userMessage) : null;
  const toolDeclarations: any[] = selectedToolNames
    ? (TOOL_DECLARATIONS as any[]).filter((t: any) => selectedToolNames.includes(t.name))
    : (TOOL_DECLARATIONS as any[]);

  /* Q3-012 fix: 대화당 비용 상한 — 진입 시 누적 도구 호출 수·입력 토큰 한도 차단.
     기존엔 MAX_TOOLS_PER_CONV·MAX_INPUT_TOKENS_PER_CONV 상수가 선언만 되고 적용 0이었다(비용 무제한). */
  const priorToolCount = messages.reduce((n, m) => {
    if (m.role === "user" && Array.isArray(m.parts)) {
      return n + m.parts.filter((p: any) => p.functionResponse).length;
    }
    return n;
  }, 0);
  if (priorToolCount >= MAX_TOOLS_PER_CONV) {
    return jsonError("tool_limit", `이 대화에서 도구 호출 한도(${MAX_TOOLS_PER_CONV}회)를 초과했습니다. 새 대화를 시작해주세요.`, 429);
  }
  const estimatedInputTokens = estimateInputTokens(messages, systemPrompt, toolDeclarations);
  if (estimatedInputTokens > MAX_INPUT_TOKENS_PER_CONV) {
    return jsonError("input_token_limit",
      `이 대화의 누적 입력이 한도(${MAX_INPUT_TOKENS_PER_CONV.toLocaleString()} 토큰, 추정 ${estimatedInputTokens.toLocaleString()})를 초과해 비용 폭증 위험이 있습니다. 새 대화를 시작해주세요.`, 429);
  }

  /* 의도별 모델 체인 — 변경(고성능)=gemini-3.5-flash 1순위, 조회=lite (순수·빠름) */
  const modelChain = HIGH_INTENT_RE.test(userMessage) ? HIGH_MODEL_CHAIN : LOW_MODEL_CHAIN;

  /* === SSE 응답 시작 === */
  const stream = createSSEStream(async (write: SSEWrite) => {
    write("start", { conversationId });

    /* 2026-06-01 504 fix: RAG 임베딩 검색을 첫 바이트 전송 이후로 이동(콜드스타트 504 방지).
       qna·manual 격리 검색 top-5 주입. 순직(martyr_*) 민감자료는 검색 제외(격리 필수).
       2026-06-03 fix: 발송·생성·수정·삭제 등 행동(HIGH intent) 요청엔 RAG 매뉴얼 주입을 생략.
       매뉴얼에 "이메일은 발송 관리 메뉴에서 직접" 같은 절차 안내가 있어 RAG로 주입되면
       모델이 도구(email_send 등)를 호출하지 않고 매뉴얼대로 "메뉴에서 하세요"라고 떠넘김(간헐적 도구 미실행의 근본 원인).
       RAG는 정보성 질문(LOW intent)에만 사용한다. */
    if (userMessage && !HIGH_INTENT_RE.test(userMessage)) {
      try {
        const ragCheck = await checkFeatureBeforeCall("ai_rag_search");
        if (ragCheck.ok) {
          const ragHits = await searchRag(userMessage, 5, ["qna", "manual"]);
          if (ragHits.length > 0) {
            const ragBlock = "[참고 자료]\n" + ragHits
              .map(h => `- ${h.title || h.sourceRef}: ${h.content.slice(0, 300)}`)
              .join("\n");
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === "user" && Array.isArray(lastMsg.parts)) {
              const textIdx = lastMsg.parts.findIndex((p: any) => typeof p.text === "string");
              if (textIdx >= 0) lastMsg.parts[textIdx] = { text: `${ragBlock}\n\n${lastMsg.parts[textIdx].text}` };
              else lastMsg.parts.unshift({ text: ragBlock });
            }
            void recordFeatureUsage({
              featureKey: "ai_rag_search",
              model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",
              inputTokens: Math.ceil(userMessage.length / 4),
              outputTokens: 0,
              adminId, conversationId,
            });
          }
        }
      } catch (ragErr) {
        console.warn("[ai-agent-stream] RAG 검색 실패 — 기존 동작 계속", (ragErr as any)?.message);
      }
    }

    const executedTools: any[] = [];
    let pendingApproval: any = null;
    let finalReply = "";
    let totalToolCalls = 0;
    const recentToolNames: string[] = [];

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        /* Gemini stream 호출 — 의도별 모델 폴백 체인 (첫 모델 실패 시 다음) */
        let usedModel = modelChain[0];
        let usage: any = null;
        let stepParts: any[] = [];
        let stepText = "";
        let stepFnCalls: any[] = [];

        let success = false;
        let lastError = "";
        for (let m = 0; m < modelChain.length; m++) {
          usedModel = modelChain[m];
          const isLastModel = m === modelChain.length - 1;
          /* 매 시도마다 상태 초기화 — 이전 모델의 부분 출력 carryover 방지 */
          stepParts = []; stepText = ""; stepFnCalls = [];
          /* 1순위(느릴 수 있는 고성능 모델)엔 TTFB 14초, 폴백 모델은 8초 (worst-case<함수한도) */
          const ttfbMs = m === 0 ? 14000 : 8000;
          try {
            const reqBody: any = {
              contents: messages,
              systemInstruction: { parts: [{ text: systemPrompt }] },
              /* Q3-013: 동적 선택된 도구만 전송 (0개면 tools 생략 — 인사·단문 빠르게) */
              ...(toolDeclarations.length > 0 ? { tools: [{ functionDeclarations: toolDeclarations }] } : {}),
              generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
            };
            let chunkCount = 0;
            for await (const chunk of streamGemini(usedModel, reqBody, GEMINI_API_KEY, ttfbMs)) {
              chunkCount++;
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
            /* 2026-06-01 핵심 FIX: 이 Netlify 런타임에서 streamGenerateContent가
               빈 본문(0청크)을 반환하는 환경 이슈 발견 → 스트리밍이 비면 같은 모델로
               비스트리밍 generateContent 1회 구제. (비스트리밍은 34개 도구 검증 정상.) */
            if (chunkCount === 0 && stepText === "" && stepFnCalls.length === 0) {
              console.warn(`[ai-agent-stream] ${usedModel} 스트리밍 0청크 — 비스트리밍 구제 호출`);
              const ns = await fetchGenerateContent(usedModel, reqBody, GEMINI_API_KEY, ttfbMs);
              if (ns.usageMetadata) usage = ns.usageMetadata;
              for (const p of ns.parts) {
                if (typeof p.text === "string") {
                  write("text", { text: p.text });
                  stepText += p.text;
                } else if (p.functionCall) {
                  stepFnCalls.push(p);
                  stepParts.push(p);
                }
              }
            }
            /* 빈 응답(텍스트·도구 0) — lite가 STOP/no-parts로 끝나는 패턴. 다음 모델로 폴백.
               (아직 아무것도 스트리밍 안 했으므로 재시도해도 클라이언트 중복 없음) */
            if (stepText === "" && stepFnCalls.length === 0 && !isLastModel) {
              lastError = `${usedModel} 빈 응답(STOP/no-parts)`;
              console.warn(`[ai-agent-stream] ${usedModel} 빈 응답 — 다음 모델 시도`);
              continue;
            }
            /* text는 마지막에 한 번에 part로 보관 (messages 저장용) */
            if (stepText) stepParts.unshift({ text: stepText });
            success = true;
            break;
          } catch (e: any) {
            lastError = String(e?.message || e);
            console.warn(`[ai-agent-stream] ${usedModel} 실패`, lastError.slice(0, 200));
            /* 다음 모델 폴백 케이스 */
            const isRetryable =
              lastError.includes("404") || lastError.includes("503") || lastError.includes("429") ||
              lastError.includes("NOT_FOUND") || lastError.includes("not supported") ||
              lastError.includes("UNAVAILABLE") || lastError.includes("high demand") ||
              lastError.includes("RESOURCE_EXHAUSTED") ||
              lastError.includes("thought_signature") ||  /* Gemini 3.x lite 가끔 누락 */
              lastError.includes("abort");                 /* TTFB 타임아웃 → 다음(빠른) 모델로 폴백 */
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

        /* Q3-012 fix: 대화당 누적 도구 호출 한도 — 초과 시 추가 호출 중단 */
        if (priorToolCount + totalToolCalls + stepFnCalls.length > MAX_TOOLS_PER_CONV) {
          const warn = `대화당 도구 호출 한도(${MAX_TOOLS_PER_CONV}회)에 가까워 추가 호출을 중단했습니다. 새 대화를 시작해주세요.`;
          write("text", { text: `\n\n${warn}` });
          finalReply += (finalReply ? "\n\n" : "") + warn;
          break;
        }

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

          write("tool_done", { name: toolName, ok: result.ok, error: result.ok ? undefined : result.error, _cached: result._cached, hasPreview: !!result.preview });
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
