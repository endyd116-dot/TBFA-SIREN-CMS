/* admin-other-revenues.js — Phase 22A: 후원 외 매출 관리 */
(function () {
  'use strict';

  /* ── 상태 ── */
  let currentYear   = new Date().getFullYear();
  let currentCat    = '';
  let currentStatus = '';
  let categories    = [];
  let currentPage   = 1;
  const PAGE_SIZE   = 20;
  let detailItem    = null;

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

  /* ── 카테고리 로드 ── */
  async function loadCategories() {
    const res = await api('GET', '/api/admin-revenue-categories-list');
    if (!res.ok) { console.warn('[other-revenues] 카테고리 조회 실패', res.error); return; }
    const raw = res.data?.data || res.data || res.items || [];
    categories = raw.filter(c => c.isActive !== false);
  }

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

    const qs = new URLSearchParams({
      fiscalYear: currentYear,
      page:       currentPage,
      limit:      PAGE_SIZE,
    });
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

  /* ── 화면 골격 렌더 (최초 1회) ── */
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

    /* 필터 이벤트 */
    document.getElementById('orYearSelect').addEventListener('change',   e => { currentYear   = Number(e.target.value); currentPage = 1; loadList(); });
    document.getElementById('orCatSelect').addEventListener('change',    e => { currentCat    = e.target.value;         currentPage = 1; loadList(); });
    document.getElementById('orStatusSelect').addEventListener('change', e => { currentStatus = e.target.value;         currentPage = 1; loadList(); });

    /* 추가 모달 카테고리 */
    const addCat = document.getElementById('orAddCat');
    if (addCat) addCat.innerHTML = `<option value="">선택하세요</option>` + buildCatOptions('');

    /* 파일 미리보기 */
    document.getElementById('orAddFile').addEventListener('change', e => {
      const f = e.target.files[0];
      document.getElementById('orAddFilePreview').textContent =
        f ? `선택: ${f.name} (${(f.size / 1024).toFixed(1)} KB)` : '';
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
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-2)">✏️ 초안 편집</div>
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
      const reason = prompt('반려 사유를 입력하세요 (선택)');
      if (reason !== null) body.rejectionReason = reason;
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

  window.SIREN_OTHER_REVENUES = {
    init, load: init,
    openAdd, closeAdd, submitAdd,
    openDetail, closeDetail, submitEdit,
    doApprove,
    openRefund, closeRefund, submitRefund,
  };
})();
