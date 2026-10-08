import { yearKST, jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attHolidays } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { determineStatus, getDefaultPolicy, getFlexRangeMins } from "../../lib/att-utils";

export const config = { path: "/api/admin-att-holidays" };

function jsonOk(data: unknown, status = 200) {
  return new Response(jsonKST({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "공휴일 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

/* ── 공휴일 설정 ↔ 근태 기록 상태 동기화 (2026-10-08) ──
   출근을 찍는 순간 그날이 공휴일이면 근태 기록에 'HOLIDAY' 상태가 찍힌다. 그래서 공휴일을
   나중에 추가·삭제하면 이미 찍힌 기록의 상태가 설정과 어긋난 채 남는다.
   급여 계산(lib/payroll-calc.ts)은 설정표만 보도록 고쳤지만, 근태 현황·만근 판정·내보내기가
   같은 상태값을 읽으므로 여기서 설정과 기록을 함께 맞춘다.
   (실측 2026-09-28: 잘못 등록된 '추석 대체공휴일'을 지워도 그날 8시간 근무가 계속 미지급) */

/** 공휴일 등록 뒤 — 그날 이미 찍힌 출근·결근 기록을 '공휴일'로 표시 (출근 당시 판정과 같은 규칙) */
async function stampHolidayOnRecords(date: string): Promise<number> {
  const r = await db.execute(sql`
    UPDATE att_records SET status = 'HOLIDAY', updated_at = NOW()
    WHERE date = ${date}::date
      AND status IN ('NORMAL','LATE','EARLY_LEAVE','PARTIAL_LEAVE','ABSENT')
    RETURNING id
  `);
  return rowsOf(r).length;
}

/** 공휴일 삭제 뒤 — 그날 '공휴일'로 찍힌 기록을 보통 날 기준으로 다시 판정한다.
 *  승인 휴가(전일) → LEAVE · 반차 → PARTIAL_LEAVE · 그 밖엔 출퇴근 시각으로 정상/지각/조퇴 · 출근 없음 → ABSENT */
async function rejudgeHolidayRecords(date: string): Promise<{
  count: number;
  changes: Array<{ id: number; memberUid: string; status: string }>;
}> {
  const recs = rowsOf(await db.execute(sql`
    SELECT id, member_uid, work_mode,
           to_char(check_in_time,  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS check_in_iso,
           to_char(check_out_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS check_out_iso
    FROM att_records
    WHERE date = ${date}::date AND status = 'HOLIDAY'
    ORDER BY id
  `));
  if (!recs.length) return { count: 0, changes: [] };

  const policy = await getDefaultPolicy();
  const flexRangeMins = policy?.flexEnabled ? await getFlexRangeMins() : undefined;

  /* 그날 승인 휴가 — 회원별 (전일 휴가가 반차보다 우선) */
  const leaveHalfByMember = new Map<string, boolean>();
  for (const l of rowsOf(await db.execute(sql`
    SELECT member_uid, is_half_day FROM att_leave_requests
    WHERE status = 'APPROVED' AND start_date <= ${date}::date AND end_date >= ${date}::date
  `))) {
    const uid = String(l.member_uid);
    const half = l.is_half_day === true;
    if (!leaveHalfByMember.has(uid) || !half) leaveHalfByMember.set(uid, half);
  }

  const changes: Array<{ id: number; memberUid: string; status: string }> = [];
  for (const rec of recs) {
    const uid = String(rec.member_uid);
    const checkIn = rec.check_in_iso ? new Date(rec.check_in_iso) : null;
    const checkOut = rec.check_out_iso ? new Date(rec.check_out_iso) : null;
    let next: string;
    if (leaveHalfByMember.has(uid)) {
      next = leaveHalfByMember.get(uid) ? "PARTIAL_LEAVE" : "LEAVE";
    } else if (!policy) {
      next = checkIn ? "NORMAL" : "ABSENT";
    } else {
      next = determineStatus(checkIn, checkOut, {
        checkInTime:         String(policy.checkInTime),
        checkOutTime:        String(policy.checkOutTime),
        lateGraceMins:       policy.lateGraceMins,
        earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
        coreStartTime:       policy.coreStartTime ? String(policy.coreStartTime) : null,
        coreEndTime:         policy.coreEndTime   ? String(policy.coreEndTime)   : null,
        flexEnabled:         policy.flexEnabled,
        flexRangeMins,
      }, false, false, rec.work_mode ?? undefined);
    }
    await db.execute(sql`
      UPDATE att_records SET status = ${next}, updated_at = NOW() WHERE id = ${Number(rec.id)}
    `);
    changes.push({ id: Number(rec.id), memberUid: uid, status: next });
  }
  return { count: changes.length, changes };
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  // P2-39 fix: 조회(GET)는 근태 설정 권한(att_config) 국장 허용, 변경(POST/PUT/DELETE)은 이사장(super_admin) 전용.
  //            (권한정책 카탈로그 att_config adminDefault·설정 라벨 '저장은 이사장 전용'과 일치)
  const _role = (auth as any).ctx.member.role ?? "";
  if (req.method === "GET"
        ? !(_role === "super_admin" || await canAccess(_role, "att_config"))
        : _role !== "super_admin") {
    return new Response(jsonKST({ ok: false, error: req.method === "GET" ? "근태 설정 조회 권한이 없습니다" : "슈퍼어드민 전용" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const method = req.method;
  const url = new URL(req.url);

  // GET — 연도별 목록 (?year=)
  if (method === "GET") {
    const year = url.searchParams.get("year") ?? yearKST().toString();
    try {
      const rows = await db.execute(sql`
        SELECT * FROM att_holidays
        WHERE EXTRACT(YEAR FROM date) = ${Number(year)}
        ORDER BY date
      `);
      return jsonOk(rowsOf(rows));
    } catch (err) {
      return jsonError("select_holidays", err);
    }
  }

  // POST — 등록 (+ 그날 이미 찍힌 근태 기록을 공휴일로 표시)
  if (method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const { date, name, type } = body;
    if (!date || !name) {
      return jsonError("validate", new Error("date, name 필수"), 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return jsonError("validate_date", new Error("date 는 YYYY-MM-DD 형식"), 400);
    }

    let row: any;
    try {
      [row] = await db.insert(attHolidays).values({
        date,
        name,
        type: type ?? "PUBLIC",
      } as any).returning();
    } catch (err) {
      if (String(err).includes("unique")) {
        return jsonError("duplicate", new Error("해당 날짜에 이미 공휴일 등록됨"), 409);
      }
      return jsonError("insert_holiday", err);
    }

    /* 보조 — 표시 갱신이 실패해도 등록 자체는 성공으로 돌려주되 사유를 함께 싣는다 */
    let stamped = 0;
    let stampError: string | null = null;
    try {
      stamped = await stampHolidayOnRecords(String(date));
    } catch (err: any) {
      stampError = String(err?.message ?? err).slice(0, 300);
      console.warn("[admin-att-holidays] 공휴일 표시 갱신 실패:", stampError);
    }
    return jsonOk({ ...row, stamped, stampError }, 201);
  }

  // DELETE — 삭제 (?id=) (+ 그날 '공휴일'로 찍힌 근태 기록을 평일 기준으로 재판정)
  if (method === "DELETE") {
    const id = Number(url.searchParams.get("id"));
    if (!id) return jsonError("validate_id", new Error("id 필수"), 400);

    let date: string | null = null;
    try {
      const found = rowsOf(await db.execute(sql`
        SELECT to_char(date, 'YYYY-MM-DD') AS d FROM att_holidays WHERE id = ${id} LIMIT 1
      `));
      date = found[0]?.d ?? null;
      await db.delete(attHolidays).where(eq(attHolidays.id, id));
    } catch (err) {
      return jsonError("delete_holiday", err);
    }

    /* 보조 — 재판정이 실패해도 삭제 자체는 성공으로 돌려주되 사유를 함께 싣는다 */
    let rejudged: { count: number; changes: Array<{ id: number; memberUid: string; status: string }> } = { count: 0, changes: [] };
    let rejudgeError: string | null = null;
    if (date) {
      try {
        rejudged = await rejudgeHolidayRecords(date);
      } catch (err: any) {
        rejudgeError = String(err?.message ?? err).slice(0, 300);
        console.warn("[admin-att-holidays] 근태 기록 재판정 실패:", rejudgeError);
      }
    }
    return jsonOk({ deleted: id, date, rejudged: rejudged.count, changes: rejudged.changes, rejudgeError });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
