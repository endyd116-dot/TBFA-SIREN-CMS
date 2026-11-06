/**
 * 매일 KST 03:00 — 후원·수입·지출·급여·정산 입금을 장부 전표로 옮긴다.
 * 기존 03:00 크론과 같은 시각에 맞춰 DB를 따로 깨우지 않는다.
 */
import type { Context } from "@netlify/functions";
import { syncLedger } from "../../lib/ledger-auto";

export default async (_req: Request, _ctx: Context) => {
  try {
    const result = await syncLedger();
    console.info("[cron-ledger-sync] 완료", JSON.stringify(result));
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[cron-ledger-sync] 실패:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err).slice(0, 300) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config = {
  schedule: "0 18 * * *", // UTC 18:00 = KST 03:00
};
