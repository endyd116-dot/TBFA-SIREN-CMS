import { db } from "../../db";
import { rewards, rewardRedemptions, memberPointLogs } from "../../db/schema";
import { eq, sum } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { checkAndAwardBadges } from "../../lib/badge-checker";

export const config = { path: "/api/reward-redeem" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const _r = await requireActiveUser(req);
    if (!_r.ok) return (_r as { ok: false; res: Response }).res;
    const memberId = (_r.user as any).uid as number;

    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const rewardId = Number(body.rewardId);
    if (!rewardId || !Number.isInteger(rewardId) || rewardId <= 0) {
      return badRequest("올바른 rewardId를 입력해주세요");
    }

    // 리워드 조회
    const [reward] = await db
      .select()
      .from(rewards)
      .where(eq(rewards.id, rewardId))
      .limit(1);

    if (!reward) return notFound("리워드를 찾을 수 없습니다");
    if (!reward.isActive) return badRequest("비활성 리워드입니다");
    if (reward.stock !== null && reward.stock <= 0) {
      return badRequest("재고가 소진된 리워드입니다");
    }

    // 잔액 확인
    const [balanceRow] = await db
      .select({ total: sum(memberPointLogs.delta) })
      .from(memberPointLogs)
      .where(eq(memberPointLogs.memberId, memberId));
    const balance = Number(balanceRow?.total ?? 0);

    if (balance < reward.pointCost) {
      return badRequest(`포인트가 부족합니다 (보유: ${balance}pt, 필요: ${reward.pointCost}pt)`);
    }

    // 교환 기록 INSERT
    const [redemption] = await db
      .insert(rewardRedemptions)
      .values({
        memberId,
        rewardId: reward.id,
        pointCost: reward.pointCost,
        status: "pending",
      } as any)
      .returning({ id: rewardRedemptions.id });

    // 포인트 차감 로그
    await db.insert(memberPointLogs).values({
      memberId,
      delta: -reward.pointCost,
      reason: `리워드 교환: ${reward.nameKo}`,
      eventType: "reward_redeem",
      referenceId: redemption.id,
    } as any);

    const newBalance = balance - reward.pointCost;

    // 뱃지 체크 (fire-and-forget)
    try {
      await checkAndAwardBadges(memberId);
    } catch (badgeErr) {
      console.warn("[reward-redeem] 뱃지 체크 실패", badgeErr);
    }

    return ok({ redemptionId: redemption.id, newBalance });
  } catch (err) {
    console.error("[reward-redeem]", err);
    return serverError("리워드 교환 중 오류가 발생했습니다", err);
  }
};
