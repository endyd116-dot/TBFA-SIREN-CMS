import { db } from "../../db/index";
import { attRecords, attRemoteWorkReports, attWorkplaces } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { getDefaultPolicy, determineStatus, todayKST, hhmmKST, haversineDistance, isWithinRadius, getFlexRangeMins } from "../../lib/att-utils";
import { normalizeSessions, isWorking, recomputeSummary, type AttSession } from "../../lib/att-session";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { path: "/api/att-checkout" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "퇴근 처리 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { lat, lng } = body;
  const VALID_DEVICE_TYPES = ["MOBILE", "TABLET", "DESKTOP"] as const;
  const rawDeviceType = String(body.deviceType || "").toUpperCase();
  const deviceType: string | null = (VALID_DEVICE_TYPES as readonly string[]).includes(rawDeviceType) ? rawDeviceType : null;

  const memberUid: string = String(auth.ctx.member.id);
  const today = todayKST();
  const now = new Date();

  // 오늘 출근 기록
  let existing: any;
  try {
    const rows = await db.select().from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today))).limit(1);
    existing = rows[0];
  } catch (err) { return jsonError("select_record", err); }

  if (!existing) {
    return new Response(JSON.stringify({ ok: false, error: "출근 기록 없음 — 출근 먼저 처리해 주세요", step: "no_checkin" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const sessions = normalizeSessions(existing);
  if (!isWorking(sessions)) {
    return new Response(JSON.stringify({ ok: false, error: "이미 퇴근 처리됨", step: "already_checkout" }),
      { status: 409, headers: { "Content-Type": "application/json" } });
  }

  const policy = await getDefaultPolicy();
  if (!policy) return jsonError("no_policy", new Error("근무 정책 없음"), 500);

  // ① 근무시간 미달 경고용 미리보기 (DB 미반영·위치검증 전) — Swain 2026-05-26
  //   프론트가 퇴근 확정 전 호출 → 표준 근무시간 미달이면 확인창 표시(막지 않음)
  if (body.preview === true) {
    const pv: AttSession[] = sessions.slice();
    pv[pv.length - 1] = { ...pv[pv.length - 1], out: now.toISOString() };
    const ps = recomputeSummary(pv, {
      dailyHours: policy.dailyHours, breakMins: policy.breakMins, breakThresholdHours: policy.breakThresholdHours,
    });
    const requiredMins = Math.round(Number(policy.dailyHours) * 60);
    const underHours = ps.workingMins < requiredMins;
    return jsonOk({
      preview: true, workingMins: ps.workingMins, requiredMins,
      underHours, shortfallMins: underHours ? requiredMins - ps.workingMins : 0,
    });
  }

  // 퇴근 위치 검증 — 일반근무(OFFICE)만 거점 반경 강제 (재택·외근·출장 제외) · Swain 2026-05-24
  if (existing.workMode === "OFFICE") {
    if (lat == null || lng == null) return jsonError("no_location", new Error("위치 정보 필요 (lat, lng)"), 400);
    let workplace: any = null;
    if (existing.workplaceId) {
      try {
        const [wp] = await db.select().from(attWorkplaces)
          .where(and(eq(attWorkplaces.id, existing.workplaceId), eq(attWorkplaces.isActive, true))).limit(1);
        workplace = wp ?? null;
      } catch {}
    }
    if (!workplace) {
      try {
        const wps = await db.select().from(attWorkplaces).where(and(eq(attWorkplaces.isActive, true), eq(attWorkplaces.type, "OFFICE")));
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
        return new Response(JSON.stringify({
          ok: false, error: `사무실 반경 ${dist}m 초과 — 퇴근은 사무실에서 가능합니다`, step: "radius_check",
          detail: `허용 반경: ${workplace.radius}m, 현재 거리: ${dist}m`,
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }
  }

  // 진행 중인 마지막 세션 마감
  const outLatStr = lat != null ? String(lat) : null;
  const outLngStr = lng != null ? String(lng) : null;
  const ns: AttSession[] = sessions.slice();
  ns[ns.length - 1] = { ...ns[ns.length - 1], out: now.toISOString(), outLat: outLatStr, outLng: outLngStr };

  // 요약 재계산 (단일=휴게차감 / 다중=세션합산)
  const summary = recomputeSummary(ns, {
    dailyHours: policy.dailyHours, breakMins: policy.breakMins, breakThresholdHours: policy.breakThresholdHours,
  });

  // 조퇴 판정 — 첫 출근 ~ 현재 기준 (유연근무 시 ±X 범위·조퇴 미판정)
  const flexRangeMins = policy.flexEnabled ? await getFlexRangeMins() : undefined;
  const checkInForStatus = summary.checkInTime ?? new Date(existing.checkInTime ?? now);
  const status = determineStatus(checkInForStatus, now, {
    checkInTime: String(policy.checkInTime), checkOutTime: String(policy.checkOutTime),
    lateGraceMins: policy.lateGraceMins, earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
    coreStartTime: policy.coreStartTime ? String(policy.coreStartTime) : null,
    coreEndTime: policy.coreEndTime ? String(policy.coreEndTime) : null,
    flexEnabled: policy.flexEnabled, flexRangeMins,
  }, false, false, existing.workMode);

  // REMOTE 퇴근 시 오늘 보고서 제출 여부
  let reportSubmitted = false;
  if (existing.workMode === "REMOTE") {
    try {
      const reportRows = await db.select({ status: attRemoteWorkReports.status }).from(attRemoteWorkReports)
        .where(and(eq(attRemoteWorkReports.memberUid, memberUid), eq(attRemoteWorkReports.date, today))).limit(1);
      reportSubmitted = reportRows.length > 0 && reportRows[0].status === "SUBMITTED";
    } catch {}
  }

  try {
    const updatePayload: any = {
      sessions: ns as any,
      checkOutTime: summary.checkOutTime,
      checkOutLat: outLatStr, checkOutLng: outLngStr,
      workingMins: summary.workingMins, overtimeMins: summary.overtimeMins,
      status, updatedAt: new Date(),
    };
    if (deviceType) updatePayload.deviceType = deviceType;

    const [record] = await db.update(attRecords).set(updatePayload)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today))).returning();

    sendWorkspaceNotification({
      memberId: auth.ctx.member.id, sourceType: "event" as any, sourceId: record?.id ?? 0,
      notifType: "completed" as any, channel: "bell",
      title: "퇴근 완료", body: `${hhmmKST(now)} 퇴근이 등록되었습니다. 오늘도 수고하셨습니다!`,
      actionUrl: "/workspace-attendance.html", category: "system",
    }).catch(e => console.warn("[att-checkout] 알림 실패:", e));

    const requiredMins = Math.round(Number(policy.dailyHours) * 60);
    const underHours = (summary.workingMins ?? 0) < requiredMins;
    return jsonOk({
      ...record, reportSubmitted,
      underHours, requiredMins, shortfallMins: underHours ? requiredMins - (summary.workingMins ?? 0) : 0,
    });
  } catch (err) { return jsonError("update_record", err); }
}
