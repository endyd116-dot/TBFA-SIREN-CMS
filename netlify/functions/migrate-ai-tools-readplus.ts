/**
 * 1회용 마이그 — 추가 읽기 도구 6종 권한 시드
 * audit·로그인·발송·트리거·고액·이탈 후원자
 *
 * GET ?run=1 : 어드민 인증 후 실행 (멱등)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-tools-readplus" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS: Array<[string, boolean, string, string | null, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  ["audit_logs_recent",      false, "members",   null, "감사 로그 최근 조회"],
  ["members_recent_logins",  false, "members",   null, "최근 로그인한 회원 목록"],
  ["dispatch_logs_recent",   false, "workspace", null, "알림 발송 이력"],
  ["auto_triggers_recent",   false, "workspace", null, "자동 트리거 실행 이력"],
  ["donors_top",             false, "donations", null, "고액 후원자 상위 N명"],
  ["donors_at_risk",         false, "donations", null, "이탈 위험 후원자"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS.map(t => `seed_${t[0]}`),
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
