/**
 * 1회용 마이그 — Phase 1 워크스페이스 확장 도구 12종 권한 시드
 * 메모(4) + 캘린더 일정(4) + 작업 댓글·삭제(3) + 파일 목록(1)
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등 — ON CONFLICT DO NOTHING)
 *
 * 호출 성공 후 → 파일 삭제 + 커밋
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-tools-phase1ws" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS: Array<[string, boolean, string, string | null, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  /* 메모 */
  ["memos_list",          false, "workspace", null, "내 메모 목록"],
  ["memo_create",         true,  "workspace", null, "메모 생성"],
  ["memo_update",         true,  "workspace", null, "메모 수정"],
  ["memo_delete",         true,  "workspace", null, "메모 삭제 (영구)"],
  /* 캘린더 일정 */
  ["events_list",         false, "workspace", null, "캘린더 일정 목록"],
  ["event_create",        true,  "workspace", null, "캘린더 일정 생성"],
  ["event_update",        true,  "workspace", null, "캘린더 일정 수정"],
  ["event_delete",        true,  "workspace", null, "캘린더 일정 삭제 (영구)"],
  /* 작업 댓글 + 작업 삭제 */
  ["task_comments_list",  false, "workspace", null, "작업 카드 댓글 목록"],
  ["task_comment_add",    true,  "workspace", null, "작업 카드에 댓글 추가"],
  ["task_delete",         true,  "workspace", null, "작업 카드 삭제 (cascade)"],
  /* 파일 목록 */
  ["files_list",          false, "workspace", null, "워크스페이스 파일·폴더 목록"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS.map(t => `seed_${t[0]}`),
      callExample: "GET /api/migrate-ai-tools-phase1ws?run=1 (어드민 로그인 필요)",
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  for (const [name, isMutation, category, requiredRole, description] of TOOLS) {
    try {
      await db.execute(sql`
        INSERT INTO ai_tool_permissions
          (tool_name, enabled, required_role, description, is_mutation, category)
        VALUES
          (${name}, TRUE, ${requiredRole}, ${description}, ${isMutation}, ${category})
        ON CONFLICT (tool_name) DO NOTHING
      `);
      results.push({ step: `seed_${name}`, result: "ok" });
    } catch (e: any) {
      results.push({ step: `seed_${name}`, result: String(e?.message).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: JSON_HEADER });
};
