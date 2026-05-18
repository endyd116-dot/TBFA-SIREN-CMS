import { db } from "../../db/index";
import { attWorkplaces } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-workplace" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
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
  if (!auth.ok) return auth.res;
  if (auth.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

  // PUT — 거점 수정
  if (req.method === "PUT") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const [row] = await db
        .update(attWorkplaces)
        .set({
          name:      body.name,
          type:      body.type,
          address:   body.address ?? null,
          lat:       body.lat != null ? String(body.lat) : null,
          lng:       body.lng != null ? String(body.lng) : null,
          radius:    body.radius,
          isActive:  body.isActive,
          updatedAt: new Date(),
        })
        .where(eq(attWorkplaces.id, id))
        .returning();
      if (!row) return jsonError("not_found", new Error("거점 없음"), 404);
      return jsonOk(row);
    } catch (err) {
      return jsonError("update_workplace", err);
    }
  }

  // DELETE — 거점 삭제
  if (req.method === "DELETE") {
    try {
      await db.delete(attWorkplaces).where(eq(attWorkplaces.id, id));
      return jsonOk({ deleted: id });
    } catch (err) {
      return jsonError("delete_workplace", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
