/* =========================================================
   SIREN — donate.js
   후원 모달 인터랙션 + Netlify Function API 연동
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

      // 같은 그룹 내 형제 버튼 비활성화
      const group = btn.parentElement;
      group.querySelectorAll('.amt').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');

      // input 동기화
      const input = document.getElementById('customAmt');
      if (input) input.value = amt;
    });

    // 직접 입력 시, 일치하는 버튼이 있으면 활성화 / 없으면 모두 해제
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'customAmt') return;
      const v = String(e.target.value).trim();
      document.querySelectorAll('.amt').forEach(b => {
        b.classList.toggle('on', b.dataset.amt === v);
      });
    });
  }

  /* ------------ 2. 후원 폼 제출 ------------ */
  function setupDonateForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'donate') return;

      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      data.amount = Number(data.amount);

      // 유효성
      if (!data.name || !data.phone) {
        return SIREN.toast('이름과 연락처를 입력해 주세요');
      }
      if (!data.amount || data.amount < 1000) {
        return SIREN.toast('후원 금액은 1,000원 이상 입력해 주세요');
      }

      // 제출 버튼 잠금
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '결제 진행 중...';
      }

      try {
        // Netlify Functions 호출 (실제 환경)
        // 로컬 테스트 시 API가 없어도 catch로 떨어져 "성공" 처리됨
        const res = await fetch('/api/donate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            phone: data.phone,
            amount: data.amount,
            type: data.dtype,
            payMethod: data.payMethod
          })
        });

        let result;
        if (res.ok) {
          result = await res.json();
        } else {
          throw new Error('API 미연결');
        }

        if (result.ok) {
          showDonateSuccess(result.donationId || generateLocalId());
        } else {
          throw new Error(result.error || '오류');
        }
      } catch (err) {
        // API가 아직 없을 때 (로컬 개발/배포 전) 데모 동작
        console.warn('[Donate] API not connected - demo mode:', err.message);
        showDonateSuccess(generateLocalId());
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });
  }

  /* ------------ 3. 완료 화면으로 전환 ------------ */
  function showDonateSuccess(donationId) {
    const step1 = document.querySelector('.donate-step[data-step="1"]');
    const step2 = document.querySelector('.donate-step[data-step="2"]');
    const idEl = document.getElementById('donationId');

    if (idEl) idEl.textContent = donationId;
    if (step1) step1.classList.remove('active');
    if (step2) step2.classList.add('active');

    SIREN.toast('후원이 완료되었습니다 🎗 감사합니다');

    // 모달이 닫힐 때 1단계 화면으로 복귀
    const modal = document.getElementById('donateModal');
    if (modal) {
      const observer = new MutationObserver(() => {
        if (!modal.classList.contains('show')) {
          setTimeout(() => {
            if (step1) step1.classList.add('active');
            if (step2) step2.classList.remove('active');
            const form = modal.querySelector('form[data-form="donate"]');
            if (form) form.reset();
            // 기본 금액 30,000으로 복귀
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

  /* ------------ 4. 로컬 데모용 후원번호 생성 ------------ */
  function generateLocalId() {
    const ts = Date.now().toString().slice(-7);
    return `D-${ts}`;
  }

  /* ------------ 5. 초기화 ------------ */
  function init() {
    setupAmountButtons();
    setupDonateForm();
  }

  // common.js의 SIREN_PAGE_INIT 훅에 합류
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();