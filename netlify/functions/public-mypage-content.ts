// netlify/functions/public-mypage-content.ts
// v11 묶음 B-1: 마이페이지 안내 콘텐츠 통합 API
// scope='mypage' 키들을 트리 형태로 묶어서 반환
// preview=1 + 어드민 인증 시 Draft 우선 (public-home-content와 동일 패턴)

import { authenticateAdmin } from "../../lib/auth";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

interface MypageKeyRow {
  key: string;
  value_text: string | null;
  value_json: any;
  value_blob_id: number | null;
  draft_value_text: string | null;
  draft_value_json: any;
  draft_value_blob_id: number | null;
  has_draft: boolean;
}

function setNested(tree: any, dottedKey: string, value: any) {
  const parts = dottedKey.split(".");
  if (parts[0] === "mypage") parts.shift();
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function pickValue(row: MypageKeyRow, useDraft: boolean): any {
  const jsonVal = useDraft && row.has_draft && row.draft_value_json !== null
    ? row.draft_value_json
    : row.value_json;
  if (jsonVal !== null && jsonVal !== undefined) return jsonVal;

  const blobId = useDraft && row.has_draft && row.draft_value_blob_id !== null
    ? row.draft_value_blob_id
    : row.value_blob_id;
  if (blobId) return { blobId, url: `/api/blob-image?id=${blobId}` };

  const textVal = useDraft && row.has_draft && row.draft_value_text !== null
    ? row.draft_value_text
    : row.value_text;
  if (textVal === null || textVal === undefined) return null;

  if (textVal === "true") return true;
  if (textVal === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(textVal)) return Number(textVal);
  return textVal;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    let useDraft = false;
    if (preview) {
      const admin = authenticateAdmin(req);
      if (admin) useDraft = true;
    }

    const result: any = await db.execute(sql`
      SELECT 
        key, value_text, value_json, value_blob_id,
        draft_value_text, draft_value_json, draft_value_blob_id, has_draft
      FROM site_settings
      WHERE key LIKE 'mypage.%'
      ORDER BY key
    `);
    const rows: MypageKeyRow[] = Array.isArray(result) ? result : (result?.rows || []);

    const tree: any = {};
    for (const row of rows) {
      const value = pickValue(row, useDraft);
      setNested(tree, row.key, value);
    }

    const data = {
      ...tree,
      _meta: {
        mode: useDraft ? "draft" : "published",
        totalKeys: rows.length,
        generatedAt: new Date().toISOString(),
      },
    };

    const response = ok(data);
    if (useDraft) {
      response.headers.set("Cache-Control", "no-store");
    } else {
      response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    }
    return response;
  } catch (e: any) {
    console.error("[public-mypage-content]", e);
    return serverError("마이페이지 콘텐츠 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/mypage-content" };