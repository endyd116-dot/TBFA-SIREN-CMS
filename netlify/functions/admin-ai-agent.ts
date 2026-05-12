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

export const config = { path: "/api/admin-ai-agent" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/* 모델 폴백 체인 — 환경변수 모델 → 안정 production 모델 → 경량 폴백
 * 일부 모델은 v1beta API에서 404 가능 → 자동 다음 모델로 재시도 */
const MODEL_CHAIN: string[] = Array.from(new Set([
  process.env.GEMINI_MODEL_FLASH || "",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
].filter(Boolean)));

const SYSTEM_PROMPT = `당신은 (사)교사유가족협의회의 통합 관리 시스템 SIREN의 AI 비서입니다.

역할:
- 관리자(super_admin/operator)가 자연어로 명령하면, 적절한 SIREN 도구를 호출해 작업을 수행합니다.
- 콘텐츠 페이지 수정, 공지사항 등록, 캠페인 등록, 메뉴 관리 등 콘텐츠·관리 영역 도구 5개를 사용할 수 있습니다.

원칙:
1. 모든 변경 작업(content_pages_update, notice_create, campaign_create)은 먼저 requireApproval=true로 호출해 dry-run 미리보기를 받으세요.
2. 사용자가 미리보기를 본 후 "응", "OK", "등록해", "적용" 등으로 명시 승인하면, requireApproval=false로 다시 호출해 실제 적용하세요.
3. 사용자 의도가 모호하면 도구 호출 전에 한국어로 다시 물어보세요. 예: "어떤 페이지를 수정하시겠습니까?"
4. 도구 호출 결과를 사용자에게 한국어 자연어로 친근하게 보고하세요. 단순 raw JSON 덤프 금지.
5. 위험한 작업(전체 메뉴 변경, 메인 hero 수정 등)은 반드시 미리보기 + 승인 절차 거치세요.

답변 스타일:
- 한국어 존댓말, 친근하지만 전문적인 톤.
- 이모지 절제 (작업 결과 표시할 때만).
- 길이는 간결하게.`;

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

async function callGeminiWithTools(contents: GeminiContent[]): Promise<any> {
  const body = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
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
        return await r.json();
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

  try {
    for (let step = 0; step < 5; step++) {
      const t0 = Date.now();
      const geminiRes = await callGeminiWithTools(messages);
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

      /* 함수 호출 처리 */
      const fnResponses: any[] = [];
      for (const fc of fnCalls) {
        const toolName = fc.functionCall?.name;
        const toolArgs = fc.functionCall?.args || {};
        const tStart = Date.now();
        const result = await executeTool(toolName, toolArgs, adminId);
        const durationMs = Date.now() - tStart;

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

        /* dry-run 미리보기면 사용자 승인 대기로 표시 */
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

      /* 함수 응답을 user role로 추가 → 다음 step에서 AI가 결과 보고 응답 */
      messages.push({ role: "user", parts: fnResponses });
    }
  } catch (err) {
    return jsonError("gemini_call", err);
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

  return new Response(JSON.stringify({
    ok: true,
    conversationId,
    reply: finalReply || "(응답 없음)",
    toolCalls: executedTools,
    pendingApproval,
  }), { status: 200, headers: JSON_HEADER });
};
