/**
 * 1회용 마이그 — Phase X 변경 도구 11종 권한 시드
 * X-1 (4개) + X-2 (7개)
 *
 * GET            : 진단
 * GET ?run=1     : 어드민 인증 후 실행 (멱등)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-tools-x" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS_X: Array<[string, boolean, string, string, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  /* X-1: 회원·후원 변경 */
  ["members_update",            true, "members",   "super_admin", "회원 정보 부분 수정 (이름·전화·이메일·동의·카테고리)"],
  ["members_block",             true, "members",   "super_admin", "회원 차단 (status=suspended + blacklist)"],
  ["members_unblock",           true, "members",   "super_admin", "회원 차단 해제 (status=active)"],
  ["donations_status_update",   true, "donations", "super_admin", "후원 상태 변경 (환불·실패 등)"],
  /* X-2: 신고·캠페인·게시판·작업 변경 */
  ["incidents_status_update",   true, "siren",     "admin",       "사건 제보 상태 변경"],
  ["harassment_status_update",  true, "siren",     "admin",       "악성민원 상태 변경"],
  ["legal_status_update",       true, "siren",     "admin",       "법률 상담 상태 변경"],
  ["campaigns_update",          true, "content",   "super_admin", "캠페인 정보 수정 (목표·종료일·게시)"],
  ["notice_update",             true, "content",   "super_admin", "공지사항 제목·본문 수정"],
  ["board_post_delete",         true, "board",     "super_admin", "게시판 글 soft delete"],
  ["task_update",               true, "workspace", "admin",       "워크 작업 카드 수정 (상태·진행률·담당자)"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS_X.map(t => `seed_${t[0]}`),
      count: TOOLS_X.length,
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  for (const [name, isMutation, category, requiredRole, description] of TOOLS_X) {
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
