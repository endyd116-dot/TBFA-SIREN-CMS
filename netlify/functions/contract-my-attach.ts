/**
 * 직원 부속서류 첨부 연결 (본인 계약)
 *   POST /api/contract-my-attach { contractId, blobId, blobKey, fileName, mimeType, sizeBytes, kind, label }
 *
 * 업로드 자체는 기존 3단계(blob-presign → R2 PUT → blob-confirm)로 끝낸 뒤,
 * 이 API로 그 파일을 계약에 연결한다. 신분증·통장 사본 등(세금·4대보험 등록용).
 * 인증: requireOperator(본인). 본인 계약에만 첨부.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/contract-my-attach" };
const H = { "Content-Type": "application/json; charset=utf-8" };
const ok = (data: any, message?: string) => new Response(jsonKST({ ok: true, message, data }), { status: 200, headers: H });
const bad = (msg: string, status = 400) => new Response(jsonKST({ ok: false, error: msg }), { status, headers: H });

const ALLOWED_KIND = new Set(["id_card", "bankbook", "etc"]);

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  if (req.method !== "POST") return bad("POST 전용", 405);
  try {
    step = "auth";
    const auth = await requireOperator(req);
    if (operatorGuardFailed(auth)) return auth.res;
    const me = auth.ctx.member;

    const body = await req.json().catch(() => ({}));
    const contractId = Number(body.contractId);
    if (!contractId || !body.blobKey) return bad("필수 값이 없습니다");

    step = "verify_owner";
    const r: any = await db.execute(sql`SELECT member_id, status FROM employment_contracts WHERE id = ${contractId} LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (!row) return bad("계약을 찾을 수 없습니다", 404);
    if (Number(row.member_id) !== Number(me.id)) return bad("본인 계약에만 첨부할 수 있습니다", 403);

    const kind = ALLOWED_KIND.has(body.kind) ? body.kind : "etc";

    step = "insert";
    const ins: any = await db.execute(sql`
      INSERT INTO contract_attachments
        (contract_id, kind, label, blob_id, blob_key, file_name, mime_type, size_bytes, uploaded_by, uploaded_role)
      VALUES (${contractId}, ${kind}, ${body.label || null}, ${body.blobId ? Number(body.blobId) : null},
              ${body.blobKey}, ${body.fileName || null}, ${body.mimeType || null}, ${body.sizeBytes ? Number(body.sizeBytes) : null},
              ${me.id}, 'employee')
      RETURNING id`);
    await db.execute(sql`
      INSERT INTO contract_signature_events (contract_id, actor, action, meta)
      VALUES (${contractId}, 'employee', 'ATTACH', ${JSON.stringify({ kind, fileName: body.fileName || null })}::jsonb)`);

    return ok({ id: (ins?.rows ?? ins ?? [])[0]?.id }, "서류를 첨부했습니다");
  } catch (err: any) {
    return new Response(jsonKST({ ok: false, error: "첨부 실패", step, detail: String(err?.message || err).slice(0, 500) }), { status: 500, headers: H });
  }
}
