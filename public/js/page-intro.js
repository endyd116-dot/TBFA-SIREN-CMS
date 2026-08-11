/* =========================================================
   page-intro.js — 화면 위쪽 '꾸미는 말' 불러오기
   (2026-08-11 · 주요활동 1메뉴 = 1화면 개편)

   운영자가 백오피스 [페이지 편집]에서 고친 제목·부제·본문을 화면 맨 위에 얹는다.
   코드를 고치지 않고도 문구와 사진을 바꿀 수 있게 하려는 것.

   쓰는 법 — 화면 HTML 에 이렇게 자리만 만들어 두면 된다:
     <section class="page-hero" data-intro="intro-notice">
       <div class="container">
         <div class="sec-eyebrow" data-intro-eyebrow>NOTICE</div>
         <h1 data-intro-title>공지사항</h1>
         <p data-intro-subtitle>…</p>
       </div>
     </section>
     <div class="container"><div class="page-intro-body" data-intro-body></div></div>

   저장소에서 못 받아오면 HTML 에 적혀 있던 기본 문구를 그대로 둔다 (빈 화면 방지).
   ========================================================= */
(function () {
  'use strict';

  /* 관리자가 [미리보기]로 들어온 경우에만 임시저장본을 보여준다 */
  var PREVIEW = /(^|[?&])preview=1(&|$)/.test(location.search);

  function apply(host, page) {
    var root = host.parentElement || document;

    function put(sel, value, opts) {
      /* 인트로 영역 밖까지 뒤져서 엉뚱한 곳을 건드리지 않도록 화면 전체에서 한 번만 찾는다 */
      var el = document.querySelector(sel);
      if (!el) return;
      var v = (value == null ? '' : String(value)).trim();
      if (!v) {
        /* 운영자가 비워 둔 칸은 화면에서도 감춘다 */
        if (opts && opts.hideWhenEmpty) el.style.display = 'none';
        return;
      }
      el.style.display = '';
      if (opts && opts.html) el.innerHTML = v;
      else el.textContent = v;
    }

    put('[data-intro-eyebrow]', page.eyebrow, { hideWhenEmpty: true });
    put('[data-intro-title]', page.title);
    put('[data-intro-subtitle]', page.subtitle, { hideWhenEmpty: true });
    /* 본문은 운영자가 편집기로 쓴 글이라 서식(사진·링크·표)을 그대로 살린다 */
    put('[data-intro-body]', page.contentHtml, { html: true, hideWhenEmpty: true });

    if (page.title) {
      var crumb = document.querySelector('[data-intro-breadcrumb]');
      if (crumb) crumb.textContent = page.title;
    }

    if (root && root.classList) root.classList.add('intro-loaded');
  }

  async function load() {
    var host = document.querySelector('[data-intro]');
    if (!host) return;

    var slug = host.getAttribute('data-intro');
    if (!slug) return;

    try {
      var url = '/api/public/page?slug=' + encodeURIComponent(slug) + (PREVIEW ? '&preview=1' : '');
      var res = await fetch(url, { credentials: 'include' });
      var body = await res.json().catch(function () { return {}; });
      var page = body && (body.data?.page || body.page);
      /* 아직 안 만들어진 화면이면 조용히 기본 문구를 유지한다 (오류 문구를 띄우지 않는다) */
      if (!res.ok || !page) return;
      apply(host, page);
    } catch (err) {
      console.warn('[page-intro] 화면 문구를 불러오지 못했습니다 — 기본 문구를 그대로 씁니다', err);
    }
  }

  /* 다른 화면 스크립트와 같은 방식으로 3가지 경로에서 시작을 보장한다 */
  var started = false;
  function start() { if (started) return; started = true; load(); }

  var prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    start();
  };
  document.addEventListener('partials:loaded', start);
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
