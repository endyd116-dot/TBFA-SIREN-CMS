/**
 * /api/admin-user-preferences
 *
 * 운영자 본인 개인 설정 — Phase 21 R3: 부재 토글.
 *
 *  GET           : 본인의 out_of_office_* 상태 (오늘 기준 자동 계산도 동봉)
 *  POST          : 부재 예약 등록·수정 { outOfOfficeStart, outOfOfficeEnd, outOfOfficeNote? }
 *  DELETE        : 즉시 해제 (start/end/note null + flag false)
 */
import type { Context } from "@netlify/functions";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-user-preferences" };

function jsonError(status: number, error: string, step?: string, err?: any) {
  return new Response(JSON.stringify({
    ok: false, error, step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack:  err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function jsonOk(data: any, message?: string) {
  return new Response(JSON.stringify({ ok: true, message: message ?? null, data }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function isWithinRange(start: any, end: any): boolean {
  if (!start || !end) return false;
  const today = new Date();
  const s = new Date(start);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  return today >= s && today <= e;
}

function parseDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export default async (req: Request, _ctx: Context) => {
  let step = "auth";
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const meId = guard.ctx.member.id as number;

    /* ───── GET ───── */
    if (req.method === "GET") {
      step = "select_prefs";
      const res: any = await db.execute(sql`
        SELECT
          COALESCE(out_of_office, FALSE) AS flag,
          out_of_office_start AS start_date,
          out_of_office_end   AS end_date,
          out_of_office_note  AS note
        FROM members
        WHERE id = ${meId}
        LIMIT 1
      `);
      const row = Array.isArray(res) ? res[0] : (res as any).rows?.[0];
      const startStr = row?.start_date ? String(row.start_date).slice(0, 10) : null;
      const endStr   = row?.end_date   ? String(row.end_date).slice(0, 10)   : null;
      const currentlyOut = Boolean(row?.flag) || isWithinRange(row?.start_date, row?.end_date);
      return jsonOk({
        outOfOffice: currentlyOut,
        outOfOfficeFlag: Boolean(row?.flag),
        outOfOfficeStart: startStr,
        outOfOfficeEnd:   endStr,
        outOfOfficeNote:  row?.note ?? null,
      });
    }

    /* ───── POST — 예약 등록·수정 ───── */
    if (req.method === "POST") {
      step = "post_parse";
      let body: any;
      try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }

      const startStr = parseDate(body?.outOfOfficeStart);
      const endStr   = parseDate(body?.outOfOfficeEnd);
      const note = typeof body?.outOfOfficeNote === "string" ? body.outOfOfficeNote.trim().slice(0, 500) : null;

      step = "post_validate";
      if (!startStr || !endStr) return jsonError(400, "outOfOfficeStart, outOfOfficeEnd 필수 (YYYY-MM-DD)", step);
      if (startStr > endStr) return jsonError(400, "종료일이 시작일보다 빠릅니다", step);

      step = "post_update";
      const flag = isWithinRange(startStr, endStr);
      await db.execute(sql`
        UPDATE members
        SET out_of_office       = ${flag},
            out_of_office_start = ${startStr}::date,
            out_of_office_end   = ${endStr}::date,
            out_of_office_note  = ${note}
        WHERE id = ${meId}
      `);
      return jsonOk({
        outOfOffice: flag,
        outOfOfficeStart: startStr,
        outOfOfficeEnd: endStr,
        outOfOfficeNote: note,
      }, `${startStr} ~ ${endStr} 부재 예약`);
    }

    /* ───── DELETE — 즉시 해제 ───── */
    if (req.method === "DELETE") {
      step = "delete_clear";
      await db.execute(sql`
        UPDATE members
        SET out_of_office       = FALSE,
            out_of_office_start = NULL,
            out_of_office_end   = NULL,
            out_of_office_note  = NULL
        WHERE id = ${meId}
      `);
      return jsonOk({ outOfOffice: false }, "근무 상태로 돌아왔어요");
    }

    return jsonError(405, "허용되지 않은 메서드", "method");
  } catch (err: any) {
    console.error("[admin-user-preferences] error:", err);
    return jsonError(500, "개인 설정 처리 중 오류", step, err);
  }
};
