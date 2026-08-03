// netlify/functions/public-nav-menus.ts
// Phase B: 공개 메뉴 API (어드민 미리보기는 ?preview=1 + 어드민 쿠키)
// 인증 불필요 (preview=1 제외) — 캐싱 5분
//
// GET /api/public/nav-menus?location=header           — 트리 (운영 적용된 값)
// GET /api/public/nav-menus?location=header&preview=1 — 트리 (Draft 우선, 어드민 토큰 필요)

import { authenticateAdmin } from "../../lib/auth";
import { getNavMenus } from "../../lib/site-settings";
import { enrichMenuLinks } from "../../lib/nav-menu-links";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

const VALID_LOCATIONS = ["header", "footer", "siren", "mobile"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const location = url.searchParams.get("location") || "header";
    const preview = url.searchParams.get("preview") === "1";

    if (!VALID_LOCATIONS.includes(location)) {
      return badRequest("유효하지 않은 location");
    }

    /* preview=1 인 경우 어드민 토큰 확인 */
    let preferDraft = false;
    if (preview) {
      const admin = authenticateAdmin(req);
      if (admin) preferDraft = true;
      /* 어드민 아니면 그냥 운영값 반환 (조용히) */
    }

    let items = await getNavMenus(location, preferDraft);

    /* 2026-08-03: 페이지를 가리키는 메뉴는 주소를 자동으로 만들어 붙인다(/p/{페이지주소}).
       운영자가 주소를 직접 관리할 필요가 없고, 페이지 주소를 바꿔도 메뉴가 따라간다.
       숨김 처리됐거나 지워진 페이지를 가리키는 메뉴는 여기서 빠진다 —
       눌렀는데 "페이지를 찾을 수 없습니다"가 뜨는 것보다 안 보이는 편이 낫다. */
    items = await enrichMenuLinks(items);

    const response = ok({ location, items, preview: preferDraft });
    if (!preferDraft) {
      response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    } else {
      response.headers.set("Cache-Control", "no-store");
    }
    return response;
  } catch (e: any) {
    console.error("[public-nav-menus]", e);
    return serverError("메뉴 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/nav-menus" };