// netlify/functions/public-related-sites.ts
// Phase B: 공개 관련사이트 API
// 인증 불필요 — 캐싱 5분
//
// GET /api/public/related-sites

import { getRelatedSites } from "../../lib/site-settings";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const items = await getRelatedSites(true); // active만
    const response = ok({ items });
    response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return response;
  } catch (e: any) {
    console.error("[public-related-sites]", e);
    return serverError("관련 사이트 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/related-sites" };