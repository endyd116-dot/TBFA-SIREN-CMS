/**
 * admin-martyrdom-doc-register — 업로드 완료 신고 + 추출 트리거
 *
 * POST { docId }
 *   → blob_uploads.upload_status = 'completed'
 *   → martyrdom_case_documents.extract_status = 'queued'
 *   → admin-martyrdom-extract-background 트리거 (fire-and-forget)
 *   → { ok, docId, extractQueued: true }
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { blobUploads } from "../../db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-doc-register" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

/* background 호출은 await로 요청 전송을 보장(미await 시 함수 종료로 fetch가 취소됨·5313ce8).
   -background 함수는 호출 즉시 202를 반환하고 실제 처리는 15분 한도로 계속 실행. */
async function triggerExtract(docId: number): Promise<{ bgStatus: number; bgError?: string }> {
  const base = process.env.URL || process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;
  const secret = process.env.INTERNAL_TRIGGER_SECRET || "";
  try {
    const resp = await fetch(`${baseUrl}/.netlify/functions/admin-martyrdom-extract-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId, secret }),
    });
    if (resp.status !== 202 && resp.status !== 200) {
      return { bgStatus: resp.status, bgError: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    return { bgStatus: resp.status };
  } catch (err: any) {
    console.warn("[martyrdom-extract trigger]", err?.message || err);
    return { bgStatus: 0, bgError: String(err?.message || err).slice(0, 200) };
  }
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST만 허용" }), { status: 405 });
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

  try {
    /* 문서 조회 — blob_id 확인 */
    const docRes: any = await db.execute(sql.raw(`
      SELECT id, blob_id AS "blobId", extract_status AS "extractStatus"
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

    /* blob_uploads → completed */
    if (doc.blobId) {
      await db.update(blobUploads)
        .set({ uploadStatus: "completed" } as any)
        .where(eq(blobUploads.id, Number(doc.blobId)));
    }

    /* martyrdom_case_documents → extract_status = processing */
    await db.execute(sql.raw(`
      UPDATE martyrdom_case_documents
      SET extract_status = 'processing', updated_at = NOW()
      WHERE id = ${docId}
    `));

    /* extract-background 트리거 (await로 전송 보장) */
    const bg = await triggerExtract(docId);

    return new Response(JSON.stringify({
      ok: true,
      docId,
      extractQueued: true,
      bgStatus: bg.bgStatus,
      bgError: bg.bgError || undefined,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return jsonError("register", err);
  }
};
