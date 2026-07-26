/**
 * 관리자 부속서류 관리 (슈퍼어드민 전용)
 *   GET  /api/admin-contract-attachments?contractId=N  — 목록(blobId로 blob-image 다운로드)
 *   POST /api/admin-contract-attachments { action }     — add | delete
 *     add:    contractId, blobId, blobKey, fileName, mimeType, sizeBytes, kind, label (관리자 첨부)
 *     delete: id  (소프트 삭제 deleted_at)
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/admin-contract-attachments" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any, message?: string) => new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: H });
const bad = (msg: string, status = 400) => new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });
const rows = (r: any) => (r?.rows ?? r ?? []);
const ALLOWED_KIND = new Set(["id_card", "bankbook", "etc"]);

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;
    const me = (auth as any).ctx.member;
    if (me.role !== "super_admin") return bad("이사장(슈퍼어드민)만 가능합니다", 403);

    if (req.method === "GET") {
      step = "list";
      const contractId = Number(new URL(req.url).searchParams.get("contractId"));
      if (!contractId) return bad("contractId 없음");
      const list = await db.execute(sql`
        SELECT id, kind, label, blob_id, file_name, mime_type, size_bytes, uploaded_role, created_at
          FROM contract_attachments WHERE contract_id = ${contractId} AND deleted_at IS NULL ORDER BY created_at DESC`);
      return ok({ items: rows(list) });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === "add") {
        step = "add";
        const contractId = Number(body.contractId);
        if (!contractId || !body.blobKey) return bad("필수 값이 없습니다");
        const exist = await db.execute(sql`SELECT id FROM employment_contracts WHERE id = ${contractId} LIMIT 1`);
        if (rows(exist).length === 0) return bad("계약을 찾을 수 없습니다", 404);
        const kind = ALLOWED_KIND.has(body.kind) ? body.kind : "etc";
        const ins = await db.execute(sql`
          INSERT INTO contract_attachments
            (contract_id, kind, label, blob_id, blob_key, file_name, mime_type, size_bytes, uploaded_by, uploaded_role)
          VALUES (${contractId}, ${kind}, ${body.label || null}, ${body.blobId ? Number(body.blobId) : null},
                  ${body.blobKey}, ${body.fileName || null}, ${body.mimeType || null}, ${body.sizeBytes ? Number(body.sizeBytes) : null},
                  ${me.id}, 'company')
          RETURNING id`);
        await db.execute(sql`
          INSERT INTO contract_signature_events (contract_id, actor, action, meta)
          VALUES (${contractId}, 'company', 'ATTACH', ${JSON.stringify({ kind, fileName: body.fileName || null })}::jsonb)`);
        return ok({ id: rows(ins)[0]?.id }, "서류를 첨부했습니다");
      }

      if (action === "delete") {
        step = "delete";
        const id = Number(body.id);
        if (!id) return bad("id 없음");
        await db.execute(sql`UPDATE contract_attachments SET deleted_at = NOW() WHERE id = ${id}`);
        return ok({ id }, "서류를 삭제했습니다");
      }

      return bad("알 수 없는 action");
    }

    return bad("허용되지 않은 메서드", 405);
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "부속서류 처리 실패", step, detail: String(err?.message || err).slice(0, 500) }), { status: 500, headers: H });
  }
}
