// netlify/functions/public-footer-content.ts
// 공개 푸터 콘텐츠 API — site_settings scope='footer'(org.* / sns.*)를 반환.
// preview=1 + 어드민 인증 시 Draft 우선(임시발행 미리보기), 그 외 발행값.
// (2026-07-07: 푸터가 하드코딩이라 편집기 저장/발행이 반영 안 되던 버그 fix — 렌더 경로 신설)
import { authenticateAdmin } from "../../lib/auth";
import { getPublishedSettings, getDraftSettings } from "../../lib/site-settings";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    /* preview=1 + 어드민 인증 시에만 Draft 우선 (미인증이면 조용히 발행값 폴백) */
    let useDraft = false;
    if (preview && authenticateAdmin(req)) useDraft = true;

    const settings = useDraft
      ? await getDraftSettings("footer")
      : await getPublishedSettings("footer");
    const footer = (settings && settings.footer) || {};

    const response = ok({ footer, _meta: { mode: useDraft ? "draft" : "published" } });
    response.headers.set(
      "Cache-Control",
      useDraft ? "no-store" : "public, max-age=30, stale-while-revalidate=60"
    );
    return response;
  } catch (e: any) {
    console.error("[public-footer-content]", e);
    return serverError("푸터 콘텐츠 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/footer-content" };
