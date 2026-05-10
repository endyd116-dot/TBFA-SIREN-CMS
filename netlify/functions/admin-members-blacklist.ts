/**
 * 5순위 #1 — 회원 블랙 처리/해제 API
 *
 * GET    ?list=1                : 블랙 목록 (status='suspended' AND blacklistedAt IS NOT NULL)
 * POST   {memberId, reason}     : 블랙 처리 (status → 'suspended', 메타 기록)
 * DELETE ?id=N                  : 블랙 해제 (status → 'active', 메타 nullify)
 *
 * 권한: admin + super_admin (모두 가능 — 인수인계서 명시)
 * 효과: 차단된 회원이 SIREN/유족지원/채팅 등 모든 서비스 진입 시
 *       lib/auth.ts requireActiveUser가 403 차단 응답 반환.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members } from "../../db/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, notFound, methodNotAllowed,
  serverError, parseJson,
} from "../../lib/response";
import { logAudit } from "../../lib/audit";

export default async (req: Request, _ctx: Context) => {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const adminMember = guard.ctx.member as any;
  const meId = adminMember.id as number;

  const url = new URL(req.url);

  try {
    /* ════════ GET ════════ */
    if (req.method === "GET") {
      const listFlag = url.searchParams.get("list");
      if (listFlag !== "1") return badRequest("list=1 필요");

      const items: any = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          phone: members.phone,
          type: members.type,
          status: members.status,
          blacklistedAt: members.blacklistedAt,
          blacklistedBy: members.blacklistedBy,
          blacklistReason: members.blacklistReason,
        })
        .from(members)
        .where(
          and(
            eq(members.status, "suspended" as any),
            isNotNull(members.blacklistedAt)
          )
        )
        .orderBy(desc(members.blacklistedAt))
        .limit(500);

      return ok({ items, total: items.length });
    }

    /* ════════ POST — 블랙 처리 ════════ */
    if (req.method === "POST") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("body 필수");

      const memberId = Number(body.memberId);
      if (!memberId) return badRequest("memberId 필수");
      const reason = body.reason ? String(body.reason).slice(0, 1000).trim() : null;

      // 본인은 블랙 처리 불가
      if (memberId === meId) return badRequest("본인을 블랙 처리할 수 없습니다");

      const [target]: any = await db
        .select()
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      if (!target) return notFound("회원을 찾을 수 없습니다");

      // 다른 어드민/super_admin은 블랙 처리 불가 (안전)
      if (target.type === "admin") {
        return forbidden("관리자 계정은 블랙 처리할 수 없습니다");
      }

      if (target.status === "suspended" && target.blacklistedAt) {
        return badRequest("이미 블랙 처리된 회원입니다");
      }

      const [updated]: any = await db
        .update(members)
        .set({
          status: "suspended" as any,
          blacklistedAt: new Date(),
          blacklistedBy: meId,
          blacklistReason: reason,
          updatedAt: new Date(),
        } as any)
        .where(eq(members.id, memberId))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "members.blacklist.add",
        target: `member:${memberId}`,
        detail: { name: target.name, reason },
        req,
      });

      return ok(updated, "블랙 처리되었습니다");
    }

    /* ════════ DELETE — 블랙 해제 ════════ */
    if (req.method === "DELETE") {
      const id = Number(url.searchParams.get("id") || 0);
      if (!id) return badRequest("id 필수");

      const [target]: any = await db
        .select()
        .from(members)
        .where(eq(members.id, id))
        .limit(1);
      if (!target) return notFound("회원을 찾을 수 없습니다");

      if (!target.blacklistedAt && target.status !== "suspended") {
        return badRequest("블랙 처리된 회원이 아닙니다");
      }

      const [updated]: any = await db
        .update(members)
        .set({
          status: "active" as any,
          blacklistedAt: null,
          blacklistedBy: null,
          blacklistReason: null,
          updatedAt: new Date(),
        } as any)
        .where(eq(members.id, id))
        .returning();

      await logAudit({
        userId: meId, userType: "admin", userName: adminMember.name,
        action: "members.blacklist.remove",
        target: `member:${id}`,
        detail: { name: target.name, prevReason: target.blacklistReason },
        req,
      });

      return ok(updated, "블랙 해제되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-members-blacklist]", err);
    return serverError("블랙 관리 중 오류", err);
  }
};

export const config = { path: "/api/admin-members-blacklist" };
