import { db } from "../../db";
import { memberBadges, badgeDefinitions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/my-badges" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const _r = await requireActiveUser(req);
    if (!_r.ok) return (_r as { ok: false; res: Response }).res;
    const memberId = (_r.user as any).uid as number;

    const rows = await db
      .select({
        code: badgeDefinitions.code,
        nameKo: badgeDefinitions.nameKo,
        icon: badgeDefinitions.icon,
        awardedAt: memberBadges.awardedAt,
      })
      .from(memberBadges)
      .where(eq(memberBadges.memberId, memberId));

    // badgeDefinitions JOIN — separate query + Map 매칭 (drizzle 다중 leftJoin 금지)
    const defRows = await db.select().from(badgeDefinitions);
    const defMap = new Map(defRows.map((d) => [d.code, d]));

    const badges = rows.map((r) => {
      const def = defMap.get(r.code);
      return {
        code: r.code,
        nameKo: def?.nameKo ?? r.nameKo,
        icon: def?.icon ?? null,
        awardedAt: r.awardedAt,
      };
    });

    return ok({ badges });
  } catch (err) {
    console.error("[my-badges]", err);
    return serverError("뱃지 조회 중 오류가 발생했습니다", err);
  }
};
