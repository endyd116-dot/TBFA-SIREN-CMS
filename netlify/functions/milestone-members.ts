import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/milestone-members*" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
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

  // ── PATCH /:id/role — milestoneRole 설정 ──
  if (req.method === "PATCH") {
    const id = url.pathname.split("/").filter(Boolean).slice(-2)[0];
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { milestoneRole } = body;
    const VALID = [null, "SM", "PM", "SI"];
    if (!VALID.includes(milestoneRole)) {
      return Response.json({ ok: false, error: "유효한 값: SM, PM, SI, null" }, { status: 400 });
    }
    try {
      await db.execute(sql`
        UPDATE members SET milestone_role = ${milestoneRole}, updated_at = NOW()
        WHERE id = ${Number(id)}
      `);
      return Response.json({ ok: true });
    } catch (err) { return jsonError("update", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}
