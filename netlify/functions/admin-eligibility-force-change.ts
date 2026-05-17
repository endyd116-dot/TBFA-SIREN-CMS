// netlify/functions/admin-eligibility-force-change.ts
// 어드민 전용: 회원 자격 유형 강제 변경 (신청 없이 직접 변경)

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, members } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAdminAction } from "../../lib/audit";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin-eligibility-force-change" };

const VALID_TYPES = ["active_teacher", "retired_teacher", "pre_teacher", "general"];

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

    const newType = String(body.eligibilityType || "").trim();
    if (!VALID_TYPES.includes(newType)) {
      return badRequest(`유효하지 않은 자격 유형입니다. 허용값: ${VALID_TYPES.join(", ")}`);
    }

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

    /* 자격 유형 강제 변경 */
    await db
      .update(members)
      .set({ eligibilityType: newType, updatedAt: new Date() } as any)
      .where(eq(members.id, memberId));

    /* 감사 로그 */
    try {
      await logAdminAction(req, (admin as any).uid, (admin as any).name, "eligibility_force_change", {
        target: String(memberId),
        detail: { memberName: member.name, beforeType, afterType: newType },
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
