/* =========================================================
   SIREN — common.js  (v3 — 모바일 햄버거 수정)
   ========================================================= */
(function () {
  'use strict';

  /* ------------ 0. 헬퍼 ------------ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${file} ${res.status}`);
      target.innerHTML = await res.text();
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
      /* ★ 핵심 수정: nav.gnb 또는 ul.gnb 둘 다 찾기 */
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
    /* ★ 수정: nav.gnb 또는 ul.gnb */
    const li = document.querySelector(`nav.gnb li[data-page="${page}"], ul.gnb li[data-page="${page}"]`);
    if (li) li.classList.add('active');
  }

  /* ------------ 6. 메뉴 항목 클릭 시 모바일 메뉴 자동 닫기 ------------ */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('ul.gnb a, nav.gnb a');
    if (!link) return;
    const gnb = document.querySelector('nav.gnb, ul.gnb');
    if (gnb && gnb.classList.contains('mobile-open')) {
      /* 드롭다운 부모 링크는 제외 (바로 닫지 않음) */
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


  /* ------------ 9. 관련 사이트 셀렉트 ------------ */
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


  /* ------------ 10. 폼 기본 핸들러 (auth.js가 login/signup 처리, donate.js가 donate 처리) ------------ */
  function setupCommonForms() {
    // login/signup → auth.js
    // donate → donate.js
    // 여기서는 추가 공통 폼만 처리 (현재 없음)
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


  /* ------------ 13. 초기화 ------------ */
  async function init() {
    await loadAllPartials();
    activateGNB();
    setupLangToggle();
    setupSearch();
    setupRelatedSelect();
    setupCommonForms();
    if (typeof window.SIREN_PAGE_INIT === 'function') {
      window.SIREN_PAGE_INIT();
    }
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


  /* ------------ 14. 전역 노출 ------------ */
  window.SIREN = {
    $, $$, toast,
    openModal, closeModal, switchModal,
    isPartialsLoaded: () => partialsLoaded
  };
})();
