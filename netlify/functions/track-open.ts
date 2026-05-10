// netlify/functions/track-open.ts
// Phase 10 R4 — 이메일 오픈 추적 (PUBLIC GET)
//
// 이메일 HTML 안 1×1 픽셀 img 태그가 로드될 때 호출됨.
// 인증 없음 — 토큰으로 수신자 특정.
//
// 동작:
//   1. tracking_token으로 수신자 조회
//   2. 최초 오픈이면 opened_at 기록, open_count 증가
//   3. 추적 이벤트 로그 INSERT
//   4. 1×1 투명 GIF 반환

import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/track-open" };

// 1×1 투명 GIF (최소 바이너리)
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";

  /* 토큰 없으면 즉시 픽셀 반환 (봇 차단 X — 정상적으로 픽셀만 돌려줌) */
  if (!token || token.length > 60) {
    return gifResponse();
  }

  /* fire-and-forget 방식 — 추적 실패해도 픽셀은 반환 */
  trackOpen(token, req).catch((err) => {
    console.warn("[track-open] 추적 실패", err);
  });

  return gifResponse();
}

async function trackOpen(token: string, req: Request) {
  /* 수신자 조회 */
  const res: any = await db.execute(sql`
    SELECT id, job_id, open_count, opened_at
      FROM communication_send_recipients
     WHERE tracking_token = ${token}
     LIMIT 1
  `);
  const recipient = (res?.rows ?? res ?? [])[0];
  if (!recipient) return;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;
  const now = new Date();

  /* 수신자 카운터·최초 오픈 기록 */
  await db.execute(sql`
    UPDATE communication_send_recipients
       SET open_count = open_count + 1,
           opened_at  = COALESCE(opened_at, ${now}),
           updated_at = NOW()
     WHERE id = ${recipient.id}
  `);

  /* 추적 이벤트 로그 */
  await db.execute(sql`
    INSERT INTO communication_send_tracking
      (recipient_id, job_id, event_type, ip, user_agent, tracked_at)
    VALUES
      (${recipient.id}, ${recipient.job_id}, 'open', ${ip}, ${userAgent}, ${now})
  `);
}

function gifResponse() {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
