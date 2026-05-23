/**
 * /api/admin-att-record-edit — 어드민이 직원 출퇴근 기록을 직접 수정
 *
 * R39 Stage 7 A-2.
 *
 * PATCH body:
 *   { recordId, checkInTime?, checkOutTime?, workMode?, note?, reason }
 *   reason 필수 — att_record_admin_edits에 이력 적재.
 *
 * 정책:
 *   - R35 H-G2 호환: 출근 시각 보존 정책은 자동 보정·재계산에만 적용.
 *     어드민의 명시적 직접 수정은 그 정책을 우회 (의도된 수정).
 *   - is_manually_adjusted = TRUE 자동 마킹.
 *   - 변경 안 한 필드는 그대로 (PATCH 의미).
 *
 * 응답: { ok:true, data: { record, edit } }
 */
import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getDefaultPolicy, calcWorkingMins } from "../../lib/att-utils";

export const config = { path: "/api/admin-att-record-edit" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: JSON_HEADER });
}
function jsonErr(error: string, status = 400, detail?: string) {
  return new Response(
    JSON.stringify({ ok: false, error, ...(detail ? { detail } : {}) }),
    { status, headers: JSON_HEADER },
  );
}
function jsonStepErr(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "출퇴근 직접 수정 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 800),
  }), { status: 500, headers: JSON_HEADER });
}

function parseTs(v: any): string | null | undefined {
  // undefined = 변경 안 함, null = NULL로 클리어, 문자열 = 새 값
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  // YYYY-MM-DDTHH:MM 또는 ISO 형식 허용
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error("시각 형식이 잘못되었습니다 (ISO 또는 YYYY-MM-DDTHH:MM): " + v);
  return d.toISOString();
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "PATCH") {
    return jsonErr("PATCH만 지원합니다", 405);
  }

  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  if ((auth as any).ctx.member.role !== "super_admin") {
    return jsonErr("슈퍼어드민 전용", 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonErr("요청 본문 파싱 실패", 400); }

  const recordId = Number(body.recordId);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!recordId || !Number.isFinite(recordId)) return jsonErr("recordId 필수", 400);
  if (!reason) return jsonErr("사유(reason) 필수 — 어드민 수정 시 감사 추적용", 400);

  // 입력 정규화
  let newCheckIn: string | null | undefined, newCheckOut: string | null | undefined;
  try {
    newCheckIn  = parseTs(body.checkInTime);
    newCheckOut = parseTs(body.checkOutTime);
  } catch (e: any) {
    return jsonErr(e.message || "시각 형식 오류", 400);
  }
  const newWorkMode: string | null | undefined =
    body.workMode === undefined ? undefined : (body.workMode === null || body.workMode === "" ? null : String(body.workMode));
  const newNote: string | null | undefined =
    body.note === undefined ? undefined : (body.note === null ? null : String(body.note));

  if (newCheckIn === undefined && newCheckOut === undefined && newWorkMode === undefined && newNote === undefined) {
    return jsonErr("변경할 필드가 없습니다", 400);
  }

  /* 1) 기존 record 조회 */
  let old: any;
  try {
    const r = await db.execute(sql`
      SELECT id, member_uid, date,
             check_in_time, check_out_time, work_mode, note,
             status, working_mins, overtime_mins
      FROM att_records WHERE id = ${recordId} LIMIT 1
    `);
    old = (((r as any).rows ?? r) as any[])[0];
    if (!old) return jsonErr("해당 출퇴근 기록을 찾을 수 없습니다", 404);
  } catch (err) {
    return jsonStepErr("select_old", err);
  }

  /* ★ fix: 출퇴근 시각을 수정하면 업무시간(working_mins)·야근시간(overtime_mins)도 재계산.
     (기존엔 시각만 바꾸고 파생 시간은 그대로라 표에 반영 안 됐음) — 양쪽 시각이 다 있을 때만. */
  let recalcWorkingMins: number | undefined;
  let recalcOvertimeMins: number | undefined;
  if (newCheckIn !== undefined || newCheckOut !== undefined) {
    const effIn  = newCheckIn  !== undefined ? newCheckIn  : (old.check_in_time  ? new Date(old.check_in_time).toISOString()  : null);
    const effOut = newCheckOut !== undefined ? newCheckOut : (old.check_out_time ? new Date(old.check_out_time).toISOString() : null);
    if (effIn && effOut) {
      try {
        const policy = await getDefaultPolicy();
        if (policy) {
          const r = calcWorkingMins(new Date(effIn), new Date(effOut), {
            dailyHours: Number(policy.dailyHours),
            breakMins: policy.breakMins,
            breakThresholdHours: Number(policy.breakThresholdHours),
          });
          recalcWorkingMins = r.workingMins;
          recalcOvertimeMins = r.overtimeMins;
        }
      } catch (e) {
        console.warn("[admin-att-record-edit] 근무시간 재계산 실패(무시):", e);
      }
    }
  }

  /* 2) UPDATE — 변경 필드만 SET, 미변경 필드는 그대로 (안전한 sql 템플릿 합성) */
  try {
    /* 동적 SET 합성 — sql.raw(values) 사용 금지·모든 값 파라미터 바인딩 */
    let setExpr = sql`is_manually_adjusted = TRUE, updated_at = now()`;
    if (newCheckIn !== undefined) {
      setExpr = sql`${setExpr}, check_in_time = ${newCheckIn}::timestamp`;
    }
    if (newCheckOut !== undefined) {
      setExpr = sql`${setExpr}, check_out_time = ${newCheckOut}::timestamp`;
    }
    if (newWorkMode !== undefined) {
      setExpr = sql`${setExpr}, work_mode = ${newWorkMode}`;
    }
    if (newNote !== undefined) {
      setExpr = sql`${setExpr}, note = ${newNote}`;
    }
    if (recalcWorkingMins !== undefined) {
      setExpr = sql`${setExpr}, working_mins = ${recalcWorkingMins}`;
    }
    if (recalcOvertimeMins !== undefined) {
      setExpr = sql`${setExpr}, overtime_mins = ${recalcOvertimeMins}`;
    }

    const updRes = await db.execute(sql`
      UPDATE att_records SET ${setExpr}
      WHERE id = ${recordId}
      RETURNING id, member_uid, date,
                check_in_time, check_out_time, work_mode, note,
                status, working_mins, overtime_mins, is_manually_adjusted, device_type
    `);
    const updated = (((updRes as any).rows ?? updRes) as any[])[0];

    /* 3) 이력 적재 — 변경된 필드만 old/new 기록 (값은 모두 파라미터 바인딩) */
    let editRow: any = null;
    try {
      const adminUid = String((auth as any).ctx.member.id);
      const oldCi: string | null = newCheckIn  !== undefined && old.check_in_time  ? new Date(old.check_in_time).toISOString()  : null;
      const oldCo: string | null = newCheckOut !== undefined && old.check_out_time ? new Date(old.check_out_time).toISOString() : null;
      const oldWm: string | null = newWorkMode !== undefined ? (old.work_mode || null) : null;
      const newCi: string | null = newCheckIn  !== undefined && newCheckIn  ? newCheckIn  : null;
      const newCo: string | null = newCheckOut !== undefined && newCheckOut ? newCheckOut : null;
      const newWm: string | null = newWorkMode !== undefined ? (newWorkMode || null) : null;
      const ins = await db.execute(sql`
        INSERT INTO att_record_admin_edits
          (record_id, edited_by, old_check_in, old_check_out, old_work_mode,
           new_check_in, new_check_out, new_work_mode, reason)
        VALUES
          (${recordId}, ${adminUid},
           ${oldCi}::timestamp, ${oldCo}::timestamp, ${oldWm},
           ${newCi}::timestamp, ${newCo}::timestamp, ${newWm},
           ${reason})
        RETURNING id, created_at
      `);
      editRow = (((ins as any).rows ?? ins) as any[])[0];
    } catch (e) {
      console.warn("[admin-att-record-edit] 이력 적재 실패:", e);
    }

    return jsonOk({ record: updated, edit: editRow });
  } catch (err) {
    return jsonStepErr("update", err);
  }
}
