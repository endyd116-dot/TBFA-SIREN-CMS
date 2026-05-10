/* admin-favorites.js — Phase 20-C 즐겨찾기·최근 본 메뉴 위젯 */
(function () {
  'use strict';

  /* ─── API 헬퍼 ─── */
  async function api({ method = 'GET', url, body } = {}) {
    try {
      if (typeof window.adminApi === 'function') return await window.adminApi({ method, url, body });
      if (typeof window.api === 'function')      return await window.api({ method, url, body });
      const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      if (r.status === 401) { window.location.href = '/admin.html'; return { ok: false, status: 401, data: {} }; }
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  /* ─── 토스트 ─── */
  function showToast(msg, type = 'error') {
    const el = document.getElementById('toast') || document.getElementById('admToast');
    if (el) {
      el.textContent = msg;
      el.className = 'toast show' + (type === 'error' ? ' toast-error' : '');
      setTimeout(() => el.classList.remove('show'), 3500);
    } else {
      console.warn('[Favorites]', msg);
    }
  }

  /* ─── 데이터 로드 ─── */
  async function load() {
    const widget = document.getElementById('sidebar-favorites-widget');
    if (!widget) return;

    let favs = [];
    let recents = [];

    try {
      const [favRes, recRes] = await Promise.all([
        api({ url: '/api/admin-favorites-list' }),
        api({ url: '/api/admin-recent-views-list' }),
      ]);
      if (favRes.ok) {
        const d = favRes.data?.data || favRes.data || [];
        favs = Array.isArray(d) ? d.slice(0, 5) : [];
      }
      if (recRes.ok) {
        const d = recRes.data?.data || recRes.data || [];
        recents = Array.isArray(d) ? d.slice(0, 5) : [];
      }
    } catch (err) {
      console.warn('[Favorites] 로드 실패:', err);
    }

    render(widget, favs, recents);
  }

  /* ─── 렌더링 ─── */
  function render(widget, favs, recents) {
    const favItems = favs.map(item => `
      <li data-key="${esc(item.menuKey || '')}"
        style="display:flex;align-items:center;padding:5px 0;gap:6px;cursor:pointer">
        <span class="fav-label-text" style="flex:1;font-size:12.5px;color:var(--tok-text-1,#222);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          onclick="window.__favNavigate('${esc(item.menuKey || '')}')">
          ${esc(item.label || item.menuKey || '')}
        </span>
        <button class="fav-toggle" data-key="${esc(item.menuKey || '')}"
          style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--brand,#7a1e2c);padding:0 2px"
          title="즐겨찾기 해제">★</button>
      </li>`).join('');

    const recItems = recents.map(item => `
      <li data-key="${esc(item.menuKey || '')}"
        style="display:flex;align-items:center;padding:5px 0;cursor:pointer"
        onclick="window.__favNavigate('${esc(item.menuKey || '')}')">
        <span style="flex:1;font-size:12.5px;color:var(--tok-text-1,#222);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${esc(item.label || item.menuKey || '')}
        </span>
      </li>`).join('');

    widget.innerHTML = `
      <div class="fav-section" style="padding:12px 16px 6px;border-bottom:1px solid var(--line,#eee)">
        <div class="fav-label" style="font-size:11px;font-weight:700;color:var(--tok-text-3,#999);letter-spacing:0.4px;margin-bottom:6px">★ 즐겨찾기</div>
        <ul id="fav-list" style="list-style:none;margin:0;padding:0">
          ${favItems || '<li style="font-size:12px;color:var(--tok-text-3,#999);padding:4px 0">즐겨찾기 없음</li>'}
        </ul>
      </div>
      <div class="fav-section" style="padding:10px 16px 12px">
        <div class="fav-label" style="font-size:11px;font-weight:700;color:var(--tok-text-3,#999);letter-spacing:0.4px;margin-bottom:6px">🕐 최근 본 메뉴</div>
        <ul id="recent-list" style="list-style:none;margin:0;padding:0">
          ${recItems || '<li style="font-size:12px;color:var(--tok-text-3,#999);padding:4px 0">최근 방문 없음</li>'}
        </ul>
      </div>`;

    /* ★ 토글 이벤트 */
    widget.querySelectorAll('.fav-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleFavorite(this.dataset.key);
      });
    });
  }

  /* ─── 즐겨찾기 토글 ─── */
  async function toggleFavorite(menuKey) {
    if (!menuKey) return;
    try {
      const res = await api({
        method: 'POST',
        url: '/api/admin-favorites-toggle',
        body: { menuKey },
      });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      await load();
    } catch (err) {
      showToast('즐겨찾기 변경 실패: ' + err.message);
    }
  }

  /* ─── 메뉴 이동 (hash + 최근 기록) ─── */
  window.__favNavigate = function (menuKey) {
    if (!menuKey) return;
    window.location.hash = '#' + menuKey;
    recordRecent(menuKey);
  };

  /* ─── 최근 본 메뉴 기록 (fire-and-forget) ─── */
  function recordRecent(menuKey) {
    if (!menuKey) return;
    api({
      method: 'POST',
      url: '/api/admin-recent-views-record',
      body: { menuKey },
    }).catch(() => {});
  }

  /* ─── 사이드바 일반 메뉴 클릭 감지 ─── */
  function bindSidebarMenuClicks() {
    document.addEventListener('click', function (e) {
      const target = e.target.closest('[data-menu-key]');
      if (target && target.dataset.menuKey) {
        recordRecent(target.dataset.menuKey);
      }
    }, true);
  }

  /* ─── 유틸 ─── */
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  }

  /* ─── DOMContentLoaded 후 초기화 ─── */
  document.addEventListener('DOMContentLoaded', function () {
    bindSidebarMenuClicks();
    load();
  });

})();
