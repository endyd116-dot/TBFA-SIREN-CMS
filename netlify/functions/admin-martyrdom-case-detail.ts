/**
 * admin-martyrdom-case-detail — 순직 사건 상세 조회
 *
 * GET ?id=N : 사건 1건 + 자료 목록 + AI 산출물 목록
 *             separate query + JS Map (leftJoin 체인 금지)
 *
 * 감사 로그: 사건 조회마다 기록
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";

export const config = { path: "/api/admin-martyrdom-case-detail" };

function jsonOk(data: object) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "GET만 허용" }), { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const { admin, member } = auth.ctx;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    /* ── 1. 사건 기본 정보 ── */
    let caseRow: any = null;
    try {
      const r: any = await db.execute(sql.raw(`
        SELECT
          mc.id, mc.case_no AS "caseNo", mc.case_kind AS "caseKind",
          mc.title, mc.deceased_name AS "deceasedName",
          mc.school_name AS "schoolName", mc.position,
          mc.deceased_at AS "deceasedAt", mc.occurred_summary AS "occurredSummary",
          mc.status, mc.outcome, mc.outcome_note AS "outcomeNote",
          mc.procedure_stage AS "procedureStage",
          mc.next_deadline_at AS "nextDeadlineAt",
          mc.next_deadline_label AS "nextDeadlineLabel",
          mc.extraction_json AS "extractionJson",
          mc.extracted_at AS "extractedAt",
          mc.assigned_admin_id AS "assignedAdminId",
          mc.created_at AS "createdAt", mc.updated_at AS "updatedAt"
        FROM martyrdom_cases mc
        WHERE mc.id = ${id}
        LIMIT 1
      `));
      caseRow = (r?.rows ?? r ?? [])[0] || null;
    } catch (err: any) { return jsonError("select_case", err); }

    if (!caseRow) {
      return new Response(JSON.stringify({ ok: false, error: "사건을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    /* ── 2. 자료 목록 (separate query) ── */
    let documents: any[] = [];
    try {
      const r: any = await db.execute(sql.raw(`
        SELECT
          md.id, md.file_name AS "fileName", md.doc_type AS "docType",
          md.doc_type_auto AS "docTypeAuto", md.doc_summary AS "docSummary",
          md.classify_confidence AS "classifyConfidence",
          md.mime_type AS "mimeType", md.size_bytes AS "sizeBytes",
          md.extract_status AS "extractStatus", md.extract_method AS "extractMethod",
          md.extract_error AS "extractError",
          md.indexed_to_rag AS "indexedToRag", md.blob_key AS "blobKey",
          md.blob_id AS "blobId",
          md.created_at AS "createdAt"
        FROM martyrdom_case_documents md
        WHERE md.case_id = ${id}
        ORDER BY md.created_at ASC
      `));
      const rows = r?.rows ?? r ?? [];
      documents = rows.map((d: any) => ({
        id: Number(d.id),
        fileName: String(d.fileName || ""),
        docType: d.docType ? String(d.docType) : null,
        docTypeAuto: d.docTypeAuto ? String(d.docTypeAuto) : null,
        docSummary: d.docSummary ? String(d.docSummary) : null,
        classifyConfidence: Number(d.classifyConfidence || 0),
        mimeType: d.mimeType ? String(d.mimeType) : null,
        sizeBytes: Number(d.sizeBytes || 0),
        extractStatus: String(d.extractStatus || "pending"),
        extractMethod: d.extractMethod ? String(d.extractMethod) : null,
        extractError: d.extractError ? String(d.extractError) : null,
        indexedToRag: Boolean(d.indexedToRag),
        blobUrl: d.blobId ? `/api/blob-image?id=${d.blobId}` : null,
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      }));
    } catch (err: any) { console.warn("[martyrdom-case-detail] 자료 목록 실패", err?.message); }

    /* ── 3. AI 산출물 목록 (separate query) ── */
    let outputs: any[] = [];
    try {
      const r: any = await db.execute(sql.raw(`
        SELECT
          ao.id, ao.output_type AS "outputType", ao.version,
          ao.content_json AS "contentJson", ao.rag_sources AS "ragSources",
          ao.model_used AS "modelUsed", ao.status,
          ao.reviewed_by AS "reviewedBy", ao.reviewed_at AS "reviewedAt",
          ao.review_note AS "reviewNote",
          ao.created_at AS "createdAt"
        FROM martyrdom_ai_outputs ao
        WHERE ao.case_id = ${id}
        ORDER BY ao.output_type ASC, ao.version DESC
      `));
      const rows = r?.rows ?? r ?? [];
      outputs = rows.map((o: any) => ({
        id: Number(o.id),
        outputType: String(o.outputType || ""),
        version: Number(o.version || 1),
        contentJson: o.contentJson || null,
        ragSources: o.ragSources || [],
        modelUsed: o.modelUsed ? String(o.modelUsed) : null,
        status: String(o.status || "draft"),
        reviewedBy: o.reviewedBy ? Number(o.reviewedBy) : null,
        reviewedAt: o.reviewedAt ? new Date(o.reviewedAt).toISOString() : null,
        reviewNote: o.reviewNote ? String(o.reviewNote) : null,
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
      }));
    } catch (err: any) { console.warn("[martyrdom-case-detail] AI 산출물 목록 실패", err?.message); }

    /* ── 4. 감사 로그: 사건 조회 기록 ── */
    void logAdminAction(req, admin.uid, member.name || String(admin.uid), "martyrdom_case_view", {
      target: String(caseRow.caseNo || id),
      detail: { caseId: id },
    });

    return jsonOk({
      case: {
        id: Number(caseRow.id),
        caseNo: String(caseRow.caseNo || ""),
        caseKind: String(caseRow.caseKind || "active"),
        title: String(caseRow.title || ""),
        deceasedName: caseRow.deceasedName ? String(caseRow.deceasedName) : null,
        schoolName: caseRow.schoolName ? String(caseRow.schoolName) : null,
        position: caseRow.position ? String(caseRow.position) : null,
        deceasedAt: caseRow.deceasedAt ? String(caseRow.deceasedAt).slice(0, 10) : null,
        occurredSummary: caseRow.occurredSummary ? String(caseRow.occurredSummary) : null,
        status: String(caseRow.status || "intake"),
        outcome: caseRow.outcome ? String(caseRow.outcome) : null,
        outcomeNote: caseRow.outcomeNote ? String(caseRow.outcomeNote) : null,
        procedureStage: caseRow.procedureStage ? String(caseRow.procedureStage) : null,
        nextDeadlineAt: caseRow.nextDeadlineAt ? String(caseRow.nextDeadlineAt).slice(0, 10) : null,
        nextDeadlineLabel: caseRow.nextDeadlineLabel ? String(caseRow.nextDeadlineLabel) : null,
        extractionJson: caseRow.extractionJson || null,
        extractedAt: caseRow.extractedAt ? new Date(caseRow.extractedAt).toISOString() : null,
        assignedAdminId: caseRow.assignedAdminId ? Number(caseRow.assignedAdminId) : null,
        createdAt: caseRow.createdAt ? new Date(caseRow.createdAt).toISOString() : null,
        updatedAt: caseRow.updatedAt ? new Date(caseRow.updatedAt).toISOString() : null,
      },
      documents,
      outputs,
    });
  } catch (err: any) {
    return jsonError("main", err);
  }
};
