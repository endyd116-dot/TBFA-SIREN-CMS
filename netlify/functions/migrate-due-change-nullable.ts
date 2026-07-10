// netlify/functions/migrate-due-change-nullable.ts
// [감사#97 / P2-30] 1회용 마이그레이션 — task_due_change_requests.current_due NOT NULL 해제
//   마감일이 없는 지시 카드에서 '마감일 변경 요청' 시 current_due=NULL INSERT가 NOT NULL 위반으로 500.
//   호출: 어드민 로그인 상태에서 https://tbfa.co.kr/api/migrate-due-change-nullable?run=1
//   GET(기본): 진단(인증 불필요) / GET ?run=1: requireAdmin 후 실제 실행. 성공 후 파일 삭제.
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/migrate-due-change-nullable" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  // 진단 — 현재 컬럼 nullable 여부 조회 (인증 불필요)
  let isNullable: string | null = null;
  try {
    const r: any = await db.execute(sql`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'task_due_change_requests' AND column_name = 'current_due'
    `);
    isNullable = String((r?.rows ?? r ?? [])[0]?.is_nullable ?? "");
  } catch (e: any) {
    return json(500, { ok: false, step: "diagnose", detail: String(e?.message || e) });
  }

  if (!run) {
    return json(200, {
      ok: true, mode: "diagnostic",
      currentDueNullable: isNullable,
      hint: isNullable === "YES" ? "이미 nullable — 실행 불필요" : "?run=1 로 실행하면 NOT NULL 해제",
    });
  }

  // 실행 — 어드민 인증 필요
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  try {
    await db.execute(sql`ALTER TABLE task_due_change_requests ALTER COLUMN current_due DROP NOT NULL`);
    return json(200, { ok: true, mode: "run", message: "current_due NOT NULL 해제 완료", before: isNullable, after: "YES" });
  } catch (e: any) {
    return json(500, { ok: false, step: "alter", detail: String(e?.message || e) });
  }
};

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
