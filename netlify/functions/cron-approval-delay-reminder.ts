/**
 * netlify/functions/cron-approval-delay-reminder.ts
 *
 * 매일 KST 09:00 (UTC 00:00) 실행.
 * 지출 결재가 같은 단계에서 오래 멈춰 있으면(pending, updated_at 기준) 결재자에게 리마인드.
 *
 * 2단계:
 *   48h  — 현재 단계 결재 대상(국장/이사장)에게 리마인드
 *   120h — 위 대상 + 이사장(super_admin) 전원에게 에스컬레이션 알림
 *
 * 중복 발송 방지: notifications 테이블에서 같은 결재건(refId)·같은 단계 마커(title에 포함)로
 * 최근 20시간 내 이미 보낸 알림이 있으면 skip (cron-workspace-due-reminder.ts와 동일 패턴).
 */
import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyMany } from "../../lib/notify";

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

interface Stage {
  marker: "48H" | "120H";
  hoursLow: number;
  escalate: boolean;
}
const STAGES: Stage[] = [
  { marker: "48H", hoursLow: 48, escalate: false },
  { marker: "120H", hoursLow: 120, escalate: true },
];

async function fetchStalled(hoursLow: number): Promise<any[]> {
  const res = await db.execute(sql`
    SELECT id, title, amount, steps, current_step, drafter_name, updated_at
      FROM approval_requests
     WHERE status = 'pending'
       AND updated_at <= NOW() - (${hoursLow}::int * INTERVAL '1 hour')
     LIMIT 300
  `);
  return rowsOf(res);
}

async function alreadyNotified(requestId: number, memberId: number, marker: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM notifications
     WHERE recipient_id = ${memberId}
       AND ref_table = 'approval_requests'
       AND ref_id = ${requestId}
       AND title ILIKE ${"%[결재지연-" + marker + "]%"}
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1
  `);
  return rowsOf(res).length > 0;
}

export default async (_req: Request, _ctx: Context) => {
  const startedAt = Date.now();
  let totalSent = 0;
  let totalSkipped = 0;
  const detail: any[] = [];

  for (const stage of STAGES) {
    let rows: any[] = [];
    try {
      rows = await fetchStalled(stage.hoursLow);
    } catch (err: any) {
      console.error("[cron-approval-delay] fetchStalled 실패:", stage.marker, err);
      detail.push({ stage: stage.marker, error: String(err?.message || err).slice(0, 200) });
      continue;
    }

    for (const r of rows) {
      const steps: string[] = Array.isArray(r.steps) ? r.steps : [];
      const curRole = steps[Number(r.current_step) || 0];
      if (!curRole) continue;

      let approverIds: number[] = [];
      try {
        const ares = await db.execute(sql`
          SELECT id FROM members
           WHERE type = 'admin' AND operator_active = TRUE AND status = 'active'
             AND role IN (${curRole}, 'super_admin')
        `);
        approverIds = rowsOf(ares).map((a: any) => Number(a.id)).filter((n) => Number.isFinite(n));
      } catch (err) {
        console.warn("[cron-approval-delay] 대상 조회 실패:", r.id, err);
        continue;
      }
      if (stage.escalate) {
        try {
          const sres = await db.execute(sql`
            SELECT id FROM members
             WHERE type = 'admin' AND operator_active = TRUE AND status = 'active' AND role = 'super_admin'
          `);
          rowsOf(sres).forEach((s: any) => {
            const id = Number(s.id);
            if (Number.isFinite(id) && !approverIds.includes(id)) approverIds.push(id);
          });
        } catch (err) {
          console.warn("[cron-approval-delay] 이사장 조회 실패:", r.id, err);
        }
      }
      if (approverIds.length === 0) continue;

      const days = Math.floor(stage.hoursLow / 24);
      const title = `[결재지연-${stage.marker}] 지출 결재가 ${days}일째 대기 중`;
      const message = `${r.drafter_name || "기안자"}님의 ${Number(r.amount).toLocaleString()}원 지출 결재 "${r.title}"가 ${days}일째 결재를 기다리고 있어요.${stage.escalate ? " (이사장 확인 요청)" : ""}`;

      for (const memberId of approverIds) {
        try {
          if (await alreadyNotified(Number(r.id), memberId, stage.marker)) { totalSkipped++; continue; }
          const sent = await notifyMany([memberId], {
            recipientType: "operator", category: "system", severity: stage.escalate ? "critical" : "warning",
            title, message, link: "/cms-tbfa.html#approval-inbox",
            refTable: "approval_requests", refId: Number(r.id),
          });
          if (sent > 0) totalSent++; else totalSkipped++;
        } catch (err) {
          console.warn("[cron-approval-delay] 알림 발송 실패:", { requestId: r.id, memberId, err });
        }
      }
    }
  }

  const ms = Date.now() - startedAt;
  console.log("[cron-approval-delay] done", { totalSent, totalSkipped, ms });
  return new Response(jsonKST({
    ok: true, totalSent, totalSkipped, elapsedMs: ms, detail,
  }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
};

/* schedule: 매일 UTC 00:00 = KST 09:00. path 금지 (Netlify Scheduled Function 제약) */
export const config = {
  schedule: "0 0 * * *",
};
