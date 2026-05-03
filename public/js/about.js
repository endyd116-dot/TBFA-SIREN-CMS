/* =========================================================
   SIREN — about.js (★ Phase M-11)
   - about.html의 [data-cp-key] 영역을 DB에서 로드해 채움
   ========================================================= */
(function () {
  'use strict';

  async function loadAbout() {
    const placeholders = document.querySelectorAll('[data-cp-key]');
    if (placeholders.length === 0) return;

    /* 모든 키 한 번에 조회 */
    const keys = Array.from(placeholders).map((el) => el.dataset.cpKey).filter(Boolean);
    const uniqKeys = [...new Set(keys)];

    try {
      const res = await fetch('/api/content-pages?keys=' + encodeURIComponent(uniqKeys.join(',')), {
        credentials: 'include',
      });
      const json = await res.json();

      if (!res.ok || !json.ok || !json.data?.pages) {
        placeholders.forEach((el) => {
          el.removeAttribute('data-cp-loading');
          el.innerHTML = '<p style="color:var(--text-3);font-size:13px">콘텐츠를 불러오지 못했습니다</p>';
        });
        return;
      }

      const pagesMap = json.data.pages || {};

      placeholders.forEach((el) => {
        const key = el.dataset.cpKey;
        el.removeAttribute('data-cp-loading');
        const page = pagesMap[key];
        if (page && page.contentHtml) {
          el.innerHTML = page.contentHtml;
        } else {
          el.innerHTML = '<p style="color:var(--text-3);font-size:13px">(준비 중)</p>';
        }
      });
    } catch (e) {
      console.error('[about] load error', e);
      placeholders.forEach((el) => {
        el.removeAttribute('data-cp-loading');
        el.innerHTML = '<p style="color:var(--danger);font-size:13px">네트워크 오류</p>';
      });
    }
  }

  function init() {
    if (document.body.dataset.page !== 'about') return;
    loadAbout();
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