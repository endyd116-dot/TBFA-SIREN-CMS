import { db } from "../../db";
import { siteCurations } from "../../db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { ok, badRequest, notFound, serverError, parseJson, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin-curations" };

/* 각 row가 하나의 아이템. title = 아이템 제목, items JSON = {subtitle, linkUrl, imageUrl, contentType} */
function toItem(row: any) {
  const extra = (row.items ?? {}) as Record<string, unknown>;
  return {
    id:          row.id,
    slot:        row.slot,
    title:       row.title ?? "",
    subtitle:    extra.subtitle ?? null,
    linkUrl:     extra.linkUrl ?? null,
    imageUrl:    extra.imageUrl ?? null,
    contentType: extra.contentType ?? "banner",
    isActive:    row.isActive,
    sortOrder:   row.sortOrder ?? 0,
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;

  const url = new URL(req.url);
  const id     = Number(url.searchParams.get("id"));
  const slot   = url.searchParams.get("slot") || null;
  const action = url.searchParams.get("action") || null;

  try {
    if (req.method === "GET") {
      const rows = slot
        ? await db.select().from(siteCurations).where(eq(siteCurations.slot, slot)).orderBy(asc(siteCurations.sortOrder))
        : await db.select().from(siteCurations).orderBy(asc(siteCurations.slot), asc(siteCurations.sortOrder));
      return ok({ items: rows.map(toItem) });
    }

    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");
      if (!body.slot) return badRequest("slot은 필수입니다");
      if (!body.title?.trim()) return badRequest("제목은 필수입니다");

      const [created] = await db
        .insert(siteCurations)
        .values({
          slot:      String(body.slot).trim(),
          title:     String(body.title).trim(),
          items:     { subtitle: body.subtitle || null, linkUrl: body.linkUrl || null, imageUrl: body.imageUrl || null, contentType: body.contentType || "banner" },
          isActive:  body.isActive !== false,
          sortOrder: Number(body.sortOrder ?? 0),
        } as any)
        .returning();

      return ok({ item: toItem(created) });
    }

    if (req.method === "PATCH") {
      /* 순서 일괄 변경: ?action=reorder, body: {ids: number[]} */
      if (action === "reorder") {
        const body = await parseJson(req);
        const ids: number[] = body?.ids ?? [];
        if (!ids.length) return badRequest("ids가 필요합니다");
        await Promise.all(ids.map((rid, idx) =>
          db.update(siteCurations).set({ sortOrder: idx } as any).where(eq(siteCurations.id, rid))
        ));
        return ok({ reordered: true });
      }

      if (!id) return badRequest("id 파라미터가 필요합니다");
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const updateData: Record<string, unknown> = {};
      if (body.title !== undefined)    updateData.title = String(body.title).trim();
      if (body.slot  !== undefined)    updateData.slot  = String(body.slot);
      if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;
      if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder);

      /* 아이템 필드는 items JSON에 머지 */
      const [current] = await db.select({ items: siteCurations.items }).from(siteCurations).where(eq(siteCurations.id, id));
      const prevExtra = (current?.items ?? {}) as Record<string, unknown>;
      const newExtra: Record<string, unknown> = { ...prevExtra };
      if ("subtitle"    in body) newExtra.subtitle    = body.subtitle    || null;
      if ("linkUrl"     in body) newExtra.linkUrl     = body.linkUrl     || null;
      if ("imageUrl"    in body) newExtra.imageUrl    = body.imageUrl    || null;
      if ("contentType" in body) newExtra.contentType = body.contentType || "banner";
      updateData.items = newExtra;

      if (!Object.keys(updateData).length) return badRequest("수정할 항목이 없습니다");

      const [updated] = await db.update(siteCurations).set(updateData).where(eq(siteCurations.id, id)).returning();
      if (!updated) return notFound("해당 아이템을 찾을 수 없습니다");
      return ok({ item: toItem(updated) });
    }

    if (req.method === "DELETE") {
      if (!id) return badRequest("id 파라미터가 필요합니다");
      const [deleted] = await db.delete(siteCurations).where(eq(siteCurations.id, id)).returning({ id: siteCurations.id });
      if (!deleted) return notFound("해당 아이템을 찾을 수 없습니다");
      return ok({ deleted: true });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-curations]", err);
    return serverError("큐레이션 처리 중 오류가 발생했습니다", err);
  }
};
