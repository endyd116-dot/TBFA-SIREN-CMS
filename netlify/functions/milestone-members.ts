import type { Context } from "@netlify/functions";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/milestone-members*" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const admin = auth.ctx?.member as any;
  const isSuperAdmin = admin?.role === "super_admin";
  if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "멤버 역할 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);

  // ── GET 멤버 목록 (operatorActive) ──
  if (req.method === "GET") {
    try {
      const rows = await db.execute(sql`
        SELECT id, name, email, role, milestone_role, operator_active
        FROM members
        WHERE operator_active = TRUE OR role IN ('admin', 'super_admin')
        ORDER BY role DESC, name
        LIMIT 100
      `);
      const members = ((rows as any).rows || (rows as any[])).map((r: any) => ({
        id: r.id, name: r.name, email: r.email, role: r.role,
        milestoneRole: r.milestone_role, operatorActive: r.operator_active,
      }));
      return Response.json({ ok: true, data: { members } });
    } catch (err) { return jsonError("select", err); }
  }

  /* ★ R34-P1-B-11: PATCH /:id/role deprecated — /api/admin-milestone-role-assign으로 통일.
     레거시 호출이 들어와도 410 Gone + 안내 메시지로 마이그 유도. 호출처(admin-milestones.js)는 신 endpoint로 전환됨. */
  if (req.method === "PATCH") {
    return Response.json({
      ok: false,
      error: "이 엔드포인트는 사용 중단되었습니다",
      detail: "PUT /api/admin-milestone-role-assign { memberId, milestoneRole }로 호출하세요",
    }, { status: 410 });
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}
