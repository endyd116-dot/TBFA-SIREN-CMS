// netlify/functions/migrate-add-banner-campaign-key.ts
// ★ 1회용 마이그레이션 — Phase B Step 6-G
// home.specialBanner.linkedCampaignId 키 1개 추가
// 호출 후 즉시 삭제

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";

const MIGRATE_KEY = "siren-add-banner-campaign-v10";

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("key") !== MIGRATE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403, headers: { "content-type": "application/json" },
      });
    }

    /* 이미 있으면 중단 */
    const existsRes: any = await db.execute(sql`
      SELECT key FROM site_settings WHERE key = 'home.specialBanner.linkedCampaignId'
    `);
    const exists = Array.isArray(existsRes) ? existsRes : (existsRes?.rows || []);
    if (exists.length > 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "이미 키가 존재함 (재실행 차단)" }, null, 2),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    }

    await db.execute(sql`
      INSERT INTO site_settings
        (scope, key, value_type, value_text, has_draft, sort_order, is_active, updated_at)
      VALUES
        ('home', 'home.specialBanner.linkedCampaignId', 'text', NULL,
         false, 57, true, NOW())
    `);

    const afterRes: any = await db.execute(sql`
      SELECT key, scope, value_type, value_text, sort_order
      FROM site_settings
      WHERE key = 'home.specialBanner.linkedCampaignId'
    `);
    const after = Array.isArray(afterRes) ? afterRes : (afterRes?.rows || []);

    return new Response(
      JSON.stringify({ ok: true, message: "키 추가 완료", row: after[0] || null }, null, 2),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};