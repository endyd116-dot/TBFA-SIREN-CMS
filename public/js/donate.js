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

// public/js/donate.js — setupAutoFill 안, updatePayMethodVisibility 직전에 추가
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

        /* ★ M-19-2: 캠페인 셀렉트 로드 */
        loadCampaignsForDonate();

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

      // public/js/donate.js — try 블록 시작부, 분기들 직전 + 각 분기 호출 수정
      try {
        /* ★ M-19-2: 캠페인 ID 수집 (선택) */
        const campaignSelect = document.getElementById('donateCampaignSelect');
        const campaignId = campaignSelect?.value ? Number(campaignSelect.value) : null;

        /* ───── 분기 1: 일시 + 토스 카드 ───── */
        if (dtype === 'onetime' && onetimeChoice === 'toss_card') {
          await handleTossOnetime({
            name: data.name, phone: data.phone, email, amount, isAnonymous, isLoggedIn,
            campaignId,
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
            campaignId,
          });
          return;
        }

        /* ───── 분기 3: 정기 + 토스 카드 → 빌링키 등록 페이지 ───── */
        if (dtype === 'regular' && payChoice === 'toss_card') {
          sessionStorage.setItem('siren_billing_intent', JSON.stringify({
            name: data.name, phone: data.phone, email, amount, isAnonymous,
            campaignId,
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
            campaignId,
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
  /* ============ 5. 토스 일시 결제 ============ */
  async function handleTossOnetime(opts) {
    const { name, phone, email, amount, isAnonymous } = opts;
    console.log('[Donate] 🟦 토스 일시 결제 시작', { name, amount, email });

    const prepRes = await fetch('/api/donate-toss-prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name, phone, email, amount, type: 'onetime', isAnonymous,
        campaignId: opts.campaignId || null,
      }),
    });
    console.log('[Donate] prepare 응답 status:', prepRes.status);
    const prepData = await prepRes.json().catch(() => ({}));
    console.log('[Donate] prepare 응답 본문:', prepData);

    if (!prepRes.ok || !prepData.ok || !prepData.data?.orderId) {
      throw new Error(prepData.error || '결제 준비 실패');
    }
    const { orderId, donationId } = prepData.data;

    console.log('[Donate] 토스 SDK 로드 시작');
    await loadTossSdk();
    console.log('[Donate] 토스 SDK 로드 완료');

    const clientKey = getTossClientKey();
    console.log('[Donate] clientKey:', clientKey ? clientKey.slice(0, 10) + '...' : '(없음)');

    if (!window.TossPayments) {
      throw new Error('토스 SDK가 로드되지 않았습니다');
    }

    const tossPayments = window.TossPayments(clientKey);
    console.log('[Donate] tossPayments 객체:', !!tossPayments);

    const payment = tossPayments.payment({ customerKey: 'ANONYMOUS' });
    console.log('[Donate] payment 객체:', !!payment);

    const successUrl = location.origin + '/payment-success.html';
    const failUrl = location.origin + '/payment-fail.html';

    try {
      console.log('[Donate] 🚀 requestPayment 호출');
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
      console.log('[Donate] ✅ requestPayment 완료 (리다이렉트 대기)');
    } catch (tossErr) {
      console.error('[Donate] ❌ Toss 결제창 에러:', tossErr);
      if (tossErr.code === 'USER_CANCEL') {
        window.SIREN.toast('결제가 취소되었습니다');
      } else {
        window.SIREN.toast(tossErr.message || '결제창 호출 실패');
      }
    }
  }

  /* ============ 6. 직접 계좌이체 신청 ============ */
// public/js/donate.js — handleBankIntent 함수 fetch 부분 교체
  async function handleBankIntent(opts) {
    const { name, phone, email, amount, isAnonymous, depositorName, campaignId } = opts;

    const res = await fetch('/api/donate-bank-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name, phone, email, amount, isAnonymous, depositorName,
        campaignId: campaignId || null,  // ★ M-19-2
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

    /* ★ 2026-05: 정책에서 받은 값 우선, 없으면 응답값, 그것도 없으면 폴백 */
    const policy = _policyCache || {};
    const hyosungUrl = result.data?.hyosungUrl
      || policy.hyosungUrl
      || 'https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf';
    const guideText = policy.hyosungCountdownMessage
      || result.data?.guideText
      || '자동이체를 위해 외부페이지로 이동합니다.';
    const seconds = Number(policy.hyosungCountdownSeconds)
      || Number(result.data?.autoRedirectSeconds)
      || 5;

    /* 후원 모달 닫기 → 효성 카운트다운 모달 열기 */
    closeModalById('donateModal');
    setTimeout(() => openHyosungCountdown(hyosungUrl, guideText, seconds), 350);
  }

  /* ============ 8. 효성 카운트다운 모달 컨트롤 ============ */
  /* ============ 8. 효성 카운트다운 모달 컨트롤 (★ 2026-05 패치) ============ */
  function openHyosungCountdown(url, guideText, seconds) {
    const modal = document.getElementById('hyosungRedirectModal');

    /* 모달이 DOM에 없으면 폴백: 1초 안내 후 메인 창에서 직접 이동 */
    if (!modal) {
      console.warn('[Donate] hyosungRedirectModal 없음 → 폴백 이동');
      window.SIREN.toast('효성 CMS+ 페이지로 이동합니다...');
      setTimeout(() => { window.location.href = url; }, 1000);
      return;
    }

    const guideEl = document.getElementById('hyosungGuideText');
    const countEl = document.getElementById('hyosungCountdown');
    let confirmBtn = document.getElementById('hyosungConfirmBtn');
    let cancelBtn = document.getElementById('hyosungCancelBtn');
    let cancelBtn2 = document.getElementById('hyosungCancelBtn2');

    /* 안내 메시지 동적 적용 */
    if (guideEl && guideText) {
      guideEl.innerHTML = String(guideText).replace(/\n/g, '<br />');
    }

    /* 카운트다운 초수 안전 범위 (1~30초) */
    let remain = Math.max(1, Math.min(30, Number(seconds) || 5));
    if (countEl) countEl.textContent = String(remain);

    /* ★ 핵심 패치: 기존 이벤트 리스너 제거 (cloneNode 트릭) */
    if (confirmBtn) {
      const cb = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(cb, confirmBtn);
      confirmBtn = cb;
    }
    if (cancelBtn) {
      const cb = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(cb, cancelBtn);
      cancelBtn = cb;
    }
    if (cancelBtn2) {
      const cb = cancelBtn2.cloneNode(true);
      cancelBtn2.parentNode.replaceChild(cb, cancelBtn2);
      cancelBtn2 = cb;
    }

    let timer = null;
    let _done = false;  /* ★ 중복 실행 방지 가드 */

    const stopTimer = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const redirect = () => {
      if (_done) return;
      _done = true;
      stopTimer();
      closeModalById('hyosungRedirectModal');
      /* ★ 메인 창에서 직접 이동 (window.open 사용 안 함 → 새 창 안 열림) */
      console.log('[Donate] 효성 페이지로 이동:', url);
      window.location.href = url;
    };

    const cancel = () => {
      if (_done) return;
      _done = true;
      stopTimer();
      closeModalById('hyosungRedirectModal');
      window.SIREN.toast('이동이 취소되었습니다');
    };

    const tick = () => {
      if (_done) return;
      remain -= 1;
      if (countEl) countEl.textContent = String(Math.max(0, remain));
      if (remain <= 0) redirect();
    };

    if (confirmBtn) confirmBtn.addEventListener('click', redirect);
    if (cancelBtn) cancelBtn.addEventListener('click', cancel);
    if (cancelBtn2) cancelBtn2.addEventListener('click', cancel);

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

 // public/js/donate.js — init() 함수 직전에 신규 함수 추가
  /* ============ ★ M-19-2: 캠페인 셀렉트 로드 ============ */
  async function loadCampaignsForDonate() {
    const wrap = document.getElementById('donateCampaignWrap');
    const select = document.getElementById('donateCampaignSelect');
    if (!wrap || !select) return;

    try {
      const res = await fetch('/api/campaigns?featured=1', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        wrap.style.display = 'none';
        return;
      }
      const list = data.data?.list || [];

      if (list.length === 0) {
        wrap.style.display = 'none';
        return;
      }

      const TYPE_ICON = { fundraising: '💰', memorial: '🎗', awareness: '📣' };
      select.innerHTML = '<option value="">캠페인 선택 안 함 (일반 후원)</option>' +
        list.map(c => {
          const icon = TYPE_ICON[c.type] || '🎯';
          const pctText = c.progressPercent !== null ? ` (${c.progressPercent}%)` : '';
          const safeTitle = String(c.title || '').replace(/[<>]/g, '');
          return `<option value="${c.id}">${icon} ${safeTitle}${pctText}</option>`;
        }).join('');

      wrap.style.display = '';

      /* sessionStorage에 사전 선택값 있으면 자동 선택 (campaign.html에서 진입 시) */
      const pre = sessionStorage.getItem('siren_preselect_campaign');
      if (pre) {
        try {
          const obj = JSON.parse(pre);
          select.value = String(obj.id);
          sessionStorage.removeItem('siren_preselect_campaign');
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[Donate] 캠페인 로드 실패', e);
      wrap.style.display = 'none';
    }
  }


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