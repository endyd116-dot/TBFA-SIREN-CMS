import { db } from "../../db";
import { memberPointLogs } from "../../db/schema";
import { eq, desc, sum } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/my-points" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const _r = await requireActiveUser(req);
    if (!_r.ok) return (_r as { ok: false; res: Response }).res;
    const memberId = (_r.user as any).uid as number;

    const [balanceRow] = await db
      .select({ total: sum(memberPointLogs.delta) })
      .from(memberPointLogs)
      .where(eq(memberPointLogs.memberId, memberId));

    const balance = Number(balanceRow?.total ?? 0);

    const logs = await db
      .select({
        delta: memberPointLogs.delta,
        reason: memberPointLogs.reason,
        eventType: memberPointLogs.eventType,
        createdAt: memberPointLogs.createdAt,
      })
      .from(memberPointLogs)
      .where(eq(memberPointLogs.memberId, memberId))
      .orderBy(desc(memberPointLogs.createdAt))
      .limit(20);

    return ok({ balance, logs });
  } catch (err) {
    console.error("[my-points]", err);
    return serverError("포인트 조회 중 오류가 발생했습니다", err);
  }
};
