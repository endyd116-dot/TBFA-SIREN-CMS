/**
 * ⚠️ 일회용 마이그레이션 — STEP G-1
 * 채팅 시스템 테이블 4개 생성
 *
 * 사용:
 *   GET /api/migrate-step-g1?key=siren-migrate-2026-g1
 *
 * ⚠️ 사용 후 즉시 삭제!
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ok, badRequest, serverError, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-migrate-2026-g1";

export default async (req: Request) => {
  if (req.method !== "GET") return methodNotAllowed();

  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== MIGRATION_KEY) return badRequest("Invalid migration key");

  try {
    const results: string[] = [];

    /* 1. chat_rooms — 채팅방 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_rooms (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        category varchar(30) NOT NULL DEFAULT 'support_other',
        title varchar(200),
        status varchar(20) NOT NULL DEFAULT 'active',
        last_message_at timestamp DEFAULT now(),
        last_message_preview varchar(200),
        unread_for_admin integer DEFAULT 0,
        unread_for_user integer DEFAULT 0,
        admin_memo text,
        closed_at timestamp,
        closed_by integer REFERENCES members(id) ON DELETE SET NULL,
        archived_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    results.push("✅ chat_rooms table created");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_rooms_member_idx ON chat_rooms(member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_rooms_status_idx ON chat_rooms(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_rooms_last_msg_idx ON chat_rooms(last_message_at DESC)`);
    results.push("✅ chat_rooms indexes created");

    /* 2. chat_messages — 메시지 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id serial PRIMARY KEY,
        room_id integer NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
        sender_id integer NOT NULL REFERENCES members(id) ON DELETE SET NULL,
        sender_role varchar(20) NOT NULL DEFAULT 'user',
        message_type varchar(20) NOT NULL DEFAULT 'text',
        content text,
        attachment_id integer,
        is_read boolean DEFAULT false,
        read_at timestamp,
        is_system boolean DEFAULT false,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    results.push("✅ chat_messages table created");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_messages_room_idx ON chat_messages(room_id, created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_messages_sender_idx ON chat_messages(sender_id)`);
    results.push("✅ chat_messages indexes created");

    /* 3. chat_attachments — 첨부파일 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_attachments (
        id serial PRIMARY KEY,
        room_id integer NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
        uploader_id integer REFERENCES members(id) ON DELETE SET NULL,
        blob_key varchar(255) NOT NULL,
        original_name varchar(255),
        mime_type varchar(100),
        file_size integer,
        thumbnail_key varchar(255),
        width integer,
        height integer,
        expires_at timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    results.push("✅ chat_attachments table created");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_attachments_room_idx ON chat_attachments(room_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_attachments_expires_idx ON chat_attachments(expires_at)`);
    results.push("✅ chat_attachments indexes created");

    /* 4. chat_blacklist — 블랙리스트 */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_blacklist (
        id serial PRIMARY KEY,
        member_id integer NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
        reason text NOT NULL,
        blocked_by integer NOT NULL REFERENCES members(id) ON DELETE SET NULL,
        blocked_at timestamp NOT NULL DEFAULT now(),
        unblocked_at timestamp,
        unblocked_by integer REFERENCES members(id) ON DELETE SET NULL,
        is_active boolean DEFAULT true
      )
    `);
    results.push("✅ chat_blacklist table created");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_blacklist_member_idx ON chat_blacklist(member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_blacklist_active_idx ON chat_blacklist(is_active)`);
    results.push("✅ chat_blacklist indexes created");

    /* 5. 검증 */
    const tables: any = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('chat_rooms', 'chat_messages', 'chat_attachments', 'chat_blacklist')
      ORDER BY table_name
    `);

    return ok({
      success: true,
      results,
      verification: tables,
      message: "STEP G-1 마이그레이션 완료! 함수 파일을 삭제하세요.",
    }, "Migration STEP G-1 completed");
  } catch (err: any) {
    console.error("[migrate-step-g1]", err);
    return serverError("마이그레이션 실패", {
      message: err?.message || String(err),
    });
  }
};

export const config = { path: "/api/migrate-step-g1" };