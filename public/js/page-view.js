/**
 * public/js/page-view.js — 공개 페이지 화면 보조
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §4.2
 *
 * 본문 자체는 서버가 이미 채워서 내려준다(검색 노출·첫 화면 때문). 여기서는 나머지를 맡는다.
 *  ① 현재 위치 표시 — 메뉴 구조에서 이 페이지의 상위 메뉴를 찾아 "홈 › 협의회 소개 › 인사말"로 만든다.
 *     (예전에는 이 줄이 코드에 박혀 있어 어느 메뉴로 들어와도 '인사말'로 고정돼 있었다)
 *  ② 넓은 표는 표만 좌우로 넘기게 감싼다 — 페이지 전체가 가로로 밀리지 않도록
 *  ③ 서버가 본문을 못 채운 경우의 대비책 — 주소의 페이지를 직접 불러와 채운다
 */
(function () {
  'use strict';

  function slugFromPath() {
    var m = String(location.pathname || '').match(/^\/p\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]);
    var q = new URLSearchParams(location.search).get('slug');
    return q ? String(q) : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* =========================================================
     ① 현재 위치 표시
     ========================================================= */
  function findTrail(items, targetHref, parentLabel) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var href = String(it.href || '');
      if (href && href.replace(/\/+$/, '') === targetHref) {
        return { parent: parentLabel || null, label: it.label };
      }
      if (it.children && it.children.length) {
        var hit = findTrail(it.children, targetHref, it.label);
        if (hit) return hit;
      }
    }
    return null;
  }

  async function renderBreadcrumb() {
    var box = document.querySelector('[data-page-breadcrumb]');
    if (!box) return;

    var slug = box.getAttribute('data-slug') || slugFromPath();
    var pageTitle = (window.__SIREN_PAGE__ && window.__SIREN_PAGE__.title) ||
                    (document.querySelector('.page-hero-wrap h1') || {}).textContent || '';

    /* 메뉴를 못 불러와도 최소한 "홈 › 페이지이름"은 보여준다 */
    var trail = null;
    try {
      var res = await fetch('/api/public/nav-menus?location=header', { credentials: 'same-origin' });
      var json = await res.json();
      var items = (json && json.data && json.data.items) || (json && json.items) || [];
      trail = findTrail(items, '/p/' + slug, null);
    } catch (_) { /* 메뉴 조회 실패 — 아래 기본 표시 */ }

    var parts = ['<a href="/index.html">홈</a>'];
    if (trail && trail.parent) parts.push(esc(trail.parent));
    parts.push(esc((trail && trail.label) || pageTitle));

    box.innerHTML = parts.join(' &nbsp;›&nbsp; ');
  }

  /* =========================================================
     ② 넓은 표 감싸기
     ========================================================= */
  function wrapWideTables(root) {
    var body = root || document.querySelector('[data-page-body]');
    if (!body) return;
    body.querySelectorAll('table').forEach(function (tb) {
      if (tb.parentElement && tb.parentElement.classList.contains('table-scroll')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      tb.parentNode.insertBefore(wrap, tb);
      wrap.appendChild(tb);
    });
  }

  /* =========================================================
     ③ 서버가 본문을 못 채운 경우 대비책
     ========================================================= */
  async function fillIfEmpty() {
    var body = document.querySelector('[data-page-body]');
    var main = document.querySelector('main');
    if (body && body.innerHTML.trim()) return false;      // 이미 채워져 있으면 할 일 없음
    if (!main) return false;

    var slug = slugFromPath();
    if (!slug) return false;

    var preview = new URLSearchParams(location.search).get('preview') === '1';
    try {
      var res = await fetch('/api/public/page?slug=' + encodeURIComponent(slug) + (preview ? '&preview=1' : ''),
        { credentials: 'same-origin' });
      var json = await res.json();
      var page = (json && json.data && json.data.page) || (json && json.page);
      if (!page) return false;

      if (body) {
        body.innerHTML = page.contentHtml || '';
      } else {
        main.innerHTML =
          '<div class="page-hero-wrap"><div class="container">' +
            (page.eyebrow ? '<div class="sec-eyebrow">' + esc(page.eyebrow) + '</div>' : '') +
            '<h1>' + esc(page.title) + '</h1>' +
            (page.subtitle ? '<p class="page-subtitle">' + esc(page.subtitle) + '</p>' : '') +
          '</div></div>' +
          '<div class="page-main"><div class="container">' +
            '<nav class="breadcrumb" data-page-breadcrumb data-slug="' + esc(slug) + '"></nav>' +
            '<div class="page-body-wrap layout-' + esc(page.layout || 'default') + '">' +
              '<div class="page-body" data-page-body>' + (page.contentHtml || '') + '</div>' +
            '</div>' +
          '</div></div>';
      }
      if (document.title === '교사유가족협의회' && page.title) {
        document.title = page.title + ' | 교사유가족협의회';
      }
      return true;
    } catch (e) {
      console.warn('[page-view] 본문을 불러오지 못했습니다', e);
      return false;
    }
  }

  async function init() {
    var filled = await fillIfEmpty();
    await renderBreadcrumb();
    wrapWideTables();
    /* 본문을 나중에 채운 경우 지도 등을 다시 살린다 */
    if (filled && window.SirenPageWidgets) window.SirenPageWidgets.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
