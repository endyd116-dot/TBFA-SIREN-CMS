/**
 * SIREN — 관리자 권한 검증 미들웨어
 * 모든 /api/admin/* 함수에서 첫 번째로 호출
 */
import { eq } from "drizzle-orm";
import { db, members } from "../db";
import { authenticateAdmin, AdminPayload } from "./auth";
import { unauthorized, forbidden } from "./response";

export interface AdminContext {
  admin: AdminPayload;
  member: typeof members.$inferSelect;
}

/**
 * 관리자 인증 + DB 회원 조회
 * - 토큰 없거나 잘못 → 401 Response 반환
 * - 회원 상태 비정상 → 403 Response 반환
 * - 정상 → AdminContext 반환
 */
export async function requireAdmin(req: Request): Promise<
  | { ok: true; ctx: AdminContext }
  | { ok: false; res: Response }
> {
  const auth = authenticateAdmin(req);
  if (!auth) return { ok: false, res: unauthorized("관리자 로그인이 필요합니다") };

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, auth.uid))
    .limit(1);

  if (!member) return { ok: false, res: unauthorized("관리자 계정을 찾을 수 없습니다") };
  if (member.type !== "admin") return { ok: false, res: forbidden("관리자 권한이 없습니다") };
  if (member.status !== "active") return { ok: false, res: forbidden("이용할 수 없는 계정입니다") };

  return { ok: true, ctx: { admin: auth, member } };
}