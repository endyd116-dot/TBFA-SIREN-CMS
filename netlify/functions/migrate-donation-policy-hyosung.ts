import { db } from "../../db";
import { sql } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key !== "siren-policy-hyosung-2026") {
    return new Response(JSON.stringify({ ok: false, error: "invalid key" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const results: string[] = [];

    /* 컬럼 1: 카운트다운 메시지 */
    await db.execute(sql`
      ALTER TABLE donation_policies
      ADD COLUMN IF NOT EXISTS hyosung_countdown_message TEXT
    `);
    results.push("✓ hyosung_countdown_message 컬럼 추가");

    /* 컬럼 2: 카운트다운 초수 */
    await db.execute(sql`
      ALTER TABLE donation_policies
      ADD COLUMN IF NOT EXISTS hyosung_countdown_seconds INTEGER DEFAULT 5
    `);
    results.push("✓ hyosung_countdown_seconds 컬럼 추가");

    /* id=1 기본값 설정 */
    await db.execute(sql`
      UPDATE donation_policies
      SET 
        hyosung_countdown_message = COALESCE(hyosung_countdown_message, '자동이체를 위해 외부페이지로 이동합니다.'),
        hyosung_countdown_seconds = COALESCE(hyosung_countdown_seconds, 5)
      WHERE id = 1
    `);
    results.push("✓ id=1 기본값 설정");

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};