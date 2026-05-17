import { db } from "../../db";
import { rewards } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/rewards-list" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const rewardRows = await db
      .select({
        id: rewards.id,
        nameKo: rewards.nameKo,
        description: rewards.description,
        pointCost: rewards.pointCost,
        stock: rewards.stock,
        imageUrl: rewards.imageUrl,
      })
      .from(rewards)
      .where(eq(rewards.isActive, true));

    return ok({ rewards: rewardRows });
  } catch (err) {
    console.error("[rewards-list]", err);
    return serverError("리워드 목록 조회 중 오류가 발생했습니다", err);
  }
};
