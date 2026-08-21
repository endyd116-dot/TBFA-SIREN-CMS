// netlify/functions/page-with-seo.ts
// R42 SEO — 동적 콘텐츠 페이지의 정적 HTML을 읽어 SEO 메타 주입 후 반환.
//
// 적용 경로: /campaign.html, /incident.html, /activity.html,
//           /board-view.html, /family-story.html, /memorial-teacher.html
//
// 쿼리: slug 또는 id — 콘텐츠 메타 우선, 없으면 페이지 기본 메타 fallback.
//
// netlify.toml functions 블록에 included_files=["public/*.html"] 필요 (메인이 처리).

import fs from "node:fs";
import path from "node:path";
import { getPageMeta, getOrgMeta, getDefaultMeta, getContentMeta } from "../../lib/seo-meta";
import { injectMeta } from "../../lib/seo-injector";
import { loadShellData, applyShell, injectPreload } from "../../lib/shell-render";

// P0 fix: Function v2의 config.path에서 ".html" 확장자 경로가 라우팅 미동작 →
//   /api/page-with-seo 표준 경로로 변경. netlify.toml에서 각 .html → /api/page-with-seo?_p=/xxx.html rewrite.
//   함수는 _p 쿼리로 원래 경로 식별 (직접 호출 시 url.pathname 사용 가능).
export const config = { path: "/api/page-with-seo" };

const PATH_TO_TABLE: Record<string, string> = {
  "/campaign.html": "campaigns",
  "/activity.html": "activityPosts",
  "/incident.html": "incidents",
  "/family-story.html": "familyStories",
  "/board-view.html": "boardPosts",
  "/memorial-teacher.html": "memorialTeachers",
};

const PATH_TO_QUERY: Record<string, "slug" | "id"> = {
  "/campaign.html": "slug",
  "/activity.html": "slug",
  "/incident.html": "slug",
  "/family-story.html": "id",
  "/board-view.html": "id",
  "/memorial-teacher.html": "id",
};

function resolveHtml(pagePath: string): string | null {
  const fname = pagePath.replace(/^\//, "");
  const candidates = [
    path.join(process.cwd(), "public", fname),
    path.join(__dirname, "..", "..", "public", fname),
    path.join(__dirname, "..", "..", "..", "public", fname),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return null;
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    // rewrite 경유 시 url.pathname=/api/page-with-seo. 원래 경로는 _p 쿼리에서 받음.
    const pagePath = url.searchParams.get("_p") || url.pathname;
    const html = resolveHtml(pagePath);
    if (!html) {
      return new Response("Page not found", { status: 404 });
    }

    const siteUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;
    const table = PATH_TO_TABLE[pagePath];
    const queryKey = PATH_TO_QUERY[pagePath];
    const keyValue = url.searchParams.get(queryKey);

    let pageMeta = null as any;
    if (table && keyValue) {
      pageMeta = await getContentMeta(table, keyValue);
    }
    if (!pageMeta) {
      pageMeta = await getPageMeta(pagePath, false);
    }
    if (!pageMeta.canonical) {
      pageMeta.canonical = pagePath + (url.search || "");
    }

    const [org, defaults] = await Promise.all([
      getOrgMeta(false).catch(() => undefined),
      getDefaultMeta(false).catch(() => undefined),
    ]);

    /* ★ 2026-08-20: 상단 메뉴·단체 정보란을 서버가 미리 채운다.
       예전에는 화면이 열린 뒤 브라우저가 따로 받아 채워서, 검색엔진·심사기관이 읽는
       페이지 원본에는 메뉴도 단체 정보도 없었다. 실패해도 페이지는 그대로 나온다. */
    let shellHtml = html;
    let preload: Record<string, any> = {};
    try {
      const shell = applyShell(html, await loadShellData());
      shellHtml = shell.html;
      preload = shell.preload;
    } catch (e) {
      console.warn("[page-with-seo] 뼈대 채우기 실패 — 원본 유지", e);
    }

    const finalHtml = injectMeta(injectPreload(shellHtml, preload), {
      page: pageMeta,
      org,
      defaults,
      siteUrl,
      currentPath: pagePath + (url.search || ""),
    });

    return new Response(finalHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        /* ★ 2026-08-21: 지역을 넘어 함께 쓰는 보관소(durable) — 첫 응답 지연 완화 */
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control":
          "public, durable, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (e: any) {
    console.error("[page-with-seo]", e);
    // 실패 시 원본 HTML이라도 반환 (SEO만 누락). _p 우선 처리 — try 본문과 동일.
    try {
      const url = new URL(req.url);
      const fallbackPath = url.searchParams.get("_p") || url.pathname;
      const html = resolveHtml(fallbackPath);
      if (html) {
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    } catch {}
    return new Response("Internal Error", { status: 500 });
  }
};
