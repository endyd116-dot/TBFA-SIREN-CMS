/**
 * admin-martyrdom-family-summary — 유족 전달용 쉬운 요약 (⑧·P4)
 *
 * POST { caseId }     → 새로 생성 (AI 호출)
 * GET  ?caseId=N      → 최신 family_summary 로드
 *
 * 응답: { ok, summary: { id, outputType, contentText, nextSteps, status } }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { buildFamilySummary } from "../../lib/martyrdom-ai";

export const config = { path: "/api/admin-martyrdom-family-summary" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }),
    { status: 400, headers: { "Content-Type": "application/json" } });
}
function ok(data: any) {
  return new Response(jsonKST({ ok: true, ...data }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  /* GET — 최신 family_summary 로드 */
  if (req.method === "GET") {
    const url = new URL(req.url);
    const caseId = Number(url.searchParams.get("caseId") || "0");
    if (!caseId) return badRequest("caseId 필수");

    try {
      const r: any = await db.execute(sql.raw(`
        SELECT id, output_type AS "outputType", content_text AS "contentText",
               content_json AS "contentJson", status, created_at AS "createdAt"
        FROM martyrdom_ai_outputs
        WHERE case_id = ${caseId} AND output_type = 'family_summary'
        ORDER BY created_at DESC LIMIT 1
      `));
      const row = (r?.rows ?? r ?? [])[0];
      if (!row) return ok({ summary: null });

      const contentJson = typeof row.contentJson === "string"
        ? JSON.parse(row.contentJson) : (row.contentJson || {});
      return ok({
        summary: {
          id:          Number(row.id),
          outputType:  "family_summary" as const,
          contentText: String(row.contentText || ""),
          nextSteps:   Array.isArray(contentJson?.nextSteps) ? contentJson.nextSteps : [],
          status:      String(row.status || "draft"),
        },
      });
    } catch (err: any) {
      return jsonError("select_summary", err);
    }
  }

  /* POST — 새로 생성 */
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
    const caseId = Number(body?.caseId || 0);
    if (!caseId) return badRequest("caseId 필수");

    try {
      const summary = await buildFamilySummary(caseId);
      return ok({ summary });
    } catch (err: any) {
      return jsonError("build_family_summary", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "GET·POST만 허용" }), { status: 405 });
};
