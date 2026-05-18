import { db } from "../../db/index";
import { members, attRecords, attWorkplaces, attHolidays, attLeaveRequests } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireActiveUser } from "../../lib/auth";
import {
  getScheduledWorkMode,
  getDefaultPolicy,
  haversineDistance,
  isWithinRadius,
  determineStatus,
} from "../../lib/att-utils";

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
  const auth = await requireActiveUser(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const { lat, lng } = body;

  // members.uid(varchar) 조회
  let memberUid: string;
  try {
    const [member] = await db
      .select({ uid: members.uid })
      .from(members)
      .where(eq(members.id, auth.user.uid))
      .limit(1);
    if (!member) return jsonError("member_not_found", new Error("회원 없음"), 404);
    memberUid = member.uid;
  } catch (err) {
    return jsonError("select_member", err);
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  // 정책 조회
  const policy = await getDefaultPolicy();
  if (!policy) return jsonError("no_policy", new Error("근무 정책 없음"), 500);

  // 오늘 근무형태
  const workMode = await getScheduledWorkMode(memberUid, today);

  // OFFICE / FIELD: 위치 검증
  let workplaceId: number | null = workMode.workplaceId;
  if (workMode.mode === "OFFICE" || workMode.mode === "FIELD") {
    if (lat == null || lng == null) {
      return jsonError("no_location", new Error("위치 정보 필요 (lat, lng)"), 400);
    }

    // 거점 조회 (할당된 거점 우선, 없으면 활성 OFFICE 거점 중 가장 가까운 곳)
    let workplace: any = null;
    if (workplaceId) {
      try {
        const [wp] = await db.select().from(attWorkplaces).where(eq(attWorkplaces.id, workplaceId)).limit(1);
        workplace = wp ?? null;
      } catch {}
    }
    if (!workplace) {
      try {
        const wps = await db.select().from(attWorkplaces).where(eq(attWorkplaces.isActive, true));
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

  // 지각 판정
  const status = determineStatus(
    now, null,
    {
      checkInTime: String(policy.checkInTime),
      checkOutTime: String(policy.checkOutTime),
      lateGraceMins: policy.lateGraceMins,
      earlyLeaveGraceMins: policy.earlyLeaveGraceMins,
    },
    isLeave,
    isHoliday
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
    }).returning();
    return jsonOk(record, 201);
  } catch (err) {
    if (String(err).includes("unique") || String(err).includes("att_records_member_date_uq")) {
      return new Response(JSON.stringify({
        ok: false, error: "이미 출근 처리됨", step: "insert_conflict",
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return jsonError("insert_record", err);
  }
}
