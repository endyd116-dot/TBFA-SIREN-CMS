import type { Config, Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config: Config = {
  schedule: "0 0 * * *",  // 매일 UTC 00:00 (KST 09:00)
};

export default async function handler(_req: Request, _ctx: Context) {
  const today = new Date().toISOString().slice(0, 10);
  const results: string[] = [];

  try {
    // UPCOMING → ACTIVE (시작일 도래)
    const activateRes = await db.execute(sql`
      UPDATE quarters SET status = 'ACTIVE', updated_at = NOW()
      WHERE status = 'UPCOMING' AND start_date <= ${today}
      RETURNING id, year, quarter
    `);
    const activated = (activateRes as any).rows || (activateRes as any[]);
    if (activated.length > 0) results.push(`ACTIVE 전환: ${activated.map((r: any) => `${r.year}Q${r.quarter}`).join(", ")}`);

    // ACTIVE → ENDED (종료일 도래)
    const endRes = await db.execute(sql`
      UPDATE quarters SET status = 'ENDED', updated_at = NOW()
      WHERE status = 'ACTIVE' AND end_date < ${today}
      RETURNING id, year, quarter
    `);
    const ended = (endRes as any).rows || (endRes as any[]);
    if (ended.length > 0) results.push(`ENDED 전환: ${ended.map((r: any) => `${r.year}Q${r.quarter}`).join(", ")}`);

    // ENDED → SETTLED (결산일 도래 + 모든 결산 PAID)
    const endedQRows = await db.execute(sql`SELECT id, year, quarter FROM quarters WHERE status = 'ENDED'`);
    const endedQs = (endedQRows as any).rows || (endedQRows as any[]);
    for (const q of endedQs) {
      const unpaidRows = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM quarterly_settlements
        WHERE quarter_id = ${q.id} AND status NOT IN ('PAID', 'APPROVED')
      `);
      const unpaid = Number(((unpaidRows as any).rows?.[0] || unpaidRows[0])?.cnt || 0);
      if (unpaid === 0) {
        await db.execute(sql`UPDATE quarters SET status = 'SETTLED', updated_at = NOW() WHERE id = ${q.id}`);
        results.push(`SETTLED: ${q.year}Q${q.quarter}`);
      }
    }

    // D-7 알림: 분기 종료 7일 전
    const d7Date = new Date();
    d7Date.setDate(d7Date.getDate() + 7);
    const d7 = d7Date.toISOString().slice(0, 10);
    const d7Rows = await db.execute(sql`SELECT id FROM quarters WHERE status = 'ACTIVE' AND end_date = ${d7}`);
    const d7Qs = (d7Rows as any).rows || (d7Rows as any[]);
    if (d7Qs.length > 0) {
      results.push(`D-7 알림 대상 분기: ${d7Qs.length}개 (알림 발송은 workspace-logger 통해 구현 예정)`);
    }

    console.log("[cron-milestone-quarter]", results.join(" | ") || "변경 없음");
  } catch (err: any) {
    console.error("[cron-milestone-quarter] 오류:", err?.message);
  }

  return new Response("ok");
}
