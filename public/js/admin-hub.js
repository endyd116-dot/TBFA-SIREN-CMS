/* =========================================================
   SIREN — Admin Hub Controller
   ========================================================= */
(function() {
  'use strict';

  /* ============ API 헬퍼 ============ */
  async function api(path, options = {}) {
    try {
      const res = await fetch(path, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        credentials: 'include',
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[Hub API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ============ 토스트 ============ */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._hubToast);
    window._hubToast = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ============ 인증 확인 ============ */
  async function checkAuth() {
    const res = await api('/api/admin/me');
    if (!res.ok || !res.data?.data) {
      // 로그인 안 됨 → admin 로그인 페이지로
      location.href = '/admin.html';
      return null;
    }
    return res.data.data;
  }

  /* ============ 사용자 정보 표시 ============ */
  function renderUserInfo(admin) {
    const nameEl = document.getElementById('hubUserName');
    const greetEl = document.getElementById('hubGreeting');
    if (nameEl && admin.name) nameEl.textContent = admin.name;
    if (greetEl && admin.name) {
      const hour = new Date().getHours();
      const period = hour < 6 ? '새벽' : hour < 12 ? '오전' : hour < 18 ? '오후' : '저녁';
      greetEl.innerHTML = `${period} 인사드립니다, <strong style="color:#b8935a">${escapeHtml(admin.name)}</strong>님`;
    }
  }

  /* ============ SSO 위성앱 카드 권한 게이팅 ============
     진입 권한 없는 role에겐 카드 숨김(클릭 후 허브로 튕기는 혼란 방지).
     서버 canAccess 미러: super_admin 항상 허용, 미등록 키는 admin만 허용. */
  const SSO_CARD_FEATURE = { on: 'sso_on', si: 'sso_si', marketing: 'sso_marketing' };

  function ssoAllows(role, key, permMap) {
    if (role === 'super_admin') return true;
    const p = permMap[key];
    if (!p) return role === 'admin';           // 미등록(시드 전) 기본값: admin 허용·operator 차단
    if (role === 'admin') return !!p.adminAllowed;
    if (role === 'operator') return !!p.operatorAllowed;
    return false;
  }

  async function applyCardPermissions(admin) {
    const role = admin && admin.role;
    if (!role || role === 'super_admin') return; // 슈퍼어드민은 전체 표시
    let permMap = {};
    try {
      const res = await api('/api/admin-role-permissions');
      const rows = (res.data && (res.data.data && res.data.data.permissions || res.data.permissions)) || [];
      rows.forEach(r => { permMap[r.featureKey] = { adminAllowed: r.adminAllowed, operatorAllowed: r.operatorAllowed }; });
    } catch (_) { return; } // 조회 실패 시 카드 그대로(백엔드 게이트가 최종 차단)
    Object.keys(SSO_CARD_FEATURE).forEach(svc => {
      if (!ssoAllows(role, SSO_CARD_FEATURE[svc], permMap)) {
        const card = document.querySelector('.hub-card[data-service="' + svc + '"]');
        if (card) card.style.display = 'none';
      }
    });
  }

  /* ============ 통계 렌더링 ============ */
  function renderStats(kpi) {
    if (!kpi) return;
    
    const totalEl = document.getElementById('statTotalMembers');
    const donationEl = document.getElementById('statMonthDonation');
    const supportEl = document.getElementById('statPendingSupport');

    if (totalEl) totalEl.textContent = (kpi.totalMembers || 0).toLocaleString();
    
    if (donationEl) {
      const amount = kpi.monthlyDonation || 0;
      donationEl.textContent = amount >= 1_000_000 
        ? `₩${(amount / 1_000_000).toFixed(1)}M`
        : `₩${(amount / 10_000).toFixed(0)}만`;
    }
    
    if (supportEl) supportEl.textContent = `${kpi.pendingSupportCount || 0}건`;
  }

  /* ============ 로그아웃 ============ */
  async function handleLogout() {
    if (!confirm('로그아웃하시겠습니까?')) return;
    
    const btn = document.getElementById('btnHubLogout');
    if (btn) btn.disabled = true;

    try {
      await api('/api/admin/logout', { method: 'POST' });
      toast('로그아웃되었습니다');
      setTimeout(() => location.href = '/index.html', 600);
    } catch (e) {
      console.error('[Logout]', e);
      toast('로그아웃 실패');
      if (btn) btn.disabled = false;
    }
  }

  /* ============ 카드 클릭 처리 ============ */
  function setupCardClicks() {
    document.querySelectorAll('.hub-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const service = card.dataset.service;
        const status = card.dataset.status;
        
        // 데모 경고 (베타 → 정식 서비스 전환으로 베타 경고 제거)
        if (status === 'demo') {
          if (!confirm('⚠️ 이 서비스는 DEMO 버전입니다.\n실제 데이터가 저장되지 않습니다.\n\n계속하시겠습니까?')) {
            e.preventDefault();
            return;
          }
        } else if (status === 'active' && service === 'on') {
          // 함께워크 ON 정식 오픈 안내 (베타 경고 대체 알림)
          // 다른 서비스 카드는 새 탭(target="_blank")으로 열림 → 허브는 그대로 유지
          toast('함께워크 ON 정식 오픈! 🎉 새 탭에서 엽니다');
        }

        console.log('[Hub] Navigating to service:', service);
      });
    });
  }

  /* ============ 유틸 ============ */
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => 
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  /* ============ 초기화 ============ */
  async function init() {
    const userData = await checkAuth();
    if (!userData) return;

    renderUserInfo(userData.admin);
    renderStats(userData.kpi);
    setupCardClicks();
    await applyCardPermissions(userData.admin);

    // 로그아웃 버튼
    const logoutBtn = document.getElementById('btnHubLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();