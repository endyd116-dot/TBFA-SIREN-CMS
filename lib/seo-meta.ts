// lib/seo-meta.ts
// R42 SEO — site_settings(scope='seo') 기반 페이지/단체/기본/콘텐츠 메타 조회 헬퍼
//
// 키 패턴:
//   page:{path}:{field}            — 페이지별 메타 (예: page:/campaign.html:title)
//   org:{field}                    — 단체 구조화 데이터 (예: org:name)
//   default:{field}                — 사이트 전역 기본값 (예: default:site_name)
//
// 콘텐츠 메타는 동적(콘텐츠 테이블의 title/summary/thumbnailBlobId 등)으로 끌어옴.
//
// PageMeta 표준 필드:
//   title, description, og_title, og_description, og_image_url, canonical

import { and, eq, like, sql } from "drizzle-orm";
import { db } from "../db";
import {
  siteSettings,
  campaigns,
  activityPosts,
  incidents,
  familyStories,
  boardPosts,
  memorialTeachers,
} from "../db/schema";

export interface PageMeta {
  title: string;
  description: string;
  og_title: string;
  og_description: string;
  og_image_url: string;
  canonical: string;
}

export interface OrgMeta {
  name: string;
  legal_name: string;
  registration_no: string;
  representative: string;
  address: string;
  phone: string;
  email: string;
  url: string;
  logo_url: string;
  [k: string]: string;
}

export interface DefaultMeta {
  site_name: string;
  locale: string;
  title_suffix: string;
  default_og_image_url: string;
  [k: string]: string;
}

const SEO_FIELDS: (keyof PageMeta)[] = [
  "title",
  "description",
  "og_title",
  "og_description",
  "og_image_url",
  "canonical",
];

function emptyPageMeta(): PageMeta {
  return {
    title: "",
    description: "",
    og_title: "",
    og_description: "",
    og_image_url: "",
    canonical: "",
  };
}

function blobUrl(blobId: number | string | null | undefined): string {
  if (!blobId) return "";
  return `/api/blob-image?id=${blobId}`;
}

/**
 * scope='seo' AND key LIKE prefix% 의 모든 키를 가져와
 * {restOfKey: value} 맵으로 반환. preferDraft=true면 draft 우선.
 */
async function fetchSeoKeys(
  prefix: string,
  preferDraft: boolean,
): Promise<Record<string, { value: string; blobId: number | null; updatedAt: Date; hasDraft: boolean }>> {
  const rows = await db
    .select()
    .from(siteSettings)
    .where(and(
      eq(siteSettings.scope, "seo"),
      eq(siteSettings.isActive, true),
      like(siteSettings.key, `${prefix}%`),
    ));

  const out: Record<string, { value: string; blobId: number | null; updatedAt: Date; hasDraft: boolean }> = {};
  for (const r of rows as any[]) {
    const rest = String(r.key).slice(prefix.length);
    const useDraft = preferDraft && r.hasDraft;
    out[rest] = {
      value: String((useDraft ? r.draftValueText : r.valueText) ?? r.valueText ?? ""),
      blobId: (useDraft ? r.draftValueBlobId : r.valueBlobId) ?? r.valueBlobId ?? null,
      updatedAt: r.updatedAt,
      hasDraft: !!r.hasDraft,
    };
  }
  return out;
}

/**
 * 페이지 메타 조회 — site_settings에서 page:{path}:* 키들을 수집.
 * 누락된 필드는 빈 문자열.
 */
export async function getPageMeta(path: string, preferDraft = false): Promise<PageMeta> {
  const prefix = `page:${path}:`;
  const map = await fetchSeoKeys(prefix, preferDraft);

  const meta = emptyPageMeta();
  for (const f of SEO_FIELDS) {
    const row = map[f];
    if (!row) continue;
    if (f === "og_image_url" && row.blobId) {
      meta.og_image_url = blobUrl(row.blobId);
    } else {
      meta[f] = row.value;
    }
  }
  // og_image_blob_id 키 별도 지원
  const blobKey = map["og_image_blob_id"];
  if (blobKey && (blobKey.blobId || blobKey.value)) {
    meta.og_image_url = blobUrl(blobKey.blobId || blobKey.value);
  }
  return meta;
}

/**
 * 어드민 미리보기용 — published + draft 분리 반환 + og_image_url 변환.
 */
export async function getPageMetaSplit(path: string): Promise<{
  published: PageMeta;
  draft: PageMeta;
  hasDraft: boolean;
  lastUpdated: Date | null;
}> {
  const prefix = `page:${path}:`;
  const rows = await db
    .select()
    .from(siteSettings)
    .where(and(
      eq(siteSettings.scope, "seo"),
      eq(siteSettings.isActive, true),
      like(siteSettings.key, `${prefix}%`),
    ));

  const published = emptyPageMeta();
  const draft = emptyPageMeta();
  let hasDraft = false;
  let lastUpdated: Date | null = null;

  for (const r of rows as any[]) {
    const field = String(r.key).slice(prefix.length);
    if (r.hasDraft) hasDraft = true;
    if (!lastUpdated || (r.updatedAt && r.updatedAt > lastUpdated)) lastUpdated = r.updatedAt;

    // 운영
    if (field === "og_image_blob_id") {
      if (r.valueBlobId) published.og_image_url = blobUrl(r.valueBlobId);
      else if (r.valueText) published.og_image_url = blobUrl(r.valueText);
    } else if ((SEO_FIELDS as string[]).includes(field)) {
      (published as any)[field] = String(r.valueText ?? "");
    }

    // Draft
    if (r.hasDraft) {
      if (field === "og_image_blob_id") {
        const bid = r.draftValueBlobId ?? r.valueBlobId;
        if (bid) draft.og_image_url = blobUrl(bid);
      } else if ((SEO_FIELDS as string[]).includes(field)) {
        (draft as any)[field] = String(r.draftValueText ?? r.valueText ?? "");
      }
    }
  }

  return { published, draft, hasDraft, lastUpdated };
}

export async function getOrgMeta(preferDraft = false): Promise<OrgMeta> {
  const map = await fetchSeoKeys("org:", preferDraft);
  const out: OrgMeta = {
    name: "", legal_name: "", registration_no: "",
    representative: "", address: "", phone: "", email: "",
    url: "", logo_url: "",
  };
  for (const [k, v] of Object.entries(map)) {
    if (k === "logo_blob_id") {
      if (v.blobId) out.logo_url = blobUrl(v.blobId);
    } else {
      out[k] = v.value;
    }
  }
  return out;
}

export async function getDefaultMeta(preferDraft = false): Promise<DefaultMeta> {
  const map = await fetchSeoKeys("default:", preferDraft);
  const out: DefaultMeta = {
    site_name: "",
    locale: "ko_KR",
    title_suffix: "",
    default_og_image_url: "",
  };
  for (const [k, v] of Object.entries(map)) {
    if (k === "default_og_image_blob_id") {
      if (v.blobId) out.default_og_image_url = blobUrl(v.blobId);
    } else {
      out[k] = v.value || out[k] || "";
    }
  }
  return out;
}

/**
 * 콘텐츠 메타 조회 — 콘텐츠 테이블에서 직접 title/summary/thumbnail 끌어옴.
 * table: 'campaigns' | 'activityPosts' | 'incidents' | 'familyStories' | 'boardPosts' | 'memorialTeachers'
 * key:   slug 또는 id (문자열)
 */
export async function getContentMeta(table: string, key: string): Promise<PageMeta | null> {
  if (!key) return null;
  const meta = emptyPageMeta();

  try {
    switch (table) {
      case "campaigns": {
        const [row] = await db.select().from(campaigns)
          .where(eq(campaigns.slug, key)).limit(1);
        if (!row) return null;
        meta.title = row.title || "";
        meta.description = row.summary || "";
        meta.og_title = row.title || "";
        meta.og_description = row.summary || "";
        if (row.thumbnailBlobId) meta.og_image_url = blobUrl(row.thumbnailBlobId);
        meta.canonical = `/campaign.html?slug=${encodeURIComponent(key)}`;
        return meta;
      }
      case "activityPosts": {
        const [row] = await db.select().from(activityPosts)
          .where(eq(activityPosts.slug, key)).limit(1);
        if (!row) return null;
        meta.title = row.title || "";
        meta.description = row.summary || "";
        meta.og_title = row.title || "";
        meta.og_description = row.summary || "";
        if (row.thumbnailBlobId) meta.og_image_url = blobUrl(row.thumbnailBlobId);
        meta.canonical = `/activity.html?slug=${encodeURIComponent(key)}`;
        return meta;
      }
      case "incidents": {
        const [row] = await db.select().from(incidents)
          .where(eq(incidents.slug, key)).limit(1);
        if (!row) return null;
        meta.title = row.title || "";
        meta.description = row.summary || "";
        meta.og_title = row.title || "";
        meta.og_description = row.summary || "";
        if (row.thumbnailBlobId) meta.og_image_url = blobUrl(row.thumbnailBlobId);
        meta.canonical = `/incident.html?slug=${encodeURIComponent(key)}`;
        return meta;
      }
      case "familyStories": {
        const id = Number(key);
        if (!Number.isFinite(id)) return null;
        const [row] = await db.select().from(familyStories)
          .where(eq(familyStories.id, id)).limit(1);
        if (!row) return null;
        meta.title = row.title || "";
        meta.description = row.summary || row.subtitle || "";
        meta.og_title = row.title || "";
        meta.og_description = row.summary || row.subtitle || "";
        if (row.thumbnailUrl) meta.og_image_url = row.thumbnailUrl;
        meta.canonical = `/family-story.html?id=${id}`;
        return meta;
      }
      case "boardPosts": {
        const id = Number(key);
        if (!Number.isFinite(id)) return null;
        const [row] = await db.select({
          id: boardPosts.id,
          title: boardPosts.title,
          isHidden: boardPosts.isHidden,
        }).from(boardPosts).where(eq(boardPosts.id, id)).limit(1);
        if (!row || row.isHidden) return null;
        meta.title = row.title || "";
        meta.og_title = row.title || "";
        meta.canonical = `/board-view.html?id=${id}`;
        return meta;
      }
      case "memorialTeachers": {
        const id = Number(key);
        if (!Number.isFinite(id)) return null;
        const [row] = await db.select().from(memorialTeachers)
          .where(eq(memorialTeachers.id, id)).limit(1);
        if (!row) return null;
        meta.title = row.name || "";
        meta.description = row.tributeLine || "";
        meta.og_title = row.name || "";
        meta.og_description = row.tributeLine || "";
        if (row.photoBlobId) meta.og_image_url = blobUrl(row.photoBlobId);
        meta.canonical = `/memorial-teacher.html?id=${id}`;
        return meta;
      }
      default:
        return null;
    }
  } catch (e) {
    console.warn("[seo-meta.getContentMeta]", table, key, e);
    return null;
  }
}

/**
 * 페이지 단위 SELECT — site_settings에서 page:* prefix만 가져와 path별로 그룹화.
 * 어드민 목록 화면용.
 */
export async function listPageSeoKeys(): Promise<Array<{
  path: string;
  title: string;
  hasDraft: boolean;
  lastUpdated: Date | null;
}>> {
  const rows = await db
    .select()
    .from(siteSettings)
    .where(and(
      eq(siteSettings.scope, "seo"),
      like(siteSettings.key, "page:%"),
    ));

  const byPath: Record<string, { title: string; hasDraft: boolean; lastUpdated: Date | null }> = {};
  for (const r of rows as any[]) {
    // key 형식: page:{path}:{field} — path는 첫 콜론과 마지막 콜론 사이
    const k = String(r.key);
    const head = "page:".length;
    const lastColon = k.lastIndexOf(":");
    if (lastColon <= head) continue;
    const path = k.slice(head, lastColon);
    const field = k.slice(lastColon + 1);
    if (!byPath[path]) byPath[path] = { title: "", hasDraft: false, lastUpdated: null };
    if (field === "title") byPath[path].title = String(r.valueText || "");
    if (r.hasDraft) byPath[path].hasDraft = true;
    if (r.updatedAt && (!byPath[path].lastUpdated || r.updatedAt > byPath[path].lastUpdated!)) {
      byPath[path].lastUpdated = r.updatedAt;
    }
  }

  return Object.entries(byPath).map(([path, info]) => ({ path, ...info }));
}

/**
 * 페이지 메타 Draft 저장 — site_settings에 page:{path}:{field} 키로 upsert.
 * upsert: 기존 행 있으면 draft 컬럼만 갱신, 없으면 새 INSERT.
 */
export async function savePageMetaDraft(
  path: string,
  fields: Partial<Record<keyof PageMeta | "og_image_blob_id", string | number | null>>,
  updatedBy: number,
): Promise<number> {
  const prefix = `page:${path}:`;
  let count = 0;

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const key = `${prefix}${field}`;

    const [existing] = await db
      .select()
      .from(siteSettings)
      .where(and(eq(siteSettings.scope, "seo"), eq(siteSettings.key, key)))
      .limit(1);

    const isBlob = field === "og_image_blob_id";
    const draftText = isBlob ? null : (value === null ? null : String(value));
    const draftBlobId = isBlob ? (value === null ? null : Number(value)) : null;

    if (existing) {
      await db.update(siteSettings).set({
        draftValueText: draftText,
        draftValueBlobId: draftBlobId,
        hasDraft: true,
        updatedAt: new Date(),
        updatedBy,
      } as any).where(eq(siteSettings.id, (existing as any).id));
    } else {
      await db.insert(siteSettings).values({
        scope: "seo",
        key,
        valueType: isBlob ? "image_blob" : "text",
        valueText: isBlob ? null : "",
        valueBlobId: null,
        draftValueText: draftText,
        draftValueBlobId: draftBlobId,
        hasDraft: true,
        isActive: true,
        updatedBy,
      } as any);
    }
    count++;
  }
  return count;
}

/**
 * 특정 path만 publish — page:{path}:* 키만 draft → published 머지.
 */
export async function publishPageMeta(path: string): Promise<number> {
  const prefix = `page:${path}:`;
  const result = await db.update(siteSettings).set({
    valueText: sql`COALESCE(draft_value_text, value_text)` as any,
    valueBlobId: sql`COALESCE(draft_value_blob_id, value_blob_id)` as any,
    draftValueText: null,
    draftValueBlobId: null,
    hasDraft: false,
    updatedAt: new Date(),
  } as any).where(and(
    eq(siteSettings.scope, "seo"),
    like(siteSettings.key, `${prefix}%`),
    eq(siteSettings.hasDraft, true),
  )).returning({ id: siteSettings.id });
  return result.length;
}

/**
 * 단일 키 저장 (org/default 용) — Draft 시스템 없이 즉시 운영 반영 옵션 + draft 옵션.
 */
export async function saveSeoKey(
  key: string,
  value: string | null,
  opts: { draft?: boolean; blobId?: number | null; updatedBy: number },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(siteSettings)
    .where(and(eq(siteSettings.scope, "seo"), eq(siteSettings.key, key)))
    .limit(1);

  const isBlob = opts.blobId !== undefined;

  if (existing) {
    if (opts.draft) {
      await db.update(siteSettings).set({
        draftValueText: isBlob ? null : value,
        draftValueBlobId: isBlob ? opts.blobId ?? null : null,
        hasDraft: true,
        updatedAt: new Date(),
        updatedBy: opts.updatedBy,
      } as any).where(eq(siteSettings.id, (existing as any).id));
    } else {
      await db.update(siteSettings).set({
        valueText: isBlob ? null : value,
        valueBlobId: isBlob ? opts.blobId ?? null : null,
        draftValueText: null,
        draftValueBlobId: null,
        hasDraft: false,
        updatedAt: new Date(),
        updatedBy: opts.updatedBy,
      } as any).where(eq(siteSettings.id, (existing as any).id));
    }
  } else {
    await db.insert(siteSettings).values({
      scope: "seo",
      key,
      valueType: isBlob ? "image_blob" : "text",
      valueText: opts.draft ? null : (isBlob ? null : value),
      valueBlobId: opts.draft ? null : (isBlob ? opts.blobId ?? null : null),
      draftValueText: opts.draft && !isBlob ? value : null,
      draftValueBlobId: opts.draft && isBlob ? opts.blobId ?? null : null,
      hasDraft: !!opts.draft,
      isActive: true,
      updatedBy: opts.updatedBy,
    } as any);
  }
}
