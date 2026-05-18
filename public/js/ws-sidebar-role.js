/**
 * ws-sidebar-role.js — 워크스페이스 사이드바 super_admin 전용 메뉴 표시
 * 모든 workspace HTML에 공통 로드
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/admin/me?light=1', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.admin && d.admin.role === 'super_admin') {
          var el = document.getElementById('wsNavMilestoneSettings');
          if (el) el.style.display = '';
        }
      })
      .catch(function () {});
  });
})();
