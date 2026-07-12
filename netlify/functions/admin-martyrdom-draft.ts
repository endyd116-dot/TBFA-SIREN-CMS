/**
 * admin-martyrdom-draft — 서면 초안 로드 (화면 렌더용·§P3.2)
 *
 * GET ?caseId=N
 *   최신 'draft' ai_outputs + 목차(content_json.outline) + 섹션 + 검토 이력.
 *
 * 응답: { ok, outputId, status, outline:{ sections }, sections:[…], reviews:[…] }
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-draft" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(jsonKST({ ok: false, error: "GET만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const caseId = Number(url.searchParams.get("caseId"));
  if (!caseId) {
    return new Response(jsonKST({ ok: false, error: "caseId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    /* 최신 draft 행 */
    const dr: any = await db.execute(sql.raw(`
      SELECT id, status, content_json AS "contentJson"
      FROM martyrdom_ai_outputs
      WHERE case_id = ${caseId} AND output_type = 'draft'
      ORDER BY version DESC, id DESC LIMIT 1
    `));
    const draftRow = (dr?.rows ?? dr ?? [])[0];

    if (!draftRow) {
      return new Response(jsonKST({
        ok: true, outputId: null, status: null, outline: { sections: [] }, sections: [], reviews: [],
      }), { headers: { "Content-Type": "application/json" } });
    }

    const outputId = Number(draftRow.id);
    let outline: any = { sections: [] };
    if (draftRow.contentJson) {
      try {
        const cj = typeof draftRow.contentJson === "string" ? JSON.parse(draftRow.contentJson) : draftRow.contentJson;
        if (cj?.outline?.sections && Array.isArray(cj.outline.sections)) outline = cj.outline;
      } catch { /* 무시 */ }
    }

    /* 섹션 (보조 SELECT — 실패해도 빈 배열) */
    let sections: any[] = [];
    try {
      const sr: any = await db.execute(sql.raw(`
        SELECT id, section_key AS "sectionKey", title, content, rag_sources AS "ragSources",
               status, section_order AS "sectionOrder", word_count AS "wordCount"
        FROM martyrdom_draft_sections
        WHERE output_id = ${outputId}
        ORDER BY section_order ASC, id ASC
      `));
      sections = (sr?.rows ?? sr ?? []).map((row: any) => {
        let rag: any[] = [];
        if (row.ragSources) {
          try { rag = typeof row.ragSources === "string" ? JSON.parse(row.ragSources) : row.ragSources; } catch { rag = []; }
        }
        return {
          id: Number(row.id), sectionKey: String(row.sectionKey || ""), title: String(row.title || ""),
          content: String(row.content || ""), ragSources: Array.isArray(rag) ? rag : [],
          status: String(row.status || "pending"), order: Number(row.sectionOrder || 0),
          wordCount: Number(row.wordCount || 0),
        };
      });
    } catch (e: any) { console.warn("[martyrdom-draft] 섹션 로드 실패", e?.message); }

    /* 검토 이력 (보조 SELECT) */
    let reviews: any[] = [];
    try {
      const rr: any = await db.execute(sql.raw(`
        SELECT r.id, r.assigned_to AS "assignedTo", m.name AS "assignedToName",
               r.status, r.note, r.created_at AS "createdAt", r.decided_at AS "decidedAt"
        FROM martyrdom_reviews r
        LEFT JOIN members m ON m.id = r.assigned_to
        WHERE r.case_id = ${caseId} AND r.output_id = ${outputId}
        ORDER BY r.created_at DESC
      `));
      reviews = (rr?.rows ?? rr ?? []).map((row: any) => ({
        id: Number(row.id), assignedTo: Number(row.assignedTo),
        assignedToName: row.assignedToName ? String(row.assignedToName) : null,
        status: String(row.status || "pending"), note: row.note ? String(row.note) : null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
      }));
    } catch (e: any) { console.warn("[martyrdom-draft] 검토 로드 실패", e?.message); }

    return new Response(jsonKST({
      ok: true, outputId, status: String(draftRow.status || "draft"), outline, sections, reviews,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("draft_load", err);
  }
};
