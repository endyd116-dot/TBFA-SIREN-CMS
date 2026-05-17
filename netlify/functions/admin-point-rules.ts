import { db } from "../../db";
import { pointRules } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-point-rules" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(pointRules);
      return ok({ rules: rows });
    }

    if (req.method === "PATCH") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!id) return badRequest("id가 필요합니다");

      const updateData: Record<string, unknown> = {};
      if (typeof body.pointAmount === "number") updateData.pointAmount = body.pointAmount;
      if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db
        .update(pointRules)
        .set(updateData)
        .where(eq(pointRules.id, id))
        .returning();

      if (!updated) return badRequest("해당 규칙을 찾을 수 없습니다");
      return ok({ rule: updated });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-point-rules]", err);
    return serverError("포인트 규칙 처리 중 오류가 발생했습니다", err);
  }
};
