/**
 * Round 12 — 마이페이지 알림 탭
 * GET /api/notifications/mine  → 목록 렌더링
 * PATCH /api/notifications/read { id } → 단건 읽음
 * PATCH /api/notifications/read { all: true } → 전체 읽음
 */
(function () {
  'use strict';

  const MOCK_NOTIFICATIONS = {
    ok: true,
    list: [
      {
        id: 1, category: 'workspace', severity: 'info',
        title: '태스크 멘션',
        message: '"회의록 준비" 태스크에서 홍길동님이 멘션했습니다.',
        link: '/workspace-kanban.html', isRead: false,
        createdAt: '2026-05-18T10:00:00Z',
      },
      {
        id: 2, category: 'legal', severity: 'info',
        title: '법률 상담 배정',
        message: '새 법률 상담이 배정되었습니다.',
        link: '/admin-legal.html', isRead: true,
        createdAt: '2026-05-18T09:00:00Z',
      },
    ],
    unreadCount: 1,
    criticalCount: 0,
  };

  let _loaded = false;

  function timeAgo(iso) {
    if (!iso) return '';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return '방금 전';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    return Math.floor(diff / 86400) + '일 전';
  }

  function categoryLabel(cat) {
    const map = {
      workspace: '워크스페이스', legal: '법률', incident: '사건신고',
      harassment: '괴롭힘신고', donation: '후원', system: '시스템',
    };
    return map[cat] || cat || '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  }

  function renderList(list) {
    const el = document.getElementById('mpNotifyList');
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:40px;text-align:center;font-size:13px">알림이 없습니다.</div>';
      return;
    }

    el.innerHTML = list.map(n => `
<div class="mn-item${n.isRead ? '' : ' mn-unread'}" data-notify-id="${n.id}" data-notify-link="${escapeHtml(n.link || '')}">
  ${n.isRead ? '' : '<span class="mn-dot"></span>'}
  <div class="mn-body">
    <div class="mn-head">
      <span class="mn-cat">${escapeHtml(categoryLabel(n.category))}</span>
      <span class="mn-time">${escapeHtml(timeAgo(n.createdAt))}</span>
    </div>
    <div class="mn-title">${escapeHtml(n.title || '')}</div>
    <div class="mn-msg">${escapeHtml(n.message || '')}</div>
  </div>
</div>`).join('');

    el.querySelectorAll('.mn-item').forEach(item => {
      item.addEventListener('click', () => handleItemClick(item));
    });
  }

  async function handleItemClick(item) {
    const id = Number(item.dataset.notifyId);
    const link = item.dataset.notifyLink;
    if (!item.classList.contains('mn-unread')) {
      if (link) location.href = link;
      return;
    }
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch (_) { /* 실패해도 이동 */ }
    item.classList.remove('mn-unread');
    item.querySelector('.mn-dot')?.remove();
    if (link) location.href = link;
  }

  async function handleReadAll() {
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch (_) { /* 폴백: 무시 */ }
    document.querySelectorAll('.mn-item.mn-unread').forEach(item => {
      item.classList.remove('mn-unread');
      item.querySelector('.mn-dot')?.remove();
    });
    updateMenuBadge(0);
  }

  function updateMenuBadge(unreadCount) {
    const tab = document.getElementById('mpNotifyTab');
    if (!tab) return;
    const existing = tab.querySelector('.mn-menu-badge');
    if (existing) existing.remove();
    if (unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'mn-menu-badge';
      badge.textContent = unreadCount;
      tab.appendChild(badge);
    }
  }

  async function loadNotifications() {
    if (_loaded) return;
    _loaded = true;
    const el = document.getElementById('mpNotifyList');
    if (!el) return;

    let data;
    try {
      const res = await fetch('/api/notifications/mine', { credentials: 'include' });
      const json = await res.json().catch(() => null);
      if (json && json.ok) {
        data = json;
      } else {
        data = MOCK_NOTIFICATIONS;
      }
    } catch (_) {
      data = MOCK_NOTIFICATIONS;
    }

    const list = data.list || data.data?.list || [];
    const unreadCount = data.unreadCount ?? data.data?.unreadCount ?? 0;
    renderList(list);
    updateMenuBadge(unreadCount);
  }

  function injectStyles() {
    if (document.getElementById('mn-styles')) return;
    const style = document.createElement('style');
    style.id = 'mn-styles';
    style.textContent = `
.mn-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
  background: #fff;
}
.mn-item:hover { background: var(--bg-soft); }
.mn-item.mn-unread {
  background: linear-gradient(135deg, #eef4ff, #fff);
  border-color: #bfdbfe;
}
.mn-dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3b82f6;
  flex-shrink: 0;
  margin-top: 6px;
}
.mn-body { flex: 1; min-width: 0; }
.mn-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.mn-cat {
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 8px;
  background: #e0e7ff;
  color: #3730a3;
}
.mn-time { font-size: 11px; color: var(--text-3); }
.mn-title { font-size: 13.5px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
.mn-msg { font-size: 12.5px; color: var(--text-2); line-height: 1.5; }
.mn-menu-badge {
  display: inline-block;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 10px;
  padding: 0 5px;
  min-width: 16px;
  text-align: center;
  margin-left: 5px;
  line-height: 16px;
  vertical-align: middle;
}
`;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    const readAllBtn = document.getElementById('mpNotifyReadAll');
    if (readAllBtn) readAllBtn.addEventListener('click', handleReadAll);
  }

  document.addEventListener('DOMContentLoaded', init);

  // 탭 클릭 시 로드 (SIREN_PAGE_INIT 패턴과 동일)
  document.addEventListener('click', function (e) {
    const li = e.target.closest('#mpMenu li[data-mp="notifications"]');
    if (li) loadNotifications();
  });

  window.SIREN_MYPAGE_NOTIFICATIONS = { load: loadNotifications };
})();
