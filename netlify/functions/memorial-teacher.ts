import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialTeachers } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";

export const config = { path: "/api/memorial-teacher" };

async function safeCount(q: any): Promise<number> {
  try {
    const r: any = await db.execute(q);
    const rows = r?.rows ?? r ?? [];
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    console.warn("[memorial-teacher] count 실패", err);
    return 0;
  }
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0", 10);
  if (!id) {
    return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const [t] = await db
      .select()
      .from(memorialTeachers)
      .where(and(eq(memorialTeachers.id, id), eq(memorialTeachers.isPublic, true)))
      .limit(1);

    if (!t) {
      return new Response(jsonKST({ ok: false, error: "공개된 추모 공간을 찾을 수 없습니다" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const candleCount  = await safeCount(sql`SELECT COUNT(*)::int AS n FROM memorial_offerings WHERE teacher_id = ${id}`);
    const messageCount = await safeCount(sql`SELECT COUNT(*)::int AS n FROM memorial_messages WHERE teacher_id = ${id} AND is_hidden = FALSE`);
    const letterCount  = await safeCount(sql`SELECT COUNT(*)::int AS n FROM memorial_letters WHERE teacher_id = ${id} AND is_hidden = FALSE`);

    const teacher = {
      id:           t.id,
      name:         t.name,
      photoUrl:     t.photoBlobId ? `/api/blob-image?id=${t.photoBlobId}` : null,
      schoolRegion: t.schoolRegion,
      birthDate:    t.birthDate,
      deathDate:    t.deathDate,
      tributeLine:  t.tributeLine,
      bioHtml:      t.bioHtml,
      timeline:     Array.isArray(t.timeline) ? t.timeline : [],
      candleCount,
      messageCount,
      letterCount,
    };

    return new Response(jsonKST({ ok: true, data: { teacher } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "선생님 상세 조회 실패",
      step: "select_teacher",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
