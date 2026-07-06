/**
 * GET /api/migrate-door-command        — 진단 (인증 불필요·readonly)
 * GET /api/migrate-door-command?run=1  — 실행 (어드민 인증)
 *
 * 출입문 자동 개폐(ON 이식)용 감사 테이블 door_command 생성.
 *   근태 출근/복귀·수동 문열기·관리자 원격 개방 시 도어 어댑터 호출 결과를 적재.
 *
 * 멱등: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
 * 호출 성공 후 즉시 파일 삭제 + commit (§6.8).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/migrate-door-command" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "diag";
    const existing: any = await db.execute(sql.raw(`
      SELECT to_regclass('public.door_command') AS tbl
    `));
    const rows = existing?.rows ?? existing ?? [];
    const already = !!rows[0]?.tbl;

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        door_command_exists: already,
        hint: already
          ? "이미 생성됨. 재실행해도 안전(IF NOT EXISTS)."
          : "?run=1 로 실행하면 door_command 테이블이 생성됩니다.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "create_table";
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS door_command (
        id            SERIAL PRIMARY KEY,
        trigger_type  VARCHAR(20)  NOT NULL,
        trigger_id    INTEGER,
        member_uid    VARCHAR(64),
        adapter       VARCHAR(20)  NOT NULL,
        gate_id       VARCHAR(40)  NOT NULL DEFAULT 'main',
        request       JSONB,
        response      JSONB,
        ok            BOOLEAN      NOT NULL DEFAULT false,
        at            TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `));

    step = "create_index";
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS door_command_at_idx ON door_command (at)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS door_command_trigger_idx ON door_command (trigger_type)`));

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      created: !already,
      hint: "door_command 생성 완료. 성공 확인 후 이 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADER });
  }
}
