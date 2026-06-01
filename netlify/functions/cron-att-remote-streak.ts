/**
 * cron-att-remote-streak: 연속 재택 N일 알림 (KST 08:00 = UTC 23:00)
 * schedule: 0 23 * * *
 *
 * R36-Att-Optional A-3:
 * - 직원별 최근 연속 REMOTE 출근일 계산
 * - 임계 N일(기본 5일) 이상 → 슈퍼어드민에게 알림
 *
 * 임계값은 att_policies.remoteMaxPerMonth가 있지만 streak 임계는 별도라 환경변수·상수.
 * ?dryRun=1 로 검증 가능.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { members } from "../../db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";

export const config = { schedule: "0 23 * * *" };

const STREAK_THRESHOLD = parseInt(process.env.ATT_REMOTE_STREAK_THRESHOLD ?? "5", 10);

function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async (req: Request, _ctx: Context) => {
  const start = Date.now();
  const today = kstToday();
  let dryRun = false;
  try { dryRun = new URL(req.url).searchParams.get("dryRun") === "1"; } catch {}
  console.info("[cron-att-remote-streak] 시작", today, dryRun ? "(dryRun)" : "");

  try {
    // 최근 14일 REMOTE 기록만 조회 후 직원별 연속 streak 계산
    const rows: any = await db.execute(sql`
      SELECT member_uid, date, work_mode
      FROM att_records
      WHERE date >= (${today}::date - INTERVAL '14 days')
        AND date <= ${today}::date
      ORDER BY member_uid, date DESC
    `);
    const list: any[] = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

    // member별 DESC 정렬된 날짜 순서로 REMOTE 연속 카운트
    const byMember = new Map<string, { date: string; mode: string }[]>();
    for (const r of list) {
      const uid = String(r.member_uid);
      if (!byMember.has(uid)) byMember.set(uid, []);
      byMember.get(uid)!.push({ date: String(r.date), mode: String(r.work_mode ?? "") });
    }

    const overThreshold: { uid: string; streak: number }[] = [];
    for (const [uid, records] of byMember.entries()) {
      let streak = 0;
      for (const rec of records) {
        if (rec.mode === "REMOTE") streak++;
        else break;
      }
      if (streak >= STREAK_THRESHOLD) overThreshold.push({ uid, streak });
    }

    if (overThreshold.length === 0) {
      console.info("[cron-att-remote-streak] 임계 도달자 없음");
      return new Response(JSON.stringify({ ok: true, durationMs: Date.now() - start, alertCount: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 이름 조회
    const memberIds = overThreshold.map(o => Number(o.uid)).filter(n => Number.isFinite(n) && n > 0);
    let nameMap = new Map<number, string>();
    if (memberIds.length > 0) {
      try {
        const mRows = await db.execute(sql`
          SELECT id, name FROM members WHERE id = ANY(${memberIds})
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

    let alertCount = 0;
    if (!dryRun && superAdmins.length > 0) {
      for (const o of overThreshold) {
        const name = nameMap.get(Number(o.uid)) ?? `#${o.uid}`;
        for (const sa of superAdmins) {
          try {
            await sendWorkspaceNotification({
              memberId: sa.id,
              sourceType: "event" as any,
              sourceId: 0,
              notifType: "reminder_3d" as any,
              channel: "bell" as any,
              title: `연속 재택 ${o.streak}일`,
              body: `${name}님이 ${o.streak}일 연속 재택근무 중입니다. 확인이 필요합니다.`,
              actionUrl: "/cms-tbfa.html#att-ops",
              category: "system" as any,
            });
            alertCount++;
          } catch (err) {
            console.warn(`[cron-att-remote-streak] 알림 실패 sa=${sa.id} uid=${o.uid}:`, err);
          }
        }
      }
    }

    const durationMs = Date.now() - start;
    console.info(`[cron-att-remote-streak] 완료 — 임계도달:${overThreshold.length}명 알림:${alertCount}건 (${durationMs}ms)${dryRun ? " [dryRun]" : ""}`);

    return new Response(JSON.stringify({
      ok: true, dryRun, threshold: STREAK_THRESHOLD,
      overThreshold: overThreshold.map(o => ({ uid: o.uid, streak: o.streak, name: nameMap.get(Number(o.uid)) ?? null })),
      alertCount, durationMs,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-att-remote-streak] 오류:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
