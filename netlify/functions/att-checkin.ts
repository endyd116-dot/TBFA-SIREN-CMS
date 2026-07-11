import { db } from "../../db/index";
import { attRecords, attWorkplaces, attHolidays, attLeaveRequests } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import {
  getScheduledWorkMode,
  getDefaultPolicy,
  haversineDistance,
  isWithinRadius,
  determineStatus,
  todayKST,
  hhmmKST,
  getFlexRangeMins,
} from "../../lib/att-utils";
import { normalizeSessions, isWorking, isWithinWorkHours, type AttSession } from "../../lib/att-session";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import { openDoor } from "../../lib/adapters/door";

/** 출입문 자동 개방 — 사무실(OFFICE) 현장 출근/복귀만. REMOTE(재택)·FIELD(외근)는 사무실 문과 무관.
 *  openDoor는 설계상 throw하지 않음(내부 try/catch). 응답엔 간단 요약만 실어 프론트가 안내. */
async function autoOpenDoor(
  workMode: { mode: string },
  triggerType: "checkin" | "reentry",
  triggerId: number | null,
  memberUid: string,
): Promise<{ ok: boolean; adapter: string; sim: boolean } | null> {
  if (workMode.mode !== "OFFICE") return null;
  try {
    const r = await openDoor({ triggerType, triggerId, memberUid });
    return { ok: r.ok, adapter: r.adapter, sim: r.adapter === "sim" };
  } catch (e) {
    console.warn("[att-checkin] 문 개방 호출 실패(비차단):", String((e as any)?.message || e).slice(0, 200));
    return { ok: false, adapter: "unknown", sim: false };
  }
}

export const config = { path: "/api/att-checkin" };

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "출근 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

/** OFFICE/FIELD 위치 검증 — 통과 시 workplaceId, 실패 시 Response 반환. */
async function verifyLocation(
  workMode: { mode: string; workplaceId: number | null },
  selectedWorkplaceId: number | null,
  lat: any, lng: any,
): Promise<{ workplaceId: number | null; errorRes: Response | null }> {
  let workplaceId: number | null = selectedWorkplaceId ?? workMode.workplaceId;

  // FIELD: 거점 미지정 시 활성 FIELD 목록 반환 → 선택 요구
  if (workMode.mode === "FIELD" && !workplaceId) {
    try {
      const fieldList = await db.select({
        id: attWorkplaces.id, name: attWorkplaces.name, address: attWorkplaces.address,
        lat: attWorkplaces.lat, lng: attWorkplaces.lng, radius: attWorkplaces.radius,
      }).from(attWorkplaces).where(and(eq(attWorkplaces.isActive, true), eq(attWorkplaces.type, "FIELD")));
      return { workplaceId: null, errorRes: new Response(JSON.stringify({
        ok: false, needsWorkplaceSelection: true, error: "외근지를 선택해 주세요", workplaces: fieldList,
      }), { status: 422, headers: { "Content-Type": "application/json" } }) };
    } catch (err) { console.warn("[att-checkin] FIELD 거점 목록 조회 실패:", err); }
  }

  if (workMode.mode === "OFFICE" || workMode.mode === "FIELD") {
    if (lat == null || lng == null) {
      return { workplaceId: null, errorRes: jsonError("no_location", new Error("위치 정보 필요 (lat, lng)"), 400) };
    }
    let workplace: any = null;
    if (workplaceId) {
      try {
        const [wp] = await db.select().from(attWorkplaces)
          .where(and(eq(attWorkplaces.id, workplaceId), eq(attWorkplaces.isActive, true))).limit(1);
        workplace = wp ?? null;
      } catch {}
    }
    if (!workplace) {
      try {
        const wps = workMode.mode === "OFFICE"
          ? await db.select().from(attWorkplaces).where(and(eq(attWorkplaces.isActive, true), eq(attWorkplaces.type, "OFFICE")))
          : await db.select().from(attWorkplaces).where(eq(attWorkplaces.isActive, true));
        let minDist = Infinity;
        for (const wp of wps) {
          if (wp.lat == null || wp.lng == null) continue;
          const d = haversineDistance(lat, lng, Number(wp.lat), Number(wp.lng));
          if (d < minDist) { minDist = d; workplace = wp; }
        }
      } catch {}
    }
    if (workplace && workplace.lat != null && workplace.lng != null) {
      const dist = Math.round(haversineDistance(lat, lng, Number(workplace.lat), Number(workplace.lng)));
      if (!isWithinRadius(lat, lng, Number(workplace.lat), Number(workplace.lng), workplace.radius)) {
        return { workplaceId: null, errorRes: new Response(JSON.stringify({
          ok: false, error: `사무실 반경 ${dist}m 초과`, step: "radius_check",
          detail: `허용 반경: ${workplace.radius}m, 현재 거리: ${dist}m`,
        }), { status: 400, headers: { "Content-Type": "application/json" } }) };
      }
      workplaceId = workplace.id;
    }
  }
  return { workplaceId, errorRes: null };
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { lat, lng } = body;
  const selectedWorkplaceId: number | null = body.workplaceId != null ? Number(body.workplaceId) : null;
  const reentryMode: string | null = body.reentryMode === "reopen" || body.reentryMode === "new" ? body.reentryMode : null;

  const VALID_DEVICE_TYPES = ["MOBILE", "TABLET", "DESKTOP"] as const;
  const rawDeviceType = String(body.deviceType || "").toUpperCase();
  const deviceType: string | null = (VALID_DEVICE_TYPES as readonly string[]).includes(rawDeviceType) ? rawDeviceType : null;

  const memberUid: string = String(auth.ctx.member.id);
  const today = todayKST();
  const now = new Date();
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);

  const policy = await getDefaultPolicy();
  if (!policy) return jsonError("no_policy", new Error("근무 정책 없음"), 500);

  // 오늘 기록 조회
  let existing: any = null;
  try {
    const rows = await db.select().from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today))).limit(1);
    existing = rows[0] ?? null;
  } catch (err) { return jsonError("select_record", err); }

  const inLatStr = lat != null ? String(lat) : null;
  const inLngStr = lng != null ? String(lng) : null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // ─── 재출근 분기 (오늘 기록이 이미 있음) ───
  if (existing) {
    const sessions = normalizeSessions(existing);

    if (isWorking(sessions)) {
      return new Response(JSON.stringify({ ok: false, error: "이미 출근 상태입니다", step: "already_working" }),
        { status: 409, headers: { "Content-Type": "application/json" } });
    }

    const inWork = isWithinWorkHours(String(policy.checkInTime), String(policy.checkOutTime), nowKst);

    // 선택 미지정 → 모달 띄우라고 응답
    if (!reentryMode) {
      const last = sessions[sessions.length - 1];
      const reMsg = inWork ? "재출근 또는 퇴근 취소를 선택하세요" : "업무시간 외입니다. 재출근만 가능합니다(기존 퇴근 기록은 보존).";
      return new Response(JSON.stringify({
        ok: false, needsReentryChoice: true, inWorkHours: inWork,
        lastCheckOut: last?.out ?? existing.checkOutTime ?? null,
        error: reMsg, message: reMsg,
      }), { status: 422, headers: { "Content-Type": "application/json" } });
    }

    // 퇴근 취소 (업무시간 내만) — 마지막 세션의 퇴근을 되돌려 근무중 복귀
    if (reentryMode === "reopen") {
      if (!inWork) {
        return new Response(JSON.stringify({ ok: false, error: "업무시간이 지나 퇴근 취소는 불가합니다. 재출근만 가능합니다.", step: "reopen_after_hours" }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const ns = sessions.slice();
      const last = { ...ns[ns.length - 1], out: null, outLat: null, outLng: null };
      ns[ns.length - 1] = last;
      try {
        const [rec] = await db.update(attRecords).set({
          sessions: ns as any, checkOutTime: null, checkOutLat: null, checkOutLng: null,
          workingMins: null, overtimeMins: 0, updatedAt: new Date(),
        } as any).where(eq(attRecords.id, existing.id)).returning();
        return jsonOk({ ...rec, reopened: true });
      } catch (err) { return jsonError("reopen", err); }
    }

    // 재출근 (새 세션) — 위치 검증 후 세션 추가
    const workMode = await getScheduledWorkMode(memberUid, today);
    const loc = await verifyLocation(workMode, selectedWorkplaceId, lat, lng);
    if (loc.errorRes) return loc.errorRes;

    const ns: AttSession[] = sessions.slice();
    ns.push({ in: now.toISOString(), out: null, inLat: inLatStr, inLng: inLngStr, workplaceId: loc.workplaceId });
    try {
      const [rec] = await db.update(attRecords).set({
        sessions: ns as any, checkOutTime: null, checkOutLat: null, checkOutLng: null,
        workingMins: null, overtimeMins: 0, updatedAt: new Date(),
      } as any).where(eq(attRecords.id, existing.id)).returning();

      sendWorkspaceNotification({
        memberId: auth.ctx.member.id, sourceType: "event" as any, sourceId: rec?.id ?? 0,
        notifType: "reminder_3d" as any, channel: "bell",
        title: "재출근 등록", body: `${hhmmKST(now)} 재출근이 등록되었습니다. (${ns.length}번째 세션)`,
        actionUrl: "/workspace-attendance.html", category: "system",
      }).catch(e => console.warn("[att-checkin] 재출근 알림 실패:", e));

      const door = await autoOpenDoor(workMode, "reentry", rec?.id ?? existing.id, memberUid);
      return jsonOk({ ...rec, reentry: true, sessionCount: ns.length, door }, 201);
    } catch (err) { return jsonError("reentry", err); }
  }

  // ─── 첫 출근 (오늘 기록 없음) ───
  const workMode = await getScheduledWorkMode(memberUid, today);
  const loc = await verifyLocation(workMode, selectedWorkplaceId, lat, lng);
  if (loc.errorRes) return loc.errorRes;
  const workplaceId = loc.workplaceId;

  // 공휴일·휴가 여부
  let isHoliday = false, isLeave = false, isHalfDayLeave = false;
  try {
    const holidays = await db.select().from(attHolidays).where(eq(attHolidays.date, today)).limit(1);
    isHoliday = holidays.length > 0;
  } catch {}
  if (!isHoliday) {
    try {
      const leaves = await db.select().from(attLeaveRequests).where(and(
        eq(attLeaveRequests.memberUid, memberUid),
        eq(attLeaveRequests.status, "APPROVED"),
        sql`${attLeaveRequests.startDate} <= ${today}::date AND ${attLeaveRequests.endDate} >= ${today}::date`,
      )).limit(1);
      // Q3-028: 반차(isHalfDay)는 종일 휴가가 아니라 출근 허용 + PARTIAL_LEAVE 기록. 전일 휴가만 LEAVE로 차단.
      if (leaves.length > 0) {
        if ((leaves[0] as any).isHalfDay) isHalfDayLeave = true;
        else isLeave = true;
      }
    } catch {}

    /* 2026-05-29 BUG-2 fix — 결재 대기(PENDING) 휴가가 있으면 출근 차단.
       Swain 시나리오: 직원이 휴가 신청 후 같은 날 출근 찍으면 PENDING이라 통과되던 사고. */
    try {
      const pendingLeaves = await db.select({
        id: attLeaveRequests.id,
        startDate: attLeaveRequests.startDate,
        endDate: attLeaveRequests.endDate,
        isHalfDay: attLeaveRequests.isHalfDay,
      }).from(attLeaveRequests).where(and(
        eq(attLeaveRequests.memberUid, memberUid),
        eq(attLeaveRequests.status, "PENDING"),
        sql`${attLeaveRequests.startDate} <= ${today}::date AND ${attLeaveRequests.endDate} >= ${today}::date`,
      )).limit(1);
      if (pendingLeaves.length > 0 && !pendingLeaves[0].isHalfDay) {
        return new Response(JSON.stringify({
          ok: false,
          error: "결재 대기 중인 휴가 신청이 있습니다. 운영자의 결재가 완료된 후 출근하거나, 휴가를 철회한 후 다시 시도하세요",
          step: "leave_pending",
          conflict: pendingLeaves[0],
        }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
    } catch (err) {
      console.warn("[att-checkin] PENDING 휴가 검사 실패:", err);
    }
  }

  const flexRangeMins = policy.flexEnabled ? await getFlexRangeMins() : undefined;
  let status = determineStatus(now, null, {
    checkInTime: String(policy.checkInTime), checkOutTime: String(policy.checkOutTime),
    lateGraceMins: policy.lateGraceMins, earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
    coreStartTime: policy.coreStartTime ? String(policy.coreStartTime) : null,
    coreEndTime: policy.coreEndTime ? String(policy.coreEndTime) : null,
    flexEnabled: policy.flexEnabled, flexRangeMins,
  }, isLeave, isHoliday, workMode.mode);
  // Q3-028: 반차일은 출근을 허용하되 상태를 PARTIAL_LEAVE로 기록 (지각/조퇴 판정 대신 — 오전/오후 반차 근무).
  if (isHalfDayLeave) status = "PARTIAL_LEAVE";

  const firstSession: AttSession = { in: now.toISOString(), out: null, inLat: inLatStr, inLng: inLngStr, workplaceId };

  try {
    const [record] = await db.insert(attRecords).values({
      memberUid, date: today, workMode: workMode.mode, status,
      checkInTime: now, checkInLat: inLatStr, checkInLng: inLngStr, checkInIp: ip,
      workplaceId, deviceType, sessions: [firstSession] as any,
    } as any).returning();

    sendWorkspaceNotification({
      memberId: auth.ctx.member.id, sourceType: "event" as any, sourceId: record.id,
      notifType: "completed" as any, channel: "bell",
      title: "출근 완료", body: `${hhmmKST(now)} 출근이 등록되었습니다.${status === "LATE" ? " (지각 처리)" : ""}`,
      actionUrl: "/workspace-attendance.html", category: "system",
    }).catch(e => console.warn("[att-checkin] 알림 실패:", e));

    // REMOTE 출근 시 WBS 자동 카드 생성 (중복 방지)
    let autoCardId: number | null = null;
    if (workMode.mode === "REMOTE") {
      try {
        const memberId = auth.ctx.member.id;
        const existsRows: any = await db.execute(sql`
          SELECT id FROM workspace_tasks
          WHERE member_id = ${memberId} AND source_type = 'att_remote_report' AND source_ref_url = ${today} LIMIT 1`);
        const existsList: any[] = Array.isArray(existsRows) ? existsRows : (existsRows as any).rows ?? [];
        if (existsList.length === 0) {
          const dueDate = new Date(today + "T23:59:59+09:00");
          const insRows: any = await db.execute(sql`
            INSERT INTO workspace_tasks
              (member_id, title, description, status, priority, due_date, source_type, source_id, source_ref_url, created_by_agent)
            VALUES (${memberId}, ${today + " 재택근무 보고서"}, ${"재택근무 일일 보고서 작성 (자동 생성)"},
               'todo', 'normal', ${dueDate.toISOString()}::timestamp, 'att_remote_report', ${record.id}, ${today}, 'user')
            RETURNING id`);
          const insList: any[] = Array.isArray(insRows) ? insRows : (insRows as any).rows ?? [];
          autoCardId = insList[0]?.id ?? null;
        } else {
          autoCardId = existsList[0]?.id ?? null;
        }
      } catch (err) { console.warn("[att-checkin] WBS 자동 카드 생성 실패:", err); }
    }

    const door = await autoOpenDoor(workMode, "checkin", record.id, memberUid);
    return jsonOk({ ...record, remoteReportRequired: workMode.mode === "REMOTE", autoCardId, door }, 201);
  } catch (err) {
    if (String(err).includes("unique") || String(err).includes("att_records_member_date_uq")) {
      return new Response(JSON.stringify({ ok: false, error: "이미 출근 처리됨", step: "insert_conflict" }),
        { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return jsonError("insert_record", err);
  }
}
