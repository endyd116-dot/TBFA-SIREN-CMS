// netlify/functions/cron-notification-retry.ts
// Phase 8 — 알림 발송 실패 재시도 cron (1시간 주기·:00 정렬)
// 2026-06-25 DB 비용 절감 2차(wake-on-demand): 30분 → 1시간. Netlify 관리형 Neon은
//   autosuspend 최저가 5분 → 깨우는 횟수를 줄여 5분 잠을 더 길게. 모든 빈발 크론을 :00로
//   정렬해 :30 wake 제거(시간당 1회). 실패 재시도 1시간 지연 무해.
//
// 동작:
// - status='pending' AND next_retry_at <= now() AND attempt < 3 인 로그를 최대 50건 처리
// - 지수 백오프: 1s(1차) → 5s(2차) → 25s(3차) — lib/notify-dispatcher.ts retryLog 위임
// - 3회 전부 실패 → status='dead' + super_admin 인앱 알림 (메타-알림은 재시도 없음)

import { jsonKST } from "../../lib/kst";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { retryLog } from "../../lib/notify-dispatcher";
import { notifyAllSuperAdmins } from "../../lib/notify";

export default async (_req: Request) => {
  const now = new Date();
  console.log("[cron-notification-retry] 시작", now.toISOString());

  const stats = { retried: 0, sent: 0, dead: 0, pending: 0, errors: 0 };

  try {
    const res: any = await db.execute(sql`
      SELECT id, attempt
      FROM notification_dispatch_logs
      WHERE status    = 'pending'
        AND next_retry_at <= ${now}
        AND attempt    < 3
      ORDER BY next_retry_at ASC
      LIMIT 50
    `);
    const rows: any[] = Array.isArray(res) ? res : (res as any).rows || [];

    for (const row of rows) {
      stats.retried++;
      const result = await retryLog(Number(row.id));

      if (result.status === "sent") {
        stats.sent++;
      } else if (result.status === "dead") {
        stats.dead++;
        /* dead 도달 → super_admin 인앱 알림 (메타-알림: 재시도 없음) */
        try {
          await notifyAllSuperAdmins({
            category: "system",
            severity: "critical",
            title:    `알림 발송 실패 (dead) — logId=${row.id}`,
            message:  `3차 재시도까지 모두 실패했습니다. 발송 로그를 확인해 주세요.`,
            link:     `/admin/notifications.html?logId=${row.id}`,
          });
        } catch (notifyErr) {
          console.error("[cron-notification-retry] 메타-알림 실패:", notifyErr);
        }
      } else if (result.status === "pending") {
        stats.pending++;
      } else {
        stats.errors++;
      }
    }
  } catch (err: any) {
    console.error("[cron-notification-retry] 실행 오류:", err);
    return new Response(
      jsonKST({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log("[cron-notification-retry] 완료", stats);
  return new Response(jsonKST({ ok: true, ...stats }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "0 * * * *",
};
