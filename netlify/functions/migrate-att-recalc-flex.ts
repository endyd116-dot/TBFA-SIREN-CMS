/**
 * GET /api/migrate-att-recalc-flex        — 진단 (인증 불필요·미리보기)
 * GET /api/migrate-att-recalc-flex?run=1  — 실행 (어드민 인증)
 *
 * 과거 출퇴근 기록의 근무·야근시간을 유연 출근 하한(표준출근-유연범위, 예 08:00) 기준으로 일괄 재계산.
 *   대상: 출근·퇴근이 모두 있는 전체 기록(재택·외근 포함 — 2026-07-10 Swain: 하한은 전 근무형태).
 *   하한 로직 배포 이전에 저장된 기록은 실제 출근시각(예 07:37)부터 계산돼 근무·야근이 과다 산정됨.
 * 멱등: 재실행해도 같은 결과(항상 현재 정책 기준 재계산).
 * 호출 성공 후 파일 삭제 + commit (§6.8).
 */
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { attRecords } from "../../db/schema";
import { sql, and, isNotNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDefaultPolicy, getFlexRangeMins, flexStartFloor } from "../../lib/att-utils";
import { normalizeSessions, recomputeSummary } from "../../lib/att-session";

export const config = { path: "/api/migrate-att-recalc-flex" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export default async function handler(req: Request, _ctx: Context) {
  let step = "start";
  try {
    const url = new URL(req.url);
    const run = url.searchParams.get("run") === "1";

    step = "policy";
    const policy = await getDefaultPolicy();
    if (!policy) throw new Error("근무 정책 없음");
    const flexRange = policy.flexEnabled ? await getFlexRangeMins() : 0;

    step = "select";
    const rows = await db
      .select()
      .from(attRecords)
      .where(and(isNotNull(attRecords.checkInTime), isNotNull(attRecords.checkOutTime)))
      .limit(2000);

    step = "recalc";
    const changes: any[] = [];
    for (const rec of rows as any[]) {
      const sessions = normalizeSessions(rec);
      if (!sessions.length || !sessions[0].in) continue;

      let minStart: Date | null = null;
      if (policy.flexEnabled) {
        try { minStart = flexStartFloor(new Date(sessions[0].in), String(policy.checkInTime), flexRange); } catch {}
      }
      const summary = recomputeSummary(sessions, {
        dailyHours: policy.dailyHours, breakMins: policy.breakMins, breakThresholdHours: policy.breakThresholdHours,
      }, minStart);
      if (summary.workingMins == null) continue;

      const oldW = rec.workingMins == null ? null : Number(rec.workingMins);
      const oldO = Number(rec.overtimeMins ?? 0);
      if (oldW === summary.workingMins && oldO === summary.overtimeMins) continue;

      changes.push({
        id: rec.id, memberUid: rec.memberUid, date: String(rec.date), workMode: rec.workMode,
        working: `${oldW ?? "—"} → ${summary.workingMins}분`,
        overtime: `${oldO} → ${summary.overtimeMins}분`,
        _newW: summary.workingMins, _newO: summary.overtimeMins,
      });
    }

    if (!run) {
      return new Response(JSON.stringify({
        ok: true, mode: "diagnose",
        total_records: rows.length,
        will_change: changes.length,
        preview: changes.slice(0, 30).map(({ _newW, _newO, ...v }) => v),
        hint: "will_change 건이 재계산 대상. 미리보기 확인 후 ?run=1 로 실행.",
      }, null, 2), { headers: JSON_HEADER });
    }

    step = "auth";
    const auth = await requireAdmin(req);
    if (!auth.ok) return (auth as any).res;

    step = "update";
    let updated = 0;
    for (const c of changes) {
      await db.update(attRecords)
        .set({ workingMins: c._newW, overtimeMins: c._newO, updatedAt: new Date() } as any)
        .where(eq(attRecords.id, c.id));
      updated++;
    }

    return new Response(JSON.stringify({
      ok: true, mode: "executed",
      updated,
      hint: "과거 기록 근무·야근 재계산 완료(하한 반영). 출퇴근 기록에서 확인 후 파일 삭제 + commit.",
    }, null, 2), { headers: JSON_HEADER });
  } catch (err: any) {
    return new Response(JSON.stringify({
      ok: false, error: "마이그 실패", step,
      detail: String(err?.message || err).slice(0, 500),
    }), { status: 500, headers: JSON_HEADER });
  }
}
