// recheck.mjs — 다듬기 배포 뒤 읽기 전용 재확인(점검용 데이터 생성 없음): 정기·예비 패널 스크린샷 + 문구 점검
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const BASE = 'https://tbfa.co.kr';
const ID = process.env.ADMIN_ID, PW = process.env.ADMIN_PW;
const OUT = path.join(process.cwd(), 'shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() }, body: body ? JSON.stringify(body) : undefined });
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  const data = await res.json().catch(() => ({})); return { status: res.status, ok: res.ok && data.ok !== false, data };
}
class CDP { constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) for (const h of this.handlers) h(m); }; } send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); } on(fn) { this.handlers.push(fn); } }
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok, d }); console.log(ok ? '✅' : '❌', n, d || ''); };
let cdp, chrome;
try {
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW }); check('로그인', login.ok);
  await api('POST', '/api/auth/login', { email: ID, password: PW });
  const reg = await api('GET', '/api/admin/donor-regular-list?pageSize=1'); const rid = ((reg.data.data || {}).data || [])[0]?.id;
  const jr = await api('GET', `/api/admin/customer-journey?member=${rid}`); const dr = jr.data.data || {};
  check('API: 무기한 약정 종료 항목 제외', !(dr.timeline || []).some((t) => /약정 종료/.test(t.title) && t.at >= '2999'), `타임라인 ${(dr.timeline || []).length}건, 첫 항목: ${(dr.timeline || [])[0]?.title}`);
  check('API: 자동 생성 기록 표현', (dr.origin?.steps || []).some((s) => /회원 기록 자동 생성|회원 가입/.test(s.label)), JSON.stringify((dr.origin?.steps || []).map((s) => s.label)));
  const port = 9333; const profile = path.join(process.cwd(), 'chrome-profile');
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* 대기 */ } await sleep(250); }
  let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
  const ws = new WebSocket((await r.json()).webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; }); cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const [name, value] of jar) await cdp.send('Network.setCookie', { name, value, domain: 'tbfa.co.kr', path: '/', secure: true, httpOnly: true });
  const ev = async (e) => { const x = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (x.exceptionDetails) throw new Error(x.exceptionDetails.text); return x.result.value; };
  const waitFor = async (e, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(e); if (v) return v; } catch { /* 재시도 */ } await sleep(300); } throw new Error('대기 초과: ' + e.slice(0, 60)); };
  const shot = async (n) => { const x = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(x.data, 'base64')); console.log('  📷', n); };
  await cdp.send('Page.navigate', { url: `${BASE}/cms-tbfa.html?v=${Date.now()}#donor-prospect` }); await sleep(2500);
  await ev(`location.hash='#donor-prospect'`);
  await waitFor(`document.querySelectorAll('#dpBody .cj-link').length>0`);
  await ev(`document.querySelector('#dpBody .cj-link').click()`);
  await waitFor(`document.querySelectorAll('#cjBody .cj-sec').length>=5`); await sleep(800);
  const t1 = await ev(`document.getElementById('cjBody').textContent`);
  await shot('11-recheck-prospect.png');
  check('화면: 예비·해지 — 재평가 예고 문구·정기 상태 «해지»·효성 대기 한글', /다음 재평가/.test(t1) && /해지/.test(t1) && !/pending_hyosung/.test(t1), '');
  await ev(`window.closeCustomerJourney()`); await sleep(400);
  await ev(`location.hash='#donor-regular'`); await sleep(500);
  await waitFor(`document.querySelectorAll('#drBody .cj-link').length>0`);
  await ev(`document.querySelector('#drBody .cj-link').click()`);
  await waitFor(`document.querySelectorAll('#cjBody .cj-sec').length>=5`); await sleep(800);
  const t2 = await ev(`document.getElementById('cjBody').textContent`);
  await ev(`document.getElementById('cjBody').scrollTop=900`); await sleep(300); await shot('12-recheck-regular-b.png');
  await ev(`document.getElementById('cjBody').scrollTop=1800`); await sleep(300); await shot('13-recheck-regular-c.png');
  check('화면: 정기 — 약정 기간 «무기한»·약정 종료 항목 없음·자동 생성 기록 표현', /무기한/.test(t2) && !/약정 종료 \(사용\)/.test(t2) && /자동 생성 기록/.test(t2), '');
} catch (e) { check('예외', false, String(e.stack || e).slice(0, 300)); }
finally { try { if (cdp) await cdp.send('Browser.close'); } catch { /* 무시 */ } try { if (chrome) chrome.kill(); } catch { /* 무시 */ } console.log(`=== ${results.filter((r) => r.ok).length}/${results.length} 통과 ===`); process.exit(results.every((r) => r.ok) ? 0 : 1); }
