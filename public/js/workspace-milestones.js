/**
 * workspace-milestones.js — Phase 24 성과 관리
 * 개인 성과 대시보드: 내 현황 / 매출 입력 / 매출 검증 / 비매출 성과 / 분기 결산
 */
(function () {
  'use strict';

  /* ─── 상태 ─── */
  let state = {
    member: null,        // 로그인 멤버 (milestoneRole 포함)
    quarters: [],
    currentQuarterId: null,
    dashboard: null,     // GET /api/milestone-dashboard 응답
    milestones: [],      // 본인 역할의 마일스톤 정의
    revenueEntries: [],
    pendingVerifications: [],
    nonRevAchs: [],
    settlement: null,
    isAdmin: false,
    isSuperAdmin: false,
    nrSelectedIds: [],   // 비매출 선택 중 IDs
    rejectTarget: null,  // { type: 'revenue'|'nonrevenue', id }
  };

  /* ─── 유틸 ─── */
  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.from((root || document).querySelectorAll(s)); }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
  function fmt(n) { return Number(n||0).toLocaleString('ko-KR') + '원'; }
  function fmtDate(d) { return d ? String(d).slice(0,10) : ''; }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body != null ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) { const err = new Error((data && (data.error || data.message)) || 'HTTP ' + res.status); (err as any).status = res.status; throw err; }
    return data;
  }

  function toast(msg, type) {
    const root = $('#wsToast') || document.body;
    const el = document.createElement('div');
    el.style.cssText = `padding:12px 18px;border-radius:8px;color:#fff;font-size:13.5px;margin-top:8px;
      background:${type==='error'?'#dc2626':type==='success'?'#16a34a':'#334155'};box-shadow:0 4px 12px rgba(0,0,0,.15)`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ─── 초기화 ─── */
  document.addEventListener('DOMContentLoaded', async () => {
    // 로그인 확인
    try {
      const meData = await api('/api/admin/me?light=1');
      state.member = meData.admin || meData.data || meData.member || meData;
      state.isAdmin = state.member.role === 'admin' || state.member.role === 'super_admin';
      state.isSuperAdmin = state.member.role === 'super_admin';
    } catch {
      window.location.href = '/login.html';
      return;
    }

    // milestoneRole 없으면 안내
    if (!state.member.milestoneRole && !state.isSuperAdmin) {
      $('#msSubtitle').textContent = '성과 담당 역할이 설정되어 있지 않습니다. 슈퍼어드민에게 문의하세요.';
      return;
    }

    // 어드민 전용 탭 표시
    if (state.isAdmin) {
      $$('.admin-only').forEach(el => { el.style.display = ''; });
    }

    // 사용자 정보 표시
    const roleLabel = { SM: '사무국장', PM: '정책국장', SI: 'SI관리자' };
    $('#msSubtitle').textContent = `${state.member.name || ''} · ${roleLabel[state.member.milestoneRole] || state.member.milestoneRole || ''} · ${state.member.role}`;

    // 분기 목록 로드
    await loadQuarters();

    // 분기가 없으면 안내 메시지만 표시
    if (!state.currentQuarterId) {
      const loading = $('#overviewLoading') as HTMLElement;
      const content = $('#overviewContent') as HTMLElement;
      if (loading) loading.style.display = 'none';
      if (content) {
        content.style.display = '';
        content.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px 20px">활성 분기가 없습니다.<br>슈퍼어드민에서 분기를 추가해 주세요.</div>';
      }
      return;
    }

    // 탭 이벤트
    $$('#msTabs .ms-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // 기본 탭 로드
    await loadDashboard();
    await loadRevenueMilestones();
    renderOverview();
  });

  /* ─── 분기 ─── */
  async function loadQuarters() {
    try {
      const res = await api('/api/milestone-quarters');
      state.quarters = (res.data?.quarters || res.quarters || []);
      const active = state.quarters.find(q => q.status === 'ACTIVE');
      state.currentQuarterId = active ? active.id : (state.quarters[0]?.id || null);
      renderQuarterSelect();
    } catch (e) { toast('분기 로드 실패: ' + (e as any).message, 'error'); }
  }

  function renderQuarterSelect() {
    const sel = $('#msQuarterSelect') as HTMLSelectElement;
    if (!sel) return;
    sel.innerHTML = state.quarters.map(q =>
      `<option value="${q.id}" ${q.id===state.currentQuarterId?'selected':''}>${q.year}년 Q${q.quarter}</option>`
    ).join('');
    sel.onchange = async () => {
      state.currentQuarterId = Number(sel.value);
      await loadDashboard();
      renderCurrentTab();
      updateQuarterBadge();
    };
    updateQuarterBadge();
  }

  function updateQuarterBadge() {
    const q = state.quarters.find(x => x.id === state.currentQuarterId);
    const badge = $('#msQuarterBadge');
    if (!badge || !q) return;
    badge.textContent = { ACTIVE:'진행 중', UPCOMING:'예정', ENDED:'종료', SETTLED:'정산 완료' }[q.status] || q.status;
    badge.className = 'ms-quarter-badge ' + (q.status === 'ACTIVE' ? 'active' : q.status === 'ENDED' || q.status === 'SETTLED' ? 'ended' : '');
  }

  /* ─── 대시보드 ─── */
  async function loadDashboard() {
    if (!state.currentQuarterId) return;
    try {
      const res = await api(`/api/milestone-dashboard?quarterId=${state.currentQuarterId}`);
      state.dashboard = res.data || res;
      state.nonRevAchs = state.dashboard.nonRevenueAchievements || [];
      state.settlement = state.dashboard.settlement;
    } catch (e) { toast('대시보드 로드 실패: ' + (e as any).message, 'error'); }
  }

  /* ─── 매출연동 마일스톤 정의 로드 (입력 폼용) ─── */
  async function loadRevenueMilestones() {
    if (!state.member.milestoneRole) return;
    try {
      const res = await api(`/api/milestone-definitions?role=${state.member.milestoneRole}&category=REVENUE_LINKED`);
      state.milestones = res.data?.milestones || res.milestones || [];
      buildMilestoneSelect('#riMilestoneId', state.milestones);
    } catch { /* non-critical */ }
  }

  function buildMilestoneSelect(selector, milestones) {
    const el = $(selector) as HTMLSelectElement;
    if (!el) return;
    el.innerHTML = '<option value="">마일스톤 선택...</option>' +
      milestones.map(m => `<option value="${m.id}">${m.name} (${m.code})</option>`).join('');
  }

  /* ─── 탭 전환 ─── */
  function switchTab(tab) {
    $$('#msTabs .ms-tab').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
    $$('.ms-tab-panel').forEach(p => { (p as HTMLElement).style.display = 'none'; });
    const panels = { overview:'tabOverview', 'revenue-input':'tabRevenueInput', 'revenue-verify':'tabRevenueVerify', nonrevenue:'tabNonRevenue', settlement:'tabSettlement' };
    const panelEl = $(('#' + panels[tab]) || '#tabOverview');
    if (panelEl) (panelEl as HTMLElement).style.display = '';
    if (tab === 'overview')         renderOverview();
    if (tab === 'revenue-input')    loadAndRenderRevenueList();
    if (tab === 'revenue-verify')   loadAndRenderVerifyList();
    if (tab === 'nonrevenue')       renderNonRevenue();
    if (tab === 'settlement')       renderSettlement();
  }

  function renderCurrentTab() {
    const active = $('#msTabs .ms-tab.active') as HTMLElement;
    if (active) switchTab(active.dataset.tab);
  }

  /* ─── 내 현황 탭 ─── */
  function renderOverview() {
    const loading = $('#overviewLoading') as HTMLElement;
    const content = $('#overviewContent') as HTMLElement;
    if (!state.dashboard) {
      loading.style.display = 'none';
      content.style.display = '';
      content.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:40px 20px">성과 데이터를 불러올 수 없습니다.<br>분기 설정을 확인해 주세요.</div>';
      return;
    }
    loading.style.display = 'none';
    content.style.display = '';

    const d = state.dashboard;
    const inc = d.estimatedIncentive || {};
    $('#kpiRevenue').textContent  = fmt(inc.revenueLinked || 0);
    $('#kpiNonRevenue').textContent = fmt(inc.nonRevenue || 0);
    $('#kpiTotal').textContent    = fmt(inc.total || 0);
    ($('#msKpiRow') as HTMLElement).style.display = '';

    const progress = d.revenueProgress || [];
    if (!progress.length) {
      content.innerHTML = '<div class="ms-empty" style="margin-bottom:16px"><div class="ms-empty-icon">📊</div>담당 매출연동 마일스톤이 없습니다.</div>';
    } else {
      content.innerHTML = '<h3 style="font-size:15px;font-weight:700;margin-bottom:12px">매출연동 마일스톤 진행률</h3>' +
      progress.map(p => `
        <div class="ms-progress-card">
          <div class="ms-progress-top">
            <div>
              <div class="ms-progress-name">${escHtml(p.name)}</div>
              <div class="ms-progress-code">${escHtml(p.code)} · ${escHtml(p.businessUnit || '')}</div>
            </div>
            <div style="text-align:right">
              <div class="ms-progress-amt">${p.estimatedIncentive > 0 ? fmt(p.estimatedIncentive) : '-'}</div>
              <span class="ms-threshold-tag ${p.thresholdStatus === 'ABOVE' ? 'above' : p.thresholdStatus === 'BELOW' ? 'below' : 'na'}">
                ${p.thresholdStatus === 'ABOVE' ? '임계점 초과' : p.thresholdStatus === 'BELOW' ? '임계점 미달' : ''}
              </span>
            </div>
          </div>
          <div class="ms-progress-bar-wrap">
            <div class="ms-progress-bar ${p.thresholdStatus === 'ABOVE' ? 'above' : 'below'}" style="width:${Math.min(p.progressPct||0,100)}%"></div>
          </div>
          <div class="ms-progress-meta">
            <span>${p.thresholdEnabled ? `임계점: ${Number(p.thresholdValue||0).toLocaleString()} ${p.thresholdUnit||''}` : '임계점 없음'}</span>
            <span>달성: ${Number(p.currentVerifiedAmount||0).toLocaleString()} ${p.thresholdUnit||''} (${p.progressPct||0}%)</span>
          </div>
        </div>
      `).join('');
    }

    // ★ Phase 25: 보류 큐 + 보관함 + 카드 생성 섹션 삽입
    content.insertAdjacentHTML('beforeend', `
      <div style="margin-top:28px">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:10px">🔍 성과 분류 보류 카드</h3>
        <div id="p25PendingSection" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
          <div style="font-size:13px;color:#9ca3af">불러오는 중...</div>
        </div>
      </div>
      <div style="margin-top:24px">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:10px">📁 보관함 (성과별)</h3>
        <div id="p25DoneSection" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
          <div style="font-size:13px;color:#9ca3af">불러오는 중...</div>
        </div>
      </div>
      <div style="margin-top:24px">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:10px">🏆 마일스톤 → WBS 카드 생성</h3>
        <div id="p25CardCreate" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
          <div style="font-size:13px;color:#9ca3af">불러오는 중...</div>
        </div>
      </div>`);
    loadAndRenderPendingQueue();
    loadAndRenderDoneTasks();
    if (state.member.milestoneRole) loadNonRevMilestonesForCardCreate();
  }

  /* ─── 매출 입력 탭 ─── */
  async function loadAndRenderRevenueList() {
    const list = $('#riList');
    if (!list) return;
    list.innerHTML = '<div class="ms-loading">불러오는 중...</div>';
    try {
      const res = await api(`/api/milestone-revenue?quarterId=${state.currentQuarterId}`);
      state.revenueEntries = res.data?.entries || res.entries || [];
      renderRevenueList();
    } catch (e) { list.innerHTML = `<div class="ms-empty">로드 실패: ${escHtml((e as any).message)}</div>`; }
  }

  function renderRevenueList() {
    const list = $('#riList');
    if (!list) return;
    if (!state.revenueEntries.length) { list.innerHTML = '<div class="ms-empty"><div class="ms-empty-icon">📥</div>입력 내역이 없습니다.</div>'; return; }
    list.innerHTML = `<table class="ms-table">
      <thead><tr><th>날짜</th><th>마일스톤</th><th>금액/수량</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>${state.revenueEntries.map(e => `
        <tr>
          <td style="font-size:12px;white-space:nowrap">${fmtDate(e.revenueDate)}</td>
          <td>${escHtml(e.milestoneName||'')} <small style="color:#9ca3af">${escHtml(e.milestoneCode||'')}</small></td>
          <td style="font-weight:600">${Number(e.amount||0).toLocaleString()} ${escHtml(e.amountUnit||'')}</td>
          <td><span class="ms-badge ${e.status}">${{PENDING:'검증 대기',VERIFIED:'검증 완료',REJECTED:'반려'}[e.status]||e.status}</span></td>
          <td style="font-size:12px;color:#6b7280">${escHtml(e.note||'')}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  // 입력 폼 이벤트
  document.addEventListener('DOMContentLoaded', () => {
    const savBtn = $('#riBtnSave');
    if (savBtn) savBtn.addEventListener('click', saveRevenueEntry);

    const milSel = $('#riMilestoneId') as HTMLSelectElement;
    if (milSel) milSel.addEventListener('change', () => {
      const wrap = $('#riCampaignWrap') as HTMLElement;
      const m = state.milestones.find(x => String(x.id) === milSel.value);
      if (wrap) wrap.style.display = m && ['sm-001','sm-002'].includes(m.code) ? '' : 'none';
    });

    // 기본 날짜
    const dateEl = $('#riDate') as HTMLInputElement;
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  });

  async function saveRevenueEntry() {
    const milestoneDefinitionId = Number(($('#riMilestoneId') as HTMLSelectElement).value);
    const revenueDate = ($('#riDate') as HTMLInputElement).value;
    const amount = Number(($('#riAmount') as HTMLInputElement).value);
    const amountUnit = ($('#riUnit') as HTMLSelectElement).value;
    const note = ($('#riNote') as HTMLInputElement).value.trim();
    const isCampaignRouted = ($('#riCampaignRouted') as HTMLSelectElement)?.value === 'true';
    if (!milestoneDefinitionId) { toast('마일스톤을 선택하세요', 'error'); return; }
    if (!revenueDate) { toast('날짜를 입력하세요', 'error'); return; }
    if (!amount || amount <= 0) { toast('금액/수량을 입력하세요', 'error'); return; }
    const btn = $('#riBtnSave') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await api('/api/milestone-revenue', {
        method: 'POST',
        body: { milestoneDefinitionId, quarterId: state.currentQuarterId, revenueDate, amount, amountUnit, note: note||null, isCampaignRouted },
      });
      toast('입력 완료 (검증 대기)', 'success');
      ($('#riAmount') as HTMLInputElement).value = '';
      ($('#riNote') as HTMLInputElement).value = '';
      await loadAndRenderRevenueList();
    } catch (e) { toast('입력 실패: ' + (e as any).message, 'error'); }
    finally { btn.disabled = false; }
  }

  /* ─── 매출 검증 탭 (어드민) ─── */
  async function loadAndRenderVerifyList() {
    const list = $('#rvList');
    if (!list) return;
    list.innerHTML = '<div class="ms-loading">불러오는 중...</div>';
    const status = ($('#rvStatusFilter') as HTMLSelectElement)?.value || 'PENDING';
    try {
      const res = await api(`/api/admin-milestone-revenue?quarterId=${state.currentQuarterId}&status=${status}`);
      state.pendingVerifications = res.data?.entries || res.entries || [];
      renderVerifyList();
    } catch (e) { list.innerHTML = `<div class="ms-empty">로드 실패: ${escHtml((e as any).message)}</div>`; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const statusFilter = $('#rvStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', loadAndRenderVerifyList);
  });

  function renderVerifyList() {
    const list = $('#rvList');
    if (!list) return;
    if (!state.pendingVerifications.length) { list.innerHTML = '<div class="ms-empty"><div class="ms-empty-icon">✅</div>검증할 항목이 없습니다.</div>'; return; }
    list.innerHTML = `<table class="ms-table">
      <thead><tr><th>날짜</th><th>입력자</th><th>마일스톤</th><th>금액/수량</th><th>상태</th><th>액션</th></tr></thead>
      <tbody>${state.pendingVerifications.map(e => {
        const formula = e.bonusFormula || {};
        const isEventRange = formula.type === 'EVENT_RANGE' || formula.formula_type === 'EVENT_RANGE';
        const rangeMin = formula.minAmount || formula.min || 0;
        const rangeMax = formula.maxAmount || formula.max || 0;
        const rangeHint = isEventRange
          ? `<div style="font-size:11px;color:#7c3aed;margin-top:3px">범위: ${Number(rangeMin).toLocaleString()}~${Number(rangeMax).toLocaleString()}만원</div>
             <input type="number" id="eventRangeAmount_${e.id}" placeholder="금액 입력" min="${rangeMin}" max="${rangeMax}" disabled
               style="margin-top:4px;width:120px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12.5px">`
          : '';
        const actionBtn = e.status === 'PENDING' ? `
          ${isEventRange ? `<button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="window.__msVerifyEventRange(${e.id})" style="background:#ede9fe;color:#5b21b6;border:none">검증 + 금액 확정</button>` :
            `<button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="window.__msVerify('revenue','verify',${e.id})">✅ 승인</button>`}
          <button class="ms-btn ms-btn-danger ms-btn-sm" style="margin-left:4px" onclick="window.__msVerify('revenue','reject',${e.id})">반려</button>
        ` : '';
        return `
        <tr>
          <td style="font-size:12px;white-space:nowrap">${fmtDate(e.revenueDate)}</td>
          <td style="font-size:12.5px">${escHtml(e.enteredByName||'')}</td>
          <td>${escHtml(e.milestoneName||'')} <small style="color:#9ca3af">${escHtml(e.milestoneCode||'')}</small>${rangeHint}</td>
          <td style="font-weight:600">${Number(e.amount||0).toLocaleString()} ${escHtml(e.amountUnit||'')}</td>
          <td><span class="ms-badge ${e.status}">${{PENDING:'대기',VERIFIED:'완료',REJECTED:'반려'}[e.status]||e.status}</span></td>
          <td>${actionBtn}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

    // EVENT_RANGE 입력 필드 활성화 (렌더 후 이벤트 바인딩)
    state.pendingVerifications.forEach(e => {
      const input = document.getElementById(`eventRangeAmount_${e.id}`) as HTMLInputElement;
      if (input) input.disabled = false;
    });
  }

  window.__msVerifyEventRange = async function(id) {
    const input = document.getElementById(`eventRangeAmount_${id}`) as HTMLInputElement;
    const eventRangeAmount = input ? Number(input.value) : 0;
    if (!eventRangeAmount || eventRangeAmount <= 0) { toast('금액을 입력하세요', 'error'); return; }
    try {
      await api('/api/admin-milestone-revenue', { method: 'PUT', body: { id, action: 'verify', eventRangeAmount } });
      toast('검증 및 금액 확정 완료', 'success');
      await loadAndRenderVerifyList();
    } catch (e) { toast('처리 실패: ' + (e as any).message, 'error'); }
  };

  window.__msVerify = async function(type, action, id) {
    if (action === 'reject') {
      state.rejectTarget = { type, id };
      ($('#rejectReason') as HTMLTextAreaElement).value = '';
      ($('#rejectModal') as HTMLElement).style.display = '';
      return;
    }
    try {
      await api(`/api/admin-milestone-${type}/${id}/${action}`, { method: 'POST' });
      toast(action === 'verify' ? '승인 완료' : '처리 완료', 'success');
      await loadAndRenderVerifyList();
    } catch (e) { toast('처리 실패: ' + (e as any).message, 'error'); }
  };

  // 반려 모달
  document.addEventListener('DOMContentLoaded', () => {
    $('#rejectCancel')?.addEventListener('click', () => { ($('#rejectModal') as HTMLElement).style.display = 'none'; });
    $('#rejectConfirm')?.addEventListener('click', async () => {
      const reason = ($('#rejectReason') as HTMLTextAreaElement).value.trim();
      if (!reason) { toast('반려 사유를 입력하세요', 'error'); return; }
      if (!state.rejectTarget) return;
      const btn = $('#rejectConfirm') as HTMLButtonElement;
      btn.disabled = true;
      try {
        await api(`/api/admin-milestone-${state.rejectTarget.type}/${state.rejectTarget.id}/reject`, { method: 'POST', body: { rejectReason: reason } });
        toast('반려 완료', 'success');
        ($('#rejectModal') as HTMLElement).style.display = 'none';
        state.rejectTarget = null;
        if ($('#msTabs .ms-tab.active')?.dataset?.tab === 'revenue-verify') await loadAndRenderVerifyList();
      } catch (e) { toast('반려 실패: ' + (e as any).message, 'error'); }
      finally { btn.disabled = false; }
    });
  });

  /* ─── 비매출 성과 탭 ─── */
  function renderNonRevenue() {
    const list = $('#nrList');
    if (!list) return;
    const achs = state.nonRevAchs;
    if (!achs.length) { list.innerHTML = '<div class="ms-empty"><div class="ms-empty-icon">🎯</div>제출한 비매출 성과가 없습니다.</div>'; return; }

    // 현재 선택된 IDs (initial)
    state.nrSelectedIds = achs.filter(a => a.isSelectedForQuarter).map(a => a.id);
    renderNrCards(achs);
  }

  function renderNrCards(achs) {
    const list = $('#nrList');
    if (!list) return;

    const selectedCount = state.nrSelectedIds.length;
    const maxReached = selectedCount >= 2;

    // 섹션 헤더 배지
    const badge = `<span class="ms-select-badge" style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${selectedCount===2?'#dcfce7':'#eff6ff'};color:${selectedCount===2?'#15803d':'#1d4ed8'};margin-left:8px">선택됨 ${selectedCount}/2개</span>`;

    // 선택된 항목들의 보너스 합산
    const selectedBonus = achs
      .filter(a => state.nrSelectedIds.includes(a.id))
      .reduce((sum, a) => sum + Number(a.bonusAmount || 0), 0);

    list.innerHTML = `
      <div style="display:flex;align-items:center;margin-bottom:12px">
        <span style="font-size:14px;font-weight:700;color:#111">비매출 성과 항목</span>${badge}
      </div>
      ${achs.map(a => {
        const selIdx = state.nrSelectedIds.indexOf(a.id);
        const isSelected = selIdx >= 0;
        const checkClass = isSelected ? (selIdx === 0 ? 'selected' : 'selected-2') : '';
        const canSelect = a.status === 'VERIFIED';
        const isDisabled = canSelect && !isSelected && maxReached;
        const cardStyle = isSelected
          ? 'border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;background:#f0fdf4'
          : isDisabled
            ? 'border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;opacity:0.5;background:#f9fafb'
            : 'border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;background:#fff';
        const checkEl = canSelect
          ? `<div class="ms-ach-check ${checkClass}" onclick="${isDisabled ? "window.__nrMaxToast()" : `window.__nrToggle(${a.id})`}"
               title="${isDisabled ? '최대 2개 선택 가능' : ''}"
               style="cursor:${isDisabled?'not-allowed':'pointer'}">${isSelected ? (selIdx+1) : ''}</div>`
          : '<div style="width:22px"></div>';
        const nameStyle = isSelected ? 'font-weight:700;color:#111' : 'font-weight:500;color:#374151';
        const bonusStyle = isSelected ? 'font-weight:700;color:#15803d' : 'color:#6b7280';
        return `
          <div style="${cardStyle}">
            ${checkEl}
            <div class="ms-ach-body" style="flex:1">
              <div class="ms-ach-name" style="${nameStyle}">${escHtml(a.name||a.milestoneName||'')}</div>
              <div class="ms-ach-meta">달성일: ${fmtDate(a.achievedDate)} · <span class="ms-badge ${a.status}">${{PENDING:'검증 대기',VERIFIED:'검증 완료',REJECTED:'반려'}[a.status]||a.status}</span></div>
              ${a.description ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">${escHtml(a.description)}</div>` : ''}
            </div>
            <div class="ms-ach-bonus" style="${bonusStyle}">${fmt(a.bonusAmount)}</div>
          </div>`;
      }).join('')}
      <div style="margin-top:14px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:13.5px">
        <span style="font-weight:700;color:#111">선택된 비매출 보너스: ${fmt(selectedBonus)}</span>
        <span style="color:#6b7280;margin-left:8px">(${selectedCount}/2)</span>
      </div>`;

    const saveBtn = $('#nrBtnSaveSelect') as HTMLElement;
    if (saveBtn) saveBtn.style.display = achs.some(a => a.status === 'VERIFIED') ? '' : 'none';
  }

  window.__nrMaxToast = function() {
    toast('최대 2개까지만 선택 가능합니다', 'error');
  };

  window.__nrToggle = function(id) {
    const idx = state.nrSelectedIds.indexOf(id);
    if (idx >= 0) {
      state.nrSelectedIds.splice(idx, 1);
    } else {
      if (state.nrSelectedIds.length >= 2) { toast('최대 2개까지만 선택 가능합니다', 'error'); return; }
      state.nrSelectedIds.push(id);
    }
    renderNrCards(state.nonRevAchs);
  };

  document.addEventListener('DOMContentLoaded', () => {
    $('#nrBtnSaveSelect')?.addEventListener('click', async () => {
      const btn = $('#nrBtnSaveSelect') as HTMLButtonElement;
      btn.disabled = true;
      try {
        await api('/api/milestone-nonrevenue/select', {
          method: 'POST', body: { quarterId: state.currentQuarterId, selectedIds: state.nrSelectedIds },
        });
        toast('선택 저장 완료', 'success');
        await loadDashboard();
        renderNonRevenue();
      } catch (e) { toast('저장 실패: ' + (e as any).message, 'error'); }
      finally { btn.disabled = false; }
    });

    // 비매출 성과 제출 모달
    $('#nrBtnSubmit')?.addEventListener('click', async () => {
      // 비매출 마일스톤 목록 로드
      try {
        const res = await api(`/api/milestone-definitions?role=${state.member.milestoneRole}&category=NON_REVENUE`);
        const nrMs = res.data?.milestones || res.milestones || [];
        buildMilestoneSelect('#nrMilestoneId', nrMs);
      } catch { /* ignore */ }
      ($('#nrAchievedDate') as HTMLInputElement).value = new Date().toISOString().slice(0,10);
      ($('#nrModal') as HTMLElement).style.display = '';
    });

    $('#nrModalClose')?.addEventListener('click', () => { ($('#nrModal') as HTMLElement).style.display = 'none'; });
    $('#nrModalSave')?.addEventListener('click', async () => {
      const milestoneDefinitionId = Number(($('#nrMilestoneId') as HTMLSelectElement).value);
      const achievedDate = ($('#nrAchievedDate') as HTMLInputElement).value;
      const description = ($('#nrDescription') as HTMLTextAreaElement).value.trim();
      if (!milestoneDefinitionId || !achievedDate) { toast('마일스톤과 달성일을 입력하세요', 'error'); return; }
      const btn = $('#nrModalSave') as HTMLButtonElement;
      btn.disabled = true;
      try {
        await api('/api/milestone-nonrevenue', {
          method: 'POST', body: { milestoneDefinitionId, quarterId: state.currentQuarterId, achievedDate, description },
        });
        toast('성과 제출 완료 (검증 대기)', 'success');
        ($('#nrModal') as HTMLElement).style.display = 'none';
        await loadDashboard();
        renderNonRevenue();
      } catch (e) { toast('제출 실패: ' + (e as any).message, 'error'); }
      finally { btn.disabled = false; }
    });
  });

  /* ─── Phase 25: 보류 분류 큐 ─── */
  async function loadAndRenderPendingQueue() {
    const container = $('#p25PendingSection');
    if (!container) return;
    try {
      const res = await api('/api/workspace-milestone-pending');
      const tasks = res.data?.tasks || [];
      const defs  = res.data?.milestones || [];
      if (!tasks.length) {
        (container as HTMLElement).innerHTML =
          '<div style="font-size:13px;color:#9ca3af;padding:12px 0">분류 대기 카드가 없습니다.</div>';
        return;
      }
      const defsOpts = defs.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`).join('');
      (container as HTMLElement).innerHTML = `
        <p style="font-size:12.5px;color:#6b7280;margin:0 0 10px">완료 카드 중 성과 분류가 필요한 항목입니다. AI가 처리하지 못한 건을 직접 지정하세요.</p>
        ${tasks.map(t => `
          <div class="ms-pending-item" data-task-id="${t.id}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6">
            <span style="flex:1;font-size:13px;color:#374151">${escHtml(t.title)}</span>
            <select class="p25-def-sel" data-task-id="${t.id}" style="padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px">
              <option value="">-- 마일스톤 선택 --</option>${defsOpts}
            </select>
            <button class="ms-btn ms-btn-primary ms-btn-sm p25-confirm" data-task-id="${t.id}" style="font-size:12px;padding:4px 10px">확인</button>
            <button class="ms-btn ms-btn-ghost ms-btn-sm p25-skip" data-task-id="${t.id}" style="font-size:12px;padding:4px 8px">제외</button>
          </div>
        `).join('')}`;

      (container as HTMLElement).querySelectorAll('.p25-confirm').forEach(btn => {
        btn.addEventListener('click', async () => {
          const taskId = Number((btn as HTMLElement).dataset.taskId);
          const sel = (container as HTMLElement).querySelector(`.p25-def-sel[data-task-id="${taskId}"]`) as HTMLSelectElement;
          const milestoneDefId = Number(sel?.value || 0);
          if (!milestoneDefId) { toast('마일스톤을 선택하세요', 'error'); return; }
          (btn as HTMLButtonElement).disabled = true;
          try {
            await api('/api/workspace-milestone-task-match', { method:'POST', body:{ taskId, milestoneDefId, action:'confirm' } });
            toast('성과에 연결되었습니다', 'success');
            await loadAndRenderPendingQueue();
          } catch (e) { toast('오류: ' + (e as any).message, 'error'); (btn as HTMLButtonElement).disabled = false; }
        });
      });

      (container as HTMLElement).querySelectorAll('.p25-skip').forEach(btn => {
        btn.addEventListener('click', async () => {
          const taskId = Number((btn as HTMLElement).dataset.taskId);
          try {
            await api('/api/workspace-milestone-task-match', { method:'POST', body:{ taskId, action:'skip' } });
            await loadAndRenderPendingQueue();
          } catch (e) { toast('오류: ' + (e as any).message, 'error'); }
        });
      });
    } catch (e) {
      (container as HTMLElement).innerHTML = `<div style="font-size:13px;color:#ef4444">로드 실패: ${escHtml((e as any).message)}</div>`;
    }
  }

  /* ─── Phase 25: 보관함 (성과별 완료 카드) ─── */
  async function loadAndRenderDoneTasks() {
    const container = $('#p25DoneSection');
    if (!container) return;
    (container as HTMLElement).innerHTML = '<div style="font-size:13px;color:#9ca3af">불러오는 중...</div>';
    try {
      const res = await api(`/api/workspace-milestone-done-tasks?quarterId=${state.currentQuarterId||''}`);
      const grouped  = res.data?.grouped || [];
      const unmatched = res.data?.unmatched || [];
      if (!grouped.length && !unmatched.length) {
        (container as HTMLElement).innerHTML = '<div style="font-size:13px;color:#9ca3af;padding:8px 0">이번 분기 완료 카드가 없습니다.</div>';
        return;
      }
      const parts = [];
      grouped.forEach(g => {
        parts.push(`<div style="margin-bottom:14px">
          <div style="font-size:13.5px;font-weight:700;color:#111;margin-bottom:6px">🏆 ${escHtml(g.name)} <span style="font-size:11.5px;font-weight:400;color:#6b7280">${g.tasks.length}건</span></div>
          ${g.tasks.map(t => `<div style="font-size:12.5px;color:#374151;padding:3px 0 3px 14px;border-left:3px solid #e5e7eb">
            ${escHtml(t.title)} <span style="color:#9ca3af">${fmtDate(t.completedAt)}</span>
          </div>`).join('')}
        </div>`);
      });
      if (unmatched.length) {
        parts.push(`<div style="margin-bottom:14px">
          <div style="font-size:13.5px;font-weight:700;color:#9ca3af;margin-bottom:6px">미분류 ${unmatched.length}건</div>
          ${unmatched.map(t => `<div style="font-size:12.5px;color:#9ca3af;padding:3px 0 3px 14px">${escHtml(t.title)}</div>`).join('')}
        </div>`);
      }
      (container as HTMLElement).innerHTML = parts.join('');
    } catch (e) {
      (container as HTMLElement).innerHTML = `<div style="font-size:13px;color:#ef4444">로드 실패: ${escHtml((e as any).message)}</div>`;
    }
  }

  /* ─── Phase 25: 마일스톤 → WBS 카드 생성 ─── */
  async function loadNonRevMilestonesForCardCreate() {
    const container = $('#p25CardCreate');
    if (!container) return;
    try {
      const res = await api(`/api/milestone-definitions?role=${state.member.milestoneRole}&category=NON_REVENUE`);
      const defs = res.data?.milestones || res.milestones || [];
      if (!defs.length) {
        (container as HTMLElement).innerHTML = '<div style="font-size:13px;color:#9ca3af">비매출 마일스톤이 없습니다.</div>';
        return;
      }
      (container as HTMLElement).innerHTML = `
        <p style="font-size:12.5px;color:#6b7280;margin:0 0 10px">선택한 비매출 마일스톤에 맞는 WBS 카드를 자동 생성합니다. 생성된 카드를 완료하면 성과 달성에 카운트됩니다.</p>
        ${defs.map(d => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6">
            <div>
              <div style="font-size:13px;font-weight:600;color:#111">${escHtml(d.name)}</div>
              <div style="font-size:11.5px;color:#9ca3af">목표: ${d.targetValue || 1}${d.targetUnit || '건'}</div>
            </div>
            <button class="ms-btn ms-btn-ghost ms-btn-sm p25-create-card" data-def-id="${d.id}" data-def-name="${escHtml(d.name)}"
              style="font-size:12px;padding:4px 10px">+ WBS 카드 생성</button>
          </div>
        `).join('')}`;

      (container as HTMLElement).querySelectorAll('.p25-create-card').forEach(btn => {
        btn.addEventListener('click', async () => {
          const milestoneDefId = Number((btn as HTMLElement).dataset.defId);
          const defName = (btn as HTMLElement).dataset.defName;
          if (!confirm(`"${defName}" 관련 WBS 카드를 생성하시겠습니까?`)) return;
          (btn as HTMLButtonElement).disabled = true;
          try {
            const res = await api('/api/workspace-milestone-create-tasks', { method:'POST', body:{ milestoneDefId } });
            toast(res.message || '카드 생성 완료', 'success');
          } catch (e) { toast('카드 생성 실패: ' + (e as any).message, 'error'); }
          finally { (btn as HTMLButtonElement).disabled = false; }
        });
      });
    } catch (e) {
      (container as HTMLElement).innerHTML = `<div style="font-size:13px;color:#ef4444">로드 실패: ${escHtml((e as any).message)}</div>`;
    }
  }

  /* ─── 분기 결산 탭 ─── */
  async function renderSettlement() {
    const panel = $('#settlementPanel');
    if (!panel) return;
    panel.innerHTML = '<div class="ms-loading">계산 중...</div>';
    try {
      const res = await api(`/api/milestone-settlement?quarterId=${state.currentQuarterId}`);
      const settlements = res.data?.settlements || [];
      const settle = settlements.find(s => s.quarterId === state.currentQuarterId) || null;
      state.settlement = settle;
      renderSettlementPanel(settle);
    } catch (e) {
      panel.innerHTML = `<div class="ms-empty">로드 실패: ${escHtml((e as any).message)}</div>`;
    }
  }

  function renderSettlementPanel(settle) {
    const panel = $('#settlementPanel');
    if (!panel) return;

    if (settle && ['SUBMITTED','APPROVED','PAID'].includes(settle.status)) {
      panel.innerHTML = `
        <div class="ms-settle-box">
          <div style="font-size:13px;color:#6b7280;margin-bottom:6px">결산 상태</div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="ms-badge ${settle.status}" style="font-size:14px;padding:4px 14px">${{SUBMITTED:'검토 대기',APPROVED:'승인됨',PAID:'지급 완료',REJECTED:'반려됨'}[settle.status]||settle.status}</span>
            <div>
              <div class="ms-settle-total">${fmt(settle.totalBonus)}</div>
              <div style="font-size:12px;color:#6b7280">매출연동 ${fmt(settle.revenueLinkedTotal)} + 비매출 ${fmt(settle.nonRevenueTotal)}</div>
            </div>
          </div>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 12px;font-size:15px;font-weight:700">자동 계산 미리보기</h3>
        <div id="calcPreview" style="color:#9ca3af;font-size:13px">아래 "계산" 버튼을 눌러 인센티브를 계산하세요.</div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="ms-btn ms-btn-ghost" id="btnCalc">📊 계산하기</button>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">
        <h3 style="margin:0 0 12px;font-size:15px;font-weight:700">자가평가 의견</h3>
        <div style="display:flex;align-items:flex-start;gap:8px">
          <textarea id="settleSelf" rows="4" style="flex:1;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13.5px;box-sizing:border-box" placeholder="이번 분기 성과에 대한 의견을 작성하세요"></textarea>
          <button class="ms-btn ms-btn-ghost" id="btnAiCoach" style="white-space:nowrap;padding:8px 14px;font-size:12.5px;border:1px solid #3b82f6;color:#3b82f6">💡 AI 코칭</button>
        </div>
        <div id="aiCoachResult" style="display:none;margin-top:10px;padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;color:#1e40af;line-height:1.6"></div>
        <div style="margin-top:12px">
          <button class="ms-btn ms-btn-primary" id="btnSubmitSettle">결산 제출</button>
        </div>
      </div>`;

    $('#btnCalc')?.addEventListener('click', async () => {
      const btn = $('#btnCalc') as HTMLButtonElement;
      btn.disabled = true; btn.textContent = '계산 중...';
      try {
        const res = await api('/api/milestone-settlement/calculate', { method:'POST', body:{ quarterId: state.currentQuarterId } });
        const calc = res.data || res;
        ($('#calcPreview') as HTMLElement).innerHTML = `
          <div class="ms-settle-breakdown">
            <div class="ms-kpi"><div class="ms-kpi-label">매출연동</div><div class="ms-kpi-val blue">${fmt(calc.revenueLinkedTotal)}</div></div>
            <div class="ms-kpi"><div class="ms-kpi-label">비매출</div><div class="ms-kpi-val green">${fmt(calc.nonRevenueTotal)}</div></div>
          </div>
          <div style="margin-top:12px;font-size:20px;font-weight:800">예상 합계: ${fmt(calc.totalBonus)}</div>`;
      } catch (e) { toast('계산 실패: ' + (e as any).message, 'error'); }
      finally { btn.disabled = false; btn.textContent = '📊 계산하기'; }
    });

    $('#btnAiCoach')?.addEventListener('click', async () => {
      const selfEvalText = ($('#settleSelf') as HTMLTextAreaElement).value.trim();
      if (!selfEvalText) { toast('자가평가 내용을 먼저 작성하세요', 'error'); return; }
      const btn = $('#btnAiCoach') as HTMLButtonElement;
      const resultEl = $('#aiCoachResult') as HTMLElement;
      btn.disabled = true; btn.textContent = '분석 중...';
      resultEl.style.display = 'none';
      try {
        const res = await api('/api/ai-milestone-insight', { method:'POST', body:{ type:'coach', selfEvalText } });
        const text = res.data?.text || res.text || '';
        resultEl.style.display = '';
        resultEl.innerHTML = `<strong>💡 AI 코칭</strong><br>${escHtml(text).replace(/\n/g,'<br>')}`;
      } catch (e) { toast('AI 코칭 실패: ' + (e as any).message, 'error'); }
      finally { btn.disabled = false; btn.textContent = '💡 AI 코칭'; }
    });

    $('#btnSubmitSettle')?.addEventListener('click', async () => {
      if (!confirm('분기 결산을 제출하시겠습니까?')) return;
      const selfEvaluation = ($('#settleSelf') as HTMLTextAreaElement).value.trim();
      const btn = $('#btnSubmitSettle') as HTMLButtonElement;
      btn.disabled = true;
      try {
        await api('/api/milestone-settlement/submit', { method:'POST', body:{ quarterId: state.currentQuarterId, selfEvaluation } });
        toast('결산 제출 완료', 'success');
        await renderSettlement();
      } catch (e) { toast('제출 실패: ' + (e as any).message, 'error'); }
      finally { btn.disabled = false; }
    });
  }

})();
