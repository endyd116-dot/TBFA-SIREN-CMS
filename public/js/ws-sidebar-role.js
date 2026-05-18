/**
 * ws-sidebar-role.js — 워크스페이스 사이드바 super_admin 전용 메뉴 표시
 * 모든 workspace HTML에 공통 로드
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/admin/me?light=1', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var admin = (d && d.data && d.data.admin) || (d && d.admin) || {};
        if (admin.role === 'super_admin') {
          var ms = document.getElementById('wsNavMilestoneSettings');
          if (ms) ms.style.display = '';
          var att = document.getElementById('wsNavAttendanceSettings');
          if (att) att.style.display = '';
        }
      })
      .catch(function () {});
  });
})();
