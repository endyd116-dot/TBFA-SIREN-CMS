import { db } from "../../db";
import { rewards, rewardRedemptions, memberPointLogs } from "../../db/schema";
import { eq, sum, sql } from "drizzle-orm";
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

    /* ★US-059/060: 단일 트랜잭션 + 회원별 advisory lock(잔액 동시성 TOCTOU 차단) +
       재고 원자적 조건부 차감(RETURNING으로 경합 감지). 기존엔 재고 무차감(0개도 무한교환) +
       비트랜잭션 SELECT-then-INSERT라 동시요청 시 음수 잔액(이중 차감)이 가능했음. */
    const result: any = await db.transaction(async (tx) => {
      /* 같은 회원의 동시 교환을 직렬화 → 잔액 이중 차감 방지 */
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${memberId})`);

      const [reward] = await tx.select().from(rewards).where(eq(rewards.id, rewardId)).limit(1);
      if (!reward) return { error: "notfound" };
      if (!reward.isActive) return { error: "inactive" };
      if (reward.stock !== null && reward.stock <= 0) return { error: "soldout" };

      const [balanceRow] = await tx
        .select({ total: sum(memberPointLogs.delta) })
        .from(memberPointLogs)
        .where(eq(memberPointLogs.memberId, memberId));
      const balance = Number(balanceRow?.total ?? 0);
      if (balance < reward.pointCost) {
        return { error: "insufficient", balance, pointCost: reward.pointCost };
      }

      /* 재고 관리 리워드면 원자적 조건부 차감 — 동시 교환으로 0이 되면 affected 0 → 소진 처리 */
      if (reward.stock !== null) {
        const upd: any = await tx.execute(
          sql`UPDATE rewards SET stock = stock - 1 WHERE id = ${rewardId} AND stock > 0 RETURNING id`
        );
        const affected = (upd?.rows ?? upd ?? []).length;
        if (affected === 0) return { error: "soldout" };
      }

      const [redemption] = await tx
        .insert(rewardRedemptions)
        .values({ memberId, rewardId: reward.id, pointCost: reward.pointCost, status: "pending" } as any)
        .returning({ id: rewardRedemptions.id });

      await tx.insert(memberPointLogs).values({
        memberId,
        delta: -reward.pointCost,
        reason: `리워드 교환: ${reward.nameKo}`,
        eventType: "reward_redeem",
        referenceId: redemption.id,
      } as any);

      return { ok: true, redemptionId: redemption.id, newBalance: balance - reward.pointCost };
    });

    if (result.error === "notfound") return notFound("리워드를 찾을 수 없습니다");
    if (result.error === "inactive") return badRequest("비활성 리워드입니다");
    if (result.error === "soldout") return badRequest("재고가 소진된 리워드입니다");
    if (result.error === "insufficient") {
      return badRequest(`포인트가 부족합니다 (보유: ${result.balance}pt, 필요: ${result.pointCost}pt)`);
    }

    // 뱃지 체크 (트랜잭션 밖·fire-and-forget)
    try {
      await checkAndAwardBadges(memberId);
    } catch (badgeErr) {
      console.warn("[reward-redeem] 뱃지 체크 실패", badgeErr);
    }

    return ok({ redemptionId: result.redemptionId, newBalance: result.newBalance });
  } catch (err) {
    console.error("[reward-redeem]", err);
    return serverError("리워드 교환 중 오류가 발생했습니다", err);
  }
};
