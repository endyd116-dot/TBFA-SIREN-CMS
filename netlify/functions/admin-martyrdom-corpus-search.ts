/**
 * admin-martyrdom-corpus-search — 운영자 코퍼스 의미 검색 (보완 다·§P2.0 #6)
 *
 * POST { q, topK? }
 *   과거 사례(martyr_case) + 법령(martyr_law)만 검색. 진행 사건(martyr_active) 제외(교차 노출 방지).
 *
 * 응답: { ok, query, hits:[{ id, sourceType, sourceRef, title, snippet, score }] }
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { searchRag } from "../../lib/ai-embedding";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-corpus-search" };

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const query = String(body.q || body.query || "").trim();
  if (!query) {
    return new Response(JSON.stringify({ ok: false, error: "검색어(q) 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const topK = Math.min(20, Math.max(1, Number(body.topK) || 8));

  try {
    /* martyr_case + martyr_law 만 (active 제외·caseId 미전달) */
    const hits = await searchRag(query, topK, ["martyr_case", "martyr_law"]);
    const mapped = hits.map(h => ({
      id: h.id,
      sourceType: h.sourceType,
      sourceRef: h.sourceRef,
      title: h.title || h.sourceRef,
      snippet: (h.content || "").slice(0, 300),
      score: Math.round((h.score || 0) * 1000) / 1000,
    }));

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_corpus_search", {
      detail: { query: query.slice(0, 100), hits: mapped.length },
    });

    return new Response(JSON.stringify({ ok: true, query, hits: mapped }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "검색 실패", detail: String(err?.message || err).slice(0, 300),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
