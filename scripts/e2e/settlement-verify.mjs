// 결산·내부결재·공익법인 대응 라이브 검증 (2026-11-06)
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/settlement-verify.mjs
// 시험 데이터는 전부 2099·2100 회계연도다. 끝나면 /api/migrate-ledger-settlement?cleanup=1 로 지운다.
// 이사장 계정 하나로 돌리므로 여러 사람의 합의·반려·근태 연결은 로컬 시험이 맡는다.
const BASE = process.env.BASE || 'https://tbfa.co.kr';
const YEAR = 2099;
let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

const check = (name, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; failures.push(name); }
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ' — ' + String(extra).slice(0, 170) : ''}`);
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
const why = (r) => [r.json?.error, r.json?.detail, ...(r.json?.missing || [])].filter(Boolean).join(' / ').slice(0, 170);
const docs = (body) => api('POST', '/api/admin-docs', body);
const view = (qs) => api('GET', '/api/admin-docs?' + qs);

async function attach(id, kind) {
  const bytes = Buffer.from('%PDF-1.4\n% 시험 증빙\n');
  const pre = await docs({ action: 'file_presign', fileName: '시험증빙.pdf', contentType: 'application/pdf', sizeBytes: bytes.length });
  const put = await fetch(pre.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
  await api('POST', '/api/blob-confirm', { id: pre.data.id });
  const add = await docs({ action: 'file_add', id, blobId: pre.data.id, fileKind: kind, sha256: 'test' });
  return put.ok && add.ok;
}

async function main() {
  const login = await api('POST', '/api/admin/login', { id: process.env.ADMIN_ID, password: process.env.ADMIN_PW });
  check('로그인', login.ok);
  if (!login.ok) return;
  const me = (await api('GET', '/api/admin/me')).data?.admin;
  const myId = Number(me?.id ?? me?.uid);

  const thisYear = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
  const snapshot = async () => {
    const pl = await api('GET', `/api/admin-finance-pl-summary?fiscalYear=${thisYear}`);
    return JSON.stringify({ expense: pl.data?.expenditure?.total ?? null, net: pl.data?.netIncome ?? null });
  };
  const before = await snapshot();

  const fy = await api('POST', '/api/admin-ledger-fiscal-year', { year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, reason: 'E2E 시험' });
  check('시험 연도', fy.ok, why(fy));

  /* 예산 */
  const plan = await api('POST', '/api/admin-budget-plan-create', { fiscalYear: YEAR, title: '[점검] 2099 예산' });
  check('예산안 작성', plan.ok, why(plan));
  const planId = plan.data.planId;
  const detail = await api('GET', `/api/admin-budget-plan-detail?id=${planId}`);
  const lines = detail.data.lines;
  const rent = lines.find((l) => l.mokCode === '3-1-01');
  const counsel = lines.find((l) => l.mokCode === '2-1-01');
  check('예산 줄', !!rent && !!counsel, lines.length);
  await api('PUT', '/api/admin-budget-plan-update', { planId, lines: [{ lineId: rent.id, plannedAmount: 1000000 }, { lineId: counsel.id, plannedAmount: 500000 }] });
  const masters = (await api('GET', '/api/admin-ledger-masters')).data;
  const fund = (c) => masters.funds.find((f) => f.code === c).id;
  const program = (c) => masters.programs.find((p) => p.code === c).id;
  const split = await api('POST', '/api/admin-budget-plan-extras', { planId, action: 'splits', lineId: counsel.id, splits: [{ functionCode: 'service', programId: program('P05'), fundId: fund('F02'), amount: 500000 }] });
  check('목 나누기', split.ok, why(split));
  const rev = await api('POST', '/api/admin-budget-plan-extras', { planId, action: 'revenue', lines: [{ accountCode: '4011', fundId: fund('F02'), plannedAmount: 2000000 }] });
  check('수입 예산', rev.ok, why(rev));
  const carry = await api('POST', '/api/admin-budget-plan-extras', { planId, action: 'carry', carryIn: 300000 });
  check('수지예산서', carry.data?.statement?.carryOut === 300000 + 2000000 - carry.data?.statement?.expenseTotal, JSON.stringify(carry.data?.statement).slice(0, 120));
  const submitted = await api('POST', '/api/admin-budget-plan-submit', { planId });
  const approved = await api('POST', '/api/admin-budget-plan-approve', { planId });
  check('예산안 승인', submitted.ok && approved.ok, why(approved));

  /* 결재 문서 */
  const line = [{ type: 'approve', memberId: myId }];
  const p = await docs({ action: 'save', docType: 'proposal', title: '[점검] 상담 지원 품의', payMethod: 'transfer', body: '<p>목적 <b>시험</b></p>', formData: { periodFrom: `${YEAR}-02-01`, budgetRows: [{ item: '상담', amount: 300000 }], line } });
  check('품의서 저장', p.ok, why(p));
  const pId = p.data.id;
  const ps = await docs({ action: 'submit', id: pId });
  check('품의서 상신', ps.ok && /^품의-/.test(ps.data?.docNo), why(ps) || ps.data?.docNo);
  const pd = await docs({ action: 'decide', id: pId, decision: 'approve' });
  check('품의서 승인', pd.ok && pd.data.result === 'approved', why(pd));

  const budgets = (await view(`view=budgets&year=${YEAR}`)).data;
  const opt = budgets.options.find((o) => o.locked);
  check('나눈 예산 선택지', !!opt, JSON.stringify(budgets.options.map((o) => o.key)).slice(0, 100));
  const e = await docs({
    action: 'save', docType: 'expense', title: '[점검] 상담비', payMethod: 'transfer', expenseKind: 'general', budgetSplitId: opt.splitId, budgetYear: YEAR,
    references: [{ targetId: pId, refKind: 'basis' }],
    formData: { items: [{ use: '상담', content: '심리상담', payee: '시험 상담소', supply: 200000, vat: 20000 }], payees: [{ payee: '시험 상담소', bank: '우리', account: '000', holder: '시험', payDate: `${YEAR}-02-10` }], line },
  });
  check('지출결의서 저장', e.ok, why(e));
  const eId = e.data.id;
  const noFile = await docs({ action: 'submit', id: eId });
  check('증빙 없으면 상신 차단', noFile.status === 422, why(noFile));
  check('첨부 업로드', await attach(eId, 'payment'));
  const es = await docs({ action: 'submit', id: eId });
  check('지출결의서 상신', es.ok, why(es));
  const fileRow = (await view(`view=detail&id=${eId}`)).data?.files?.[0];
  const direct = await fetch(`${BASE}/api/admin-docs-file?id=${fileRow?.id}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  check('첨부 열람 주소', direct.status === 302, direct.status);
  const noCookie = await fetch(`${BASE}/api/admin-docs-file?id=${fileRow?.id}`, { redirect: 'manual' });
  check('로그인 없으면 첨부 열람 불가', noCookie.status === 401, noCookie.status);
  const ed = await docs({ action: 'decide', id: eId, decision: 'approve' });
  check('최종 승인과 결의번호', ed.ok && !!ed.data.resolutionNo, why(ed));
  const pos = (await view(`view=budget&year=${YEAR}&budgetAccountId=${opt.budgetAccountId}`)).data;
  check('승인 = 예약', pos.position.reserved === 220000 && pos.position.executed === 0, JSON.stringify(pos.position));
  const pay = await api('POST', '/api/admin-approval-pay', { requestId: eId, paidAt: `${YEAR}-02-10`, paidAmount: 200000, payAccountCode: '1012', evidenceChecked: true });
  check('지출완료 확인(실제 지급액)', pay.ok, why(pay));
  const pos2 = (await view(`view=budget&year=${YEAR}&budgetAccountId=${opt.budgetAccountId}`)).data;
  check('집행 20만, 예약 해제', pos2.position.reserved === 0 && pos2.position.executed === 200000, JSON.stringify(pos2.position));

  const inside = await docs({ action: 'save', docType: 'internal', title: '[점검] 출장', body: '<p>출장</p>', formData: { kind: 'trip', periodFrom: `${YEAR}-03-01`, periodTo: `${YEAR}-03-02`, place: '세종', line } });
  const iSub = await docs({ action: 'submit', id: inside.data.id });
  check('내부결재 상신', iSub.ok && /^내부-/.test(iSub.data?.docNo), why(iSub));
  await docs({ action: 'decide', id: inside.data.id, decision: 'approve' });
  const seal = await docs({ action: 'save', docType: 'seal', title: '[점검] 인감', formData: { sealType: '법인인감', usePurpose: '시험', submitTo: '시험처', useDate: `${YEAR}-03-05`, sealTarget: '시험 서류', line } });
  check('인감 신청 상신', (await docs({ action: 'submit', id: seal.data.id })).ok);
  const cardForm = { usePurpose: '시험', periodFrom: `${YEAR}-03-05`, plannedAmount: 10000, cardLabel: '0000', line };
  const card = await docs({ action: 'save', docType: 'card', title: '[점검] 카드', formData: cardForm });
  const cardBare = await docs({ action: 'submit', id: card.data.id });
  check('품의 없는 카드 신청 차단', cardBare.status === 422, why(cardBare));
  await docs({ action: 'save', id: card.data.id, docType: 'card', title: '[점검] 카드', formData: cardForm, references: [{ targetId: pId, refKind: 'basis' }] });
  check('카드 신청 상신', (await docs({ action: 'submit', id: card.data.id })).ok);
  await docs({ action: 'decide', id: card.data.id, decision: 'approve' });
  const overUse = await docs({ action: 'card_usage', id: card.data.id, actualAmount: 10001, usedOn: `${YEAR}-03-06` });
  check('승인 금액 초과 사용 거절', overUse.status === 422, why(overUse));
  const used = await docs({ action: 'card_usage', id: card.data.id, actualAmount: 9000, usedOn: `${YEAR}-03-06` });
  check('카드 실제 사용액 등록', used.ok, why(used));

  /* 긴급 지출과 사후 품의. 마지막에 취소해 예약을 푼다 */
  const urgent = await docs({
    action: 'save', docType: 'expense', title: '[점검] 긴급 지출', payMethod: 'transfer', expenseKind: 'urgent', budgetSplitId: opt.splitId, budgetYear: YEAR,
    formData: { items: [{ use: '수리', content: '시험', payee: '시험처', supply: 1000 }], urgentReason: '시험', line },
  });
  await attach(urgent.data.id, 'payment');
  await docs({ action: 'submit', id: urgent.data.id });
  await docs({ action: 'decide', id: urgent.data.id, decision: 'approve' });
  const uDoc = (await view(`view=detail&id=${urgent.data.id}`)).data;
  check('사후 품의 표시', uDoc.followupDue === true && uDoc.actions.followup === true, JSON.stringify(uDoc.actions));
  const fu = await docs({ action: 'followup_link', id: urgent.data.id, targetId: pId });
  check('사후 품의 연결', fu.ok && (await view(`view=detail&id=${urgent.data.id}`)).data.followupDue === false, why(fu));
  await docs({ action: 'cancel_request', id: urgent.data.id, reason: '시험' });
  const uCancel = await docs({ action: 'cancel_decide', id: urgent.data.id, decision: 'approve' });
  check('긴급 지출 취소로 예약 해제', uCancel.ok, why(uCancel));

  /* 취소 */
  const c = await docs({ action: 'save', docType: 'proposal', title: '[점검] 취소 대상', payMethod: 'none', body: '<p>x</p>', formData: { periodFrom: `${YEAR}-04-01`, line } });
  await docs({ action: 'submit', id: c.data.id });
  await docs({ action: 'decide', id: c.data.id, decision: 'approve' });
  const cr = await docs({ action: 'cancel_request', id: c.data.id, reason: '시험' });
  const ca = await docs({ action: 'cancel_decide', id: c.data.id, decision: 'approve' });
  check('원결재선 취소', cr.ok && ca.ok && ca.data.result === 'approved', why(ca));
  const del = await docs({ action: 'delete', id: c.data.id, reason: '시험' });
  check('일반 삭제와 보존함', del.ok && (await view('view=list&box=archive')).data.items.some((x) => x.id === c.data.id), why(del));
  const home = await view('view=home');
  check('결재 홈', home.ok, JSON.stringify(home.data?.counts));

  /* 수입과 개시 */
  const o = await api('POST', '/api/admin-voucher-create', {
    voucherDate: `${YEAR}-01-01`, voucherType: 'opening', description: '[점검] 개시', payeeName: null, evidenceType: 'none',
    lines: [{ accountCode: '1012', debit: 1000000, credit: 0 }, { accountCode: '3021', debit: 0, credit: 1000000 }],
  });
  const oId = o.data?.voucherId;
  await api('POST', '/api/admin-voucher-submit', { id: oId });
  const oa = await api('POST', '/api/admin-voucher-approve', { id: oId, action: 'approve' });
  check('개시 전표', oa.ok, why(oa));
  const r = await api('POST', '/api/admin-revenue-create', {
    fiscalYear: YEAR, recognizedAt: `${YEAR}-05-02`, categoryId: masters.revenueCategories.find((x) => x.code === 'govgrant').id,
    amount: 500000, payerName: '시험 기관', description: '[점검] 지원금',
  });
  await api('POST', '/api/admin-revenue-approve', { id: r.data?.revenue?.id ?? r.data?.id, action: 'approve' });
  await api('POST', '/api/admin-ledger-sync');

  /* 결산 */
  const load = async () => (await api('GET', `/api/admin-ledger-settlement?year=${YEAR}`)).data;
  let s = await load();
  check('결산 조회', !!s?.package, '');
  const P = s.package;
  const bs = (k) => P.balance.rows.find((x) => x.key === k)?.current.total;
  const op = (k) => P.operating.rows.find((x) => x.key === k)?.current.total;
  check('자산총계', bs('asset.total') === 1300000, bs('asset.total'));
  check('대차 일치', P.balance.balanced === true);
  check('사업수행비용', op('expense.service') === 200000, op('expense.service'));
  check('당기운영이익', op('profit.net') === 300000, op('profit.net'));
  check('주석 17개', P.notes.length === 17);
  check('수지 일치', P.settlement.incomeSide === P.settlement.outflowSide, `${P.settlement.incomeSide} ${P.settlement.outflowSide}`);
  check('성격별 합계', P.nature.rows.find((x) => x.key === 'total').total === 200000);
  check('다음 해 묶음', P.next.year === 2100);

  const lockEarly = await api('POST', '/api/admin-ledger-settlement', { action: 'lock', year: YEAR });
  check('막힌 채 확정 거절', lockEarly.status === 422, why(lockEarly));
  await api('POST', '/api/admin-ledger-docs', { type: 'property_fill', year: YEAR });
  for (const n of P.notes.filter((x) => x.confirm)) await api('POST', '/api/admin-ledger-docs', { type: 'note', year: YEAR, key: n.key, body: n.body });
  await api('POST', '/api/admin-ledger-docs', { type: 'program', year: YEAR, programId: program('P05'), resultBody: '[점검] 상담 지원', events: 1, beneficiaries: 3 });
  await api('POST', '/api/admin-ledger-settlement', { action: 'checklist', year: YEAR, checklist: { depreciation: true, retirement: true, accrual: true, inkind: true } });
  for (let month = 1; month <= 12; month += 1) {
    const cl = await api('POST', '/api/admin-ledger-close', { action: 'close', year: YEAR, month });
    if (!cl.ok) check(`${month}월 마감`, false, why(cl));
  }
  s = await load();
  const blockers = s.checks.items.filter((i) => i.state === 'block');
  check('점검 통과', blockers.length === 0, JSON.stringify(blockers).slice(0, 170));
  const lock = await api('POST', '/api/admin-ledger-settlement', { action: 'lock', year: YEAR });
  check('결산 확정', lock.ok, why(lock));
  s = await load();
  check('승인본', s.frozen === true && s.settlement.status === 'locked');
  for (const [action, extra] of [['audit', { auditorName: '시험 감사', opinion: '적정' }], ['board', { note: '의결' }], ['assembly', { note: '승인' }], ['submit', { to: '교육부' }]]) {
    const a = await api('POST', '/api/admin-ledger-settlement', { action, year: YEAR, date: '2100-02-20', ...extra });
    check(`${action} 기록`, a.ok, why(a));
  }

  /* 공익법인 */
  const pub = (await api('GET', `/api/admin-ledger-public?year=${YEAR}`)).data;
  check('공익법인 자료', pub?.form?.type === 'simple' && pub?.ratios?.serviceOfExpense === 100, JSON.stringify(pub?.ratios));
  await api('POST', '/api/admin-ledger-public', { action: 'disclosure_save', year: YEAR, title: '[점검] 재정 공개', intro: '시험' });
  const publish = await api('POST', '/api/admin-ledger-public', { action: 'publish', year: YEAR });
  check('재정 공개', publish.ok, why(publish));
  const list = await api('GET', '/api/public/disclosures');
  check('공개 자료 조회', list.data?.items?.some((x) => x.year === YEAR), JSON.stringify(list.data?.items?.[0]).slice(0, 120));
  const tax = await api('GET', `/api/admin-ledger-public?year=${YEAR}&doc=vouchers`);
  check('세무사 전달 분개', tax.data?.rows?.length >= 6, tax.data?.rows?.length);

  const after = await snapshot();
  check('올해 손익 숫자 변화 없음', before === after && !before.includes('"net":null'), `${before} / ${after}`);

  console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
  if (failures.length) console.log('실패 항목:', failures.join(', '));
}

main().catch((e) => { console.error('중단:', e); process.exit(1); }).finally(() => { if (fail) process.exitCode = 1; });
