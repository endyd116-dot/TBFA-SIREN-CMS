/**
 * cron-martyrdom-deadline — 순직 기한 임박·소멸시효 알림 + 저장용량 임계 알림
 *
 * 스케줄: KST 08:00 = UTC 23:00 (netlify.toml: schedule = "0 23 * * *")
 *
 * 1. pending 기한 중 임박(일반 D-7·소멸시효 D-30) + 미알림(alerted_at NULL) → 운영자 알림 + alerted_at 기록
 * 2. 기한 지남(due_date < 오늘) → status='overdue' + 알림(미알림 한정)
 * 3. 저장 용량 SUM(size_bytes) ≥ MARTYRDOM_STORAGE_ALERT_GB → super_admin 알림(백업 후 수동 파기 권장)
 *
 * notifyMartyrdomAdmins 재사용(notifications·신규 테이블 0).
 */
import { todayKST, jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { notifyMartyrdomAdmins } from "../../lib/martyrdom-notify";

export const config = { schedule: "0 23 * * *" };

function dDay(due: string): number {
  const d = new Date(due + "T00:00:00Z").getTime();
  const today = new Date(todayKST() + "T00:00:00Z").getTime();
  return Math.round((d - today) / 86400000);
}

export default async (_req: Request, _ctx: Context) => {
  const result = { imminent: 0, overdue: 0, storageAlert: false };
  console.info("[cron-martyrdom-deadline] start");

  try {
    /* ── 1·2. 기한 점검 (pending·90일 이내 + 지난 것) ── */
    const dr: any = await db.execute(sql.raw(`
      SELECT d.id, d.case_id AS "caseId", d.label, d.kind, d.due_date AS "dueDate", d.alerted_at AS "alertedAt",
             c.title AS "caseTitle", c.assigned_admin_id AS "assignedAdminId"
      FROM martyrdom_deadlines d
      JOIN martyrdom_cases c ON c.id = d.case_id
      WHERE d.status = 'pending' AND d.due_date <= ((NOW() AT TIME ZONE 'Asia/Seoul')::date + INTERVAL '90 days')
      ORDER BY d.due_date ASC
    `));
    const rows = dr?.rows ?? dr ?? [];

    for (const d of rows) {
      const due = d.dueDate ? String(d.dueDate).slice(0, 10) : null;
      if (!due) continue;
      const dd = dDay(due);
      const kind = String(d.kind || "custom");
      const alreadyAlerted = !!d.alertedAt;
      const assignedAdminId = d.assignedAdminId ? Number(d.assignedAdminId) : null;
      const caseId = Number(d.caseId);
      const threshold = kind === "statute_limit" ? 30 : 7;

      /* 기한 지남 → overdue + 알림 */
      if (dd < 0) {
        await db.execute(sql.raw(`UPDATE martyrdom_deadlines SET status='overdue', updated_at=NOW() WHERE id = ${Number(d.id)}`)).catch(() => {});
        if (!alreadyAlerted) {
          await notifyMartyrdomAdmins({
            caseId, assignedAdminId,
            title: "순직 지원 — 기한 경과",
            message: `[${String(d.caseTitle || "")}] "${String(d.label || "")}" 기한이 지났습니다(${due}, D+${Math.abs(dd)}).`,
            severity: "critical",
          });
          await db.execute(sql.raw(`UPDATE martyrdom_deadlines SET alerted_at=NOW() WHERE id = ${Number(d.id)}`)).catch(() => {});
          result.overdue++;
        }
        continue;
      }

      /* 임박(D-threshold 이내) + 미알림 → 알림 */
      if (dd <= threshold && !alreadyAlerted) {
        const sev = kind === "statute_limit" ? "critical" : "warning";
        await notifyMartyrdomAdmins({
          caseId, assignedAdminId,
          title: kind === "statute_limit" ? "순직 지원 — 소멸시효 임박" : "순직 지원 — 기한 임박",
          message: `[${String(d.caseTitle || "")}] "${String(d.label || "")}" 기한 D-${dd} (${due}). 준비 상태를 확인하세요.`,
          severity: sev,
        });
        await db.execute(sql.raw(`UPDATE martyrdom_deadlines SET alerted_at=NOW() WHERE id = ${Number(d.id)}`)).catch(() => {});
        result.imminent++;
      }
    }

    /* ── 3. 저장 용량 임계 ── */
    try {
      const alertGb = Number(process.env.MARTYRDOM_STORAGE_ALERT_GB || 20);
      const sr: any = await db.execute(sql.raw(`SELECT COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM martyrdom_case_documents`));
      const bytes = Number((sr?.rows ?? sr ?? [])[0]?.bytes || 0);
      const gb = Math.round((bytes / (1024 ** 3)) * 100) / 100;
      if (gb >= alertGb) {
        await notifyMartyrdomAdmins({
          title: "순직 지원 — 저장 용량 임계 초과",
          message: `순직 자료 저장 용량 ${gb}GB (임계 ${alertGb}GB). 백업 후 불필요 원본을 수동 파기하세요.`,
          severity: "warning",
        });
        result.storageAlert = true;
      }
    } catch (e: any) { console.warn("[cron-martyrdom-deadline] 용량 점검 실패", e?.message); }

    console.info(`[cron-martyrdom-deadline] done — 임박 ${result.imminent} · 경과 ${result.overdue} · 용량알림 ${result.storageAlert}`);
    return new Response(jsonKST({ ok: true, ...result }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[cron-martyrdom-deadline] 예외:", err?.message, err?.stack);
    return new Response(jsonKST({ ok: false, error: String(err?.message || err).slice(0, 300) }), { status: 500 });
  }
};
