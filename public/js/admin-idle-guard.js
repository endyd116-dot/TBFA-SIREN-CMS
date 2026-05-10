/* Phase 17 — 어드민 비활성 자동 로그아웃 (28분 경고 / 30분 강제) */
(function () {
  'use strict';

  const WARN_MS   = 28 * 60 * 1000;  // 28분
  const LOGOUT_MS = 30 * 60 * 1000;  // 30분

  let warnTimer   = null;
  let logoutTimer = null;
  let warningShown = false;

  /* 어드민 페이지인지 확인 (login-admin.html 제외) */
  function isAdminPage() {
    return !window.location.pathname.includes('login-admin');
  }

  /* 강제 로그아웃 */
  async function forceLogout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    } catch (_) { /* 실패해도 이동 */ }
    window.location.href = '/login-admin.html?reason=idle';
  }

  /* 경고 팝업 표시 */
  function showWarning() {
    if (document.getElementById('idleWarningOverlay')) return;
    warningShown = true;

    const overlay = document.createElement('div');
    overlay.id = 'idleWarningOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.55);
      display:flex;align-items:center;justify-content:center;
      z-index:99999;font-family:inherit;`;

    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:12px;padding:32px 36px;
        max-width:360px;width:90%;text-align:center;
        box-shadow:0 8px 32px rgba(0,0,0,0.22);">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:8px">
          자동 로그아웃 예정
        </div>
        <div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:6px">
          2분간 활동이 없으면<br />자동으로 로그아웃됩니다.
        </div>
        <div id="idleCountdown" style="
          font-size:28px;font-weight:700;color:#dc2626;margin:14px 0;
          font-variant-numeric:tabular-nums;"></div>
        <button id="idleContinueBtn" style="
          background:var(--brand,#7a1e2c);color:#fff;border:none;
          border-radius:6px;padding:11px 28px;font-size:14px;font-weight:600;
          cursor:pointer;width:100%;margin-bottom:10px;">
          계속 사용
        </button>
        <button id="idleLogoutNowBtn" style="
          background:transparent;color:#888;border:none;
          font-size:13px;cursor:pointer;text-decoration:underline;">
          지금 로그아웃
        </button>
      </div>`;

    document.body.appendChild(overlay);

    /* 카운트다운 (남은 시간: 30분 - 28분 = 2분) */
    let remaining = 120;
    updateCountdown(remaining);
    const countInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearInterval(countInterval); return; }
      updateCountdown(remaining);
    }, 1000);

    overlay.dataset.countInterval = countInterval;

    document.getElementById('idleContinueBtn').addEventListener('click', () => {
      resetTimers();
    });
    document.getElementById('idleLogoutNowBtn').addEventListener('click', () => {
      forceLogout();
    });
  }

  function updateCountdown(sec) {
    const el = document.getElementById('idleCountdown');
    if (!el) return;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  function hideWarning() {
    const overlay = document.getElementById('idleWarningOverlay');
    if (!overlay) return;
    const ci = overlay.dataset.countInterval;
    if (ci) clearInterval(Number(ci));
    overlay.remove();
    warningShown = false;
  }

  /* 타이머 리셋 (활동 감지 또는 [계속 사용] 클릭) */
  function resetTimers() {
    hideWarning();
    if (warnTimer)   clearTimeout(warnTimer);
    if (logoutTimer) clearTimeout(logoutTimer);

    warnTimer   = setTimeout(showWarning,  WARN_MS);
    logoutTimer = setTimeout(forceLogout,  LOGOUT_MS);
  }

  /* 활동 이벤트 목록 */
  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

  /* 경고 팝업이 열려있는 동안은 활동 이벤트로 타이머 리셋하지 않음 */
  function onActivity() {
    if (warningShown) return;
    resetTimers();
  }

  function startGuard() {
    if (!isAdminPage()) return;

    ACTIVITY_EVENTS.forEach(evt =>
      window.addEventListener(evt, onActivity, { passive: true })
    );

    resetTimers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGuard);
  } else {
    startGuard();
  }
})();
