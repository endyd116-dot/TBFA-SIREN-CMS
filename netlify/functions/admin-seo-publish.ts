// netlify/functions/admin-seo-publish.ts
// R42 SEO — Draft → 운영 일괄 적용 + 선택적 Netlify 빌드 hook 트리거.
// body: { path?: string | "all" }   생략 시 "all".

import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { publishDrafts } from "../../lib/site-settings";
import { publishPageMeta } from "../../lib/seo-meta";

export const config = { path: "/api/admin-seo-publish" };

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
  if (req.method !== "POST") return jsonError(405, "POST만 허용");

  const g = await requireAdmin(req);
  if (guardFailed(g)) return g.res;
  const role = (g.ctx.member as any).role || (g.ctx.member.type === "admin" ? "admin" : "");
  if (!(await canAccess(role, "seo_edit"))) {
    return jsonError(403, "SEO 편집 권한이 없습니다");
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const pathInput = body?.path;

  try {
    let published = 0;
    if (!pathInput || pathInput === "all") {
      published = await publishDrafts("seo");
    } else {
      published = await publishPageMeta(String(pathInput));
    }

    let buildTriggered = false;
    const hook = process.env.NETLIFY_BUILD_HOOK_URL;
    if (hook) {
      try {
        const r = await fetch(hook, { method: "POST" });
        buildTriggered = r.ok;
      } catch (e) {
        console.warn("[admin-seo-publish] build hook 호출 실패", e);
      }
    } else {
      console.warn("[admin-seo-publish] NETLIFY_BUILD_HOOK_URL 미설정 — 자동 재빌드 안 됨");
    }

    return jsonOk({ ok: true, published, buildTriggered });
  } catch (e: any) {
    console.error("[admin-seo-publish]", e);
    return jsonError(500, e?.message || "배포 실패");
  }
};
