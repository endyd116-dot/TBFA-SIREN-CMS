// netlify/functions/migrate-m14-fix.ts
// ★ M-14 핫픽스: donation_policies.stamp_blob_id 컬럼 추가 (누락된 마이그레이션 복구)
// - 호출: GET /api/migrate-m14-fix?key=siren-m14-fix-2026
// - 호출 후 ★즉시 삭제 + push (보안)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m14-fix-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. donation_policies.stamp_blob_id 추가 ===== */
    await db.execute(sql`
      ALTER TABLE donation_policies
        ADD COLUMN IF NOT EXISTS stamp_blob_id INTEGER
    `);
    results.step1_donation_policies_stamp = "ok";

    /* ===== 2. donations.receipt_blob_id 확인/추가 (M-14에서 같이 추가됨) ===== */
    await db.execute(sql`
      ALTER TABLE donations
        ADD COLUMN IF NOT EXISTS receipt_blob_id INTEGER
    `);
    results.step2_donations_receipt = "ok";

    /* ===== 3. 검증 ===== */
    const verifyResult: any = await db.execute(sql`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name='donation_policies' AND column_name='stamp_blob_id'
        ) AS "stampCol",
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name='donations' AND column_name='receipt_blob_id'
        ) AS "receiptCol"
    `);
    const v: any = verifyResult.rows ? verifyResult.rows[0] : verifyResult[0] || {};
    results.verify = {
      donationPolicies_stampBlobId: v.stampCol === true,
      donations_receiptBlobId: v.receiptCol === true,
    };

    return ok({
      migration: "m14-fix",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요 (보안)",
    }, "M-14 누락 컬럼 복구 완료");
  } catch (err: any) {
    console.error("[migrate-m14-fix]", err);
    return serverError("M-14 핫픽스 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m14-fix" };