/* admin-siren-group.js — Phase 20-A 사이렌 신고 그룹 4탭 + 익명 식별 사건 탭 흡수 (mock 모드) */
(function () {
  'use strict';

  const USE_MOCK = true;

  /* mock 데이터 — 응답 키: { ok, incidents[], harassment[], legal[], board[], anonRevealCases[] } */
  const MOCK_SIREN_UNIFIED = {
    ok: true,
    incidents: [
      { id: 1,  title: '학교 내 괴롭힘 신고', category: '학교폭력', status: 'processing', reporterMask: '신고자-A', createdAt: '2026-05-10', isAnon: false },
      { id: 2,  title: '익명 제보 — 부당해고', category: '노동', status: 'pending',    reporterMask: '익명-2XK', createdAt: '2026-05-11', isAnon: true },
      { id: 3,  title: '교원 상담 요청',       category: '상담',  status: 'closed',     reporterMask: '신고자-B', createdAt: '2026-05-09', isAnon: false },
    ],
    harassment: [
      { id: 101, title: '민원인 반복 전화 민원', status: 'processing', reporterMask: '민원-C',   createdAt: '2026-05-08', count: 12 },
      { id: 102, title: '온라인 악성 댓글',      status: 'pending',    reporterMask: '민원-D',   createdAt: '2026-05-11', count: 3 },
    ],
    legal: [
      { id: 201, title: '산재 법률 지원 요청', status: 'in_review', lawyerName: '김변호사', createdAt: '2026-05-07', category: '산업재해' },
      { id: 202, title: '학폭 소송 지원',       status: 'pending',   lawyerName: null,      createdAt: '2026-05-11', category: '학교폭력' },
    ],
    board: [
      { id: 301, title: '협의회 공지사항 게시',  author: '관리자A', createdAt: '2026-05-11', views: 142, isNotice: true },
      { id: 302, title: '5월 활동 보고 게시글', author: '김철수',  createdAt: '2026-05-10', views: 58,  isNotice: false },
    ],
    anonRevealCases: [
      { id: 401, incidentTitle: '익명 제보 — 부당해고', requestedBy: '관리자A', reason: '수사 협조 요청', status: 'pending',  requestedAt: '2026-05-11' },
      { id: 402, incidentTitle: '익명 학교폭력 제보',   requestedBy: '관리자A', reason: '피해자 동의 확인', status: 'approved', requestedAt: '2026-05-09' },
    ],
  };

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
      let data;
      if (USE_MOCK) {
        data = MOCK_SIREN_UNIFIED;
      } else {
        const res = await fetch('/api/admin-siren-unified');
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || '응답 오류');
        data = json.data || json;
      }
      sirenData = data;
      renderTab(currentTab);
      renderAnonReveal(data.anonRevealCases);
    } catch (err) {
      console.error('[SirenGroup]', err);
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
