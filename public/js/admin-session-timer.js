/* ============================================================
   admin-session-timer.js — 관리자 세션 우상단 타이머 + 연장 (공용)
   통합 CMS / 관리자 허브 / 관리자(admin.html) 공통 포함.
   - httpOnly 쿠키라 만료시각을 서버(/api/admin/session GET)에서 받아 카운트다운
   - 5분 전 연장 팝업, 타이머/버튼 클릭 시 POST로 재발급(만료시각 갱신·횟수제한 없음)
   - 만료 시 /admin.html 이동. 2분마다 서버 동기화.
   - 로그인 화면(미인증)에선 조용히 숨김(첫 조회 401 → 리다이렉트 안 함·루프 방지).
   - 페이지에 #sessionTimer 버튼이 있으면 그 자리(헤더)에, 없으면 우상단 플로팅으로 자동 생성.
   ============================================================ */
(function () {
  var WARN_SEC = 300;        // 5분 전 경고
  var remain = 0;            // 남은 초(로컬 카운트다운)
  var tick = null, resync = null;
  var warnOpen = false, busy = false, wasActive = false;

  function $(id) { return document.getElementById(id); }
  function fmt(s) { s = Math.max(0, s | 0); var m = Math.floor(s / 60), ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }

  function ensureUI() {
    var b = $('sessionTimer');
    if (!b) {
      b = document.createElement('button');
      b.id = 'sessionTimer'; b.type = 'button';
      b.style.position = 'fixed'; b.style.top = '14px'; b.style.right = '16px'; b.style.zIndex = '9998';
      b.style.boxShadow = '0 2px 8px rgba(0,0,0,.10)';
      document.body.appendChild(b);
    }
    if (!b.dataset.styled) {
      b.style.alignItems = 'center'; b.style.gap = '6px'; b.style.padding = '6px 11px';
      b.style.borderRadius = '8px'; b.style.border = '1px solid #e2e8f0'; b.style.background = '#f8fafc';
      b.style.color = '#475569'; b.style.fontSize = '12px'; b.style.fontWeight = '600';
      b.style.cursor = 'pointer'; b.style.fontFamily = 'inherit'; b.style.display = 'none';
      b.dataset.styled = '1';
    }
    if (!b.getAttribute('onclick')) b.setAttribute('onclick', 'extendAdminSession()');
    if (!b.innerHTML.trim()) b.innerHTML = '<span id="sessionTimerIcon">🔓</span><span id="sessionTimerText">--:--</span>';
    if (!b.title) b.title = '관리자 세션 남은 시간 — 클릭하면 연장됩니다';

    if (!$('sessionWarnModal')) {
      var m = document.createElement('div');
      m.id = 'sessionWarnModal';
      m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;align-items:center;justify-content:center';
      m.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:26px 28px;width:min(420px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.25);text-align:center">' +
        '<div style="font-size:32px;margin-bottom:8px">⏰</div>' +
        '<h3 style="margin:0 0 8px;font-size:18px;color:#1e293b">세션이 곧 만료됩니다</h3>' +
        '<p style="margin:0 0 6px;color:#475569;font-size:14px;line-height:1.6">보안을 위해 관리자 세션은 일정 시간 후 자동 만료됩니다.<br>계속 사용하시려면 세션을 연장해 주세요.</p>' +
        '<p style="margin:0 0 18px;color:#dc2626;font-weight:700;font-size:15px">남은 시간 <span id="sessionWarnCountdown">5:00</span></p>' +
        '<div style="display:flex;gap:10px;justify-content:center">' +
        '<button type="button" onclick="logoutAdminSession()" style="padding:9px 18px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer">로그아웃</button>' +
        '<button type="button" onclick="extendAdminSession()" style="padding:9px 22px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer">세션 연장</button>' +
        '</div></div>';
      document.body.appendChild(m);
    }
  }

  async function call(method) {
    try {
      var res = await fetch('/api/admin/session', { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      if (res.status === 401) return { expired: true };
      var body = {}; try { body = await res.json(); } catch (e) {}
      var d = (body && body.data) ? body.data : body;
      return { expiresInSec: (d && typeof d.expiresInSec === 'number') ? d.expiresInSec : null };
    } catch (e) { return { netErr: true }; }
  }

  function render() {
    var btn = $('sessionTimer'), txt = $('sessionTimerText'), icon = $('sessionTimerIcon');
    if (!btn || !txt) return;
    btn.style.display = 'inline-flex';
    txt.textContent = fmt(remain);
    var warn = remain <= WARN_SEC;
    btn.style.borderColor = warn ? '#fca5a5' : '#e2e8f0';
    btn.style.background = warn ? '#fef2f2' : '#f8fafc';
    btn.style.color = warn ? '#dc2626' : '#475569';
    if (icon) icon.textContent = warn ? '⏰' : '🔓';
  }

  function hideTimer() { var b = $('sessionTimer'); if (b) b.style.display = 'none'; stopTick(); }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  function onExpired() {
    stopTick(); if (resync) { clearInterval(resync); resync = null; }
    var m = $('sessionWarnModal'); if (m) m.style.display = 'none';
    alert('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.');
    location.href = '/admin.html';
  }

  function startTick() {
    stopTick(); render();
    tick = setInterval(function () {
      remain--;
      render();
      if (remain <= WARN_SEC && !warnOpen) openWarn();
      if (warnOpen) { var c = $('sessionWarnCountdown'); if (c) c.textContent = fmt(Math.max(0, remain)); }
      if (remain <= 0) onExpired();
    }, 1000);
  }

  function openWarn() { warnOpen = true; var m = $('sessionWarnModal'); if (m) m.style.display = 'flex'; }
  function closeWarn() { warnOpen = false; var m = $('sessionWarnModal'); if (m) m.style.display = 'none'; }

  async function load(extend) {
    if (busy) return; busy = true;
    try {
      var r = await call(extend ? 'POST' : 'GET');
      if (r.expired) {
        if (wasActive) onExpired();   // 사용 중 만료 → 로그인 이동
        else hideTimer();             // 처음부터 미인증(로그인 화면) → 조용히 숨김(루프 방지)
        return;
      }
      if (typeof r.expiresInSec === 'number') {
        wasActive = true;
        remain = r.expiresInSec;
        if (remain > WARN_SEC) closeWarn();
        startTick();
      }
    } finally { busy = false; }
  }

  window.extendAdminSession = function () { load(true); };
  window.logoutAdminSession = function () { location.href = '/admin.html'; };

  function boot() {
    ensureUI();
    load(false);  // 최초 만료시각 조회(미인증이면 조용히 숨김)
    resync = setInterval(function () { if (!warnOpen) load(false); }, 120000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
