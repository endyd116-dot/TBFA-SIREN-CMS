/* ===========================================================
   퀵이동 (quick-jump) — 어드민·워크스페이스 공통 화면 전환 컴포넌트
   - 1뎁스 토글로 5개 화면(싸이렌 어드민/통합 CMS/허브/사용자 홈/워크스페이스) 펼침
   - 현재 페이지 자기 자신은 영구 숨김
   - 외부 클릭 시 자동 접힘
   =========================================================== */
(function () {
  'use strict';

  function detectCurrent() {
    var path = (window.location.pathname || '').toLowerCase();
    if (path === '/' || path === '/index.html') return 'home';
    if (path.indexOf('/admin-hub') === 0) return 'hub';
    if (path.indexOf('/admin.html') === 0) return 'admin';
    if (path.indexOf('/cms-tbfa') === 0) return 'cms-tbfa';
    if (path.indexOf('/workspace') === 0) return 'workspace';
    return '';
  }

  function buildItems(currentKey) {
    return [
      { key: 'admin',    href: '/admin.html?service=siren', icon: '🚨', label: '싸이렌 어드민' },
      { key: 'cms-tbfa', href: '/cms-tbfa.html',            icon: '🏦', label: '통합 CMS 어드민' },
      { key: 'workspace',href: '/workspace.html',           icon: '📊', label: '워크스페이스' },
      { key: 'hub',      href: '/admin-hub.html',           icon: '🏠', label: '허브' },
      { key: 'home',     href: '/',                         icon: '🌐', label: '사용자 홈페이지' },
    ];
  }

  function renderInto(container) {
    if (!container) return;
    var current = detectCurrent();
    container.setAttribute('data-current', current);
    container.setAttribute('aria-expanded', 'false');

    var items = buildItems(current);
    var html = '';
    html += '<button type="button" class="quick-jump-toggle" aria-haspopup="true">';
    html += '<span class="quick-jump-icon">🚀</span>';
    html += '<span class="quick-jump-label">퀵이동</span>';
    html += '<span class="quick-jump-chevron">▾</span>';
    html += '</button>';
    html += '<ul class="quick-jump-menu" role="menu">';
    items.forEach(function (it) {
      var isCurrent = (it.key === current);
      html += '<li role="none"' + (isCurrent ? ' data-current="1"' : '') + ' data-target="' + it.key + '">';
      html += '<a role="menuitem" href="' + it.href + '" onclick="window.location.href=\'' + it.href + '\';return false;">';
      html += '<span class="quick-jump-item-icon">' + it.icon + '</span>';
      html += '<span class="quick-jump-item-label">' + it.label + '</span>';
      html += '</a>';
      html += '</li>';
    });
    html += '</ul>';
    container.innerHTML = html;

    var toggle = container.querySelector('.quick-jump-toggle');
    if (toggle) {
      toggle.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var open = container.getAttribute('aria-expanded') === 'true';
        container.setAttribute('aria-expanded', open ? 'false' : 'true');
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    }

    document.addEventListener('click', function (ev) {
      if (!container.contains(ev.target)) {
        container.setAttribute('aria-expanded', 'false');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        container.setAttribute('aria-expanded', 'false');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-quick-jump]');
    nodes.forEach(renderInto);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
