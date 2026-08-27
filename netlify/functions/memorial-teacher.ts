import { jsonKST } from "../../lib/kst";
import { getMemorialDisplay } from "../../lib/memorial-display";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialTeachers, memorialTeacherPhotos } from "../../db/schema";
import { eq, and, asc, sql } from "drizzle-orm";

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
      /* ★ 2026-08-28: 이 선생님 화면의 문구를 개별로 손볼 수 있게 함께 내려준다 */
      pageCopy:     (t as any).pageCopy && typeof (t as any).pageCopy === "object" ? (t as any).pageCopy : null,
      candleCount,
      messageCount,
      letterCount,
      photos: [] as any[],
    };

    /* ★ 2026-08-28: 생전의 순간(사진). 운영자가 등록한 공개분만.
       실패해도 화면은 나와야 하므로 빈 배열로 계속한다. */
    try {
      const rows = await db
        .select({
          id: memorialTeacherPhotos.id,
          blobId: memorialTeacherPhotos.blobId,
          caption: memorialTeacherPhotos.caption,
          detail: memorialTeacherPhotos.detail,
          takenLabel: memorialTeacherPhotos.takenLabel,
        })
        .from(memorialTeacherPhotos)
        .where(and(
          eq(memorialTeacherPhotos.teacherId, id),
          eq(memorialTeacherPhotos.isPublic, true),
        ))
        .orderBy(asc(memorialTeacherPhotos.sortOrder), asc(memorialTeacherPhotos.id));
      teacher.photos = rows.map((r) => ({
        id: r.id,
        url: r.blobId ? `/api/blob-image?id=${r.blobId}` : null,
        caption: r.caption,
        detail: r.detail,
        takenLabel: r.takenLabel,
      }));
    } catch (err) {
      console.warn("[memorial-teacher] 사진 조회 실패", err);
    }

    /* 2026-08-04: 화면에 쓸 표시 문구·개별 헌화 노출 설정을 함께 내려준다
       (제목을 '약력' 대신 다른 말로 쓰거나, 개별 헌화를 감출 수 있도록) */
    const display = await getMemorialDisplay();

    /* ★ 2026-08-28 — 선생님 화면의 구간 제목·설명은 운영자가 어드민에서 고친다.
       모든 선생님에게 공통으로 쓰이고, 선생님별 문구가 있으면 그쪽이 우선한다.
       읽기에 실패해도 화면은 기본 문구로 멀쩡히 뜬다. */
    let teacherCopy: any = null;
    try {
      const r: any = await db.execute(
        sql`SELECT hall_copy FROM memorial_settings ORDER BY id DESC LIMIT 1`
      );
      const row = (r?.rows ?? r ?? [])[0];
      const hall = row?.hall_copy;
      const parsed = typeof hall === "string" ? JSON.parse(hall) : hall;
      if (parsed && typeof parsed === "object" && parsed.teacher) teacherCopy = parsed.teacher;
    } catch (err) {
      console.warn("[memorial-teacher] 공통 문구 조회 실패", err);
    }
    (display as any).teacherCopy = teacherCopy;

    return new Response(jsonKST({ ok: true, data: { teacher, display } }), {
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
