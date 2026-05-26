/**
 * admin-martyrdom-draft-section — 섹션 본문 편집 (§P3.2)
 *
 * PATCH { sectionId, content }
 *   운영자가 textarea 편집 저장 → status='edited', word_count 갱신.
 *
 * 응답: { ok, section:{ id, sectionKey, title, content, ragSources, status, wordCount } }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-draft-section" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function badRequest(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH") {
    return new Response(JSON.stringify({ ok: false, error: "PATCH만 허용" }), { status: 405 });
  }
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  let body: any;
  try { body = await req.json(); } catch { return badRequest("요청 본문 파싱 실패"); }
  const sectionId = Number(body.sectionId);
  if (!sectionId) return badRequest("sectionId 필수");
  if (body.content === undefined || body.content === null) return badRequest("content 필수");

  const content = String(body.content);
  const wordCount = content.length;

  try {
    const exists: any = await db.execute(sql.raw(`SELECT id FROM martyrdom_draft_sections WHERE id = ${sectionId} LIMIT 1`));
    if (!(exists?.rows ?? exists ?? []).length) {
      return new Response(JSON.stringify({ ok: false, error: "섹션을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    await db.execute(sql.raw(`
      UPDATE martyrdom_draft_sections
      SET content = '${content.replace(/'/g, "''")}', status = 'edited', word_count = ${wordCount}, updated_at = NOW()
      WHERE id = ${sectionId}
    `));

    const r: any = await db.execute(sql.raw(`
      SELECT id, section_key AS "sectionKey", title, content, rag_sources AS "ragSources", status, word_count AS "wordCount"
      FROM martyrdom_draft_sections WHERE id = ${sectionId} LIMIT 1
    `));
    const row = (r?.rows ?? r ?? [])[0];
    let ragSources: any[] = [];
    if (row?.ragSources) {
      try { ragSources = typeof row.ragSources === "string" ? JSON.parse(row.ragSources) : row.ragSources; } catch { ragSources = []; }
    }

    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_draft_section_edit", {
      target: String(sectionId), detail: { wordCount },
    });

    return new Response(JSON.stringify({
      ok: true,
      section: {
        id: Number(row.id), sectionKey: String(row.sectionKey || ""), title: String(row.title || ""),
        content: String(row.content || ""), ragSources: Array.isArray(ragSources) ? ragSources : [],
        status: String(row.status || "edited"), wordCount: Number(row.wordCount || 0),
      },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("section_edit", err);
  }
};
