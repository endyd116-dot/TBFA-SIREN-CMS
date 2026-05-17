import { db } from "../../db";
import { siteCurations } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/site-curations" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const slot = url.searchParams.get("slot");

    if (!slot) return badRequest("slot 파라미터가 필요합니다");

    const [row] = await db
      .select({
        slot: siteCurations.slot,
        title: siteCurations.title,
        items: siteCurations.items,
      })
      .from(siteCurations)
      .where(and(eq(siteCurations.slot, slot), eq(siteCurations.isActive, true)))
      .limit(1);

    return ok({ curation: row ?? { slot, title: null, items: [] } });
  } catch (err) {
    console.error("[site-curations]", err);
    return serverError("큐레이션 조회 중 오류가 발생했습니다", err);
  }
};
