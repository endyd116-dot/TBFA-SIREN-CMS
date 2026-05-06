/* =========================================================
   SIREN — admin-site-builder.js (Phase B Step 6-B)
   메인 화면 편집 시스템 — 트리 + 라우터 + iframe 미리보기
   ========================================================= */
(function () {
  'use strict';

  /* ============ 카테고리 트리 정의 ============ */
  const TREE = [
    {
      key: 'header', label: '🏠 헤더', expanded: true,
      children: [
        { key: 'header.brand', label: '로고/협회명/부제' },
        { key: 'header.menus', label: '메뉴 관리' },
      ],
    },
    {
      key: 'home', label: '🌟 메인 (홈)', expanded: true,
      children: [
        { key: 'home.hero',          label: '히어로 배너 (슬라이드 + 텍스트)' },
        { key: 'home.quickMenu',     label: '퀵메뉴 (6개 박스)' },
        { key: 'home.sections',      label: '섹션 제목 (캠페인/공지/FAQ)' },
        { key: 'home.specialBanner', label: '특별 캠페인 배너 (하단)' },
        { key: 'home.effects',       label: '효과 / 애니메이션' },
      ],
    },
    { key: 'stats', label: '📊 통계', leaf: true },
    { key: 'notices_faq', label: '📰 공지/FAQ 표시', leaf: true },
    {
      key: 'footer', label: '📌 푸터', expanded: true,
      children: [
        { key: 'footer.org', label: '회사 정보' },
        { key: 'footer.sns', label: '소셜 미디어 링크' },
        { key: 'footer.menus', label: '푸터 메뉴' },
        { key: 'footer.related_sites', label: '관련 사이트' },
      ],
    },
    { key: 'siren_menu', label: '🚨 사이렌 메뉴', leaf: true },
    {
      key: 'mypage', label: '🎗 마이페이지', expanded: false,
      children: [
        { key: 'mypage.cancellationGuide', label: '정기 후원 해지 안내' },
      ],
    },
    {
      key: 'static_pages', label: '📄 정적 페이지', expanded: false,
      children: [
        { key: 'page.terms', label: '이용약관' },
        { key: 'page.privacy', label: '개인정보처리방침' },
        { key: 'page.email_reject', label: '이메일 무단수집 거부' },
        { key: 'page.ethics', label: '윤리경영' },
      ],
    },
    { key: 'publish', label: '🚀 배포 관리', leaf: true },
  ];

  /* ============ 상태 ============ */
  let _currentNode = null;
  let _currentMode = 'draft';
  let _currentDevice = 'desktop';
  let _draftCount = 0;

  /* ============ 헬퍼 ============ */
  function $(sel) { return document.querySelector(sel); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    const t = $('#toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._sbtt);
    window._sbtt = setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[site-builder]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ============ 어드민 인증 체크 ============ */
  async function checkAdminAuth() {
    const res = await api('/api/admin/site-settings?scope=stats');
    if (res.status === 401) {
      alert('관리자 로그인이 필요합니다');
      location.href = '/admin.html';
      return false;
    }
    if (!res.ok) {
      console.warn('[site-builder] 인증 체크 실패:', res.data);
      return true;
    }
    return true;
  }

  /* ============ 트리 렌더링 ============ */
  function renderTree() {
    const root = $('#sbTree');
    if (!root) return;
    let html = '';
    for (const node of TREE) html += renderTreeNode(node, false);
    root.innerHTML = html;
  }

  function renderTreeNode(node, isChild) {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const expanded = !!node.expanded;
    const cls = [
      'sb-tree-node',
      hasChildren ? 'parent' : '',
      isChild ? 'child' : '',
      expanded ? 'expanded' : '',
    ].filter(Boolean).join(' ');

    let html = `<div class="${cls}" data-node-key="${escapeHtml(node.key)}" data-has-children="${hasChildren ? '1' : '0'}">`;
    html += hasChildren ? '<span class="sb-tree-toggle">▶</span>' : '<span class="sb-tree-toggle"></span>';
    html += `<span class="sb-tree-node-label">${escapeHtml(node.label)}</span>`;
    html += '</div>';

    if (hasChildren) {
      html += `<div class="sb-tree-children${expanded ? ' expanded' : ''}" data-children-of="${escapeHtml(node.key)}">`;
      for (const child of node.children) html += renderTreeNode(child, true);
      html += '</div>';
    }
    return html;
  }

  function attachTreeEvents() {
    const root = $('#sbTree');
    if (!root) return;

    root.addEventListener('click', (e) => {
      const nodeEl = e.target.closest('.sb-tree-node');
      if (!nodeEl) return;
      const key = nodeEl.dataset.nodeKey;
      const hasChildren = nodeEl.dataset.hasChildren === '1';

      if (hasChildren) {
        nodeEl.classList.toggle('expanded');
        const childrenEl = root.querySelector(`[data-children-of="${CSS.escape(key)}"]`);
        if (childrenEl) childrenEl.classList.toggle('expanded');
      } else {
        selectNode(key);
      }
    });

    const collapseBtn = $('#sbTreeCollapse');
    if (collapseBtn) {
      let isCollapsed = false;
      collapseBtn.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        root.querySelectorAll('.sb-tree-node.parent').forEach((n) => {
          n.classList.toggle('expanded', !isCollapsed);
        });
        root.querySelectorAll('.sb-tree-children').forEach((c) => {
          c.classList.toggle('expanded', !isCollapsed);
        });
      });
    }
  }

  /* ============ 노드 선택 + 폼 라우팅 ============ */
  function findNodeLabel(key) {
    for (const n of TREE) {
      if (n.key === key) return n.label;
      if (n.children) {
        for (const c of n.children) {
          if (c.key === key) return n.label + ' → ' + c.label;
        }
      }
    }
    return key;
  }

  function selectNode(key) {
    document.querySelectorAll('.sb-tree-node').forEach((n) => {
      n.classList.toggle('active', n.dataset.nodeKey === key);
    });
    _currentNode = key;

    const subtitle = $('#sbCurrentSection');
    if (subtitle) subtitle.textContent = findNodeLabel(key);

    const renderer = RENDERERS[key];
    if (renderer) {
      renderer();
    } else {
      renderPlaceholder(key, findNodeLabel(key));
    }
  }


  /* ============ 폼 렌더러 ============ */
  const RENDERERS = {
    'stats': function () {
      const inner = $('#sbContentInner');
      inner.innerHTML = '<div id="statsEditContainer"></div>';
      if (window.SIREN_STATS_EDIT) {
        window.SIREN_STATS_EDIT.init();
        window.SIREN_STATS_EDIT.loadStats();
      } else {
        inner.innerHTML = '<div class="sb-placeholder"><p>통계 편집 모듈 로드 실패</p></div>';
      }
    },
    /* ★ Step 6-D: HERO 편집 폼 */
    'home.hero': function () {
      if (window.SIREN_HOME_HERO && window.SIREN_HOME_HERO.render) {
        window.SIREN_HOME_HERO.render();
      } else {
        const inner = $('#sbContentInner');
        inner.innerHTML = '<div class="sb-placeholder"><p>HERO 편집 모듈 로드 실패 — admin-home-hero.js 스크립트 태그 확인</p></div>';
      }
    },
    /* ★ Step 6-E: 퀵메뉴 편집 폼 */
    'home.quickMenu': function () {
      if (window.SIREN_HOME_QUICKMENU && window.SIREN_HOME_QUICKMENU.render) {
        window.SIREN_HOME_QUICKMENU.render();
      } else {
        const inner = $('#sbContentInner');
        inner.innerHTML = '<div class="sb-placeholder"><p>퀵메뉴 편집 모듈 로드 실패 — admin-home-quickmenu.js 스크립트 태그 확인</p></div>';
      }
    },
    'publish': function () {
      renderPublishPanel();
    },
        /* ★ Step 6-F: 섹션 제목 편집 (캠페인/공지/FAQ) */
    'home.sections': function () {
      if (window.SIREN_HOME_SECTIONS && window.SIREN_HOME_SECTIONS.render) {
        window.SIREN_HOME_SECTIONS.render();
      } else {
        const inner = $('#sbContentInner');
        inner.innerHTML = '<div class="sb-placeholder"><p>섹션 제목 편집 모듈 로드 실패 — admin-home-sections.js 스크립트 태그 확인</p></div>';
      }
    },
        /* ★ Step 6-G: 특별 캠페인 배너 편집 */
    'home.specialBanner': function () {
      if (window.SIREN_HOME_BANNER && window.SIREN_HOME_BANNER.render) {
        window.SIREN_HOME_BANNER.render();
      } else {
        const inner = $('#sbContentInner');
        inner.innerHTML = '<div class="sb-placeholder"><p>배너 편집 모듈 로드 실패 — admin-home-banner.js 스크립트 태그 확인</p></div>';
      }
    },
        /* ★ Step 6-H: 효과/애니메이션 편집 */
    'home.effects': function () {
      if (window.SIREN_HOME_EFFECTS && window.SIREN_HOME_EFFECTS.render) {
        window.SIREN_HOME_EFFECTS.render();
      } else {
        const inner = $('#sbContentInner');
        inner.innerHTML = '<div class="sb-placeholder"><p>효과 편집 모듈 로드 실패 — admin-home-effects.js 스크립트 태그 확인</p></div>';
      }
    },
  };

  
  /* ★ Step 6-B: home.* 노드용 placeholder는 시드 데이터 키 안내까지 표시 */
  const HOME_NODE_INFO = {
    'home.hero': {
      icon: '🎬',
      desc: 'HERO 슬라이더 (3장) + eyebrow 라벨 + 본문 + 자동재생 속도',
      keys: ['home.hero.slides', 'home.hero.eyebrow', 'home.hero.lead', 'home.hero.autoplaySpeed', 'home.hero.autoplayEnabled'],
    },
    'home.quickMenu': {
      icon: '🟦',
      desc: '메인 상단 6개 박스 (후원하기 / SIREN 그룹 3개 / 자유게시판 / 신청내역)',
      keys: ['home.quickMenu.items', 'home.quickMenu.sectionVisible'],
    },
    'home.sections': {
      icon: '📑',
      desc: '캠페인 영역 / 공지사항 / FAQ 영역의 제목·부제·노출개수·표시여부',
      keys: ['home.campaign.*', 'home.notice.*', 'home.faq.*'],
    },
    'home.specialBanner': {
      icon: '🎗',
      desc: '하단 "기억의 약속" 특별 캠페인 배너 (제목/본문/모금액/CTA)',
      keys: ['home.specialBanner.visible/tag/title/lead/goalAmount/raisedAmount/cta'],
    },
    'home.effects': {
      icon: '✨',
      desc: '카운터 애니메이션 / 사이렌 펄스 / 진행률 게이지 속도 조정',
      keys: ['home.effects.counterDuration', 'home.effects.sirenPulseEnabled', 'home.effects.progressBarDuration'],
    },
  };

  function renderPlaceholder(key, label) {
    const inner = $('#sbContentInner');
    const info = HOME_NODE_INFO[key];

    if (info) {
      const keyList = info.keys.map((k) => `<li><code>${escapeHtml(k)}</code></li>`).join('');
      inner.innerHTML = `
        <div class="sb-placeholder" style="text-align:left;max-width:560px;margin:40px auto">
          <div class="sb-placeholder-icon" style="text-align:center">${info.icon}</div>
          <h3 style="text-align:center">${escapeHtml(label)}</h3>
          <p style="text-align:center;color:#86868b">${escapeHtml(info.desc)}</p>
          <div style="margin-top:24px;padding:16px 20px;background:#f5f5f7;border-radius:8px">
            <div style="font-size:12px;color:#7a1f2b;font-weight:600;margin-bottom:8px">
              ✅ DB 시드 완료 — 다음 키들이 편집 가능 상태입니다
            </div>
            <ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.9">
              ${keyList}
            </ul>
          </div>
          <p style="margin-top:18px;font-size:12px;color:#86868b;text-align:center">
            ※ 상세 편집 폼은 묶음 2 단계에서 추가됩니다.<br />
            현재는 우측 미리보기에서 메인 페이지 전체를 확인할 수 있습니다.
          </p>
        </div>
      `;
      return;
    }

    /* 그 외 영역 — 기본 안내 */
    inner.innerHTML = `
      <div class="sb-placeholder">
        <div class="sb-placeholder-icon">🚧</div>
        <h3>${escapeHtml(label)}</h3>
        <p>이 영역의 편집 기능은 다음 단계에서 구현됩니다.</p>
        <small>※ 점진적으로 추가될 예정입니다.</small>
      </div>
    `;
  }

  async function renderPublishPanel() {
    const inner = $('#sbContentInner');
    inner.innerHTML = '<div class="sb-placeholder"><p>배포 정보 로딩 중...</p></div>';

    const [settingsRes, menusRes] = await Promise.all([
      api('/api/admin/site-settings'),
      api('/api/admin/nav-menus'),
    ]);

    const draftSettings = settingsRes.data?.data?.stats?.drafts || 0;
    const draftMenus = menusRes.data?.data?.draftCount || 0;
    const total = draftSettings + draftMenus;

    inner.innerHTML = `
      <div style="background:#fff;padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04)">
        <h2 style="margin:0 0 24px;font-family:'Noto Serif KR',serif">🚀 배포 관리</h2>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:28px">
          <div style="padding:20px;background:#fef9f5;border:1px solid #f5d97a;border-radius:8px;text-align:center">
            <div style="font-size:11px;color:#86868b;text-transform:uppercase;margin-bottom:6px">설정 임시저장</div>
            <div style="font-size:32px;font-weight:700;color:#7a5e00">${draftSettings}</div>
          </div>
          <div style="padding:20px;background:#fef9f5;border:1px solid #f5d97a;border-radius:8px;text-align:center">
            <div style="font-size:11px;color:#86868b;text-transform:uppercase;margin-bottom:6px">메뉴 임시저장</div>
            <div style="font-size:32px;font-weight:700;color:#7a5e00">${draftMenus}</div>
          </div>
        </div>
        <div style="padding:16px;background:#f5f5f7;border-radius:8px;margin-bottom:20px">
          <div style="font-size:13px;color:#424245;line-height:1.7">
            <strong>배포 동작:</strong><br />
            • 모든 임시저장(Draft) 변경사항이 운영 사이트에 즉시 반영됩니다<br />
            • 배포 후에는 이전 값으로 되돌릴 수 없습니다 (수동 재입력 필요)<br />
            • 일반 사용자는 배포된 내용만 볼 수 있습니다
          </div>
        </div>
        <button type="button" id="sbInlinePublishBtn"
          style="width:100%;padding:14px;background:linear-gradient(135deg,#7a1f2b,#a3303f);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer"
          ${total === 0 ? 'disabled' : ''}>
          🚀 ${total > 0 ? `${total}건 모두 배포` : '배포할 변경사항 없음'}
        </button>
      </div>
    `;

    const btn = $('#sbInlinePublishBtn');
    if (btn) btn.addEventListener('click', publishAll);
  }

  /* ============ Draft 카운트 갱신 ============ */
  async function refreshDraftCount() {
    const [settingsRes, menusRes] = await Promise.all([
      api('/api/admin/site-settings'),
      api('/api/admin/nav-menus'),
    ]);

    const draftSettings = settingsRes.data?.data?.stats?.drafts || 0;
    const draftMenus = menusRes.data?.data?.draftCount || 0;
    _draftCount = draftSettings + draftMenus;

    const counter = $('#sbDraftCounter');
    const countEl = $('#sbDraftCount');
    if (counter && countEl) {
      if (_draftCount > 0) {
        counter.style.display = '';
        countEl.textContent = _draftCount;
      } else {
        counter.style.display = 'none';
      }
    }
  }

  /* ============ 일괄 배포 ============ */
  async function publishAll() {
    if (_draftCount === 0) {
      toast('배포할 변경사항이 없습니다');
      return;
    }
    const confirmed = confirm(
      `${_draftCount}건의 모든 임시 변경사항을 운영에 배포하시겠습니까?\n\n` +
      '• 즉시 사용자에게 반영됩니다\n' +
      '• 배포 후 되돌릴 수 없습니다 (수동 재입력 필요)'
    );
    if (!confirmed) return;

    const btn = $('#sbPublishAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = '배포 중...'; }

    let total = 0;
    const r1 = await api('/api/admin/site-settings', {
      method: 'POST', body: { action: 'publish' },
    });
    total += r1.data?.data?.affectedCount || 0;

    const r2 = await api('/api/admin/nav-menus?action=publish', {
      method: 'POST', body: {},
    });
    total += r2.data?.data?.affectedCount || 0;

    if (btn) { btn.disabled = false; btn.textContent = '🚀 모든 변경사항 배포'; }

    toast(`${total}건 배포 완료`);
    await refreshDraftCount();
    reloadPreview();

    if (_currentNode === 'publish') renderPublishPanel();
  }

  /* ============ iframe 미리보기 제어 ============ */
  function reloadPreview() {
    const frame = $('#sbPreviewFrame');
    if (!frame) return;
    const ts = Date.now();
    const url = _currentMode === 'draft'
      ? `/index.html?preview=1&_t=${ts}`
      : `/index.html?_t=${ts}`;
    frame.src = url;
  }

  function setMode(mode) {
    _currentMode = mode;
    document.querySelectorAll('.sb-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
    });

    const dot = $('#sbStatusDot');
    const txt = $('#sbStatusText');
    if (dot) {
      dot.classList.remove('draft', 'live');
      dot.classList.add(mode);
    }
    if (txt) {
      txt.textContent = mode === 'draft'
        ? 'Draft 모드 — 임시저장 반영'
        : 'Live 모드 — 운영 사이트 그대로';
    }
    reloadPreview();
  }

  function setDevice(device) {
    _currentDevice = device;
    const wrap = $('#sbPreviewFrameWrap');
    if (!wrap) return;
    wrap.classList.remove('device-desktop', 'device-tablet', 'device-mobile');
    wrap.classList.add('device-' + device);

    document.querySelectorAll('.sb-device-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.device === device);
    });
  }

  function attachPreviewEvents() {
    document.querySelectorAll('.sb-mode-btn').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });
    document.querySelectorAll('.sb-device-btn').forEach((b) => {
      b.addEventListener('click', () => setDevice(b.dataset.device));
    });
    const refreshBtn = $('#sbRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', reloadPreview);

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'siren:reload-preview') {
        reloadPreview();
      }
    });
  }

  /* ============ 초기화 ============ */
  let _initialized = false;

  async function init() {
    if (_initialized) return;
    _initialized = true;

    const ok = await checkAdminAuth();
    if (!ok) return;

    renderTree();
    attachTreeEvents();
    attachPreviewEvents();
    setMode('draft');

    try {
      const r = await api('/api/admin/site-settings?scope=stats');
      if (r.ok && r.data?.data) {
        const adminName = r.data?.admin?.name || '관리자';
        const nameEl = $('#sbAdminName');
        if (nameEl) nameEl.textContent = adminName;
      }
    } catch (_) {}

    await refreshDraftCount();

    const publishBtn = $('#sbPublishAllBtn');
    if (publishBtn) publishBtn.addEventListener('click', publishAll);

    setInterval(refreshDraftCount, 30000);
  }

  window.SIREN_SITE_BUILDER = {
    reloadPreview,
    refreshDraftCount,
    selectNode,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();