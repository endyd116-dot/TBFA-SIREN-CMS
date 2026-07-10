/* admin-other-revenues.js — Phase 22A: 후원 외 매출 관리 */
(function () {
  'use strict';

  /* ── 상태 ── */
  let currentYear    = new Date().getFullYear();
  let currentCat     = '';
  let currentStatus  = '';
  let categories     = [];   // 활성 카테고리 (드롭다운용)
  let allCategories  = [];   // 전체 카테고리 (관리 화면용 — 비활성 포함)
  let currentTab     = 'list'; // list | categories
  let currentPage    = 1;
  const PAGE_SIZE    = 20;
  let detailItem     = null;
  let editingCatId   = null;

  /* ── API 헬퍼 ── */
  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
  }

  /* ── 포맷 헬퍼 ── */
  function fmtKRW(n) {
    if (!n && n !== 0) return '—';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function fmtDate(s) {
    if (!s) return '—';
    return s.slice(0, 10);
  }
  function statusLabel(s) {
    return { draft: '초안', approved: '승인', rejected: '반려', refunded: '환불' }[s] || s;
  }
  function statusColor(s) {
    return { draft: '#6b7280', approved: 'var(--success)', rejected: 'var(--danger)', refunded: '#f59e0b' }[s] || '#6b7280';
  }
  function showErr(el, msg) { el.textContent = msg; el.style.display = 'block'; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 카테고리 로드 (전체 — 비활성 포함) ── */
  async function loadCategories() {
    const res = await api('GET', '/api/admin-revenue-categories-list?all=1');
    if (!res.ok) { console.warn('[other-revenues] 카테고리 조회 실패', res.error); return; }
    const payload = res.data?.data || res.data || {};
    const raw = payload.items || res.items || [];
    allCategories = Array.isArray(raw) ? raw : [];
    categories = allCategories.filter(c => c.isActive !== false);
  }

  /* 대분류 → 소분류 계층 순서로 정렬된 활성 카테고리 (드롭다운·필터 공용) */
  function hierarchicalCats() {
    const parents = categories.filter(c => !c.parentId);
    const parentIds = new Set(parents.map(p => p.id));
    const out = [];
    for (const p of parents) {
      out.push({ ...p, depth: 0 });
      categories.filter(c => c.parentId === p.id)
        .forEach(ch => out.push({ ...ch, depth: 1 }));
    }
    // 부모가 비활성이라 목록에 없는 소분류 — 평면으로 뒤에 노출
    categories.filter(c => c.parentId && !parentIds.has(c.parentId))
      .forEach(ch => out.push({ ...ch, depth: 0 }));
    return out;
  }

  /* 매출 등록·수정 모달용 카테고리 옵션 — 대·소분류 모두 선택 가능 */
  function buildCatOptions(selectedId) {
    return hierarchicalCats().map(c => {
      const sel = String(c.id) === String(selectedId) ? 'selected' : '';
      const label = c.depth === 1 ? '└ ' + escapeHtml(c.name) : escapeHtml(c.name);
      return `<option value="${c.id}" ${sel}>${label}</option>`;
    }).join('');
  }

  /* ── 목록 로드 ── */
  async function loadList() {
    const tbody = document.getElementById('orTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>';

    const pd = getPeriodQs('or');
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

    const res = await api('GET', '/api/admin-revenue-list?' + qs);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center">${res.data?.error || res.error || '조회 실패'}</td></tr>`;
      return;
    }

    const payload = res.data?.data || res.data || res;
    const items   = payload.items || [];
    /* summary는 서버가 주면 사용, 없으면 items에서 직접 집계 */
    const summary = payload.summary || computeSummary(items);

    renderSummary(summary);
    renderTable(items, tbody);
  }

  function computeSummary(items) {
    const totalAmount = items.reduce((a, i) => a + (i.amount || 0), 0);
    const totalRefund = items.reduce((a, i) => a + (i.refundAmount || 0), 0);
    return { totalAmount, totalRefund, netAmount: totalAmount - totalRefund };
  }

  function renderSummary(s) {
    const el = id => document.getElementById(id);
    if (el('orSumTotal'))  el('orSumTotal').textContent  = fmtKRW(s.totalAmount);
    if (el('orSumRefund')) el('orSumRefund').textContent = fmtKRW(s.totalRefund);
    if (el('orSumNet'))    el('orSumNet').textContent    = fmtKRW(s.netAmount);
  }

  function renderTable(items, tbody) {
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">내역이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(item => `
      <tr>
        <td>${item.fiscalYear}년</td>
        <td>${fmtDate(item.recognizedAt)}</td>
        <td>${item.categoryName || '—'}</td>
        <td>${item.payerName || '—'}</td>
        <td class="num">${fmtKRW(item.amount)}</td>
        <td class="num" style="color:${(item.refundAmount || 0) > 0 ? 'var(--danger)' : 'var(--text-3)'}">
          ${(item.refundAmount || 0) > 0 ? fmtKRW(item.refundAmount) : '—'}
        </td>
        <td><span style="color:${statusColor(item.status)};font-weight:600">${statusLabel(item.status)}</span></td>
        <td><button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.openDetail(${item.id})">상세</button></td>
      </tr>
    `).join('');
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
    const catOpts = `<option value="">전체 카테고리</option>` +
      hierarchicalCats().map(c =>
        `<option value="${c.id}">${c.depth === 1 ? '└ ' : ''}${escapeHtml(c.name)}</option>`
      ).join('');

    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">후원 외 매출 관리</div>
          <div class="p-actions">
            <button class="btn-sm btn-sm-ghost" id="orTabList" type="button">매출 내역</button>
            <button class="btn-sm btn-sm-ghost" id="orTabCat" type="button">카테고리 관리</button>
          </div>
        </div>

        <!-- ── 매출 내역 뷰 ── -->
        <div id="orViewList">
          <div class="p-actions" style="gap:8px;flex-wrap:wrap;margin-bottom:16px">
            ${periodSelectorHtml('or')}
            <select id="orCatSelect" class="input-sm" style="width:180px">${catOpts}</select>
            <select id="orStatusSelect" class="input-sm" style="width:100px">
              <option value="">전체 상태</option>
              <option value="draft">초안</option>
              <option value="approved">승인</option>
              <option value="rejected">반려</option>
              <option value="refunded">환불</option>
            </select>
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.load()">조회</button>
            <button class="btn-sm btn-sm-primary" onclick="window.SIREN_OTHER_REVENUES.openAdd()">+ 매출 추가</button>
          </div>

          <!-- 요약 KPI -->
          <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
            <div class="kpi"><div class="kpi-label">총 매출</div><div class="kpi-value" id="orSumTotal">—</div></div>
            <div class="kpi"><div class="kpi-label">환불 합계</div><div class="kpi-value" id="orSumRefund" style="color:var(--danger)">—</div></div>
            <div class="kpi"><div class="kpi-label">순 매출</div><div class="kpi-value" id="orSumNet">—</div></div>
          </div>

          <!-- 목록 테이블 -->
          <table class="data-table" style="width:100%">
            <thead>
              <tr>
                <th>회계연도</th><th>인식일</th><th>카테고리</th><th>납입자</th>
                <th class="num">매출액</th><th class="num">환불액</th><th>상태</th><th></th>
              </tr>
            </thead>
            <tbody id="orTbody">
              <tr><td colspan="8" style="text-align:center;color:var(--text-3)">조회 버튼을 눌러 데이터를 불러오세요.</td></tr>
            </tbody>
          </table>
        </div>

        <!-- ── 카테고리 관리 뷰 ── -->
        <div id="orViewCat" style="display:none">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <div style="font-size:13px;color:var(--text-2,#5b6577);flex:1">
              후원 외 매출 분류입니다. 대분류 아래 소분류를 둘 수 있고(2단계), 매출 등록 시 대·소분류 어디든 선택할 수 있습니다.
              비활성 처리하면 신규 등록 목록에서 숨겨집니다(기존 매출 기록은 유지). 기본 분류는 이름 변경·비활성이 제한됩니다.
            </div>
            <button class="btn-sm btn-sm-primary" type="button" id="orCatAddBtn">+ 카테고리 추가</button>
          </div>
          <div id="orCatList"></div>
        </div>
      </div>

      <!-- ── 카테고리 추가·수정 모달 ── -->
      <div id="orCatModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:440px">
          <div class="modal-head">
            <span class="modal-title" id="orCatModalTitle">카테고리 추가</span>
            <button class="modal-close" type="button" id="orCatCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="form-label">코드 <span style="color:var(--danger)">*</span></label>
              <input type="text" id="orCatCode" class="input" placeholder="예: corp_event (영문·숫자·밑줄 2~32자)">
              <div style="font-size:11.5px;color:var(--text-3,#94a0b3);margin-top:3px">
                코드는 추가 후 변경할 수 없습니다.
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">카테고리명 <span style="color:var(--danger)">*</span></label>
              <input type="text" id="orCatName" class="input" placeholder="예: 법인 행사 수익">
            </div>
            <div class="form-row">
              <label class="form-label">상위 분류</label>
              <select id="orCatParent" class="input">
                <option value="">— 대분류 (상위 없음) —</option>
              </select>
            </div>
            <div class="form-row">
              <label class="form-label">설명</label>
              <textarea id="orCatDesc" class="input" rows="2" placeholder="분류 설명 (선택)"></textarea>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-2,#5b6577)" id="orCatActiveRow">
              <input type="checkbox" id="orCatActive" checked> 활성 (비활성 시 신규 등록 목록에서 숨김)
            </label>
            <div id="orCatModalError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="orCatCancelBtn">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="orCatSaveBtn">저장</button>
          </div>
        </div>
      </div>

      <!-- ── 매출 추가 모달 ── -->
      <div id="orAddModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <span class="modal-title">매출 추가</span>
            <button class="modal-close" onclick="window.SIREN_OTHER_REVENUES.closeAdd()">×</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <label class="form-label">인식일 <span style="color:var(--danger)">*</span></label>
              <input type="date" id="orAddDate" class="input" style="width:160px">
            </div>
            <div class="form-row">
              <label class="form-label">카테고리 <span style="color:var(--danger)">*</span></label>
              <select id="orAddCat" class="input"></select>
            </div>
            <div class="form-row">
              <label class="form-label">금액 (원) <span style="color:var(--danger)">*</span></label>
              <input type="number" id="orAddAmount" class="input" min="0" placeholder="0">
            </div>
            <div class="form-row">
              <label class="form-label">납입자</label>
              <input type="text" id="orAddPayer" class="input" placeholder="기관명 또는 개인명">
            </div>
            <div class="form-row">
              <label class="form-label">비고</label>
              <textarea id="orAddDesc" class="input" rows="3" placeholder="상세 내용"></textarea>
            </div>
            <div class="form-row">
              <label class="form-label">증빙 파일</label>
              <input type="file" id="orAddFile" class="input" accept="image/*,.pdf">
              <div id="orAddFilePreview" style="margin-top:6px;font-size:12px;color:var(--text-3)"></div>
            </div>
            <div id="orAddError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.closeAdd()">취소</button>
            <button class="btn-sm btn-sm-primary" onclick="window.SIREN_OTHER_REVENUES.submitAdd()">저장 (초안)</button>
          </div>
        </div>
      </div>

      <!-- ── 상세/편집/승인/환불 모달 ── -->
      <div id="orDetailModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:560px">
          <div class="modal-head">
            <span class="modal-title">매출 상세</span>
            <button class="modal-close" onclick="window.SIREN_OTHER_REVENUES.closeDetail()">×</button>
          </div>
          <div class="modal-body" id="orDetailBody"></div>
          <div class="modal-foot" id="orDetailFoot"></div>
        </div>
      </div>

      <!-- ── 환불 등록 모달 ── -->
      <div id="orRefundModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:400px">
          <div class="modal-head">
            <span class="modal-title">환불 등록</span>
            <button class="modal-close" onclick="window.SIREN_OTHER_REVENUES.closeRefund()">×</button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:12px;color:var(--text-2)">환불 금액을 입력하세요. 등록 후 상태가 <strong>환불</strong>로 변경됩니다.</p>
            <div class="form-row">
              <label class="form-label">환불 금액 (원) <span style="color:var(--danger)">*</span></label>
              <input type="number" id="orRefundAmount" class="input" min="1" placeholder="0">
            </div>
            <div class="form-row">
              <label class="form-label">환불 사유</label>
              <textarea id="orRefundReason" class="input" rows="2" placeholder="사유 입력"></textarea>
            </div>
            <div id="orRefundError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.closeRefund()">취소</button>
            <button class="btn-sm btn-sm-danger" onclick="window.SIREN_OTHER_REVENUES.submitRefund()">환불 확정</button>
          </div>
        </div>
      </div>
    `;

    /* 필터 이벤트 (기간 선택기는 periodSelectorHtml 내부에서 자체 바인딩) */
    const orCatSel = document.getElementById('orCatSelect');
    if (orCatSel) orCatSel.addEventListener('change', e => { currentCat = e.target.value; currentPage = 1; loadList(); });
    const orStatusSel = document.getElementById('orStatusSelect');
    if (orStatusSel) orStatusSel.addEventListener('change', e => { currentStatus = e.target.value; currentPage = 1; loadList(); });

    /* 추가 모달 카테고리 */
    const addCat = document.getElementById('orAddCat');
    if (addCat) addCat.innerHTML = `<option value="">선택하세요</option>` + buildCatOptions('');

    /* 파일 미리보기 */
    document.getElementById('orAddFile').addEventListener('change', e => {
      const f = e.target.files[0];
      document.getElementById('orAddFilePreview').textContent =
        f ? `선택: ${f.name} (${(f.size / 1024).toFixed(1)} KB)` : '';
    });

    /* 탭 전환 */
    document.getElementById('orTabList')?.addEventListener('click', () => switchTab('list'));
    document.getElementById('orTabCat')?.addEventListener('click', () => switchTab('categories'));

    /* 카테고리 관리 */
    document.getElementById('orCatAddBtn')?.addEventListener('click', () => openCatModal(null));
    document.getElementById('orCatCloseBtn')?.addEventListener('click', closeCatModal);
    document.getElementById('orCatCancelBtn')?.addEventListener('click', closeCatModal);
    document.getElementById('orCatSaveBtn')?.addEventListener('click', saveCat);
  }

  /* ── 탭 전환 ── */
  function switchTab(tab) {
    currentTab = tab;
    const listView = document.getElementById('orViewList');
    const catView  = document.getElementById('orViewCat');
    const listBtn  = document.getElementById('orTabList');
    const catBtn   = document.getElementById('orTabCat');
    if (listView) listView.style.display = tab === 'list' ? '' : 'none';
    if (catView)  catView.style.display  = tab === 'categories' ? '' : 'none';
    if (listBtn)  listBtn.className = 'btn-sm ' + (tab === 'list' ? 'btn-sm-primary' : 'btn-sm-ghost');
    if (catBtn)   catBtn.className  = 'btn-sm ' + (tab === 'categories' ? 'btn-sm-primary' : 'btn-sm-ghost');
    if (tab === 'list') loadList();
    else loadCategoryAdmin();
  }

  /* ════════════════════════════════════════════════
     카테고리 관리 (대분류 → 소분류 2단계)
  ════════════════════════════════════════════════ */
  async function loadCategoryAdmin() {
    const el = document.getElementById('orCatList');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    await loadCategories();
    /* 매출 내역 화면의 필터/모달 드롭다운도 최신 카테고리로 동기화 */
    refreshCatDropdowns();
    renderCategoryAdmin(el);
  }

  /* 대분류 → 소분류 순서로 평탄화 (관리 화면용 — 비활성 포함) */
  function hierarchicalAllCats() {
    const parents = allCategories.filter(c => !c.parentId);
    const parentIds = new Set(parents.map(p => p.id));
    const out = [];
    for (const p of parents) {
      out.push({ ...p, depth: 0 });
      allCategories.filter(c => c.parentId === p.id)
        .forEach(ch => out.push({ ...ch, depth: 1 }));
    }
    allCategories.filter(c => c.parentId && !parentIds.has(c.parentId))
      .forEach(ch => out.push({ ...ch, depth: 0 }));
    return out;
  }

  function renderCategoryAdmin(el) {
    const ordered = hierarchicalAllCats();
    if (!ordered.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:16px;text-align:center">등록된 카테고리가 없습니다. "+ 카테고리 추가"로 등록하세요.</div>';
      return;
    }
    el.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>카테고리명</th><th style="width:130px">코드</th><th style="width:80px">구분</th>
            <th style="width:70px">상태</th><th style="width:80px">순서</th><th style="width:170px">액션</th>
          </tr>
        </thead>
        <tbody>
          ${ordered.map((c, i) => {
            const nameCell = c.depth === 1
              ? `<span style="color:var(--text-2,#5b6577)">└ ${escapeHtml(c.name)}</span>`
              : `<strong>${escapeHtml(c.name)}</strong>`;
            const kind = c.isSystem ? '<span style="color:#0369a1">기본</span>' : '사용자';
            const statusBadge = c.isActive
              ? '<span style="color:#15803d;font-weight:600">활성</span>'
              : '<span style="color:#94a0b3">비활성</span>';
            const addSub = c.depth === 0
              ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_OTHER_REVENUES.openCatSub(${c.id})">+소분류</button>`
              : '';
            const toggleBtn = c.isSystem
              ? ''
              : `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_OTHER_REVENUES.toggleCat(${c.id})">${c.isActive ? '비활성' : '활성'}</button>`;
            return `<tr style="${c.isActive ? '' : 'opacity:.55'}">
              <td>${nameCell}</td>
              <td style="font-family:monospace;color:var(--text-3,#94a0b3)">${escapeHtml(c.code)}</td>
              <td>${kind}</td>
              <td>${statusBadge}</td>
              <td style="white-space:nowrap">
                <button class="btn-sm btn-sm-ghost" type="button" ${i === 0 ? 'disabled' : ''} onclick="window.SIREN_OTHER_REVENUES.moveCat(${i},-1)" title="위로">▲</button>
                <button class="btn-sm btn-sm-ghost" type="button" ${i === ordered.length - 1 ? 'disabled' : ''} onclick="window.SIREN_OTHER_REVENUES.moveCat(${i},1)" title="아래로">▼</button>
              </td>
              <td style="white-space:nowrap">
                <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_OTHER_REVENUES.openCatEdit(${c.id})">수정</button>
                ${addSub}${toggleBtn}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /* 상위 분류 select 채우기 — 대분류만 후보로 */
  function fillCatParentSelect(selectedId) {
    const sel = document.getElementById('orCatParent');
    if (!sel) return;
    const parents = allCategories.filter(c => !c.parentId);
    sel.innerHTML = '<option value="">— 대분류 (상위 없음) —</option>'
      + parents.map(p =>
          `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
  }

  /* cat=null → 대분류 추가 / {parentId} → 소분류 추가 / cat 객체 → 수정 */
  function openCatModal(cat) {
    editingCatId = cat && cat.id ? cat.id : null;
    const isEdit = !!editingCatId;
    const modal   = document.getElementById('orCatModal');
    const title   = document.getElementById('orCatModalTitle');
    const codeEl  = document.getElementById('orCatCode');
    const nameEl  = document.getElementById('orCatName');
    const descEl  = document.getElementById('orCatDesc');
    const actEl   = document.getElementById('orCatActive');
    const actRow  = document.getElementById('orCatActiveRow');
    const errEl   = document.getElementById('orCatModalError');
    if (errEl) errEl.style.display = 'none';
    if (title) title.textContent = isEdit ? '카테고리 수정' : '카테고리 추가';
    if (codeEl) {
      codeEl.value = isEdit ? cat.code : '';
      codeEl.disabled = isEdit;  // 코드는 추가 후 변경 불가
    }
    if (nameEl) {
      nameEl.value = isEdit ? (cat.name || '') : '';
      nameEl.disabled = isEdit && cat.isSystem;  // 기본 분류 이름 변경 불가
    }
    if (descEl) descEl.value = isEdit ? (cat.description || '') : '';
    if (actEl)  actEl.checked = isEdit ? !!cat.isActive : true;
    /* 활성 체크박스: 추가 시·기본 분류는 숨김 */
    if (actRow) actRow.style.display = (isEdit && !cat.isSystem) ? 'flex' : 'none';
    fillCatParentSelect(cat ? cat.parentId : '');
    /* 기본 분류는 대분류 고정 — 상위 분류 선택 비활성 */
    const parentSel = document.getElementById('orCatParent');
    if (parentSel) parentSel.disabled = isEdit && cat.isSystem;
    if (modal) modal.style.display = 'flex';
  }

  function openCatEdit(id) {
    const c = allCategories.find(x => x.id === id);
    if (c) openCatModal(c);
  }

  /* 특정 대분류 아래 소분류 추가 — 모달을 추가 모드로 열고 상위 분류 미리 선택 */
  function openCatSub(parentId) {
    openCatModal(null);
    const parentSel = document.getElementById('orCatParent');
    if (parentSel) parentSel.value = String(parentId);
  }

  function closeCatModal() {
    const modal = document.getElementById('orCatModal');
    if (modal) modal.style.display = 'none';
    editingCatId = null;
  }

  async function saveCat() {
    const errEl = document.getElementById('orCatModalError');
    const show  = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
    const code     = document.getElementById('orCatCode')?.value.trim();
    const name     = document.getElementById('orCatName')?.value.trim();
    const desc     = document.getElementById('orCatDesc')?.value.trim();
    const parentId = document.getElementById('orCatParent')?.value || null;
    const isActive = document.getElementById('orCatActive')?.checked;
    if (!name) { show('카테고리명을 입력하세요.'); return; }
    let res;
    if (editingCatId) {
      res = await api('POST', '/api/admin-revenue-category-update', {
        id: editingCatId, name, description: desc,
        parentId: parentId ? Number(parentId) : null, isActive,
      });
    } else {
      if (!code || !/^[a-zA-Z0-9_]{2,32}$/.test(code)) {
        show('코드는 영문·숫자·밑줄 2~32자여야 합니다.'); return;
      }
      res = await api('POST', '/api/admin-revenue-category-create', {
        code, name, description: desc,
        parentId: parentId ? Number(parentId) : null,
      });
    }
    if (!res.ok) {
      show('저장 실패: ' + (res.data?.error || res.error || '')
        + (res.data?.detail ? ' — ' + res.data.detail : ''));
      return;
    }
    closeCatModal();
    await loadCategoryAdmin();
  }

  async function toggleCat(id) {
    const c = allCategories.find(x => x.id === id);
    if (!c) return;
    const next = !c.isActive;
    if (!confirm(`"${c.name}" 카테고리를 ${next ? '활성' : '비활성'} 처리하시겠습니까?`
      + (next ? '' : '\n비활성 시 신규 매출 등록 목록에서 숨겨집니다. 기존 매출 기록은 그대로 유지됩니다.'))) return;
    const res = await api('POST', '/api/admin-revenue-category-update', { id, isActive: next });
    if (!res.ok) { alert('상태 변경 실패: ' + (res.data?.error || res.error || '')); return; }
    await loadCategoryAdmin();
  }

  async function moveCat(index, dir) {
    const ordered = hierarchicalAllCats();
    const target = index + dir;
    if (target < 0 || target >= ordered.length) return;
    const arr = ordered.slice();
    const tmp = arr[index]; arr[index] = arr[target]; arr[target] = tmp;
    const res = await api('POST', '/api/admin-revenue-category-reorder', {
      orderedIds: arr.map(c => c.id),
    });
    if (!res.ok) { alert('순서 변경 실패: ' + (res.data?.error || res.error || '')); return; }
    await loadCategoryAdmin();
  }

  /* 카테고리 변경 후 매출 내역 화면의 필터·모달 드롭다운 동기화 */
  function refreshCatDropdowns() {
    const filterSel = document.getElementById('orCatSelect');
    if (filterSel) {
      const cur = filterSel.value;
      filterSel.innerHTML = `<option value="">전체 카테고리</option>` +
        hierarchicalCats().map(c =>
          `<option value="${c.id}">${c.depth === 1 ? '└ ' : ''}${escapeHtml(c.name)}</option>`
        ).join('');
      filterSel.value = cur;
    }
    const addCat = document.getElementById('orAddCat');
    if (addCat) addCat.innerHTML = `<option value="">선택하세요</option>` + buildCatOptions('');
  }

  /* ── 추가 모달 ── */
  function openAdd() {
    document.getElementById('orAddModal').style.display = 'flex';
    document.getElementById('orAddDate').value   = new Date().toISOString().slice(0, 10);
    document.getElementById('orAddAmount').value = '';
    document.getElementById('orAddPayer').value  = '';
    document.getElementById('orAddDesc').value   = '';
    document.getElementById('orAddFile').value   = '';
    document.getElementById('orAddFilePreview').textContent = '';
    document.getElementById('orAddError').style.display = 'none';
  }

  function closeAdd() {
    document.getElementById('orAddModal').style.display = 'none';
  }

  async function submitAdd() {
    const errEl  = document.getElementById('orAddError');
    const date   = document.getElementById('orAddDate').value;
    const catId  = document.getElementById('orAddCat').value;
    const amount = Number(document.getElementById('orAddAmount').value);
    const payer  = document.getElementById('orAddPayer').value.trim();
    const desc   = document.getElementById('orAddDesc').value.trim();
    const file   = document.getElementById('orAddFile').files[0];

    if (!date)              { showErr(errEl, '인식일을 선택하세요.');       return; }
    if (!catId)             { showErr(errEl, '카테고리를 선택하세요.');      return; }
    if (!amount || amount <= 0) { showErr(errEl, '금액을 올바르게 입력하세요.'); return; }
    errEl.style.display = 'none';

    let attachmentUrl = null;
    if (file) {
      attachmentUrl = await uploadFile(file, errEl);
      if (!attachmentUrl) return;
    }

    const res = await api('POST', '/api/admin-revenue-create', {
      fiscalYear:   new Date(date).getFullYear(),
      recognizedAt: date,
      categoryId:   Number(catId),
      amount,
      payerName:    payer   || undefined,
      description:  desc    || undefined,
    });
    if (!res.ok) { showErr(errEl, res.data?.error || res.error || '저장 실패'); return; }
    closeAdd();
    await loadList();
  }

  async function uploadFile(file, errEl) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('prefix', 'other-revenues');
    const res = await fetch('/api/r2-upload', { method: 'POST', credentials: 'include', body: formData })
      .then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
    if (!res.ok) { showErr(errEl, '파일 업로드 실패: ' + (res.error || '')); return null; }
    return res.data?.url || res.url || null;
  }

  /* ── 상세 모달 ── */
  async function openDetail(id) {
    /* 목록에서 먼저 찾고, 없으면 목록 재조회로 대체 (상세 전용 API 없음) */
    const tbody = document.getElementById('orTbody');
    let item = null;
    if (tbody) {
      /* 현재 렌더된 행에서 id 매칭 — fallback: 전체 목록 재요청 */
    }
    /* 목록 API로 단건 조회 */
    const res = await api('GET', `/api/admin-revenue-list?fiscalYear=${currentYear}&page=1&limit=200`);
    if (res.ok) {
      const payload = res.data?.data || res.data || res;
      item = (payload.items || []).find(i => i.id === id);
    }
    if (!item) { alert('내역을 찾을 수 없습니다.'); return; }
    detailItem = item;
    renderDetailModal(item);
    document.getElementById('orDetailModal').style.display = 'flex';
  }

  function renderDetailModal(item) {
    const body = document.getElementById('orDetailBody');
    const foot = document.getElementById('orDetailFoot');

    body.innerHTML = `
      <table class="data-table" style="width:100%">
        <tbody>
          <tr><td style="color:var(--text-3);width:110px">회계연도</td><td>${item.fiscalYear}년</td></tr>
          <tr><td style="color:var(--text-3)">인식일</td><td>${fmtDate(item.recognizedAt)}</td></tr>
          <tr><td style="color:var(--text-3)">카테고리</td><td>${item.categoryName || '—'}</td></tr>
          <tr><td style="color:var(--text-3)">납입자</td><td>${item.payerName || '—'}</td></tr>
          <tr><td style="color:var(--text-3)">매출액</td><td><strong>${fmtKRW(item.amount)}</strong></td></tr>
          <tr><td style="color:var(--text-3)">환불액</td>
            <td style="color:${(item.refundAmount || 0) > 0 ? 'var(--danger)' : 'var(--text-3)'}">
              ${(item.refundAmount || 0) > 0 ? fmtKRW(item.refundAmount) : '—'}
            </td></tr>
          <tr><td style="color:var(--text-3)">비고</td><td>${item.description || '—'}</td></tr>
          <tr><td style="color:var(--text-3)">상태</td>
            <td><span style="color:${statusColor(item.status)};font-weight:600">${statusLabel(item.status)}</span></td></tr>
          ${item.status === 'rejected' && item.rejectionReason ? `<tr><td style="color:var(--text-3)">반려 사유</td><td>${escapeHtml(item.rejectionReason)}</td></tr>` : ''}
          <tr><td style="color:var(--text-3)">등록일</td><td>${fmtDate(item.recordedAt)}</td></tr>
          <tr><td style="color:var(--text-3)">승인일</td><td>${item.approvedAt ? fmtDate(item.approvedAt) : '—'}</td></tr>
        </tbody>
      </table>
      ${item.status === 'draft' ? renderEditSection(item) : ''}
    `;

    let btns = `<button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.closeDetail()">닫기</button>`;
    if (item.status === 'draft') {
      btns += `<button class="btn-sm btn-sm-primary" onclick="window.SIREN_OTHER_REVENUES.submitEdit()">수정 저장</button>`;
      /* super_admin 여부는 서버가 최종 판정. 프론트에서는 항상 버튼 노출하고 서버가 거부. */
      btns += `<button class="btn-sm btn-sm-success" onclick="window.SIREN_OTHER_REVENUES.doApprove(${item.id},'approve')">승인</button>`;
      btns += `<button class="btn-sm btn-sm-danger"  onclick="window.SIREN_OTHER_REVENUES.doApprove(${item.id},'reject')">반려</button>`;
    }
    if (item.status === 'approved') {
      btns += `<button class="btn-sm btn-sm-danger" onclick="window.SIREN_OTHER_REVENUES.openRefund()">환불 등록</button>`;
    }
    foot.innerHTML = btns;
  }

  function renderEditSection(item) {
    return `
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-2)">초안 편집</div>
      <div class="form-row">
        <label class="form-label">인식일</label>
        <input type="date" id="orEditDate" class="input" style="width:160px" value="${item.recognizedAt ? item.recognizedAt.slice(0, 10) : ''}">
      </div>
      <div class="form-row">
        <label class="form-label">카테고리</label>
        <select id="orEditCat" class="input">${buildCatOptions(item.categoryId)}</select>
      </div>
      <div class="form-row">
        <label class="form-label">금액 (원)</label>
        <input type="number" id="orEditAmount" class="input" min="0" value="${item.amount}">
      </div>
      <div class="form-row">
        <label class="form-label">납입자</label>
        <input type="text" id="orEditPayer" class="input" value="${item.payerName || ''}">
      </div>
      <div class="form-row">
        <label class="form-label">비고</label>
        <textarea id="orEditDesc" class="input" rows="2">${item.description || ''}</textarea>
      </div>
    `;
  }

  function closeDetail() {
    document.getElementById('orDetailModal').style.display = 'none';
    detailItem = null;
  }

  async function submitEdit() {
    if (!detailItem) return;
    const date   = document.getElementById('orEditDate')?.value;
    const catId  = document.getElementById('orEditCat')?.value;
    const amount = Number(document.getElementById('orEditAmount')?.value);
    const payer  = document.getElementById('orEditPayer')?.value.trim();
    const desc   = document.getElementById('orEditDesc')?.value.trim();

    const res = await api('PUT', '/api/admin-revenue-update', {
      id:           detailItem.id,
      recognizedAt: date        || undefined,
      categoryId:   catId ? Number(catId) : undefined,
      amount:       amount || undefined,
      payerName:    payer  || undefined,
      description:  desc   || undefined,
    });
    if (!res.ok) { alert('수정 실패: ' + (res.data?.error || res.error || '')); return; }
    closeDetail();
    await loadList();
  }

  async function doApprove(id, action) {
    const label = action === 'approve' ? '승인' : '반려';
    if (!confirm(`이 매출을 ${label}하시겠습니까?`)) return;

    const body = { id, action };
    if (action === 'reject') {
      // AD-067: 서버가 반려 사유를 필수로 요구 — 지출 화면과 동일하게 필수 안내·검증
      const reason = prompt('반려 사유를 입력하세요 (필수)');
      if (!reason || !reason.trim()) { alert('반려 사유는 필수입니다.'); return; }
      body.rejectionReason = reason.trim();
    }

    const res = await api('POST', '/api/admin-revenue-approve', body);
    if (!res.ok) { alert(`${label} 실패: ` + (res.data?.error || res.error || '')); return; }
    closeDetail();
    await loadList();
  }

  /* ── 환불 모달 ── */
  function openRefund() {
    document.getElementById('orRefundAmount').value = '';
    document.getElementById('orRefundReason').value = '';
    document.getElementById('orRefundError').style.display = 'none';
    document.getElementById('orRefundModal').style.display = 'flex';
  }

  function closeRefund() {
    document.getElementById('orRefundModal').style.display = 'none';
  }

  async function submitRefund() {
    if (!detailItem) return;
    const errEl  = document.getElementById('orRefundError');
    const amount = Number(document.getElementById('orRefundAmount').value);

    if (!amount || amount <= 0) { showErr(errEl, '환불 금액을 입력하세요.'); return; }
    if (amount > detailItem.amount) { showErr(errEl, `매출액(${fmtKRW(detailItem.amount)})을 초과할 수 없습니다.`); return; }
    errEl.style.display = 'none';

    const res = await api('POST', '/api/admin-revenue-refund', {
      id:           detailItem.id,
      refundAmount: amount,
    });
    if (!res.ok) { showErr(errEl, res.data?.error || res.error || '환불 등록 실패'); return; }
    closeRefund();
    closeDetail();
    await loadList();
  }

  /* ── 초기화 / 재진입 통합 ──
     ★ 버그픽스 20260515-2차 (#9): 사전 로드(카테고리)가 실패해도 화면 골격은 반드시
        그린다. 예전엔 중간 단계가 throw하면 renderShell이 안 돌아 빈 섹션 = 빈 화면. */
  async function init() {
    const container = document.getElementById('adm-other-revenues') || document.getElementById('page-other-revenues');
    if (!container) return;
    if (!container.querySelector('.panel')) {
      try { await loadCategories(); }
      catch (e) { console.warn('[other-revenues] 카테고리 조회 실패', e); categories = categories || []; }
      try {
        renderShell(container);
        bindPeriodSelector('or', () => { currentPage = 1; loadList(); });
      } catch (e) {
        console.error('[other-revenues] 화면 구성 실패', e);
        container.innerHTML = `<div class="panel"><div style="color:var(--danger);padding:24px;text-align:center">후원 외 매출 화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.<br><small>${String(e?.message || e)}</small></div></div>`;
        return;
      }
    }
    try { switchTab(currentTab); }
    catch (e) { console.error('[other-revenues] 화면 갱신 실패', e); }
  }

  window.SIREN_OTHER_REVENUES = {
    init, load: init,
    openAdd, closeAdd, submitAdd,
    openDetail, closeDetail, submitEdit,
    doApprove,
    openRefund, closeRefund, submitRefund,
    openCatEdit, openCatSub, toggleCat, moveCat,
  };
})();
