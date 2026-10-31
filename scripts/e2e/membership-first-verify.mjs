// membership-first-verify.mjs — 후원회원 가입 필수·홈 계좌 안내 배너·해지 운영자 알림 라이브 눈검증 (API + 헤드리스 크롬 CDP 스크린샷)
// 사용: ADMIN_ID=... ADMIN_PW=... node scripts/e2e/membership-first-verify.mjs   (스크린샷은 ./shots/mf-*.png)
// 점검용 데이터: 후원회원 1명(이메일 @lantern.invalid → 환영 문자 생략) + 효성 신청 의향 1건(바로 본인 해지 → 운영자 알림 검증) → 끝에 회원 탈퇴 처리.
// 운영 설정은 «가입 필수» 스위치를 끄고 바로 다시 켜는 것 외에 바꾸지 않는다(최종 상태 = 켬).
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

const TS = Date.now();
const T = { name: '점검용 가입검증', phone: '010-7700-' + String(1000 + Math.floor(Math.random() * 9000)), email: `e2e-mf-${TS}@lantern.invalid`, school: '점검용' };

/* ───────── API (쿠키 보관 — 관리자 세션 전용) ───────── */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
function absorb(res) {
  const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of sc) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
async function api(method, p, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!opts.noCookie) headers.Cookie = cookieHeader();
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!opts.noCookie) absorb(res);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.ok !== false, data };
}
const unwrap = (d) => (d && d.data && typeof d.data === 'object') ? d.data : (d || {});
function firstArray(o, depth = 0) { if (Array.isArray(o)) return o; if (o && typeof o === 'object' && depth < 3) { for (const k of Object.keys(o)) { const v = firstArray(o[k], depth + 1); if (v) return v; } } return null; }

/* ───────── CDP ───────── */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) { for (const h of this.handlers) h(m); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(fn) { this.handlers.push(fn); }
}
let cdp = null, chrome = null;
async function launch() {
  const port = 9334; const profile = path.join(process.cwd(), 'chrome-profile-mf');
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
  cdp.on((m) => { if (m.method === 'Page.javascriptDialogOpening') { log('  대화상자:', (m.params.message || '').slice(0, 80)); cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); } });
}
async function evalJs(expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
async function waitFor(expr, ms = 15000, label = expr) { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v = null; try { v = await evalJs(expr); } catch { /* 재시도 */ } if (v) return v; await sleep(300); } throw new Error('대기 시간 초과: ' + label); }
async function shot(name) { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); log('  📷', name); return f; }
async function goto(url) { await cdp.send('Page.navigate', { url }); await sleep(1800); }
/* 페이지 안에서 fetch — 브라우저의 회원 쿠키(가입 직후 발급)로 호출 */
async function pageFetch(method, p, body) {
  return evalJs(`(async () => { const r = await fetch(${JSON.stringify(p)}, { method: ${JSON.stringify(method)}, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }); const j = await r.json().catch(() => ({})); return { status: r.status, data: j }; })()`);
}

let MID = 0, DID = 0;
try {
  /* ───── A. 공개 API: 스위치·계좌·홈 배너 ───── */
  const pol = await api('GET', '/api/donation-policy', null, { noCookie: true }); const P = unwrap(pol.data);
  check('공개 후원 정책: 가입 필수 켬', P.requireMembership === true, JSON.stringify({ requireMembership: P.requireMembership, bylawsUrl: P.bylawsUrl }));
  check('공개 후원 정책: 계좌 정보', !!P.bankAccountNo && !!P.bankName, `${P.bankName} ${P.bankAccountNo} (${P.bankAccountHolder})`);
  const hc = await api('GET', '/api/public/home-content', null, { noCookie: true }); const BB = unwrap(hc.data).bankBanner || {};
  check('홈 콘텐츠: 계좌 안내 배너 데이터', BB.visible === true && BB.bank && BB.bank.accountNo === P.bankAccountNo, JSON.stringify({ visible: BB.visible, title: BB.title, account: BB.bank && BB.bank.accountNo }));
  const homeHtml = await (await fetch(BASE + '/')).text();
  check('홈 HTML: 배너 자리·새 스크립트 버전', homeHtml.includes('id="bankBannerSlot"') && homeHtml.includes('home.js?v=20261101-bank'), '');

  /* ───── B. 결제 시작 API 4개 — 비회원 거절(needMembership) ───── */
  const guest = { name: '점검용 게이트', phone: '010-7700-0001', email: 'gate@lantern.invalid', amount: 10000, depositorName: '점검용', isAnonymous: false, type: 'onetime' };
  for (const [label, p, body] of [
    ['계좌이체 신청', '/api/donate-bank-intent', guest],
    ['효성 CMS 신청', '/api/donate-hyosung-intent', guest],
    ['카드 일시 결제 시작', '/api/donate-kicc-register', guest],
    ['카드 정기 등록 시작', '/api/billing-register', guest],
  ]) {
    const r = await api('POST', p, body, { noCookie: true });
    const nm = !!(r.data && r.data.detail && r.data.detail.needMembership);
    check(`비회원 차단: ${label}`, r.status === 400 && nm, `HTTP ${r.status} · ${String(r.data && r.data.error || '').slice(0, 60)}${nm ? '' : ' · needMembership 없음'}`);
  }

  /* ───── C. 브라우저: 홈 배너 → 후원회원 되기 → 가입 단계 → 계좌 보기 → 가입 → 결제 단계 ───── */
  await launch();
  await goto(BASE + '/?e2e=' + TS);
  await waitFor(`!!document.querySelector('#bankBannerSlot .bank-banner-no strong')`, 20000, '홈 배너 렌더');
  const bannerTxt = await evalJs(`document.querySelector('#bankBannerSlot .bank-banner').innerText`);
  check('홈 화면: 계좌 안내 배너 보임', bannerTxt.includes(P.bankAccountNo), bannerTxt.replace(/\s+/g, ' ').slice(0, 120));
  await evalJs(`document.getElementById('bankBannerSlot').scrollIntoView({block:'center'})`); await sleep(400);
  await shot('mf-01-home-bank-banner.png');

  await evalJs(`window.scrollTo(0,0)`); await sleep(200);
  await evalJs(`(document.querySelector('.quick-item[data-target="donateModal"]') || document.querySelector('[data-action="open-modal"][data-target="donateModal"]')).click()`);
  await waitFor(`(function(){var m=document.getElementById('donateModal');var s=document.getElementById('donateJoinStep');return !!(m&&m.classList.contains('show')&&s&&s.classList.contains('active'))})()`, 20000, '가입 단계 표시');
  const joinInfo = await evalJs(`(function(){return {intro:(document.getElementById('sjIntro')||{}).textContent,bylaws:(document.getElementById('sjBylawsLink')||{}).href,step1:document.querySelector('.donate-step[data-step="1"]').classList.contains('active'),orgHidden:(document.getElementById('sjNoticeOrg')||{}).hidden,sms:((document.getElementById('sjSmsLabel')||{}).textContent||'').trim(),badge:((document.getElementById('sjBadge')||{}).textContent||'').trim()}})()`);
  check('후원회원 되기 클릭 → 가입 단계가 먼저', joinInfo.step1 === false, `안내: ${String(joinInfo.intro || '').trim().slice(0, 50)} · 회칙 링크: ${joinInfo.bylaws}`);
  check('일반 가입 단계: 등불 전용 문구 없음(함께워크 안내 숨김·«활동 보고» 라벨·🤝 배지)', joinInfo.orgHidden === true && joinInfo.sms.includes('활동 보고') && !joinInfo.sms.includes('등불') && joinInfo.badge.startsWith('🤝'), `${joinInfo.badge} · ${joinInfo.sms.slice(0, 40)}`);
  await shot('mf-02-join-step.png');

  await evalJs(`document.querySelector('.bank-quick-toggle[data-target="sjBankQuick"]').click()`);
  const quick = await waitFor(`(function(){var b=document.getElementById('sjBankQuick');return (b&&!b.hidden&&b.querySelector('.bq-account').textContent.includes('${P.bankAccountNo.slice(0, 4)}'))?b.innerText:''})()`, 10000, '계좌 보기 패널');
  check('가입 단계 «후원 계좌 보기» 패널', !!quick, String(quick).replace(/\s+/g, ' ').slice(0, 100));
  await shot('mf-03-join-bank-quick.png');
  await evalJs(`document.querySelector('.bank-quick-toggle[data-target="sjBankQuick"]').click()`);

  await evalJs(`(function(){var s=(id,v)=>{var e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};s('sjName',${JSON.stringify(T.name)});s('sjPhone',${JSON.stringify(T.phone)});s('sjEmail',${JSON.stringify(T.email)});s('sjSchool',${JSON.stringify(T.school)});document.getElementById('sjBylaws').checked=true;document.getElementById('sjPrivacy').checked=true;document.getElementById('sponsorJoinForm').requestSubmit();})()`);
  await waitFor(`document.querySelector('.donate-step[data-step="1"]').classList.contains('active')`, 25000, '가입 뒤 결제 단계');
  await sleep(1200); /* 캠페인 선택칸 로드 대기 */
  const step1 = await evalJs(`(function(){var f=document.querySelector('.donate-step[data-step="1"] input[name="name"]');var b=document.getElementById('donateLanternBadge');var w=document.getElementById('donateCampaignWrap');var s=document.getElementById('donateCampaignSelect');return {name:f?f.value:'',locked:f?f.readOnly:false,lanternBadgeShown:!!(b&&getComputedStyle(b).display!=='none'),campaignWrapShown:!!(w&&getComputedStyle(w).display!=='none'),options:s?s.options.length:0,title:(document.querySelector('#donateModal h2.serif')||{}).textContent}})()`);
  check('가입 완료 → 결제 단계로 이동(이름 자동 채움)', step1.name === T.name, JSON.stringify({ name: step1.name, title: String(step1.title || '').trim() }));
  check('일반 창: 등불 배지 숨김 · 캠페인 선택칸 표시', step1.lanternBadgeShown === false && step1.campaignWrapShown === true && step1.options >= 2, JSON.stringify({ lanternBadgeShown: step1.lanternBadgeShown, campaignWrapShown: step1.campaignWrapShown, options: step1.options }));
  await shot('mf-04-after-join-step1.png');

  /* 가입된 회원 확인(브라우저 회원 세션) */
  const me = await pageFetch('GET', '/api/sponsor-signup');
  const meD = unwrap(me.data); MID = Number((meD.member || {}).id) || 0;
  check('가입 회원 세션: 회칙 동의 완료 상태', me.status === 200 && meD.loggedIn === true && meD.needsBylaws === false, JSON.stringify({ id: MID, needsBylaws: meD.needsBylaws }));

  /* ───── D. 회원으로 효성 정기 신청 의향 → 본인 해지 → 운영자 알림 ───── */
  const hy = await pageFetch('POST', '/api/donate-hyosung-intent', { name: T.name, phone: T.phone, email: T.email, amount: 10000, isAnonymous: false });
  const hyD = unwrap(hy.data);
  DID = Number(String(hyD.donationId || hyD.id || (hyD.donation && hyD.donation.id) || '').replace(/\D/g, '')) || 0; /* 응답은 D-0000123 꼴 */
  if (!DID) { const mine = await pageFetch('GET', '/api/donations/mine'); const arr = firstArray(mine.data) || []; const d = arr.find((x) => x.status === 'pending_hyosung') || arr[0]; DID = d ? Number(d.id) : 0; }
  check('회원 효성 정기 신청 의향 접수', hy.status >= 200 && hy.status < 300 && DID > 0, `HTTP ${hy.status} · 후원 #${DID}`);
  const cancel = await pageFetch('POST', '/api/donations/cancel', { id: DID, reason: '[점검용] 해지 운영자 알림 검증' });
  check('회원 본인 해지 처리', cancel.status === 200 && cancel.data && cancel.data.ok !== false, `HTTP ${cancel.status} · ${String(cancel.data && (cancel.data.message || cancel.data.error) || '').slice(0, 60)}`);

  /* ───── E. 관리자: 정책 스위치·설정 행 보장·운영자 알림 ───── */
  const login = await api('POST', '/api/admin/login', { id: ID, password: PW });
  check('관리자 로그인', login.ok, '');
  const ap = await api('GET', '/api/admin/donation-policy'); const apP = unwrap(ap.data).policy || {};
  check('관리자 후원 정책: 가입 필수 값 노출', apP.requireMembership === true, JSON.stringify({ requireMembership: apP.requireMembership }));
  const off = await api('PATCH', '/api/admin/donation-policy', { requireMembership: false });
  const on = await api('PATCH', '/api/admin/donation-policy', { requireMembership: true });
  check('스위치 끄기→켜기 저장(최종 켬)', off.ok && unwrap(off.data).policy.requireMembership === false && on.ok && unwrap(on.data).policy.requireMembership === true, `off ${off.status} on ${on.status}`);
  const ens1 = await api('POST', '/api/admin/site-setting-ensure', { key: 'home.bankBanner.title', valueText: '후원 계좌 안내' });
  const ens2 = await api('POST', '/api/admin/site-setting-ensure', { key: 'home.bankBanner.title', valueText: '후원 계좌 안내' });
  const ensBad = await api('POST', '/api/admin/site-setting-ensure', { key: 'home.hero.lead', valueText: 'x' });
  check('배너 설정 행 보장(만들기·재호출 멱등·허용 외 키 거절)', ens1.ok && ens2.ok && unwrap(ens2.data).created === false && ensBad.status === 400, `1:${ens1.status} 2:${ens2.status} bad:${ensBad.status}`);
  const hs = await api('GET', '/api/admin/site-settings?scope=home'); const rows = firstArray(unwrap(hs.data)) || [];
  check('메인 편집 설정 목록에 배너 키 존재', rows.some((r) => r.key === 'home.bankBanner.title'), rows.filter((r) => String(r.key).startsWith('home.bankBanner')).map((r) => r.key).join(','));

  /* 운영자 개인 알림함은 회원 세션(같은 계정)으로 읽는다 — 관리자 토큰과 별개 */
  let notes = [];
  for (const p of ['/api/auth/login', '/api/auth-login']) { const r = await api('POST', p, { email: ID, password: PW, id: ID }); if (r.ok) { log('  회원 세션 확보:', p); break; } }
  for (const p of ['/api/notifications/mine?limit=50']) {
    const r = await api('GET', p); const arr = firstArray(unwrap(r.data)); if (r.ok && arr && arr.length) { notes = arr; log('  알림 목록 경로:', p, arr.length, '건'); break; }
  }
  const hit = (t) => notes.find((n) => String(n.title || '').includes(t) && String(n.message || n.body || '').includes(T.name));
  check('운영자 알림함: 후원회원 가입(홈페이지)', !!hit('후원회원 가입'), (hit('후원회원 가입') || {}).title);
  check('운영자 알림함: 효성 신청 의향 접수', !!hit('효성'), (hit('효성') || {}).title);
  check('운영자 알림함: 정기 회비 해지(사유 포함)', !!hit('정기 회비 해지') && String(hit('정기 회비 해지').message || '').includes('점검용'), (hit('정기 회비 해지') || {}).message);
} catch (e) {
  check('실행 중 예외', false, e.message);
} finally {
  /* ───── F. 정리 ───── */
  try {
    if (!jar.size) await api('POST', '/api/admin/login', { id: ID, password: PW });
    if (!MID) { const s = await api('GET', '/api/admin/members?search=' + encodeURIComponent(T.email) + '&pageSize=5'); const arr = firstArray(unwrap(s.data)) || []; const m = arr.find((x) => String(x.email || '').toLowerCase() === T.email.toLowerCase()); MID = m ? Number(m.id) : 0; }
    if (MID) { const w = await api('PATCH', `/api/admin/members?id=${MID}`, { id: MID, inlineStatusOnly: true, status: 'withdrawn' }); log('  점검용 후원회원 탈퇴 처리:', w.status, JSON.stringify(w.data).slice(0, 80)); }
  } catch (e) { log('정리 중 오류', e.message); }
  try { if (cdp) await cdp.send('Browser.close'); } catch { /* 무시 */ }
  try { chrome && chrome.kill(); } catch { /* 무시 */ }
  const okN = results.filter((r) => r.ok).length;
  console.log(`\n==== 결과 ${okN}/${results.length} 통과 ====`);
  for (const r of results) console.log((r.ok ? '✅ ' : '❌ ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  fs.writeFileSync(path.join(OUT, 'mf-results.json'), JSON.stringify({ test: T, memberId: MID, donationId: DID, results }, null, 2));
  process.exit(okN === results.length ? 0 : 1);
}
