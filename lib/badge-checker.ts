import { db } from "../db";
import { badgeDefinitions, memberBadges, memberPointLogs, donations } from "../db/schema";
import { and, eq, count, sum } from "drizzle-orm";

export async function checkAndAwardBadges(memberId: number): Promise<void> {
  const defs = await db.select().from(badgeDefinitions).where(eq(badgeDefinitions.isActive, true));
  if (!defs.length) return;

  const existing = await db
    .select({ badgeCode: memberBadges.badgeCode })
    .from(memberBadges)
    .where(eq(memberBadges.memberId, memberId));
  const ownedCodes = new Set(existing.map((r) => r.badgeCode));

  for (const def of defs) {
    if (ownedCodes.has(def.code)) continue;

    let earned = false;

    if (def.conditionType === "donation_count") {
      const [row] = await db
        .select({ cnt: count() })
        .from(donations)
        .where(and(eq(donations.memberId, memberId), eq(donations.status, "completed")));
      earned = (row?.cnt ?? 0) >= def.conditionValue;
    } else if (def.conditionType === "point_threshold") {
      const [row] = await db
        .select({ total: sum(memberPointLogs.delta) })
        .from(memberPointLogs)
        .where(eq(memberPointLogs.memberId, memberId));
      earned = Number(row?.total ?? 0) >= def.conditionValue;
    }

    if (earned) {
      try {
        await db.insert(memberBadges).values({ memberId, badgeCode: def.code });
      } catch {
        // uniqueIndex 충돌 무시
      }
    }
  }
}
