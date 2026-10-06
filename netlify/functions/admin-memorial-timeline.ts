// netlify/functions/admin-memorial-timeline.ts
// ★ 2026-10-07 정책국장 요청 — '우리가 함께 놓은 온기의 징검다리' 관리 (운영자)
//
// 협의회가 유가족 곁에서 해온 일·하고 있는 일·앞으로 할 일을 시간순으로 적는다.
// 날짜 · 날짜 표기(예: "2025년 봄") · 구분(예: 자조 모임) · 제목 · 요약 · 자세한 이야기 · 사진 · 링크.
//
//   GET                목록 (숨긴 것 포함)
//   POST               추가   { eventDate, dateLabel, category, title, summary, detail, imageBlobId, linkUrl, sortOrder, isPublic }
//   PATCH ?id=         수정   (준 것만 바뀐다)
//   DELETE ?id=        삭제
//
// 표가 아직 없으면(마이그 전) 어드민이 멈추지 않고 안내만 띄운다.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { jsonKST } from "../../lib/kst";
import { requireAdmin } from "../../lib/admin-guard";
import { rowsOf, timelineTableReady, TIMELINE_SELECT_COLS, shapeTimeline } from "../../lib/memorial-timeline";

export const config = { path: "/api/admin-memorial-timeline" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "징검다리 처리에 실패했습니다",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}
function bad(msg: string, status = 400) {
  return new Response(jsonKST({ ok: false, error: msg }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

/* 'YYYY-MM-DD' 만 받는다. 비우면 null (날짜 없이 표기만 쓸 수도 있다). 모양이 틀리면 undefined */
function parseDate(v: any): string | null | undefined {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

export default async function handler(req: Request, _ctx: Context) {
  const guard: any = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  if (!(await timelineTableReady())) {
    return new Response(jsonKST({
      ok: true,
      data: { items: [], ready: false },
      message: "저장소 준비가 아직 끝나지 않았습니다",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  /* ── 목록 ── */
  if (method === "GET") {
    try {
      const rows = rowsOf(await db.execute(sql`
        SELECT ${TIMELINE_SELECT_COLS} FROM memorial_timeline
         ORDER BY sort_order ASC, event_date ASC NULLS LAST, id ASC
      `));
      return new Response(jsonKST({ ok: true, data: { items: rows.map(shapeTimeline), ready: true } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("select_timeline", err);
    }
  }

  /* ── 추가 ── */
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const title = String(body.title || "").trim();
    if (!title) return bad("제목을 입력해 주세요");
    const eventDate = parseDate(body.eventDate);
    if (eventDate === undefined) return bad("날짜는 YYYY-MM-DD 형식으로 입력해 주세요");

    try {
      const rows = rowsOf(await db.execute(sql`
        INSERT INTO memorial_timeline
          (event_date, date_label, category, title, summary, detail, image_blob_id, link_url, sort_order, is_public, created_by)
        VALUES (
          ${eventDate}::date,
          ${String(body.dateLabel || "").trim().slice(0, 40) || null},
          ${String(body.category || "").trim().slice(0, 40) || null},
          ${title.slice(0, 150)},
          ${String(body.summary || "").trim() || null},
          ${String(body.detail || "").trim() || null},
          ${body.imageBlobId ? Number(body.imageBlobId) : null},
          ${String(body.linkUrl || "").trim().slice(0, 300) || null},
          ${Number(body.sortOrder || 0)},
          ${body.isPublic !== false},
          ${guard.ctx?.uid ?? guard.ctx?.id ?? null}
        )
        RETURNING ${TIMELINE_SELECT_COLS}
      `));
      return new Response(jsonKST({ ok: true, data: { item: shapeTimeline(rows[0]) }, message: "징검다리를 추가했습니다" }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("insert_timeline", err);
    }
  }

  /* ── 수정 ── */
  if (method === "PATCH") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) return bad("id 가 필요합니다");
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const hasDate = body.eventDate !== undefined;
    const eventDate = hasDate ? parseDate(body.eventDate) : null;
    if (hasDate && eventDate === undefined) return bad("날짜는 YYYY-MM-DD 형식으로 입력해 주세요");
    const title = body.title !== undefined ? String(body.title).trim().slice(0, 150) : null;
    if (body.title !== undefined && !title) return bad("제목을 입력해 주세요");

    try {
      const rows = rowsOf(await db.execute(sql`
        UPDATE memorial_timeline SET
          event_date    = ${hasDate ? sql`${eventDate}::date` : sql`event_date`},
          date_label    = ${body.dateLabel !== undefined ? (String(body.dateLabel).trim().slice(0, 40) || null) : sql`date_label`},
          category      = ${body.category !== undefined ? (String(body.category).trim().slice(0, 40) || null) : sql`category`},
          title         = COALESCE(${title}, title),
          summary       = ${body.summary !== undefined ? (String(body.summary).trim() || null) : sql`summary`},
          detail        = ${body.detail !== undefined ? (String(body.detail).trim() || null) : sql`detail`},
          image_blob_id = ${body.imageBlobId !== undefined
                             ? (body.imageBlobId ? Number(body.imageBlobId) : null)
                             : sql`image_blob_id`},
          link_url      = ${body.linkUrl !== undefined ? (String(body.linkUrl).trim().slice(0, 300) || null) : sql`link_url`},
          sort_order    = COALESCE(${body.sortOrder !== undefined ? Number(body.sortOrder) : null}, sort_order),
          is_public     = COALESCE(${body.isPublic !== undefined ? !!body.isPublic : null}, is_public),
          updated_at    = NOW()
        WHERE id = ${id}
        RETURNING ${TIMELINE_SELECT_COLS}
      `));
      if (!rows.length) return bad("존재하지 않는 항목입니다", 404);
      return new Response(jsonKST({ ok: true, data: { item: shapeTimeline(rows[0]) }, message: "수정되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("update_timeline", err);
    }
  }

  /* ── 삭제 ── */
  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) return bad("id 가 필요합니다");
    try {
      await db.execute(sql`DELETE FROM memorial_timeline WHERE id = ${id}`);
      return new Response(jsonKST({ ok: true, message: "삭제되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return jsonError("delete_timeline", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 방식입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
