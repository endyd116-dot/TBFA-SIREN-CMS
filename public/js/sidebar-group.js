/* ===========================================================
   사이드바 그룹 토글 — 1뎁스 클릭 시 2뎁스 펼침/접힘
   - 1뎁스: [data-sidebar-group="키"]
   - 2뎁스: [data-sidebar-submenu="키"]
   - 기본 접힘 (HTML에서 style="display:none" + aria-hidden="true")
   - 같은 페이지 안에서 여러 그룹 가능
   =========================================================== */
(function () {
  'use strict';

  function toggleGroup(triggerEl) {
    var key = triggerEl.getAttribute('data-sidebar-group');
    if (!key) return;
    var submenu = document.querySelector('[data-sidebar-submenu="' + key + '"]');
    if (!submenu) return;
    var isOpen = triggerEl.getAttribute('aria-expanded') === 'true';
    var nextOpen = !isOpen;
    triggerEl.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    submenu.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    submenu.style.display = nextOpen ? '' : 'none';
  }

  function init() {
    document.addEventListener('click', function (ev) {
      var trigger = ev.target.closest('[data-sidebar-group]');
      if (!trigger) return;
      ev.preventDefault();
      toggleGroup(trigger);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
