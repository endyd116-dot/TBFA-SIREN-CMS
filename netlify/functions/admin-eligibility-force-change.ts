// netlify/functions/admin-eligibility-force-change.ts
// 어드민 전용: 회원 자격 유형 강제 변경 (신청 없이 직접 변경)

import type { Context } from "@netlify/functions";
import { eq, sql } from "drizzle-orm";
import { db, members, notifications } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin-eligibility-force-change" };

const VALID_TYPES = ["현직", "은퇴", "예비", "일반", "lawyer", "counselor"];
const EXPERT_TYPES = ["lawyer", "counselor"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const { admin } = guard.ctx;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const memberId = Number(body.memberId);
    if (!Number.isFinite(memberId) || memberId <= 0) return badRequest("memberId가 유효하지 않습니다");

    const newType = String(body.newEligibilityType || "").trim();
    if (!VALID_TYPES.includes(newType)) {
      return badRequest(`유효하지 않은 자격 유형입니다. 허용값: ${VALID_TYPES.join(", ")}`);
    }

    const reason = String(body.reason || "").trim();
    if (reason.length < 5) return badRequest("강제 변경 사유를 5자 이상 입력해 주세요");

    /* 대상 회원 조회 */
    const [member] = await db
      .select({ id: members.id, name: members.name, eligibilityType: members.eligibilityType })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!member) return notFound("회원을 찾을 수 없습니다");

    const beforeType = (member as any).eligibilityType || null;

    if (beforeType === newType) {
      return badRequest("현재 자격 유형과 동일합니다");
    }

    /* 자격 유형 강제 변경 (전문가 여부 분기) */
    const isExpert = EXPERT_TYPES.includes(newType);
    if (isExpert) {
      await db.execute(sql`
        UPDATE members
           SET eligibility_type = ${newType},
               type = 'volunteer',
               member_subtype = ${newType},
               secondary_verified = true,
               secondary_verified_at = now(),
               updated_at = now()
         WHERE id = ${memberId}
      `);
    } else {
      await db
        .update(members)
        .set({ eligibilityType: newType, updatedAt: new Date() } as any)
        .where(eq(members.id, memberId));
    }

    /* 회원 알림 (실패해도 메인 흐름 영향 X) */
    try {
      await db.insert(notifications).values({
        recipientId: memberId,
        recipientType: "user",
        category: "eligibility",
        severity: "info",
        title: "회원 자격이 변경되었습니다",
        message: `변경 사유: ${reason}`.slice(0, 500),
        link: "/mypage.html#eligibility",
        refTable: "members",
        refId: memberId,
      } as any);
    } catch (notifyErr: any) {
      console.warn("[admin-eligibility-force-change] 알림 적재 실패:", notifyErr?.message);
    }

    /* 감사 로그 */
    try {
      await logAdminAction(req, (admin as any).uid, (admin as any).name, "eligibility_force_change", {
        target: String(memberId),
        detail: { memberName: member.name, beforeType, afterType: newType, reason, isExpert },
      });
    } catch (_) {}

    return ok(
      { memberId, beforeType, afterType: newType },
      "회원 자격이 강제 변경되었습니다"
    );
  } catch (e: any) {
    console.error("[admin-eligibility-force-change]", e);
    return serverError("자격 강제 변경 중 오류가 발생했습니다", e);
  }
};
