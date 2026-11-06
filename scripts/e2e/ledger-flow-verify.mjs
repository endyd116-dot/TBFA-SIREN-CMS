// 2단계 돈의 흐름 라이브 검증
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/ledger-flow-verify.mjs
// 시험 데이터는 전부 2099 시험 연도다. 끝나면 /api/migrate-ledger-flow?cleanup=1 로 지운다.
// 후원·급여는 시험 데이터를 넣을 경로가 없어 로컬 임시 DB에서 시험했다.
const BASE = process.env.BASE || 'https://tbfa.co.kr';
const YEAR = 2099;
let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

const check = (name, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; failures.push(name); }
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ' — ' + String(extra).slice(0, 160) : ''}`);
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
const why = (r) => [r.json?.error, r.json?.detail, ...(r.json?.missing || [])].filter(Boolean).join(' / ').slice(0, 150);

async function main() {
  const login = await api('POST', '/api/admin/login', { id: process.env.ADMIN_ID, password: process.env.ADMIN_PW });
  check('로그인', login.ok);
  if (!login.ok) return;

  const thisYear = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
  const snapshot = async () => {
    const pl = await api('GET', `/api/admin-finance-pl-summary?year=${thisYear}`);
    const b = await api('GET', `/api/admin-finance-budget-list?year=${thisYear}`);
    return JSON.stringify({ expense: pl.data?.expenditure?.total ?? null, net: pl.data?.netIncome ?? null, executed: b.data?.totalExecuted ?? null });
  };
  const before = await snapshot();

  const masters = await api('GET', '/api/admin-ledger-masters');
  check('기준 정보 조회', masters.ok, why(masters));
  const M = masters.data;
  check('수입 분류 연결', M.revenueCategories?.length >= 6 && M.revenueCategories.every((c) => c.accountCode), JSON.stringify(M.revenueCategories?.map((c) => c.accountCode)));
  check('직원 목록', Array.isArray(M.staff) && M.staff.length > 0, M.staff?.length);
  const tags = await api('GET', '/api/admin-ledger-tags');
  check('기안 창 항목', tags.ok && tags.data.programs.length === 8 && tags.data.funds.length === 5, why(tags));

  const budgetTree = await api('GET', '/api/admin-budget-accounts');
  const moks = [];
  const walk = (n) => { for (const x of n || []) { if (x.level === '목') moks.push(x); walk(x.children); } };
  walk(budgetTree.data?.tree);
  const rent = moks.find((x) => x.code === '3-1-01');
  check('예산 목 ↔ 계정 연결', (rent?.mappedCodes || []).includes('5031'), JSON.stringify(rent?.mappedCodes));

  const fund = (code) => M.funds.find((f) => f.code === code).id;
  const F01 = fund('F01');
  const yr = await api('POST', '/api/admin-ledger-fiscal-year', { year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, reason: 'E2E 시험' });
  check('시험 연도 생성', yr.ok, why(yr));

  const flow0 = await api('GET', '/api/admin-ledger-flow');
  check('자금 연결 조회', flow0.ok, why(flow0));
  check('자금 연결 항목', ['sync', 'bank', 'unpaid', 'noApproval', 'directExpenses'].every((k) => k in (flow0.data || {})));

  /* 결재 → 지급 */
  const req = await api('POST', '/api/admin-approval-request-create', {
    title: '[점검] 장부 지급', amount: 120000, budgetAccountId: rent.id, fiscalYear: YEAR, occurredAt: `${YEAR}-05-01`,
    payeeName: '시험 임대인', functionCode: 'admin', fundId: F01,
  });
  check('결재 기안', req.ok, why(req));
  const reqId = req.data?.id ?? req.data?.requestId;
  const dec = await api('POST', '/api/admin-approval-decide', { requestId: reqId, decision: 'approve' });
  let guard = 0;
  let last = dec;
  while (last.ok && last.data?.status === 'pending' && guard < 4) {
    last = await api('POST', '/api/admin-approval-decide', { requestId: reqId, decision: 'approve' });
    guard += 1;
  }
  check('최종 승인', last.ok && last.data?.status === 'approved', why(last));
  const detail1 = await api('GET', `/api/admin-approval-requests?id=${reqId}`);
  const r1 = detail1.data?.request || detail1.data;
  check('승인만으로 지출 없음', r1?.paymentStatus === 'unpaid' && r1?.expenseId == null, JSON.stringify({ p: r1?.paymentStatus, e: r1?.expenseId }));
  const flow1 = await api('GET', '/api/admin-ledger-flow');
  check('미지급 결재 표시', (flow1.data?.unpaid || []).some((u) => u.id === reqId));

  const noDate = await api('POST', '/api/admin-approval-pay', { requestId: reqId });
  check('지급일 없으면 거절', noDate.status === 400);
  const pay = await api('POST', '/api/admin-approval-pay', { requestId: reqId, paidAt: `${YEAR}-05-02`, payAccountCode: '1012' });
  check('지급 확인', pay.ok, why(pay));
  check('지급 즉시 장부 반영', pay.data?.ledger?.posted === 1, JSON.stringify(pay.data?.ledger));
  const twice = await api('POST', '/api/admin-approval-pay', { requestId: reqId, paidAt: `${YEAR}-05-02` });
  check('이중 지급 막힘', twice.status === 422, why(twice));
  const tb1 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=12`);
  check('임차료 비용 반영', tb1.data?.rows?.find((x) => x.code === '5031')?.debitBalance === 120000);
  check('시산표 합계 일치', tb1.data?.balanced === true);

  /* 결재 취소: 반대 전표 */
  const cancel = await api('POST', '/api/admin-approval-cancel', { requestId: reqId, action: 'cancel', reason: 'E2E 시험' });
  check('지급 뒤 결재 취소', cancel.ok, why(cancel));
  const tb2 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=12`);
  const rentRow = tb2.data?.rows?.find((x) => x.code === '5031');
  check('취소 뒤 비용 0', rentRow?.debitBalance === 0 && rentRow?.creditBalance === 0, JSON.stringify(rentRow));

  /* 미지급 취소 */
  const req2 = await api('POST', '/api/admin-approval-request-create', { title: '[점검] 미지급 취소', amount: 5000, budgetAccountId: rent.id, fiscalYear: YEAR, functionCode: 'admin', fundId: F01 });
  const req2Id = req2.data?.id ?? req2.data?.requestId;
  let d2 = await api('POST', '/api/admin-approval-decide', { requestId: req2Id, decision: 'approve' });
  guard = 0;
  while (d2.ok && d2.data?.status === 'pending' && guard < 4) {
    d2 = await api('POST', '/api/admin-approval-decide', { requestId: req2Id, decision: 'approve' });
    guard += 1;
  }
  const cancel2 = await api('POST', '/api/admin-approval-cancel', { requestId: req2Id, action: 'cancel' });
  check('미지급 결재 취소', cancel2.ok, why(cancel2));

  /* 직접 등록 지출 */
  const exp = await api('POST', '/api/admin-expense-create', {
    fiscalYear: YEAR, occurredAt: `${YEAR}-06-01`, categoryId: M.funds.length ? 3 : 3, amount: 33000, payeeName: '시험 문구', description: '[점검] 사무용품',
    accountCode: '5033', functionCode: 'admin', fundId: F01, payAccountCode: '1012',
  });
  check('지출 등록', exp.ok, why(exp));
  const expId = exp.data?.expense?.id;
  const appr = await api('POST', '/api/admin-expense-approve', { id: expId, action: 'approve' });
  check('지출 승인', appr.ok, why(appr));
  const tb3 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=12`);
  check('승인 즉시 장부 반영', tb3.data?.rows?.find((x) => x.code === '5033')?.debitBalance === 33000);

  /* 기타 수입 */
  const rev = await api('POST', '/api/admin-revenue-create', {
    fiscalYear: YEAR, recognizedAt: `${YEAR}-06-02`, categoryId: M.revenueCategories.find((c) => c.code === 'govgrant').id,
    amount: 200000, payerName: '시험 기관', description: '[점검] 지원금',
  });
  check('수입 등록', rev.ok, why(rev));
  const revId = rev.data?.revenue?.id ?? rev.data?.id;
  const revOk = await api('POST', '/api/admin-revenue-approve', { id: revId, action: 'approve' });
  check('수입 승인', revOk.ok, why(revOk));
  const sync = await api('POST', '/api/admin-ledger-sync');
  check('지금 반영', sync.ok && sync.data?.posted >= 1, why(sync) || JSON.stringify(sync.data));
  const tb4 = await api('GET', `/api/admin-ledger-trial-balance?year=${YEAR}&month=12`);
  check('보조금수익 반영', tb4.data?.rows?.find((x) => x.code === '4012')?.creditBalance === 200000);
  check('최종 시산표 합계 일치', tb4.data?.balanced === true);
  const sync2 = await api('POST', '/api/admin-ledger-sync');
  check('다시 반영해도 중복 없음', sync2.ok && sync2.data?.posted === 0, JSON.stringify(sync2.data));
  const flowEnd = await api('GET', '/api/admin-ledger-flow');
  check('반영 뒤 미반영 0건', flowEnd.data?.sync?.total === 0, JSON.stringify(flowEnd.data?.sync?.bySource));

  /* 기존 숫자 */
  const after = await snapshot();
  check('올해 손익·집행 숫자 변화 없음', before === after && !before.includes('"net":null'), `${before} / ${after}`);

  console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
  if (failures.length) console.log('실패 항목:', failures.join(', '));
}

main().catch((e) => { console.error('중단:', e); process.exit(1); }).finally(() => { if (fail) process.exitCode = 1; });
