/**
 * Phase 21 R2 — 알림 전체 보기 페이지
 *
 * API:
 *   GET  /api/admin-workspace-notifications?limit=N&offset=N&category=X
 *   POST /api/admin-workspace-notifications  { id } | { all: true }
 */
(function () {
  'use strict';

  const STATE = {
    filter: 'all',     // assign / due / mention / transfer / watcher / system / all
    hideRead: false,
    items: [],
    offset: 0,
    limit: 30,
    total: null,
  };

  const CATEGORY_BADGE = {
    assign:   { label: '할당', cls: 'ws-notif-cat-assign' },
    due:      { label: '마감', cls: 'ws-notif-cat-due' },
    mention:  { label: '멘션', cls: 'ws-notif-cat-mention' },
    transfer: { label: '토스', cls: 'ws-notif-cat-transfer' },
    watcher:  { label: '관찰', cls: 'ws-notif-cat-watcher' },
    system:   { label: '시스템', cls: 'ws-notif-cat-system' },
  };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const t = new Date(ts).getTime();
    if (!t) return '';
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 60) return '방금 전';
    if (sec < 3600) return Math.floor(sec / 60) + '분 전';
    if (sec < 86400) return Math.floor(sec / 3600) + '시간 전';
    if (sec < 604800) return Math.floor(sec / 86400) + '일 전';
    return (typeof window.fmtKSTDate === 'function') ? window.fmtKSTDate(ts) : new Date(ts).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  function showToast(msg, type) {
    const root = $('#wsToastRoot');
    if (!root) { console.warn('[wsn]', msg); return; }
    const el = document.createElement('div');
    el.className = `ws-toast ws-toast-${type || 'info'}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('ws-toast-out');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    if (res.status === 401) { location.href = '/admin.html'; throw new Error('UNAUTHORIZED'); }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
    return data;
  }

  async function load(reset) {
    if (reset) {
      STATE.offset = 0;
      STATE.items = [];
    }
    const params = new URLSearchParams();
    params.set('limit', String(STATE.limit));
    params.set('offset', String(STATE.offset));
    if (STATE.filter !== 'all') params.set('category', STATE.filter);

    try {
      const res = await api('/api/admin-workspace-notifications?' + params.toString());
      const data = (res && res.data) || res || {};
      const items = Array.isArray(data.items) ? data.items : [];
      STATE.items = STATE.items.concat(items);
      STATE.total = data.total != null ? Number(data.total) : null;
      STATE.offset += items.length;
      render();
      const moreBtn = $('#wsnMoreBtn');
      if (moreBtn) {
        const more = STATE.total != null ? STATE.offset < STATE.total : items.length === STATE.limit;
        moreBtn.style.display = more ? '' : 'none';
      }
    } catch (err) {
      console.warn('[wsn] load 실패:', err);
      const list = $('#wsnList');
      if (list && !STATE.items.length) {
        list.innerHTML = '<li class="wsn-empty">불러오기 실패: ' + escapeHtml(err.message) + '</li>';
      }
    }
  }

  function render() {
    const list = $('#wsnList');
    if (!list) return;
    let items = STATE.items;
    if (STATE.hideRead) items = items.filter(n => !n.readAt);

    if (!items.length) {
      list.innerHTML = '<li class="wsn-empty">표시할 알림이 없습니다</li>';
      return;
    }

    list.innerHTML = items.map(n => {
      const cat = CATEGORY_BADGE[n.category] || { label: n.category || '-', cls: 'ws-notif-cat-system' };
      const isRead = !!n.readAt;
      // B 명세: actionUrl (옛 linkUrl)
      const url = n.actionUrl || n.linkUrl || '';
      return `
        <li class="wsn-item ${isRead ? 'is-read' : 'is-unread'}" data-id="${n.id}" data-source="${n.source || 'ws'}" data-url="${escapeHtml(url)}">
          <span class="wsn-dot">${isRead ? '○' : '●'}</span>
          <div class="wsn-body">
            <div class="wsn-title">${escapeHtml(n.title || n.message || '알림')}</div>
            ${n.subtitle ? `<div class="wsn-sub">${escapeHtml(n.subtitle)}</div>` : ''}
            <div class="wsn-meta">
              <span class="wsn-time">${escapeHtml(timeAgo(n.sentAt || n.createdAt))}</span>
              <span class="ws-notif-cat ${cat.cls}">${escapeHtml(cat.label)}</span>
            </div>
          </div>
        </li>`;
    }).join('');
  }

  function bind() {
    // 로그아웃 (2026-06-03)
    const _logout = document.getElementById('wsBtnLogout');
    if (_logout) _logout.addEventListener('click', async () => {
      if (!confirm('로그아웃 하시겠습니까?')) return;
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
      location.href = '/admin.html';
    });
    // 필터 탭
    $$('.wsn-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.wsn-filter').forEach(b => b.classList.toggle('is-active', b === btn));
        STATE.filter = btn.dataset.filter || 'all';
        load(true);
      });
    });

    // 읽은 것 숨기기 토글
    const hideRead = $('#wsnHideRead');
    if (hideRead) {
      hideRead.addEventListener('change', () => {
        STATE.hideRead = !!hideRead.checked;
        render();
      });
    }

    // 모두 읽음
    const markAll = $('#wsnMarkAll');
    if (markAll) {
      markAll.addEventListener('click', async () => {
        try {
          await api('/api/admin-workspace-notifications', { method: 'POST', body: { all: true } });
          showToast('모든 알림을 읽음 처리했어요', 'success');
          load(true);
        } catch (err) {
          showToast('처리 실패: ' + err.message, 'error');
        }
      });
    }

    // 더 보기
    const moreBtn = $('#wsnMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => load(false));
    }

    // 알림 클릭 → 읽음 처리 + linkUrl 이동
    document.addEventListener('click', async (e) => {
      const item = e.target.closest('#wsnList .wsn-item');
      if (!item) return;
      const id = Number(item.dataset.id);
      const url = item.dataset.url;
      const source = item.dataset.source || 'ws';
      try {
        await api('/api/admin-workspace-notifications', { method: 'POST', body: { id, source } });
      } catch (_) { /* 읽음 실패는 무시 */ }
      if (url) location.href = url;
    });
  }

  function init() {
    bind();
    load(true);

    if (window.WorkspaceSync) {
      WorkspaceSync.on('notification:new', () => load(true));
      WorkspaceSync.on('page:visible',     () => load(true));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
