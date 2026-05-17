import { db } from "../../db";
import { memberPointLogs, members } from "../../db/schema";
import { eq, sum } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { checkAndAwardBadges } from "../../lib/badge-checker";

export const config = { path: "/api/admin-point-adjust" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const memberId = Number(body.memberId);
    const delta = Number(body.delta);
    const reason = String(body.reason || "").trim();

    if (!memberId) return badRequest("memberId가 필요합니다");
    if (!Number.isInteger(delta) || delta === 0) return badRequest("delta는 0이 아닌 정수여야 합니다");
    if (!reason) return badRequest("reason이 필요합니다");

    const [log] = await db
      .insert(memberPointLogs)
      .values({ memberId, delta, reason, eventType: "admin_adjust" } as any)
      .returning();

    const [balanceRow] = await db
      .select({ total: sum(memberPointLogs.delta) })
      .from(memberPointLogs)
      .where(eq(memberPointLogs.memberId, memberId));
    const newBalance = Number(balanceRow?.total ?? 0);

    try {
      await checkAndAwardBadges(memberId);
    } catch (badgeErr) {
      console.warn("[admin-point-adjust] 뱃지 체크 실패", badgeErr);
    }

    return ok({ log, newBalance });
  } catch (err) {
    console.error("[admin-point-adjust]", err);
    return serverError("포인트 조정 중 오류가 발생했습니다", err);
  }
};
