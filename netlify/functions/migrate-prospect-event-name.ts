/**
 * 1회용 마이그레이션 — members 테이블에 예비 후원자의 캠페인·이벤트 구분 컬럼 추가
 *  - prospect_event_name VARCHAR(150) NULL  (예: "2026 봄 캠페인", "5월 기부 행사")
 *  - prospect_entry_path VARCHAR(50)  NULL  (예: "event", "referral", "social")
 *
 * 예비 후원자가 어떤 캠페인·이벤트로 들어왔는지 화면에서 구분하기 위함.
 *
 * GET ?run=1 : 어드민 인증 후 실행
 * GET 만     : 진단 모드 (인증 불필요)
 */

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-prospect-event-name" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("run")) {
    return new Response(JSON.stringify({
      ok: true, mode: "diagnostic",
      adds: ["members.prospect_event_name VARCHAR(150) NULL",
             "members.prospect_entry_path VARCHAR(50) NULL"],
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

  await run("prospect_event_name",
    "ALTER TABLE members ADD COLUMN IF NOT EXISTS prospect_event_name VARCHAR(150)");
  await run("prospect_entry_path",
    "ALTER TABLE members ADD COLUMN IF NOT EXISTS prospect_entry_path VARCHAR(50)");

  return new Response(JSON.stringify({ ok: true, results }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};
