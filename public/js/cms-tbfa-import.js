/* =========================================================
   ★ 작업 C(#15): CSV 자동 매핑 — 효성 + 기업은행
   - 업로드 → pending_donations 적재 + 자동 매칭
   - 미확정 목록 검토 → 1건/일괄 확정 / 무시 / 재매칭
   - window.CsvImport.init() 으로 초기화
   ========================================================= */
(function() {
  'use strict';

  let initialized = false;
  let currentRows = [];
  let currentLimit = 50;
  let currentOffset = 0;
  let currentTotal = 0;

  /* ─── 토스트 (cms-tbfa.js의 cmsToast 재사용) ─── */
  function toast(msg, ms = 2400) {
    const t = document.getElementById('cmsToast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._cmsT);
    window._cmsT = setTimeout(() => t.classList.remove('show'), ms);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtAmount(n) {
    if (n == null || isNaN(Number(n))) return '-';
    return Number(n).toLocaleString() + '원';
  }

  function fmtScore(s) {
    if (s == null) return '-';
    const v = Number(s);
    const pct = Math.round(v * 100);
    const color = pct >= 75 ? '#0a8a4f' : pct >= 50 ? '#1a5ec4' : '#c47a00';
    return `<span style="color:${color};font-weight:600">${pct}%</span>`;
  }

  function statusBadge(status) {
    const map = {
      pending:   ['미확정', '#fff7e6', '#c47a00'],
      matched:   ['매칭됨', '#e6f0ff', '#1a5ec4'],
      confirmed: ['확정',   '#e6fff0', '#0a8a4f'],
      ignored:   ['무시',   '#f0f0f0', '#666'],
    };
    const [label, bg, fg] = map[status] || [status, '#eee', '#333'];
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:${bg};color:${fg};font-weight:600">${label}</span>`;
  }

  function sourceBadge(source) {
    if (source === 'hyosung_contracts') return '<span style="color:#1a5ec4;font-weight:600">효성 계약</span>';
    if (source === 'hyosung_billings') return '<span style="color:#0a8a4f;font-weight:600">효성 수납</span>';
    if (source === 'hyosung') return '<span style="color:#1a5ec4;font-weight:600">효성</span>';
    if (source === 'ibk') return '<span style="color:#c47a00;font-weight:600">기업은행</span>';
    return escapeHtml(source);
  }

  /* ─── 응답 키 다중 fallback ─── */
  function pluck(res, keys) {
    for (const k of keys) {
      const v = k.split('.').reduce((o, kk) => (o == null ? o : o[kk]), res);
      if (v !== undefined && v !== null) return v;
    }
    return null;
  }

  /* ─── API ─── */
  async function apiGet(url) {
    const r = await fetch(url, { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok && data.ok !== false, data };
  }
  async function apiPost(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok && data.ok !== false, data };
  }

  /* ─── 엑셀 → CSV 클라이언트 변환 (SheetJS, 프로젝트 표준) ─── */
  async function excelToCsvFile(file) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS 미로드 — 페이지 새로고침 후 재시도');
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('엑셀 파일에 시트가 없습니다');
    const ws = wb.Sheets[sheetName];
    const csvText = XLSX.utils.sheet_to_csv(ws);
    if (!csvText || !csvText.trim()) throw new Error('엑셀 첫 시트가 비어 있습니다');
    /* 서버 파서가 .csv 확장자 기준으로 분기할 수 있어 이름·MIME 모두 csv로 변환 */
    const newName = file.name.replace(/\.(xlsx|xls)$/i, '.csv');
    return new File([csvText], newName, { type: 'text/csv' });
  }

  /* ─── 업로드 ─── */
  async function handleUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById('csvFile');
    const sourceSel = document.getElementById('csvSource');
    const autoMatch = document.getElementById('csvAutoMatch');
    const btn = document.getElementById('csvImportBtn');
    const resultDiv = document.getElementById('csvImportResult');

    const file = fileInput?.files?.[0];
    if (!file) {
      toast('CSV 또는 엑셀 파일을 선택하세요');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('파일 크기는 5MB 이하여야 합니다');
      return;
    }

    /* 엑셀(.xlsx/.xls) → CSV 변환 */
    let uploadFile = file;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      btn.disabled = true;
      btn.textContent = '엑셀 → CSV 변환 중…';
      try {
        uploadFile = await excelToCsvFile(file);
      } catch (err) {
        toast('엑셀 변환 실패: ' + (err.message || ''));
        btn.disabled = false;
        btn.textContent = '📥 업로드 + 매칭';
        if (resultDiv) {
          resultDiv.innerHTML = `<span style="color:#c5293a">❌ 엑셀 변환 실패: ${escapeHtml(err.message || '')}</span>`;
        }
        return;
      }
    }

    const fd = new FormData();
    fd.append('file', uploadFile);
    fd.append('source', sourceSel?.value || 'auto');
    fd.append('autoMatch', autoMatch?.checked ? 'true' : 'false');

    btn.disabled = true;
    btn.textContent = '업로드 중…';
    resultDiv.textContent = '';

    try {
      const r = await fetch('/api/admin-donation-import', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) {
        const msg = data.error || data.detail?.parseErrors?.[0]?.error || '업로드 실패';
        resultDiv.innerHTML = `<span style="color:#c5293a">❌ ${escapeHtml(msg)}</span>`;
        toast(msg);
        return;
      }
      const d = data.data || data;
      resultDiv.innerHTML =
        `<span style="color:#0a8a4f">✅ ${escapeHtml(data.message || '적재 완료')}</span><br>` +
        `<small style="color:#666">출처: ${escapeHtml(d.source || '-')} · ` +
        `적재 ${d.importedRows || 0}건 / 자동매칭 ${d.autoMatchedRows || 0}건 / ` +
        `파싱오류 ${(d.parseErrors || []).length}건</small>`;
      toast(data.message || `${d.importedRows || 0}건 적재 완료`);
      /* 파일 입력 초기화 */
      if (fileInput) fileInput.value = '';
      /* 목록 새로고침 */
      currentOffset = 0;
      await refreshList();
    } catch (err) {
      resultDiv.innerHTML = `<span style="color:#c5293a">❌ 네트워크 오류: ${escapeHtml(err.message || '')}</span>`;
      toast('업로드 실패');
    } finally {
      btn.disabled = false;
      btn.textContent = '📥 업로드 + 매칭';
    }
  }

  /* ─── 목록 조회 ─── */
  async function refreshList() {
    const body = document.getElementById('csvPendingBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">불러오는 중…</td></tr>';

    const status = document.getElementById('csvFilterStatus')?.value || 'pending,matched';
    const source = document.getElementById('csvFilterSource')?.value || 'all';
    const search = (document.getElementById('csvFilterSearch')?.value || '').trim();
    const params = new URLSearchParams({
      status, source,
      limit: String(currentLimit),
      offset: String(currentOffset),
    });
    if (search) params.append('search', search);

    const res = await apiGet('/api/admin-donation-pending-list?' + params.toString());
    if (!res.ok) {
      body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:30px;color:#c5293a">❌ ${escapeHtml(res.data?.error || '조회 실패')}</td></tr>`;
      return;
    }
    const d = res.data.data || {};
    currentRows = d.rows || [];
    currentTotal = d.total || 0;
    renderRows();
    renderSummary(d.summary || {});
    renderPagination();
  }

  function renderRows() {
    const body = document.getElementById('csvPendingBody');
    if (!body) return;
    if (currentRows.length === 0) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">조회된 항목이 없습니다.</td></tr>';
      updateBatchButtons();
      return;
    }
    body.innerHTML = currentRows.map(r => {
      const matchedName = r.matchedMember?.name ? escapeHtml(r.matchedMember.name) : '<span style="color:#aaa">없음</span>';
      const canSelect = r.status === 'pending' || r.status === 'matched';
      const checkbox = canSelect
        ? `<input type="checkbox" class="csv-row-chk" data-id="${r.id}">`
        : '';
      const actions = renderActions(r);
      return `
        <tr data-id="${r.id}">
          <td>${checkbox}</td>
          <td>${sourceBadge(r.source)}</td>
          <td>${escapeHtml(r.parsedName || '-')}</td>
          <td style="text-align:right">${fmtAmount(r.parsedAmount)}</td>
          <td>${fmtDate(r.parsedDate)}</td>
          <td>${matchedName}${r.matchedMember?.phone ? `<br><small style="color:#888">${escapeHtml(r.matchedMember.phone)}</small>` : ''}</td>
          <td style="text-align:right">${fmtScore(r.matchScore)}</td>
          <td style="font-size:11.5px;color:#666;max-width:180px">${escapeHtml(r.matchReason || '-')}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');

    /* 행별 액션 바인딩 */
    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', onRowAction);
    });
    body.querySelectorAll('.csv-row-chk').forEach(cb => {
      cb.addEventListener('change', updateBatchButtons);
    });
    updateBatchButtons();
  }

  function renderActions(r) {
    if (r.status === 'confirmed') {
      if (r.source === 'hyosung_contracts') {
        return `<span style="color:#0a8a4f;font-size:11.5px">✓ 회원 등록됨</span>`;
      }
      return `<a href="#" data-action="open-donation" data-id="${r.confirmedDonationId || ''}" style="color:#1a5ec4;font-size:11.5px">후원 보기</a>`;
    }
    if (r.status === 'ignored') {
      return `<button data-action="restore" data-id="${r.id}" class="cms-btn cms-btn-ghost" style="padding:3px 8px;font-size:11.5px">↩ 복원</button>`;
    }
    /* pending / matched — 효성 계약은 매칭 없어도 통과 가능 (신규 회원 자동 생성) */
    const isContract = r.source === 'hyosung_contracts';
    const canConfirm = isContract || !!r.matchedMemberId;
    const confirmTitle = isContract
      ? '효성 계약 — 통과 시 신규 회원 자동 등록 또는 기존 회원 연결'
      : (r.matchedMemberId ? '' : '회원 매칭 후 가능');
    const confirmBtn = `<button data-action="confirm" data-id="${r.id}" class="cms-btn cms-btn-primary" style="padding:3px 8px;font-size:11.5px;margin-right:4px"${canConfirm ? '' : ' disabled'}${confirmTitle ? ` title="${confirmTitle}"` : ''}>✅ 통과</button>`;
    const rematchBtn = `<button data-action="rematch" data-id="${r.id}" class="cms-btn cms-btn-ghost" style="padding:3px 8px;font-size:11.5px;margin-right:4px">🔍 매칭 변경</button>`;
    const ignoreBtn = `<button data-action="ignore" data-id="${r.id}" class="cms-btn cms-btn-ghost" style="padding:3px 8px;font-size:11.5px">🗑 무시</button>`;
    return confirmBtn + rematchBtn + ignoreBtn;
  }

  async function onRowAction(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);
    if (!id) return;

    if (action === 'confirm') {
      if (!confirm('이 항목을 통과 처리하시겠습니까?\n효성 계약: 회원·계약 정식 반영\n효성 수납: 후원 내역 생성\n기업은행: 후원 내역 생성')) return;
      const res = await apiPost('/api/admin-donation-confirm', { ids: [id], action: 'confirm' });
      handleConfirmResult(res);
    } else if (action === 'ignore') {
      if (!confirm('이 항목을 무시 처리하시겠습니까?')) return;
      const res = await apiPost('/api/admin-donation-confirm', { ids: [id], action: 'ignore' });
      handleConfirmResult(res);
    } else if (action === 'restore') {
      /* 복원: ignored → pending (matched_member_id 있으면 matched, 없으면 pending) */
      toast('복원 기능은 추후 추가 예정입니다');
    } else if (action === 'rematch') {
      const memberIdStr = prompt('수동으로 매칭할 회원 ID를 입력하세요 (admin 회원 검색 페이지에서 확인):');
      if (!memberIdStr) return;
      const memberId = parseInt(memberIdStr.trim(), 10);
      if (!memberId) { toast('유효한 회원 ID가 아닙니다'); return; }
      const res = await apiPost('/api/admin-donation-confirm', { ids: [id], action: 'rematch', memberIdOverride: memberId });
      handleConfirmResult(res);
    } else if (action === 'open-donation') {
      const did = parseInt(btn.dataset.id, 10);
      if (did) toast(`후원 ID: ${did} (admin 화면에서 검색)`);
    }
  }

  function handleConfirmResult(res) {
    if (!res.ok) {
      toast(res.data?.error || '처리 실패');
      return;
    }
    toast(res.data?.message || '처리 완료');
    refreshList();
  }

  /* ─── 일괄 처리 ─── */
  function selectedIds() {
    return Array.from(document.querySelectorAll('.csv-row-chk:checked')).map(cb => parseInt(cb.dataset.id, 10)).filter(Boolean);
  }

  function updateBatchButtons() {
    const ids = selectedIds();
    const cntEl = document.getElementById('csvSelectedCount');
    if (cntEl) cntEl.textContent = String(ids.length);
    const cb = document.getElementById('csvBatchConfirmBtn');
    const ib = document.getElementById('csvBatchIgnoreBtn');
    /* 효성 계약은 매칭 없어도 통과 가능 (신규 회원 자동 생성) */
    const eligible = currentRows.filter(r => {
      if (!ids.includes(r.id)) return false;
      if (r.source === 'hyosung_contracts') return true;
      return !!r.matchedMemberId;
    });
    if (cb) cb.disabled = eligible.length === 0;
    if (ib) ib.disabled = ids.length === 0;
  }

  async function batchConfirm() {
    const ids = selectedIds();
    if (ids.length === 0) return;
    /* 효성 계약은 매칭이 없어도(신규 회원 자동 생성) 통과 가능 */
    const eligible = currentRows.filter(r => {
      if (!ids.includes(r.id)) return false;
      if (r.source === 'hyosung_contracts') return true;
      return !!r.matchedMemberId;
    });
    const skipped = ids.length - eligible.length;
    if (eligible.length === 0) {
      toast('통과 가능한 항목이 없습니다 (수납내역·기업은행은 매칭 필요)');
      return;
    }
    if (!confirm(`${eligible.length}건을 일괄 통과 처리합니다.${skipped > 0 ? ` (매칭 미완료 ${skipped}건은 제외)` : ''}\n효성 계약은 회원·계약 정식 반영, 효성 수납·기업은행은 후원 내역이 생성됩니다.\n진행하시겠습니까?`)) return;

    const res = await apiPost('/api/admin-donation-confirm', {
      ids: eligible.map(r => r.id),
      action: 'confirm',
    });
    handleConfirmResult(res);
  }

  async function batchIgnore() {
    const ids = selectedIds();
    if (ids.length === 0) return;
    if (!confirm(`${ids.length}건을 일괄 무시 처리합니다. 진행하시겠습니까?`)) return;
    const res = await apiPost('/api/admin-donation-confirm', { ids, action: 'ignore' });
    handleConfirmResult(res);
  }

  /* ─── 요약 + 페이지네이션 ─── */
  function renderSummary(s) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('csvSumPending', (s.pending || 0).toLocaleString());
    set('csvSumMatched', (s.matched || 0).toLocaleString());
    set('csvSumConfirmed', (s.confirmed || 0).toLocaleString());
    set('csvSumIgnored', (s.ignored || 0).toLocaleString());
  }

  function renderPagination() {
    const el = document.getElementById('csvPagination');
    if (!el) return;
    const start = currentOffset + 1;
    const end = Math.min(currentOffset + currentLimit, currentTotal);
    const hasPrev = currentOffset > 0;
    const hasNext = end < currentTotal;
    el.innerHTML = currentTotal === 0
      ? '0건'
      : `${start.toLocaleString()}–${end.toLocaleString()} / ${currentTotal.toLocaleString()}건 ` +
        (hasPrev ? `<a href="#" data-page="prev" style="margin-left:8px">‹ 이전</a>` : '') +
        (hasNext ? `<a href="#" data-page="next" style="margin-left:8px">다음 ›</a>` : '');
    el.querySelectorAll('a[data-page]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        if (a.dataset.page === 'prev') currentOffset = Math.max(0, currentOffset - currentLimit);
        else currentOffset = currentOffset + currentLimit;
        refreshList();
      });
    });
  }

  /* ─── 초기화 ─── */
  function init() {
    if (initialized) {
      refreshList();
      return;
    }
    initialized = true;

    document.getElementById('csvImportForm')?.addEventListener('submit', handleUpload);
    document.getElementById('csvRefreshBtn')?.addEventListener('click', () => { currentOffset = 0; refreshList(); });
    document.getElementById('csvFilterStatus')?.addEventListener('change', () => { currentOffset = 0; refreshList(); });
    document.getElementById('csvFilterSource')?.addEventListener('change', () => { currentOffset = 0; refreshList(); });
    document.getElementById('csvFilterSearch')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { currentOffset = 0; refreshList(); }
    });
    document.getElementById('csvBatchConfirmBtn')?.addEventListener('click', batchConfirm);
    document.getElementById('csvBatchIgnoreBtn')?.addEventListener('click', batchIgnore);

    const selAll = document.getElementById('csvSelectAll');
    if (selAll) {
      selAll.addEventListener('change', () => {
        document.querySelectorAll('.csv-row-chk').forEach(cb => { cb.checked = selAll.checked; });
        updateBatchButtons();
      });
    }

    refreshList();
  }

  /* ─── 외부 노출 ─── */
  window.CsvImport = { init, refresh: refreshList };
})();
