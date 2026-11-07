// netlify/functions/cron-billing-upcoming.ts
// 정기 회비 자동 출금 "예정" 사전 안내 — 출금 3일 전 알림톡(BILLING_UPCOMING).
// 매일 KST 10:00 (UTC 01:00) 실행. members.next_billing_date = 오늘+3 인 활성 회원 대상.
// 솔라피 알림톡 SOLAPI_TPL_BILLING_UPCOMING (어댑터 처리). env 미설정 시 placeholder(미발송).
// 2026-11-08: 일시 후원회원 자격 만료 30일 전 안내(MEMBERSHIP_EXPIRING)도 같은 실행에 얹는다(DB를 따로 깨우지 않음).
//   발송은 끝날 때까지 기다린다 — 서버리스 함수는 응답 뒤 남은 작업이 끊길 수 있다.

import { jsonKST, kstDateSql, todayKST } from "../../lib/kst";
import type { Config } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { dispatchAndWait } from "../../lib/notify-dispatcher";
import { ONETIME_MONTHS } from "../../lib/donor-stage";
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
      await dispatchAndWait({
        event: NotifyEvent.BILLING_UPCOMING,
        target: { type: "member", id: Number(r.member_id) },
        params: {
          memberName: r.member_name,
          amount: Number(r.amount) || 0,
          chargeDate: ymd,
          paymentMethod: card,
          title: "정기 회비 자동 출금 예정 안내",
          message: `${Number(r.amount).toLocaleString()}원이 ${ymd}에 자동 출금될 예정입니다.`,
          link: "/mypage.html",
          category: "billing",
          severity: "info",
        },
      });
      sent++;
    }

    console.log(`[cron-billing-upcoming] 출금예정(${ymd}) 대상 ${rows.length}건 발송 ${sent}`);

    /* 일시 후원회원 자격 만료 30일 전 안내 (2026-11-08 회비 규칙).
       자격은 마지막 회비 납부일부터 ONETIME_MONTHS개월(lib/donor-stage.ts). 정기 약정이 살아 있으면 단계가 정기라 대상이 아니다.
       만료 30일 전 날짜가 오늘인 회원에게만 보내므로 하루 한 번만 나간다. */
    let expiring = 0;
    try {
      const today = todayKST();
      const months = sql.raw(`INTERVAL '${ONETIME_MONTHS} months'`);
      const exp: any = await db.execute(sql`
        SELECT m.id AS member_id, m.name AS member_name,
               to_char(lp.last_paid_kst + ${months}, 'YYYY-MM-DD') AS expires_on
          FROM members m
          JOIN LATERAL (
            SELECT MAX(${sql.raw(kstDateSql("COALESCE(d.paid_at, d.created_at)"))}) AS last_paid_kst
              FROM donations d WHERE d.member_id = m.id AND d.status = 'completed') lp ON TRUE
         WHERE m.donor_type = 'prospect' AND m.prospect_subtype = 'onetime'
           AND m.status = 'active' AND m.withdrawn_at IS NULL
           AND lp.last_paid_kst IS NOT NULL
           AND (lp.last_paid_kst + ${months} - INTERVAL '30 days')::date = ${today}::date`);
      const list = Array.isArray(exp) ? exp : (exp?.rows || []);
      const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
      for (const r of list) {
        const name = String(r.member_name || "회원");
        const expiresOn = String(r.expires_on);
        await dispatchAndWait({
          event: NotifyEvent.MEMBERSHIP_EXPIRING,
          target: { type: "member", id: Number(r.member_id) },
          params: {
            memberName: name,
            expiresOn,
            title: "후원회원 자격 만료 예정 안내",
            message: `후원회원 자격이 ${expiresOn}에 만료됩니다. 회비를 다시 납부하시면 납부일부터 1년 연장됩니다.`,
            smsBody: `[교사유가족협의회] ${name}님, 후원회원 자격이 ${expiresOn}에 만료됩니다. 회비를 다시 납부하시면 납부일부터 1년 연장됩니다. tbfa.co.kr`,
            emailBody: `<p>${esc(name)}님, 안녕하세요. 사단법인 교사유가족협의회입니다.</p>`
              + `<p>회원님의 후원회원 자격이 <strong>${expiresOn}</strong>에 만료됩니다. 회비를 다시 납부하시면 납부일부터 1년간 회원 자격이 이어집니다.</p>`
              + `<p>홈페이지 <a href="https://tbfa.co.kr/mypage.html">마이페이지</a>에서 납부 내역을 확인하실 수 있습니다. 함께해 주셔서 감사합니다.</p>`,
            link: "/mypage.html",
            category: "billing",
            severity: "info",
          },
        });
        expiring++;
      }
      console.log(`[cron-billing-upcoming] 자격 만료 예정 안내 ${expiring}건`);
    } catch (e: any) {
      console.warn("[cron-billing-upcoming] 자격 만료 안내 실패(출금 예정 안내는 유효):", e?.message || e);
    }

    return new Response(jsonKST({ ok: true, chargeDate: ymd, count: sent, expiring }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[cron-billing-upcoming] 오류:", error);
    return new Response(jsonKST({ ok: false, error: error?.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};
