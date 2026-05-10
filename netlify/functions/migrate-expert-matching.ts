/**
 * GET /api/migrate-expert-matching
 *
 * 6순위 #8 — 1:1 매칭 채팅 1회용 마이그
 * - expert_matches 테이블 신설
 * - chat_rooms.room_type / expert_id 컬럼 추가
 * - 인덱스 4개 + 2개
 *
 * 호출: 어드민 로그인 후 주소창에
 *   https://tbfa-siren-cms.netlify.app/api/migrate-expert-matching?run=1
 *
 * 멱등 보장 (IF NOT EXISTS).
 * 호출 성공 후 메인 채팅이 schema 정의 활성화 + 본 파일 삭제.
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";

interface DiagRow {
  table: string;
  exists: boolean;
  columns: string[];
}

async function diagnose(): Promise<{
  expertMatchesExists: boolean;
  expertMatchesColumns: string[];
  chatRoomsHasRoomType: boolean;
  chatRoomsHasExpertId: boolean;
}> {
  const tableRes: any = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'expert_matches'
  `);
  const tableRows = Array.isArray(tableRes) ? tableRes : (tableRes as any).rows || [];
  const expertMatchesExists = tableRows.length > 0;

  let expertMatchesColumns: string[] = [];
  if (expertMatchesExists) {
    const colRes: any = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expert_matches'
      ORDER BY ordinal_position
    `);
    const colRows = Array.isArray(colRes) ? colRes : (colRes as any).rows || [];
    expertMatchesColumns = colRows.map((r: any) => String(r.column_name));
  }

  const chatColRes: any = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_rooms'
      AND column_name IN ('room_type','expert_id')
  `);
  const chatColRows = Array.isArray(chatColRes) ? chatColRes : (chatColRes as any).rows || [];
  const chatColNames = chatColRows.map((r: any) => String(r.column_name));

  return {
    expertMatchesExists,
    expertMatchesColumns,
    chatRoomsHasRoomType: chatColNames.includes("room_type"),
    chatRoomsHasExpertId: chatColNames.includes("expert_id"),
  };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET only" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 진단 모드 (인증 불필요) */
  if (!run) {
    try {
      const diag = await diagnose();
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "diagnose",
          message: "진단 모드. 적용하려면 ?run=1 (어드민 로그인 필요)",
          state: diag,
        }, null, 2),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          ok: false,
          step: "diagnose",
          detail: String(err?.message || err).slice(0, 500),
        }, null, 2),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } },
      );
    }
  }

  /* 적용 모드 — 어드민 인증 필수 */
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const startedAt = new Date();
  const before = await diagnose();
  const steps: { step: string; ok: boolean; detail?: string }[] = [];

  /* 1. expert_matches 테이블 */
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS expert_matches (
        id              serial PRIMARY KEY,
        user_id         int NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        expert_id       int REFERENCES members(id) ON DELETE SET NULL,
        match_type      varchar(20),
        source_domain   varchar(30),
        source_id       int,
        chat_room_id    int REFERENCES chat_rooms(id) ON DELETE SET NULL,
        status          varchar(20) NOT NULL DEFAULT 'pending',
        reason          text,
        admin_note      text,
        assigned_by     int REFERENCES admins(id),
        assigned_at     timestamp,
        closed_at       timestamp,
        closed_reason   varchar(50),
        created_at      timestamp NOT NULL DEFAULT now(),
        updated_at      timestamp NOT NULL DEFAULT now()
      )
    `);
    steps.push({ step: "create_expert_matches", ok: true });
  } catch (err: any) {
    steps.push({ step: "create_expert_matches", ok: false, detail: String(err?.message || err) });
  }

  /* 2. expert_matches 인덱스 */
  try {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS expert_matches_user_idx   ON expert_matches(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS expert_matches_expert_idx ON expert_matches(expert_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS expert_matches_status_idx ON expert_matches(status)`);
    steps.push({ step: "expert_matches_indexes", ok: true });
  } catch (err: any) {
    steps.push({ step: "expert_matches_indexes", ok: false, detail: String(err?.message || err) });
  }

  /* 3. chat_rooms.room_type 컬럼 */
  try {
    await db.execute(sql`
      ALTER TABLE chat_rooms
      ADD COLUMN IF NOT EXISTS room_type varchar(20) NOT NULL DEFAULT 'general'
    `);
    steps.push({ step: "chat_rooms_room_type", ok: true });
  } catch (err: any) {
    steps.push({ step: "chat_rooms_room_type", ok: false, detail: String(err?.message || err) });
  }

  /* 4. chat_rooms.expert_id 컬럼 */
  try {
    await db.execute(sql`
      ALTER TABLE chat_rooms
      ADD COLUMN IF NOT EXISTS expert_id int REFERENCES members(id) ON DELETE SET NULL
    `);
    steps.push({ step: "chat_rooms_expert_id", ok: true });
  } catch (err: any) {
    steps.push({ step: "chat_rooms_expert_id", ok: false, detail: String(err?.message || err) });
  }

  /* 5. chat_rooms 인덱스 */
  try {
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_rooms_room_type_idx ON chat_rooms(room_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_rooms_expert_idx    ON chat_rooms(expert_id)`);
    steps.push({ step: "chat_rooms_indexes", ok: true });
  } catch (err: any) {
    steps.push({ step: "chat_rooms_indexes", ok: false, detail: String(err?.message || err) });
  }

  const after = await diagnose();
  const completedAt = new Date();

  return new Response(
    JSON.stringify({
      ok: steps.every(s => s.ok),
      mode: "apply",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      before,
      after,
      steps,
      nextAction: "성공 시 메인 채팅에서 schema.ts 정의 활성화 + 본 파일 삭제",
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};

export const config = { path: "/api/migrate-expert-matching" };
