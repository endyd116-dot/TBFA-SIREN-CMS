/**
 * 1회용 마이그레이션 — 라운드 9: 채팅 메시지 수정/소프트 삭제 컬럼 추가
 *  - chat_messages.edited_at   (timestamp NULL)
 *  - chat_messages.is_deleted  (boolean NOT NULL DEFAULT false)
 *  - chat_messages.deleted_at  (timestamp NULL)
 *
 * GET            : 진단 (인증 불필요)
 * GET ?run=1     : 어드민 인증 후 실행 (멱등 — IF NOT EXISTS)
 * 호출 성공 후 → 파일 삭제 + schema 정의 활성화
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-chat-edit" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);

  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true,
      mode: "diagnostic",
      adds: [
        "chat_messages.edited_at (timestamp NULL)",
        "chat_messages.is_deleted (boolean NOT NULL DEFAULT false)",
        "chat_messages.deleted_at (timestamp NULL)",
      ],
      callExample: "GET /api/migrate-chat-edit?run=1 (어드민 로그인 필요)",
    }), { status: 200, headers: JSON_HEADER });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: String(e?.message).slice(0, 300) });
    }
  }

  await run("edited_at",  "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamp");
  await run("is_deleted", "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false");
  await run("deleted_at", "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamp");

  return new Response(
    JSON.stringify({ ok: true, results }, null, 2),
    { status: 200, headers: JSON_HEADER }
  );
};
