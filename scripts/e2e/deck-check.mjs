// deck-check.mjs — 제안서 전 슬라이드 넘침·깨진 이미지·콘솔 오류 검사 + 지정 슬라이드 촬영. 사용: node scripts/e2e/deck-check.mjs <public 절대경로> <출력 폴더>. SHOTS에 촬영할 슬라이드 id를 적는다.
// 로컬 파일을 정적 서버로 띄워 헤드리스 크롬으로 전 슬라이드 넘침·깨진 이미지·콘솔 오류 검사 + 지정 슬라이드 촬영
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const ROOT = process.argv[2]; const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const SHOTS = { 1: [], 2: ['s25', 's-si-cost'] };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.jpg') ? 'image/jpeg' : 'text/plain' }); r.end(b); } }); }).listen(8765);
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9338', `--user-data-dir=${path.join(OUT, 'prof')}`, '--window-size=1320,760', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9338/json/version')).ok) break; } catch {} await sleep(250); }
const t = await (await fetch('http://127.0.0.1:9338/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)?.(m.result || m); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 760, deviceScaleFactor: 1, mobile: false });
for (const n of [1, 2]) {
  await send('Page.navigate', { url: `http://127.0.0.1:8765/${n}.html` }); await sleep(2500);
  const info = await ev(`(async()=>{const S=[...document.querySelectorAll('.slide')];const bad=[];for(let i=0;i<S.length;i++){goTo(i);await new Promise(r=>setTimeout(r,60));const s=S[i];const lim=s.getBoundingClientRect();const sc=lim.height/720;let max=0;s.querySelectorAll('*').forEach(e=>{const c=getComputedStyle(e);if(e.children.length||c.position==='absolute'||c.display==='none'||e.closest('.result-bar')||e.closest('.slide-footer'))return;const b=e.getBoundingClientRect();if(b.height>0)max=Math.max(max,(b.bottom-lim.top)/sc)});const bar=s.querySelector('.result-bar,.slide-footer');const barTop=bar?(bar.getBoundingClientRect().top-lim.top)/sc:720;if(max>barTop+1)bad.push((s.id||i)+':'+Math.round(max)+'>'+Math.round(barTop))}goTo(0);return {n:S.length,ctr:document.getElementById('ctr').textContent,bad,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth&&!/brand/.test(i.src)).map(i=>i.getAttribute('src'))}})()`);
  console.log(n, JSON.stringify(info));
  for (const sid of SHOTS[n]) {
    await ev(`goTo([...document.querySelectorAll('.slide')].findIndex(s=>s.id==='${sid}'))`); await sleep(600);
    const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `d${n}-${sid}.png`), Buffer.from(r.data, 'base64'));
  }
}
console.log('오류', JSON.stringify(errs.slice(0, 5)));
try { await send('Browser.close'); } catch {} chrome.kill(); srv.close(); process.exit(0);
