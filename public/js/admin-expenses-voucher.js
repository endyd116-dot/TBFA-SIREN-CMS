/* admin-expenses-voucher.js — 전표 관리 (Phase 22-D-R1)
 * 2026-11-06 복식 전표로 전환: 재정 관리 › 장부에서 연다. 지출·수입은 쉬운 입력, 대체·개시는 줄 직접 입력.
 * 서버 응답 키: 계정 codes·accounts, 전표 vouchers, 틀 templates. */
(function () {
  'use strict';

  /* ── 상태 ── */
  let myRole        = null;
  let accountCodes  = [];   // 계정과목 목록
  let budgetLines   = [];   // 예산 항목 목록 (22-B-R2 마이그 후 채워짐)
  let budgetAvailMap = {};  // { budgetLineId: { planned, reserved, executed, available } } — 예산 잠금
  let templates     = [];   // 반복 템플릿 목록
  let currentPage   = 1;
  const PAGE_SIZE   = 30;
  let filterParams  = {};   // 현재 필터 상태
  let currentItems  = [];   // 현재 페이지 전표 목록 (일괄 인쇄용)
  let orgName       = '(사)교사유가족협의회';
  let masters       = { accounts: [], programs: [], funds: [], functions: [], fiscalYears: [] };
  let vc            = null;   // 작성 창 상태 { type, rows, manual, pay }
  let viewingId     = null;   // 보기 창에 열린 전표
  const FN_LABEL    = { service: '사업수행', admin: '일반관리', fundraising: '모금' };
  const TYPE_LABEL  = { expense: '지출', income: '수입', transfer: '대체', opening: '개시', reversal: '취소' };
  const SOURCE_LABEL = {
    donation: '후원금', revenue: '기타 수입', revenue_refund: '수입 환불', expense: '지출',
    expense_refund: '지출 환불', payroll: '급여', settlement: '정산 입금',
  };
  const HISTORY_LABEL = {
    created: '작성', updated: '수정', submitted: '제출', approved: '승인',
    rejected: '반려', reversed: '반대 전표로 취소', deleted: '삭제',
  };

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

  function templateOptionLabel(t) {
    const name = escapeHtml(t.template_name || t.templateName || '이름없음');
    const active = t.recurring_active ?? t.recurringActive;
    const day    = t.recurring_day ?? t.recurringDay;
    if (active) {
      const dayLabel = (day === 0 || day === '0') ? '말일' : `${day}일`;
      return `${name} (매월 ${dayLabel})`;
    }
    return name;
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
    const res = await api('GET', '/api/admin-ledger-masters');
    if (res.ok) {
      const d = res.data?.data || res.data || {};
      masters = {
        accounts: d.accounts || [], programs: d.programs || [], funds: d.funds || [],
        functions: d.functions || [], fiscalYears: d.fiscalYears || [],
      };
      accountCodes = masters.accounts.filter(a => a.isActive);
      return;
    }
    const fallback = await api('GET', '/api/admin-account-codes-list');
    const d = fallback.data?.data || fallback.data || {};
    accountCodes = d.codes || d.items || [];
  }

  async function loadBudgetLines() {
    budgetAvailMap = {};
    const res = await api('GET', '/api/admin-budget-plan-list');
    if (!res.ok) { budgetLines = []; return; }
    const plans = res.data?.data?.plans || res.data?.plans || res.data?.data || res.data || [];
    const approved = Array.isArray(plans) ? plans.filter(p => p.status === 'approved') : [];
    if (!approved.length) { budgetLines = []; return; }
    /* 최신 승인 예산안의 lines 로드 */
    const latest = approved.sort((a, b) => (b.fiscal_year || b.fiscalYear) - (a.fiscal_year || a.fiscalYear))[0];
    const year = latest.fiscal_year || latest.fiscalYear;
    const dres = await api('GET', `/api/admin-budget-plan-detail?id=${latest.id}`);
    if (dres.ok) {
      const d = dres.data?.data || dres.data;
      budgetLines = d?.lines || [];
    } else {
      budgetLines = [];
    }
    /* 예산 잠금 — 항목별 가용액 맵 (admin-finance-budget-list 확장 응답) */
    const bres = await api('GET', `/api/admin-finance-budget-list?year=${year}`);
    if (bres.ok) {
      const bd = bres.data?.data || bres.data;
      const items = bd?.items || [];
      items.forEach(it => {
        const lid = it.id || it.budgetLineId || it.budget_line_id;
        if (lid == null) return;
        const planned   = it.planned  || it.plannedAmount  || it.planned_amount  || 0;
        const reserved  = it.reserved || it.reservedAmount || it.reserved_amount || 0;
        const executed  = it.executed || it.executedAmount || it.executed_amount || 0;
        const available = it.available != null ? it.available : (planned - reserved - executed);
        budgetAvailMap[String(lid)] = { planned, reserved, executed, available };
      });
    }
  }

  async function loadTemplates() {
    const res = await api('GET', '/api/admin-voucher-templates-list');
    if (res.ok) {
      const raw = res.data?.data?.templates || res.data?.templates || res.data?.data?.items || [];
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
      <!-- 결산 체크리스트 배너 -->
      <div id="vcSettlementBanner" style="display:none;margin-bottom:16px"></div>

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
        <select id="vcTemplateSelect" class="input-sm" style="width:200px" title="반복 템플릿 불러오기">
          <option value="">템플릿 불러오기…</option>
          ${templates.map(t => `<option value="${t.id}">${templateOptionLabel(t)}</option>`).join('')}
        </select>
        <button class="btn-sm btn-sm-ghost" id="vcPrintSelectedBtn" type="button">선택 일괄 인쇄</button>
        <button class="btn-sm btn-sm-primary" id="vcAddBtn" type="button">+ 전표 작성</button>
      </div>

      <!-- 목록 테이블 -->
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th style="width:32px"><input type="checkbox" id="vcCheckAll" title="전체 선택"></th>
            <th>전표번호</th>
            <th>날짜</th>
            <th>적요</th>
            <th>거래처</th>
            <th>구분</th>
            <th>계정과목</th>
            <th class="num">금액</th>
            <th>예산</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="vcTbody">
          <tr><td colspan="11" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>
        </tbody>
      </table>
      <div id="vcPager" style="margin-top:12px;text-align:center"></div>

      <!-- ── 전표 작성/수정 모달 ── -->
      <div id="vcAddModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:900px">
          <div class="modal-head">
            <span class="modal-title" id="vcAddModalTitle">전표 작성</span>
            <button class="modal-close" type="button" id="vcAddCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="vcEditId">
            <div id="vcTypeBar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
              <button type="button" class="btn-sm btn-sm-ghost" data-vtype="expense">지출</button>
              <button type="button" class="btn-sm btn-sm-ghost" data-vtype="income">수입</button>
              <button type="button" class="btn-sm btn-sm-ghost" data-vtype="transfer">대체</button>
              <button type="button" class="btn-sm btn-sm-ghost" data-vtype="opening">개시 잔액</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-row">
                <label class="form-label">날짜 <span style="color:var(--danger)">*</span></label>
                <input type="date" id="vcDate" class="input">
              </div>
              <div class="form-row">
                <label class="form-label">거래처</label>
                <input type="text" id="vcPayeeName" class="input" placeholder="거래처명">
              </div>
              <div class="form-row" style="grid-column:1/-1">
                <label class="form-label">적요 <span style="color:var(--danger)">*</span></label>
                <input type="text" id="vcDescription" class="input" placeholder="무엇에 대한 전표인지 적어 주세요">
              </div>
            </div>
            <div id="vcLinesBox" style="margin-top:14px"></div>
            <div id="vcPreview" style="margin-top:10px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:14px">
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
              <div class="form-row">
                <label class="form-label">세목</label>
                <input type="text" id="vcSubAccount" class="input" placeholder="선택 입력">
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
                <div id="vcBudgetAvail" style="display:none;margin-top:6px;font-size:12px;padding:8px 10px;border-radius:6px"></div>
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
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-top:10px">
                <input type="checkbox" id="vcRecurringActive">
                매월 지정일에 작성중 전표 자동 생성
              </label>
              <div id="vcRecurringDayRow" style="display:none;margin-top:8px;align-items:center;gap:8px">
                <label class="form-label" style="margin:0">매월</label>
                <select id="vcRecurringDay" class="input-sm" style="width:90px">
                  ${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}일</option>`).join('')}
                  <option value="0">말일</option>
                </select>
                <span style="font-size:12px;color:var(--text-3)">에 자동 생성</span>
              </div>
            </div>
            <div id="vcAddError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="vcAddCancelBtn">취소</button>
            <button class="btn-sm btn-sm-ghost" type="button" id="vcSaveDraftBtn">저장 (작성중)</button>
            <button class="btn-sm btn-sm-primary" type="button" id="vcSaveSubmitBtn">저장 후 제출</button>
          </div>
        </div>
      </div>

      <!-- ── 전표 보기 모달 ── -->
      <div id="vcViewModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:760px">
          <div class="modal-head">
            <span class="modal-title" id="vcViewTitle">전표 보기</span>
            <button class="modal-close" type="button" id="vcViewCloseBtn">×</button>
          </div>
          <div class="modal-body" id="vcViewBody"></div>
          <div class="modal-foot" id="vcViewFoot"></div>
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
    document.getElementById('vcPrintSelectedBtn')?.addEventListener('click', printSelectedVouchers);
    document.getElementById('vcCheckAll')?.addEventListener('change', function () {
      document.querySelectorAll('.vc-row-check').forEach(cb => { cb.checked = this.checked; });
    });
    document.getElementById('vcAddCloseBtn')?.addEventListener('click', closeVoucherModal);
    document.getElementById('vcAddCancelBtn')?.addEventListener('click', closeVoucherModal);
    document.getElementById('vcSaveDraftBtn')?.addEventListener('click', () => saveVoucherDraft(false));
    document.getElementById('vcSaveSubmitBtn')?.addEventListener('click', () => saveVoucherDraft(true));
    document.getElementById('vcViewCloseBtn')?.addEventListener('click', closeView);
    document.getElementById('vcTypeBar')?.addEventListener('click', e => {
      const type = e.target?.dataset?.vtype;
      if (type) setVoucherType(type);
    });
    const linesBox = document.getElementById('vcLinesBox');
    linesBox?.addEventListener('change', onLinesChange);
    linesBox?.addEventListener('input', onLinesInput);
    linesBox?.addEventListener('click', onLinesClick);
    document.getElementById('vcRejectCloseBtn')?.addEventListener('click', closeVoucherRejectModal);
    document.getElementById('vcRejectCancelBtn')?.addEventListener('click', closeVoucherRejectModal);

    /* 반복 템플릿 체크박스 */
    document.getElementById('vcIsTemplate')?.addEventListener('change', function () {
      const row = document.getElementById('vcTemplateNameRow');
      if (row) row.style.display = this.checked ? '' : 'none';
    });

    /* 매월 자동 생성 토글 */
    document.getElementById('vcRecurringActive')?.addEventListener('change', function () {
      const row = document.getElementById('vcRecurringDayRow');
      if (row) row.style.display = this.checked ? 'flex' : 'none';
    });

    /* 예산 잠금 — 예산 항목·금액 변경 시 가용액 표시 */
    document.getElementById('vcBudgetLineId')?.addEventListener('change', renderBudgetAvail);

    /* 템플릿 선택 드롭다운 */
    document.getElementById('vcTemplateSelect')?.addEventListener('change', async function () {
      const tid = this.value;
      if (!tid) return;
      const tpl = templates.find(t => String(t.id) === String(tid));
      this.value = '';
      if (!tpl) return;
      const res = await api('GET', `/api/admin-voucher-detail?id=${tid}`);
      const detail = res.ok ? (res.data?.data?.voucher || null) : null;
      openVoucherModal(null, { ...tpl, ...(detail || {}), id: undefined });
    });

    /* 모달 바깥 클릭 닫기 */
    ['vcAddModal', 'vcRejectModal', 'vcViewModal'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
      });
    });

    loadVoucherList();
    loadSettlementBanner();
    loadAnomalyBadges();
  }

  /* ════════════════════════════════════════════════
     결산 체크리스트 배너 (미결 전표·미확인 통장 거래)
  ════════════════════════════════════════════════ */
  async function loadSettlementBanner() {
    const banner = document.getElementById('vcSettlementBanner');
    if (!banner) return;
    const res = await api('GET', '/api/admin-finance-settlement-check');
    if (!res.ok) { banner.style.display = 'none'; return; }
    const d = res.data?.data || res.data || {};
    const pendingVouchers = d.pendingVouchers ?? d.pending_vouchers ?? d.unsettledVouchers ?? 0;
    const draftCount      = d.draftCount ?? d.draft_count ?? 0;
    const submittedCount  = d.submittedCount ?? d.submitted_count ?? 0;
    const unconfirmedTxns = d.pendingBankTxn ?? d.unconfirmedTxns ?? d.unconfirmed_txns ?? d.unmatchedTransactions ?? 0;
    const monthLabel      = (d.year && d.month) ? `${d.year}년 ${d.month}월` : (d.month || d.monthLabel || '이번 달');

    const totalPending = pendingVouchers || (draftCount + submittedCount);
    if (!totalPending && !unconfirmedTxns) {
      banner.style.display = '';
      banner.innerHTML = `
        <div style="padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#15803d;font-size:13px">
          ${escapeHtml(String(monthLabel))} 결산 정리 완료 — 미결 전표·미확인 통장 거래가 없습니다.
        </div>`;
      return;
    }

    const parts = [];
    if (totalPending) {
      const detail = (draftCount || submittedCount)
        ? ` (작성중 ${draftCount}건 · 승인 대기 ${submittedCount}건)`
        : '';
      parts.push(`미결 전표 <strong>${totalPending}건</strong>${detail}`);
    }
    if (unconfirmedTxns) parts.push(`미확인 통장 거래 <strong>${unconfirmedTxns}건</strong>`);

    banner.style.display = '';
    banner.innerHTML = `
      <div style="padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:13px">
        <strong>${escapeHtml(String(monthLabel))} 결산 체크리스트</strong> — ${parts.join(' · ')}
        <span style="color:#a16207"> · 마감 전 정리해 주세요.</span>
      </div>`;
  }

  /* ════════════════════════════════════════════════
     이상 지출 패턴 배지 (계정과목별 전월 대비 급증)
  ════════════════════════════════════════════════ */
  let anomalyCodes = {};   // { accountCode: { rate, current, prev } }
  async function loadAnomalyBadges() {
    const res = await api('GET', '/api/admin-finance-anomaly');
    if (!res.ok) { anomalyCodes = {}; return; }
    const d = res.data?.data || res.data || {};
    /* 백엔드는 items에 급증·비급증 모두 담고 surge 플래그로 구분 — surgeItems만 배지 대상 */
    const items = d.surgeItems || (d.items || d.anomalies || (Array.isArray(d) ? d : [])).filter(it => it.surge);
    anomalyCodes = {};
    (items || []).forEach(it => {
      const code = it.accountCode || it.account_code || it.code;
      if (!code) return;
      anomalyCodes[String(code)] = {
        rate:    it.changeRate ?? it.increaseRate ?? it.increase_rate ?? it.rate ?? null,
        current: it.thisMonth ?? it.currentAmount ?? it.current_amount ?? it.current ?? 0,
        prev:    it.prevSync ?? it.prevAmount ?? it.prev_amount ?? it.previous ?? 0,
        name:    it.accountName || it.account_name || it.name || '',
      };
    });
    /* 이미 렌더된 목록이 있으면 배지 반영 위해 재렌더 */
    if (currentItems.length) renderVoucherRows();
  }

  function anomalyBadge(accountCode) {
    const a = anomalyCodes[String(accountCode)];
    if (!a) return '';
    /* rate=null = 전월 동기 지출 0원이라 비율 계산 불가 (신규 발생) */
    const rateText = (a.rate == null) ? '신규' : `+${Math.round(a.rate)}%`;
    return ` <span class="vc-anomaly-badge" title="전월 대비 급증 (전월 ${fmtKRW(a.prev)} → 이번 달 ${fmtKRW(a.current)})" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;border:1px solid #fde68a">급증 ${rateText}</span>`;
  }

  /* ── 전표 목록 조회 ── */
  async function loadVoucherList() {
    const tbody = document.getElementById('vcTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>';

    const { startDate, endDate } = getPeriodQs('vc');
    const accountCode = document.getElementById('vcAccountFilter')?.value || '';
    const status      = document.getElementById('vcStatusFilter')?.value || '';

    const qs = new URLSearchParams({ page: currentPage, limit: PAGE_SIZE, isTemplate: 'false' });
    if (startDate) qs.set('startDate', startDate);
    if (endDate)   qs.set('endDate', endDate);
    if (accountCode) qs.set('accountCode', accountCode);
    if (status)    qs.set('status', status);

    const res = await api('GET', `/api/admin-vouchers-list?${qs}`);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--danger)">조회 실패: ${escapeHtml(res.error || '')}</td></tr>`;
      return;
    }

    const d     = res.data?.data || res.data;
    const items = d?.vouchers || d?.items || [];
    const total = d?.total || 0;
    currentItems = items;

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-3)">전표가 없습니다.</td></tr>';
      document.getElementById('vcPager').innerHTML = '';
      return;
    }

    renderVoucherRows();

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

  /* ── 전표 행 렌더 (anomaly 배지 갱신 시 재호출) ── */
  function renderVoucherRows() {
    const tbody = document.getElementById('vcTbody');
    if (!tbody || !currentItems.length) return;
    tbody.innerHTML = currentItems.map(v => {
      const status = v.status || 'draft';
      const label  = voucherStatusLabel(status);
      const color  = voucherStatusColor(status);
      const bg     = voucherStatusBg(status);
      const budgetName = v.budget_line_name || v.budgetLineName || v.categoryName || '—';
      const accCode = v.account_code || v.accountCode || '';
      const actions = buildVoucherActions(v);
      const vType   = v.voucherType || 'expense';
      const cancelled = v.reversedById
        ? '<span style="margin-left:4px;font-size:11px;color:var(--danger)">취소됨</span>' : '';

      return `<tr>
        <td><input type="checkbox" class="vc-row-check" value="${v.id}"></td>
        <td style="font-family:monospace;font-size:12px;white-space:nowrap">${escapeHtml(v.voucher_number || v.voucherNumber || '')}</td>
        <td style="white-space:nowrap">${fmtDate(v.voucher_date || v.voucherDate)}</td>
        <td>${escapeHtml(v.description || '')}</td>
        <td>${escapeHtml(v.payee_name || v.payeeName || '—')}</td>
        <td style="white-space:nowrap">${escapeHtml(TYPE_LABEL[vType] || vType)}</td>
        <td>${escapeHtml(v.account_name || v.accountName || accCode || '')}${anomalyBadge(accCode)}</td>
        <td class="num" style="white-space:nowrap">${fmtKRW(v.amount)}</td>
        <td style="font-size:12px;color:var(--text-2)">${escapeHtml(budgetName)}</td>
        <td style="white-space:nowrap"><span style="padding:2px 8px;border-radius:20px;font-size:12px;font-weight:600;color:${color};background:${bg}">${label}</span>${cancelled}</td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('');
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

    btns.push(`<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_VOUCHER.openView(${id})" style="margin-left:4px">보기</button>`);
    btns.push(`<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_VOUCHER.printVoucher(${id})" style="margin-left:4px">인쇄</button>`);

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
  const roleAccount = role => masters.accounts.find(a => a.systemRole === role);
  const accountOf = code => masters.accounts.find(a => a.code === code);
  const leafAccounts = filter => masters.accounts.filter(a => a.isActive && !a.hasChildren && (!filter || filter(a)));
  const isBusinessExpense = a => a && a.statementLine === 'business_expense';
  const isIncomeOrExpense = a => a && (a.kind === 'revenue' || a.kind === 'expense');
  const newRow = () => ({ accountCode: '', amount: 0, functionCode: '', programId: '', fundId: '' });
  const newManual = () => ({ accountCode: '', debit: 0, credit: 0, functionCode: '', programId: '', fundId: '' });

  function accountOptions(list, selected) {
    const names = new Map(masters.accounts.map(a => [a.code, a.name]));
    const groups = new Map();
    list.forEach(a => {
      const g = names.get(a.parentCode) || '기타';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    });
    const body = Array.from(groups).map(([g, items]) =>
      `<optgroup label="${escapeHtml(g)}">${items.map(a =>
        `<option value="${escapeHtml(a.code)}"${a.code === selected ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</optgroup>`).join('');
    return '<option value="">선택</option>' + body;
  }
  function fnOptions(selected) {
    return '<option value="">활동</option>' + Object.keys(FN_LABEL).map(k =>
      `<option value="${k}"${k === selected ? ' selected' : ''}>${FN_LABEL[k]}</option>`).join('');
  }
  function programOptions(selected) {
    return '<option value="">사업</option>' + masters.programs.filter(p => p.isActive).map(p =>
      `<option value="${p.id}"${String(p.id) === String(selected) ? ' selected' : ''}>${escapeHtml(p.name)}${p.charterRef ? '' : ' (정관 근거 없음)'}</option>`).join('');
  }
  function fundOptions(selected) {
    return '<option value="">재원</option>' + masters.funds.filter(f => f.isActive).map(f =>
      `<option value="${f.id}"${String(f.id) === String(selected) ? ' selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
  }
  function payOptions(type, selected) {
    const cash = masters.accounts.filter(a => a.isActive && a.parentCode === '101');
    const others = type === 'expense'
      ? [roleAccount('payable_default')]
      : [roleAccount('receivable_default'), roleAccount('settlement_receivable')];
    return [...cash, ...others.filter(Boolean)].map(a =>
      `<option value="${escapeHtml(a.code)}"${a.code === selected ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  }

  /* 분개 줄 계산: 화면 상태 → 서버로 보낼 줄 */
  function buildLines() {
    if (!vc) return [];
    if (vc.type === 'expense' || vc.type === 'income') {
      const rows = vc.rows.filter(r => r.accountCode && Number(r.amount) > 0);
      const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
      const isExpense = vc.type === 'expense';
      const body = rows.map(r => ({
        accountCode: r.accountCode,
        debit: isExpense ? Number(r.amount) : 0,
        credit: isExpense ? 0 : Number(r.amount),
        functionCode: isExpense ? (r.functionCode || null) : null,
        programId: isExpense && r.functionCode === 'service' ? (Number(r.programId) || null) : null,
        fundId: Number(r.fundId) || null,
      }));
      if (!total || !vc.pay) return body;
      const counter = { accountCode: vc.pay, debit: isExpense ? 0 : total, credit: isExpense ? total : 0 };
      return isExpense ? [...body, counter] : [counter, ...body];
    }
    return vc.manual.filter(r => r.accountCode && (Number(r.debit) > 0 || Number(r.credit) > 0)).map(r => ({
      accountCode: r.accountCode,
      debit: Number(r.debit) || 0,
      credit: Number(r.credit) || 0,
      functionCode: r.functionCode || null,
      programId: r.functionCode === 'service' ? (Number(r.programId) || null) : null,
      fundId: Number(r.fundId) || null,
    }));
  }
  const linesTotal = () => buildLines().reduce((sum, l) => sum + l.debit, 0);

  function renderTypeBar() {
    document.querySelectorAll('#vcTypeBar [data-vtype]').forEach(b => {
      b.className = 'btn-sm ' + (b.dataset.vtype === vc.type ? 'btn-sm-primary' : 'btn-sm-ghost');
    });
  }

  function renderLinesBox() {
    const box = document.getElementById('vcLinesBox');
    if (!box || !vc) return;
    const simple = vc.type === 'expense' || vc.type === 'income';
    if (simple) {
      const isExpense = vc.type === 'expense';
      const options = leafAccounts(a => a.kind === (isExpense ? 'expense' : 'revenue'));
      const cols = isExpense ? '2fr 1.1fr 1.1fr 1.5fr 1.1fr 32px' : '3fr 1.3fr 1.5fr 32px';
      box.innerHTML = `
        <div style="display:grid;grid-template-columns:${cols};gap:6px;font-size:12px;color:var(--text-3);margin-bottom:4px">
          <span>${isExpense ? '무엇에 썼나' : '무슨 수입인가'}</span><span>금액</span>
          ${isExpense ? '<span>왜 썼나</span><span>어느 사업</span>' : ''}
          <span>어떤 돈</span><span></span>
        </div>
        ${vc.rows.map((r, i) => `
          <div style="display:grid;grid-template-columns:${cols};gap:6px;margin-bottom:6px">
            <select class="input" data-mode="row" data-i="${i}" data-f="accountCode">${accountOptions(options, r.accountCode)}</select>
            <input class="input" type="number" min="0" step="1" data-mode="row" data-i="${i}" data-f="amount" value="${Number(r.amount) || ''}" placeholder="금액">
            ${isExpense ? `<select class="input" data-mode="row" data-i="${i}" data-f="functionCode">${fnOptions(r.functionCode)}</select>
            <select class="input" data-mode="row" data-i="${i}" data-f="programId"${r.functionCode === 'service' ? '' : ' disabled'}>${programOptions(r.programId)}</select>` : ''}
            <select class="input" data-mode="row" data-i="${i}" data-f="fundId">${fundOptions(r.fundId)}</select>
            <button type="button" class="btn-sm btn-sm-ghost" data-act="del" data-i="${i}" title="이 줄 지우기"${vc.rows.length < 2 ? ' disabled' : ''}>×</button>
          </div>`).join('')}
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px">
          <button type="button" class="btn-sm btn-sm-ghost" data-act="add">+ 나누기</button>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px">
            ${isExpense ? '지급 방법' : '입금 계좌'}
            <select class="input" style="width:230px" data-mode="pay">${payOptions(vc.type, vc.pay)}</select>
          </label>
        </div>`;
    } else {
      const options = leafAccounts();
      box.innerHTML = `
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1.4fr 1fr 32px;gap:6px;font-size:12px;color:var(--text-3);margin-bottom:4px">
          <span>계정과목</span><span>차변</span><span>대변</span><span>활동</span><span>사업</span><span>재원</span><span></span>
        </div>
        ${vc.manual.map((r, i) => {
          const account = accountOf(r.accountCode);
          const showFn = isBusinessExpense(account);
          const showFund = isIncomeOrExpense(account);
          return `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1.4fr 1fr 32px;gap:6px;margin-bottom:6px">
            <select class="input" data-mode="manual" data-i="${i}" data-f="accountCode">${accountOptions(options, r.accountCode)}</select>
            <input class="input" type="number" min="0" step="1" data-mode="manual" data-i="${i}" data-f="debit" value="${Number(r.debit) || ''}">
            <input class="input" type="number" min="0" step="1" data-mode="manual" data-i="${i}" data-f="credit" value="${Number(r.credit) || ''}">
            <select class="input" data-mode="manual" data-i="${i}" data-f="functionCode"${showFn ? '' : ' disabled'}>${fnOptions(r.functionCode)}</select>
            <select class="input" data-mode="manual" data-i="${i}" data-f="programId"${showFn && r.functionCode === 'service' ? '' : ' disabled'}>${programOptions(r.programId)}</select>
            <select class="input" data-mode="manual" data-i="${i}" data-f="fundId"${showFund ? '' : ' disabled'}>${fundOptions(r.fundId)}</select>
            <button type="button" class="btn-sm btn-sm-ghost" data-act="del" data-i="${i}" title="이 줄 지우기"${vc.manual.length < 3 ? ' disabled' : ''}>×</button>
          </div>`;
        }).join('')}
        <button type="button" class="btn-sm btn-sm-ghost" data-act="add" style="margin-top:6px">+ 줄 추가</button>`;
    }
    renderPreview();
  }

  function renderPreview() {
    const box = document.getElementById('vcPreview');
    if (!box) return;
    const lines = buildLines();
    renderBudgetAvail();
    if (!lines.length) { box.innerHTML = ''; return; }
    const dr = lines.reduce((sum, l) => sum + l.debit, 0);
    const cr = lines.reduce((sum, l) => sum + l.credit, 0);
    const matched = dr > 0 && dr === cr;
    box.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;font-size:13px">
        <div style="font-weight:600;margin-bottom:6px">장부에 기록될 내용</div>
        ${lines.map(l => `<div style="display:grid;grid-template-columns:50px 1fr 110px 110px;gap:8px">
          <span style="color:var(--text-3)">${l.debit ? '차변' : '대변'}</span>
          <span>${escapeHtml(accountOf(l.accountCode)?.name || l.accountCode)}${l.functionCode ? ` · ${FN_LABEL[l.functionCode]}` : ''}</span>
          <span style="text-align:right">${l.debit ? fmtKRW(l.debit) : ''}</span>
          <span style="text-align:right">${l.credit ? fmtKRW(l.credit) : ''}</span>
        </div>`).join('')}
        <div style="margin-top:6px;font-weight:600;color:${matched ? '#15803d' : 'var(--danger)'}">
          ${matched ? '합계 일치' : `합계 차이 ${fmtKRW(Math.abs(dr - cr))}`}
        </div>
      </div>`;
  }

  function setVoucherType(type) {
    if (!vc) return;
    vc.type = type;
    if (type === 'opening' && !vc.manual.some(r => r.accountCode)) {
      vc.manual = [
        { ...newManual(), accountCode: roleAccount('cash_default')?.code || '' },
        { ...newManual(), accountCode: roleAccount('opening_net_asset')?.code || '' },
      ];
      const desc = document.getElementById('vcDescription');
      if (desc && !desc.value) desc.value = '개시 잔액';
      const firstYear = masters.fiscalYears.find(f => f.status === 'open');
      const date = document.getElementById('vcDate');
      if (date && firstYear) date.value = firstYear.startDate;
    }
    if (type === 'transfer' && vc.manual.length < 2) vc.manual = [newManual(), newManual()];
    if ((type === 'expense' || type === 'income')) {
      vc.pay = roleAccount('cash_default')?.code || '';
      vc.rows = vc.rows.map(r => ({ ...r, accountCode: accountOf(r.accountCode)?.kind === (type === 'expense' ? 'expense' : 'revenue') ? r.accountCode : '' }));
    }
    renderTypeBar();
    renderLinesBox();
  }

  function onLinesChange(e) {
    const el = e.target;
    if (el.dataset.mode === 'pay') { vc.pay = el.value; renderPreview(); return; }
    if (!el.dataset.mode) return;
    const list = el.dataset.mode === 'row' ? vc.rows : vc.manual;
    const row = list[Number(el.dataset.i)];
    if (!row) return;
    row[el.dataset.f] = el.value;
    if (el.dataset.f === 'accountCode') {
      const account = accountOf(el.value);
      row.functionCode = account?.defaultFunction || '';
      if (row.functionCode !== 'service') row.programId = '';
      if (!isIncomeOrExpense(account)) row.fundId = '';
    }
    if (el.dataset.f === 'functionCode' && el.value !== 'service') row.programId = '';
    renderLinesBox();
  }

  function onLinesInput(e) {
    const el = e.target;
    if (el.tagName !== 'INPUT' || !el.dataset.mode) return;
    const list = el.dataset.mode === 'row' ? vc.rows : vc.manual;
    const row = list[Number(el.dataset.i)];
    if (!row) return;
    row[el.dataset.f] = Number(el.value) || 0;
    renderPreview();
  }

  function onLinesClick(e) {
    const act = e.target?.dataset?.act;
    if (!act) return;
    const simple = vc.type === 'expense' || vc.type === 'income';
    const list = simple ? vc.rows : vc.manual;
    if (act === 'add') list.push(simple ? newRow() : newManual());
    if (act === 'del') list.splice(Number(e.target.dataset.i), 1);
    renderLinesBox();
  }

  /* 저장된 분개를 화면 상태로 되돌린다. 쉬운 입력으로 표현되지 않으면 줄 입력으로 연다. */
  function stateFromVoucher(v) {
    const type = v?.voucherType || 'expense';
    const state = { type, rows: [newRow()], manual: [newManual(), newManual()], pay: roleAccount('cash_default')?.code || '' };
    const lines = v?.lines || [];
    if (!lines.length) {
      const account = accountOf(v?.accountCode || v?.account_code || '');
      state.type = account?.kind === 'revenue' ? 'income' : 'expense';
      const leaf = account && !account.hasChildren ? account.code : '';
      state.rows = [{ ...newRow(), accountCode: leaf, amount: Number(v?.amount) || 0, functionCode: account?.defaultFunction || '' }];
      /* 통장 거래 없이 만들어진 기존 전표는 서버 기본 분개와 같게 미지급금으로 연다 */
      if (v && state.type === 'expense' && !v.bankTxnId) state.pay = roleAccount('payable_default')?.code || state.pay;
      return state;
    }
    const counterSide = type === 'expense' ? 'credit' : 'debit';
    const counters = lines.filter(l => l[counterSide] > 0);
    const body = lines.filter(l => !(l[counterSide] > 0));
    const wantedKind = type === 'expense' ? 'expense' : 'revenue';
    const simple = (type === 'expense' || type === 'income') && counters.length === 1
      && body.length > 0 && body.every(l => accountOf(l.accountCode)?.kind === wantedKind);
    if (simple) {
      state.pay = counters[0].accountCode;
      state.rows = body.map(l => ({
        accountCode: l.accountCode, amount: l.debit || l.credit, functionCode: l.functionCode || '',
        programId: l.programId || '', fundId: l.fundId || '',
      }));
      return state;
    }
    state.type = type === 'expense' || type === 'income' ? 'transfer' : type;
    state.manual = lines.map(l => ({
      accountCode: l.accountCode, debit: l.debit, credit: l.credit, functionCode: l.functionCode || '',
      programId: l.programId || '', fundId: l.fundId || '',
    }));
    return state;
  }

  function openVoucherModal(voucherId, prefill) {
    const modal = document.getElementById('vcAddModal');
    if (!modal) return;
    const titleEl = document.getElementById('vcAddModalTitle');
    if (titleEl) titleEl.textContent = voucherId ? '전표 수정' : '전표 작성';
    document.getElementById('vcEditId').value = voucherId || '';
    document.getElementById('vcAddError').style.display = 'none';

    /* 폼 초기화 */
    const today = todayKST();
    document.getElementById('vcDate').value          = prefill?.voucher_date || prefill?.voucherDate || today;
    document.getElementById('vcSubAccount').value    = prefill?.sub_account  || prefill?.subAccount  || '';
    document.getElementById('vcDescription').value   = prefill?.description || '';
    document.getElementById('vcPayeeName').value     = prefill?.payee_name || prefill?.payeeName || '';
    document.getElementById('vcEvidenceType').value  = prefill?.evidence_type || prefill?.evidenceType || 'none';
    document.getElementById('vcEvidenceNumber').value= prefill?.evidence_number || prefill?.evidenceNumber || '';
    document.getElementById('vcBudgetLineId').value  = prefill?.budget_line_id || prefill?.budgetLineId || '';
    /* 반복 템플릿 — 템플릿 불러오기(prefill)면 자동 생성 설정도 복원 */
    const fromTemplate = !!(prefill && (prefill.is_template || prefill.isTemplate));
    const recActive = !!(prefill?.recurring_active ?? prefill?.recurringActive);
    const recDay    = prefill?.recurring_day ?? prefill?.recurringDay;
    document.getElementById('vcIsTemplate').checked  = false;
    document.getElementById('vcTemplateName').value  = fromTemplate ? (prefill.template_name || prefill.templateName || '') : '';
    document.getElementById('vcTemplateNameRow').style.display = 'none';
    document.getElementById('vcRecurringActive').checked = recActive;
    document.getElementById('vcRecurringDay').value  = (recDay != null ? String(recDay) : '1');
    document.getElementById('vcRecurringDayRow').style.display = recActive ? 'flex' : 'none';

    vc = stateFromVoucher(prefill || null);
    renderTypeBar();
    renderLinesBox();
    modal.style.display = 'flex';
  }

  function closeVoucherModal() {
    const modal = document.getElementById('vcAddModal');
    if (modal) modal.style.display = 'none';
  }

  /* ── 예산 잠금: 선택 예산 항목 가용액 표시 + 초과 경고 ── */
  function renderBudgetAvail() {
    const box = document.getElementById('vcBudgetAvail');
    if (!box) return;
    const lid = document.getElementById('vcBudgetLineId')?.value || '';
    const info = budgetAvailMap[String(lid)];
    if (!lid || !info) {
      box.style.display = 'none';
      return;
    }
    const amount = linesTotal();
    /* 현재 입력 금액 반영: 이 전표가 제출되면 available − amount */
    const afterAvail = info.available - amount;
    const over = afterAvail < 0;

    box.style.display = '';
    box.style.background = over ? '#fef2f2' : '#f0fdf4';
    box.style.color      = over ? 'var(--danger)' : '#15803d';
    box.style.border     = '1px solid ' + (over ? '#fecaca' : '#bbf7d0');
    box.innerHTML = `
      편성 ${fmtKRW(info.planned)} ·
      예약 ${fmtKRW(info.reserved)} ·
      집행 ${fmtKRW(info.executed)} ·
      <strong>현재 가용 ${fmtKRW(info.available)}</strong>
      ${amount > 0
        ? `<br>이 전표 제출 시 가용액: <strong>${fmtKRW(afterAvail)}</strong>${over ? ' 예산 초과 (제출·승인은 가능하나 검토 필요)' : ''}`
        : ''}`;
  }

  /* ── 전표 상세 로드 후 수정 모달 열기 ── */
  async function editVoucher(id) {
    const res = await api('GET', `/api/admin-voucher-detail?id=${id}`);
    if (!res.ok) { alert('조회 실패: ' + (res.data?.error || res.error || '')); return; }
    const v = res.data?.data?.voucher || res.data?.voucher || res.data?.data || res.data;
    openVoucherModal(id, v);
  }

  /* ── 전표 저장 (draft) ── */
  function showModalError(res, prefix) {
    const errEl = document.getElementById('vcAddError');
    const missing = res.data?.missing || [];
    errEl.innerHTML = escapeHtml(prefix + (res.data?.error || res.error || ''))
      + (missing.length ? '<ul style="margin:6px 0 0 18px">' + missing.map(m => `<li>${escapeHtml(m)}</li>`).join('') + '</ul>' : '')
      + (res.data?.detail ? '<div style="font-size:12px;margin-top:4px">' + escapeHtml(res.data.detail) + '</div>' : '');
    errEl.style.display = '';
  }

  async function saveVoucherDraft(submitAfter) {
    const errEl  = document.getElementById('vcAddError');
    errEl.style.display = 'none';

    const editId      = document.getElementById('vcEditId').value;
    const date        = document.getElementById('vcDate').value;
    const description = document.getElementById('vcDescription').value.trim();
    const subAccount  = document.getElementById('vcSubAccount').value.trim();
    const payeeName   = document.getElementById('vcPayeeName').value.trim();
    const evidenceType= document.getElementById('vcEvidenceType').value;
    const evidenceNumber = document.getElementById('vcEvidenceNumber').value.trim();
    const budgetLineId= document.getElementById('vcBudgetLineId').value;
    const isTemplate  = document.getElementById('vcIsTemplate').checked;
    const templateName= document.getElementById('vcTemplateName').value.trim();
    const recurringActive = document.getElementById('vcRecurringActive').checked;
    const recurringDay    = parseInt(document.getElementById('vcRecurringDay').value);
    const lines = buildLines();

    if (!date || !description) {
      errEl.textContent = '날짜와 적요는 필수입니다.';
      errEl.style.display = '';
      return;
    }
    if (!lines.length) {
      errEl.textContent = '계정과 금액을 입력해 주세요.';
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
      voucherType:    vc.type,
      lines,
      subAccount:     subAccount || undefined,
      description,
      payeeName:      payeeName  || undefined,
      evidenceType,
      evidenceNumber: evidenceNumber || undefined,
      budgetLineId:   budgetLineId ? parseInt(budgetLineId) : undefined,
      isTemplate,
      templateName:   isTemplate ? templateName : undefined,
      recurringActive: isTemplate ? recurringActive : undefined,
      recurringDay:    isTemplate && recurringActive ? recurringDay : undefined,
    };

    let res;
    if (editId) {
      res = await api('PUT', '/api/admin-voucher-update', { id: parseInt(editId), ...body });
    } else {
      res = await api('POST', '/api/admin-voucher-create', body);
    }

    if (!res.ok) {
      showModalError(res, '저장 실패: ');
      return;
    }

    /* 반복 템플릿 자동 생성 주기 — 생성된 전표/템플릿 id로 별도 설정 (B: admin-voucher-template-update) */
    if (isTemplate) {
      const savedId = editId
        ? parseInt(editId)
        : (res.data?.data?.id || res.data?.id || res.data?.data?.voucherId || res.data?.voucherId);
      if (savedId) {
        await api('PUT', '/api/admin-voucher-template-update', {
          id: savedId,
          recurringActive,
          recurringDay: recurringActive ? recurringDay : null,
        });
      }
    }

    /* 저장 후 제출: 빠진 항목이 있으면 창을 닫지 않고 알려 준다 */
    const savedVoucherId = editId
      ? parseInt(editId)
      : (res.data?.data?.voucherId || res.data?.data?.id || res.data?.voucherId);
    if (submitAfter && !isTemplate && savedVoucherId) {
      const sub = await api('POST', '/api/admin-voucher-submit', { id: savedVoucherId });
      if (!sub.ok) {
        document.getElementById('vcEditId').value = savedVoucherId;
        document.getElementById('vcAddModalTitle').textContent = '전표 수정';
        showModalError(sub, '저장은 되었지만 제출하지 못했습니다: ');
        loadVoucherList();
        return;
      }
    }

    closeVoucherModal();
    await loadTemplates();
    /* 템플릿 드롭다운 갱신 */
    const tplSel = document.getElementById('vcTemplateSelect');
    if (tplSel) {
      tplSel.innerHTML = `<option value="">템플릿 불러오기…</option>` +
        templates.map(t => `<option value="${t.id}">${templateOptionLabel(t)}</option>`).join('');
    }
    loadVoucherList();
  }

  const failText = res => [res.data?.error || res.error || '', ...(res.data?.missing || [])].join('\n');

  /* ── 전표 제출 ── */
  async function submitVoucher(id) {
    if (!confirm('전표를 제출하시겠습니까? 제출 후 승인 담당자에게 알림이 전송됩니다.')) return;
    const res = await api('POST', '/api/admin-voucher-submit', { id });
    if (!res.ok) { alert('제출 실패: ' + failText(res)); return; }
    loadVoucherList();
  }

  /* ── 전표 승인 ── */
  async function approveVoucher(id) {
    if (!confirm('전표를 승인하시겠습니까?')) return;
    // BUG-020 fix: admin-voucher-approve는 { id, action } 필수 — action 누락 시 400
    const res = await api('POST', '/api/admin-voucher-approve', { id, action: 'approve' });
    if (!res.ok) { alert('승인 실패: ' + failText(res)); return; }
    loadVoucherList();
  }

  /* ── 전표 보기: 분개·이력·취소 ── */
  async function openView(id) {
    const res = await api('GET', `/api/admin-voucher-detail?id=${id}`);
    if (!res.ok) { alert('전표 조회 실패: ' + (res.data?.error || res.error || '')); return; }
    const v = res.data?.data?.voucher || res.data?.voucher;
    if (!v) return;
    viewingId = id;
    document.getElementById('vcViewTitle').textContent = `전표 ${v.voucherNumber}`;
    const lines = v.lines || [];
    const history = v.history || [];
    document.getElementById('vcViewBody').innerHTML = `
      <div style="display:grid;grid-template-columns:90px 1fr 90px 1fr;gap:6px 10px;font-size:13px;margin-bottom:12px">
        <span style="color:var(--text-3)">날짜</span><span>${escapeHtml(fmtDate(v.voucherDate))}</span>
        <span style="color:var(--text-3)">구분</span><span>${escapeHtml(TYPE_LABEL[v.voucherType] || v.voucherType || '')}</span>
        <span style="color:var(--text-3)">적요</span><span style="grid-column:2/-1">${escapeHtml(v.description || '')}</span>
        <span style="color:var(--text-3)">거래처</span><span>${escapeHtml(v.payeeName || '—')}</span>
        ${v.sourceType ? `<span style="color:var(--text-3)">자동 전표</span><span>${escapeHtml(SOURCE_LABEL[v.sourceType] || v.sourceType)} #${escapeHtml(String(v.sourceId || '').split(':')[0])}</span>` : ''}
        <span style="color:var(--text-3)">상태</span><span>${escapeHtml(voucherStatusLabel(v.status))}${v.reversedById ? ' · 취소됨' : ''}</span>
      </div>
      ${lines.length ? `<table class="data-table" style="width:100%">
        <thead><tr><th>계정과목</th><th>활동</th><th>사업</th><th>재원</th><th class="num">차변</th><th class="num">대변</th></tr></thead>
        <tbody>${lines.map(l => `<tr>
          <td>${escapeHtml(l.accountName || l.accountCode)}</td>
          <td>${escapeHtml(FN_LABEL[l.functionCode] || '')}</td>
          <td>${escapeHtml(l.programName || '')}</td>
          <td>${escapeHtml(l.fundName || '')}</td>
          <td class="num">${l.debit ? fmtKRW(l.debit) : ''}</td>
          <td class="num">${l.credit ? fmtKRW(l.credit) : ''}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div style="color:var(--text-3);font-size:13px">분개가 없습니다. 제출할 때 기본 분개가 만들어집니다.</div>'}
      ${v.rejectionReason ? `<div style="margin-top:10px;color:var(--danger);font-size:13px">반려 사유: ${escapeHtml(v.rejectionReason)}</div>` : ''}
      ${history.length ? `<div style="margin-top:14px;font-size:13px;font-weight:600">처리 이력</div>
        <div style="font-size:12px;color:var(--text-2);margin-top:4px">${history.map(h =>
          `<div>${escapeHtml(h.at || '')} · ${escapeHtml(HISTORY_LABEL[h.action] || h.action)} · ${escapeHtml(h.actorName || '')}${h.reason ? ' · ' + escapeHtml(h.reason) : ''}</div>`).join('')}</div>` : ''}
      <div id="vcReverseBox"></div>`;

    const canReverse = isSuperAdmin() && v.status === 'approved' && !v.reversedById && v.voucherType !== 'reversal';
    document.getElementById('vcViewFoot').innerHTML = `
      ${canReverse ? '<button class="btn-sm btn-sm-danger" type="button" id="vcReverseOpenBtn">반대 전표로 취소</button>' : ''}
      <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_VOUCHER.printVoucher(${id})">인쇄</button>`;
    document.getElementById('vcReverseOpenBtn')?.addEventListener('click', openReverseForm);
    document.getElementById('vcViewModal').style.display = 'flex';
  }

  function closeView() {
    const modal = document.getElementById('vcViewModal');
    if (modal) modal.style.display = 'none';
    viewingId = null;
  }

  function openReverseForm() {
    const box = document.getElementById('vcReverseBox');
    if (!box) return;
    box.innerHTML = `
      <div style="margin-top:14px;border:1px solid var(--border);border-radius:6px;padding:12px">
        <div style="font-size:13px;margin-bottom:8px">승인된 전표는 지우지 않고 반대 전표를 만들어 취소합니다. 원래 전표는 그대로 남습니다.</div>
        <label class="form-label">취소일</label>
        <input type="date" id="vcReverseDate" class="input" value="${todayKST()}" style="max-width:200px">
        <label class="form-label" style="margin-top:8px">사유 <span style="color:var(--danger)">*</span></label>
        <input type="text" id="vcReverseReason" class="input" placeholder="취소 사유">
        <div id="vcReverseError" style="color:var(--danger);font-size:13px;margin-top:6px;display:none"></div>
        <button class="btn-sm btn-sm-danger" type="button" id="vcReverseSubmitBtn" style="margin-top:10px">취소 확정</button>
      </div>`;
    document.getElementById('vcReverseOpenBtn')?.remove();
    document.getElementById('vcReverseSubmitBtn')?.addEventListener('click', submitReverse);
  }

  async function submitReverse() {
    const err = document.getElementById('vcReverseError');
    const date = document.getElementById('vcReverseDate').value;
    const reason = document.getElementById('vcReverseReason').value.trim();
    if (!date || !reason) { err.textContent = '취소일과 사유를 입력해 주세요.'; err.style.display = ''; return; }
    const res = await api('POST', '/api/admin-voucher-reverse', { id: viewingId, date, reason });
    if (!res.ok) { err.textContent = failText(res); err.style.display = ''; return; }
    closeView();
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
     전표 인쇄 — 지출결의서 양식 (단건·일괄)
  ════════════════════════════════════════════════ */
  async function loadOrgName() {
    try {
      const res = await api('GET', '/api/admin/receipt-settings');
      const s = res?.data?.data?.settings || {};
      if (s.orgName) orgName = s.orgName;
    } catch { /* 기본값 유지 */ }
  }

  /* 단건 지출결의서 HTML (전표 상세 객체) */
  function voucherFormHtml(v) {
    const num   = v.voucher_number || v.voucherNumber || '';
    const date  = fmtDate(v.voucher_date || v.voucherDate);
    const acc   = (v.account_code || v.accountCode || '') + ' ' + (v.account_name || v.accountName || '');
    const sub   = v.sub_account || v.subAccount || '';
    const desc  = v.description || '';
    const payee = v.payee_name || v.payeeName || '';
    const amount= v.amount;
    const ev    = evidenceLabel(v.evidence_type || v.evidenceType);
    const evNo  = v.evidence_number || v.evidenceNumber || '';
    const budget= v.budget_line_name || v.budgetLineName ||
                  (v.budgetLine && (v.budgetLine.category_name || v.budgetLine.categoryName)) || '—';
    const lines = v.lines || [];
    const title = (v.voucherType || 'expense') === 'expense' ? '지 출 결 의 서' : '전 표';
    const linesHtml = lines.length ? `
        <table class="vc-form-table">
          <tr><th>계정과목</th><th>활동·사업·재원</th><th>차변</th><th>대변</th></tr>
          ${lines.map(l => `<tr>
            <td>${escapeHtml(l.accountName || l.accountCode)}</td>
            <td>${escapeHtml([FN_LABEL[l.functionCode], l.programName, l.fundName].filter(Boolean).join(' · ') || '—')}</td>
            <td style="text-align:right">${l.debit ? fmtKRW(l.debit) : ''}</td>
            <td style="text-align:right">${l.credit ? fmtKRW(l.credit) : ''}</td>
          </tr>`).join('')}
        </table>` : '';

    return `
      <div class="vc-form">
        <div class="vc-form-title">${title}</div>
        <div class="vc-form-org">${escapeHtml(orgName)}</div>
        <table class="vc-form-table">
          <tr>
            <th>전표번호</th><td>${escapeHtml(num)}</td>
            <th>작성일</th><td>${escapeHtml(date)}</td>
          </tr>
          <tr>
            <th>계정과목</th><td>${escapeHtml(acc.trim())}</td>
            <th>세목</th><td>${escapeHtml(sub || '—')}</td>
          </tr>
          <tr>
            <th>적요</th><td colspan="3">${escapeHtml(desc)}</td>
          </tr>
          <tr>
            <th>거래처</th><td>${escapeHtml(payee || '—')}</td>
            <th>예산</th><td>${escapeHtml(budget)}</td>
          </tr>
          <tr>
            <th>금액</th><td class="vc-form-amount">${fmtKRW(amount)}</td>
            <th>증빙</th><td>${escapeHtml(ev)}${evNo ? ' (' + escapeHtml(evNo) + ')' : ''}</td>
          </tr>
        </table>
        ${linesHtml}
        <table class="vc-form-sign">
          <tr>
            <th>작 성</th><th>검 토</th><th>승 인</th>
          </tr>
          <tr>
            <td class="vc-sign-cell"></td>
            <td class="vc-sign-cell"></td>
            <td class="vc-sign-cell"></td>
          </tr>
        </table>
        <div class="vc-form-foot">출력일시: ${(() => {
          const d = new Date(); const p = x => String(x).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        })()}</div>
      </div>`;
  }

  /* 인쇄 영역 채우고 window.print() */
  function doPrint(formsHtml) {
    let area = document.getElementById('vc-print-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'vc-print-area';
      document.body.appendChild(area);
    }
    area.innerHTML = formsHtml;
    document.body.classList.add('vc-printing');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('vc-printing');
      area.innerHTML = '';
    }, 500);
  }

  /* 단건 인쇄 */
  async function printVoucher(id) {
    const res = await api('GET', `/api/admin-voucher-detail?id=${id}`);
    if (!res.ok) { alert('전표 조회 실패: ' + (res.data?.error || res.error || '')); return; }
    const v = res.data?.data?.voucher || res.data?.voucher || res.data?.data || res.data;
    if (!v) { alert('전표를 찾을 수 없습니다.'); return; }
    /* budgetLine 객체 병합 (상세 응답에 별도로 옴) */
    if (res.data?.data?.budgetLine) v.budgetLine = res.data.data.budgetLine;
    doPrint(voucherFormHtml(v));
  }

  /* 일괄 인쇄 — 선택된 전표 (현재 페이지 목록 기준, 상세 재조회) */
  async function printSelectedVouchers() {
    const ids = Array.from(document.querySelectorAll('.vc-row-check:checked')).map(cb => parseInt(cb.value));
    if (!ids.length) { alert('인쇄할 전표를 선택해 주세요.'); return; }
    if (ids.length > 50 && !confirm(`${ids.length}건을 인쇄합니다. 계속하시겠습니까?`)) return;

    const btn = document.getElementById('vcPrintSelectedBtn');
    if (btn) { btn.disabled = true; btn.textContent = '준비 중…'; }

    const forms = [];
    for (const id of ids) {
      const res = await api('GET', `/api/admin-voucher-detail?id=${id}`);
      if (!res.ok) continue;
      const v = res.data?.data?.voucher || res.data?.voucher || res.data?.data || res.data;
      if (!v) continue;
      if (res.data?.data?.budgetLine) v.budgetLine = res.data.data.budgetLine;
      forms.push(`<div class="vc-form-page">${voucherFormHtml(v)}</div>`);
    }

    if (btn) { btn.disabled = false; btn.textContent = '선택 일괄 인쇄'; }

    if (!forms.length) { alert('인쇄할 전표 정보를 불러오지 못했습니다.'); return; }
    doPrint(forms.join(''));
  }

  /* ════════════════════════════════════════════════
     외부 진입점: admin-expenses.js에서 호출
  ════════════════════════════════════════════════ */
  async function initVoucherTab(container) {
    if (!container) return;
    await loadMyRole();
    await Promise.all([loadAccountCodes(), loadBudgetLines(), loadTemplates(), loadOrgName()]);
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
    printVoucher,
    printSelectedVouchers,
    openView,
  };
})();
