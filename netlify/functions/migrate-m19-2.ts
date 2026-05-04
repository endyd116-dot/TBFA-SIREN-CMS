// netlify/functions/migrate-m19-2.ts
// ★ Phase M-19-2: 캠페인 관리 시스템
// - campaigns 테이블 신규 생성
// - donations.campaign_id 컬럼 추가 (campaign_tag 병행 유지)
// - 호출: GET /api/migrate-m19-2?key=siren-m19-2-2026
// - 호출 후 ★즉시 삭제 + push (보안)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m19-2-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. campaign_type ENUM ===== */
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE campaign_type AS ENUM ('fundraising', 'memorial', 'awareness');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    results.step1_enum = "ok";

    /* ===== 2. campaigns 테이블 ===== */
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) NOT NULL UNIQUE,
        type campaign_type NOT NULL DEFAULT 'fundraising',
        title VARCHAR(200) NOT NULL,
        summary VARCHAR(500),
        content_html TEXT,
        thumbnail_blob_id INTEGER,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        goal_amount INTEGER,
        raised_amount INTEGER DEFAULT 0 NOT NULL,
        donor_count INTEGER DEFAULT 0 NOT NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        is_published BOOLEAN DEFAULT false NOT NULL,
        is_pinned BOOLEAN DEFAULT false NOT NULL,
        sort_order INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0 NOT NULL,
        last_slump_alert_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      )
    `);
    results.step2_campaigns = "ok";

    /* ===== 3. campaigns 인덱스 ===== */
    await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_slug_idx ON campaigns(slug)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_type_idx ON campaigns(type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_published_idx ON campaigns(is_published)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_pinned_idx ON campaigns(is_pinned)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS campaigns_dates_idx ON campaigns(start_date, end_date)`);
    results.step3_indexes = "ok";

    /* ===== 4. donations.campaign_id 컬럼 추가 ===== */
    await db.execute(sql`
      ALTER TABLE donations
        ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS donations_campaign_id_idx ON donations(campaign_id)
    `);
    results.step4_donations_campaign_id = "ok";

    /* ===== 5. 검증 ===== */
    const verifyTable: any = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaigns') AS "campaignsTable",
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='donations' AND column_name='campaign_id') AS "campaignIdCol"
    `);
    results.verify = (verifyTable as any).rows ? (verifyTable as any).rows[0] : (verifyTable as any)[0] || null;

    return ok({
      migration: "m19-2",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-2 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-2]", err);
    return serverError("M-19-2 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-2" };