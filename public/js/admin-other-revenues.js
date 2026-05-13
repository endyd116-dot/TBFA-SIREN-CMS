/* admin-other-revenues.js — Phase 22A: 후원 외 매출 관리 */
(function () {
  'use strict';

  /* ── mock 데이터 (B 머지 전 사용) ── */
  const MOCK_REVENUE_CATEGORIES = [
    { id: 1, code: 'lecture',      name: '강연·교육 수익',                    sortOrder: 10,  isActive: true },
    { id: 2, code: 'govgrant',     name: '정부·지자체 지원금',                sortOrder: 20,  isActive: true },
    { id: 3, code: 'corp_sponsor', name: '기업 협찬·제휴 수익',               sortOrder: 30,  isActive: true },
    { id: 4, code: 'twork_on',     name: '함께워크_On (사업지원·자리대여)', sortOrder: 40,  isActive: true },
    { id: 5, code: 'twork_si',     name: '함께워크_SI (AI·AX·SI)',           sortOrder: 50,  isActive: true },
    { id: 6, code: 'etc',          name: '기타',                              sortOrder: 999, isActive: true },
  ];

  const MOCK_REVENUE_LIST = {
    items: [
      { id: 1, fiscalYear: 2026, recognizedAt: '2026-05-14', categoryId: 1, categoryName: '강연·교육 수익',
        amount: 500000, refundAmount: 0, payerName: '○○고등학교', description: '5월 교사 연수 강연료',
        status: 'draft', recordedAt: '2026-05-14T10:00:00Z', approvedAt: null },
      { id: 2, fiscalYear: 2026, recognizedAt: '2026-05-10', categoryId: 5, categoryName: '함께워크_SI (AI·AX·SI)',
        amount: 1500000, refundAmount: 0, payerName: '□□회사', description: 'AI 컨설팅',
        status: 'approved', recordedAt: '2026-05-10T14:00:00Z', approvedAt: '2026-05-11T09:00:00Z' },
      { id: 3, fiscalYear: 2026, recognizedAt: '2026-04-22', categoryId: 2, categoryName: '정부·지자체 지원금',
        amount: 5000000, refundAmount: 0, payerName: '서울특별시 교육청', description: '2026년 1차 사업비',
        status: 'approved', recordedAt: '2026-04-22T11:00:00Z', approvedAt: '2026-04-23T10:00:00Z' },
    ],
    total: 3,
    summary: { totalAmount: 7000000, totalRefund: 0, netAmount: 7000000 },
  };

  const USE_MOCK = true; // B 머지 후 false로 전환

  /* ── 상태 ── */
  let currentYear  = new Date().getFullYear();
  let currentCat   = '';
  let currentStatus = '';
  let categories   = [];
  let currentPage  = 1;
  const PAGE_SIZE  = 20;
  let detailItem   = null;

  /* ── 헬퍼 ── */
  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
  }

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

  function isSuperAdmin() {
    return document.body.dataset.role === 'super_admin';
  }

  /* ── 카테고리 로드 ── */
  async function loadCategories() {
    if (USE_MOCK) { categories = MOCK_REVENUE_CATEGORIES; return; }
    const res = await api('GET', '/api/admin-other-revenue-categories');
    categories = (res.data || res.items || []).filter(c => c.isActive);
  }

  /* ── 카테고리 select 옵션 ── */
  function buildCatOptions(selectedId) {
    return categories.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${c.name}</option>`
    ).join('');
  }

  /* ── 목록 로드 ── */
  async function loadList() {
    const tbody = document.getElementById('orTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">불러오는 중…</td></tr>';

    let items, summary;
    if (USE_MOCK) {
      let filtered = MOCK_REVENUE_LIST.items.filter(item => {
        if (currentYear && item.fiscalYear !== Number(currentYear)) return false;
        if (currentCat && String(item.categoryId) !== String(currentCat)) return false;
        if (currentStatus && item.status !== currentStatus) return false;
        return true;
      });
      items = filtered;
      const totalAmt = filtered.reduce((a, i) => a + i.amount, 0);
      const totalRef = filtered.reduce((a, i) => a + (i.refundAmount || 0), 0);
      summary = { totalAmount: totalAmt, totalRefund: totalRef, netAmount: totalAmt - totalRef };
    } else {
      let qs = `?year=${currentYear}&page=${currentPage}&limit=${PAGE_SIZE}`;
      if (currentCat)    qs += `&categoryId=${currentCat}`;
      if (currentStatus) qs += `&status=${currentStatus}`;
      const res = await api('GET', '/api/admin-other-revenues' + qs);
      if (!res.ok) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center">${res.error || '조회 실패'}</td></tr>`;
        return;
      }
      items   = (res.data || res).items || [];
      summary = (res.data || res).summary || {};
    }

    renderSummary(summary);
    renderTable(items, tbody);
  }

  function renderSummary(summary) {
    const el = id => document.getElementById(id);
    if (el('orSumTotal'))  el('orSumTotal').textContent  = fmtKRW(summary.totalAmount);
    if (el('orSumRefund')) el('orSumRefund').textContent = fmtKRW(summary.totalRefund);
    if (el('orSumNet'))    el('orSumNet').textContent    = fmtKRW(summary.netAmount);
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
        <td class="num" style="color:${item.refundAmount > 0 ? 'var(--danger)' : 'var(--text-3)'}">${item.refundAmount > 0 ? fmtKRW(item.refundAmount) : '—'}</td>
        <td><span style="color:${statusColor(item.status)};font-weight:600">${statusLabel(item.status)}</span></td>
        <td>
          <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.openDetail(${item.id})">상세</button>
        </td>
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

  /* ── 초기 HTML 렌더 ── */
  function renderShell(container) {
    const catOpts = `<option value="">전체 카테고리</option>` +
      categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">후원 외 매출 관리</div>
          <div class="p-actions" style="gap:8px">
            <select id="orYearSelect" class="input-sm" style="width:90px">${buildYearOpts()}</select>
            <select id="orCatSelect" class="input-sm" style="width:160px">${catOpts}</select>
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
        </div>

        <!-- 요약 박스 -->
        <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
          <div class="kpi"><div class="kpi-label">총 매출</div><div class="kpi-value" id="orSumTotal">—</div></div>
          <div class="kpi"><div class="kpi-label">환불 합계</div><div class="kpi-value" id="orSumRefund" style="color:var(--danger)">—</div></div>
          <div class="kpi"><div class="kpi-label">순 매출</div><div class="kpi-value" id="orSumNet">—</div></div>
        </div>

        <!-- 목록 테이블 -->
        <table class="data-table" style="width:100%">
          <thead>
            <tr>
              <th>회계연도</th>
              <th>인식일</th>
              <th>카테고리</th>
              <th>납입자</th>
              <th class="num">매출액</th>
              <th class="num">환불액</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="orTbody">
            <tr><td colspan="8" style="text-align:center;color:var(--text-3)">조회 버튼을 눌러 데이터를 불러오세요.</td></tr>
          </tbody>
        </table>
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
          <div class="modal-body" id="orDetailBody">
            <!-- 동적 렌더 -->
          </div>
          <div class="modal-foot" id="orDetailFoot">
            <!-- 동적 버튼 -->
          </div>
        </div>
      </div>

      <!-- ── 환불 등록 모달 (approved 상태에서만) ── -->
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

    /* 이벤트 바인딩 */
    document.getElementById('orYearSelect').addEventListener('change', e => { currentYear = Number(e.target.value); loadList(); });
    document.getElementById('orCatSelect').addEventListener('change',    e => { currentCat = e.target.value;         loadList(); });
    document.getElementById('orStatusSelect').addEventListener('change', e => { currentStatus = e.target.value;      loadList(); });

    /* 추가 모달 카테고리 채우기 */
    const addCat = document.getElementById('orAddCat');
    if (addCat) addCat.innerHTML = `<option value="">선택하세요</option>` + buildCatOptions('');

    /* 파일 선택 미리보기 */
    document.getElementById('orAddFile').addEventListener('change', e => {
      const f = e.target.files[0];
      document.getElementById('orAddFilePreview').textContent = f ? `선택: ${f.name} (${(f.size/1024).toFixed(1)} KB)` : '';
    });
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

    if (!date)   { showErr(errEl, '인식일을 선택하세요.'); return; }
    if (!catId)  { showErr(errEl, '카테고리를 선택하세요.'); return; }
    if (!amount || amount <= 0) { showErr(errEl, '금액을 올바르게 입력하세요.'); return; }

    errEl.style.display = 'none';

    let attachmentUrl = null;
    if (file) {
      attachmentUrl = await uploadFile(file, errEl);
      if (!attachmentUrl) return;
    }

    if (USE_MOCK) {
      const cat = categories.find(c => String(c.id) === String(catId));
      const newItem = {
        id: MOCK_REVENUE_LIST.items.length + 1,
        fiscalYear: new Date(date).getFullYear(),
        recognizedAt: date,
        categoryId: Number(catId),
        categoryName: cat ? cat.name : '—',
        amount,
        refundAmount: 0,
        payerName: payer,
        description: desc,
        status: 'draft',
        recordedAt: new Date().toISOString(),
        approvedAt: null,
      };
      MOCK_REVENUE_LIST.items.unshift(newItem);
      MOCK_REVENUE_LIST.total++;
      closeAdd();
      await loadList();
      return;
    }

    const res = await api('POST', '/api/admin-other-revenues', {
      recognizedAt: date, categoryId: Number(catId), amount, payerName: payer, description: desc, attachmentUrl,
    });
    if (!res.ok) { showErr(errEl, res.error || '저장 실패'); return; }
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
    return res.url || res.data?.url;
  }

  /* ── 상세 모달 ── */
  async function openDetail(id) {
    let item;
    if (USE_MOCK) {
      item = MOCK_REVENUE_LIST.items.find(i => i.id === id);
    } else {
      const res = await api('GET', `/api/admin-other-revenues/${id}`);
      if (!res.ok) { alert('조회 실패: ' + (res.error || '')); return; }
      item = res.data || res;
    }
    if (!item) { alert('내역을 찾을 수 없습니다.'); return; }
    detailItem = item;

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
          <tr><td style="color:var(--text-3)">환불액</td><td style="color:${item.refundAmount > 0 ? 'var(--danger)' : 'var(--text-3)'}">${item.refundAmount > 0 ? fmtKRW(item.refundAmount) : '—'}</td></tr>
          <tr><td style="color:var(--text-3)">비고</td><td>${item.description || '—'}</td></tr>
          <tr><td style="color:var(--text-3)">상태</td><td><span style="color:${statusColor(item.status)};font-weight:600">${statusLabel(item.status)}</span></td></tr>
          <tr><td style="color:var(--text-3)">등록일</td><td>${fmtDate(item.recordedAt)}</td></tr>
          <tr><td style="color:var(--text-3)">승인일</td><td>${item.approvedAt ? fmtDate(item.approvedAt) : '—'}</td></tr>
        </tbody>
      </table>
      ${item.status === 'draft' ? renderEditSection(item) : ''}
    `;

    /* 하단 버튼: 상태별 */
    let btns = `<button class="btn-sm btn-sm-ghost" onclick="window.SIREN_OTHER_REVENUES.closeDetail()">닫기</button>`;
    if (item.status === 'draft') {
      btns += `<button class="btn-sm btn-sm-primary" onclick="window.SIREN_OTHER_REVENUES.submitEdit()">수정 저장</button>`;
      if (isSuperAdmin()) {
        btns += `<button class="btn-sm btn-sm-success" onclick="window.SIREN_OTHER_REVENUES.approve(${item.id})">승인</button>`;
        btns += `<button class="btn-sm btn-sm-danger"  onclick="window.SIREN_OTHER_REVENUES.reject(${item.id})">반려</button>`;
      }
    }
    if (item.status === 'approved') {
      btns += `<button class="btn-sm btn-sm-danger" onclick="window.SIREN_OTHER_REVENUES.openRefund()">환불 등록</button>`;
    }
    foot.innerHTML = btns;

    document.getElementById('orDetailModal').style.display = 'flex';
  }

  function renderEditSection(item) {
    const catOpts = buildCatOptions(item.categoryId);
    return `
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-2)">✏️ 초안 편집</div>
      <div class="form-row">
        <label class="form-label">인식일</label>
        <input type="date" id="orEditDate" class="input" style="width:160px" value="${item.recognizedAt ? item.recognizedAt.slice(0,10) : ''}">
      </div>
      <div class="form-row">
        <label class="form-label">카테고리</label>
        <select id="orEditCat" class="input">${catOpts}</select>
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

    if (USE_MOCK) {
      const cat = categories.find(c => String(c.id) === String(catId));
      Object.assign(detailItem, {
        recognizedAt: date, categoryId: Number(catId),
        categoryName: cat ? cat.name : detailItem.categoryName,
        amount, payerName: payer, description: desc,
      });
      closeDetail();
      await loadList();
      return;
    }

    const res = await api('PATCH', `/api/admin-other-revenues/${detailItem.id}`, {
      recognizedAt: date, categoryId: Number(catId), amount, payerName: payer, description: desc,
    });
    if (!res.ok) { alert('수정 실패: ' + (res.error || '')); return; }
    closeDetail();
    await loadList();
  }

  async function approve(id) {
    if (!confirm('이 매출을 승인하시겠습니까?')) return;
    if (USE_MOCK) {
      const item = MOCK_REVENUE_LIST.items.find(i => i.id === id);
      if (item) { item.status = 'approved'; item.approvedAt = new Date().toISOString(); }
      closeDetail();
      await loadList();
      return;
    }
    const res = await api('POST', `/api/admin-other-revenues/${id}/approve`);
    if (!res.ok) { alert('승인 실패: ' + (res.error || '')); return; }
    closeDetail();
    await loadList();
  }

  async function reject(id) {
    if (!confirm('이 매출을 반려하시겠습니까?')) return;
    if (USE_MOCK) {
      const item = MOCK_REVENUE_LIST.items.find(i => i.id === id);
      if (item) { item.status = 'rejected'; }
      closeDetail();
      await loadList();
      return;
    }
    const res = await api('POST', `/api/admin-other-revenues/${id}/reject`);
    if (!res.ok) { alert('반려 실패: ' + (res.error || '')); return; }
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
    const reason = document.getElementById('orRefundReason').value.trim();

    if (!amount || amount <= 0) { showErr(errEl, '환불 금액을 입력하세요.'); return; }
    if (amount > detailItem.amount) { showErr(errEl, `매출액(${fmtKRW(detailItem.amount)})을 초과할 수 없습니다.`); return; }

    errEl.style.display = 'none';

    if (USE_MOCK) {
      detailItem.refundAmount = amount;
      detailItem.status = 'refunded';
      closeRefund();
      closeDetail();
      await loadList();
      return;
    }

    const res = await api('POST', `/api/admin-other-revenues/${detailItem.id}/refund`, { refundAmount: amount, reason });
    if (!res.ok) { showErr(errEl, res.error || '환불 등록 실패'); return; }
    closeRefund();
    closeDetail();
    await loadList();
  }

  function showErr(el, msg) {
    el.textContent = msg;
    el.style.display = 'block';
  }

  /* ── 초기화 / 재진입 통합 ── */
  async function init() {
    const container = document.getElementById('adm-other-revenues');
    if (!container) return;
    if (!container.querySelector('.panel')) {
      await loadCategories();
      renderShell(container);
    }
    await loadList();
  }

  window.SIREN_OTHER_REVENUES = { init, load: init, openAdd, closeAdd, submitAdd, openDetail, closeDetail, submitEdit, approve, reject, openRefund, closeRefund, submitRefund };
})();
