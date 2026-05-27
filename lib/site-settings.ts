// lib/site-settings.ts
// ★ 2026-05 Phase A + B: 메인 화면 관리 시스템 — 헬퍼 라이브러리
// - 공개/관리자 양쪽에서 사용
// - 캐싱은 호출 측에서 처리
//
// v2 (Phase B): nav_menu_items + related_sites 헬퍼 추가

import { eq, and, isNull, sql, asc } from "drizzle-orm";
import { db } from "../db";
import { siteSettings, navMenuItems, relatedSites } from "../db/schema";

export type SettingValueType = "text" | "html" | "image_blob" | "number" | "json";

export interface SettingItem {
  id: number;
  scope: string;
  key: string;
  valueType: string;
  valueText: string | null;
  valueBlobId: number | null;
  valueJson: any;
  hasDraft: boolean;
  draftValueText?: string | null;
  draftValueBlobId?: number | null;
  draftValueJson?: any;
  description: string | null;
  sortOrder: number;
  updatedAt: Date;
}

/* =========================================================
   site_settings 헬퍼 (Phase A)
   ========================================================= */

export async function getPublishedSettings(scope?: string): Promise<Record<string, Record<string, any>>> {
  const conds: any[] = [eq(siteSettings.isActive, true)];
  if (scope) conds.push(eq(siteSettings.scope, scope));

  const where = conds.length === 1 ? conds[0] : and(...conds);

  const rows = await db
    .select({
      scope: siteSettings.scope,
      key: siteSettings.key,
      valueType: siteSettings.valueType,
      valueText: siteSettings.valueText,
      valueBlobId: siteSettings.valueBlobId,
      valueJson: siteSettings.valueJson,
    })
    .from(siteSettings)
    .where(where as any)
    .orderBy(siteSettings.scope, siteSettings.sortOrder);

  const result: Record<string, Record<string, any>> = {};
  for (const r of rows as any[]) {
    if (!result[r.scope]) result[r.scope] = {};
    result[r.scope][r.key] = parseSettingValue(r);
  }
  return result;
}

/**
 * ★ Phase B: Draft 우선 (어드민 미리보기용)
 * preferDraft=true 인 경우 draft 값이 있으면 그것을, 없으면 운영 값
 */
export async function getDraftSettings(scope?: string): Promise<Record<string, Record<string, any>>> {
  const conds: any[] = [eq(siteSettings.isActive, true)];
  if (scope) conds.push(eq(siteSettings.scope, scope));

  const where = conds.length === 1 ? conds[0] : and(...conds);

  const rows = await db
    .select()
    .from(siteSettings)
    .where(where as any)
    .orderBy(siteSettings.scope, siteSettings.sortOrder);

  const result: Record<string, Record<string, any>> = {};
  for (const r of rows as any[]) {
    if (!result[r.scope]) result[r.scope] = {};
    if (r.hasDraft) {
      result[r.scope][r.key] = parseSettingValue({
        valueType: r.valueType,
        valueText: r.draftValueText ?? r.valueText,
        valueBlobId: r.draftValueBlobId ?? r.valueBlobId,
        valueJson: r.draftValueJson ?? r.valueJson,
      });
    } else {
      result[r.scope][r.key] = parseSettingValue(r);
    }
  }
  return result;
}

export async function getAdminSettings(scope?: string): Promise<SettingItem[]> {
  const conds: any[] = [];
  if (scope) conds.push(eq(siteSettings.scope, scope));

  const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

  const rows = await db
    .select()
    .from(siteSettings)
    .where(where as any)
    .orderBy(siteSettings.scope, siteSettings.sortOrder);

  return rows as any;
}

export async function getSetting(
  scope: string,
  key: string,
  preferDraft = false,
): Promise<any> {
  const [row] = await db
    .select()
    .from(siteSettings)
    .where(and(eq(siteSettings.scope, scope), eq(siteSettings.key, key)))
    .limit(1);

  if (!row) return null;

  if (preferDraft && (row as any).hasDraft) {
    return parseSettingValue({
      valueType: (row as any).valueType,
      valueText: (row as any).draftValueText,
      valueBlobId: (row as any).draftValueBlobId,
      valueJson: (row as any).draftValueJson,
    });
  }
  return parseSettingValue(row as any);
}

export async function saveDraft(
  id: number,
  draft: { valueText?: string | null; valueBlobId?: number | null; valueJson?: any },
  updatedBy: number,
): Promise<boolean> {
  const updateData: any = {
    hasDraft: true,
    updatedAt: new Date(),
    updatedBy,
  };
  if (draft.valueText !== undefined) updateData.draftValueText = draft.valueText;
  if (draft.valueBlobId !== undefined) updateData.draftValueBlobId = draft.valueBlobId;
  if (draft.valueJson !== undefined) updateData.draftValueJson = draft.valueJson;

  try {
    await db.update(siteSettings).set(updateData).where(eq(siteSettings.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.saveDraft]", e);
    return false;
  }
}

export async function publishDrafts(scope?: string): Promise<number> {
  const conds: any[] = [eq(siteSettings.hasDraft, true)];
  if (scope) conds.push(eq(siteSettings.scope, scope));

  const where = conds.length === 1 ? conds[0] : and(...conds);

  const result = await db
    .update(siteSettings)
    .set({
      valueText: sql`COALESCE(draft_value_text, value_text)` as any,
      valueBlobId: sql`COALESCE(draft_value_blob_id, value_blob_id)` as any,
      valueJson: sql`COALESCE(draft_value_json, value_json)` as any,
      draftValueText: null,
      draftValueBlobId: null,
      draftValueJson: null,
      hasDraft: false,
      updatedAt: new Date(),
    } as any)
    .where(where as any)
    .returning({ id: siteSettings.id });

  return result.length;
}

export async function discardDraft(id: number): Promise<boolean> {
  try {
    await db.update(siteSettings).set({
      draftValueText: null,
      draftValueBlobId: null,
      draftValueJson: null,
      hasDraft: false,
      updatedAt: new Date(),
    } as any).where(eq(siteSettings.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.discardDraft]", e);
    return false;
  }
}

function parseSettingValue(row: {
  valueType: string;
  valueText?: string | null;
  valueBlobId?: number | null;
  valueJson?: any;
}): any {
  switch (row.valueType) {
    case "number":
      return row.valueText !== null && row.valueText !== undefined
        ? Number(row.valueText)
        : null;

    case "json":
      return row.valueJson;

    case "image_blob":
      return row.valueBlobId
        ? { blobId: row.valueBlobId, url: `/api/blob-image?id=${row.valueBlobId}` }
        : null;

    case "html":
    case "text":
    default:
      return row.valueText || "";
  }
}

/* =========================================================
   ★ Phase B: nav_menu_items 헬퍼
   ========================================================= */

export interface MenuItem {
  id: number;
  parentId: number | null;
  menuLocation: string;
  label: string;
  href: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  opensModal: string | null;
  pageKey: string | null;
  target: string | null;
  cssClass: string | null;
  hasDraft: boolean;
  draftLabel?: string | null;
  draftHref?: string | null;
  draftSortOrder?: number | null;
  children?: MenuItem[];
}

/**
 * 메뉴 트리 조회 (location별)
 * preferDraft=true 면 draft 값 우선 반환 (어드민 미리보기용)
 */
export async function getNavMenus(
  location: string,
  preferDraft = false,
): Promise<MenuItem[]> {
  const rows = await db
    .select()
    .from(navMenuItems)
    .where(and(
      eq(navMenuItems.menuLocation, location),
      eq(navMenuItems.isActive, true),
    ))
    .orderBy(asc(navMenuItems.sortOrder), asc(navMenuItems.id));

  /* draft 우선 적용 + 트리 구성 */
  const items: MenuItem[] = (rows as any[]).map((r) => {
    const useDraft = preferDraft && r.hasDraft;
    return {
      id: r.id,
      parentId: r.parentId,
      menuLocation: r.menuLocation,
      label: useDraft && r.draftLabel != null ? r.draftLabel : r.label,
      href: useDraft && r.draftHref != null ? r.draftHref : r.href,
      icon: r.icon,
      sortOrder: useDraft && r.draftSortOrder != null ? r.draftSortOrder : (r.sortOrder || 0),
      isActive: r.isActive,
      opensModal: r.opensModal,
      pageKey: r.pageKey,
      target: r.target,
      cssClass: r.cssClass,
      hasDraft: r.hasDraft,
      draftLabel: r.draftLabel,
      draftHref: r.draftHref,
      draftSortOrder: r.draftSortOrder,
    };
  });

  /* sortOrder 재정렬 (draft 적용 후) */
  items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  /* 트리 구성 — parentId가 null이면 root */
  const map = new Map<number, MenuItem>();
  items.forEach((it) => map.set(it.id, { ...it, children: [] }));

  const roots: MenuItem[] = [];
  for (const it of items) {
    const node = map.get(it.id)!;
    if (it.parentId && map.has(it.parentId)) {
      const parent = map.get(it.parentId)!;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * 어드민용 — flat 리스트로 모든 메뉴 (active 무관)
 */
export async function getAdminNavMenus(location?: string): Promise<MenuItem[]> {
  const conds: any[] = [];
  if (location) conds.push(eq(navMenuItems.menuLocation, location));
  const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

  const rows = await db
    .select()
    .from(navMenuItems)
    .where(where as any)
    .orderBy(asc(navMenuItems.menuLocation), asc(navMenuItems.sortOrder), asc(navMenuItems.id));

  return rows as any;
}

export async function createMenuItem(payload: {
  parentId?: number | null;
  menuLocation: string;
  label: string;
  href?: string | null;
  icon?: string | null;
  sortOrder?: number;
  opensModal?: string | null;
  pageKey?: string | null;
  target?: string | null;
  cssClass?: string | null;
}): Promise<number> {
  const [row] = await db.insert(navMenuItems).values({
    parentId: payload.parentId ?? null,
    menuLocation: payload.menuLocation,
    label: payload.label,
    href: payload.href ?? null,
    icon: payload.icon ?? null,
    sortOrder: payload.sortOrder ?? 0,
    isActive: true,
    opensModal: payload.opensModal ?? null,
    pageKey: payload.pageKey ?? null,
    target: payload.target ?? "_self",
    cssClass: payload.cssClass ?? null,
    hasDraft: false,
  } as any).returning({ id: navMenuItems.id });

  return (row as any).id;
}

export async function saveMenuDraft(
  id: number,
  draft: { label?: string; href?: string | null; sortOrder?: number },
): Promise<boolean> {
  const updateData: any = {
    hasDraft: true,
    updatedAt: new Date(),
  };
  if (draft.label !== undefined) updateData.draftLabel = draft.label;
  if (draft.href !== undefined) updateData.draftHref = draft.href;
  if (draft.sortOrder !== undefined) updateData.draftSortOrder = draft.sortOrder;

  try {
    await db.update(navMenuItems).set(updateData).where(eq(navMenuItems.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.saveMenuDraft]", e);
    return false;
  }
}

/**
 * 메타 즉시 수정 (icon/opensModal/pageKey/target/cssClass/parentId/menuLocation/isActive)
 * — Draft 시스템 없이 바로 반영
 */
export async function updateMenuMeta(
  id: number,
  meta: {
    icon?: string | null;
    opensModal?: string | null;
    pageKey?: string | null;
    target?: string | null;
    cssClass?: string | null;
    parentId?: number | null;
    menuLocation?: string;
    isActive?: boolean;
  },
): Promise<boolean> {
  const updateData: any = { updatedAt: new Date() };
  if (meta.icon !== undefined) updateData.icon = meta.icon;
  if (meta.opensModal !== undefined) updateData.opensModal = meta.opensModal;
  if (meta.pageKey !== undefined) updateData.pageKey = meta.pageKey;
  if (meta.target !== undefined) updateData.target = meta.target;
  if (meta.cssClass !== undefined) updateData.cssClass = meta.cssClass;
  if (meta.parentId !== undefined) updateData.parentId = meta.parentId;
  if (meta.menuLocation !== undefined) updateData.menuLocation = meta.menuLocation;
  if (meta.isActive !== undefined) updateData.isActive = meta.isActive;

  if (Object.keys(updateData).length === 1) return false; // updatedAt만 있음

  try {
    await db.update(navMenuItems).set(updateData).where(eq(navMenuItems.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.updateMenuMeta]", e);
    return false;
  }
}

export async function publishMenuDrafts(location?: string): Promise<number> {
  const conds: any[] = [eq(navMenuItems.hasDraft, true)];
  if (location) conds.push(eq(navMenuItems.menuLocation, location));

  const where = conds.length === 1 ? conds[0] : and(...conds);

  const result = await db
    .update(navMenuItems)
    .set({
      label: sql`COALESCE(draft_label, label)` as any,
      href: sql`COALESCE(draft_href, href)` as any,
      sortOrder: sql`COALESCE(draft_sort_order, sort_order)` as any,
      draftLabel: null,
      draftHref: null,
      draftSortOrder: null,
      hasDraft: false,
      updatedAt: new Date(),
    } as any)
    .where(where as any)
    .returning({ id: navMenuItems.id });

  return result.length;
}

export async function discardMenuDraft(id: number): Promise<boolean> {
  try {
    await db.update(navMenuItems).set({
      draftLabel: null,
      draftHref: null,
      draftSortOrder: null,
      hasDraft: false,
      updatedAt: new Date(),
    } as any).where(eq(navMenuItems.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.discardMenuDraft]", e);
    return false;
  }
}

export async function deleteMenuItem(id: number): Promise<boolean> {
  try {
    /* Q4-017: 자손 전체를 재귀로 삭제 (parent_id 자기참조라 cascade 안 됨).
       직계 자식만 지우면 3단계 이상 손자가 고아로 남아 트리 렌더 시 루트로 승격 노출됨. */
    await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM nav_menu_items WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM nav_menu_items c
          JOIN descendants d ON c.parent_id = d.id
      )
      DELETE FROM nav_menu_items WHERE id IN (SELECT id FROM descendants)
    `);
    return true;
  } catch (e) {
    console.error("[site-settings.deleteMenuItem]", e);
    return false;
  }
}

export async function countMenuDrafts(location?: string): Promise<number> {
  const conds: any[] = [eq(navMenuItems.hasDraft, true)];
  if (location) conds.push(eq(navMenuItems.menuLocation, location));
  const where = conds.length === 1 ? conds[0] : and(...conds);

  const result: any = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM nav_menu_items
    WHERE has_draft = true
    ${location ? sql`AND menu_location = ${location}` : sql``}
  `);
  const rows = Array.isArray(result) ? result : (result?.rows || []);
  return Number(rows[0]?.cnt || 0);
}

/* =========================================================
   ★ Phase B: related_sites 헬퍼 (Draft 시스템 없음 — 즉시 반영)
   ========================================================= */

export async function getRelatedSites(activeOnly = true): Promise<any[]> {
  const conds: any[] = [];
  if (activeOnly) conds.push(eq(relatedSites.isActive, true));
  const where = conds.length === 0 ? undefined : conds[0];

  const rows = await db
    .select()
    .from(relatedSites)
    .where(where as any)
    .orderBy(asc(relatedSites.sortOrder), asc(relatedSites.id));

  return rows as any;
}

export async function createRelatedSite(payload: {
  name: string;
  url: string;
  description?: string | null;
  sortOrder?: number;
}): Promise<number> {
  const [row] = await db.insert(relatedSites).values({
    name: payload.name,
    url: payload.url,
    description: payload.description ?? null,
    sortOrder: payload.sortOrder ?? 0,
    isActive: true,
  } as any).returning({ id: relatedSites.id });

  return (row as any).id;
}

export async function updateRelatedSite(
  id: number,
  payload: {
    name?: string;
    url?: string;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<boolean> {
  const updateData: any = { updatedAt: new Date() };
  if (payload.name !== undefined) updateData.name = payload.name;
  if (payload.url !== undefined) updateData.url = payload.url;
  if (payload.description !== undefined) updateData.description = payload.description;
  if (payload.sortOrder !== undefined) updateData.sortOrder = payload.sortOrder;
  if (payload.isActive !== undefined) updateData.isActive = payload.isActive;

  if (Object.keys(updateData).length === 1) return false;

  try {
    await db.update(relatedSites).set(updateData).where(eq(relatedSites.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.updateRelatedSite]", e);
    return false;
  }
}

export async function deleteRelatedSite(id: number): Promise<boolean> {
  try {
    await db.delete(relatedSites).where(eq(relatedSites.id, id));
    return true;
  } catch (e) {
    console.error("[site-settings.deleteRelatedSite]", e);
    return false;
  }
}