/**
 * admin-martyrdom-doc-delete — 순직 사건 자료 삭제 (개별 + 전체)
 *
 * DELETE /api/admin-martyrdom-doc-delete?docId=N        → 자료 1건 삭제
 * DELETE /api/admin-martyrdom-doc-delete?caseId=N&all=1 → 사건의 모든 자료 삭제(처음부터 다시)
 *
 * 각 자료 삭제 시: R2 원본 객체 + RAG 색인 청크(ai_rag_documents) + blob_uploads 행 + 자료 행
 * (사건 자체는 유지 — 자료만 비움. 분석 산출물은 자료 없으면 의미 없으나 별도 정리 안 함.)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { deleteFromR2 } from "../../lib/r2-delete";

export const config = { path: "/api/admin-martyrdom-doc-delete" };

function json(body: any, status = 200) {
  return new Response(jsonKST(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

/** 자료 한 건의 부수 자원 삭제(R2 + RAG 청크 + blob_uploads). 실패해도 계속(행 삭제가 핵심). */
async function purgeDocResources(docId: number, blobKey: string | null, blobId: number | null) {
  if (blobKey) {
    try { await deleteFromR2(blobKey); } catch (e) { console.warn("[martyrdom-doc-delete] R2", (e as any)?.message); }
  }
  /* RAG 청크 — source_ref = 'doc-{id}#{idx}' (# 구분자로 doc-1 / doc-10 충돌 없음) */
  try {
    await db.execute(sql.raw(`DELETE FROM ai_rag_documents WHERE source_ref LIKE 'doc-${docId}#%'`));
  } catch (e) { console.warn("[martyrdom-doc-delete] rag", (e as any)?.message); }
  if (blobId) {
    try { await db.execute(sql.raw(`DELETE FROM blob_uploads WHERE id = ${blobId}`)); }
    catch (e) { console.warn("[martyrdom-doc-delete] blob_uploads", (e as any)?.message); }
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "DELETE") {
    return json({ ok: false, error: "DELETE만 허용" }, 405);
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const docId = Number(url.searchParams.get("docId") || 0);
  const caseId = Number(url.searchParams.get("caseId") || 0);
  const all = url.searchParams.get("all") === "1";

  try {
    /* ── 전체 삭제: 사건의 모든 자료 ── */
    if (all && caseId) {
      const rowsRes: any = await db.execute(sql.raw(`
        SELECT id, blob_key AS "blobKey", blob_id AS "blobId"
        FROM martyrdom_case_documents WHERE case_id = ${caseId}
      `));
      const rows = (rowsRes?.rows ?? rowsRes ?? []) as any[];

      for (const r of rows) {
        await purgeDocResources(Number(r.id), r.blobKey ? String(r.blobKey) : null, r.blobId ? Number(r.blobId) : null);
      }
      /* 혹시 누락된 사건 RAG 청크까지 정리(case_id 격리·법령 시드 martyr_law는 보존) */
      try {
        await db.execute(sql.raw(`
          DELETE FROM ai_rag_documents
          WHERE case_id = ${caseId} AND source_type IN ('martyr_active','martyr_case')
        `));
      } catch (e) { console.warn("[martyrdom-doc-delete] rag bulk", (e as any)?.message); }

      await db.execute(sql.raw(`DELETE FROM martyrdom_case_documents WHERE case_id = ${caseId}`));
      return json({ ok: true, mode: "all", caseId, deleted: rows.length });
    }

    /* ── 개별 삭제 ── */
    if (!docId) return json({ ok: false, error: "docId 또는 caseId&all=1 필수" }, 400);

    const docRes: any = await db.execute(sql.raw(`
      SELECT id, blob_key AS "blobKey", blob_id AS "blobId"
      FROM martyrdom_case_documents WHERE id = ${docId} LIMIT 1
    `));
    const doc = (docRes?.rows ?? docRes ?? [])[0];
    if (!doc) return json({ ok: false, error: "문서를 찾을 수 없습니다" }, 404);

    await purgeDocResources(docId, doc.blobKey ? String(doc.blobKey) : null, doc.blobId ? Number(doc.blobId) : null);
    await db.execute(sql.raw(`DELETE FROM martyrdom_case_documents WHERE id = ${docId}`));

    return json({ ok: true, mode: "single", docId });
  } catch (err: any) {
    return json({
      ok: false, error: "삭제 실패",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }, 500);
  }
};
