/**
 * cron-ms-deadline-remind: 분기 마감 D-1~D-7 매일 독촉 알림
 *
 * 매일 KST 09:00 (UTC 00:00) 실행:
 *   - 현재 ACTIVE 분기 endDate가 오늘 기준 1~7일 이내
 *   - 결산 미제출(quarterly_settlements row 없거나 status='DRAFT') 운영자에게 알림
 *   - 슈퍼어드민에게 "미입력 N명" 요약 알림
 * 분기 종료(endDate < 오늘)이면 스킵.
 */
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { createNotification, notifyAllSuperAdmins } from "../../lib/notify";

export const config: Config = {
  schedule: "0 0 * * *",
};

export default async function handler(_req: Request, _ctx: Context) {
  const today = new Date().toISOString().slice(0, 10);
  const results: string[] = [];

  try {
    /* 1. ACTIVE 분기 중 endDate가 오늘 ~ +7일 사이인 분기 조회 */
    const qRows = await db.execute(sql`
      SELECT id, year, quarter, end_date
      FROM quarters
      WHERE status = 'ACTIVE'
        AND end_date >= ${today}
        AND end_date <= (DATE(${today}) + INTERVAL '7 days')
    `);
    const targetQuarters = ((qRows as any).rows || (qRows as any[])) as any[];

    for (const q of targetQuarters) {
      const quarterLabel = `${q.year}년 Q${q.quarter}`;
      const endDate = new Date(String(q.end_date).slice(0, 10) + "T23:59:59+09:00");
      const diffDays = Math.ceil((endDate.getTime() - Date.now()) / (24 * 3600 * 1000));
      const dn = Math.max(0, diffDays);

      /* 2. 운영자 (milestone_role 보유) 중 결산 미제출자 조회 */
      const opRows = await db.execute(sql`
        SELECT m.id, m.name, m.milestone_role,
               COALESCE(qs.status, 'NONE') AS settle_status
        FROM members m
        LEFT JOIN quarterly_settlements qs
          ON qs.member_id = m.id AND qs.quarter_id = ${q.id}
        WHERE m.type = 'admin' AND m.status = 'active' AND m.milestone_role IS NOT NULL
          AND (qs.status IS NULL OR qs.status IN ('DRAFT', 'REJECTED'))
      `);
      const operators = ((opRows as any).rows || (opRows as any[])) as any[];

      /* 3. 각 운영자에게 알림 */
      for (const op of operators) {
        try {
          await createNotification({
            recipientId: op.id,
            recipientType: "admin",
            category: "milestone",
            severity: dn <= 3 ? "warning" : "info",
            title: `분기 마감 D-${dn}일`,
            message: `${quarterLabel} 매출 실적과 결산을 확인해주세요.`,
            link: "/admin#settlement-my",
          });
        } catch (e: any) {
          console.warn("[ms-deadline-remind:op]", e?.message);
        }
      }

      /* 4. 슈퍼어드민 전원에게 요약 알림 */
      if (operators.length > 0) {
        try {
          await notifyAllSuperAdmins({
            category: "milestone",
            severity: dn <= 3 ? "warning" : "info",
            title: `성과관리 마감 D-${dn}일 — 미입력 ${operators.length}명`,
            message: `${quarterLabel} 미제출 운영자: ${operators.map((o: any) => o.name || "-").join(", ").slice(0, 200)}`,
            link: "/cms-tbfa.html#milestone-review",
          });
        } catch (e: any) {
          console.warn("[ms-deadline-remind:super]", e?.message);
        }
      }

      results.push(`${quarterLabel} D-${dn} → ${operators.length}명 독촉`);
    }

    console.log("[cron-ms-deadline-remind]", results.join(" | ") || "대상 없음");
  } catch (err: any) {
    console.error("[cron-ms-deadline-remind] 오류:", err?.message);
  }

  return new Response("ok");
}
