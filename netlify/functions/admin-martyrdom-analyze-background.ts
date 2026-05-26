/**
 * admin-martyrdom-analyze-background — 사건 구조 AI 분석
 *
 * Netlify Background Function (suffix -background, 응답 즉시 202·최대 15분)
 *
 * POST { caseId, secret }
 *   → 사건의 모든 추출된 자료를 수집
 *   → extractCaseStructure (RAG 기반·§2.5 JSON)
 *   → martyrdom_cases.extraction_json 갱신
 *   → martyrdom_ai_outputs 행 UPSERT (output_type='extraction', version++)
 *   → { ok, caseId, outputId }
 *
 * extract-background에서 자동 호출 + admin-martyrdom-reanalyze에서 수동 호출
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { extractCaseStructure } from "../../lib/martyrdom-ai";

/* ⚠️ 백그라운드 함수(-background)는 config.path 금지 (2026-05-26 자동체인 멈춤 근본 원인·extract-bg 참고) */

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}

  /* ── 인증 (fail-closed) ── */
  const secret = String(body?.secret || "");
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "권한 없음" }), { status: 403 });
  }

  const caseId = Number(body?.caseId || 0);
  if (!caseId) {
    return new Response(JSON.stringify({ ok: false, error: "caseId 필수" }), { status: 400 });
  }

  console.info(`[martyrdom-analyze-bg] start caseId=${caseId}`);

  try {
    /* ── 1. 사건 존재 확인 ── */
    const caseRes: any = await db.execute(sql.raw(`
      SELECT id, case_no AS "caseNo", status, case_kind AS "caseKind" FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
    `));
    const mc = (caseRes?.rows ?? caseRes ?? [])[0];
    if (!mc) {
      console.warn(`[martyrdom-analyze-bg] caseId=${caseId} 없음`);
      return new Response(JSON.stringify({ ok: false, error: "사건 없음" }), { status: 404 });
    }

    /* ── 2. 추출 완료된 자료 수집 ── */
    const docsRes: any = await db.execute(sql.raw(`
      SELECT
        doc_type AS "docType",
        doc_type_auto AS "docTypeAuto",
        doc_summary AS "docSummary",
        file_name AS "fileName",
        extracted_text AS "extractedText"
      FROM martyrdom_case_documents
      WHERE case_id = ${caseId}
        AND extract_status = 'done'
        AND extracted_text IS NOT NULL
      ORDER BY created_at ASC
    `));
    const docs = (docsRes?.rows ?? docsRes ?? []).map((d: any) => ({
      docType: String(d.docType || d.docTypeAuto || "other"),
      summary: String(d.docSummary || ""),
      fileName: String(d.fileName || ""),
      extractedText: d.extractedText ? String(d.extractedText) : undefined,
    }));

    if (docs.length === 0) {
      console.info(`[martyrdom-analyze-bg] caseId=${caseId} 추출 완료 자료 없음 — 스킵`);
      return new Response(JSON.stringify({ ok: true, caseId, skipped: true, reason: "추출 완료 자료 없음" }));
    }

    /* ── 3. 사건 구조 추출 (§2.5) — reference 사건만 recognitionPattern 추출 ── */
    const extraction = await extractCaseStructure(caseId, docs, String(mc.caseKind || "active"));

    /* ── 4. martyrdom_cases.extraction_json 갱신 ── */
    const safeJson = JSON.stringify(extraction).replace(/'/g, "''");
    await db.execute(sql.raw(`
      UPDATE martyrdom_cases
      SET extraction_json = '${safeJson}'::jsonb,
          extracted_at   = NOW(),
          updated_at     = NOW()
      WHERE id = ${caseId}
    `));

    /* ── 5. martyrdom_ai_outputs UPSERT (version 자동 증가) ── */
    const versionRes: any = await db.execute(sql.raw(`
      SELECT COALESCE(MAX(version), 0) AS v
      FROM martyrdom_ai_outputs
      WHERE case_id = ${caseId} AND output_type = 'extraction'
    `));
    const nextVersion = Number((versionRes?.rows ?? versionRes ?? [])[0]?.v || 0) + 1;

    const outputInserted: any = await db.execute(sql.raw(`
      INSERT INTO martyrdom_ai_outputs
        (case_id, output_type, version, content_json, model_used, status, created_at)
      VALUES
        (${caseId}, 'extraction', ${nextVersion},
         '${safeJson}'::jsonb,
         '${(process.env.GEMINI_MODEL_PRO || "gemini-3-flash").replace(/'/g, "''")}',
         'draft', NOW())
      RETURNING id
    `));
    const outputId = Number((outputInserted?.rows ?? outputInserted ?? [])[0]?.id || 0);

    console.info(`[martyrdom-analyze-bg] done caseId=${caseId} outputId=${outputId} v=${nextVersion} confidence=${extraction.confidence}`);
    return new Response(JSON.stringify({
      ok: true, caseId, outputId, version: nextVersion,
      confidence: extraction.confidence,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error(`[martyrdom-analyze-bg] caseId=${caseId} 예외:`, err?.message, err?.stack);
    return new Response(JSON.stringify({
      ok: false, error: String(err?.message || err).slice(0, 300),
    }), { status: 500 });
  }
};
