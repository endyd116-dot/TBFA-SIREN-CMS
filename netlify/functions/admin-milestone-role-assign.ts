/**
 * GET  /api/admin-milestone-role-assign  — 어드민 멤버 목록 + milestoneRole
 * PUT  /api/admin-milestone-role-assign  — 직원 milestoneRole 배정
 * super_admin 전용
 */
import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { isValidRoleCode } from "../../lib/milestone-roles";

export const config = { path: "/api/admin-milestone-role-assign" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth.ctx.member as any).role !== "super_admin") {
    return Response.json({ ok: false, error: "슈퍼어드민 전용 기능입니다" }, { status: 403 });
  }

  /* ── GET: 어드민 멤버 목록 ── */
  if (req.method === "GET") {
    try {
      const rows = await db.execute(sql`
        SELECT id, name, email, role, milestone_role, operator_active
        FROM members
        WHERE type = 'admin' AND status = 'active'
        ORDER BY name
      `);
      return Response.json({ ok: true, data: (rows as any).rows ?? rows });
    } catch (err: any) {
      return Response.json({
        ok: false, error: "멤버 조회 실패",
        detail: String(err?.message || err).slice(0, 400),
      }, { status: 500 });
    }
  }

  /* ── PUT: milestoneRole 배정 ── */
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch {
      return Response.json({ ok: false, error: "요청 본문 파싱 실패" }, { status: 400 });
    }
    const { memberId, milestoneRole } = body;
    if (!memberId) return Response.json({ ok: false, error: "memberId 필수" }, { status: 400 });

    /* R39 Stage 2: 활성 역할 코드 DB 조회로 동적 검증 (null·빈값 허용은 헬퍼 내부 처리) */
    const valid = await isValidRoleCode(milestoneRole);
    if (!valid) {
      return Response.json({
        ok: false,
        error: "유효하지 않은 역할값입니다 (활성 역할 카탈로그에 없음)",
      }, { status: 400 });
    }
    try {
      await db.execute(sql`
        UPDATE members
        SET milestone_role = ${milestoneRole || null}, updated_at = now()
        WHERE id = ${Number(memberId)} AND type = 'admin'
      `);
      return Response.json({ ok: true });
    } catch (err: any) {
      return Response.json({
        ok: false, error: "역할 배정 실패",
        detail: String(err?.message || err).slice(0, 400),
      }, { status: 500 });
    }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}
