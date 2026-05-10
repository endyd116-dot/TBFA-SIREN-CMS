// lib/communication-tracking.ts
// Phase 10 R4 — 이메일 오픈/클릭 추적 헬퍼
//
// tracking_token: crypto 기반 32자 랜덤 토큰 — 수신자 INSERT 시 생성
// open pixel:     1×1 투명 GIF — 이메일 렌더링 시 자동 로드
// click redirect: 링크 클릭 시 추적 후 원본 URL 리다이렉트

import { randomBytes } from "crypto";

/** 32자 고유 추적 토큰 생성 (URL-safe base64) */
export function generateTrackingToken(): string {
  // 24바이트 → base64url 32자
  return randomBytes(24).toString("base64url");
}

/** 오픈 픽셀 URL */
export function buildOpenPixelUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/track-open?t=${encodeURIComponent(token)}`;
}

/** 클릭 리다이렉트 URL */
export function buildClickRedirectUrl(
  baseUrl: string,
  token: string,
  targetUrl: string,
): string {
  return (
    `${baseUrl}/api/track-click?t=${encodeURIComponent(token)}&u=${encodeURIComponent(targetUrl)}`
  );
}

/** 이메일 HTML에 추적 삽입
 *  - <a href="..."> 를 클릭 추적 URL로 치환 (외부 링크만, /api/* /api 등 내부는 제외)
 *  - </body> 직전에 오픈 픽셀 img 삽입
 */
export function injectTrackingIntoHtml(
  html: string,
  token: string,
  baseUrl: string,
): string {
  const openPixelUrl = buildOpenPixelUrl(baseUrl, token);

  // <a href="..."> 치환 — 외부 http(s) 링크만
  const withLinks = html.replace(
    /(<a\s[^>]*href=["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi,
    (_match, pre, href, post) => {
      const redirectUrl = buildClickRedirectUrl(baseUrl, token, href);
      return `${pre}${redirectUrl}${post}`;
    },
  );

  // 오픈 픽셀 삽입 — </body> 앞, 없으면 끝에 추가
  const pixel = `<img src="${openPixelUrl}" width="1" height="1" alt="" style="display:none" />`;
  if (/<\/body>/i.test(withLinks)) {
    return withLinks.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return withLinks + pixel;
}
