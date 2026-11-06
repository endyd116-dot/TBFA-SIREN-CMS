/* admin-approval.js — 금액별 추천 결재선·지출결의서 대장 (2026-07-01, 2026-11-06 개편)
 * 결재 문서는 내부결재(admin-docs.js)에서 처리한다.
 * window.SIREN_APPROVAL = { lines, resolutions }
 */
(function () {
  'use strict';

  let myRole = null;

  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  function fmtKRW(n) { return (n == null ? 0 : Number(n)).toLocaleString('ko-KR') + '원'; }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const ROLE_LABEL = { operator: '담당자', admin: '국장', super_admin: '이사장' };
  function stepsLabel(steps) { return (steps || []).map(r => ROLE_LABEL[r] || r).join(' → '); }
  const STATUS = {
    pending: { t: '결재중', c: '#f59e0b', b: '#fef3c7' },
    approved: { t: '승인', c: '#059669', b: '#d1fae5' },
    rejected: { t: '반려', c: '#dc2626', b: '#fee2e2' },
    canceled: { t: '취소', c: '#6b7280', b: '#f3f4f6' },
  };
  function statusBadge(s) {
    const o = STATUS[s] || STATUS.pending;
    return `<span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;color:${o.c};background:${o.b}">${o.t}</span>`;
  }

  async function loadRole() {
    if (myRole !== null) return;
    const res = await api('GET', '/api/admin/me');
    const me = res.ok ? (res.data?.data?.admin || res.data?.admin || res.data?.data || res.data) : null;
    myRole = me?.role || 'admin';
  }
  function isSuper() { return myRole === 'super_admin'; }

  /* ══════════ 금액별 추천 결재선 (이사장) ══════════ */
  async function initLines() {
    const c = document.getElementById('page-approval-lines');
    if (!c) return;
    await loadRole();
    c.innerHTML = `<div class="panel">
      <div class="p-head">
        <div class="p-title">금액별 추천 결재선</div>
        ${isSuper() ? '<div class="p-actions"><button class="btn-sm btn-sm-primary" id="apLineAddBtn" type="button">+ 결재라인 추가</button></div>' : ''}
      </div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">문서 작성 화면의 «추천 결재선»이 쓰는 기준입니다. 금액에 맞는 직책의 담당자를 채워 줄 뿐이고, 기안자가 바꿀 수 있습니다. ${isSuper() ? '' : '<b>이사장만 수정할 수 있습니다.</b>'}</div>
      <div id="apLinesBody"></div>
      <div id="apLineModal"></div>
    </div>`;
    if (isSuper()) document.getElementById('apLineAddBtn')?.addEventListener('click', () => openLineForm(null));
    await loadLines();
  }
  async function loadLines() {
    const el = document.getElementById('apLinesBody');
    const res = await api('GET', '/api/admin-approval-lines');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger)">조회 실패</div>`; return; }
    const lines = res.data?.data?.lines || res.data?.lines || [];
    el.innerHTML = `<table class="data-table" style="width:100%">
      <thead><tr><th>구간</th><th>금액</th><th>결재 단계</th><th>이사회</th><th>상태</th>${isSuper() ? '<th></th>' : ''}</tr></thead>
      <tbody>${lines.map(l => `<tr>
        <td>${esc(l.name)}</td>
        <td class="num">${fmtKRW(l.minAmount)} ~ ${l.maxAmount == null ? '무제한' : fmtKRW(l.maxAmount)}</td>
        <td>${esc(stepsLabel(l.steps))}</td>
        <td>${l.boardRequired ? '이사회 안건' : '—'}</td>
        <td>${l.isActive ? '<span style="color:#059669">활성</span>' : '<span style="color:#9ca3af">비활성</span>'}</td>
        ${isSuper() ? `<td style="white-space:nowrap">
          <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._editLine(${l.id})">수정</button>
          <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._delLine(${l.id})">삭제</button>
        </td>` : ''}
      </tr>`).join('')}</tbody>
    </table>
    <div style="font-size:12px;color:var(--text-3);margin-top:8px">기본 3구간: 30만 미만=국장 단독 / 30만~300만=국장→이사장 / 300만 이상=국장→이사장(이사회 안건). ${isSuper() ? '금액 경계·단계는 위 표에서 직접 추가·수정·삭제할 수 있습니다.' : '금액 경계·단계 변경은 이사장 문의.'}</div>`;
    window.__apLinesCache = lines;
  }

  /* ── 결재라인 추가/수정 폼 (super_admin 전용) ── */
  function openLineForm(existing) {
    const m = document.getElementById('apLineModal');
    if (!m) return;
    const steps = existing?.steps || [];
    m.innerHTML = `
      <div class="modal-backdrop" style="display:flex" id="apLineBackdrop">
        <div class="modal" style="max-width:460px">
          <div class="modal-head"><span class="modal-title">${existing ? '결재라인 수정' : '결재라인 추가'}</span><button class="modal-close" type="button" id="apLineClose">×</button></div>
          <div class="modal-body">
            <label class="form-label">구간명 *</label>
            <input class="input" id="aplName" maxlength="100" placeholder="예: 500만원 이상" value="${esc(existing?.name || '')}">
            <label class="form-label" style="margin-top:8px">최소 금액(원) *</label>
            <input class="input" id="aplMin" type="number" min="0" value="${existing?.minAmount ?? 0}">
            <label class="form-label" style="margin-top:8px">최대 금액(원) — 비우면 무제한</label>
            <input class="input" id="aplMax" type="number" min="0" value="${existing?.maxAmount ?? ''}">
            <label class="form-label" style="margin-top:8px">결재 단계 *</label>
            <div style="display:flex;gap:16px;margin-top:4px">
              <label style="font-size:13px;display:flex;align-items:center;gap:5px"><input type="checkbox" id="aplStepAdmin" ${steps.includes('admin') || !existing ? 'checked' : ''}> 국장</label>
              <label style="font-size:13px;display:flex;align-items:center;gap:5px"><input type="checkbox" id="aplStepSuper" ${steps.includes('super_admin') ? 'checked' : ''}> 이사장</label>
            </div>
            <label style="font-size:13px;display:flex;align-items:center;gap:5px;margin-top:10px"><input type="checkbox" id="aplBoard" ${existing?.boardRequired ? 'checked' : ''}> 이사회 안건 필요</label>
            <label style="font-size:13px;display:flex;align-items:center;gap:5px;margin-top:6px"><input type="checkbox" id="aplActive" ${existing == null || existing?.isActive ? 'checked' : ''}> 활성</label>
            <div id="aplErr" style="color:var(--danger);font-size:12px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="apLineCancel">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="apLineSubmit">${existing ? '저장' : '추가'}</button>
          </div>
        </div>
      </div>`;
    const close = () => { m.innerHTML = ''; };
    m.querySelector('#apLineClose').onclick = close;
    m.querySelector('#apLineCancel').onclick = close;
    m.querySelector('#apLineSubmit').onclick = async () => {
      const errEl = m.querySelector('#aplErr');
      errEl.style.display = 'none';
      const name = m.querySelector('#aplName').value.trim();
      const minAmount = Number(m.querySelector('#aplMin').value);
      const maxRaw = m.querySelector('#aplMax').value;
      const maxAmount = maxRaw === '' ? null : Number(maxRaw);
      const stepsVal = [];
      if (m.querySelector('#aplStepAdmin').checked) stepsVal.push('admin');
      if (m.querySelector('#aplStepSuper').checked) stepsVal.push('super_admin');
      const boardRequired = m.querySelector('#aplBoard').checked;
      const isActive = m.querySelector('#aplActive').checked;
      if (!name) { errEl.textContent = '구간명은 필수입니다.'; errEl.style.display = ''; return; }
      if (!Number.isFinite(minAmount) || minAmount < 0) { errEl.textContent = '최소 금액을 확인하세요.'; errEl.style.display = ''; return; }
      if (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount < minAmount)) { errEl.textContent = '최대 금액은 최소 금액 이상이어야 합니다.'; errEl.style.display = ''; return; }
      if (stepsVal.length === 0) { errEl.textContent = '결재 단계를 최소 1개 선택하세요.'; errEl.style.display = ''; return; }

      const body = existing
        ? { action: 'update', id: existing.id, name, minAmount, maxAmount, steps: stepsVal, boardRequired, isActive }
        : { action: 'create', name, minAmount, maxAmount, steps: stepsVal, boardRequired };
      const res = await api('POST', '/api/admin-approval-lines', body);
      if (!res.ok) { errEl.textContent = '저장 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; return; }
      close();
      await loadLines();
    };
  }
  function editLine(id) {
    const line = (window.__apLinesCache || []).find(l => l.id === id);
    if (!line) { alert('결재라인 정보를 찾을 수 없습니다.'); return; }
    openLineForm(line);
  }
  async function deleteLine(id) {
    if (!confirm('이 결재라인을 삭제할까요? 이 구간에 걸리는 금액대는 더 이상 결재를 올릴 수 없게 됩니다.')) return;
    const res = await api('POST', '/api/admin-approval-lines', { action: 'delete', id });
    if (!res.ok) { alert('삭제 실패: ' + (res.data?.error || res.error || '')); return; }
    await loadLines();
  }
  /* ══════════ 화면 3: 지출결의서 ══════════ */
  let resCache = [];
  async function initResolutions() {
    const c = document.getElementById('page-approval-resolutions');
    if (!c) return;
    await loadRole();
    c.innerHTML = `<div class="panel">
      <div class="p-head">
        <div class="p-title">지출결의서 대장</div>
        <div class="p-actions" style="display:flex;gap:6px">
          <button class="btn-sm btn-sm-ghost" id="apResCsv" type="button">CSV 내보내기</button>
          <button class="btn-sm btn-sm-ghost" id="apResZip" type="button">발행본 일괄 다운로드</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <input class="input-sm" id="apResSearch" placeholder="제목·결의번호·지급처 검색" style="max-width:220px">
        <select class="input-sm" id="apResYear" style="width:110px"><option value="">전체 연도</option></select>
      </div>
      <div id="apResStatus" style="font-size:12px;color:var(--text-3);margin-bottom:8px;display:none"></div>
      <div id="apResBody"></div>
    </div>`;
    document.getElementById('apResCsv').addEventListener('click', exportResolutionsCsv);
    document.getElementById('apResZip').addEventListener('click', downloadResolutionsZip);
    document.getElementById('apResSearch').addEventListener('input', renderResolutions);
    document.getElementById('apResYear').addEventListener('change', renderResolutions);

    const res = await api('GET', '/api/admin-approval-requests?box=all');
    const list = (res.ok ? (res.data?.data?.items || res.data?.items || res.data?.data?.requests || res.data?.requests || []) : []).filter(r => r.resolutionNo);
    resCache = list;

    const years = [...new Set(list.map(r => r.fiscalYear))].sort((a, b) => b - a);
    const yearSel = document.getElementById('apResYear');
    years.forEach(y => yearSel.insertAdjacentHTML('beforeend', `<option value="${y}">${y}년</option>`));

    renderResolutions();
  }

  function renderResolutions() {
    const el = document.getElementById('apResBody');
    if (!el) return;
    const q = (document.getElementById('apResSearch')?.value || '').trim().toLowerCase();
    const year = document.getElementById('apResYear')?.value || '';
    const list = resCache.filter(r => {
      if (year && String(r.fiscalYear) !== String(year)) return false;
      if (!q) return true;
      return [r.title, r.resolutionNo, r.payeeName].some(v => String(v || '').toLowerCase().includes(q));
    });
    if (!list.length) { el.innerHTML = `<div style="color:var(--text-3);padding:20px;text-align:center">발행된 지출결의서가 없습니다.</div>`; return; }
    el.innerHTML = `<table class="data-table" style="width:100%">
      <thead><tr><th>결의번호</th><th>제목</th><th>금액</th><th>예산과목</th><th>발행일</th><th>상태</th><th>지급</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr style="${r.status === 'canceled' ? 'opacity:.55' : ''}">
        <td><b>${esc(r.resolutionNo)}</b></td><td>${esc(r.title)}</td><td class="num">${fmtKRW(r.amount)}</td>
        <td>${esc(r.budgetAccountName || '—')}</td><td>${fmtDate(r.decidedAt || r.createdAt)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="white-space:nowrap;font-size:12px">${r.paymentStatus === 'paid' ? '지급 완료' : r.paymentStatus === 'unpaid' ? '<span style="color:#b45309">미지급</span>' : '—'}</td>
        <td style="white-space:nowrap">${r.resolutionPdfUrl ? `<a class="btn-sm btn-sm-ghost" href="${esc(r.resolutionPdfUrl)}" target="_blank" style="text-decoration:none">발행본</a> ` : ''}<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._print(${r.id})">인쇄</button>${
          r.status === 'approved' && isSuper() ? ` <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._regenRes(${r.id})">재발행</button>` : ''
        }</td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function regenerateResolution(id) {
    if (!isSuper()) { alert('재발행은 이사장만 가능합니다.'); return; }
    if (!confirm('이 지출결의서의 발행본(PDF)을 최신 서식으로 다시 만들까요?\n결의번호·금액 등 내용은 그대로이고, 결재란·레이아웃 표기만 갱신됩니다.')) return;
    const res = await api('POST', '/api/admin-approval-resolution-regenerate', { requestId: id });
    if (!res.ok) { alert('재발행 실패: ' + (res.data?.error || res.error || '')); return; }
    alert('발행본을 다시 만들었습니다. 발행본 링크에서 확인하세요.');
    initResolutions();
  }

  function exportResolutionsCsv() {
    const q = (document.getElementById('apResSearch')?.value || '').trim().toLowerCase();
    const year = document.getElementById('apResYear')?.value || '';
    const list = resCache.filter(r => {
      if (year && String(r.fiscalYear) !== String(year)) return false;
      if (!q) return true;
      return [r.title, r.resolutionNo, r.payeeName].some(v => String(v || '').toLowerCase().includes(q));
    });
    if (!list.length) { alert('내보낼 항목이 없습니다.'); return; }
    const header = ['결의번호', '제목', '금액', '예산과목', '발행일', '상태'];
    const csvRows = [header.join(',')];
    list.forEach(r => {
      const row = [
        r.resolutionNo || '', r.title || '', r.amount || 0, r.budgetAccountName || '',
        fmtDate(r.decidedAt || r.createdAt), STATUS[r.status]?.t || r.status,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      csvRows.push(row.join(','));
    });
    const blob = new Blob(['﻿' + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `지출결의서_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── 발행본 ZIP 일괄 다운로드 (workspace-files.js와 동일 CDN fallback 패턴) ── */
  const JSZIP_CDNS = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  ];
  function loadScriptFallback(urls) {
    return new Promise((resolve, reject) => {
      let i = 0;
      const tryNext = () => {
        if (i >= urls.length) return reject(new Error('모든 CDN 소스에서 로드 실패'));
        const s = document.createElement('script');
        s.src = urls[i++];
        s.onload = resolve;
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
  }
  async function downloadResolutionsZip() {
    const statusEl = document.getElementById('apResStatus');
    const list = resCache.filter(r => r.resolutionPdfUrl);
    if (!list.length) { alert('다운로드할 발행본이 없습니다.'); return; }
    statusEl.style.display = ''; statusEl.textContent = 'JSZip 라이브러리 로드 중…';
    try {
      if (!window.JSZip) await loadScriptFallback(JSZIP_CDNS);
    } catch (e) { statusEl.textContent = 'ZIP 라이브러리 로드 실패: ' + e.message; return; }

    const zip = new window.JSZip();
    let done = 0;
    for (const r of list) {
      statusEl.textContent = `다운로드 중… (${done + 1}/${list.length}) ${r.resolutionNo}`;
      try {
        const resp = await fetch(r.resolutionPdfUrl, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        zip.file(`${r.resolutionNo}.pdf`, blob);
      } catch (e) {
        console.warn('[zip] failed:', r.resolutionNo, e);
      }
      done++;
    }
    statusEl.textContent = 'ZIP 압축 중…';
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `지출결의서_발행본_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      statusEl.textContent = `완료 (${done}건)`;
      setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
    } catch (e) {
      statusEl.textContent = 'ZIP 생성 실패: ' + e.message;
    }
  }
  async function printResolution(id) {
    const res = await api('GET', `/api/admin-approval-requests?id=${id}`);
    if (!res.ok) { alert('조회 실패'); return; }
    const d = res.data?.data || res.data; const r = d.request || d;
    /* 기안자가 결재선의 직책(예: 국장)을 겸하면 그 직책 결재칸은 자기결재라 제외
       (발행본 PDF와 동일 규칙 — lib/resolution-pdf-store) */
    const drafterRole = r.drafterRole || null;
    const steps = (d.steps || []).filter(s => !(drafterRole && s.role === drafterRole));
    const w = window.open('', '_blank', 'width=800,height=1000');
    const stepCells = steps.map(s => `<td style="border:1px solid #333;padding:14px 8px;text-align:center;vertical-align:bottom;height:70px">
      <div style="font-size:11px;color:#555">${ROLE_LABEL[s.role] || s.role}</div>
      <div style="font-weight:700;margin-top:18px">${esc(s.decidedByName || '')}</div>
      <div style="font-size:10px;color:#888">${s.decision === 'approved' ? fmtDate(s.decidedAt) : ''}</div></td>`).join('');
    w.document.write(`<html><head><title>${esc(r.resolutionNo)}</title>
      <style>body{font-family:'Malgun Gothic',sans-serif;padding:40px;color:#111}
      h1{text-align:center;font-size:24px;letter-spacing:8px;border:3px double #333;padding:12px;margin-bottom:8px}
      table{border-collapse:collapse;width:100%;margin-top:14px}td,th{border:1px solid #333;padding:8px 10px;font-size:13px}
      .lbl{background:#f3f3f3;font-weight:700;width:120px}</style></head><body>
      <h1>지 출 결 의 서</h1>
      <div style="text-align:right;font-size:13px;margin-bottom:6px">${esc(r.resolutionNo)}</div>
      <table style="margin-top:0"><tr><td class="lbl" style="text-align:center" colspan="${steps.length}">결 재</td></tr><tr>${stepCells}</tr></table>
      <table>
        <tr><td class="lbl">지출일자</td><td>${fmtDate(r.occurredAt || r.decidedAt)}</td><td class="lbl">금액</td><td><b>${fmtKRW(r.amount)}</b></td></tr>
        <tr><td class="lbl">예산과목</td><td>${esc(d.budgetPath || '')}</td><td class="lbl">지급처</td><td>${esc(r.payeeName || '')}</td></tr>
        <tr><td class="lbl">적요(제목)</td><td colspan="3">${esc(r.title)}</td></tr>
        <tr><td class="lbl">내용</td><td colspan="3" style="white-space:pre-wrap;min-height:80px">${esc(r.description || '')}</td></tr>
        <tr><td class="lbl">기안자</td><td>${esc(r.drafterName || '')}</td><td class="lbl">기안일</td><td>${fmtDate(r.createdAt)}</td></tr>
      </table>
      <div style="text-align:center;margin-top:30px;font-size:15px;font-weight:700">(사)교사유가족협의회</div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  window.SIREN_APPROVAL = {
    lines: initLines, resolutions: initResolutions,
    _print: printResolution, _editLine: editLine, _delLine: deleteLine, _regenRes: regenerateResolution,
  };
})();
