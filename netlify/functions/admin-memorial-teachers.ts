import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialTeachers, memorialOfferings, memorialMessages, memorialLetters } from "../../db/schema";
import { eq, asc, sql } from "drizzle-orm";

export const config = { path: "/api/admin-memorial-teachers" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "선생님 관리 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

/* 빈 문자열 → null (DATE 컬럼 보호) */
function dateOrNull(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function withPhotoUrl(t: any) {
  return { ...t, photoUrl: t.photoBlobId ? `/api/blob-image?id=${t.photoBlobId}` : null };
}

export default async function handler(req: Request, _ctx: Context) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;
  const admin = (guard as { ok: true; ctx: import("../../lib/admin-guard").AdminContext }).ctx.admin;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  /* ── GET: 전체 목록 (비공개 포함) ── */
  if (method === "GET") {
    try {
      const rows = await db
        .select()
        .from(memorialTeachers)
        .orderBy(asc(memorialTeachers.sortOrder), asc(memorialTeachers.id));
      return new Response(jsonKST({ ok: true, data: { teachers: rows.map(withPhotoUrl) } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_teachers", err);
    }
  }

  /* ── POST: 생성 ── */
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const name = (body.name || "").toString().trim();
    if (!name) {
      return new Response(jsonKST({ ok: false, error: "성함은 필수입니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const insertData: any = {
        name,
        photoBlobId:  body.photoBlobId ? Number(body.photoBlobId) : undefined,
        schoolRegion: body.schoolRegion || undefined,
        birthDate:    dateOrNull(body.birthDate) ?? undefined,
        deathDate:    dateOrNull(body.deathDate) ?? undefined,
        tributeLine:  body.tributeLine || undefined,
        bioHtml:      body.bioHtml || undefined,
        timeline:     Array.isArray(body.timeline) ? body.timeline : undefined,
        isPublic:     body.isPublic !== undefined ? !!body.isPublic : undefined,
        sortOrder:    body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
        createdBy:    admin.uid,
      };
      const [row] = await db.insert(memorialTeachers).values(insertData).returning();

      return new Response(jsonKST({ ok: true, data: { teacher: withPhotoUrl(row) }, message: "저장되었습니다" }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("insert_teacher", err);
    }
  }

  /* ── PATCH: 수정 ── */
  if (method === "PATCH") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const existing = await db.select().from(memorialTeachers).where(eq(memorialTeachers.id, id)).limit(1);
      if (!existing.length) {
        return new Response(jsonKST({ ok: false, error: "존재하지 않는 선생님입니다" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (body.name !== undefined)         updates.name = String(body.name).trim();
      if (body.photoBlobId !== undefined)  updates.photoBlobId = body.photoBlobId ? Number(body.photoBlobId) : null;
      if (body.schoolRegion !== undefined) updates.schoolRegion = body.schoolRegion || null;
      if (body.birthDate !== undefined)    updates.birthDate = dateOrNull(body.birthDate);
      if (body.deathDate !== undefined)    updates.deathDate = dateOrNull(body.deathDate);
      if (body.tributeLine !== undefined)  updates.tributeLine = body.tributeLine || null;
      if (body.bioHtml !== undefined)      updates.bioHtml = body.bioHtml || null;
      if (body.timeline !== undefined)     updates.timeline = Array.isArray(body.timeline) ? body.timeline : [];
      if (body.isPublic !== undefined)     updates.isPublic = !!body.isPublic;
      if (body.sortOrder !== undefined)    updates.sortOrder = Number(body.sortOrder);

      const [row] = await db.update(memorialTeachers).set(updates).where(eq(memorialTeachers.id, id)).returning();

      return new Response(jsonKST({ ok: true, data: { teacher: withPhotoUrl(row) }, message: "수정되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("update_teacher", err);
    }
  }

  /* ── DELETE ── */
  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      // AD-030: 선생님 삭제 시 자식(헌화·방명록·편지·좋아요)을 함께 정리 — FK가 없어 고아로 남던 문제 해소
      // ('함께 정리됩니다' 안내가 실제로 동작하도록). 트랜잭션으로 원자 처리.
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM memorial_message_likes WHERE message_id IN (SELECT id FROM memorial_messages WHERE teacher_id = ${id})`);
        await tx.delete(memorialMessages).where(eq(memorialMessages.teacherId, id));
        await tx.delete(memorialLetters).where(eq(memorialLetters.teacherId, id));
        await tx.delete(memorialOfferings).where(eq(memorialOfferings.teacherId, id));
        await tx.delete(memorialTeachers).where(eq(memorialTeachers.id, id));
      });
      return new Response(jsonKST({ ok: true, message: "선생님과 관련 헌화·방명록·편지를 모두 삭제했습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("delete_teacher", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
