// netlify/functions/admin-seo-org.ts
// R42 SEO — 단체 구조화 데이터 (org:*) GET/POST.
// 즉시 운영 반영 (Draft 시스템 사용 안 함).

import { and, eq, like } from "drizzle-orm";
import { db } from "../../db";
import { siteSettings } from "../../db/schema";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { getOrgMeta, saveSeoKey } from "../../lib/seo-meta";

export const config = { path: "/api/admin-seo-org" };

function jsonOk(body: any) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const ALLOWED_FIELDS = [
  "name", "legal_name", "registration_no",
  "representative", "address", "phone", "email",
  "url", "logo_blob_id",
];

export default async (req: Request) => {
  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;
  const role = (g.ctx.member as any).role || (g.ctx.member.type === "admin" ? "admin" : "");
  if (!(await canAccess(role, "seo_edit"))) {
    return jsonError(403, "SEO 편집 권한이 없습니다");
  }

  if (req.method === "GET") {
    try {
      const org = await getOrgMeta(false);
      return jsonOk({ ok: true, org });
    } catch (e: any) {
      console.error("[admin-seo-org GET]", e);
      return jsonError(500, e?.message || "조회 실패");
    }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return jsonError(400, "JSON body 파싱 실패"); }
    if (!body || typeof body !== "object") return jsonError(400, "body가 필요합니다");

    let saved = 0;
    try {
      for (const field of ALLOWED_FIELDS) {
        if (body[field] === undefined) continue;
        const key = `org:${field}`;
        if (field === "logo_blob_id") {
          const blobId = body[field] == null ? null : Number(body[field]);
          await saveSeoKey(key, null, { blobId, updatedBy: g.ctx.admin.uid });
        } else {
          const v = body[field] == null ? "" : String(body[field]);
          await saveSeoKey(key, v, { updatedBy: g.ctx.admin.uid });
        }
        saved++;
      }
      return jsonOk({ ok: true, saved });
    } catch (e: any) {
      console.error("[admin-seo-org POST]", e);
      return jsonError(500, e?.message || "저장 실패");
    }
  }

  return jsonError(405, "GET/POST만 허용");
};
