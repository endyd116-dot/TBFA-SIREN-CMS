import { db } from "../../db";
import { memberPointLogs, members } from "../../db/schema";
import { eq, sum, desc } from "drizzle-orm";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/ranking" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    // 포인트 합계 상위 20명 — separate query + Map 매칭
    const pointRows = await db
      .select({
        memberId: memberPointLogs.memberId,
        total: sum(memberPointLogs.delta),
      })
      .from(memberPointLogs)
      .groupBy(memberPointLogs.memberId)
      .orderBy(desc(sum(memberPointLogs.delta)))
      .limit(20);

    if (!pointRows.length) {
      return ok({ ranking: [] });
    }

    const memberIds = [...new Set(pointRows.map((r) => r.memberId))];
    const memberRows = await db
      .select({ id: members.id, name: members.name })
      .from(members);
    const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));

    const ranking = pointRows.map((r, idx) => {
      const name = memberMap.get(r.memberId) ?? "회원";
      const first = name.slice(0, 1);
      const masked = first + "***";
      return {
        rank: idx + 1,
        name: masked,
        points: Number(r.total ?? 0),
      };
    });

    return ok({ ranking });
  } catch (err) {
    console.error("[ranking]", err);
    return serverError("랭킹 조회 중 오류가 발생했습니다", err);
  }
};
