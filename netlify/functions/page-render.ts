/**
 * netlify/functions/page-render.ts — 공개 페이지 그리기 (/p/{주소})
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §4.1
 *
 * `/p/greeting` 으로 들어오면 netlify.toml 규칙이 이리로 넘긴다(`?_slug=greeting`).
 * 여기서 페이지 뼈대(public/page.html)를 읽어 **제목·본문을 서버에서 채워** 내려보낸다.
 *
 * 왜 화면(JS)에서 채우지 않고 서버에서 채우나
 *  · 검색엔진이 본문을 읽을 수 있어야 한다 (JS로 채우면 빈 페이지로 수집될 수 있다)
 *  · 첫 화면이 빈 상태로 깜빡이지 않는다
 *  · 카카오톡·페이스북 공유 미리보기에 제목·설명이 제대로 뜬다
 *
 * `?preview=1` + 관리자 로그인이면 임시저장본을 보여준다. 이때 상단에 안내 띠가 붙는다.
 */
import fs from "node:fs";
import path from "node:path";
import { authenticateAdmin } from "../../lib/auth";
import { getPublicPage } from "../../lib/site-pages";
import { renderShortcodes } from "../../lib/page-shortcodes";
import { htmlToPlainText } from "../../lib/sanitize-page-html";
import { getOrgMeta, getDefaultMeta, PageMeta } from "../../lib/seo-meta";
import { injectMeta } from "../../lib/seo-injector";
import { loadShellData, applyShell, injectPreload } from "../../lib/shell-render";

/**
 * 이 함수가 `/p/{주소}`를 **직접** 받는다.
 * 처음에는 netlify.toml의 넘김 규칙(`/p/* → /api/page-render`)에 맡겼는데 라이브에서 동작하지 않았다
 * (정확한 주소를 지정한 기존 규칙들은 되는데, `*` 패턴 규칙만 함수로 넘어가지 않음 — 2026-08-03 실측).
 * 함수가 경로를 직접 맡으면 넘김 규칙을 거치지 않아 더 확실하다.
 * `/api/page-render?_slug=…` 형태도 계속 받는다(넘김 규칙이 살아 있을 때의 대비).
 */
export const config = { path: ["/p/:slug", "/api/page-render"] };

/** 본문을 끼워 넣을 자리. public/page.html 안에 이 주석이 그대로 들어 있다. */
const CONTENT_MARK = "<!--SIREN_PAGE_CONTENT-->";

function readPublicHtml(fileName: string): string | null {
  const candidates = [
    path.join(process.cwd(), "public", fileName),
    path.join(__dirname, "..", "..", "public", fileName),
    path.join(__dirname, "..", "..", "..", "public", fileName),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, "utf8"); } catch { /* 다음 후보 */ }
  }
  return null;
}

function esc(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function notFound(): Response {
  const html = readPublicHtml("404.html");
  return new Response(html || "페이지를 찾을 수 없습니다", {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    /* 주소를 두 곳에서 찾는다: 실제 경로(/p/xxx) 또는 넘김 규칙이 붙여준 쿼리(_slug) */
    const fromPath = url.pathname.match(/^\/p\/([^/?#]+)\/?$/);
    const raw = (url.searchParams.get("_slug") || (fromPath ? decodeURIComponent(fromPath[1]) : "")).trim();
    /* 주소는 영문·숫자·하이픈만. 그 외는 잘못된 주소로 본다. */
    const slug = raw.replace(/\/+$/, "");
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return notFound();

    /* 미리보기는 관리자만 */
    let preview = false;
    if (url.searchParams.get("preview") === "1" && authenticateAdmin(req)) preview = true;

    const page = await getPublicPage(slug, preview);
    if (!page) return notFound();

    const shell = readPublicHtml("page.html");
    if (!shell) {
      console.error("[page-render] page.html을 찾지 못했습니다 — netlify.toml included_files 확인");
      return new Response("페이지 뼈대를 찾을 수 없습니다", { status: 500 });
    }

    /* 본문 속 지도·버튼 자리표시를 실제 요소로 바꾼다 */
    const bodyHtml = renderShortcodes(page.contentHtml || "", { preview });

    const layoutClass = "layout-" + (page.layout || "default");
    const block = `
${preview ? '<div class="page-draft-banner">임시저장 미리보기입니다 — 방문자에게는 아직 보이지 않습니다</div>' : ""}
<div class="page-hero-wrap">
  <div class="container">
    ${page.eyebrow ? `<div class="sec-eyebrow">${esc(page.eyebrow)}</div>` : ""}
    <h1>${esc(page.title)}</h1>
    ${page.subtitle ? `<p class="page-subtitle">${esc(page.subtitle)}</p>` : ""}
  </div>
</div>
<div class="page-main">
  <div class="container">
    <nav class="breadcrumb" data-page-breadcrumb data-slug="${esc(slug)}" aria-label="현재 위치"></nav>
    <div class="page-body-wrap ${layoutClass}">
      <div class="page-body" data-page-body>${bodyHtml}</div>
    </div>
  </div>
</div>`.trim();

    let html = shell.includes(CONTENT_MARK)
      ? shell.replace(CONTENT_MARK, block)
      : shell.replace(/<main[^>]*>[\s\S]*?<\/main>/i, `<main class="page-main-slot">${block}</main>`);

    /* 화면 쪽에서 쓰도록 페이지 정보를 심어둔다 (제목 표시·상태 판단용) */
    html = html.replace(
      "</head>",
      `<script>window.__SIREN_PAGE__=${JSON.stringify({
        slug: page.slug, title: page.title, layout: page.layout, preview,
      })};</script></head>`,
    );

    /* 검색·공유 메타 */
    const siteUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;
    /* 설명은 **자리표시를 바꾼 뒤의 본문**에서 뽑는다.
       원본에서 뽑으면 `{{apply:support}}` 같은 표시가 검색 결과 설명에 그대로 나온다(2026-08-03 실측). */
    const plain = htmlToPlainText(bodyHtml, 160);
    const pageMeta: PageMeta = {
      title: page.seoTitle || page.title,
      description: page.seoDescription || plain,
      og_title: page.seoTitle || page.title,
      og_description: page.seoDescription || plain,
      og_image_url: page.ogImageUrl || "",
      canonical: `/p/${slug}`,
    };

    const [org, defaults] = await Promise.all([
      getOrgMeta(false).catch(() => undefined),
      getDefaultMeta(false).catch(() => undefined),
    ]);

    /* ★ 2026-08-20: 상단 메뉴·단체 정보란을 서버가 미리 채운다.
       예전에는 화면이 열린 뒤 브라우저가 따로 받아 채워서, 검색엔진·심사기관이 읽는
       페이지 원본에는 메뉴도 단체 정보도 없었다. 실패해도 페이지는 그대로 나온다.
       임시저장 미리보기는 편집 중 값이 섞이지 않도록 건드리지 않는다. */
    let shellHtml = html;
    let shellPreload: Record<string, any> = {};
    if (!preview) {
      try {
        const built = applyShell(html, await loadShellData());
        shellHtml = built.html;
        shellPreload = built.preload;
      } catch (e) {
        console.warn("[page-render] 뼈대 채우기 실패 — 원본 유지", e);
      }
    }

    const finalHtml = injectMeta(injectPreload(shellHtml, shellPreload), {
      page: pageMeta,
      org,
      defaults,
      siteUrl,
      currentPath: `/p/${slug}`,
    });

    return new Response(finalHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        /* 미리보기는 절대 캐시하지 않는다 — 임시저장본이 방문자에게 새어나가면 안 된다 */
        /* ★ 2026-08-21: 첫 응답이 느리던 문제 — 지역별 보관소가 따로 놀아서
           그 지역 첫 방문자는 매번 서버 조회를 기다렸다. 함께 쓰는 보관소(durable)로 바꾼다. */
        "Cache-Control": preview ? "private, no-store" : "public, max-age=0, must-revalidate",
        ...(preview ? {} : {
          "Netlify-CDN-Cache-Control":
            "public, durable, s-maxage=300, stale-while-revalidate=86400",
        }),
      },
    });
  } catch (e: any) {
    console.error("[page-render]", e);
    return new Response("페이지를 표시하는 중 문제가 발생했습니다", {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
};
