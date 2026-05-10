/* admin-content-group.js — Phase 20-C 콘텐츠·보고서·메인편집 그룹 */
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
      console.warn('[ContentGroup]', msg);
    }
  }

  /* ─── 상태 ─── */
  let initialized = false;
  let currentTab = 'content';

  /* ─── 진입 ─── */
  function init() {
    /* 콘텐츠 관리 뷰 */
    const contentContainer = document.getElementById('adm20-content-mgmt');
    if (contentContainer) {
      contentContainer.innerHTML = buildShell('content-mgmt');
      bindTabs(contentContainer, 'content-mgmt');
      loadTab('content');
    }

    /* 주간 보고서 뷰 */
    const reportContainer = document.getElementById('adm20-weekly-report');
    if (reportContainer) {
      reportContainer.innerHTML = buildShell('weekly-report');
      bindTabs(reportContainer, 'weekly-report');
      loadTab('weekly');
    }
  }

  /* ─── 탭 셸 HTML ─── */
  function buildShell(type) {
    if (type === 'content-mgmt') {
      return `
        <div class="adm-card">
          <div class="adm-group-tabs">
            <button class="adm-group-tab is-active" data-tab="content">📝 콘텐츠 관리</button>
            <button class="adm-group-tab" data-tab="site-builder">🎨 메인 화면 편집</button>
          </div>
          <div class="adm-group-panel is-active" data-panel="content">
            <div id="cg-content-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">
              로딩 중...
            </div>
            <div id="cg-content-wrap"></div>
          </div>
          <div class="adm-group-panel" data-panel="site-builder">
            <div style="padding:24px;text-align:center">
              <p style="margin-bottom:16px;font-size:14px;color:var(--tok-text-2,#555)">메인 화면(홈페이지) 레이아웃을 편집합니다.</p>
              <button onclick="window.location.href='/site-builder.html'"
                style="padding:10px 24px;background:var(--brand,#7a1e2c);color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">
                메인 화면 편집으로 이동
              </button>
            </div>
          </div>
        </div>`;
    }
    if (type === 'weekly-report') {
      return `
        <div class="adm-card">
          <div class="adm-group-tabs">
            <button class="adm-group-tab is-active" data-tab="weekly">📊 주간 보고서</button>
          </div>
          <div class="adm-group-panel is-active" data-panel="weekly">
            <div id="cg-weekly-loading" style="padding:20px;text-align:center;color:var(--tok-text-3,#999);display:none">
              로딩 중...
            </div>
            <div id="cg-weekly-wrap"></div>
          </div>
        </div>`;
    }
    return '';
  }

  /* ─── 탭 바인딩 ─── */
  function bindTabs(container, type) {
    container.querySelectorAll('.adm-group-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const tab = this.dataset.tab;
        container.querySelectorAll('.adm-group-tab').forEach(b => b.classList.remove('is-active'));
        container.querySelectorAll('.adm-group-panel').forEach(p => p.classList.remove('is-active'));
        this.classList.add('is-active');
        const panel = container.querySelector('[data-panel="' + tab + '"]');
        if (panel) panel.classList.add('is-active');
        currentTab = tab;
        if (tab === 'content') loadTab('content');
        else if (tab === 'weekly') loadTab('weekly');
      });
    });
  }

  /* ─── 탭별 데이터 로드 ─── */
  async function loadTab(tab) {
    if (tab === 'content') {
      await loadContent();
    } else if (tab === 'weekly') {
      await loadWeekly();
    }
  }

  /* ─── 콘텐츠 목록 ─── */
  async function loadContent() {
    const loadingEl = document.getElementById('cg-content-loading');
    const wrapEl = document.getElementById('cg-content-wrap');
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin/activity-posts?limit=50' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.data?.list || res.data?.list || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildContentTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('콘텐츠 목록 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 주간 보고서 목록 ─── */
  async function loadWeekly() {
    const loadingEl = document.getElementById('cg-weekly-loading');
    const wrapEl = document.getElementById('cg-weekly-wrap');
    if (!wrapEl) return;
    if (loadingEl) loadingEl.style.display = 'block';
    wrapEl.innerHTML = '';

    try {
      const res = await api({ url: '/api/admin/activity-posts?category=report&limit=50' });
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      const rows = res.data?.data?.list || res.data?.list || res.data?.data || res.data || [];
      wrapEl.innerHTML = buildWeeklyTable(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast('주간 보고서 목록 조회 실패: ' + err.message);
      wrapEl.innerHTML = '<p style="padding:20px;color:var(--tok-text-3,#999)">데이터를 불러오지 못했습니다.</p>';
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /* ─── 콘텐츠 테이블 ─── */
  function buildContentTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">등록된 콘텐츠가 없습니다.</p>';
    }
    const ths = ['ID', '제목', '카테고리', '연도', '공개', '조회', '등록일'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace">${r.id ?? ''}</td>
        <td style="padding:9px 12px;font-size:12.5px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${esc(r.category ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.year ?? ''}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.isPublished ? '✅' : '—'}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.views ?? 0}</td>
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

  /* ─── 주간 보고서 테이블 ─── */
  function buildWeeklyTable(rows) {
    if (!rows.length) {
      return '<p style="padding:20px;text-align:center;color:var(--tok-text-3,#999)">등록된 주간 보고서가 없습니다.</p>';
    }
    const ths = ['ID', '제목', '연도', '월', '공개', '등록일'];
    const head = ths.map(t => `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:var(--tok-text-3,#999);border-bottom:1px solid var(--line,#eee)">${t}</th>`).join('');
    const body = rows.map(r => `
      <tr style="border-bottom:1px solid var(--line,#eee)">
        <td style="padding:9px 12px;font-size:12.5px;font-family:monospace">${r.id ?? ''}</td>
        <td style="padding:9px 12px;font-size:12.5px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title ?? '')}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.year ?? ''}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.month ?? ''}</td>
        <td style="padding:9px 12px;font-size:12.5px">${r.isPublished ? '✅' : '—'}</td>
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
    const targets = ['adm20-content-mgmt', 'adm20-weekly-report'];
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
