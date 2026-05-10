/* admin-siren-group.js — Phase 20-A 사이렌 신고 그룹 4탭 + 익명 식별 사건 탭 흡수 (실 API) */
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
      console.warn('[SirenGroup toast]', msg);
    }
  }

  /* ─── 상태 ─── */
  let currentTab = 'incidents';
  let sirenData = null;

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-siren');
    if (!container) return;

    container.innerHTML = buildShell();
    bindTabs(container);
    loadData();
  }

  /* ─── 탭 셸 HTML ─── */
  function buildShell() {
    return `
      <div class="adm-card">
        <div class="adm-group-tabs">
          <button class="adm-group-tab is-active" data-tab="incidents">사건 신고</button>
          <button class="adm-group-tab" data-tab="harassment">악성 민원</button>
          <button class="adm-group-tab" data-tab="legal">법률 지원</button>
          <button class="adm-group-tab" data-tab="board">자유 게시판</button>
        </div>

        <!-- 사건 신고 탭 (익명 식별 케이스 섹션 포함) -->
        <div class="adm-group-panel is-active" data-panel="incidents">
          <div class="adm-toolbar">
            <input type="search" placeholder="제목·신고자 검색…" id="sg-incident-search">
            <select id="sg-incident-status">
              <option value="">전체 상태</option>
              <option value="pending">대기</option>
              <option value="processing">처리 중</option>
              <option value="closed">종료</option>
            </select>
          </div>
          <div id="sg-incidents-table-wrap"></div>

          <!-- 익명 신원 식별 케이스 (사건 탭 하단 흡수) -->
          <div style="margin-top:28px">
            <div class="adm-card__title" style="margin-bottom:10px">
              🔍 익명 신원 확인 요청 <span style="font-size:11px;font-weight:400;color:var(--tok-text-3)">(super_admin 전용)</span>
            </div>
            <div id="sg-anon-reveal-wrap"></div>
          </div>
        </div>

        <!-- 악성 민원 탭 -->
        <div class="adm-group-panel" data-panel="harassment">
          <div id="sg-harassment-table-wrap"></div>
        </div>

        <!-- 법률 지원 탭 -->
        <div class="adm-group-panel" data-panel="legal">
          <div id="sg-legal-table-wrap"></div>
        </div>

        <!-- 자유 게시판 탭 -->
        <div class="adm-group-panel" data-panel="board">
          <div id="sg-board-table-wrap"></div>
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
        container.querySelector(`[data-panel="${tab}"]`).classList.add('is-active');
        currentTab = tab;
        if (sirenData) renderTab(tab);
      });
    });

    container.querySelector('#sg-incident-search')?.addEventListener('input', function () {
      if (sirenData) renderIncidents(sirenData.incidents, this.value,
        container.querySelector('#sg-incident-status')?.value);
    });
    container.querySelector('#sg-incident-status')?.addEventListener('change', function () {
      if (sirenData) renderIncidents(sirenData.incidents,
        container.querySelector('#sg-incident-search')?.value, this.value);
    });
  }

  /* ─── 데이터 로드 ─── */
  async function loadData() {
    try {
      const res = await api({ url: '/api/admin-siren-unified' });
      if (res.status === 401) return;
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      /* 다중 fallback: data.data.X || data.X */
      const raw = res.data;
      const payload = raw?.data || raw;
      sirenData = {
        incidents:       payload?.incidents       || [],
        harassment:      payload?.harassment      || [],
        legal:           payload?.legal           || [],
        board:           payload?.board           || [],
        anonRevealCases: payload?.anonRevealCases || [],
      };
      renderTab(currentTab);
      renderAnonReveal(sirenData.anonRevealCases);
    } catch (err) {
      console.error('[SirenGroup]', err);
      showToast('사이렌 데이터를 불러오지 못했습니다: ' + err.message);
      showError('사이렌 데이터를 불러오지 못했습니다: ' + err.message);
    }
  }

  function renderTab(tab) {
    if (!sirenData) return;
    if (tab === 'incidents')  renderIncidents(sirenData.incidents);
    if (tab === 'harassment') renderHarassment(sirenData.harassment);
    if (tab === 'legal')      renderLegal(sirenData.legal);
    if (tab === 'board')      renderBoard(sirenData.board);
  }

  /* ─── 사건 신고 목록 ─── */
  function renderIncidents(incidents, search = '', status = '') {
    let rows = incidents || [];
    if (search) rows = rows.filter(i =>
      i.title.includes(search) || i.reporterMask.includes(search));
    if (status) rows = rows.filter(i => i.status === status);

    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>제목</th><th>분류</th><th>신고자</th><th>상태</th><th>익명</th><th>신고일</th></tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tok-text-3)">신고 내역이 없습니다</td></tr>'
              : rows.map(i => `
                <tr>
                  <td><strong>${esc(i.title)}</strong></td>
                  <td>${esc(i.category)}</td>
                  <td>${esc(i.reporterMask)}</td>
                  <td>${incidentStatusBadge(i.status)}</td>
                  <td>${i.isAnon ? '<span class="adm-badge adm-badge--yellow">익명</span>' : '-'}</td>
                  <td>${esc(i.createdAt)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('sg-incidents-table-wrap').innerHTML = html;
  }

  /* ─── 익명 신원 확인 요청 ─── */
  function renderAnonReveal(cases) {
    const wrap = document.getElementById('sg-anon-reveal-wrap');
    if (!wrap) return;
    const rows = cases || [];
    wrap.innerHTML = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>연결 사건</th><th>요청자</th><th>사유</th><th>상태</th><th>요청일</th><th>처리</th></tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--tok-text-3)">신원 확인 요청이 없습니다</td></tr>'
              : rows.map(c => `
                <tr>
                  <td>${esc(c.incidentTitle)}</td>
                  <td>${esc(c.requestedBy)}</td>
                  <td>${esc(c.reason)}</td>
                  <td>${anonRevealBadge(c.status)}</td>
                  <td>${esc(c.requestedAt)}</td>
                  <td>
                    ${c.status === 'pending'
                      ? `<button class="adm-btn adm-btn--primary" style="padding:4px 10px;font-size:11.5px" onclick="alert('신원 확인 처리 (20-C 실API 연결 후 동작)')">확인</button>`
                      : '-'}
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ─── 악성 민원 목록 ─── */
  function renderHarassment(list) {
    const rows = list || [];
    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>제목</th><th>민원인</th><th>횟수</th><th>상태</th><th>접수일</th></tr>
          </thead>
          <tbody>
            ${rows.map(h => `
              <tr>
                <td><strong>${esc(h.title)}</strong></td>
                <td>${esc(h.reporterMask)}</td>
                <td><span class="adm-badge adm-badge--red">${h.count}회</span></td>
                <td>${incidentStatusBadge(h.status)}</td>
                <td>${esc(h.createdAt)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('sg-harassment-table-wrap').innerHTML = html;
  }

  /* ─── 법률 지원 목록 ─── */
  function renderLegal(list) {
    const rows = list || [];
    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>제목</th><th>분류</th><th>담당 변호사</th><th>상태</th><th>신청일</th></tr>
          </thead>
          <tbody>
            ${rows.map(l => `
              <tr>
                <td><strong>${esc(l.title)}</strong></td>
                <td>${esc(l.category)}</td>
                <td>${l.lawyerName ? esc(l.lawyerName) : '<span style="color:var(--tok-text-4)">미배정</span>'}</td>
                <td>${legalStatusBadge(l.status)}</td>
                <td>${esc(l.createdAt)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('sg-legal-table-wrap').innerHTML = html;
  }

  /* ─── 자유 게시판 목록 ─── */
  function renderBoard(list) {
    const rows = list || [];
    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>제목</th><th>작성자</th><th>조회</th><th>작성일</th></tr>
          </thead>
          <tbody>
            ${rows.map(b => `
              <tr>
                <td>
                  ${b.isNotice ? '<span class="adm-badge adm-badge--blue" style="margin-right:4px">공지</span>' : ''}
                  <strong>${esc(b.title)}</strong>
                </td>
                <td>${esc(b.author)}</td>
                <td>${b.views || 0}</td>
                <td>${esc(b.createdAt)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('sg-board-table-wrap').innerHTML = html;
  }

  /* ─── 유틸 ─── */
  function esc(str) {
    if (str == null) return '-';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function incidentStatusBadge(s) {
    const map = { pending: ['yellow','대기'], processing: ['blue','처리 중'], closed: ['gray','종료'], in_review: ['blue','검토 중'] };
    const [cls, label] = map[s] || ['gray', s];
    return `<span class="adm-badge adm-badge--${cls}">${label}</span>`;
  }

  function legalStatusBadge(s) {
    const map = { pending: ['yellow','대기'], in_review: ['blue','검토 중'], resolved: ['green','완료'] };
    const [cls, label] = map[s] || ['gray', s];
    return `<span class="adm-badge adm-badge--${cls}">${label}</span>`;
  }

  function anonRevealBadge(s) {
    const map = { pending: ['yellow','대기'], approved: ['green','승인'], rejected: ['red','거절'] };
    const [cls, label] = map[s] || ['gray', s];
    return `<span class="adm-badge adm-badge--${cls}">${label}</span>`;
  }

  function showError(msg) {
    const w = document.getElementById('sg-incidents-table-wrap');
    if (w) w.innerHTML = `<p style="color:var(--tok-danger);padding:16px">${esc(msg)}</p>`;
  }

  /* ─── 공개 API ─── */
  window.AdminSirenGroup = { init, reload: loadData };

  /* admin-shell이 이 view를 활성화하면 init 호출 */
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('adm20-siren');
    if (container) {
      const obs = new MutationObserver(() => {
        if (container.classList.contains('is-active') && !container.dataset.initialized) {
          container.dataset.initialized = '1';
          init();
        }
      });
      obs.observe(container, { attributes: true, attributeFilter: ['class'] });
      if (container.classList.contains('is-active')) {
        container.dataset.initialized = '1';
        init();
      }
    }
  });
})();
