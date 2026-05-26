/**
 * admin-martyrdom-extract-background — 자료 자동 추출·분류·RAG 색인 체인
 *
 * Netlify Background Function (suffix -background, 응답 즉시 202·최대 15분)
 *
 * POST { docId, secret, reindex? }
 *   secret   : INTERNAL_TRIGGER_SECRET (fail-closed)
 *   reindex  : true → 기존 RAG 청크 삭제 후 재색인 (doc-reclassify에서 수동 텍스트 입력 시)
 *
 * 자동 체인:
 *   R2 다운로드 → extractDocText → 분류(classifyDocument) → 청킹·임베딩
 *   → ai_rag_documents UPSERT (martyr_active, case_id 격리)
 *   → extract_status 갱신 + 알림 (담당 어드민·super_admin)
 *   → 사건 active이면 analyze-background 트리거
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { downloadFromR2 } from "../../lib/r2-server";
import { extractDocText } from "../../lib/ai-ocr";
import { classifyDocument } from "../../lib/martyrdom-ai";
import { embedText } from "../../lib/ai-embedding";

export const config = { path: "/api/admin-martyrdom-extract-background" };

const MAX_CHUNK_CHARS = 1200;

/* ── 청킹 ── */
function chunkText(text: string, sourceRef: string): Array<{ title: string; content: string; sourceRef: string }> {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Array<{ title: string; content: string; sourceRef: string }> = [];
  let buf = "";
  let idx = 0;

  function flush() {
    const content = buf.trim();
    if (content.length < 30) return;
    chunks.push({ title: sourceRef, content, sourceRef: `${sourceRef}#${idx++}` });
    buf = "";
  }

  for (const para of paragraphs) {
    if (buf.length + para.length > MAX_CHUNK_CHARS && buf.length > 0) {
      flush();
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  flush();

  return chunks;
}

/* ── analyze-background 트리거 (await로 요청 전송 보장·5313ce8) ── */
async function triggerAnalyze(caseId: number): Promise<void> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-analyze-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, secret }),
    });
  } catch (err: any) {
    console.warn("[martyrdom-analyze trigger]", err?.message || err);
  }
}

/* ── 어드민 알림 (DB insert — console fallback) ── */
async function notifyAdmins(caseId: number, assignedAdminId: number | null, msg: string) {
  try {
    /* assigned admin + super_admin에게 알림 */
    const targets: number[] = [];
    if (assignedAdminId) targets.push(assignedAdminId);

    /* super_admin 목록 조회 */
    const saRes: any = await db.execute(sql.raw(`
      SELECT id FROM members WHERE role = 'super_admin' AND operator_active = true LIMIT 5
    `));
    const superAdmins: number[] = (saRes?.rows ?? saRes ?? []).map((r: any) => Number(r.id));
    for (const uid of superAdmins) {
      if (!targets.includes(uid)) targets.push(uid);
    }

    if (targets.length === 0) return;
    const safeMsg = msg.replace(/'/g, "''").slice(0, 500);
    const values = targets
      .map(uid => `(${uid}, 'admin', 'system', '순직 지원', '${safeMsg}', 'martyrdom_cases', ${caseId}, NOW())`)
      .join(",");

    await db.execute(sql.raw(`
      INSERT INTO notifications
        (recipient_id, recipient_type, category, title, message, ref_table, ref_id, created_at)
      VALUES ${values}
    `));
  } catch (err) {
    /* 알림 실패는 조용히 넘김 */
    console.warn("[martyrdom-extract] 알림 실패", (err as any)?.message);
  }
}

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

  const docId = Number(body?.docId || 0);
  if (!docId) {
    return new Response(JSON.stringify({ ok: false, error: "docId 필수" }), { status: 400 });
  }
  const reindex = Boolean(body?.reindex);

  console.info(`[martyrdom-extract-bg] start docId=${docId} reindex=${reindex}`);

  try {
    /* ── 1. 문서 정보 조회 ── */
    const docRes: any = await db.execute(sql.raw(`
      SELECT
        md.id, md.case_id AS "caseId", md.blob_key AS "blobKey",
        md.mime_type AS "mimeType", md.file_name AS "fileName",
        md.extracted_text AS "extractedText",
        md.extract_method AS "extractMethod",
        mc.case_kind AS "caseKind", mc.assigned_admin_id AS "assignedAdminId",
        mc.status AS "caseStatus"
      FROM martyrdom_case_documents md
      JOIN martyrdom_cases mc ON mc.id = md.case_id
      WHERE md.id = ${docId}
      LIMIT 1
    `));
    const doc = (docRes?.rows ?? docRes ?? [])[0];
    if (!doc) {
      console.warn(`[martyrdom-extract-bg] docId=${docId} 없음`);
      return new Response(JSON.stringify({ ok: false, error: "문서 없음" }), { status: 404 });
    }

    const caseId = Number(doc.caseId);
    const blobKey = String(doc.blobKey || "");
    const mimeType = String(doc.mimeType || "application/octet-stream");
    const fileName = String(doc.fileName || "");
    const assignedAdminId = doc.assignedAdminId ? Number(doc.assignedAdminId) : null;
    const caseKind = String(doc.caseKind || "active");

    /* extract_status → processing (프론트 폴링·배지와 동일 어휘·§1 enum) */
    await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
      SET extract_status = 'processing', updated_at = NOW()
      WHERE id = ${docId}
    `));

    /* ── 2. 텍스트 추출 (수동 입력 있으면 스킵) ── */
    let text = "";
    let extractMethod = "";
    let extractError: string | null = null;

    const hasManualText = doc.extractMethod === "manual" && doc.extractedText && String(doc.extractedText).length >= 10;

    if (hasManualText) {
      text = String(doc.extractedText);
      extractMethod = "manual";
      console.info(`[martyrdom-extract-bg] docId=${docId} 수동 텍스트 사용 (${text.length}자)`);
    } else if (blobKey) {
      /* R2에서 다운로드 */
      const bytes = await downloadFromR2(blobKey);
      if (!bytes || bytes.length === 0) {
        await markFailed(docId, "R2 다운로드 실패 — 파일 없음");
        await notifyAdmins(caseId, assignedAdminId, `[순직 자료 추출 실패] ${fileName} — R2 파일 없음`);
        return new Response(JSON.stringify({ ok: false, error: "R2 다운로드 실패" }), { status: 500 });
      }

      const base64 = Buffer.from(bytes).toString("base64");
      const ocr = await extractDocText({ base64, mimeType, fileName });
      text = ocr.text;
      extractMethod = ocr.method;
      if (ocr.error) {
        extractError = ocr.error.slice(0, 1000);
        console.warn(`[martyrdom-extract-bg] docId=${docId} OCR 경고: ${ocr.error}`);
      }
    } else {
      await markFailed(docId, "blob_key 없음");
      return new Response(JSON.stringify({ ok: false, error: "blob_key 없음" }), { status: 400 });
    }

    /* 텍스트 미추출 → failed (수동 입력 유도) */
    if (!text || text.length < 10) {
      const errMsg = extractError || "텍스트 추출 불가 (수동 입력 필요)";
      await db.execute(sql.raw(`
        UPDATE martyrdom_case_documents
        SET extract_status = 'failed',
            extract_method = '${extractMethod.replace(/'/g, "''")}',
            extract_error  = '${errMsg.replace(/'/g, "''")}',
            updated_at     = NOW()
        WHERE id = ${docId}
      `));
      await notifyAdmins(caseId, assignedAdminId, `[순직 자료 추출 실패] ${fileName} — ${errMsg}`);
      console.warn(`[martyrdom-extract-bg] docId=${docId} 추출 실패: ${errMsg}`);
      return new Response(JSON.stringify({ ok: false, docId, error: errMsg }));
    }

    /* ── 3. 자동 분류 (텍스트·이미지 분기) ── */
    let docTypeAuto = "other";
    let docSummary: string | null = null;
    let classifyConfidence = 0;

    try {
      const isImage = mimeType.startsWith("image/") || (mimeType === "application/pdf" && extractMethod === "gemini_ocr");
      const bytes2 = isImage && blobKey ? await downloadFromR2(blobKey) : null;
      const imageBase64 = bytes2 ? Buffer.from(bytes2).toString("base64") : undefined;

      const classified = await classifyDocument({
        text: text.slice(0, 8000),
        imageBase64,
        mimeType,
        fileName,
      });
      docTypeAuto = classified.docType;
      docSummary = classified.summary;
      classifyConfidence = classified.confidence;
    } catch (classErr: any) {
      console.warn(`[martyrdom-extract-bg] docId=${docId} 분류 실패: ${classErr?.message}`);
    }

    /* ── 4. extracted_text + 분류 결과 저장 ── */
    const safeText = text.slice(0, 100000).replace(/'/g, "''");
    const safeMethod = extractMethod.replace(/'/g, "''");
    const safeSummary = docSummary ? `'${docSummary.slice(0, 500).replace(/'/g, "''")}'` : "NULL";
    const safeErrCol = extractError ? `'${extractError.replace(/'/g, "''")}'` : "NULL";

    await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
      SET extracted_text        = '${safeText}',
          extract_method        = '${safeMethod}',
          doc_type_auto         = '${docTypeAuto}',
          doc_summary           = ${safeSummary},
          classify_confidence   = ${classifyConfidence},
          extract_error         = ${safeErrCol},
          updated_at            = NOW()
      WHERE id = ${docId}
    `));

    /* ── 5. RAG 청킹·임베딩 UPSERT (§1.2: active→martyr_active / reference→martyr_case·둘 다 case_id 격리) ── */
    let indexedCount = 0;
    const ragSourceType = caseKind === "reference" ? "martyr_case" : "martyr_active";

    /* reindex 시 기존 청크 삭제 */
    if (reindex) {
      await db.execute(sql.raw(`
        DELETE FROM ai_rag_documents
        WHERE source_type = '${ragSourceType}'
          AND case_id = ${caseId}
          AND source_ref LIKE 'doc-${docId}#%'
      `));
    }

    const sourceRef = `doc-${docId}`;
    const chunks = chunkText(text, sourceRef);

    for (const chunk of chunks) {
      try {
        const embedding = await embedText(chunk.content);
        const vecLiteral = `[${embedding.join(",")}]`;
        const safeContent = chunk.content.replace(/'/g, "''").slice(0, 4000);
        const safeTitle = chunk.title.replace(/'/g, "''").slice(0, 200);
        const safeChunkRef = chunk.sourceRef.replace(/'/g, "''").slice(0, 200);

        await db.execute(sql.raw(`
          INSERT INTO ai_rag_documents
            (source_type, source_ref, case_id, title, content, embedding, created_at)
          VALUES
            ('${ragSourceType}', '${safeChunkRef}', ${caseId},
             '${safeTitle}', '${safeContent}',
             '${vecLiteral}'::vector, NOW())
          ON CONFLICT (source_type, source_ref)
          DO UPDATE SET
            content   = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            case_id   = EXCLUDED.case_id,
            title     = EXCLUDED.title
        `));
        indexedCount++;
      } catch (embedErr: any) {
        console.warn(`[martyrdom-extract-bg] 청크 임베딩 실패 ${chunk.sourceRef}: ${embedErr?.message}`);
      }
    }

    /* ── 6. extract_status = 'done' + indexed_to_rag = true ── */
    await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
      SET extract_status = 'done',
          indexed_to_rag = true,
          updated_at     = NOW()
      WHERE id = ${docId}
    `));

    /* ── 7. 완료 알림 ── */
    await notifyAdmins(
      caseId,
      assignedAdminId,
      `[순직 자료 추출 완료] ${fileName} — 분류: ${docTypeAuto}, 청크 ${indexedCount}개 색인`,
    );

    /* ── 8. active 사건이면 analyze-background 트리거 (await로 전송 보장) ── */
    if (caseKind === "active") {
      await triggerAnalyze(caseId);
    }

    console.info(`[martyrdom-extract-bg] done docId=${docId} chunks=${indexedCount} docType=${docTypeAuto}`);
    return new Response(JSON.stringify({
      ok: true, docId, caseId, docTypeAuto, indexedCount,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error(`[martyrdom-extract-bg] docId=${docId} 예외:`, err?.message, err?.stack);
    await markFailed(docId, String(err?.message || err).slice(0, 500)).catch(() => {});
    return new Response(JSON.stringify({
      ok: false, error: String(err?.message || err).slice(0, 300),
    }), { status: 500 });
  }
};

async function markFailed(docId: number, reason: string) {
  const safeReason = reason.replace(/'/g, "''").slice(0, 1000);
  await db.execute(sql.raw(`
    UPDATE martyrdom_case_documents
    SET extract_status = 'failed', extract_error = '${safeReason}', updated_at = NOW()
    WHERE id = ${docId}
  `));
}
