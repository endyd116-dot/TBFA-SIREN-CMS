/**
 * 1회용 마이그 — Phase 2 콘텐츠·게시판·캠페인·공지·FAQ 도구 10종 권한 시드
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

export const config = { path: "/api/migrate-ai-tools-phase2" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS: Array<[string, boolean, string, string | null, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  /* 공지 */
  ["notices_list",         false, "content",  null, "공지 목록 조회"],
  ["notice_delete",        true,  "content",  null, "공지 영구 삭제"],
  /* 콘텐츠 페이지 */
  ["page_create",          true,  "content",  null, "콘텐츠 페이지 신규 생성"],
  ["page_delete",          true,  "content",  null, "콘텐츠 페이지 영구 삭제"],
  /* 게시판 */
  ["board_post_create",    true,  "board",    null, "게시글 작성 (관리자 명의)"],
  ["board_post_update",    true,  "board",    null, "게시글 수정"],
  ["board_comments_list",  false, "board",    null, "게시글 댓글 목록"],
  ["board_comment_hide",   true,  "board",    null, "게시판 댓글 숨김·해제 (soft)"],
  /* 캠페인 */
  ["campaign_archive",     true,  "campaign", null, "캠페인 아카이브"],
  /* FAQ */
  ["faqs_list",            false, "content",  null, "FAQ 목록"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS.map(t => `seed_${t[0]}`),
      callExample: "GET /api/migrate-ai-tools-phase2?run=1 (어드민 로그인 필요)",
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
