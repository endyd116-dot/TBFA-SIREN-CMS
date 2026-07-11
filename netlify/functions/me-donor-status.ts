// netlify/functions/me-donor-status.ts
// 2026-05: 로그인 사용자의 후원 여부 + 누적 통계 조회 (사이렌 페이지에서 사전 차단용)

import type { Context } from "@netlify/functions";
import { authenticateUser } from "../../lib/auth";
import { hasAnyCompletedDonation } from "../../lib/donor-check";
import { ok, unauthorized, corsPreflight, methodNotAllowed, serverError } from "../../lib/response";

export const config = { path: "/api/me/donor-status" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const status = await hasAnyCompletedDonation(user.uid);
    return ok({
      isDonor: !!status.isDonor,
      donationCount: status.donationCount || 0,
    });
  } catch (e) {
    console.error("[me-donor-status]", e);
    return serverError("후원 상태 조회 실패", e);
  }
};