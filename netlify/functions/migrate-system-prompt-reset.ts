/**
 * 1회용 마이그 — 시스템 프롬프트 강제 초기화
 *
 * 문제: DB에 옛 짧은 시스템 프롬프트(도구 22개 안내, "의도 모호하면 되묻기")가
 *       저장돼 있어 AI가 명확한 명령에도 도구 호출 안 하고 되묻는 회귀 발생.
 * 해결: ai_agent_settings.system_prompt를 DELETE → 자동으로 FALLBACK 사용 (lib/ai-agent-config.ts).
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행
 *
 * 호출 성공 후 → 파일 삭제 + 커밋
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { invalidatePromptCache } from "../../lib/ai-agent-config";

export const config = { path: "/api/migrate-system-prompt-reset" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      action: "DELETE FROM ai_agent_settings WHERE key = 'system_prompt'",
      effect: "AI 비서 시스템 프롬프트가 lib/ai-agent-config.ts의 FALLBACK_SYSTEM_PROMPT로 복귀",
      reason: "옛 짧은 프롬프트가 DB에 남아 AI가 명확한 명령에도 도구 호출 안 하는 회귀",
      callExample: "GET /api/migrate-system-prompt-reset?run=1 (어드민 로그인 필요)",
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  /* 현재 값 백업 (rollback 가능하도록) */
  let beforeValue: string | null = null;
  try {
    const r: any = await db.execute(sql`
      SELECT value FROM ai_agent_settings WHERE key = 'system_prompt' LIMIT 1
    `);
    const row = (r?.rows ?? r ?? [])[0];
    beforeValue = row?.value ? String(row.value) : null;
  } catch { /* 테이블 없으면 무시 */ }

  /* DELETE */
  let deleted = 0;
  try {
    const r: any = await db.execute(sql`
      DELETE FROM ai_agent_settings WHERE key = 'system_prompt'
    `);
    deleted = Number(r?.rowCount ?? r?.affectedRows ?? 0);
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: "DELETE 실패",
      detail: String(e?.message).slice(0, 300),
    }), { status: 500, headers: JSON_HEADER });
  }

  /* 캐시 무효화 (60초 TTL 안 기다리고 즉시) */
  try { invalidatePromptCache(); } catch {}

  return new Response(JSON.stringify({
    ok: true,
    deletedRows: deleted,
    beforePreview: beforeValue ? beforeValue.slice(0, 300) + (beforeValue.length > 300 ? "..." : "") : null,
    beforeLength: beforeValue ? beforeValue.length : 0,
    nextSource: "FALLBACK_SYSTEM_PROMPT (lib/ai-agent-config.ts)",
    note: "AI 비서 다음 호출부터 새 시스템 프롬프트 적용 (60초 캐시 + 강제 무효화 완료).",
  }, null, 2), { status: 200, headers: JSON_HEADER });
};
