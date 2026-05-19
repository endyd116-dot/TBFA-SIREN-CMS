import { db } from "../../db/index";
import { attRecords, members } from "../../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireOperator } from "../../lib/operator-guard";

export const config = { path: "/api/att/export" };

function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "CSV 내보내기 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

function toKST(ts: Date | string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  // UTC+9
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("T", " ").slice(0, 16);
}

function minsToHHMM(mins: number | null): string {
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}시간 ${m}분`;
}

const STATUS_LABEL: Record<string, string> = {
  NORMAL: "정상",
  LATE: "지각",
  EARLY_LEAVE: "조퇴",
  ABSENT: "결근",
  LEAVE: "휴가",
  HOLIDAY: "공휴일",
  PARTIAL_LEAVE: "반차",
};

const WORK_MODE_LABEL: Record<string, string> = {
  OFFICE: "사무실",
  REMOTE: "재택",
  FIELD: "현장",
  BUSINESS_TRIP: "출장",
  HYBRID: "혼합",
};

export default async function handler(req: Request) {
  const auth = await requireOperator(req);
  if (!auth.ok) return auth.res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const memberUidParam = url.searchParams.get("memberUid");
  const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth() + 1));

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return new Response(JSON.stringify({ ok: false, error: "year, month 형식 오류", step: "validate" }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // 날짜 범위 계산
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // 멤버 정보 확인
  let targetMemberId: number | null = null;
  let memberName = "";
  if (memberUidParam) {
    targetMemberId = parseInt(memberUidParam);
    // R34-P2 (round2 M9): 본인 데이터가 아니면 슈퍼어드민·admin만 허용
    if (targetMemberId !== auth.ctx.member.id) {
      const isSuper = auth.ctx.member.role === "super_admin";
      const isAdmin = auth.ctx.member.type === "admin";
      if (!isSuper && !isAdmin) {
        return new Response(JSON.stringify({
          ok: false,
          error: "본인 데이터만 export할 수 있습니다",
          step: "permission",
        }), { status: 403, headers: { "Content-Type": "application/json" } });
      }
    }
    try {
      const [m] = await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(eq(members.id, targetMemberId))
        .limit(1);
      if (!m) {
        return new Response(JSON.stringify({ ok: false, error: "해당 직원을 찾을 수 없습니다", step: "find_member" }),
          { status: 404, headers: { "Content-Type": "application/json" } });
      }
      memberName = m.name;
    } catch (err) {
      return jsonError("select_member", err);
    }
  } else {
    // 본인 데이터
    targetMemberId = auth.ctx.member.id;
    memberName = auth.ctx.member.name ?? "";
  }

  // 근태 기록 조회
  let records: any[] = [];
  try {
    records = await db
      .select({
        date: attRecords.date,
        workMode: attRecords.workMode,
        status: attRecords.status,
        checkInTime: attRecords.checkInTime,
        checkOutTime: attRecords.checkOutTime,
        workingMins: attRecords.workingMins,
        overtimeMins: attRecords.overtimeMins,
        note: attRecords.note,
      })
      .from(attRecords)
      .where(and(
        eq(attRecords.memberUid, String(targetMemberId)),
        gte(attRecords.date, startDate),
        lte(attRecords.date, endDate),
      ))
      .orderBy(attRecords.date)
      .limit(60);
  } catch (err) {
    return jsonError("select_records", err);
  }

  // CSV 생성
  const BOM = "﻿"; // UTF-8 BOM (Excel 한글 인식)
  const headers = ["날짜", "근무형태", "출근시각", "퇴근시각", "근무시간", "초과근무", "상태", "메모"];
  const rows = records.map(r => [
    r.date ?? "",
    WORK_MODE_LABEL[r.workMode ?? ""] ?? (r.workMode ?? ""),
    toKST(r.checkInTime),
    toKST(r.checkOutTime),
    minsToHHMM(r.workingMins),
    minsToHHMM(r.overtimeMins),
    STATUS_LABEL[r.status ?? ""] ?? (r.status ?? ""),
    (r.note ?? "").replace(/,/g, " ").replace(/\n/g, " "),
  ]);

  const csvLines = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  );
  const csv = BOM + csvLines.join("\r\n");

  const filename = `att-${memberName}-${year}-${String(month).padStart(2, "0")}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
