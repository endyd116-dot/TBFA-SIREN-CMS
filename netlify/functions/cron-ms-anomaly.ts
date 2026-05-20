/**
 * cron-ms-anomaly: 매출 입력 이상 패턴 자동 감지
 *
 * 감지 규칙 (각각 별도 try/catch):
 *   1. 동일 entered_by + 날짜 + milestone_definition_id의 PENDING 3건 이상
 *   2. 단일 입력 금액이 해당 멤버 최근 30일 평균의 10배 초과
 *   3. 동일 entered_by의 하루 입력 건수 10건 초과
 *
 * 감지 시 슈퍼어드민 전원에게 알림.
 * GET ?dryRun=1 → DB 변경 없이 탐지 결과 JSON 반환.
 *
 * 스케줄: UTC 22:00 = KST 07:00 (netlify.toml)
 */
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config: Config = {
  schedule: "0 22 * * *",
};

interface Anomaly {
  rule: 1 | 2 | 3;
  memberId: number;
  memberName: string;
  desc: string;
  date: string;
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const anomalies: Anomaly[] = [];

  /* 규칙 1: 동일 멤버·날짜·마일스톤 PENDING 3건 이상 */
  try {
    const rows = await db.execute(sql`
      SELECT re.entered_by AS member_id, m.name AS member_name,
             re.revenue_date AS rdate, re.milestone_definition_id AS mid,
             md.name AS milestone_name, COUNT(*)::int AS cnt
      FROM revenue_entries re
      JOIN members m ON m.id = re.entered_by
      LEFT JOIN milestone_definitions md ON md.id = re.milestone_definition_id
      WHERE re.status = 'PENDING'
        AND re.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY re.entered_by, m.name, re.revenue_date, re.milestone_definition_id, md.name
      HAVING COUNT(*) >= 3
      LIMIT 50
    `);
    for (const r of ((rows as any).rows || (rows as any[])) as any[]) {
      anomalies.push({
        rule: 1,
        memberId: r.member_id,
        memberName: r.member_name,
        desc: `동일 마일스톤(${r.milestone_name}) PENDING ${r.cnt}건`,
        date: String(r.rdate).slice(0, 10),
      });
    }
  } catch (e: any) { console.warn("[ms-anomaly:rule1]", e?.message); }

  /* 규칙 2: 단일 금액이 최근 30일 평균의 10배 초과 */
  try {
    const rows = await db.execute(sql`
      WITH recent AS (
        SELECT entered_by, AVG(amount::numeric) AS avg_amt
        FROM revenue_entries
        WHERE created_at >= NOW() - INTERVAL '30 days' AND status IN ('PENDING','VERIFIED')
        GROUP BY entered_by
        HAVING COUNT(*) >= 3
      )
      SELECT re.id, re.entered_by AS member_id, m.name AS member_name,
             re.amount::numeric AS amt, recent.avg_amt, re.revenue_date AS rdate
      FROM revenue_entries re
      JOIN recent ON recent.entered_by = re.entered_by
      JOIN members m ON m.id = re.entered_by
      WHERE re.created_at >= NOW() - INTERVAL '1 day'
        AND re.amount::numeric > recent.avg_amt * 10
      LIMIT 50
    `);
    for (const r of ((rows as any).rows || (rows as any[])) as any[]) {
      anomalies.push({
        rule: 2,
        memberId: r.member_id,
        memberName: r.member_name,
        desc: `단일 입력 ${Number(r.amt).toLocaleString()}원 (최근30일 평균 ${Number(r.avg_amt).toLocaleString()}원의 10배 초과)`,
        date: String(r.rdate).slice(0, 10),
      });
    }
  } catch (e: any) { console.warn("[ms-anomaly:rule2]", e?.message); }

  /* 규칙 3: 동일 멤버 하루 입력 10건 초과 */
  try {
    const rows = await db.execute(sql`
      SELECT re.entered_by AS member_id, m.name AS member_name,
             DATE(re.created_at) AS cdate, COUNT(*)::int AS cnt
      FROM revenue_entries re
      JOIN members m ON m.id = re.entered_by
      WHERE re.created_at >= NOW() - INTERVAL '2 days'
      GROUP BY re.entered_by, m.name, DATE(re.created_at)
      HAVING COUNT(*) > 10
      LIMIT 50
    `);
    for (const r of ((rows as any).rows || (rows as any[])) as any[]) {
      anomalies.push({
        rule: 3,
        memberId: r.member_id,
        memberName: r.member_name,
        desc: `하루 입력 ${r.cnt}건 (10건 초과)`,
        date: String(r.cdate).slice(0, 10),
      });
    }
  } catch (e: any) { console.warn("[ms-anomaly:rule3]", e?.message); }

  if (dryRun) {
    return Response.json({ ok: true, dryRun: true, count: anomalies.length, anomalies });
  }

  /* 슈퍼어드민 전원에게 알림 */
  for (const a of anomalies) {
    try {
      await notifyAllSuperAdmins({
        category: "milestone", severity: "warning",
        title: "매출 이상 패턴 감지",
        message: `${a.memberName}: ${a.desc} (${a.date})`,
        link: "/admin#milestone-review",
        refTable: "revenue_entries",
        refId: a.memberId,
      });
    } catch (e: any) { console.warn("[ms-anomaly:notify]", e?.message); }
  }

  console.log("[cron-ms-anomaly] anomalies:", anomalies.length);
  return new Response("ok");
}
