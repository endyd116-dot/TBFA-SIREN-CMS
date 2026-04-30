/* =========================================================
   SIREN — donate.js (v2 — 실 API 연동 + 로그인 사용자 정보 자동 채움)
   ========================================================= */
(function () {
  'use strict';

  /* ------------ 1. 금액 버튼 ↔ 직접 입력 동기화 ------------ */
  function setupAmountButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.amt');
      if (!btn) return;
      e.preventDefault();
      const amt = btn.dataset.amt;
      const group = btn.parentElement;
      group.querySelectorAll('.amt').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const input = document.getElementById('customAmt');
      if (input) input.value = amt;
    });

    document.addEventListener('input', (e) => {
      if (e.target.id !== 'customAmt') return;
      const v = String(e.target.value).trim();
      document.querySelectorAll('.amt').forEach(b => {
        b.classList.toggle('on', b.dataset.amt === v);
      });
    });
  }

  /* ------------ 2. 모달 열릴 때 로그인 사용자 정보 자동 채움 ------------ */
  function setupAutoFill() {
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-action="open-modal"][data-target="donateModal"]');
      if (!trigger) return;

      // 약간 지연 후 (모달이 열린 뒤)
      setTimeout(() => {
        const auth = window.SIREN_AUTH;
        if (!auth || !auth.isLoggedIn()) return;

        const modal = document.getElementById('donateModal');
        if (!modal) return;

        const nameInput = modal.querySelector('input[name="name"]');
        const phoneInput = modal.querySelector('input[name="phone"]');

        if (nameInput && !nameInput.value) nameInput.value = auth.user.name || '';
        if (phoneInput && !phoneInput.value) phoneInput.value = auth.user.phone || '';
      }, 150);
    });
  }

  /* ------------ 3. 후원 폼 제출 — 실 API 호출 ------------ */
  function setupDonateForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'donate') return;
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      const amount = Number(data.amount);

      /* 클라이언트 검증 */
      if (!data.name || !data.phone) {
        return window.SIREN.toast('이름과 연락처를 입력해 주세요');
      }
      if (!amount || amount < 1000) {
        return window.SIREN.toast('후원 금액은 1,000원 이상 입력해 주세요');
      }
      const agreeCheckbox = form.querySelector('input[type="checkbox"][required]');
      if (agreeCheckbox && !agreeCheckbox.checked) {
        return window.SIREN.toast('개인정보 수집·이용에 동의해 주세요');
      }

      /* 제출 버튼 잠금 */
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '결제 진행 중...';
      }

      try {
        /* 로그인 사용자면 이메일 자동 첨부 */
        const authEmail = window.SIREN_AUTH?.user?.email || '';

        const res = await fetch('/api/donate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: data.name,
            phone: data.phone,
            email: authEmail,
            amount,
            type: data.dtype || 'regular',
            payMethod: data.payMethod || 'cms',
            isAnonymous: false,
            agreePersonal: true,
          }),
        });

        const result = await res.json();

        if (res.ok && result.ok) {
          showDonateSuccess(result.data?.donationId || generateLocalId());
        } else {
          const msg = result.error || result.message || '결제 처리 중 오류가 발생했습니다';
          window.SIREN.toast(msg);
          if (result.detail) console.warn('[Donate]', result.detail);
        }
      } catch (err) {
        console.error('[Donate Network]', err);
        window.SIREN.toast('네트워크 오류가 발생했습니다');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });
  }

  /* ------------ 4. 완료 화면 전환 ------------ */
  function showDonateSuccess(donationId) {
    const step1 = document.querySelector('.donate-step[data-step="1"]');
    const step2 = document.querySelector('.donate-step[data-step="2"]');
    const idEl = document.getElementById('donationId');

    if (idEl) idEl.textContent = donationId;
    if (step1) step1.classList.remove('active');
    if (step2) step2.classList.add('active');

    window.SIREN.toast('후원이 완료되었습니다 🎗 감사합니다');

    /* 마이페이지에 있다면 후원 내역 새로고침 */
    if (typeof window.SIREN_REFRESH_MYPAGE === 'function') {
      setTimeout(() => window.SIREN_REFRESH_MYPAGE(), 500);
    }

    /* 모달 닫힐 때 1단계로 복귀 */
    const modal = document.getElementById('donateModal');
    if (modal) {
      const observer = new MutationObserver(() => {
        if (!modal.classList.contains('show')) {
          setTimeout(() => {
            if (step1) step1.classList.add('active');
            if (step2) step2.classList.remove('active');
            const form = modal.querySelector('form[data-form="donate"]');
            if (form) form.reset();
            const def = modal.querySelector('.amt[data-amt="30000"]');
            if (def) {
              modal.querySelectorAll('.amt').forEach(b => b.classList.remove('on'));
              def.classList.add('on');
              const input = document.getElementById('customAmt');
              if (input) input.value = 30000;
            }
          }, 400);
          observer.disconnect();
        }
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function generateLocalId() {
    return `D-${String(Date.now()).slice(-7)}`;
  }

  /* ------------ 5. 초기화 ------------ */
  function init() {
    setupAmountButtons();
    setupAutoFill();
    setupDonateForm();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();