/**
 * POST /api/att-session-edit
 * 직원 본인이 업무시간 내에 오늘 출퇴근 시각을 셀프 수정.
 *  body: { checkIn: "HH:MM"?, checkOut: "HH:MM"? }  (오늘 날짜 기준·KST)
 *  - 첫 세션의 출근 시각·마지막 세션의 퇴근 시각을 조정
 *  - 업무시간(정책 표준 출퇴근 시각) 외에는 거부 (어드민 정정 안내)
 *  - 요약(checkInTime·checkOutTime·workingMins) 재계산 + isManuallyAdjusted 표시
 */
import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attRecords } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { getDefaultPolicy, determineStatus, todayKST, getFlexRangeMins, flexStartFloor } from "../../lib/att-utils";
import { normalizeSessions, recomputeSummary, isWithinWorkHours, type AttSession } from "../../lib/att-session";

export const config = { path: "/api/att-session-edit" };

function jsonOk(data: unknown) {
  return new Response(jsonKST({ ok: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(jsonKST({
    ok: false, error: "시각 수정 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
  }), { status, headers: { "Content-Type": "application/json" } });
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const checkIn: string = typeof body.checkIn === "string" ? body.checkIn.trim() : "";
  const checkOut: string = typeof body.checkOut === "string" ? body.checkOut.trim() : "";
  if (!checkIn && !checkOut) return jsonError("validate", new Error("수정할 출근 또는 퇴근 시각을 입력하세요"), 400);
  if (checkIn && !HHMM.test(checkIn)) return jsonError("validate", new Error("출근 시각 형식 오류 (HH:MM)"), 400);
  if (checkOut && !HHMM.test(checkOut)) return jsonError("validate", new Error("퇴근 시각 형식 오류 (HH:MM)"), 400);

  const memberUid = String(auth.ctx.member.id);
  const today = todayKST();
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);

  const policy = await getDefaultPolicy();
  if (!policy) return jsonError("no_policy", new Error("근무 정책 없음"), 500);

  // 업무시간 외에는 셀프 수정 불가
  if (!isWithinWorkHours(String(policy.checkInTime), String(policy.checkOutTime), nowKst)) {
    return jsonError("after_hours", new Error("업무시간이 지나 시각 셀프 수정은 불가합니다. 어드민에게 정정을 요청하세요."), 400);
  }

  let existing: any;
  try {
    const rows = await db.select().from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today))).limit(1);
    existing = rows[0];
  } catch (err) { return jsonError("select_record", err); }
  if (!existing) return jsonError("no_record", new Error("오늘 출퇴근 기록이 없습니다"), 400);

  const sessions = normalizeSessions(existing);
  if (sessions.length === 0) return jsonError("no_session", new Error("출근 기록이 없습니다"), 400);

  const toISO = (hhmm: string) => new Date(`${today}T${hhmm}:00+09:00`).toISOString();
  const ns: AttSession[] = sessions.slice();
  if (checkIn) ns[0] = { ...ns[0], in: toISO(checkIn) };
  if (checkOut) {
    const last = ns.length - 1;
    if (!ns[last].out) return jsonError("not_checked_out", new Error("아직 퇴근 전이라 퇴근 시각을 수정할 수 없습니다. 먼저 퇴근하거나 출근 시각만 수정하세요."), 400);
    ns[last] = { ...ns[last], out: toISO(checkOut) };
  }

  // 검증: 각 세션 in < out
  for (const s of ns) {
    if (s.out && new Date(s.in).getTime() >= new Date(s.out).getTime()) {
      return jsonError("order", new Error("출근 시각이 퇴근 시각보다 늦을 수 없습니다"), 400);
    }
  }

  /* 2026-07-09 유연근무 출근 하한(floor) — OFFICE + 유연근무만. 하한 이전 출근은 근무·야근 미산입. */
  let minStart: Date | null = null;
  let flexRangeMins: number | undefined = undefined;
  if (policy.flexEnabled && ns.length && ns[0].in) {   // 2026-07-10: 전 근무형태 하한 적용
    try {
      flexRangeMins = await getFlexRangeMins();
      minStart = flexStartFloor(new Date(ns[0].in), String(policy.checkInTime), flexRangeMins);
    } catch (e) { console.warn("[att-session-edit] 유연 하한 계산 실패:", e); }
  }

  const summary = recomputeSummary(ns, {
    dailyHours: policy.dailyHours, breakMins: policy.breakMins, breakThresholdHours: policy.breakThresholdHours,
  }, minStart);
  const checkInForStatus = summary.checkInTime ?? new Date(existing.checkInTime ?? Date.now());
  const computedStatus = determineStatus(checkInForStatus, summary.checkOutTime, {
    checkInTime: String(policy.checkInTime), checkOutTime: String(policy.checkOutTime),
    lateGraceMins: policy.lateGraceMins, earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
    coreStartTime: policy.coreStartTime ? String(policy.coreStartTime) : null,
    coreEndTime: policy.coreEndTime ? String(policy.coreEndTime) : null,
    flexEnabled: policy.flexEnabled, flexRangeMins,   // P2-34 fix: 셀프 수정에도 유연근무 범위 전달(과거 누락→정상이 지각으로 뒤바뀜)
  }, false, false, existing.workMode);
  // P1-17 fix: 출근 시 확정된 반차·휴가·공휴일 상태는 셀프 수정 시 재판정으로 덮지 않음
  const PRESERVE_STATUS = ["PARTIAL_LEAVE", "HOLIDAY", "LEAVE"];
  const status = PRESERVE_STATUS.includes(String(existing.status)) ? existing.status : computedStatus;

  try {
    const [rec] = await db.update(attRecords).set({
      sessions: ns as any,
      checkInTime: summary.checkInTime,
      checkOutTime: summary.checkOutTime,
      workingMins: summary.workingMins,
      overtimeMins: summary.overtimeMins,
      status,
      isManuallyAdjusted: true,
      updatedAt: new Date(),
    } as any).where(eq(attRecords.id, existing.id)).returning();
    return jsonOk(rec);
  } catch (err) { return jsonError("update", err); }
}
