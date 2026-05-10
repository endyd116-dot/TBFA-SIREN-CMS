/* ===========================================================
   통합 일반 회원 — 가입경로별 인원수 KPI 카드 채우기
   - 페이지 진입 시 1회 + 회원 추가/수정 후 갱신 가능 (window 이벤트)
   - 호출: GET /api/admin-members-source-kpi
   - 렌더링 대상: msKpiTotal / msKpiSiren / msKpiHyosung / msKpiManual / msKpiOther
   =========================================================== */
(function () {
  'use strict';

  let lastFetchedAt = 0;
  const CACHE_MS = 5000; // 5초 안 재호출 시 캐시

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (value == null) ? '-' : `${Number(value).toLocaleString()}명`;
  }

  function isMembersPageVisible() {
    const page = document.getElementById('page-members');
    if (!page) return false;
    const cs = window.getComputedStyle(page);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  async function loadKpi(force) {
    if (!force && Date.now() - lastFetchedAt < CACHE_MS) return;
    try {
      const r = await fetch('/api/admin-members-source-kpi', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });
      if (!r.ok) {
        console.warn('[source-kpi] HTTP', r.status);
        return;
      }
      const json = await r.json();
      const data = json?.data || {};
      const otherSum = (Number(data.event)  || 0)
                     + (Number(data.etc)    || 0)
                     + (Number(data.other)  || 0);
      setText('msKpiTotal',   data.total);
      setText('msKpiSiren',   data.siren);
      setText('msKpiHyosung', data.hyosung);
      setText('msKpiManual',  data.manual);
      setText('msKpiOther',   otherSum);
      lastFetchedAt = Date.now();
    } catch (err) {
      console.warn('[source-kpi] fetch error', err);
    }
  }

  function init() {
    /* 통합 일반 회원 페이지가 처음 보일 때 + 새로고침 버튼 클릭 시 */
    if (isMembersPageVisible()) loadKpi(true);

    /* hash 변경(탭 전환)으로 #members 진입 시 */
    window.addEventListener('hashchange', () => {
      if (location.hash === '#members' || location.hash === '') {
        setTimeout(() => loadKpi(false), 50);
      }
    });

    /* 새로고침 버튼 클릭 시 */
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('#btnRefreshMembers')) loadKpi(true);
    });

    /* 외부 갱신 트리거 — cms-tbfa.js가 회원 추가/수정 후 dispatch 가능 */
    window.addEventListener('members:changed', () => loadKpi(true));

    /* 첫 로드 보장 — 약간 지연 후 한 번 더 시도 (탭 라우팅 이후) */
    setTimeout(() => loadKpi(false), 300);
    setTimeout(() => loadKpi(false), 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
