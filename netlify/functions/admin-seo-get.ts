// netlify/functions/admin-seo-get.ts
// R42 SEO — 단일 페이지 SEO 상세 (published + draft).

import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { getPageMetaSplit } from "../../lib/seo-meta";

export const config = { path: "/api/admin-seo-get" };

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

export default async (req: Request) => {
  if (req.method !== "GET") return jsonError(405, "GET만 허용");

  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;
  const role = (g.ctx.member as any).role || (g.ctx.member.type === "admin" ? "admin" : "");
  if (!(await canAccess(role, "seo_edit"))) {
    return jsonError(403, "SEO 편집 권한이 없습니다");
  }

  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return jsonError(400, "path 쿼리가 필요합니다");

  try {
    const { published, draft, hasDraft, lastUpdated } = await getPageMetaSplit(path);
    return jsonOk({
      ok: true,
      path,
      hasDraft,
      lastUpdated,
      published,
      draft,
    });
  } catch (e: any) {
    console.error("[admin-seo-get]", e);
    return jsonError(500, e?.message || "조회 실패");
  }
};
