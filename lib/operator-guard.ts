// lib/operator-guard.ts
// 운영자(사용자 JWT + operatorActive=true 또는 type='admin') 가드.
// 근태 사용자 API(att-checkin/checkout/my-status 등 9개)는 일반 회원이지만
// 운영자 권한이 있는 사람이 사용. admin-guard(슈퍼/일반 어드민 전용)는 너무 엄격.
//
// 반환: requireAdmin 과 동일한 모양 ({ok:true, ctx:{member}} | {ok:false, res})
// 호출부 호환성을 위해 ctx.member 만 노출. 어드민 토큰은 admin 시스템 전용.
import { eq } from "drizzle-orm";
import { db, members } from "../db";
import { authenticateUser } from "./auth";

export interface OperatorContext {
  member: typeof members.$inferSelect;
}

export async function requireOperator(req: Request): Promise<
  | { ok: true; ctx: OperatorContext }
  | { ok: false; res: Response }
> {
  const payload = authenticateUser(req);
  if (!payload) {
    return {
      ok: false,
      res: new Response(
        JSON.stringify({ ok: false, error: "로그인이 필요합니다" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, payload.uid))
    .limit(1);

  if (!member) {
    return {
      ok: false,
      res: new Response(
        JSON.stringify({ ok: false, error: "회원 정보를 찾을 수 없습니다" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  // 블랙·정지 차단
  if (member.status === "suspended") {
    return {
      ok: false,
      res: new Response(
        JSON.stringify({
          ok: false,
          error: "귀하의 서비스가 차단되었습니다.",
          blacklisted: true,
          reason: member.blacklistReason || null,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      ),
    };
  }
  if (member.status !== "active") {
    return {
      ok: false,
      res: new Response(
        JSON.stringify({ ok: false, error: "이용할 수 없는 계정입니다" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  // 운영자 권한: type='admin' 또는 operatorActive=true
  const isOperator = member.type === "admin" || member.operatorActive === true;
  if (!isOperator) {
    return {
      ok: false,
      res: new Response(
        JSON.stringify({ ok: false, error: "운영자 권한이 필요합니다" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  return { ok: true, ctx: { member } };
}
