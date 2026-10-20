/**
 * GET /api/admin/potential-donor-events — 잠재 후원자 이벤트별 집계 (2026-10-20)
 *   응답: { ok, data: { events: [{ name, count, linked, converted, contactable }] } }
 *   잠재 표의 «이벤트별 보기»·수신자 그룹 편집의 «잠재 이벤트 참여» 선택지에 쓴다.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { loadPotentialEvents } from "../../lib/potential-donor-events";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin/potential-donor-events" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  if (req.method !== "GET") return new Response(jsonKST({ ok: false, error: "Method Not Allowed" }), { status: 405, headers: JSON_HEADER });
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  try {
    const events = await loadPotentialEvents();
    return new Response(jsonKST({ ok: true, data: { events } }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "이벤트 집계 실패", step: "select", detail: String(err?.message || err).slice(0, 500) }), { status: 500, headers: JSON_HEADER });
  }
};
