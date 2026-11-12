// memorial-letter-photo-verify.mjs — 기억의 편지 «사진 1장 붙이기» 라이브 눈검증 (헤드리스 크롬 CDP · 스크린샷 ./shots/lp-*.png)
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/memorial-letter-photo-verify.mjs [선생님 번호]
// 흐름: ① 선생님 화면(로그인 없이)에서 점검용 편지에 사진을 붙여 보낸다 → «운영자 확인 뒤 공개» 안내 · 공개 목록에 아직 없음
//       ② 관리자 화면 «사진 편지 검토 대기»에서 [공개]
//       ③ 선생님 화면 새로고침 → 봉투 표지 · 열면 크게 · (휴대폰 폭도) · 사진 파일에 위치정보 없음 · 긴 변 2400px 이하
//       ④ 관리자 화면 편지 목록에서 [삭제] → 공개 목록·사진 주소에서 사라지는지
// 시험 사진은 스크립트가 만든다(3000×2000 JPEG · 위치정보(GPS)·기기 이름을 일부러 넣음).
// 남는 것: 편지 한 통 = 등불 하나로 함께 쌓인 등불 1개 · 운영자 알림 · 비공개 사진 파일 1개 — 결과 파일(lp-result.json)의
//          번호로 따로 정리한다(이 스크립트는 DB를 직접 건드리지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const sharp = require('sharp');

const BASE = 'https://tbfa.co.kr';
const ID = process.env.ADMIN_ID, PW = process.env.ADMIN_PW;
if (!ID || !PW) { console.error('ADMIN_ID / ADMIN_PW 환경변수 필요'); process.exit(2); }
const OUT = path.join(process.cwd(), 'shots'); fs.mkdirSync(OUT, { recursive: true });
const ASSET = path.join(process.cwd(), 'lp-assets'); fs.mkdirSync(ASSET, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); log(ok ? '✅' : '❌', name, detail == null ? '' : detail); }
const pick = (j, k) => (j && j.data && j.data.data && j.data.data[k] !== undefined) ? j.data.data[k]
  : (j && j.data && j.data[k] !== undefined) ? j.data[k] : (j ? j[k] : undefined);
const abs = (u) => (/^https?:/i.test(u) ? u : BASE + u);

/* RESUME_RUN=<앞 실행 번호> : 앞 실행이 ①(보내기)까지 마치고 멈췄을 때 그 편지로 ②부터 이어 간다(편지를 새로 보내지 않음) */
const RESUME = String(process.env.RESUME_RUN || '').trim();
const RUN = RESUME || Date.now().toString(36);
const MARK = `[점검용 ${RUN}]`;
const CONTENT = `${MARK} 사진 편지 기능 점검입니다. 확인 후 바로 지웁니다.`;
const AUTHOR = '점검용';
const state = { run: RUN, startedAt: new Date().toISOString(), teacherId: 0, letterId: 0, photoId: 0, sent: false, deleted: false, before: null };

/* ───────── 시험 사진 — 위치정보·기기 이름을 일부러 넣는다 ───────── */
const W = 3000, H = 2000;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d9b1"/><stop offset="0.55" stop-color="#c9a7c7"/><stop offset="1" stop-color="#6f8fbf"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="2250" cy="640" r="360" fill="#fff6dc" opacity="0.9"/>
  <path d="M0 1500 Q 750 1250 1500 1480 T 3000 1420 V 2000 H 0 Z" fill="#3c4a63" opacity="0.75"/>
  <rect x="380" y="420" width="900" height="620" rx="36" fill="#ffffff" opacity="0.35"/>
</svg>`;
const EXIF = {
  IFD0: { Make: 'E2E-EXIF-MAKE', Model: 'E2E-EXIF-MODEL' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 33/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '126/1 50/1 0/1' },
};
let pipe = sharp(Buffer.from(svg)).jpeg({ quality: 88 });
pipe = typeof pipe.withExif === 'function' ? pipe.withExif(EXIF) : pipe.withMetadata({ exif: EXIF });
const JPG = await pipe.toBuffer();
const PHOTO_FILE = path.join(ASSET, 'e2e-letter-photo.jpg');
fs.writeFileSync(PHOTO_FILE, JPG);
const srcMeta = await sharp(JPG).metadata();
check('시험 사진 준비(위치정보·기기 이름 넣음)', !!srcMeta.exif && JPG.includes(Buffer.from('E2E-EXIF-MAKE')),
  `${srcMeta.width}×${srcMeta.height} · ${Math.round(JPG.length / 1024)}KB · EXIF ${srcMeta.exif ? srcMeta.exif.length + 'B' : '없음'}`);

/* ───────── API (쿠키 보관) ───────── */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
function absorb(res) { const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []; for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() }, body: body ? JSON.stringify(body) : undefined });
  absorb(res); const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.ok !== false, data };
}
async function publicLetters(tid) {
  const r = await fetch(`${BASE}/api/memorial-letters?teacherId=${tid}&_cb=${Date.now()}`);
  const j = await r.json().catch(() => ({}));
  return pick(j, 'letters') || [];
}
async function teacherCounts(tid) {
  const r = await fetch(`${BASE}/api/memorial-teacher?id=${tid}&_cb=${Date.now()}`);
  const j = await r.json().catch(() => ({}));
  const t = pick(j, 'teacher') || {};
  return { candleCount: Number(t.candleCount ?? pick(j, 'candleCount') ?? -1), letterCount: Number(t.letterCount ?? pick(j, 'letterCount') ?? -1) };
}
let loggedIn = false;
async function adminLogin() {
  if (loggedIn) return true;
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW });
  check('관리자 로그인', login.ok, login.ok ? '' : ((login.data && login.data.error) || login.status));
  loggedIn = login.ok;
  return login.ok;
}

/* ───────── CDP ───────── */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) { for (const h of this.handlers) h(m); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(fn) { this.handlers.push(fn); }
}
let cdp = null, chrome = null;
const dialogs = [], pageErrors = [];
async function launch() {
  const port = 9337; const profile = path.join(process.cwd(), 'chrome-profile-lp');
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* 대기 */ } await sleep(250); }
  let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
  const ws = new WebSocket((await r.json()).webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; });
  cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('DOM.enable');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await setViewport(1400, 1000, false);
  cdp.on((m) => {
    if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message || ''); log('  대화상자:', (m.params.message || '').replace(/\s+/g, ' ').slice(0, 90)); cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails || {}; pageErrors.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0].slice(0, 160)); }
  });
}
async function setAdminCookies() { for (const [name, value] of jar) await cdp.send('Network.setCookie', { name, value, domain: 'tbfa.co.kr', path: '/', secure: true, httpOnly: true }); }
async function setViewport(width, height, mobile) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); }
async function evalJs(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
async function waitFor(expr, ms = 20000, label = expr) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v = null; try { v = await evalJs(expr); } catch { /* 재시도 */ } if (v) return v; await sleep(300); } throw new Error('대기 시간 초과: ' + label); }
async function shot(name) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); log('  📷', name); return f; }
async function goto(url) { await cdp.send('Page.navigate', { url }); await sleep(1500); }
async function setFiles(selector, files) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error('파일 입력 칸을 못 찾음: ' + selector);
  await cdp.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: files.map((p) => path.resolve(p)) });
}
const visible = (id) => `(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e && getComputedStyle(e).display!=='none';})()`;
const imgOk = (sel) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});return i && i.complete && i.naturalWidth>0 ? i.naturalWidth+'x'+i.naturalHeight : '';})()`;
const rowExpr = `[...document.querySelectorAll('#modTbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(MARK)}))`;

async function findMyPending() {
  const pend = await api('GET', '/api/admin-memorial-moderation?type=letter&photo=pending');
  const items = pick(pend.data, 'items') || [];
  return { items, mine: items.find((it) => String(it.content || '').includes(MARK)) || null };
}

/* ───────── 본문 ───────── */
try {
  /* 점검할 선생님 — 인자로 받거나 공개 목록 첫 분 */
  let tid = Number(process.argv[2] || 0);
  if (!tid) {
    const tj = await (await fetch(`${BASE}/api/memorial-teachers?_cb=${Date.now()}`)).json().catch(() => ({}));
    const list = pick(tj, 'teachers') || pick(tj, 'items') || [];
    tid = Number(list[0] && (list[0].id || list[0].teacherId)) || 0;
  }
  if (!tid) throw new Error('점검할 선생님을 찾지 못함');
  state.teacherId = tid;
  state.before = await teacherCounts(tid);
  log('점검 선생님 #' + tid, '점검 전 등불', state.before.candleCount, '· 편지', state.before.letterCount);

  await launch();

  /* ① 로그인 없이 사진 편지 보내기 */
  if (RESUME) {
    state.sent = true;
    log('① 앞 실행에서 보낸 점검 편지로 이어 갑니다', MARK);
  } else {
  await goto(`${BASE}/memorial-teacher.html?id=${tid}`);
  await waitFor(visible('mtLtPhotoField'), 30000, '사진 붙이기 칸');
  check('① 선생님 화면에 «사진 1장 붙이기» 칸 보임', true);
  await setFiles('#mtLtPhoto', [PHOTO_FILE]);
  const prev = await waitFor(`(${visible('mtLtPhotoPreview')}) && (${imgOk('#mtLtPhotoImg')})`, 20000, '미리보기');
  check('① 사진 고르면 미리보기', !!prev, prev);
  await evalJs(`(()=>{const b=document.getElementById('mtLtBody');b.value=${JSON.stringify(CONTENT)};b.dispatchEvent(new Event('input',{bubbles:true}));const n=document.getElementById('mtLtName');n.value=${JSON.stringify(AUTHOR)};n.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('mtLtPhotoField').scrollIntoView({block:'center'});return true;})()`);
  await sleep(500);
  await shot('lp-1a-form.png');
  await evalJs(`document.getElementById('mtLtSubmit').click(); true`);
  const sentText = await waitFor(`(()=>{const e=document.getElementById('mtLtSent');return e && getComputedStyle(e).display!=='none' && e.textContent.trim() ? e.textContent.trim() : '';})()`, 90000, '보낸 뒤 안내');
  state.sent = true;
  check('① 보낸 뒤 «운영자가 확인한 뒤 공개» 안내', /운영자가 확인한 뒤 공개/.test(sentText), sentText.slice(0, 70) + '…');
  await evalJs(`document.getElementById('mtLtSent').scrollIntoView({block:'center'}); true`);
  await sleep(400);
  await shot('lp-1b-sent.png');
  const pub1 = await publicLetters(tid);
  check('① 공개 목록에는 아직 없음', !pub1.some((l) => String(l.content || '').includes(MARK)), `공개 편지 ${pub1.length}통`);
  }

  /* ② 관리자 «사진 편지 검토 대기» → [공개] */
  if (!(await adminLogin())) throw new Error('로그인 실패');
  const { items, mine } = await findMyPending();
  check('② 관리자 «사진 편지 검토 대기»에 도착', !!mine, mine ? `편지 #${mine.id} · 대기 ${items.length}건` : `대기 ${items.length}건`);
  if (!mine) throw new Error('대기 목록에서 점검 편지를 못 찾음');
  state.letterId = Number(mine.id);
  const pm = /[?&]id=(\d+)/.exec(String(mine.photoUrl || ''));
  state.photoId = pm ? Number(pm[1]) : 0;
  /* 검토 전 사진은 로그인 없이 못 봐야 한다 */
  if (mine.photoUrl) {
    const anon = await fetch(abs(mine.photoUrl) + '&_cb=' + Date.now(), { redirect: 'manual' });
    check('② 검토 전 사진은 로그인 없이 못 봄', anon.status === 403 || anon.status === 401, `상태 ${anon.status}`);
  }
  await setAdminCookies();
  await goto(`${BASE}/admin-memorial.html`);
  await waitFor(`typeof switchTab === 'function'`, 20000, '관리자 화면');
  await evalJs(`switchTab('moderation'); true`);
  const cardSel = `#lpList .lp-card[data-lp-id="${state.letterId}"]`;
  await waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, 30000, '대기 카드');
  const cardImg = await waitFor(imgOk(cardSel + ' img'), 20000, '대기 카드 사진');
  check('② 관리자 화면에서 사진 미리 보임', !!cardImg, cardImg);
  await evalJs(`document.getElementById('lpBox').scrollIntoView({block:'start'}); true`);
  await sleep(400);
  await shot('lp-2a-admin-pending.png');
  await evalJs(`document.querySelector(${JSON.stringify(cardSel + ' .btn-success')}).click(); true`);
  await waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 30000, '공개 처리');
  check('② [공개] 누르면 대기 목록에서 빠짐', true, dialogs.length ? '확인 창: ' + dialogs[dialogs.length - 1].split('\n')[0] : '');
  await sleep(600);
  await shot('lp-2b-admin-approved.png');

  /* ③ 로그인 없이 선생님 화면 — 봉투 표지 · 열면 크게 */
  await cdp.send('Network.clearBrowserCookies');
  const envSel = `#mtEnv${state.letterId}`;
  await goto(`${BASE}/memorial-teacher.html?id=${tid}`);
  await waitFor(`!!document.querySelector(${JSON.stringify(envSel + '.has-cover .mt2-env-cover img')})`, 30000, '표지 봉투');
  const cover = await waitFor(imgOk(envSel + ' .mt2-env-cover img'), 20000, '표지 사진');
  check('③ 봉투 표지에 사진(PC)', !!cover, cover);
  await evalJs(`document.querySelector(${JSON.stringify(envSel)}).scrollIntoView({block:'center'}); true`);
  await sleep(700);
  await shot('lp-3a-cover-pc.png');
  await evalJs(`document.querySelector(${JSON.stringify(envSel)}).click(); true`);
  const big = await waitFor(`(${visible('mtLtBoxPhoto')}) && (${imgOk('#mtLtBoxImg')})`, 20000, '크게 보기');
  check('③ 봉투를 열면 사진 크게(PC)', !!big, big);
  await sleep(600);
  await shot('lp-3b-open-pc.png');

  await setViewport(390, 844, true);
  await goto(`${BASE}/memorial-teacher.html?id=${tid}`);
  await waitFor(imgOk(envSel + ' .mt2-env-cover img'), 30000, '표지 사진(휴대폰)');
  await evalJs(`document.querySelector(${JSON.stringify(envSel)}).scrollIntoView({block:'center'}); true`);
  await sleep(700);
  await shot('lp-3c-cover-mobile.png');
  await evalJs(`document.querySelector(${JSON.stringify(envSel)}).click(); true`);
  const bigM = await waitFor(`(${visible('mtLtBoxPhoto')}) && (${imgOk('#mtLtBoxImg')})`, 20000, '크게 보기(휴대폰)');
  check('③ 휴대폰 폭에서도 표지·크게 보기', !!bigM, bigM);
  await sleep(600);
  await shot('lp-3d-open-mobile.png');
  await setViewport(1400, 1000, false);

  /* 사진 파일 자체 — 로그인 없이 받아서 위치정보·크기 확인 */
  const pub3 = await publicLetters(tid);
  const L = pub3.find((l) => Number(l.id) === state.letterId);
  check('③ 공개 목록에 사진 주소', !!(L && L.photoUrl), L ? L.photoUrl : '없음');
  if (L && L.photoUrl) {
    const r = await fetch(abs(L.photoUrl));
    const buf = Buffer.from(await r.arrayBuffer());
    const ctype = r.headers.get('content-type') || '';
    check('③ 로그인 없이 사진 받기', r.ok && /^image\//.test(ctype), `${r.status} · ${ctype} · ${Math.round(buf.length / 1024)}KB`);
    if (r.ok) {
      const m = await sharp(buf).metadata();
      check('③ 위치정보·기기 이름 지워짐', !m.exif && !buf.includes(Buffer.from('E2E-EXIF')), m.exif ? `EXIF ${m.exif.length}B 남음` : 'EXIF 없음');
      check('③ 큰 사진은 긴 변 2400px 이하로', Math.max(m.width || 0, m.height || 0) <= 2400, `${m.width}×${m.height} (보낸 사진 ${W}×${H})`);
    }
  }

  /* ④ 관리자 편지 목록에서 삭제 */
  await setAdminCookies();
  await goto(`${BASE}/admin-memorial.html`);
  await waitFor(`typeof switchTab === 'function'`, 20000, '관리자 화면');
  await evalJs(`switchTab('moderation'); switchModType('letter'); switchModSort('recent'); true`);
  await waitFor(`!!(${rowExpr})`, 30000, '편지 목록의 점검 편지');
  await evalJs(`(${rowExpr}).scrollIntoView({block:'center'}); true`);
  await sleep(500);
  await shot('lp-4a-admin-row.png');
  await evalJs(`(${rowExpr}).querySelector('.btn-danger').click(); true`);
  await waitFor(`!(${rowExpr})`, 30000, '삭제');
  state.deleted = true;
  check('④ 관리자 화면에서 삭제', true, dialogs.length ? '확인 창: ' + dialogs[dialogs.length - 1].split('\n')[0] : '');
  const pub4 = await publicLetters(tid);
  check('④ 공개 목록에서 사라짐', !pub4.some((l) => Number(l.id) === state.letterId), `공개 편지 ${pub4.length}통`);
  if (L && L.photoUrl) {
    const fresh = await fetch(abs(L.photoUrl) + '&_cb=' + Date.now(), { redirect: 'manual' });
    /* 비공개 사진은 로그인하지 않은 요청에 401(관리자 로그인 필요)로 막힌다 — 403·404도 막힘으로 본다 */
    check('④ 삭제 뒤 사진 주소 막힘(새로 묻는 요청)', [401, 403, 404].includes(fresh.status), `상태 ${fresh.status}`);
    const same = await fetch(abs(L.photoUrl), { redirect: 'manual' });
    const age = same.headers.get('age');
    state.sameUrlAfterDelete = { status: same.status, cacheControl: same.headers.get('cache-control'), age, cacheStatus: same.headers.get('cache-status') };
    check('④ 삭제 뒤 표지에 쓰던 같은 주소', [401, 403, 404].includes(same.status),
      `상태 ${same.status}${same.status === 302 ? ' (캐시에 남은 안내 — 최대 5분)' : ''} · cache-control ${same.headers.get('cache-control')} · age ${age ?? '-'}`);
  }
} catch (e) {
  check('진행 중 오류', false, String(e && e.message || e).slice(0, 200));
} finally {
  /* 중간에 멈췄으면 점검 편지를 남기지 않는다 */
  try {
    if (state.sent && !state.deleted) {
      if (await adminLogin()) {
        if (!state.letterId) { const { mine } = await findMyPending(); if (mine) state.letterId = Number(mine.id); }
        if (state.letterId) {
          const d = await api('DELETE', `/api/admin-memorial-moderation?type=letter&id=${state.letterId}`);
          state.deleted = d.ok;
          check('정리: 남은 점검 편지 삭제', d.ok, `편지 #${state.letterId} · ${d.status}`);
        }
      }
    }
  } catch (e) { check('정리 실패', false, String(e && e.message || e).slice(0, 200)); }
  if (pageErrors.length) log('화면 스크립트 오류', pageErrors.length + '건:', pageErrors.slice(0, 3).join(' | '));
  state.pageErrors = pageErrors;
  state.finishedAt = new Date().toISOString();
  state.results = results;
  fs.writeFileSync(path.join(process.cwd(), 'lp-result.json'), JSON.stringify(state, null, 2), 'utf8');
  const bad = results.filter((r) => !r.ok);
  log(`결과: ${results.length - bad.length}/${results.length} 통과` + (bad.length ? ' · 실패: ' + bad.map((b) => b.name).join(', ') : ''));
  try { if (cdp) await cdp.send('Browser.close'); } catch { /* 이미 닫힘 */ }
  try { if (chrome) chrome.kill(); } catch { /* 이미 닫힘 */ }
  process.exit(bad.length ? 1 : 0);
}
