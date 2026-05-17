import { db } from "../../db";
import { pointRules } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-point-rules" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(pointRules).orderBy(pointRules.id);
      return ok({ rules: rows });
    }

    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      if (!body.eventType?.trim()) return badRequest("이벤트 유형(eventType)은 필수입니다");
      if (typeof body.pointAmount !== "number") return badRequest("포인트 금액(pointAmount)이 필요합니다");

      const [created] = await db
        .insert(pointRules)
        .values({
          eventType:   String(body.eventType).trim(),
          pointAmount: Number(body.pointAmount),
          isActive:    body.isActive !== false,
          description: body.description ? String(body.description).trim() : null,
        } as any)
        .returning();

      return ok({ rule: created });
    }

    if (req.method === "PATCH") {
      if (!id) return badRequest("id 파라미터가 필요합니다");
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (typeof body.pointAmount === "number") updateData.pointAmount = body.pointAmount;
      if (typeof body.isActive    === "boolean") updateData.isActive    = body.isActive;
      if (body.description !== undefined)        updateData.description = body.description;

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db.update(pointRules).set(updateData).where(eq(pointRules.id, id)).returning();
      if (!updated) return notFound("해당 규칙을 찾을 수 없습니다");
      return ok({ rule: updated });
    }

    if (req.method === "DELETE") {
      if (!id) return badRequest("id 파라미터가 필요합니다");
      const [deleted] = await db.delete(pointRules).where(eq(pointRules.id, id)).returning({ id: pointRules.id });
      if (!deleted) return notFound("해당 규칙을 찾을 수 없습니다");
      return ok({ deleted: true });
    }

    return methodNotAllowed();
  } catch (err: any) {
    if (err?.message?.includes("unique")) return badRequest("이미 존재하는 이벤트 유형입니다");
    console.error("[admin-point-rules]", err);
    return serverError("포인트 규칙 처리 중 오류가 발생했습니다", err);
  }
};
