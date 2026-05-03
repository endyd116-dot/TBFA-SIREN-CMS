/* =========================================================
   SIREN — auth.js (★ K-1 비번재설정 + K-2 인증/탈퇴 + K-6 정보수정/비번변경/정기해지)
   인증 API 클라이언트 + 헤더 동기화 + 폼 핸들러 + 채팅 알림
   ========================================================= */
(function () {
  'use strict';

  /* ------------ API 호출 헬퍼 ------------ */
  async function api(path, options = {}) {
    const opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'include',
    };
    if (options.body) opts.body = JSON.stringify(options.body);

    try {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (err) {
      console.error('[API Error]', path, err);
      return { status: 0, ok: false, data: { error: '네트워크 오류가 발생했습니다' } };
    }
  }

  /* ------------ 인증 상태 관리 ------------ */
  const Auth = {
    user: null,
    stats: null,

    async fetchMe() {
      const res = await api('/api/auth/me');
      if (res.ok && res.data.data) {
        this.user = res.data.data.user;
        this.stats = res.data.data.stats;
        return true;
      }
      this.user = null;
      this.stats = null;
      return false;
    },

    async signup(payload) {
      const res = await api('/api/auth/signup', { method: 'POST', body: payload });
      if (res.ok && res.data.data) {
        this.user = res.data.data.user;
      }
      return res;
    },

    async login(payload) {
      const res = await api('/api/auth/login', { method: 'POST', body: payload });
      if (res.ok && res.data.data) {
        this.user = res.data.data.user;
      }
      return res;
    },

    async logout() {
      await api('/api/auth/logout', { method: 'POST' });
      this.user = null;
      this.stats = null;
    },

    isLoggedIn() {
      return !!this.user;
    },
  };

  /* ------------ 채팅 미읽음 알림 (헤더 뱃지) ------------ */
  let _chatAlarmTimer = null;

  async function checkChatUnread() {
    if (!Auth.isLoggedIn()) return;
    try {
      const res = await api('/api/chat/mine');
      if (!res.ok || !res.data?.data?.rooms) return;

      const rooms = res.data.data.rooms;
      let totalUnread = 0;
      for (const r of rooms) {
        totalUnread += (r.unreadForUser || 0);
      }

      const badge = document.getElementById('chatNotifyBadge');
      if (badge) {
        if (totalUnread > 0) {
          badge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) {
      /* 조용히 실패 */
    }
  }

  function startChatAlarmPolling() {
    stopChatAlarmPolling();
    checkChatUnread();
    _chatAlarmTimer = setInterval(checkChatUnread, 30000);
  }

  function stopChatAlarmPolling() {
    if (_chatAlarmTimer) {
      clearInterval(_chatAlarmTimer);
      _chatAlarmTimer = null;
    }
  }

  /* ------------ 헤더 UI 동기화 ------------ */
  function syncHeader() {
    const topRight = document.querySelector('.top-right');
    if (!topRight) return;

    const loginLinks = topRight.querySelectorAll('a[data-action="open-modal"][data-target="loginModal"], a[data-action="open-modal"][data-target="signupModal"]');
    let userBox = document.getElementById('userBox');

    if (Auth.isLoggedIn()) {
      loginLinks.forEach(a => a.style.display = 'none');

      if (!userBox) {
        userBox = document.createElement('div');
        userBox.id = 'userBox';
        userBox.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:12.5px;';
        const langToggle = topRight.querySelector('.lang-toggle');
        if (langToggle) topRight.insertBefore(userBox, langToggle);
        else topRight.prepend(userBox);
      }
      const u = Auth.user;
      const typeLabel = ({regular:'후원회원',family:'유가족',volunteer:'봉사자',admin:'관리자'})[u.type] || u.type;
      userBox.innerHTML = `
        <a href="/mypage.html#consult" style="color:#fff;font-weight:500;position:relative;display:inline-flex;align-items:center;gap:4px;text-decoration:none" title="1:1 상담">
          💬<span id="chatNotifyBadge" style="display:none;position:absolute;top:-6px;right:-10px;background:#c5293a;color:#fff;font-size:9px;font-weight:700;min-width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;padding:0 4px">0</span>
        </a>
        <a href="/mypage.html" style="color:#fff;font-weight:500" title="마이페이지">${escapeHtml(u.name)} <span style="color:var(--gold,#b8935a);font-size:11px">(${typeLabel})</span></a>
        <button id="btnLogout" style="background:transparent;border:1px solid #2a2a2a;color:#bdbdbd;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer">로그아웃</button>
      `;
      userBox.querySelector('#btnLogout').addEventListener('click', async () => {
        await Auth.logout();
        if (window.SIREN) SIREN.toast('로그아웃되었습니다');
        syncHeader();
        if (['/mypage.html'].includes(location.pathname)) {
          setTimeout(() => location.href = '/index.html', 500);
        }
      });

      startChatAlarmPolling();
    } else {
      loginLinks.forEach(a => a.style.display = '');
      if (userBox) userBox.remove();
      stopChatAlarmPolling();
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ------------ 폼 제출 핸들러 (로그인/회원가입/비번재설정 요청) ------------ */
  function setupAuthForms() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const type = form.dataset.form;
      if (type !== 'login' && type !== 'signup' && type !== 'password-reset-request') return;

      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());

      const btn = form.querySelector('button[type="submit"]');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

      try {
        let res;
        if (type === 'login') {
          res = await Auth.login({
            email: data.email,
            password: data.password,
            remember: !!data.remember,
          });
        } else if (type === 'signup') {
          const checkboxes = form.querySelectorAll('input[type="checkbox"][required]');
          const agreeAll = Array.from(checkboxes).every(c => c.checked);
          if (!agreeAll) throw new Error('이용약관에 동의해주세요');

          res = await Auth.signup({
            email: data.email,
            password: data.password,
            name: data.name,
            phone: data.phone,
            memberType: data.memberType || 'regular',
            agree: true,
          });
        } else if (type === 'password-reset-request') {
          res = await api('/api/auth/password-reset-request', {
            method: 'POST',
            body: { email: data.email },
          });
        }

        if (res.ok) {
          window.SIREN.toast(res.data.message || '완료되었습니다');

          if (type === 'login') {
            window.SIREN.closeModal('loginModal');
            form.reset();
            syncHeader();
          } else if (type === 'signup') {
            window.SIREN.closeModal('signupModal');
            form.reset();
            syncHeader();
          } else if (type === 'password-reset-request') {
            window.SIREN.closeModal('passwordResetModal');
            form.reset();
          }
        } else {
          const msg = res.data?.error || '처리 중 오류가 발생했습니다';
          window.SIREN.toast(msg);
          if (res.data?.detail) console.warn('[Validation]', res.data.detail);
        }
      } catch (err) {
        window.SIREN.toast(err.message || '처리 중 오류가 발생했습니다');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ------------ 마이페이지 데이터 주입 ------------ */
  async function injectMypage() {
    if (!document.body.dataset.page || document.body.dataset.page !== 'mypage') return;
    if (!Auth.isLoggedIn()) {
      window.SIREN.toast('로그인이 필요합니다');
      setTimeout(() => location.href = '/index.html', 800);
      return;
    }

    const avatar = document.querySelector('.mp-avatar');
    if (avatar) avatar.textContent = (Auth.user.name || '?').charAt(0);
    const nameEl = document.querySelector('.mp-user strong');
    if (nameEl) nameEl.textContent = `${Auth.user.name}님`;
    const typeEl = document.querySelector('.mp-user span');
    if (typeEl) {
      const map = { regular:'정기 후원 회원', family:'유가족 회원', volunteer:'봉사자', admin:'관리자' };
      typeEl.textContent = map[Auth.user.type] || '회원';
    }

    /* ★ K-2: 이메일 인증 상태 배너 갱신 */
    updateEmailVerifyBanner();

    /* ★ K-6: 폼 필드 채우기 */
    fillProfileForm();

    await refreshDonations();
    await refreshSupport();
  }

  /* ★ K-6: 회원 정보 폼 채우기 */
  function fillProfileForm() {
    if (!Auth.user) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    const cb = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    set('mpName', Auth.user.name);
    set('mpEmail', Auth.user.email);
    set('mpPhone', Auth.user.phone);
    cb('mpAgreeEmail', Auth.user.agreeEmail !== false);
    cb('mpAgreeSms', Auth.user.agreeSms !== false);
    cb('mpAgreeMail', Auth.user.agreeMail === true);
  }

  /* ------------ ★ K-2: 이메일 인증 상태 배너 ------------ */
  function updateEmailVerifyBanner() {
    const banner = document.getElementById('emailVerifyBanner');
    if (!banner || !Auth.user) return;

    if (Auth.user.emailVerified) {
      banner.classList.add('verified');
      banner.innerHTML = `
        <div class="icon">✅</div>
        <div class="text">
          <strong>이메일 인증 완료</strong><br />
          모든 보안 기능을 안전하게 이용하실 수 있습니다.
        </div>
      `;
      banner.style.display = 'flex';
    } else {
      banner.classList.remove('verified');
      banner.innerHTML = `
        <div class="icon">✉️</div>
        <div class="text">
          <strong>이메일 인증이 필요합니다</strong><br />
          비밀번호 찾기 등 보안 기능을 이용하려면 이메일 인증을 완료해 주세요.
        </div>
        <button type="button" id="btnResendVerify">인증 메일 재발송</button>
      `;
      banner.style.display = 'flex';
    }
  }

  /* ------------ ★ K-2: 인증 메일 재발송 ------------ */
  function setupResendVerifyHandler() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('#btnResendVerify');
      if (!btn) return;
      e.preventDefault();

      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '발송 중...';

      try {
        const res = await api('/api/auth/email-verify-request', { method: 'POST' });
        if (res.ok) {
          window.SIREN.toast(res.data.message || '인증 메일이 발송되었습니다');
        } else {
          window.SIREN.toast(res.data?.error || '메일 발송에 실패했습니다');
        }
      } catch (err) {
        window.SIREN.toast('네트워크 오류가 발생했습니다');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  }

  /* ------------ ★ K-2: 회원 탈퇴 ------------ */
  function setupWithdrawHandler() {
    document.addEventListener('change', (e) => {
      if (e.target.id !== 'withdrawConfirm') return;
      const btn = document.getElementById('btnWithdraw');
      if (btn) btn.disabled = !e.target.checked;
    });

    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.id !== 'withdrawForm') return;
      e.preventDefault();

      const password = (document.getElementById('withdrawPassword') || {}).value || '';
      const reason = (document.getElementById('withdrawReason') || {}).value || '';
      const confirmed = (document.getElementById('withdrawConfirm') || {}).checked;

      if (!password) return window.SIREN.toast('비밀번호를 입력해 주세요');
      if (!confirmed) return window.SIREN.toast('탈퇴 확인 체크박스를 선택해 주세요');

      const finalConfirm = confirm(
        '정말 탈퇴하시겠습니까?\n\n' +
        '• 탈퇴 후 복구가 불가능합니다\n' +
        '• 같은 이메일로 재가입할 수 없습니다\n' +
        '• 즉시 로그아웃됩니다\n\n' +
        '계속하시려면 [확인]을 눌러주세요.'
      );
      if (!finalConfirm) return;

      const btn = document.getElementById('btnWithdraw');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

      try {
        const res = await api('/api/auth/withdraw', {
          method: 'POST',
          body: { password, reason: reason.trim() || undefined },
        });

        if (res.ok) {
          window.SIREN.toast(res.data.message || '탈퇴가 완료되었습니다');
          Auth.user = null;
          Auth.stats = null;
          stopChatAlarmPolling();
          setTimeout(() => { location.href = '/index.html'; }, 2000);
        } else {
          window.SIREN.toast(res.data?.error || '탈퇴 처리 중 오류가 발생했습니다');
          if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
      } catch (err) {
        window.SIREN.toast('네트워크 오류가 발생했습니다');
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ------------ ★ K-6: 회원 정보 저장 ------------ */
  function setupProfileFormHandler() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.id !== 'profileForm') return;
      e.preventDefault();

      const name = (document.getElementById('mpName')?.value || '').trim();
      const phone = (document.getElementById('mpPhone')?.value || '').trim();
      const agreeEmail = !!document.getElementById('mpAgreeEmail')?.checked;
      const agreeSms = !!document.getElementById('mpAgreeSms')?.checked;
      const agreeMail = !!document.getElementById('mpAgreeMail')?.checked;

      if (name.length < 2) return window.SIREN.toast('이름은 2자 이상이어야 합니다');

      const btn = document.getElementById('btnProfileSave');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

      try {
        const res = await api('/api/auth/me', {
          method: 'PATCH',
          body: { name, phone, agreeEmail, agreeSms, agreeMail },
        });

        if (res.ok) {
          window.SIREN.toast(res.data?.message || '저장되었습니다');
          /* Auth 캐시 갱신 */
          if (res.data?.data?.user) {
            Auth.user = { ...Auth.user, ...res.data.data.user };
            syncHeader();
          }
        } else {
          window.SIREN.toast(res.data?.error || '저장 실패');
        }
      } catch (err) {
        window.SIREN.toast('네트워크 오류가 발생했습니다');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ------------ ★ K-6: 비밀번호 변경 ------------ */
  function setupPasswordFormHandler() {
    /* 새 비번 일치 실시간 표시 */
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'mpNewPw' && e.target.id !== 'mpNewPw2') return;
      const pw1 = document.getElementById('mpNewPw')?.value || '';
      const pw2 = document.getElementById('mpNewPw2')?.value || '';
      const matchEl = document.getElementById('mpPwMatch');
      if (!matchEl) return;
      if (!pw2) { matchEl.textContent = ''; return; }
      if (pw1 === pw2) {
        matchEl.textContent = '✓ 일치합니다';
        matchEl.style.color = '#10b981';
      } else {
        matchEl.textContent = '✗ 일치하지 않습니다';
        matchEl.style.color = '#dc2626';
      }
    });

    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (form.id !== 'passwordForm') return;
      e.preventDefault();

      const currentPassword = document.getElementById('mpCurrentPw')?.value || '';
      const newPassword = document.getElementById('mpNewPw')?.value || '';
      const newPassword2 = document.getElementById('mpNewPw2')?.value || '';

      if (!currentPassword) return window.SIREN.toast('현재 비밀번호를 입력해 주세요');
      if (newPassword.length < 8) return window.SIREN.toast('새 비밀번호는 8자 이상이어야 합니다');
      if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        return window.SIREN.toast('새 비밀번호는 영문과 숫자를 모두 포함해야 합니다');
      }
      if (newPassword !== newPassword2) return window.SIREN.toast('새 비밀번호가 일치하지 않습니다');
      if (currentPassword === newPassword) return window.SIREN.toast('새 비밀번호는 현재와 달라야 합니다');

      const btn = document.getElementById('btnPasswordSave');
      const oldText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '변경 중...'; }

      try {
        const res = await api('/api/auth/password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });

        if (res.ok) {
          window.SIREN.toast(res.data?.message || '비밀번호가 변경되었습니다');
          form.reset();
          const matchEl = document.getElementById('mpPwMatch');
          if (matchEl) matchEl.textContent = '';
        } else {
          window.SIREN.toast(res.data?.error || '비밀번호 변경 실패');
        }
      } catch (err) {
        window.SIREN.toast('네트워크 오류가 발생했습니다');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ------------ ★ K-6: 정기 후원 해지 (행 단위) ------------ */
  function setupDonationCancelHandler() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cancel-donation]');
      if (!btn) return;
      e.preventDefault();

      const id = Number(btn.dataset.cancelDonation);
      if (!id) return;

      const confirmed = confirm(
        '이 정기 후원을 해지하시겠습니까?\n\n' +
        '• 다음 결제부터 자동 청구가 중단됩니다\n' +
        '• 이미 처리된 결제분은 영향을 받지 않습니다\n' +
        '• 영수증 발급은 그대로 가능합니다\n\n' +
        '해지 후 복구는 새로 가입하셔야 합니다.'
      );
      if (!confirmed) return;

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = '해지 중...';

      try {
        const res = await api('/api/donations/cancel', {
          method: 'POST',
          body: { id },
        });

        if (res.ok) {
          window.SIREN.toast(res.data?.message || '정기 후원이 해지되었습니다');
          await refreshDonations();
        } else {
          window.SIREN.toast(res.data?.error || '해지 실패');
          btn.disabled = false;
          btn.textContent = oldText;
        }
      } catch (err) {
        window.SIREN.toast('네트워크 오류가 발생했습니다');
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });

    /* 안내 버튼 (탭 상단 "정기 후원 해지 안내") */
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#btnCancelRegular')) return;
      e.preventDefault();
      window.SIREN.toast('해지하실 정기 후원의 행에서 "🚫 해지" 버튼을 클릭해 주세요');
    });
  }

  /* ------------ 후원 내역 새로고침 ------------ */
  async function refreshDonations() {
    const res = await api('/api/donations/mine');
    if (!res.ok || !res.data?.data) return;

    const { list, stats } = res.data.data;

    const panel = document.querySelector('.mp-panel[data-mp-panel="donations"]');
    if (panel) {
      const kpiValues = panel.querySelectorAll('.kpi-value');
      if (kpiValues[0]) kpiValues[0].textContent = (stats.totalAmount || 0).toLocaleString() + '원';
      if (kpiValues[1]) kpiValues[1].textContent = (stats.regularCount || 0) + '회';
      if (kpiValues[2]) {
        kpiValues[2].textContent = stats.totalCount > 0 ? '발급 가능' : '내역 없음';
        kpiValues[2].style.color = stats.totalCount > 0 ? 'var(--success)' : 'var(--text-3)';
      }
    }

    const tbody = panel?.querySelector('table.tbl tbody');
    if (tbody) {
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:40px">아직 후원 내역이 없습니다 🎗</td></tr>`;
      } else {
        const typeMap = { regular: '정기 후원', onetime: '일시 후원' };
        const payMap = { cms: 'CMS', card: '카드', bank: '계좌이체' };
        const statusMap = {
          completed: '<span class="badge b-success">완료</span>',
          pending: '<span class="badge b-warn">대기</span>',
          failed: '<span class="badge b-danger">실패</span>',
          cancelled: '<span class="badge b-mute">취소</span>',
          refunded: '<span class="badge b-mute">환불</span>',
        };
        tbody.innerHTML = list.map(d => {
          /* ★ K-6: 정기 후원 + 활성 상태일 때만 해지 버튼 표시 */
          const canCancel = d.type === 'regular' && (d.status === 'completed' || d.status === 'pending');
          const receiptCell = d.status === 'completed'
            ? `<a class="btn-link" href="/api/donation-receipt?id=${d.id}" target="_blank" rel="noopener" title="${d.receiptNumber ? '영수증번호: ' + escapeHtml(d.receiptNumber) : 'PDF 영수증 발급/열기'}" style="text-decoration:none;color:var(--brand);font-weight:600">📄 발급</a>`
            : canCancel
              ? `<button type="button" class="btn-link" data-cancel-donation="${d.id}" style="color:var(--danger);background:none;border:none;cursor:pointer;font-weight:600;padding:0">🚫 해지</button>`
              : '<span style="color:var(--text-3);font-size:12px">—</span>';
          /* 정기 + 완료일 경우 영수증 + 해지 둘 다 표시 */
          const actionCell = (d.status === 'completed' && canCancel)
            ? `<a class="btn-link" href="/api/donation-receipt?id=${d.id}" target="_blank" rel="noopener" title="${d.receiptNumber ? '영수증번호: ' + escapeHtml(d.receiptNumber) : 'PDF 영수증 발급/열기'}" style="text-decoration:none;color:var(--brand);font-weight:600;margin-right:8px">📄 발급</a><button type="button" class="btn-link" data-cancel-donation="${d.id}" style="color:var(--danger);background:none;border:none;cursor:pointer;font-weight:600;padding:0;font-size:12.5px">🚫 해지</button>`
            : receiptCell;

          return `
            <tr>
              <td>${formatDate(d.createdAt)}</td>
              <td>${typeMap[d.type] || d.type}</td>
              <td>${(d.amount || 0).toLocaleString()}원</td>
              <td>${payMap[d.payMethod] || d.payMethod}</td>
              <td>${statusMap[d.status] || d.status}</td>
              <td>${actionCell}</td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }

  /* ------------ 지원 신청 내역 새로고침 ------------ */
  async function refreshSupport() {
    const res = await api('/api/support/mine');
    if (!res.ok || !res.data?.data) return;

    const { list } = res.data.data;
    const panel = document.querySelector('.mp-panel[data-mp-panel="support"]');
    const tbody = panel?.querySelector('table.tbl tbody');
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:40px">아직 신청 내역이 없습니다</td></tr>`;
      return;
    }

    const catMap = { counseling:'심리상담', legal:'법률자문', scholarship:'장학사업', other:'기타' };
    const statusMap = {
      submitted: '<span class="badge b-info">접수</span>',
      reviewing: '<span class="badge b-warn">서류검토</span>',
      supplement: '<span class="badge b-danger">보완요청</span>',
      matched: '<span class="badge b-info">매칭완료</span>',
      in_progress: '<span class="badge b-warn">진행중</span>',
      completed: '<span class="badge b-success">완료</span>',
      rejected: '<span class="badge b-mute">반려</span>',
    };

    tbody.innerHTML = list.map(s => `
      <tr>
        <td>${escapeHtml(s.requestNo)}</td>
        <td>${catMap[s.category] || s.category}</td>
        <td>${escapeHtml(s.title || '').slice(0,40)}</td>
        <td>${formatDate(s.createdAt)}</td>
        <td>${statusMap[s.status] || s.status}</td>
      </tr>
    `).join('');
  }

  window.SIREN_REFRESH_SUPPORT = refreshSupport;
  window.SIREN_REFRESH_MYPAGE = refreshDonations;

  /* ------------ 초기화 ------------ */
  let _initExecuted = false;

  async function init() {
    if (_initExecuted) return;
    _initExecuted = true;

    setupAuthForms();
    setupResendVerifyHandler();      /* ★ K-2 */
    setupWithdrawHandler();          /* ★ K-2 */
    setupProfileFormHandler();       /* ★ K-6 */
    setupPasswordFormHandler();      /* ★ K-6 */
    setupDonationCancelHandler();    /* ★ K-6 */

    await Auth.fetchMe();
    syncHeader();

    if (document.body.dataset.page === 'mypage') {
      await injectMypage();
    }
  }

  window.SIREN_AUTH = Auth;
  window.SIREN_AUTH_INIT = init;

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  document.addEventListener('partials:loaded', () => init());

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 500);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 500);
    });
  }
})();