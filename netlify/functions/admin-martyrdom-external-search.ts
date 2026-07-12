/**
 * admin-martyrdom-external-search — R43 외부 자료 수동 검색 트리거
 *
 * POST { query: string, engines?: ['gemini','naver'] }
 *   → background 함수에 queries=[query]·engines로 위임
 *   → { ok, queued, jobId }
 *
 * 권한: requireAdmin + canAccess('martyrdom_external_review')
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { roleForbidden } from "../../lib/admin-role";
import { canAccess } from "../../lib/role-permission-check";

export const config = { path: "/api/admin-martyrdom-external-search" };

const FEATURE = "martyrdom_external_review";

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "외부 검색 트리거 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") return badRequest("POST만 허용");

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { member } = auth.ctx;

  if (!(await canAccess(member.role ?? "", FEATURE))) return roleForbidden("admin");

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }

  const query = String(body?.query || "").trim();
  if (!query || query.length < 2) return badRequest("query 필수 (2자 이상)");
  if (query.length > 200) return badRequest("query는 200자 이내");

  const enginesRaw = Array.isArray(body?.engines) ? body.engines : ["gemini", "naver"];
  const engines = enginesRaw
    .map((s: any) => String(s).toLowerCase())
    .filter((s: string) => s === "gemini" || s === "naver");
  if (engines.length === 0) return badRequest("engines는 ['gemini','naver'] 중 1개 이상");

  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!secret) {
    return jsonError("secret_missing", new Error("INTERNAL_TRIGGER_SECRET 미설정 — 백그라운드 검색 비활성"));
  }

  const jobId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const base = process.env.URL || process.env.SITE_URL || "https://tbfa.co.kr";
    const baseUrl = base.startsWith("http") ? base : `https://${base}`;
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-external-search-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [query], engines, jobId, secret }),
    });
    if (resp.status !== 202 && resp.status !== 200) {
      const txt = (await resp.text().catch(() => "")).slice(0, 200);
      return jsonError("background_trigger", new Error(`status=${resp.status} ${txt}`));
    }
    return new Response(jsonKST({ ok: true, queued: engines.length, jobId }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("background_fetch", err);
  }
};
