import { db } from "../../db/index";
import { members } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";

export const config = { path: "/api/att-my-stats" };

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function jsonError(step: string, err: any, status = 500) {
  return new Response(JSON.stringify({
    ok: false, error: "통계 조회 실패", step,
    detail: String(err?.message ?? err).slice(0, 500),
    stack: String(err?.stack ?? "").slice(0, 1000),
  }), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;

  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  const url = new URL(req.url);
  const now = new Date();
  const year  = Number(url.searchParams.get("year")  ?? now.getFullYear());
  const month = Number(url.searchParams.get("month") ?? now.getMonth() + 1);

  let memberUid: string;
  try {
    const [member] = await db
      .select({ uid: members.uid })
      .from(members)
      .where(eq(members.id, auth.ctx.member.id))
      .limit(1);
    if (!member) return jsonError("member_not_found", new Error("회원 없음"), 404);
    memberUid = member.uid;
  } catch (err) {
    return jsonError("select_member", err);
  }

  // 월별 집계
  let monthly: any = null;
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)                                                        AS work_days,
        COALESCE(SUM(working_mins), 0)                                 AS total_working_mins,
        COALESCE(SUM(overtime_mins), 0)                                AS total_overtime_mins,
        COUNT(*) FILTER (WHERE status = 'LATE')                        AS late_count,
        COUNT(*) FILTER (WHERE status = 'EARLY_LEAVE')                 AS early_leave_count,
        COUNT(*) FILTER (WHERE work_mode = 'REMOTE')                   AS remote_days,
        COUNT(*) FILTER (WHERE work_mode = 'FIELD')                    AS field_days,
        COUNT(*) FILTER (WHERE work_mode = 'BUSINESS_TRIP')            AS business_trip_days
      FROM att_records
      WHERE member_uid = ${memberUid}
        AND EXTRACT(YEAR FROM date) = ${year}
        AND EXTRACT(MONTH FROM date) = ${month}
    `);
    monthly = result.rows[0] ?? null;
  } catch (err) {
    console.warn("[att-my-stats] 월별 집계 실패:", err);
  }

  // 주별 집계 (해당 월의 주차별)
  let weekly: any[] = [];
  try {
    const result = await db.execute(sql`
      SELECT
        EXTRACT(WEEK FROM date)::int                    AS week_num,
        MIN(date)                                        AS week_start,
        MAX(date)                                        AS week_end,
        COUNT(*)                                         AS work_days,
        COALESCE(SUM(working_mins), 0)                  AS total_working_mins,
        COALESCE(SUM(overtime_mins), 0)                 AS total_overtime_mins
      FROM att_records
      WHERE member_uid = ${memberUid}
        AND EXTRACT(YEAR FROM date) = ${year}
        AND EXTRACT(MONTH FROM date) = ${month}
      GROUP BY EXTRACT(WEEK FROM date)
      ORDER BY week_num
    `);
    weekly = result.rows as any[];
  } catch (err) {
    console.warn("[att-my-stats] 주별 집계 실패:", err);
  }

  return jsonOk({ year, month, memberUid, monthly, weekly });
}
