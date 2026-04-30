/* =========================================================
   SIREN — auth.js
   인증 API 클라이언트 + 헤더 동기화 + 폼 핸들러
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

  /* ------------ 헤더 UI 동기화 (로그인/회원가입 영역) ------------ */
  function syncHeader() {
    const topRight = document.querySelector('.top-right');
    if (!topRight) return;

    const loginLinks = topRight.querySelectorAll('a[data-action="open-modal"][data-target="loginModal"], a[data-action="open-modal"][data-target="signupModal"]');
    let userBox = document.getElementById('userBox');

    if (Auth.isLoggedIn()) {
      // 로그인/회원가입 링크 숨김
      loginLinks.forEach(a => a.style.display = 'none');

      // 사용자 박스 추가/갱신
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
        <a href="/mypage.html" style="color:#fff;font-weight:500" title="마이페이지">${escapeHtml(u.name)} <span style="color:var(--gold,#b8935a);font-size:11px">(${typeLabel})</span></a>
        <button id="btnLogout" style="background:transparent;border:1px solid #2a2a2a;color:#bdbdbd;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer">로그아웃</button>
      `;
      userBox.querySelector('#btnLogout').addEventListener('click', async () => {
        await Auth.logout();
        if (window.SIREN) SIREN.toast('로그아웃되었습니다');
        syncHeader();
        // 마이페이지/관리자였으면 홈으로 이동
        if (['/mypage.html'].includes(location.pathname)) {
          setTimeout(() => location.href = '/index.html', 500);
        }
      });
    } else {
      // 비로그인 상태 — 로그인/회원가입 다시 보이기
      loginLinks.forEach(a => a.style.display = '');
      if (userBox) userBox.remove();
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ------------ 폼 제출 핸들러 (로그인/회원가입) ------------ */
  function setupAuthForms() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      const type = form.dataset.form;
      if (type !== 'login' && type !== 'signup') return;

      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());

      // 제출 버튼 잠금
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
        } else {
          // signup
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
        }

        if (res.ok) {
          window.SIREN.toast(res.data.message || '완료되었습니다');
          window.SIREN.closeModal(type === 'login' ? 'loginModal' : 'signupModal');
          form.reset();
          syncHeader();
        } else {
          const msg = res.data?.error || '처리 중 오류가 발생했습니다';
          window.SIREN.toast(msg);
          // 검증 에러 상세 출력 (콘솔)
          if (res.data?.detail) console.warn('[Validation]', res.data.detail);
        }
      } catch (err) {
        window.SIREN.toast(err.message || '처리 중 오류가 발생했습니다');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
      }
    });
  }

  /* ------------ 마이페이지 데이터 주입 (있을 때만) ------------ */
    /* ------------ 마이페이지 데이터 주입 (있을 때만) ------------ */
  async function injectMypage() {
    if (!document.body.dataset.page || document.body.dataset.page !== 'mypage') return;
    if (!Auth.isLoggedIn()) {
      window.SIREN.toast('로그인이 필요합니다');
      setTimeout(() => location.href = '/index.html', 800);
      return;
    }

    /* 사용자 정보 표시 */
    const avatar = document.querySelector('.mp-avatar');
    if (avatar) avatar.textContent = (Auth.user.name || '?').charAt(0);
    const nameEl = document.querySelector('.mp-user strong');
    if (nameEl) nameEl.textContent = `${Auth.user.name}님`;
    const typeEl = document.querySelector('.mp-user span');
    if (typeEl) {
      const map = { regular:'정기 후원 회원', family:'유가족 회원', volunteer:'봉사자', admin:'관리자' };
      typeEl.textContent = map[Auth.user.type] || '회원';
    }

    /* 후원 내역 로드 */
    await refreshDonations();
    /* 지원 신청 내역 로드 */         
    await refreshSupport();

  }

  /* 후원 내역 새로고침 (전역 노출) */
  async function refreshDonations() {
    const res = await api('/api/donations/mine');
    if (!res.ok || !res.data?.data) return;

    const { list, stats } = res.data.data;

    /* KPI 카드 */
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

    /* 테이블 갱신 */
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
        tbody.innerHTML = list.map(d => `
          <tr>
            <td>${formatDate(d.createdAt)}</td>
            <td>${typeMap[d.type] || d.type}</td>
            <td>${(d.amount || 0).toLocaleString()}원</td>
            <td>${payMap[d.payMethod] || d.payMethod}</td>
            <td>${statusMap[d.status] || d.status}</td>
            <td>${d.status === 'completed'
              ? `<button class="btn-link" data-demo-action="receipt" data-demo-message="영수증 PDF를 발급합니다">발급</button>`
              : '<span style="color:var(--text-3);font-size:12px">—</span>'}
            </td>
          </tr>
        `).join('');
      }
    }
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }
  /* 지원 신청 내역 새로고침 (전역 노출) */
  async function refreshSupport() {
    const res = await api('/api/support/mine');
    if (!res.ok || !res.data?.data) return;

    const { list } = res.data.data;
    const panel = document.querySelector('.mp-panel[data-mp-panel="consult"]');
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
  /* 전역 노출 (donate.js가 후원 완료 시 호출) */
  window.SIREN_REFRESH_MYPAGE = refreshDonations;

  /* ------------ 초기화 ------------ */
  async function init() {
    setupAuthForms();
    await Auth.fetchMe();   // 세션 확인
    syncHeader();           // 헤더 UI 갱신
    injectMypage();         // 마이페이지면 데이터 주입
  }

  /* common.js의 SIREN_PAGE_INIT 훅에 합류 */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  /* 전역 노출 */
  window.SIREN_AUTH = Auth;
})();