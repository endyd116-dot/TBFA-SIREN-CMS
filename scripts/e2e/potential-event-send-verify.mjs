// verify-event-send.mjs — 잠재 이벤트별 보기·이벤트 참여자 발송 흐름 E2E (점검용 데이터 생성→검증→정리)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const BASE = 'https://tbfa.co.kr';
const ID = process.env.ADMIN_ID, PW = process.env.ADMIN_PW;
const OUT = path.join(process.cwd(), 'shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (n, ok, d) => { results.push({ n, ok: !!ok, d }); console.log(ok ? '✅' : '❌', n, d == null ? '' : d); };
const jar = new Map(); const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() }, body: body ? JSON.stringify(body) : undefined });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  const data = await res.json().catch(() => ({})); return { status: res.status, ok: res.ok && data.ok !== false, data };
}
const unwrap = (d) => (d && d.data && typeof d.data === 'object') ? d.data : (d || {});
class CDP { constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) for (const h of this.handlers) h(m); }; } send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); } on(fn) { this.handlers.push(fn); } }
const EV = '[점검용 이벤트]';
let PD = 0, GROUP = 0, MID = 0, cdp = null, chrome = null;
try {
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW }); check('로그인', login.ok); if (!login.ok) throw new Error('login');
  await api('POST', '/api/auth/login', { email: ID, password: PW });

  const cr = await api('POST', '/api/admin/potential-donor-crud', { name: '[점검용] 이벤트검증', phone: '010-0000-0002', eventName: EV, entryPath: 'event', memo: '[점검용] 이벤트 발송 검증 — 끝나면 삭제' });
  PD = Number(unwrap(cr.data).id) || 0; check('점검용 잠재 생성', PD > 0, `PD=${PD}`);

  const l1 = await api('GET', `/api/admin/potential-donor-list?sort=event&event=${encodeURIComponent(EV)}&pageSize=10`); const d1 = unwrap(l1.data);
  const evRow = (d1.events || []).find((e) => e.name === EV);
  check('목록 API — event 정확 필터·sort·events 집계', l1.ok && (d1.data || []).length === 1 && d1.data[0].id === PD && evRow && evRow.count === 1 && d1.sort === 'event', `rows=${(d1.data || []).length} events=${(d1.events || []).length} evRow=${JSON.stringify(evRow)}`);
  const ev0 = await api('GET', '/api/admin/potential-donor-events'); const evs = unwrap(ev0.data).events || [];
  check('이벤트 집계 API', ev0.ok && evs.some((e) => e.name === EV) && evs.some((e) => e.name === '제주후원자' && e.count >= 180), evs.map((e) => `${e.name}:${e.count}`).join(' | '));

  const g = await api('POST', '/api/admin/potential-donor-event-group', { eventName: EV }); const gd = unwrap(g.data);
  GROUP = Number(gd.groupId) || 0;
  check('이벤트 수신자 그룹 준비(리드 생성·그룹 생성·인원)', g.ok && GROUP > 0 && gd.created === true && gd.leads && gd.leads.created === 1 && gd.counts && gd.counts.total === 1 && gd.counts.sms === 1, JSON.stringify(gd));
  const l2 = await api('GET', `/api/admin/potential-donor-list?event=${encodeURIComponent(EV)}`); const row2 = (unwrap(l2.data).data || [])[0] || {};
  MID = Number(row2.linkedMemberId) || 0;
  check('잠재 행이 리드 회원에 연결됨', MID > 0 && row2.stage === 'potential', `member=${MID} stage=${row2.stage}`);
  const g2 = await api('POST', '/api/admin/potential-donor-event-group', { eventName: EV }); const gd2 = unwrap(g2.data);
  check('재호출 멱등(같은 그룹·추가 생성 0)', g2.ok && gd2.groupId === GROUP && gd2.created === false && gd2.leads.created === 0, JSON.stringify(gd2.leads));
  const gl = await api('GET', '/api/admin-recipient-groups-list?limit=200'); const grows = (unwrap(gl.data).rows || gl.data.rows || []);
  const grp = grows.find((x) => Number(x.id) === GROUP) || {};
  check('수신자 그룹 목록에 «[이벤트] …» 표시', !!grp.id && String(grp.name || '').includes(EV), `name=${grp.name} summary=${grp.criteriaSummary || grp.summary || ''}`);

  /* 헤드리스 화면 */
  const port = 9336; const profile = path.join(process.cwd(), 'chrome-profile-ev');
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* 대기 */ } await sleep(250); }
  let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
  const ws = new WebSocket((await r.json()).webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; }); cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  cdp.on((m) => { if (m.method === 'Page.javascriptDialogOpening') cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });
  for (const [name, value] of jar) await cdp.send('Network.setCookie', { name, value, domain: 'tbfa.co.kr', path: '/', secure: true, httpOnly: true });
  const ev = async (e) => { const x = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (x.exceptionDetails) throw new Error(x.exceptionDetails.text); return x.result.value; };
  const waitFor = async (e, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(e); if (v) return v; } catch { /* 재시도 */ } await sleep(300); } throw new Error('대기 초과: ' + e.slice(0, 70)); };
  const shot = async (n) => { const x = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(x.data, 'base64')); console.log('  📷', n); };
  await cdp.send('Page.navigate', { url: `${BASE}/cms-tbfa.html?n=${Date.now()}#donor-potential` }); await sleep(3000);
  await ev(`(function(){var a=document.querySelector('a[data-tab="donor-potential"]');if(a)a.click();})()`);
  await waitFor(`document.querySelectorAll('#pdFilterEvent option').length>1 && document.querySelectorAll('#pdBody tr').length>0`);
  const optTxt = await ev(`[...document.querySelectorAll('#pdFilterEvent option')].map(o=>o.textContent).join(' | ')`);
  check('화면: 이벤트 선택지(건수 포함)', /제주후원자 \(\d+명/.test(optTxt) && optTxt.includes(EV), optTxt.slice(0, 160));
  await ev(`(function(){var s=document.getElementById('pdSort');s.value='event';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`document.querySelectorAll('#pdBody tr.pd-group-row').length>0`);
  const heads = await ev(`[...document.querySelectorAll('#pdBody tr.pd-group-row')].map(r=>r.textContent.replace(/\\s+/g,' ').trim()).join(' || ')`);
  await shot('40-potential-sorted-by-event.png');
  check('화면: 이벤트별 정렬 → 묶음 제목 행', heads.includes('제주후원자') || heads.includes('자동 전환'), heads.slice(0, 200));
  await ev(`(function(){var s=document.getElementById('pdFilterEvent');s.value=${JSON.stringify(EV)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(`document.querySelectorAll('#pdBody tr:not(.pd-group-row)').length===1 && !document.getElementById('pdBtnSendEvent').disabled`);
  const btnTxt = await ev(`document.getElementById('pdBtnSendEvent').textContent`);
  await shot('41-potential-event-selected.png');
  check('화면: 이벤트 선택 → 발송 버튼 활성', btnTxt.includes(EV), btnTxt);
  await ev(`document.getElementById('pdBtnSendEvent').click()`);
  await waitFor(`location.hash==='#send-jobs' && (function(){var f=document.querySelector('#page-send-jobs iframe');return f&&/group=/.test(f.src)})()`);
  await sleep(4000);
  const sel = await waitFor(`(function(){var f=document.querySelector('#page-send-jobs iframe');try{var d=f.contentDocument;var s=d&&d.getElementById('fGroup');return s&&s.value?s.value+'|'+s.options[s.selectedIndex].textContent:''}catch(e){return ''}})()`, 30000);
  await shot('42-send-job-create-group-preselected.png');
  check('화면: 발송 작업 만들기 — 이벤트 그룹 자동 선택', sel.startsWith(String(GROUP) + '|') && sel.includes(EV), sel);
  await cdp.send('Page.navigate', { url: `${BASE}/admin-recipient-group-edit.html?id=${GROUP}&n=${Date.now()}` }); await sleep(4000);
  const editTxt = await ev(`document.body.innerText.replace(/\\s+/g,' ')`);
  const optEv = await ev(`[...document.querySelectorAll('select[data-role="values"] option, select option')].map(o=>o.textContent).filter(t=>/제주후원자|점검용 이벤트/.test(t)).join(' | ')`);
  await shot('43-group-edit-potential-event.png');
  check('화면: 그룹 편집 — «잠재 이벤트 참여» 조건·이벤트 선택지', /잠재 이벤트 참여/.test(editTxt) && optEv.length > 0, optEv.slice(0, 160));
} catch (e) { check('예외', false, String(e.stack || e).slice(0, 400)); }
finally {
  try {
    if (GROUP) { let d = await api('DELETE', `/api/admin-recipient-group-delete?id=${GROUP}`); if (!d.ok) d = await api('POST', `/api/admin-recipient-group-delete?id=${GROUP}`); console.log('  점검용 그룹 삭제:', d.status); }
    if (MID) { const w = await api('PATCH', `/api/admin/members?id=${MID}`, { id: MID, inlineStatusOnly: true, status: 'withdrawn' }); console.log('  점검용 리드 회원 탈퇴 처리:', w.status); }
    if (PD) { const dl = await api('DELETE', '/api/admin/potential-donor-crud', { id: PD }); console.log('  점검용 잠재 삭제:', dl.status); }
  } catch (e) { console.log('정리 오류', e.message); }
  try { if (cdp) await cdp.send('Browser.close'); } catch { /* 무시 */ } try { if (chrome) chrome.kill(); } catch { /* 무시 */ }
  const okN = results.filter((r) => r.ok).length; console.log(`\n=== 결과 ${okN}/${results.length} 통과 ===`); for (const r of results) console.log((r.ok ? '✅ ' : '❌ ') + r.n + (r.d ? ' — ' + r.d : ''));
  process.exit(okN === results.length ? 0 : 1);
}
