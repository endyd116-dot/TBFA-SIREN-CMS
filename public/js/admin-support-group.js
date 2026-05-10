/* admin-support-group.js — Phase 20-C 유가족 지원·문의 그룹 */
(function () {
  'use strict';

  const USE_MOCK = false;

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
      console.warn('[SupportGroup]', msg);
    }
  }

  /* ─── 상태 ─── */
  let initialized = false;
  let currentTab = 'support';

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-support');
    if (!container) return;
    container.innerHTML = buildShell();
    bindTabs(container);
    loadTab('support');
  }

  /* ─── 탭 셸 HTML ─── */
  function buildShell() {
    return `
      <div class="adm-card">
        <div class="adm-group-tabs">
          <button class="adm-group-tab is-active" data-tab="support">🤝 유가족 지원 관리</button>
          <button class="adm-group-tab" data-tab="chat">💬 문의(채팅) 관리</button>
        </div>

        <div class="adm-group-panel is-active" data-panel="support">
          <div id="sg-support-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">
            로딩 중...
          </div>
          <div id="sg-support-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="chat">
          <div id="sg-chat-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">
            로딩 중...
          </div>
          <div id="sg-chat-wrap"></div>
        </div>
      </div>`;
  }

  /* ─── 탭 바인딩 ─── */
  function bindTabs(container) {
    container.querySelectorAll('.adm-group-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const tab = this.dataset.tab;
        container.querySelectorAll('.adm-group-tab').forEach(b => b.classList.remove('is-active'));
        container.querySelectorAll('.adm-group-panel').forEach(p => p.classList.remove('is-active'));
        this.classList.add('is-active');
        const panel = container.querySelector('[data-panel="' + tab + '"]');
        if (panel) panel.classList.add('is-active');
        currentTab = tab;
        loadTab(tab);
      });
    });
  }

  /* ─── 탭별 데이터 로드 ─── */
  async function loadTab(tab) {
    if (tab === 'support') {
      await loadSupport();
    } else if (tab === 'chat') {
      await loadChat();
    }
  }

  /* ─── 유가족 지원 목록 ─── */
  async function loadSupport() {
    const loadingEl = document.getElementById('sg-support-loading');
    const wrapEl = document.getElementById('sg-support-wrap');
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin/support' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.data?.list || res.data?.list || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildSupportTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('유가족 지원 목록 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 문의(채팅) 목록 ─── */
  async function loadChat() {
    const loadingEl = document.getElementById('sg-chat-loading');
    const wrapEl = document.getElementById('sg-chat-wrap');
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin/chat/rooms?limit=50' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.data?.rooms || res.data?.rooms || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildChatTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('문의 채팅 목록 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 유가족 지원 테이블 ─── */
  function buildSupportTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">등록된 유가족 지원 내역이 없습니다.</p>';
    }
    const ths = ['접수번호', '신청자', '유형', '제목', '상태', '신청일'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace">${esc(r.requestNo ?? r.id ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.requesterName ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.category ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.status ?? '')}</td>
        <td style="padding:9px 12px;font-size:12px;color:var(--tok-text-3,#999)">${fmtDate(r.createdAt)}</td>
      </tr>`).join('');
    return `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  /* ─── 채팅 테이블 ─── */
  function buildChatTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">등록된 문의 채팅이 없습니다.</p>';
    }
    const ths = ['ID', '카테고리', '회원', '마지막 메시지', '상태', '업데이트'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace">${r.id ?? ''}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.category ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.memberName ?? r.memberEmail ?? '')}</td>
        <td style="padding:9px 12px;font-size:12px;color:var(--tok-text-3,#999);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.lastMessagePreview ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.status ?? '')}</td>
        <td style="padding:9px 12px;font-size:12px;color:var(--tok-text-3,#999)">${fmtDate(r.lastMessageAt)}</td>
      </tr>`).join('');
    return `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  /* ─── 유틸 ─── */
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtDate(v) {
    if (!v) return '-';
    try { return new Date(v).toLocaleString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch { return String(v); }
  }

  /* ─── 초기화 한 번만 ─── */
  function tryInit() {
    if (initialized) return;
    initialized = true;
    init();
  }

  /* ─── MutationObserver: is-active 감지 ─── */
  document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('adm20-support');
    if (!container) return;
    const obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.target && m.target.id === 'adm20-support' && m.target.classList.contains('is-active')) {
          tryInit();
        }
      });
    });
    obs.observe(container, { attributes: true, attributeFilter: ['class'] });
    if (container.classList.contains('is-active')) tryInit();
  });

})();
