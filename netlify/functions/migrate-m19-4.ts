// netlify/functions/migrate-m19-4.ts
// ★ Phase M-19-4: 회원 등급 시스템
// - member_tier ENUM 추가 (seed/sprout/tree/forest/land)
// - members 테이블에 tier/tier_score/previous_tier/tier_updated_at 추가
// - 호출: GET /api/migrate-m19-4?key=siren-m19-4-2026
// - 호출 후 ★즉시 삭제 + push (보안)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m19-4-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. ENUM 생성 ===== */
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE member_tier AS ENUM ('seed', 'sprout', 'tree', 'forest', 'land');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    results.step1_enum = "ok";

    /* ===== 2. 컬럼 추가 ===== */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS tier member_tier DEFAULT 'seed' NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS tier_score INTEGER DEFAULT 0 NOT NULL
    `);
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS previous_tier member_tier
    `);
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMP
    `);
    results.step2_columns = "ok";

    /* ===== 3. 인덱스 ===== */
    await db.execute(sql`CREATE INDEX IF NOT EXISTS members_tier_idx ON members(tier)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS members_tier_score_idx ON members(tier_score DESC)`);
    results.step3_indexes = "ok";

    /* ===== 4. 기존 회원 일괄 산정 (현재 totalDonationAmount 기준) ===== */
    /* totalDonationAmount 컬럼은 M-19-1에서 추가됨 */
    const seedRow: any = await db.execute(sql`
      UPDATE members SET
        tier_score = COALESCE(total_donation_amount, 0),
        tier = CASE
          WHEN COALESCE(total_donation_amount, 0) >= 5000000 THEN 'land'::member_tier
          WHEN COALESCE(total_donation_amount, 0) >= 2000000 THEN 'forest'::member_tier
          WHEN COALESCE(total_donation_amount, 0) >= 500000 THEN 'tree'::member_tier
          WHEN COALESCE(total_donation_amount, 0) >= 100000 THEN 'sprout'::member_tier
          ELSE 'seed'::member_tier
        END,
        tier_updated_at = NOW()
      WHERE status != 'withdrawn'
    `);
    results.step4_initial_calc = {
      rowCount: (seedRow as any)?.rowCount ?? "n/a",
    };

    /* ===== 5. 검증 ===== */
    const verifyRow: any = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE tier = 'seed')::int AS "seedCount",
        COUNT(*) FILTER (WHERE tier = 'sprout')::int AS "sproutCount",
        COUNT(*) FILTER (WHERE tier = 'tree')::int AS "treeCount",
        COUNT(*) FILTER (WHERE tier = 'forest')::int AS "forestCount",
        COUNT(*) FILTER (WHERE tier = 'land')::int AS "landCount",
        COUNT(*) FILTER (WHERE tier IS NOT NULL)::int AS "totalAssigned"
      FROM members
      WHERE status != 'withdrawn'
    `);
    const v: any = (verifyRow as any).rows ? (verifyRow as any).rows[0] : (verifyRow as any)[0] || {};
    results.verify = {
      seed: Number(v.seedCount || 0),
      sprout: Number(v.sproutCount || 0),
      tree: Number(v.treeCount || 0),
      forest: Number(v.forestCount || 0),
      land: Number(v.landCount || 0),
      total: Number(v.totalAssigned || 0),
    };

    return ok({
      migration: "m19-4",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-4 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-4]", err);
    return serverError("M-19-4 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-4" };