// netlify/functions/cron-donation-receipt-annual.ts
// 연간 기부금 영수증 발급 안내 — 매년 1월 15일 KST 10:00 (UTC 01:00).
// 전년도 완료 후원이 있는 회원에게 영수증 발급 안내 알림톡(DONATION_RECEIPT_ANNUAL).
// 솔라피 SOLAPI_TPL_RECEIPT (어댑터 처리). env 미설정 시 placeholder(미발송).

import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

export const config: Config = {
  schedule: "0 1 15 1 *", // 매년 1월 15일 UTC 01:00 = KST 10:00 (netlify.toml에도 등록)
};

export default async (_req: Request) => {
  try {
    const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
    const prevYear = nowKst.getUTCFullYear() - 1;
    const from = `${prevYear}-01-01`;
    const to = `${prevYear + 1}-01-01`;
    const issuePeriod = `${prevYear + 1}년 1월 ~ 3월`;

    const res: any = await db.execute(sql`
      SELECT m.id AS member_id, m.name AS member_name,
             COALESCE(SUM(d.amount), 0)::bigint AS total
        FROM members m
        INNER JOIN donations d ON d.member_id = m.id
       WHERE d.status = 'completed'
         AND d.paid_at >= ${from}::date
         AND d.paid_at <  ${to}::date
         AND m.withdrawn_at IS NULL
       GROUP BY m.id, m.name
      HAVING COALESCE(SUM(d.amount), 0) > 0
    `);
    const rows = Array.isArray(res) ? res : (res?.rows || []);

    let sent = 0;
    for (const r of rows) {
      dispatch({
        event: NotifyEvent.DONATION_RECEIPT_ANNUAL,
        target: { type: "member", id: Number(r.member_id) },
        params: {
          memberName: r.member_name,
          year: String(prevYear),
          annualAmount: Number(r.total) || 0,
          issuePeriod,
          receiptType: "기부금 세액공제 영수증",
          title: "연간 기부금 영수증 발급 안내",
          message: `${prevYear}년 기부금 영수증을 마이페이지에서 발급받으실 수 있습니다.`,
          link: "/mypage.html",
          category: "donation",
          severity: "info",
        },
      });
      sent++;
    }

    console.log(`[cron-donation-receipt-annual] ${prevYear}년 영수증 안내 대상 ${rows.length}건 발송 ${sent}`);
    return new Response(JSON.stringify({ ok: true, year: prevYear, count: sent }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[cron-donation-receipt-annual] 오류:", error);
    return new Response(JSON.stringify({ ok: false, error: error?.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
