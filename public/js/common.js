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

  /* ------------ 0. 깜빡임 방지 장치 (2026-08-03) ------------
     증상: 화면이 뜨면 **옛 메뉴가 먼저 보였다가** 잠시 뒤 수정한 메뉴로 바뀌었다.
     원인 세 가지를 모두 없앤다.
       ① 파일에 박혀 있던 옛 내용이 먼저 그려진다
          → 조회가 끝날 때까지 감춰 두고, 조회에 실패했을 때만 안전망으로 드러낸다.
       ② 머리말 조각을 다 받은 뒤에야 메뉴 조회를 시작한다(순서대로 기다림)
          → 둘을 동시에 시작한다.
       ③ 페이지를 옮길 때마다 처음부터 다시 받는다
          → 마지막에 받은 값을 브라우저에 저장해 두고 즉시 그린 뒤, 뒤에서 최신값을 확인한다.
     결과: 두 번째 방문부터는 기다림이 사실상 없고, 첫 방문에도 틀린 내용이 보이지 않는다. */

  const IS_PREVIEW = new URLSearchParams(location.search).get('preview') === '1';

  /* 저장해 둔 값 읽기/쓰기 — 저장 공간이 막혀 있어도 그냥 넘어간다(비공개 모드 등) */
  function storeGet(key) {
    if (IS_PREVIEW) return null;   // 미리보기는 항상 최신값만
    try {
      const raw = localStorage.getItem('siren:v1:' + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && o.d) || null;
    } catch (_) { return null; }
  }
  function storeSet(key, data) {
    if (IS_PREVIEW) return;
    try {
      localStorage.setItem('siren:v1:' + key, JSON.stringify({ t: Date.now(), d: data }));
    } catch (_) { /* 저장 공간 가득참 등 — 무시 */ }
  }

  /* 조회가 끝나기 전까지 옛 내용을 감춘다.
     자리는 그대로 두고 내용만 감추므로 화면이 위아래로 흔들리지 않는다. */
  (function injectPendingStyle() {
    const st = document.createElement('style');
    st.setAttribute('data-siren-pending', '');
    st.textContent =
      '.gnb[data-gnb-pending] > li{visibility:hidden}' +
      '[data-home-pending]{visibility:hidden}';
    (document.head || document.documentElement).appendChild(st);
  })();

  /* ★ 2026-08-20: 서버가 페이지에 미리 담아 보낸 값이 있으면 왕복 없이 그대로 쓴다.
     예전에는 화면이 열릴 때마다 같은 값을 7~10번 다시 물어봐서 첫 화면이 느렸다.
     한 번 쓰고 지운다 — 이후 갱신은 실제 조회로 최신값을 받는다. */
  function takePreloaded(url) {
    const pre = window.__SIREN_PRELOAD__;
    if (!pre) return undefined;
    if (!Object.prototype.hasOwnProperty.call(pre, url)) return undefined;
    const value = pre[url];
    delete pre[url];
    return value;
  }

  async function fetchJson(url) {
    const pre = takePreloaded(url);
    if (pre !== undefined && pre !== null) return pre;
    try {
      const res = await fetch(url, { credentials: 'include', cache: IS_PREVIEW ? 'no-store' : 'no-cache' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[SIREN] 조회 실패', url, e);
      return null;
    }
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
    /* ★ 2026-08-20: 서버가 이미 채워 보냈으면 다시 받아오지 않는다.
       (같은 내용을 한 번 더 받아 덮어쓰면 첫 화면이 느려지고 깜빡인다) */
    if (target.innerHTML.trim() !== '') return;
    try {
      /* 캐시 강제 무력화 — 헤더/푸터/모달 변경 시 즉시 반영 */
      const res = await fetch(file + (file.includes('?') ? '&' : '?') + 'cb=' + Date.now(),
                              { cache: 'no-store' });
      if (!res.ok) throw new Error(`${file} ${res.status}`);
      target.innerHTML = await res.text();
      /* 핵심: innerHTML로 삽입된 <script> 태그는 브라우저 보안 정책상 실행 안 됨.
       * 새 script 요소를 만들어 다시 추가해야 inline script가 실행됨. */
      target.querySelectorAll('script').forEach(function(oldScript) {
        const newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(function(a){
          newScript.setAttribute(a.name, a.value);
        });
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });

      /* ★ 2026-08-21: 붙여 넣은 조각 안의 아이콘 자리를 채운다.
         예전에는 조각 파일마다 아이콘 모음(47KB)을 다시 불러서 그 김에 채워졌는데,
         그 방식이 화면 중간에서 그리기를 세 번이나 막아(구글 측정 '렌더링 차단 750ms')
         조각에서 스크립트를 걷어냈다. 대신 여기서 직접 채운다. */
      if (window.Icons && typeof Icons.hydrate === 'function') {
        try { Icons.hydrate(target); } catch (err) { console.warn('[아이콘 채우기]', err); }
      }
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

    /* DB에서 동적 로드 (실패 시 placeholder만 유지)
       ★ 2026-08-20: 서버가 미리 담아 보낸 값이 있으면 그것부터 쓴다(왕복 제거) */
    try {
      const json = await fetchJson('/api/public/related-sites');
      if (json) {
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
     Phase B Step 5-A — 헤더 메뉴 동적 렌더링
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

  /* [메인] nav 아이콘 SVG화 — DB icon 필드(이모지 or 아이콘이름)를 SVG로. 미등록·미로드 시 '' (원문 이모지 노출 방지) */
  function navIcon(value) {
    if (!value || !window.Icons || !Icons.svg) return '';
    var name = (Icons.forEmoji && Icons.forEmoji(value)) || value;
    if (!Icons._paths || !Icons._paths[name]) return '';
    return Icons.svg(name) + ' ';
  }
  /* [메인] DB label 선두에 박힌 이모지를 SVG로 분리 (예: "[이모지] 자료실" → 아이콘 + "자료실") */
  function navLabel(label) {
    var s = String(label || '');
    var sp = s.indexOf(' ');
    if (sp > 0 && window.Icons && Icons.forEmoji) {
      var name = Icons.forEmoji(s.slice(0, sp));
      if (name && Icons._paths && Icons._paths[name]) {
        return Icons.svg(name) + ' ' + escHtml(s.slice(sp + 1));
      }
    }
    return escHtml(s);
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

    /* 아이콘 (사이렌 등) — [메인] 이모지→SVG */
    const iconHtml = navIcon(icon);

    /* 자식 드롭다운 */
    let dropdownHtml = '';
    if (children.length > 0) {
      const sortedChildren = [...children].sort(
        (a, b) => (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0)
      );
      const itemsHtml = sortedChildren.map(c => renderChildMenu(c)).join('');
      if (itemsHtml) dropdownHtml = `<ul class="dropdown">${itemsHtml}</ul>`;
    }

    /* 갈 곳도 없고 펼칠 하위도 없으면 내보내지 않는다 (죽은 메뉴 방지 — 서버 규칙과 동일) */
    if (!dropdownHtml && hasNoDestination(parent)) return '';

    return `<li${dataPageAttr}${classAttr}><a ${linkAttrs}>${iconHtml}${navLabel(label)}</a>${dropdownHtml}</li>`;
  }

  /* 갈 곳이 정해지지 않은 메뉴인지 — 눌러도 제자리인 항목
     ★ 2026-08-21: lib/shell-html.ts 의 같은 이름 함수와 규칙을 맞춘다.
     구글 광고그랜트 정책이 "빈 페이지로 연결되는 링크"를 거부 사유로 명시. */
  function hasNoDestination(item) {
    if (item.opensModal ?? item.opens_modal) return false;
    const href = String(item.href || '').trim();
    return href === '' || href === '#';
  }

  /* 2뎁스 메뉴 1개 HTML */
  function renderChildMenu(child) {
    const cssClass = child.cssClass ?? child.css_class;

    /* 구분선 (label/href 없는 특수 행) */
    if (cssClass === 'dropdown-divider') {
      return `<li class="dropdown-divider"></li>`;
    }

    /* 갈 곳이 없는 하위 메뉴는 내보내지 않는다 (죽은 메뉴 방지) */
    if (hasNoDestination(child)) return '';

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

    return `<li><a ${linkAttrs}>${navLabel(label)}</a></li>`;
  }

  /* 메인 렌더 함수 — partials 로드 직후 호출됨 */
  const NAV_URL = '/api/public/nav-menus' + (IS_PREVIEW ? '?preview=1' : '');
  const NAV_STORE_KEY = 'nav-menus';

  /** 감춰 둔 메뉴를 드러낸다. 어떤 경로로 끝나든 반드시 불러야 한다(안 부르면 메뉴가 영영 안 보임). */
  function revealGnb() {
    document.querySelectorAll('.gnb[data-gnb-pending]').forEach(el => el.removeAttribute('data-gnb-pending'));
  }

  /** 받아온 메뉴로 화면을 그린다. 그렸으면 true, 못 그렸으면 false(=옛 내용 유지). */
  function paintHeaderMenu(json) {
    const ul = document.querySelector('ul.gnb, nav.gnb');
    if (!ul || !json) return false;

    let menus = extractMenusFromResponse(json);
    if (!menus) {
      console.warn('[Header] 메뉴 응답 형식 인식 실패', json);
      return false;
    }

    /* header 위치만 (혹시 footer 등이 섞여 있으면 걸러냄) */
    menus = menus.filter(m => {
      const loc = m.menuLocation ?? m.menu_location;
      return !loc || loc === 'header';
    });

    /* 트리 형식인지 자동 감지 — 아니면 트리로 변환 */
    const isTree = menus.some(m => Array.isArray(m.children) && m.children.length > 0);
    if (!isTree) menus = buildMenuTree(menus);

    const topLevels = menus
      .filter(m => !(m.parentId ?? m.parent_id))
      .sort((a, b) => (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0));

    if (topLevels.length === 0) {
      console.warn('[Header] 1뎁스 메뉴 0건, 기존 내용 유지');
      return false;
    }

    ul.innerHTML = topLevels.map(p => renderTopLevelMenu(p)).join('');
    revealGnb();
    return true;
  }

  /** 메뉴 데이터를 받아온다 (화면은 건드리지 않음) */
  function fetchNavJson() {
    if (!IS_PREVIEW && window.__sirenCache) {
      const hit = window.__sirenCache.get(NAV_URL);
      if (hit) return Promise.resolve(hit);
    }
    return fetchJson(NAV_URL).then(json => {
      if (json && !IS_PREVIEW) {
        if (window.__sirenCache) window.__sirenCache.set(NAV_URL, json);
        storeSet(NAV_STORE_KEY, json);
      }
      return json;
    });
  }

  /** 기존 호출부(어드민 미리보기의 강제 새로고침 등) 호환용 */
  async function renderHeaderMenu() {
    const json = await fetchNavJson();
    const painted = paintHeaderMenu(json);
    revealGnb();   /* 실패해도 옛 내용을 드러내야 메뉴가 사라지지 않는다 */
    return painted;
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
  const BRAND_STORE_KEY = 'brand';

  /** 화면에 보이는 크기로 줄여서 받는 주소를 만든다.
   *  우리 서버 안의 이미지만 대상으로 한다(바깥 주소는 손대지 않는다).
   *  변환이 안 되는 환경이면 원래 주소가 그대로 쓰이므로 로고가 사라질 일은 없다. */
  function sizedImage(url, width) {
    try {
      var u = String(url || '');
      if (!u || u.indexOf('data:') === 0) return u;
      if (/^https?:\/\//i.test(u) && u.indexOf(location.host) === -1) return u;  /* 바깥 주소 */
      if (u.indexOf('/.netlify/images') === 0) return u;                          /* 이미 처리됨 */
      return '/.netlify/images?url=' + encodeURIComponent(u) +
             '&w=' + (width || 96) + '&fm=webp&q=82';
    } catch (e) { return url; }
  }

  /** 받아온 값으로 로고·협회명·파비콘을 반영 (몇 번 불려도 결과가 같아야 함) */
  function paintBrand(b) {
    try {
      if (!b) return;

      /* 1) 로고 심볼 — 헤더/푸터 img 교체
         ★ 2026-08-21: 운영자가 올린 원본이 1080×1080·540KB인데 화면에는 42px로만 보인다.
         느린 휴대폰 회선에서 이 한 장이 화면 전체를 늦춘다(구글 측정: 절감 가능 539KB).
         화면에 필요한 크기로 줄여서 받는다 — 원본은 그대로 두므로 운영자는 신경 쓸 게 없다. */
      if (b.logoUrl) {
        document.querySelectorAll('.brand-img, .foot-brand img').forEach(function (img) {
          var small = sizedImage(b.logoUrl, 96);
          if (small === b.logoUrl) { img.src = b.logoUrl; return; }
          /* ★ 안전망: 줄이기가 처음 한 번은 실패할 수 있다(원본을 만드는 쪽이 깨어나는 데
             시간이 걸려 변환기가 기다리다 끊는다). 그때는 원본을 그대로 쓴다 —
             느릴 뿐 로고가 사라지지는 않는다. */
          img.onerror = function () { this.onerror = null; this.src = b.logoUrl; };
          img.src = small;
        });
      }
      /* 2) 파비콘 — 기존 icon 링크 href 교체(없으면 생성) */
      if (b.faviconUrl) {
        var icons = document.querySelectorAll("link[rel~='icon']");
        if (icons.length === 0) {
          var l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); icons = [l];
        }
        /* ★ 2026-08-21: 파비콘 원본도 150KB였다. 탭에는 32px로만 보인다.
           투명 배경을 살려야 하므로 png 그대로 두고 크기만 줄인다. */
        var favi = sizedImage(b.faviconUrl, 64).replace('&fm=webp&q=82', '&fm=png');
        icons.forEach(function (l) { l.href = favi; });
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
    } catch (_) { /* 무시 — 기본값 유지 */ }
  }

  /** 로고·협회명 값을 받아온다 (화면은 건드리지 않음) */
  function fetchBrandJson() {
    /* ★ 2026-08-20: 서버가 미리 담아 보낸 값이 있으면 왕복 없이 그대로 쓴다 */
    var pre = takePreloaded('/api/public/brand');
    if (pre !== undefined && pre !== null) {
      if (!IS_PREVIEW) storeSet(BRAND_STORE_KEY, pre);
      return Promise.resolve(pre);
    }
    return fetch('/api/public/brand', { cache: IS_PREVIEW ? 'no-store' : 'no-cache' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (b) { if (b && !IS_PREVIEW) storeSet(BRAND_STORE_KEY, b); return b; })
      .catch(function () { return null; });
  }

  async function applyBrand() {
    paintBrand(await fetchBrandJson());
  }

  /* 2026-07-07 푸터를 DB 설정값(site_settings scope=footer)으로 렌더.
     preview=1이면 임시발행(draft) 우선 → 편집기 저장·발행이 실제 푸터에 반영.
     값이 없으면 정적 기본값 유지(폴백 안전·비차단). */
  const FOOTER_URL = '/api/public/footer-content' + (IS_PREVIEW ? '?preview=1' : '');
  const FOOTER_STORE_KEY = 'footer-content';

  /** 받아온 값으로 꼬리말을 채운다. 값이 있는 항목만 덮어쓴다(빈 값으로 지우지 않음). */
  function paintFooter(json) {
    var footer = document.querySelector('footer');
    if (!footer || !json) return false;
    var f = (json && json.data && json.data.footer) || (json && json.footer) || {};

    footer.querySelectorAll('[data-footer]').forEach(function (el) {
      var v = f[el.getAttribute('data-footer')];
      if (v != null && String(v).trim() !== '') el.textContent = String(v);
    });
    /* SNS 링크 — 실제 주소가 있을 때만 연결(미설정 '#'는 그대로) */
    footer.querySelectorAll('[data-footer-sns]').forEach(function (a) {
      var v = f['sns.' + a.getAttribute('data-footer-sns')];
      if (v && String(v).trim() !== '' && String(v) !== '#') {
        a.href = String(v); a.target = '_blank'; a.rel = 'noopener noreferrer';
      }
    });
    return true;
  }

  function fetchFooterJson() {
    return fetchJson(FOOTER_URL).then(function (json) {
      if (json && !IS_PREVIEW) storeSet(FOOTER_STORE_KEY, json);
      return json;
    });
  }

  async function renderFooter() {
    paintFooter(await fetchFooterJson());
  }

  /* ------------ 14. 초기화 ------------ */
  async function init() {
    /* ① 머리말 조각을 받는 동안 메뉴·꼬리말 조회를 **동시에** 시작한다.
          예전에는 조각을 다 받은 뒤에야 조회를 시작해 기다리는 시간이 두 배였다. */
    const navPromise = fetchNavJson();
    const footerPromise = fetchFooterJson();
    const brandPromise = fetchBrandJson();   /* 로고·협회명도 함께 시작 */

    await loadAllPartials();

    /* ② 저장해 둔 값이 있으면 **바로** 그린다 — 조회를 기다리지 않는다.
          두 번째 방문부터는 이 시점에 이미 최신 모습이 완성된다. */
    let painted = false;
    const cachedNav = storeGet(NAV_STORE_KEY);
    if (cachedNav) painted = paintHeaderMenu(cachedNav);
    const cachedFooter = storeGet(FOOTER_STORE_KEY);
    if (cachedFooter) paintFooter(cachedFooter);
    /* 로고·협회명은 조각이 들어온 직후 바로 반영해야 한 박자 늦게 바뀌지 않는다 */
    const cachedBrand = storeGet(BRAND_STORE_KEY);
    if (cachedBrand) paintBrand(cachedBrand);
    if (painted) activateGNB();

    /* ③ 조회가 끝나면 최신값으로 맞춘다(달라진 게 없으면 화면 변화도 없다). */
    navPromise.then(json => {
      const ok = paintHeaderMenu(json);
      revealGnb();               /* 실패해도 감춘 것을 반드시 드러낸다 */
      if (ok || !painted) activateGNB();
    });
    footerPromise.then(paintFooter);
    brandPromise.then(paintBrand);

    /* 조회가 지나치게 늦거나 막혀도 메뉴가 영영 안 보이는 일이 없도록 한 번 더 안전망 */
    setTimeout(revealGnb, 3000);

    setupLangToggle();
    setupSearch();
    setupRelatedSelect();
    setupCommonForms();
    setupPreviewBanner();
    /* 로고·협회명은 위에서 이미 시작·반영했다 (예전엔 여기서 시작해 한 박자 늦게 바뀌었음) */
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
  /**
   * 깜빡임 없이 데이터를 화면에 반영한다.
   * 저장해 둔 값이 있으면 **먼저 그려서** 기다림을 없애고, 조회가 끝나면 최신값으로 맞춘다.
   * 같은 그리기 함수를 두 번 부르므로, 그리기 함수는 몇 번 불려도 결과가 같아야 한다.
   *
   * @param {string} key     저장 이름 (페이지·데이터 종류별로 고유하게)
   * @param {string} url     조회 주소
   * @param {Function} apply 받은 값으로 화면을 그리는 함수 apply(json)
   */
  function loadWithCache(key, url, apply) {
    const cached = storeGet(key);
    if (cached) { try { apply(cached); } catch (e) { console.warn('[SIREN] 저장값 적용 실패', key, e); } }
    return fetchJson(url).then(json => {
      if (!json) return null;
      try { apply(json); } catch (e) { console.warn('[SIREN] 최신값 적용 실패', key, e); }
      storeSet(key, json);
      return json;
    });
  }

  window.SIREN = {
    $, $$, toast,
    openModal, closeModal, switchModal,
    isPartialsLoaded: () => partialsLoaded,
    /* 외부에서 헤더 강제 새로고침 가능 (어드민 미리보기에서 활용) */
    reloadHeader: renderHeaderMenu,
    reloadFooter: renderFooter,
    /* 깜빡임 방지 — 다른 화면 스크립트도 같은 방식을 쓰도록 공개 */
    loadWithCache,
    cache: { get: storeGet, set: storeSet },
    isPreview: IS_PREVIEW,
  };

})();

/* =========================================================
   K-9: 401 자동 세션 만료 처리 (변경 없음)
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
    /* 2026-05-16: 헤더 '관리자 모드' 버튼 표시 판단용 호출(/api/admin/me·
       /api/admin/me?light=1)이 비로그인 메인 페이지에서 정상 401 응답인데,
       isExcluded 미통과로 handle401이 모달을 강제로 열어 모든 사용자에게
       세션 만료 모달이 뜨던 결함. 어드민 페이지 자체는 진입 시 별도 redirect
       흐름이 있어 모달 안 떠도 안전. ai-agent-widget.js의 권한 체크 호출도
       동일하게 보호됨. */
    '/api/admin/me',
    /* 2026-05-16: mypage-out-of-office.js가 마이페이지 진입 시 /api/admin-user-preferences
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
   SIREN 클라이언트 캐시 레이어
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