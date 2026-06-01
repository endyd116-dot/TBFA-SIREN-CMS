/* ============================================================
   admin-notif-bell.js — 어드민/CMS GNB 우상단 알림 종 아이콘
   (2026-05-29 Swain 보고 — cms-tbfa·admin.html에 알림 진입점 부재 fix)

   동작:
   - 우상단(세션 타이머 왼쪽)에 🔔 종 아이콘 + 미확인 카운트 배지
   - /api/notifications/mine 호출(60초 주기)로 unreadCount·criticalCount 갱신
   - 클릭 시 /workspace-notifications.html 새 탭 열림(어드민 화면 작업 중단 X)
   - 미인증(401) 시 조용히 숨김(로그인 화면 등에서 폭주 방지)
   ============================================================ */
(function () {
  'use strict';
  var POLL_MS = 60 * 1000; // 60초마다 갱신 (배포 비용·서버 부담↓)
  var BTN_ID = 'adminNotifBell';
  var BADGE_ID = 'adminNotifBadge';
  var authed = false;
  var pollTimer = null;

  function ensureUI() {
    var b = document.getElementById(BTN_ID);
    if (b) return b;
    b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.title = '알림';
    /* 공통(외형) 스타일 */
    var common = [
      'align-items:center', 'gap:4px',
      'padding:6px 11px', 'border-radius:8px',
      'border:1px solid #e2e8f0', 'background:#f8fafc',
      'color:#475569', 'font-size:14px',
      'cursor:pointer', 'font-family:inherit'
    ];
    /* ★ 2026-06-01 fix: cms-tbfa 헤더(.cms-top-user)가 있으면 그 안 흐름에 삽입해
       세션 타이머(고정 위치 아님)와 겹치지 않게 한다. 없으면(admin.html 등) 기존 고정 배치. */
    var host = document.querySelector('.cms-top-user');
    if (host) {
      b.style.cssText = ['display:none', 'order:-1'].concat(common).join(';');
    } else {
      b.style.cssText = [
        'position:fixed', 'top:14px', 'right:130px', 'z-index:9998',
        'box-shadow:0 2px 8px rgba(0,0,0,.10)', 'display:none'
      ].concat(common).join(';');
    }
    b.innerHTML =
      '<span aria-hidden="true">🔔</span>' +
      '<span id="' + BADGE_ID + '" style="' +
        'display:none;background:#dc2626;color:#fff;font-size:11px;font-weight:700;' +
        'padding:1px 6px;border-radius:9px;line-height:1.4;min-width:18px;text-align:center' +
        '">0</span>';
    b.addEventListener('click', function () {
      window.open('/workspace-notifications.html', '_blank', 'noopener');
    });
    if (host) host.insertBefore(b, host.firstChild);
    else document.body.appendChild(b);
    return b;
  }

  async function poll() {
    var btn = ensureUI();
    var badge = document.getElementById(BADGE_ID);
    if (!btn || !badge) return;
    try {
      var res = await fetch('/api/notifications/mine?limit=1', {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        authed = false;
        btn.style.display = 'none';
        return;
      }
      if (!res.ok) return; // 일시 오류 — 다음 poll에서 재시도
      authed = true;
      var data = await res.json().catch(function () { return null; });
      var payload = (data && (data.data || data)) || {};
      var n = Number(payload.unreadCount || 0);
      var critical = Number(payload.criticalCount || 0);
      btn.style.display = 'inline-flex';
      if (n > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.style.background = critical > 0 ? '#dc2626' : '#f59e0b';
        btn.title = '알림 ' + n + '건' + (critical > 0 ? ' (중요 ' + critical + '건 포함)' : '');
      } else {
        badge.style.display = 'none';
        btn.title = '알림 없음';
      }
    } catch (_) {
      /* 네트워크 일시 오류 — 다음 poll에서 재시도 */
    }
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, POLL_MS);
    /* 페이지 가시화 시 즉시 갱신 (탭 전환 후 빠른 반영) */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
