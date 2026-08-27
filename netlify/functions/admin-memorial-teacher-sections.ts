/**
 * 선생님 화면 '자유 구간' 관리 (운영자)
 *
 * 정해진 칸 말고, 운영자가 원하는 만큼 구간을 직접 늘려 쓰는 자리다.
 * 제목 + 글 + 사진 한 장으로 이루어지고, 순서와 공개 여부를 정할 수 있다.
 *
 * 저장 칸을 직접 SQL로 다룬다 — 저장소가 아직 준비되지 않아도(마이그레이션 전)
 * 화면이 통째로 멈추지 않게 하기 위함이다(CLAUDE.md §9.1.1).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import type { Context } from "@netlify/functions";

export const config = { path: "/api/admin-memorial-teacher-sections" };

function rowsOf(r: any): any[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "자유 구간 처리에 실패했습니다",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

let _ready: boolean | null = null;
async function tableReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const t = rowsOf(await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'memorial_teacher_sections'
    `));
    _ready = t.length > 0;
  } catch {
    _ready = false;
  }
  return _ready;
}

function shape(r: any) {
  return {
    id: r.id,
    teacherId: r.teacher_id,
    title: r.title,
    body: r.body,
    imageBlobId: r.image_blob_id,
    imageUrl: r.image_blob_id ? `/api/blob-image?id=${r.image_blob_id}` : null,
    sortOrder: r.sort_order,
    isPublic: r.is_public,
  };
}

export default async function handler(req: Request, _ctx: Context) {
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  if (!(await tableReady())) {
    return new Response(jsonKST({
      ok: true,
      data: { sections: [], ready: false },
      message: "저장소 준비가 아직 끝나지 않았습니다",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  /* ── 목록 ── */
  if (method === "GET") {
    const teacherId = parseInt(url.searchParams.get("teacherId") || "0", 10);
    if (!teacherId) {
      return new Response(jsonKST({ ok: false, error: "선생님을 지정해 주세요" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const rows = rowsOf(await db.execute(sql`
        SELECT * FROM memorial_teacher_sections
         WHERE teacher_id = ${teacherId}
         ORDER BY sort_order ASC, id ASC
      `));
      return new Response(jsonKST({ ok: true, data: { sections: rows.map(shape), ready: true } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("select_sections", err);
    }
  }

  /* ── 추가 ── */
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const teacherId = Number(body.teacherId || 0);
    const title = String(body.title || "").trim();
    if (!teacherId) {
      return new Response(jsonKST({ ok: false, error: "선생님을 지정해 주세요" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (!title) {
      return new Response(jsonKST({ ok: false, error: "구간 제목을 입력해 주세요" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const rows = rowsOf(await db.execute(sql`
        INSERT INTO memorial_teacher_sections
          (teacher_id, title, body, image_blob_id, sort_order, is_public)
        VALUES (
          ${teacherId},
          ${title.slice(0, 120)},
          ${body.body ? String(body.body) : null},
          ${body.imageBlobId ? Number(body.imageBlobId) : null},
          ${Number(body.sortOrder || 0)},
          ${body.isPublic !== false}
        )
        RETURNING *
      `));
      return new Response(jsonKST({ ok: true, data: { section: shape(rows[0]) }, message: "구간을 추가했습니다" }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("insert_section", err);
    }
  }

  /* ── 수정 ── */
  if (method === "PATCH") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    try {
      const title = body.title !== undefined ? String(body.title).trim().slice(0, 120) : null;
      const rows = rowsOf(await db.execute(sql`
        UPDATE memorial_teacher_sections SET
          title         = COALESCE(${title}, title),
          body          = ${body.body !== undefined ? (body.body ? String(body.body) : null) : sql`body`},
          image_blob_id = ${body.imageBlobId !== undefined
                             ? (body.imageBlobId ? Number(body.imageBlobId) : null)
                             : sql`image_blob_id`},
          sort_order    = COALESCE(${body.sortOrder !== undefined ? Number(body.sortOrder) : null}, sort_order),
          is_public     = COALESCE(${body.isPublic !== undefined ? !!body.isPublic : null}, is_public),
          updated_at    = NOW()
        WHERE id = ${id}
        RETURNING *
      `));
      if (!rows.length) {
        return new Response(jsonKST({ ok: false, error: "존재하지 않는 구간입니다" }), {
          status: 404, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(jsonKST({ ok: true, data: { section: shape(rows[0]) }, message: "수정되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("update_section", err);
    }
  }

  /* ── 삭제 ── */
  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      await db.execute(sql`DELETE FROM memorial_teacher_sections WHERE id = ${id}`);
      return new Response(jsonKST({ ok: true, message: "삭제되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("delete_section", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 방식입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
