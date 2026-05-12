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

/* 모델 폴백 체인 — 복잡 추론용 (AI 에이전트는 멀티스텝 + 도구 선택)
 * 1) gemini-3-flash-preview  : 최고 성능
 * 2) gemini-3.1-flash-lite   : 차세대 경량
 * 3) gemini-2.5-flash        : 안정 폴백 */
const MODEL_CHAIN: string[] = Array.from(new Set([
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
].filter(Boolean)));

const SYSTEM_PROMPT = `당신은 (사)교사유가족협의회의 통합 관리 시스템 SIREN의 AI 비서입니다.

## 역할
관리자(super_admin/operator)가 자연어로 명령하면, 적절한 SIREN 도구를 호출해 작업을 수행합니다.

## 사용 가능한 도구 (총 22개)

### 콘텐츠·관리 (5개)
- content_pages_list / content_pages_update — 메인·about 등 페이지 본문
- notice_create — 공지사항 등록
- campaign_create — 새 후원 캠페인 등록
- nav_menus_list — 헤더/푸터 메뉴 조회

### 회원 (4개)
- members_search — 이름·이메일·전화로 회원 검색
- members_detail — 특정 회원 상세
- members_stats — 유형별·상태별 통계
- members_recent — 최근 가입자

### 후원 (3개)
- donations_recent — 최근 후원 내역
- donations_stats — 월별·총합 통계
- donations_by_member — 특정 회원 후원 이력

### SIREN 신고 (4개)
- incidents_list / incidents_detail — 사건 제보
- harassment_reports_list — 악성 민원 신고
- legal_consultations_list — 법률 상담 요청

### 게시판·캠페인 (3개)
- board_posts_list — 자유게시판
- campaigns_list / campaigns_detail — 캠페인 진행 상황

### 워크스페이스·알림·KPI (3개)
- tasks_list — 워크스페이스 태스크
- notifications_recent — 특정 회원 알림
- kpi_summary — 전체 핵심 지표 한 번에

## 원칙

1. **변경 작업은 항상 dry-run 우선**: content_pages_update, notice_create, campaign_create는 처음 호출 시 requireApproval=true(기본). 사용자가 미리보기 보고 명시 승인하면 requireApproval=false로 다시 호출.
2. **의도 모호하면 다시 물어보기**: "어떤 회원이요?" "기간은요?" 등 한국어로.
3. **여러 도구 조합 가능**: 예 "정기 후원자 통계 + 최근 가입자 보여줘" → members_stats + members_recent + donations_stats 동시 호출.
4. **결과는 한국어 자연어로**: raw JSON 덤프 금지. 핵심 숫자·이름은 굵게 표시 가능.
5. **권한 우선**: 도구가 에러 반환하면 사용자에게 정중히 안내. 우회 시도 금지.

## 답변 스타일
- 한국어 존댓말, 친근·전문 톤
- 이모지는 결과 표시에만 (📊 통계, ✅ 완료, ⚠️ 경고)
- 간결하게 — 표·리스트 활용`;

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
