import { db } from "../../db";
import { sitePopups } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-popups" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(sitePopups);
      return ok({ popups: rows });
    }

    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      if (!body.title) return badRequest("title은 필수입니다");

      const [created] = await db
        .insert(sitePopups)
        .values({
          title: String(body.title).trim(),
          content: body.content ?? null,
          imageUrl: body.imageUrl ?? null,
          linkUrl: body.linkUrl ?? null,
          targetPages: body.targetPages ?? ["*"],
          displayFrequency: body.displayFrequency ?? "once_day",
          startAt: body.startAt ? new Date(body.startAt) : null,
          endAt: body.endAt ? new Date(body.endAt) : null,
          isActive: body.isActive !== false,
        } as any)
        .returning();

      return ok({ popup: created });
    }

    if (req.method === "PATCH") {
      if (!id) return badRequest("id 파라미터가 필요합니다");
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (body.title !== undefined) updateData.title = String(body.title);
      if (body.content !== undefined) updateData.content = body.content;
      if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;
      if (body.linkUrl !== undefined) updateData.linkUrl = body.linkUrl;
      if (body.targetPages !== undefined) updateData.targetPages = body.targetPages;
      if (body.displayFrequency !== undefined) updateData.displayFrequency = String(body.displayFrequency);
      if (body.startAt !== undefined) updateData.startAt = body.startAt ? new Date(body.startAt) : null;
      if (body.endAt !== undefined) updateData.endAt = body.endAt ? new Date(body.endAt) : null;
      if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db
        .update(sitePopups)
        .set(updateData)
        .where(eq(sitePopups.id, id))
        .returning();

      if (!updated) return notFound("해당 팝업을 찾을 수 없습니다");
      return ok({ popup: updated });
    }

    if (req.method === "DELETE") {
      if (!id) return badRequest("id 파라미터가 필요합니다");

      const [deleted] = await db
        .delete(sitePopups)
        .where(eq(sitePopups.id, id))
        .returning({ id: sitePopups.id });

      if (!deleted) return notFound("해당 팝업을 찾을 수 없습니다");
      return ok({ deleted: true });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-popups]", err);
    return serverError("팝업 처리 중 오류가 발생했습니다", err);
  }
};
