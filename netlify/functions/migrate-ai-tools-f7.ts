/**
 * 1회용 마이그 — F-7 도구 3종 권한 시드
 * task_create, email_send, notification_send
 *
 * GET            : 진단
 * GET ?run=1     : 어드민 인증 후 실행 (멱등)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-ai-tools-f7" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

const TOOLS_F7: Array<[string, boolean, string, string, string]> = [
  /* [name, isMutation, category, requiredRole, description] */
  ["task_create",        true, "workspace", "admin",       "워크스페이스 작업 카드 생성 (변경 도구)"],
  ["email_send",         true, "content",   "super_admin", "회원에게 이메일 발송 (Resend·변경 도구)"],
  ["notification_send",  true, "workspace", "admin",       "회원에게 사이트 알림 발송 (변경 도구)"],
];

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({ ok: true, mode: "diagnostic",
      adds: TOOLS_F7.map(t => `seed_${t[0]}`),
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  for (const [name, isMutation, category, requiredRole, description] of TOOLS_F7) {
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
