// netlify/functions/admin-seo-save.ts
// R42 SEO — 단일 페이지 SEO Draft 저장 (운영 미반영, publish 필요).

import { jsonKST } from "../../lib/kst";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { savePageMetaDraft } from "../../lib/seo-meta";

export const config = { path: "/api/admin-seo-save" };

function jsonOk(body: any) {
  return new Response(jsonKST(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonError(status: number, error: string) {
  return new Response(jsonKST({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return jsonError(405, "POST만 허용");

  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;
  const role = (g.ctx.member as any).role || (g.ctx.member.type === "admin" ? "admin" : "");
  if (!(await canAccess(role, "seo_edit"))) {
    return jsonError(403, "SEO 편집 권한이 없습니다");
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonError(400, "JSON body 파싱 실패"); }

  const path = String(body?.path || "").trim();
  if (!path) return jsonError(400, "path가 필요합니다");

  const fields: Record<string, any> = {};
  if (body.title !== undefined) fields.title = body.title == null ? "" : String(body.title);
  if (body.description !== undefined) fields.description = body.description == null ? "" : String(body.description);
  if (body.og_title !== undefined) fields.og_title = body.og_title == null ? "" : String(body.og_title);
  if (body.og_description !== undefined) fields.og_description = body.og_description == null ? "" : String(body.og_description);
  if (body.canonical !== undefined) fields.canonical = body.canonical == null ? "" : String(body.canonical);
  if (body.og_image_blob_id !== undefined) {
    fields.og_image_blob_id = body.og_image_blob_id == null ? null : Number(body.og_image_blob_id);
  }

  if (Object.keys(fields).length === 0) return jsonError(400, "저장할 필드가 없습니다");

  try {
    await savePageMetaDraft(path, fields, g.ctx.admin.uid);
    return jsonOk({ ok: true, saved: true });
  } catch (e: any) {
    console.error("[admin-seo-save]", e);
    return jsonError(500, e?.message || "저장 실패");
  }
};
