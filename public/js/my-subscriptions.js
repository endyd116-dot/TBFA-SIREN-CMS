/* =========================================================
   SIREN — my-subscriptions.js (★ Phase 11 멘션·구독)
   - 구독 게시글 목록 + 구독 알림 목록 관리
   ========================================================= */
(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let _postsPage = 1;
  let _notifPage = 1;
  let _activeTab = 'posts';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '방금 전';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ── 탭 전환 ── */
  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.sub-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.getElementById('paneSubPosts').style.display = tab === 'posts' ? '' : 'none';
    document.getElementById('paneSubNotifications').style.display = tab === 'notifications' ? '' : 'none';

    if (tab === 'posts') loadSubscribedPosts();
    else loadNotifications();
  }

  /* ── 구독 게시글 목록 ── */
  async function loadSubscribedPosts() {
    const list = document.getElementById('subPostsList');
    list.innerHTML = '<div class="sub-empty"><div class="icon"></div>불러오는 중...</div>';

    try {
      const params = new URLSearchParams({ page: _postsPage, limit: PAGE_SIZE });
      const res = await fetch('/api/user-post-subscriptions?' + params, { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          list.innerHTML = '<div class="sub-empty"><div class="icon"></div>로그인이 필요합니다</div>';
          return;
        }
        list.innerHTML = '<div class="sub-empty"><div class="icon"></div>목록을 불러오지 못했습니다</div>';
        return;
      }

      const rows = json.postSubscriptions || json.data?.postSubscriptions || json.data?.rows || json.rows || [];
      const total = rows.length;
      const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

      if (!rows.length) {
        list.innerHTML = `
          <div class="sub-empty">
            <div class="icon"></div>
            구독 중인 게시글이 없습니다.<br>
            <small style="margin-top:8px;display:block">게시글을 볼 때 구독하기 버튼을 눌러 새 댓글 알림을 받으세요</small>
          </div>`;
        document.getElementById('subPostsPagination').style.display = 'none';
        return;
      }

      let html = '';
      rows.forEach((row) => {
        const unread = row.unreadCount > 0
          ? `<span class="sub-unread-badge">+${row.unreadCount}</span>` : '';
        html += `
          <div class="sub-item">
            <div class="sub-item-icon"></div>
            <div class="sub-item-body">
              <div class="sub-item-title">
                <a href="/board-view.html?id=${escapeHtml(row.postId)}">${escapeHtml(row.postTitle)}</a>
                ${unread}
              </div>
              <div class="sub-item-meta">
                구독 시작: ${fmtDate(row.subscribedAt)}
                · 댓글 ${escapeHtml(String(row.commentCount || 0))}개
              </div>
            </div>
            <button class="sub-unsub-btn" onclick="unsubscribePost(${row.postId}, this)">해제</button>
          </div>
        `;
      });
      list.innerHTML = html;

      renderPagination('subPostsPagination', _postsPage, totalPages, (p) => {
        _postsPage = p;
        loadSubscribedPosts();
      });
    } catch (e) {
      console.error('[subscriptions]', e);
      list.innerHTML = '<div class="sub-empty"><div class="icon"></div>네트워크 오류</div>';
    }
  }

  /* ── 구독 해제 ── */
  window.unsubscribePost = async function (postId, btn) {
    if (!confirm('이 게시글 구독을 해제하시겠습니까?')) return;
    btn.disabled = true;
    try {
      const res = await fetch('/api/user-post-subscribe?postId=' + encodeURIComponent(postId), {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '해제 실패');
        btn.disabled = false;
        return;
      }
      window.SIREN.toast('구독이 해제되었습니다');
      loadSubscribedPosts();
    } catch (e) {
      console.error('[unsubscribe]', e);
      window.SIREN.toast('네트워크 오류');
      btn.disabled = false;
    }
  };

  /* ── 알림 목록 ── */
  async function loadNotifications() {
    const list = document.getElementById('subNotifList');
    list.innerHTML = '<div class="sub-empty"><div class="icon"></div>불러오는 중...</div>';

    try {
      const params = new URLSearchParams({ page: _notifPage, limit: PAGE_SIZE });
      const res = await fetch('/api/user-mentions?' + params, { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        if (res.status === 401) {
          list.innerHTML = '<div class="sub-empty"><div class="icon"></div>로그인이 필요합니다</div>';
          return;
        }
        list.innerHTML = '<div class="sub-empty"><div class="icon"></div>알림을 불러오지 못했습니다</div>';
        return;
      }

      const rows = json.items || json.data?.items || json.data?.rows || json.rows || [];
      const total = rows.length;
      const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

      if (!rows.length) {
        list.innerHTML = '<div class="sub-empty"><div class="icon"></div>새 알림이 없습니다</div>';
        document.getElementById('subNotifPagination').style.display = 'none';
        return;
      }

      let html = '';
      rows.forEach((n) => {
        const srcType = n.sourceType || n.type || '';
        const icon = srcType === 'post' ? '' : '';
        const actorName = n.mentionerName || n.actorName || '누군가';
        const linkHtml = n.sourceId
          ? `<a href="/board-view.html?id=${escapeHtml(String(n.sourceId))}">${escapeHtml(n.postTitle || '게시글')}</a>`
          : escapeHtml(n.postTitle || '게시글');

        let msg = '';
        if (srcType === 'post' || srcType === 'comment') {
          msg = `<strong>${escapeHtml(actorName)}</strong>님이 게시글에서 회원님을 멘션했습니다 → ${linkHtml}`;
        } else {
          msg = `<strong>${escapeHtml(actorName)}</strong>님이 회원님을 멘션했습니다`;
        }

        html += `
          <div class="sub-notif-item${n.isRead ? '' : ' unread'}" data-notif-id="${n.id}">
            <div class="sub-notif-icon">${icon}</div>
            <div class="sub-notif-body">
              <div class="sub-notif-text">${msg}</div>
              <div class="sub-notif-meta">${fmtDate(n.createdAt)}</div>
            </div>
            ${!n.isRead ? `<button class="sub-notif-read-btn" title="읽음 처리" onclick="markRead(${n.id}, this)">✓</button>` : ''}
          </div>
        `;
      });
      list.innerHTML = html;

      renderPagination('subNotifPagination', _notifPage, totalPages, (p) => {
        _notifPage = p;
        loadNotifications();
      });
    } catch (e) {
      console.error('[notifications]', e);
      list.innerHTML = '<div class="sub-empty"><div class="icon"></div>네트워크 오류</div>';
    }
  }

  /* ── 알림 읽음 처리 ── */
  window.markRead = async function (id, btn) {
    btn.disabled = true;
    try {
      const res = await fetch('/api/user-mention-read', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { btn.disabled = false; return; }
      const item = btn.closest('.sub-notif-item');
      if (item) {
        item.classList.remove('unread');
        btn.remove();
      }
    } catch (e) {
      console.error('[mark-read]', e);
      btn.disabled = false;
    }
  };

  window.markAllRead = async function () {
    try {
      const res = await fetch('/api/user-mention-read', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '처리 실패');
        return;
      }
      window.SIREN.toast('모두 읽음 처리되었습니다');
      loadNotifications();
    } catch (e) {
      console.error('[mark-all-read]', e);
      window.SIREN.toast('네트워크 오류');
    }
  };

  /* ── 페이지네이션 ── */
  function renderPagination(elId, page, totalPages, onChange) {
    const box = document.getElementById(elId);
    if (!box) return;

    if (totalPages <= 1) { box.style.display = 'none'; return; }
    box.style.display = 'flex';

    const maxBtns = 5;
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    let html = `<button data-p="1" ${page === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = start; i <= end; i++) {
      html += `<button data-p="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button data-p="${totalPages}" ${page === totalPages ? 'disabled' : ''}>»</button>`;
    box.innerHTML = html;

    box.querySelectorAll('button[data-p]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.p);
        if (Number.isFinite(p)) onChange(p);
      });
    });
  }

  /* ── 초기화 ── */
  function init() {
    if (document.body.dataset.page !== 'my-subscriptions') return;

    /* 로그인 확인 */
    setTimeout(() => {
      const auth = window.SIREN_AUTH;
      if (!auth || !auth.isLoggedIn()) {
        window.SIREN.toast('로그인이 필요합니다');
        setTimeout(() => location.href = '/index.html', 1000);
      }
    }, 1200);

    /* 탭 이벤트 */
    document.querySelectorAll('.sub-tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    /* 첫 탭 로드 */
    loadSubscribedPosts();
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
