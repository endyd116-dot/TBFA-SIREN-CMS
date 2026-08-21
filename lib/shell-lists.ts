// lib/shell-lists.ts
// ★ 2026-08-21 (구글 광고그랜트 심사 대응 C단계)
//
// 문제: 목록 화면(활동 내용·공지사항·언론보도·캠페인·추모관·유가족 이야기·
//      사건 제보·자료실·자유게시판)이 서버가 내보내는 원본에는 "불러오는 중..."
//      글자만 있었다. 내용은 브라우저가 나중에 채우기 때문이다.
//      검색엔진·심사기관은 브라우저를 돌리지 않으므로 이 화면들을 "내용 없는 페이지"로 읽는다.
//      (구글 광고그랜트 웹사이트 정책: "상당한 양의 자체 제작 콘텐츠" 요구)
//
// 해결: 서버가 목록 자리를 실제 항목으로 미리 채워서 내보낸다.
//      브라우저는 지금처럼 다시 조회해서 같은 자리를 다시 그린다 — 동작 변화 없음.
//
// 원칙: 어느 단계에서 실패하든 원본 화면은 그대로 나가야 한다.
//      조회 실패·항목 0건이면 아무것도 바꾸지 않는다(기존 안내 문구 유지).

import { esc, replaceById } from "./shell-html";

/* ------------------------------------------------------------------ */
/* 공통 도우미                                                          */
/* ------------------------------------------------------------------ */

/** 날짜 표시 — 한국 날짜 기준 (2026.08.21) */
function fmtDate(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, "0")}.${String(kst.getUTCDate()).padStart(2, "0")}`;
}

/** 숨겨둔 자리를 보이게 한다 (style의 display:none 제거) */
function showById(html: string, id: string): string {
  const re = new RegExp(`(<\\w+\\b[^>]*\\bid="${id}"[^>]*>)`);
  return html.replace(re, (open: string) =>
    open.replace(/style="([^"]*)"/, (_m, style: string) => {
      const next = String(style).replace(/display\s*:\s*none\s*;?/gi, "").trim();
      return next ? `style="${next}"` : "";
    })
  );
}

/** 안내 자리를 감춘다 (불러오는 중·곧 채워집니다 등) */
function hideById(html: string, id: string): string {
  const re = new RegExp(`(<\\w+\\b[^>]*\\bid="${id}"[^>]*>)`);
  if (!re.test(html)) return html;
  return html.replace(re, (open: string) => {
    if (/display\s*:\s*none/i.test(open)) return open;   /* 이미 감춰져 있으면 그대로 */
    if (/style="/.test(open)) {
      return open.replace(/style="([^"]*)"/, (_m, style: string) => `style="${style};display:none"`);
    }
    return open.replace(/>$/, ' style="display:none">');
  });
}

/** 목록 조회 한 건 — 실패해도 빈 배열로 계속 */
async function safeRows<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch (e) {
    console.warn(`[shell-lists] ${label} 조회 실패`, e);
    return [];
  }
}

/* 분류 이름표 — 화면(js)과 같은 표기를 쓴다 */
const NOTICE_CATS: Record<string, { label: string; cls: string }> = {
  general: { label: "일반공지", cls: "tag-mute" },
  member: { label: "회원공지", cls: "tag-sec" },
  event: { label: "사업안내", cls: "tag-pri" },
  media: { label: "언론보도", cls: "tag-mute" },
};

const ACTIVITY_CATS: Record<string, string> = {
  report: "활동 보고",
  photo: "현장 사진",
  news: "활동 뉴스",
  notice: "안내",
};

const MEDIA_CATS: Record<string, string> = {
  press: "언론보도",
  gallery: "갤러리",
  broadcast: "방송",
};

const BOARD_CATS: Record<string, string> = {
  free: "자유",
  experience: "경험 공유",
  question: "질문",
  info: "정보",
  etc: "기타",
};

/* ------------------------------------------------------------------ */
/* 화면별 그리기                                                        */
/* ------------------------------------------------------------------ */

function renderNoticeRows(list: any[]): string {
  return list
    .map((n, i) => {
      const cat = NOTICE_CATS[n.category] || { label: "공지", cls: "tag-mute" };
      const pin = n.isPinned ? '<span class="news-pin">고정</span>' : "";
      return (
        `<tr data-news-id="${esc(n.id)}">` +
        `<td>${i + 1}</td>` +
        `<td><span class="tag ${cat.cls}">${esc(cat.label)}</span></td>` +
        `<td>${pin}${esc(n.title || "")}</td>` +
        `<td>${esc(fmtDate(n.publishedAt || n.createdAt))}</td>` +
        `<td>${esc(Number(n.views || 0).toLocaleString("en-US"))}</td>` +
        `</tr>`
      );
    })
    .join("");
}

function renderActivityAlbum(list: any[]): string {
  const cards = list
    .map((p) => {
      const period = `${esc(p.year || "")}${p.month ? "." + String(p.month).padStart(2, "0") : ""}`;
      return (
        `<a class="act-card" href="/activity.html?slug=${encodeURIComponent(String(p.slug || ""))}">` +
        `<div class="act-card-thumb"><span class="placeholder"></span>` +
        `<span class="cat-mark">${esc(ACTIVITY_CATS[p.category] || "활동")}</span>` +
        (p.isPinned ? '<span class="pin-mark">고정</span>' : "") +
        `</div>` +
        `<div class="act-card-body">` +
        `<div class="act-card-meta">${period}</div>` +
        `<h3 class="act-card-title">${esc(p.title || "")}</h3>` +
        `<p class="act-card-summary">${esc(p.summary || "")}</p>` +
        `<div class="act-card-bottom"><span>${esc(fmtDate(p.publishedAt))}</span>` +
        `<span>${esc(Number(p.views || 0).toLocaleString("en-US"))}</span></div>` +
        `</div></a>`
      );
    })
    .join("");
  return `<div class="act-album">${cards}</div>`;
}

function renderMediaGrid(list: any[]): string {
  const cards = list
    .map((m) => {
      const href = m.externalUrl ? String(m.externalUrl) : "";
      const open = href
        ? `<a class="media-card" href="${esc(href)}" target="_blank" rel="noopener">`
        : `<div class="media-card">`;
      const close = href ? "</a>" : "</div>";
      return (
        open +
        `<div class="media-card-body">` +
        `<span class="media-cat">${esc(MEDIA_CATS[m.category] || "보도")}</span>` +
        `<h3 class="media-title">${esc(m.title || "")}</h3>` +
        `<p class="media-summary">${esc(m.summary || "")}</p>` +
        `<div class="media-meta"><span>${esc(m.source || "")}</span>` +
        `<span>${esc(fmtDate(m.publishedAt))}</span></div>` +
        `</div>` +
        close
      );
    })
    .join("");
  return `<div class="media-grid-inner">${cards}</div>`;
}

function renderCampaignCards(list: any[]): string {
  return list
    .map((c) => {
      const goal = Number(c.goalAmount || 0);
      const now = Number(c.raisedAmount || 0);
      const pct = goal > 0 ? Math.min(100, Math.round((now / goal) * 100)) : 0;
      return (
        `<a class="cmp-card" href="/campaign.html?slug=${encodeURIComponent(String(c.slug || ""))}">` +
        `<div class="cmp-card-body">` +
        `<h3 class="cmp-card-title">${esc(c.title || "")}</h3>` +
        `<p class="cmp-card-summary">${esc(c.summary || "")}</p>` +
        (goal > 0
          ? `<div class="cmp-card-progress"><span>${pct}% 달성</span>` +
            `<span>목표 ${esc(goal.toLocaleString("en-US"))}원</span></div>`
          : "") +
        `</div></a>`
      );
    })
    .join("");
}

function renderIncidentCards(list: any[]): string {
  return list
    .map((it) => {
      const meta = [it.location, fmtDate(it.occurredAt)].filter(Boolean).map(String);
      return (
        `<a class="incident-card" href="/incident.html?slug=${encodeURIComponent(String(it.slug || ""))}">` +
        `<h3 class="incident-title">${esc(it.title || "")}</h3>` +
        `<p class="incident-summary">${esc(it.summary || "")}</p>` +
        (meta.length ? `<div class="incident-meta">${esc(meta.join(" · "))}</div>` : "") +
        `</a>`
      );
    })
    .join("");
}

function renderResourceCards(list: any[]): string {
  return list
    .map(
      (r) =>
        `<a class="res-card" href="/resources.html?id=${esc(r.id)}">` +
        `<h3 class="res-card-title">${esc(r.title || "")}</h3>` +
        `<p class="res-card-desc">${esc(r.description || "")}</p>` +
        `<div class="res-card-meta">${esc(fmtDate(r.publishedAt || r.createdAt))}</div>` +
        `</a>`
    )
    .join("");
}

function renderBoardRows(list: any[]): string {
  const rows = list
    .map((p) => {
      const who = p.isAnonymous ? "익명" : String(p.authorName || "회원");
      return (
        `<tr data-post-id="${esc(p.id)}">` +
        `<td class="col-no">${esc(p.id)}</td>` +
        `<td class="col-cat"><span class="board-cat-badge ${esc(p.category || "free")}">` +
        `${esc(BOARD_CATS[p.category] || "자유")}</span></td>` +
        `<td class="col-title">${esc(p.title || "")}</td>` +
        `<td class="col-author">${esc(who)}</td>` +
        `<td class="col-date">${esc(fmtDate(p.createdAt))}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table class="board-table"><thead><tr>` +
    `<th class="col-no">번호</th><th class="col-cat">분류</th><th>제목</th>` +
    `<th class="col-author">작성자</th><th class="col-date">작성일</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderMemorialCards(list: any[]): string {
  return list
    .map(
      (t) =>
        `<a class="mem-card" href="/memorial-teacher.html?id=${esc(t.id)}">` +
        `<div class="mem-card-name">${esc(t.name || "")}</div>` +
        (t.schoolRegion ? `<div class="mem-card-region">${esc(t.schoolRegion)}</div>` : "") +
        (t.tributeLine ? `<p class="mem-card-line">${esc(t.tributeLine)}</p>` : "") +
        `</a>`
    )
    .join("");
}

function renderStoryCards(list: any[]): string {
  return list
    .map(
      (s) =>
        `<a class="story-card" href="/family-story.html?id=${esc(s.id)}">` +
        `<div class="story-body">` +
        `<h3 class="story-title">${esc(s.title || "")}</h3>` +
        (s.subtitle ? `<div class="story-duration">${esc(s.subtitle)}</div>` : "") +
        `<p class="story-summary">${esc(s.summary || "")}</p>` +
        `</div></a>`
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* 화면별 조회 + 채우기                                                  */
/*                                                                      */
/* 조회(loadListSeed)와 채우기(applyListSeed)를 나눠 둔 이유:              */
/*   page-shell 이 뼈대 조회·목록 조회·검색엔진 정보 조회를 '동시에' 돌릴 수  */
/*   있게 하려는 것. 차례로 기다리면 첫 방문 응답이 그만큼 늦어진다.          */
/*   (2026-08-21 실측: 캐시 없는 첫 방문 4.5초 — 구글 거부 사유 1번)        */
/* ------------------------------------------------------------------ */

const SEED_PAGES = new Set([
  "/activities.html",
  "/news.html",
  "/notice.html",
  "/press.html",
  "/campaigns.html",
  "/incidents.html",
  "/resources.html",
  "/board.html",
  "/memorial.html",
  "/family-stories.html",
]);

/** 이 화면이 서버 채우기 대상인지 */
export function hasListSeed(pagePath: string): boolean {
  return SEED_PAGES.has(pagePath);
}

/** 화면에 채워 넣을 목록들 — 자리 이름(id) → 항목 배열 */
export type ListSeed = Record<string, any[]>;

/**
 * 이 화면에 필요한 목록을 한꺼번에(동시에) 읽어 온다.
 * 실패한 목록은 빈 배열이 되고, 나머지는 그대로 쓰인다.
 */
export async function loadListSeed(pagePath: string): Promise<ListSeed> {
  if (!SEED_PAGES.has(pagePath)) return {};

  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { eq, and, asc, desc, sql } = await import("drizzle-orm");

  const jobs: Array<Promise<[string, any[]]>> = [];
  const add = (slotId: string, label: string, run: () => Promise<any[]>) => {
    jobs.push(safeRows(label, run).then((rows) => [slotId, rows] as [string, any[]]));
  };

  /* ---------- 공지사항 (소식 화면 + 공지 화면) ---------- */
  if (pagePath === "/news.html" || pagePath === "/notice.html") {
    add("newsTableBody", "공지사항", () =>
      db
        .select({
          id: schema.notices.id,
          category: schema.notices.category,
          title: schema.notices.title,
          isPinned: schema.notices.isPinned,
          views: schema.notices.views,
          publishedAt: schema.notices.publishedAt,
          createdAt: schema.notices.createdAt,
        })
        .from(schema.notices)
        .where(eq(schema.notices.isPublished, true))
        .orderBy(
          desc(schema.notices.isPinned),
          sql`CASE WHEN ${schema.notices.sortOrder} = 0 THEN 1 ELSE 0 END`,
          asc(schema.notices.sortOrder),
          desc(schema.notices.publishedAt),
          desc(schema.notices.id)
        )
        .limit(20)
    );
  }

  /* ---------- 언론보도 (소식 화면 + 언론보도 화면) ---------- */
  if (pagePath === "/news.html" || pagePath === "/press.html") {
    add("mediaGrid", "언론보도", () =>
      db
        .select({
          id: schema.mediaPosts.id,
          category: schema.mediaPosts.category,
          title: schema.mediaPosts.title,
          summary: schema.mediaPosts.summary,
          externalUrl: schema.mediaPosts.externalUrl,
          source: schema.mediaPosts.source,
          publishedAt: schema.mediaPosts.publishedAt,
        })
        .from(schema.mediaPosts)
        .where(eq(schema.mediaPosts.isPublished, true))
        .orderBy(desc(schema.mediaPosts.publishedAt))
        .limit(12)
    );
  }

  /* ---------- 활동 내용 ---------- */
  if (pagePath === "/activities.html") {
    add("actAlbum", "활동 내용", () =>
      db
        .select({
          id: schema.activityPosts.id,
          slug: schema.activityPosts.slug,
          year: schema.activityPosts.year,
          month: schema.activityPosts.month,
          category: schema.activityPosts.category,
          title: schema.activityPosts.title,
          summary: schema.activityPosts.summary,
          isPinned: schema.activityPosts.isPinned,
          views: schema.activityPosts.views,
          publishedAt: schema.activityPosts.publishedAt,
        })
        .from(schema.activityPosts)
        .where(eq(schema.activityPosts.isPublished, true))
        .orderBy(desc(schema.activityPosts.isPinned), desc(schema.activityPosts.publishedAt))
        .limit(12)
    );
  }

  /* ---------- 캠페인 ---------- */
  if (pagePath === "/campaigns.html") {
    add("cmpGrid", "캠페인", () =>
      db
        .select({
          id: schema.campaigns.id,
          slug: schema.campaigns.slug,
          title: schema.campaigns.title,
          summary: schema.campaigns.summary,
          goalAmount: schema.campaigns.goalAmount,
          raisedAmount: schema.campaigns.raisedAmount,
          isPinned: schema.campaigns.isPinned,
          createdAt: schema.campaigns.createdAt,
        })
        .from(schema.campaigns)
        .where(and(eq(schema.campaigns.isPublished, true), eq(schema.campaigns.status, "active")))
        .orderBy(desc(schema.campaigns.isPinned), desc(schema.campaigns.createdAt))
        .limit(12)
    );
  }

  /* ---------- 사건 제보 ---------- */
  if (pagePath === "/incidents.html") {
    add("incidentList", "사건 목록", () =>
      db
        .select({
          id: schema.incidents.id,
          slug: schema.incidents.slug,
          title: schema.incidents.title,
          summary: schema.incidents.summary,
          occurredAt: schema.incidents.occurredAt,
          location: schema.incidents.location,
        })
        .from(schema.incidents)
        .where(eq(schema.incidents.status, "active"))
        .orderBy(asc(schema.incidents.sortOrder), desc(schema.incidents.occurredAt))
        .limit(20)
    );
  }

  /* ---------- 자료실 (누구나 볼 수 있는 자료만) ---------- */
  if (pagePath === "/resources.html") {
    add("resGrid", "자료실", () =>
      db
        .select({
          id: schema.resources.id,
          title: schema.resources.title,
          description: schema.resources.description,
          publishedAt: schema.resources.publishedAt,
          createdAt: schema.resources.createdAt,
        })
        .from(schema.resources)
        .where(
          and(eq(schema.resources.isPublished, true), eq(schema.resources.accessLevel, "public"))
        )
        .orderBy(desc(schema.resources.isPinned), desc(schema.resources.publishedAt))
        .limit(12)
    );
  }

  /* ---------- 자유게시판 ---------- */
  if (pagePath === "/board.html") {
    add("boardListContainer", "게시판", () =>
      db
        .select({
          id: schema.boardPosts.id,
          category: schema.boardPosts.category,
          title: schema.boardPosts.title,
          authorName: schema.boardPosts.authorName,
          isAnonymous: schema.boardPosts.isAnonymous,
          createdAt: schema.boardPosts.createdAt,
        })
        .from(schema.boardPosts)
        .where(eq(schema.boardPosts.isHidden, false))
        .orderBy(desc(schema.boardPosts.isPinned), desc(schema.boardPosts.createdAt))
        .limit(20)
    );
  }

  /* ---------- 추모관 ---------- */
  if (pagePath === "/memorial.html") {
    add("memTeacherGrid", "추모관", () =>
      db
        .select({
          id: schema.memorialTeachers.id,
          name: schema.memorialTeachers.name,
          schoolRegion: schema.memorialTeachers.schoolRegion,
          tributeLine: schema.memorialTeachers.tributeLine,
        })
        .from(schema.memorialTeachers)
        .where(eq(schema.memorialTeachers.isPublic, true))
        .orderBy(asc(schema.memorialTeachers.sortOrder), asc(schema.memorialTeachers.id))
        .limit(24)
    );
  }

  /* ---------- 유가족 이야기 ---------- */
  if (pagePath === "/family-stories.html") {
    add("storiesGrid", "유가족 이야기", () =>
      db
        .select({
          id: schema.familyStories.id,
          title: schema.familyStories.title,
          subtitle: schema.familyStories.subtitle,
          summary: schema.familyStories.summary,
        })
        .from(schema.familyStories)
        .where(eq(schema.familyStories.status, "published"))
        .orderBy(asc(schema.familyStories.sortOrder), asc(schema.familyStories.publishedAt))
        .limit(24)
    );
  }

  const pairs = await Promise.all(jobs);
  const out: ListSeed = {};
  for (const [slotId, rows] of pairs) out[slotId] = rows;
  return out;
}

/* 자리 이름 → 그리기 함수 */
const RENDERERS: Record<string, (rows: any[]) => string> = {
  newsTableBody: renderNoticeRows,
  mediaGrid: renderMediaGrid,
  actAlbum: renderActivityAlbum,
  cmpGrid: renderCampaignCards,
  incidentList: renderIncidentCards,
  resGrid: renderResourceCards,
  boardListContainer: renderBoardRows,
  memTeacherGrid: renderMemorialCards,
  storiesGrid: renderStoryCards,
};

/* 채운 뒤 감춤·보임을 손봐야 하는 자리 */
const AFTER_FILL: Record<string, { show: string[]; hide: string[] }> = {
  memTeacherGrid: { show: ["memTeacherGrid"], hide: ["memTeacherLoading", "memTeacherEmpty"] },
  storiesGrid: { show: ["storiesGrid"], hide: ["storiesLoading", "storiesEmpty"] },
};

/**
 * 읽어 온 목록을 화면의 제자리에 넣는다.
 * 항목이 없으면 그 자리는 건드리지 않는다(기존 안내 문구 유지).
 */
export function applyListSeed(pagePath: string, html: string, seed: ListSeed): string {
  if (!SEED_PAGES.has(pagePath) || !seed) return html;

  let out = html;
  for (const [slotId, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const render = RENDERERS[slotId];
    if (!render) continue;
    try {
      out = replaceById(out, slotId, render(rows));
      const after = AFTER_FILL[slotId];
      if (after) {
        for (const id of after.show) out = showById(out, id);
        for (const id of after.hide) out = hideById(out, id);
      }
    } catch (e) {
      console.warn("[shell-lists] 채우기 실패", slotId, e);
    }
  }
  return out;
}
