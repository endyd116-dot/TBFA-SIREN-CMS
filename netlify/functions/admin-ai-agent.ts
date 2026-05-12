/**
 * POST /api/admin-ai-agent
 *
 * SIREN AI 에이전트 — Gemini Function Calling 기반
 *
 * Body:
 *   {
 *     conversationId?: number   // 기존 대화 이어가기 (없으면 신규)
 *     userMessage: string       // 사용자 메시지
 *     toolApproval?: {          // 도구 승인 응답
 *       toolName: string
 *       args: any
 *     }
 *   }
 *
 * Response:
 *   {
 *     ok, conversationId,
 *     reply: string             // AI 자연어 응답
 *     toolCalls?: [{ name, args, result }]  // 실행된 도구 (있으면)
 *     pendingApproval?: { name, args, preview }  // 승인 대기 중인 도구
 *   }
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

const AGENT_FEATURE_KEY = "ai_agent_chat";

export const config = { path: "/api/admin-ai-agent" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/* ★ 비용 최적화 정책 (월 $100 이내 목표)
 *   AI 비서는 빈번 호출 → 가장 저렴한 lite 우선
 *   1) gemini-3.1-flash-lite : 1순위 (대부분의 단순한 응답·도구 선택)
 *   2) gemini-2.5-flash      : 폴백 (lite 실패 시만)
 *   복잡한 분석은 cron-agent-8/9 같은 빈도 낮은 곳에서만 2.5-flash 사용 */
const MODEL_CHAIN: string[] = Array.from(new Set([
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
].filter(Boolean)));

/* ★ 무한루프·비용 폭발 방지 한도 */
const MAX_STEPS = 3;                /* 멀티스텝 최대 횟수 (5 → 3 축소) */
const MAX_TOOLS_PER_CONV = 10;      /* 대화당 누적 도구 호출 상한 */
const MAX_SAME_TOOL_CONSECUTIVE = 2;/* 같은 도구 연속 호출 차단 */
const MAX_OUTPUT_TOKENS = 1024;     /* 응답당 토큰 (2048 → 1024) */
const MAX_MESSAGES_KEEP = 20;       /* 대화 이력 유지 메시지 수 (앞쪽 트리밍) */

/* 시스템 프롬프트 — 단축 버전 (토큰 비용 절감) */
const SYSTEM_PROMPT = `당신은 (사)교사유가족협의회 SIREN의 AI 비서입니다. 관리자 명령을 받아 적절한 도구를 호출하세요.

## 도구 22개 카테고리
- 콘텐츠·관리(5): content_pages_list/update, notice_create, campaign_create, nav_menus_list
- 회원(4): members_search/detail/stats/recent
- 후원(3): donations_recent/stats/by_member
- SIREN 신고(4): incidents_list/detail, harassment_reports_list, legal_consultations_list
- 게시판·캠페인(3): board_posts_list, campaigns_list/detail
- 워크스페이스·KPI(3): tasks_list, notifications_recent, kpi_summary

## 핵심 규칙
1. 변경 작업(*_update, *_create)은 dry-run(requireApproval=true) 우선 → 사용자 승인 후 requireApproval=false로 재호출.
2. 의도 모호하면 도구 호출 전 한국어로 다시 묻기.
3. 결과는 한국어 자연어 + 핵심 숫자만 (raw JSON 금지).
4. 한 번에 필요한 도구만 호출 (불필요한 반복 금지).
5. 같은 도구를 반복 호출하지 마세요 — 결과가 같으면 그대로 사용.

답변: 존댓말, 간결, 이모지 절제.`;

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "AI 에이전트 오류", step,
    detail: String(err?.message || err).slice(0, 500),
  }), { status, headers: JSON_HEADER });
}

interface GeminiContent {
  role: "user" | "model";
  parts: any[];
}

async function callGeminiWithTools(contents: GeminiContent[]): Promise<{ data: any; model: string }> {
  const body = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    /* ★ 비용 절감 — maxOutputTokens 보수적 + temperature 낮춤(일관성) */
    generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
  };

  let lastError = "";
  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        if (i > 0) console.info(`[ai-agent] 폴백 #${i + 1} 성공: ${model}`);
        return { data: await r.json(), model };
      }
      const errText = await r.text().catch(() => "");
      lastError = `${model} → ${r.status}: ${errText.slice(0, 300)}`;
      console.warn(`[ai-agent] ${model} 실패`, r.status, errText.slice(0, 400));
      /* 404/NOT_FOUND/UNSUPPORTED는 다음 모델 시도, 그 외는 즉시 종료 */
      const isRetryable = r.status === 404 || errText.includes("NOT_FOUND") || errText.includes("not supported");
      if (!isRetryable) break;
    } catch (e: any) {
      lastError = `${model} → ${e?.message || e}`;
      console.warn(`[ai-agent] ${model} 네트워크 오류`, e?.message);
    }
  }
  throw new Error(`모든 Gemini 모델 호출 실패: ${lastError}`);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: JSON_HEADER });
  }
  if (!GEMINI_API_KEY) {
    return jsonError("config", "GEMINI_API_KEY 환경변수 없음", 500);
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminId = (auth as any).ctx?.admin?.uid ?? null;

  /* === Phase 1.5: 'AI 비서 채팅' 기능 토글 + 기능별·전체 월 한도 체크 === */
  const featureCheck = await checkFeatureBeforeCall(AGENT_FEATURE_KEY);
  if (!featureCheck.ok) {
    return new Response(JSON.stringify({
      ok: false,
      error: featureCheck.reason === "disabled" ? "AI 비서가 비활성화되었습니다" : "AI 비용 한도 초과",
      step: featureCheck.reason || "feature_blocked",
      detail: featureCheck.message,
      used: featureCheck.used,
      limit: featureCheck.limit,
    }), { status: 429, headers: JSON_HEADER });
  }

  /* === Phase 3: 사용자별 Rate Limit (분 10 / 시간 50 / 일 500) === */
  const rl = await checkRateLimit(adminId);
  if (!rl.ok) {
    return new Response(JSON.stringify({
      ok: false, error: "AI 호출 횟수 한도 초과", step: "rate_limit",
      detail: rl.message, retryAtMs: rl.retryAtMs,
    }), { status: 429, headers: JSON_HEADER });
  }

  /* 응답 끝에서 경고 임계($80) 안내용 — 차단은 위에서 이미 처리 */
  const budget = await checkMonthlyBudget();

  let body: any = {};
  try { body = await req.json(); } catch { return jsonError("parse", "JSON 파싱 실패", 400); }

  const userMessage = String(body?.userMessage || "").trim();
  let conversationId = body?.conversationId ? Number(body.conversationId) : null;

  if (!userMessage && !body?.toolApproval) {
    return jsonError("validate", "userMessage 또는 toolApproval 필요", 400);
  }

  /* 1. 대화 로드 또는 신규 생성 */
  let messages: GeminiContent[] = [];
  if (conversationId) {
    try {
      const r: any = await db.execute(sql`
        SELECT messages FROM ai_agent_conversations WHERE id = ${conversationId} AND admin_id = ${adminId} LIMIT 1
      `);
      const row = (r?.rows ?? r ?? [])[0];
      if (!row) return jsonError("not_found", "대화 없음", 404);
      messages = Array.isArray(row.messages) ? row.messages : [];
    } catch (err) { return jsonError("load_conv", err); }
  } else {
    /* 신규 대화 생성 */
    try {
      const r: any = await db.execute(sql`
        INSERT INTO ai_agent_conversations (admin_id, title, messages)
        VALUES (${adminId}, ${userMessage.slice(0, 60) || "새 대화"}, '[]'::jsonb)
        RETURNING id
      `);
      conversationId = Number((r?.rows ?? r ?? [])[0]?.id) || 0;
    } catch (err) { return jsonError("create_conv", err); }
  }

  /* 2. 사용자 메시지 추가 */
  if (userMessage) {
    messages.push({ role: "user", parts: [{ text: userMessage }] });
  }

  /* 3. Gemini 호출 — 최대 5회 멀티스텝 (도구 호출 → 결과 반영 → 또 도구 호출) */
  const executedTools: any[] = [];
  let pendingApproval: any = null;
  let finalReply = "";

  /* ★ 무한루프·비용 폭발 방지 카운터 (대화 전체 누적) */
  let totalToolCallsThisRequest = 0;
  const recentToolNames: string[] = [];  /* 같은 도구 연속 호출 차단용 */

  /* 대화당 누적 도구 호출 수 (이전 누적 + 이번 요청) 체크
   * messages에서 이전 functionResponse 카운트 */
  const priorToolCount = messages.reduce((n, m) => {
    if (m.role === "user" && Array.isArray(m.parts)) {
      return n + m.parts.filter((p: any) => p.functionResponse).length;
    }
    return n;
  }, 0);
  if (priorToolCount >= MAX_TOOLS_PER_CONV) {
    return new Response(JSON.stringify({
      ok: true, conversationId,
      reply: `이 대화에서 도구 호출 한도(${MAX_TOOLS_PER_CONV}회)를 초과했습니다. 새 대화를 시작해주세요.`,
      toolCalls: [], pendingApproval: null,
    }), { status: 200, headers: JSON_HEADER });
  }

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const { data: geminiRes, model: usedModel } = await callGeminiWithTools(messages);

      /* === Phase 1.5: 토큰 사용량 기록 (Gemini 응답 직후) === */
      try {
        const usage = geminiRes?.usageMetadata || {};
        const inputTok = Number(usage.promptTokenCount) || 0;
        const outputTok = Number(usage.candidatesTokenCount) || 0;
        const cachedTok = Number(usage.cachedContentTokenCount) || 0;
        if (inputTok > 0 || outputTok > 0) {
          await recordFeatureUsage({
            featureKey: AGENT_FEATURE_KEY,
            adminId, conversationId, model: usedModel,
            inputTokens: inputTok, outputTokens: outputTok, cachedTokens: cachedTok,
          });
        }
      } catch (_) { /* 비용 기록 실패는 무시 — 응답은 정상 진행 */ }

      const candidate = geminiRes?.candidates?.[0];
      if (!candidate) {
        finalReply = "AI가 응답하지 않았습니다.";
        break;
      }
      const parts = candidate.content?.parts || [];
      const textParts = parts.filter((p: any) => typeof p.text === "string");
      const fnCalls = parts.filter((p: any) => p.functionCall);

      /* 텍스트 응답 누적 */
      const textChunk = textParts.map((p: any) => p.text).join("\n").trim();
      if (textChunk) finalReply += (finalReply ? "\n" : "") + textChunk;

      /* AI 응답을 messages에 model role로 추가 */
      messages.push({ role: "model", parts });

      /* 함수 호출 없으면 종료 */
      if (fnCalls.length === 0) break;

      /* 누적 한도 초과 차단 */
      if (priorToolCount + totalToolCallsThisRequest + fnCalls.length > MAX_TOOLS_PER_CONV) {
        finalReply += (finalReply ? "\n\n" : "") +
          `⚠️ 대화당 도구 호출 한도(${MAX_TOOLS_PER_CONV}회)에 가까워 추가 호출을 중단했습니다. 새 대화를 시작해주세요.`;
        break;
      }

      /* 함수 호출 처리 */
      const fnResponses: any[] = [];
      let blockedSameTool = false;
      for (const fc of fnCalls) {
        const toolName = fc.functionCall?.name;
        const toolArgs = fc.functionCall?.args || {};

        /* ★ 같은 도구 연속 호출 차단 — 동일 도구가 N회 연속이면 fake error 반환 */
        recentToolNames.push(toolName);
        if (recentToolNames.length > MAX_SAME_TOOL_CONSECUTIVE + 1) recentToolNames.shift();
        const consecutive = recentToolNames.filter(n => n === toolName).length;
        if (consecutive > MAX_SAME_TOOL_CONSECUTIVE) {
          console.warn(`[ai-agent] 같은 도구 ${toolName} ${consecutive}회 연속 — 차단`);
          fnResponses.push({
            functionResponse: {
              name: toolName,
              response: { output: { error: `같은 도구 '${toolName}'를 연속 ${consecutive}회 호출했습니다. 다른 접근 시도하거나 사용자에게 응답을 정리해 보고하세요.` } },
            },
          });
          blockedSameTool = true;
          continue;
        }

        const tStart = Date.now();

        /* === Phase 2: 캐시 hit 시 executeTool 우회 === */
        let result: any;
        const cachedOutput = tryCacheGet(toolName, toolArgs);
        if (cachedOutput !== null) {
          result = { ok: true, output: cachedOutput, _cached: true };
          console.info(`[ai-agent] 캐시 hit: ${toolName}`);
        } else {
          result = await executeTool(toolName, toolArgs, adminId);
          /* 성공한 읽기 도구만 캐시 저장 (cacheSet 내부에서 화이트리스트 체크) */
          if (result.ok && (result.output !== undefined || result.preview !== undefined)) {
            cacheSet(toolName, toolArgs, result.output ?? result.preview);
          }
          /* 변경 도구면 관련 캐시 청소 */
          if (result.ok) invalidateRelated(toolName);
        }

        const durationMs = Date.now() - tStart;
        totalToolCallsThisRequest++;

        /* 도구 로그 저장 */
        try {
          await db.execute(sql`
            INSERT INTO ai_agent_logs
              (conversation_id, admin_id, tool_name, input_args, output, status, rollback_data, duration_ms, error)
            VALUES
              (${conversationId}, ${adminId}, ${toolName},
               ${JSON.stringify(toolArgs)}::jsonb,
               ${JSON.stringify(result.output ?? result.preview ?? null)}::jsonb,
               ${result.ok ? "ok" : "error"},
               ${JSON.stringify(result.rollbackData ?? null)}::jsonb,
               ${durationMs},
               ${result.error ?? null})
          `);
        } catch (_) { /* 로그 실패는 무시 */ }

        executedTools.push({ name: toolName, args: toolArgs, result });

        if (result.preview) {
          pendingApproval = { toolName, args: toolArgs, preview: result.preview };
        }

        fnResponses.push({
          functionResponse: {
            name: toolName,
            response: { output: result.ok ? (result.output ?? result.preview) : { error: result.error } },
          },
        });
      }

      messages.push({ role: "user", parts: fnResponses });

      /* 같은 도구 차단됐으면 1회 더 진행해서 AI가 정리 보고하게 */
      if (blockedSameTool && step >= MAX_STEPS - 2) break;
    }
  } catch (err) {
    return jsonError("gemini_call", err);
  }

  /* ★ 메시지 이력 트리밍 — 너무 길어지면 앞쪽 잘라냄 (토큰·비용 절감) */
  if (messages.length > MAX_MESSAGES_KEEP) {
    /* 첫 N개 잘라내되 user→model 페어를 유지 */
    const overflow = messages.length - MAX_MESSAGES_KEEP;
    messages.splice(0, overflow);
  }

  /* 4. 대화 저장 */
  try {
    await db.execute(sql`
      UPDATE ai_agent_conversations
         SET messages = ${JSON.stringify(messages)}::jsonb,
             updated_at = NOW()
       WHERE id = ${conversationId}
    `);
  } catch (_) { /* 저장 실패는 무시 — 응답은 정상 */ }

  /* === Phase 1: 경고 임계 도달 시 응답에 안내 메시지 동봉 === */
  const replyWithWarn = budget.warn
    ? `${finalReply || "(응답 없음)"}\n\n${budget.message}`
    : (finalReply || "(응답 없음)");

  return new Response(JSON.stringify({
    ok: true,
    conversationId,
    reply: replyWithWarn,
    toolCalls: executedTools,
    pendingApproval,
    costWarning: budget.warn ? budget.message : undefined,
  }), { status: 200, headers: JSON_HEADER });
};
