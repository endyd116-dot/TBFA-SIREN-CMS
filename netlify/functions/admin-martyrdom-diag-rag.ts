/**
 * GET /api/admin-martyrdom-diag-rag — R44 BUG-A 1회용 진단 (readonly)
 *
 * 딥릴리프 자료 추출·색인 흐름 진단:
 *   1) martyrdom_case_documents extract_status 분포
 *   2) indexed_to_rag 합산
 *   3) ai_rag_documents에서 martyr_* source_type별 count
 *   4) 최근 실패·미색인 자료 10건 (id·fileName·extract_error·status)
 *   5) 최근 자료 10건 상태 (id·fileName·status·indexedToRag·summaryLen·updatedAt)
 *   6) env 설정 여부 (INTERNAL_TRIGGER_SECRET·GEMINI_EMBED_*·GEMINI_API_KEY)
 *
 * 진단 후 즉시 파일 삭제 (1회용 보안 원칙·§6.8).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-martyrdom-diag-rag" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonErr(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "진단 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: JSON_HEADER });
}

export default async function handler(req: Request, _ctx: Context) {
  let step = "auth";
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "select_status_dist";
    const statusDist: any = await db.execute(sql.raw(`
      SELECT COALESCE(extract_status, 'NULL') AS "status", COUNT(*)::int AS n
        FROM martyrdom_case_documents
       GROUP BY 1
       ORDER BY n DESC
    `));

    step = "select_rag_flag";
    const ragFlag: any = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE indexed_to_rag = true)::int  AS "indexedTrue",
        COUNT(*) FILTER (WHERE indexed_to_rag = false)::int AS "indexedFalse",
        COUNT(*) FILTER (WHERE indexed_to_rag IS NULL)::int AS "indexedNull",
        COUNT(*)::int                                       AS "total"
        FROM martyrdom_case_documents
    `));

    step = "select_rag_by_type";
    const ragByType: any = await db.execute(sql.raw(`
      SELECT source_type AS "sourceType", COUNT(*)::int AS n,
             MAX(created_at) AS "lastCreatedAt"
        FROM ai_rag_documents
       WHERE source_type LIKE 'martyr%'
       GROUP BY 1
       ORDER BY n DESC
    `));

    step = "select_recent_fails";
    const recentFails: any = await db.execute(sql.raw(`
      SELECT id,
             COALESCE(file_name, '(no name)') AS "fileName",
             extract_status AS "extractStatus",
             COALESCE(extract_error, '') AS "extractError",
             indexed_to_rag AS "indexedToRag",
             updated_at AS "updatedAt",
             case_id AS "caseId"
        FROM martyrdom_case_documents
       WHERE extract_status IN ('failed','queued','processing')
          OR (extract_status = 'done' AND indexed_to_rag IS NOT TRUE)
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 10
    `));

    step = "select_recent_docs";
    const recentDocs: any = await db.execute(sql.raw(`
      SELECT id,
             COALESCE(file_name, '(no name)') AS "fileName",
             extract_status AS "extractStatus",
             indexed_to_rag AS "indexedToRag",
             LENGTH(COALESCE(doc_summary, '')) AS "summaryLen",
             COALESCE(extract_error, '') AS "extractError",
             case_id AS "caseId",
             updated_at AS "updatedAt"
        FROM martyrdom_case_documents
       ORDER BY id DESC
       LIMIT 10
    `));

    step = "env";
    const envStatus = {
      INTERNAL_TRIGGER_SECRET_set: !!process.env.INTERNAL_TRIGGER_SECRET,
      INTERNAL_TRIGGER_SECRET_len: process.env.INTERNAL_TRIGGER_SECRET?.length || 0,
      GEMINI_API_KEY_set:          !!process.env.GEMINI_API_KEY,
      GEMINI_EMBED_MODEL:          process.env.GEMINI_EMBED_MODEL || "(unset → text-embedding-004 fallback)",
      GEMINI_EMBED_OUTPUT_DIM:     process.env.GEMINI_EMBED_OUTPUT_DIM || "(unset)",
    };

    step = "site_url";
    /* extract-background 호출 base URL 후보 — Netlify SITE_URL 또는 URL */
    const siteUrl = process.env.SITE_URL || process.env.URL || "(neither SITE_URL nor URL set)";

    return new Response(JSON.stringify({
      ok: true,
      statusDist: (statusDist?.rows ?? statusDist ?? []),
      ragFlag:    (ragFlag?.rows ?? ragFlag ?? [])[0] || {},
      ragByType:  (ragByType?.rows ?? ragByType ?? []),
      recentFails:(recentFails?.rows ?? recentFails ?? []),
      recentDocs: (recentDocs?.rows ?? recentDocs ?? []),
      envStatus,
      siteUrl,
      hint: "진단 후 이 파일 즉시 삭제 + commit. (§6.8 1회용 보안)",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return jsonErr(step, err);
  }
}
