// netlify/functions/public-home-content.ts
// ★ Phase B Step 6-C — 메인 페이지 통합 콘텐츠 API
// home.* 키 27개 + 향후 추가 키를 트리 형태로 묶어서 반환
// preview=1 + 어드민 인증 시 Draft 우선

import { authenticateAdmin } from "../../lib/auth";
import { db } from "../../db/index.js";
import { sql } from "drizzle-orm";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

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

  /* 자동 형변환 */
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

    /* preview=1 + 어드민 인증 시 Draft 우선 */
    let useDraft = false;
    if (preview) {
      const admin = authenticateAdmin(req);
      if (admin) useDraft = true;
      /* 미인증이면 조용히 운영값 폴백 */
    }

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

    const tree: any = {};
    for (const row of rows) {
      const value = pickValue(row, useDraft);
      setNested(tree, row.key, value);
    }
    /* ★ Step 6-G: specialBanner.linkedCampaignId가 있으면 캠페인 데이터 덮어쓰기 */
    try {
      const linkedId = tree.specialBanner?.linkedCampaignId;
      if (linkedId && String(linkedId).trim() !== "") {
        const campRes: any = await db.execute(sql`
          SELECT id, title, goal_amount, raised_amount
          FROM campaigns
          WHERE id = ${Number(linkedId)}
          LIMIT 1
        `);
        const campRows = Array.isArray(campRes) ? campRes : (campRes?.rows || []);
        const camp = campRows[0];
        if (camp) {
          if (!tree.specialBanner) tree.specialBanner = {};
          tree.specialBanner.title = camp.title || tree.specialBanner.title;
          tree.specialBanner.goalAmount = Number(camp.goal_amount || 0);
          tree.specialBanner.raisedAmount = Number(camp.raised_amount || 0);
          tree.specialBanner._linkedFrom = "campaign:" + camp.id;
        }
      }
    } catch (e) {
      console.warn("[public-home-content] linked campaign 조회 실패", e);
      /* 실패해도 직접 입력 값 그대로 응답 */
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

    /* 캐시 정책 — Draft는 즉시 반영, 운영값은 30초 캐시 */
    if (useDraft) {
      response.headers.set("Cache-Control", "no-store");
    } else {
      response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    }
    return response;
  } catch (e: any) {
    console.error("[public-home-content]", e);
    return serverError("메인 콘텐츠 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/home-content" };