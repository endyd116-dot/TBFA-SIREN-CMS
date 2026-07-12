// netlify/functions/admin-seo-list.ts
// R42 SEO — 어드민용 페이지 SEO 목록.
// site_settings page:* 항목 + 고정 페이지 + 동적 콘텐츠 페이지 머지.

import { jsonKST } from "../../lib/kst";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { listPageSeoKeys } from "../../lib/seo-meta";
import { STATIC_PAGES } from "../../lib/sitemap-builder";

export const config = { path: "/api/admin-seo-list" };

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

/** 어드민에서 메타 관리 가능한 페이지 풀 (정적 + 동적 prefix). */
const MANAGEABLE_PAGES = Array.from(new Set([
  ...STATIC_PAGES.map(p => p.loc),
  "/campaign.html",
  "/activity.html",
  "/incident.html",
  "/family-story.html",
  "/board-view.html",
  "/memorial-teacher.html",
]));

export default async (req: Request) => {
  if (req.method !== "GET") return jsonError(405, "GET만 허용");

  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;
  const role = (g.ctx.member as any).role || (g.ctx.member.type === "admin" ? "admin" : "");

  if (!(await canAccess(role, "seo_edit"))) {
    return jsonError(403, "SEO 편집 권한이 없습니다");
  }

  try {
    const existing = await listPageSeoKeys();
    const byPath = new Map(existing.map(e => [e.path, e]));

    const pages = MANAGEABLE_PAGES.map(p => {
      const e = byPath.get(p);
      return {
        path: p,
        title: e?.title || "",
        hasDraft: !!e?.hasDraft,
        lastUpdated: e?.lastUpdated ?? null,
      };
    });

    // 등록된 페이지 중 풀에 없는 것도 노출
    for (const e of existing) {
      if (!MANAGEABLE_PAGES.includes(e.path)) {
        pages.push({ path: e.path, title: e.title, hasDraft: e.hasDraft, lastUpdated: e.lastUpdated });
      }
    }

    return jsonOk({ ok: true, pages });
  } catch (e: any) {
    console.error("[admin-seo-list]", e);
    return jsonError(500, e?.message || "조회 실패");
  }
};
