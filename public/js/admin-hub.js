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
        
        // 데모/베타 경고
        if (status === 'demo') {
          if (!confirm('⚠️ 이 서비스는 DEMO 버전입니다.\n실제 데이터가 저장되지 않습니다.\n\n계속하시겠습니까?')) {
            e.preventDefault();
            return;
          }
        } else if (status === 'beta') {
          toast(`${card.querySelector('.hub-card-title').textContent} — 베타 서비스입니다`);
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