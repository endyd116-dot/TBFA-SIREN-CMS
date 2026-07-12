import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { familyStories } from "../../db/schema";
import { eq, asc } from "drizzle-orm";

export const config = { path: "/api/family-stories" };

export default async function handler(_req: Request, _ctx: Context) {
  try {
    const rows = await db
      .select({
        id:           familyStories.id,
        youtubeId:    familyStories.youtubeId,
        title:        familyStories.title,
        subtitle:     familyStories.subtitle,
        thumbnailUrl: familyStories.thumbnailUrl,
        summary:      familyStories.summary,
        duration:     familyStories.duration,
        category:     familyStories.category,
      })
      .from(familyStories)
      .where(eq(familyStories.status, "published"))
      .orderBy(asc(familyStories.sortOrder), asc(familyStories.publishedAt));

    return new Response(jsonKST({ ok: true, data: { stories: rows } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "목록 조회 실패",
      step: "select_stories",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
