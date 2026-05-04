// netlify/functions/migrate-m19-1.ts
// ★ Phase M-19-1: 후원자 이탈 예측 시스템
// - members 테이블에 이탈 점수 필드 추가
// - 호출: GET /api/migrate-m19-1?key=siren-m19-1-2026
// - 호출 후 ★즉시 삭제 + push (보안)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m19-1-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. churn 관련 컬럼 5개 추가 ===== */
    await db.execute(sql`
      ALTER TABLE members
        ADD COLUMN IF NOT EXISTS churn_risk_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS churn_risk_level VARCHAR(20),
        ADD COLUMN IF NOT EXISTS churn_last_evaluated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS churn_signals JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS last_reengage_email_at TIMESTAMP
    `);
    results.step1_addColumns = "ok";

    /* ===== 2. 인덱스 ===== */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_members_churn_level 
        ON members(churn_risk_level) 
        WHERE churn_risk_level IS NOT NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_members_churn_score 
        ON members(churn_risk_score DESC)
    `);
    results.step2_indexes = "ok";

    /* ===== 3. 검증 ===== */
    const verify: any = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE churn_risk_score IS NOT NULL) AS "withScore",
        COUNT(*) AS "totalMembers"
      FROM members
    `);
    results.verify = (verify as any)?.rows?.[0] || (verify as any)?.[0] || null;

    return ok({
      migration: "m19-1",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-1 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-1]", err);
    return serverError("M-19-1 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-1" };