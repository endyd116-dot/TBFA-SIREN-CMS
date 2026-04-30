/* =========================================================
   SIREN — common.js  (v2 — 모달/GNB 안정성 강화)
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
    // 토스트 엘리먼트가 없으면 생성
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

  /* ------------ 3. 모달 컨트롤 (★ 안정성 강화) ------------ */
  function openModal(id, retries = 5) {
    const m = $('#' + id);
    if (m) {
      m.classList.add('show');
      document.body.style.overflow = 'hidden';
      // 첫 input에 포커스
      setTimeout(() => {
        const firstInput = m.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) firstInput.focus();
      }, 100);
      return true;
    }
    // 모달이 없으면 잠시 후 재시도 (partials 로딩 대기)
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
    else if (action === 'mobile-menu') {
      e.preventDefault();
      const gnb = document.querySelector('nav.gnb');
      if (gnb) gnb.classList.toggle('mobile-open');
    }
  });

  /* ------------ 5. GNB 활성 메뉴 자동 표시 ------------ */
  function activateGNB() {
    const page = document.body.dataset.page;
    if (!page) return;
    const li = document.querySelector(`nav.gnb li[data-page="${page}"]`);
    if (li) li.classList.add('active');
  }

  /* ------------ 6. 언어 토글 ------------ */
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

  /* ------------ 7. 통합 검색 ------------ */
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

  /* ------------ 9. 폼 기본 핸들러 (로그인/회원가입) - API 연동 후 STEP 5에서 갱신됨 ------------ */
  function setupCommonForms() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const type = form.dataset.form;
      if (!type) return;
      if (type === 'donate') return; // donate.js에서 처리

      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());

      // 추후 STEP 5에서 실제 API 호출로 교체됨
      if (type === 'login') {
        toast('로그인되었습니다. 환영합니다 :)');
        closeModal('loginModal');
      }
      else if (type === 'signup') {
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

  /* ------------ 12. 전역 노출 ------------ */
  window.SIREN = {
    $, $$, toast,
    openModal, closeModal, switchModal,
    isPartialsLoaded: () => partialsLoaded
  };
})();