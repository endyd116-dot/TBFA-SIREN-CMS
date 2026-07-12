/**
 * cron-att-late-streak: 3회 지각 누적 알림 (KST 08:05 = UTC 23:05)
 * schedule: 5 23 * * *
 *
 * R36-Att-Optional A-4:
 * - 직원별 최근 30일 LATE 건수 집계
 * - 임계 N회(기본 3회) 이상 → 슈퍼어드민 + 본인 알림
 *
 * ?dryRun=1 로 검증 가능.
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members } from "../../db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { schedule: "5 23 * * *" };

const LATE_THRESHOLD = parseInt(process.env.ATT_LATE_THRESHOLD ?? "3", 10);
const WINDOW_DAYS = parseInt(process.env.ATT_LATE_WINDOW_DAYS ?? "30", 10);

function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async (req: Request, _ctx: Context) => {
  const start = Date.now();
  const today = kstToday();
  let dryRun = false;
  try { dryRun = new URL(req.url).searchParams.get("dryRun") === "1"; } catch {}
  console.info("[cron-att-late-streak] 시작", today, dryRun ? "(dryRun)" : "");

  try {
    const rows: any = await db.execute(sql`
      SELECT member_uid, COUNT(*) AS late_count
      FROM att_records
      WHERE date >= (${today}::date - (${WINDOW_DAYS}::int || ' days')::interval)
        AND date <= ${today}::date
        AND status = 'LATE'
      GROUP BY member_uid
      HAVING COUNT(*) >= ${LATE_THRESHOLD}
    `);
    const list: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

    if (list.length === 0) {
      console.info("[cron-att-late-streak] 임계 도달자 없음");
      return new Response(jsonKST({ ok: true, durationMs: Date.now() - start, alertCount: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 이름 조회
    const memberIds = list.map(r => parseInt(r.member_uid)).filter(n => !isNaN(n) && n > 0);
    const nameMap = new Map<number, string>();
    if (memberIds.length > 0) {
      try {
        const mRows = await db.execute(sql`
          SELECT id, name FROM members WHERE id = ANY(ARRAY[${sql.raw(memberIds.map(Number).join(","))}]::int[])
        `);
        const list2: any[] = Array.isArray(mRows) ? mRows : (mRows as any).rows ?? [];
        for (const m of list2) nameMap.set(Number(m.id), String(m.name));
      } catch {}
    }

    // 슈퍼어드민 목록
    const superAdmins = await db
      .select({ id: members.id })
      .from(members)
      .where(and(
        eq(members.role as any, "super_admin"),
        eq(members.operatorActive as any, true),
        isNull(members.withdrawnAt),
      ))
      .limit(10);

    let selfAlertCount = 0;
    let supAlertCount = 0;
    const detail: { uid: string; lateCount: number; name: string }[] = [];

    for (const r of list) {
      const uid = String(r.member_uid);
      const lateCount = parseInt(r.late_count);
      const memberId = parseInt(uid);
      const name = nameMap.get(memberId) ?? `#${uid}`;
      detail.push({ uid, lateCount, name });

      if (dryRun) continue;

      // 본인 알림
      if (Number.isFinite(memberId) && memberId > 0) {
        try {
          await sendWorkspaceNotification({
            memberId,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: `최근 ${WINDOW_DAYS}일 지각 ${lateCount}회`,
            body: `최근 ${WINDOW_DAYS}일간 ${lateCount}회 지각이 누적되었습니다. 출근 시간에 유의해 주세요.`,
            actionUrl: "/workspace-attendance.html",
            category: "system" as any,
          });
          selfAlertCount++;
        } catch (err) {
          console.warn(`[cron-att-late-streak] 본인 알림 실패 uid=${uid}:`, err);
        }
      }

      // 슈퍼어드민 알림
      for (const sa of superAdmins) {
        try {
          await sendWorkspaceNotification({
            memberId: sa.id,
            sourceType: "event" as any,
            sourceId: 0,
            notifType: "reminder_3d" as any,
            channel: "bell" as any,
            title: `[근태] ${name} 지각 ${lateCount}회`,
            body: `${name}님이 최근 ${WINDOW_DAYS}일간 ${lateCount}회 지각했습니다. 확인이 필요합니다.`,
            actionUrl: "/cms-tbfa.html#att-ops",
            category: "system" as any,
          });
          supAlertCount++;
        } catch (err) {
          console.warn(`[cron-att-late-streak] 슈퍼어드민 알림 실패 sa=${sa.id}:`, err);
        }
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-late-streak] 완료 — 임계도달:${list.length}명 본인:${selfAlertCount} 슈퍼:${supAlertCount} (${durationMs}ms)${dryRun ? " [dryRun]" : ""}`);

    return new Response(jsonKST({
      ok: true, dryRun, threshold: LATE_THRESHOLD, windowDays: WINDOW_DAYS,
      detail, selfAlertCount, supAlertCount, durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-late-streak] 오류:", err);
    return new Response(jsonKST({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
