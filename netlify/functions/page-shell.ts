// netlify/functions/page-shell.ts
// ★ 2026-08-20 (구글 광고그랜트 심사 대응 B단계)
//
// 공개 페이지를 내보내기 전에 서버가 페이지 뼈대를 채워서 보낸다.
//   · 머리말(상단 메뉴) · 꼬리말(단체 정보란) · 공용 창(모달)을 페이지 안에 미리 넣는다
//   · 단체 정보는 어드민 저장값으로 채운다 (예시값이 노출되지 않는다)
//   · 홈이면 활동 지표·공지사항·자주 묻는 질문까지 채운다
//   · 이미 받아 둔 값을 페이지에 심어, 브라우저가 같은 걸 다시 조회하지 않게 한다
//
// 무슨 일이 있어도 화면은 나와야 하므로, 어느 단계에서 실패하든 원본을 그대로 돌려준다.
//
// netlify.toml 에서 각 공개 페이지를 /api/page-shell?_p=/xxx.html 로 넘긴다.
// 함수 번들에 정적 HTML·조각 파일을 동봉해야 한다(netlify.toml [functions."page-shell"]).

import { getPublishedSettings } from "../../lib/site-settings";
import { getPageMeta, getOrgMeta, getDefaultMeta } from "../../lib/seo-meta";
import { injectMeta } from "../../lib/seo-injector";
import {
  readPublicFile, esc, injectPreload, revealHomePending, replaceById, applyStatValues,
  loadShellData, applyShell, withTimeout,
} from "../../lib/shell-render";

export const config = { path: "/api/page-shell" };

const HOME_PATHS = new Set(["/", "/index.html"]);

function htmlResponse(html: string, cacheable: boolean) {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
  };
  if (cacheable) {
    /* 브라우저는 매번 확인, 전송망(CDN)은 5분 보관 + 하루 동안은 옛 것이라도 즉시 응답.
       어드민에서 값을 바꿔도 늦어도 5분 안에 반영된다. */
    headers["Cache-Control"] = "public, max-age=0, must-revalidate";
    headers["Netlify-CDN-Cache-Control"] = "public, s-maxage=300, stale-while-revalidate=86400";
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(html, { status: 200, headers });
}

export default async (req: Request) => {
  let pagePath = "/index.html";
  let rawHtml: string | null = null;

  try {
    const url = new URL(req.url);
    pagePath = url.searchParams.get("_p") || url.pathname;
    rawHtml = readPublicFile(pagePath === "/" ? "/index.html" : pagePath);
    if (!rawHtml) return new Response("Page not found", { status: 404 });

    /* 어드민 미리보기는 서버가 미리 채우지 않는다 — 편집 중인 값이 섞이면 혼란스럽다 */
    if (url.searchParams.get("preview") === "1") return htmlResponse(rawHtml, false);

    const isHome = HOME_PATHS.has(pagePath);
    const siteUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;

    /* ---------- 1. 뼈대(머리말·꼬리말·공용 창) 채우기 ---------- */
    const shellData = await loadShellData();
    const shell = applyShell(rawHtml, shellData);
    let html = shell.html;
    const preload: Record<string, any> = shell.preload;

    /* ---------- 2. 홈 화면 내용 채우기 ---------- */
    if (isHome) {
      const [homeSettings, statsSettings] = await Promise.all([
        withTimeout(getPublishedSettings("home"), 2500, {} as any),
        withTimeout(getPublishedSettings("stats"), 2500, {} as any),
      ]);
      const home = (homeSettings && (homeSettings as any).home) || {};
      const stats = (statsSettings && (statsSettings as any).stats) || {};

      try {
        html = applyStatValues(html, flattenStats(stats));
      } catch (e) { console.warn("[page-shell] 활동 지표 채우기 실패", e); }

      try {
        const lists = await withTimeout(
          loadHomeLists(home), 2500, { notices: [] as any[], faqs: [] as any[] }
        );
        if (lists.notices.length) {
          html = replaceById(html, "homeNoticeList", renderNoticeList(lists.notices));
        }
        if (lists.faqs.length) {
          html = replaceById(html, "homeFaqList", renderFaqList(lists.faqs));
        }
        preload["/api/notices?limit=20"] = { ok: true, data: { list: lists.notices } };
        preload["/api/faqs?limit=20"] = { ok: true, data: { list: lists.faqs } };
      } catch (e) { console.warn("[page-shell] 홈 목록 채우기 실패", e); }

      preload["/api/public/home-content"] = { ok: true, data: home };
      preload["/api/public/stats"] = { ok: true, data: stats };

      html = revealHomePending(html);
    }

    /* ---------- 3. 이미 받아 둔 값 심기 (브라우저 재조회 방지) ---------- */
    html = injectPreload(html, preload);

    /* ---------- 4. 검색엔진용 정보 주입 (기존 규칙 그대로) ---------- */
    try {
      const [pageMeta, org, defaults] = await Promise.all([
        withTimeout(getPageMeta(pagePath, false), 2000, null as any),
        withTimeout(getOrgMeta(false), 2000, undefined as any),
        withTimeout(getDefaultMeta(false), 2000, undefined as any),
      ]);
      if (pageMeta) {
        if (!pageMeta.canonical) pageMeta.canonical = pagePath === "/index.html" ? "/" : pagePath;
        html = injectMeta(html, { page: pageMeta, org, defaults, siteUrl, currentPath: pagePath });
      }
    } catch (e) { console.warn("[page-shell] 검색엔진 정보 주입 실패", e); }

    return htmlResponse(html, true);
  } catch (e: any) {
    console.error("[page-shell]", pagePath, e);
    /* 어떤 경우에도 화면은 나와야 한다 — 원본 그대로 */
    if (rawHtml) return htmlResponse(rawHtml, false);
    return new Response("Internal Error", { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/* 홈 화면 보조                                                         */
/* ------------------------------------------------------------------ */

/** 저장된 지표를 '분류.항목' 형태 한 겹으로 편다 (예: donations.totalAmount) */
function flattenStats(stats: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!stats || typeof stats !== "object") return out;
  for (const [group, value] of Object.entries(stats)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as any)) {
        if (typeof v === "number" || typeof v === "string") out[`${group}.${k}`] = v;
      }
    }
  }
  /* 누적 후원금은 화면에 '만원' 단위로 나온다 */
  const total = Number(out["donations.totalAmount"]);
  if (Number.isFinite(total)) out["donations.totalAmount"] = Math.floor(total / 10000);
  return out;
}

/** 공지사항·자주 묻는 질문을 저장소에서 직접 읽는다 (목록 화면과 같은 조건·순서) */
async function loadHomeLists(home: any): Promise<{ notices: any[]; faqs: any[] }> {
  const noticeMax = Number(home?.notice?.maxItems) || 5;
  const faqMax = Number(home?.faq?.maxItems) || 4;

  const { db } = await import("../../db");
  const { notices, faqs } = await import("../../db/schema");
  const { eq, desc, asc, sql } = await import("drizzle-orm");

  let noticeRows: any[] = [];
  try {
    noticeRows = await db
      .select({
        id: notices.id,
        category: notices.category,
        title: notices.title,
        isPinned: notices.isPinned,
        sortOrder: notices.sortOrder,
        publishedAt: notices.publishedAt,
        createdAt: notices.createdAt,
      })
      .from(notices)
      .where(eq(notices.isPublished, true))
      .orderBy(
        sql`CASE WHEN ${notices.sortOrder} = 0 THEN 1 ELSE 0 END`,
        asc(notices.sortOrder),
        desc(notices.publishedAt),
        desc(notices.id),
      )
      .limit(noticeMax);
  } catch (e) { console.warn("[page-shell] 공지사항 조회 실패", e); }

  let faqRows: any[] = [];
  try {
    faqRows = await db
      .select({
        id: faqs.id,
        category: faqs.category,
        question: faqs.question,
        answer: faqs.answer,
        sortOrder: faqs.sortOrder,
      })
      .from(faqs)
      .where(eq(faqs.isActive, true))
      .orderBy(asc(faqs.sortOrder), asc(faqs.id))
      .limit(faqMax);
  } catch (e) { console.warn("[page-shell] 자주 묻는 질문 조회 실패", e); }

  return { notices: noticeRows, faqs: faqRows };
}

/* 공지 분류 이름표 — 화면(home.js)과 같은 표기를 쓴다 */
const NOTICE_CATS: Record<string, { label: string; cls: string }> = {
  general: { label: "일반공지", cls: "tag-mute" },
  member:  { label: "회원공지", cls: "tag-sec" },
  event:   { label: "사업안내", cls: "tag-pri" },
  media:   { label: "언론보도", cls: "tag-mute" },
};

function fmtDate(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  /* 표시는 한국 날짜 기준 */
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, "0")}.${String(kst.getUTCDate()).padStart(2, "0")}`;
}

function renderNoticeList(list: any[]): string {
  return list.map((n) => {
    const cat = NOTICE_CATS[n.category] || { label: "공지", cls: "tag-mute" };
    const date = fmtDate(n.publishedAt || n.createdAt);
    return "<li>" +
      `<span class="tag ${cat.cls}">${esc(cat.label)}</span>` +
      `<a class="notice-title" href="/news.html#notice" style="color:inherit;text-decoration:none">${esc(n.title || "")}</a>` +
      (date ? `<span class="notice-date">${esc(date)}</span>` : "") +
      "</li>";
  }).join("");
}

function renderFaqList(list: any[]): string {
  return list.map((f) =>
    `<div class="faq-item">` +
    `<div class="faq-q"><span class="q-mark">Q</span>${esc(f.question || "")}<span class="arrow">▼</span></div>` +
    `<div class="faq-a"><div class="faq-a-inner">${esc(f.answer || "")}</div></div>` +
    `</div>`
  ).join("");
}
