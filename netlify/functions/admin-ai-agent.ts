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
import { canAccess } from "../../lib/role-permission-check";
import { TOOL_DECLARATIONS, executeTool } from "../../lib/ai-agent-tools";

/* === Phase 1~4 비용 안전장치 === */
import { recordFeatureUsage, checkFeatureBeforeCall } from "../../lib/ai-feature";
import { checkMonthlyBudget } from "../../lib/ai-cost-monitor";
import { tryCacheGet, cacheSet, invalidateRelated } from "../../lib/ai-cache";
import { checkRateLimit } from "../../lib/ai-rate-limit";
import { ensurePromptCache } from "../../lib/ai-prompt-cache";

/* === Phase B AI 비서 설정 === */
import { getSystemPrompt, checkToolAllowed } from "../../lib/ai-agent-config";

/* === RAG 검색 인프라 === */
import { searchRag } from "../../lib/ai-embedding";

/* === 대화 요약용 (별도 가벼운 호출) === */
import { callGemini } from "../../lib/ai-gemini";

/* === #9 개인정보 마스킹 === */
import { maskPII } from "../../lib/pii-mask";

const AGENT_FEATURE_KEY = "ai_agent_chat";

/* === 대화 요약 임계 === */
const SUMMARIZE_THRESHOLD = 20;   /* messages 개수 (10턴 이상) */
const SUMMARIZE_KEEP = 10;        /* 최신 N개는 그대로 유지 */
const SUMMARY_MARKER = "[이전 대화 요약]";

export const config = { path: "/api/admin-ai-agent" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

/* 비용 최적화 정책 — 의도별 모델 체인 분리 (2026-05-13 업데이트)
 *
 * HIGH (변경 CRUD·복잡 작업) — 정확도 우선
 *   1) gemini-3.5-flash       (최신·최고 성능, 2026-06-01 추가)
 *   2) gemini-3-flash-preview (폴백)
 *   3) gemini-3.1-flash-lite  (폴백)
 *   4) gemini-2.5-flash       (안정 폴백)
 *   5) gemini-2.5-flash-lite  (최후 폴백)
 *
 * LOW (단순 조회·통계) — 속도·비용 우선
 *   1) gemini-3.1-flash-lite  (저렴·충분)
 *   2) gemini-2.5-flash-lite  (폴백)
 *
 * NONE (인사·확인 8자↓) — 도구 없이 lite로 즉시 (selectRelevantTools에서 처리)
 */
const HIGH_MODEL_CHAIN: string[] = Array.from(new Set([
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
].filter(Boolean)));
const LOW_MODEL_CHAIN: string[] = Array.from(new Set([
  /* 2026-05-14: lite가 7,411 토큰 시스템 프롬프트 + 84개 도구 declarations를
     소화 못 해 도구 호출을 거의 안 함 → flash로 승격. lite는 폴백으로 보존. */
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
].filter(Boolean)));

/* 변경 의도 키워드 — 매칭 시 HIGH 체인 사용 */
const HIGH_INTENT_KEYWORDS = [
  "추가", "등록", "생성", "만들", "넣어",
  "수정", "변경", "바꿔", "고쳐", "업데이트",
  "삭제", "지워", "제거", "없애",
  "차단", "해제", "정지",
  "발송", "보내", "보내줘",
  "환불", "복구", "롤백",
];

function pickModelChain(userMessage: string): string[] {
  const t = (userMessage || "").trim();
  if (HIGH_INTENT_KEYWORDS.some(k => t.includes(k))) return HIGH_MODEL_CHAIN;
  return LOW_MODEL_CHAIN;
}

/* 무한루프·비용 폭발 방지 한도 (적정 수준 — 보수치 ×1.5~2) */
const MAX_STEPS = 4;                /* 멀티스텝 최대 횟수 — 검색→상세→수정 3단계 + 보고 1단계 여유 */
const MAX_TOOLS_PER_CONV = 20;      /* 대화당 누적 도구 호출 상한 */
const MAX_SAME_TOOL_CONSECUTIVE = 2;/* 같은 도구 연속 호출 차단 */
const MAX_OUTPUT_TOKENS = 1500;     /* 응답당 토큰 — 회원·작업 목록 잘림 방지 */
const MAX_MESSAGES_KEEP = 30;       /* 대화 이력 유지 메시지 수 (앞쪽 트리밍) */

/* 비용 폭탄 방지 — 대화당 누적 input 토큰 한도 (estimate)
   초과 시 새 대화 강제. 메시지 누적·도구 결과 누적 모두 통제 */
const MAX_INPUT_TOKENS_PER_CONV = 100_000;
const WARN_INPUT_TOKENS_PER_CONV = 80_000;

/* 도구 결과 압축 임계 — 저장 시점에 큰 결과는 요약본으로 대체 */
const TOOL_RESULT_COMPRESS_THRESHOLD = 1200;  /* 문자 수 — 너무 작으면 본문 요약돼서 후속 답 빈약 */

/* NOTE: 실제 시스템 프롬프트는 getSystemPrompt()로 DB 또는 FALLBACK에서 로드됨 (line 529).
   여기 하드코딩된 변수는 더 이상 사용되지 않으므로 제거.
   시스템 프롬프트 수정은 lib/ai-agent-config.ts FALLBACK_SYSTEM_PROMPT 또는
   /admin-ai-config.html에서 DB 값 갱신. */

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

/* === 입력 토큰 추정 (1 토큰 ≈ 3.5자 — 한·영 혼합 기준) === */
/* Q3-012: 스트리밍 핸들러(admin-ai-agent-stream)와 공유 — 단일 출처 유지 위해 export */
export function estimateInputTokens(messages: GeminiContent[], systemPrompt: string, toolDeclarations: any[]): number {
  let total = systemPrompt.length / 3.5;
  try { total += JSON.stringify(toolDeclarations).length / 3.5; } catch {}
  for (const m of messages) {
    for (const p of (m.parts || [])) {
      if (p.text) total += String(p.text).length / 3.5;
      else if (p.inlineData) total += (p.inlineData.data?.length || 0) / 4;  /* base64 → 토큰 비율 */
      else if (p.functionCall) total += JSON.stringify(p.functionCall).length / 3.5;
      else if (p.functionResponse) total += JSON.stringify(p.functionResponse).length / 3.5;
    }
  }
  return Math.round(total);
}

/* === 도구 결과 압축 — messages 저장 시점에 호출 ===
   현재 step의 functionResponse는 그대로 두고, 이전 step의 큰 결과만 압축 */
function compressOldToolResults(messages: GeminiContent[]): GeminiContent[] {
  /* 마지막 user functionResponse 묶음은 유지 (현재 step), 그 외 functionResponse는 압축 */
  let lastFnResponseIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && (messages[i].parts || []).some((p: any) => p.functionResponse)) {
      lastFnResponseIdx = i;
      break;
    }
  }
  return messages.map((m, idx) => {
    if (idx === lastFnResponseIdx) return m;     /* 현재 step의 결과는 유지 */
    if (m.role !== "user" || !Array.isArray(m.parts)) return m;
    const newParts = m.parts.map((p: any) => {
      if (!p.functionResponse) return p;
      const raw = p.functionResponse.response?.output;
      if (raw == null) return p;
      const str = typeof raw === "string" ? raw : (() => { try { return JSON.stringify(raw); } catch { return ""; } })();
      if (str.length <= TOOL_RESULT_COMPRESS_THRESHOLD) return p;
      /* 압축 */
      const summary = summarizeToolOutput(raw, str.length);
      return {
        functionResponse: {
          name: p.functionResponse.name,
          response: { output: summary },
        },
      };
    });
    return { role: m.role, parts: newParts };
  });
}

function summarizeToolOutput(raw: any, byteLen: number): string {
  if (Array.isArray(raw)) {
    return `[이전 호출 결과: ${raw.length}개 항목 — 약 ${byteLen.toLocaleString()}자. 필요 시 도구 재호출]`;
  }
  if (typeof raw === "object" && raw !== null) {
    const keys = Object.keys(raw).slice(0, 8);
    return `[이전 호출 결과 객체: ${keys.join(", ")} ... — 약 ${byteLen.toLocaleString()}자. 필요 시 도구 재호출]`;
  }
  return String(raw).slice(0, 200) + " ... (이전 결과 생략 — 필요 시 도구 재호출)";
}

/* === 대화 요약 — 메시지 누적 시 앞부분을 AI 요약으로 압축 ===
   비용 ↑ 1회(요약 호출) vs 비용 ↓ 후속 N회(짧은 input) — 보통 5회 이상이면 이득 */
async function summarizeOldMessages(
  messages: GeminiContent[],
  adminId: number | null,
  conversationId: number | null,
): Promise<GeminiContent[]> {
  if (messages.length <= SUMMARIZE_THRESHOLD) return messages;

  /* 첫 메시지가 이미 SUMMARY_MARKER로 시작하는지 */
  const firstText = messages[0]?.parts?.[0]?.text || "";
  const alreadySummarized = typeof firstText === "string" && firstText.startsWith(SUMMARY_MARKER);

  const toSummarize = alreadySummarized
    ? messages.slice(1, messages.length - SUMMARIZE_KEEP)
    : messages.slice(0, messages.length - SUMMARIZE_KEEP);
  const toKeep = messages.slice(messages.length - SUMMARIZE_KEEP);
  const existingSummary = alreadySummarized ? firstText : "";

  /* 충분히 모이지 않으면 그냥 둠 (요약 비용이 이득 안 됨) */
  if (toSummarize.length < 4) return messages;

  /* 직렬화 — 각 메시지를 한 줄로 (max 300자) */
  const conversationText = toSummarize.map(m => {
    const partsText = (m.parts || []).map((p: any) => {
      if (p.text) return String(p.text).slice(0, 300);
      if (p.functionCall) return `[도구 호출: ${p.functionCall.name}]`;
      if (p.functionResponse) return `[도구 결과]`;
      if (p.inlineData) return `[파일 첨부: ${p.inlineData.mimeType}]`;
      return "";
    }).filter(Boolean).join(" ");
    return `${m.role === "user" ? "관리자" : "AI"}: ${partsText}`;
  }).join("\n");

  const prompt =
    `다음 ${toSummarize.length}개 메시지를 400자 이내로 한국어 요약하세요. ` +
    `핵심 결정·진행 상황·확정 사실 위주. 인사·잡담 제외.\n\n` +
    (existingSummary ? `이전 요약:\n${existingSummary.slice(SUMMARY_MARKER.length).slice(0, 600)}\n\n새 메시지:\n` : "") +
    conversationText.slice(0, 8000);

  try {
    const r = await callGemini(prompt, {
      mode: "flash",
      temperature: 0.3,
      maxOutputTokens: 600,
      featureKey: AGENT_FEATURE_KEY,
      adminId: adminId ?? undefined,
      conversationId: conversationId ?? undefined,
    });
    if (!r.ok || !r.text) {
      console.warn("[ai-agent] 대화 요약 실패", r.error);
      return messages;
    }
    const summary = r.text.trim();
    console.info(`[ai-agent] 대화 요약 성공 (${toSummarize.length}개 → 1개): ${summary.slice(0, 80)}...`);

    return [
      {
        role: "user" as const,
        parts: [{ text: `${SUMMARY_MARKER}\n${summary}\n\n(위는 이전 대화 요약입니다. 아래부터 최근 대화입니다.)` }],
      },
      ...toKeep,
    ];
  } catch (e) {
    console.warn("[ai-agent] 대화 요약 호출 오류", (e as any)?.message);
    return messages;
  }
}

/* === 동적 도구 로딩 — 의도별 도구 그룹 === */
interface ToolGroup { name: string; tools: string[]; keywords: string[] }

const TOOL_GROUPS: ToolGroup[] = [
  { name: "members",  tools: ["members_search", "members_stats", "members_recent", "members_detail", "members_recent_logins", "members_update", "members_block", "members_unblock"],
    keywords: ["회원", "가입", "유족", "유가족", "후원회원", "신규", "탈퇴", "로그인", "차단", "정지", "해제", "차단 해제", "정보 수정", "등급 변경", "블랙리스트"] },
  { name: "donations", tools: ["donations_recent", "donations_stats", "donations_by_member", "donors_top", "donors_at_risk", "donations_status_update", "email_send_by_filter", "bulk_pipeline"],
    keywords: ["후원", "정기", "일시", "기부", "금액", "후원금", "후원자", "정기결제", "고액", "이탈", "위험", "감사 이메일", "필터 이메일", "대상자 이메일", "이메일 보내줘", "재참여", "파이프라인", "일괄 처리", "후원 상태", "결제 상태"] },
  /* 직접 이메일·인앱 알림 발송 — email_send/notification_send는 어떤 그룹에도 없으면
     키워드 매칭 시 미로드되어 모델이 호출 불가(2026-06-01 BUG fix). 직접 발송 전용 그룹. */
  { name: "email",   tools: ["email_send", "sms_send", "notification_send", "email_templates_list", "email_template_create", "email_template_update", "email_template_delete", "recipient_group_create", "recipient_group_update", "recipient_group_delete", "email_send_by_filter"],
    keywords: ["메일", "이메일", "발송", "보내", "보낼", "보냄", "전송해", "알림 보내", "인앱 알림", "공지 메일", "이메일 템플릿", "메일 템플릿", "수신자 그룹", "뉴스레터", "안내 메일", "단체 메일", "단체 이메일", "문자", "SMS", "sms", "LMS", "lms", "문자메시지", "문자 메시지", "휴대폰 문자", "단체 문자"] },
  { name: "audit",    tools: ["audit_logs_recent"],
    keywords: ["감사", "이력", "로그", "audit", "기록"] },
  { name: "dispatch", tools: ["dispatch_logs_recent", "auto_triggers_recent"],
    keywords: ["발송", "전송", "트리거", "자동", "이메일 이력", "sms 이력"] },
  { name: "siren",    tools: ["incidents_list", "incidents_detail", "harassment_reports_list", "legal_consultations_list", "legal_reply_batch", "harassment_reply_batch", "incidents_status_update", "harassment_status_update", "harassment_reply", "legal_status_update", "legal_reply", "bulk_pipeline"],
    keywords: ["사건", "신고", "악성", "민원", "법률", "상담", "siren", "SIREN", "교권", "괴롭힘", "일괄 답변", "일괄답변", "거절", "전부 답변", "상태 바꿔", "검토 중", "일괄 상태", "답변", "답변해", "처리 완료", "종결"] },
  { name: "board",    tools: ["board_posts_list", "board_post_create", "board_post_update", "board_post_delete", "board_comments_list", "board_comment_hide", "notice_create", "notice_update", "notice_delete", "notices_list"],
    keywords: ["게시판", "공지", "공고", "글", "포스트", "알림글", "댓글", "숨김", "게시글 삭제"] },
  { name: "campaign", tools: ["campaigns_list", "campaigns_detail", "campaign_create", "campaigns_update", "campaign_archive"],
    keywords: ["캠페인", "카피", "광고", "모금", "아카이브", "종료"] },
  { name: "faq",      tools: ["faqs_list", "faq_create", "faq_update", "faq_delete"],
    keywords: ["faq", "FAQ", "자주묻", "자주 묻는", "질의응답"] },
  { name: "resources", tools: ["resources_list", "resource_categories_list"],
    keywords: ["자료", "자료실", "다운로드", "문서", "양식"] },
  { name: "templates", tools: ["templates_list", "template_create", "template_update", "recipient_groups_list", "email_templates_list", "email_template_create", "email_template_update", "email_template_delete", "recipient_group_create", "recipient_group_update", "recipient_group_delete"],
    keywords: ["템플릿", "양식문", "수신자", "발송 그룹", "타겟", "수신자 그룹"] },
  { name: "siren_admin", tools: ["incident_comment_add"],
    keywords: ["사건 답변", "사건 의견", "내부 메모", "코멘트", "운영자 의견"] },
  { name: "potential_donors", tools: ["potential_donors_list", "potential_donor_link"],
    keywords: ["잠재", "후원자 후보", "행사 참가자", "연결"] },
  { name: "resources_cud", tools: ["resource_create", "resource_update", "resource_delete"],
    keywords: ["자료 등록", "자료 수정", "자료 삭제"] },
  { name: "finance", tools: [
      "budgets_list", "budget_summary", "donation_policy_get", "donation_policy_update",
      /* Phase 22-A 매출 */
      "revenue_categories_list", "revenue_list", "revenue_create", "revenue_update", "revenue_approve", "revenue_refund",
      /* Phase 22-C 지출 */
      "expense_categories_list", "expenses_list", "expense_create", "expense_approve", "expense_refund",
      "pl_summary",
      /* Phase 22-B-R2 예산 편성 */
      "budget_plan_list", "budget_plan_create", "budget_plan_approve",
      /* Phase 22-D-R1 전표 시스템 */
      "account_codes_list", "voucher_list", "voucher_create", "voucher_approve",
      /* Phase 22-D-R2 통장 대사 */
      "bank_reconcile_summary",
    ],
    keywords: [
      "예산", "지출", "결산", "회계", "정책", "계좌", "재정",
      /* 22-A 매출 — substring 매칭이므로 짧은 어근으로 분해 */
      "수입", "매출", "후원외", "기타수입",
      "강연", "정부", "기업", "협찬", "지원금", "함께워크",
      /* 22-C 지출 — substring 매칭 */
      "비용", "경비", "인건비", "사업비", "관리운영비", "관리비", "운영비", "모금비",
      "지급처", "영수증",
      /* 손익 */
      "손익", "순이익", "순손실", "P&L", "pl", "PL",
      /* 22-B-R2 예산 편성 */
      "예산안", "편성", "차년도", "내년 예산", "전년 실적",
      /* 22-D-R1 전표 — substring 매칭 */
      "전표", "계정과목", "계정", "세목", "증빙", "임차료", "공과금", "통신비",
      /* 22-D-R2 통장 대사 — substring 매칭 */
      "통장", "거래내역", "대사", "입출금", "입금", "출금", "묶음정산", "정산",
    ] },
  { name: "chat", tools: ["chat_rooms_list", "chat_message_broadcast", "chat_message_send", "chat_room_close", "chat_room_messages_list"],
    keywords: ["채팅", "상담", "1:1", "메시지", "대화방", "전부 보내", "일괄 전송", "브로드캐스트", "미답변", "채팅방", "대화 종료", "상담 종료"] },
  { name: "workspace", tools: ["tasks_list", "task_create", "task_update", "task_delete", "task_comments_list", "task_comment_add", "notifications_recent"],
    keywords: ["작업", "할 일", "할일", "태스크", "워크스페이스", "투두", "todo", "카드", "댓글", "보고서"] },
  { name: "memos",     tools: ["memos_list", "memo_create", "memo_update", "memo_delete"],
    keywords: ["메모", "노트", "포스트잇", "쪽지", "스티커"] },
  { name: "calendar",  tools: ["events_list", "event_create", "event_update", "event_delete"],
    keywords: ["일정", "캘린더", "약속", "미팅", "회의", "이벤트", "스케줄", "예약", "마감일"] },
  { name: "files",     tools: ["files_list"],
    keywords: ["파일", "폴더", "자료", "문서함", "업로드"] },
  { name: "notifications", tools: ["notifications_recent", "notification_batch", "notification_send"],
    keywords: ["알림", "안내", "공지", "일괄 알림", "전체 알림", "알림 발송", "푸시"] },
  /* 예약 명령(스케줄 도구) — 어떤 그룹에도 없으면 미로드(2026-06-01 BUG fix).
     calendar(일정) 그룹과 키워드 충돌 피하려 '예약 실행/명령' 등 구체 키워드만. */
  { name: "schedule", tools: ["schedule_command", "schedule_cancel", "scheduled_commands_list"],
    keywords: ["예약 실행", "예약 명령", "예약된 작업", "정기 실행", "자동 실행", "나중에 실행", "스케줄 명령", "예약 취소", "예약 목록"] },
  { name: "kpi",      tools: ["kpi_summary"],
    keywords: ["지표", "통계", "KPI", "현황", "요약", "대시보드"] },
  { name: "content",  tools: ["content_pages_list", "content_pages_update", "page_create", "page_delete"],
    keywords: ["페이지", "콘텐츠", "정적", "내용"] },
  { name: "nav",      tools: ["nav_menus_list"],
    keywords: ["메뉴", "네비", "내비게이션"] },
  { name: "memorial", tools: ["memorial_summary", "memorial_teachers_list", "family_stories_list"],
    keywords: ["추모", "추모관", "헌화", "촛불", "국화", "방명록", "기억의 편지", "추모 영상", "유가족이야기", "모신 선생님", "헌사"] },
  /* 순직 인정 지원(딥릴리프) 읽기 도구 — 운영자 전용·순직 테이블 직접 조회(일반 RAG 격리 불변·P4) */
  { name: "martyrdom", tools: ["martyrdom_case_list", "martyrdom_case_status", "martyrdom_deadlines_upcoming"],
    keywords: ["순직", "유족급여", "딥릴리프", "deep-relief", "재해보상", "공무상 사망", "공무상사망"] },
];

/** 의도 분류 — 키워드 매칭.
 *  - 매우 짧은 메시지(8자↓) 또는 인사·확인 → 빈 배열 (도구 0개, 빠른 응답)
 *  - 매칭 0개 (의도 불명, 8자↑) → 전체 도구 (null) — 안전망
 *  - 매칭 4개↑ (광범위) → 전체 도구
 *  - 그 외 → 관련 도구만 */
const GREETING_PATTERNS = /^(야|응|네|예|아니|아니오|ok|오케이|안녕|하이|hi|hello|뭐해|왜|진행|확인|취소|좋아|싫어|괜찮)/i;

/* 어떤 TOOL_GROUP에도 속하지 않은 선언 도구 목록 — 모듈 로드 시 1회 계산.
   selectRelevantTools가 키워드 매칭 결과에 항상 합쳐서 반환(미로드 BUG 재발 방지). */
const ORPHAN_TOOL_NAMES: string[] = (() => {
  const grouped = new Set<string>();
  for (const g of TOOL_GROUPS) for (const t of g.tools) grouped.add(t);
  const orphans = (TOOL_DECLARATIONS as any[])
    .map((t: any) => t?.name).filter((n: any): n is string => typeof n === "string" && !grouped.has(n));
  if (orphans.length > 0) {
    console.warn(`[ai-agent] TOOL_GROUP 미분류 도구 ${orphans.length}개 — 항상 로드로 폴백: ${orphans.join(", ")}`);
  }
  return orphans;
})();

/* Q3-013: 스트리밍 핸들러와 공유 — TOOL_GROUPS 중복 정의 방지 위해 export */
export function selectRelevantTools(userMessage: string): string[] | null {
  const text = (userMessage || "").trim();
  /* 짧은 메시지(4자↓) 또는 인사·확인 → 도구 안 보냄.
     2026-05-14: 8자 → 4자 완화 — "내 메모"(5자) 같은 짧은 도메인 명령도 도구 받음.
     진짜 인사(응/OK/안녕)는 GREETING_PATTERNS에서 별도 잡음. */
  if (text.length <= 4 || GREETING_PATTERNS.test(text)) return [];

  const matched: ToolGroup[] = [];
  for (const g of TOOL_GROUPS) {
    for (const kw of g.keywords) {
      if (text.includes(kw)) { matched.push(g); break; }
    }
  }
  if (matched.length === 0) return null;
  /* 2026-05-14: 'matched.length >= 4 → ALL' 임계 제거.
     매칭 그룹 도구만 합쳐서 보냄 (라이브 검증 8/8 PASS). */

  const set = new Set<string>();
  for (const g of matched) for (const t of g.tools) set.add(t);
  /* 2026-06-01 안전망: 어떤 그룹에도 속하지 않은 선언 도구(누락)는 키워드 매칭 시
     영영 미로드되어 모델이 호출 불가 → 항상 포함시켜 도달 가능성 보장.
     평소 누락이 0이면 빈 배열이라 오버헤드 없음(BUG: email_send 등 26개 미로드 재발 방지). */
  for (const t of ORPHAN_TOOL_NAMES) set.add(t);
  return Array.from(set);
}

async function callGeminiWithTools(
  contents: GeminiContent[],
  toolDeclarations: any[],
  systemPrompt: string,
  modelChain: string[] = HIGH_MODEL_CHAIN,
): Promise<{ data: any; model: string }> {
  /* === Phase 4: Context Caching 시도 (32k 미달 시 자동 폴백) === */
  let lastError = "";
  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    /* Context Caching — 환경변수 AI_PROMPT_CACHE=off로 비활성화 가능.
       2026-05-14: F9 빈 응답 자동 폴백 추가됐으니 재활성화. 캐시 영향 의심 시 즉시 off. */
    const ENABLE_PROMPT_CACHE = process.env.AI_PROMPT_CACHE !== "off"
      && process.env.AI_PROMPT_CACHE !== "false";
    const cachedName = !ENABLE_PROMPT_CACHE ? null : await ensurePromptCache({
      model,
      systemPrompt,
      tools: [{ functionDeclarations: toolDeclarations }],
    });

    const body: any = cachedName
      ? {
          contents,
          cachedContent: cachedName,
          generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
        }
      : {
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          /* 도구 0개면 tools 자체 생략 (단순 응답 빠르게) */
          ...(toolDeclarations.length > 0 ? { tools: [{ functionDeclarations: toolDeclarations }] } : {}),
          generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
        };

    /* Gemini 호출 자체 timeout — Netlify 26초 한도 - 여유 마진 = 모델당 12초 */
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (r.ok) {
        const data = await r.json();
        /* 2026-05-14 B+ fix: 200 OK인데 빈 응답(STOP + parts 없음)이면 다음 모델로 폴백.
           Gemini 2.5 flash가 Context Caching + 함수 declarations 다수 조합에서
           "할 말 없음"으로 정상 종료하는 패턴 발견 (debug log 2026-05-14 01:38).
           응답 토큰 0 → 사용자에겐 "(응답 없음)"으로 보임 → 다음 모델 시도. */
        const cand0 = data?.candidates?.[0];
        const hasParts = Array.isArray(cand0?.content?.parts) && cand0.content.parts.length > 0;
        const isEmptyOk = cand0?.finishReason === "STOP" && !hasParts;
        if (isEmptyOk && i < modelChain.length - 1) {
          lastError = `${model} → STOP with empty parts (Context Caching 추정). 다음 모델 시도.`;
          console.warn(`[ai-agent] ${model} 빈 응답 (STOP/no-parts) — 다음 모델 시도`);
          continue;
        }
        if (i > 0) console.info(`[ai-agent] 폴백 #${i + 1} 성공: ${model}`);
        if (cachedName) console.info(`[ai-agent] 프롬프트 캐시 사용: ${cachedName}`);
        return { data, model };
      }
      const errText = await r.text().catch(() => "");
      lastError = `${model} → ${r.status}: ${errText.slice(0, 300)}`;
      console.warn(`[ai-agent] ${model} 실패`, r.status, errText.slice(0, 400));
      /* 폴백 케이스: 404·503·429·UNAVAILABLE·thought_signature·timeout 등 */
      const isRetryable =
        r.status === 404 || r.status === 503 || r.status === 429 ||
        errText.includes("NOT_FOUND") || errText.includes("not supported") ||
        errText.includes("UNAVAILABLE") || errText.includes("high demand") ||
        errText.includes("RESOURCE_EXHAUSTED") ||
        errText.includes("thought_signature");
      if (!isRetryable) break;
    } catch (e: any) {
      clearTimeout(timeoutId);
      /* AbortError = 우리 timeout — 다음 모델 시도 */
      if (e?.name === "AbortError") {
        lastError = `${model} → timeout 12s (다음 모델 시도)`;
        console.warn(`[ai-agent] ${model} timeout 12초`);
        continue;
      }
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
  // R45 §4-AI: AI 비서 채팅 진입 권한(ai_agent_chat·운영자 허용·권한정책 토글)
  if (!(await canAccess((auth as any).ctx?.member?.role ?? "", "ai_agent_chat"))) {
    return new Response(JSON.stringify({ ok: false, error: "AI 비서 사용 권한이 없습니다", step: "auth_role" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

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

  /* === F-1: 첨부 파일 (PDF·이미지) 받기 ===
     [{ mimeType: 'image/jpeg', data: base64 }, ...]
     5MB 한도, 4개 이하 권장 */
  const rawFiles: Array<{ mimeType?: string; data?: string }> = Array.isArray(body?.inlineFiles) ? body.inlineFiles : [];
  const inlineFiles = rawFiles
    .filter(f => f && typeof f.data === "string" && typeof f.mimeType === "string")
    .map(f => {
      let data = f.data || "";
      if (data.startsWith("data:")) {
        const idx = data.indexOf(",");
        if (idx >= 0) data = data.slice(idx + 1);
      }
      return { mimeType: f.mimeType!, data };
    })
    .filter(f => /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.mimeType))
    .slice(0, 4);
  const totalBase64KB = inlineFiles.reduce((s, f) => s + (f.data.length / 1024), 0);
  if (totalBase64KB > 7000) {  /* base64 7000KB ≈ 원본 5MB */
    return jsonError("validate", "첨부 파일 합계가 5MB를 초과합니다 (최대 4개 / 5MB)", 400);
  }

  if (!userMessage && !body?.toolApproval && inlineFiles.length === 0) {
    return jsonError("validate", "userMessage 또는 toolApproval 또는 inlineFiles 필요", 400);
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

  /* === BUG-03 fix (2026-05-14): 자연어 dry-run 승인 short-circuit ===
     직전 turn에 dry-run preview(pendingApproval)가 있고 사용자가 짧은 승인어로 답하면
     LLM 호출 건너뛰고 같은 도구를 requireApproval=false로 직접 재호출.
     "응", "OK", "진행" 같은 자연어도 toolApproval 객체와 동일 효과. */
  const APPROVE_RE = /^(응|네|예|어|그래|좋아|좋|맞아|맞다|ok|오케이|진행|진행해|확인|가자|시작|해|해줘|등록|생성|저장|승인|진행해줘)$/i;
  const REJECT_RE  = /^(아니|아니오|취소|안돼|그만|멈춰|스톱|패스|넘어가|건너|취소해)$/i;
  const isShortApprove = userMessage && APPROVE_RE.test(userMessage);
  const isShortReject  = userMessage && REJECT_RE.test(userMessage);

  if ((isShortApprove || isShortReject) && messages.length > 0) {
    /* 직전 model turn의 마지막 functionCall + 그 결과 dry_run:true 찾기 */
    let pendingCall: { name: string; args: any } | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "model") continue;
      const fnCallPart = (m.parts || []).find((p: any) => p.functionCall);
      if (!fnCallPart) continue;
      /* 그 다음 user turn (functionResponse)에서 dry_run 결과 확인 */
      const nextUser = messages[i + 1];
      if (!nextUser || nextUser.role !== "user") break;
      const fnResp = (nextUser.parts || []).find((p: any) => p.functionResponse);
      const output = fnResp?.functionResponse?.response?.output;
      const isDryRun = output && (output.dry_run === true || (typeof output === "object" && output.message?.includes?.("승인 대기")));
      if (isDryRun) {
        pendingCall = { name: fnCallPart.functionCall.name, args: fnCallPart.functionCall.args || {} };
      }
      break;
    }

    if (pendingCall) {
      if (isShortReject) {
        /* 거부 — pendingApproval 없음으로 정리, 친근한 응답 */
        const reply = `'${pendingCall.name}' 작업을 취소했습니다.`;
        return new Response(JSON.stringify({
          ok: true, conversationId, reply, toolCalls: [], pendingApproval: null,
        }), { status: 200, headers: JSON_HEADER });
      }
      /* 승인 — requireApproval=false로 직접 실행 */
      const finalArgs = { ...pendingCall.args, requireApproval: false };
      console.info(`[ai-agent] short-circuit 승인: ${pendingCall.name}`);
      const result = await executeTool(pendingCall.name, finalArgs, adminId);
      /* messages에 새 turn 추가 (감사 로그 일관성) */
      messages.push({ role: "user", parts: [{ text: userMessage }] });
      messages.push({ role: "model", parts: [{ functionCall: { name: pendingCall.name, args: finalArgs } }] });
      messages.push({ role: "user", parts: [{ functionResponse: { name: pendingCall.name, response: { output: result.output } } }] });
      const reply = result.ok
        ? (result.output?.message || `'${pendingCall.name}' 실행 완료.`)
        : `'${pendingCall.name}' 실행 실패: ${result.error || "알 수 없는 오류"}`;
      /* 대화 저장 */
      try {
        await db.execute(sql`
          UPDATE ai_agent_conversations SET messages = ${JSON.stringify(messages)}::jsonb, updated_at = NOW()
           WHERE id = ${conversationId}
        `);
      } catch (_) {}
      return new Response(JSON.stringify({
        ok: true, conversationId, reply,
        toolCalls: [{ name: pendingCall.name, args: finalArgs, result }],
        pendingApproval: null,
      }), { status: 200, headers: JSON_HEADER });
    }
  }

  /* === 동적 도구 로딩 — 첫 사용자 메시지로 의도 분류 → 관련 도구만 전송 === */
  const selectedToolNames = userMessage ? selectRelevantTools(userMessage) : null;
  let toolDeclarations: any[] = selectedToolNames
    ? (TOOL_DECLARATIONS as any[]).filter((t: any) => selectedToolNames.includes(t.name))
    : (TOOL_DECLARATIONS as any[]);
  if (selectedToolNames) {
    console.info(`[ai-agent] 동적 도구 ${toolDeclarations.length}/${(TOOL_DECLARATIONS as any[]).length}개 선택: ${selectedToolNames.join(", ")}`);
  }

  /* === Phase B: DB에서 시스템 프롬프트 + 운영자 권한 로드 === */
  const baseSystemPrompt = await getSystemPrompt();
  /* BUG-05 fix (2026-05-14): "내일/모레/이번 주" 자연어를 정확한 날짜로 변환하도록
     현재 KST 날짜를 시스템 프롬프트 맨 앞에 동적 주입. 캐시 키는 일 단위로 갱신. */
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayIso = nowKst.toISOString().slice(0, 10);
  const dayName = ["일", "월", "화", "수", "목", "금", "토"][nowKst.getUTCDay()];
  const tomorrowIso = new Date(nowKst.getTime() + 86400000).toISOString().slice(0, 10);

  /* === 소프트 업무 제한: 이 대화에서 범위 외 응답 횟수 집계 === */
  const offTopicCount = messages.filter(
    (m: any) => m.role === "model" && (
      (m.parts?.[0]?.text ?? "").startsWith("[범위외]") ||
      (m.parts?.[0]?.text ?? "").startsWith("[업무복귀]")
    )
  ).length;
  const offTopicContext = offTopicCount > 0
    ? `\n[현재 대화 상태: 범위 외 응답 ${offTopicCount}회]`
    : "";

  const systemPrompt = `현재 한국 시간(KST) 기준 오늘 날짜: ${todayIso} (${dayName}요일). 내일: ${tomorrowIso}.\n날짜 인자(dueDate·startAt 등)는 이 정보 기준으로 정확히 계산하세요.\n\n${baseSystemPrompt}${offTopicContext}`;
  const adminRole = (auth as any).ctx?.member?.role ?? null; // R45 CLUSTER-1: DB 역할(도구 권한 판정·JWT 신뢰 금지)

  /* === 의도별 모델 체인 선택 (변경 키워드 → HIGH, 그 외 → LOW) === */
  const modelChain = pickModelChain(userMessage);
  console.info(`[ai-agent] 체인 선택: ${modelChain === HIGH_MODEL_CHAIN ? "HIGH" : "LOW"} (${modelChain[0]} 1순위)`);

  /* === F-1: 첨부 파일이 있으면 toolDeclarations는 전체로 (분류 한계 회피) === */
  if (inlineFiles.length > 0) {
    toolDeclarations = TOOL_DECLARATIONS as any[];
    console.info(`[ai-agent] 첨부 파일 ${inlineFiles.length}개 — 전체 도구 사용`);
  }

  /* 2. 사용자 메시지 추가 — 첨부 있으면 파일 먼저, 텍스트 나중에 (Gemini 권장 순서) */
  if (userMessage || inlineFiles.length > 0) {
    const parts: any[] = [];
    for (const f of inlineFiles) {
      parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
    }
    if (userMessage) parts.push({ text: userMessage });
    else if (inlineFiles.length > 0) parts.push({ text: "첨부된 파일을 분석해주세요." });
    messages.push({ role: "user", parts });
  }

  /* 2.5. RAG 주입 — featureKey ai_rag_search ON 시 top-5 검색 결과를 사용자 메시지 앞에 삽입.
     2026-06-03 fix: 발송·생성·수정·삭제 등 행동(HIGH intent) 요청엔 RAG 매뉴얼 주입을 생략한다.
     매뉴얼에 "이메일은 발송 관리 메뉴에서 직접" 류 절차가 있어 RAG로 주입되면 모델이 도구(email_send 등)를
     호출하지 않고 "메뉴에서 하세요"라고 떠넘긴다(간헐적 도구 미실행의 근본 원인). RAG는 정보성 질문에만. */
  if (userMessage && modelChain !== HIGH_MODEL_CHAIN) {
    try {
      const ragCheck = await checkFeatureBeforeCall("ai_rag_search");
      if (ragCheck.ok) {
        /* AI 비서는 일반 코퍼스(qna·manual)만 검색 — 순직(martyr_*) 민감 자료 격리(§2.8·§P2.0 #10).
           필터 누락 시 전체 테이블 검색이라 진행 사건 민감정보가 AI 비서에 노출됨. */
        const ragHits = await searchRag(userMessage, 5, ["qna", "manual"]);
        if (ragHits.length > 0) {
          const ragBlock = "[참고 자료]\n" + ragHits
            .map(h => `- ${h.title || h.sourceRef}: ${h.content.slice(0, 300)}`)
            .join("\n");
          /* 마지막 user 메시지 첫 파트에 RAG 블록 prepend */
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.role === "user" && Array.isArray(lastMsg.parts)) {
            const textIdx = lastMsg.parts.findIndex((p: any) => typeof p.text === "string");
            if (textIdx >= 0) {
              lastMsg.parts[textIdx] = { text: `${ragBlock}\n\n${lastMsg.parts[textIdx].text}` };
            } else {
              lastMsg.parts.unshift({ text: ragBlock });
            }
          }
          /* 비용 기록 (fire-and-forget) */
          void recordFeatureUsage({
            featureKey: "ai_rag_search",
            model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",   // Q3-049 fix: 실제 임베딩 모델명

            inputTokens: Math.ceil(userMessage.length / 4),
            outputTokens: 0,
            adminId,
            conversationId,
          });
        }
      }
    } catch (ragErr) {
      /* RAG 실패해도 기존 동작 그대로 진행 */
      console.warn("[ai-agent] RAG 검색 실패 — 기존 동작 계속", (ragErr as any)?.message);
    }
  }

  /* 3. Gemini 호출 — 최대 5회 멀티스텝 (도구 호출 → 결과 반영 → 또 도구 호출) */
  const executedTools: any[] = [];
  let pendingApproval: any = null;
  let finalReply = "";

  /* 무한루프·비용 폭발 방지 카운터 (대화 전체 누적) */
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

  /* === 대화 요약 — 메시지 누적 시 앞부분 압축 (한도 체크 전 적용) === */
  if (messages.length > SUMMARIZE_THRESHOLD) {
    messages = await summarizeOldMessages(messages, adminId, conversationId);
  }

  /* === 비용 폭탄 방지 — 누적 input 토큰 추정 한도 === */
  const estimatedInputTokens = estimateInputTokens(messages, systemPrompt, toolDeclarations);
  if (estimatedInputTokens > MAX_INPUT_TOKENS_PER_CONV) {
    return new Response(JSON.stringify({
      ok: true, conversationId,
      reply: `이 대화의 누적 입력이 한도(${MAX_INPUT_TOKENS_PER_CONV.toLocaleString()} 토큰, 추정 ${estimatedInputTokens.toLocaleString()})를 초과해 비용 폭증 위험이 있습니다. 새 대화를 시작해주세요.`,
      toolCalls: [], pendingApproval: null,
      tokenWarning: { estimated: estimatedInputTokens, limit: MAX_INPUT_TOKENS_PER_CONV },
    }), { status: 200, headers: JSON_HEADER });
  }
  const inputTokenWarn = estimatedInputTokens >= WARN_INPUT_TOKENS_PER_CONV;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const { data: geminiRes, model: usedModel } = await callGeminiWithTools(messages, toolDeclarations, systemPrompt, modelChain);

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
          `대화당 도구 호출 한도(${MAX_TOOLS_PER_CONV}회)에 가까워 추가 호출을 중단했습니다. 새 대화를 시작해주세요.`;
        break;
      }

      /* 함수 호출 처리 */
      const fnResponses: any[] = [];
      let blockedSameTool = false;
      for (const fc of fnCalls) {
        const toolName = fc.functionCall?.name;
        const toolArgs = fc.functionCall?.args || {};

        /* 같은 도구 연속 호출 차단 — 동일 도구가 N회 연속이면 fake error 반환 */
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

        /* === Phase B: 도구 권한·토글 체크 === */
        const allow = await checkToolAllowed(toolName, adminRole);
        let result: any;
        if (!allow.ok) {
          console.warn(`[ai-agent] 도구 차단: ${toolName} — ${allow.reason}`);
          result = { ok: false, error: allow.message || "도구 호출 차단" };
        } else {
          /* === Phase 2: 캐시 hit 시 executeTool 우회 === */
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

  /* 메시지 이력 트리밍 — 너무 길어지면 앞쪽 잘라냄 (토큰·비용 절감) */
  if (messages.length > MAX_MESSAGES_KEEP) {
    /* 첫 N개 잘라내되 user→model 페어를 유지 */
    const overflow = messages.length - MAX_MESSAGES_KEEP;
    messages.splice(0, overflow);
  }

  /* === 도구 결과 압축 — 이전 step의 큰 결과는 요약본으로 대체 (현재 step은 유지) === */
  const messagesToStore = compressOldToolResults(messages);

  /* 4. 대화 저장 */
  try {
    await db.execute(sql`
      UPDATE ai_agent_conversations
         SET messages = ${JSON.stringify(messagesToStore)}::jsonb,
             updated_at = NOW()
       WHERE id = ${conversationId}
    `);
  } catch (_) { /* 저장 실패는 무시 — 응답은 정상 */ }

  /* === #9: 개인정보 마스킹 (주민번호·카드번호·계좌번호) === */
  const piiResult = maskPII(finalReply || "");
  let safeReply = piiResult.masked || "(응답 없음)";

  /* === 소프트 업무 제한: 접두사 감지 === */
  const isOffTopic = safeReply.startsWith("[범위외]");
  const isRedirect = safeReply.startsWith("[업무복귀]");
  if (isOffTopic) safeReply = safeReply.slice("[범위외]".length).trimStart();
  else if (isRedirect) safeReply = safeReply.slice("[업무복귀]".length).trimStart();

  /* === Phase 1: 경고 임계 도달 시 응답에 안내 메시지 동봉 === */
  let replyWithWarn = safeReply;
  if (budget.warn) replyWithWarn += `\n\n${budget.message}`;
  if (inputTokenWarn) {
    replyWithWarn += `\n\n이 대화의 누적 입력이 ${estimatedInputTokens.toLocaleString()} 토큰입니다 (한도 ${MAX_INPUT_TOKENS_PER_CONV.toLocaleString()}). 새 대화를 시작하면 비용·속도가 개선됩니다.`;
  }
  if (piiResult.redactCount > 0) {
    replyWithWarn += `\n\n개인정보 ${piiResult.redactCount}건 자동 마스킹 처리됨 (주민번호·카드·계좌)`;
  }

  return new Response(JSON.stringify({
    ok: true,
    conversationId,
    reply: replyWithWarn,
    isOffTopic: isOffTopic || undefined,
    isRedirect: isRedirect || undefined,
    toolCalls: executedTools,
    pendingApproval,
    costWarning: budget.warn ? budget.message : undefined,
    inputTokenEstimate: estimatedInputTokens,
    inputTokenWarn,
    piiRedacted: piiResult.redactCount,
  }), { status: 200, headers: JSON_HEADER });
};
