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
} from "../../lib/att-utils";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

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

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (operatorGuardFailed(auth)) return auth.res;

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { lat, lng } = body;
  const selectedWorkplaceId: number | null =
    body.workplaceId != null ? Number(body.workplaceId) : null;

  // 회원 식별자 (att_*.member_uid varchar 컬럼용 — members.id의 문자열 변환)
  const memberUid: string = String(auth.ctx.member.id);

  // R29-ATT-GAP2: 오늘 날짜는 KST 기준 (서버 UTC + 9h)
  const today = todayKST();
  const now = new Date();  // DB 저장은 UTC 유지

  // 정책 조회
  const policy = await getDefaultPolicy();
  if (!policy) return jsonError("no_policy", new Error("근무 정책 없음"), 500);

  // 오늘 근무형태
  const workMode = await getScheduledWorkMode(memberUid, today);

  // R36 A-2: FIELD 모드에서 workplaceId 미명시·스케줄 거점도 없을 때 활성 FIELD 거점 목록 반환
  let workplaceId: number | null = selectedWorkplaceId ?? workMode.workplaceId;
  if (workMode.mode === "FIELD" && !workplaceId) {
    try {
      const fieldList = await db.select({
        id: attWorkplaces.id, name: attWorkplaces.name, address: attWorkplaces.address,
        lat: attWorkplaces.lat, lng: attWorkplaces.lng, radius: attWorkplaces.radius,
      })
        .from(attWorkplaces)
        .where(and(eq(attWorkplaces.isActive, true), eq(attWorkplaces.type, "FIELD")));
      return new Response(JSON.stringify({
        ok: false,
        needsWorkplaceSelection: true,
        error: "외근지를 선택해 주세요",
        workplaces: fieldList,
      }), { status: 422, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      console.warn("[att-checkin] FIELD 거점 목록 조회 실패:", err);
    }
  }

  // OFFICE / FIELD: 위치 검증
  if (workMode.mode === "OFFICE" || workMode.mode === "FIELD") {
    if (lat == null || lng == null) {
      return jsonError("no_location", new Error("위치 정보 필요 (lat, lng)"), 400);
    }

    // 거점 조회 — R35-GAP-P2 M-G2·M-G3: isActive·type 필터 정합
    let workplace: any = null;
    if (workplaceId) {
      try {
        // M-G2: workplaceId 명시 시 isActive=true 검증 — 비활성 거점은 매칭 안 함
        const [wp] = await db.select().from(attWorkplaces)
          .where(and(eq(attWorkplaces.id, workplaceId), eq(attWorkplaces.isActive, true)))
          .limit(1);
        workplace = wp ?? null;
      } catch {}
    }
    if (!workplace) {
      try {
        // M-G3: OFFICE 모드 자동 거점 선택 시 type='OFFICE' 필터 추가
        // FIELD 모드는 workplaceId 명시 필수 — 자동 선택 케이스는 OFFICE 한정
        const wps = workMode.mode === "OFFICE"
          ? await db.select().from(attWorkplaces)
              .where(and(eq(attWorkplaces.isActive, true), eq(attWorkplaces.type, "OFFICE")))
          : await db.select().from(attWorkplaces)
              .where(eq(attWorkplaces.isActive, true));
        // 가장 가까운 거점
        let minDist = Infinity;
        for (const wp of wps) {
          if (wp.lat == null || wp.lng == null) continue;
          const d = haversineDistance(lat, lng, Number(wp.lat), Number(wp.lng));
          if (d < minDist) {
            minDist = d;
            workplace = wp;
          }
        }
      } catch {}
    }

    if (workplace && workplace.lat != null && workplace.lng != null) {
      const dist = Math.round(haversineDistance(lat, lng, Number(workplace.lat), Number(workplace.lng)));
      if (!isWithinRadius(lat, lng, Number(workplace.lat), Number(workplace.lng), workplace.radius)) {
        return new Response(JSON.stringify({
          ok: false,
          error: `사무실 반경 ${dist}m 초과`,
          step: "radius_check",
          detail: `허용 반경: ${workplace.radius}m, 현재 거리: ${dist}m`,
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      workplaceId = workplace.id;
    }
  }

  // 공휴일·휴가 여부
  let isHoliday = false;
  let isLeave = false;
  try {
    const holidays = await db.select().from(attHolidays).where(eq(attHolidays.date, today)).limit(1);
    isHoliday = holidays.length > 0;
  } catch {}
  if (!isHoliday) {
    try {
      const leaves = await db.select().from(attLeaveRequests).where(
        and(
          eq(attLeaveRequests.memberUid, memberUid),
          eq(attLeaveRequests.status, "APPROVED"),
          sql`${attLeaveRequests.startDate} <= ${today}::date AND ${attLeaveRequests.endDate} >= ${today}::date`
        )
      ).limit(1);
      isLeave = leaves.length > 0;
    } catch {}
  }

  // 지각 판정 — R34-P2: workMode + coreStartTime 전달 (REMOTE LATE 정합)
  const status = determineStatus(
    now, null,
    {
      checkInTime: String(policy.checkInTime),
      checkOutTime: String(policy.checkOutTime),
      lateGraceMins: policy.lateGraceMins,
      earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
      coreStartTime: policy.coreStartTime ? String(policy.coreStartTime) : null,
      coreEndTime:   policy.coreEndTime   ? String(policy.coreEndTime)   : null,
    },
    isLeave,
    isHoliday,
    workMode.mode,
  );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const [record] = await db.insert(attRecords).values({
      memberUid,
      date: today,
      workMode: workMode.mode,
      status,
      checkInTime: now,
      checkInLat: lat != null ? String(lat) : null,
      checkInLng: lng != null ? String(lng) : null,
      checkInIp: ip,
      workplaceId,
    } as any).returning();

    // R29-ATT-GAP2 PHASE E 알림 1: 출근 확인 (fire-and-forget — 메인 흐름 차단 X)
    sendWorkspaceNotification({
      memberId: auth.ctx.member.id,
      sourceType: "event" as any,
      sourceId: record.id,
      notifType: "completed" as any,
      channel: "bell",
      title: "출근 완료",
      body: `${hhmmKST(now)} 출근이 등록되었습니다.${status === "LATE" ? " (지각 처리)" : ""}`,
      actionUrl: "/workspace-attendance.html",
      category: "system",
    }).catch(e => console.warn("[att-checkin] 알림 실패:", e));

    // R36 A-5: REMOTE 출근 시 WBS 자동 카드 생성 (중복 방지)
    //   sourceType='att_remote_report' + sourceRefUrl=date 로 중복 판정
    let autoCardId: number | null = null;
    if (workMode.mode === "REMOTE") {
      try {
        const memberId = auth.ctx.member.id;
        // 오늘자 자동 카드 중복 체크
        const existsRows: any = await db.execute(sql`
          SELECT id FROM workspace_tasks
          WHERE member_id = ${memberId}
            AND source_type = 'att_remote_report'
            AND source_ref_url = ${today}
          LIMIT 1
        `);
        const existsList: any[] = Array.isArray(existsRows) ? existsRows : (existsRows as any).rows ?? [];
        if (existsList.length === 0) {
          // 오늘 KST 23:59 마감 (UTC 14:59)
          const dueDate = new Date(today + "T23:59:59+09:00");
          const insRows: any = await db.execute(sql`
            INSERT INTO workspace_tasks
              (member_id, title, description, status, priority, due_date,
               source_type, source_id, source_ref_url, created_by_agent)
            VALUES
              (${memberId}, ${today + " 재택근무 보고서"},
               ${"재택근무 일일 보고서 작성 (자동 생성)"},
               'todo', 'normal', ${dueDate.toISOString()}::timestamp,
               'att_remote_report', ${record.id}, ${today}, 'user')
            RETURNING id
          `);
          const insList: any[] = Array.isArray(insRows) ? insRows : (insRows as any).rows ?? [];
          autoCardId = insList[0]?.id ?? null;
        } else {
          autoCardId = existsList[0]?.id ?? null;
        }
      } catch (err) {
        console.warn("[att-checkin] WBS 자동 카드 생성 실패:", err);
      }
    }

    return jsonOk({
      ...record,
      remoteReportRequired: workMode.mode === "REMOTE",
      autoCardId,
    }, 201);
  } catch (err) {
    if (String(err).includes("unique") || String(err).includes("att_records_member_date_uq")) {
      return new Response(JSON.stringify({
        ok: false, error: "이미 출근 처리됨", step: "insert_conflict",
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return jsonError("insert_record", err);
  }
}
