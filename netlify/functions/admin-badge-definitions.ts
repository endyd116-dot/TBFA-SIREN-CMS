import { db } from "../../db";
import { badgeDefinitions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

/* 게이미피케이션 라우팅 fix: 클라이언트가 /api/admin-badge-definitions/{code}(경로 세그먼트)로
   PATCH·DELETE 호출 → base + 와일드카드 둘 다 매칭. code는 쿼리 또는 경로에서 추출. */
export const config = { path: ["/api/admin-badge-definitions", "/api/admin-badge-definitions/*"] };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  let code = url.searchParams.get("code");
  if (!code) {
    const m = url.pathname.match(/\/api\/admin-badge-definitions\/([^/?]+)/);
    if (m) code = decodeURIComponent(m[1]);
  }

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(badgeDefinitions).orderBy(badgeDefinitions.sortOrder);
      return ok({ badges: rows });
    }

    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      if (!body.code || !body.nameKo || !body.conditionType || body.conditionValue === undefined) {
        return badRequest("code, nameKo, conditionType, conditionValue는 필수입니다");
      }

      const [created] = await db
        .insert(badgeDefinitions)
        .values({
          code: String(body.code).trim(),
          nameKo: String(body.nameKo).trim(),
          icon: body.icon ? String(body.icon) : null,
          conditionType: String(body.conditionType),
          conditionValue: Number(body.conditionValue),
          description: body.description ? String(body.description) : null,
          isActive: body.isActive !== false,
          sortOrder: Number(body.sortOrder ?? 0),
        } as any)
        .returning();

      return ok({ badge: created });
    }

    if (req.method === "PATCH") {
      if (!code) return badRequest("code 파라미터가 필요합니다");
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (body.nameKo !== undefined) updateData.nameKo = String(body.nameKo);
      if (body.icon !== undefined) updateData.icon = body.icon;
      if (body.conditionType !== undefined) updateData.conditionType = String(body.conditionType);
      if (body.conditionValue !== undefined) updateData.conditionValue = Number(body.conditionValue);
      if (body.description !== undefined) updateData.description = body.description;
      if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;
      if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder);

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db
        .update(badgeDefinitions)
        .set(updateData)
        .where(eq(badgeDefinitions.code, code))
        .returning();

      if (!updated) return notFound("해당 뱃지를 찾을 수 없습니다");
      return ok({ badge: updated });
    }

    if (req.method === "DELETE") {
      if (!code) return badRequest("code 파라미터가 필요합니다");

      const [deleted] = await db
        .delete(badgeDefinitions)
        .where(eq(badgeDefinitions.code, code))
        .returning({ code: badgeDefinitions.code });

      if (!deleted) return notFound("해당 뱃지를 찾을 수 없습니다");
      return ok({ deleted: true });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-badge-definitions]", err);
    return serverError("뱃지 정의 처리 중 오류가 발생했습니다", err);
  }
};
