// netlify/functions/migrate-phase2-card-expiry.ts
// ★ Phase 2 Step 4-A: billing_keys.card_expiry_month 컬럼 추가

import { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = {
  path: "/migrate-phase2-card-expiry",
};

const MIGRATION_KEY = "siren-phase2-cardexpiry-20260508";

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");

    if (key !== MIGRATION_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid key" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const results: string[] = [];

    // billing_keys.card_expiry_month 추가 (YYMM 형식, 예: "2712")
    await db.execute(sql.raw(
      `ALTER TABLE billing_keys ADD COLUMN IF NOT EXISTS card_expiry_month VARCHAR(10)`
    ));
    results.push(`✅ billing_keys.card_expiry_month 추가`);

    // 인덱스 추가 (만료 예정자 조회용)
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_billing_keys_card_expiry ON billing_keys(card_expiry_month) WHERE is_active = true`
    ));
    results.push(`✅ idx_billing_keys_card_expiry 생성`);

    // 검증
    const verify: any = await db.execute(sql.raw(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'billing_keys' AND column_name = 'card_expiry_month'
    `));
    const verifyRows = Array.isArray(verify) ? verify : (verify as any).rows || [];
    results.push(`🔍 검증: ${verifyRows.length}/1 컬럼`);

    return new Response(
      JSON.stringify({
        ok: true,
        phase: "Phase 2 Step 4-A - card_expiry_month",
        results,
      }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[migrate-phase2-card-expiry] 실패:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error?.message || "unknown",
        stack: error?.stack,
      }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
