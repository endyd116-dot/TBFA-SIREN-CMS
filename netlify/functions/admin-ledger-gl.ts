/**
 * GET /api/admin-ledger-gl?accountCode=1012&from=2026-11-25&to=2026-11-30&programId=&fundId=&limit=500&offset=0
 * 총계정원장. 승인된 전표만 읽는다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { generalLedger } from "../../lib/ledger-report";

export const config = { path: "/api/admin-ledger-gl" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET 메서드만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const accountCode = String(url.searchParams.get("accountCode") || "").trim();
  const from = String(url.searchParams.get("from") || "");
  const to = String(url.searchParams.get("to") || "");
  if (!accountCode || !DATE.test(from) || !DATE.test(to)) {
    return new Response(jsonKST({ ok: false, error: "accountCode, from, to(YYYY-MM-DD) 필수" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const data = await generalLedger({
      accountCode, from, to,
      programId: Number(url.searchParams.get("programId")) || null,
      fundId: Number(url.searchParams.get("fundId")) || null,
      limit: Math.min(Number(url.searchParams.get("limit")) || 500, 2000),
      offset: Math.max(Number(url.searchParams.get("offset")) || 0, 0),
    });
    if (!data) {
      return new Response(jsonKST({ ok: false, error: "계정과목을 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(jsonKST({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "총계정원장 조회 실패", step: "select",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
