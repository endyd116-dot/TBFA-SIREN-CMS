import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { familyStories } from "../../db/schema";
import { and, eq, sql } from "drizzle-orm";

export const config = { path: "/api/family-story" };

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rows = await db
      .select()
      .from(familyStories)
      .where(and(eq(familyStories.id, id), eq(familyStories.status, "published")))
      .limit(1);

    if (!rows.length) {
      return new Response(jsonKST({ ok: false, error: "준비 중인 이야기입니다" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 조회수 비동기 증가 (실패해도 응답에 영향 없음)
    db.execute(sql`UPDATE family_stories SET view_count = view_count + 1 WHERE id = ${id}`)
      .catch((e) => console.warn("[family-story] view_count 증가 실패:", e));

    const s = rows[0];
    return new Response(jsonKST({
      ok: true,
      data: {
        story: {
          id:           s.id,
          youtubeId:    s.youtubeId,
          youtubeUrl:   s.youtubeUrl,
          title:        s.title,
          subtitle:     s.subtitle,
          thumbnailUrl: s.thumbnailUrl,
          summary:      s.summary,
          detailHtml:   s.detailHtml,
          duration:     s.duration,
          category:     s.category,
          viewCount:    s.viewCount,
          publishedAt:  s.publishedAt,
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "상세 조회 실패",
      step: "select_story",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
