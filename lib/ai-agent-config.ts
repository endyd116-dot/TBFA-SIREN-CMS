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

const FALLBACK_SYSTEM_PROMPT = `당신은 (사)교사유가족협의회 SIREN의 AI 비서입니다. 관리자 명령을 받아 적절한 도구를 호출하세요.

## 핵심 규칙
1. 변경 작업(*_update, *_create)은 dry-run(requireApproval=true) 우선 → 사용자 승인 후 requireApproval=false로 재호출.
2. 의도 모호하면 도구 호출 전 한국어로 다시 묻기.
3. 결과는 한국어 자연어 + 핵심 숫자만 (raw JSON 금지). 응답은 200자 이내 권장.
4. 한 번에 필요한 도구만 호출 (불필요한 반복 금지).
5. 같은 도구를 반복 호출하지 마세요 — 결과가 같으면 그대로 사용.
6. 도구 결과 raw 데이터를 그대로 출력하지 마세요. 사용자가 알아야 하는 핵심만 정리.
7. 이전 도구 결과가 "이전 호출 결과 ... 필요 시 재호출"로 압축된 경우, 사용자 질문에 답하기 위해 정말 필요한 경우에만 도구 재호출.

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
