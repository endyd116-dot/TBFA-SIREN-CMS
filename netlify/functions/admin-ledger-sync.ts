/**
 * POST /api/admin-ledger-sync
 * 장부 › 자금 연결의 «지금 반영». 후원·수입·지출·급여·정산 입금을 전표로 옮긴다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ledgerErrorBody } from "../../lib/ledger-post";
import { syncLedger } from "../../lib/ledger-auto";

export const config = { path: "/api/admin-ledger-sync" };

const JSON_HEADERS = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "POST 메서드만 허용" }), { status: 405, headers: JSON_HEADERS });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const data = await syncLedger();
    return new Response(jsonKST({ ok: true, data }), { status: 200, headers: JSON_HEADERS });
  } catch (err: any) {
    const { status, body } = ledgerErrorBody("sync", "자동 전표 반영 실패", err);
    return new Response(jsonKST(body), { status, headers: JSON_HEADERS });
  }
}
