/**
 * cron-payroll-remind — 급여명세 수령확인(전자서명) 미완료 독촉
 *
 * 매일 UTC 01:00 (KST 10:00) 1회.
 *   ※ 빈발 크론 금지 정책 — DB가 계속 깨어 있으면 비용이 오른다. 하루 1회·정시 정렬.
 *
 * 대상: 교부된 지 3일이 지났는데 아직 서명하지 않은 명세서
 *   - 3일 간격으로 최대 3번까지만 알린다 (그 이상은 담당자가 직접 챙기는 게 맞다)
 *   - 이의 제기한 건은 독촉하지 않는다 (이미 담당자 처리 대기 중)
 * 미서명자가 여럿이면 슈퍼어드민에게도 현황을 한 번 알린다.
 */
import { jsonKST } from "../../lib/kst";
import type { Config, Context } from "@netlify/functions";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { sendWorkspaceNotification } from "../../lib/workspace-logger";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config: Config = {
  schedule: "0 1 * * *",     // UTC 01:00 = KST 10:00
};

const MAX_REMINDERS = 3;
const GRACE_DAYS = 3;        // 교부 후 며칠 지나서부터 독촉
const INTERVAL_DAYS = 3;     // 독촉 간격

export default async function handler(_req: Request, _ctx: Context) {
  const started = Date.now();
  const summary: any = { startedAt: new Date().toISOString() };

  let targets: any[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT s.id, s.member_uid, s.pay_year, s.pay_month, s.reminder_count, s.issued_at,
             m.name AS member_name
        FROM payroll_slips s
        LEFT JOIN members m ON m.id = NULLIF(s.member_uid,'')::int
       WHERE s.status IN ('SENT','PAID')
         AND s.ack_status = 'PENDING'
         AND s.issued_at IS NOT NULL
         AND s.issued_at < NOW() - make_interval(days => ${GRACE_DAYS})
         AND s.reminder_count < ${MAX_REMINDERS}
         AND (s.reminder_sent_at IS NULL
              OR s.reminder_sent_at < NOW() - make_interval(days => ${INTERVAL_DAYS}))
       ORDER BY s.issued_at
       LIMIT 200
    `);
    targets = ((r as any).rows ?? r ?? []) as any[];
  } catch (err: any) {
    summary.fatal = `대상 조회 실패: ${String(err?.message ?? err).slice(0, 300)}`;
    return new Response(jsonKST({ ok: false, summary }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  summary.candidates = targets.length;
  let sent = 0, failed = 0;

  for (const t of targets) {
    const memberId = Number(t.member_uid);
    if (!Number.isFinite(memberId)) continue;
    const period = `${t.pay_year}년 ${String(t.pay_month).padStart(2, "0")}월`;
    const nth = Number(t.reminder_count || 0) + 1;

    try {
      await sendWorkspaceNotification({
        memberId,
        sourceType: "event" as any,
        sourceId: Number(t.id),
        notifType: nth >= MAX_REMINDERS ? "overdue" : "reminder_3d",
        channel: "bell",
        title: `[재안내] ${period} 급여명세서 수령 확인이 아직 완료되지 않았습니다`,
        body: "명세서를 열어 내용을 확인하고 전자서명해 주세요. 내용이 사실과 다르면 이의를 제기할 수 있습니다.",
        actionUrl: `/workspace-attendance.html#payroll-slip=${t.id}`,
        category: "system",
      });
      await db.execute(sql`
        UPDATE payroll_slips
           SET reminder_sent_at = NOW(), reminder_count = reminder_count + 1, updated_at = NOW()
         WHERE id = ${Number(t.id)}
      `);
      sent++;
    } catch (err) {
      failed++;
      console.warn(`[cron-payroll-remind] 독촉 실패 (slip=${t.id}):`, err);
    }
  }

  summary.reminded = sent;
  summary.failed = failed;

  /* 관리자에게 현황 요약 — 알림 폭탄 방지를 위해 실제 독촉이 나간 날만 */
  if (sent > 0) {
    try {
      const names = targets.slice(0, 8).map((t: any) => t.member_name || `회원 ${t.member_uid}`);
      await notifyAllSuperAdmins({
        category: "system",
        severity: "info",
        title: `급여명세 수령확인 미완료 ${sent}건 — 재안내 발송`,
        message: `${names.join(", ")}${targets.length > 8 ? ` 외 ${targets.length - 8}명` : ""} 님이 아직 전자서명하지 않았습니다.`,
        link: "/cms-tbfa.html#payroll",
      });
      summary.notified = true;
    } catch (err: any) {
      summary.notifyError = String(err?.message ?? err).slice(0, 200);
    }
  }

  summary.elapsedMs = Date.now() - started;
  return new Response(jsonKST({ ok: true, summary }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
