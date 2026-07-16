/* admin-approval.js — 지출 결재(배치2): 내 결재함·결재라인 설정·지출결의서 (2026-07-01)
 * window.SIREN_APPROVAL = { inbox, lines, resolutions }
 */
(function () {
  'use strict';

  let myRole = null;
  let mokCache = null;   // 예산 목 select 캐시

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

  /* 예산 목 목록(관>항>목 경로 라벨) */
  async function loadMoks() {
    if (mokCache) return mokCache;
    const res = await api('GET', '/api/admin-budget-accounts');
    const tree = res.ok ? (res.data?.data?.tree || res.data?.tree || []) : [];
    const out = [];
    (tree || []).forEach(g => (g.children || []).forEach(h => (h.children || []).forEach(m => {
      out.push({ id: m.id, label: `${g.name} > ${h.name} > ${m.name}` });
    })));
    mokCache = out;
    return out;
  }

  /* ══════════ 화면 1: 내 결재함 ══════════ */
  async function initInbox() {
    const c = document.getElementById('page-approval-inbox');
    if (!c) return;
    await loadRole();
    c.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">내 결재함</div>
          <div class="p-actions"><button class="btn-sm btn-sm-primary" id="apNewBtn" type="button">+ 지출 결재 올리기</button></div>
        </div>
        <div style="display:flex;gap:8px;margin:6px 0 12px">
          <button class="btn-sm apTab" data-box="inbox" type="button">결재 대기</button>
          <button class="btn-sm btn-sm-ghost apTab" data-box="drafts" type="button">내 기안</button>
          <button class="btn-sm btn-sm-ghost apTab" data-box="all" type="button">전체</button>
        </div>
        <div id="apListBody"></div>
      </div>
      <div id="apModal"></div>`;
    c.querySelector('#apNewBtn').addEventListener('click', () => openDraftForm());
    c.querySelectorAll('.apTab').forEach(b => b.addEventListener('click', () => {
      c.querySelectorAll('.apTab').forEach(x => x.classList.add('btn-sm-ghost'));
      b.classList.remove('btn-sm-ghost');
      loadBox(b.dataset.box);
    }));
    loadBox('inbox');
  }

  async function loadBox(box) {
    const el = document.getElementById('apListBody');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', `/api/admin-approval-requests?box=${box}`);
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:12px">조회 실패: ${esc(res.error || '')}</div>`; return; }
    const list = res.data?.data?.items || res.data?.items || res.data?.data?.requests || res.data?.requests || [];
    if (!list.length) { el.innerHTML = `<div style="color:var(--text-3);padding:20px;text-align:center">해당 항목이 없습니다.</div>`; return; }
    el.innerHTML = list.map(r => {
      const steps = r.steps || [];
      const curRole = steps[r.currentStep] ? ROLE_LABEL[steps[r.currentStep]] : '—';
      const canAct = box === 'inbox' && r.status === 'pending';
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;font-size:14px">${esc(r.title)} ${statusBadge(r.status)}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:3px">
              ${esc(r.requestNo || '')} · <strong>${fmtKRW(r.amount)}</strong> · ${esc(r.budgetAccountName || '예산 미지정')}
              ${r.boardRequired ? ' · <span style="color:#b45309">이사회 안건</span>' : ''}
            </div>
            <div style="font-size:12px;color:var(--text-3);margin-top:3px">
              기안 ${esc(r.drafterName || '')} · 결재선 ${esc(stepsLabel(steps))} ${r.status === 'pending' ? `(현재: ${curRole})` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._detail(${r.id})">상세</button>
            ${canAct ? `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_APPROVAL._decide(${r.id},'approve')">승인</button>
                        <button class="btn-sm btn-sm-danger" type="button" onclick="window.SIREN_APPROVAL._decide(${r.id},'reject')">반려</button>` : ''}
            ${box === 'drafts' && r.status === 'rejected'
              ? `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_APPROVAL._resubmit(${r.id})">재상신</button>` : ''}
            ${box === 'drafts' && !r.resolutionNo && (r.status === 'pending' || r.status === 'rejected')
              ? `<button class="btn-sm btn-sm-danger" type="button" onclick="window.SIREN_APPROVAL._delReq(${r.id})">삭제</button>` : ''}
            ${r.resolutionNo ? `<span style="align-self:center;font-size:11px;color:#059669">${esc(r.resolutionNo)}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  async function openDraftForm(prefill) {
    const moks = await loadMoks();
    const m = document.getElementById('apModal');
    const p = prefill || {};
    m.innerHTML = `
      <div class="modal-backdrop" style="display:flex" id="apDraftBackdrop">
        <div class="modal" style="max-width:520px">
          <div class="modal-head"><span class="modal-title">${p.isResubmit ? '반려건 재상신' : '지출 결재 올리기'}</span><button class="modal-close" type="button" id="apDraftClose">×</button></div>
          <div class="modal-body">
            ${p.isResubmit ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;font-size:12px;color:#92400e;margin-bottom:10px">이전 반려건(${esc(p.origRequestNo || '')}) 내용을 불러왔습니다. 필요한 부분을 수정한 뒤 다시 올리세요.</div>` : ''}
            <label class="form-label">제목 *</label>
            <input class="input" id="apfTitle" maxlength="200" placeholder="예: 추모행사 현수막 제작" value="${esc(p.title || '')}">
            <label class="form-label" style="margin-top:8px">금액(원) *</label>
            <input class="input" id="apfAmount" type="number" min="1" placeholder="150000" value="${p.amount || ''}">
            <div style="font-size:11px;color:var(--text-3);margin-top:2px" id="apfLineHint">금액에 따라 결재선이 자동 결정됩니다.</div>
            <label class="form-label" style="margin-top:8px">예산 목(目) *</label>
            <select class="input" id="apfMok"><option value="">— 예산과목(목) 선택 —</option>${moks.map(x => `<option value="${x.id}" ${p.budgetAccountId && String(p.budgetAccountId) === String(x.id) ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
            <label class="form-label" style="margin-top:8px">지급처</label>
            <input class="input" id="apfPayee" maxlength="200" placeholder="예: OO기획" value="${esc(p.payeeName || '')}">
            <label class="form-label" style="margin-top:8px">지출 예정일</label>
            <input class="input" id="apfDate" type="date" value="${p.occurredAt ? String(p.occurredAt).slice(0, 10) : ''}">
            <label class="form-label" style="margin-top:8px">내용/사유</label>
            <textarea class="input" id="apfDesc" rows="3">${esc(p.description || '')}</textarea>
            <label class="form-label" style="margin-top:8px">증빙 파일 (영수증·세금계산서)</label>
            <input class="input" id="apfFile" type="file" accept="image/*,application/pdf,.xlsx,.xls,.hwp">
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">이미지·PDF·엑셀·한글 파일, 50MB 이하 (선택)${p.evidenceUrl ? ' — 이전 첨부파일은 자동으로 옮겨지지 않으니 필요하면 다시 첨부하세요' : ''}</div>
            <div id="apfErr" style="color:var(--danger);font-size:12px;margin-top:6px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="apDraftCancel">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="apDraftSubmit">${p.isResubmit ? '재상신' : '결재 올리기'}</button>
          </div>
        </div>
      </div>`;
    const close = () => { m.innerHTML = ''; };
    m.querySelector('#apDraftClose').onclick = close;
    m.querySelector('#apDraftCancel').onclick = close;
    m.querySelector('#apDraftSubmit').onclick = async () => {
      const title = m.querySelector('#apfTitle').value.trim();
      const amount = parseInt(m.querySelector('#apfAmount').value) || 0;
      const budgetAccountId = parseInt(m.querySelector('#apfMok').value) || 0;
      const file = m.querySelector('#apfFile').files[0];
      const errEl = m.querySelector('#apfErr');
      errEl.style.display = 'none';
      if (!title || amount <= 0 || !budgetAccountId) {
        errEl.textContent = '제목·금액·예산 목은 필수입니다.'; errEl.style.display = ''; return;
      }
      const submitBtn = m.querySelector('#apDraftSubmit');
      let evidenceUrl = null;
      if (file) {
        submitBtn.disabled = true; submitBtn.textContent = '파일 업로드 중…';
        evidenceUrl = await uploadEvidence(file, errEl);
        submitBtn.disabled = false; submitBtn.textContent = '결재 올리기';
        if (!evidenceUrl) return;
      }
      const res = await api('POST', '/api/admin-approval-request-create', {
        title, amount, budgetAccountId,
        payeeName: m.querySelector('#apfPayee').value.trim(),
        occurredAt: m.querySelector('#apfDate').value || null,
        description: m.querySelector('#apfDesc').value.trim(),
        evidenceUrl: evidenceUrl || undefined,
      });
      if (!res.ok) { errEl.textContent = '올리기 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; return; }
      close();
      alert('결재를 올렸습니다.');
      loadBox('drafts');
    };
  }

  /* ── R2 증빙 파일 업로드 (presign → PUT), admin-expenses.js와 동일 패턴 ── */
  async function uploadEvidence(file, errEl) {
    const pres = await api('POST', '/api/admin-expense-receipt-presign', {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
    });
    if (!pres.ok) {
      errEl.textContent = '업로드 URL 발급 실패: ' + (pres.data?.error || pres.error || ''); errEl.style.display = '';
      return null;
    }
    const payload = pres.data?.data || pres.data;
    const uploadUrl = payload?.uploadUrl;
    const fileUrl = payload?.fileUrl;
    if (!uploadUrl || !fileUrl) {
      errEl.textContent = 'presign 응답에 uploadUrl/fileUrl 없음'; errEl.style.display = '';
      return null;
    }
    try {
      const r = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!r.ok) { errEl.textContent = `파일 업로드 실패 (HTTP ${r.status})`; errEl.style.display = ''; return null; }
    } catch (e) {
      errEl.textContent = '파일 업로드 오류: ' + String(e); errEl.style.display = '';
      return null;
    }
    return fileUrl;
  }

  /* ── 반려건 재상신: 원본 내용 + 반려 사유를 불러와 새 기안 폼에 미리 채움 ── */
  async function resubmit(id) {
    const res = await api('GET', `/api/admin-approval-requests?id=${id}`);
    if (!res.ok) { alert('조회 실패'); return; }
    const d = res.data?.data || res.data;
    const r = d.request || d;
    const steps = d.steps || [];
    const rejStep = [...steps].reverse().find(s => s.decision === 'rejected');
    const note = `[재상신 · 원 결의 ${r.requestNo || ''} 반려사유: ${rejStep?.comment || '(사유 없음)'}]\n` + (r.description || '');
    openDraftForm({
      isResubmit: true, origRequestNo: r.requestNo,
      title: r.title, amount: r.amount, budgetAccountId: r.budgetAccountId,
      payeeName: r.payeeName, occurredAt: r.occurredAt, description: note,
    });
  }

  async function detail(id) {
    const res = await api('GET', `/api/admin-approval-requests?id=${id}`);
    if (!res.ok) { alert('조회 실패'); return; }
    const d = res.data?.data || res.data;
    const r = d.request || d;
    const steps = d.steps || [];
    const m = document.getElementById('apModal') || document.body.appendChild(document.createElement('div'));
    m.id = 'apModal';
    const stepRows = steps.map(s => `<tr>
      <td>${ROLE_LABEL[s.role] || s.role}</td>
      <td>${s.decision === 'approved' ? '승인' : s.decision === 'rejected' ? '반려' : '대기'}</td>
      <td>${esc(s.decidedByName || '—')}</td>
      <td style="font-size:12px;color:var(--text-3)">${esc(s.comment || '')}</td>
      <td style="font-size:11px;color:var(--text-3)">${fmtDate(s.decidedAt)}</td>
    </tr>`).join('');
    m.innerHTML = `
      <div class="modal-backdrop" style="display:flex" id="apDetBackdrop">
        <div class="modal" style="max-width:560px">
          <div class="modal-head"><span class="modal-title">${esc(r.title)}</span><button class="modal-close" type="button" id="apDetClose">×</button></div>
          <div class="modal-body">
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:10px">
              <div><b>${esc(r.requestNo || '')}</b> ${statusBadge(r.status)}</div>
              <div>금액 <b>${fmtKRW(r.amount)}</b></div>
              <div>예산 ${esc(d.budgetPath || r.budgetAccountName || '—')}</div>
            </div>
            <div style="font-size:13px;color:var(--text-2);margin-bottom:6px">기안 ${esc(r.drafterName || '')} · ${fmtDate(r.createdAt)} · 지급처 ${esc(r.payeeName || '—')}</div>
            ${r.evidenceUrl ? `<div style="margin-bottom:10px"><a href="${esc(r.evidenceUrl)}" target="_blank" rel="noopener" class="btn-sm btn-sm-ghost" style="text-decoration:none;display:inline-block">📎 증빙 파일 보기</a></div>` : ''}
            ${r.description ? `<div style="background:#f9fafb;border-radius:8px;padding:10px;font-size:13px;margin-bottom:10px;white-space:pre-wrap">${esc(r.description)}</div>` : ''}
            ${r.resolutionNo ? `<div style="color:#059669;font-weight:600;font-size:13px;margin-bottom:8px">지출결의서 ${esc(r.resolutionNo)} 발행됨</div>` : ''}
            <table class="data-table" style="width:100%"><thead><tr><th>결재</th><th>결과</th><th>결재자</th><th>의견</th><th>일시</th></tr></thead><tbody>${stepRows}</tbody></table>
          </div>
        </div>
      </div>`;
    m.querySelector('#apDetClose').onclick = () => { m.innerHTML = ''; };
  }

  async function decide(id, kind) {
    let comment = '';
    if (kind === 'reject') { comment = prompt('반려 사유를 입력하세요'); if (comment == null) return; }
    else { if (!confirm('이 지출을 승인하시겠습니까?')) return; }
    const res = await api('POST', '/api/admin-approval-decide', { requestId: id, decision: kind, comment });
    if (!res.ok) { alert('처리 실패: ' + (res.data?.error || res.error || '')); return; }
    const d = res.data?.data || {};
    if (d.resolutionNo) alert(`최종 승인 완료. 지출결의서 ${d.resolutionNo} 발행.`);
    else alert(kind === 'approve' ? '승인 처리했습니다.' : '반려 처리했습니다.');
    loadBox('inbox');
  }

  /* ══════════ 화면 2: 결재라인 설정 (이사장) ══════════ */
  async function initLines() {
    const c = document.getElementById('page-approval-lines');
    if (!c) return;
    await loadRole();
    c.innerHTML = `<div class="panel">
      <div class="p-head">
        <div class="p-title">결재라인 설정</div>
        ${isSuper() ? '<div class="p-actions"><button class="btn-sm btn-sm-primary" id="apLineAddBtn" type="button">+ 결재라인 추가</button></div>' : ''}
      </div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">금액 구간에 따라 결재 단계(직책 순서)가 자동 적용됩니다. ${isSuper() ? '' : '<b>이사장(super_admin)만 수정 가능</b>합니다.'}</div>
      <div id="apLinesBody"></div>
      <div style="margin-top:24px" id="apDelegWrap"></div>
      <div id="apLineModal"></div>
    </div>`;
    if (isSuper()) document.getElementById('apLineAddBtn')?.addEventListener('click', () => openLineForm(null));
    await loadLines();
    await loadDelegations();
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
  async function loadDelegations() {
    const el = document.getElementById('apDelegWrap');
    const res = await api('GET', '/api/admin-approval-delegations');
    const dels = res.ok ? (res.data?.data?.delegations || res.data?.delegations || []) : [];
    el.innerHTML = `<div class="p-head" style="margin-bottom:6px"><div class="p-title" style="font-size:14px">위임(전결·대결) — 이사장 부재 시 대리 결재</div>
      ${isSuper() ? '<button class="btn-sm btn-sm-primary" id="apDelAdd" type="button">+ 위임 추가</button>' : ''}</div>
      <table class="data-table" style="width:100%"><thead><tr><th>위임 직책</th><th>대리 결재자</th><th>기간</th><th>사유</th><th>상태</th>${isSuper() ? '<th></th>' : ''}</tr></thead>
      <tbody>${dels.length ? dels.map(d => `<tr>
        <td>${ROLE_LABEL[d.delegateRole] || d.delegateRole}</td>
        <td>${esc(d.toMemberName || d.toMemberId)}</td>
        <td>${fmtDate(d.startAt)} ~ ${fmtDate(d.endAt)}</td>
        <td style="font-size:12px">${esc(d.reason || '')}</td>
        <td>${d.isActive ? '<span style="color:#059669">활성</span>' : '<span style="color:#9ca3af">해제</span>'}</td>
        ${isSuper() ? `<td>${d.isActive ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._deldel(${d.id})">해제</button>` : ''}</td>` : ''}
      </tr>`).join('') : `<tr><td colspan="${isSuper() ? 6 : 5}" style="text-align:center;color:var(--text-3);padding:14px">설정된 위임이 없습니다.</td></tr>`}</tbody></table>`;
    if (isSuper()) document.getElementById('apDelAdd')?.addEventListener('click', addDelegation);
  }
  async function addDelegation() {
    const toId = prompt('대리 결재자의 회원 ID를 입력하세요 (관리자 회원)');
    if (!toId) return;
    const start = prompt('시작일 (YYYY-MM-DD)'); if (!start) return;
    const end = prompt('종료일 (YYYY-MM-DD)'); if (!end) return;
    const reason = prompt('사유 (선택)') || '';
    const res = await api('POST', '/api/admin-approval-delegations', {
      action: 'create', delegateRole: 'super_admin', toMemberId: parseInt(toId), startAt: start, endAt: end, reason,
    });
    if (!res.ok) { alert('추가 실패: ' + (res.data?.error || res.error || '')); return; }
    loadDelegations();
  }
  async function delDelegation(id) {
    if (!confirm('이 위임을 해제할까요?')) return;
    const res = await api('POST', '/api/admin-approval-delegations', { action: 'deactivate', id });
    if (!res.ok) { alert('해제 실패'); return; }
    loadDelegations();
  }

  /* ══════════ 화면 3: 지출결의서 ══════════ */
  let resCache = [];
  async function initResolutions() {
    const c = document.getElementById('page-approval-resolutions');
    if (!c) return;
    await loadRole();
    c.innerHTML = `<div class="panel">
      <div class="p-head">
        <div class="p-title">지출결의서</div>
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
      <thead><tr><th>결의번호</th><th>제목</th><th>금액</th><th>예산과목</th><th>발행일</th><th>상태</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr style="${r.status === 'canceled' ? 'opacity:.55' : ''}">
        <td><b>${esc(r.resolutionNo)}</b></td><td>${esc(r.title)}</td><td class="num">${fmtKRW(r.amount)}</td>
        <td>${esc(r.budgetAccountName || '—')}</td><td>${fmtDate(r.decidedAt || r.createdAt)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="white-space:nowrap">${r.resolutionPdfUrl ? `<a class="btn-sm btn-sm-ghost" href="${esc(r.resolutionPdfUrl)}" target="_blank" style="text-decoration:none">발행본</a> ` : ''}<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_APPROVAL._print(${r.id})">인쇄</button>${
          r.status === 'approved' && isSuper() ? ` <button class="btn-sm btn-sm-danger" type="button" onclick="window.SIREN_APPROVAL._cancelRes(${r.id})">결재취소</button>` : ''
        }</td>
      </tr>`).join('')}</tbody></table>`;
  }

  async function cancelResolution(id) {
    if (!isSuper()) { alert('결재취소는 이사장만 가능합니다.'); return; }
    const reason = prompt('취소 사유를 입력하세요 (선택)') || '';
    if (!confirm('이 지출결의서를 취소할까요?\n연결된 지출은 예산 집행에서 제외되고, 결의번호·기록은 이력으로 남습니다.')) return;
    const res = await api('POST', '/api/admin-approval-cancel', { requestId: id, action: 'cancel', reason });
    if (!res.ok) { alert('취소 실패: ' + (res.data?.error || res.error || '')); return; }
    alert('취소 처리했습니다.');
    initResolutions();
  }

  async function deleteRequest(id) {
    if (!confirm('이 기안을 삭제할까요? 되돌릴 수 없습니다.')) return;
    const res = await api('POST', '/api/admin-approval-cancel', { requestId: id, action: 'delete' });
    if (!res.ok) { alert('삭제 실패: ' + (res.data?.error || res.error || '')); return; }
    loadBox('drafts');
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
    const d = res.data?.data || res.data; const r = d.request || d; const steps = d.steps || [];
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
    inbox: initInbox, lines: initLines, resolutions: initResolutions,
    _detail: detail, _decide: decide, _deldel: delDelegation, _print: printResolution,
    _editLine: editLine, _delLine: deleteLine,
    _delReq: deleteRequest, _cancelRes: cancelResolution, _resubmit: resubmit,
  };
})();
