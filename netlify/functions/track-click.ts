// netlify/functions/track-click.ts
// Phase 10 R4 — 이메일 클릭 추적 + 리다이렉트 (PUBLIC GET)
//
// 이메일 HTML 안 <a href> 치환 URL이 클릭될 때 호출됨.
// 인증 없음 — 토큰으로 수신자 특정.
//
// 동작:
//   1. 토큰·타겟 URL 파라미터 검증
//   2. 외부 도메인으로 리다이렉트 (내부 도메인·비http 차단)
//   3. tracking_token으로 수신자 조회 → 클릭 기록
//   4. 302 리다이렉트
//
// 보안:
//   - u(타겟 URL)가 http(s)가 아니면 거부 → 302 홈으로
//   - 추적 실패해도 리다이렉트는 정상 진행 (fire-and-forget)

import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/track-click" };

const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";
const HOME_URL = SITE_URL;

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const rawTarget = url.searchParams.get("u") || "";

  /* 타겟 URL 검증 — http(s)만 허용, 내부 API 경로 차단 */
  const targetUrl = validateRedirectUrl(rawTarget);
  if (!targetUrl) {
    return Response.redirect(HOME_URL, 302);
  }

  /* fire-and-forget 추적 */
  if (token && token.length <= 60) {
    trackClick(token, targetUrl, req).catch((err) => {
      console.warn("[track-click] 추적 실패", err);
    });
  }

  return Response.redirect(targetUrl, 302);
}

function validateRedirectUrl(raw: string): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  /* http(s)만 허용 */
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  /* Q4-027: 내부 함수 경로(/api/·/.netlify/)로의 리다이렉트는 도메인 무관 차단.
     SITE_URL 호스트만 비교하던 기존 로직은 공식 도메인(tbfa.co.kr)을 못 막아
     u=tbfa.co.kr/api/track-click 자기호출 루프(함수 과호출·크레딧 소진) 위험이 있었음. */
  const path = parsed.pathname.toLowerCase();
  if (path.startsWith("/api/") || path.startsWith("/.netlify/")) {
    const internalHosts = new Set<string>(["tbfa.co.kr", "tbfa-siren-cms.netlify.app"]);
    try { internalHosts.add(new URL(SITE_URL).hostname); } catch { /* noop */ }
    if (internalHosts.has(parsed.hostname)) return null;
  }
  return parsed.href;
}

async function trackClick(token: string, targetUrl: string, req: Request) {
  /* 수신자 조회 */
  const res: any = await db.execute(sql`
    SELECT id, job_id, click_count, clicked_at
      FROM communication_send_recipients
     WHERE tracking_token = ${token}
     LIMIT 1
  `);
  const recipient = (res?.rows ?? res ?? [])[0];
  if (!recipient) return;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;
  const now = new Date();

  /* 수신자 카운터·최초 클릭 기록 */
  await db.execute(sql`
    UPDATE communication_send_recipients
       SET click_count = click_count + 1,
           clicked_at  = COALESCE(clicked_at, ${now}),
           updated_at  = NOW()
     WHERE id = ${recipient.id}
  `);

  /* 추적 이벤트 로그 */
  await db.execute(sql`
    INSERT INTO communication_send_tracking
      (recipient_id, job_id, event_type, clicked_url, ip, user_agent, tracked_at)
    VALUES
      (${recipient.id}, ${recipient.job_id}, 'click', ${targetUrl.slice(0, 2000)}, ${ip}, ${userAgent}, ${now})
  `);
}
