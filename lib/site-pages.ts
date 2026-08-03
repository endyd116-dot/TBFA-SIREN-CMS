/**
 * lib/site-pages.ts — 페이지 본체 저장소 헬퍼
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §3.1·§3.2
 *
 * 메뉴 하나가 가리키는 독립 페이지를 다룬다. 본문은 조각이 아니라 통짜 HTML.
 *
 * 핵심 규칙 3가지
 *  1. **임시저장 → 배포** 2단계. 편집은 draft_* 컬럼에만 쌓이고, [배포]를 눌러야 발행 컬럼으로 승격된다.
 *     (site_settings·nav_menu_items와 동일한 체계 — 배포 버튼 하나로 함께 나간다)
 *  2. **저장·배포 직전 상태를 자동 백업**한다. 통짜 편집은 실수 한 번에 페이지 전체가 날아가므로
 *     되돌릴 수단이 없으면 안 된다. 페이지당 최근 20개만 유지한다.
 *  3. **주소(slug)는 한글 제목에서 자동 생성**한다. 운영자가 영문 주소를 고민할 필요가 없다.
 *     예) "인사말" → insamal, "주요 연혁" → juyo-yeonhyeok
 */
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { sitePages, sitePageRevisions } from "../db/schema";

/** 페이지당 보관하는 되돌리기 이력 개수 */
export const REVISION_KEEP = 20;

export type PageStatus = "published" | "hidden";
export type PageLayout = "default" | "wide" | "plain";

export const VALID_STATUS: PageStatus[] = ["published", "hidden"];
export const VALID_LAYOUT: PageLayout[] = ["default", "wide", "plain"];

/* =========================================================
   1. 주소(slug) 자동 생성 — 한글 제목 → 로마자
   ========================================================= */

/* 국어의 로마자 표기법 근사. 자음동화 같은 예외는 적용하지 않는다 —
   주소로 쓸 수 있고 사람이 대충 읽을 수 있으면 충분하다. */
const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "p", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

/** 한글 음절을 로마자로 바꾼다. 한글이 아닌 문자는 그대로 통과시킨다. */
export function romanizeKorean(input: string): string {
  let out = "";
  for (const ch of String(input || "")) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171) {
      out += CHO[Math.floor(code / 588)]
        + JUNG[Math.floor((code % 588) / 28)]
        + JONG[code % 28];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 제목 → 주소로 쓸 수 있는 문자열. 비면 'page'를 돌려준다(호출부에서 번호를 붙인다). */
export function makeSlug(title: string): string {
  const slug = romanizeKorean(String(title || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // 영숫자 외 전부 하이픈
    .replace(/-{2,}/g, "-")        // 연속 하이픈 축약
    .replace(/^-|-$/g, "")         // 앞뒤 하이픈 제거
    .slice(0, 80);
  return slug || "page";
}

/** 이미 쓰는 주소면 -2, -3 …을 붙여 비어 있는 주소를 찾는다. */
export async function ensureUniqueSlug(base: string, excludeId?: number): Promise<string> {
  const clean = makeSlug(base);
  for (let n = 1; n <= 200; n++) {
    const candidate = n === 1 ? clean : `${clean}-${n}`;
    const conds: any[] = [eq(sitePages.slug, candidate)];
    if (excludeId) conds.push(ne(sitePages.id, excludeId));
    const [hit] = await db
      .select({ id: sitePages.id })
      .from(sitePages)
      .where(conds.length === 1 ? conds[0] : and(...conds))
      .limit(1);
    if (!hit) return candidate;
  }
  /* 200개까지 겹치는 건 사실상 불가능하지만, 무한루프 대신 시각을 붙여 확실히 비켜간다. */
  return `${clean}-${Date.now().toString(36)}`;
}

/* =========================================================
   2. 조회
   ========================================================= */

/** 관리자 목록 — 본문은 빼고 메타만. 목록 화면이 무거워지지 않게 한다. */
export async function listAdminPages(): Promise<any[]> {
  const rows = await db
    .select({
      id: sitePages.id,
      slug: sitePages.slug,
      title: sitePages.title,
      eyebrow: sitePages.eyebrow,
      subtitle: sitePages.subtitle,
      status: sitePages.status,
      layout: sitePages.layout,
      hasDraft: sitePages.hasDraft,
      draftTitle: sitePages.draftTitle,
      sortOrder: sitePages.sortOrder,
      viewCount: sitePages.viewCount,
      updatedAt: sitePages.updatedAt,
      createdAt: sitePages.createdAt,
    })
    .from(sitePages)
    .orderBy(asc(sitePages.sortOrder), asc(sitePages.id));
  return rows as any[];
}

/** 관리자 상세 — 본문 포함. 편집 화면이 쓴다. */
export async function getAdminPage(id: number): Promise<any | null> {
  const [row] = await db.select().from(sitePages).where(eq(sitePages.id, id)).limit(1);
  return (row as any) || null;
}

export async function getAdminPageBySlug(slug: string): Promise<any | null> {
  const [row] = await db.select().from(sitePages).where(eq(sitePages.slug, slug)).limit(1);
  return (row as any) || null;
}

/**
 * 공개 조회. preferDraft=true(관리자 미리보기)면 임시저장본을 보여준다.
 * 숨김 페이지는 미리보기가 아닌 한 없는 것으로 취급한다.
 */
export async function getPublicPage(
  slug: string,
  preferDraft = false,
): Promise<any | null> {
  const [row] = await db.select().from(sitePages).where(eq(sitePages.slug, slug)).limit(1);
  if (!row) return null;

  const r = row as any;
  if (r.status !== "published" && !preferDraft) return null;

  const useDraft = preferDraft && r.hasDraft;
  return {
    id: r.id,
    slug: r.slug,
    title: useDraft && r.draftTitle != null ? r.draftTitle : r.title,
    eyebrow: useDraft && r.draftEyebrow != null ? r.draftEyebrow : r.eyebrow,
    subtitle: useDraft && r.draftSubtitle != null ? r.draftSubtitle : r.subtitle,
    contentHtml: useDraft && r.draftContentHtml != null ? r.draftContentHtml : r.contentHtml,
    layout: r.layout,
    status: r.status,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    ogImageUrl: r.ogImageUrl,
    updatedAt: r.updatedAt,
    isDraftPreview: !!useDraft,
  };
}

/** 조회수 +1. 실패해도 페이지 표시를 막지 않는다. */
export async function bumpViewCount(id: number): Promise<void> {
  try {
    await db.execute(sql`UPDATE site_pages SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ${id}`);
  } catch (e) {
    console.warn("[site-pages.bumpViewCount]", e);
  }
}

/* =========================================================
   3. 되돌리기 백업
   ========================================================= */

/**
 * 지금 편집 중인 내용을 이력으로 남긴다.
 * - 저장 직전: 그 시점의 편집 상태(임시저장본 우선, 없으면 발행본)
 * - 배포 직전: 발행본
 * 직전 이력과 내용이 같으면 남기지 않는다(같은 내용이 20칸을 채우는 것 방지).
 */
async function snapshot(
  pageId: number,
  note: string,
  admin?: { uid?: number; name?: string },
  source: "draft" | "published" = "draft",
): Promise<void> {
  try {
    const cur = await getAdminPage(pageId);
    if (!cur) return;

    const useDraft = source === "draft" && cur.hasDraft;
    const snap = {
      title: useDraft && cur.draftTitle != null ? cur.draftTitle : cur.title,
      eyebrow: useDraft && cur.draftEyebrow != null ? cur.draftEyebrow : cur.eyebrow,
      subtitle: useDraft && cur.draftSubtitle != null ? cur.draftSubtitle : cur.subtitle,
      contentHtml: useDraft && cur.draftContentHtml != null ? cur.draftContentHtml : cur.contentHtml,
    };

    /* 직전 이력과 같으면 스킵 */
    const [last] = await db
      .select({ contentHtml: sitePageRevisions.contentHtml, title: sitePageRevisions.title })
      .from(sitePageRevisions)
      .where(eq(sitePageRevisions.pageId, pageId))
      .orderBy(desc(sitePageRevisions.savedAt), desc(sitePageRevisions.id))
      .limit(1);
    if (last && (last as any).contentHtml === snap.contentHtml && (last as any).title === snap.title) return;

    await db.insert(sitePageRevisions).values({
      pageId,
      title: snap.title ?? null,
      eyebrow: snap.eyebrow ?? null,
      subtitle: snap.subtitle ?? null,
      contentHtml: snap.contentHtml ?? null,
      note: note.slice(0, 200),
      savedBy: admin?.uid ?? null,
      savedByName: admin?.name ?? null,
    } as any);

    await pruneRevisions(pageId);
  } catch (e) {
    /* 백업 실패가 저장 자체를 막으면 안 된다 — 경고만 남기고 진행 */
    console.warn("[site-pages.snapshot]", e);
  }
}

/** 최근 REVISION_KEEP개만 남기고 오래된 이력 삭제 */
async function pruneRevisions(pageId: number): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM site_page_revisions
       WHERE page_id = ${pageId}
         AND id NOT IN (
           SELECT id FROM site_page_revisions
            WHERE page_id = ${pageId}
            ORDER BY saved_at DESC, id DESC
            LIMIT ${REVISION_KEEP}
         )
    `);
  } catch (e) {
    console.warn("[site-pages.pruneRevisions]", e);
  }
}

export async function listRevisions(pageId: number, limit = REVISION_KEEP): Promise<any[]> {
  const rows = await db
    .select({
      id: sitePageRevisions.id,
      title: sitePageRevisions.title,
      note: sitePageRevisions.note,
      savedBy: sitePageRevisions.savedBy,
      savedByName: sitePageRevisions.savedByName,
      savedAt: sitePageRevisions.savedAt,
      /* 목록에선 본문 전체 대신 길이만 — 응답이 커지는 걸 막는다 */
      contentLength: sql<number>`COALESCE(LENGTH(${sitePageRevisions.contentHtml}), 0)::int`,
    })
    .from(sitePageRevisions)
    .where(eq(sitePageRevisions.pageId, pageId))
    .orderBy(desc(sitePageRevisions.savedAt), desc(sitePageRevisions.id))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows as any[];
}

export async function getRevision(revisionId: number): Promise<any | null> {
  const [row] = await db
    .select().from(sitePageRevisions).where(eq(sitePageRevisions.id, revisionId)).limit(1);
  return (row as any) || null;
}

/**
 * 이력으로 되돌린다. **임시저장으로만** 복원하고 바로 발행하지 않는다 —
 * 운영자가 화면에서 확인한 뒤 [배포]를 눌러야 라이브에 나간다.
 */
export async function restoreRevision(
  pageId: number,
  revisionId: number,
  admin?: { uid?: number; name?: string },
): Promise<boolean> {
  const rev = await getRevision(revisionId);
  if (!rev || rev.pageId !== pageId) return false;

  /* 되돌리기 자체도 되돌릴 수 있게, 현재 상태를 먼저 남긴다 */
  await snapshot(pageId, "되돌리기 직전 자동 백업", admin);

  try {
    await db.update(sitePages).set({
      draftTitle: rev.title,
      draftEyebrow: rev.eyebrow,
      draftSubtitle: rev.subtitle,
      draftContentHtml: rev.contentHtml,
      hasDraft: true,
      updatedAt: new Date(),
      updatedBy: admin?.uid ?? null,
    } as any).where(eq(sitePages.id, pageId));
    return true;
  } catch (e) {
    console.error("[site-pages.restoreRevision]", e);
    return false;
  }
}

/* =========================================================
   4. 편집
   ========================================================= */

export interface CreatePagePayload {
  title: string;
  slug?: string | null;
  eyebrow?: string | null;
  subtitle?: string | null;
  contentHtml?: string | null;
  layout?: string | null;
  status?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogImageUrl?: string | null;
  sortOrder?: number | null;
}

/**
 * 페이지 생성. 주소를 안 주면 제목에서 자동 생성한다.
 * 새 페이지는 **임시저장 상태로 시작**한다 — 내용을 채우기 전에 라이브에 빈 페이지가 뜨면 안 되므로
 * 처음엔 숨김(hidden)으로 만들고, 운영자가 노출을 켜면 그때 보인다.
 */
export async function createPage(
  payload: CreatePagePayload,
  admin?: { uid?: number; name?: string },
): Promise<{ id: number; slug: string }> {
  const title = String(payload.title || "").trim();
  const slug = await ensureUniqueSlug(payload.slug ? String(payload.slug) : title);

  const layout = VALID_LAYOUT.includes(payload.layout as PageLayout)
    ? (payload.layout as PageLayout) : "default";
  const status = VALID_STATUS.includes(payload.status as PageStatus)
    ? (payload.status as PageStatus) : "hidden";

  const [row] = await db.insert(sitePages).values({
    slug,
    title: title || "제목 없는 페이지",
    eyebrow: payload.eyebrow ?? null,
    subtitle: payload.subtitle ?? null,
    contentHtml: payload.contentHtml ?? "",
    hasDraft: false,
    status,
    layout,
    seoTitle: payload.seoTitle ?? null,
    seoDescription: payload.seoDescription ?? null,
    ogImageUrl: payload.ogImageUrl ?? null,
    sortOrder: payload.sortOrder ?? 0,
    updatedBy: admin?.uid ?? null,
  } as any).returning({ id: sitePages.id });

  return { id: (row as any).id, slug };
}

export interface PageDraftPayload {
  title?: string;
  eyebrow?: string | null;
  subtitle?: string | null;
  contentHtml?: string;
}

/** 임시저장. 저장 직전 상태를 이력으로 남긴다. */
export async function savePageDraft(
  id: number,
  draft: PageDraftPayload,
  admin?: { uid?: number; name?: string },
): Promise<boolean> {
  const updateData: any = { hasDraft: true, updatedAt: new Date(), updatedBy: admin?.uid ?? null };
  if (draft.title !== undefined) updateData.draftTitle = draft.title;
  if (draft.eyebrow !== undefined) updateData.draftEyebrow = draft.eyebrow;
  if (draft.subtitle !== undefined) updateData.draftSubtitle = draft.subtitle;
  if (draft.contentHtml !== undefined) updateData.draftContentHtml = draft.contentHtml;

  await snapshot(id, "저장 전 자동 백업", admin);

  try {
    await db.update(sitePages).set(updateData).where(eq(sitePages.id, id));
    return true;
  } catch (e) {
    console.error("[site-pages.savePageDraft]", e);
    return false;
  }
}

/**
 * 노출·레이아웃·주소·검색설정 수정 — 본문과 달리 임시저장을 거치지 않고 바로 반영한다.
 * (급히 감춰야 할 때 배포를 기다릴 수 없다. 메뉴 노출 토글과 같은 정책.)
 */
export async function updatePageMeta(
  id: number,
  meta: {
    slug?: string;
    status?: string;
    layout?: string;
    seoTitle?: string | null;
    seoDescription?: string | null;
    ogImageUrl?: string | null;
    sortOrder?: number;
  },
  admin?: { uid?: number; name?: string },
): Promise<{ ok: boolean; slug?: string; error?: string }> {
  const updateData: any = { updatedAt: new Date(), updatedBy: admin?.uid ?? null };

  if (meta.slug !== undefined) {
    const wanted = makeSlug(meta.slug);
    updateData.slug = await ensureUniqueSlug(wanted, id);
  }
  if (meta.status !== undefined) {
    if (!VALID_STATUS.includes(meta.status as PageStatus)) return { ok: false, error: "노출 상태 값이 올바르지 않습니다" };
    updateData.status = meta.status;
  }
  if (meta.layout !== undefined) {
    if (!VALID_LAYOUT.includes(meta.layout as PageLayout)) return { ok: false, error: "레이아웃 값이 올바르지 않습니다" };
    updateData.layout = meta.layout;
  }
  if (meta.seoTitle !== undefined) updateData.seoTitle = meta.seoTitle;
  if (meta.seoDescription !== undefined) updateData.seoDescription = meta.seoDescription;
  if (meta.ogImageUrl !== undefined) updateData.ogImageUrl = meta.ogImageUrl;
  if (meta.sortOrder !== undefined) updateData.sortOrder = Number(meta.sortOrder) || 0;

  if (Object.keys(updateData).length <= 2) return { ok: false, error: "변경할 값이 없습니다" };

  try {
    await db.update(sitePages).set(updateData).where(eq(sitePages.id, id));
    return { ok: true, slug: updateData.slug };
  } catch (e) {
    console.error("[site-pages.updatePageMeta]", e);
    return { ok: false, error: "저장에 실패했습니다" };
  }
}

/** 배포 — 임시저장본을 발행본으로 승격. id를 주면 그 페이지만, 없으면 전체. */
export async function publishPages(
  id?: number,
  admin?: { uid?: number; name?: string },
): Promise<number> {
  /* 배포 직전 발행본을 남긴다 → 배포 후에도 이전 발행본으로 되돌릴 수 있다 */
  const targets = id
    ? [id]
    : (await db.select({ id: sitePages.id }).from(sitePages).where(eq(sitePages.hasDraft, true)))
        .map((r: any) => r.id);

  for (const pid of targets) {
    await snapshot(pid, "배포 전 자동 백업", admin, "published");
  }

  const conds: any[] = [eq(sitePages.hasDraft, true)];
  if (id) conds.push(eq(sitePages.id, id));

  const result = await db
    .update(sitePages)
    .set({
      title: sql`COALESCE(draft_title, title)` as any,
      eyebrow: sql`COALESCE(draft_eyebrow, eyebrow)` as any,
      subtitle: sql`COALESCE(draft_subtitle, subtitle)` as any,
      contentHtml: sql`COALESCE(draft_content_html, content_html)` as any,
      draftTitle: null,
      draftEyebrow: null,
      draftSubtitle: null,
      draftContentHtml: null,
      hasDraft: false,
      updatedAt: new Date(),
      updatedBy: admin?.uid ?? null,
    } as any)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .returning({ id: sitePages.id });

  return result.length;
}

export async function discardPageDraft(id: number): Promise<boolean> {
  try {
    await db.update(sitePages).set({
      draftTitle: null,
      draftEyebrow: null,
      draftSubtitle: null,
      draftContentHtml: null,
      hasDraft: false,
      updatedAt: new Date(),
    } as any).where(eq(sitePages.id, id));
    return true;
  } catch (e) {
    console.error("[site-pages.discardPageDraft]", e);
    return false;
  }
}

/** 이 페이지를 가리키는 메뉴 개수 — 삭제 전 경고에 쓴다. */
export async function countLinkedMenus(pageId: number): Promise<number> {
  try {
    const res: any = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM nav_menu_items WHERE site_page_id = ${pageId}`,
    );
    const rows = Array.isArray(res) ? res : (res?.rows || []);
    return Number(rows[0]?.cnt || 0);
  } catch {
    /* 아직 마이그 전이라 컬럼이 없는 경우 — 연결 0으로 본다 */
    return 0;
  }
}

/**
 * 페이지 삭제. 이력은 저장소 제약(CASCADE)으로 함께 지워진다.
 * 이 페이지를 가리키던 메뉴는 링크가 깨지지 않도록 '연결 없음'으로 되돌린다.
 */
export async function deletePage(id: number): Promise<boolean> {
  try {
    try {
      await db.execute(sql`
        UPDATE nav_menu_items
           SET site_page_id = NULL, draft_site_page_id = NULL, link_type = 'none', href = NULL
         WHERE site_page_id = ${id}
      `);
    } catch (e) {
      /* 마이그 전이면 컬럼이 없다 — 페이지 삭제 자체는 계속 진행 */
      console.warn("[site-pages.deletePage] 메뉴 연결 해제 건너뜀", e);
    }
    await db.delete(sitePages).where(eq(sitePages.id, id));
    return true;
  } catch (e) {
    console.error("[site-pages.deletePage]", e);
    return false;
  }
}

export async function countPageDrafts(): Promise<number> {
  try {
    const res: any = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM site_pages WHERE has_draft = true`,
    );
    const rows = Array.isArray(res) ? res : (res?.rows || []);
    return Number(rows[0]?.cnt || 0);
  } catch (e) {
    console.warn("[site-pages.countPageDrafts]", e);
    return 0;
  }
}
