import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialTeachers } from "../../db/schema";
import { eq, asc, sql } from "drizzle-orm";

export const config = { path: "/api/memorial-teachers" };

export default async function handler(_req: Request, _ctx: Context) {
  try {
    /* 공개 선생님 그리드 */
    const rows = await db
      .select({
        id:           memorialTeachers.id,
        name:         memorialTeachers.name,
        photoBlobId:  memorialTeachers.photoBlobId,
        schoolRegion: memorialTeachers.schoolRegion,
        tributeLine:  memorialTeachers.tributeLine,
      })
      .from(memorialTeachers)
      .where(eq(memorialTeachers.isPublic, true))
      .orderBy(asc(memorialTeachers.sortOrder), asc(memorialTeachers.id));

    /* 카운트 일괄 집계 (헌화·메시지) — 실패 시 0 */
    const candleMap = new Map<number, number>();
    const messageMap = new Map<number, number>();
    try {
      const cr: any = await db.execute(
        sql`SELECT teacher_id, COUNT(*)::int AS n FROM memorial_offerings WHERE teacher_id IS NOT NULL GROUP BY teacher_id`
      );
      for (const r of (cr?.rows ?? cr ?? [])) candleMap.set(Number(r.teacher_id), Number(r.n));
    } catch (err) { console.warn("[memorial-teachers] 헌화 집계 실패", err); }
    try {
      const mr: any = await db.execute(
        sql`SELECT teacher_id, COUNT(*)::int AS n FROM memorial_messages WHERE teacher_id IS NOT NULL AND is_hidden = FALSE GROUP BY teacher_id`
      );
      for (const r of (mr?.rows ?? mr ?? [])) messageMap.set(Number(r.teacher_id), Number(r.n));
    } catch (err) { console.warn("[memorial-teachers] 메시지 집계 실패", err); }

    const teachers = rows.map((t) => ({
      id:           t.id,
      name:         t.name,
      photoUrl:     t.photoBlobId ? `/api/blob-image?id=${t.photoBlobId}` : null,
      schoolRegion: t.schoolRegion,
      tributeLine:  t.tributeLine,
      candleCount:  candleMap.get(t.id) ?? 0,
      messageCount: messageMap.get(t.id) ?? 0,
    }));

    return new Response(JSON.stringify({ ok: true, data: { teachers } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false,
      error: "선생님 목록 조회 실패",
      step: "select_teachers",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
