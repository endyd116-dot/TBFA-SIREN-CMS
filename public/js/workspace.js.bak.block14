// public/js/workspace.js
// ★ Phase 3 Step 3 placeholder — 블록 14에서 본격 구현 예정
// 현재는 페이지 로드 시 "준비 중" 안내만

(function() {
  'use strict';
  if (window._wsInitialized) return;
  window._wsInitialized = true;

  document.addEventListener('DOMContentLoaded', function() {
    // 모든 로딩 영역에 임시 안내 표시
    const loadingEls = document.querySelectorAll('.ws-loading');
    loadingEls.forEach(function(el) {
      el.textContent = '⏳ 워크스페이스는 다음 블록(14)에서 본격 구현됩니다';
    });

    // 인사말 채우기
    const greetEl = document.getElementById('wsGreeting');
    if (greetEl) greetEl.textContent = '워크스페이스 페이지 골격 표시 중 (UI 미완성)';

    // 날짜 표시
    const dateEl = document.getElementById('wsBriefingDate');
    if (dateEl) {
      const now = new Date();
      const days = ['일','월','화','수','목','금','토'];
      dateEl.textContent = now.getFullYear() + '.' +
        String(now.getMonth()+1).padStart(2,'0') + '.' +
        String(now.getDate()).padStart(2,'0') + ' (' + days[now.getDay()] + ')';
    }

    // 통계 카드들 임시값
    ['wsStatOverdue','wsStatToday','wsStatTomorrow','wsStatInbox','wsStatUrgent','wsStatEvents'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '?';
    });

    // 빠른 추가 버튼 placeholder
    document.querySelectorAll('[data-ws-action]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const action = btn.dataset.wsAction;
        alert('🚧 "' + action + '" 기능은 다음 블록(14)에서 구현됩니다.');
      });
    });

    // 사이드바 사용자 이름 (Auth 객체가 있으면)
    if (window.Auth && window.Auth.user) {
      const nameEl = document.getElementById('wsSidebarUserName');
      if (nameEl) nameEl.textContent = window.Auth.user.name || '사용자';
    }

    // 로그아웃 버튼
    const logoutBtn = document.getElementById('wsBtnLogout');
    if (logoutBtn && window.Auth && window.Auth.logout) {
      logoutBtn.addEventListener('click', function() {
        window.Auth.logout();
      });
    }

    console.log('[workspace.js] placeholder 로드 완료. 본격 구현은 블록 14.');
  });
})();
