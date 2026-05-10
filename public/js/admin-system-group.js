/* admin-system-group.js — Phase 20-C 시스템·감사·보안 그룹 */
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
      console.warn('[SystemGroup]', msg);
    }
  }

  /* ─── 상태 ─── */
  let initialized = false;
  let currentTab = 'settings';
  let roleChecked = false;

  /* ─── super_admin 역할 확인 ─── */
  async function getAdminRole() {
    if (window.__adminRole) return window.__adminRole;
    try {
      const res = await api({ url: '/api/admin-me' });
      return res.data?.data?.role || res.data?.role || '';
    } catch { return ''; }
  }

  /* ─── 진입 ─── */
  async function init() {
    /* 시스템 설정 뷰 */
    const systemContainer = document.getElementById('adm20-system');
    if (systemContainer) {
      const role = await getAdminRole();
      roleChecked = true;
      systemContainer.innerHTML = buildSystemShell(role);
      bindSystemTabs(systemContainer);
      loadTab('settings');
    }

    /* 감사 로그 뷰 (별도 adm20-audit) */
    const auditContainer = document.getElementById('adm20-audit');
    if (auditContainer) {
      auditContainer.innerHTML = buildAuditShell();
      loadAuditLog();
    }
  }

  /* ─── 시스템 탭 셸 HTML ─── */
  function buildSystemShell(role) {
    const isSuperAdmin = role === 'super_admin';
    const anonTabBtn = isSuperAdmin
      ? '<button class="adm-group-tab" data-tab="anon-audit">🔒 보안·감사 로그</button>'
      : '';
    const anonPanel = isSuperAdmin
      ? `<div class="adm-group-panel" data-panel="anon-audit">
           <div id="sg-anon-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">로딩 중...</div>
           <div id="sg-anon-wrap"></div>
         </div>`
      : '';
    return `
      <div class="adm-card">
        <div class="adm-group-tabs">
          <button class="adm-group-tab is-active" data-tab="settings">⚙️ 시스템 설정</button>
          <button class="adm-group-tab" data-tab="audit">🔍 감사 로그</button>
          ${anonTabBtn}
        </div>

        <div class="adm-group-panel is-active" data-panel="settings">
          <div id="sg-settings-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">로딩 중...</div>
          <div id="sg-settings-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="audit">
          <div id="sg-audit-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">로딩 중...</div>
          <div id="sg-audit-wrap"></div>
        </div>

        ${anonPanel}
      </div>`;
  }

  /* ─── 감사 로그 별도 뷰 셸 ─── */
  function buildAuditShell() {
    return `
      <div class="adm-card">
        <div class="adm-card__title">🔍 감사 로그</div>
        <div id="sg-audit2-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">로딩 중...</div>
        <div id="sg-audit2-wrap"></div>
      </div>`;
  }

  /* ─── 탭 바인딩 ─── */
  function bindSystemTabs(container) {
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
    if (tab === 'settings') {
      await loadSettings();
    } else if (tab === 'audit') {
      await loadAuditLog('sg-audit-loading', 'sg-audit-wrap');
    } else if (tab === 'anon-audit') {
      await loadAnonAudit();
    }
  }

  /* ─── 시스템 설정 ─── */
  async function loadSettings() {
    const loadingEl = document.getElementById('sg-settings-loading');
    const wrapEl = document.getElementById('sg-settings-wrap');
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin/site-settings' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.data?.list || res.data?.list || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildSettingsTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('시스템 설정 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 감사 로그 ─── */
  async function loadAuditLog(loadingId, wrapId) {
    const lid = loadingId || 'sg-audit2-loading';
    const wid = wrapId || 'sg-audit2-wrap';
    const loadingEl = document.getElementById(lid);
    const wrapEl = document.getElementById(wid);
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin/audit?limit=50' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.data?.list || res.data?.list || res.data?.logs || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildAuditTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('감사 로그 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 익명 감사 로그 (super_admin 전용) ─── */
  async function loadAnonAudit() {
    const loadingEl = document.getElementById('sg-anon-loading');
    const wrapEl = document.getElementById('sg-anon-wrap');
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin-anonymous-reveal-logs?limit=50' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.items || res.data?.data?.items || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildAnonTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('보안·감사 로그 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 테이블 빌더들 ─── */
  function buildSettingsTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">시스템 설정 항목이 없습니다.</p>';
    }
    const ths = ['범위', '설정 키', '값', '임시저장', '수정일'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace">${esc(r.scope ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace;font-weight:600">${esc(r.key ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.valueText ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.hasDraft ? '📝' : '—'}</td>
        <td style="padding:9px 12px;font-size:12px;color:var(--tok-text-3,#999)">${fmtDate(r.updatedAt)}</td>
      </tr>`).join('');
    return `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function buildAuditTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">감사 로그가 없습니다.</p>';
    }
    const ths = ['사용자', '유형', '액션', '대상', '성공', '일시'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.userName ?? r.adminId ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.userType ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace;font-weight:600">${esc(r.action ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.target ?? r.targetType ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.success !== undefined ? (r.success ? '✅' : '❌') : '—'}</td>
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

  function buildAnonTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">익명 감사 로그가 없습니다.</p>';
    }
    const ths = ['담당자', '신고유형', '신고제목', '식별수준', '사유', '조회일시'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.revealedByName ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.reportType ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.reportTitle ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px;text-align:center">${r.revealLevel ?? ''}</td>
        <td style="padding:9px 12px;font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.reason ?? '')}</td>
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
    const targets = ['adm20-system', 'adm20-audit'];
    targets.forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          if (m.target && m.target.classList.contains('is-active')) {
            tryInit();
          }
        });
      });
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
      if (el.classList.contains('is-active')) tryInit();
    });
  });

})();
