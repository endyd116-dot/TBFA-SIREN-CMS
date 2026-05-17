import { db } from "../../db";
import { rewardRedemptions, rewards, members } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-reward-redemptions" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const statusFilter = url.searchParams.get("status");

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(rewardRedemptions);

      // 회원·리워드 정보 별도 조회 후 Map 매칭
      const memberRows = await db.select({ id: members.id, name: members.name }).from(members);
      const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));

      const rewardRows = await db.select({ id: rewards.id, nameKo: rewards.nameKo }).from(rewards);
      const rewardMap = new Map(rewardRows.map((r) => [r.id, r.nameKo]));

      const filtered = statusFilter
        ? rows.filter((r) => r.status === statusFilter)
        : rows;

      const result = filtered.map((r) => ({
        ...r,
        memberName: memberMap.get(r.memberId) ?? null,
        rewardName: rewardMap.get(r.rewardId) ?? null,
      }));

      return ok({ redemptions: result });
    }

    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const targetId = id || Number(body.id);
      if (!targetId) return badRequest("id가 필요합니다");

      const status = body.status;
      if (!["processed", "cancelled"].includes(status)) {
        return badRequest("status는 'processed' 또는 'cancelled'여야 합니다");
      }

      const updateData: Record<string, unknown> = { status };
      if (body.note !== undefined) updateData.note = String(body.note);
      if (status === "processed") updateData.processedAt = new Date();

      const [updated] = await db
        .update(rewardRedemptions)
        .set(updateData)
        .where(eq(rewardRedemptions.id, targetId))
        .returning();

      if (!updated) return notFound("해당 교환 신청을 찾을 수 없습니다");
      return ok({ redemption: updated });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-reward-redemptions]", err);
    return serverError("교환 신청 처리 중 오류가 발생했습니다", err);
  }
};
