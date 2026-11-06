/**
 * GET /api/admin-ledger-trial-balance?year=2026&month=11
 * 합계잔액시산표. month를 생략하면 회계연도 끝까지 계산한다.
 */
import { jsonKST, yearKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { trialBalance } from "../../lib/ledger-report";

export const config = { path: "/api/admin-ledger-trial-balance" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || yearKST();
  const month = Number(url.searchParams.get("month")) || null;
  if (month !== null && (month < 1 || month > 12)) {
    return new Response(jsonKST({ ok: false, error: "month는 1~12입니다" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const data = await trialBalance(year, month);
    if (!data) {
      return new Response(jsonKST({ ok: false, error: `${year}년 회계연도가 없습니다` }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(jsonKST({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "시산표 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
