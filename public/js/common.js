/* =========================================================
   SIREN — common.js
   교사유가족협의회 공통 스크립트 (전 페이지 로드)
   ========================================================= */
(function () {
  'use strict';

  /* ------------ 0. 헬퍼 ------------ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------ 1. 파셜 자동 로더 ------------ */
  /* <div id="header-slot"></div> 등의 자리에 partials/*.html을 fetch해 삽입 */
  const PARTIALS = [
    { slot: '#header-slot', file: '/partials/header.html' },
    { slot: '#modals-slot', file: '/partials/modals.html' },
    { slot: '#footer-slot', file: '/partials/footer.html' }
  ];

  async function loadPartial({ slot, file }) {
    const target = $(slot);
    if (!target) return;
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${file} ${res.status}`);
      target.innerHTML = await res.text();
    } catch (e) {
      console.error('[Partial Load Failed]', file, e);
    }
  }

  async function loadAllPartials() {
    await Promise.all(PARTIALS.map(loadPartial));
  }

  /* ------------ 2. 토스트 ------------ */
  let toastTimer;
  function toast(msg, ms = 2400) {
    const t = $('#toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ------------ 3. 모달 컨트롤 ------------ */
  function openModal(id) {
    const m = $('#' + id);
    if (!m) return;
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
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

  // 모달 외부 클릭 시 닫기 + ESC 닫기
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
  });

  /* ------------ 5. GNB 활성 메뉴 자동 표시 ------------ */
  /* <body data-page="about"> 와 <li data-page="about"> 매칭 */
  function activateGNB() {
    const page = document.body.dataset.page;
    if (!page) return;
    const li = document.querySelector(`nav.gnb li[data-page="${page}"]`);
    if (li) li.classList.add('active');
  }

  /* ------------ 6. 언어 토글 (KO/EN) ------------ */
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

    // 저장된 언어 복원
    const saved = localStorage.getItem('siren-lang');
    if (saved && saved !== 'KO') {
      const btn = btns.find(b => b.dataset.lang === saved);
      if (btn) btn.click();
    }
  }

  /* ------------ 7. 통합 검색 ------------ */
  function setupSearch() {
    const input = $('#globalSearch');
    const btn = $('#searchBtn');
    if (!input) return;

    const submit = () => {
      const q = input.value.trim();
      if (!q) return toast('검색어를 입력해 주세요');
      // 실제 환경: window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
      toast(`"${q}" 검색 결과 페이지로 이동합니다`);
    };
    if (btn) btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  /* ------------ 8. 관련 사이트 셀렉트 ------------ */
  function setupRelatedSelect() {
    const sel = $('.related-select');
    if (!sel) return;
    sel.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      const link = opt && opt.dataset.link;
      if (link) {
        window.open(link, '_blank', 'noopener');
        sel.selectedIndex = 0;
      }
    });
  }

  /* ------------ 9. 폼 기본 핸들러 (로그인/회원가입) ------------ */
  function setupCommonForms() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const type = form.dataset.form;
      if (!type) return;

      // donate 폼은 donate.js에서 별도 처리하므로 제외
      if (type === 'donate') return;

      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());

      if (type === 'login') {
        // 실제 환경: await fetch('/api/login', ...)
        toast('로그인되었습니다. 환영합니다 :)');
        closeModal('loginModal');
      }
      else if (type === 'signup') {
        // 실제 환경: await fetch('/api/signup', ...)
        toast('가입이 완료되었습니다. 환영합니다 :)');
        closeModal('signupModal');
      }
    });
  }

  /* ------------ 10. 부드러운 앵커 스크롤 ------------ */
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

  /* ------------ 11. 초기화 ------------ */
  async function init() {
    await loadAllPartials();   // 파셜 먼저 로드
    activateGNB();             // 그 다음 GNB 활성화
    setupLangToggle();
    setupSearch();
    setupRelatedSelect();
    setupCommonForms();

    // 페이지별 초기화 훅: window.SIREN_PAGE_INIT 가 정의돼 있으면 호출
    if (typeof window.SIREN_PAGE_INIT === 'function') {
      window.SIREN_PAGE_INIT();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ------------ 12. 전역 노출 (다른 스크립트에서 사용) ------------ */
  window.SIREN = {
    $, $$,
    toast,
    openModal, closeModal, switchModal
  };
})();