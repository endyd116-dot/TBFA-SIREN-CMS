/**
 * cron-att-remote-deadline — 재택근무 보고서 제출 기한 안내·확정
 *
 * 매일 UTC 00:00 (KST 09:00) 1회.
 *   ※ 빈발 크론 금지 정책 — 하루 1회·정시 정렬 (DB를 계속 깨워두지 않는다)
 *
 * 재택일 D 기준 (마감 = D+3 자정):
 *   - D+2 (마감 하루 전) → "내일까지 안 내면 근무 불인정"
 *   - D+3 (마감 당일)    → "오늘 자정 마감 — 지나면 근무 불인정"
 *   - D+4 (마감 다음 날) → "근무 불인정 확정" (직원) + 관리자에게 요약
 * 같은 날짜에 대해 각 시점당 한 번만 나간다 (남은 일수로 판정 · 크론이 하루 1회).
 *
 * 이미 낸 보고서(SUBMITTED)·관리자 예외 인정(EXEMPTED)은 대상에서 빠진다.
 */
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import { notifyAllSuperAdmins } from "../../lib/notify";
import {
  REMOTE_REPORT_REQUIRED_FROM, REMOTE_REPORT_DEADLINE_DAYS,
  todayKstDate, daysLeftToDeadline, reportDeadline,
} from "../../lib/att-remote-policy";

export const config: Config = {
  schedule: "0 0 * * *",      // UTC 00:00 = KST 09:00
};

export default async function handler(_req: Request, _ctx: Context) {
  const started = Date.now();
  const today = todayKstDate();
  const summary: any = { today, startedAt: new Date().toISOString() };

  /* 미제출 재택일 — 오늘 기준으로 안내할 구간(마감 1일 전 ~ 마감 다음 날)만 */
  let rows: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT ar.member_uid, ar.date::text AS date, m.name AS member_name
        FROM att_records ar
        LEFT JOIN att_remote_work_reports rep
          ON rep.member_uid = ar.member_uid AND rep.date = ar.date
         AND rep.status IN ('SUBMITTED','EXEMPTED')
        LEFT JOIN members m ON m.id = NULLIF(ar.member_uid,'')::int
       WHERE ar.work_mode = 'REMOTE'
         AND ar.status IN ('NORMAL','LATE','EARLY_LEAVE')
         AND ar.date >= ${REMOTE_REPORT_REQUIRED_FROM}::date
         -- 마감 하루 전(D+2) ~ 마감 다음 날(D+4) 구간만
         AND ar.date >= (CURRENT_DATE - INTERVAL '${sql.raw(String(REMOTE_REPORT_DEADLINE_DAYS + 1))} days')
         AND ar.date <= (CURRENT_DATE - INTERVAL '${sql.raw(String(REMOTE_REPORT_DEADLINE_DAYS - 1))} days')
         AND rep.id IS NULL
       ORDER BY ar.date
       LIMIT 300
    `);
    rows = ((r as any).rows ?? r ?? []) as any[];
  } catch (err: any) {
    summary.fatal = `대상 조회 실패: ${String(err?.message ?? err).slice(0, 300)}`;
    return new Response(JSON.stringify({ ok: false, summary }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  summary.candidates = rows.length;
  let warned = 0, lastCall = 0, confirmed = 0, failed = 0;
  const unrecognized: string[] = [];

  for (const r of rows) {
    const memberId = Number(r.member_uid);
    if (!Number.isFinite(memberId)) continue;
    const date = String(r.date).slice(0, 10);
    const left = daysLeftToDeadline(date, today);

    let title = "", body = "", type: any = "reminder_3d";
    if (left === 1) {
      title = `[내일 마감] ${date} 재택근무 보고서를 아직 내지 않았습니다`;
      body = `내일(${reportDeadline(date)}) 자정까지 제출하지 않으면 그 날은 근무로 인정되지 않습니다 (급여 산정 제외).`;
      type = "reminder_1d";
    } else if (left === 0) {
      title = `[오늘 마감] ${date} 재택근무 보고서 제출 기한이 오늘까지입니다`;
      body = "오늘 자정까지 제출하지 않으면 그 날은 근무로 인정되지 않습니다 (급여 산정 제외).";
      type = "reminder_2h";
    } else if (left === -1) {
      title = `[근무 불인정] ${date} 재택근무가 보고서 미제출로 불인정 처리되었습니다`;
      body = "제출 기한이 지나 그 날은 급여 산정에서 제외됩니다. 사정이 있으면 관리자에게 예외 인정을 요청하세요.";
      type = "overdue";
      unrecognized.push(`${r.member_name ?? memberId}(${date})`);
    } else {
      continue;   // 안내 구간 밖
    }

    try {
      await sendWorkspaceNotification({
        memberId,
        sourceType: "event" as any,
        sourceId: 0,
        notifType: type,
        channel: "bell",
        title, body,
        actionUrl: "/workspace-attendance.html",
        category: "system",
      });
      if (left === 1) warned++;
      else if (left === 0) lastCall++;
      else confirmed++;
    } catch (err) {
      failed++;
      console.warn(`[cron-att-remote-deadline] 알림 실패 member=${memberId} date=${date}:`, err);
    }
  }

  summary.warned = warned;         // 내일 마감
  summary.lastCall = lastCall;     // 오늘 마감
  summary.confirmed = confirmed;   // 불인정 확정
  summary.failed = failed;

  /* 불인정이 확정된 건이 있으면 관리자에게 한 번에 요약 — 예외 인정이 필요한지 판단하도록 */
  if (unrecognized.length > 0) {
    try {
      await notifyAllSuperAdmins({
        category: "system",
        severity: "warning",
        title: `재택근무 보고서 미제출로 근무 불인정 ${unrecognized.length}건`,
        message:
          `${unrecognized.slice(0, 10).join(", ")}${unrecognized.length > 10 ? ` 외 ${unrecognized.length - 10}건` : ""}\n` +
          "사정이 있는 건은 근태 관리에서 '예외 인정'으로 근무를 되살릴 수 있습니다.",
        link: "/cms-tbfa.html#att-ops",
      });
      summary.notifiedAdmins = true;
    } catch (err: any) {
      summary.notifyError = String(err?.message ?? err).slice(0, 200);
    }
  }

  summary.elapsedMs = Date.now() - started;
  return new Response(JSON.stringify({ ok: true, summary }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
