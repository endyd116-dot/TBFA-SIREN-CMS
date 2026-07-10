/* =========================================================
   SIREN — donate.js
   (★ R40: 토스 SDK 팝업 → KICC authPageUrl 리다이렉트 전면 교체)
   ========================================================= */
(function () {
  'use strict';

  let _hyosungShowing = false;

  /* 응답 봉투 다중 fallback — { ok, data } 또는 한 단계 더 감싼 경우 모두 흡수 */
  function unwrap(json) {
    if (!json || typeof json !== 'object') return {};
    return json.data?.data || json.data || json || {};
  }

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
      _policyCache = {
        regularAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
        onetimeAmounts: [10000, 30000, 50000, 100000, 300000, 500000],
        bankName: '국민은행',
        bankAccountNo: '(계좌번호 미등록)',
        bankAccountHolder: '(사)교사유가족협의회',
        bankGuideText: '입금 확인까지 1~3일 이내 소요됩니다.',
        hyosungUrl: 'https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf',
        hyosungGuideText: '효성 CMS+에서 등록한 경우 등록 완료까지 2~3일 정도 소요됩니다.',
        hyosungCountdownMessage: '자동이체를 위해 외부페이지로 이동합니다.',
        hyosungCountdownSeconds: 5,
        modalTitle: '후원 동참하기',
        modalSubtitle: '여러분의 따뜻한 마음이 유가족에게 큰 힘이 됩니다.',
      };
      return _policyCache;
    })();

    return _policyLoading;
  }

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

  function applyAmountButtons(policy) {
    const grid = document.querySelector('#donateModal .amt-grid');
    if (!grid) return;

    const dtype = document.querySelector('#donateModal input[name="dtype"]:checked')?.value || 'regular';
    const amounts = dtype === 'regular'
      ? (policy.regularAmounts && policy.regularAmounts.length > 0 ? policy.regularAmounts : null)
      : (policy.onetimeAmounts && policy.onetimeAmounts.length > 0 ? policy.onetimeAmounts : null);

    if (!amounts) return;

    grid.innerHTML = amounts.map((amt, i) => {
      const isDefault = (i === 1 || (amounts.length === 1 && i === 0));
      return `<button type="button" class="amt${isDefault ? ' on' : ''}" data-amt="${amt}">${Number(amt).toLocaleString()}원</button>`;
    }).join('');

    const defaultAmt = amounts[1] || amounts[0];
    const customInput = document.getElementById('customAmt');
    if (customInput && defaultAmt) customInput.value = defaultAmt;
  }

  function setupAutoFill() {
    document.addEventListener('click', async (e) => {
      const trigger = e.target.closest('[data-action="open-modal"][data-target="donateModal"]');
      if (!trigger) return;

      try { await loadPolicy(); } catch (_) {}

      setTimeout(() => {
        const auth = window.SIREN_AUTH;
        const modal = document.getElementById('donateModal');
        if (!modal) return;

        if (_policyCache) {
          const h2 = modal.querySelector('h2.serif');
          const sub = modal.querySelector('.modal-sub');
          if (h2 && _policyCache.modalTitle) h2.textContent = _policyCache.modalTitle;
          if (sub && _policyCache.modalSubtitle) sub.textContent = _policyCache.modalSubtitle;

          applyAmountButtons(_policyCache);
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

        loadCampaignsForDonate();
        updatePayMethodVisibility();
      }, 150);
    });
  }

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
          ? '효성 CMS+ 등록하러 가기'
          : '카드 등록하기 (정기 후원)';
      }
    } else {
      if (regularBox) regularBox.style.display = 'none';
      if (onetimeBox) onetimeBox.style.display = 'flex';

      const onetimeChoice = modal.querySelector('input[name="onetimeChoice"]:checked')?.value;
      if (bankDepositorBox) {
        bankDepositorBox.style.display = onetimeChoice === 'bank_transfer' ? 'block' : 'none';
      }

      if (submitBtn) {
        submitBtn.textContent = onetimeChoice === 'bank_transfer'
          ? '계좌이체 신청하기'
          : '카드·간편결제로 결제하기';
      }
    }
  }

  function setupTypeToggle() {
    document.addEventListener('change', (e) => {
      if (e.target.name === 'dtype'
          || e.target.name === 'payMethodChoice'
          || e.target.name === 'onetimeChoice') {
        updatePayMethodVisibility();
        if (e.target.name === 'dtype' && _policyCache) {
          applyAmountButtons(_policyCache);
        }
      }
    });
  }

  function setupDonateForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'donate') return;
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      const amount = Number(data.amount);
      const dtype = data.dtype || 'regular';
      const payChoice = data.payMethodChoice || 'card';
      const onetimeChoice = data.onetimeChoice || 'card';
      const isAnonymous = !!data.isAnonymous;
      const auth = window.SIREN_AUTH;
      const isLoggedIn = !!(auth && auth.isLoggedIn());

      if (!data.name || !data.phone) return window.SIREN.toast('이름과 연락처를 입력해 주세요');
      if (!amount || amount < 1000) return window.SIREN.toast('후원 금액은 1,000원 이상 입력해 주세요');
      if (amount > 100000000) return window.SIREN.toast('1회 최대 후원 금액은 1억원입니다');

      const email = (data.email || '').trim() || (auth?.user?.email || '');
      if (!email) return window.SIREN.toast('이메일을 입력해 주세요 (영수증 발송용)');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return window.SIREN.toast('올바른 이메일 형식을 입력해 주세요');
      if (!data.agreePersonal) return window.SIREN.toast('개인정보 수집·이용에 동의해 주세요');

      const submitBtn = form.querySelector('button[type="submit"]');
      const oldText = submitBtn ? submitBtn.textContent : '';
      const restoreBtn = () => {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
      };
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '처리 중...'; }

      try {
        const campaignSelect = document.getElementById('donateCampaignSelect');
        const campaignId = campaignSelect?.value ? Number(campaignSelect.value) : null;

        if (dtype === 'onetime' && onetimeChoice === 'card') {
          await handleKiccOnetime({ name: data.name, phone: data.phone, email, amount, isAnonymous, isLoggedIn, campaignId });
          return;
        }

        if (dtype === 'onetime' && onetimeChoice === 'bank_transfer') {
          const depositorName = String(data.bankDepositorName || '').trim();
          if (!depositorName) {
            restoreBtn();
            return window.SIREN.toast('입금자명을 입력해 주세요');
          }
          await handleBankIntent({ name: data.name, phone: data.phone, email, amount, isAnonymous, depositorName, campaignId });
          return;
        }

        if (dtype === 'regular' && payChoice === 'card') {
          sessionStorage.setItem('siren_billing_intent', JSON.stringify({
            name: data.name, phone: data.phone, email, amount, isAnonymous, campaignId, timestamp: Date.now(),
          }));
          window.SIREN.toast('카드 등록 페이지로 이동합니다...');
          setTimeout(() => { location.href = '/billing-register.html'; }, 800);
          return;
        }

        if (dtype === 'regular' && payChoice === 'hyosung_cms') {
          await handleHyosungIntent({ name: data.name, phone: data.phone, email, amount, isAnonymous, campaignId });
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

  /* ★ R40: KICC 일시 결제 — register API로 결제창 주소(authPageUrl) 받아 리다이렉트.
     KICC가 결제 완료 후 백엔드 returnUrl(approve)로 POST 복귀 → 302로 payment-success/fail 이동.
     A는 approve를 직접 호출하지 않음 */
  async function handleKiccOnetime(opts) {
    const { name, phone, email, amount, isAnonymous, campaignId } = opts;
    console.log('[Donate] KICC 일시 결제 시작', { name, amount, email });

    const body = { name, phone, email, amount, type: 'onetime', isAnonymous };
    /* 캠페인 식별자: 폼은 숫자 id만 보유 → 계약 키(campaignTag)에 문자열 id로 매핑.
       (B가 어느 키로 합산하는지 확정 시 단일화 — 그때까지 campaignId도 함께 전송) */
    if (campaignId) {
      body.campaignTag = String(campaignId);
      body.campaignId = campaignId;
    }

    const res = await fetch('/api/donate-kicc-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    const d = unwrap(json);

    if (!res.ok || json.ok === false || !d.authPageUrl) {
      throw new Error(json.error || d.error || '결제 준비 실패');
    }

    window.SIREN.toast('결제창으로 이동합니다...');
    setTimeout(() => { window.location.href = d.authPageUrl; }, 300);
  }

  async function handleBankIntent(opts) {
    const { name, phone, email, amount, isAnonymous, depositorName, campaignId } = opts;

    const res = await fetch('/api/donate-bank-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name, phone, email, amount, isAnonymous, depositorName,
        campaignId: campaignId || null,
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.ok) throw new Error(result.error || '신청 처리 실패');

    const info = result.data?.bankInfo || {};
    showDonateSuccess(result.data?.donationId || generateLocalId(), {
      title: '계좌이체 신청이 접수되었습니다',
      icon: '',
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

  async function handleHyosungIntent(opts) {
    const { name, phone, email, amount, isAnonymous } = opts;

    const res = await fetch('/api/donate-hyosung-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, phone, email, amount, isAnonymous }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.ok) throw new Error(result.error || '신청 처리 실패');

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

    closeModalById('donateModal');
    setTimeout(() => openHyosungCountdown(hyosungUrl, guideText, seconds), 600);
  }

  function openHyosungCountdown(url, guideText, seconds) {
    if (_hyosungShowing) {
      console.warn('[Donate] 카운트다운 이미 표시 중');
      return;
    }
    _hyosungShowing = true;

    console.log('[Donate] openHyosungCountdown', { url, seconds });

    const modal = document.getElementById('hyosungRedirectModal');
    if (!modal) {
      console.error('[Donate] 모달 DOM 없음 → 폴백');
      _hyosungShowing = false;
      window.SIREN.toast('효성 CMS+ 페이지로 이동합니다...');
      setTimeout(() => { window.location.href = url; }, 1000);
      return;
    }

    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    const guideEl = document.getElementById('hyosungGuideText');
    const countEl = document.getElementById('hyosungCountdown');
    let confirmBtn = document.getElementById('hyosungConfirmBtn');
    let cancelBtn = document.getElementById('hyosungCancelBtn');
    let cancelBtn2 = document.getElementById('hyosungCancelBtn2');

    if (guideEl && guideText) {
      guideEl.innerHTML = String(guideText).replace(/\n/g, '<br />');
    }

    let remain = Math.max(1, Math.min(30, Number(seconds) || 5));
    if (countEl) countEl.textContent = String(remain);

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
    let _done = false;

    const cleanup = () => {
      if (timer) { clearInterval(timer); timer = null; }
      modal.classList.remove('show');
      modal.style.cssText = '';
      document.body.style.overflow = '';
      _hyosungShowing = false;
    };

    const redirect = () => {
      if (_done) return;
      _done = true;
      cleanup();
      window.location.href = url;
    };

    const cancel = () => {
      if (_done) return;
      _done = true;
      cleanup();
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

    modal.classList.add('show');
    modal.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 999999 !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: rgba(10,10,10,0.6) !important;
      backdrop-filter: blur(8px) !important;
      pointer-events: auto !important;
    `;
    document.body.style.overflow = 'hidden';

    void modal.offsetHeight;

    console.log('[Donate] 모달 표시 완료:', {
      computed: getComputedStyle(modal).display,
      zIndex: getComputedStyle(modal).zIndex,
    });

    timer = setInterval(tick, 1000);
  }

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

        const copyBtn = document.getElementById('bankCopyBtn');
        if (copyBtn && !copyBtn.dataset.bound) {
          copyBtn.dataset.bound = '1';
          copyBtn.addEventListener('click', () => {
            const text = `${b.bank} ${b.account} (${b.holder})`;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(
                () => window.SIREN.toast('계좌번호가 복사되었습니다 '),
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

    window.SIREN.toast(opts.toast || '후원이 완료되었습니다 감사합니다');

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
    const anyOpen = document.querySelector('.modal-bg.show');
    if (!anyOpen) document.body.style.overflow = '';
  }

  window.SIREN_DONATE = { showSuccess: showDonateSuccess };

  async function loadCampaignsForDonate() {
    const wrap = document.getElementById('donateCampaignWrap');
    const select = document.getElementById('donateCampaignSelect');
    if (!wrap || !select) return;

    try {
      const res = await fetch('/api/campaigns?featured=1', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.ok) { wrap.style.display = 'none'; return; }
      const list = data.data?.list || [];
      if (list.length === 0) { wrap.style.display = 'none'; return; }

      const TYPE_ICON = { fundraising: '', memorial: '', awareness: '' };
      select.innerHTML = '<option value="">캠페인 선택 안 함 (일반 후원)</option>' +
        list.map(c => {
          const icon = TYPE_ICON[c.type] || '';
          const pctText = c.progressPercent !== null ? ` (${c.progressPercent}%)` : '';
          const safeTitle = String(c.title || '').replace(/[<>]/g, '');
          return `<option value="${c.id}">${icon} ${safeTitle}${pctText}</option>`;
        }).join('');

      wrap.style.display = '';

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

  function init() {
    setupAmountButtons();
    setupAutoFill();
    setupTypeToggle();
    setupDonateForm();
    // ★ 후원 모달 프리페치 — 모달 처음 열릴 때 어드민 설정값 즉시 적용 (3초 딜레이 제거)
    loadPolicy().catch(() => {});
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