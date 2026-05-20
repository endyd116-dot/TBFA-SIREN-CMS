import type { Config } from "@netlify/functions";

/* 5분마다 주요 API에 자동 요청 → 콜드 스타트 방지 */
const SITE_URL = process.env.SITE_URL || "https://tbfa-siren-cms.netlify.app";

const WARMUP_ENDPOINTS = [
  "/api/public-home-stats",
  "/api/public-nav-menus",
  "/api/notifications-list",
  "/api/admin-dashboard-summary",
  "/api/admin-members-list?limit=1",
  "/api/admin-send-jobs-list?limit=1",
];

/* Oracle 알리고 프록시 health ping — 콜드 스타트/잠듦 방지.
   ALIGO_SMS_PROXY_URL(예: https://host:8080/aligo/sms)의 끝 라우트를 /health로 치환해 GET.
   프록시가 잠들면 회원가입 SMS 인증·카카오 알림톡이 10초 timeout으로 실패하므로
   5분마다 깨워둔다. (server.js의 GET /health 엔드포인트) */
function getProxyHealthUrl(): string | null {
  const smsProxy = process.env.ALIGO_SMS_PROXY_URL || "";
  if (!smsProxy) return null;
  try {
    const u = new URL(smsProxy);
    u.pathname = "/health";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

export default async () => {
  const results: { path: string; status: number; ms: number }[] = [];

  await Promise.allSettled(
    WARMUP_ENDPOINTS.map(async (path) => {
      const t = Date.now();
      try {
        const res = await fetch(`${SITE_URL}${path}`, {
          method: "GET",
          headers: { "x-warmup": "1" },
          signal: AbortSignal.timeout(8000),
        });
        results.push({ path, status: res.status, ms: Date.now() - t });
      } catch {
        results.push({ path, status: 0, ms: Date.now() - t });
      }
    })
  );

  /* Oracle 알리고 프록시 warm 유지 */
  const proxyHealthUrl = getProxyHealthUrl();
  if (proxyHealthUrl) {
    const t = Date.now();
    try {
      const res = await fetch(proxyHealthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(9000),
      });
      results.push({ path: "aligo-proxy/health", status: res.status, ms: Date.now() - t });
    } catch {
      /* 프록시가 9초 안에 응답 못 하면 잠들었거나 다운 — 로그로 남겨 모니터링 */
      results.push({ path: "aligo-proxy/health", status: 0, ms: Date.now() - t });
    }
  }

  console.log("[warmup]", JSON.stringify(results));
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
