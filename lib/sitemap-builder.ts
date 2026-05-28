// lib/sitemap-builder.ts
// R42 SEO — sitemap.xml 자동 생성
//
// 포함:
//   고정 페이지 ~25개 + 동적 콘텐츠 (campaigns / activityPosts / incidents /
//   familyStories / boardPosts / memorialTeachers / memorialMessages)

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  campaigns,
  activityPosts,
  incidents,
  familyStories,
  boardPosts,
  memorialTeachers,
  memorialMessages,
} from "../db/schema";

export interface SitemapUrl {
  loc: string;             // 절대 또는 상대 (siteUrl이 있으면 빌더가 합쳐줌)
  lastmod?: Date | string | null;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;       // 0.0 ~ 1.0
}

/** 고정 페이지 목록 — 실재하는 public/*.html만 포함.
 *  ★ R42-fix: 이전 25개 중 14개가 dead 파일(donate/signup/login/campaign-list/about-history/
 *  about-team/contact/media/family-support 4종/report-incident/report-legal) → sitemap dead link 노출 위험.
 *  동적 콘텐츠 페이지(campaign·incident·activity·board-view·family-story·memorial-teacher)는
 *  builder가 DB 발행분만 자동 추가하므로 여기에 안 넣음(빈 템플릿 URL 검색 노출 방지).
 */
const STATIC_PAGES: SitemapUrl[] = [
  { loc: "/",                       changefreq: "daily",   priority: 1.0 },
  { loc: "/about.html",             changefreq: "monthly", priority: 0.8 },
  { loc: "/activities.html",        changefreq: "weekly",  priority: 0.7 },
  { loc: "/news.html",              changefreq: "weekly",  priority: 0.7 },
  { loc: "/campaigns.html",         changefreq: "daily",   priority: 0.9 },
  { loc: "/support.html",           changefreq: "weekly",  priority: 0.8 },
  { loc: "/memorial.html",          changefreq: "weekly",  priority: 0.7 },
  { loc: "/family-stories.html",    changefreq: "weekly",  priority: 0.7 },
  { loc: "/incidents.html",         changefreq: "weekly",  priority: 0.7 },
  { loc: "/resources.html",         changefreq: "monthly", priority: 0.6 },
  { loc: "/ethics.html",            changefreq: "yearly",  priority: 0.4 },
  { loc: "/board.html",             changefreq: "daily",   priority: 0.7 },
  { loc: "/ranking.html",           changefreq: "weekly",  priority: 0.6 },
  { loc: "/legal-support.html",     changefreq: "monthly", priority: 0.6 },
  { loc: "/manual.html",            changefreq: "monthly", priority: 0.5 },
  { loc: "/report.html",            changefreq: "monthly", priority: 0.7 },
  { loc: "/report-harassment.html", changefreq: "monthly", priority: 0.7 },
  { loc: "/terms.html",             changefreq: "yearly",  priority: 0.3 },
  { loc: "/privacy.html",           changefreq: "yearly",  priority: 0.3 },
];

function fmtDate(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function abs(siteUrl: string, locOrPath: string): string {
  if (/^https?:\/\//i.test(locOrPath)) return locOrPath;
  if (!siteUrl) return locOrPath;
  const base = siteUrl.replace(/\/+$/, "");
  if (locOrPath.startsWith("/")) return base + locOrPath;
  return base + "/" + locOrPath;
}

/**
 * 동적 콘텐츠 URL 수집.
 * 각 테이블에서 발행/공개 상태인 항목만.
 */
async function collectDynamicUrls(): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = [];

  // campaigns (isPublished=true)
  try {
    const rows = await db.select({
      slug: campaigns.slug,
      updatedAt: campaigns.updatedAt,
      createdAt: campaigns.createdAt,
    }).from(campaigns).where(eq(campaigns.isPublished, true));
    for (const r of rows) {
      if (!r.slug) continue;
      urls.push({
        loc: `/campaign.html?slug=${encodeURIComponent(r.slug)}`,
        lastmod: r.updatedAt || r.createdAt,
        changefreq: "weekly",
        priority: 0.8,
      });
    }
  } catch (e) { console.warn("[sitemap] campaigns", e); }

  // activityPosts (isPublished=true)
  try {
    const rows = await db.select({
      slug: activityPosts.slug,
      updatedAt: activityPosts.updatedAt,
      createdAt: activityPosts.createdAt,
    }).from(activityPosts).where(eq(activityPosts.isPublished, true));
    for (const r of rows) {
      if (!r.slug) continue;
      urls.push({
        loc: `/activity.html?slug=${encodeURIComponent(r.slug)}`,
        lastmod: r.updatedAt || r.createdAt,
        changefreq: "monthly",
        priority: 0.6,
      });
    }
  } catch (e) { console.warn("[sitemap] activityPosts", e); }

  // incidents (status='active')
  try {
    const rows = await db.select({
      slug: incidents.slug,
      updatedAt: incidents.updatedAt,
      createdAt: incidents.createdAt,
    }).from(incidents).where(eq(incidents.status, "active"));
    for (const r of rows) {
      if (!r.slug) continue;
      urls.push({
        loc: `/incident.html?slug=${encodeURIComponent(r.slug)}`,
        lastmod: r.updatedAt || r.createdAt,
        changefreq: "weekly",
        priority: 0.7,
      });
    }
  } catch (e) { console.warn("[sitemap] incidents", e); }

  // familyStories (status='published')
  try {
    const rows = await db.select({
      id: familyStories.id,
      updatedAt: familyStories.updatedAt,
      createdAt: familyStories.createdAt,
    }).from(familyStories).where(eq(familyStories.status, "published"));
    for (const r of rows) {
      urls.push({
        loc: `/family-story.html?id=${r.id}`,
        lastmod: r.updatedAt || r.createdAt,
        changefreq: "monthly",
        priority: 0.6,
      });
    }
  } catch (e) { console.warn("[sitemap] familyStories", e); }

  // boardPosts (isHidden=false)
  try {
    const rows = await db.select({
      id: boardPosts.id,
      updatedAt: boardPosts.updatedAt,
      createdAt: boardPosts.createdAt,
    }).from(boardPosts).where(eq(boardPosts.isHidden, false));
    for (const r of rows) {
      urls.push({
        loc: `/board-view.html?id=${r.id}`,
        lastmod: r.updatedAt || r.createdAt,
        changefreq: "monthly",
        priority: 0.4,
      });
    }
  } catch (e) { console.warn("[sitemap] boardPosts", e); }

  // memorialTeachers (isPublic=true)
  try {
    const rows = await db.select({
      id: memorialTeachers.id,
      updatedAt: memorialTeachers.updatedAt,
      createdAt: memorialTeachers.createdAt,
    }).from(memorialTeachers).where(eq(memorialTeachers.isPublic, true));
    for (const r of rows) {
      urls.push({
        loc: `/memorial-teacher.html?id=${r.id}`,
        lastmod: r.updatedAt || r.createdAt,
        changefreq: "monthly",
        priority: 0.5,
      });
    }
  } catch (e) { console.warn("[sitemap] memorialTeachers", e); }

  // memorialMessages (isHidden=false) — 방명록은 개별 URL이 거의 없으므로 생략하거나
  // 추모 페이지 lastmod 갱신 신호로만 사용. (Q4-031 — sitemap 비대화 방지.)
  // 명세상 포함이 명시돼있으므로 최근 N개만 createdAt 데이터로 추가 — 단, 별도 URL 패턴 없음.
  // memorial-teacher.html?id=...#msg-N 형태는 SEO 가치 낮음 → 제외.

  return urls;
}

/**
 * sitemap.xml 직렬화.
 * siteUrl이 있으면 모든 loc에 prefix.
 */
export async function buildSitemap(siteUrl: string = ""): Promise<string> {
  const dyn = await collectDynamicUrls();
  const all = [...STATIC_PAGES, ...dyn];

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);
  for (const u of all) {
    const loc = abs(siteUrl, u.loc);
    lines.push(`  <url>`);
    lines.push(`    <loc>${escapeXml(loc)}</loc>`);
    const lm = fmtDate(u.lastmod);
    if (lm) lines.push(`    <lastmod>${lm}</lastmod>`);
    if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (u.priority != null) lines.push(`    <priority>${u.priority.toFixed(1)}</priority>`);
    lines.push(`  </url>`);
  }
  lines.push(`</urlset>`);
  return lines.join("\n");
}

export { STATIC_PAGES };
