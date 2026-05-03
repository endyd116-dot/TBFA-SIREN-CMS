// netlify/functions/incidents.ts
// ★ M-5: 사건 목록/상세 공개 조회

import type { Context } from "@netlify/functions";
import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "../../db";
import { incidents } from "../../db/schema";
import { ok, badRequest, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/incidents" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");

    /* ===== 상세 ===== */
    if (slug) {
      const [item] = await db.select().from(incidents)
        .where(and(eq(incidents.slug, slug), eq(incidents.status, "active")))
        .limit(1);

      if (!item) return notFound("사건을 찾을 수 없습니다");

      return ok({
        incident: {
          id: (item as any).id,
          slug: (item as any).slug,
          title: (item as any).title,
          summary: (item as any).summary,
          contentHtml: (item as any).contentHtml,
          thumbnailUrl: (item as any).thumbnailBlobId
            ? `/api/blob-image?id=${(item as any).thumbnailBlobId}`
            : null,
          occurredAt: (item as any).occurredAt,
          location: (item as any).location,
          category: (item as any).category,
        },
      });
    }

    /* ===== 목록 ===== */
    const list = await db.select({
      id: incidents.id,
      slug: incidents.slug,
      title: incidents.title,
      summary: incidents.summary,
      thumbnailBlobId: incidents.thumbnailBlobId,
      occurredAt: incidents.occurredAt,
      location: incidents.location,
      category: incidents.category,
    }).from(incidents)
      .where(eq(incidents.status, "active"))
      .orderBy(asc(incidents.sortOrder), desc(incidents.occurredAt));

    return ok({
      list: list.map((n: any) => ({
        ...n,
        thumbnailUrl: n.thumbnailBlobId ? `/api/blob-image?id=${n.thumbnailBlobId}` : null,
      })),
    });
  } catch (e: any) {
    console.error("[incidents]", e);
    return serverError("사건 조회 실패", e);
  }
};