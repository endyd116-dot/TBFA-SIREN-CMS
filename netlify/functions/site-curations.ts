import { db } from "../../db";
import { siteCurations } from "../../db/schema";
import { and, eq, asc } from "drizzle-orm";
import { ok, badRequest, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/site-curations" };

/* 각 row가 하나의 아이템. title = 아이템 제목, items JSON = {subtitle, linkUrl, imageUrl, contentType}.
   admin-curations 의 toItem 과 동일 평탄화(공개 노출 불필요 필드 제외). */
function toItem(row: any) {
  const extra = (row.items ?? {}) as Record<string, unknown>;
  return {
    title:       row.title ?? "",
    subtitle:    extra.subtitle ?? null,
    linkUrl:     extra.linkUrl ?? null,
    imageUrl:    extra.imageUrl ?? null,
    contentType: extra.contentType ?? "banner",
    sortOrder:   row.sortOrder ?? 0,
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const slot = url.searchParams.get("slot");

    if (!slot) return badRequest("slot 파라미터가 필요합니다");

    /* Q4-003 fix: 슬롯당 여러 아이템(각 row=1아이템) 전부를 sort_order 순으로 반환.
       이전엔 .limit(1) 로 1개만 노출돼 운영자가 여러 개 등록·정렬해도 무시됐음. */
    const rows = await db
      .select({
        slot:      siteCurations.slot,
        title:     siteCurations.title,
        items:     siteCurations.items,
        sortOrder: siteCurations.sortOrder,
      })
      .from(siteCurations)
      .where(and(eq(siteCurations.slot, slot), eq(siteCurations.isActive, true)))
      .orderBy(asc(siteCurations.sortOrder), asc(siteCurations.id));

    const curations = rows.map(toItem);
    /* curation(단건)은 하위호환 키 — 기존 단일 소비처가 있으면 첫 아이템 유지 */
    return ok({
      slot,
      curations,
      curation: curations[0] ?? { slot, title: null, items: [] },
    });
  } catch (err) {
    console.error("[site-curations]", err);
    return serverError("큐레이션 조회 중 오류가 발생했습니다", err);
  }
};
