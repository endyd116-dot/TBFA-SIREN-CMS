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

    /* US-057: FROM은 member_badges 한 테이블인데 SELECT가 badge_definitions 컬럼을 참조해
       'missing FROM-clause' 로 매 호출 500이 나고, 게다가 member_badges 실제 컬럼은 badge_code(code 아님)였음.
       member_badges 컬럼만 조회하고 라벨·아이콘은 아래 defMap(별도 쿼리)으로 매칭한다. */
    const rows = await db
      .select({
        badgeCode: memberBadges.badgeCode,
        awardedAt: memberBadges.awardedAt,
      })
      .from(memberBadges)
      .where(eq(memberBadges.memberId, memberId));

    // badgeDefinitions JOIN — separate query + Map 매칭 (drizzle 다중 leftJoin 금지)
    const defRows = await db.select().from(badgeDefinitions);
    const defMap = new Map(defRows.map((d) => [d.code, d]));

    const badges = rows.map((r) => {
      const def: any = defMap.get(r.badgeCode);
      return {
        code: r.badgeCode,
        nameKo: def?.nameKo ?? null,
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
