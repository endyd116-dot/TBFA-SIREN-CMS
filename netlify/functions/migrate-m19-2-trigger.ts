// netlify/functions/migrate-m19-2-trigger.ts
// ★ Phase M-19-2 STEP 12: donations → campaigns 자동 동기화 트리거
// - donations INSERT/UPDATE/DELETE 시 campaigns.raised_amount / donor_count 자동 갱신
// - status='completed'인 후원만 집계
// - 호출: GET /api/migrate-m19-2-trigger?key=siren-m19-2-trigger-2026
// - 호출 후 ★즉시 삭제 + push (보안)

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { ok, badRequest, forbidden, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const MIGRATION_KEY = "siren-m19-2-trigger-2026";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) return badRequest("key 파라미터가 필요합니다");
    if (key !== MIGRATION_KEY) return forbidden("invalid key");

    const results: any = {};

    /* ===== 1. 트리거 함수 생성 ===== */
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION update_campaign_stats() RETURNS TRIGGER AS $$
      DECLARE
        target_campaign_id INTEGER;
      BEGIN
        /* INSERT/UPDATE/DELETE 모두 처리 */
        IF (TG_OP = 'DELETE') THEN
          target_campaign_id := OLD.campaign_id;
        ELSE
          target_campaign_id := NEW.campaign_id;
          IF (TG_OP = 'UPDATE' AND OLD.campaign_id IS NOT NULL AND OLD.campaign_id <> COALESCE(NEW.campaign_id, -1)) THEN
            /* 캠페인이 바뀌면 이전 캠페인도 갱신 */
            PERFORM update_campaign_stats_recalc(OLD.campaign_id);
          END IF;
        END IF;

        IF target_campaign_id IS NOT NULL THEN
          PERFORM update_campaign_stats_recalc(target_campaign_id);
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
    results.step1_func_main = "ok";

    /* ===== 2. 재계산 함수 ===== */
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION update_campaign_stats_recalc(p_campaign_id INTEGER) RETURNS VOID AS $$
      BEGIN
        UPDATE campaigns SET
          raised_amount = COALESCE((
            SELECT SUM(amount)::int
              FROM donations
             WHERE campaign_id = p_campaign_id
               AND status = 'completed'
          ), 0),
          donor_count = COALESCE((
            SELECT COUNT(DISTINCT COALESCE(member_id, 0))::int
              FROM donations
             WHERE campaign_id = p_campaign_id
               AND status = 'completed'
          ), 0),
          updated_at = NOW()
        WHERE id = p_campaign_id;
      END;
      $$ LANGUAGE plpgsql;
    `);
    results.step2_func_recalc = "ok";

    /* ===== 3. 트리거 등록 ===== */
    await db.execute(sql`DROP TRIGGER IF EXISTS donations_campaign_stats_sync ON donations`);
    await db.execute(sql`
      CREATE TRIGGER donations_campaign_stats_sync
      AFTER INSERT OR UPDATE OF amount, status, campaign_id, member_id OR DELETE
      ON donations
      FOR EACH ROW
      EXECUTE FUNCTION update_campaign_stats();
    `);
    results.step3_trigger = "ok";

    /* ===== 4. 기존 데이터 1회 재계산 (있으면) ===== */
    const existingCampaigns: any = await db.execute(sql`
      SELECT id FROM campaigns
    `);
    const rows = (existingCampaigns as any).rows || (existingCampaigns as any) || [];
    let recalcCount = 0;
    for (const r of rows) {
      try {
        await db.execute(sql`SELECT update_campaign_stats_recalc(${r.id})`);
        recalcCount++;
      } catch (_) {}
    }
    results.step4_recalc_existing = { processed: recalcCount, total: rows.length };

    /* ===== 5. 검증 ===== */
    const verifyResult: any = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE tgname = 'donations_campaign_stats_sync')::int AS "triggerExists"
        FROM pg_trigger
       WHERE NOT tgisinternal
    `);
    const v: any = (verifyResult as any).rows ? (verifyResult as any).rows[0] : (verifyResult as any)[0] || {};
    results.verify = { triggerExists: Number(v.triggerExists || 0) > 0 };

    return ok({
      migration: "m19-2-trigger",
      ...results,
      reminder: "★ 호출 성공 후 즉시 이 파일을 삭제하고 push하세요",
    }, "M-19-2 트리거 마이그레이션 완료");
  } catch (err: any) {
    console.error("[migrate-m19-2-trigger]", err);
    return serverError("M-19-2 트리거 마이그레이션 실패", err?.message || String(err));
  }
};

export const config = { path: "/api/migrate-m19-2-trigger" };