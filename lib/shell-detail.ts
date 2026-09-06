// lib/shell-detail.ts
// ★ 2026-09-03 (구글 광고그랜트 재심사 대응)
//
// 문제: 상세 화면 6종(활동 상세·사건 상세·캠페인 상세·유가족 이야기·게시글·추모 상세)이
//      서버가 내보내는 원본에는 제목·검색엔진 정보만 있고 **본문이 완전히 비어** 있었다.
//      검색엔진 제출 목록(sitemap)에 40여 개가 올라가 있는데 전부 껍데기로 읽혀
//      "내용 없는 페이지 다수"가 재거부의 핵심 사유가 됐다 (2026-09-03 라이브 진단).
//
// 해결: 목록 채움(shell-lists)과 같은 방식 — 서버가 본문 자리를 실제 내용으로 미리
//      채워서 내보낸다. 브라우저는 지금처럼 다시 조회해 같은 자리를 다시 그린다.
//
// 원칙: 어느 단계에서 실패하든 원본 화면은 그대로 나가야 한다.
//      비공개·미발행·없는 항목이면 아무것도 바꾸지 않는다.
//
// ⚠️ replaceById 는 같은 태그가 중첩되면 첫 닫는 태그에서 끊긴다 —
//    채우는 자리(자리표시)는 반드시 중첩 없는 단순 구조여야 한다.
//    (board-view.html·news.html·report.html 자리표시를 <p>로 바꿔 둔 이유)

import { esc, replaceById, setAttrById, addBodyClass, appendToHead, safeJson, withTimeout } from "./shell-html";
import { showById } from "./shell-lists";
import { sanitizePageHtml } from "./sanitize-page-html";
import { renderCampaignDefault, renderCampaignLantern, type CampaignView } from "./campaign-page";

/* ------------------------------------------------------------------ */
/* 공통 도우미                                                          */
/* ------------------------------------------------------------------ */

function fmtDate(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, "0")}.${String(kst.getUTCDate()).padStart(2, "0")}`;
}

/* 어드민 작성 리치 HTML — 화면(각 페이지 js)과 같은 수준의 살균을 서버에서도 거친다 */
function safeHtml(html: any): string {
  if (!html) return "";
  try {
    return sanitizePageHtml(String(html));
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* 대상 판별                                                            */
/* ------------------------------------------------------------------ */

/** 상세 화면 → 조회 키 이름 (page-with-seo 의 PATH_TO_QUERY 와 같은 표) */
const DETAIL_KEYS: Record<string, "slug" | "id"> = {
  "/activity.html": "slug",
  "/incident.html": "slug",
  "/campaign.html": "slug",
  "/family-story.html": "id",
  "/board-view.html": "id",
  "/memorial-teacher.html": "id",
};

export function detailKeyName(pagePath: string): "slug" | "id" | null {
  return DETAIL_KEYS[pagePath] || null;
}

/* ------------------------------------------------------------------ */
/* 조회                                                                */
/* ------------------------------------------------------------------ */

/**
 * 상세 화면에 채울 항목 하나를 읽어 온다.
 * 비공개·미발행·없음이면 null — 호출부는 아무것도 바꾸지 않는다.
 */
export async function loadDetailSeed(pagePath: string, key: string): Promise<any | null> {
  if (!DETAIL_KEYS[pagePath] || !key) return null;

  try {
    const { db } = await import("../db");
    const schema = await import("../db/schema");
    const { and, eq } = await import("drizzle-orm");

    switch (pagePath) {
      case "/activity.html": {
        const [row] = await db
          .select({
            title: schema.activityPosts.title,
            summary: schema.activityPosts.summary,
            contentHtml: schema.activityPosts.contentHtml,
            publishedAt: schema.activityPosts.publishedAt,
          })
          .from(schema.activityPosts)
          .where(and(eq(schema.activityPosts.slug, key), eq(schema.activityPosts.isPublished, true)))
          .limit(1);
        return row || null;
      }
      case "/incident.html": {
        const [row] = await db
          .select({
            title: schema.incidents.title,
            summary: schema.incidents.summary,
            contentHtml: schema.incidents.contentHtml,
            occurredAt: schema.incidents.occurredAt,
            location: schema.incidents.location,
          })
          .from(schema.incidents)
          .where(and(eq(schema.incidents.slug, key), eq(schema.incidents.status, "active")))
          .limit(1);
        return row || null;
      }
      case "/campaign.html": {
        /* ★ 2026-09-06 깜빡임 근본 FIX: 브라우저 캠페인 API(/api/campaigns?slug=)와 같은 조건·같은 값을 읽어
           서버가 최종 화면을 완성한다. 등불 캠페인이면 FAQ·실값까지 함께(각각 상한 2.5초·실패해도 빈값). */
        const { sql, asc } = await import("drizzle-orm");
        const [row] = await db
          .select({
            id: schema.campaigns.id,
            slug: schema.campaigns.slug,
            type: schema.campaigns.type,
            title: schema.campaigns.title,
            summary: schema.campaigns.summary,
            contentHtml: schema.campaigns.contentHtml,
            thumbnailBlobId: schema.campaigns.thumbnailBlobId,
            status: schema.campaigns.status,
            goalAmount: schema.campaigns.goalAmount,
            raisedAmount: schema.campaigns.raisedAmount,
            donorCount: schema.campaigns.donorCount,
            startDate: schema.campaigns.startDate,
            endDate: schema.campaigns.endDate,
          })
          .from(schema.campaigns)
          .where(and(
            eq(schema.campaigns.slug, key),
            eq(schema.campaigns.isPublished, true),
            sql`${schema.campaigns.status} IN ('active', 'closed')`,
            sql`(${schema.campaigns.startDate} IS NULL OR ${schema.campaigns.startDate} <= NOW())`,
          ))
          .limit(1);
        if (!row) return null;

        const { resolveCampaignExtras, toPublicExtras } = await import("./campaign-extras");
        const extras = await resolveCampaignExtras({ id: row.id, slug: row.slug });
        const seed: any = { kind: "campaign", campaign: row, extras: toPublicExtras(extras), faqs: [], stats: null };
        if (extras) {
          const faqP = db
            .select({ question: schema.faqs.question, answer: schema.faqs.answer })
            .from(schema.faqs)
            .where(and(eq(schema.faqs.isActive, true), eq(schema.faqs.category, extras.faqCategory)))
            .orderBy(asc(schema.faqs.sortOrder), asc(schema.faqs.id))
            .then((l) => l as any[])
            .catch((e) => { console.warn("[shell-detail] FAQ 조회 실패", e); return [] as any[]; });
          const statsP = import("./campaign-stats")
            .then((m) => m.computeCampaignPublicStats({ id: row.id, goalAmount: row.goalAmount }))
            .catch((e) => { console.warn("[shell-detail] 실값 집계 실패", e); return null; });
          const [faqs, stats] = await Promise.all([
            withTimeout(faqP, 2500, [] as any[]),
            withTimeout(statsP, 2500, null as any),
          ]);
          seed.faqs = faqs;
          seed.stats = stats;
        }
        return seed;
      }
      case "/family-story.html": {
        const id = Number(key);
        if (!Number.isFinite(id)) return null;
        const [row] = await db
          .select({
            title: schema.familyStories.title,
            subtitle: schema.familyStories.subtitle,
            summary: schema.familyStories.summary,
            detailHtml: schema.familyStories.detailHtml,
          })
          .from(schema.familyStories)
          .where(and(eq(schema.familyStories.id, id), eq(schema.familyStories.status, "published")))
          .limit(1);
        return row || null;
      }
      case "/board-view.html": {
        const id = Number(key);
        if (!Number.isFinite(id)) return null;
        const [row] = await db
          .select({
            title: schema.boardPosts.title,
            contentHtml: schema.boardPosts.contentHtml,
            authorName: schema.boardPosts.authorName,
            isAnonymous: schema.boardPosts.isAnonymous,
            createdAt: schema.boardPosts.createdAt,
          })
          .from(schema.boardPosts)
          .where(and(eq(schema.boardPosts.id, id), eq(schema.boardPosts.isHidden, false)))
          .limit(1);
        return row || null;
      }
      case "/memorial-teacher.html": {
        const id = Number(key);
        if (!Number.isFinite(id)) return null;
        const [row] = await db
          .select({
            name: schema.memorialTeachers.name,
            schoolRegion: schema.memorialTeachers.schoolRegion,
            tributeLine: schema.memorialTeachers.tributeLine,
            bioHtml: schema.memorialTeachers.bioHtml,
          })
          .from(schema.memorialTeachers)
          .where(and(eq(schema.memorialTeachers.id, id), eq(schema.memorialTeachers.isPublic, true)))
          .limit(1);
        return row || null;
      }
      default:
        return null;
    }
  } catch (e) {
    console.warn("[shell-detail] 조회 실패", pagePath, key, e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 캠페인 상세 — 서버가 최종 모양을 완성한다 (2026-09-06 깜빡임 근본 FIX)   */
/* ------------------------------------------------------------------ */

/**
 * 캠페인 화면을 브라우저 API 와 같은 값으로 통째 그리고, 브라우저가 다시 그리지 않도록
 *  · #cmpRoot 에 data-ssr="lantern|default" 표시
 *  · 그린 값(본문 제외)을 <script id="cmpData" type="application/json"> 으로 동봉(후원 창도 같은 값을 즉시 씀)
 *  · 등불 캠페인이면 <body class="lantern-page"> 를 서버에서 켜고 대표 사진을 미리 받게 한다
 */
function applyCampaignSeed(html: string, seed: any): string {
  const c0 = seed && seed.campaign;
  if (!c0) return html;
  const goal = Number(c0.goalAmount || 0);
  const raised = Number(c0.raisedAmount || 0);
  const view: CampaignView = {
    id: Number(c0.id),
    slug: String(c0.slug || ""),
    type: String(c0.type || "fundraising"),
    title: String(c0.title || ""),
    summary: c0.summary || null,
    contentHtml: safeHtml(c0.contentHtml),
    thumbnailBlobId: c0.thumbnailBlobId || null,
    status: String(c0.status || "active"),
    goalAmount: goal,
    raisedAmount: raised,
    donorCount: Number(c0.donorCount || 0),
    progressPercent: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100 * 10) / 10) : null,
    remainingDays: c0.endDate
      ? Math.max(0, Math.ceil((new Date(c0.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null,
    startDate: c0.startDate,
    endDate: c0.endDate,
    extras: seed.extras || null,
  };
  const isLantern = !!(view.extras && view.extras.theme === "lantern");
  const body = isLantern
    ? renderCampaignLantern(view, seed.faqs || [], seed.stats || null)
    : renderCampaignDefault(view);

  /* 브라우저 쪽 동봉 값 — 본문은 이미 화면에 있으니 뺀다 */
  const { contentHtml: _omit, ...campaignData } = view;
  const data = { campaign: campaignData, faqs: seed.faqs || [], stats: seed.stats || null };
  const dataTag = `<script id="cmpData" type="application/json">${safeJson(data)}</script>`;

  let out = replaceById(html, "cmpRoot", body + dataTag);
  if (out === html) return html;   /* 자리를 못 찾았으면 아무것도 바꾸지 않는다 */
  out = setAttrById(out, "cmpRoot", "data-ssr", isLantern ? "lantern" : "default");
  if (isLantern) {
    out = addBodyClass(out, "lantern-page");
    if (view.thumbnailBlobId) {
      out = appendToHead(out, `<link rel="preload" as="image" href="/api/blob-image?id=${Number(view.thumbnailBlobId)}">`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 채우기                                                               */
/* ------------------------------------------------------------------ */

/**
 * 읽어 온 항목을 화면의 제자리에 넣는다. 실패하면 원본 그대로.
 * 브라우저가 어차피 같은 자리를 다시 그리므로, 모양이 완전히 같을 필요는 없고
 * 검색엔진·심사기관이 읽을 제목·요약·본문 텍스트가 들어가는 것이 핵심이다.
 */
export function applyDetailSeed(pagePath: string, html: string, row: any): string {
  if (!row) return html;

  try {
    switch (pagePath) {
      case "/activity.html": {
        let out = replaceById(html, "actDetailTitle", esc(row.title || ""));
        const body =
          (row.summary ? `<p class="act-detail-summary">${esc(row.summary)}</p>` : "") +
          safeHtml(row.contentHtml);
        if (body) out = replaceById(out, "actDetailBody", body);
        return out;
      }
      case "/incident.html": {
        let out = replaceById(html, "incidentTitle", esc(row.title || ""));
        const meta = [row.location, fmtDate(row.occurredAt)].filter(Boolean).map(String);
        const body =
          (row.summary ? `<p class="incident-summary-line">${esc(row.summary)}</p>` : "") +
          (meta.length ? `<p class="incident-meta-line">${esc(meta.join(" · "))}</p>` : "") +
          safeHtml(row.contentHtml);
        if (body) out = replaceById(out, "incidentContent", body);
        return out;
      }
      case "/campaign.html": {
        return applyCampaignSeed(html, row);
      }
      case "/family-story.html": {
        let out = replaceById(html, "heroTitle", esc(row.title || ""));
        if (row.subtitle) out = replaceById(out, "heroSubtitle", esc(row.subtitle));
        const body =
          (row.summary ? `<p class="story-summary-line">${esc(row.summary)}</p>` : "") +
          safeHtml(row.detailHtml);
        if (body) out = replaceById(out, "detailHtml", body);
        out = showById(out, "storyHero");
        out = showById(out, "storyContent");
        return out;
      }
      case "/board-view.html": {
        /* 개인화 요소(본인 여부 등)는 절대 넣지 않는다 — CDN이 공유 캐시로 보관한다 */
        const who = row.isAnonymous ? "익명" : String(row.authorName || "회원");
        const body =
          `<h1 class="board-view-title">${esc(row.title || "")}</h1>` +
          `<p class="board-view-meta">${esc(who)} · ${esc(fmtDate(row.createdAt))}</p>` +
          `<div class="board-view-content">${safeHtml(row.contentHtml)}</div>`;
        return replaceById(html, "boardViewContainer", body);
      }
      case "/memorial-teacher.html": {
        let out = replaceById(html, "mtName", esc(row.name || ""));
        if (row.schoolRegion) out = replaceById(out, "mtMeta", esc(row.schoolRegion));
        if (row.tributeLine) {
          out = replaceById(out, "mtQuote", esc(row.tributeLine));
          out = showById(out, "mtQuote");
        }
        if (row.bioHtml) {
          out = replaceById(out, "mtBio", safeHtml(row.bioHtml));
          out = showById(out, "mtBioSec");
        }
        return out;
      }
      default:
        return html;
    }
  } catch (e) {
    console.warn("[shell-detail] 채우기 실패", pagePath, e);
    return html;
  }
}
