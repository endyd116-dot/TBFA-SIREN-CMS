/**
 * admin-martyrdom-external-search-background — R43 외부 검색 백그라운드
 *
 * Netlify Background Function (-background suffix·15분 한도)
 * POST { queries: string[], engines: ('gemini'|'naver')[], jobId?, secret }
 *   - secret = process.env.INTERNAL_TRIGGER_SECRET (fail-closed)
 *   - runExternalResearch 호출 → 결과 INSERT (lib에서 처리)
 *   - pending 상태로 저장 + RAG 'martyr_external' 색인은 별도 (검토 후 승급 시 키 전환)
 *
 * 응답: 202 즉시 반환 (실제 처리는 백그라운드)
 *
 * config.path 안 붙임 (-background 함수는 .netlify/functions/* 경로로만 호출)
 */
import type { Context } from "@netlify/functions";
import { runExternalResearch, SearchEngine } from "../../lib/martyrdom-external";

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "백그라운드 검색 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }),
      { status: 405, headers: { "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonError("parse_body", new Error("요청 본문 파싱 실패"), 400); }

  /* fail-closed — secret 미일치 시 즉시 차단 */
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || expected !== String(body?.secret || "")) {
    return new Response(JSON.stringify({ ok: false, error: "internal secret 불일치" }),
      { status: 403, headers: { "Content-Type": "application/json" } });
  }

  const queries: string[] = Array.isArray(body?.queries) ? body.queries.map((q: any) => String(q).trim()).filter(Boolean) : [];
  const enginesRaw: string[] = Array.isArray(body?.engines) ? body.engines.map((e: any) => String(e).toLowerCase()) : ["gemini", "naver"];
  const engines: SearchEngine[] = enginesRaw.filter((e: string): e is SearchEngine => e === "gemini" || e === "naver");
  const jobId = String(body?.jobId || `ext-${Date.now()}`);

  if (queries.length === 0) return jsonError("validate", new Error("queries 비어 있음"), 400);
  if (engines.length === 0) return jsonError("validate", new Error("engines 비어 있음"), 400);

  console.info(`[external-search-bg] start jobId=${jobId} queries=${queries.length} engines=${engines.join(",")}`);

  try {
    const r = await runExternalResearch(queries, engines);
    console.info(`[external-search-bg] done jobId=${jobId} inserted=${r.inserted} duplicated=${r.duplicated} errors=${r.errors.length}`);
    if (r.errors.length) console.warn(`[external-search-bg] errors: ${r.errors.slice(0, 5).join(" | ")}`);
    return new Response(JSON.stringify({ ok: r.ok, jobId, inserted: r.inserted, duplicated: r.duplicated, errors: r.errors }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error(`[external-search-bg] 예외 jobId=${jobId}:`, err?.message);
    return jsonError("run_research", err);
  }
};
