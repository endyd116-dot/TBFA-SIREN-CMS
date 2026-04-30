/* =========================================================
   SIREN — admin.js
   관리자 패널 인증 & 페이지 라우팅
   ========================================================= */
(function () {
  'use strict';

  /* ------------ 0. 설정 ------------ */
  const ADMIN_CREDENTIALS = {
    id: 'admin',
    pw: '1234'
  };
  const SESSION_KEY = 'siren-admin-session';
  const MAX_FAIL = 5;
  const LOCK_MIN = 30;

  const PAGE_TITLES = {
    dashboard: '대시보드',
    members: '회원 관리',
    donations: '기부 관리',
    support: '지원 관리',
    ai: 'AI 추천 센터',
    content: '콘텐츠 관리',
    settings: '시스템 설정'
  };

  /* ------------ 1. 로그인 잠금 관리 ------------ */
  function getFailInfo() {
    try {
      return JSON.parse(localStorage.getItem('siren-admin-fail') || '{"count":0,"until":0}');
    } catch { return { count: 0, until: 0 }; }
  }
  function setFailInfo(info) {
    localStorage.setItem('siren-admin-fail', JSON.stringify(info));
  }
  function isLocked() {
    const info = getFailInfo();
    return info.until && Date.now() < info.until;
  }
  function lockRemaining() {
    const info = getFailInfo();
    return Math.ceil((info.until - Date.now()) / 60000);
  }

  /* ------------ 2. 세션 관리 ------------ */
  function isLoggedIn() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return s && s.expires > Date.now();
    } catch { return false; }
  }
  function setSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      user: 'admin',
      expires: Date.now() + 60 * 60 * 1000 // 1시간
    }));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  /* ------------ 3. 화면 전환 ------------ */
  function showLogin() {
    const login = document.getElementById('adminLogin');
    const wrap = document.getElementById('adminWrap');
    if (login) login.classList.add('show');
    if (wrap) wrap.classList.remove('show');
  }
  function showAdminPanel() {
    const login = document.getElementById('adminLogin');
    const wrap = document.getElementById('adminWrap');
    if (login) login.classList.remove('show');
    if (wrap) wrap.classList.add('show');

    // 차트 초기화 (charts.js가 로드된 경우)
    if (window.SIREN_CHARTS && typeof window.SIREN_CHARTS.initDashboard === 'function') {
      setTimeout(() => window.SIREN_CHARTS.initDashboard(), 100);
    }
  }

  /* ------------ 4. 로그인 처리 ------------ */
  function setupLoginForm() {
    const form = document.querySelector('#adminLogin form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      // 잠금 확인
      if (isLocked()) {
        return SIREN.toast(`로그인이 잠금되었습니다. ${lockRemaining()}분 후 시도해 주세요.`);
      }

      const id = document.getElementById('adm_id').value.trim();
      const pw = document.getElementById('adm_pw').value;

      if (id === ADMIN_CREDENTIALS.id && pw === ADMIN_CREDENTIALS.pw) {
        // 성공
        setFailInfo({ count: 0, until: 0 });
        setSession();
        showAdminPanel();
        SIREN.toast('관리자 인증 완료. 환영합니다.');
        logAuditEvent('관리자 로그인 성공');
      } else {
        // 실패
        const info = getFailInfo();
        info.count = (info.count || 0) + 1;
        if (info.count >= MAX_FAIL) {
          info.until = Date.now() + LOCK_MIN * 60 * 1000;
          info.count = 0;
          setFailInfo(info);
          SIREN.toast(`로그인 ${MAX_FAIL}회 실패. ${LOCK_MIN}분간 잠금됩니다.`);
        } else {
          setFailInfo(info);
          SIREN.toast(`인증 정보가 일치하지 않습니다 (${info.count}/${MAX_FAIL})`);
        }
      }
    });
  }

  /* ------------ 5. 사이드바 메뉴 라우팅 ------------ */
  function setupSidebar() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.adm-menu a[data-page]');
      if (!link) return;

      e.preventDefault();
      const page = link.dataset.page;
      switchAdminPage(page, link);
    });
  }

  function switchAdminPage(page, linkEl) {
    // 메뉴 활성화
    document.querySelectorAll('.adm-menu a').forEach(a => a.classList.remove('on'));
    if (linkEl) linkEl.classList.add('on');

    // 페이지 전환
    document.querySelectorAll('.adm-page').forEach(p => p.classList.remove('show'));
    const target = document.getElementById('adm-' + page);
    if (target) target.classList.add('show');

    // 타이틀 변경
    const titleEl = document.getElementById('admPageTitle');
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || '관리자';

    // 페이지별 추가 초기화 (차트 등)
    if (window.SIREN_CHARTS) {
      if (page === 'ai' && window.SIREN_CHARTS.initAI) {
        setTimeout(() => window.SIREN_CHARTS.initAI(), 100);
      }
    }
  }

  /* ------------ 6. 로그아웃 ------------ */
  function setupLogout() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="admin-logout"]');
      if (!btn) return;

      e.preventDefault();
      clearSession();
      logAuditEvent('관리자 로그아웃');
      // 사용자 사이트로 복귀
      window.location.href = '/index.html';
    });
  }

  /* ------------ 7. "사용자 사이트로 돌아가기" ------------ */
  function setupExitToUser() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="admin-exit"]');
      if (!btn) return;

      e.preventDefault();
      window.location.href = '/index.html';
    });
  }

  /* ------------ 8. 감사 로그 (로컬 데모) ------------ */
  function logAuditEvent(action) {
    try {
      const logs = JSON.parse(localStorage.getItem('siren-audit-logs') || '[]');
      logs.unshift({
        time: new Date().toISOString(),
        action,
        ip: '127.0.0.1' // 실서버에서는 서버사이드에서 기록
      });
      // 최근 100개만 유지
      localStorage.setItem('siren-audit-logs', JSON.stringify(logs.slice(0, 100)));
    } catch (e) {
      console.warn('Audit log failed', e);
    }
  }

  /* ------------ 9. 더미 데이터 액션 (저장/삭제 버튼 등) ------------ */
  function setupDemoActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-demo-action]');
      if (!btn) return;
      e.preventDefault();
      const msg = btn.dataset.demoMessage || '처리되었습니다.';
      SIREN.toast(msg);
      logAuditEvent(btn.dataset.demoAction);
    });
  }

  /* ------------ 10. 초기화 ------------ */
  function init() {
    setupLoginForm();
    setupSidebar();
    setupLogout();
    setupExitToUser();
    setupDemoActions();

    // 자동 로그인 (세션이 살아있을 때)
    if (isLoggedIn()) {
      showAdminPanel();
    } else {
      showLogin();
    }
  }

  // common.js의 SIREN_PAGE_INIT 훅에 합류
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();