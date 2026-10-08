// netlify/functions/migrate-break-recalc.ts
// [1회용] 2026-10-08 휴게 차감 연속화(Swain A안) — 기존 근태 기록의 근무·야근시간을 새 규칙으로 재계산.
//
//   GET          : 어드민(super_admin) 로그인 상태에서 모의 계산 — 달라지는 기록 목록만 (쓰기 없음)
//   GET ?run=1   : 실제 갱신 (att_records.working_mins · overtime_mins)
//   ?from=YYYY-MM-DD (기본 2026-09-01) — 8월(명세서 발송 완료 달)은 건드리지 않는다
//
// 계산은 퇴근 처리(att-checkout)와 똑같은 함수(normalizeSessions → flexStartFloor → recomputeSummary)를
// 그대로 쓴다. 규칙이 바뀐 곳은 lib/att-utils.ts breakMinsFor 하나뿐이므로, 이 함수는 "그 규칙으로
// 다시 계산했을 때 달라지는 기록"만 골라 갱신한다. 두 번 호출해도 두 번째는 0건(멱등).
// 호출 성공·급여 재집계 확인 후 이 파일 삭제 + 커밋 (1회용 보안 원칙).
import { jsonKST } from "../../lib/kst";
import { db } from "../../db/index";
import { attRecords } from "../../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getDefaultPolicy, getFlexRangeMins, flexStartFloor } from "../../lib/att-utils";
import { normalizeSessions, recomputeSummary } from "../../lib/att-session";

export const config = { path: "/api/migrate-break-recalc" };

function json(body: unknown, status = 200) {
  return new Response(jsonKST(body), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request) {
  const auth = await requireAdmin(req);
  if (guardFailed(auth)) return auth.res;
  const role = (auth as any).ctx?.member?.role ?? "";
  if (role !== "super_admin") return json({ ok: false, error: "슈퍼어드민 전용" }, 403);

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const fromParam = url.searchParams.get("from") ?? "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : "2026-09-01";

  try {
    const policy = await getDefaultPolicy();
    if (!policy) return json({ ok: false, error: "기본 근무 정책이 없습니다", step: "no_policy" }, 500);
    const flexRange = policy.flexEnabled ? await getFlexRangeMins() : null;

    const rows = await db.select().from(attRecords)
      .where(sql`${attRecords.date} >= ${from}::date AND ${attRecords.checkOutTime} IS NOT NULL`)
      .orderBy(attRecords.date, attRecords.memberUid);

    const changes: Array<{
      id: number; memberUid: string; date: string; status: string;
      workingMins: { before: number | null; after: number };
      overtimeMins: { before: number; after: number };
    }> = [];

    for (const rec of rows) {
      const sessions = normalizeSessions(rec);
      if (!sessions.length) continue;
      let minStart: Date | null = null;
      if (flexRange != null && sessions[0].in) {
        minStart = flexStartFloor(new Date(sessions[0].in), String(policy.checkInTime), flexRange);
      }
      const s = recomputeSummary(sessions, {
        dailyHours: policy.dailyHours, breakMins: policy.breakMins, breakThresholdHours: policy.breakThresholdHours,
      }, minStart);
      if (s.workingMins == null) continue;                     // 진행 중(퇴근 미확정) → 건너뜀
      const before = rec.workingMins == null ? null : Number(rec.workingMins);
      const beforeOT = Number(rec.overtimeMins ?? 0);
      if (before === s.workingMins && beforeOT === s.overtimeMins) continue;
      changes.push({
        id: rec.id, memberUid: String(rec.memberUid), date: String(rec.date), status: String(rec.status),
        workingMins: { before, after: s.workingMins },
        overtimeMins: { before: beforeOT, after: s.overtimeMins },
      });
    }

    let updated = 0;
    if (run) {
      for (const c of changes) {
        /* att-checkout·att-checkin 과 같은 관례 — 이 테이블의 쓰기 페이로드는 any 캐스트(스키마 타입 추론 한계) */
        await db.update(attRecords)
          .set({ workingMins: c.workingMins.after, overtimeMins: c.overtimeMins.after, updatedAt: new Date() } as any)
          .where(eq(attRecords.id, c.id));
        updated++;
      }
    }

    return json({
      ok: true,
      mode: run ? "applied" : "dry-run",
      from,
      checked: rows.length,
      changeCount: changes.length,
      updated,
      changes,
      next: run
        ? "급여관리 → 해당 월 [재집계] 로 명세서에 반영하세요"
        : "목록이 맞으면 주소 끝에 ?run=1 을 붙여 다시 호출하세요",
    });
  } catch (err: any) {
    return json({
      ok: false, error: "근무시간 재계산 실패", step: "recalc",
      detail: String(err?.message ?? err).slice(0, 500),
      stack: String(err?.stack ?? "").slice(0, 1000),
    }, 500);
  }
}
