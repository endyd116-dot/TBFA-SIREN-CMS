// 장부 1단계 검증 — 설계서 §4 Q2~Q16
// 사용: BASE=https://tbfa.co.kr ADMIN_ID=... ADMIN_PW=... node scripts/e2e/ledger-verify.mjs
// BASE를 로컬 시험 서버로 주면 같은 시나리오를 로컬 DB에서 돈다. LOCAL=1이면 로그인을 건너뛴다.
//
// 시험 전표는 전부 2099 시험 연도로 만든다. 실제 2026·2027 장부에는 쓰지 않는다.
// 끝난 뒤 /api/migrate-ledger-foundation?cleanup=1 로 지운다(이 스크립트는 지우지 않는다).
const BASE = process.env.BASE || 'https://tbfa.co.kr';
const LOCAL = process.env.LOCAL === '1';
const YEAR = 2099;

let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

const check = (name, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; failures.push(name); }
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  let json = null;
  try { json = await res.json(); } catch { /* 본문 없음 */ }
  return { status: res.status, ok: res.status < 400 && json?.ok !== false, json, data: json?.data };
}

const reasonOf = (r) => [r.json?.error, ...(r.json?.missing || [])].filter(Boolean).join(' / ').slice(0, 120);

async function main() {
  if (!LOCAL) {
    const login = await api('POST', '/api/admin/login', { id: process.env.ADMIN_ID, password: process.env.ADMIN_PW });
    check('관리자 로그인', login.ok, String(login.status));
    if (!login.ok) return;
  }

  /* 기존 화면 숫자 기록(Q15) */
  const thisYear = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
  const snapshot = async () => {
    const pl = await api('GET', `/api/admin-finance-pl-summary?fiscalYear=${thisYear}`);
    const budget = await api('GET', `/api/admin-finance-budget-list?year=${thisYear}`);
    return JSON.stringify({
      expenditure: pl.data?.expenditure?.total ?? null,
      net: pl.data?.netIncome ?? null,
      executed: budget.data?.totalExecuted ?? null,
    });
  };
  const before = await snapshot();

  /* 기준 정보 */
  const masters = await api('GET', '/api/admin-ledger-masters');
  check('Q1 기준 정보 조회', masters.ok, reasonOf(masters));
  if (!masters.ok) return;
  const M = masters.data;
  check('Q1 계정과목 93개', M.accounts.length === 93, String(M.accounts.length));
  check('Q1 실제 기표 계정 74개', M.accounts.filter((a) => !a.hasChildren).length === 74);
  check('Q1 사업 8개·재원 5개', M.programs.length >= 8 && M.funds.length >= 5);
  check('Q1 정관 근거 있는 사업 4개', M.programs.filter((p) => p.code.startsWith('P') && p.charterRef).length === 4);
  check('Q1 2026 장부 시작일 11월 25일', M.fiscalYears.find((f) => f.year === 2026)?.startDate === '2026-11-25');

  const acc = (code) => M.accounts.find((a) => a.code === code);
  check('Q1 전용계좌 기본 지정', M.accounts.find((a) => a.systemRole === 'cash_default')?.code === '1012');
  check('Q1 후원회원 후원금 계정 4011 개인기부금', acc('4011')?.statementLine === 'donation_individual');

  const fund = (code) => M.funds.find((f) => f.code === code).id;
  const program = (code) => M.programs.find((p) => p.code === code).id;
  const F01 = fund('F01');
  const P05 = program('P05');

  /* 시험 연도 */
  const yr = await api('POST', '/api/admin-ledger-fiscal-year', {
    year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, reason: 'E2E 시험',
  });
  check('시험 연도 2099 생성', yr.ok, reasonOf(yr));

  const voucher = async (over) => api('POST', '/api/admin-voucher-create', {
    voucherDate: `${YEAR}-03-10`, description: 'E2E 시험', ...over,
  });
  const submit = (id) => api('POST', '/api/admin-voucher-submit', { id });
  const approve = (id) => api('POST', '/api/admin-voucher-approve', { id, action: 'approve' });

  /* Q3 지출 전표 */
  const rent = await voucher({
    voucherType: 'expense', description: 'E2E 임차료', payeeName: '시험빌딩',
    lines: [
      { accountCode: '5031', debit: 600000, credit: 0, functionCode: 'admin', fundId: F01 },
      { accountCode: '5031', debit: 400000, credit: 0, functionCode: 'service', programId: P05, fundId: F01 },
      { accountCode: '1012', debit: 0, credit: 1000000 },
    ],
  });
  check('Q3 금액 나누기 전표 저장', rent.ok, reasonOf(rent));
  const rentId = rent.data?.voucherId;
  const detail = await api('GET', `/api/admin-voucher-detail?id=${rentId}`);
  check('Q3 분개 3줄 저장', detail.data?.voucher?.lines?.length === 3);
  check('Q3 머리표 금액 자동 계산', detail.data?.voucher?.amount === 1000000);
  check('Q3 머리표 계정은 비용 계정', detail.data?.voucher?.accountCode === '5031');

  /* Q4 활동 누락 */
  const noFn = await voucher({
    voucherType: 'expense', lines: [
      { accountCode: '5032', debit: 1000, credit: 0, fundId: F01 },
      { accountCode: '1012', debit: 0, credit: 1000 },
    ],
  });
  const noFnSub = await submit(noFn.data?.voucherId);
  check('Q4 활동 누락 제출 막힘', noFnSub.status === 422 && (noFnSub.json?.missing || []).some((m) => m.includes('활동')), reasonOf(noFnSub));

  const noProgram = await voucher({
    voucherType: 'expense', lines: [
      { accountCode: '5021', debit: 1000, credit: 0, functionCode: 'service', fundId: F01 },
      { accountCode: '1012', debit: 0, credit: 1000 },
    ],
  });
  const noProgramSub = await submit(noProgram.data?.voucherId);
  check('Q4 사업수행인데 사업 누락 막힘', noProgramSub.status === 422 && (noProgramSub.json?.missing || []).some((m) => m.includes('사업')), reasonOf(noProgramSub));

  const noFund = await voucher({
    voucherType: 'expense', lines: [
      { accountCode: '5032', debit: 1000, credit: 0, functionCode: 'admin' },
      { accountCode: '1012', debit: 0, credit: 1000 },
    ],
  });
  const noFundSub = await submit(noFund.data?.voucherId);
  check('Q4 재원 누락 막힘', noFundSub.status === 422 && (noFundSub.json?.missing || []).some((m) => m.includes('재원')), reasonOf(noFundSub));

  /* 상위 계정 */
  const parent = await voucher({
    voucherType: 'expense', lines: [
      { accountCode: '503', debit: 1000, credit: 0, functionCode: 'admin', fundId: F01 },
      { accountCode: '1012', debit: 0, credit: 1000 },
    ],
  });
  const parentSub = await submit(parent.data?.voucherId);
  check('Q4 상위 계정 기표 막힘', parentSub.status === 422 && (parentSub.json?.missing || []).some((m) => m.includes('묶음')), reasonOf(parentSub));

  /* 불일치 */
  const uneven = await voucher({
    voucherType: 'transfer', lines: [
      { accountCode: '1011', debit: 1000, credit: 0 },
      { accountCode: '1012', debit: 0, credit: 900 },
    ],
  });
  const unevenSub = await submit(uneven.data?.voucherId);
  check('Q4 차변·대변 불일치 막힘', unevenSub.status === 422 && (unevenSub.json?.missing || []).some((m) => m.includes('맞지 않습니다')), reasonOf(unevenSub));

  /* Q5 분배비용 */
  const grant = await voucher({
    voucherType: 'expense', lines: [
      { accountCode: '5023', debit: 1000, credit: 0, functionCode: 'admin', fundId: F01 },
      { accountCode: '1012', debit: 0, credit: 1000 },
    ],
  });
  const grantSub = await submit(grant.data?.voucherId);
  check('Q5 장학금을 일반관리로 입력 막힘', grantSub.status === 422 && (grantSub.json?.missing || []).some((m) => m.includes('사업수행')), reasonOf(grantSub));

  /* Q6 승인 */
  const sub = await submit(rentId);
  check('Q6 제출', sub.ok, reasonOf(sub));
  const ok = await approve(rentId);
  check('Q6 승인', ok.ok, reasonOf(ok));

  const tb1 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=3`);
  check('Q6 시산표 조회', tb1.ok, reasonOf(tb1));
  check('Q6 시산표 합계 일치', tb1.data?.balanced === true);
  const rentRow = tb1.data?.rows?.find((r) => r.code === '5031');
  check('Q6 임차료 차변 잔액 1,000,000', rentRow?.debitBalance === 1000000);
  const cashRow = tb1.data?.rows?.find((r) => r.code === '1012');
  check('Q6 전용계좌 대변 잔액 1,000,000', cashRow?.creditBalance === 1000000);

  const gl = await api('GET', `/api/admin-ledger-gl?accountCode=1012&from=${YEAR}-01-01&to=${YEAR}-12-31`);
  check('Q6 원장 조회', gl.ok, reasonOf(gl));
  check('Q6 원장 잔액 -1,000,000', gl.data?.closing === -1000000);

  /* Q9 필터 */
  const glProgram = await api('GET', `/api/admin-ledger-gl?accountCode=5031&from=${YEAR}-01-01&to=${YEAR}-12-31&programId=${P05}`);
  check('Q9 사업 필터 합계 400,000', glProgram.data?.closing === 400000, String(glProgram.data?.closing));
  const glFund = await api('GET', `/api/admin-ledger-gl?accountCode=5031&from=${YEAR}-01-01&to=${YEAR}-12-31&fundId=${F01}`);
  check('Q9 재원 필터 합계 1,000,000', glFund.data?.closing === 1000000, String(glFund.data?.closing));

  /* Q7 승인 전표 보호 */
  const edit = await api('PUT', '/api/admin-voucher-update', { id: rentId, description: '변조' });
  check('Q7 승인 전표 수정 막힘', edit.status === 422, reasonOf(edit));
  const del = await api('DELETE', `/api/admin-voucher-delete?id=${rentId}`);
  check('Q7 승인 전표 삭제 막힘', del.status === 422, reasonOf(del));

  /* 초안 삭제 */
  const scrap = await voucher({
    voucherType: 'expense', description: 'E2E 삭제', lines: [
      { accountCode: '5032', debit: 100, credit: 0, functionCode: 'admin', fundId: F01 },
      { accountCode: '1012', debit: 0, credit: 100 },
    ],
  });
  const scrapDel = await api('DELETE', `/api/admin-voucher-delete?id=${scrap.data?.voucherId}`);
  check('Q7 작성중 전표는 분개와 함께 삭제', scrapDel.ok, reasonOf(scrapDel));
  const scrapHistory = await api('GET', `/api/admin-ledger-history?entity=voucher&entityId=${scrap.data?.voucherId}`);
  check('Q7 삭제도 이력에 남음', (scrapHistory.data?.items || []).some((h) => h.action === 'deleted'));

  /* Q14 동시 승인 */
  const race = await voucher({
    voucherType: 'expense', lines: [
      { accountCode: '5032', debit: 7000, credit: 0, functionCode: 'admin', fundId: F01 },
      { accountCode: '2011', debit: 0, credit: 7000 },
    ],
  });
  await submit(race.data?.voucherId);
  const raced = await Promise.all([1, 2, 3].map(() => approve(race.data?.voucherId)));
  check('Q14 동시 승인 3회 중 1회만 성공', raced.filter((r) => r.ok).length === 1, raced.map((r) => r.status).join(','));

  /* Q8 반대 전표 */
  const rev = await api('POST', '/api/admin-voucher-reverse', { id: rentId, date: `${YEAR}-03-20`, reason: 'E2E 시험' });
  check('Q8 반대 전표 생성', rev.ok, reasonOf(rev));
  const tb2 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=3`);
  const rentRow2 = tb2.data?.rows?.find((r) => r.code === '5031');
  check('Q8 취소 뒤 임차료 잔액 0', rentRow2 && rentRow2.debitBalance === 0 && rentRow2.creditBalance === 0);
  check('Q8 취소 뒤 시산표 합계 일치', tb2.data?.balanced === true);
  const detail2 = await api('GET', `/api/admin-voucher-detail?id=${rentId}`);
  check('Q8 원전표에 취소 표시', detail2.data?.voucher?.reversedById === rev.data?.reversalId);
  check('Q8 처리 이력 남음', (detail2.data?.voucher?.history || []).some((h) => h.action === 'reversed'));
  const rev2 = await api('POST', '/api/admin-voucher-reverse', { id: rentId, date: `${YEAR}-03-21`, reason: 'E2E 시험' });
  check('Q8 이중 취소 막힘', rev2.status === 422, reasonOf(rev2));
  const rev3 = await api('POST', '/api/admin-voucher-reverse', { id: rev.data?.reversalId, date: `${YEAR}-03-21`, reason: 'E2E 시험' });
  check('Q8 반대 전표 재취소 막힘', rev3.status === 422, reasonOf(rev3));

  /* Q10 수입·개시 */
  const income = await voucher({
    voucherType: 'income', description: 'E2E 후원금', voucherDate: `${YEAR}-03-11`, lines: [
      { accountCode: '1012', debit: 50000, credit: 0 },
      { accountCode: '4011', debit: 0, credit: 50000, fundId: fund('F02') },
    ],
  });
  await submit(income.data?.voucherId);
  const incomeOk = await approve(income.data?.voucherId);
  check('Q10 수입 전표 승인', incomeOk.ok, reasonOf(incomeOk));

  const opening = await voucher({
    voucherType: 'opening', description: 'E2E 개시', voucherDate: `${YEAR}-01-01`, lines: [
      { accountCode: '1012', debit: 3000000, credit: 0 },
      { accountCode: '3011', debit: 0, credit: 1000000 },
      { accountCode: '3021', debit: 0, credit: 2000000 },
    ],
  });
  await submit(opening.data?.voucherId);
  const openingOk = await approve(opening.data?.voucherId);
  check('Q10 개시 전표 승인', openingOk.ok, reasonOf(openingOk));

  const tb3 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=3`);
  const cash3 = tb3.data?.rows?.find((r) => r.code === '1012');
  check('Q10 통장 잔액 3,050,000', cash3?.debitBalance === 3050000, String(cash3?.debitBalance));
  const income3 = tb3.data?.rows?.find((r) => r.code === '4011');
  check('Q10 수익은 대변 잔액', income3?.creditBalance === 50000);
  check('Q10 시산표 합계 일치', tb3.data?.balanced === true);

  /* Q11 줄 없는 전표: 기본 2줄 */
  const header = await api('POST', '/api/admin-voucher-create', {
    voucherDate: `${YEAR}-03-12`, accountCode: '5032', description: 'E2E 머리표만', amount: 3300,
  });
  const headerSub = await submit(header.data?.voucherId);
  check('Q11 줄 없는 전표는 기본 2줄 뒤 재원·활동 요구', headerSub.status === 422 && (headerSub.json?.missing || []).some((m) => m.includes('재원')), reasonOf(headerSub));
  const headerDetail = await api('GET', `/api/admin-voucher-detail?id=${header.data?.voucherId}`);
  check('Q11 제출 실패해도 전표 상태 유지', headerDetail.data?.voucher?.status === 'draft');

  /* Q13 마감 */
  const closeBlocked = await api('POST', '/api/admin-ledger-close', { action: 'close', year: YEAR, month: 1 });
  check('Q13 첫 달 마감 가능', closeBlocked.ok, reasonOf(closeBlocked));
  const closeFeb = await api('POST', '/api/admin-ledger-close', { action: 'close', year: YEAR, month: 2 });
  check('Q13 2월 마감', closeFeb.ok, reasonOf(closeFeb));
  const closeMar = await api('POST', '/api/admin-ledger-close', { action: 'close', year: YEAR, month: 3 });
  check('Q13 미결 전표 있으면 마감 막힘', closeMar.status === 422 && String(closeMar.json?.error).includes('미결'), reasonOf(closeMar));
  const skip = await api('POST', '/api/admin-ledger-close', { action: 'close', year: YEAR, month: 5 });
  check('Q13 순서 건너뛰기 막힘', skip.status === 422, reasonOf(skip));
  const lateJan = await voucher({
    voucherType: 'transfer', voucherDate: `${YEAR}-02-10`, lines: [
      { accountCode: '1011', debit: 500, credit: 0 },
      { accountCode: '1012', debit: 0, credit: 500 },
    ],
  });
  const lateSub = await submit(lateJan.data?.voucherId);
  check('Q13 마감된 달 제출 막힘', lateSub.status === 422 && (lateSub.json?.missing || []).some((m) => m.includes('마감')), reasonOf(lateSub));
  const noReason = await api('POST', '/api/admin-ledger-close', { action: 'reopen', year: YEAR, month: 2 });
  check('Q13 해제 사유 필수', noReason.status === 400, reasonOf(noReason));
  const reopen = await api('POST', '/api/admin-ledger-close', { action: 'reopen', year: YEAR, month: 2, reason: 'E2E 시험' });
  check('Q13 사유 입력 뒤 해제', reopen.ok, reasonOf(reopen));
  const status = await api('GET', `/api/admin-ledger-close?year=${YEAR}`);
  check('Q13 해제 뒤 1월까지만 마감', status.data?.fiscalYear?.closedThrough === `${YEAR}-01-31`, String(status.data?.fiscalYear?.closedThrough));

  /* 장부 시작일 변경 */
  const moved = await api('POST', '/api/admin-ledger-fiscal-year', {
    year: YEAR, startDate: `${YEAR}-02-01`, endDate: `${YEAR}-12-31`, reason: 'E2E 시험',
  });
  check('승인 전표가 밖으로 나가는 시작일 변경 막힘', moved.status === 422, reasonOf(moved));

  /* Q16 사업·재원 CRUD */
  const stamp = String(Date.now()).slice(-5);
  const addP = await api('POST', '/api/admin-ledger-master-save', { type: 'program', code: `T99${stamp}`, name: 'E2E 사업', reason: 'E2E 시험' });
  check('Q16 사업 추가', addP.ok, reasonOf(addP));
  const dupP = await api('POST', '/api/admin-ledger-master-save', { type: 'program', code: `T99${stamp}`, name: 'E2E 사업', reason: 'E2E 시험' });
  check('Q16 같은 코드 추가 막힘', dupP.status === 409, reasonOf(dupP));
  const hideP = await api('POST', '/api/admin-ledger-master-save', { type: 'program', id: addP.data?.id, isActive: false, reason: 'E2E 시험' });
  check('Q16 사업 숨김', hideP.ok, reasonOf(hideP));
  const addF = await api('POST', '/api/admin-ledger-master-save', { type: 'fund', code: `T99${stamp}`, name: 'E2E 재원', restricted: true, reason: 'E2E 시험' });
  check('Q16 재원 추가', addF.ok, reasonOf(addF));
  const sysF = await api('POST', '/api/admin-ledger-master-save', { type: 'fund', id: F01, isActive: false, reason: 'E2E 시험' });
  check('Q16 기본 재원 숨김 막힘', sysF.status === 422, reasonOf(sysF));

  /* 계정과목 보호 */
  const usedKind = await api('POST', '/api/admin-account-code-update', { id: acc('5031').id, category: 'asset' });
  check('장부에 쓰인 계정 구분 변경 막힘', usedKind.status === 400, reasonOf(usedKind));
  const sysAcc = await api('POST', '/api/admin-account-code-update', { id: acc('1012').id, isActive: false });
  check('기본 계정 사용 중지 막힘', sysAcc.status === 400, reasonOf(sysAcc));

  /* 이력 */
  const hist = await api('GET', '/api/admin-ledger-history?limit=30');
  check('변경 이력 조회', hist.ok && (hist.data?.items || []).length > 0, reasonOf(hist));

  /* Q15 기존 화면 숫자 */
  const after = await snapshot();
  check('Q15 손익·예산 집행 숫자 변화 없음', before === after && !before.includes('"net":null'), `${before} / ${after}`);

  console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
  if (failures.length) console.log('실패 항목:', failures.join(', '));
}

main().catch((e) => { console.error('중단:', e); process.exit(1); }).finally(() => { if (fail) process.exitCode = 1; });
