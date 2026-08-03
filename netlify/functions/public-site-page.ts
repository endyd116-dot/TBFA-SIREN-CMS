/**
 * netlify/functions/public-site-page.ts — 공개 페이지 조회
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §4
 *
 * GET /api/public/page?slug=greeting            — 발행된 내용
 * GET /api/public/page?slug=greeting&preview=1  — 임시저장본 (관리자 로그인 상태에서만)
 *
 * 인증 불필요. 발행본은 5분 캐시, 미리보기는 캐시 금지.
 * 숨김 처리된 페이지는 미리보기가 아닌 한 없는 것으로 응답한다.
 */
import { authenticateAdmin } from "../../lib/auth";
import { getPublicPage, bumpViewCount } from "../../lib/site-pages";
import { ok, badRequest, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/public/page" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const slug = (url.searchParams.get("slug") || "").trim();
    if (!slug) return badRequest("페이지 주소가 필요합니다");

    /* 미리보기는 관리자만. 관리자가 아니면 조용히 발행본을 준다. */
    let preferDraft = false;
    if (url.searchParams.get("preview") === "1") {
      if (authenticateAdmin(req)) preferDraft = true;
    }

    const page = await getPublicPage(slug, preferDraft);
    if (!page) return notFound("페이지를 찾을 수 없습니다");

    /* 조회수는 실제 방문만 센다 (미리보기 제외). 실패해도 페이지 표시를 막지 않는다. */
    if (!preferDraft) { try { await bumpViewCount(page.id); } catch (_) {} }

    const res = ok({ page });
    res.headers.set(
      "Cache-Control",
      preferDraft ? "no-store" : "public, max-age=300, stale-while-revalidate=60",
    );
    return res;
  } catch (e: any) {
    console.error("[public-site-page]", e);
    return serverError("페이지 조회에 실패했습니다", e, "public_page");
  }
};
