/**
 * GET /api/migrate-task-duedate-nullable        — 진단 (인증 불필요)
 * GET /api/migrate-task-duedate-nullable?run=1  — 실행 (어드민 인증)
 *
 * workspace_tasks.due_date NOT NULL 제약 해제 → 마감일 없는 카드(개인 기록·보관용) 허용.
 * 멱등: 이미 nullable이면 안전(무동작). 호출 성공 후 파일 삭제 + commit (§6.8).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-task-duedate-nullable" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const chk: any = await db.execute(sql.raw(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'workspace_tasks' AND column_name = 'due_date'
    `));
    const rows = chk?.rows ?? chk ?? [];
    const nullable = rows[0]?.is_nullable === "YES";

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        due_date_nullable: nullable,
        hint: nullable ? "이미 nullable. 재실행 안전." : "?run=1 로 NOT NULL 제약을 해제합니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "alter";
    await db.execute(sql.raw(`ALTER TABLE workspace_tasks ALTER COLUMN due_date DROP NOT NULL`));

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      changed: !nullable,
      hint: "due_date NOT NULL 해제 완료. 마감일 없는 카드 생성 가능. 성공 확인 후 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
}
