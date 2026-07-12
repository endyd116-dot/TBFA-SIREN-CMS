// netlify/functions/cron-billing-upcoming.ts
// 정기 후원금 자동 출금 "예정" 사전 안내 — 출금 3일 전 알림톡(BILLING_UPCOMING).
// 매일 KST 10:00 (UTC 01:00) 실행. members.next_billing_date = 오늘+3 인 활성 회원 대상.
// 솔라피 알림톡 SOLAPI_TPL_BILLING_UPCOMING (어댑터 처리). env 미설정 시 placeholder(미발송).

import { jsonKST } from "../../lib/kst";
import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { dispatch } from "../../lib/notify-dispatcher";
import { NotifyEvent } from "../../lib/notify-events";

export const config: Config = {
  schedule: "0 1 * * *", // UTC 01:00 = KST 10:00 (netlify.toml에도 등록)
};

export default async (_req: Request) => {
  const startedAt = new Date();
  try {
    /* 오늘+3일 출금 예정 (KST 기준 날짜) */
    const target = new Date(startedAt.getTime() + 9 * 3600 * 1000); // → KST
    target.setUTCDate(target.getUTCDate() + 3);
    const ymd = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(target.getUTCDate()).padStart(2, "0")}`;

    const res: any = await db.execute(sql`
      SELECT m.id AS member_id, m.name AS member_name, bk.amount,
             bk.card_company, bk.card_number_masked
        FROM members m
        INNER JOIN billing_keys bk ON bk.member_id = m.id AND bk.is_active = true
       WHERE m.next_billing_date = ${ymd}::date
         AND m.withdrawn_at IS NULL
         AND m.status = 'active'
    `);
    const rows = Array.isArray(res) ? res : (res?.rows || []);

    let sent = 0;
    for (const r of rows) {
      const card = [r.card_company, r.card_number_masked].filter(Boolean).join(" ") || "등록 카드";
      dispatch({
        event: NotifyEvent.BILLING_UPCOMING,
        target: { type: "member", id: Number(r.member_id) },
        params: {
          memberName: r.member_name,
          amount: Number(r.amount) || 0,
          chargeDate: ymd,
          paymentMethod: card,
          title: "정기 후원금 자동 출금 예정 안내",
          message: `${Number(r.amount).toLocaleString()}원이 ${ymd}에 자동 출금될 예정입니다.`,
          link: "/mypage.html",
          category: "billing",
          severity: "info",
        },
      });
      sent++;
    }

    console.log(`[cron-billing-upcoming] 출금예정(${ymd}) 대상 ${rows.length}건 발송 ${sent}`);
    return new Response(jsonKST({ ok: true, chargeDate: ymd, count: sent }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[cron-billing-upcoming] 오류:", error);
    return new Response(jsonKST({ ok: false, error: error?.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
