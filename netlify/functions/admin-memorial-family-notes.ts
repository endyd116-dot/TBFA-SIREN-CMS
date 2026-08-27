// netlify/functions/admin-memorial-family-notes.ts
// ★ 2026-08-28 추모관 v2 — 유가족 근황 소식 관리 (운영자)
//
// 아침관 '우린 요즘 이렇게 지냅니다'에 나가는 짧은 근황을 등록·수정·삭제한다.
// 유가족 신원 보호를 위해 실명이 아니라 표기용 이름만 받는다.
//
//   GET                      목록 (숨긴 것 포함)
//   POST                     등록      { title, content, authorLabel, mood, isPublic, sortOrder }
//   POST ?action=update&id=  수정      (같은 필드, 준 것만 바뀐다)
//   POST ?action=delete&id=  삭제

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialFamilyNotes } from "../../db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { jsonKST } from "../../lib/kst";

export const config = { path: "/api/admin-memorial-family-notes" };

const MOODS = ["calm", "hope", "thanks", "daily"];

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
      return new Response(jsonKST({ ok: true, data: { notes: rows } }), {
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
  const moodRaw = String(body.mood || "calm").trim();
  const mood = MOODS.indexOf(moodRaw) >= 0 ? moodRaw : "calm";
  const isPublic = body.isPublic === undefined ? true : !!body.isPublic;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

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

      const [row] = await db
        .update(memorialFamilyNotes)
        .set(patch)
        .where(eq(memorialFamilyNotes.id, id))
        .returning();
      if (!row) return bad("해당 근황을 찾을 수 없습니다");
      return new Response(jsonKST({ ok: true, data: { note: row } }), {
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
        title, content, authorLabel, mood, isPublic, sortOrder,
        createdBy: guard.ctx?.uid ?? guard.ctx?.id ?? null,
      } as any)
      .returning();
    return new Response(jsonKST({ ok: true, data: { note: row } }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  } catch (err) { return jsonError("insert_note", err); }
}
