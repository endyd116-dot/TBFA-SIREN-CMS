// verify-journey.mjs — 고객 여정 패널·단계 전환 라이브 눈검증 (API + 헤드리스 크롬 CDP 스크린샷)
// 사용: ADMIN_ID=... ADMIN_PW=... node verify-journey.mjs   (스크린샷은 ./shots/*.png)
// 점검용 데이터([점검용] 잠재 1명·메모·단계 이동)는 끝에 정리한다. 실제 회원 데이터는 읽기만 한다(자동 매칭 버튼 제외 — 의도된 운영 동작).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE = 'https://tbfa.co.kr';
const ID = process.env.ADMIN_ID, PW = process.env.ADMIN_PW;
if (!ID || !PW) { console.error('ADMIN_ID / ADMIN_PW 환경변수 필요'); process.exit(2); }
const OUT = path.join(process.cwd(), 'shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); log(ok ? '✅' : '❌', name, detail == null ? '' : detail); }

/* ───────── API (쿠키 보관) ───────── */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
function absorb(res) {
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() }, body: body ? JSON.stringify(body) : undefined });
  absorb(res);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.ok !== false, data };
}
const unwrap = (d) => (d && d.data && typeof d.data === 'object') ? d.data : (d || {});

/* ───────── CDP ───────── */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) { for (const h of this.handlers) h(m); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(fn) { this.handlers.push(fn); }
}
let cdp = null, chrome = null;
async function launch() {
  const port = 9333; const profile = path.join(process.cwd(), 'chrome-profile');
  const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* 대기 */ } await sleep(250); }
  let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
  const wsUrl = (await r.json()).webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl); await new Promise((res) => { ws.onopen = res; });
  cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  cdp.on((m) => { if (m.method === 'Page.javascriptDialogOpening') { log('  대화상자:', (m.params.message || '').slice(0, 60)); cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); } });
  for (const [name, value] of jar) await cdp.send('Network.setCookie', { name, value, domain: 'tbfa.co.kr', path: '/', secure: true, httpOnly: true });
}
async function evalJs(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
async function waitFor(expr, ms = 15000, label = expr) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v = null; try { v = await evalJs(expr); } catch { /* 재시도 */ } if (v) return v; await sleep(300); } throw new Error('대기 시간 초과: ' + label); }
async function shot(name) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); log('  📷', name); return f; }
async function goto(url) { await cdp.send('Page.navigate', { url }); await sleep(1500); }
const toastText = () => evalJs(`(document.getElementById('cmsToast')||{}).textContent || ''`);
async function waitToast(includes, ms = 12000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await toastText(); if (t && t.includes(includes)) return t; await sleep(300); } return await toastText(); }
async function panelOpenAndRendered() { return waitFor(`(function(){var o=document.getElementById('cjOverlay');return !!(o&&!o.hidden&&o.classList.contains('open')&&document.querySelectorAll('#cjBody .cj-sec').length>=3)})()`, 20000, '패널 렌더'); }
async function panelSummary() {
  return evalJs(`(function(){var h=document.getElementById('cjName');var secs=[...document.querySelectorAll('#cjBody .cj-sec-title')].map(e=>e.textContent.trim());return {title:h?h.textContent.trim():'',sections:secs,timeline:document.querySelectorAll('#cjBody .cj-tl-item').length,notes:document.querySelectorAll('#cjBody .cj-note').length,warn:[...document.querySelectorAll('#cjBody .cj-warn,#cjBody .cj-danger')].map(e=>e.textContent.trim()).join(' | ')}})()`);
}
async function panelShots(prefix) {
  const files = [await shot(prefix + '-a.png')];
  for (const [i, top] of [900, 1800, 2700].entries()) {
    const h = await evalJs(`(function(){var b=document.getElementById('cjBody');return b?b.scrollHeight-b.clientHeight:0})()`);
    if (top > h + 50) break;
    await evalJs(`document.getElementById('cjBody').scrollTop=${top}`); await sleep(200);
    files.push(await shot(prefix + '-' + 'bcd'[i] + '.png'));
  }
  await evalJs(`document.getElementById('cjBody').scrollTop=0`);
  return files;
}
async function closePanel() { await evalJs(`window.closeCustomerJourney&&window.closeCustomerJourney()`); await sleep(400); }

/* ───────── 본문 ───────── */
let PD = 0, MID = 0, noteIds = [];
try {
  /* 1. 로그인 */
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW });
  check('관리자 로그인', login.ok, login.ok ? `쿠키 ${[...jar.keys()].join(',')}` : JSON.stringify(login.data).slice(0, 120));
  if (!login.ok) throw new Error('로그인 실패');
  for (const p of ['/api/auth/login', '/api/auth-login']) { /* 회원 세션(관리자 ID)도 함께 — 화면의 로그인 확인용(실패해도 계속) */
    const r = await api('POST', p, { email: ID, password: PW, id: ID }); if (r.ok) { log('  회원 세션도 확보:', p); break; }
  }

  /* 2. API 검증 */
  const list = await api('GET', '/api/admin/potential-donor-list?pageSize=5');
  const lr = unwrap(list.data); const first = (lr.data || [])[0] || {};
  check('잠재 목록 API — 전환 상태 필드·KPI', list.ok && 'stage' in first && lr.kpi && 'converted' in lr.kpi, `stage=${first.stage} kpi=${JSON.stringify(lr.kpi)}`);

  const cr = await api('POST', '/api/admin/potential-donor-crud', { name: '[점검용] 여정검증', phone: '010-0000-0001', eventName: '[점검용] 자동검증', entryPath: 'other', memo: '[점검용] 자동 눈검증 — 끝나면 삭제' });
  PD = Number(unwrap(cr.data).id || cr.data.id) || 0;
  check('점검용 잠재 생성', cr.ok && PD > 0, `PD=${PD}`);

  const j1 = await api('GET', `/api/admin/customer-journey?potential=${PD}`); const d1 = unwrap(j1.data);
  check('여정 API(잠재) — 구조', j1.ok && d1.subject && d1.subject.kind === 'potential' && d1.stage === 'potential' && d1.notes && d1.notes.ready === true, `stage=${d1.stage} notesReady=${d1.notes && d1.notes.ready} timeline=${(d1.timeline || []).length} warnings=${JSON.stringify((d1.meta || {}).warnings)}`);

  const n1 = await api('POST', '/api/admin/customer-notes', { potentialId: PD, body: '[점검용] 메모 저장 확인' }); const nid = Number(unwrap(n1.data).id) || 0; if (nid) noteIds.push(nid);
  const n2 = await api('GET', `/api/admin/customer-notes?potential=${PD}`); const nl = unwrap(n2.data).list || [];
  check('메모 저장·조회', n1.ok && nid > 0 && nl.some((x) => x.id === nid), `id=${nid} 목록 ${nl.length}건`);
  const n3 = await api('PATCH', '/api/admin/customer-notes', { id: nid, pinned: true });
  check('메모 고정', n3.ok, JSON.stringify(n3.data).slice(0, 80));

  const m1 = await api('POST', '/api/admin/donor-stage-move', { potentialId: PD, toStage: 'prospect_onetime', reason: '[점검용] 자동 눈검증' }); const md = unwrap(m1.data);
  MID = Number(md.memberId) || 0;
  check('단계 수동 이동 잠재→예비·일시(리드 회원 생성)', m1.ok && MID > 0 && md.toStage === 'prospect_onetime' && md.override === true, `member=${MID} from=${md.fromStage} auto=${md.autoStage} override=${md.override}`);
  const j2 = await api('GET', `/api/admin/customer-journey?member=${MID}`); const d2 = unwrap(j2.data);
  check('여정 API(회원) — 단계·수동 지정·이력 반영', j2.ok && d2.stage === 'prospect_onetime' && d2.stageInfo && d2.stageInfo.override && (d2.stageInfo.events || []).length >= 1, `stage=${d2.stage} override=${!!(d2.stageInfo && d2.stageInfo.override)} events=${(d2.stageInfo && d2.stageInfo.events || []).length} potential=${(d2.potential || []).length}`);
  const l2 = await api('GET', `/api/admin/potential-donor-list?q=${encodeURIComponent('[점검용]')}`); const row2 = (unwrap(l2.data).data || []).find((r) => r.id === PD) || {};
  check('잠재 표 전환 상태 = 예비·일시 + 수동', row2.stage === 'prospect_onetime' && row2.linkedOverride === true, `stage=${row2.stage} override=${row2.linkedOverride} linked=${row2.linkedMemberId}`);
  const m2 = await api('POST', '/api/admin/donor-stage-move', { memberId: MID, toStage: 'potential', reason: '[점검용] 되돌림' }); const md2 = unwrap(m2.data);
  const j3 = await api('GET', `/api/admin/customer-journey?member=${MID}`); const d3 = unwrap(j3.data);
  check('단계 되돌림 예비→잠재(수동 지정 해제)', m2.ok && md2.toStage === 'potential' && d3.stage === 'potential' && !(d3.stageInfo && d3.stageInfo.override) && (d3.stageInfo.events || []).length >= 2, `override=${md2.override} stage=${d3.stage} events=${(d3.stageInfo && d3.stageInfo.events || []).length}`);

  const reg = await api('GET', '/api/admin/donor-regular-list?pageSize=1'); const regRow = (unwrap(reg.data).data || [])[0];
  if (regRow) {
    const jr = await api('GET', `/api/admin/customer-journey?member=${regRow.id}`); const dr = unwrap(jr.data); const R = dr.regular || {};
    check('여정 API(정기 후원자 실데이터)', jr.ok && dr.stage === 'regular', `M-${regRow.id} ${regRow.name} stage=${dr.stage} 후원 ${dr.donations?.summary?.completedCount}건 ₩${dr.donations?.summary?.completedAmount} 효성약정 ${(R.contracts || []).length} 수납 ${R.hyosungBillings?.count} 카드 ${(R.billingKeys || []).length} 청구 ${(R.billingLogs || []).length} 입금 ${(R.bankMatches || []).length} 타임라인 ${(dr.timeline || []).length} warnings=${JSON.stringify(dr.meta?.warnings)}`);
  } else check('정기 후원자 샘플', false, '정기 목록 비어 있음');
  const pro = await api('GET', '/api/admin/donor-prospect-list?pageSize=1'); const proRow = (unwrap(pro.data).data || [])[0];
  if (proRow) { const jp = await api('GET', `/api/admin/customer-journey?member=${proRow.id}`); const dp = unwrap(jp.data); check('여정 API(예비 후원자 실데이터)', jp.ok && String(dp.stage || '').startsWith('prospect'), `M-${proRow.id} stage=${dp.stage} 타임라인 ${(dp.timeline || []).length}`); }

  /* 3. 헤드리스 크롬 눈검증 */
  await launch();
  await goto(`${BASE}/cms-tbfa.html#donor-potential`);
  await waitFor(`document.querySelectorAll('#pdBody tr').length>0 && !/불러오는 중/.test(document.getElementById('pdBody').textContent)`, 25000, '잠재 표');
  const hdr = await evalJs(`(function(){var th=[...document.querySelectorAll('#page-donor-potential thead th')].map(e=>e.textContent.trim());return {th:th,kpi:[['pdKpiTotal','pdKpiLinked','pdKpiUnlinked'].map(id=>(document.getElementById(id)||{}).textContent).join(' / ')],firstBadge:(document.querySelector('#pdBody tr td:nth-child(9)')||{}).textContent,hasAutomatch:!!document.getElementById('pdBtnAutomatch'),hasMapBtn:/회원연결/.test(document.getElementById('pdBody').textContent),loginPrompt:/관리자 로그인/.test(document.body.textContent)}})()`);
  await shot('01-potential-table.png');
  check('화면: 잠재 표 머리 «전환 상태»·자동 매칭 버튼·수동 회원연결 제거', hdr.th.includes('전환 상태') && hdr.hasAutomatch && !hdr.hasMapBtn, JSON.stringify(hdr));

  await evalJs(`(function(){var i=document.getElementById('pdFilterSearch');i.value='[점검용]';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await waitFor(`/점검용/.test(document.getElementById('pdBody').textContent) && document.querySelectorAll('#pdBody tr').length===1`, 15000, '점검용 행 검색');
  await evalJs(`document.querySelector('#pdBody .cj-link').click()`);
  await panelOpenAndRendered(); await sleep(600);
  let ps = await panelSummary();
  const shots1 = await panelShots('02-panel-potential');
  check('화면: 잠재 이름 클릭 → 패널 열림·섹션', ps.sections.length >= 5 && /점검용/.test(ps.title), JSON.stringify(ps));

  await evalJs(`(function(){var t=document.getElementById('cjNoteText');t.value='[점검용] 화면에서 쓴 메모';})()`);
  const before = ps.notes;
  await evalJs(`[...document.querySelectorAll('#cjBody button')].find(b=>b.textContent.trim()==='메모 저장').click()`);
  await waitFor(`document.querySelectorAll('#cjBody .cj-note').length>${before}`, 15000, '메모 목록 갱신');
  ps = await panelSummary(); await shot('03-panel-note.png');
  check('화면: 메모 저장 → 목록 갱신', ps.notes > before, `메모 ${before}→${ps.notes}`);
  noteIds = noteIds.concat((unwrap((await api('GET', `/api/admin/customer-notes?potential=${PD}`)).data).list || []).map((x) => x.id));

  await evalJs(`(function(){document.getElementById('cjMoveStage').value='prospect_onetime';document.getElementById('cjMoveReason').value='[점검용] 화면 이동';})()`);
  await evalJs(`[...document.querySelectorAll('#cjBody button')].find(b=>b.textContent.trim()==='단계 이동').click()`);
  await waitFor(`/예비/.test((document.getElementById('cjName')||{}).textContent||'')`, 20000, '패널 단계 배지 갱신');
  await sleep(800); await shot('04-panel-moved.png');
  const rowBadge = await waitFor(`(function(){var td=document.querySelector('#pdBody tr td:nth-child(9)');return td&&/예비/.test(td.textContent)?td.textContent.trim():''})()`, 15000, '표 배지 갱신');
  check('화면: 단계 이동(잠재→예비·일시) → 패널·표 반영', /예비/.test(rowBadge) && /수동/.test(rowBadge), `표 배지="${rowBadge}"`);
  await evalJs(`(function(){document.getElementById('cjMoveStage').value='potential';document.getElementById('cjMoveReason').value='[점검용] 되돌림';})()`);
  await evalJs(`[...document.querySelectorAll('#cjBody button')].find(b=>b.textContent.trim()==='단계 이동').click()`);
  await waitFor(`(function(){var h=(document.getElementById('cjName')||{}).textContent||'';return /잠재/.test(h)&&!/예비/.test(h)})()`, 20000, '되돌림 반영');
  await sleep(600); await shot('05-panel-back.png');
  const hist = await evalJs(`(function(){return [...document.querySelectorAll('#cjBody table.cj-table tr')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()).filter(t=>/수동|자동/.test(t)).slice(0,4)})()`);
  check('화면: 단계 이력 표시', hist.length >= 2, JSON.stringify(hist).slice(0, 300));
  await closePanel();

  await evalJs(`location.hash='#donor-regular'`); await sleep(500);
  await waitFor(`document.querySelectorAll('#drBody .cj-link').length>0`, 25000, '정기 표');
  await evalJs(`document.querySelector('#drBody .cj-link').click()`);
  await panelOpenAndRendered(); await sleep(800);
  ps = await panelSummary(); await panelShots('06-panel-regular');
  const regTxt = await evalJs(`document.getElementById('cjBody').textContent`);
  check('화면: 정기 후원자 패널 — 효성/카드·후원 합계', /효성|카드 정기/.test(regTxt) && /후원 합계/.test(regTxt), JSON.stringify(ps).slice(0, 300));
  await closePanel();

  await evalJs(`location.hash='#donor-prospect'`); await sleep(500);
  await waitFor(`document.querySelectorAll('#dpBody .cj-link').length>0`, 25000, '예비 표');
  await evalJs(`document.querySelector('#dpBody .cj-link').click()`);
  await panelOpenAndRendered(); await sleep(800);
  ps = await panelSummary(); await shot('07-panel-prospect.png');
  check('화면: 예비 후원자 패널', ps.sections.length >= 5, JSON.stringify(ps).slice(0, 300));
  await closePanel();

  await evalJs(`location.hash='#donor-potential'`); await sleep(800);
  await waitFor(`document.getElementById('pdBtnAutomatch')&&!document.getElementById('pdBtnAutomatch').disabled`, 10000, '자동 매칭 버튼');
  await evalJs(`document.getElementById('pdBtnAutomatch').click()`);
  const t = await waitToast('자동 매칭', 20000);
  check('화면: 자동 매칭 버튼 → 결과 토스트', /자동 매칭/.test(t), t);
  await shot('08-automatch.png');
} catch (e) {
  check('예외', false, String(e && e.stack || e).slice(0, 400));
} finally {
  /* 4. 정리 */
  try {
    for (const id of [...new Set(noteIds)]) await api('DELETE', '/api/admin/customer-notes', { id });
    if (MID) { const w = await api('PATCH', `/api/admin/members?id=${MID}`, { id: MID, inlineStatusOnly: true, status: 'withdrawn' }); log('  점검용 리드 회원 탈퇴 처리:', w.status, JSON.stringify(w.data).slice(0, 80)); }
    if (PD) { const dl = await api('DELETE', '/api/admin/potential-donor-crud', { id: PD }); log('  점검용 잠재 삭제:', dl.status); }
  } catch (e) { log('정리 중 오류', e.message); }
  try { if (cdp) await cdp.send('Browser.close'); } catch { /* 무시 */ }
  try { if (chrome) chrome.kill(); } catch { /* 무시 */ }
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n=== 결과 ${okN}/${results.length} 통과 ===`);
  for (const r of results) console.log((r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(okN === results.length ? 0 : 1);
}
