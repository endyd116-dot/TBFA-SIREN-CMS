/**
 * /api/migrate-recalc-att-worktime?run=1   — 1회용 (호출 후 파일 삭제)
 *
 * 이미 저장된 근태 기록의 '근무시간·야근시간'을 새 휴게 규칙으로 다시 계산한다.
 *
 * 왜 필요한가:
 *   휴게시간 규칙이 바뀌었다 (2026-07-12).
 *     기존: 4시간만 넘으면 무조건 60분 차감
 *     변경: 8시간 이상 → 60분 / 4시간 초과~8시간 미만 → 30분 / 4시간 이하 → 0분 (근로기준법 §54)
 *   그런데 att_records.working_mins 는 '기록될 당시의 규칙'으로 이미 계산돼 저장돼 있다.
 *   급여는 이 저장값을 읽어 지급일수를 정하므로(8시간=1일 · 4시간=0.5일),
 *   기록을 다시 계산하지 않으면 새 규칙이 급여에 반영되지 않는다.
 *   (실제: 김광일 6/8 반차가 4시간 근무인데 3시간으로 저장돼 있어 0.25일치로 계산됨)
 *
 * 안전:
 *   - 출퇴근 '시각'은 절대 건드리지 않는다. 시각에서 파생되는 근무시간·야근시간만 다시 계산.
 *   - 유연근무 출근 하한(예 08:00)도 기존 계산과 동일하게 적용.
 *   - 여러 번 호출해도 같은 결과 (멱등).
 *
 * GET (기본) : 진단 — 무엇이 얼마나 바뀔지 미리보기 (인증 불필요)
 * GET ?run=1 : 어드민 인증 후 실제 반영
 * GET ?from=2026-06-01&to=2026-06-30 : 기간 한정 (기본: 전체)
 */
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { requireAdmin, guardFailed } from "../../lib/admin-guard";
import { getDefaultPolicy, calcWorkingMins, getFlexRangeMins, flexStartFloor, payDayFraction } from "../../lib/att-utils";

export const config = { path: "/api/migrate-recalc-att-worktime" };

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADER });
}
const rows = (r: any) => ((r as any).rows ?? r ?? []) as any[];

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const from = url.searchParams.get("from") || "2000-01-01";
  const to   = url.searchParams.get("to")   || "2999-12-31";

  if (run) {
    const auth = await requireAdmin(req);
    if (guardFailed(auth)) return auth.res;
  }

  const policy = await getDefaultPolicy();
  if (!policy) return json({ ok: false, error: "근태 정책을 읽지 못했습니다" }, 500);

  const dailyHours = Number(policy.dailyHours) || 8;
  const flexRange = policy.flexEnabled ? await getFlexRangeMins() : 0;

  let list: any[];
  try {
    const r: any = await db.execute(sql`
      SELECT ar.id, ar.member_uid, ar.date::text AS date, ar.status, ar.work_mode,
             ar.check_in_time, ar.check_out_time, ar.working_mins, ar.overtime_mins,
             m.name AS member_name
        FROM att_records ar
        LEFT JOIN members m ON m.id = NULLIF(ar.member_uid,'')::int
       WHERE ar.check_in_time IS NOT NULL
         AND ar.check_out_time IS NOT NULL
         AND ar.date >= ${from}::date
         AND ar.date <= ${to}::date
       ORDER BY ar.date
    `);
    list = rows(r);
  } catch (err: any) {
    return json({ ok: false, step: "select", detail: String(err?.message ?? err).slice(0, 500) }, 500);
  }

  const changed: any[] = [];
  let same = 0, failed = 0;

  for (const r of list) {
    try {
      let calcIn = new Date(r.check_in_time);
      const calcOut = new Date(r.check_out_time);

      /* 유연근무 출근 하한 — 표준출근 -유연범위(예 08:00)보다 이른 출근은 그 하한부터 인정 */
      if (policy.flexEnabled && flexRange > 0) {
        const floor = flexStartFloor(calcIn, String(policy.checkInTime), flexRange);
        if (calcIn.getTime() < floor.getTime()) calcIn = floor;
      }

      const res = calcWorkingMins(calcIn, calcOut, {
        dailyHours,
        breakMins: policy.breakMins,
        breakThresholdHours: Number(policy.breakThresholdHours),
      });

      const oldW = r.working_mins == null ? null : Number(r.working_mins);
      const oldO = Number(r.overtime_mins || 0);
      if (oldW === res.workingMins && oldO === res.overtimeMins) { same++; continue; }

      const oldFrac = payDayFraction(oldW, dailyHours);
      const newFrac = payDayFraction(res.workingMins, dailyHours);

      changed.push({
        id: r.id,
        직원: r.member_name ?? r.member_uid,
        날짜: r.date,
        근무시간: `${oldW ?? "-"}분 → ${res.workingMins}분`,
        야근: oldO !== res.overtimeMins ? `${oldO}분 → ${res.overtimeMins}분` : undefined,
        지급일수: oldFrac !== newFrac ? `${oldFrac} → ${newFrac}일` : undefined,
        _w: res.workingMins,
        _o: res.overtimeMins,
      });
    } catch (err) {
      failed++;
      console.warn(`[recalc-att-worktime] 계산 실패 id=${r.id}:`, err);
    }
  }

  /* ── 진단 모드 ── */
  if (!run) {
    return json({
      ok: true, mode: "diagnose",
      message: changed.length === 0
        ? "다시 계산해도 달라지는 기록이 없습니다 (이미 최신 규칙)"
        : `${changed.length}건의 근무시간이 바뀝니다 (동일 ${same}건)`,
      휴게규칙: `${dailyHours}시간 이상 → ${policy.breakMins}분 / 4시간 초과~${dailyHours}시간 미만 → 30분 / 4시간 이하 → 0분`,
      변경예정: changed.map(({ _w, _o, ...rest }) => rest).slice(0, 60),
      전체: list.length, 변경: changed.length, 동일: same, 실패: failed,
      안내: "어드민 로그인 후 ?run=1 로 호출하면 실제로 반영됩니다 (출퇴근 시각은 건드리지 않습니다)",
    });
  }

  /* ── 실행 ── */
  let updated = 0;
  for (const c of changed) {
    try {
      await db.execute(sql`
        UPDATE att_records
           SET working_mins = ${c._w}, overtime_mins = ${c._o}, updated_at = NOW()
         WHERE id = ${Number(c.id)}
      `);
      updated++;
    } catch (err) {
      failed++;
      console.warn(`[recalc-att-worktime] 갱신 실패 id=${c.id}:`, err);
    }
  }

  return json({
    ok: true, mode: "run",
    message: `근무시간 ${updated}건 재계산 완료 (출퇴근 시각은 그대로)`,
    반영: changed.map(({ _w, _o, ...rest }) => rest).slice(0, 60),
    전체: list.length, 변경: updated, 동일: same, 실패: failed,
    다음: "급여관리에서 해당 월을 재집계하면 새 근무시간이 반영됩니다",
  });
}
