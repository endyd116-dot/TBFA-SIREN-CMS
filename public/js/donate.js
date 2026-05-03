/* =========================================================
   SIREN — donate.js (★ Phase M-4: 듀얼 옵션 완전 개편)
   - 일시 후원: 토스페이먼츠 카드 OR 직접 계좌이체
   - 정기 후원: 토스 카드 (빌링키) OR 효성 CMS+ (5초 카운트다운 + 외부 이동)
   - 후원 정책은 /api/donation-policy로 동적 로드
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

  function getTossClientKey() {
    if (window.SIREN_TOSS_CLIENT_KEY) return window.SIREN_TOSS_CLIENT_KEY;
    const meta = document.querySelector('meta[name="toss-client-key"]');
    if (meta && meta.content) return meta.content;
    return 'test_ck_vZnjEJeQVxeemRee2PBMrPmOoBN0';
  }

  /* ============ 정책 캐시 ============ */
  let _policyCache = null;
  let _policyLoading = null;

  async function loadPolicy() {
    if (_policyCache) return _policyCache;
    if (_policyLoading) return _policyLoading;

    _policyLoading = (async () => {
      try {
        const res = await fetch('/api/donation-policy', { credentials: 'include' });
        if (!res.ok) throw new Error('정책 로드 실패');
        const json = await res.json();
        if (json.ok && json.data) {
          _policyCache = json.data;
          return json.data;
        }
      } catch (e) {
        console.warn('[Donate] 정책 로드 실패, 기본값 사용', e);
      }
      /* 폴백 */
      _policyCache = {
        regularAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
        onetimeAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
        bankName: '국민은행',
        bankAccountNo: '(계좌번호 미등록)',
        bankAccountHolder: '(사)교사유가족협의회',
        bankGuideText: '입금 확인까지 1~3일 이내 소요됩니다.',
        hyosungUrl: 'https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf',
        hyosungGuideText: '효성 CMS+에서 등록한 경우 등록 완료까지 2~3일 정도 소요됩니다.',
        modalTitle: '🎗 후원 동참하기',
        modalSubtitle: '여러분의 따뜻한 마음이 유가족에게 큰 힘이 됩니다.',
      };
      return _policyCache;
    })();

    return _policyLoading;
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

  /* ============ 2. 모달 열릴 때 초기화 (정책 로드 + 자동 채움) ============ */
  function setupAutoFill() {
    document.addEventListener('click', async (e) => {
      const trigger = e.target.closest('[data-action="open-modal"][data-target="donateModal"]');
      if (!trigger) return;

      /* 정책 로드 (비동기) */
      try {
        await loadPolicy();
      } catch (_) {}

      setTimeout(() => {
        const auth = window.SIREN_AUTH;
        const modal = document.getElementById('donateModal');
        if (!modal) return;

        /* 모달 타이틀/부제 업데이트 */
        if (_policyCache) {
          const h2 = modal.querySelector('h2.serif');
          const sub = modal.querySelector('.modal-sub');
          if (h2 && _policyCache.modalTitle) h2.textContent = _policyCache.modalTitle;
          if (sub && _policyCache.modalSubtitle) sub.textContent = _policyCache.modalSubtitle;
        }

        const nameInput = modal.querySelector('input[name="name"]');
        const phoneInput = modal.querySelector('input[name="phone"]');
        const emailInput = modal.querySelector('#donateEmail');

        if (auth && auth.isLoggedIn()) {
          if (nameInput && !nameInput.value) nameInput.value = auth.user.name || '';
          if (phoneInput && !phoneInput.value) phoneInput.value = auth.user.phone || '';
          if (emailInput && !emailInput.value) emailInput.value = auth.user.email || '';

          if (emailInput) {
            emailInput.readOnly = true;
            emailInput.style.background = 'var(--bg-soft)';
          }
        } else {
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
    const onetimeBox = document.getElementById('onetimePayMethods');
    const bankDepositorBox = document.getElementById('bankDepositorBox');
    const submitBtn = document.getElementById('donateSubmitBtn');

    if (dtype === 'regular') {
      if (regularBox) regularBox.style.display = 'flex';
      if (onetimeBox) onetimeBox.style.display = 'none';
      if (bankDepositorBox) bankDepositorBox.style.display = 'none';

      if (submitBtn) {
        const choice = modal.querySelector('input[name="payMethodChoice"]:checked')?.value;
        submitBtn.textContent = choice === 'hyosung_cms'
          ? '🏦 효성 CMS+ 등록하러 가기'
          : '💳 카드 등록하기 (정기 후원)';
      }
    } else {
      /* 일시 */
      if (regularBox) regularBox.style.display = 'none';
      if (onetimeBox) onetimeBox.style.display = 'flex';

      const onetimeChoice = modal.querySelector('input[name="onetimeChoice"]:checked')?.value;
      if (bankDepositorBox) {
        bankDepositorBox.style.display = onetimeChoice === 'bank_transfer' ? 'block' : 'none';
      }

      if (submitBtn) {
        submitBtn.textContent = onetimeChoice === 'bank_transfer'
          ? '🏦 계좌이체 신청하기'
          : '💳 카드로 결제하기';
      }
    }
  }

  function setupTypeToggle() {
    document.addEventListener('change', (e) => {
      if (e.target.name === 'dtype'
          || e.target.name === 'payMethodChoice'
          || e.target.name === 'onetimeChoice') {
        updatePayMethodVisibility();
      }
    });
  }

  /* ============ 4. 후원 폼 제출 — 4분기 처리 ============ */
  function setupDonateForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'donate') return;
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      const amount = Number(data.amount);
      const dtype = data.dtype || 'regular';
      const payChoice = data.payMethodChoice || 'toss_card';
      const onetimeChoice = data.onetimeChoice || 'toss_card';
      const isAnonymous = !!data.isAnonymous;
      const auth = window.SIREN_AUTH;
      const isLoggedIn = !!(auth && auth.isLoggedIn());

      /* 공통 검증 */
      if (!data.name || !data.phone) {
        return window.SIREN.toast('이름과 연락처를 입력해 주세요');
      }
      if (!amount || amount < 1000) {
        return window.SIREN.toast('후원 금액은 1,000원 이상 입력해 주세요');
      }
      if (amount > 100000000) {
        return window.SIREN.toast('1회 최대 후원 금액은 1억원입니다');
      }

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
      const restoreBtn = () => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = oldText;
        }
      };
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '처리 중...';
      }

      try {
        /* ───── 분기 1: 일시 + 토스 카드 ───── */
        if (dtype === 'onetime' && onetimeChoice === 'toss_card') {
          await handleTossOnetime({
            name: data.name, phone: data.phone, email, amount, isAnonymous, isLoggedIn,
          });
          return;
        }

        /* ───── 분기 2: 일시 + 직접 계좌이체 ───── */
        if (dtype === 'onetime' && onetimeChoice === 'bank_transfer') {
          const depositorName = String(data.bankDepositorName || '').trim();
          if (!depositorName) {
            restoreBtn();
            return window.SIREN.toast('입금자명을 입력해 주세요');
          }
          await handleBankIntent({
            name: data.name, phone: data.phone, email, amount, isAnonymous,
            depositorName,
          });
          return;
        }

        /* ───── 분기 3: 정기 + 토스 카드 → 빌링키 등록 페이지 ───── */
        if (dtype === 'regular' && payChoice === 'toss_card') {
          sessionStorage.setItem('siren_billing_intent', JSON.stringify({
            name: data.name, phone: data.phone, email, amount, isAnonymous,
            timestamp: Date.now(),
          }));
          window.SIREN.toast('카드 등록 페이지로 이동합니다...');
          setTimeout(() => { location.href = '/billing-register.html'; }, 800);
          return;
        }

        /* ───── 분기 4: 정기 + 효성 CMS+ → 카운트다운 모달 → 외부 이동 ───── */
        if (dtype === 'regular' && payChoice === 'hyosung_cms') {
          await handleHyosungIntent({
            name: data.name, phone: data.phone, email, amount, isAnonymous,
          });
          restoreBtn();
          return;
        }

        window.SIREN.toast('결제 방식을 선택해 주세요');
        restoreBtn();
      } catch (err) {
        console.error('[Donate]', err);
        window.SIREN.toast(err.message || '처리 중 오류가 발생했습니다');
        restoreBtn();
      }
    });
  }

  /* ============ 5. 토스 일시 결제 ============ */
  async function handleTossOnetime(opts) {
    const { name, phone, email, amount, isAnonymous } = opts;

    const prepRes = await fetch('/api/donate-toss-prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, phone, email, amount, type: 'onetime', isAnonymous }),
    });
    const prepData = await prepRes.json().catch(() => ({}));
    if (!prepRes.ok || !prepData.ok || !prepData.data?.orderId) {
      throw new Error(prepData.error || '결제 준비 실패');
    }
    const { orderId, donationId } = prepData.data;

    await loadTossSdk();
    const tossPayments = window.TossPayments(getTossClientKey());
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
    } catch (tossErr) {
      console.error('[Toss]', tossErr);
      if (tossErr.code === 'USER_CANCEL') {
        window.SIREN.toast('결제가 취소되었습니다');
      } else {
        window.SIREN.toast(tossErr.message || '결제창 호출 실패');
      }
    }
  }

  /* ============ 6. 직접 계좌이체 신청 ============ */
  async function handleBankIntent(opts) {
    const { name, phone, email, amount, isAnonymous, depositorName } = opts;

    const res = await fetch('/api/donate-bank-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name, phone, email, amount, isAnonymous, depositorName,
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.ok) {
      throw new Error(result.error || '신청 처리 실패');
    }

    const info = result.data?.bankInfo || {};
    showDonateSuccess(result.data?.donationId || generateLocalId(), {
      title: '계좌이체 신청이 접수되었습니다',
      icon: '🏦',
      message: '아래 계좌로 입금해 주시면<br />확인 후 정상 반영해 드립니다.',
      bankInfo: {
        bank: info.bankName,
        account: info.bankAccountNo,
        holder: info.bankAccountHolder,
        amount: info.amount || amount,
        depositor: info.depositorName || depositorName,
        guide: info.guideText,
      },
      toast: '계좌이체 신청이 접수되었습니다',
    });
  }

  /* ============ 7. 효성 CMS+ 신청 의향 + 카운트다운 모달 ============ */
  async function handleHyosungIntent(opts) {
    const { name, phone, email, amount, isAnonymous } = opts;

    const res = await fetch('/api/donate-hyosung-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, phone, email, amount, isAnonymous }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.ok) {
      throw new Error(result.error || '신청 처리 실패');
    }

    const hyosungUrl = result.data?.hyosungUrl
      || 'https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf';
    const guideText = result.data?.guideText || '';
    const seconds = Number(result.data?.autoRedirectSeconds || 5);

    /* 후원 모달 닫기 → 효성 카운트다운 모달 열기 */
    closeModalById('donateModal');
    setTimeout(() => openHyosungCountdown(hyosungUrl, guideText, seconds), 300);
  }

  /* ============ 8. 효성 카운트다운 모달 컨트롤 ============ */
  function openHyosungCountdown(url, guideText, seconds) {
    const modal = document.getElementById('hyosungRedirectModal');
    if (!modal) {
      /* 모달 없으면 즉시 이동 */
      window.open(url, '_blank', 'noopener');
      return;
    }

    const guideEl = document.getElementById('hyosungGuideText');
    const countEl = document.getElementById('hyosungCountdown');
    const confirmBtn = document.getElementById('hyosungConfirmBtn');
    const cancelBtn = document.getElementById('hyosungCancelBtn');
    const cancelBtn2 = document.getElementById('hyosungCancelBtn2');

    if (guideEl && guideText) {
      guideEl.innerHTML = String(guideText).replace(/\n/g, '<br />');
    }

    let remain = seconds;
    if (countEl) countEl.textContent = String(remain);

    let timer = null;
    const redirect = () => {
      cleanup();
      window.open(url, '_blank', 'noopener');
      closeModalById('hyosungRedirectModal');
      window.SIREN.toast('효성 CMS+ 페이지로 이동했습니다 🏦', 3000);
    };
    const cancel = () => {
      cleanup();
      closeModalById('hyosungRedirectModal');
      window.SIREN.toast('이동이 취소되었습니다');
    };
    const tick = () => {
      remain -= 1;
      if (countEl) countEl.textContent = String(Math.max(0, remain));
      if (remain <= 0) redirect();
    };
    const cleanup = () => {
      if (timer) { clearInterval(timer); timer = null; }
      if (confirmBtn) confirmBtn.removeEventListener('click', redirect);
      if (cancelBtn) cancelBtn.removeEventListener('click', cancel);
      if (cancelBtn2) cancelBtn2.removeEventListener('click', cancel);
    };

    if (confirmBtn) confirmBtn.addEventListener('click', redirect);
    if (cancelBtn) cancelBtn.addEventListener('click', cancel);
    if (cancelBtn2) cancelBtn2.addEventListener('click', cancel);

    /* 모달 열기 */
    openModalById('hyosungRedirectModal');
    timer = setInterval(tick, 1000);
  }

  /* ============ 9. 완료 화면 전환 ============ */
  function showDonateSuccess(donationId, opts) {
    opts = opts || {};
    const step1 = document.querySelector('.donate-step[data-step="1"]');
    const step2 = document.querySelector('.donate-step[data-step="2"]');
    const idEl = document.getElementById('donationId');
    const msgEl = document.getElementById('donateSuccessMessage');
    const titleEl = document.getElementById('donateSuccessTitle');
    const iconEl = document.getElementById('donateSuccessIcon');
    const bankBox = document.getElementById('bankInfoBox');

    if (idEl) idEl.textContent = donationId;
    if (msgEl && opts.message) msgEl.innerHTML = String(opts.message).replace(/\n/g, '<br />');
    if (titleEl && opts.title) titleEl.textContent = opts.title;
    if (iconEl && opts.icon) iconEl.textContent = opts.icon;

    /* 은행 정보 박스 */
    if (bankBox) {
      if (opts.bankInfo) {
        const b = opts.bankInfo;
        setText('bankInfoBank', b.bank || '-');
        setText('bankInfoAccount', b.account || '-');
        setText('bankInfoHolder', b.holder || '-');
        setText('bankInfoAmount', b.amount ? (Number(b.amount).toLocaleString() + '원') : '-');
        setText('bankInfoDepositor', b.depositor || '-');
        setText('bankInfoGuide', b.guide || '입금 확인까지 1~3일 이내 소요될 수 있습니다.');
        bankBox.style.display = '';

        /* 복사 버튼 */
        const copyBtn = document.getElementById('bankCopyBtn');
        if (copyBtn && !copyBtn.dataset.bound) {
          copyBtn.dataset.bound = '1';
          copyBtn.addEventListener('click', () => {
            const text = `${b.bank} ${b.account} (${b.holder})`;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(
                () => window.SIREN.toast('계좌번호가 복사되었습니다 📋'),
                () => window.SIREN.toast('복사 실패. 직접 선택해 주세요')
              );
            } else {
              window.SIREN.toast('계좌번호: ' + text, 5000);
            }
          });
        }
      } else {
        bankBox.style.display = 'none';
      }
    }

    if (step1) step1.classList.remove('active');
    if (step2) step2.classList.add('active');

    window.SIREN.toast(opts.toast || '후원이 완료되었습니다 🎗 감사합니다');

    if (typeof window.SIREN_REFRESH_MYPAGE === 'function') {
      setTimeout(() => window.SIREN_REFRESH_MYPAGE(), 500);
    }

    const modal = document.getElementById('donateModal');
    if (modal) {
      const observer = new MutationObserver(() => {
        if (!modal.classList.contains('show')) {
          setTimeout(() => {
            if (step1) step1.classList.add('active');
            if (step2) step2.classList.remove('active');
            if (bankBox) bankBox.style.display = 'none';
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

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function generateLocalId() {
    return `D-${String(Date.now()).slice(-7)}`;
  }

  /* ============ 10. 모달 open/close 헬퍼 (common.js 의존 최소화) ============ */
  function openModalById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeModalById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('show');
    /* 다른 모달이 열려있지 않으면 스크롤 해제 */
    const anyOpen = document.querySelector('.modal-bg.show');
    if (!anyOpen) document.body.style.overflow = '';
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_DONATE = {
    showSuccess: showDonateSuccess,
  };

  /* ============ 초기화 ============ */
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();