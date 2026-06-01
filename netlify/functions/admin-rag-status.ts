/**
 * GET  /api/admin-rag-status — 색인 현황 조회
 * POST /api/admin-rag-status — body: { query } → 검색 테스트 top-K
 * super_admin 전용
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { searchRag } from "../../lib/ai-embedding";
import { checkFeatureBeforeCall } from "../../lib/ai-feature";

export const config = { path: "/api/admin-rag-status" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false,
    error: "RAG 상태 조회 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status, headers: JSON_HEADER });
}

export default async function handler(req: Request, ctx: Context) {
  let step = "auth";
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    /* ── GET ?diag=models: 이 API 키로 쓸 수 있는 임베딩 모델 조회 (404 진단용) ── */
    if (req.method === "GET" && new URL(req.url).searchParams.get("diag") === "models") {
      step = "diag_models";
      const key = process.env.GEMINI_API_KEY || "";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1000`);
      const j: any = await r.json().catch(() => ({}));
      const all: any[] = j?.models ?? [];
      const embedModels = all
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("embedContent"))
        .map((m: any) => m.name);
      /* 생성(generateContent) 가능 모델 — AI 비서 체인 모델명 검증용 (gemini-* 만 노출) */
      const genModels = all
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter((n: string) => n.startsWith("gemini"));
      return new Response(JSON.stringify({
        ok: true,
        data: {
          httpStatus: r.status,
          totalModels: all.length,
          embedModels,                                  // ← 이 중 하나를 GEMINI_EMBED_MODEL에 설정
          genModels,                                    // ← AI 비서 모델 체인 검증용
          currentModel: process.env.GEMINI_EMBED_MODEL || "text-embedding-004",
          apiError: j?.error?.message || null,
        },
      }), { headers: JSON_HEADER });
    }

    /* ── GET: 색인 현황 ── */
    if (req.method === "GET") {
      step = "select_status";

      let total = 0;
      const byType: Record<string, number> = {};
      let lastIndexedAt: string | null = null;
      let enabled = true;

      try {
        /* source_type별 문서 수 + 전체 합계 */
        const countR: any = await db.execute(sql`
          SELECT source_type, COUNT(*)::int AS cnt
          FROM ai_rag_documents
          GROUP BY source_type
        `);
        const countRows: any[] = countR?.rows ?? countR ?? [];
        for (const row of countRows) {
          const t = String(row.source_type);
          const c = Number(row.cnt);
          byType[t] = c;
          total += c;
        }

        /* 최근 색인 시각 */
        const lastR: any = await db.execute(sql`
          SELECT MAX(updated_at) AS last_at FROM ai_rag_documents
        `);
        const lastRow = (lastR?.rows ?? lastR ?? [])[0];
        if (lastRow?.last_at) lastIndexedAt = new Date(lastRow.last_at).toISOString();
      } catch {
        /* 테이블 없으면(마이그 전) 0 반환 */
      }

      /* featureKey 활성 여부 */
      try {
        const featureR: any = await db.execute(sql`
          SELECT enabled FROM ai_feature_settings WHERE feature_key = 'ai_rag_search' LIMIT 1
        `);
        const featureRow = (featureR?.rows ?? featureR ?? [])[0];
        if (featureRow) enabled = featureRow.enabled !== false;
      } catch { /* 마이그 전 — 기본 true */ }

      return new Response(JSON.stringify({
        ok: true,
        data: { total, byType, lastIndexedAt, enabled },
      }), { headers: JSON_HEADER });
    }

    /* ── POST: 검색 테스트 ── */
    if (req.method === "POST") {
      step = "embed_query";
      let body: any = {};
      try { body = await req.json(); } catch { /* */ }

      const query = String(body?.query || "").trim();
      if (!query) {
        return new Response(JSON.stringify({ ok: false, error: "query 필드 필요" }), { status: 400, headers: JSON_HEADER });
      }

      /* featureKey 체크 (OFF여도 테스트는 허용 — admin 도구이므로) */
      step = "search";
      /* AI 비서 RAG 진단 — 일반 코퍼스(qna·manual)만(순직 민감 자료 격리·AI 비서 실제 검색 범위와 일치) */
      const hits = await searchRag(query, 5, ["qna", "manual"]);

      step = "map";
      const mapped = hits.map(h => ({
        title: h.title || h.sourceRef,
        sourceType: h.sourceType,
        sourceRef: h.sourceRef,
        score: Math.round(h.score * 1000) / 1000,
        snippet: h.content.slice(0, 150),
      }));

      return new Response(JSON.stringify({
        ok: true,
        data: { hits: mapped },
      }), { headers: JSON_HEADER });
    }

    return new Response(JSON.stringify({ ok: false, error: "GET·POST만 허용" }), { status: 405, headers: JSON_HEADER });

  } catch (err: any) {
    return jsonError(step, err);
  }
}
