/* 근무시간 재계산 → 김광일 6월 재집계 (임시) */
const BASE = 'https://tbfa.co.kr';
let C = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const won = n => Math.round(Number(n || 0)).toLocaleString('ko-KR');

async function q(p, o = {}) {
  const r = await fetch(BASE + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: C },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let j = null; try { j = JSON.parse(await r.text()); } catch (e) {}
  return { s: r.status, j, d: (j && (j.data ?? j)) || {}, err: j?.error };
}

(async () => {
  const lr = await fetch(BASE + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'admin', password: 'admin12345' }),
  });
  C = (lr.headers.getSetCookie() || []).find(x => x.includes('siren_admin_token')).split(';')[0];

  process.stdout.write('배포 대기');
  for (let i = 0; i < 45; i++) {
    const p = await fetch(BASE + '/api/migrate-recalc-att-worktime');
    if (p.status === 200) { console.log('\n배포 반영 확인\n'); break; }
    process.stdout.write('.');
    await sleep(7000);
  }

  /* ── 1. 근무시간 재계산 (출퇴근 시각은 그대로) ── */
  const dry = await q('/api/migrate-recalc-att-worktime');
  console.log('══ 1. 근태 기록 근무시간 재계산 ══');
  console.log('  휴게 규칙:', dry.j.휴게규칙);
  console.log('  ' + dry.j.message);
  for (const c of (dry.j.변경예정 || []).slice(0, 12)) {
    console.log(`   ${c.날짜} ${c.직원}  ${c.근무시간}` + (c.지급일수 ? `   지급일수 ${c.지급일수}` : ''));
  }

  const run = await q('/api/migrate-recalc-att-worktime?run=1');
  console.log('\n  → ' + (run.j.message || run.err));

  /* ── 2. 김광일 6월 재집계 ── */
  console.log('\n══ 2. 김광일 6월 재집계 ══');
  const before = (await q('/api/admin-payroll?year=2026&month=6')).d.rows.find(x => String(x.memberUid) === '65');
  const rc = await q('/api/admin-payroll?action=recalculate&year=2026&month=6&memberUid=65',
    { method: 'POST', body: { force: true } });
  console.log('  대상 ' + rc.d.candidateCount + '명 · 갱신 ' + rc.d.updated + '건'
    + (rc.d.errors?.length ? ' · 오류 ' + JSON.stringify(rc.d.errors) : ''));

  const after = (await q('/api/admin-payroll?year=2026&month=6')).d.rows.find(x => String(x.memberUid) === '65');
  const snap = (await q('/api/admin-payroll?id=' + after.id)).d.slip?.calculationSnapshot || {};
  const a = snap.att || {};

  console.log('\n══ 김광일 6월 급여 — 최종 ══');
  console.log('                   전             후');
  console.log('  근무일수 :  ' + String(before.workingDays).padStart(9) + '   →' + String(after.workingDays).padStart(9) + ' 일');
  console.log('  기본급   :  ' + won(before.baseSalaryMonth).padStart(9) + '   →' + won(after.baseSalaryMonth).padStart(9) + ' 원');
  console.log('  공제     :  ' + won(before.totalDeduction).padStart(9) + '   →' + won(after.totalDeduction).padStart(9) + ' 원');
  console.log('  실수령   :  ' + won(before.netPay).padStart(9) + '   →' + won(after.netPay).padStart(9) + ' 원');
  console.log('  상태     :  ' + after.status + ' (검토 대기)');
  console.log('\n  명세서에 표시되는 근태 근거:');
  console.log('   · 소정근로 미달     ' + (a.shortDays ?? 0) + '일  (반차·반반차 — 일한 만큼 지급)');
  console.log('   · 휴일 출근         ' + (a.offDayWorkDays ?? 0) + '일  (지급 제외)');
  console.log('   · 퇴근 미기록       ' + (a.noCheckoutDays ?? 0) + '일');
  console.log('   · 재택보고서 미제출  ' + (a.unreportedRemoteDays ?? 0) + '일');
  console.log('   · 지각 ' + (a.lateCount ?? 0) + '회 · 결근 ' + (a.absentCount ?? 0) + '회 · 만근 ' + (after.perfectAttendance ? '예' : '아니오'));
})();
