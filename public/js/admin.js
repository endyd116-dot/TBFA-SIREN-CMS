/* =========================================================
   SIREN — admin.js (v3 — 실 데이터 동적 로딩)
   ========================================================= */
(function () {
  'use strict';

  const PAGE_TITLES = {
    dashboard: '대시보드', members: '회원 관리', donations: '기부 관리',
    support: '지원 관리', ai: 'AI 추천 센터', content: '콘텐츠 관리', settings: '시스템 설정',
  };

  let CURRENT_ADMIN = null;
  let CURRENT_KPI = null;

  /* ------------ 헬퍼 ------------ */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

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

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }

  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${formatDate(iso)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  /* ------------ 화면 전환 ------------ */
  function showLogin() {
    document.getElementById('adminLogin')?.classList.add('show');
    document.getElementById('adminWrap')?.classList.remove('show');
  }
  function showAdminPanel() {
    document.getElementById('adminLogin')?.classList.remove('show');
    document.getElementById('adminWrap')?.classList.add('show');
    if (window.SIREN_CHARTS?.initDashboard) {
      setTimeout(() => window.SIREN_CHARTS.initDashboard(), 150);
    }
    renderDashboardKPI();
    loadDashboardActivity();
  }

  /* ------------ KPI ------------ */
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

    const adminAvatar = document.querySelector('.adm-avatar');
    if (adminAvatar && CURRENT_ADMIN) {
      adminAvatar.textContent = (CURRENT_ADMIN.name || 'A').charAt(0);
    }
  }

  /* ------------ 대시보드 최근 활동 ------------ */
  async function loadDashboardActivity() {
    const res = await api('/api/admin/stats');
    if (!res.ok || !res.data?.data) return;
    const recent = res.data.data.recentActivity || [];
    const dash = document.getElementById('adm-dashboard');
    const tbody = dash?.querySelectorAll('.row-1-1 .panel')[1]?.querySelector('table.tbl tbody');
    if (!tbody) return;
    if (recent.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-3);padding:30px">최근 활동 없음</td></tr>`;
      return;
    }
    const typeMap = { regular:'정기후원', onetime:'일시후원' };
    const statusMap = {
      completed:'<span class="badge b-success">완료</span>',
      pending:'<span class="badge b-warn">대기</span>',
      failed:'<span class="badge b-danger">실패</span>',
    };
    tbody.innerHTML = recent.map(r => {
      const time = new Date(r.createdAt);
      const hh = String(time.getHours()).padStart(2,'0');
      const mm = String(time.getMinutes()).padStart(2,'0');
      return `<tr><td>${hh}:${mm}</td><td>${typeMap[r.type]||r.type}</td><td>${escapeHtml(r.donorName||'-')} (${(r.amount||0).toLocaleString()})</td><td>${statusMap[r.status]||r.status}</td></tr>`;
    }).join('');
  }

  /* ------------ 회원 관리 ------------ */
  async function loadMembers() {
    const panel = document.getElementById('adm-members');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>`;

    const res = await api('/api/admin/members?limit=50');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>`;
      return;
    }
    const list = res.data.data.list || [];
    const total = res.data.data.pagination?.total || 0;

    /* KPI 갱신 */
    const kpis = panel.querySelectorAll('.kpi-value');
    if (kpis[0]) kpis[0].textContent = total.toLocaleString() + ' 명';
    if (kpis[1]) kpis[1].textContent = list.filter(m=>m.type==='family').length + ' 명';
    if (kpis[2]) kpis[2].textContent = list.filter(m=>m.status==='pending').length + ' 명';

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">회원이 없습니다</td></tr>`;
      return;
    }

    const typeMap = {
      regular:'<span class="badge b-info">정기후원</span>',
      family:'<span class="badge b-danger">유가족</span>',
      volunteer:'<span class="badge b-success">봉사자</span>',
      admin:'<span class="badge b-warn">관리자</span>',
    };
    const statusMap = {
      active:'<span class="badge b-success">정상</span>',
      pending:'<span class="badge b-warn">승인대기</span>',
      suspended:'<span class="badge b-danger">정지</span>',
      withdrawn:'<span class="badge b-mute">탈퇴</span>',
    };

    tbody.innerHTML = list.map(m => `
      <tr>
        <td><input type="checkbox"></td>
        <td>M-${String(m.id).padStart(5,'0')}</td>
        <td>${escapeHtml(m.name)}</td>
        <td>${typeMap[m.type]||m.type}</td>
        <td>${formatDate(m.createdAt)}</td>
        <td>${formatDate(m.lastLoginAt)}</td>
        <td>${statusMap[m.status]||m.status}</td>
        <td>
          ${m.status==='pending' ? `<button class="btn-link" data-member-action="approve" data-id="${m.id}">승인</button>` : ''}
          ${m.status==='active' && m.type!=='admin' ? `<button class="btn-link" data-member-action="suspend" data-id="${m.id}" style="color:var(--danger)">정지</button>` : ''}
          ${m.status==='suspended' ? `<button class="btn-link" data-member-action="approve" data-id="${m.id}">정상화</button>` : ''}
        </td>
      </tr>
    `).join('');
  }

  /* 회원 액션 (승인/정지) */
  function setupMemberActions() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-member-action]');
      if (!btn) return;
      e.preventDefault();
      const id = Number(btn.dataset.id);
      const action = btn.dataset.memberAction;
      const status = action === 'approve' ? 'active' : 'suspended';
      const label = action === 'approve' ? '승인' : '정지';

      if (!confirm(`회원을 ${label}하시겠습니까?`)) return;

      const res = await api('/api/admin/members', {
        method: 'PATCH',
        body: { id, status },
      });

      if (res.ok) {
        toast(`회원이 ${label}되었습니다`);
        loadMembers();
      } else {
        toast(res.data?.error || '처리 실패');
      }
    });
  }

  /* ------------ 기부 관리 ------------ */
  async function loadDonations() {
    const panel = document.getElementById('adm-donations');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>`;

    const res = await api('/api/admin/donations?limit=50');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>`;
      return;
    }
    const list = res.data.data.list || [];
    const stats = res.data.data.stats || {};

    /* KPI */
    const kpis = panel.querySelectorAll('.kpi-value');
    const fmt = (n) => '₩ ' + (n / 1_000_000).toFixed(2) + 'M';
    if (kpis[0]) kpis[0].textContent = fmt(stats.today || 0);
    if (kpis[1]) kpis[1].textContent = fmt(stats.month || 0);
    if (kpis[2]) kpis[2].textContent = (stats.failedCount || 0) + ' 건';
    if (kpis[3]) kpis[3].textContent = (stats.receiptPendingCount || 0) + ' 건';

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">결제 내역이 없습니다</td></tr>`;
      return;
    }

    const typeMap = { regular:'정기후원', onetime:'일시후원' };
    const payMap = { cms:'CMS', card:'카드', bank:'계좌이체' };
    const statusMap = {
      completed:'<span class="badge b-success">승인</span>',
      pending:'<span class="badge b-warn">대기</span>',
      failed:'<span class="badge b-danger">실패</span>',
      cancelled:'<span class="badge b-mute">취소</span>',
      refunded:'<span class="badge b-mute">환불</span>',
    };

    tbody.innerHTML = list.map(d => `
      <tr>
        <td>${formatDateTime(d.createdAt)}</td>
        <td>${escapeHtml(d.donorName)}</td>
        <td>${typeMap[d.type]||d.type}</td>
        <td>₩ ${(d.amount||0).toLocaleString()}</td>
        <td>${payMap[d.payMethod]||d.payMethod}</td>
        <td style="font-family:'Inter';font-size:11px">${escapeHtml(d.transactionId||'-').slice(-12)}</td>
        <td>${statusMap[d.status]||d.status}</td>
      </tr>
    `).join('');
  }

  /* 영수증 일괄 발행 */
  function setupDonationActions() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-demo-action="bulk-receipt"]');
      if (!btn) return;
      e.preventDefault();

      /* completed && !receiptIssued 인 모든 ID 조회 후 발행 */
      const res = await api('/api/admin/donations?limit=100&status=completed');
      const ids = (res.data?.data?.list || [])
        .filter(d => !d.receiptIssued)
        .map(d => d.id);

      if (ids.length === 0) return toast('발행할 영수증이 없습니다');

      const r = await api('/api/admin/donations', {
        method: 'PATCH',
        body: { ids },
      });

      if (r.ok) {
        toast(r.data?.message || `${ids.length}건 발행 완료`);
        loadDonations();
      } else {
        toast('발행 실패');
      }
    });
  }

  /* ------------ 콘텐츠 관리 (공지사항) ------------ */
  async function loadContent() {
    const panel = document.getElementById('adm-content');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>`;

    const res = await api('/api/notices?limit=50');
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>`;
      return;
    }
    const list = res.data?.data?.list || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">공지사항이 없습니다</td></tr>`;
      return;
    }
    const catMap = {
      general:'<span class="badge b-mute">일반</span>',
      member:'<span class="badge b-info">회원</span>',
      event:'<span class="badge b-warn">사업</span>',
      media:'<span class="badge b-success">언론</span>',
    };
    tbody.innerHTML = list.map(n => `
      <tr>
        <td>${n.id}</td>
        <td>${catMap[n.category]||n.category}</td>
        <td>${escapeHtml(n.title)}</td>
        <td>${escapeHtml(n.authorName||'관리자')}</td>
        <td>${n.isPinned ? '📌' : '—'}</td>
        <td>${(n.views||0).toLocaleString()}</td>
        <td><button class="btn-link">상세</button></td>
      </tr>
    `).join('');
  }

  /* ------------ 지원 관리 ------------ */
  async function loadSupport() {
    /* support 페이지는 STEP 11에서 풀 구현 — 지금은 KPI만 */
    const panel = document.getElementById('adm-support');
    if (!panel) return;
    const tbody = panel.querySelector('table.tbl tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">STEP 11에서 구현 예정 — 현재는 사용자가 신청한 내역이 표시됩니다</td></tr>`;
  }

  /* ------------ 로그인 ------------ */
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
        const res = await api('/api/admin/login', { method:'POST', body:{ id, password: pw } });
        if (res.ok && res.data?.data) {
          CURRENT_ADMIN = res.data.data.admin;
          await fetchAdminMe();
          showAdminPanel();
          toast(res.data.message || '로그인되었습니다');
        } else {
          toast(res.data?.error || '인증 실패');
        }
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
      }
    });
  }

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

  /* ------------ 사이드바 ------------ */
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
    document.getElementById('adm-' + page)?.classList.add('show');
    const titleEl = document.getElementById('admPageTitle');
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || '관리자';

    /* 탭별 데이터 로딩 */
    if (page === 'members') loadMembers();
    else if (page === 'donations') loadDonations();
    else if (page === 'content') loadContent();
    else if (page === 'support') loadSupport();
    else if (page === 'ai' && window.SIREN_CHARTS?.initAI) {
      setTimeout(() => window.SIREN_CHARTS.initAI(), 100);
    }
  }

  /* ------------ 로그아웃 ------------ */
  function setupLogout() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="admin-logout"]');
      if (!btn) return;
      e.preventDefault();
      await api('/api/admin/logout', { method:'POST' });
      CURRENT_ADMIN = null; CURRENT_KPI = null;
      toast('로그아웃되었습니다');
      setTimeout(() => location.href = '/index.html', 600);
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="admin-exit"]')) {
        e.preventDefault();
        location.href = '/index.html';
      }
    });
  }

  function setupDemoActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-demo-action]');
      if (!btn || btn.dataset.demoAction === 'bulk-receipt') return;
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
    setupMemberActions();
    setupDonationActions();

    const ok = await fetchAdminMe();
    if (ok) showAdminPanel();
    else showLogin();
  }

  /* ------------ 강제 부트스트랩 ------------ */
  (function bootstrap() {
    function go() {
      const login = document.getElementById('adminLogin');
      const wrap = document.getElementById('adminWrap');
      if (login && !login.classList.contains('show') && (!wrap || !wrap.classList.contains('show'))) {
        login.classList.add('show');
      }
      init().catch(e => console.error('[admin init]', e));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  })();

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
  };
})();