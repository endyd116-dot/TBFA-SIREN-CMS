/* ============================================================
   admin-notif-bell.js — 어드민/CMS GNB 우상단 알림 종 + 드롭다운
   (2026-05-29 신설 · 2026-06-03 드롭다운화 — Swain: 벨 누르면 새 탭/워크스페이스로
    이동하지 말고 현재 화면 위에 작은 알림창. '전체보기'만 전체 페이지로.)

   동작:
   - 우상단(세션 타이머 왼쪽) + 미확인 배지 (workspace_notifications 통합 카운트, 60초)
   - 클릭 → 현재 화면 위 작은 드롭다운(최근 8건). 항목 클릭 → 읽음 + 해당 링크 이동.
     하단 [모두 읽음] / [전체보기→/workspace-notifications.html]
   - 미인증(401/403) 시 조용히 숨김
   ============================================================ */
(function () {
  'use strict';
  var POLL_MS = 60 * 1000;
  var BTN_ID = 'adminNotifBell';
  var BADGE_ID = 'adminNotifBadge';
  var PANEL_ID = 'adminNotifPanel';
  var LIST_LIMIT = 8;
  var pollTimer = null;
  var panelOpen = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var t = new Date(ts).getTime();
    if (!isFinite(t)) return '';
    var diff = Date.now() - t;
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '일 전';
    try { return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }); }
    catch (_) { return ''; }
  }

  function ensureUI() {
    var b = document.getElementById(BTN_ID);
    if (b) return b;
    b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.title = '알림';
    var common = [
      'align-items:center', 'gap:4px', 'padding:6px 11px', 'border-radius:8px',
      'border:1px solid #e2e8f0', 'background:#f8fafc', 'color:#475569',
      'font-size:14px', 'cursor:pointer', 'font-family:inherit'
    ];
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
      '<span aria-hidden="true"></span>' +
      '<span id="' + BADGE_ID + '" style="' +
        'display:none;background:#dc2626;color:#fff;font-size:11px;font-weight:700;' +
        'padding:1px 6px;border-radius:9px;line-height:1.4;min-width:18px;text-align:center' +
        '">0</span>';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    if (host) host.insertBefore(b, host.firstChild);
    else document.body.appendChild(b);
    return b;
  }

  function ensurePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) return p;
    p = document.createElement('div');
    p.id = PANEL_ID;
    p.style.cssText = [
      'position:fixed', 'z-index:10000', 'display:none', 'width:340px',
      'max-height:460px', 'background:#fff', 'border:1px solid #e2e8f0',
      'border-radius:12px', 'box-shadow:0 8px 28px rgba(0,0,0,.16)',
      'overflow:hidden', 'font-family:inherit', 'color:#1e293b'
    ].join(';');
    p.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #f1f5f9">' +
        '<strong style="font-size:13.5px">알림</strong>' +
        '<button type="button" id="anpMarkAll" style="background:none;border:none;color:#2563eb;font-size:12px;cursor:pointer;font-family:inherit">모두 읽음</button>' +
      '</div>' +
      '<div id="anpList" style="max-height:340px;overflow-y:auto"></div>' +
      '<div style="border-top:1px solid #f1f5f9;padding:9px 14px;text-align:center">' +
        '<button type="button" id="anpViewAll" style="background:none;border:none;color:#475569;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit">전체보기 →</button>' +
      '</div>';
    document.body.appendChild(p);
    p.addEventListener('click', function (e) { e.stopPropagation(); });
    p.querySelector('#anpViewAll').addEventListener('click', function () {
      window.location.href = '/workspace-notifications.html';
    });
    p.querySelector('#anpMarkAll').addEventListener('click', async function () {
      try {
        await fetch('/api/admin-workspace-notifications', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
      } catch (_) {}
      await loadPanel();
      poll();
    });
    return p;
  }

  function positionPanel() {
    var btn = document.getElementById(BTN_ID);
    var p = document.getElementById(PANEL_ID);
    if (!btn || !p) return;
    var r = btn.getBoundingClientRect();
    var width = 340;
    var left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    p.style.top = (r.bottom + 6) + 'px';
    p.style.left = left + 'px';
  }

  async function loadPanel() {
    var list = document.getElementById('anpList');
    if (!list) return;
    list.innerHTML = '<div style="padding:22px;text-align:center;color:#94a3b8;font-size:12.5px">불러오는 중…</div>';
    var items = [];
    try {
      var res = await fetch('/api/admin-workspace-notifications?limit=' + LIST_LIMIT, {
        credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        var data = await res.json().catch(function () { return null; });
        var payload = (data && (data.data || data)) || {};
        items = payload.items || [];
      }
    } catch (_) {}
    if (!items.length) {
      list.innerHTML = '<div style="padding:26px;text-align:center;color:#94a3b8;font-size:12.5px">새 알림이 없습니다</div>';
      return;
    }
    list.innerHTML = items.map(function (n) {
      var unread = !n.readAt;
      var url = n.actionUrl || n.linkUrl || '';
      return '' +
        '<div class="anp-item" data-id="' + n.id + '" data-source="' + (n.source || 'ws') + '" data-url="' + esc(url) + '"' +
          ' style="display:flex;gap:9px;padding:11px 14px;border-bottom:1px solid #f8fafc;cursor:pointer;' + (unread ? 'background:#f0f7ff' : '') + '">' +
          '<span style="color:' + (unread ? '#2563eb' : '#cbd5e1') + ';font-size:9px;line-height:1.8">●</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12.7px;font-weight:' + (unread ? '600' : '400') + ';color:#1e293b;line-height:1.45">' + esc(n.title || '알림') + '</div>' +
            '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + esc(timeAgo(n.sentAt || n.createdAt)) + '</div>' +
          '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.anp-item'), function (el) {
      el.addEventListener('click', async function () {
        var id = Number(el.getAttribute('data-id'));
        var source = el.getAttribute('data-source') || 'ws';
        var url = el.getAttribute('data-url');
        try {
          await fetch('/api/admin-workspace-notifications', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, source: source }),
          });
        } catch (_) {}
        if (url) { window.location.href = url; return; }
        closePanel(); poll();
      });
    });
  }

  function openPanel() {
    ensurePanel();
    positionPanel();
    document.getElementById(PANEL_ID).style.display = 'block';
    panelOpen = true;
    loadPanel();
    setTimeout(function () {
      document.addEventListener('click', onDocClick);
      window.addEventListener('resize', positionPanel);
      document.addEventListener('keydown', onEsc);
    }, 0);
  }
  function closePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.style.display = 'none';
    panelOpen = false;
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('resize', positionPanel);
    document.removeEventListener('keydown', onEsc);
  }
  function togglePanel() { panelOpen ? closePanel() : openPanel(); }
  function onDocClick() { closePanel(); }
  function onEsc(e) { if (e.key === 'Escape') closePanel(); }

  async function poll() {
    var btn = ensureUI();
    var badge = document.getElementById(BADGE_ID);
    if (!btn || !badge) return;
    try {
      var res = await fetch('/api/admin-workspace-notifications?limit=1', {
        credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 401 || res.status === 403) { btn.style.display = 'none'; return; }
      if (!res.ok) return;
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
    } catch (_) {}
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, POLL_MS);
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
