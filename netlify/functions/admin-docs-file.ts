/**
 * GET /api/admin-docs-file?id=첨부번호[&download=1]
 *
 * 결재 문서 첨부 열람. 문서 열람 권한을 확인한 뒤 1분짜리 R2 주소로 보낸다(설계도 14쪽).
 * 문서 첨부는 공용 파일 주소로 열 수 없다(blob-image가 막는다).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db } from "../../db/index";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { sql } from "drizzle-orm";
import { getR2Client, R2_BUCKET } from "../../lib/r2-client";
import { canViewDoc, type ReadScope } from "../../lib/approval-docs-read";

export const config = { path: "/api/admin-docs-file" };

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const JSON_HEADERS = { "Content-Type": "application/json" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id")) || 0;
  try {
    const f = rowsOf(await db.execute(sql`
      SELECT request_id, blob_key, file_name, mime_type FROM approval_doc_files WHERE id = ${id} AND removed_at IS NULL`))[0];
    if (!f?.blob_key) return new Response(jsonKST({ ok: false, error: "파일을 찾을 수 없습니다" }), { status: 404, headers: JSON_HEADERS });

    const role = String(auth.ctx.member.role ?? "");
    const scope: ReadScope = {
      actor: { id: Number(auth.ctx.admin.uid), name: auth.ctx.member.name ?? "", role },
      finance: await canAccess(role, "finance_view"),
      bookkeeping: await canAccess(role, "finance_bookkeeping"),
    };
    if (!(await canViewDoc(scope, Number(f.request_id)))) {
      return new Response(jsonKST({ ok: false, error: "열람 권한이 없습니다" }), { status: 403, headers: JSON_HEADERS });
    }

    const encoded = encodeURIComponent(String(f.file_name));
    const signed = await getSignedUrl(getR2Client(), new GetObjectCommand({
      Bucket: R2_BUCKET, Key: f.blob_key,
      ResponseContentType: f.mime_type || undefined,
      ResponseContentDisposition: `${url.searchParams.get("download") ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
    }), { expiresIn: 60 });
    return new Response(null, { status: 302, headers: { Location: signed } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false, error: "첨부 열람 실패", step: "sign",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: JSON_HEADERS });
  }
}
