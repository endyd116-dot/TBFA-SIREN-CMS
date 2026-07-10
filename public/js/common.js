/* =========================================================
   SIREN — common.js  (v4 — Phase B Step 5-A: 헤더 동적 렌더링)
   ========================================================= */
(function () {
  'use strict';

  /* ------------ HTTPS 강제 (2026-05-16) — _redirects 백업 ------------
   * Netlify "Force HTTPS" 토글이 새 UI에서 안 보여서 우회.
   * _redirects 룰이 1차, 이 JS가 2차 안전망 (localhost·netlify.app 미적용). */
  try {
    if (location.protocol === 'http:' && /(^|\.)tbfa\.co\.kr$/.test(location.hostname)) {
      location.replace('https://' + location.host + location.pathname + location.search + location.hash);
      return;
    }
  } catch (e) { /* 리다이렉트 실패 무시 */ }

  /* ------------ 0. 헬퍼 ------------ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------ 1. 파셜 자동 로더 ------------ */
  const PARTIALS = [
    { slot: '#header-slot', file: '/partials/header.html' },
    { slot: '#modals-slot', file: '/partials/modals.html' },
    { slot: '#footer-slot', file: '/partials/footer.html' }
  ];

  let partialsLoaded = false;

  async function loadPartial({ slot, file }) {
    const target = $(slot);
    if (!target) return;
    try {
      /* ★ 캐시 강제 무력화 — 헤더/푸터/모달 변경 시 즉시 반영 */
      const res = await fetch(file + (file.includes('?') ? '&' : '?') + 'cb=' + Date.now(),
                              { cache: 'no-store' });
      if (!res.ok) throw new Error(`${file} ${res.status}`);
      target.innerHTML = await res.text();
      /* ★ 핵심: innerHTML로 삽입된 <script> 태그는 브라우저 보안 정책상 실행 안 됨.
       * 새 script 요소를 만들어 다시 추가해야 inline script가 실행됨. */
      target.querySelectorAll('script').forEach(function(oldScript) {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(function(a){
          newScript.setAttribute(a.name, a.value);
        });
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });
    } catch (e) {
      console.error('[Partial Load Failed]', file, e);
    }
  }

  async function loadAllPartials() {
    await Promise.all(PARTIALS.map(loadPartial));
    partialsLoaded = true;
    document.dispatchEvent(new CustomEvent('partials:loaded'));
  }

  /* ------------ 2. 토스트 ------------ */
  let toastTimer;
  function toast(msg, ms = 2400) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ------------ 3. 모달 컨트롤 ------------ */
  function openModal(id, retries = 5) {
    const m = $('#' + id);
    if (m) {
      m.classList.add('show');
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        const firstInput = m.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) firstInput.focus();
      }, 100);
      return true;
    }
    if (retries > 0) {
      console.warn(`[Modal] #${id} not yet loaded, retrying... (${retries} left)`);
      setTimeout(() => openModal(id, retries - 1), 150);
    } else {
      console.error(`[Modal] #${id} not found after retries`);
      toast(`모달을 열 수 없습니다 (${id})`);
    }
    return false;
  }
  function closeModal(id) {
    const m = id ? $('#' + id) : $('.modal-bg.show');
    if (!m) return;
    m.classList.remove('show');
    document.body.style.overflow = '';
  }
  function switchModal(from, to) {
    closeModal(from);
    setTimeout(() => openModal(to), 200);
  }

  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-bg')) {
      e.target.classList.remove('show');
      document.body.style.overflow = '';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  /* ------------ 4. data-action 이벤트 위임 ------------ */
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;

    if (action === 'open-modal') {
      e.preventDefault();
      openModal(trigger.dataset.target);
    }
    else if (action === 'close-modal') {
      e.preventDefault();
      closeModal();
    }
    else if (action === 'switch-modal') {
      e.preventDefault();
      switchModal(trigger.dataset.from, trigger.dataset.to);
    }
    else if (action === 'mobile-menu') {
      e.preventDefault();
      const gnb = document.querySelector('nav.gnb, ul.gnb');
      if (gnb) {
        gnb.classList.toggle('mobile-open');
        trigger.classList.toggle('active');
        console.log('[Mobile Menu] toggled:', gnb.classList.contains('mobile-open'));
      } else {
        console.warn('[Mobile Menu] GNB element not found');
      }
    }
  });

  /* ------------ 5. GNB 활성 메뉴 자동 표시 ------------ */
  function activateGNB() {
    const page = document.body.dataset.page;
    if (!page) return;
    const li = document.querySelector(`nav.gnb li[data-page="${page}"], ul.gnb li[data-page="${page}"]`);
    if (li) li.classList.add('active');
  }

  /* ------------ 6. 메뉴 항목 클릭 시 모바일 메뉴 자동 닫기 ------------ */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('ul.gnb a, nav.gnb a');
    if (!link) return;
    const gnb = document.querySelector('nav.gnb, ul.gnb');
    if (gnb && gnb.classList.contains('mobile-open')) {
      const hasDropdown = link.parentElement?.querySelector('.dropdown');
      if (!hasDropdown) {
        gnb.classList.remove('mobile-open');
        const toggleBtn = document.querySelector('.mobile-toggle');
        if (toggleBtn) toggleBtn.classList.remove('active');
      }
    }
  });

  /* ------------ 7. 언어 토글 ------------ */
  const I18N = {
    KO: {
      heroTitle: '교사 유가족들의 <em>지원과 수사</em>,<br />모든 교사들의 <em>사회적 문제 해결</em>을 위해<br />싸이렌 홈페이지의 문을 열었습니다.',
      langSwitched: '한국어로 전환되었습니다'
    },
    EN: {
      heroTitle: 'Opening the door for <em>support &amp; investigation</em><br />for the bereaved families of teachers,<br />and for solving the <em>social issues</em> of all educators.',
      langSwitched: 'Switched to English'
    }
  };

  function setupLangToggle() {
    const btns = $$('.lang-toggle button[data-lang]');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        btns.forEach(b => b.classList.toggle('on', b === btn));
        const heroEl = $('#heroTitle');
        if (heroEl && I18N[lang]) heroEl.innerHTML = I18N[lang].heroTitle;
        toast(I18N[lang].langSwitched);
        localStorage.setItem('siren-lang', lang);
      });
    });
    const saved = localStorage.getItem('siren-lang');
    if (saved && saved !== 'KO') {
      const btn = btns.find(b => b.dataset.lang === saved);
      if (btn) btn.click();
    }
  }

  /* ------------ 8. 통합 검색 ------------ */
  function setupSearch() {
    const input = $('#globalSearch');
    const btn = $('#searchBtn');
    if (!input) return;
    const submit = () => {
      const q = input.value.trim();
      if (!q) return toast('검색어를 입력해 주세요');
      toast(`"${q}" 검색 결과 페이지로 이동합니다`);
    };
    if (btn) btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  /* ------------ 9. 관련 사이트 셀렉트 (DB 동적 로드) ------------ */
  async function setupRelatedSelect() {
    const sel = $('.related-select');
    if (!sel) return;

    /* DB에서 동적 로드 (실패 시 placeholder만 유지) */
    try {
      const res = await fetch('/api/public/related-sites', { credentials: 'omit' });
      if (res.ok) {
        const json = await res.json();
        const items = (json.data && json.data.items) || json.items || [];
        if (items.length > 0) {
          const escapeAttr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
          const opts = ['<option value="">관련 사이트 바로가기</option>']
            .concat(items.map((s) =>
              '<option value="' + escapeAttr(s.url) + '">' + escapeAttr(s.name) + '</option>'
            ));
          sel.innerHTML = opts.join('');
        }
      }
    } catch (err) {
      console.warn('[setupRelatedSelect] 로드 실패:', err);
    }

    sel.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      // value 우선, fallback으로 data-link (구 호환)
      const url = (opt && opt.value) || (opt && opt.dataset && opt.dataset.link) || '';
      if (url) {
        window.open(url, '_blank', 'noopener');
        sel.selectedIndex = 0;
      }
    });
  }

  /* =========================================================
     ★ Phase B Step 5-A — 헤더 메뉴 동적 렌더링
     - /api/public/nav-menus 호출 → DB 데이터로 <ul class="gnb"> 다시 그림
     - 실패 시 정적 HTML 폴백 그대로 유지
     - preview=1 일 때 Draft 데이터 우선
     ========================================================= */

  /* 응답 형태에 따라 메뉴 배열 추출 (트리/플랫 자동 인식) */
  function extractMenusFromResponse(json) {
    if (!json || !json.ok) return null;
    const candidates = [
      json.data?.menus,
      json.data?.header,
      json.data?.items,
      json.menus,
      json.data,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return null;
  }

  /* 플랫 배열 → 트리 구조 변환 (children 없으면 호출됨) */
  function buildMenuTree(flat) {
    const map = new Map();
    const roots = [];
    flat.forEach(item => {
      const copy = { ...item, children: [] };
      map.set(copy.id, copy);
    });
    flat.forEach(item => {
      const pid = item.parentId ?? item.parent_id ?? null;
      const node = map.get(item.id);
      if (pid && map.has(pid)) {
        map.get(pid).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  /* 1뎁스 메뉴 1개 HTML */
  function renderTopLevelMenu(parent) {
    const label = parent.label || '';
    const href = parent.href || '#';
    const pageKey = parent.pageKey ?? parent.page_key;
    const icon = parent.icon;
    const cssClass = parent.cssClass ?? parent.css_class;
    const opensModal = parent.opensModal ?? parent.opens_modal;
    const target = parent.target || '_self';
    const children = parent.children || [];

    const dataPageAttr = pageKey ? ` data-page="${escHtml(pageKey)}"` : '';
    const classAttr = cssClass ? ` class="${escHtml(cssClass)}"` : '';

    /* 링크 속성 */
    let linkAttrs;
    if (opensModal) {
      linkAttrs = `href="#" data-action="open-modal" data-target="${escHtml(opensModal)}"`;
    } else {
      const tgt = target === '_blank' ? ` target="_blank" rel="noopener"` : '';
      linkAttrs = `href="${escHtml(href)}"${tgt}`;
    }

    /* 아이콘 (사이렌 등) */
    const iconHtml = icon
      ? `<span class="siren-icon" aria-hidden="true">${escHtml(icon)}</span> `
      : '';

    /* 자식 드롭다운 */
    let dropdownHtml = '';
    if (children.length > 0) {
      const sortedChildren = [...children].sort(
        (a, b) => (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0)
      );
      const itemsHtml = sortedChildren.map(c => renderChildMenu(c)).join('');
      dropdownHtml = `<ul class="dropdown">${itemsHtml}</ul>`;
    }

    return `<li${dataPageAttr}${classAttr}><a ${linkAttrs}>${iconHtml}${escHtml(label)}</a>${dropdownHtml}</li>`;
  }

  /* 2뎁스 메뉴 1개 HTML */
  function renderChildMenu(child) {
    const cssClass = child.cssClass ?? child.css_class;

    /* 구분선 (label/href 없는 특수 행) */
    if (cssClass === 'dropdown-divider') {
      return `<li class="dropdown-divider"></li>`;
    }

    const label = child.label || '';
    const href = child.href || '#';
    const opensModal = child.opensModal ?? child.opens_modal;
    const target = child.target || '_self';

    let linkAttrs;
    if (opensModal) {
      linkAttrs = `href="#" data-action="open-modal" data-target="${escHtml(opensModal)}"`;
    } else {
      const tgt = target === '_blank' ? ` target="_blank" rel="noopener"` : '';
      linkAttrs = `href="${escHtml(href)}"${tgt}`;
    }

    return `<li><a ${linkAttrs}>${escHtml(label)}</a></li>`;
  }

  /* 메인 렌더 함수 — partials 로드 직후 호출됨 */
  async function renderHeaderMenu() {
    const ul = document.querySelector('ul.gnb, nav.gnb');
    if (!ul) {
      console.warn('[Header] .gnb element not found, skip');
      return;
    }

    try {
      const params = new URLSearchParams(location.search);
      const previewParam = params.get('preview') === '1' ? '?preview=1' : '';
      const navUrl = '/api/public/nav-menus' + previewParam;

      /* 캐시 확인 — 프리뷰 모드는 캐시 건너뜀 */
      let json;
      const cached = !previewParam && window.__sirenCache && window.__sirenCache.get(navUrl);
      if (cached) {
        json = cached;
      } else {
        const res = await fetch(navUrl, { credentials: 'include', cache: 'no-cache' });
        if (!res.ok) {
          console.warn('[Header] /api/public/nav-menus 응답 실패, 정적 폴백 사용:', res.status);
          return;
        }
        json = await res.json();
        if (!previewParam && window.__sirenCache) window.__sirenCache.set(navUrl, json);
      }

      let menus = extractMenusFromResponse(json);

      if (!menus) {
        console.warn('[Header] 메뉴 응답 형식 인식 실패, 정적 폴백', json);
        return;
      }

      /* header location만 (혹시 footer 등이 섞여 있으면 필터) */
      menus = menus.filter(m => {
        const loc = m.menuLocation ?? m.menu_location;
        return !loc || loc === 'header';
      });

      /* 트리 형식인지 자동 감지 */
      const isTree = menus.some(m => Array.isArray(m.children) && m.children.length > 0);
      if (!isTree) {
        /* 플랫이면 트리로 변환 */
        menus = buildMenuTree(menus);
      }

      /* 1뎁스만 (parent_id 없는 것) + sort_order 정렬 */
      const topLevels = menus
        .filter(m => !(m.parentId ?? m.parent_id))
        .sort((a, b) => (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0));

      if (topLevels.length === 0) {
        console.warn('[Header] 1뎁스 메뉴 0건, 정적 폴백 유지');
        return;
      }

      /* HTML 다시 그리기 */
      const html = topLevels.map(p => renderTopLevelMenu(p)).join('');
      ul.innerHTML = html;

      console.log(`[Header] 동적 렌더링 완료 — 1뎁스 ${topLevels.length}개`);
    } catch (e) {
      console.warn('[Header] 동적 렌더링 실패, 정적 폴백 사용', e);
    }
  }

  /* ------------ 10. 폼 기본 핸들러 ------------ */
  function setupCommonForms() {
    /* login/signup → auth.js, donate → donate.js */
  }

  /* ------------ 11. 부드러운 앵커 스크롤 ------------ */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  /* ------------ 12. 화면 리사이즈 시 모바일 메뉴 자동 닫기 ------------ */
  window.addEventListener('resize', () => {
    if (window.innerWidth > 920) {
      const gnb = document.querySelector('nav.gnb, ul.gnb');
      if (gnb && gnb.classList.contains('mobile-open')) {
        gnb.classList.remove('mobile-open');
        const toggleBtn = document.querySelector('.mobile-toggle');
        if (toggleBtn) toggleBtn.classList.remove('active');
      }
    }
  });

  /* ------------ 13-Phase B. 미리보기 모드 배너 ------------ */
  function setupPreviewBanner() {
    const params = new URLSearchParams(location.search);
    if (params.get('preview') !== '1') return;
    if (document.getElementById('sirenPreviewBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'sirenPreviewBanner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
      'background:linear-gradient(90deg,#fff8ec 0%,#fef5d8 50%,#fff8ec 100%)',
      'border-bottom:2px solid #c47a00', 'color:#7a5e00',
      'padding:9px 16px', 'font-size:12.5px', 'font-weight:600',
      'text-align:center', 'box-shadow:0 2px 8px rgba(0,0,0,0.08)',
      'font-family:-apple-system,"Noto Sans KR",sans-serif', 'line-height:1.5',
    ].join(';');
    banner.innerHTML =
      '<strong>Draft 미리보기 모드</strong> — 어드민에서 임시저장한 변경사항이 표시됩니다 ' +
      '<span style="opacity:0.7;font-weight:400">(일반 사용자에게는 보이지 않음)</span>';

    document.body.appendChild(banner);

    const currentPad = parseInt(getComputedStyle(document.body).paddingTop || '0', 10) || 0;
    document.body.style.paddingTop = (currentPad + 36) + 'px';

    console.log('[Phase B] 미리보기 모드 활성화');
  }

  /* ------------ 13.5 브랜드 설정 적용 (운영자가 사이트빌더에서 변경) ------------
   * 2026-06-03: 로고·파비콘·사이트이름·홈타이틀을 /api/public/brand 에서 읽어 적용.
   * 전적으로 fallback-safe — 미설정/조회실패 시 정적 기본값(코드 로고·파비콘·타이틀) 그대로 유지.
   * 헤더/푸터 DOM이 그려진 뒤 호출. */
  async function applyBrand() {
    try {
      const res = await fetch('/api/public/brand', { cache: 'no-store' });
      if (!res.ok) return;
      const b = await res.json().catch(function () { return null; });
      if (!b) return;

      /* 1) 로고 심볼 — 헤더/푸터 img 교체 */
      if (b.logoUrl) {
        document.querySelectorAll('.brand-img, .foot-brand img').forEach(function (img) { img.src = b.logoUrl; });
      }
      /* 2) 파비콘 — 기존 icon 링크 href 교체(없으면 생성) */
      if (b.faviconUrl) {
        var icons = document.querySelectorAll("link[rel~='icon']");
        if (icons.length === 0) {
          var l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); icons = [l];
        }
        icons.forEach(function (l) { l.href = b.faviconUrl; });
      }
      /* 3) 사이트 이름 — 헤더/푸터에 표시된 단체명 텍스트만 교체(아이콘·small 보존) */
      if (b.siteName) {
        var bt = document.querySelector('.brand-text');
        if (bt && bt.firstChild && bt.firstChild.nodeType === 3) bt.firstChild.textContent = b.siteName;
        var fb = document.querySelector('.foot-brand');
        if (fb) {
          for (var i = 0; i < fb.childNodes.length; i++) {
            var n = fb.childNodes[i];
            if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = b.siteName; break; }
          }
        }
      }
      /* 4) 홈 타이틀 — 홈 페이지에서만 탭 제목 교체(타 페이지 SEO 제목 보존) */
      if (b.homeTitle) {
        var p = location.pathname;
        if (p === '/' || p === '/index.html' || /\/index\.html$/.test(p)) document.title = b.homeTitle;
      }
    } catch (_) { /* 무시 — 정적 기본값 유지 */ }
  }

  /* ★ 2026-07-07 푸터를 DB 설정값(site_settings scope=footer)으로 렌더.
     preview=1이면 임시발행(draft) 우선 → 편집기 저장·발행이 실제 푸터에 반영.
     값이 없으면 정적 기본값 유지(폴백 안전·비차단). */
  async function renderFooter() {
    var footer = document.querySelector('footer');
    if (!footer) return;
    try {
      var params = new URLSearchParams(location.search);
      var previewParam = params.get('preview') === '1' ? '?preview=1' : '';
      var res = await fetch('/api/public/footer-content' + previewParam, {
        credentials: 'include', cache: previewParam ? 'no-store' : 'no-cache',
      });
      if (!res.ok) return;
      var json = await res.json();
      var f = (json && json.data && json.data.footer) || (json && json.footer) || {};

      /* 회사정보 텍스트 — 값이 있을 때만 덮어씀 */
      footer.querySelectorAll('[data-footer]').forEach(function (el) {
        var v = f[el.getAttribute('data-footer')];
        if (v != null && String(v).trim() !== '') el.textContent = String(v);
      });
      /* SNS 링크 — 실제 URL이 설정된 경우만 링크 연결(미설정 '#'는 정적 유지) */
      footer.querySelectorAll('[data-footer-sns]').forEach(function (a) {
        var v = f['sns.' + a.getAttribute('data-footer-sns')];
        if (v && String(v).trim() !== '' && String(v) !== '#') {
          a.href = String(v); a.target = '_blank'; a.rel = 'noopener noreferrer';
        }
      });
    } catch (e) {
      console.warn('[Footer] 렌더 실패(정적 폴백):', e);
    }
  }

  /* ------------ 14. 초기화 ------------ */
  async function init() {
    await loadAllPartials();
    /* ★ Phase B Step 5-A — partials 로드 직후 헤더를 DB 데이터로 다시 그림 */
    await renderHeaderMenu();
    renderFooter();   /* ★ 2026-07-07 푸터 DB 설정 렌더(비차단) */
    activateGNB();
    setupLangToggle();
    setupSearch();
    setupRelatedSelect();
    setupCommonForms();
    setupPreviewBanner();
    applyBrand();   /* ★ 2026-06-03 브랜드 설정 적용 (fallback-safe·비차단) */
    if (typeof window.SIREN_PAGE_INIT === 'function') {
      window.SIREN_PAGE_INIT();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ------------ 15. 전역 노출 ------------ */
  window.SIREN = {
    $, $$, toast,
    openModal, closeModal, switchModal,
    isPartialsLoaded: () => partialsLoaded,
    /* ★ 외부에서 헤더 강제 새로고침 가능 (어드민 미리보기에서 활용) */
    reloadHeader: renderHeaderMenu,
    reloadFooter: renderFooter,
  };

})();

/* =========================================================
   ★ K-9: 401 자동 세션 만료 처리 (변경 없음)
   ========================================================= */
(function () {
  'use strict';

  if (window.__SIREN_401_INSTALLED__) return;
  window.__SIREN_401_INSTALLED__ = true;

  const ORIGINAL_FETCH = window.fetch.bind(window);
  let _last401HandledAt = 0;
  const COOLDOWN_MS = 3000;

  const EXCLUDED_PATHS = [
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/password-reset-request',
    '/api/auth/password-reset',
    '/api/auth/email-verify',
    '/api/admin/login',
    '/api/auth/me',
    /* ★ 2026-05-16: 헤더 '관리자 모드' 버튼 표시 판단용 호출(/api/admin/me·
       /api/admin/me?light=1)이 비로그인 메인 페이지에서 정상 401 응답인데,
       isExcluded 미통과로 handle401이 모달을 강제로 열어 모든 사용자에게
       세션 만료 모달이 뜨던 결함. 어드민 페이지 자체는 진입 시 별도 redirect
       흐름이 있어 모달 안 떠도 안전. ai-agent-widget.js의 권한 체크 호출도
       동일하게 보호됨. */
    '/api/admin/me',
    /* ★ 2026-05-16: mypage-out-of-office.js가 마이페이지 진입 시 /api/admin-user-preferences
       호출(부재 일정 카드 렌더 — 어드민·운영자 전용 기능). 일반 회원은 정상 401 응답인데
       EXCLUDED 미통과 → 모달 트리거. 클라이언트 측은 catch로 카드 숨김 처리하지만
       fetch wrap의 handle401이 먼저 발사돼서 모달 강제 표시. */
    '/api/admin-user-preferences',
  ];

  function isExcluded(url) {
    try {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      return EXCLUDED_PATHS.some((p) => u.indexOf(p) >= 0);
    } catch (e) {
      return false;
    }
  }

  function isApiCall(url) {
    try {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      return u.indexOf('/api/') >= 0;
    } catch (e) {
      return false;
    }
  }

  function isAdminPage() {
    return location.pathname === '/admin.html' ||
      location.pathname.indexOf('/admin') === 0 ||
      document.body && document.body.dataset && document.body.dataset.page === 'admin';
  }

  function safeToast(msg) {
    try {
      if (window.SIREN && typeof window.SIREN.toast === 'function') {
        window.SIREN.toast(msg);
      } else {
        console.warn('[401]', msg);
      }
    } catch (e) {
      console.warn('[401] toast 실패:', e, msg);
    }
  }

  function handle401(url) {
    const now = Date.now();
    if (now - _last401HandledAt < COOLDOWN_MS) return;
    _last401HandledAt = now;

    try {
      if (window.SIREN_AUTH) {
        window.SIREN_AUTH.user = null;
        window.SIREN_AUTH.stats = null;
      }
    } catch (e) {}

    if (isAdminPage()) {
      safeToast('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.');
      setTimeout(function () {
        location.href = '/admin.html';
      }, 1200);
    } else {
      safeToast('세션이 만료되었습니다. 다시 로그인해 주세요.');
      const isProtected = location.pathname === '/mypage.html';

      setTimeout(function () {
        if (isProtected) {
          location.href = '/index.html';
          return;
        }
        try {
          if (window.SIREN && typeof window.SIREN.openModal === 'function') {
            window.SIREN.openModal('loginModal');
          }
        } catch (e) {
          console.warn('[401] 모달 오픈 실패:', e);
        }
      }, 800);
    }
  }

  window.fetch = async function (resource, init) {
    let response;
    try {
      response = await ORIGINAL_FETCH(resource, init);
    } catch (err) {
      throw err;
    }

    if (response && response.status === 401 && isApiCall(resource) && !isExcluded(resource)) {
      handle401(resource);
    }

    return response;
  };

  console.log('[K-9] 401 자동 처리 핸들러 활성화');
})();

/* ============================================================
   ★ SIREN 클라이언트 캐시 레이어
   - GET 요청 결과를 메모리에 TTL 기반으로 저장
   - 자주 바뀌지 않는 데이터(메뉴·설정·통계) 재요청 방지
   - window.__sirenCache.get(url) / .set(url, data, ttlMs) / .clear()
   ============================================================ */
(function () {
  var _store = new Map();

  /* TTL(ms) 기본값 — 엔드포인트 패턴별 */
  var TTL_MAP = [
    { pattern: /public-nav-menus/,        ttl: 5 * 60 * 1000  }, /* 5분  */
    { pattern: /public-home-stats/,        ttl: 3 * 60 * 1000  }, /* 3분  */
    { pattern: /admin-dashboard-summary/,  ttl: 2 * 60 * 1000  }, /* 2분  */
    { pattern: /admin-members-list/,       ttl: 60 * 1000       }, /* 1분  */
    { pattern: /admin-send-jobs-list/,     ttl: 60 * 1000       }, /* 1분  */
    { pattern: /content-pages/,            ttl: 10 * 60 * 1000 }, /* 10분 */
    { pattern: /public-related-sites/,     ttl: 10 * 60 * 1000 }, /* 10분 */
  ];
  var DEFAULT_TTL = 30 * 1000; /* 기본 30초 */

  function getTtl(url) {
    for (var i = 0; i < TTL_MAP.length; i++) {
      if (TTL_MAP[i].pattern.test(url)) return TTL_MAP[i].ttl;
    }
    return DEFAULT_TTL;
  }

  window.__sirenCache = {
    get: function (url) {
      var entry = _store.get(url);
      if (!entry) return null;
      if (Date.now() > entry.exp) { _store.delete(url); return null; }
      return entry.data;
    },
    set: function (url, data, ttlMs) {
      _store.set(url, { data: data, exp: Date.now() + (ttlMs || getTtl(url)) });
    },
    clear: function (pattern) {
      if (!pattern) { _store.clear(); return; }
      _store.forEach(function (_, key) {
        if (pattern.test(key)) _store.delete(key);
      });
    },
    /* POST 등 데이터 변경 시 관련 캐시 무효화 */
    invalidate: function (urlPattern) {
      var re = typeof urlPattern === 'string' ? new RegExp(urlPattern) : urlPattern;
      _store.forEach(function (_, key) { if (re.test(key)) _store.delete(key); });
    },
    getTtl: getTtl,
  };
})();