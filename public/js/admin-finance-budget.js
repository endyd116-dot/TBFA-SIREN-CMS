/* admin-finance-budget.js — Phase 22-B-R2: 차년도 예산 편성 + 2단계 결재 + 집행률 */
(function () {
  'use strict';

  /* ── 상태 ── */
  let myRole       = null;
  let currentPlanId = null;   // 편집 중인 budget_plan id
  let planList     = [];      // 목록 캐시
  let lineEdits    = {};      // { lineId: amount } 편성 편집 중 값

  /* ── API 헬퍼 ── */
  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }

  /* ── 포맷 ── */
  function fmtKRW(n) {
    if (n === null || n === undefined || n === '') return '0원';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isSuperAdmin() { return myRole === 'super_admin'; }

  function planStatusLabel(s) {
    return { draft: '작성중', submitted: '상신됨', approved: '승인됨', rejected: '반려됨' }[s] || s;
  }
  function planStatusColor(s) {
    return {
      draft:     '#6b7280',
      submitted: '#f59e0b',
      approved:  'var(--success)',
      rejected:  'var(--danger)',
    }[s] || '#6b7280';
  }
  function planStatusBg(s) {
    return {
      draft:     '#f3f4f6',
      submitted: '#fef3c7',
      approved:  '#d1fae5',
      rejected:  '#fee2e2',
    }[s] || '#f3f4f6';
  }

  /* ── 권한 확인 ── */
  async function loadMyRole() {
    if (myRole !== null) return;
    const res = await api('GET', '/api/admin/me');
    if (res.ok) {
      const me = res.data?.data?.admin || res.data?.admin || res.data?.data || res.data;
      myRole = me?.role || 'admin';
    } else {
      myRole = 'admin';
    }
  }

  /* ════════════════════════════════════════════════
     화면 1: 예산안 목록
  ════════════════════════════════════════════════ */
  function renderShell(container) {
    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">예산 관리</div>
          <div class="p-actions">
            <button class="btn-sm btn-sm-primary" id="bpCreateBtn" type="button" style="display:none">+ 차년도 예산안 작성</button>
          </div>
        </div>

        <!-- 뷰 컨테이너: list / compose / approve / rate -->
        <div id="bpViewList">
          <div id="bpPlanList" style="margin-top:8px"></div>
        </div>

        <div id="bpViewCompose" style="display:none">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <button class="btn-sm btn-sm-ghost" id="bpBackFromComposeBtn" type="button">← 목록</button>
            <span id="bpComposeTitle" style="font-size:15px;font-weight:700"></span>
          </div>
          <div id="bpComposeBody"></div>
        </div>

        <div id="bpViewApprove" style="display:none">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <button class="btn-sm btn-sm-ghost" id="bpBackFromApproveBtn" type="button">← 목록</button>
            <span id="bpApproveTitle" style="font-size:15px;font-weight:700"></span>
          </div>
          <div id="bpApproveBody"></div>
        </div>

        <div id="bpViewRate" style="display:none">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <button class="btn-sm btn-sm-ghost" id="bpBackFromRateBtn" type="button">← 목록</button>
            <span id="bpRateTitle" style="font-size:15px;font-weight:700"></span>
          </div>
          <div id="bpRateBody"></div>
        </div>
      </div>

      <!-- 반려 사유 모달 -->
      <div id="bpRejectModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:440px">
          <div class="modal-head">
            <span class="modal-title">반려 사유 입력</span>
            <button class="modal-close" type="button" id="bpRejectCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <label class="form-label">반려 사유 <span style="color:var(--danger)">*</span></label>
            <textarea id="bpRejectReason" class="input" rows="4" placeholder="반려 사유를 입력해 주세요."></textarea>
            <div id="bpRejectError" style="color:var(--danger);font-size:13px;margin-top:6px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="bpRejectCancelBtn">취소</button>
            <button class="btn-sm btn-sm-danger" type="button" id="bpRejectSubmitBtn">반려 확정</button>
          </div>
        </div>
      </div>
    `;

    /* 뒤로 버튼 */
    document.getElementById('bpBackFromComposeBtn')?.addEventListener('click', showList);
    document.getElementById('bpBackFromApproveBtn')?.addEventListener('click', showList);
    document.getElementById('bpBackFromRateBtn')?.addEventListener('click', showList);

    /* 차년도 예산안 작성 버튼 */
    document.getElementById('bpCreateBtn')?.addEventListener('click', createNextYearPlan);

    /* 반려 모달 닫기 */
    document.getElementById('bpRejectCloseBtn')?.addEventListener('click', closeRejectModal);
    document.getElementById('bpRejectCancelBtn')?.addEventListener('click', closeRejectModal);
  }

  /* ── 뷰 전환 헬퍼 ── */
  function showView(name) {
    ['list', 'compose', 'approve', 'rate'].forEach(v => {
      const el = document.getElementById('bpView' + v.charAt(0).toUpperCase() + v.slice(1));
      if (el) el.style.display = v === name ? '' : 'none';
    });
  }
  function showList() { showView('list'); loadPlanList(); }

  /* ════════════════════════════════════════════════
     예산안 목록 로드·렌더
  ════════════════════════════════════════════════ */
  async function loadPlanList() {
    const listEl = document.getElementById('bpPlanList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';

    const res = await api('GET', '/api/admin-budget-plan-list');
    if (!res.ok) {
      listEl.innerHTML = `<div style="color:var(--danger);padding:12px">목록 조회 실패: ${escapeHtml(res.error || '')}</div>`;
      return;
    }

    planList = res.data?.data?.plans || res.data?.plans || res.data?.data || res.data || [];
    if (!Array.isArray(planList)) planList = [];

    renderPlanList(listEl);

    /* 차년도 버튼 활성화: 올해+1 연도 예산안이 없을 때 */
    const nextYear = new Date().getFullYear() + 1;
    const hasNext  = planList.some(p => p.fiscal_year === nextYear || p.fiscalYear === nextYear);
    const createBtn = document.getElementById('bpCreateBtn');
    if (createBtn) createBtn.style.display = hasNext ? 'none' : '';
  }

  function renderPlanList(listEl) {
    if (!planList.length) {
      listEl.innerHTML = `<div style="color:var(--text-3);padding:16px;text-align:center">등록된 예산안이 없습니다.<br>우측 상단 "차년도 예산안 작성" 버튼을 눌러 작성하세요.</div>`;
      return;
    }

    listEl.innerHTML = planList.map(p => {
      const year      = p.fiscal_year || p.fiscalYear;
      const title     = escapeHtml(p.title || year + '년도 예산안');
      const status    = p.status || 'draft';
      const total     = p.total_planned || p.totalPlanned || 0;
      const label     = planStatusLabel(status);
      const color     = planStatusColor(status);
      const bg        = planStatusBg(status);
      const id        = p.id;
      const rejReason = p.rejection_reason || p.rejectionReason;

      const editBtn = (status === 'draft' || status === 'rejected')
        ? `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_FINANCE_BUDGET.openCompose(${id})">편성</button>`
        : `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_FINANCE_BUDGET.openCompose(${id})">보기</button>`;

      const approveBtn = (status === 'submitted' && isSuperAdmin())
        ? `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_FINANCE_BUDGET.openApprove(${id})" style="margin-left:4px">결재</button>`
        : (status === 'submitted'
          ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_FINANCE_BUDGET.openApprove(${id})" style="margin-left:4px">결재 보기</button>`
          : '');

      const rateBtn = status === 'approved'
        ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_FINANCE_BUDGET.openRate(${id})" style="margin-left:4px">집행률</button>`
        : '';

      const deleteBtn = status === 'draft'
        ? `<button class="btn-sm btn-sm-danger" type="button" onclick="window.SIREN_FINANCE_BUDGET.deletePlan(${id})" style="margin-left:4px">삭제</button>`
        : '';

      const rejNote = rejReason
        ? `<div style="margin-top:6px;font-size:12px;color:var(--danger);background:#fee2e2;border-radius:6px;padding:6px 10px">반려 사유: ${escapeHtml(rejReason)}</div>`
        : '';

      return `
        <div style="border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:12px;background:#fff">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <span style="font-size:15px;font-weight:700">${title}</span>
              <span style="display:inline-block;margin-left:10px;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;color:${color};background:${bg}">${label}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
              <span style="font-size:13px;color:var(--text-2);margin-right:8px">편성 합계: <strong>${fmtKRW(total)}</strong></span>
              ${editBtn}${approveBtn}${rateBtn}${deleteBtn}
            </div>
          </div>
          ${rejNote}
        </div>`;
    }).join('');
  }

  /* ── 차년도 예산안 작성 ── */
  async function createNextYearPlan() {
    const nextYear = new Date().getFullYear() + 1;
    if (!confirm(`${nextYear}년도 예산안을 작성하시겠습니까?\n전년(${nextYear - 1}) 지출 실적이 자동으로 채워집니다.`)) return;
    const res = await api('POST', '/api/admin-budget-plan-create', { fiscalYear: nextYear });
    if (!res.ok) { alert('예산안 작성 실패: ' + (res.data?.error || res.error || '')); return; }
    const planId = res.data?.data?.id || res.data?.id;
    showList();
    if (planId) setTimeout(() => openCompose(planId), 300);
  }

  /* ── 예산안 삭제 ── */
  async function deletePlan(id) {
    if (!confirm('초안 예산안을 삭제하시겠습니까?')) return;
    const res = await api('DELETE', `/api/admin-budget-plan-delete?id=${id}`);
    if (!res.ok) { alert('삭제 실패: ' + (res.data?.error || res.error || '')); return; }
    loadPlanList();
  }

  /* ════════════════════════════════════════════════
     화면 2: 예산 편성 (카테고리별 편성 금액 입력)
  ════════════════════════════════════════════════ */
  async function openCompose(planId) {
    currentPlanId = planId;
    lineEdits = {};
    showView('compose');

    const bodyEl = document.getElementById('bpComposeBody');
    const titleEl = document.getElementById('bpComposeTitle');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';

    const res = await api('GET', `/api/admin-budget-plan-detail?id=${planId}`);
    if (!res.ok) {
      bodyEl.innerHTML = `<div style="color:var(--danger)">조회 실패: ${escapeHtml(res.error || '')}</div>`;
      return;
    }

    const d = res.data?.data || res.data;
    const plan = d?.plan || d;
    const lines = d?.lines || plan?.lines || [];
    const status = plan?.status || 'draft';
    const year   = plan?.fiscal_year || plan?.fiscalYear;
    const title  = plan?.title || year + '년도 예산안';

    if (titleEl) titleEl.textContent = title + ' — ' + planStatusLabel(status);

    const editable = status === 'draft' || status === 'rejected';

    /* 관-항-목 그룹핑 */
    const groups = {};   // gk -> { name, hangs: { hk: { name, lines: [] } } }
    lines.forEach(l => {
      const gk = l.gwanId != null ? 'g' + l.gwanId : 'g0';
      const hk = l.hangId != null ? 'h' + l.hangId : (gk + '-h0');
      if (!groups[gk]) groups[gk] = { name: l.gwanName || '기타(미분류)', hangs: {} };
      if (!groups[gk].hangs[hk]) groups[gk].hangs[hk] = { name: l.hangName || '기타', lines: [] };
      groups[gk].hangs[hk].lines.push(l);
    });

    /* 초기 소계 */
    const gwanSum = {}, hangSum = {};
    lines.forEach(l => {
      const gk = l.gwanId != null ? 'g' + l.gwanId : 'g0';
      const hk = l.hangId != null ? 'h' + l.hangId : (gk + '-h0');
      const v = l.plannedAmount || 0;
      gwanSum[gk] = (gwanSum[gk] || 0) + v;
      hangSum[hk] = (hangSum[hk] || 0) + v;
    });

    let rowsHtml = '';
    Object.keys(groups).forEach(gk => {
      const g = groups[gk];
      rowsHtml += `<tr style="background:#fdf2f4">
        <td style="font-weight:700;color:#7a1f2b">관 · ${escapeHtml(g.name)}</td>
        <td></td>
        <td class="num" style="font-weight:700"><span class="bp-gwan-sum" data-g="${gk}">${fmtKRW(gwanSum[gk] || 0)}</span></td>
      </tr>`;
      Object.keys(g.hangs).forEach(hk => {
        const h = g.hangs[hk];
        rowsHtml += `<tr style="background:#fffbeb">
          <td style="padding-left:24px;font-weight:600;color:#b45309">항 · ${escapeHtml(h.name)}</td>
          <td></td>
          <td class="num" style="font-weight:600;color:#b45309"><span class="bp-hang-sum" data-h="${hk}">${fmtKRW(hangSum[hk] || 0)}</span></td>
        </tr>`;
        h.lines.forEach(l => {
          const prev = l.prevYearActual || 0;
          const plan_ = l.plannedAmount || 0;
          const codeTag = l.mokCode ? ` <span style="color:var(--text-3);font-size:11px;font-family:monospace">${escapeHtml(l.mokCode)}</span>` : '';
          rowsHtml += `<tr>
            <td style="padding-left:44px">목 · ${escapeHtml(l.mokName || l.categoryName || '')}${codeTag}</td>
            <td class="num" style="color:var(--text-2)">${fmtKRW(prev)}</td>
            <td class="num">${editable
              ? `<input type="number" class="input-sm bp-line-input" style="width:150px;text-align:right" data-lid="${l.id}" data-g="${gk}" data-h="${hk}" value="${plan_}" min="0">`
              : fmtKRW(plan_)}</td>
          </tr>`;
        });
      });
    });

    const totalPlanned = lines.reduce((s, l) => s + (l.plannedAmount || 0), 0);

    const submitBtn = editable
      ? `<button class="btn-sm btn-sm-primary" id="bpSaveBtn" type="button">임시저장</button>
         <button class="btn-sm btn-sm-primary" id="bpSubmitBtn" type="button" style="margin-left:8px;background:var(--success)">상신</button>`
      : '';

    bodyEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">예산과목 관·항·목 체계로 편성합니다. 금액은 목(目)에서 입력하고 항·관 소계는 자동 합산됩니다.</div>
      <table class="data-table" style="width:100%;margin-bottom:16px">
        <thead>
          <tr>
            <th>예산과목 (관 · 항 · 목)</th>
            <th class="num">전년 실적</th>
            <th class="num">편성 금액 (원)</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td>총계</td>
            <td></td>
            <td class="num" id="bpComposeTotal">${fmtKRW(totalPlanned)}</td>
          </tr>
        </tfoot>
      </table>
      ${status === 'rejected' && (plan?.rejection_reason || plan?.rejectionReason)
        ? `<div style="margin-bottom:12px;font-size:13px;color:var(--danger);background:#fee2e2;border-radius:8px;padding:10px 14px">반려 사유: ${escapeHtml(plan?.rejection_reason || plan?.rejectionReason)}</div>`
        : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end">${submitBtn}</div>
    `;

    if (editable) {
      const recompute = () => {
        const hs = {}, gs = {}; let total = 0;
        bodyEl.querySelectorAll('.bp-line-input').forEach(i => {
          const v = parseInt(i.value) || 0;
          total += v;
          hs[i.dataset.h] = (hs[i.dataset.h] || 0) + v;
          gs[i.dataset.g] = (gs[i.dataset.g] || 0) + v;
        });
        bodyEl.querySelectorAll('.bp-hang-sum').forEach(s => s.textContent = fmtKRW(hs[s.dataset.h] || 0));
        bodyEl.querySelectorAll('.bp-gwan-sum').forEach(s => s.textContent = fmtKRW(gs[s.dataset.g] || 0));
        const totalEl = document.getElementById('bpComposeTotal');
        if (totalEl) totalEl.textContent = fmtKRW(total);
      };
      bodyEl.querySelectorAll('.bp-line-input').forEach(inp => inp.addEventListener('input', recompute));

      document.getElementById('bpSaveBtn')?.addEventListener('click', () => saveDraft(false));
      document.getElementById('bpSubmitBtn')?.addEventListener('click', () => {
        if (!confirm('예산안을 상신하시겠습니까? 상신 후에는 수정이 불가합니다.')) return;
        saveDraft(true);
      });
    }
  }

  async function saveDraft(doSubmit) {
    const bodyEl = document.getElementById('bpComposeBody');
    const inputs = bodyEl?.querySelectorAll('.bp-line-input') || [];
    const lineUpdates = [];
    inputs.forEach(inp => {
      lineUpdates.push({ lineId: parseInt(inp.dataset.lid), plannedAmount: parseInt(inp.value) || 0 });
    });

    /* 1) 편성 금액 저장 */
    if (lineUpdates.length) {
      const res = await api('PUT', '/api/admin-budget-plan-update', {
        planId: currentPlanId,
        lines:  lineUpdates,
      });
      if (!res.ok) { alert('임시저장 실패: ' + (res.data?.error || res.error || '')); return; }
    }

    /* 2) 상신 */
    if (doSubmit) {
      const res = await api('POST', '/api/admin-budget-plan-submit', { planId: currentPlanId });
      if (!res.ok) { alert('상신 실패: ' + (res.data?.error || res.error || '')); return; }
      alert('상신 완료');
      showList();
      return;
    }
    alert('임시저장 완료');
    openCompose(currentPlanId);
  }

  /* ════════════════════════════════════════════════
     화면 3: 결재 (상신된 예산안 승인/반려)
  ════════════════════════════════════════════════ */
  async function openApprove(planId) {
    currentPlanId = planId;
    showView('approve');

    const bodyEl  = document.getElementById('bpApproveBody');
    const titleEl = document.getElementById('bpApproveTitle');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';

    const res = await api('GET', `/api/admin-budget-plan-detail?id=${planId}`);
    if (!res.ok) {
      bodyEl.innerHTML = `<div style="color:var(--danger)">조회 실패: ${escapeHtml(res.error || '')}</div>`;
      return;
    }

    const d = res.data?.data || res.data;
    const plan = d?.plan || d;
    const lines = d?.lines || plan?.lines || [];
    const status = plan?.status || 'submitted';
    const year   = plan?.fiscal_year || plan?.fiscalYear;
    const title  = plan?.title || year + '년도 예산안';

    if (titleEl) titleEl.textContent = title + ' — ' + planStatusLabel(status);

    const lineRows = lines.map(l => `<tr>
      <td>${escapeHtml(l.category_name || l.categoryName || '')}</td>
      <td class="num">${fmtKRW(l.prev_year_actual || l.prevYearActual || 0)}</td>
      <td class="num">${fmtKRW(l.planned_amount || l.plannedAmount || 0)}</td>
    </tr>`).join('');

    const totalPlanned = lines.reduce((s, l) => s + (l.planned_amount || l.plannedAmount || 0), 0);

    const approvalBtns = (status === 'submitted' && isSuperAdmin())
      ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
           <button class="btn-sm btn-sm-danger" type="button" id="bpApproveRejectBtn">반려</button>
           <button class="btn-sm btn-sm-primary" type="button" id="bpApproveConfirmBtn" style="background:var(--success)">승인</button>
         </div>`
      : `<div style="margin-top:16px;color:var(--text-3);font-size:13px">결재 권한(super_admin)이 필요합니다.</div>`;

    bodyEl.innerHTML = `
      <div style="margin-bottom:12px;font-size:13px;color:var(--text-2)">
        상신일: ${fmtDate(plan?.submitted_at || plan?.submittedAt)}
      </div>
      <table class="data-table" style="width:100%;margin-bottom:8px">
        <thead><tr><th>카테고리</th><th class="num">전년 실적</th><th class="num">편성 금액</th></tr></thead>
        <tbody>${lineRows}</tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td>합계</td><td></td>
            <td class="num">${fmtKRW(totalPlanned)}</td>
          </tr>
        </tfoot>
      </table>
      ${approvalBtns}
    `;

    document.getElementById('bpApproveConfirmBtn')?.addEventListener('click', async () => {
      if (!confirm('예산안을 승인하시겠습니까?')) return;
      const r = await api('POST', '/api/admin-budget-plan-approve', { planId: currentPlanId });
      if (!r.ok) { alert('승인 실패: ' + (r.data?.error || r.error || '')); return; }
      alert('승인 완료');
      showList();
    });

    document.getElementById('bpApproveRejectBtn')?.addEventListener('click', openRejectModal);
  }

  /* ── 반려 모달 ── */
  function openRejectModal() {
    const el = document.getElementById('bpRejectModal');
    if (el) { el.style.display = 'flex'; }
    const ta = document.getElementById('bpRejectReason');
    if (ta) ta.value = '';
    const err = document.getElementById('bpRejectError');
    if (err) err.style.display = 'none';

    document.getElementById('bpRejectSubmitBtn')?.removeEventListener('click', doReject);
    document.getElementById('bpRejectSubmitBtn')?.addEventListener('click', doReject);
  }
  function closeRejectModal() {
    const el = document.getElementById('bpRejectModal');
    if (el) el.style.display = 'none';
  }
  async function doReject() {
    const reason = document.getElementById('bpRejectReason')?.value.trim();
    const errEl  = document.getElementById('bpRejectError');
    if (!reason) {
      if (errEl) { errEl.textContent = '반려 사유를 입력해 주세요.'; errEl.style.display = ''; }
      return;
    }
    const res = await api('POST', '/api/admin-budget-plan-reject', { planId: currentPlanId, rejectionReason: reason });
    if (!res.ok) {
      if (errEl) { errEl.textContent = '반려 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; }
      return;
    }
    closeRejectModal();
    alert('반려 처리 완료');
    showList();
  }

  /* ════════════════════════════════════════════════
     화면 4: 집행률 (승인된 예산안 기준 카테고리별 막대)
  ════════════════════════════════════════════════ */
  async function openRate(planId) {
    currentPlanId = planId;
    showView('rate');

    const bodyEl  = document.getElementById('bpRateBody');
    const titleEl = document.getElementById('bpRateTitle');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';

    /* 집행률 API — plan의 fiscal_year로 조회 */
    const plan = planList.find(p => p.id === planId);
    const year = plan?.fiscal_year || plan?.fiscalYear || new Date().getFullYear();
    if (titleEl) titleEl.textContent = (plan?.title || year + '년도 예산안') + ' — 집행률';

    /* 관-항-목 집행 롤업 — 예산과목 트리 API 재사용 */
    const res = await api('GET', `/api/admin-budget-accounts?fiscalYear=${year}`);
    if (!res.ok) {
      bodyEl.innerHTML = `<div style="color:var(--danger)">조회 실패: ${escapeHtml(res.error || '')}</div>`;
      return;
    }
    const tree = res.data?.data?.tree || res.data?.tree || [];
    if (!tree.length) {
      bodyEl.innerHTML = '<div style="color:var(--text-3);padding:16px">예산과목(관-항-목)이 없습니다. "예산과목 체계" 화면에서 먼저 구성하세요.</div>';
      return;
    }

    const totalPlanned  = tree.reduce((s, n) => s + (n.planned || 0), 0);
    const totalExecuted = tree.reduce((s, n) => s + (n.executed || 0), 0);
    const totalRemaining = totalPlanned - totalExecuted;
    const totalRate = totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0;

    let anyOver = false;
    const rowFor = (n, depth) => {
      const planned = n.planned || 0, executed = n.executed || 0;
      const remaining = planned - executed;
      const rate = n.rate != null ? Math.round(n.rate * 100) : (planned > 0 ? Math.round((executed / planned) * 100) : 0);
      const over = executed > planned && planned > 0;
      if (over) anyOver = true;
      const rateColor = over ? 'var(--danger)' : rate >= 90 ? 'var(--danger)' : rate >= 70 ? '#f59e0b' : 'var(--success)';
      const pad = 6 + depth * 20;
      const bg = n.level === '관' ? 'background:#fdf2f4;' : n.level === '항' ? 'background:#fffbeb;' : '';
      const wt = n.level === '관' ? 'font-weight:700;' : n.level === '항' ? 'font-weight:600;' : '';
      let html = `<tr style="${bg}${over ? 'background:#fef2f2;' : ''}">
        <td style="padding-left:${pad}px;${wt}"><span style="font-size:10px;color:var(--text-3)">${n.level}</span> ${escapeHtml(n.name)}${over ? ' <span style="color:var(--danger);font-size:11px;font-weight:700">⚠️ 초과</span>' : ''}</td>
        <td class="num">${fmtKRW(planned)}</td>
        <td class="num">${fmtKRW(executed)}</td>
        <td class="num" style="color:${remaining < 0 ? 'var(--danger)' : 'var(--success)'};${remaining < 0 ? 'font-weight:700' : ''}">${fmtKRW(remaining)}</td>
        <td style="min-width:150px"><div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:9px;border-radius:5px;background:#e5e7eb;overflow:hidden"><div style="height:100%;width:${Math.min(rate, 100)}%;background:${rateColor}"></div></div>
          <span style="color:${rateColor};font-weight:600;min-width:38px;font-size:12px">${rate}%</span>
        </div></td>
      </tr>`;
      (n.children || []).forEach(c => { html += rowFor(c, depth + 1); });
      return html;
    };
    const rows = tree.map(n => rowFor(n, 0)).join('');

    const rateColorT = totalRate >= 90 ? 'var(--danger)' : totalRate >= 70 ? '#f59e0b' : 'var(--success)';
    const remColorT = totalRemaining < 0 ? 'var(--danger)' : 'var(--success)';

    bodyEl.innerHTML = `
      ${anyOver
        ? '<div style="margin-bottom:16px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:var(--danger);font-size:13px;font-weight:600">⚠️ 집행이 편성을 초과한 항목이 있습니다.</div>'
        : ''}
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
        <div class="kpi"><div class="kpi-label">편성 합계</div><div class="kpi-value">${fmtKRW(totalPlanned)}</div></div>
        <div class="kpi"><div class="kpi-label">집행 합계 (승인 지출)</div><div class="kpi-value" style="color:var(--danger)">${fmtKRW(totalExecuted)}</div></div>
        <div class="kpi"><div class="kpi-label">잔액</div><div class="kpi-value" style="color:${remColorT}">${fmtKRW(totalRemaining)}</div></div>
        <div class="kpi"><div class="kpi-label">전체 집행률</div><div class="kpi-value" style="color:${rateColorT}">${totalRate}%</div></div>
      </div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>예산과목 (관·항·목)</th><th class="num">편성</th><th class="num">집행</th><th class="num">잔액</th><th>집행률</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:10px;font-size:12px;color:var(--text-3)">※ 집행 = 승인 완료 지출 합계 · 잔액 = 편성 − 집행 · 계층별 소계는 자동 합산</div>
    `;
  }

  /* ════════════════════════════════════════════════
     초기화 / 재진입
  ════════════════════════════════════════════════ */
  async function init() {
    const container = document.getElementById('adm-finance-budget') || document.getElementById('page-finance-budget');
    if (!container) return;
    if (!container.querySelector('.panel')) {
      await loadMyRole();
      renderShell(container);
    }
    showView('list');
    await loadPlanList();
  }

  window.SIREN_FINANCE_BUDGET = {
    load:         init,
    init,
    openCompose,
    openApprove,
    openRate,
    deletePlan,
  };
})();
