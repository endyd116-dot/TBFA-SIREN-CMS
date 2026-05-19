import { db } from "../../db/index";
import { attWorkplaces } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-workplaces" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "거점 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;

  // GET — 거점 목록 (R35-GAP-P2 M-G2: 기본 is_active=true·?includeInactive=1로 전체 보기)
  if (method === "GET") {
    try {
      const url = new URL(req.url);
      const includeInactive = url.searchParams.get("includeInactive") === "1";
      const query = includeInactive
        ? db.select().from(attWorkplaces).orderBy(attWorkplaces.id)
        : db.select().from(attWorkplaces).where(eq(attWorkplaces.isActive, true)).orderBy(attWorkplaces.id);
      const rows = await query;
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_workplaces", err);
    }
  }

  // POST — 거점 신규 생성
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { name, type, address, lat, lng, radius, isActive } = body;
    if (!name || !type) {
      return jsonError("validate", new Error("name, type 필수"), 400);
    }

    try {
      const [row] = await db.insert(attWorkplaces).values({
        name,
        type,
        address: address ?? null,
        lat: lat != null ? String(lat) : null,
        lng: lng != null ? String(lng) : null,
        radius: radius ?? 50,
        isActive: isActive !== false,
      } as any).returning();
      return jsonOk(row, 201);
    } catch (err) {
      return jsonError("insert_workplace", err);
    }
  }

  // PUT — 거점 수정 (/api/admin-att-workplace?id=)
  if (method === "PUT") {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const [row] = await db
        .update(attWorkplaces)
        .set({
          name: body.name,
          type: body.type,
          address: body.address ?? null,
          lat: body.lat != null ? String(body.lat) : null,
          lng: body.lng != null ? String(body.lng) : null,
          radius: body.radius,
          isActive: body.isActive,
          updatedAt: new Date(),
        } as any)
        .where(eq(attWorkplaces.id, id))
        .returning();
      if (!row) return jsonError("not_found", new Error("거점 없음"), 404);
      return jsonOk(row);
    } catch (err) {
      return jsonError("update_workplace", err);
    }
  }

  // DELETE — 거점 삭제 (/api/admin-att-workplace?id=)
  if (method === "DELETE") {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    try {
      await db.delete(attWorkplaces).where(eq(attWorkplaces.id, id));
      return jsonOk({ deleted: id });
    } catch (err) {
      return jsonError("delete_workplace", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
