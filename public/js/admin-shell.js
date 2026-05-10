/* admin-shell.js — Phase 20-A 사이드바 호버·라우팅·테마 (실 API) */
(function () {
  'use strict';

  /* ─── API 헬퍼 ─── */
  async function api({ method = 'GET', url, body } = {}) {
    try {
      if (typeof window.adminApi === 'function') return await window.adminApi({ method, url, body });
      if (typeof window.api === 'function')      return await window.api({ method, url, body });
      const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      if (r.status === 401) { window.location.href = '/admin.html'; return { ok: false, status: 401, data: {} }; }
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  /* ─── 즐겨찾기·최근 본 메뉴 상태 ─── */
  let favoritesSet = new Set();   /* menuKey 집합 */
  let recentViews  = [];          /* [{ menuKey, viewedAt, count }] */

  /* ─── 현재 운영자 역할 ─── */
  let currentRole = null;         /* 'super_admin' | 'admin' | null */

  /* super_admin 전용 메뉴 키 목록 */
  const SUPER_ADMIN_ONLY_KEYS = ['anon-audit'];

  /* ─── 9그룹 IA 정의 ─── */
  const NAV_GROUPS = [
    {
      key: 'dashboard',
      icon: '🏠',
      label: '대시보드',
      single: true,
      viewId: 'adm20-dashboard',
      hash: 'adm20-dashboard',
    },
    {
      key: 'members',
      icon: '👥',
      label: '회원·운영자',
      items: [
        { key: 'members-group', label: '회원·운영자 관리', hash: 'adm20-members', viewId: 'adm20-members' },
      ],
    },
    {
      key: 'donations',
      icon: '💰',
      label: '후원·재정',
      items: [
        { key: 'donations-group', label: '후원금 관리', hash: 'adm20-donations', viewId: 'adm20-donations' },
        { key: 'finance-group',   label: '재정 관리',   hash: 'adm20-finance',   viewId: 'adm20-finance' },
        { key: 'campaigns',       label: '캠페인 관리', hash: 'adm20-campaigns',  viewId: 'adm20-campaigns' },
      ],
    },
    {
      key: 'siren',
      icon: '🚨',
      label: '사이렌 신고',
      items: [
        { key: 'siren-group',  label: '신고 처리',          hash: 'adm20-siren',       viewId: 'adm20-siren' },
        { key: 'siren-stats',  label: '신고 통계',          hash: 'adm20-siren-stats', viewId: 'adm20-siren-stats' },
        { key: 'anon-audit',   label: '익명 감사 로그',     hash: 'adm20-anon-audit',  viewId: 'adm20-anon-audit' },
      ],
    },
    {
      key: 'support',
      icon: '🤝',
      label: '유가족 지원·문의',
      items: [
        { key: 'support-group', label: '유가족 지원 관리', hash: 'adm20-support', viewId: 'adm20-support' },
        { key: 'chat',          label: '문의 채팅',        hash: 'adm20-chat',    viewId: 'adm20-chat' },
      ],
    },
    {
      key: 'send',
      icon: '📨',
      label: '알림·발송',
      items: [
        { key: 'send-jobs',      label: '발송 작업',    hash: 'adm20-send-jobs',      viewId: 'adm20-send-jobs' },
        { key: 'send-templates', label: '발송 템플릿',  hash: 'adm20-send-templates', viewId: 'adm20-send-templates' },
        { key: 'send-groups',    label: '수신자 그룹',  hash: 'adm20-send-groups',    viewId: 'adm20-send-groups' },
        { key: 'send-analytics', label: '발송 분석·로그', hash: 'adm20-send-analytics', viewId: 'adm20-send-analytics' },
      ],
    },
    {
      key: 'content',
      icon: '📝',
      label: '콘텐츠',
      items: [
        { key: 'site-builder', label: '메인 화면 편집', hash: 'adm20-site-builder', viewId: 'adm20-site-builder' },
        { key: 'content-mgmt', label: '콘텐츠 관리',   hash: 'adm20-content',       viewId: 'adm20-content-mgmt' },
        { key: 'weekly-report', label: '주간 보고서',   hash: 'adm20-weekly-report', viewId: 'adm20-weekly-report' },
      ],
    },
    {
      key: 'ai',
      icon: '🤖',
      label: 'AI 에이전트',
      items: [
        { key: 'ai-recommend',  label: 'AI 추천 센터',       hash: 'adm20-ai-recommend',  viewId: 'adm20-ai-recommend' },
        { key: 'ai-activity',   label: 'AI 활동보고서',      hash: 'adm20-ai-activity',   viewId: 'adm20-ai-activity' },
        { key: 'ai-triggers',   label: 'AI 자동 발송 트리거', hash: 'adm20-ai-triggers',   viewId: 'adm20-ai-triggers' },
      ],
    },
    {
      key: 'system',
      icon: '⚙️',
      label: '시스템·보안',
      items: [
        { key: 'system-settings', label: '시스템 설정', hash: 'adm20-system',      viewId: 'adm20-system' },
        { key: 'audit-logs',      label: '감사 로그',   hash: 'adm20-audit',        viewId: 'adm20-audit' },
      ],
    },
  ];

  /* 기존 hash → 새 view 매핑 (하위 호환) */
  const LEGACY_HASH_MAP = {
    'adm-dashboard':        'adm20-dashboard',
    'adm-unified-dashboard':'adm20-dashboard',
    'adm-members':          'adm20-members',
    'adm-operators':        'adm20-members',
    'adm-eligibility':      'adm20-members',
    'adm-donations':        'adm20-donations',
    'adm-hyosung':          'adm20-donations',
    'adm-receipt-settings': 'adm20-donations',
    'adm-campaigns':        'adm20-campaigns',
    'adm-finance-income':   'adm20-finance',
    'adm-finance-budget':   'adm20-finance',
    'adm-finance-report':   'adm20-finance',
    'adm-siren-incidents':  'adm20-siren',
    'adm-siren-harassment': 'adm20-siren',
    'adm-siren-legal':      'adm20-siren',
    'adm-siren-board':      'adm20-siren',
    'adm-siren-stats':      'adm20-siren-stats',
    'adm-anon-audit':       'adm20-anon-audit',
    'adm-anon-reveal':      'adm20-siren',
    'adm-support':          'adm20-support',
    'adm-chat':             'adm20-chat',
    'adm-agency-mgmt':      'adm20-support',
    'adm-referral-history': 'adm20-support',
    'adm-expert-match':     'adm20-members',
    'adm-expert-profiles':  'adm20-members',
    'adm-report':           'adm20-weekly-report',
    'adm-activity-report':  'adm20-ai-activity',
    'adm-ai':               'adm20-ai-recommend',
    'adm-content':          'adm20-content',
    'adm-audit':            'adm20-audit',
    'adm-security-audit':   'adm20-audit',
    'adm-settings':         'adm20-system',
    'adm-notification-logs':'adm20-send-analytics',
  };

  /* ─── DOM 참조 ─── */
  let sidebar, navEl, headerTitle, contentEl;

  /* ─── 현재 활성 view ─── */
  let currentViewId = null;

  /* ─── 즐겨찾기 로드 ─── */
  async function loadFavorites() {
    try {
      const res = await api({ url: '/api/admin-favorites-list' });
      if (!res.ok) return;
      const raw = res.data;
      const payload = raw?.data || raw;
      const list = payload?.favorites || [];
      favoritesSet = new Set(list.map(f => f.menuKey));
    } catch (e) {
      /* 즐겨찾기 실패는 조용히 무시 */
    }
  }

  /* ─── 최근 본 메뉴 로드 ─── */
  async function loadRecentViews() {
    try {
      const res = await api({ url: '/api/admin-recent-views-list' });
      if (!res.ok) return;
      const raw = res.data;
      const payload = raw?.data || raw;
      recentViews = payload?.recentViews || [];
    } catch (e) {
      /* 최근 본 메뉴 실패는 조용히 무시 */
    }
  }

  /* ─── 최근 본 메뉴 기록 (fire-and-forget) ─── */
  function recordRecentView(menuKey) {
    api({ method: 'POST', url: '/api/admin-recent-views-record', body: { menuKey } })
      .catch(() => {});
  }

  /* ─── 운영자 role 로드 → super_admin 전용 메뉴 숨김 ─── */
  async function loadRoleAndApply() {
    try {
      /* admin.js가 이미 /api/admin/me를 호출했을 수 있으나,
         shell은 독립적으로 role을 파악해 메뉴 가시성을 보장 */
      const res = await api({ url: '/api/admin/me' });
      if (res.ok) {
        const payload = res.data?.data || res.data || {};
        currentRole = (payload.admin || payload)?.role || null;
      }
    } catch (e) {
      /* role 조회 실패 시 일반 admin으로 간주 (super_admin 메뉴 숨김) */
    }
    applyRoleVisibility();
  }

  /* super_admin 전용 메뉴 표시/숨김 */
  function applyRoleVisibility() {
    const isSuperAdmin = currentRole === 'super_admin';
    SUPER_ADMIN_ONLY_KEYS.forEach(key => {
      navEl.querySelectorAll('[data-key="' + key + '"]').forEach(el => {
        el.style.display = isSuperAdmin ? '' : 'none';
      });
      /* 서브메뉴 버튼 숨김 */
      navEl.querySelectorAll('.adm-nav-sub__item[data-hash="adm20-' + key + '"]').forEach(el => {
        el.style.display = isSuperAdmin ? '' : 'none';
      });
    });
  }

  /* ─── 초기화 ─── */
  function init() {
    sidebar    = document.getElementById('adm20-sidebar');
    navEl      = document.getElementById('adm20-nav');
    headerTitle = document.getElementById('adm20-header-title');
    contentEl  = document.getElementById('adm20-content');

    if (!sidebar || !navEl) return;

    buildNav();
    setupMobileToggle();
    routeFromHash(location.hash);
    window.addEventListener('hashchange', () => routeFromHash(location.hash));

    /* 즐겨찾기·최근 목록 비동기 로드 (20-C UI에서 활용) */
    loadFavorites();
    loadRecentViews();

    /* role 기반 메뉴 가시성 적용 (BUG-20A-04) */
    loadRoleAndApply();
  }

  /* ─── 사이드바 HTML 생성 ─── */
  function buildNav() {
    navEl.innerHTML = '';
    NAV_GROUPS.forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'adm-nav-group';
      groupEl.dataset.key = group.key;

      if (group.single) {
        /* 단독 메뉴 (대시보드) */
        groupEl.innerHTML = `
          <button class="adm-nav-group__btn" data-view="${group.viewId}" data-hash="${group.hash}">
            <span class="adm-nav-group__icon">${group.icon}</span>
            <span class="adm-nav-group__label">${group.label}</span>
          </button>`;
        groupEl.querySelector('.adm-nav-group__btn').addEventListener('click', function () {
          navigate(this.dataset.view, this.dataset.hash, group.label);
        });
      } else {
        /* 그룹 + 서브메뉴 */
        const subHtml = group.items.map(item => `
          <button class="adm-nav-sub__item" data-view="${item.viewId}" data-hash="${item.hash}" data-label="${item.label}">
            ${item.label}
          </button>`).join('');

        groupEl.innerHTML = `
          <button class="adm-nav-group__btn" data-group="${group.key}">
            <span class="adm-nav-group__icon">${group.icon}</span>
            <span class="adm-nav-group__label">${group.label}</span>
            <span class="adm-nav-group__arrow">▶</span>
          </button>
          <div class="adm-nav-group__sub">${subHtml}</div>`;

        groupEl.querySelector('.adm-nav-group__btn').addEventListener('click', function () {
          toggleGroup(groupEl);
        });
        groupEl.querySelectorAll('.adm-nav-sub__item').forEach(btn => {
          btn.addEventListener('click', function () {
            navigate(this.dataset.view, this.dataset.hash, this.dataset.label);
          });
        });
      }

      navEl.appendChild(groupEl);
    });
  }

  /* ─── 그룹 열기/닫기 ─── */
  function toggleGroup(groupEl) {
    const isExpanded = groupEl.classList.contains('is-expanded');
    /* 다른 그룹 닫기 */
    document.querySelectorAll('.adm-nav-group.is-expanded').forEach(el => {
      if (el !== groupEl) el.classList.remove('is-expanded');
    });
    groupEl.classList.toggle('is-expanded', !isExpanded);
  }

  /* ─── 라우팅 ─── */
  function navigate(viewId, hash, label) {
    /* 모든 view 숨기기 */
    document.querySelectorAll('.adm-view').forEach(el => el.classList.remove('is-active'));
    /* 활성 view 표시 */
    const view = document.getElementById(viewId);
    if (view) view.classList.add('is-active');

    /* 활성 메뉴 스타일 */
    document.querySelectorAll('.adm-nav-group__btn, .adm-nav-sub__item').forEach(el => {
      el.classList.remove('is-active');
    });
    const activeBtn = navEl.querySelector(`[data-view="${viewId}"]`);
    if (activeBtn) {
      activeBtn.classList.add('is-active');
      const group = activeBtn.closest('.adm-nav-group');
      if (group) group.classList.add('is-expanded');
    }

    /* 헤더 타이틀 */
    if (headerTitle && label) headerTitle.textContent = label;

    /* URL hash 동기화 */
    if (hash && location.hash !== '#' + hash) {
      history.replaceState(null, '', '#' + hash);
    }

    currentViewId = viewId;
    closeMobileSidebar();

    /* 최근 본 메뉴 기록 (hash를 menuKey로 사용) */
    if (hash) recordRecentView(hash);
  }

  /* ─── Hash → viewId 매핑 ─── */
  function routeFromHash(hash) {
    const h = hash ? hash.replace('#', '') : '';
    if (!h) {
      navigate('adm20-dashboard', 'adm20-dashboard', '대시보드');
      return;
    }
    /* 새 hash 직접 매핑 */
    const allItems = flatItems();
    const direct = allItems.find(i => i.hash === h);
    if (direct) {
      navigate(direct.viewId, direct.hash, direct.label);
      return;
    }
    /* 레거시 hash 매핑 */
    const legacyTarget = LEGACY_HASH_MAP[h];
    if (legacyTarget) {
      const item = allItems.find(i => i.viewId === legacyTarget);
      if (item) {
        navigate(item.viewId, item.hash, item.label);
        return;
      }
    }
    /* 기본: 대시보드 */
    navigate('adm20-dashboard', 'adm20-dashboard', '대시보드');
  }

  function flatItems() {
    const result = [];
    NAV_GROUPS.forEach(g => {
      if (g.single) result.push({ viewId: g.viewId, hash: g.hash, label: g.label });
      else (g.items || []).forEach(i => result.push(i));
    });
    return result;
  }

  /* ─── 모바일 토글 ─── */
  function setupMobileToggle() {
    const toggleBtn = document.getElementById('adm20-mobile-toggle');
    let overlay = document.getElementById('adm20-sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'adm20-sidebar-overlay';
      overlay.className = 'adm-sidebar-overlay';
      document.body.appendChild(overlay);
    }
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('is-open');
        overlay.classList.toggle('is-visible', sidebar.classList.contains('is-open'));
      });
    }
    overlay.addEventListener('click', closeMobileSidebar);
  }

  function closeMobileSidebar() {
    if (sidebar) sidebar.classList.remove('is-open');
    const overlay = document.getElementById('adm20-sidebar-overlay');
    if (overlay) overlay.classList.remove('is-visible');
  }

  /* ─── 공개 API ─── */
  window.AdminShell = {
    navigate,
    getCurrentView: () => currentViewId,
    /* 즐겨찾기 토글 (20-C에서 UI 연결) */
    toggleFavorite: async (menuKey) => {
      const res = await api({ method: 'POST', url: '/api/admin-favorites-toggle', body: { menuKey } });
      if (!res.ok) return null;
      const raw = res.data;
      const payload = raw?.data || raw;
      const action = payload?.action || (payload?.ok ? 'toggled' : null);
      if (action === 'added')   favoritesSet.add(menuKey);
      if (action === 'removed') favoritesSet.delete(menuKey);
      return action;
    },
    isFavorite: (menuKey) => favoritesSet.has(menuKey),
    getFavorites: () => Array.from(favoritesSet),
    getRecentViews: () => recentViews.slice(),
  };

  /* DOMContentLoaded 또는 즉시 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
