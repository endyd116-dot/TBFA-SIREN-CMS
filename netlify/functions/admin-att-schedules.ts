import { db } from "../../db/index";
import { attSchedules } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-att-schedules" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "스케줄 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return new Response(JSON.stringify({ ok: false, error: "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;
  const url = new URL(req.url);

  // GET — 직원별 스케줄 목록 (?memberUid=)
  if (method === "GET") {
    const memberUid = url.searchParams.get("memberUid");
    try {
      const rows = memberUid
        ? await db.select().from(attSchedules).where(eq(attSchedules.memberUid, memberUid)).orderBy(attSchedules.startDate)
        : await db.select().from(attSchedules).orderBy(attSchedules.memberUid, attSchedules.startDate);
      return jsonOk(rows);
    } catch (err) {
      return jsonError("select_schedules", err);
    }
  }

  // POST — 반복 스케줄 등록
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { memberUid, workMode, recurringRule, startDate, endDate, workplaceId, note } = body;
    if (!memberUid || !workMode || !startDate) {
      return jsonError("validate", new Error("memberUid, workMode, startDate 필수"), 400);
    }

    try {
      const [row] = await db.insert(attSchedules).values({
        memberUid,
        workMode,
        recurringRule: recurringRule ?? null,
        startDate,
        endDate: endDate ?? null,
        workplaceId: workplaceId ?? null,
        note: note ?? null,
        createdBy: String(auth.ctx.member.id),
      }).returning();
      return jsonOk(row, 201);
    } catch (err) {
      return jsonError("insert_schedule", err);
    }
  }

  // R34-P2 (round2 M6): PUT — 스케줄 수정 (?id=)
  if (method === "PUT") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const existing = await db
        .select()
        .from(attSchedules)
        .where(eq(attSchedules.id, id))
        .limit(1);
      if (existing.length === 0) {
        return jsonError("not_found", new Error("스케줄 없음"), 404);
      }
      const [row] = await db
        .update(attSchedules)
        .set({
          workMode:      body.workMode       ?? existing[0].workMode,
          recurringRule: body.recurringRule !== undefined ? body.recurringRule : existing[0].recurringRule,
          startDate:     body.startDate      ?? existing[0].startDate,
          endDate:       body.endDate !== undefined ? body.endDate : existing[0].endDate,
          workplaceId:   body.workplaceId !== undefined ? body.workplaceId : existing[0].workplaceId,
          note:          body.note !== undefined ? body.note : existing[0].note,
          updatedAt:     new Date(),
        })
        .where(eq(attSchedules.id, id))
        .returning();
      return jsonOk(row);
    } catch (err) {
      return jsonError("update_schedule", err);
    }
  }

  // R34-P2 (round2 M6): DELETE — 스케줄 삭제 (?id=)
  if (method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    try {
      await db.delete(attSchedules).where(eq(attSchedules.id, id));
      return jsonOk({ deleted: id });
    } catch (err) {
      return jsonError("delete_schedule", err);
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
