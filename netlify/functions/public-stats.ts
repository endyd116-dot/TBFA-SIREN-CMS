// netlify/functions/public-stats.ts
// ★ 2026-05: 공개 통계 API (활동 보고서 페이지 + 메인 페이지 stats 영역)
// 인증 불필요 — 캐싱 5분
//
// GET /api/public/stats

import { getPublishedSettings } from "../../lib/site-settings";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const settings = await getPublishedSettings("stats");
    const stats = settings.stats || {};

    /* 월별 추이 파싱 */
    let monthlyTrend: any[] = [];
    try {
      const t = stats["donations.monthlyTrend"];
      if (Array.isArray(t)) monthlyTrend = t;
    } catch (_) {}

    /* 응답 빌드 */
    const data = {
      donations: {
        totalAmount: Number(stats["donations.totalAmount"] || 0),
        monthlyTrend,
      },
      support: {
        totalCount: Number(stats["support.totalCount"] || 0),
      },
      members: {
        regularDonors: Number(stats["members.regularDonors"] || 0),
        volunteers: Number(stats["members.volunteers"] || 0),
      },
      distribution: {
        directSupport: Number(stats["distribution.directSupport"] || 0),
        memorial: Number(stats["distribution.memorial"] || 0),
        scholarship: Number(stats["distribution.scholarship"] || 0),
        operation: Number(stats["distribution.operation"] || 0),
      },
      transparency: {
        grade: stats["transparency.grade"] || "—",
      },
    };

    /* 5분 캐시 (CDN 캐싱 가능) */
    const response = ok(data);
    response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    return response;
  } catch (e: any) {
    console.error("[public-stats]", e);
    return serverError("통계 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/stats" };