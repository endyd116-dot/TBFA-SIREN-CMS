/**
 * admin-martyrdom-doc-reclassify — 자료 수동 재분류
 *
 * PATCH { docId, docType?, extractedText? }
 *   docType      : 운영자 수동 유형 지정 (8개 중 택1)
 *   extractedText: 운영자 수동 텍스트 입력 (hwp 등 자동추출 불가 파일)
 *   → { ok, docId, docType, extractMethod: "manual" }
 *
 * extractedText 제공 시 → extract_method='manual', 텍스트 재청킹·임베딩 트리거
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { MARTYRDOM_DOC_TYPES } from "../../lib/martyrdom-ai";

export const config = { path: "/api/admin-martyrdom-doc-reclassify" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

/* background 호출은 await로 요청 전송을 보장(미await 시 함수 종료로 fetch가 취소됨·5313ce8). */
async function triggerExtract(docId: number): Promise<void> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-extract-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId, secret, reindex: true }),
    });
  } catch (err: any) {
    console.warn("[martyrdom-reextract trigger]", err?.message || err);
  }
}

const VALID_DOC_TYPES = Object.keys(MARTYRDOM_DOC_TYPES);

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "PATCH") {
    return new Response(JSON.stringify({ ok: false, error: "PATCH만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "요청 본문 파싱 실패" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const docId = Number(body.docId);
  if (!docId) {
    return new Response(JSON.stringify({ ok: false, error: "docId 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const docType = body.docType ? String(body.docType) : null;
  const extractedText = body.extractedText ? String(body.extractedText).slice(0, 200000) : null;

  if (docType && !VALID_DOC_TYPES.includes(docType)) {
    return new Response(JSON.stringify({
      ok: false,
      error: `유효하지 않은 docType. 허용: ${VALID_DOC_TYPES.join(", ")}`,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (!docType && !extractedText) {
    return new Response(JSON.stringify({ ok: false, error: "docType 또는 extractedText 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    /* 문서 존재 확인 */
    const docRes: any = await db.execute(sql.raw(`
      SELECT id, doc_type AS "docType", extract_method AS "extractMethod"
      FROM martyrdom_case_documents
      WHERE id = ${docId}
      LIMIT 1
    `));
    const doc = (docRes?.rows ?? docRes ?? [])[0];
    if (!doc) {
      return new Response(JSON.stringify({ ok: false, error: "문서를 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const sets: string[] = ["updated_at = NOW()"];

    if (docType) {
      sets.push(`doc_type = '${docType}'`);
      sets.push(`doc_type_auto = '${docType}'`);
    }

    if (extractedText) {
      /* 수동 입력 텍스트 → extract_method=manual, 상태 재처리 대기 */
      const safeText = extractedText.replace(/'/g, "''");
      sets.push(`extracted_text = '${safeText}'`);
      sets.push(`extract_method = 'manual'`);
      sets.push(`extract_status = 'processing'`);
    } else if (docType) {
      /* 유형만 변경 — 텍스트는 그대로, 상태 유지 */
    }

    await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
      SET ${sets.join(", ")}
      WHERE id = ${docId}
    `));

    /* 수동 텍스트 제공 시 RAG 재청킹·임베딩 트리거 (await로 전송 보장) */
    if (extractedText) {
      await triggerExtract(docId);
    }

    const finalDocType = docType || String(doc.docType || "other");

    return new Response(JSON.stringify({
      ok: true,
      docId,
      docType: finalDocType,
      extractMethod: extractedText ? "manual" : String(doc.extractMethod || "pending"),
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("reclassify", err);
  }
};
