import { db } from "../../db";
import { rewardRedemptions, rewards, members, memberPointLogs } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";
import { createNotification } from "../../lib/notify";

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

      /* 기존 상태 조회 — 취소 환불 멱등 판정용 (이미 cancelled면 중복 환불 금지) */
      const [prior] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, targetId)).limit(1);
      if (!prior) return notFound("해당 교환 신청을 찾을 수 없습니다");

      const updateData: Record<string, unknown> = { status };
      if (body.note !== undefined) updateData.note = String(body.note);
      if (status === "processed") updateData.processedAt = new Date();

      /* US-061: 취소 전이 시 차감 포인트 환불 + 재고 복원 (기존엔 상태만 바꾸고 환불 없어 회원이 포인트만 잃음) */
      const willRefund = status === "cancelled" && (prior as any).status !== "cancelled";

      const updated = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(rewardRedemptions)
          .set(updateData)
          .where(eq(rewardRedemptions.id, targetId))
          .returning();
        if (willRefund) {
          await tx.insert(memberPointLogs).values({
            memberId: (prior as any).memberId,
            delta: (prior as any).pointCost,
            reason: `리워드 교환 취소 환불 (#${targetId})`,
            eventType: "reward_refund",
            referenceId: targetId,
          } as any);
          /* 재고 관리 리워드면 1 복원 */
          await tx.execute(sql`UPDATE rewards SET stock = stock + 1 WHERE id = ${(prior as any).rewardId} AND stock IS NOT NULL`);
        }
        return u;
      });

      if (willRefund) {
        try {
          await createNotification({
            recipientId: (prior as any).memberId,
            recipientType: "user",
            category: "system",
            severity: "info",
            title: "리워드 교환이 취소되었습니다",
            message: `차감되었던 ${(prior as any).pointCost}pt가 환불되었습니다.`,
            link: "/mypage-points.html",
            refTable: "reward_redemptions",
            refId: targetId,
          });
        } catch (e) { console.warn("[admin-reward-redemptions] 취소 환불 알림 예외(무시):", e); }
      }

      return ok({ redemption: updated });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-reward-redemptions]", err);
    return serverError("교환 신청 처리 중 오류가 발생했습니다", err);
  }
};
