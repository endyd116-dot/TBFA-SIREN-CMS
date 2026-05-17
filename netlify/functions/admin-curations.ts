import { db } from "../../db";
import { siteCurations } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-curations" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(siteCurations);
      return ok({ curations: rows });
    }

    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      if (!body.slot) return badRequest("slot은 필수입니다");

      const [created] = await db
        .insert(siteCurations)
        .values({
          slot: String(body.slot).trim(),
          title: body.title ? String(body.title) : null,
          items: body.items ?? [],
          isActive: body.isActive !== false,
          sortOrder: Number(body.sortOrder ?? 0),
        } as any)
        .returning();

      return ok({ curation: created });
    }

    if (req.method === "PATCH") {
      if (!id) return badRequest("id 파라미터가 필요합니다");
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (body.slot !== undefined) updateData.slot = String(body.slot);
      if (body.title !== undefined) updateData.title = body.title;
      if (body.items !== undefined) updateData.items = body.items;
      if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;
      if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder);

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db
        .update(siteCurations)
        .set(updateData)
        .where(eq(siteCurations.id, id))
        .returning();

      if (!updated) return notFound("해당 큐레이션을 찾을 수 없습니다");
      return ok({ curation: updated });
    }

    if (req.method === "DELETE") {
      if (!id) return badRequest("id 파라미터가 필요합니다");

      const [deleted] = await db
        .delete(siteCurations)
        .where(eq(siteCurations.id, id))
        .returning({ id: siteCurations.id });

      if (!deleted) return notFound("해당 큐레이션을 찾을 수 없습니다");
      return ok({ deleted: true });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-curations]", err);
    return serverError("큐레이션 처리 중 오류가 발생했습니다", err);
  }
};
