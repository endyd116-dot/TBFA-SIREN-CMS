/**
 * AI 비서 설정·권한 로더 — Phase B
 *
 * 책임:
 *   1) DB에서 system_prompt, 도구 enable/권한 로드
 *   2) 60초 메모리 캐시 (호출당 DB 쿼리 없게)
 *   3) admin-ai-agent.ts가 도구 호출 직전에 체크
 *
 * 사용:
 *   const prompt = await getSystemPrompt();
 *   const allowed = await isToolAllowed(toolName, adminRole);
 */

import { sql } from "drizzle-orm";
import { db } from "../db";

const TTL_MS = 60_000;

/* =========================================================
   시스템 프롬프트
   ========================================================= */
let promptCache: { value: string; expiresAt: number } | null = null;

const FALLBACK_SYSTEM_PROMPT = `당신은 (사)교사유가족협의회 SIREN의 AI 비서입니다. 도구를 호출해 데이터를 조회·수정하고 결과를 한국어로 정리해 답변합니다.

## 도메인별 도구 사용 규칙 (정확한 도구 선택이 중요)

### 회원 (members)
- 검색: members_search(query) → 후속 members_detail(id)로 단건
- 통계: members_stats / 최근: members_recent
- 정보 수정: members_update (필드 부분 수정)
- 차단/해제: members_block(id, reason) / members_unblock(id)

### 후원 (donations)
- 최근/필터: donations_recent / 통계: donations_stats
- 특정 회원: donations_by_member(memberId)
- 상태 변경(환불·실패): donations_status_update

### SIREN 신고 (incidents·harassment·legal)
- 목록: incidents_list / harassment_reports_list / legal_consultations_list
- 사건 상세: incidents_detail
- 상태 변경: incidents_status_update / harassment_status_update / legal_status_update

### 게시판·공지 (board·notice)
- 글 목록: board_posts_list / 글 삭제: board_post_delete (soft)
- 공지 등록: notice_create / 수정: notice_update

### 캠페인 (campaigns)
- 목록/상세: campaigns_list / campaigns_detail
- 신규: campaign_create / 수정: campaigns_update

### 콘텐츠·네비
- 페이지 본문: content_pages_list / content_pages_update
- 메뉴: nav_menus_list

### 워크스페이스·알림 (tasks·notifications)
- 작업 목록: tasks_list / 신규: task_create / 수정·완료: task_update
- 알림 보기: notifications_recent / 알림 발송: notification_send

### 발송 (email)
- 단일·다수 회원: email_send (Resend, dry-run 후 발송)

### 종합 KPI
- kpi_summary — 회원·후원·신고 핵심 숫자 한 번에

## 핵심 규칙
1. **변경 작업은 모두 dry-run(requireApproval=true) 우선** → 사용자 승인 후 requireApproval=false로 재호출.
2. **회원을 식별할 때**: 이름·전화·이메일이 있으면 members_search 한 번이면 충분. 전체 목록 가져오지 마세요.
3. **특정 ID로 단건 조회가 가능하면 list 호출 금지** (예: members_detail(42) > members_recent).
4. 의도 모호하면 도구 호출 전 한국어로 다시 묻기.
5. 결과는 한국어 자연어 + 핵심 숫자만 (raw JSON 금지). 응답 200자 이내 권장.
6. 같은 도구 반복 호출 금지. 이전 결과가 "압축됨"으로 표시되면 정말 필요한 경우만 재호출.

## 계획 모드
"계획", "단계별" 단어가 있거나 도구 3개 이상 + 변경 작업이 섞이면 도구 호출 전 다음 형식으로 응답:

## 실행 계획
1. [도구명] — 무엇을 (예상 결과)
2. [도구명] — 무엇을
3. 최종 보고

이 계획대로 진행할까요? "진행"이라고 답하시면 시작합니다.

→ 단순 조회(1~2 도구)는 계획 없이 즉시 실행.

답변: 존댓말, 간결, 이모지 절제, 짧고 명확.`;

export async function getSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (promptCache && promptCache.expiresAt > now) return promptCache.value;
  try {
    const r: any = await db.execute(sql`
      SELECT value FROM ai_agent_settings WHERE key = 'system_prompt' LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    const value = row?.value ? String(row.value) : FALLBACK_SYSTEM_PROMPT;
    promptCache = { value, expiresAt: now + TTL_MS };
    return value;
  } catch {
    /* 테이블 없거나 조회 실패 — 폴백 */
    promptCache = { value: FALLBACK_SYSTEM_PROMPT, expiresAt: now + TTL_MS };
    return FALLBACK_SYSTEM_PROMPT;
  }
}

export async function setSystemPrompt(newValue: string, adminId: number | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_agent_settings (key, value, updated_by, updated_at)
    VALUES ('system_prompt', ${newValue}, ${adminId}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
  `);
  promptCache = null;   /* 즉시 무효화 */
}

/* =========================================================
   도구 권한 — 전부 메모리에 캐시 (22개라 작음)
   ========================================================= */
export interface ToolPermission {
  toolName: string;
  enabled: boolean;
  requiredRole: string | null;
  description: string | null;
  isMutation: boolean;
  category: string | null;
}

let permsCache: { value: Map<string, ToolPermission>; expiresAt: number } | null = null;

async function loadPerms(): Promise<Map<string, ToolPermission>> {
  const now = Date.now();
  if (permsCache && permsCache.expiresAt > now) return permsCache.value;

  const map = new Map<string, ToolPermission>();
  try {
    const r: any = await db.execute(sql`
      SELECT tool_name, enabled, required_role, description, is_mutation, category
        FROM ai_tool_permissions
    `);
    const rows = r?.rows ?? r ?? [];
    for (const row of rows) {
      map.set(String(row.tool_name), {
        toolName: String(row.tool_name),
        enabled: row.enabled !== false,
        requiredRole: row.required_role || null,
        description: row.description || null,
        isMutation: row.is_mutation === true,
        category: row.category || null,
      });
    }
  } catch { /* 테이블 없으면 빈 맵 — 모든 도구 통과로 동작 (마이그 전 안전) */ }

  permsCache = { value: map, expiresAt: now + TTL_MS };
  return map;
}

export function invalidatePermsCache() { permsCache = null; }

export interface ToolCheck {
  ok: boolean;
  reason?: "disabled" | "role_required";
  message?: string;
}

/** 도구 호출 직전에 호출. allowed:false면 차단. */
export async function checkToolAllowed(
  toolName: string,
  adminRole: string | null,
): Promise<ToolCheck> {
  const perms = await loadPerms();
  const p = perms.get(toolName);

  /* 등록되지 않은 도구는 통과 (시드 누락 안전망) */
  if (!p) return { ok: true };

  if (!p.enabled) {
    return {
      ok: false, reason: "disabled",
      message: `'${p.description || toolName}' 도구가 관리자에 의해 비활성화됐습니다.`,
    };
  }

  if (p.requiredRole && p.requiredRole !== adminRole) {
    return {
      ok: false, reason: "role_required",
      message: `'${p.description || toolName}' 도구는 ${roleLabel(p.requiredRole)} 권한이 필요합니다.`,
    };
  }

  return { ok: true };
}

function roleLabel(role: string): string {
  return ({ super_admin: "슈퍼관리자", admin: "관리자" } as Record<string, string>)[role] || role;
}

/** 어드민 화면용 — 모든 도구 권한 목록 */
export async function listToolPermissions(): Promise<ToolPermission[]> {
  const perms = await loadPerms();
  return Array.from(perms.values()).sort((a, b) => {
    const c = (a.category || "").localeCompare(b.category || "");
    return c !== 0 ? c : a.toolName.localeCompare(b.toolName);
  });
}

/** 도구 권한 변경 */
export async function updateToolPermission(
  toolName: string,
  patch: Partial<Pick<ToolPermission, "enabled" | "requiredRole">>,
): Promise<void> {
  if (patch.enabled !== undefined && patch.requiredRole !== undefined) {
    await db.execute(sql`
      UPDATE ai_tool_permissions
         SET enabled = ${patch.enabled},
             required_role = ${patch.requiredRole},
             updated_at = NOW()
       WHERE tool_name = ${toolName}
    `);
  } else if (patch.enabled !== undefined) {
    await db.execute(sql`
      UPDATE ai_tool_permissions
         SET enabled = ${patch.enabled}, updated_at = NOW()
       WHERE tool_name = ${toolName}
    `);
  } else if (patch.requiredRole !== undefined) {
    await db.execute(sql`
      UPDATE ai_tool_permissions
         SET required_role = ${patch.requiredRole}, updated_at = NOW()
       WHERE tool_name = ${toolName}
    `);
  }
  invalidatePermsCache();
}
