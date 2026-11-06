// deck-export.mjs — 제안서 PDF·PPT 내보내기 버튼을 헤드리스 크롬에서 실제로 실행해 파일을 받는다.
// 사용: node scripts/e2e/deck-export.mjs <public 절대경로 | https://주소> <출력 폴더> [덱 번호=2] [pdf,ppt]
// 인터넷 필요(글꼴·html2canvas·jsPDF·PptxGenJS CDN). 슬라이드 수에 따라 몇 분 걸린다.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const ROOT = process.argv[2]; const OUT = path.resolve(process.argv[3]); const DECK = process.argv[4] || '2'; const KINDS = (process.argv[5] || 'pdf,ppt').split(','); fs.mkdirSync(OUT, { recursive: true });
const live = /^https?:/.test(ROOT);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
const srv = live ? null : http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(b); } }); }).listen(8766);
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9339', `--user-data-dir=${path.join(OUT, 'prof')}`, '--window-size=1320,760', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:9339/json/version')).ok) break; } catch {} await sleep(250); }
const ver = await (await fetch('http://127.0.0.1:9339/json/version')).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => { bws.onopen = r; });
bws.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'allow', downloadPath: OUT, eventsEnabled: true } }));
const t = await (await fetch('http://127.0.0.1:9339/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)?.(m.result || m); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Page.javascriptDialogOpening') { errs.push('대화상자: ' + m.params.message); send('Page.handleJavaScriptDialog', { accept: true }); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 760, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: live ? `${ROOT.replace(/\/$/, '')}/${DECK}` : `http://127.0.0.1:8766/${DECK}.html` }); await sleep(800);
for (let i = 0; i < 80; i++) { if (await ev(`typeof goTo==='function'&&document.fonts.size>20&&[...document.querySelectorAll('link[rel=stylesheet]')].every(l=>l.media==='all')`)) break; await sleep(250); }
await ev(`document.fonts.ready.then(()=>1)`); await sleep(1200);
for (const k of KINDS) {
  const before = new Set(fs.readdirSync(OUT));
  const t0 = Date.now();
  await ev(`(window.__x=exportDeck('${k}'),1)`);
  for (let i = 0; i < 900; i++) { await sleep(1000); const busy = await ev(`document.getElementById('btnPdf').disabled`); if (!busy) break; if (i % 30 === 29) console.log(k, '진행', await ev(`document.getElementById('expSub').textContent`)); }
  await sleep(2500);
  const added = fs.readdirSync(OUT).filter((f) => !before.has(f) && !f.endsWith('.crdownload') && f !== 'prof');
  console.log(k, '완료', Math.round((Date.now() - t0) / 1000) + '초', added.map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)}MB`));
}
console.log('오류', JSON.stringify(errs.slice(0, 5)));
try { await send('Browser.close'); } catch {} chrome.kill(); srv?.close(); process.exit(0);
