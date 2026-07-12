/**
 * /api/admin-user-preferences
 *
 * 운영자 본인 개인 설정
 *  Phase 21 R3: 부재 토글
 *  Phase 21 R4: defaultWbsView 추가
 *
 *  GET           : 본인 설정 전체 (부재 상태 + defaultWbsView)
 *  POST          : 부재 예약 { outOfOfficeStart, outOfOfficeEnd, outOfOfficeNote? }
 *                  또는 WBS 기본 보기 { defaultWbsView: 'board'|'list'|'calendar' }
 *  DELETE        : 부재 즉시 해제
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/admin-user-preferences" };

function jsonError(status: number, error: string, step?: string, err?: any) {
  return new Response(jsonKST({
    ok: false, error, step,
    detail: err ? String(err?.message || err).slice(0, 500) : undefined,
    stack:  err?.stack ? String(err.stack).slice(0, 1000) : undefined,
  }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function jsonOk(data: any, message?: string) {
  return new Response(jsonKST({ ok: true, message: message ?? null, data }),
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

      // Phase 21 R4 — defaultWbsView (마이그 후 컬럼 존재 시 읽기)
      let defaultWbsView = "board";
      try {
        const wbsRes: any = await db.execute(sql`
          SELECT COALESCE(default_wbs_view, 'board') AS default_wbs_view
          FROM members WHERE id = ${meId} LIMIT 1
        `);
        const wbsRow = Array.isArray(wbsRes) ? wbsRes[0] : (wbsRes as any).rows?.[0];
        if (wbsRow?.default_wbs_view) defaultWbsView = wbsRow.default_wbs_view;
      } catch { /* 컬럼 미생성 시 기본값 board */ }

      return jsonOk({
        outOfOffice: currentlyOut,
        outOfOfficeFlag: Boolean(row?.flag),
        outOfOfficeStart: startStr,
        outOfOfficeEnd:   endStr,
        outOfOfficeNote:  row?.note ?? null,
        defaultWbsView,
      });
    }

    /* ───── POST — 부재 예약 또는 defaultWbsView 갱신 ───── */
    if (req.method === "POST") {
      step = "post_parse";
      let body: any;
      try { body = await req.json(); } catch { return jsonError(400, "JSON 본문 파싱 실패", step); }

      // Phase 21 R4 — defaultWbsView 갱신 (부재와 분리)
      if (body?.defaultWbsView !== undefined) {
        step = "post_wbs_view";
        const allowed = ["board", "list", "calendar"];
        const view = String(body.defaultWbsView);
        if (!allowed.includes(view)) {
          return jsonError(400, "defaultWbsView는 board / list / calendar 중 하나만 허용됩니다", step);
        }
        try {
          await db.execute(sql`
            UPDATE members SET default_wbs_view = ${view} WHERE id = ${meId}
          `);
        } catch { /* 컬럼 미생성 시 무시 */ }
        return jsonOk({ defaultWbsView: view }, "기본 보기 모드 저장됐어요");
      }

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
