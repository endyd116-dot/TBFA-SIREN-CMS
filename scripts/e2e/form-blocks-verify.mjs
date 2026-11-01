// form-blocks-verify.mjs — 응답폼·신청폼 «이미지»·«자료» 블록 라이브 눈검증 (헤드리스 크롬 CDP · 스크린샷 ./shots/fb-*.png)
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/form-blocks-verify.mjs
// 흐름: 관리자 화면에서 점검용 폼을 «화면 조작으로» 만든다(질문 1 + 이미지 블록 2장 + 자료 블록 2개 업로드·배치·크기·발행)
//       → 공개 응답 화면(데스크톱·휴대폰) 확인 → 내려받기 확인 → 응답 1건 제출 → 응답 조회에서 블록 제외 확인 → 폼 삭제.
// 시험 파일은 스크립트가 만든다(PNG 2400×1600·PNG 800×600·작은 PDF·이름만 .hwp). 올린 시험 파일 4개(공개·수백 KB)는 업로드 기록에 남는다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const BASE = 'https://tbfa.co.kr';
const ID = process.env.ADMIN_ID, PW = process.env.ADMIN_PW;
if (!ID || !PW) { console.error('ADMIN_ID / ADMIN_PW 환경변수 필요'); process.exit(2); }
const OUT = path.join(process.cwd(), 'shots'); fs.mkdirSync(OUT, { recursive: true });
const ASSET = path.join(process.cwd(), 'fb-assets'); fs.mkdirSync(ASSET, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); log(ok ? '✅' : '❌', name, detail == null ? '' : detail); }

/* ───────── 시험 파일 만들기 ───────── */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makePng(w, h, fn) {
  const row = w * 3 + 1; const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) { raw[y * row] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const o = y * row + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const F = {
  poster: path.join(ASSET, 'e2e-poster.png'),
  photo: path.join(ASSET, 'e2e-photo.png'),
  pdf: path.join(ASSET, 'e2e-guide.pdf'),
  hwp: path.join(ASSET, '점검용-신청서.hwp'),
};
fs.writeFileSync(F.poster, makePng(2400, 1600, (x, y) => [Math.round(122 + (x / 2400) * 100), Math.round(31 + (y / 1600) * 60), 43 + ((x >> 6) % 2) * 30]));
fs.writeFileSync(F.photo, makePng(800, 600, (x, y) => [40 + ((x >> 4) % 2) * 60, 90 + (y / 600) * 120, 160]));
fs.writeFileSync(F.pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
fs.writeFileSync(F.hwp, Buffer.from('HWP Document File (e2e test — not a real hwp) '.repeat(40)));
log('시험 파일:', Object.values(F).map((p) => path.basename(p) + ' ' + fs.statSync(p).size + 'B').join(' · '));

/* ───────── API (쿠키 보관) ───────── */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
function absorb(res) { const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []; for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
async function api(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() }, body: body ? JSON.stringify(body) : undefined });
  absorb(res); const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.ok !== false, data };
}

/* ───────── CDP ───────── */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) { for (const h of this.handlers) h(m); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(fn) { this.handlers.push(fn); }
}
let cdp = null, chrome = null;
const dialogs = [];
async function launch() {
  const port = 9336; const profile = path.join(process.cwd(), 'chrome-profile-fb');
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* 대기 */ } await sleep(250); }
  let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
  const ws = new WebSocket((await r.json()).webSocketDebuggerUrl); await new Promise((res) => { ws.onopen = res; });
  cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('DOM.enable');
  await setViewport(1400, 1000, false);
  cdp.on((m) => { if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.message || ''); log('  대화상자:', (m.params.message || '').replace(/\s+/g, ' ').slice(0, 90)); cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); } });
  for (const [name, value] of jar) await cdp.send('Network.setCookie', { name, value, domain: 'tbfa.co.kr', path: '/', secure: true, httpOnly: true });
}
async function setViewport(width, height, mobile) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); }
async function evalJs(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
async function waitFor(expr, ms = 20000, label = expr) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v = null; try { v = await evalJs(expr); } catch { /* 재시도 */ } if (v) return v; await sleep(300); } throw new Error('대기 시간 초과: ' + label); }
async function shot(name, full) {
  let params = { format: 'png' };
  if (full) { const m = await cdp.send('Page.getLayoutMetrics'); const h = Math.min(6000, Math.ceil(m.cssContentSize ? m.cssContentSize.height : m.contentSize.height)); const w = Math.ceil(m.cssLayoutViewport ? m.cssLayoutViewport.clientWidth : 1400); params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }; }
  const r = await cdp.send('Page.captureScreenshot', params); const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); log('  📷', name); return f;
}
async function goto(url) { await cdp.send('Page.navigate', { url }); await sleep(1500); }
async function setFiles(selector, files) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error('파일 입력 칸을 못 찾음: ' + selector);
  await cdp.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: files.map((p) => path.resolve(p)) });
}

/* ───────── 본문 ───────── */
const SLUG = 'e2e-blocks-' + Date.now().toString(36);
let FORM_ID = 0;
try {
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW });
  check('관리자 로그인', login.ok, '');
  if (!login.ok) throw new Error('로그인 실패');
  await launch();

  /* 1) 관리자 화면에서 폼 만들기 — 질문 1 + 이미지 블록 + 자료 블록 */
  await goto(BASE + '/admin-forms.html');
  await waitFor(`typeof openModal === 'function' && typeof addField === 'function' && !document.querySelector('#formsTable tbody').textContent.includes('불러오는 중')`, 25000, '폼 목록');
  await evalJs(`openModal()`); await sleep(500);
  await evalJs(`(function(){document.getElementById('fTitle').value='[점검용] 이미지·자료 블록 검증';document.getElementById('fSlug').value=${JSON.stringify(SLUG)};document.getElementById('fDescription').value='라이브 검증용 폼 — 곧 삭제됩니다';})()`);
  await evalJs(`addField('text'); _fields[0].label='이름'; _fields[0].required=true; renderFields();`);
  const bar = await evalJs(`(function(){var b=[...document.querySelectorAll('.add-block-bar button')].map(x=>x.textContent.trim());return b.join(' | ')})()`);
  check('관리자 화면: «+ 이미지·자료 넣기» 버튼', bar.includes('이미지') && bar.includes('자료'), bar);

  await evalJs(`[...document.querySelectorAll('.add-block-bar button')].find(x=>x.textContent.includes('이미지')).click()`);
  await waitFor(`!!document.querySelector('.block-card[data-block-key="img_1"] input[type=file]')`, 8000, '이미지 블록 카드');
  await setFiles('.block-card[data-block-key="img_1"] input[type=file]', [F.poster, F.photo]);
  await waitFor(`(function(){var f=_fields.find(x=>x.type==='image');return f&&f.options.items.length===2&&_uploading===0})()`, 90000, '이미지 2장 업로드');
  const imgItems = await evalJs(`JSON.stringify(_fields.find(x=>x.type==='image').options.items)`);
  check('이미지 블록: 2장 업로드(저장소 직접 올리기→확인)', JSON.parse(imgItems).length === 2, imgItems.slice(0, 200));
  await evalJs(`(function(){var c=document.querySelector('.block-card[data-block-key="img_1"]');var t=c.querySelectorAll('input[type=text]');t[0].value='2026 추모식 포스터';t[0].dispatchEvent(new Event('input',{bubbles:true}));t[1].value='포스터를 누르면 크게 볼 수 있습니다';t[1].dispatchEvent(new Event('input',{bubbles:true}));var s=c.querySelector('select');s.value='medium';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);

  await evalJs(`[...document.querySelectorAll('.add-block-bar button')].find(x=>x.textContent.includes('자료')).click()`);
  await waitFor(`!!document.querySelector('.block-card[data-block-key="doc_1"] input[type=file]')`, 8000, '자료 블록 카드');
  await setFiles('.block-card[data-block-key="doc_1"] input[type=file]', [F.pdf, F.hwp]);
  await waitFor(`(function(){var f=_fields.find(x=>x.type==='attachment');return f&&f.options.items.length===2&&_uploading===0})()`, 90000, '자료 2개 업로드');
  const docItems = await evalJs(`JSON.stringify(_fields.find(x=>x.type==='attachment').options.items)`);
  const docs = JSON.parse(docItems);
  /* 한글 파일 형식 이름은 PC마다 다르다(한컴 설치 PC는 application/haansofthwp, 없으면 비어 있어 확장자로 application/x-hwp) — 어느 쪽이든 올라가면 통과 */
  check('자료 블록: PDF·한글(.hwp) 업로드', docs.length === 2 && docs.some((d) => /\.hwp$/i.test(d.name) && /hwp/i.test(d.mime)), docs.map((d) => `${d.name}(${d.mime})`).join(', '));
  await evalJs(`(function(){var c=document.querySelector('.block-card[data-block-key="doc_1"]');var t=c.querySelectorAll('input[type=text]');t[0].value='참가 안내문·신청서 양식';t[0].dispatchEvent(new Event('input',{bubbles:true}));})()`);

  /* 이미지 블록을 맨 위로(질문 위) */
  await evalJs(`(function(){var c=document.querySelector('.block-card[data-block-key="img_1"]');c.querySelector('.field-card-actions button').click();})()`);
  await sleep(300);
  const order = await evalJs(`_fields.map(f=>f.type+':'+f.fieldKey).join(' → ')`);
  check('↑로 이미지 블록을 맨 위로 배치', order.startsWith('image:img_1'), order);
  await evalJs(`(function(){var m=document.querySelector('#modalBg .modal');var c=document.querySelector('.block-card[data-block-key="img_1"]');if(c)c.scrollIntoView({block:'start'});})()`);
  await sleep(500);
  await shot('fb-01-builder-blocks.png');
  await evalJs(`(function(){var c=document.querySelector('.block-card[data-block-key="doc_1"]');if(c)c.scrollIntoView({block:'center'});})()`);
  await sleep(400);
  await shot('fb-02-builder-attachment.png');

  /* 발행 + 저장 */
  await evalJs(`document.getElementById('fIsPublished').checked=true; document.getElementById('fIsActive').checked=true;`);
  dialogs.length = 0;
  await evalJs(`saveForm()`);
  await waitFor(`!document.getElementById('modalBg').classList.contains('show')`, 20000, '저장 후 창 닫힘');
  check('저장 성공(안내 대화상자)', dialogs.some((d) => d.includes('저장 완료')), dialogs.join(' / ').slice(0, 120));

  /* 2) API 확인 — 목록 블록 수·공개 폼 블록 순서·주소 */
  const list = await api('GET', '/api/admin-forms-list');
  const row = (list.data.forms || []).find((f) => f.slug === SLUG); FORM_ID = row ? row.id : 0;
  check('폼 목록: 질문 수 1·블록 수 2 분리', row && row.fieldCount === 1 && row.blockCount === 2, row ? JSON.stringify({ fieldCount: row.fieldCount, blockCount: row.blockCount }) : '목록에 없음');
  const pub = await api('GET', '/api/form?slug=' + SLUG);
  const pf = (pub.data.form && pub.data.form.fields) || [];
  check('공개 폼 API: 이미지(중간)→질문→자료 순서·주소 동봉', pf.length === 3 && pf[0].type === 'image' && pf[0].options.size === 'medium' && pf[0].options.items[0].url && pf[2].type === 'attachment' && pf[2].options.items[0].downloadUrl,
    pf.map((f) => f.type + (f.options && f.options.items ? `(${f.options.items.length})` : '')).join(' → '));

  /* 큰 사진 자동 축소 확인 — 올라간 포스터의 가로 크기 */
  const posterItem = pf[0] && pf[0].options.items.find((it) => /poster/i.test(it.name));
  if (posterItem) {
    const r1 = await fetch(BASE + posterItem.url, { redirect: 'follow' });
    const buf = Buffer.from(await r1.arrayBuffer());
    const w = buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG' ? buf.readUInt32BE(16) : -1;
    const h = w > 0 ? buf.readUInt32BE(20) : -1;
    check('큰 사진 자동 축소(2400×1600 → 긴 변 1800 이하)', w > 0 && Math.max(w, h) <= 1800, `${w}×${h} · ${buf.length}B`);
  } else check('큰 사진 자동 축소', false, '포스터 항목 없음');

  /* 내려받기 확인 — 한글 파일명 */
  const hwpItem = pf[2] && pf[2].options.items.find((it) => /\.hwp$/i.test(it.name));
  if (hwpItem) {
    const r0 = await fetch(BASE + hwpItem.downloadUrl, { redirect: 'manual' });
    const loc = r0.headers.get('location') || '';
    const r2 = loc ? await fetch(loc) : null;
    const cd = r2 ? (r2.headers.get('content-disposition') || '') : '';
    check('자료 내려받기(첨부 파일로·한글 이름)', r0.status === 302 && r2 && r2.status === 200 && /attachment/i.test(cd), `HTTP ${r0.status}→${r2 && r2.status} · ${decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || cd).slice(0, 60)}`);
  } else check('자료 내려받기', false, 'hwp 항목 없음');

  /* 3) 공개 응답 화면 — 데스크톱·휴대폰 */
  await goto(BASE + '/form.html?slug=' + SLUG);
  await waitFor(`(function(){var im=[...document.querySelectorAll('.fb-imgs img')];return im.length===2&&im.every(i=>i.complete&&i.naturalWidth>0)})()`, 30000, '공개 화면 이미지 2장 로드');
  const pubInfo = await evalJs(`(function(){var b=[...document.querySelectorAll('#responseForm > *')].map(e=>e.className||e.tagName);var fig=document.querySelector('.fb-image');return {order:b.slice(0,4).join(' | '),size:fig&&fig.className,files:[...document.querySelectorAll('.fb-files a')].map(a=>a.innerText.replace(/\\s+/g,' ').trim()),title:(document.querySelector('.fb-title')||{}).textContent}})()`);
  check('공개 화면: 이미지 블록 맨 위(중간 크기)·자료 목록', /fb-image size-medium/.test(pubInfo.size || '') && pubInfo.files.length === 2, JSON.stringify(pubInfo).slice(0, 220));
  await shot('fb-03-public-desktop.png', true);
  await setViewport(390, 844, true); await sleep(800);
  await shot('fb-04-public-mobile.png', true);
  await setViewport(1400, 1000, false); await sleep(400);

  /* 4) 응답 제출 — 블록은 응답 칸이 아님 */
  await evalJs(`(function(){var i=document.querySelector('#responseForm input[name="field_1"]');i.value='점검용 응답자';})()`);
  await evalJs(`document.querySelector('#responseForm button[type=submit]').click()`);
  await waitFor(`!!document.querySelector('.status.success')`, 20000, '제출 완료');
  check('응답 제출 성공(이미지·자료 블록이 있어도)', true, '');
  const subs = await api('GET', '/api/admin-form-submissions-list?formId=' + FORM_ID);
  const cols = (subs.data.fields || []).map((f) => f.type + ':' + f.fieldKey);
  const sdata = subs.data.submissions && subs.data.submissions[0] ? subs.data.submissions[0].data : {};
  check('응답 조회: 열에 블록 없음·응답 데이터에 블록 키 없음', cols.length === 1 && cols[0] === 'text:field_1' && Object.keys(sdata).join(',') === 'field_1', `열 ${cols.join(',')} · 데이터 ${JSON.stringify(sdata)}`);
} catch (e) {
  check('실행 중 예외', false, e.message);
} finally {
  try {
    if (!FORM_ID) { const l = await api('GET', '/api/admin-forms-list'); const r = (l.data.forms || []).find((f) => f.slug === SLUG); FORM_ID = r ? r.id : 0; }
    if (FORM_ID) { const d = await api('POST', '/api/admin-form-delete', { id: FORM_ID, confirm: true }); log('  점검용 폼 삭제:', d.status, JSON.stringify(d.data).slice(0, 80)); }
  } catch (e) { log('정리 중 오류', e.message); }
  try { if (cdp) await cdp.send('Browser.close'); } catch { /* 무시 */ }
  try { chrome && chrome.kill(); } catch { /* 무시 */ }
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n==== 결과 ${okN}/${results.length} 통과 ====`);
  for (const r of results) console.log((r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  process.exit(okN === results.length ? 0 : 1);
}
