// netlify/functions/migrate-m8.ts
// ★ Phase M-8: board_posts + board_comments 테이블 + ENUM

import type { Context } from "@netlify/functions";
import postgres from "postgres";

export const config = { path: "/api/migrate-m8" };

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-m8-2026") {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const conn = process.env.NETLIFY_DATABASE_URL;
  if (!conn) {
    return new Response(JSON.stringify({ ok: false, error: "NETLIFY_DATABASE_URL not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const sql = postgres(conn, { max: 1, ssl: "require" });
  const log: string[] = [];

  try {
    /* ENUM */
    try {
      await sql`CREATE TYPE board_category AS ENUM ('general', 'share', 'question', 'info', 'etc')`;
      log.push("✅ ENUM board_category 생성");
    } catch (e: any) {
      if (e.code === "42710") log.push("ℹ️ ENUM board_category 이미 존재");
      else throw e;
    }

    /* board_posts */
    await sql`
      CREATE TABLE IF NOT EXISTS board_posts (
        id SERIAL PRIMARY KEY,
        post_no VARCHAR(30) NOT NULL UNIQUE,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        author_name VARCHAR(50) NOT NULL,
        category board_category NOT NULL DEFAULT 'general',
        title VARCHAR(200) NOT NULL,
        content_html TEXT NOT NULL,
        attachment_ids TEXT,
        views INTEGER NOT NULL DEFAULT 0,
        like_count INTEGER NOT NULL DEFAULT 0,
        comment_count INTEGER NOT NULL DEFAULT 0,
        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
        is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
        is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
        admin_memo TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS board_posts_post_no_idx ON board_posts(post_no)`;
    await sql`CREATE INDEX IF NOT EXISTS board_posts_member_idx ON board_posts(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS board_posts_category_idx ON board_posts(category)`;
    await sql`CREATE INDEX IF NOT EXISTS board_posts_pinned_idx ON board_posts(is_pinned)`;
    await sql`CREATE INDEX IF NOT EXISTS board_posts_hidden_idx ON board_posts(is_hidden)`;
    await sql`CREATE INDEX IF NOT EXISTS board_posts_created_idx ON board_posts(created_at DESC)`;
    log.push("✅ board_posts 테이블 생성");

    /* board_comments */
    await sql`
      CREATE TABLE IF NOT EXISTS board_comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        author_name VARCHAR(50) NOT NULL,
        content VARCHAR(1000) NOT NULL,
        parent_id INTEGER,
        is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
        is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS board_comments_post_idx ON board_comments(post_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS board_comments_member_idx ON board_comments(member_id)`;
    await sql`CREATE INDEX IF NOT EXISTS board_comments_parent_idx ON board_comments(parent_id)`;
    log.push("✅ board_comments 테이블 생성");

    await sql.end();

    return new Response(JSON.stringify({
      ok: true, message: "✅ Phase M-8 마이그레이션 완료", log,
    }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    await sql.end().catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: e.message, log, stack: e.stack }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
};