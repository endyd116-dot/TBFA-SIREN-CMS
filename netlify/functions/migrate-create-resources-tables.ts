// netlify/functions/migrate-create-resources-tables.ts
// ★ 1회용 마이그레이션 — 호출 후 즉시 삭제
//
// 호출:
//   /migrate-create-resources-tables?key=siren-resources-2026
//   또는
//   /.netlify/functions/migrate-create-resources-tables?key=siren-resources-2026
//
// dryRun 옵션:
//   ?key=...&dryRun=1  (실행 전 검사만)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, serverError } from "../../lib/response";

const MIGRATION_KEY = "siren-resources-tables-2026";

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== MIGRATION_KEY) {
      return badRequest("invalid key");
    }
    const dryRun = url.searchParams.get("dryRun") === "1";

    const log: string[] = [];
    log.push(`[migrate-create-resources-tables] start (dryRun=${dryRun})`);

    /* 1. enum 타입 (없으면 생성) */
    log.push("Step 1: resource_access_level enum");
    if (!dryRun) {
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE resource_access_level AS ENUM ('public', 'members_only', 'private');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      log.push("  ✓ enum 생성 또는 이미 존재");
    }

    /* 2. resource_categories 테이블 */
    log.push("Step 2: resource_categories 테이블");
    if (!dryRun) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS resource_categories (
          id SERIAL PRIMARY KEY,
          code VARCHAR(50) NOT NULL UNIQUE,
          name_ko VARCHAR(100) NOT NULL,
          description VARCHAR(300),
          icon VARCHAR(10),
          sort_order INTEGER DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resource_categories_code_idx ON resource_categories(code)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resource_categories_active_idx ON resource_categories(is_active, sort_order)`);
      log.push("  ✓ resource_categories + 2개 인덱스 생성 완료");
    }

    /* 3. resources 테이블 */
    log.push("Step 3: resources 테이블");
    if (!dryRun) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS resources (
          id SERIAL PRIMARY KEY,
          category_id INTEGER REFERENCES resource_categories(id) ON DELETE SET NULL,
          title VARCHAR(200) NOT NULL,
          slug VARCHAR(100) UNIQUE,
          description TEXT,
          content_html TEXT,
          file_blob_id INTEGER,
          thumbnail_blob_id INTEGER,
          access_level resource_access_level NOT NULL DEFAULT 'public',
          tags JSONB DEFAULT '[]'::jsonb,
          download_count INTEGER NOT NULL DEFAULT 0,
          views INTEGER NOT NULL DEFAULT 0,
          is_published BOOLEAN NOT NULL DEFAULT true,
          is_pinned BOOLEAN NOT NULL DEFAULT false,
          sort_order INTEGER DEFAULT 0,
          published_at TIMESTAMP DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resources_category_idx ON resources(category_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resources_slug_idx ON resources(slug)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resources_access_idx ON resources(access_level)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resources_published_idx ON resources(is_published)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resources_pinned_idx ON resources(is_pinned)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS resources_created_idx ON resources(created_at)`);
      log.push("  ✓ resources + 6개 인덱스 생성 완료");
    }

    /* 4. 기본 카테고리 5개 시드 (중복 시 skip) */
    log.push("Step 4: 기본 카테고리 시드");
    if (!dryRun) {
      const cats = [
        { code: "notice",  nameKo: "공지사항",   icon: "📢", sortOrder: 10 },
        { code: "manual",  nameKo: "안내자료",   icon: "📘", sortOrder: 20 },
        { code: "form",    nameKo: "양식/서식",  icon: "📋", sortOrder: 30 },
        { code: "report",  nameKo: "활동보고서", icon: "📊", sortOrder: 40 },
        { code: "etc",     nameKo: "기타자료",   icon: "📁", sortOrder: 50 },
      ];
      for (const c of cats) {
        await db.execute(sql`
          INSERT INTO resource_categories (code, name_ko, icon, sort_order, is_active)
          VALUES (${c.code}, ${c.nameKo}, ${c.icon}, ${c.sortOrder}, true)
          ON CONFLICT (code) DO NOTHING
        `);
      }
      log.push("  ✓ 5개 카테고리 시드 완료 (중복 시 skip)");
    }

    /* 5. 검증 */
    log.push("Step 5: 검증");
    const tableRes: any = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('resources', 'resource_categories')
      ORDER BY table_name
    `);
    const tables = (tableRes.rows || tableRes || []).map((r: any) => r.table_name);
    log.push(`  ✓ 존재하는 테이블: ${tables.join(", ")}`);

    const countRes: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM resource_categories`);
    const cntRow = countRes.rows ? countRes.rows[0] : countRes[0];
    log.push(`  ✓ resource_categories 행 수: ${cntRow?.c ?? 0}`);

    const resCountRes: any = await db.execute(sql`SELECT COUNT(*)::int AS c FROM resources`);
    const resCntRow = resCountRes.rows ? resCountRes.rows[0] : resCountRes[0];
    log.push(`  ✓ resources 행 수: ${resCntRow?.c ?? 0}`);

    return ok({
      success: true,
      dryRun,
      log,
      tables,
    });
  } catch (err: any) {
    console.error("[migrate-create-resources-tables]", err);
    return serverError("마이그레이션 실패", err?.message);
  }
};

export const config = { path: "/migrate-create-resources-tables" };