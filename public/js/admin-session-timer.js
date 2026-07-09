/* ============================================================
   admin-session-timer.js — 관리자 세션 타이머 + 연장 (공용·비활동 기준)
   통합 CMS / 관리자 허브 / 관리자(admin.html) 공통.

   방식(Swain 확정 2026-07-09): 비활동(idle) 6시간. 활동(클릭·입력·이동)하면 유지,
   자리 비우면 6시간 뒤 만료. 5분 전 연장 팝업. 타이머/버튼 클릭 시 연장.
   - 우상단 타이머 = 무활동 남은 시간(활동하면 6:00:00로 리셋)
   - 활동 중에는 25분마다 JWT를 조용히 재발급(6시간 절대만료로 작업 중 끊기는 것 방지)
   - '로그인 유지' 세션은 무활동 해제 + 실제 만료(로그인 후 24시간)까지 카운트다운
   - 만료 시 로그아웃 후 /admin.html 이동. 미인증(로그인 화면)이면 조용히 숨김(루프 방지)
   - 기존 admin-idle-guard.js(30분)를 대체. #sessionTimer 버튼이 있으면 그 자리, 없으면 우상단 플로팅.
   ============================================================ */
(function () {
  'use strict';
  var IDLE_MS = 6 * 60 * 60 * 1000;    // 6시간 무활동 → 만료 (2026-07-09 Swain — 관리자 세션 6h)
  var WARN_SEC = 300;                  // 만료 5분 전 경고
  var JWT_REFRESH_MS = 25 * 60 * 1000; // 활동 중 JWT 재발급 주기(2h 절대만료 방지)

  var lastActivity = Date.now();
  var lastJwtRefresh = 0;
  var tick = null, warnOpen = false, authed = false;
  /* ★ 로그인 유지(remember) 모드: 무활동 자동 로그아웃 해제 + 실제 만료(로그인 후 24시간)까지 카운트다운 */
  var rememberMode = false;
  var absoluteExpiryMs = 0;   // remember 모드에서 실제 만료 시각(ms)

  function $(id) { return document.getElementById(id); }
  function fmt(s) { s = Math.max(0, s | 0); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; var mm = (h && m < 10 ? '0' : '') + m; return (h ? h + ':' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss; }
  function remainSec() {
    if (rememberMode) return Math.round((absoluteExpiryMs - Date.now()) / 1000);  // 실제 만료까지
    return Math.round((IDLE_MS - (Date.now() - lastActivity)) / 1000);            // 무활동 남은 시간
  }

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
    b.innerHTML = '<span id="sessionTimerIcon">🔓</span><span id="sessionTimerText">--:--</span>';
    b.title = '관리자 세션 — 자리 비우면 만료. 클릭하면 연장됩니다';

    if (!$('sessionWarnModal')) {
      var m = document.createElement('div');
      m.id = 'sessionWarnModal';
      m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;align-items:center;justify-content:center';
      m.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:26px 28px;width:min(420px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.25);text-align:center">' +
        '<div style="font-size:32px;margin-bottom:8px">⏰</div>' +
        '<h3 style="margin:0 0 8px;font-size:18px;color:#1e293b">곧 자동 로그아웃됩니다</h3>' +
        '<p style="margin:0 0 6px;color:#475569;font-size:14px;line-height:1.6">일정 시간 활동이 없어 곧 로그아웃됩니다.<br>계속 사용하시려면 세션을 연장해 주세요.</p>' +
        '<p style="margin:0 0 18px;color:#dc2626;font-weight:700;font-size:15px">남은 시간 <span id="sessionWarnCountdown">5:00</span></p>' +
        '<div style="display:flex;gap:10px;justify-content:center">' +
        '<button type="button" onclick="logoutAdminSession()" style="padding:9px 18px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer">로그아웃</button>' +
        '<button type="button" onclick="extendAdminSession()" style="padding:9px 22px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer">세션 연장</button>' +
        '</div></div>';
      document.body.appendChild(m);
    }
  }

  async function ping(extend) {
    // extend=true → POST(JWT 재발급) / false → GET(인증 확인만)
    try {
      var res = await fetch('/api/admin/session', { method: extend ? 'POST' : 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      if (res.status === 401) return { ok: false, expired: true };
      var data = null; try { data = await res.json(); } catch (_) {}
      var d = (data && data.data) || data || {};
      return { ok: res.ok, remember: d.remember === true, expiresInSec: Number(d.expiresInSec) || 0 };
    } catch (e) { return { ok: false, netErr: true }; }
  }

  function render() {
    var btn = $('sessionTimer'), txt = $('sessionTimerText'), icon = $('sessionTimerIcon');
    if (!btn || !txt) return;
    if (!authed) { btn.style.display = 'none'; return; }
    btn.style.display = 'inline-flex';
    var sec = Math.max(0, remainSec());
    txt.textContent = fmt(sec);
    var warn = sec <= WARN_SEC;
    btn.style.borderColor = warn ? '#fca5a5' : '#e2e8f0';
    btn.style.background = warn ? '#fef2f2' : '#f8fafc';
    btn.style.color = warn ? '#dc2626' : '#475569';
    if (icon) icon.textContent = warn ? '⏰' : '🔓';
  }

  function openWarn() { warnOpen = true; var m = $('sessionWarnModal'); if (m) m.style.display = 'flex'; }
  function closeWarn() { warnOpen = false; var m = $('sessionWarnModal'); if (m) m.style.display = 'none'; }

  function stop() { if (tick) { clearInterval(tick); tick = null; } }

  async function doLogout(expiredMsg) {
    stop(); closeWarn();
    try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
    if (expiredMsg) alert('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.');
    location.href = '/admin.html';
  }

  function resetIdle() { lastActivity = Date.now(); if (warnOpen) closeWarn(); render(); }

  function onActivity() {
    if (rememberMode) return;    // 로그인 유지 모드: 무활동 리셋·주기 재발급 안 함(로그인 후 24시간 고정)
    if (warnOpen) return;        // 경고 중엔 활동으로 리셋 안 함 — 명시적 [세션 연장] 필요
    resetIdle();
    if (Date.now() - lastJwtRefresh > JWT_REFRESH_MS) {  // 활동 중 JWT 주기 갱신
      lastJwtRefresh = Date.now();
      ping(true);
    }
  }

  function startTick() {
    if (tick) return;
    tick = setInterval(function () {
      if (!authed) return;
      var sec = remainSec();
      render();
      if (sec <= 0) { doLogout(true); return; }
      /* 로그인 유지 모드에선 무활동 경고 없이 실제 만료(24시간)까지 표시만 */
      if (rememberMode) return;
      if (sec <= WARN_SEC && !warnOpen) openWarn();
      if (warnOpen) { var c = $('sessionWarnCountdown'); if (c) c.textContent = fmt(Math.max(0, sec)); }
    }, 1000);
  }

  window.extendAdminSession = async function () {
    var r = await ping(true);              // JWT 재발급
    if (r.expired) { doLogout(true); return; }
    lastActivity = Date.now(); lastJwtRefresh = Date.now();
    closeWarn(); render();
  };
  window.logoutAdminSession = function () { doLogout(false); };

  async function boot() {
    ensureUI();
    var r = await ping(false);             // 인증 확인(미인증=로그인 화면이면 조용히 숨김)
    if (!r.ok) { authed = false; render(); return; }
    authed = true; lastActivity = Date.now(); lastJwtRefresh = Date.now();
    /* 로그인 유지 세션이면: 무활동 해제 + 실제 만료(로그인 후 24시간)까지 카운트다운 */
    if (r.remember && r.expiresInSec > 0) {
      rememberMode = true;
      absoluteExpiryMs = Date.now() + r.expiresInSec * 1000;
    }
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function (e) {
      window.addEventListener(e, onActivity, { passive: true });
    });
    render(); startTick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
