import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/milestone-quarters" };

export default async function handler(req: Request, _ctx: Context) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  const admin = auth.ctx?.member as any;
  const isSuperAdmin = admin?.role === "super_admin";

  function jsonError(step: string, err: any) {
    return Response.json({ ok: false, error: "분기 오류", step,
      detail: String(err?.message || err).slice(0, 500) }, { status: 500 });
  }

  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const rows = await db.execute(sql`SELECT * FROM quarters ORDER BY year DESC, quarter DESC LIMIT 20`);
      const quarters = ((rows as any).rows || (rows as any[])).map(formatQ);
      return Response.json({ ok: true, data: { quarters } });
    } catch (err) { return jsonError("select", err); }
  }

  if (req.method === "POST") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { year, quarter, startDate, endDate, settlementDate } = body;
    if (!year || !quarter || !startDate || !endDate || !settlementDate) {
      return Response.json({ ok: false, error: "필수 필드 누락" }, { status: 400 });
    }
    try {
      const rows = await db.execute(sql`
        INSERT INTO quarters (year, quarter, start_date, end_date, settlement_date, status)
        VALUES (${year}, ${quarter}, ${startDate}, ${endDate}, ${settlementDate}, 'UPCOMING')
        RETURNING *
      `);
      return Response.json({ ok: true, data: { quarter: formatQ((rows as any).rows?.[0] || rows[0]) } }, { status: 201 });
    } catch (err: any) {
      if (err?.message?.includes("unique")) return Response.json({ ok: false, error: "이미 존재하는 분기입니다" }, { status: 409 });
      return jsonError("insert", err);
    }
  }

  if (req.method === "PATCH") {
    if (!isSuperAdmin) return Response.json({ ok: false, error: "슈퍼어드민 전용" }, { status: 403 });
    const id = url.searchParams.get("id") || url.pathname.split("/").pop();
    if (!id || isNaN(Number(id))) return Response.json({ ok: false, error: "ID 없음" }, { status: 400 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 }); }
    const { status, settlementDate } = body;
    const VALID = ["UPCOMING", "ACTIVE", "ENDED", "SETTLED"];
    if (status && !VALID.includes(status)) {
      return Response.json({ ok: false, error: "유효하지 않은 상태값" }, { status: 400 });
    }
    try {
      const sets: string[] = [`updated_at = NOW()`];
      const vals: any[] = [];
      if (status) { vals.push(status); sets.push(`status = $${vals.length}`); }
      if (settlementDate) { vals.push(settlementDate); sets.push(`settlement_date = $${vals.length}`); }
      vals.push(Number(id));
      const rows = await db.execute(sql.raw(`UPDATE quarters SET ${sets.join(",")} WHERE id = $${vals.length} RETURNING *`, vals));
      const q = (rows as any).rows?.[0] || rows[0];
      if (!q) return Response.json({ ok: false, error: "분기 없음" }, { status: 404 });
      return Response.json({ ok: true, data: { quarter: formatQ(q) } });
    } catch (err) { return jsonError("update", err); }
  }

  return Response.json({ ok: false, error: "지원하지 않는 메서드" }, { status: 405 });
}

function formatQ(r: any) {
  return {
    id: r.id, year: r.year, quarter: r.quarter,
    startDate: r.start_date, endDate: r.end_date, settlementDate: r.settlement_date,
    status: r.status, createdAt: r.created_at,
  };
}
