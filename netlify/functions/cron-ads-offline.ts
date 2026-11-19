/**
 * 광고 성과 들여오기(오프라인 전환) — 매시 정각 (2026-11-19 Swain 직접 승인)
 *
 * 홈페이지 화면이 보지 못하는 완료(결제사 늦은 통보·정기 자동 결제·운영자 입금 확인·효성 확인)까지
 * 구글 광고 성과로 세기 위해, «광고 클릭 표식이 이어지는 완료 회비»를 AM으로 알린다(AM이 구글에 올림).
 *
 * - 보내는 값: kind · orderId(D-0000123) · value(원) · currency(KRW) · at(완료 시각, ISO UTC) · gclid|wbraid|gbraid 하나.
 *   이름·연락처 등 개인 정보는 보내지 않는다.
 * - 클릭 표식(lib/ads-click.ts): 그 회비 기록에 붙은 것, 없으면 같은 회원의 다른 회비 기록에 붙은 것
 *   (정기 2회차·효성 확인 행·등불 의도 흡수 행 등) 가운데 완료 시각 이전 90일 안의 가장 최근 클릭.
 * - kind (AM 계약 2026-11-19):
 *     카드·간편결제 일시                    = donationOnce          (브라우저 태그와 같은 액션·같은 orderId → 구글이 한 건으로 합침)
 *     카드 정기 — 그 회원의 첫 정기 완료    = donationMonthlyFirst  (〃)
 *     계좌이체·효성 등(첫 정기 완료 포함)   = donationOtherConfirmed
 *     정기 2회차~(카드·효성 모두)           = donationRecurring
 * - 한 번 보낸 건은 source_meta.adsSentAt으로 표시해 다시 보내지 않는다(AM도 orderId로 한 번만 받는다).
 *   실패는 source_meta.adsTries를 올려 다음 정각에 다시 — 5번 실패하면 멈춘다.
 * - 비밀 값(SIREN_AM_ADS_SECRET)이 없으면 DB도 열지 않고 바로 끝난다.
 * - 매시 정각 — 기존 정각 크론들과 같은 분이라 DB를 따로 깨우지 않는다(CLAUDE.md §9.3.8).
 * - updated_at은 건드리지 않는다(완료 시각 계산에 쓰이므로).
 */
import { sql } from "drizzle-orm";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { AD_CLICK_MAX_AGE_DAYS } from "../../lib/ads-click";

const DEFAULT_URL = "https://withwork.tbfa.co.kr/api/grants-offline-conv";
const LOOKBACK_DAYS = 30;        // 최근 30일 안에 완료된 회비만 살핀다
const MAX_PER_RUN = 100;
const TIME_BUDGET_MS = 20_000;   // 한 번에 20초 안에서만 보낸다
const MAX_TRIES = 5;
const CARD_METHODS = ["card", "simplepay"];   // KICC 카드·간편결제 — 브라우저 태그도 보는 길

type Kind = "donationOnce" | "donationMonthlyFirst" | "donationRecurring" | "donationOtherConfirmed";

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

function adsKindOf(payMethod: string, type: string, firstRegular: boolean): Kind {
  const card = CARD_METHODS.includes(String(payMethod || "").toLowerCase());
  if (type === "regular") {
    if (!firstRegular) return "donationRecurring";
    return card ? "donationMonthlyFirst" : "donationOtherConfirmed";
  }
  return card ? "donationOnce" : "donationOtherConfirmed";
}

async function markSent(id: number, kind: Kind): Promise<void> {
  await db.execute(sql`
    UPDATE donations
       SET source_meta = COALESCE(source_meta, '{}'::jsonb)
                         || jsonb_build_object('adsSentAt', ${new Date().toISOString()}::text, 'adsKind', ${kind}::text)
     WHERE id = ${id}
  `);
}
async function markFailed(id: number, tries: number, status: number): Promise<void> {
  await db.execute(sql`
    UPDATE donations
       SET source_meta = COALESCE(source_meta, '{}'::jsonb)
                         || jsonb_build_object('adsTries', ${tries}::int, 'adsLastStatus', ${status}::int)
     WHERE id = ${id}
  `);
}

export default async (_req: Request, _ctx: Context) => {
  const secret = (process.env.SIREN_AM_ADS_SECRET || "").trim();
  if (!secret) {
    return new Response(JSON.stringify({ ok: true, skipped: "SIREN_AM_ADS_SECRET 미설정 — 알림 꺼짐" }), { status: 200 });
  }
  const url = (process.env.SIREN_AM_ADS_URL || DEFAULT_URL).trim();
  const started = Date.now();
  let step = "select";
  const summary = { candidates: 0, sent: 0, failed: 0, skipped: 0 };

  try {
    const res: any = await db.execute(sql`
      WITH cand AS (
        SELECT d.id, d.member_id, d.amount, d.type, d.pay_method,
               (COALESCE(d.paid_at, d.updated_at, d.created_at) AT TIME ZONE 'UTC') AS done_at,
               COALESCE((d.source_meta->>'adsTries')::int, 0) AS tries
          FROM donations d
         WHERE d.status = 'completed'
           AND d.member_id IS NOT NULL
           AND COALESCE(d.paid_at, d.updated_at, d.created_at) >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${LOOKBACK_DAYS}::int)
           AND (d.source_meta->>'adsSentAt') IS NULL
           AND COALESCE((d.source_meta->>'adsTries')::int, 0) < ${MAX_TRIES}::int
      )
      SELECT c.id, c.amount, c.type, c.pay_method, c.done_at, c.tries,
             k.click,
             NOT EXISTS (
               SELECT 1 FROM donations p
                WHERE p.member_id = c.member_id AND p.type = 'regular' AND p.status = 'completed' AND p.id <> c.id
                  AND ((COALESCE(p.paid_at, p.updated_at, p.created_at) AT TIME ZONE 'UTC') < c.done_at
                       OR ((COALESCE(p.paid_at, p.updated_at, p.created_at) AT TIME ZONE 'UTC') = c.done_at AND p.id < c.id))
             ) AS first_regular
        FROM cand c
        JOIN LATERAL (
          SELECT x.source_meta->'adClick' AS click
            FROM donations x
           WHERE x.member_id = c.member_id
             AND (x.source_meta->'adClick') IS NOT NULL
             AND (x.source_meta->'adClick'->>'at')::timestamptz <= c.done_at + interval '10 minutes'
             AND (x.source_meta->'adClick'->>'at')::timestamptz >= c.done_at - make_interval(days => ${AD_CLICK_MAX_AGE_DAYS}::int)
           ORDER BY (x.source_meta->'adClick'->>'at')::timestamptz DESC
           LIMIT 1
        ) k ON true
       ORDER BY c.id
       LIMIT ${MAX_PER_RUN}::int
    `);
    const rows = rowsOf(res);
    summary.candidates = rows.length;

    step = "send";
    for (const r of rows) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      let click: any = r.click;
      if (typeof click === "string") { try { click = JSON.parse(click); } catch { click = null; } }
      if (!click || !["gclid", "wbraid", "gbraid"].includes(click.kind) || !click.id) { summary.skipped++; continue; }

      const id = Number(r.id);
      const kind = adsKindOf(String(r.pay_method || ""), String(r.type || ""), r.first_regular === true || r.first_regular === "t");
      const body: Record<string, any> = {
        kind,
        orderId: "D-" + String(id).padStart(7, "0"),
        value: Math.round(Number(r.amount) || 0),
        currency: "KRW",
        at: new Date(r.done_at).toISOString(),
      };
      body[click.kind] = click.id;

      let status = 0;
      let ok = false;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000);
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-am-secret": secret },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        status = resp.status;
        ok = resp.ok || resp.status === 409;   // 409 = AM이 이미 받은 건
      } catch {
        status = -1;
      }
      try {
        if (ok) { await markSent(id, kind); summary.sent++; }
        else { await markFailed(id, Number(r.tries || 0) + 1, status); summary.failed++; }
      } catch (e) {
        console.warn("[cron-ads-offline] 표시 저장 실패(다음 정각에 다시):", (e as any)?.message);
      }
    }
    console.log("[cron-ads-offline]", JSON.stringify(summary));
    return new Response(JSON.stringify({ ok: true, ...summary }), { status: 200 });
  } catch (err: any) {
    console.error("[cron-ads-offline]", step, err);
    return new Response(JSON.stringify({
      ok: false, error: "광고 성과 들여오기 실패", step,
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config = {
  // 매시 정각 — 기존 정각 크론과 같은 분(DB 따로 안 깨움). 비밀 값 없으면 DB도 안 연다.
  schedule: "0 * * * *",
};
