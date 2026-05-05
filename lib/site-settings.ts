// lib/site-settings.ts
// ★ 2026-05: 메인 화면 관리 시스템 — 헬퍼 라이브러리
// - 공개/관리자 양쪽에서 사용
// - 캐싱은 호출 측에서 처리

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { siteSettings } from "../db/schema";

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

/**
 * 공개용 — 운영 적용된 값만 (draft 제외)
 * scope 지정 시 해당 영역만 반환
 */
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

  /* { scope: { key: parsedValue } } 구조로 정리 */
  const result: Record<string, Record<string, any>> = {};
  for (const r of rows as any[]) {
    if (!result[r.scope]) result[r.scope] = {};
    result[r.scope][r.key] = parseSettingValue(r);
  }
  return result;
}

/**
 * 관리자용 — draft 포함, 메타데이터 포함
 */
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

/**
 * 단일 값 조회 (draft 우선 옵션)
 */
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

/**
 * Draft 저장 — 운영에는 영향 없음
 */
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

/**
 * Draft → 운영 일괄 적용 (Publish)
 * scope 지정 시 해당 영역만, 미지정 시 전체
 */
export async function publishDrafts(scope?: string): Promise<number> {
  const conds: any[] = [eq(siteSettings.hasDraft, true)];
  if (scope) conds.push(eq(siteSettings.scope, scope));

  const where = conds.length === 1 ? conds[0] : and(...conds);

  /* draft → 정식 값으로 복사하고 hasDraft 초기화 */
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

/**
 * Draft 취소 — 변경사항 폐기
 */
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

/* ─────────────────────────────────────────
   값 파싱 — valueType에 따라 적절히 변환
   ───────────────────────────────────────── */
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