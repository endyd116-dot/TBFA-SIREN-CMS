// lib/admin-guard.ts
import { eq } from "drizzle-orm";
import { db, members } from "../db";
import { authenticateAdmin, AdminPayload } from "./auth";
import { unauthorized, forbidden } from "./response";

export interface AdminContext {
  admin: AdminPayload;
  member: typeof members.$inferSelect;
}

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