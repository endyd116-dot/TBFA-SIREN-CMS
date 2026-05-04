// netlify/functions/migrate-m15.ts
// ★ Phase M-15 — 1회용 마이그레이션
// - members.assigned_categories (JSONB) 추가
// - 기존 운영자(type=admin)에게 ['all'] 자동 부여
// - donation_policies에 min_amount / max_amount 추가
//
// 호출: GET /api/migrate-m15?key=siren-m15-2026
// 호출 후 ★즉시 이 파일 삭제 + push (보안)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m15-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. members.assigned_categories 추가 ===== */
    await db.execute(sql`
      ALTER TABLE members 
        ADD COLUMN IF NOT EXISTS assigned_categories JSONB DEFAULT '[]'::jsonb
    `);
    results.step1_addColumn = "ok";

    /* ===== 2. 기존 운영자에게 ['all'] 부여 ===== */
    const upd: any = await db.execute(sql`
      UPDATE members 
         SET assigned_categories = '["all"]'::jsonb 
       WHERE type = 'admin' 
         AND (assigned_categories IS NULL OR assigned_categories = '[]'::jsonb)
    `);
    results.step2_seedExistingAdmins = {
      rowCount: (upd as any)?.rowCount ?? (upd as any)?.count ?? "n/a",
    };

    /* ===== 3. GIN 인덱스 ===== */
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_members_assigned_categories 
        ON members USING gin(assigned_categories)
    `);
    results.step3_ginIndex = "ok";

    /* ===== 4. donation_policies.min_amount / max_amount ===== */
    await db.execute(sql`
      ALTER TABLE donation_policies 
        ADD COLUMN IF NOT EXISTS min_amount INTEGER DEFAULT 1000
    `);
    await db.execute(sql`
      ALTER TABLE donation_policies 
        ADD COLUMN IF NOT EXISTS max_amount INTEGER DEFAULT 100000000
    `);
    results.step4_donationPolicyLimits = "ok";

    /* ===== 5. 검증 ===== */
    const verifyMembers: any = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE type = 'admin') AS total_admins,
        COUNT(*) FILTER (WHERE type = 'admin' AND assigned_categories @> '["all"]'::jsonb) AS admins_with_all
      FROM members
    `);
    const verifyPolicy: any = await db.execute(sql`
      SELECT min_amount, max_amount FROM donation_policies WHERE id = 1 LIMIT 1
    `);

    results.verify = {
      members: (verifyMembers as any)?.rows?.[0] || (verifyMembers as any)?.[0] || null,
      policy: (verifyPolicy as any)?.rows?.[0] || (verifyPolicy as any)?.[0] || null,
    };

    return ok({
      migration: "m15",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요 (보안)",
    }, "M-15 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m15]", err);
    return serverError("M-15 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m15" };