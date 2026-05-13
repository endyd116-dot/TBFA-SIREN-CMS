/**
 * 1회용 마이그 — Phase 3 FAQ CUD·자료실·템플릿·수신자그룹·사건 의견 10종 권한 시드
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

export const config = { path: "/api/migrate-ai-tools-phase3" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS: Array<[string, boolean, string, string | null, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  /* FAQ CUD */
  ["faq_create",                true,  "content",     null, "FAQ 생성"],
  ["faq_update",                true,  "content",     null, "FAQ 수정"],
  ["faq_delete",                true,  "content",     null, "FAQ 영구 삭제"],
  /* 자료실 */
  ["resources_list",            false, "content",     null, "자료실 자료 목록"],
  ["resource_categories_list",  false, "content",     null, "자료실 카테고리 목록"],
  /* 알림 템플릿 */
  ["templates_list",            false, "communication", null, "알림 발송 템플릿 목록"],
  ["template_create",           true,  "communication", null, "알림 템플릿 생성"],
  ["template_update",           true,  "communication", null, "알림 템플릿 수정"],
  /* 수신자 그룹 */
  ["recipient_groups_list",     false, "communication", null, "수신자 그룹 목록"],
  /* 사건 의견 */
  ["incident_comment_add",      true,  "siren",       null, "사건 제보에 운영자 의견·답변 추가"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS.map(t => `seed_${t[0]}`),
      callExample: "GET /api/migrate-ai-tools-phase3?run=1 (어드민 로그인 필요)",
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
