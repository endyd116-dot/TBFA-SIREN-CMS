import { db } from "../../db/index";
import { attLeaveTypes } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-leave-types" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "휴가 종류 처리 실패", step,
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

  const method = req.method;
  const url = new URL(req.url);

  // GET — 휴가 종류 목록
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(attLeaveTypes)
        .orderBy(asc(attLeaveTypes.displayOrder), asc(attLeaveTypes.id));
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_leave_types", err);
    }
  }

  // POST — 신규 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { name, isPaid, unit, requiresApproval, defaultDays, isActive, displayOrder } = body;
    if (!name) return jsonError("validate", new Error("name 필수"), 400);

    try {
      const [row] = await db.insert(attLeaveTypes).values({
        name,
        isPaid:           isPaid !== false,
        unit:             unit ?? "day",
        requiresApproval: requiresApproval !== false,
        defaultDays:      defaultDays != null ? String(defaultDays) : "0",
        isActive:         isActive !== false,
        displayOrder:     displayOrder ?? 0,
      }).returning();
      return jsonOk(row, 201);
    } catch (err) {
      return jsonError("insert_leave_type", err);
    }
  }

  // PUT — 수정 (?id=)
  if (method === "PUT") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const [row] = await db
        .update(attLeaveTypes)
        .set({
          name:             body.name,
          isPaid:           body.isPaid,
          unit:             body.unit,
          requiresApproval: body.requiresApproval,
          defaultDays:      body.defaultDays != null ? String(body.defaultDays) : undefined,
          isActive:         body.isActive,
          displayOrder:     body.displayOrder,
          updatedAt:        new Date(),
        })
        .where(eq(attLeaveTypes.id, id))
        .returning();
      if (!row) return jsonError("not_found", new Error("휴가 종류 없음"), 404);
      return jsonOk(row);
    } catch (err) {
      return jsonError("update_leave_type", err);
    }
  }

  // DELETE — 삭제 (?id=)
  if (method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    try {
      await db.delete(attLeaveTypes).where(eq(attLeaveTypes.id, id));
      return jsonOk({ deleted: id });
    } catch (err) {
      return jsonError("delete_leave_type", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
