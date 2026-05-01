/* =========================================================
   SIREN — admin.js (v2 — 실 API 연동)
   ========================================================= */
(function () {
  'use strict';

  const PAGE_TITLES = {
    dashboard: '대시보드',
    members: '회원 관리',
    donations: '기부 관리',
    support: '지원 관리',
    ai: 'AI 추천 센터',
    content: '콘텐츠 관리',
    settings: '시스템 설정',
  };

  let CURRENT_ADMIN = null;
  let CURRENT_KPI = null;

  /* ------------ 토스트 ------------ */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ------------ API 헬퍼 ------------ */
  async function api(path, options = {}) {
    const opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'include',
    };
    if (options.body) opts.body = JSON.stringify(options.body);
    try {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[Admin API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ------------ 화면 전환 ------------ */
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
    if (window.SIREN_CHARTS?.initDashboard) {
      setTimeout(() => window.SIREN_CHARTS.initDashboard(), 150);
    }
    renderDashboardKPI();
  }

  /* ------------ KPI 렌더링 ------------ */
  function renderDashboardKPI() {
    if (!CURRENT_KPI) return;
    const dash = document.getElementById('adm-dashboard');
    if (!dash) return;
    const kpis = dash.querySelectorAll('.kpi-grid > .kpi .kpi-value');
    if (kpis.length < 4) return;

    const fmt = (n) => '₩ ' + (n / 1_000_000).toFixed(1) + 'M';
    kpis[0].textContent = fmt(CURRENT_KPI.monthlyDonation);
    kpis[1].textContent = (CURRENT_KPI.newRegularCount || 0) + ' 명';
    kpis[2].textContent = (CURRENT_KPI.pendingSupportCount || 0) + ' 건';
    kpis[3].textContent = (CURRENT_KPI.totalMembers || 0).toLocaleString();

    /* 상단바 사용자명 */
    const adminAvatar = document.querySelector('.adm-avatar');
    if (adminAvatar && CURRENT_ADMIN) {
      adminAvatar.textContent = (CURRENT_ADMIN.name || 'A').charAt(0);
    }
  }

  /* ------------ 로그인 폼 ------------ */
  function setupLoginForm() {
    const form = document.querySelector('#adminLogin form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('adm_id')?.value.trim() || '';
      const pw = document.getElementById('adm_pw')?.value || '';

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn?.textContent || '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '인증 중...'; }

      try {
        const res = await api('/api/admin/login', {
          method: 'POST',
          body: { id, password: pw },
        });

        if (res.ok && res.data?.data) {
          CURRENT_ADMIN = res.data.data.admin;
          await fetchAdminMe();
          showAdminPanel();
          toast(res.data.message || '로그인되었습니다');
        } else {
          toast(res.data?.error || '인증 정보가 일치하지 않습니다');
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
      }
    });
  }

  /* ------------ 세션 확인 ------------ */
  async function fetchAdminMe() {
    const res = await api('/api/admin/me');
    if (res.ok && res.data?.data) {
      CURRENT_ADMIN = res.data.data.admin;
      CURRENT_KPI = res.data.data.kpi;
      return true;
    }
    CURRENT_ADMIN = null;
    CURRENT_KPI = null;
    return false;
  }

  /* ------------ 사이드바 메뉴 ------------ */
  function setupSidebar() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.adm-menu a[data-page]');
      if (!link) return;
      e.preventDefault();
      switchAdminPage(link.dataset.page, link);
    });
  }

  function switchAdminPage(page, linkEl) {
    document.querySelectorAll('.adm-menu a').forEach(a => a.classList.remove('on'));
    if (linkEl) linkEl.classList.add('on');

    document.querySelectorAll('.adm-page').forEach(p => p.classList.remove('show'));
    const target = document.getElementById('adm-' + page);
    if (target) target.classList.add('show');

    const titleEl = document.getElementById('admPageTitle');
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || '관리자';

    if (window.SIREN_CHARTS) {
      if (page === 'ai' && window.SIREN_CHARTS.initAI) {
        setTimeout(() => window.SIREN_CHARTS.initAI(), 100);
      }
    }
  }

  /* ------------ 로그아웃 ------------ */
  function setupLogout() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="admin-logout"]');
      if (!btn) return;
      e.preventDefault();

      await api('/api/admin/logout', { method: 'POST' });
      CURRENT_ADMIN = null;
      CURRENT_KPI = null;
      toast('로그아웃되었습니다');
      setTimeout(() => location.href = '/index.html', 600);
    });

    /* "사용자 사이트로 돌아가기" */
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="admin-exit"]');
      if (!btn) return;
      e.preventDefault();
      location.href = '/index.html';
    });
  }

  /* ------------ 데모 액션 (저장/엑셀 등 — 실제 API는 STEP 10) ------------ */
  function setupDemoActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-demo-action]');
      if (!btn) return;
      e.preventDefault();
      toast(btn.dataset.demoMessage || '처리되었습니다');
    });
  }

  /* ------------ 초기화 ------------ */
  async function init() {
    setupLoginForm();
    setupSidebar();
    setupLogout();
    setupDemoActions();

    /* 자동 로그인 시도 */
    const isLogged = await fetchAdminMe();
    if (isLogged) {
      showAdminPanel();
    } else {
      showLogin();
    }
  }

    /* ------------ 안전한 부트스트랩 (DOM 준비 + 강제 init) ------------ */
  async function safeInit() {
    try {
      // 일단 로그인 화면을 무조건 보여주기 (흰 화면 방지)
      const login = document.getElementById('adminLogin');
      if (login && !login.classList.contains('show')) {
        login.classList.add('show');
      }
      // 그 다음 세션 체크 + 메뉴 등 셋업
      await init();
    } catch (err) {
      console.error('[admin bootstrap]', err);
      const login = document.getElementById('adminLogin');
      if (login) login.classList.add('show');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }

  /* 다른 스크립트 호환용 (사용자 페이지에서 admin.js를 로드한 경우 대비) */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
  };
})();