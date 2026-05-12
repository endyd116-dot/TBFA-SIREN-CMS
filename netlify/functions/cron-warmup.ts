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

  console.log("[warmup]", JSON.stringify(results));
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
