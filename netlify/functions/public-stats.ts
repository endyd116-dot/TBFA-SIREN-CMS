// netlify/functions/public-stats.ts
// Phase A + B: 공개 통계 API + 어드민 미리보기 지원
// 인증 불필요 — 캐싱 5분
//
// GET /api/public/stats              — 운영 적용된 값 (일반 사용자)
// GET /api/public/stats?preview=1    — Draft 우선 (어드민 토큰 필요, 미인증 시 운영값 폴백)
//
// ★ 2026-10-07: 응답 모양은 lib/home-content.ts(buildPublicStats)가 만든다.
//   홈을 서버에서 조립하는 page-shell이 페이지에 미리 심는 값도 같은 함수를 써서 어긋나지 않게 한다.

import { authenticateAdmin } from "../../lib/auth";
import { getPublishedSettings, getDraftSettings } from "../../lib/site-settings";
import { buildPublicStats } from "../../lib/home-content";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    /* Phase B: preview=1 + 어드민 토큰 검증 → Draft 우선 */
    let useDraft = false;
    if (preview) {
      const admin = authenticateAdmin(req);
      if (admin) useDraft = true;
      /* 어드민 아니면 조용히 운영값 폴백 (보안 누설 방지) */
    }

    const settings = useDraft
      ? await getDraftSettings("stats")
      : await getPublishedSettings("stats");

    const data = buildPublicStats(settings.stats || {}, useDraft);
    const response = ok(data);

    /* Phase B: Draft 모드는 캐싱 안 함 (실시간 반영) */
    if (useDraft) {
      response.headers.set("Cache-Control", "no-store");
    } else {
      response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    }
    return response;
  } catch (e: any) {
    console.error("[public-stats]", e);
    return serverError("통계 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/stats" };
