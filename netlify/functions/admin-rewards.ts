import { db } from "../../db";
import { rewards } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-rewards" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(rewards);
      return ok({ rewards: rows });
    }

    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      if (!body.nameKo || body.pointCost === undefined) {
        return badRequest("nameKo, pointCost는 필수입니다");
      }

      const [created] = await db
        .insert(rewards)
        .values({
          nameKo: String(body.nameKo).trim(),
          description: body.description ? String(body.description) : null,
          pointCost: Number(body.pointCost),
          stock: body.stock !== undefined ? Number(body.stock) : null,
          isActive: body.isActive !== false,
          imageUrl: body.imageUrl ? String(body.imageUrl) : null,
        } as any)
        .returning();

      return ok({ reward: created });
    }

    if (req.method === "PATCH") {
      if (!id) return badRequest("id 파라미터가 필요합니다");
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (body.nameKo !== undefined) updateData.nameKo = String(body.nameKo);
      if (body.description !== undefined) updateData.description = body.description;
      if (body.pointCost !== undefined) updateData.pointCost = Number(body.pointCost);
      if (body.stock !== undefined) updateData.stock = body.stock === null ? null : Number(body.stock);
      if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;
      if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db
        .update(rewards)
        .set(updateData)
        .where(eq(rewards.id, id))
        .returning();

      if (!updated) return notFound("해당 리워드를 찾을 수 없습니다");
      return ok({ reward: updated });
    }

    if (req.method === "DELETE") {
      if (!id) return badRequest("id 파라미터가 필요합니다");

      const [deleted] = await db
        .delete(rewards)
        .where(eq(rewards.id, id))
        .returning({ id: rewards.id });

      if (!deleted) return notFound("해당 리워드를 찾을 수 없습니다");
      return ok({ deleted: true });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-rewards]", err);
    return serverError("리워드 처리 중 오류가 발생했습니다", err);
  }
};
