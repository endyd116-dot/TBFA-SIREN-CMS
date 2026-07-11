// netlify/functions/public-brand.ts
// 2026-06-03 브랜드 설정 공개 서빙 (로그인 불필요)
//   - GET /api/public/brand                  → 설정 JSON { siteName, homeTitle, logoUrl, faviconUrl, version }
//   - GET /api/public/brand?asset=logo       → 로고 심볼 이미지 바이트
//   - GET /api/public/brand?asset=favicon    → 파비콘 이미지 바이트
//
// 저장: Netlify Blobs 영구 스토어 "brand" (만료 없음)
//   key "config"  : JSON { siteName, homeTitle, logo:{type}, favicon:{type}, version }
//   key "logo"    : 이미지 바이트
//   key "favicon" : 이미지 바이트
//
// 미설정 시 logoUrl/faviconUrl = null → 클라이언트가 기존 정적 기본값 그대로 사용(fallback-safe).

import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/public/brand" };

/* 캐시 짧게(30초) — 운영자가 브랜드 변경 시 최대 ~30초 내 전 페이지 반영.
   (max-age 길면 엣지 CDN이 옛 설정을 오래 캐시해 변경이 늦게 반영됨.) */
const JSON_HEADER = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" };

async function loadConfig(store: ReturnType<typeof getStore>): Promise<any> {
  try {
    const raw = await store.get("config", { type: "text" });
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch { return {}; }
}

export default async (req: Request, _ctx: Context) => {
  try {
    const url = new URL(req.url);
    const asset = url.searchParams.get("asset");
    /* strong consistency — 운영자 저장 직후에도 최신값 보장(eventual이면 이전 쓰기로 지연됨). */
    const store = getStore({ name: "brand", consistency: "strong" });

    /* ── 이미지 바이트 서빙 ── */
    if (asset === "logo" || asset === "favicon") {
      const cfg = await loadConfig(store);
      const meta = cfg[asset];
      const bytes = await store.get(asset, { type: "arrayBuffer" });
      if (!bytes || !meta) return new Response("Not Found", { status: 404 });
      return new Response(bytes as ArrayBuffer, {
        status: 200,
        headers: {
          "content-type": meta.type || "image/png",
          "cache-control": "public, max-age=600",
        },
      });
    }

    /* ── 설정 JSON ── */
    const cfg = await loadConfig(store);
    const version = cfg.version || 0;
    const body = {
      siteName: cfg.siteName || null,
      homeTitle: cfg.homeTitle || null,
      logoUrl: cfg.logo ? `/api/public/brand?asset=logo&v=${version}` : null,
      faviconUrl: cfg.favicon ? `/api/public/brand?asset=favicon&v=${version}` : null,
      version,
    };
    return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADER });
  } catch (e: any) {
    /* 실패해도 빈 설정 반환 → 클라이언트는 정적 기본값 사용 */
    return new Response(JSON.stringify({ siteName: null, homeTitle: null, logoUrl: null, faviconUrl: null, version: 0 }),
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }
};
