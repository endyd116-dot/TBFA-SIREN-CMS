/**
 * admin-martyrdom-doc-text — 자료 1건의 추출/전사 전문 조회 (조회 전용·운영자 이상)
 *
 * GET ?id=N : { ok, id, fileName, extractMethod, extractStatus, extractError, extractedText }
 *   - 음성·영상은 전사 후 원본(R2 blob)을 삭제하므로, 전사 텍스트가 유일한 열람 수단.
 *   - 본문이 클 수 있어(전사 전문) 상세 목록 payload엔 안 싣고 [보기] 시 on-demand 로드.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-martyrdom-doc-text" };

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

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id") || "0");
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "id 필수 (?id=N)" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const r: any = await db.execute(sql.raw(`
      SELECT id, file_name AS "fileName", extract_method AS "extractMethod",
             extract_status AS "extractStatus", extract_error AS "extractError",
             extracted_text AS "extractedText"
      FROM martyrdom_case_documents WHERE id = ${id} LIMIT 1
    `));
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: "자료를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      id: Number(row.id),
      fileName: String(row.fileName || ""),
      extractMethod: row.extractMethod ? String(row.extractMethod) : null,
      extractStatus: String(row.extractStatus || "pending"),
      extractError: row.extractError ? String(row.extractError) : null,
      extractedText: row.extractedText ? String(row.extractedText) : "",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return jsonError("select_doc_text", err);
  }
};
