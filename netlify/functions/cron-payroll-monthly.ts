/**
 * cron-payroll-monthly
 *
 * Scheduled Function — 매월 1일 UTC 17:00 (KST 익일 02:00) 실행.
 * (트리거 §3.1 — schedule: "0 17 1 * *")
 *
 * 동작:
 *  1. 직전 달(KST 기준) 자동 산출
 *  2. lib/payroll-calc.ts 의 calculatePayrollForMonth 호출
 *     - 후보 회원 SELECT (active·운영자·baseSalary>0)
 *     - 각 회원 att·leave·quarterly 집계 + 급여 구성 계산
 *     - payroll_slips UPSERT (DRAFT — REVIEWED 이상 보존)
 *  3. 슈퍼어드민 알림 발송 — "{YYYY}년 {MM}월 급여 명세서 N건 생성, 검토 필요"
 */
import { jsonKST } from "../../lib/kst";
import type { Config, Context } from "@netlify/functions";
import { calculatePayrollForMonth, previousMonthKST } from "../../lib/payroll-calc";
import { notifyAllSuperAdmins } from "../../lib/notify";

export const config: Config = {
  schedule: "0 17 1 * *",        // UTC 매월 1일 17:00 = KST 매월 2일 02:00 (직전 달 집계)
};

export default async function handler(_req: Request, _ctx: Context) {
  const started = Date.now();
  const { year, month } = previousMonthKST();
  const summary: any = { year, month, startedAt: new Date().toISOString() };

  try {
    const r = await calculatePayrollForMonth(year, month, { force: false });
    summary.candidateCount = r.candidateCount;
    summary.created = r.created;
    summary.updated = r.updated;
    summary.skipped = r.skipped;
    summary.errorCount = r.errors.length;
    summary.errors = r.errors.slice(0, 10);

    /* 알림 — 후보가 있을 때만 발송 */
    if (r.candidateCount > 0) {
      try {
        const total = r.created + r.updated;
        await notifyAllSuperAdmins({
          category: "system",
          severity: total > 0 ? "info" : "warning",
          title: `${year}년 ${String(month).padStart(2, "0")}월 급여 명세서 자동 생성`,
          message: total > 0
            ? `명세서 ${total}건 생성 (신규 ${r.created} · 갱신 ${r.updated}) — 검토 필요 (보류 ${r.skipped} · 오류 ${r.errors.length})`
            : `대상 ${r.candidateCount}명 중 신규 생성 0건 (보류 ${r.skipped} · 오류 ${r.errors.length})`,
          link: "/cms-tbfa.html#payroll",
        });
        summary.notified = true;
      } catch (e: any) {
        summary.notifyError = String(e?.message || e).slice(0, 200);
      }
    } else {
      summary.notified = false;
      summary.note = "후보 회원 0명 — 알림 생략";
    }
  } catch (err: any) {
    summary.fatal = String(err?.message || err).slice(0, 500);
    /* 치명 오류도 슈퍼어드민에 알림 */
    try {
      await notifyAllSuperAdmins({
        category: "system",
        severity: "critical",
        title: `${year}년 ${String(month).padStart(2, "0")}월 급여 자동 집계 실패`,
        message: summary.fatal,
        link: "/cms-tbfa.html#payroll",
      });
    } catch { /* 알림 실패도 무시 — 본 작업이 우선 */ }
  }

  summary.elapsedMs = Date.now() - started;

  return new Response(jsonKST({ ok: !summary.fatal, summary }), {
    status: summary.fatal ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
}
