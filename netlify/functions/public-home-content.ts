// netlify/functions/public-home-content.ts
// ★ Phase B Step 6-C — 메인 페이지 통합 콘텐츠 API
// home.* 키 27개 + 향후 추가 키를 트리 형태로 묶어서 반환
// preview=1 + 어드민 인증 시 Draft 우선

import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";
import { authenticateAdmin } from "../../lib/admin-guard.js";

interface HomeKeyRow {
  key: string;
  value_text: string | null;
  value_json: any;
  value_blob_id: number | null;
  draft_value_text: string | null;
  draft_value_json: any;
  draft_value_blob_id: number | null;
  has_draft: boolean;
}

/* "home.hero.slides" + 값 → tree에 nested 할당 */
function setNested(tree: any, dottedKey: string, value: any) {
  const parts = dottedKey.split(".");
  /* 첫 토막은 'home' 고정이므로 제거 */
  if (parts[0] === "home") parts.shift();
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/* DB row → 실제 값 (Draft 우선 옵션) */
function pickValue(row: HomeKeyRow, useDraft: boolean): any {
  /* JSON 우선 */
  const jsonVal = useDraft && row.has_draft && row.draft_value_json !== null
    ? row.draft_value_json
    : row.value_json;
  if (jsonVal !== null && jsonVal !== undefined) return jsonVal;

  /* blob_id (이미지) */
  const blobId = useDraft && row.has_draft && row.draft_value_blob_id !== null
    ? row.draft_value_blob_id
    : row.value_blob_id;
  if (blobId) {
    return { blobId, url: `/api/blob-image?id=${blobId}` };
  }

  /* 텍스트 */
  const textVal = useDraft && row.has_draft && row.draft_value_text !== null
    ? row.draft_value_text
    : row.value_text;
  if (textVal === null || textVal === undefined) return null;

  /* 자동 형변환 — "true"/"false" → boolean, 숫자 문자열 → number */
  if (textVal === "true") return true;
  if (textVal === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(textVal)) return Number(textVal);

  return textVal;
}

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview");

    /* preview=1 일 때만 어드민 인증 시도 */
    let useDraft = false;
    if (preview === "1") {
      const admin = authenticateAdmin(req);
      if (admin) useDraft = true;
      /* 인증 실패 시 조용히 운영값으로 폴백 (외부 노출 방지) */
    }

    /* home.* 키 전부 한번에 SELECT */
    const result: any = await db.execute(sql`
      SELECT 
        key,
        value_text,
        value_json,
        value_blob_id,
        draft_value_text,
        draft_value_json,
        draft_value_blob_id,
        has_draft
      FROM site_settings
      WHERE key LIKE 'home.%'
      ORDER BY key
    `);
    const rows: HomeKeyRow[] = Array.isArray(result) ? result : (result?.rows || []);

    /* 트리 빌드 */
    const tree: any = {};
    for (const row of rows) {
      const value = pickValue(row, useDraft);
      setNested(tree, row.key, value);
    }

    /* 응답 캐시 정책 — Draft는 즉시 반영, 운영값은 30초 캐시 */
    const cacheControl = useDraft
      ? "no-store"
      : "public, max-age=30, stale-while-revalidate=60";

    return new Response(
      JSON.stringify({
        ok: true,
        data: tree,
        _meta: {
          mode: useDraft ? "draft" : "live",
          totalKeys: rows.length,
          generatedAt: new Date().toISOString(),
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": cacheControl,
        },
      }
    );
  } catch (error: any) {
    console.error("[public-home-content]", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
};