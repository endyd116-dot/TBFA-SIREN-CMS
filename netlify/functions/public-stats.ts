// netlify/functions/public-stats.ts
// Phase A + B: 공개 통계 API + 어드민 미리보기 지원
// 인증 불필요 — 캐싱 5분
//
// GET /api/public/stats              — 운영 적용된 값 (일반 사용자)
// GET /api/public/stats?preview=1    — Draft 우선 (어드민 토큰 필요, 미인증 시 운영값 폴백)

import { authenticateAdmin } from "../../lib/auth";
import { getPublishedSettings, getDraftSettings } from "../../lib/site-settings";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const preview = url.searchParams.get("preview") === "1";

    /* Phase B: preview=1 + 어드민 토큰 검증 → Draft 우선 */
    let useDraft = false;
    if (preview) {
      const admin = authenticateAdmin(req);
      if (admin) useDraft = true;
      /* 어드민 아니면 조용히 운영값 폴백 (보안 누설 방지) */
    }

    const settings = useDraft
      ? await getDraftSettings("stats")
      : await getPublishedSettings("stats");
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
      /* Phase B: 미리보기 모드 메타 */
      _meta: useDraft ? { mode: "draft" } : { mode: "published" },
    };

    const response = ok(data);

    /* Phase B: Draft 모드는 캐싱 안 함 (실시간 반영) */
    if (useDraft) {
      response.headers.set("Cache-Control", "no-store");
    } else {
      response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    }
    return response;
  } catch (e: any) {
    console.error("[public-stats]", e);
    return serverError("통계 조회 실패", e?.message);
  }
};

export const config = { path: "/api/public/stats" };