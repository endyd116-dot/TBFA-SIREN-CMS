/**
 * 1회용: 파일함 3 테이블 생성
 * 호출: /migrate-workspace-files?key=SIREN-FILES-2026
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "SIREN-FILES-2026") {
    return new Response(JSON.stringify({ ok: false, error: "Invalid key" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const results: any[] = [];

    // 1) workspace_folders
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_folders (
        id SERIAL PRIMARY KEY,
        parent_id INTEGER,
        name VARCHAR(200) NOT NULL,
        owner_id INTEGER NOT NULL,
        path VARCHAR(500),
        depth INTEGER NOT NULL DEFAULT 0,
        is_shared BOOLEAN NOT NULL DEFAULT false,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);
    results.push("workspace_folders 생성");

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ws_folders_parent_name_unique
      ON workspace_folders (parent_id, name)
      WHERE deleted_at IS NULL
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_folders_owner_idx ON workspace_folders (owner_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_folders_path_idx ON workspace_folders (path)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_folders_deleted_idx ON workspace_folders (deleted_at)`);
    results.push("workspace_folders 인덱스 4개");

    // 2) workspace_files
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_files (
        id SERIAL PRIMARY KEY,
        folder_id INTEGER,
        owner_id INTEGER NOT NULL,
        name VARCHAR(300) NOT NULL,
        r2_key VARCHAR(500) NOT NULL,
        size_bytes BIGINT,
        mime_type VARCHAR(100),
        ext VARCHAR(20),
        sha256 VARCHAR(64),
        upload_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        download_count INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_shared BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);
    results.push("workspace_files 생성");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_files_folder_idx ON workspace_files (folder_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_files_owner_idx ON workspace_files (owner_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_files_sha256_idx ON workspace_files (sha256)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_files_deleted_idx ON workspace_files (deleted_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_files_name_idx ON workspace_files (name)`);
    results.push("workspace_files 인덱스 5개");

    // 3) workspace_file_shares
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_file_shares (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(10) NOT NULL,
        target_id INTEGER NOT NULL,
        shared_by INTEGER NOT NULL,
        shared_with INTEGER,
        permission VARCHAR(10) NOT NULL DEFAULT 'view',
        expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    results.push("workspace_file_shares 생성");

    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_fshare_target_idx ON workspace_file_shares (target_type, target_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ws_fshare_with_idx ON workspace_file_shares (shared_with)`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ws_fshare_unique
      ON workspace_file_shares (target_type, target_id, shared_with)
    `);
    results.push("workspace_file_shares 인덱스 3개");

    // 검증
    const verify: any = await db.execute(sql`
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_name=t.table_name) AS col_count
      FROM information_schema.tables t
      WHERE table_schema='public' AND table_name IN ('workspace_folders','workspace_files','workspace_file_shares')
      ORDER BY table_name
    `);
    const tables = Array.isArray(verify) ? verify : (verify as any).rows || [];

    return new Response(JSON.stringify({ 
      ok: true, 
      message: "파일함 마이그레이션 완료",
      steps: results,
      tables
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    console.error("[migrate-workspace-files]", err);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: err.message,
      stack: err.stack
    }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = { path: "/migrate-workspace-files" };
