// netlify/functions/admin-memorial-family-notes.ts
// ★ 2026-08-28 추모관 v2 — 유가족 근황 소식 관리 (운영자)
//
// 아침관 '우린 요즘 이렇게 지냅니다'에 나가는 근황을 등록·수정·삭제한다.
// 유가족 신원 보호를 위해 실명이 아니라 표기용 이름만 받는다.
// ★ 2026-10-07: 사진 한 장을 붙일 수 있다 (photoBlobId — /api/blob-upload 로 올린 번호).
// ★ 2026-11-12: 분위기 표시(mood)는 관리자가 직접 관리하는 목록에서 고른다(lib/memorial-moods.ts).
//               빈 값('')은 «표시 없음». 목록에 없는 key 는 받지 않는다.
//
//   GET                      목록 (숨긴 것 포함)
//   POST                     등록      { title, content, authorLabel, mood, photoBlobId, isPublic, sortOrder }
//   POST ?action=update&id=  수정      (같은 필드, 준 것만 바뀐다)
//   POST ?action=delete&id=  삭제

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialFamilyNotes } from "../../db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { jsonKST } from "../../lib/kst";
import { readMoodSetting, isMoodKey, type MemorialMood } from "../../lib/memorial-moods";

export const config = { path: "/api/admin-memorial-family-notes" };

/** 분위기 표시 목록 — 읽지 못하면 null(그때는 key 형식만 본다. 저장소가 잠깐 막혀도 글 저장은 되게) */
async function moodListOrNull(): Promise<MemorialMood[] | null> {
  try { return (await readMoodSetting()).moods; }
  catch (err: any) {
    console.warn("[admin-memorial-family-notes] 분위기 표시 목록 조회 실패 — 형식만 검사:", err?.message || err);
    return null;
  }
}

/** 보낸 분위기 표시 값 검사 — '' 는 표시 없음, 그 밖에는 목록에 있는 key 만 */
function resolveMood(raw: unknown, list: MemorialMood[] | null): { ok: true; value: string } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: "" };
  if (!isMoodKey(s)) return { ok: false, error: "분위기 표시 값이 올바르지 않습니다" };
  if (list && !list.some((m) => m.key === s)) {
    return { ok: false, error: "고른 분위기 표시가 목록에 없습니다. 화면을 새로 고친 뒤 다시 골라 주세요" };
  }
  return { ok: true, value: s };
}

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "유가족 근황 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

function bad(msg: string) {
  return new Response(jsonKST({ ok: false, error: msg }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

function shape(r: any) {
  return {
    ...r,
    photoUrl: r?.photoBlobId ? `/api/blob-image?id=${r.photoBlobId}` : null,
  };
}

export default async function handler(req: Request, _ctx: Context) {
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  /* ───────── 목록 ───────── */
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(memorialFamilyNotes)
        .orderBy(asc(memorialFamilyNotes.sortOrder), desc(memorialFamilyNotes.publishedAt));
      return new Response(jsonKST({ ok: true, data: { notes: rows.map(shape) } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) { return jsonError("select_notes", err); }
  }

  if (method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const action = (url.searchParams.get("action") || "create").trim();
  const id = parseInt(url.searchParams.get("id") || "0", 10);

  /* ───────── 삭제 ───────── */
  if (action === "delete") {
    if (!id) return bad("id가 필요합니다");
    try {
      await db.delete(memorialFamilyNotes).where(eq(memorialFamilyNotes.id, id));
      return new Response(jsonKST({ ok: true, data: { deleted: id } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) { return jsonError("delete_note", err); }
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const authorLabel = String(body.authorLabel || "").trim() || null;
  /* 분위기 표시 — 보낸 값이 있으면 목록 기준으로 검사, 새로 쓰면서 안 보냈으면 목록의 첫 표시 */
  let mood = "";
  if (body.mood !== undefined || action !== "update") {
    const list = await moodListOrNull();
    if (body.mood !== undefined) {
      const r = resolveMood(body.mood, list);
      if (!r.ok) return bad((r as { ok: false; error: string }).error);
      mood = r.value;
    } else {
      mood = list ? (list[0]?.key || "") : "calm";
    }
  }
  const isPublic = body.isPublic === undefined ? true : !!body.isPublic;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
  const photoBlobId = Number.isFinite(Number(body.photoBlobId)) && Number(body.photoBlobId) > 0
    ? Number(body.photoBlobId) : null;

  /* ───────── 수정 ───────── */
  if (action === "update") {
    if (!id) return bad("id가 필요합니다");
    try {
      const patch: any = { updatedAt: new Date() };
      if (title) patch.title = title;
      if (content) patch.content = content;
      if (body.authorLabel !== undefined) patch.authorLabel = authorLabel;
      if (body.mood !== undefined) patch.mood = mood;
      if (body.isPublic !== undefined) patch.isPublic = isPublic;
      if (body.sortOrder !== undefined) patch.sortOrder = sortOrder;
      if (body.photoBlobId !== undefined) patch.photoBlobId = photoBlobId;

      const [row] = await db
        .update(memorialFamilyNotes)
        .set(patch)
        .where(eq(memorialFamilyNotes.id, id))
        .returning();
      if (!row) return bad("해당 근황을 찾을 수 없습니다");
      return new Response(jsonKST({ ok: true, data: { note: shape(row) } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) { return jsonError("update_note", err); }
  }

  /* ───────── 등록 ───────── */
  if (!title) return bad("제목을 입력해 주세요");
  if (!content) return bad("내용을 입력해 주세요");
  if (title.length > 150) return bad("제목은 150자 이내로 입력해 주세요");

  try {
    const [row] = await db
      .insert(memorialFamilyNotes)
      .values({
        title, content, authorLabel, mood, isPublic, sortOrder, photoBlobId,
        createdBy: guard.ctx?.uid ?? guard.ctx?.id ?? null,
      } as any)
      .returning();
    return new Response(jsonKST({ ok: true, data: { note: shape(row) } }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  } catch (err) { return jsonError("insert_note", err); }
}
