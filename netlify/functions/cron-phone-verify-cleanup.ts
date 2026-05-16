/**
 * Scheduled — 만료된 phone_verifications row 자동 삭제
 *
 * 매일 KST 새벽 3시(UTC 18:00) 실행. 인증 코드 만료 후에도 row가 남으면
 * DB가 누적·rate limit 카운트 부정확. 1일 이상 지난 row는 안전하게 삭제.
 *
 * (verified 여부 무관 — verifyToken은 10분 만료라 1일이면 어차피 무효)
 */

import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const config: Config = {
  schedule: "0 18 * * *",  // UTC 18:00 = KST 03:00
};

export default async () => {
  const startedAt = new Date();
  try {
    const r: any = await db.execute(sql`
      DELETE FROM phone_verifications
       WHERE created_at < NOW() - INTERVAL '1 day'
    `);
    const deleted = Number(r?.rowCount ?? r?.count ?? 0);
    console.log(`[cron-phone-verify-cleanup] 완료 ${startedAt.toISOString()} — 삭제 ${deleted}건`);
    return new Response(JSON.stringify({ ok: true, deleted, startedAt: startedAt.toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error(`[cron-phone-verify-cleanup] 실패:`, e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 300) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
