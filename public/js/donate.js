/* =========================================================
   SIREN — donate.js (★ Phase L: 토스/효성 듀얼 옵션 + 토스 SDK 통합)
   - 일시 후원: 토스페이먼츠 카드 결제 (즉시)
   - 정기 후원 + 토스 카드: 빌링키 등록 페이지로 이동 (L-4에서 페이지 추가)
   - 정기 후원 + 효성 CMS+: 기존 /api/donate 신청 (관리자 수동 처리)
   ========================================================= */
(function () {
  'use strict';

  /* ============ 토스 SDK 동적 로드 (한 번만) ============ */
  let _tossSdkLoaded = false;
  let _tossSdkLoading = null;

  function loadTossSdk() {
    if (_tossSdkLoaded) return Promise.resolve();
    if (_tossSdkLoading) return _tossSdkLoading;

    _tossSdkLoading = new Promise((resolve, reject) => {
      if (window.TossPayments) {
        _tossSdkLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.tosspayments.com/v2/standard';
      script.async = true;
      script.onload = () => {
        _tossSdkLoaded = true;
        console.log('[Donate] 토스 SDK 로드 완료');
        resolve();
      };
      script.onerror = () => {
        _tossSdkLoading = null;
        reject(new Error('토스 SDK 로드 실패'));
      };
      document.head.appendChild(script);
    });

    return _tossSdkLoading;
  }

  /* ============ 토스 클라이언트 키 가져오기 ============ */
  function getTossClientKey() {
    /* 1. window 전역 변수 우선 */
    if (window.SIREN_TOSS_CLIENT_KEY) return window.SIREN_TOSS_CLIENT_KEY;

    /* 2. <meta name="toss-client-key" content="..."> */
    const meta = document.querySelector('meta[name="toss-client-key"]');
    if (meta && meta.content) return meta.content;

    /* 3. 테스트 키 fallback (개발용) */
    return 'test_ck_vZnjEJeQVxeemRee2PBMrPmOoBN0';
  }

  /* ============ 1. 금액 버튼 ↔ 직접 입력 동기화 ============ */
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

  /* ============ 2. 모달 열릴 때 로그인 사용자 정보 자동 채움 ============ */
  function setupAutoFill() {
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-action="open-modal"][data-target="donateModal"]');
      if (!trigger) return;

      setTimeout(() => {
        const auth = window.SIREN_AUTH;
        const modal = document.getElementById('donateModal');
        if (!modal) return;

        const nameInput = modal.querySelector('input[name="name"]');
        const phoneInput = modal.querySelector('input[name="phone"]');
        const emailInput = modal.querySelector('#donateEmail');

        if (auth && auth.isLoggedIn()) {
          if (nameInput && !nameInput.value) nameInput.value = auth.user.name || '';
          if (phoneInput && !phoneInput.value) phoneInput.value = auth.user.phone || '';
          if (emailInput && !emailInput.value) emailInput.value = auth.user.email || '';

          /* 로그인 사용자: 이메일 readonly */
          if (emailInput) {
            emailInput.readOnly = true;
            emailInput.style.background = 'var(--bg-soft)';
          }
        } else {
          /* 비회원: 이메일 입력 가능 */
          if (emailInput) {
            emailInput.readOnly = false;
            emailInput.style.background = '';
          }
        }

        updatePayMethodVisibility();
      }, 150);
    });
  }

  /* ============ 3. 정기/일시 변경 시 결제 방식 UI 토글 ============ */
  function updatePayMethodVisibility() {
    const modal = document.getElementById('donateModal');
    if (!modal) return;

    const dtype = modal.querySelector('input[name="dtype"]:checked')?.value || 'regular';
    const regularBox = document.getElementById('regularPayMethods');
    const onetimeBox = document.getElementById('onetimePayInfo');
    const submitBtn = document.getElementById('donateSubmitBtn');

    if (dtype === 'regular') {
      if (regularBox) regularBox.style.display = '';
      if (onetimeBox) onetimeBox.style.display = 'none';
      if (submitBtn) {
        const choice = modal.querySelector('input[name="payMethodChoice"]:checked')?.value;
        submitBtn.textContent = choice === 'hyosung_cms'
          ? '🏦 계좌이체 신청하기'
          : '💳 카드 등록하기 (정기 후원)';
      }
    } else {
      if (regularBox) regularBox.style.display = 'none';
      if (onetimeBox) onetimeBox.style.display = '';
      if (submitBtn) submitBtn.textContent = '💳 결제하기 (일시 후원)';
    }
  }

  function setupTypeToggle() {
    document.addEventListener('change', (e) => {
      if (e.target.name === 'dtype' || e.target.name === 'payMethodChoice') {
        updatePayMethodVisibility();
      }
    });
  }

  /* ============ 4. 후원 폼 제출 — 분기 처리 ============ */
  function setupDonateForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'donate') return;
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      const amount = Number(data.amount);
      const dtype = data.dtype || 'regular';
      const payChoice = data.payMethodChoice || 'toss_card';
      const isAnonymous = !!data.isAnonymous;
      const auth = window.SIREN_AUTH;
      const isLoggedIn = !!(auth && auth.isLoggedIn());

      /* 클라이언트 검증 */
      if (!data.name || !data.phone) {
        return window.SIREN.toast('이름과 연락처를 입력해 주세요');
      }
      if (!amount || amount < 1000) {
        return window.SIREN.toast('후원 금액은 1,000원 이상 입력해 주세요');
      }
      if (amount > 100000000) {
        return window.SIREN.toast('1회 최대 후원 금액은 1억원입니다');
      }

      /* 이메일 검증 */
      const email = (data.email || '').trim() || (auth?.user?.email || '');
      if (!email) {
        return window.SIREN.toast('이메일을 입력해 주세요 (영수증 발송용)');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return window.SIREN.toast('올바른 이메일 형식을 입력해 주세요');
      }

      if (!data.agreePersonal) {
        return window.SIREN.toast('개인정보 수집·이용에 동의해 주세요');
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '처리 중...';
      }

      try {
        /* ───── 분기 1: 일시 후원 → 토스 카드 결제 ───── */
        if (dtype === 'onetime') {
          await handleTossOnetime({
            name: data.name,
            phone: data.phone,
            email,
            amount,
            isAnonymous,
            isLoggedIn,
          });
          return;
        }

        /* ───── 분기 2: 정기 + 토스 카드 → 빌링키 등록 페이지 ───── */
        if (dtype === 'regular' && payChoice === 'toss_card') {
          /* 폼 데이터를 sessionStorage에 저장 → billing-register.html에서 읽음 */
          sessionStorage.setItem('siren_billing_intent', JSON.stringify({
            name: data.name,
            phone: data.phone,
            email,
            amount,
            isAnonymous,
            timestamp: Date.now(),
          }));
          window.SIREN.toast('카드 등록 페이지로 이동합니다...');
          setTimeout(() => {
            location.href = '/billing-register.html';
          }, 800);
          return;
        }

        /* ───── 분기 3: 정기 + 효성 CMS+ → 기존 /api/donate ───── */
        if (dtype === 'regular' && payChoice === 'hyosung_cms') {
          await handleHyosungRegular({
            name: data.name,
            phone: data.phone,
            email,
            amount,
            isAnonymous,
          });
          return;
        }

        window.SIREN.toast('결제 방식을 선택해 주세요');
      } catch (err) {
        console.error('[Donate]', err);
        window.SIREN.toast(err.message || '결제 처리 중 오류가 발생했습니다');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = oldText;
        }
      }
    });
  }

  /* ============ 5. 토스 일시 결제 처리 ============ */
  async function handleTossOnetime(opts) {
    const { name, phone, email, amount, isAnonymous } = opts;

    /* 5-1. 백엔드에 결제 준비 요청 (orderId 발급 + DB pending 저장) */
    const prepRes = await fetch('/api/donate-toss-prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name, phone, email, amount,
        type: 'onetime',
        isAnonymous,
      }),
    });
    const prepData = await prepRes.json().catch(() => ({}));

    if (!prepRes.ok || !prepData.ok || !prepData.data?.orderId) {
      throw new Error(prepData.error || '결제 준비 실패');
    }

    const { orderId, donationId } = prepData.data;

    /* 5-2. 토스 SDK 로드 */
    await loadTossSdk();

    /* 5-3. 토스 결제창 호출 */
    const clientKey = getTossClientKey();
    const tossPayments = window.TossPayments(clientKey);
    const payment = tossPayments.payment({ customerKey: 'ANONYMOUS' });

    const successUrl = location.origin + '/payment-success.html';
    const failUrl = location.origin + '/payment-fail.html';

    try {
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: amount },
        orderId: orderId,
        orderName: '교사유가족협의회 일시 후원',
        successUrl: successUrl + '?donationId=' + encodeURIComponent(donationId),
        failUrl: failUrl + '?donationId=' + encodeURIComponent(donationId),
        customerName: name,
        customerEmail: email,
        customerMobilePhone: phone.replace(/[^0-9]/g, ''),
      });
      /* 토스 결제창 호출 후 사용자가 successUrl/failUrl로 자동 리다이렉트됨 */
    } catch (tossErr) {
      console.error('[Toss]', tossErr);
      if (tossErr.code === 'USER_CANCEL') {
        window.SIREN.toast('결제가 취소되었습니다');
      } else {
        window.SIREN.toast(tossErr.message || '결제창 호출 실패');
      }
    }
  }

  /* ============ 6. 효성 CMS+ 정기 후원 신청 처리 ============ */
  async function handleHyosungRegular(opts) {
    const { name, phone, email, amount, isAnonymous } = opts;

    const res = await fetch('/api/donate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name, phone, email, amount,
        type: 'regular',
        payMethod: 'cms',
        isAnonymous,
        agreePersonal: true,
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (res.ok && result.ok) {
      showDonateSuccess(result.data?.donationId || generateLocalId(), {
        message: '정기 후원 신청이 접수되었습니다.\n관리자가 효성 CMS+에 등록 후 안내드립니다.',
      });
    } else {
      throw new Error(result.error || '신청 처리 실패');
    }
  }

  /* ============ 7. 완료 화면 전환 ============ */
  function showDonateSuccess(donationId, opts) {
    opts = opts || {};
    const step1 = document.querySelector('.donate-step[data-step="1"]');
    const step2 = document.querySelector('.donate-step[data-step="2"]');
    const idEl = document.getElementById('donationId');
    const msgEl = document.getElementById('donateSuccessMessage');

    if (idEl) idEl.textContent = donationId;
    if (msgEl && opts.message) {
      msgEl.innerHTML = String(opts.message).replace(/\n/g, '<br />');
    }
    if (step1) step1.classList.remove('active');
    if (step2) step2.classList.add('active');

    window.SIREN.toast(opts.toast || '후원이 완료되었습니다 🎗 감사합니다');

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
            updatePayMethodVisibility();
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

  /* ============ 8. 외부 노출 (payment-success.html에서 호출 가능) ============ */
  window.SIREN_DONATE = {
    showSuccess: showDonateSuccess,
  };

  /* ============ 9. 초기화 ============ */
  function init() {
    setupAmountButtons();
    setupAutoFill();
    setupTypeToggle();
    setupDonateForm();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  /* DOMContentLoaded 보장 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
