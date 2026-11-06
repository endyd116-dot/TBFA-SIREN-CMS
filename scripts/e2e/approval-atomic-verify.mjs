// 2026-11-06 2단계 이후: 최종 승인은 지출을 만들지 않고 미지급으로 둔다. 지출 건수 확인은 지급 확인 뒤 기준이다.
// approval-atomic-verify.mjs — 결재 승인 동시성·번호 발급·재무 보고서 숫자 라이브 검증 (2026-11-06)
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/approval-atomic-verify.mjs
// 만드는 시험 결재는 제목에 [점검]을 달고, 끝에 취소·삭제한다. 결의번호는 재사용하지 않으므로 몇 번 소모된다.
const ID = process.env.ADMIN_ID, PW = process.env.ADMIN_PW;
if (!ID || !PW) { console.error('ADMIN_ID / ADMIN_PW 환경변수 필요'); process.exit(2); }
const B = process.env.BASE_URL || 'https://tbfa.co.kr'; let cookie = '';
const api = async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.getSetCookie?.() || []; if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
};
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? '통과' : '실패'} · ${name}${extra ? ' · ' + extra : ''}`); };
const data = (r) => r.j?.data ?? r.j;

check('관리자 로그인', (await api('POST', '/api/admin/login', { id: ID, password: PW })).status === 200);

/* ── 재무 보고서 ── */
const bl27 = data(await api('GET', '/api/admin-finance-budget-list?year=2027'));
check('2027 예산 대비 실적이 관·항·목 라인을 읽음', (bl27.items || []).length > 0, `항목 ${(bl27.items || []).length}개, 편성 ${bl27.totalPlanned}`);
check('예산 항목에 경로 표시', (bl27.items || []).some((i) => i.path), (bl27.items || [])[0]?.path || '');
check('화면용 합계와 항목 합이 같음', (bl27.items || []).reduce((s, i) => s + i.plannedAmount, 0) === bl27.totalPlanned);
const lines = data(await api('GET', '/api/admin-budget-lines-list?year=2027'));
check('통장 화면 예산 항목 목록에 목 단위 표시', (lines.lines || []).length > 0, `${(lines.lines || []).length}개`);
const pl = data(await api('GET', '/api/admin-finance-pl-summary?period=year'));
const cats = pl.expenditure?.byCategory || [];
check('손익 지출 항목에 null 코드 없음', !cats.some((c) => c.code === 'null' || c.code == null), JSON.stringify(cats.map((c) => c.name)).slice(0, 120));
check('손익 항목 합이 지출 합계와 같음', cats.reduce((s, c) => s + Number(c.total), 0) === Number(pl.expenditure?.total));
for (const q of ['type=budget&year=2027', 'type=pl&period=year']) {
  const r = await fetch(`${B}/api/admin-finance-report-pdf?${q}`, { headers: { Cookie: cookie } });
  const buf = new Uint8Array(await r.arrayBuffer());
  check(`재무 PDF ${q}`, r.status === 200 && String.fromCharCode(...buf.slice(0, 4)) === '%PDF', `${r.status}, ${buf.length}바이트`);
}

/* ── 결재 ── */
const tree = data(await api('GET', '/api/admin-budget-accounts?fiscalYear=2026'));
const flat = []; const walk = (n) => { for (const x of n || []) { flat.push(x); walk(x.children); } }; walk(tree.tree || tree.items || tree.accounts || tree);
const mok = flat.find((x) => x.level === '목');
check('예산 목 확보', !!mok, mok?.name || '');
const create = async (title, amount) => data(await api('POST', '/api/admin-approval-request-create', { title: `[점검] ${title}`, amount, budgetAccountId: mok.id, occurredAt: '2026-11-06', payeeName: '점검' }));
const detail = async (id) => data(await api('GET', `/api/admin-approval-requests?id=${id}`));
const made = [];

// 1단계 결재: 같은 요청을 동시에 두 번 최종 승인
const a = await create('동시 승인 1단계', 1000); made.push(a.id);
check('기안 생성', !!a.id, a.requestNo);
const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => api('POST', '/api/admin-approval-decide', { requestId: a.id, decision: 'approve', expectedStep: 0 })));
const codes = [r1, r2, r3].map((r) => r.status).sort();
check('동시 승인 3회 중 1회만 성공', codes.filter((c) => c === 200).length === 1 && codes.filter((c) => c === 409).length === 2, codes.join(','));
const winner = [r1, r2, r3].find((r) => r.status === 200);
const no1 = data(winner)?.resolutionNo;
check('결의번호 발급', /^제\d{4}-\d{4}호$/.test(no1 || ''), no1);
const exList = data(await api('GET', '/api/admin-expense-list?period=year&limit=500'));
const dup = (exList.items || []).filter((e) => String(e.description || '').includes('[점검] 동시 승인 1단계') && e.status === 'approved');
check('지출이 1건만 생성', dup.length === 1, `${dup.length}건`);

// 2단계 결재: 첫 단계 동시 클릭이 다음 단계를 건너뛰지 않음
const b = await create('동시 승인 2단계', 300000); made.push(b.id);
const [d1, d2] = await Promise.all([1, 2].map(() => api('POST', '/api/admin-approval-decide', { requestId: b.id, decision: 'approve', expectedStep: 0 })));
const dc = [d1, d2].map((r) => r.status).sort();
const afterB = await detail(b.id);
const stB = afterB.request || afterB;
check('중복 클릭이 다음 단계를 넘기지 않음', stB.status === 'pending' && Number(stB.currentStep) === 1, `응답 ${dc.join(',')}, 상태 ${stB.status}, 단계 ${stB.currentStep}`);
const fin = await api('POST', '/api/admin-approval-decide', { requestId: b.id, decision: 'approve', expectedStep: 1 });
const no2 = data(fin)?.resolutionNo;
const n = (s) => Number(String(s).match(/-(\d+)호/)?.[1]);
check('다음 결의번호가 이어짐', fin.status === 200 && n(no2) === n(no1) + 1, no2);
const stale = await api('POST', '/api/admin-approval-decide', { requestId: b.id, decision: 'approve', expectedStep: 1 });
check('이미 끝난 결재 재승인 차단', stale.status === 409, String(stale.status));

// 삭제 뒤 재기안: 번호가 겹치지 않음
const c = await create('삭제 번호 1', 2000);
const c2 = await create('삭제 번호 2', 2000); made.push(c2.id);
const del = await api('POST', '/api/admin-approval-cancel', { requestId: c.id, action: 'delete' });
check('대기 기안 삭제', del.status === 200, String(del.status));
const c3 = await create('삭제 번호 3', 2000); made.push(c3.id);
check('삭제 뒤 새 기안 가능', !!c3.id && c3.requestNo !== c2.requestNo, `${c2.requestNo} → ${c3.requestNo}`);

// 반려
const rej = await api('POST', '/api/admin-approval-decide', { requestId: c3.id, decision: 'reject', comment: '점검', expectedStep: 0 });
check('반려 처리', rej.status === 200 && data(rej)?.status === 'rejected');

/* ── 정리 ── */
const concurrentCancel = await Promise.all([1, 2].map(() => api('POST', '/api/admin-approval-cancel', { requestId: a.id, action: 'cancel', reason: '점검 종료' })));
const cc = concurrentCancel.map((r) => r.status).sort();
check('동시 취소 중 1회만 성공', cc[0] === 200 && cc[1] === 409, cc.join(','));
await api('POST', '/api/admin-approval-cancel', { requestId: b.id, action: 'cancel', reason: '점검 종료' });
await api('POST', '/api/admin-approval-cancel', { requestId: c2.id, action: 'delete' });
await api('POST', '/api/admin-approval-cancel', { requestId: c3.id, action: 'delete' });
const left = data(await api('GET', '/api/admin-approval-requests?box=all&status=pending'));
check('점검 대기 건 없음', !(left.items || []).some((i) => String(i.title).startsWith('[점검]')));
const pl2 = data(await api('GET', '/api/admin-finance-pl-summary?period=year'));
check('정리 뒤 지출 합계가 시험 전과 같음', Number(pl2.expenditure?.total) === Number(pl.expenditure?.total), String(pl2.expenditure?.total));

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
