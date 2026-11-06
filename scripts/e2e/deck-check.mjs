// deck-check.mjs — 제안서 전 슬라이드 넘침·칸 안 잘림·깨진 이미지·콘솔 오류 검사 + 슬라이드 촬영.
// 사용: node scripts/e2e/deck-check.mjs <public 절대경로> <출력 폴더> [덱 번호=2] [촬영: all | 슬라이드 id 쉼표 목록]
// 로컬 파일을 정적 서버로 띄워 헤드리스 크롬(원본 1280×720 배율)으로 확인한다. 글꼴은 CDN에서 받으므로 인터넷 필요.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const ROOT = process.argv[2]; const OUT = process.argv[3]; const DECK = process.argv[4] || '2'; const SHOT = process.argv[5] || ''; fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(b); } }); }).listen(8771);
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9338', `--user-data-dir=${path.join(OUT, 'prof')}`, '--window-size=1320,760', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9338/json/version')).ok) break; } catch {} await sleep(250); }
const t = await (await fetch('http://127.0.0.1:9338/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)?.(m.result || m); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) console.log('평가 오류', JSON.stringify(r.exceptionDetails).slice(0, 500)); if (r.error) console.log('평가 오류', JSON.stringify(r.error).slice(0, 300)); return r.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 760, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:8771/${DECK}.html` }); await sleep(800);
for (let i = 0; i < 80; i++) { if (await ev(`typeof goTo==='function'&&document.fonts.size>20&&[...document.querySelectorAll('link[rel=stylesheet]')].every(l=>l.media==='all')`)) break; await sleep(250); }
await ev(`document.fonts.ready.then(()=>1)`); await sleep(1200);
const check = `(async()=>{
  await document.fonts.ready;
  const S=[...document.querySelectorAll('.slide')];const bad=[];
  const label=(e)=>{const c=(e.className&&e.className.baseVal===undefined?e.className:'')||e.tagName;return String(c).split(' ')[0]+':'+(e.textContent||'').trim().slice(0,18)};
  for(let i=0;i<S.length;i++){
    goTo(i);await new Promise(r=>setTimeout(r,40));
    const s=S[i];const lim=s.getBoundingClientRect();const sc=lim.height/720;const issues=[];
    const foot=s.querySelector('.slide-footer');const footTop=foot?(foot.getBoundingClientRect().top-lim.top)/sc:720;
    s.querySelectorAll('*').forEach(e=>{
      const c=getComputedStyle(e);if(c.display==='none'||e.closest('.slide-footer'))return;
      const b=e.getBoundingClientRect();if(!b.height||!b.width)return;
      const inRing=e.closest('.ring');const inWin=e.closest('.win');
      if(!e.children.length&&!inRing){
        const bot=(b.bottom-lim.top)/sc,rt=(b.right-lim.left)/sc,lf=(b.left-lim.left)/sc;
        if(bot>footTop+1)issues.push('아래넘침 '+Math.round(bot)+'>'+Math.round(footTop)+' '+label(e));
        if(rt>1281||lf<-1)issues.push('옆넘침 '+Math.round(rt)+' '+label(e));
      }
      if(!e.children.length||e.tagName==='TABLE'||e.tagName==='TR')return;
      if(e.scrollHeight>e.clientHeight+8&&e.clientHeight>0&&c.display!=='inline'&&!inRing)issues.push('칸안잘림 '+e.scrollHeight+'>'+e.clientHeight+' '+label(e));
      if(e.scrollWidth>e.clientWidth+1&&e.clientWidth>0&&c.display!=='inline'&&!inRing&&!inWin)issues.push('칸옆잘림 '+e.scrollWidth+'>'+e.clientWidth+' '+label(e));
    });
    if(issues.length)bad.push((i+1)+' '+(s.id||'')+' → '+[...new Set(issues)].slice(0,6).join(' | '));
  }
  goTo(0);
  const fonts=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/"/g,''));
  return {n:S.length,ctr:document.getElementById('ctr').textContent,bad,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute('src')),fontFamilies:[...new Set(fonts)]};
})()`;
const info = await ev(check);
console.log(JSON.stringify({ n: info?.n, ctr: info?.ctr, broken: info?.broken, fontFamilies: info?.fontFamilies }));
(info?.bad || []).forEach((b) => console.log('문제', b));
console.log('문제 슬라이드 수', (info?.bad || []).length);
if (SHOT) {
  const ids = await ev(`[...document.querySelectorAll('.slide')].map(s=>s.id)`);
  const want = SHOT === 'all' ? ids : SHOT.split(',');
  for (const sid of want) {
    const n = ids.indexOf(sid); if (n < 0) { console.log('없는 슬라이드', sid); continue; }
    await ev(`goTo(${n})`); await sleep(450);
    const clip = await ev(`(()=>{const r=document.getElementById('vp').getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})()`);
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(OUT, `${String(n + 1).padStart(2, '0')}-${sid}.png`), Buffer.from(r.data, 'base64'));
  }
  console.log('촬영', want.length);
}
console.log('오류', JSON.stringify(errs.slice(0, 5)));
try { await send('Browser.close'); } catch {} chrome.kill(); srv.close(); process.exit(0);
