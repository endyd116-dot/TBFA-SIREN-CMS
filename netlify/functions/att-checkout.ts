import { db } from "../../db/index";
import { attRecords, attRemoteWorkReports, attWorkplaces } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { requireOperator, operatorGuardFailed } from "../../lib/operator-guard";
import { getDefaultPolicy, calcWorkingMins, determineStatus, todayKST, hhmmKST, haversineDistance, isWithinRadius } from "../../lib/att-utils";
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

  /* R39 Stage 7 후속 fix: 디바이스 타입 수신 (퇴근 시 다른 디바이스일 수 있어 갱신·없으면 기존 값 유지) */
  const VALID_DEVICE_TYPES = ["MOBILE", "TABLET", "DESKTOP"] as const;
  const rawDeviceType = String(body.deviceType || "").toUpperCase();
  const deviceType: string | null = (VALID_DEVICE_TYPES as readonly string[]).includes(rawDeviceType)
    ? rawDeviceType
    : null;

  // 회원 식별자 (att_*.member_uid varchar — members.id 문자열)
  const memberUid: string = String(auth.ctx.member.id);

  // R29-ATT-GAP2: 오늘 날짜는 KST 기준
  const today = todayKST();
  const now = new Date();  // DB 저장은 UTC 유지

  // 오늘 출근 기록 확인
  let existing: any;
  try {
    const rows = await db
      .select()
      .from(attRecords)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today)))
      .limit(1);
    existing = rows[0];
  } catch (err) {
    return jsonError("select_record", err);
  }

  if (!existing) {
    return new Response(JSON.stringify({
      ok: false, error: "출근 기록 없음 — 출근 먼저 처리해 주세요", step: "no_checkin",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (existing.checkOutTime) {
    return new Response(JSON.stringify({
      ok: false, error: "이미 퇴근 처리됨", step: "already_checkout",
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  // 퇴근 위치 검증 — 일반근무(OFFICE)만 거점 반경 내 강제 (재택·외근·출장 제외) · Swain 2026-05-24
  // 출근(att-checkin)의 OFFICE 검증과 동일 로직. 거점은 출근 시 기록된 workplaceId 우선,
  // 없으면 가장 가까운 활성 OFFICE 거점. 거점 좌표가 없으면 검증 스킵(출근과 동일 관행).
  if (existing.workMode === "OFFICE") {
    if (lat == null || lng == null) {
      return jsonError("no_location", new Error("위치 정보 필요 (lat, lng)"), 400);
    }
    let workplace: any = null;
    if (existing.workplaceId) {
      try {
        const [wp] = await db.select().from(attWorkplaces)
          .where(and(eq(attWorkplaces.id, existing.workplaceId), eq(attWorkplaces.isActive, true)))
          .limit(1);
        workplace = wp ?? null;
      } catch {}
    }
    if (!workplace) {
      try {
        const wps = await db.select().from(attWorkplaces)
          .where(and(eq(attWorkplaces.isActive, true), eq(attWorkplaces.type, "OFFICE")));
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
          ok: false,
          error: `사무실 반경 ${dist}m 초과 — 퇴근은 사무실에서 가능합니다`,
          step: "radius_check",
          detail: `허용 반경: ${workplace.radius}m, 현재 거리: ${dist}m`,
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }
  }

  // 정책
  const policy = await getDefaultPolicy();
  if (!policy) return jsonError("no_policy", new Error("근무 정책 없음"), 500);

  // 근무시간 계산
  const checkIn = existing.checkInTime ? new Date(existing.checkInTime) : now;
  const { workingMins, overtimeMins } = calcWorkingMins(checkIn, now, {
    dailyHours: Number(policy.dailyHours),
    breakMins: policy.breakMins,
    breakThresholdHours: Number(policy.breakThresholdHours),
  });

  // 조퇴 판정 — R34-P2: workMode + coreStartTime 전달 (existing.workMode 사용)
  const status = determineStatus(
    checkIn,
    now,
    {
      checkInTime: String(policy.checkInTime),
      checkOutTime: String(policy.checkOutTime),
      lateGraceMins: policy.lateGraceMins,
      earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
      coreStartTime: policy.coreStartTime ? String(policy.coreStartTime) : null,
      coreEndTime:   policy.coreEndTime   ? String(policy.coreEndTime)   : null,
    },
    false,
    false,
    existing.workMode,
  );

  // REMOTE 퇴근 시 오늘 보고서 제출 여부 체크
  let reportSubmitted = false;
  if (existing.workMode === "REMOTE") {
    try {
      const reportRows = await db
        .select({ status: attRemoteWorkReports.status })
        .from(attRemoteWorkReports)
        .where(and(
          eq(attRemoteWorkReports.memberUid, memberUid),
          eq(attRemoteWorkReports.date, today),
        ))
        .limit(1);
      reportSubmitted = reportRows.length > 0 && reportRows[0].status === "SUBMITTED";
    } catch {
      // 조회 실패해도 퇴근은 처리
    }
  }

  try {
    const updatePayload: any = {
      checkOutTime: now,
      checkOutLat: lat != null ? String(lat) : null,
      checkOutLng: lng != null ? String(lng) : null,
      workingMins,
      overtimeMins,
      status,
      updatedAt: new Date(),
    };
    /* deviceType은 명시된 경우만 갱신 — 미명시 시 출근 시점 값 유지 */
    if (deviceType) updatePayload.deviceType = deviceType;

    const [record] = await db
      .update(attRecords)
      .set(updatePayload)
      .where(and(eq(attRecords.memberUid, memberUid), eq(attRecords.date, today)))
      .returning();

    // R29-ATT-GAP2 PHASE E 알림 2: 퇴근 확인 (fire-and-forget)
    sendWorkspaceNotification({
      memberId: auth.ctx.member.id,
      sourceType: "event" as any,
      sourceId: record?.id ?? 0,
      notifType: "completed" as any,
      channel: "bell",
      title: "퇴근 완료",
      body: `${hhmmKST(now)} 퇴근이 등록되었습니다. 오늘도 수고하셨습니다!`,
      actionUrl: "/workspace-attendance.html",
      category: "system",
    }).catch(e => console.warn("[att-checkout] 알림 실패:", e));

    return jsonOk({ ...record, reportSubmitted });
  } catch (err) {
    return jsonError("update_record", err);
  }
}
