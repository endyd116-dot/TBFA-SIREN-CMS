// form-contact-verify.mjs — 응답폼 맨 아래 고정 «이메일·전화번호(선택)» 칸 삭제 라이브 검증 (헤드리스 크롬 · ./shots/fc-*.png)
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/form-contact-verify.mjs
// 점검용 폼(이름·이메일·전화 질문)을 API로 만들고 → 공개 화면에 고정 칸이 없는지·질문만 보이는지 → 응답 제출 →
// 응답 조회의 응답자 연락처가 질문 답으로 채워졌는지 → 운영 중인 폼들도 고정 칸이 사라졌는지 → 점검용 폼 삭제.
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

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
function absorb(res) { const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []; for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() }, body: body ? JSON.stringify(body) : undefined });
  absorb(res); const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.ok !== false, data };
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) { for (const h of this.handlers) h(m); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(fn) { this.handlers.push(fn); }
}
let cdp = null, chrome = null;
async function launch() {
  const port = 9337; const profile = path.join(process.cwd(), 'chrome-profile-fc');
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* 대기 */ } await sleep(250); }
  let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
  const ws = new WebSocket((await r.json()).webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; });
  cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  cdp.on((m) => { if (m.method === 'Page.javascriptDialogOpening') cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });
}
async function evalJs(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
async function waitFor(expr, ms = 20000, label = expr) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v = null; try { v = await evalJs(expr); } catch { /* 재시도 */ } if (v) return v; await sleep(300); } throw new Error('대기 시간 초과: ' + label); }
async function shot(name) {
  const m = await cdp.send('Page.getLayoutMetrics'); const h = Math.min(4000, Math.ceil(m.cssContentSize ? m.cssContentSize.height : m.contentSize.height));
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1400, height: h, scale: 1 } });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); log('  📷', name);
}
async function goto(url) { await cdp.send('Page.navigate', { url }); await sleep(1500); }
const FIXED = `(function(){return !!document.querySelector('input[name="__memberEmail"],input[name="__memberPhone"]') || document.body.innerText.includes('응답 결과 통지용')})()`;

const SLUG = 'e2e-contact-' + Date.now().toString(36);
const T = { name: '점검용 응답자', email: 'e2e-contact@lantern.invalid', tel: '010-7700-1234' };
let FORM_ID = 0;
try {
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW });
  check('관리자 로그인', login.ok, '');
  if (!login.ok) throw new Error('로그인 실패');

  const save = await api('POST', '/api/admin-form-save', {
    title: '[점검용] 고정 연락처 칸 삭제 검증', slug: SLUG, description: '라이브 검증용 — 곧 삭제됩니다',
    accessLevel: 'public', requiresAuth: false, isActive: true, isPublished: true, allowDuplicates: true, notifyOnSubmit: false,
    fields: [
      { fieldKey: 'field_1', type: 'text', label: '이름', required: true, sortOrder: 0, isVisible: true, options: [] },
      { fieldKey: 'field_2', type: 'email', label: '이메일', required: false, sortOrder: 1, isVisible: true, options: [] },
      { fieldKey: 'field_3', type: 'tel', label: '연락처', required: false, sortOrder: 2, isVisible: true, options: [] },
    ],
  });
  FORM_ID = Number(save.data.formId) || 0;
  check('점검용 폼 만들기(이름·이메일·전화 질문)', save.ok && FORM_ID > 0, `#${FORM_ID} /${SLUG}`);

  await launch();
  await goto(BASE + '/form.html?slug=' + SLUG);
  await waitFor(`!!document.getElementById('responseForm')`, 20000, '공개 폼');
  const fixed = await evalJs(FIXED);
  const labels = await evalJs(`[...document.querySelectorAll('#responseForm .field label')].map(l=>l.textContent.replace(/\\s+/g,' ').trim())`);
  check('공개 화면: 고정 «이메일·전화번호(선택)» 칸 없음 · 넣은 질문 3개만', !fixed && labels.length === 3, labels.join(' | '));
  await evalJs(`(function(){var f=document.getElementById('responseForm');f.querySelector('[name="field_1"]').value=${JSON.stringify(T.name)};f.querySelector('[name="field_2"]').value=${JSON.stringify(T.email)};f.querySelector('[name="field_3"]').value=${JSON.stringify(T.tel)};})()`);
  await shot('fc-01-public-form.png');
  await evalJs(`document.querySelector('#responseForm button[type=submit]').click()`);
  await waitFor(`!!document.querySelector('.status.success')`, 20000, '제출 완료');
  check('응답 제출 성공', true, '');

  const subs = await api('GET', '/api/admin-form-submissions-list?formId=' + FORM_ID);
  const s0 = (subs.data.submissions || [])[0] || {};
  check('응답 조회: 응답자 연락처가 이메일·전화 질문 답으로 채워짐', s0.memberEmail === T.email && s0.memberPhone === T.tel, JSON.stringify({ memberEmail: s0.memberEmail, memberPhone: s0.memberPhone, data: s0.data }));

  /* 운영 중인 폼들 — 고정 칸이 사라졌는지 */
  const list = await api('GET', '/api/admin-forms-list');
  for (const f of (list.data.forms || []).filter((x) => x.isPublished && x.isActive && x.slug !== SLUG)) {
    await goto(BASE + '/form.html?slug=' + encodeURIComponent(f.slug));
    await waitFor(`!!document.getElementById('responseForm') || !!document.querySelector('.status')`, 20000, f.slug);
    const fx = await evalJs(FIXED);
    check(`운영 중인 폼 «${f.title}»: 고정 칸 없음`, !fx, '/' + f.slug);
  }
} catch (e) {
  check('실행 중 예외', false, e.message);
} finally {
  try { if (FORM_ID) { const d = await api('POST', '/api/admin-form-delete', { id: FORM_ID, confirm: true }); log('  점검용 폼 삭제:', d.status, JSON.stringify(d.data).slice(0, 70)); } } catch (e) { log('정리 중 오류', e.message); }
  try { if (cdp) await cdp.send('Browser.close'); } catch { /* 무시 */ }
  try { chrome && chrome.kill(); } catch { /* 무시 */ }
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n==== 결과 ${okN}/${results.length} 통과 ====`);
  for (const r of results) console.log((r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  process.exit(okN === results.length ? 0 : 1);
}
