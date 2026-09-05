/* =========================================================
   SIREN — donate.js
   (★ R40: 토스 SDK 팝업 → KICC authPageUrl 리다이렉트 전면 교체)
   (★ 2026-09-06 「등불의 기적」: 캠페인 extras 로 «후원회원 가입 먼저»(S5)·
      정기/일시 금액 사다리(S2)·랜딩 파라미터 동봉(S6-b))
   ========================================================= */
(function () {
  'use strict';

  let _hyosungShowing = false;

  /* 등불 캠페인 상태 — 캠페인 페이지가 sessionStorage(siren_preselect_campaign)에 extras 를 실어 보낸다 */
  let _campaignInfo = null;   // { id, slug, title, extras }
  let _lantern = null;        // extras (theme 'lantern') 또는 null
  let _member = null;         // 후원회원 가입/로그인 확인된 회원 { id, name, phone, email }
  let _loginWatch = null;

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
        bankName: '우리은행',
        bankAccountNo: '1005-404-940572',
        bankAccountHolder: '사단법인 교사유가족협의회',
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

  /* ───────── 등불 사다리(S2) ───────── */
  function currentDtype() {
    return document.querySelector('#donateModal input[name="dtype"]:checked')?.value || 'regular';
  }
  function ladderFor(dtype) {
    if (!_lantern || !_lantern.ladder) return null;
    const L = _lantern.ladder;
    return dtype === 'regular'
      ? { steps: L.regular || [], def: Number(L.regularDefault) || 0 }
      : { steps: L.onetime || [], def: Number(L.onetimeDefault) || 0 };
  }
  function updateImpact() {
    const box = document.getElementById('amtImpact');
    if (!box) return;
    if (!_lantern) { box.hidden = true; return; }
    const v = Number(document.getElementById('customAmt')?.value || 0);
    const l = ladderFor(currentDtype());
    const step = l && l.steps.find(s => Number(s.amount) === v);
    if (step) {
      box.textContent = '이 금액이면 — ' + step.impact;
      box.hidden = false;
    } else if (v >= 1000) {
      box.textContent = '직접 정하신 마음, 감사합니다. 이 금액도 같은 곳에 쓰입니다.';
      box.hidden = false;
    } else {
      box.hidden = true;
    }
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
      updateImpact();
    });

    document.addEventListener('input', (e) => {
      if (e.target.id !== 'customAmt') return;
      const v = String(e.target.value).trim();
      document.querySelectorAll('.amt').forEach(b => {
        b.classList.toggle('on', b.dataset.amt === v);
      });
      updateImpact();
    });
  }

  function applyAmountButtons(policy) {
    const grid = document.querySelector('#donateModal .amt-grid');
    if (!grid) return;
    const dtype = currentDtype();
    const customInput = document.getElementById('customAmt');
    const hint = document.getElementById('amtLadderHint');
    const minNote = document.getElementById('amtMinNote');

    /* 등불 캠페인: 두 탭 모두 1만·3만·5만·10만 + 영향 문구, 기본 칸만 다르게(정기 1만·일시 3만).
       탭을 바꾸면 그 탭의 기본 칸으로 초기화(선택 인덱스 승계 금지). */
    const ladder = ladderFor(dtype);
    if (ladder && ladder.steps.length) {
      grid.classList.add('ladder-4');
      grid.innerHTML = ladder.steps.map(s => {
        const amt = Number(s.amount);
        const on = amt === ladder.def ? ' on' : '';
        return `<button type="button" class="amt amt-ladder${on}" data-amt="${amt}"><span>${amt.toLocaleString()}원</span><small>${escapeText(s.impact)}</small></button>`;
      }).join('');
      if (customInput) customInput.value = ladder.def || ladder.steps[0].amount;
      if (hint) {
        const h = dtype === 'regular' ? (_lantern.ladder.monthlyHint || '') : '';
        hint.textContent = h;
        hint.hidden = !h;
      }
      if (minNote) { minNote.textContent = _lantern.ladder.minNote || '최소 1,000원부터 가능합니다'; minNote.hidden = false; }
      updateImpact();
      return;
    }

    grid.classList.remove('ladder-4');
    if (hint) hint.hidden = true;
    if (minNote) minNote.hidden = true;
    const impact = document.getElementById('amtImpact');
    if (impact) impact.hidden = true;

    const amounts = dtype === 'regular'
      ? (policy.regularAmounts && policy.regularAmounts.length > 0 ? policy.regularAmounts : null)
      : (policy.onetimeAmounts && policy.onetimeAmounts.length > 0 ? policy.onetimeAmounts : null);

    if (!amounts) return;

    grid.innerHTML = amounts.map((amt, i) => {
      const isDefault = (i === 1 || (amounts.length === 1 && i === 0));
      return `<button type="button" class="amt${isDefault ? ' on' : ''}" data-amt="${amt}">${Number(amt).toLocaleString()}원</button>`;
    }).join('');

    const defaultAmt = amounts[1] || amounts[0];
    if (customInput && defaultAmt) customInput.value = defaultAmt;
  }

  function escapeText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ───────── 단계 전환 ───────── */
  function showStep(n) {
    document.querySelectorAll('#donateModal .donate-step').forEach(el => {
      el.classList.toggle('active', String(el.dataset.step) === String(n));
    });
    const modal = document.getElementById('donateModal');
    if (modal) modal.scrollTop = 0;
  }

  /* 등불 캠페인이면 회원 상태에 따라 0단계(가입/회칙 동의) 또는 1단계로 */
  async function routeSteps() {
    if (!_lantern || !_lantern.requireMembership) { showStep(1); return; }
    let st = null;
    try {
      const res = await fetch('/api/sponsor-signup', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      st = unwrap(json);
    } catch (_) { st = null; }

    if (!st || !st.loggedIn) {
      _member = null;
      prepareJoinForm('new', null);
      showStep(0);
      return;
    }
    _member = st.member || null;
    if (st.needsBylaws) {
      prepareJoinForm('agree', st.member);
      showStep(0);
      return;
    }
    lockIdentity(st.member);
    showStep(1);
  }

  function prepareJoinForm(mode, member) {
    const form = document.getElementById('sponsorJoinForm');
    if (!form) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    const lock = (id, on) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.readOnly = !!on;
      el.classList.toggle('sj-locked', !!on);
    };
    const existing = document.getElementById('sjExisting');
    if (existing) existing.hidden = true;
    const intro = document.getElementById('sjIntro');
    const modeNote = document.getElementById('sjModeNote');
    const submit = document.getElementById('sjSubmit');
    const bylawsLink = document.getElementById('sjBylawsLink');
    if (bylawsLink && _lantern && _lantern.bylawsUrl) bylawsLink.href = _lantern.bylawsUrl;
    const privacyLine = document.getElementById('sjPrivacy')?.closest('label');
    const bylaws = document.getElementById('sjBylaws');
    const privacy = document.getElementById('sjPrivacy');

    if (mode === 'agree' && member) {
      set('sjName', member.name); set('sjPhone', member.phone); set('sjEmail', member.email); set('sjSchool', member.schoolName);
      lock('sjName', true); lock('sjPhone', true); lock('sjEmail', true);
      if (intro) intro.hidden = true;
      if (modeNote) modeNote.hidden = false;
      if (privacyLine) privacyLine.style.display = 'none';
      if (privacy) privacy.checked = true;
      if (bylaws) bylaws.checked = false;
      if (submit) submit.textContent = '회칙 동의하고 후원 계속하기';
      form.dataset.mode = 'agree';
    } else {
      lock('sjName', false); lock('sjPhone', false); lock('sjEmail', false);
      if (intro) intro.hidden = false;
      if (modeNote) modeNote.hidden = true;
      if (privacyLine) privacyLine.style.display = '';
      if (privacy) privacy.checked = false;
      if (bylaws) bylaws.checked = false;
      if (submit) submit.textContent = '가입하고 후원 계속하기';
      form.dataset.mode = 'new';
      /* 후원 폼에 이미 적힌 이름·연락처가 있으면 가져온다 */
      const donateForm = document.querySelector('#donateModal form[data-form="donate"]');
      if (donateForm) {
        const n = donateForm.querySelector('input[name="name"]')?.value;
        const p = donateForm.querySelector('input[name="phone"]')?.value;
        const em = donateForm.querySelector('#donateEmail')?.value;
        if (n && !document.getElementById('sjName').value) set('sjName', n);
        if (p && !document.getElementById('sjPhone').value) set('sjPhone', p);
        if (em && !document.getElementById('sjEmail').value) set('sjEmail', em);
      }
    }
  }

  /* 후원 폼의 이름·연락처·이메일을 회원 정보로 고정 */
  function lockIdentity(member) {
    if (!member) return;
    const modal = document.getElementById('donateModal');
    if (!modal) return;
    const nameInput = modal.querySelector('form[data-form="donate"] input[name="name"]');
    const phoneInput = modal.querySelector('form[data-form="donate"] input[name="phone"]');
    const emailInput = modal.querySelector('#donateEmail');
    if (nameInput && member.name) nameInput.value = member.name;
    if (phoneInput && member.phone && !phoneInput.value) phoneInput.value = member.phone;
    if (emailInput && member.email) {
      emailInput.value = member.email;
      emailInput.readOnly = true;
      emailInput.style.background = 'var(--bg-soft)';
    }
  }

  /* 0단계 폼 제출 — 후원회원 가입 또는 회칙 동의 */
  function setupJoinForm() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.dataset.form !== 'sponsor-join') return;
      e.preventDefault();

      const data = Object.fromEntries(new FormData(form).entries());
      const mode = form.dataset.mode || 'new';
      const name = String(data.name || '').trim();
      const phone = String(data.phone || '').trim();
      const email = String(data.email || '').trim();
      if (!data.agreeBylaws) return window.SIREN.toast('회칙(정관)에 따른 후원회원 가입에 동의해 주세요');
      if (mode === 'new') {
        if (!name || name.length < 2) return window.SIREN.toast('이름을 입력해 주세요');
        if (!phone) return window.SIREN.toast('연락처를 입력해 주세요');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return window.SIREN.toast('올바른 이메일을 입력해 주세요');
        if (!data.agreePrivacy) return window.SIREN.toast('개인정보 수집·이용에 동의해 주세요');
      }

      const submit = document.getElementById('sjSubmit');
      const old = submit ? submit.textContent : '';
      if (submit) { submit.disabled = true; submit.textContent = '처리 중...'; }
      const existing = document.getElementById('sjExisting');
      if (existing) existing.hidden = true;

      try {
        const res = await fetch('/api/sponsor-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name, phone, email,
            schoolName: String(data.schoolName || '').trim(),
            agreeBylaws: true,
            agreePrivacy: !!data.agreePrivacy || mode === 'agree',
            agreeSms: !!data.agreeSms,
            campaignSlug: _campaignInfo ? _campaignInfo.slug : '',
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409) {
          if (existing) {
            const msg = document.getElementById('sjExistingMsg');
            if (msg) msg.textContent = json.error || '이미 가입된 이메일 또는 연락처입니다. 로그인 후 이어서 진행해 주세요.';
            existing.hidden = false;
          }
          return;
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || '가입 처리 실패');

        const d = unwrap(json);
        _member = d.member || d.user || null;
        try {
          if (window.SIREN_AUTH && typeof window.SIREN_AUTH.fetchMe === 'function') await window.SIREN_AUTH.fetchMe();
          if (typeof window.refreshHeaderAuthUI === 'function') window.refreshHeaderAuthUI();
        } catch (_) {}
        window.SIREN.toast(json.message || (mode === 'agree' ? '회칙 동의가 저장되었습니다' : '후원회원 가입이 완료되었습니다'));
        lockIdentity(_member);
        showStep(1);
      } catch (err) {
        console.error('[Donate] sponsor-join', err);
        window.SIREN.toast(err.message || '처리 중 오류가 발생했습니다');
      } finally {
        if (submit) { submit.disabled = false; submit.textContent = old; }
      }
    });

    /* 로그인으로 건너뛰기 — 로그인 창을 열고, 로그인되면 후원 창을 다시 연다 */
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#sjLoginBtn, #sjLoginLink');
      if (!btn) return;
      e.preventDefault();
      openLoginAndResume();
    });
  }

  function openLoginAndResume() {
    if (!window.SIREN) return;
    try { window.SIREN.closeModal('donateModal'); } catch (_) {}
    setTimeout(() => { try { window.SIREN.openModal('loginModal'); } catch (_) {} }, 200);

    if (_loginWatch) clearInterval(_loginWatch);
    const started = Date.now();
    _loginWatch = setInterval(() => {
      const auth = window.SIREN_AUTH;
      if (auth && auth.isLoggedIn()) {
        clearInterval(_loginWatch); _loginWatch = null;
        try { window.SIREN.closeModal('loginModal'); } catch (_) {}
        if (_campaignInfo) sessionStorage.setItem('siren_preselect_campaign', JSON.stringify(_campaignInfo));
        setTimeout(() => {
          const trigger = document.createElement('a');
          trigger.setAttribute('href', 'javascript:void(0)');
          trigger.setAttribute('data-action', 'open-modal');
          trigger.setAttribute('data-target', 'donateModal');
          trigger.style.display = 'none';
          document.body.appendChild(trigger);
          trigger.click();
          setTimeout(() => trigger.remove(), 100);
        }, 250);
      } else if (Date.now() - started > 5 * 60 * 1000) {
        clearInterval(_loginWatch); _loginWatch = null;
      }
    }, 500);
  }

  /* ───────── 모달 열릴 때 ───────── */
  function readPreselect() {
    try {
      const raw = sessionStorage.getItem('siren_preselect_campaign');
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && obj.id ? obj : null;
    } catch (_) { return null; }
  }

  function applyLanternUi() {
    const modal = document.getElementById('donateModal');
    if (!modal) return;
    const badge = document.getElementById('donateLanternBadge');
    const h2 = modal.querySelector('h2.serif');
    const sub = modal.querySelector('.modal-sub');
    const noticePay = document.getElementById('donateNoticePay');
    if (noticePay) {
      noticePay.hidden = !_lantern;
      /* 결제 단계 고지는 서버가 단계(KICC/포트원)에 맞춰 준다 — AM 랜딩 모달과 같은 글자 */
      if (_lantern && _lantern.notices && _lantern.notices.NOTICE_PAY) noticePay.textContent = _lantern.notices.NOTICE_PAY;
    }
    if (_lantern) {
      if (badge) { badge.textContent = '🕯️ ' + (_lantern.certificate?.campaignLabel || _campaignInfo?.title || '캠페인') + ' · 후원회원 회비'; badge.hidden = false; }
      if (h2) h2.textContent = (_campaignInfo?.title || '등불의 기적') + ' — 후원회원으로 함께하기';
      if (sub) sub.textContent = _lantern.headline || '';
      /* 정기(월 자동결제)가 첫 번째·기본 */
      const reg = modal.querySelector('input[name="dtype"][value="regular"]');
      if (reg) reg.checked = true;
    } else {
      if (badge) badge.hidden = true;
      if (h2 && _policyCache && _policyCache.modalTitle) h2.textContent = _policyCache.modalTitle;
      if (sub && _policyCache && _policyCache.modalSubtitle) sub.textContent = _policyCache.modalSubtitle;
    }
    applyAmountButtons(_policyCache || {});
    updatePayMethodVisibility();
  }

  function setupAutoFill() {
    document.addEventListener('click', async (e) => {
      const trigger = e.target.closest('[data-action="open-modal"][data-target="donateModal"]');
      if (!trigger) return;

      try { await loadPolicy(); } catch (_) {}

      setTimeout(async () => {
        const auth = window.SIREN_AUTH;
        const modal = document.getElementById('donateModal');
        if (!modal) return;

        /* 캠페인 페이지에서 온 선택(등불 규칙 포함) */
        const pre = readPreselect();
        _campaignInfo = pre;
        _lantern = pre && pre.extras && pre.extras.theme === 'lantern' ? pre.extras : null;

        if (_policyCache) {
          const h2 = modal.querySelector('h2.serif');
          const sub = modal.querySelector('.modal-sub');
          if (h2 && _policyCache.modalTitle) h2.textContent = _policyCache.modalTitle;
          if (sub && _policyCache.modalSubtitle) sub.textContent = _policyCache.modalSubtitle;
        }
        applyLanternUi();

        const nameInput = modal.querySelector('form[data-form="donate"] input[name="name"]');
        const phoneInput = modal.querySelector('form[data-form="donate"] input[name="phone"]');
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
        await routeSteps();
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
        if (e.target.name === 'dtype') {
          /* 탭을 바꾸면 그 탭의 기본 칸으로 초기화 */
          applyAmountButtons(_policyCache || {});
        }
      }
      /* 후원 모달 안에서 캠페인을 바꾸면 그 캠페인의 규칙(등불 가입 먼저·사다리)을 적용 */
      if (e.target.id === 'donateCampaignSelect') {
        const opt = e.target.selectedOptions && e.target.selectedOptions[0];
        let extras = null;
        try { extras = opt && opt.dataset.extras ? JSON.parse(opt.dataset.extras) : null; } catch (_) { extras = null; }
        if (e.target.value) {
          _campaignInfo = { id: Number(e.target.value), slug: opt?.dataset.slug || '', title: opt?.dataset.title || opt?.textContent?.trim() || '', extras };
        } else {
          _campaignInfo = null;
        }
        _lantern = extras && extras.theme === 'lantern' ? extras : null;
        applyLanternUi();
        routeSteps();
      }
    });
  }

  /* 랜딩(withwork)에서 넘어온 파라미터 — 같은 캠페인일 때만 결제 서버에 동봉 */
  function readSourceMeta() {
    try {
      const raw = sessionStorage.getItem('siren_am_return');
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.am_lp) return null;
      if (obj.t && Date.now() - obj.t > 6 * 60 * 60 * 1000) return null;
      if (_campaignInfo && obj.slug && obj.slug !== _campaignInfo.slug) return null;
      const meta = { am_lp: obj.am_lp };
      if (obj.am_anon) meta.am_anon = obj.am_anon;
      if (obj.gate) meta.gate = obj.gate;
      return meta;
    } catch (_) { return null; }
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

      /* 등불 캠페인(S5): 후원회원 가입(회칙 동의)이 먼저 */
      if (_lantern && _lantern.requireMembership && !isLoggedIn && !_member) {
        window.SIREN.toast('후원회원 가입을 먼저 완료해 주세요');
        await routeSteps();
        return;
      }

      if (!data.name || !data.phone) return window.SIREN.toast('이름과 연락처를 입력해 주세요');
      if (!amount || amount < 1000) return window.SIREN.toast('후원 금액은 1,000원 이상 입력해 주세요');
      if (amount > 100000000) return window.SIREN.toast('1회 최대 후원 금액은 1억원입니다');

      const email = (data.email || '').trim() || (auth?.user?.email || '') || (_member?.email || '');
      if (!email) return window.SIREN.toast('이메일을 입력해 주세요 (후원 안내 발송용)');
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
        const campaignId = campaignSelect?.value ? Number(campaignSelect.value) : (_campaignInfo ? Number(_campaignInfo.id) : null);
        const sourceMeta = readSourceMeta();

        if (dtype === 'onetime' && onetimeChoice === 'card') {
          await handleKiccOnetime({ name: data.name, phone: data.phone, email, amount, isAnonymous, isLoggedIn, campaignId, sourceMeta });
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
            name: data.name, phone: data.phone, email, amount, isAnonymous, campaignId, sourceMeta, timestamp: Date.now(),
          }));
          window.SIREN.toast('카드 등록 페이지로 이동합니다...');
          setTimeout(() => { location.href = '/billing-register.html'; }, 800);
          return;
        }

        if (dtype === 'regular' && payChoice === 'hyosung_cms') {
          await handleHyosungIntent({ name: data.name, phone: data.phone, email, amount, isAnonymous, campaignId, sourceMeta });
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
    const { name, phone, email, amount, isAnonymous, campaignId, sourceMeta } = opts;
    console.log('[Donate] KICC 일시 결제 시작', { name, amount, email });

    const body = { name, phone, email, amount, type: 'onetime', isAnonymous };
    /* 캠페인 식별자: 폼은 숫자 id만 보유 → 계약 키(campaignTag)에 문자열 id로 매핑.
       (B가 어느 키로 합산하는지 확정 시 단일화 — 그때까지 campaignId도 함께 전송) */
    if (campaignId) {
      body.campaignTag = String(campaignId);
      body.campaignId = campaignId;
    }
    if (sourceMeta) body.sourceMeta = sourceMeta;

    const res = await fetch('/api/donate-kicc-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    const d = unwrap(json);

    if (!res.ok || json.ok === false || !d.authPageUrl) {
      if (json.detail && json.detail.needMembership) { await routeSteps(); }
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
    const { name, phone, email, amount, isAnonymous, campaignId, sourceMeta } = opts;

    const res = await fetch('/api/donate-hyosung-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      /* 2026-09-06: 캠페인 합산 + 랜딩 파라미터 — 효성 명세 반영 때 등불이 켜진다 */
      body: JSON.stringify({ name, phone, email, amount, isAnonymous, campaignId: campaignId || null, sourceMeta: sourceMeta || undefined }),
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
    const step0 = document.querySelector('.donate-step[data-step="0"]');
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

    if (step0) step0.classList.remove('active');
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
            if (step0) step0.classList.remove('active');
            if (step1) step1.classList.add('active');
            if (step2) step2.classList.remove('active');
            if (bankBox) bankBox.style.display = 'none';
            const form = modal.querySelector('form[data-form="donate"]');
            if (form) form.reset();
            applyAmountButtons(_policyCache || {});
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
      const pre = readPreselect();
      /* 선택된 캠페인이 홈 노출 5건에 없으면(오래된 캠페인 등) 목록 맨 위에 붙인다 */
      if (pre && !list.some(c => Number(c.id) === Number(pre.id))) {
        list.unshift({ id: pre.id, slug: pre.slug, title: pre.title, type: 'fundraising', progressPercent: null, extras: pre.extras || null });
      }
      if (list.length === 0) { wrap.style.display = 'none'; return; }

      const TYPE_ICON = { fundraising: '', memorial: '', awareness: '' };
      select.innerHTML = '<option value="">캠페인 선택 안 함 (일반 후원)</option>' +
        list.map(c => {
          const icon = TYPE_ICON[c.type] || '';
          const pctText = c.progressPercent !== null && c.progressPercent !== undefined ? ` (${c.progressPercent}%)` : '';
          const safeTitle = String(c.title || '').replace(/[<>]/g, '');
          const extrasAttr = c.extras ? ` data-extras="${escapeText(JSON.stringify(c.extras))}"` : '';
          return `<option value="${c.id}" data-slug="${escapeText(c.slug || '')}" data-title="${escapeText(safeTitle)}"${extrasAttr}>${icon} ${safeTitle}${pctText}</option>`;
        }).join('');

      wrap.style.display = '';

      if (pre) {
        select.value = String(pre.id);
        sessionStorage.removeItem('siren_preselect_campaign');
      }
    } catch (e) {
      console.warn('[Donate] 캠페인 로드 실패', e);
      wrap.style.display = 'none';
    }
  }

  function init() {
    /* common.js(SIREN_PAGE_INIT)와 DOMContentLoaded 양쪽에서 불려도 리스너는 한 번만 단다
       (두 번 달리면 제출 한 번에 결제 준비가 두 번 나간다) */
    if (window.__sirenDonateInited) return;
    window.__sirenDonateInited = true;
    setupAmountButtons();
    setupAutoFill();
    setupTypeToggle();
    setupDonateForm();
    setupJoinForm();
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
