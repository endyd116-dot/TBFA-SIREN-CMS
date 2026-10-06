// netlify/functions/public-home-content.ts
// Phase B Step 6-C — 메인 페이지 통합 콘텐츠 API
// home.* 키 27개 + 향후 추가 키를 트리 형태로 묶어서 반환
// preview=1 + 어드민 인증 시 Draft 우선
//
// ★ 2026-10-07: 값을 만드는 로직은 lib/home-content.ts(buildHomeContent)로 옮겼다.
//   홈을 서버에서 조립하는 page-shell도 같은 함수를 써서, 페이지에 미리 심는 값과
//   이 API 응답이 다시는 어긋나지 않게 한다(어긋나 메인 편집이 라이브에 반영 안 되던 사고).

import { authenticateAdmin } from "../../lib/auth";
import { buildHomeContent } from "../../lib/home-content";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    /* preview=1 + 어드민 인증 시 Draft 우선 (미인증이면 조용히 운영값 폴백) */
    let useDraft = false;
    if (preview) {
      const admin = authenticateAdmin(req);
      if (admin) useDraft = true;
    }

    const data = await buildHomeContent(useDraft);
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
