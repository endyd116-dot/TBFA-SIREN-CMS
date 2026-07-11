/* admin-expenses.js — Phase 22C: 지출 관리 */
(function () {
  'use strict';

  /* ── Mock 데이터 (B 백엔드 머지 전까지 사용) ── */
  const USE_MOCK = false; /* B 머지 후 false 로 — 현 시점 백엔드 머지됨, 우선 false 시도 */

  const MOCK_CATEGORIES = [
    { id: 1, code: 'personnel',   name: '인건비',     description: '직원 급여·복리후생', isSystem: true,  sortOrder: 1, isActive: true },
    { id: 2, code: 'program',     name: '사업비',     description: '프로그램 운영비',     isSystem: true,  sortOrder: 2, isActive: true },
    { id: 3, code: 'admin_ops',   name: '관리운영비', description: '사무실·통신·소모품',   isSystem: true,  sortOrder: 3, isActive: true },
    { id: 4, code: 'fundraising', name: '모금비',     description: '캠페인·홍보 비용',     isSystem: true,  sortOrder: 4, isActive: true },
  ];

  const MOCK_LIST = {
    items: [
      { id: 1, fiscalYear: 2026, occurredAt: '2026-04-25', categoryId: 1, categoryCode: 'personnel',
        categoryName: '인건비', amount: 3500000, payeeName: '직원 급여', description: '4월 인건비',
        receiptUrl: null, status: 'approved', refundAmount: 0, netAmount: 3500000 },
      { id: 2, fiscalYear: 2026, occurredAt: '2026-04-10', categoryId: 3, categoryCode: 'admin_ops',
        categoryName: '관리운영비', amount: 450000, payeeName: 'KT', description: '인터넷·전화 요금',
        receiptUrl: null, status: 'approved', refundAmount: 0, netAmount: 450000 },
      { id: 3, fiscalYear: 2026, occurredAt: '2026-05-02', categoryId: 2, categoryCode: 'program',
        categoryName: '사업비', amount: 800000, payeeName: '인쇄소', description: '홍보물 제작',
        receiptUrl: null, status: 'draft', refundAmount: 0, netAmount: 800000 },
    ],
    total: 3, page: 1, limit: 30,
  };

  /* ── 상태 ── */
  let currentYear   = new Date().getFullYear();
  let currentCat    = '';
  let currentStatus = '';
  let currentTab    = 'list';
  let categories    = [];
  let currentPage   = 1;
  const PAGE_SIZE   = 30;
  let detailItem    = null;
  let myRole        = null;
  let anomalyMap    = {};   // { accountCode: { rate, current, prev } } — 이상 지출 패턴 배지

  /* ── API 헬퍼 ── */
  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }

  /* ── 포맷 헬퍼 ── */
  function fmtKRW(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
  function statusLabel(s) {
    return { draft: '임시저장', approved: '승인', rejected: '반려' }[s] || s;
  }
  function statusColor(s) {
    return { draft: '#6b7280', approved: 'var(--success)', rejected: 'var(--danger)' }[s] || '#6b7280';
  }
  function statusBgColor(s) {
    return { draft: '#f3f4f6', approved: '#d1fae5', rejected: '#fee2e2' }[s] || '#f3f4f6';
  }
  function showErr(el, msg) { if (el) { el.textContent = msg; el.style.display = 'block'; } }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  /* ── 카테고리 로드 ── */
  async function loadCategories() {
    if (USE_MOCK) { categories = MOCK_CATEGORIES.slice(); return; }
    const res = await api('GET', '/api/admin-expense-categories-list');
    if (!res.ok) {
      console.warn('[expenses] 카테고리 조회 실패, mock 폴백', res.error);
      categories = MOCK_CATEGORIES.slice();
      return;
    }
    const raw = res.data?.data?.data || res.data?.data || res.data || [];
    categories = Array.isArray(raw) ? raw : (raw.items || raw.categories || []);
  }

  function buildCatOptions(selectedId, includeBlank) {
    const opts = (categories.filter(c => c.isActive !== false)).map(c =>
      `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');
    return (includeBlank ? `<option value="">선택하세요</option>` : '') + opts;
  }

  /* ── 연도 옵션 ── */
  function buildYearOpts() {
    const ty = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => {
      const y = ty - i + 1;
      return `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}년</option>`;
    }).join('');
  }

  /* ── 기간 선택기 HTML ── */
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
      </div>
    `;
  }

  /* ── 기간 선택기 이벤트 바인딩 ── */
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

  /* ── 기간 파라미터 계산 ── */
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
      const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
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
    return { period, startDate, endDate,
      fiscalYear: startDate ? new Date(startDate).getFullYear() : today.getFullYear() };
  }

  /* ── 화면 골격 렌더 (최초 1회) ── */
  function renderShell(container) {
    const superTab = isSuperAdmin()
      ? `<button class="tab-btn" data-tab="categories" type="button">카테고리 설정</button>`
      : '';

    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">지출 관리</div>
        </div>

        <!-- 탭 -->
        <div class="tabs-bar" style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px">
          <button class="tab-btn active" data-tab="list" type="button">지출 내역</button>
          <button class="tab-btn" data-tab="voucher" type="button">전표</button>
          ${superTab}
        </div>

        <!-- 지출 내역 탭 -->
        <div id="expTabList" class="tab-pane">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
            ${periodSelectorHtml('exp')}
            <select id="expStatusSelect" class="input-sm" style="width:120px">
              <option value="">전체 상태</option>
              <option value="draft">임시저장</option>
              <option value="approved">승인</option>
              <option value="rejected">반려</option>
            </select>
            <select id="expCatSelect" class="input-sm" style="width:160px">
              <option value="">전체 카테고리</option>
              ${categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <button class="btn-sm btn-sm-ghost" id="expRefreshBtn" type="button">조회</button>
            <div style="flex:1"></div>
            <button class="btn-sm btn-sm-primary" id="expAddBtn" type="button">+ 지출 등록</button>
          </div>

          <!-- 요약 KPI -->
          <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
            <div class="kpi"><div class="kpi-label">총 지출</div><div class="kpi-value" id="expSumTotal">—</div></div>
            <div class="kpi"><div class="kpi-label">환불 합계</div><div class="kpi-value" id="expSumRefund" style="color:var(--danger)">—</div></div>
            <div class="kpi"><div class="kpi-label">순 지출</div><div class="kpi-value" id="expSumNet">—</div></div>
          </div>

          <!-- 목록 테이블 -->
          <table class="data-table" style="width:100%">
            <thead>
              <tr>
                <th>지출일</th><th>카테고리</th><th>지급처</th>
                <th class="num">금액</th><th class="num">환불액</th><th class="num">순금액</th>
                <th>상태</th><th></th>
              </tr>
            </thead>
            <tbody id="expTbody">
              <tr><td colspan="8" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 전표 탭 -->
        <div id="expTabVoucher" class="tab-pane" style="display:none">
          <div id="expVoucherContainer"></div>
        </div>

        <!-- 카테고리 설정 탭 (super_admin 전용) -->
        <div id="expTabCategories" class="tab-pane" style="display:none">
          <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
            <button class="btn-sm btn-sm-primary" id="expCatAddBtn" type="button">+ 카테고리 추가</button>
          </div>
          <div id="expCatList"></div>
        </div>
      </div>

      <!-- ── 지출 등록 모달 ── -->
      <div id="expAddModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:560px">
          <div class="modal-head">
            <span class="modal-title">지출 등록</span>
            <button class="modal-close" type="button" data-close="expAddModal">×</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="form-label">회계연도 <span style="color:var(--danger)">*</span></label>
              <input type="number" id="expAddYear" class="input" style="width:120px">
            </div>
            <div class="form-row">
              <label class="form-label">지출 발생일 <span style="color:var(--danger)">*</span></label>
              <input type="date" id="expAddDate" class="input" style="width:180px">
            </div>
            <div class="form-row">
              <label class="form-label">카테고리 <span style="color:var(--danger)">*</span></label>
              <select id="expAddCat" class="input"></select>
            </div>
            <div class="form-row">
              <label class="form-label">금액 (원) <span style="color:var(--danger)">*</span></label>
              <input type="number" id="expAddAmount" class="input" min="0" placeholder="0">
            </div>
            <div class="form-row">
              <label class="form-label">지급처</label>
              <input type="text" id="expAddPayee" class="input" placeholder="기관명 또는 개인명">
            </div>
            <div class="form-row">
              <label class="form-label">설명</label>
              <textarea id="expAddDesc" class="input" rows="3" placeholder="상세 내용"></textarea>
            </div>
            <div class="form-row">
              <label class="form-label">증빙서류 (영수증)</label>
              <input type="file" id="expAddFile" class="input" accept="image/*,.pdf">
              <div id="expAddFilePreview" style="margin-top:6px;font-size:12px;color:var(--text-3)"></div>
            </div>
            <div id="expAddError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" data-close="expAddModal">취소</button>
            <button class="btn-sm btn-sm-primary" id="expAddSubmit" type="button">저장 (임시저장)</button>
          </div>
        </div>
      </div>

      <!-- ── 상세/편집/승인/환불 모달 ── -->
      <div id="expDetailModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:600px">
          <div class="modal-head">
            <span class="modal-title">지출 상세</span>
            <button class="modal-close" type="button" data-close="expDetailModal">×</button>
          </div>
          <div class="modal-body" id="expDetailBody"></div>
          <div class="modal-foot" id="expDetailFoot"></div>
        </div>
      </div>

      <!-- ── 환불 등록 모달 ── -->
      <div id="expRefundModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:420px">
          <div class="modal-head">
            <span class="modal-title">환불 등록</span>
            <button class="modal-close" type="button" data-close="expRefundModal">×</button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:12px;color:var(--text-2)">환불·취소 금액을 입력하세요. 누적 환불액에 합산됩니다.</p>
            <div class="form-row">
              <label class="form-label">환불 금액 (원) <span style="color:var(--danger)">*</span></label>
              <input type="number" id="expRefundAmount" class="input" min="1" placeholder="0">
            </div>
            <div id="expRefundError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" data-close="expRefundModal">취소</button>
            <button class="btn-sm btn-sm-danger" id="expRefundSubmit" type="button">환불 확정</button>
          </div>
        </div>
      </div>

      <!-- ── 카테고리 추가/편집 모달 ── -->
      <div id="expCatModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:480px">
          <div class="modal-head">
            <span class="modal-title" id="expCatModalTitle">카테고리 추가</span>
            <button class="modal-close" type="button" data-close="expCatModal">×</button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="expCatId">
            <div class="form-row">
              <label class="form-label">코드 <span style="color:var(--danger)">*</span></label>
              <input type="text" id="expCatCode" class="input" placeholder="예: marketing">
              <div class="form-help" style="font-size:12px;color:var(--text-3);margin-top:4px">소문자·언더스코어만. 등록 후 변경 불가.</div>
            </div>
            <div class="form-row">
              <label class="form-label">이름 <span style="color:var(--danger)">*</span></label>
              <input type="text" id="expCatName" class="input" placeholder="예: 마케팅비">
            </div>
            <div class="form-row">
              <label class="form-label">설명</label>
              <textarea id="expCatDesc" class="input" rows="2"></textarea>
            </div>
            <div class="form-row">
              <label class="form-label">정렬 순서</label>
              <input type="number" id="expCatSort" class="input" min="0" value="100" style="width:120px">
            </div>
            <div class="form-row" id="expCatActiveRow">
              <label class="form-label"><input type="checkbox" id="expCatActive" checked> 활성</label>
            </div>
            <div id="expCatError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" data-close="expCatModal">취소</button>
            <button class="btn-sm btn-sm-primary" id="expCatSubmit" type="button">저장</button>
          </div>
        </div>
      </div>
    `;

    bindShellEvents(container);
  }

  function bindShellEvents(container) {
    /* 버그픽스 20260515-2차 (#10): renderShell HTML에 없는 요소를 querySelector 후
       null 체크 없이 addEventListener → "Cannot read properties of null" → renderShell
       전체 throw → 빈 화면. 모든 참조에 null 가드. (#expYearSelect는 기간 선택기로
       대체돼 더 이상 HTML에 없으므로 참조 제거 — 기간 필터는 bindPeriodSelector가 담당) */

    /* 탭 전환 */
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    /* 필터 */
    container.querySelector('#expCatSelect')?.addEventListener('change',    e => { currentCat    = e.target.value;         currentPage = 1; loadList(); });
    container.querySelector('#expStatusSelect')?.addEventListener('change', e => { currentStatus = e.target.value;         currentPage = 1; loadList(); });
    container.querySelector('#expRefreshBtn')?.addEventListener('click', () => loadList());

    /* 버튼 */
    container.querySelector('#expAddBtn')?.addEventListener('click', openAdd);
    container.querySelector('#expAddSubmit')?.addEventListener('click', submitAdd);
    container.querySelector('#expRefundSubmit')?.addEventListener('click', submitRefund);
    if (isSuperAdmin()) {
      container.querySelector('#expCatAddBtn')?.addEventListener('click', () => openCatModal(null));
      container.querySelector('#expCatSubmit')?.addEventListener('click', submitCat);
    }

    /* 모달 닫기 (data-close 패턴) */
    container.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', () => {
        const m = document.getElementById(b.dataset.close);
        if (m) m.style.display = 'none';
      });
    });

    /* 파일 미리보기 */
    container.querySelector('#expAddFile')?.addEventListener('change', e => {
      const f = e.target.files[0];
      const preview = container.querySelector('#expAddFilePreview');
      if (preview) preview.textContent =
        f ? `선택: ${f.name} (${(f.size / 1024).toFixed(1)} KB)` : '';
    });

    /* 등록 모달 내 카테고리·기본값 세팅 */
    const addCat = container.querySelector('#expAddCat');
    if (addCat) addCat.innerHTML = buildCatOptions('', true);
  }

  function switchTab(tab) {
    if (tab === 'categories' && !isSuperAdmin()) return;
    currentTab = tab;
    const container = document.getElementById('adm-expenses') || document.getElementById('page-expenses');
    document.querySelectorAll((container?.id ? '#' + container.id : '.adm-expenses-wrap') + ' .tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const list    = document.getElementById('expTabList');
    const voucher = document.getElementById('expTabVoucher');
    const cats    = document.getElementById('expTabCategories');
    if (list)    list.style.display    = tab === 'list'       ? '' : 'none';
    if (voucher) voucher.style.display = tab === 'voucher'    ? '' : 'none';
    if (cats)    cats.style.display    = tab === 'categories' ? '' : 'none';
    if (tab === 'categories') renderCategoryList();
    if (tab === 'voucher') {
      const vcContainer = document.getElementById('expVoucherContainer');
      if (vcContainer && !vcContainer.querySelector('table')) {
        /* 최초 진입 시 초기화 */
        if (window.SIREN_VOUCHER) {
          window.SIREN_VOUCHER.initVoucherTab(vcContainer);
        }
      }
    }
  }

  /* ── 목록 로드 ── */
  async function loadList() {
    const tbody = document.getElementById('expTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>';

    let items = [];

    if (USE_MOCK) {
      items = MOCK_LIST.items.filter(i =>
        (!currentCat    || String(i.categoryId) === String(currentCat)) &&
        (!currentStatus || i.status === currentStatus) &&
        (!currentYear   || i.fiscalYear === Number(currentYear))
      );
    } else {
      const pd = getPeriodQs('exp');
      const qs = new URLSearchParams({
        fiscalYear: pd.fiscalYear,
        page:       currentPage,
        limit:      PAGE_SIZE,
        period:     pd.period,
      });
      if (pd.startDate) qs.set('startDate', pd.startDate);
      if (pd.endDate)   qs.set('endDate',   pd.endDate);
      if (currentCat)    qs.set('categoryId', currentCat);
      if (currentStatus) qs.set('status',     currentStatus);

      const res = await api('GET', '/api/admin-expense-list?' + qs);
      if (!res.ok) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center">${escapeHtml(res.error || res.data?.error || '조회 실패')}</td></tr>`;
        return;
      }
      const payload = res.data?.data?.data || res.data?.data || res.data;
      items = payload?.items || payload?.data?.items || [];
    }

    await loadAnomaly();
    renderSummary(computeSummary(items));
    renderTable(items, tbody);
  }

  /* ── 이상 지출 패턴 (계정과목별 전월 대비 급증) ── */
  async function loadAnomaly() {
    if (USE_MOCK) { anomalyMap = {}; return; }
    const res = await api('GET', '/api/admin-finance-anomaly');
    if (!res.ok) { anomalyMap = {}; return; }
    const d = res.data?.data || res.data || {};
    const items = d.items || d.anomalies || (Array.isArray(d) ? d : []);
    anomalyMap = {};
    (items || []).forEach(it => {
      const code = it.accountCode || it.account_code || it.code;
      if (!code) return;
      anomalyMap[String(code)] = {
        rate:    it.increaseRate ?? it.increase_rate ?? it.rate ?? 0,
        current: it.currentAmount ?? it.current_amount ?? it.current ?? 0,
        prev:    it.prevAmount ?? it.prev_amount ?? it.previous ?? 0,
      };
    });
  }

  function anomalyBadge(code) {
    const a = anomalyMap[String(code)];
    if (!a) return '';
    const rate = Math.round(a.rate);
    return ` <span title="전월 대비 +${rate}% 급증" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;border:1px solid #fde68a">급증 +${rate}%</span>`;
  }

  function computeSummary(items) {
    const totalAmount = items.reduce((a, i) => a + Number(i.amount || 0), 0);
    const totalRefund = items.reduce((a, i) => a + Number(i.refundAmount || 0), 0);
    return { totalAmount, totalRefund, netAmount: totalAmount - totalRefund };
  }

  function renderSummary(s) {
    const el = id => document.getElementById(id);
    if (el('expSumTotal'))  el('expSumTotal').textContent  = fmtKRW(s.totalAmount);
    if (el('expSumRefund')) el('expSumRefund').textContent = fmtKRW(s.totalRefund);
    if (el('expSumNet'))    el('expSumNet').textContent    = fmtKRW(s.netAmount);
  }

  function renderTable(items, tbody) {
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">내역이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(item => `
      <tr>
        <td>${fmtDate(item.occurredAt)}</td>
        <td>${escapeHtml(item.categoryName || '—')}${anomalyBadge(item.categoryCode)}</td>
        <td>${escapeHtml(item.payeeName || '—')}</td>
        <td class="num">${fmtKRW(item.amount)}</td>
        <td class="num" style="color:${Number(item.refundAmount || 0) > 0 ? 'var(--danger)' : 'var(--text-3)'}">
          ${Number(item.refundAmount || 0) > 0 ? fmtKRW(item.refundAmount) : '—'}
        </td>
        <td class="num"><strong>${fmtKRW(item.netAmount != null ? item.netAmount : (Number(item.amount || 0) - Number(item.refundAmount || 0)))}</strong></td>
        <td>
          <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;
            background:${statusBgColor(item.status)};color:${statusColor(item.status)}">
            ${statusLabel(item.status)}
          </span>
        </td>
        <td><button class="btn-sm btn-sm-ghost" data-detail-id="${item.id}" type="button">상세</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-detail-id]').forEach(b => {
      b.addEventListener('click', () => openDetail(Number(b.dataset.detailId)));
    });
  }

  /* ── 등록 모달 ── */
  function openAdd() {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('expAddYear').value   = currentYear;
    document.getElementById('expAddDate').value   = today;
    document.getElementById('expAddCat').innerHTML = buildCatOptions('', true);
    document.getElementById('expAddAmount').value = '';
    document.getElementById('expAddPayee').value  = '';
    document.getElementById('expAddDesc').value   = '';
    document.getElementById('expAddFile').value   = '';
    document.getElementById('expAddFilePreview').textContent = '';
    document.getElementById('expAddError').style.display = 'none';
    document.getElementById('expAddModal').style.display = 'flex';
  }

  async function submitAdd() {
    const errEl  = document.getElementById('expAddError');
    const year   = Number(document.getElementById('expAddYear').value);
    const date   = document.getElementById('expAddDate').value;
    const catId  = document.getElementById('expAddCat').value;
    const amount = Number(document.getElementById('expAddAmount').value);
    const payee  = document.getElementById('expAddPayee').value.trim();
    const desc   = document.getElementById('expAddDesc').value.trim();
    const file   = document.getElementById('expAddFile').files[0];

    if (!year)                  { showErr(errEl, '회계연도를 입력하세요.');     return; }
    if (!date)                  { showErr(errEl, '지출일을 선택하세요.');       return; }
    if (!catId)                 { showErr(errEl, '카테고리를 선택하세요.');     return; }
    if (!amount || amount <= 0) { showErr(errEl, '금액을 올바르게 입력하세요.'); return; }
    errEl.style.display = 'none';

    let receiptUrl = null;
    if (file) {
      receiptUrl = await uploadReceipt(file, errEl);
      if (!receiptUrl) return;
    }

    if (USE_MOCK) {
      alert('Mock 모드: 등록은 백엔드 머지 후 가능합니다.');
      document.getElementById('expAddModal').style.display = 'none';
      return;
    }

    const res = await api('POST', '/api/admin-expense-create', {
      fiscalYear:  year,
      occurredAt:  date,
      categoryId:  Number(catId),
      amount,
      payeeName:   payee || undefined,
      description: desc  || undefined,
      receiptUrl:  receiptUrl || undefined,
    });
    if (!res.ok) { showErr(errEl, res.data?.error || res.error || '저장 실패'); return; }
    document.getElementById('expAddModal').style.display = 'none';
    await loadList();
  }

  /* ── R2 영수증 업로드 (presign → PUT) ── */
  async function uploadReceipt(file, errEl) {
    /* 1) presign 요청 */
    const pres = await api('POST', '/api/admin-expense-receipt-presign', {
      fileName:    file.name,
      contentType: file.type || 'application/octet-stream',
    });
    if (!pres.ok) { showErr(errEl, '업로드 URL 발급 실패: ' + (pres.data?.error || pres.error || '')); return null; }
    const payload = pres.data?.data || pres.data;
    const uploadUrl = payload?.uploadUrl;
    const fileUrl   = payload?.fileUrl;
    if (!uploadUrl || !fileUrl) { showErr(errEl, 'presign 응답에 uploadUrl/fileUrl 없음'); return null; }

    /* 2) R2로 PUT */
    try {
      const r = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!r.ok) { showErr(errEl, `R2 업로드 실패 (HTTP ${r.status})`); return null; }
    } catch (e) {
      showErr(errEl, 'R2 업로드 오류: ' + String(e));
      return null;
    }

    return fileUrl;
  }

  /* ── 상세 모달 ── */
  async function openDetail(id) {
    let item = null;

    if (USE_MOCK) {
      item = MOCK_LIST.items.find(i => i.id === id);
    } else {
      const qs = new URLSearchParams({ fiscalYear: currentYear, page: 1, limit: 200 });
      const res = await api('GET', '/api/admin-expense-list?' + qs);
      if (res.ok) {
        const payload = res.data?.data?.data || res.data?.data || res.data;
        const items = payload?.items || [];
        item = items.find(i => i.id === id);
      }
    }
    if (!item) { alert('내역을 찾을 수 없습니다.'); return; }
    detailItem = item;
    renderDetailModal(item);
    document.getElementById('expDetailModal').style.display = 'flex';
  }

  function renderDetailModal(item) {
    const body = document.getElementById('expDetailBody');
    const foot = document.getElementById('expDetailFoot');
    const netAmount = item.netAmount != null ? item.netAmount : (Number(item.amount || 0) - Number(item.refundAmount || 0));

    body.innerHTML = `
      <table class="data-table" style="width:100%">
        <tbody>
          <tr><td style="color:var(--text-3);width:110px">회계연도</td><td>${item.fiscalYear}년</td></tr>
          <tr><td style="color:var(--text-3)">지출일</td><td>${fmtDate(item.occurredAt)}</td></tr>
          <tr><td style="color:var(--text-3)">카테고리</td><td>${escapeHtml(item.categoryName || '—')}</td></tr>
          <tr><td style="color:var(--text-3)">지급처</td><td>${escapeHtml(item.payeeName || '—')}</td></tr>
          <tr><td style="color:var(--text-3)">금액</td><td><strong>${fmtKRW(item.amount)}</strong></td></tr>
          <tr><td style="color:var(--text-3)">환불 누적</td>
            <td style="color:${Number(item.refundAmount || 0) > 0 ? 'var(--danger)' : 'var(--text-3)'}">
              ${Number(item.refundAmount || 0) > 0 ? fmtKRW(item.refundAmount) : '—'}
            </td></tr>
          <tr><td style="color:var(--text-3)">순 금액</td><td><strong>${fmtKRW(netAmount)}</strong></td></tr>
          <tr><td style="color:var(--text-3)">설명</td><td>${escapeHtml(item.description || '—')}</td></tr>
          <tr><td style="color:var(--text-3)">영수증</td>
            <td>${item.receiptUrl ? `<a href="${escapeHtml(item.receiptUrl)}" target="_blank" rel="noopener">영수증 보기</a>` : '—'}</td></tr>
          <tr><td style="color:var(--text-3)">상태</td>
            <td><span style="color:${statusColor(item.status)};font-weight:600">${statusLabel(item.status)}</span></td></tr>
          <tr><td style="color:var(--text-3)">승인일</td><td>${item.approvedAt ? fmtDate(item.approvedAt) : '—'}</td></tr>
          ${item.rejectionReason ? `<tr><td style="color:var(--text-3)">반려 사유</td><td>${escapeHtml(item.rejectionReason)}</td></tr>` : ''}
        </tbody>
      </table>
      ${item.status === 'draft' ? renderEditSection(item) : ''}
    `;

    let btns = `<button class="btn-sm btn-sm-ghost" type="button" data-close="expDetailModal">닫기</button>`;
    if (item.status === 'draft') {
      btns += `<button class="btn-sm btn-sm-primary" id="expDetailSaveBtn" type="button">수정 저장</button>`;
      if (isSuperAdmin()) {
        btns += `<button class="btn-sm btn-sm-success" id="expDetailApproveBtn" type="button">승인</button>`;
        btns += `<button class="btn-sm btn-sm-danger"  id="expDetailRejectBtn"  type="button">반려</button>`;
      }
    }
    if (item.status === 'approved' && isSuperAdmin()) {
      btns += `<button class="btn-sm btn-sm-danger" id="expDetailRefundBtn" type="button">환불 등록</button>`;
    }
    foot.innerHTML = btns;

    /* 이벤트 바인딩 */
    foot.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', () => { document.getElementById(b.dataset.close).style.display = 'none'; });
    });
    const saveBtn    = foot.querySelector('#expDetailSaveBtn');
    const approveBtn = foot.querySelector('#expDetailApproveBtn');
    const rejectBtn  = foot.querySelector('#expDetailRejectBtn');
    const refundBtn  = foot.querySelector('#expDetailRefundBtn');
    if (saveBtn)    saveBtn.addEventListener('click', submitEdit);
    if (approveBtn) approveBtn.addEventListener('click', () => doApprove('approve'));
    if (rejectBtn)  rejectBtn.addEventListener('click',  () => doApprove('reject'));
    if (refundBtn)  refundBtn.addEventListener('click', openRefund);
  }

  function renderEditSection(item) {
    return `
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-2)">임시저장 항목 수정</div>
      <div class="form-row">
        <label class="form-label">지출일</label>
        <input type="date" id="expEditDate" class="input" style="width:180px" value="${item.occurredAt ? String(item.occurredAt).slice(0, 10) : ''}">
      </div>
      <div class="form-row">
        <label class="form-label">카테고리</label>
        <select id="expEditCat" class="input">${buildCatOptions(item.categoryId, false)}</select>
      </div>
      <div class="form-row">
        <label class="form-label">금액 (원)</label>
        <input type="number" id="expEditAmount" class="input" min="0" value="${item.amount}">
      </div>
      <div class="form-row">
        <label class="form-label">지급처</label>
        <input type="text" id="expEditPayee" class="input" value="${escapeHtml(item.payeeName || '')}">
      </div>
      <div class="form-row">
        <label class="form-label">설명</label>
        <textarea id="expEditDesc" class="input" rows="2">${escapeHtml(item.description || '')}</textarea>
      </div>
    `;
  }

  async function submitEdit() {
    if (!detailItem) return;
    const date   = document.getElementById('expEditDate')?.value;
    const catId  = document.getElementById('expEditCat')?.value;
    const amount = Number(document.getElementById('expEditAmount')?.value);
    const payee  = document.getElementById('expEditPayee')?.value.trim();
    const desc   = document.getElementById('expEditDesc')?.value.trim();

    if (USE_MOCK) { alert('Mock 모드: 수정은 백엔드 머지 후 가능'); return; }

    const res = await api('PUT', '/api/admin-expense-update', {
      id:          detailItem.id,
      occurredAt:  date          || undefined,
      categoryId:  catId ? Number(catId) : undefined,
      amount:      amount        || undefined,
      payeeName:   payee         || undefined,
      description: desc          || undefined,
    });
    if (!res.ok) { alert('수정 실패: ' + (res.data?.error || res.error || '')); return; }
    document.getElementById('expDetailModal').style.display = 'none';
    await loadList();
  }

  async function doApprove(action) {
    if (!detailItem) return;
    const label = action === 'approve' ? '승인' : '반려';
    if (!confirm(`이 지출을 ${label}하시겠습니까?`)) return;

    const body = { id: detailItem.id, action };
    if (action === 'reject') {
      const reason = prompt('반려 사유를 입력하세요 (필수)');
      if (!reason || !reason.trim()) { alert('반려 사유는 필수입니다.'); return; }
      body.rejectionReason = reason.trim();
    }

    if (USE_MOCK) { alert('Mock 모드: 백엔드 머지 후 가능'); return; }

    const res = await api('POST', '/api/admin-expense-approve', body);
    if (!res.ok) { alert(`${label} 실패: ` + (res.data?.error || res.error || '')); return; }
    document.getElementById('expDetailModal').style.display = 'none';
    await loadList();
  }

  /* ── 환불 모달 ── */
  function openRefund() {
    document.getElementById('expRefundAmount').value = '';
    document.getElementById('expRefundError').style.display = 'none';
    document.getElementById('expRefundModal').style.display = 'flex';
  }

  async function submitRefund() {
    if (!detailItem) return;
    const errEl  = document.getElementById('expRefundError');
    const amount = Number(document.getElementById('expRefundAmount').value);

    if (!amount || amount <= 0) { showErr(errEl, '환불 금액을 입력하세요.'); return; }
    const remaining = Number(detailItem.amount) - Number(detailItem.refundAmount || 0);
    if (amount > remaining) { showErr(errEl, `남은 금액(${fmtKRW(remaining)})을 초과할 수 없습니다.`); return; }
    errEl.style.display = 'none';

    if (USE_MOCK) { alert('Mock 모드: 백엔드 머지 후 가능'); return; }

    const res = await api('POST', '/api/admin-expense-refund', {
      id:           detailItem.id,
      refundAmount: amount,
    });
    if (!res.ok) { showErr(errEl, res.data?.error || res.error || '환불 등록 실패'); return; }
    document.getElementById('expRefundModal').style.display = 'none';
    document.getElementById('expDetailModal').style.display = 'none';
    await loadList();
  }

  /* ── 카테고리 설정 탭 ── */
  function renderCategoryList() {
    const wrap = document.getElementById('expCatList');
    if (!wrap) return;
    if (!categories.length) {
      wrap.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:30px">카테고리가 없습니다.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th style="width:120px">코드</th>
            <th>이름</th>
            <th>설명</th>
            <th class="num" style="width:80px">정렬</th>
            <th style="width:80px">상태</th>
            <th style="width:80px">유형</th>
            <th style="width:80px"></th>
          </tr>
        </thead>
        <tbody>
          ${categories.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(c => `
            <tr>
              <td><code>${escapeHtml(c.code)}</code></td>
              <td>${escapeHtml(c.name)}</td>
              <td style="color:var(--text-3)">${escapeHtml(c.description || '—')}</td>
              <td class="num">${c.sortOrder || 0}</td>
              <td>${c.isActive === false
                ? '<span style="color:var(--text-3)">비활성</span>'
                : '<span style="color:var(--success);font-weight:600">활성</span>'}</td>
              <td>${c.isSystem
                ? '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:#dbeafe;color:#1e40af;font-size:11px;font-weight:600">기본값</span>'
                : '<span style="color:var(--text-3);font-size:11px">사용자</span>'}</td>
              <td><button class="btn-sm btn-sm-ghost" data-cat-edit="${c.id}" type="button">편집</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll('[data-cat-edit]').forEach(b => {
      b.addEventListener('click', () => {
        const cat = categories.find(c => String(c.id) === b.dataset.catEdit);
        openCatModal(cat);
      });
    });
  }

  function openCatModal(cat) {
    const isEdit = !!cat;
    document.getElementById('expCatModalTitle').textContent = isEdit ? '카테고리 편집' : '카테고리 추가';
    document.getElementById('expCatId').value     = isEdit ? cat.id : '';
    document.getElementById('expCatCode').value   = isEdit ? cat.code : '';
    document.getElementById('expCatName').value   = isEdit ? cat.name : '';
    document.getElementById('expCatDesc').value   = isEdit ? (cat.description || '') : '';
    document.getElementById('expCatSort').value   = isEdit ? (cat.sortOrder || 0) : 100;
    document.getElementById('expCatActive').checked = isEdit ? (cat.isActive !== false) : true;
    document.getElementById('expCatError').style.display = 'none';

    /* isSystem=true 카테고리: code·name 잠금 */
    const codeInput = document.getElementById('expCatCode');
    const nameInput = document.getElementById('expCatName');
    if (isEdit && cat.isSystem) {
      codeInput.disabled = true;
      nameInput.disabled = true;
      codeInput.title = '시스템 기본 카테고리는 코드를 수정할 수 없습니다.';
      nameInput.title = '시스템 기본 카테고리는 이름을 수정할 수 없습니다.';
    } else if (isEdit) {
      codeInput.disabled = true; /* 등록 후 code 변경 불가 정책 */
      nameInput.disabled = false;
      codeInput.title = '등록 후 코드는 변경할 수 없습니다.';
      nameInput.title = '';
    } else {
      codeInput.disabled = false;
      nameInput.disabled = false;
      codeInput.title = '';
      nameInput.title = '';
    }

    document.getElementById('expCatModal').style.display = 'flex';
  }

  async function submitCat() {
    const errEl = document.getElementById('expCatError');
    const id    = document.getElementById('expCatId').value;
    const code  = document.getElementById('expCatCode').value.trim();
    const name  = document.getElementById('expCatName').value.trim();
    const desc  = document.getElementById('expCatDesc').value.trim();
    const sort  = Number(document.getElementById('expCatSort').value) || 0;
    const active = document.getElementById('expCatActive').checked;

    if (!id) {
      if (!code || !/^[a-z][a-z0-9_]*$/.test(code)) { showErr(errEl, '코드는 소문자·숫자·언더스코어만 (예: marketing)'); return; }
      if (!name) { showErr(errEl, '이름을 입력하세요.'); return; }
    } else {
      if (!name) { showErr(errEl, '이름을 입력하세요.'); return; }
    }
    errEl.style.display = 'none';

    if (USE_MOCK) { alert('Mock 모드: 백엔드 머지 후 가능'); return; }

    let res;
    if (id) {
      res = await api('PUT', '/api/admin-expense-category-update', {
        id:          Number(id),
        name:        name || undefined,
        description: desc || undefined,
        sortOrder:   sort,
        isActive:    active,
      });
    } else {
      res = await api('POST', '/api/admin-expense-category-create', {
        code,
        name,
        description: desc || undefined,
        sortOrder:   sort,
      });
    }
    if (!res.ok) { showErr(errEl, res.data?.error || res.error || '저장 실패'); return; }
    document.getElementById('expCatModal').style.display = 'none';
    await loadCategories();
    renderCategoryList();
    /* 메인 필터·등록 모달의 카테고리 옵션도 갱신 */
    const filterSel = document.getElementById('expCatSelect');
    if (filterSel) {
      const cur = filterSel.value;
      filterSel.innerHTML = `<option value="">전체 카테고리</option>` +
        categories.map(c => `<option value="${c.id}" ${String(c.id) === String(cur) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    }
  }

  /* ── 초기화 / 재진입 통합 ──
     버그픽스: 사전 로드(권한·카테고리)가 실패해도 화면 골격은 반드시 그린다.
        예전엔 중간 단계가 throw하면 renderShell이 안 돌아 빈 섹션 = 무한로딩. */
  async function init() {
    const container = document.getElementById('adm-expenses') || document.getElementById('page-expenses');
    if (!container) return;
    if (!container.querySelector('.panel')) {
      try { await loadMyRole(); }     catch (e) { console.warn('[expenses] 권한 조회 실패', e); myRole = myRole || 'admin'; }
      try { await loadCategories(); } catch (e) { console.warn('[expenses] 카테고리 조회 실패', e); categories = categories || []; }
      try {
        renderShell(container);
        bindPeriodSelector('exp', () => { currentPage = 1; loadList(); });
        const refreshBtn = document.getElementById('expRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => { currentPage = 1; loadList(); });
      } catch (e) {
        console.error('[expenses] 화면 구성 실패', e);
        container.innerHTML = `<div class="panel"><div style="color:var(--danger);padding:24px;text-align:center">지출 관리 화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.<br><small>${escapeHtml(String(e?.message || e))}</small></div></div>`;
        return;
      }
    }
    try { await loadList(); }
    catch (e) {
      console.error('[expenses] 목록 조회 실패', e);
      const tbody = document.getElementById('expTbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center">목록 조회 실패: ${escapeHtml(String(e?.message || e))}</td></tr>`;
    }
  }

  window.SIREN_EXPENSES = { init, load: init };
})();
