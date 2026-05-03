// public/js/notification-bell.js
// ★ Phase M-3: SIREN 알림 벨 위젯
// - 30초 폴링 (활성 탭일 때만)
// - 미읽음 카운트 뱃지
// - 드롭다운 목록
// - 크리티컬 알림은 토스트로 강조
// - 사용자/관리자 양쪽 헤더에 자동 마운트
//   <div id="siren-notification-bell"></div> 가 있으면 자동 init

(function (window, document) {
  'use strict';

  const POLL_INTERVAL = 30 * 1000; // 30초
  const ICON_BY_CATEGORY = {
    support: '📋',
    donation: '💝',
    chat: '💬',
    audit: '🛡️',
    system: '⚙️',
    billing: '💳',
    member: '👤',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeAgo(ts) {
    const t = new Date(ts).getTime();
    if (!t) return '';
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 60) return '방금';
    if (sec < 3600) return Math.floor(sec / 60) + '분 전';
    if (sec < 86400) return Math.floor(sec / 3600) + '시간 전';
    if (sec < 604800) return Math.floor(sec / 86400) + '일 전';
    return new Date(ts).toLocaleDateString('ko-KR');
  }

  /* ============================================================
     Bell 클래스
     ============================================================ */
  class SirenBell {
    constructor(rootEl) {
      this.root = rootEl;
      this.list = [];
      this.unreadCount = 0;
      this.criticalCount = 0;
      this.dropdownOpen = false;
      this.pollTimer = null;
      this.shownCriticalIds = new Set();

      this._render();
      this._bindEvents();
      this._startPolling();
    }

    _render() {
      this.root.innerHTML = `
        <div class="siren-bell">
          <button type="button" class="siren-bell-btn" aria-label="알림" data-role="btn">
            🔔
            <span class="siren-bell-badge" data-role="badge" style="display:none">0</span>
          </button>
          <div class="siren-bell-dropdown" data-role="dropdown">
            <div class="siren-bell-header">
              <span class="siren-bell-title">알림</span>
              <button type="button" class="siren-bell-mark-all" data-role="mark-all">모두 읽음</button>
            </div>
            <ul class="siren-bell-list" data-role="list"></ul>
            <div class="siren-bell-footer">
              <a href="javascript:void(0)" data-role="more">최근 50건만 표시됩니다</a>
            </div>
          </div>
        </div>
      `;

      this.btn = this.root.querySelector('[data-role="btn"]');
      this.badge = this.root.querySelector('[data-role="badge"]');
      this.dropdown = this.root.querySelector('[data-role="dropdown"]');
      this.listEl = this.root.querySelector('[data-role="list"]');
      this.markAllBtn = this.root.querySelector('[data-role="mark-all"]');
    }

    _bindEvents() {
      this.btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDropdown();
      });

      this.markAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.markAllRead();
      });

      /* 외부 클릭 시 닫기 */
      document.addEventListener('click', (e) => {
        if (!this.root.contains(e.target)) {
          this.closeDropdown();
        }
      });

      /* 탭 활성/비활성에 따라 폴링 제어 */
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this._stopPolling();
        } else {
          this._startPolling();
          this.fetch();
        }
      });
    }

    _startPolling() {
      this._stopPolling();
      this.fetch();
      this.pollTimer = setInterval(() => this.fetch(), POLL_INTERVAL);
    }

    _stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    async fetch() {
      try {
        const res = await fetch('/api/notifications/mine?limit=20', {
          credentials: 'include',
        });
        if (!res.ok) {
          /* 비로그인 등 → 벨 숨김 */
          if (res.status === 401) {
            this.root.style.display = 'none';
          }
          return;
        }
        this.root.style.display = '';
        const json = await res.json();
        if (json.ok && json.data) {
          this.list = json.data.list || [];
          this.unreadCount = json.data.unreadCount || 0;
          this.criticalCount = json.data.criticalCount || 0;
          this._updateBadge();
          this._renderList();
          this._showCriticalToasts();
        }
      } catch (e) {
        console.error('[SirenBell.fetch]', e);
      }
    }

    _updateBadge() {
      if (this.unreadCount > 0) {
        this.badge.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount);
        this.badge.style.display = '';
        if (this.criticalCount > 0) {
          this.badge.classList.add('critical');
        } else {
          this.badge.classList.remove('critical');
        }
      } else {
        this.badge.style.display = 'none';
        this.badge.classList.remove('critical');
      }
    }

    _renderList() {
      if (!this.list.length) {
        this.listEl.innerHTML = `<li class="siren-bell-empty">알림이 없습니다</li>`;
        return;
      }
      this.listEl.innerHTML = this.list.map((n) => {
        const icon = ICON_BY_CATEGORY[n.category] || '🔔';
        const cls = [
          'siren-bell-item',
          n.isRead ? '' : 'unread',
          n.severity === 'critical' ? 'critical' : (n.severity === 'warning' ? 'warning' : ''),
        ].filter(Boolean).join(' ');

        const link = n.link ? escapeHtml(n.link) : 'javascript:void(0)';

        return `
          <a class="${cls}" href="${link}" data-id="${n.id}" data-link="${escapeHtml(n.link || '')}">
            <div class="siren-bell-item-title">
              <span class="siren-bell-item-icon">${icon}</span>
              <span>${escapeHtml(n.title)}</span>
            </div>
            ${n.message ? `<div class="siren-bell-item-msg">${escapeHtml(n.message)}</div>` : ''}
            <div class="siren-bell-item-time">${timeAgo(n.createdAt)}</div>
          </a>
        `;
      }).join('');

      /* 클릭 시 읽음 + 이동 */
      this.listEl.querySelectorAll('.siren-bell-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          const id = Number(el.dataset.id);
          const link = el.dataset.link;
          if (!link) e.preventDefault();
          this.markRead(id);
        });
      });
    }

    _showCriticalToasts() {
      const newCriticals = this.list.filter((n) =>
        n.severity === 'critical' && !n.isRead && !this.shownCriticalIds.has(n.id)
      );
      newCriticals.forEach((n) => {
        this.shownCriticalIds.add(n.id);
        this._showToast(n);
      });
    }

    _showToast(n) {
      const toast = document.createElement('div');
      toast.className = 'siren-critical-toast';
      const link = n.link ? escapeHtml(n.link) : '';
      toast.innerHTML = `
        <button class="close" type="button">×</button>
        <h4>🚨 ${escapeHtml(n.title)}</h4>
        ${n.message ? `<p>${escapeHtml(n.message)}</p>` : ''}
        <div class="actions">
          ${link ? `<a class="primary" href="${link}">바로 확인</a>` : ''}
          <button type="button" data-act="dismiss">나중에</button>
        </div>
      `;
      document.body.appendChild(toast);

      const remove = () => {
        try { document.body.removeChild(toast); } catch (_) {}
      };
      toast.querySelector('.close').addEventListener('click', () => {
        this.markRead(n.id);
        remove();
      });
      toast.querySelector('[data-act="dismiss"]').addEventListener('click', remove);
      const linkEl = toast.querySelector('.primary');
      if (linkEl) linkEl.addEventListener('click', () => this.markRead(n.id));

      /* 30초 후 자동 닫힘 */
      setTimeout(remove, 30000);
    }

    toggleDropdown() {
      this.dropdownOpen = !this.dropdownOpen;
      this.dropdown.classList.toggle('open', this.dropdownOpen);
      if (this.dropdownOpen) this.fetch();
    }

    closeDropdown() {
      this.dropdownOpen = false;
      this.dropdown.classList.remove('open');
    }

    async markRead(id) {
      if (!id) return;
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const item = this.list.find((x) => x.id === id);
        if (item && !item.isRead) {
          item.isRead = true;
          this.unreadCount = Math.max(0, this.unreadCount - 1);
          if (item.severity === 'critical') {
            this.criticalCount = Math.max(0, this.criticalCount - 1);
          }
          this._updateBadge();
          this._renderList();
        }
      } catch (e) {
        console.error('[SirenBell.markRead]', e);
      }
    }

    async markAllRead() {
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        this.list.forEach((n) => { n.isRead = true; });
        this.unreadCount = 0;
        this.criticalCount = 0;
        this._updateBadge();
        this._renderList();
      } catch (e) {
        console.error('[SirenBell.markAllRead]', e);
      }
    }
  }

  /* ============================================================
     자동 마운트
     ============================================================ */
  function autoMount() {
    /* CSS 자동 로드 */
    if (!document.querySelector('link[href^="/css/notification.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/css/notification.css?v=m3';
      document.head.appendChild(link);
    }

    const root = document.getElementById('siren-notification-bell');
    if (root && !root.dataset.mounted) {
      root.dataset.mounted = '1';
      new SirenBell(root);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  window.SirenBell = SirenBell;
  window.SirenBellAutoMount = autoMount;

})(window, document);