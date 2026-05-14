/* admin-expenses-voucher.js — Phase 22-D-R1: 전표 관리 탭 */
(function () {
  'use strict';

  /* ── 상태 ── */
  let myRole        = null;
  let accountCodes  = [];   // 계정과목 목록
  let budgetLines   = [];   // 예산 항목 목록 (22-B-R2 마이그 후 채워짐)
  let templates     = [];   // 반복 템플릿 목록
  let currentPage   = 1;
  const PAGE_SIZE   = 30;
  let filterParams  = {};   // 현재 필터 상태

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
    if (n === null || n === undefined || n === '') return '—';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function voucherStatusLabel(s) {
    return { draft: '작성중', submitted: '승인 대기', approved: '승인됨', rejected: '반려됨' }[s] || s;
  }
  function voucherStatusColor(s) {
    return { draft: '#6b7280', submitted: '#f59e0b', approved: 'var(--success)', rejected: 'var(--danger)' }[s] || '#6b7280';
  }
  function voucherStatusBg(s) {
    return { draft: '#f3f4f6', submitted: '#fef3c7', approved: '#d1fae5', rejected: '#fee2e2' }[s] || '#f3f4f6';
  }

  function evidenceLabel(s) {
    return {
      tax_invoice:    '세금계산서',
      receipt:        '영수증',
      card_slip:      '카드전표',
      transfer_confirm: '이체확인서',
      none:           '없음',
    }[s] || s || '—';
  }

  function isSuperAdmin() { return myRole === 'super_admin'; }

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

  /* ── 기간 선택기 ── */
  function periodSelectorHtml(prefix) {
    return `
      <select id="${prefix}PeriodSel" class="input-sm" style="width:120px">
        <option value="day">오늘</option>
        <option value="week">이번 주</option>
        <option value="month" selected>이번 달</option>
        <option value="half_year">반기</option>
        <option value="year">올해</option>
        <option value="custom">특정 기간</option>
      </select>
      <div id="${prefix}CustomRange" style="display:none;align-items:center;gap:6px">
        <input type="date" id="${prefix}StartDate" class="input-sm">
        <span>~</span>
        <input type="date" id="${prefix}EndDate" class="input-sm">
      </div>`;
  }

  function bindPeriodSelector(prefix, onSearch) {
    const sel = document.getElementById(prefix + 'PeriodSel');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const cr = document.getElementById(prefix + 'CustomRange');
      if (cr) cr.style.display = sel.value === 'custom' ? 'flex' : 'none';
      if (sel.value !== 'custom') onSearch();
    });
    const startEl = document.getElementById(prefix + 'StartDate');
    const endEl   = document.getElementById(prefix + 'EndDate');
    if (startEl && endEl) {
      const check = () => { if (startEl.value && endEl.value) onSearch(); };
      startEl.addEventListener('change', check);
      endEl.addEventListener('change', check);
    }
  }

  function getPeriodQs(prefix) {
    const sel    = document.getElementById(prefix + 'PeriodSel');
    const period = sel?.value || 'month';
    const today  = new Date();
    const pad    = n => String(n).padStart(2, '0');
    const fmt    = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    let startDate, endDate;

    if (period === 'day') {
      startDate = endDate = fmt(today);
    } else if (period === 'week') {
      const day = today.getDay();
      const mon = new Date(today); mon.setDate(today.getDate() - day + (day === 0 ? -6 : 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      startDate = fmt(mon); endDate = fmt(sun);
    } else if (period === 'month') {
      startDate = `${today.getFullYear()}-${pad(today.getMonth()+1)}-01`;
      endDate   = fmt(new Date(today.getFullYear(), today.getMonth()+1, 0));
    } else if (period === 'half_year') {
      const s = new Date(today); s.setMonth(today.getMonth() - 5); s.setDate(1);
      startDate = fmt(s); endDate = fmt(today);
    } else if (period === 'year') {
      startDate = `${today.getFullYear()}-01-01`;
      endDate   = `${today.getFullYear()}-12-31`;
    } else {
      startDate = document.getElementById(prefix + 'StartDate')?.value || '';
      endDate   = document.getElementById(prefix + 'EndDate')?.value   || '';
    }
    return { period, startDate, endDate };
  }

  /* ── 계정과목·예산항목·템플릿 로드 ── */
  async function loadAccountCodes() {
    const res = await api('GET', '/api/admin-account-codes-list');
    if (res.ok) {
      const raw = res.data?.data?.items || res.data?.items || res.data?.data || res.data || [];
      accountCodes = Array.isArray(raw) ? raw : [];
    }
  }

  async function loadBudgetLines() {
    const res = await api('GET', '/api/admin-budget-plan-list');
    if (!res.ok) { budgetLines = []; return; }
    const plans = res.data?.data?.plans || res.data?.plans || res.data?.data || res.data || [];
    const approved = Array.isArray(plans) ? plans.filter(p => p.status === 'approved') : [];
    if (!approved.length) { budgetLines = []; return; }
    /* 최신 승인 예산안의 lines 로드 */
    const latest = approved.sort((a, b) => (b.fiscal_year || b.fiscalYear) - (a.fiscal_year || a.fiscalYear))[0];
    const dres = await api('GET', `/api/admin-budget-plan-detail?id=${latest.id}`);
    if (dres.ok) {
      const d = dres.data?.data || dres.data;
      budgetLines = d?.lines || [];
    } else {
      budgetLines = [];
    }
  }

  async function loadTemplates() {
    const res = await api('GET', '/api/admin-voucher-templates-list');
    if (res.ok) {
      const raw = res.data?.data?.items || res.data?.items || res.data?.data || res.data || [];
      templates = Array.isArray(raw) ? raw : [];
    } else {
      templates = [];
    }
  }

  /* ════════════════════════════════════════════════
     전표 탭 화면 골격
  ════════════════════════════════════════════════ */
  function renderVoucherTab(container) {
    container.innerHTML = `
      <!-- 필터 영역 -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        ${periodSelectorHtml('vc')}
        <select id="vcAccountFilter" class="input-sm" style="width:150px">
          <option value="">전체 계정과목</option>
          ${accountCodes.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <select id="vcStatusFilter" class="input-sm" style="width:120px">
          <option value="">전체 상태</option>
          <option value="draft">작성중</option>
          <option value="submitted">승인 대기</option>
          <option value="approved">승인됨</option>
          <option value="rejected">반려됨</option>
        </select>
        <button class="btn-sm btn-sm-ghost" id="vcRefreshBtn" type="button">조회</button>
        <div style="flex:1"></div>
        <!-- 반복 템플릿 불러오기 -->
        <select id="vcTemplateSelect" class="input-sm" style="width:180px" title="반복 템플릿 불러오기">
          <option value="">템플릿 불러오기…</option>
          ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.template_name || t.templateName || '이름없음')}</option>`).join('')}
        </select>
        <button class="btn-sm btn-sm-primary" id="vcAddBtn" type="button">+ 전표 작성</button>
      </div>

      <!-- 목록 테이블 -->
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>전표번호</th>
            <th>날짜</th>
            <th>적요</th>
            <th>거래처</th>
            <th>계정과목</th>
            <th class="num">금액</th>
            <th>예산</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="vcTbody">
          <tr><td colspan="9" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>
        </tbody>
      </table>
      <div id="vcPager" style="margin-top:12px;text-align:center"></div>

      <!-- ── 전표 작성/수정 모달 ── -->
      <div id="vcAddModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:600px">
          <div class="modal-head">
            <span class="modal-title" id="vcAddModalTitle">전표 작성</span>
            <button class="modal-close" type="button" id="vcAddCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="vcEditId">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-row">
                <label class="form-label">날짜 <span style="color:var(--danger)">*</span></label>
                <input type="date" id="vcDate" class="input">
              </div>
              <div class="form-row">
                <label class="form-label">계정과목 <span style="color:var(--danger)">*</span></label>
                <select id="vcAccountCode" class="input">
                  <option value="">선택하세요</option>
                  ${accountCodes.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-row">
                <label class="form-label">세목</label>
                <input type="text" id="vcSubAccount" class="input" placeholder="세부 항목 (선택)">
              </div>
              <div class="form-row">
                <label class="form-label">금액 (원) <span style="color:var(--danger)">*</span></label>
                <input type="number" id="vcAmount" class="input" min="1" placeholder="0">
              </div>
              <div class="form-row" style="grid-column:1/-1">
                <label class="form-label">적요 <span style="color:var(--danger)">*</span></label>
                <input type="text" id="vcDescription" class="input" placeholder="지출 내용">
              </div>
              <div class="form-row">
                <label class="form-label">거래처</label>
                <input type="text" id="vcPayeeName" class="input" placeholder="기관명 또는 개인명">
              </div>
              <div class="form-row">
                <label class="form-label">증빙 종류</label>
                <select id="vcEvidenceType" class="input">
                  <option value="none">없음</option>
                  <option value="tax_invoice">세금계산서</option>
                  <option value="receipt">영수증</option>
                  <option value="card_slip">카드전표</option>
                  <option value="transfer_confirm">이체확인서</option>
                </select>
              </div>
              <div class="form-row">
                <label class="form-label">증빙 번호</label>
                <input type="text" id="vcEvidenceNumber" class="input" placeholder="세금계산서 번호 등">
              </div>
              <div class="form-row" style="grid-column:1/-1">
                <label class="form-label">예산 항목</label>
                <select id="vcBudgetLineId" class="input">
                  <option value="">예산 미연결</option>
                  ${budgetLines.map(l => {
                    const name = escapeHtml(l.category_name || l.categoryName || '');
                    const amt  = l.planned_amount || l.plannedAmount || 0;
                    return `<option value="${l.id}">${name} (편성: ${Number(amt).toLocaleString('ko-KR')}원)</option>`;
                  }).join('')}
                </select>
                ${budgetLines.length === 0
                  ? '<div style="font-size:12px;color:var(--text-3);margin-top:4px">예산안 승인 후 항목이 표시됩니다.</div>'
                  : ''}
              </div>
            </div>
            <div class="form-row" style="margin-top:8px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="vcIsTemplate">
                자주 쓰는 전표로 저장 (반복 템플릿)
              </label>
            </div>
            <div id="vcTemplateNameRow" style="display:none;margin-top:8px">
              <label class="form-label">템플릿 이름 <span style="color:var(--danger)">*</span></label>
              <input type="text" id="vcTemplateName" class="input" placeholder="예: 월임차료, 인터넷 요금">
            </div>
            <div id="vcAddError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="vcAddCancelBtn">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="vcSaveDraftBtn">저장 (작성중)</button>
          </div>
        </div>
      </div>

      <!-- ── 반려 사유 입력 모달 ── -->
      <div id="vcRejectModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:440px">
          <div class="modal-head">
            <span class="modal-title">전표 반려 사유</span>
            <button class="modal-close" type="button" id="vcRejectCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <label class="form-label">반려 사유 <span style="color:var(--danger)">*</span></label>
            <textarea id="vcRejectReason" class="input" rows="4" placeholder="반려 사유를 입력해 주세요."></textarea>
            <div id="vcRejectError" style="color:var(--danger);font-size:13px;margin-top:6px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="vcRejectCancelBtn">취소</button>
            <button class="btn-sm btn-sm-danger" type="button" id="vcRejectSubmitBtn">반려 확정</button>
          </div>
        </div>
      </div>
    `;

    /* 이벤트 바인딩 */
    bindPeriodSelector('vc', () => { currentPage = 1; loadVoucherList(); });
    document.getElementById('vcRefreshBtn')?.addEventListener('click', () => { currentPage = 1; loadVoucherList(); });
    document.getElementById('vcAddBtn')?.addEventListener('click', () => openVoucherModal(null));
    document.getElementById('vcAddCloseBtn')?.addEventListener('click', closeVoucherModal);
    document.getElementById('vcAddCancelBtn')?.addEventListener('click', closeVoucherModal);
    document.getElementById('vcSaveDraftBtn')?.addEventListener('click', saveVoucherDraft);
    document.getElementById('vcRejectCloseBtn')?.addEventListener('click', closeVoucherRejectModal);
    document.getElementById('vcRejectCancelBtn')?.addEventListener('click', closeVoucherRejectModal);

    /* 반복 템플릿 체크박스 */
    document.getElementById('vcIsTemplate')?.addEventListener('change', function () {
      const row = document.getElementById('vcTemplateNameRow');
      if (row) row.style.display = this.checked ? '' : 'none';
    });

    /* 템플릿 선택 드롭다운 */
    document.getElementById('vcTemplateSelect')?.addEventListener('change', function () {
      const tid = this.value;
      if (!tid) return;
      const tpl = templates.find(t => String(t.id) === String(tid));
      if (!tpl) return;
      openVoucherModal(null, tpl);
      this.value = '';
    });

    /* 모달 바깥 클릭 닫기 */
    ['vcAddModal', 'vcRejectModal'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
      });
    });

    loadVoucherList();
  }

  /* ── 전표 목록 조회 ── */
  async function loadVoucherList() {
    const tbody = document.getElementById('vcTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>';

    const { startDate, endDate } = getPeriodQs('vc');
    const accountCode = document.getElementById('vcAccountFilter')?.value || '';
    const status      = document.getElementById('vcStatusFilter')?.value || '';

    const qs = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE });
    if (startDate) qs.set('startDate', startDate);
    if (endDate)   qs.set('endDate', endDate);
    if (accountCode) qs.set('accountCode', accountCode);
    if (status)    qs.set('status', status);

    const res = await api('GET', `/api/admin-vouchers-list?${qs}`);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--danger)">조회 실패: ${escapeHtml(res.error || '')}</td></tr>`;
      return;
    }

    const d     = res.data?.data || res.data;
    const items = d?.items || [];
    const total = d?.total || 0;

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-3)">전표가 없습니다.</td></tr>';
      document.getElementById('vcPager').innerHTML = '';
      return;
    }

    tbody.innerHTML = items.map(v => {
      const status = v.status || 'draft';
      const label  = voucherStatusLabel(status);
      const color  = voucherStatusColor(status);
      const bg     = voucherStatusBg(status);
      const budgetName = v.budget_line_name || v.budgetLineName || v.categoryName || '—';

      const actions = buildVoucherActions(v);

      return `<tr>
        <td style="font-family:monospace;font-size:12px">${escapeHtml(v.voucher_number || v.voucherNumber || '')}</td>
        <td>${fmtDate(v.voucher_date || v.voucherDate)}</td>
        <td>${escapeHtml(v.description || '')}</td>
        <td>${escapeHtml(v.payee_name || v.payeeName || '—')}</td>
        <td>${escapeHtml(v.account_name || v.accountName || v.account_code || v.accountCode || '')}</td>
        <td class="num">${fmtKRW(v.amount)}</td>
        <td style="font-size:12px;color:var(--text-2)">${escapeHtml(budgetName)}</td>
        <td><span style="padding:2px 8px;border-radius:20px;font-size:12px;font-weight:600;color:${color};background:${bg}">${label}</span></td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');

    /* 페이저 */
    const pager = document.getElementById('vcPager');
    if (pager) {
      const totalPages = Math.ceil(total / PAGE_SIZE);
      if (totalPages > 1) {
        const btns = [];
        for (let p = 1; p <= totalPages; p++) {
          btns.push(`<button class="btn-sm ${p === currentPage ? 'btn-sm-primary' : 'btn-sm-ghost'}" onclick="window.SIREN_VOUCHER.goPage(${p})" type="button">${p}</button>`);
        }
        pager.innerHTML = btns.join(' ');
      } else {
        pager.innerHTML = '';
      }
    }
  }

  function buildVoucherActions(v) {
    const status = v.status || 'draft';
    const id     = v.id;
    const btns   = [];

    if (status === 'draft') {
      btns.push(`<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_VOUCHER.editVoucher(${id})">수정</button>`);
      btns.push(`<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_VOUCHER.submitVoucher(${id})" style="margin-left:4px">제출</button>`);
      btns.push(`<button class="btn-sm btn-sm-danger" type="button" onclick="window.SIREN_VOUCHER.deleteVoucher(${id})" style="margin-left:4px">삭제</button>`);
    } else if (status === 'submitted') {
      if (isSuperAdmin()) {
        btns.push(`<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_VOUCHER.approveVoucher(${id})" style="background:var(--success)">승인</button>`);
        btns.push(`<button class="btn-sm btn-sm-danger" type="button" onclick="window.SIREN_VOUCHER.openRejectVoucher(${id})" style="margin-left:4px">반려</button>`);
      }
    } else if (status === 'rejected') {
      btns.push(`<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_VOUCHER.editVoucher(${id})">수정</button>`);
      btns.push(`<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_VOUCHER.submitVoucher(${id})" style="margin-left:4px">재제출</button>`);
    }

    return btns.join('');
  }

  /* ── 페이저 ── */
  function goPage(p) {
    currentPage = p;
    loadVoucherList();
  }

  /* ════════════════════════════════════════════════
     전표 작성 모달
  ════════════════════════════════════════════════ */
  function openVoucherModal(voucherId, prefill) {
    const modal = document.getElementById('vcAddModal');
    if (!modal) return;
    const titleEl = document.getElementById('vcAddModalTitle');
    if (titleEl) titleEl.textContent = voucherId ? '전표 수정' : '전표 작성';
    document.getElementById('vcEditId').value = voucherId || '';
    document.getElementById('vcAddError').style.display = 'none';

    /* 폼 초기화 */
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('vcDate').value          = prefill?.voucher_date || prefill?.voucherDate || today;
    document.getElementById('vcAccountCode').value   = prefill?.account_code || prefill?.accountCode || '';
    document.getElementById('vcSubAccount').value    = prefill?.sub_account  || prefill?.subAccount  || '';
    document.getElementById('vcAmount').value        = prefill?.amount || '';
    document.getElementById('vcDescription').value   = prefill?.description || '';
    document.getElementById('vcPayeeName').value     = prefill?.payee_name || prefill?.payeeName || '';
    document.getElementById('vcEvidenceType').value  = prefill?.evidence_type || prefill?.evidenceType || 'none';
    document.getElementById('vcEvidenceNumber').value= prefill?.evidence_number || prefill?.evidenceNumber || '';
    document.getElementById('vcBudgetLineId').value  = prefill?.budget_line_id || prefill?.budgetLineId || '';
    document.getElementById('vcIsTemplate').checked  = false;
    document.getElementById('vcTemplateName').value  = '';
    document.getElementById('vcTemplateNameRow').style.display = 'none';

    modal.style.display = 'flex';
  }

  function closeVoucherModal() {
    const modal = document.getElementById('vcAddModal');
    if (modal) modal.style.display = 'none';
  }

  /* ── 전표 상세 로드 후 수정 모달 열기 ── */
  async function editVoucher(id) {
    const res = await api('GET', `/api/admin-voucher-detail?id=${id}`);
    if (!res.ok) { alert('조회 실패: ' + (res.data?.error || res.error || '')); return; }
    const v = res.data?.data?.voucher || res.data?.voucher || res.data?.data || res.data;
    openVoucherModal(id, v);
  }

  /* ── 전표 저장 (draft) ── */
  async function saveVoucherDraft() {
    const errEl  = document.getElementById('vcAddError');
    errEl.style.display = 'none';

    const editId      = document.getElementById('vcEditId').value;
    const date        = document.getElementById('vcDate').value;
    const accountCode = document.getElementById('vcAccountCode').value;
    const amount      = parseInt(document.getElementById('vcAmount').value) || 0;
    const description = document.getElementById('vcDescription').value.trim();
    const subAccount  = document.getElementById('vcSubAccount').value.trim();
    const payeeName   = document.getElementById('vcPayeeName').value.trim();
    const evidenceType= document.getElementById('vcEvidenceType').value;
    const evidenceNumber = document.getElementById('vcEvidenceNumber').value.trim();
    const budgetLineId= document.getElementById('vcBudgetLineId').value;
    const isTemplate  = document.getElementById('vcIsTemplate').checked;
    const templateName= document.getElementById('vcTemplateName').value.trim();

    if (!date || !accountCode || !amount || !description) {
      errEl.textContent = '날짜·계정과목·금액·적요는 필수입니다.';
      errEl.style.display = '';
      return;
    }
    if (isTemplate && !templateName) {
      errEl.textContent = '템플릿으로 저장하려면 템플릿 이름을 입력해 주세요.';
      errEl.style.display = '';
      return;
    }

    const body = {
      voucherDate:    date,
      accountCode,
      subAccount:     subAccount || undefined,
      description,
      payeeName:      payeeName  || undefined,
      amount,
      evidenceType,
      evidenceNumber: evidenceNumber || undefined,
      budgetLineId:   budgetLineId ? parseInt(budgetLineId) : undefined,
      isTemplate,
      templateName:   isTemplate ? templateName : undefined,
    };

    let res;
    if (editId) {
      res = await api('PUT', '/api/admin-voucher-update', { id: parseInt(editId), ...body });
    } else {
      res = await api('POST', '/api/admin-voucher-create', body);
    }

    if (!res.ok) {
      errEl.textContent = '저장 실패: ' + (res.data?.error || res.error || '');
      errEl.style.display = '';
      return;
    }

    closeVoucherModal();
    await loadTemplates();
    /* 템플릿 드롭다운 갱신 */
    const tplSel = document.getElementById('vcTemplateSelect');
    if (tplSel) {
      tplSel.innerHTML = `<option value="">템플릿 불러오기…</option>` +
        templates.map(t => `<option value="${t.id}">${escapeHtml(t.template_name || t.templateName || '이름없음')}</option>`).join('');
    }
    loadVoucherList();
  }

  /* ── 전표 제출 ── */
  async function submitVoucher(id) {
    if (!confirm('전표를 제출하시겠습니까? 제출 후 승인 담당자에게 알림이 전송됩니다.')) return;
    const res = await api('POST', '/api/admin-voucher-submit', { id });
    if (!res.ok) { alert('제출 실패: ' + (res.data?.error || res.error || '')); return; }
    loadVoucherList();
  }

  /* ── 전표 승인 ── */
  async function approveVoucher(id) {
    if (!confirm('전표를 승인하시겠습니까?')) return;
    const res = await api('POST', '/api/admin-voucher-approve', { id });
    if (!res.ok) { alert('승인 실패: ' + (res.data?.error || res.error || '')); return; }
    loadVoucherList();
  }

  /* ── 전표 반려 모달 ── */
  let _rejectVoucherId = null;
  function openRejectVoucher(id) {
    _rejectVoucherId = id;
    const modal = document.getElementById('vcRejectModal');
    if (!modal) return;
    document.getElementById('vcRejectReason').value = '';
    document.getElementById('vcRejectError').style.display = 'none';
    modal.style.display = 'flex';

    const submitBtn = document.getElementById('vcRejectSubmitBtn');
    submitBtn.onclick = null;
    submitBtn.onclick = doRejectVoucher;
  }
  function closeVoucherRejectModal() {
    const modal = document.getElementById('vcRejectModal');
    if (modal) modal.style.display = 'none';
    _rejectVoucherId = null;
  }
  async function doRejectVoucher() {
    const reason = document.getElementById('vcRejectReason')?.value.trim();
    const errEl  = document.getElementById('vcRejectError');
    if (!reason) {
      if (errEl) { errEl.textContent = '반려 사유를 입력해 주세요.'; errEl.style.display = ''; }
      return;
    }
    const res = await api('POST', '/api/admin-voucher-reject', { id: _rejectVoucherId, rejectionReason: reason });
    if (!res.ok) {
      if (errEl) { errEl.textContent = '반려 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; }
      return;
    }
    closeVoucherRejectModal();
    loadVoucherList();
  }

  /* ── 전표 삭제 ── */
  async function deleteVoucher(id) {
    if (!confirm('전표를 삭제하시겠습니까?')) return;
    const res = await api('DELETE', `/api/admin-voucher-delete?id=${id}`);
    if (!res.ok) { alert('삭제 실패: ' + (res.data?.error || res.error || '')); return; }
    loadVoucherList();
  }

  /* ════════════════════════════════════════════════
     외부 진입점: admin-expenses.js에서 호출
  ════════════════════════════════════════════════ */
  async function initVoucherTab(container) {
    if (!container) return;
    await loadMyRole();
    await Promise.all([loadAccountCodes(), loadBudgetLines(), loadTemplates()]);
    renderVoucherTab(container);
  }

  window.SIREN_VOUCHER = {
    initVoucherTab,
    loadVoucherList,
    goPage,
    editVoucher,
    submitVoucher,
    approveVoucher,
    openRejectVoucher,
    deleteVoucher,
  };
})();
