/**
 * 1회용 마이그레이션 — communication_send_jobs.excluded_member_ids JSONB 컬럼 추가
 * 새 발송 만들기 미리보기에서 사용자가 체크 해제한 회원 ID 배열 저장.
 * cron 발송 시 그룹 resolve 결과에서 이 ID들을 빼고 보냄.
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-send-job-excluded" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      adds: ["communication_send_jobs.excluded_member_ids JSONB DEFAULT '[]'::jsonb"],
    }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  const results: { step: string; result: string }[] = [];
  async function run(step: string, ddl: string) {
    try {
      await db.execute(sql.raw(ddl));
      results.push({ step, result: "ok" });
    } catch (e: any) {
      results.push({ step, result: String(e?.message).slice(0, 200) });
    }
  }

  await run("excluded_member_ids",
    `ALTER TABLE communication_send_jobs
     ADD COLUMN IF NOT EXISTS excluded_member_ids JSONB DEFAULT '[]'::jsonb`);

  return new Response(JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
