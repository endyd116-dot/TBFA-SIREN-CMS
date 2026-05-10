/* admin-members-group.js — Phase 20-A 회원·운영자 그룹 4탭 (실 API) */
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
      console.warn('[MembersGroup toast]', msg);
    }
  }

  /* ─── 상태 ─── */
  let currentTab = 'members';
  let membersData = null;

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-members');
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
          <button class="adm-group-tab is-active" data-tab="members">회원 관리</button>
          <button class="adm-group-tab" data-tab="operators">운영자 관리</button>
          <button class="adm-group-tab" data-tab="eligibility">자격 심사</button>
          <button class="adm-group-tab" data-tab="approvals">가입 승인</button>
        </div>

        <div class="adm-group-panel is-active" data-panel="members">
          <div class="adm-toolbar">
            <input type="search" placeholder="이름·이메일 검색…" id="mg-member-search">
            <select id="mg-member-grade">
              <option value="">전체 등급</option>
              <option value="정회원">정회원</option>
              <option value="후원회원">후원회원</option>
              <option value="일반회원">일반회원</option>
            </select>
            <select id="mg-member-status">
              <option value="">전체 상태</option>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
              <option value="black">차단</option>
            </select>
          </div>
          <div id="mg-members-table-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="operators">
          <div id="mg-operators-table-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="eligibility">
          <div id="mg-eligibility-table-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="approvals">
          <div id="mg-approvals-table-wrap"></div>
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
        if (membersData) renderTab(tab);
      });
    });

    container.querySelector('#mg-member-search')?.addEventListener('input', function () {
      if (membersData) renderMembers(membersData.members, this.value,
        container.querySelector('#mg-member-grade')?.value,
        container.querySelector('#mg-member-status')?.value);
    });
    container.querySelector('#mg-member-grade')?.addEventListener('change', function () {
      if (membersData) renderMembers(membersData.members,
        container.querySelector('#mg-member-search')?.value, this.value,
        container.querySelector('#mg-member-status')?.value);
    });
    container.querySelector('#mg-member-status')?.addEventListener('change', function () {
      if (membersData) renderMembers(membersData.members,
        container.querySelector('#mg-member-search')?.value,
        container.querySelector('#mg-member-grade')?.value, this.value);
    });
  }

  /* ─── 데이터 로드 ─── */
  async function loadData() {
    try {
      const res = await api({ url: '/api/admin-members-unified' });
      if (res.status === 401) return;
      if (!res.ok) throw new Error(res.data?.error || 'HTTP ' + res.status);
      /* 다중 fallback: data.data.X || data.X */
      const raw = res.data;
      const payload = raw?.data || raw;
      membersData = {
        members:     payload?.members     || [],
        operators:   payload?.operators   || [],
        eligibility: payload?.eligibility || [],
        approvals:   payload?.approvals   || [],
        totalCount:  payload?.totalCount  ?? 0,
      };
      renderTab(currentTab);
    } catch (err) {
      console.error('[MembersGroup]', err);
      showToast('회원 데이터를 불러오지 못했습니다: ' + err.message);
      showError('회원 데이터를 불러오지 못했습니다: ' + err.message);
    }
  }

  function renderTab(tab) {
    if (!membersData) return;
    if (tab === 'members')     renderMembers(membersData.members);
    if (tab === 'operators')   renderOperators(membersData.operators);
    if (tab === 'eligibility') renderEligibility(membersData.eligibility);
    if (tab === 'approvals')   renderApprovals(membersData.approvals);
  }

  /* ─── 회원 목록 ─── */
  function renderMembers(members, search = '', grade = '', status = '') {
    let rows = members || [];
    if (search) rows = rows.filter(m =>
      m.name.includes(search) || m.email.includes(search));
    if (grade)  rows = rows.filter(m => m.grade === grade);
    if (status) rows = rows.filter(m => m.status === status);

    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr>
              <th>이름</th><th>이메일</th><th>전화</th><th>등급</th>
              <th>상태</th><th>가입일</th><th>누적 후원</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--tok-text-3)">해당 회원이 없습니다</td></tr>'
              : rows.map(m => `
                <tr>
                  <td><strong>${esc(m.name)}</strong></td>
                  <td>${esc(m.email)}</td>
                  <td>${esc(m.phone)}</td>
                  <td>${esc(m.grade?.nameKo)}</td>
                  <td>${statusBadge(m.status)}</td>
                  <td>${esc(m.joinedAt)}</td>
                  <td>${(m.donateTotal || 0).toLocaleString()}원</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">총 ${rows.length}명</p>`;
    document.getElementById('mg-members-table-wrap').innerHTML = html;
  }

  /* ─── 운영자 목록 ─── */
  function renderOperators(operators) {
    const rows = operators || [];
    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>이름</th><th>이메일</th><th>권한</th><th>생성일</th><th>최근 로그인</th></tr>
          </thead>
          <tbody>
            ${rows.map(o => `
              <tr>
                <td><strong>${esc(o.name)}</strong></td>
                <td>${esc(o.email)}</td>
                <td>${roleBadge(o.role)}</td>
                <td>${esc(o.createdAt)}</td>
                <td>${esc(o.lastLogin)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('mg-operators-table-wrap').innerHTML = html;
  }

  /* ─── 자격 심사 목록 ─── */
  function renderEligibility(list) {
    const rows = list || [];
    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>신청자</th><th>이메일</th><th>현재 등급</th><th>요청 등급</th><th>상태</th><th>신청일</th></tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tok-text-3)">대기 중인 자격 심사가 없습니다</td></tr>'
              : rows.map(e => `
                <tr>
                  <td>${esc(e.memberName)}</td>
                  <td>${esc(e.memberEmail)}</td>
                  <td>${esc(e.currentType)}</td>
                  <td><strong>${esc(e.requestedType)}</strong></td>
                  <td>${eligibilityBadge(e.status)}</td>
                  <td>${esc(e.createdAt)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('mg-eligibility-table-wrap').innerHTML = html;
  }

  /* ─── 가입 승인 목록 ─── */
  function renderApprovals(list) {
    const rows = list || [];
    const html = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr><th>이름</th><th>이메일</th><th>전화</th><th>신청일</th><th>상태</th><th>처리</th></tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tok-text-3)">대기 중인 가입 신청이 없습니다</td></tr>'
              : rows.map(a => `
                <tr>
                  <td>${esc(a.name)}</td>
                  <td>${esc(a.email)}</td>
                  <td>${esc(a.phone)}</td>
                  <td>${esc(a.requestedAt)}</td>
                  <td>${approvalBadge(a.status)}</td>
                  <td>
                    <button class="adm-btn adm-btn--primary" style="padding:4px 10px;font-size:11.5px" onclick="alert('승인 처리 (20-C 실API 연결 후 동작)')">승인</button>
                    <button class="adm-btn adm-btn--secondary" style="padding:4px 10px;font-size:11.5px;margin-left:4px" onclick="alert('거절 처리 (20-C 실API 연결 후 동작)')">거절</button>
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('mg-approvals-table-wrap').innerHTML = html;
  }

  /* ─── 유틸 ─── */
  function esc(str) {
    if (str == null) return '-';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function statusBadge(s) {
    const map = { active: ['green','활성'], inactive: ['gray','비활성'], black: ['red','차단'] };
    const [cls, label] = map[s] || ['gray', s];
    return `<span class="adm-badge adm-badge--${cls}">${label}</span>`;
  }

  function roleBadge(r) {
    return r === 'super_admin'
      ? '<span class="adm-badge adm-badge--red">슈퍼관리자</span>'
      : '<span class="adm-badge adm-badge--blue">관리자</span>';
  }

  function eligibilityBadge(s) {
    const map = { pending: ['yellow','대기'], approved: ['green','승인'], rejected: ['red','거절'] };
    const [cls, label] = map[s] || ['gray', s];
    return `<span class="adm-badge adm-badge--${cls}">${label}</span>`;
  }

  function approvalBadge(s) {
    const map = { pending: ['yellow','대기'], approved: ['green','승인'], rejected: ['red','거절'] };
    const [cls, label] = map[s] || ['gray', s];
    return `<span class="adm-badge adm-badge--${cls}">${label}</span>`;
  }

  function showError(msg) {
    const w = document.getElementById('mg-members-table-wrap');
    if (w) w.innerHTML = `<p style="color:var(--tok-danger);padding:16px">${esc(msg)}</p>`;
  }

  /* ─── 공개 API ─── */
  window.AdminMembersGroup = { init, reload: loadData };

  /* admin-shell이 이 view를 활성화하면 init 호출 */
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('adm20-members');
    if (container) {
      /* MutationObserver: is-active 클래스 추가 시 init */
      const obs = new MutationObserver(() => {
        if (container.classList.contains('is-active') && !container.dataset.initialized) {
          container.dataset.initialized = '1';
          init();
        }
      });
      obs.observe(container, { attributes: true, attributeFilter: ['class'] });
      /* 이미 활성이면 즉시 */
      if (container.classList.contains('is-active')) {
        container.dataset.initialized = '1';
        init();
      }
    }
  });
})();
