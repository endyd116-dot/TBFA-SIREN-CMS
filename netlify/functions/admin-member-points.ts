import { db } from "../../db";
import { memberPointLogs, members } from "../../db/schema";
import { eq, desc, sum } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-member-points" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const memberId = Number(url.searchParams.get("memberId"));
  if (!memberId) return badRequest("memberId 파라미터가 필요합니다");

  try {
    const [balanceRow] = await db
      .select({ total: sum(memberPointLogs.delta) })
      .from(memberPointLogs)
      .where(eq(memberPointLogs.memberId, memberId));
    const balance = Number(balanceRow?.total ?? 0);

    const logs = await db
      .select()
      .from(memberPointLogs)
      .where(eq(memberPointLogs.memberId, memberId))
      .orderBy(desc(memberPointLogs.createdAt))
      .limit(100);

    let memberName: string | null = null;
    try {
      const [m] = await db
        .select({ name: members.name })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      memberName = m?.name ?? null;
    } catch {}

    return ok({ memberId, memberName, balance, logs });
  } catch (err) {
    console.error("[admin-member-points]", err);
    return serverError("회원 포인트 내역 조회 중 오류가 발생했습니다", err);
  }
};
