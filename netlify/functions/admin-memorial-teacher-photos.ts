// netlify/functions/admin-memorial-teacher-photos.ts
// ★ 2026-08-28 추모관 v2 — 선생님의 생전 순간(사진) 관리
//
// 고인·유가족의 사진이라 아무나 올릴 수 없다. 운영자만 등록한다(Swain A안).
// 사진 파일 자체는 기존 업로드 경로(/api/blob-upload)를 그대로 쓰고,
// 여기서는 그 번호(blobId)와 설명만 관리한다.
//
//   GET  ?teacherId=          목록 (숨긴 것 포함)
//   POST ?teacherId=          등록  { blobId, caption, detail, takenLabel, sortOrder, isPublic }
//   POST ?action=update&id=   수정  (준 것만 바뀐다)
//   POST ?action=delete&id=   삭제

import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialTeacherPhotos } from "../../db/schema";
import { eq, asc } from "drizzle-orm";
import { jsonKST } from "../../lib/kst";

export const config = { path: "/api/admin-memorial-teacher-photos" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "선생님 사진 처리 실패",
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
  const teacherId = parseInt(url.searchParams.get("teacherId") || "0", 10);
  const action = (url.searchParams.get("action") || "create").trim();
  const id = parseInt(url.searchParams.get("id") || "0", 10);

  /* ───────── 목록 ───────── */
  if (method === "GET") {
    if (!teacherId) return bad("teacherId가 필요합니다");
    try {
      const rows = await db
        .select()
        .from(memorialTeacherPhotos)
        .where(eq(memorialTeacherPhotos.teacherId, teacherId))
        .orderBy(asc(memorialTeacherPhotos.sortOrder), asc(memorialTeacherPhotos.id));
      return new Response(jsonKST({ ok: true, data: { photos: rows } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) { return jsonError("select_photos", err); }
  }

  if (method !== "POST") {
    return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  /* ───────── 삭제 ───────── */
  if (action === "delete") {
    if (!id) return bad("id가 필요합니다");
    try {
      await db.delete(memorialTeacherPhotos).where(eq(memorialTeacherPhotos.id, id));
      return new Response(jsonKST({ ok: true, data: { deleted: id } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) { return jsonError("delete_photo", err); }
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const caption = String(body.caption || "").trim();
  const detail = String(body.detail || "").trim() || null;
  const takenLabel = String(body.takenLabel || "").trim() || null;
  const blobId = Number.isFinite(Number(body.blobId)) && Number(body.blobId) > 0 ? Number(body.blobId) : null;
  const isPublic = body.isPublic === undefined ? true : !!body.isPublic;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;

  /* ───────── 수정 ───────── */
  if (action === "update") {
    if (!id) return bad("id가 필요합니다");
    try {
      const patch: any = { updatedAt: new Date() };
      if (caption) patch.caption = caption;
      if (body.detail !== undefined) patch.detail = detail;
      if (body.takenLabel !== undefined) patch.takenLabel = takenLabel;
      if (body.blobId !== undefined) patch.blobId = blobId;
      if (body.isPublic !== undefined) patch.isPublic = isPublic;
      if (body.sortOrder !== undefined) patch.sortOrder = sortOrder;

      const [row] = await db
        .update(memorialTeacherPhotos)
        .set(patch)
        .where(eq(memorialTeacherPhotos.id, id))
        .returning();
      if (!row) return bad("해당 사진을 찾을 수 없습니다");
      return new Response(jsonKST({ ok: true, data: { photo: row } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) { return jsonError("update_photo", err); }
  }

  /* ───────── 등록 ───────── */
  if (!teacherId) return bad("teacherId가 필요합니다");
  if (!caption) return bad("사진 설명(한 줄)을 입력해 주세요");
  if (!blobId) return bad("사진을 먼저 올려주세요");

  try {
    const [row] = await db
      .insert(memorialTeacherPhotos)
      .values({
        teacherId, blobId, caption, detail, takenLabel, isPublic, sortOrder,
        createdBy: guard.ctx?.uid ?? guard.ctx?.id ?? null,
      } as any)
      .returning();
    return new Response(jsonKST({ ok: true, data: { photo: row } }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  } catch (err) { return jsonError("insert_photo", err); }
}
