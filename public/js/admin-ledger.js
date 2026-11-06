/* admin-ledger.js — 재정 관리 › 장부 (2026-11-06)
 * 전표 / 총계정원장 / 시산표 / 자금 연결 / 월 마감 / 결산 / 기준 정보 / 변경 이력
 * 설계: docs/active/2026-11-06-ledger-foundation-design.md
 * window.SIREN_LEDGER = { init, load }
 */
(function () {
  'use strict';

  let myRole = null;
  let masters = { accounts: [], programs: [], funds: [], functions: [], fiscalYears: [], charterGap: null, revenueCategories: [], staff: [], allocationRules: [] };
  let currentTab = 'voucher';
  let masterTab = 'accounts';
  let voucherReady = false;
  let modalSave = null;
  let modalAfter = null;

  const FN_LABEL = { service: '사업수행', admin: '일반관리', fundraising: '모금' };
  const KIND_LABEL = { asset: '자산', liability: '부채', net_asset: '순자산', revenue: '수익', expense: '비용' };
  const NATURE_LABEL = { distribution: '분배', personnel: '인력', facility: '시설', other: '기타' };
  const CATEGORY_LABEL = {
    asset: '자산', liability: '부채', net_asset: '순자산', income: '수익',
    personnel: '비용 · 인건비', program: '비용 · 사업비', admin_ops: '비용 · 관리운영비',
    fundraising: '비용 · 모금비', non_operating: '사업외비용·법인세',
  };
  const ACTION_LABEL = {
    created: '추가', updated: '수정', submitted: '제출', approved: '승인', rejected: '반려',
    reversed: '반대 전표로 취소', deleted: '삭제', month_closed: '월 마감', month_reopened: '마감 해제',
    paid: '지급 확인', auto_posted: '자동 전표 반영', refund_confirmed: '반환 확인', budget_adjusted: '예산 조정',
    published: '공개', unpublished: '공개 내림', designated: '공익법인 지정일 변경', recalled: '회수', substituted: '승인 갈음',
    cancel_requested: '취소 요청', cancel_approved: '취소 승인', cancel_rejected: '취소 반려', doc_deleted: '일반 삭제',
    settlement_locked: '결산 확정', settlement_reopened: '확정 해제', settlement_audit: '감사 기록',
    settlement_board: '이사회 의결 기록', settlement_assembly: '총회 승인 기록', settlement_submit: '제출 기록',
  };
  const ENTITY_LABEL = {
    voucher: '전표', program: '사업', fund: '재원', fiscal_year: '회계연도', account: '계정과목',
    approval: '결재', ledger_sync: '자동 전표', revenue_category: '수입 분류', staff_allocation: '인건비 배부',
    settlement: '결산', allocation_rule: '배분 규칙', disclosure: '재정 공개', budget_plan: '예산', approval_settings: '결재 설정',
  };

  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  const dataOf = res => res.data?.data || res.data || {};
  const failText = res => [res.data?.error || res.error || '요청 실패', ...(res.data?.missing || []), res.data?.detail || ''].filter(Boolean).join('\n');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const won = n => Number(n || 0).toLocaleString('ko-KR');
  const canManage = () => myRole === 'super_admin' || myRole === 'admin';
  const isChair = () => myRole === 'super_admin';
  const qs = id => document.getElementById(id);

  async function loadRole() {
    if (myRole !== null) return;
    const res = await api('GET', '/api/admin/me');
    const me = res.ok ? (res.data?.data?.admin || res.data?.admin || res.data?.data || {}) : {};
    myRole = me?.role || 'admin';
  }

  async function loadMasters() {
    const res = await api('GET', '/api/admin-ledger-masters');
    if (!res.ok) throw new Error(failText(res));
    const d = dataOf(res);
    masters = {
      accounts: d.accounts || [], programs: d.programs || [], funds: d.funds || [],
      functions: d.functions || [], fiscalYears: d.fiscalYears || [], charterGap: d.charterGap || null,
      revenueCategories: d.revenueCategories || [], staff: d.staff || [], allocationRules: d.allocationRules || [],
    };
  }

  function defaultYear() {
    const list = masters.fiscalYears;
    const y = new Date().getFullYear();
    return (list.find(f => f.year === y) || list[0] || { year: y }).year;
  }
  function yearOptions(selected) {
    return masters.fiscalYears.map(f =>
      `<option value="${f.year}"${f.year === selected ? ' selected' : ''}>${f.year}년</option>`).join('');
  }
  function monthsOf(year) {
    const fy = masters.fiscalYears.find(f => f.year === year);
    if (!fy) return [];
    const from = Number(fy.startDate.slice(5, 7));
    const to = Number(fy.endDate.slice(5, 7));
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }

  function renderShell(container) {
    container.innerHTML = `
      <div class="panel">
        <div class="p-head"><div class="p-title">장부</div></div>
        <div class="tabs-bar" id="lgTabs" style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap">
          <button class="tab-btn" data-lg="voucher" type="button">전표</button>
          <button class="tab-btn" data-lg="gl" type="button">총계정원장</button>
          <button class="tab-btn" data-lg="trial" type="button">시산표</button>
          <button class="tab-btn" data-lg="flow" type="button">자금 연결</button>
          <button class="tab-btn" data-lg="close" type="button">월 마감</button>
          <button class="tab-btn" data-lg="settle" type="button">결산</button>
          <button class="tab-btn" data-lg="masters" type="button">기준 정보</button>
          <button class="tab-btn" data-lg="history" type="button">변경 이력</button>
        </div>
        <div id="lgVoucher"></div>
        <div id="lgGl" style="display:none"></div>
        <div id="lgTrial" style="display:none"></div>
        <div id="lgFlow" style="display:none"></div>
        <div id="lgClose" style="display:none"></div>
        <div id="lgSettle" style="display:none"></div>
        <div id="lgMasters" style="display:none"></div>
        <div id="lgHistory" style="display:none"></div>
      </div>
      <div id="lgModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:480px">
          <div class="modal-head">
            <span class="modal-title" id="lgModalTitle"></span>
            <button class="modal-close" type="button" id="lgModalClose">×</button>
          </div>
          <div class="modal-body" id="lgModalBody"></div>
          <div id="lgModalError" style="color:var(--danger);font-size:13px;padding:0 20px 8px;white-space:pre-line;display:none"></div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="lgModalCancel">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="lgModalSave">저장</button>
          </div>
        </div>
      </div>`;
    qs('lgTabs').addEventListener('click', e => {
      const tab = e.target?.dataset?.lg;
      if (tab) switchTab(tab);
    });
    qs('lgModalClose').addEventListener('click', closeModal);
    qs('lgModalCancel').addEventListener('click', closeModal);
    qs('lgModalSave').addEventListener('click', async () => {
      if (!modalSave) return;
      qs('lgModalError').style.display = 'none';
      const res = await modalSave();
      if (res && !res.ok) {
        qs('lgModalError').textContent = failText(res);
        qs('lgModalError').style.display = '';
        return;
      }
      const after = modalAfter;
      closeModal();
      await loadMasters();
      if (after) await after(); else renderMasters();
    });
  }

  function openModal(title, bodyHtml, onSave, afterSave) {
    qs('lgModalTitle').textContent = title;
    qs('lgModalBody').innerHTML = bodyHtml;
    qs('lgModalError').style.display = 'none';
    modalSave = onSave;
    modalAfter = afterSave || null;
    qs('lgModal').style.display = 'flex';
  }
  function closeModal() {
    qs('lgModal').style.display = 'none';
    modalSave = null;
    modalAfter = null;
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#lgTabs .tab-btn').forEach(b => b.classList.toggle('on', b.dataset.lg === tab));
    const panes = { voucher: 'lgVoucher', gl: 'lgGl', trial: 'lgTrial', flow: 'lgFlow', close: 'lgClose', settle: 'lgSettle', masters: 'lgMasters', history: 'lgHistory' };
    Object.keys(panes).forEach(k => { qs(panes[k]).style.display = k === tab ? '' : 'none'; });
    if (tab === 'voucher') showVoucher();
    if (tab === 'gl') renderGl();
    if (tab === 'trial') renderTrial();
    if (tab === 'flow') renderFlow();
    if (tab === 'close') renderClose();
    if (tab === 'settle' && window.SIREN_SETTLEMENT) window.SIREN_SETTLEMENT.render(qs('lgSettle'), { role: myRole, masters });
    if (tab === 'masters') renderMasters();
    if (tab === 'history') renderHistory();
  }

  function showVoucher() {
    if (!window.SIREN_VOUCHER) return;
    if (!voucherReady) {
      voucherReady = true;
      qs('lgVoucher').innerHTML = '<div style="color:var(--text-3);padding:12px">전표를 불러오는 중…</div>';
      window.SIREN_VOUCHER.initVoucherTab(qs('lgVoucher'));
    } else {
      window.SIREN_VOUCHER.loadVoucherList();
    }
  }

  /* ── 엑셀에서 바로 열리는 CSV ── */
  function downloadCsv(filename, rows) {
    const body = rows.map(r => r.map(c => {
      const text = String(c == null ? '' : c);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── 총계정원장 ── */
  function renderGl() {
    const el = qs('lgGl');
    if (el.dataset.ready) return;
    el.dataset.ready = '1';
    const year = defaultYear();
    const fy = masters.fiscalYears.find(f => f.year === year);
    const leaf = masters.accounts.filter(a => !a.hasChildren);
    const cash = masters.accounts.find(a => a.systemRole === 'cash_default');
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <select id="lgGlAccount" class="input-sm" style="width:230px">
          ${leaf.map(a => `<option value="${esc(a.code)}"${a.code === cash?.code ? ' selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}
        </select>
        <input type="date" id="lgGlFrom" class="input-sm" value="${esc(fy?.startDate || '')}">
        <span>~</span>
        <input type="date" id="lgGlTo" class="input-sm" value="${esc(fy?.endDate || '')}">
        <select id="lgGlProgram" class="input-sm" style="width:170px">
          <option value="">전체 사업</option>
          ${masters.programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <select id="lgGlFund" class="input-sm" style="width:130px">
          <option value="">전체 재원</option>
          ${masters.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}
        </select>
        <button class="btn-sm btn-sm-primary" id="lgGlLoad" type="button">조회</button>
        <button class="btn-sm btn-sm-ghost" id="lgGlExport" type="button">엑셀</button>
      </div>
      <div id="lgGlResult"></div>`;
    qs('lgGlLoad').addEventListener('click', loadGl);
    qs('lgGlExport').addEventListener('click', exportGl);
    loadGl();
  }

  let lastGl = null;
  async function fetchGl() {
    const p = new URLSearchParams({
      accountCode: qs('lgGlAccount').value, from: qs('lgGlFrom').value, to: qs('lgGlTo').value, limit: '2000',
    });
    if (qs('lgGlProgram').value) p.set('programId', qs('lgGlProgram').value);
    if (qs('lgGlFund').value) p.set('fundId', qs('lgGlFund').value);
    return api('GET', `/api/admin-ledger-gl?${p}`);
  }
  async function loadGl() {
    const box = qs('lgGlResult');
    box.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await fetchGl();
    if (!res.ok) { box.innerHTML = `<div style="color:var(--danger);padding:12px;white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const d = dataOf(res);
    lastGl = d;
    box.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead><tr><th>날짜</th><th>전표번호</th><th>적요</th><th>거래처</th><th>활동·사업·재원</th>
          <th class="num">차변</th><th class="num">대변</th><th class="num">잔액</th></tr></thead>
        <tbody>
          <tr><td colspan="7" style="font-weight:600">기초 잔액</td><td class="num">${won(d.opening)}</td></tr>
          ${(d.rows || []).map(r => `<tr>
            <td>${esc(r.date)}</td>
            <td style="font-family:monospace;font-size:12px"><a href="#" onclick="window.SIREN_LEDGER.viewVoucher(${r.voucherId});return false;">${esc(r.voucherNumber)}</a></td>
            <td>${esc(r.description)}${r.reversed ? ' <span style="color:var(--danger);font-size:11px">취소됨</span>' : ''}</td>
            <td>${esc(r.payeeName || '')}</td>
            <td style="font-size:12px;color:var(--text-2)">${esc([FN_LABEL[r.functionCode], r.programName, r.fundName].filter(Boolean).join(' · '))}</td>
            <td class="num">${r.debit ? won(r.debit) : ''}</td>
            <td class="num">${r.credit ? won(r.credit) : ''}</td>
            <td class="num">${won(r.balance)}</td>
          </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">이 기간에 승인된 거래가 없습니다.</td></tr>'}
          <tr><td colspan="5" style="font-weight:600">기말 잔액</td>
            <td class="num">${won(d.periodDebit)}</td><td class="num">${won(d.periodCredit)}</td>
            <td class="num" style="font-weight:600">${won(d.closing)}</td></tr>
        </tbody>
      </table>
      ${d.total > (d.rows || []).length ? `<div style="font-size:12px;color:var(--text-3);margin-top:6px">전체 ${won(d.total)}건 중 ${won((d.rows || []).length)}건을 표시합니다.</div>` : ''}`;
  }
  function exportGl() {
    if (!lastGl) return;
    const d = lastGl;
    const rows = [['날짜', '전표번호', '적요', '거래처', '활동', '사업', '재원', '차변', '대변', '잔액']];
    rows.push(['기초 잔액', '', '', '', '', '', '', '', '', d.opening]);
    (d.rows || []).forEach(r => rows.push([r.date, r.voucherNumber, r.description, r.payeeName || '',
      FN_LABEL[r.functionCode] || '', r.programName || '', r.fundName || '', r.debit, r.credit, r.balance]));
    rows.push(['기말 잔액', '', '', '', '', '', '', d.periodDebit, d.periodCredit, d.closing]);
    downloadCsv(`총계정원장_${d.account.code}_${d.account.name}.csv`, rows);
  }

  /* ── 시산표 ── */
  function renderTrial() {
    const el = qs('lgTrial');
    if (!el.dataset.ready) {
      el.dataset.ready = '1';
      const year = defaultYear();
      el.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
          <select id="lgTrialYear" class="input-sm" style="width:110px">${yearOptions(year)}</select>
          <select id="lgTrialMonth" class="input-sm" style="width:110px"></select>
          <span style="font-size:13px;color:var(--text-2)">까지</span>
          <button class="btn-sm btn-sm-primary" id="lgTrialLoad" type="button">조회</button>
          <button class="btn-sm btn-sm-ghost" id="lgTrialExport" type="button">엑셀</button>
          <span id="lgTrialBadge" style="margin-left:8px;font-size:13px;font-weight:600"></span>
        </div>
        <div id="lgTrialResult"></div>`;
      const fillMonths = () => {
        const y = Number(qs('lgTrialYear').value);
        const months = monthsOf(y);
        qs('lgTrialMonth').innerHTML = months.map(m => `<option value="${m}">${m}월</option>`).join('');
        qs('lgTrialMonth').value = String(months[months.length - 1] || '');
      };
      qs('lgTrialYear').addEventListener('change', () => { fillMonths(); loadTrial(); });
      qs('lgTrialLoad').addEventListener('click', loadTrial);
      qs('lgTrialExport').addEventListener('click', exportTrial);
      fillMonths();
    }
    loadTrial();
  }

  let lastTrial = null;
  async function loadTrial() {
    const box = qs('lgTrialResult');
    box.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', `/api/admin-ledger-trial-balance?year=${qs('lgTrialYear').value}&month=${qs('lgTrialMonth').value}`);
    if (!res.ok) { box.innerHTML = `<div style="color:var(--danger);padding:12px;white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const d = dataOf(res);
    lastTrial = d;
    const badge = qs('lgTrialBadge');
    badge.textContent = d.balanced ? '합계 일치' : '합계 불일치';
    badge.style.color = d.balanced ? '#15803d' : 'var(--danger)';
    const carry = d.carryForward
      ? `<tr><td class="num">${d.carryForward < 0 ? won(-d.carryForward) : ''}</td><td class="num">${d.carryForward < 0 ? won(-d.carryForward) : ''}</td>
          <td>전기 운영성과</td>
          <td class="num">${d.carryForward > 0 ? won(d.carryForward) : ''}</td><td class="num">${d.carryForward > 0 ? won(d.carryForward) : ''}</td></tr>` : '';
    box.innerHTML = `
      <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">${esc(d.period.from)} ~ ${esc(d.period.to)}${d.period.closedThrough ? ` · ${esc(d.period.closedThrough)}까지 마감` : ''}</div>
      <table class="data-table" style="width:100%">
        <thead><tr><th class="num">차변 잔액</th><th class="num">차변 합계</th><th style="text-align:center">계정과목</th><th class="num">대변 합계</th><th class="num">대변 잔액</th></tr></thead>
        <tbody>
          ${(d.rows || []).map(r => `<tr>
            <td class="num">${r.debitBalance ? won(r.debitBalance) : ''}</td>
            <td class="num">${r.debitTotal ? won(r.debitTotal) : ''}</td>
            <td style="text-align:center">${esc(r.name)}</td>
            <td class="num">${r.creditTotal ? won(r.creditTotal) : ''}</td>
            <td class="num">${r.creditBalance ? won(r.creditBalance) : ''}</td>
          </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">승인된 전표가 없습니다.</td></tr>'}
          ${carry}
          <tr style="font-weight:600">
            <td class="num">${won(d.totals.debitBalance)}</td><td class="num">${won(d.totals.debitTotal)}</td>
            <td style="text-align:center">합계</td>
            <td class="num">${won(d.totals.creditTotal)}</td><td class="num">${won(d.totals.creditBalance)}</td>
          </tr>
        </tbody>
      </table>`;
  }
  function exportTrial() {
    if (!lastTrial) return;
    const d = lastTrial;
    const rows = [['코드', '계정과목', '구분', '차변 합계', '대변 합계', '차변 잔액', '대변 잔액']];
    (d.rows || []).forEach(r => rows.push([r.code, r.name, KIND_LABEL[r.kind] || r.kind, r.debitTotal, r.creditTotal, r.debitBalance, r.creditBalance]));
    rows.push(['', '합계', '', d.totals.debitTotal, d.totals.creditTotal, d.totals.debitBalance, d.totals.creditBalance]);
    downloadCsv(`시산표_${d.period.to}.csv`, rows);
  }

  /* ── 자금 연결 ── */
  let flowData = null;
  async function renderFlow() {
    const el = qs('lgFlow');
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', '/api/admin-ledger-flow');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:12px;white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const d = dataOf(res);
    flowData = d;
    const sync = d.sync || {};
    const labels = d.sourceLabels || {};
    const bySource = Object.keys(sync.bySource || {}).map(k => `${esc(labels[k] || k)} ${sync.bySource[k]}건`).join(', ');
    const bank = d.bank || {};
    const diff = bank.difference;
    const card = (label, value, note, warn) => `
      <div style="flex:1;min-width:170px;border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-size:12px;color:var(--text-3)">${label}</div>
        <div style="font-size:19px;font-weight:700;margin-top:4px${warn ? ';color:#b45309' : ''}">${value}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px;min-height:16px">${note}</div>
      </div>`;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <div style="font-size:13px;color:var(--text-2);flex:1">후원, 수입, 지출, 급여, 정산 입금을 매일 새벽 3시에 장부로 옮깁니다. 장부 시작일 ${esc(d.ledgerStart || '')} 이후 건만 대상입니다.</div>
        <button class="btn-sm btn-sm-primary" type="button" id="lgFlowSync">지금 반영</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        ${card('장부 미반영', `${sync.total || 0}건`, bySource || (sync.lastRun ? `마지막 반영 ${esc(sync.lastRun.at)}` : '반영 기록 없음'), (sync.total || 0) > 0)}
        ${card('분류 대기 전표', `${sync.drafts || 0}건`, '활동·사업·재원을 채워 제출해 주세요', (sync.drafts || 0) > 0)}
        ${card('마감된 달 미반영', `${sync.blocked || 0}건`, '마감을 해제해야 반영됩니다', (sync.blocked || 0) > 0)}
        ${card('장부 통장 잔액', `${won(bank.bookBalance)}원`, bank.bankBalance == null ? '우리은행 파일 업로드 전' : `통장 ${won(bank.bankBalance)}원 (${esc(bank.asOf)})`, false)}
        ${card('통장과 차이', diff == null ? '—' : `${won(diff)}원`, diff ? '미처리 거래를 확인해 주세요' : '', !!diff)}
        ${card('결제 정산 미수금', `${won(d.settlement)}원`, '정산 전 금액 또는 수수료', false)}
      </div>

      <div style="font-weight:600;margin-bottom:6px">미지급 결재</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">승인됐지만 아직 돈이 나가지 않은 결재입니다. 지급 확인을 해야 손익과 예산 집행에 반영됩니다.</div>
      <table class="data-table" style="width:100%;margin-bottom:18px">
        <thead><tr><th>결의번호</th><th>제목</th><th>지급처</th><th>예산 과목</th><th>승인일</th><th class="num">금액</th><th></th></tr></thead>
        <tbody>${(d.unpaid || []).map(r => `<tr>
          <td style="white-space:nowrap">${esc(r.resolutionNo || r.requestNo)}</td>
          <td>${esc(r.title)}</td><td>${esc(r.payeeName || '—')}</td><td>${esc(r.budgetName || '—')}</td>
          <td style="white-space:nowrap">${esc(r.decidedOn || '')}</td>
          <td class="num" style="white-space:nowrap">${won(r.amount)}원</td>
          <td style="text-align:right"><button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_LEDGER.openPay(${r.id})">지급 확인</button></td>
        </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-3)">미지급 결재가 없습니다.</td></tr>'}</tbody>
      </table>

      ${(d.refunds || []).length ? `<div style="font-weight:600;margin-bottom:6px">반환 확인 대기</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">지급한 뒤 취소된 결재입니다. 집행액은 그대로이고, 실제로 돈이 돌아온 것을 확인해야 줄어듭니다.</div>
      <table class="data-table" style="width:100%;margin-bottom:18px">
        <thead><tr><th>결의번호</th><th>제목</th><th>지급처</th><th>지급일</th><th class="num">금액</th><th></th></tr></thead>
        <tbody>${d.refunds.map(r => `<tr>
          <td style="white-space:nowrap">${esc(r.resolutionNo || '')}</td><td>${esc(r.title)}</td><td>${esc(r.payeeName || '—')}</td>
          <td style="white-space:nowrap">${esc(r.paidOn || '')}</td><td class="num" style="white-space:nowrap">${won(r.amount)}원</td>
          <td style="text-align:right"><button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_LEDGER.openRefund(${r.id})">반환 확인</button></td>
        </tr>`).join('')}</tbody>
      </table>` : ''}

      <div style="font-weight:600;margin-bottom:6px">결재 없는 출금</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">통장에서 나갔지만 결재나 지출과 연결되지 않은 거래입니다. 수수료처럼 결재 없이 처리할 건은 통장 화면에서 전표로 만듭니다.</div>
      <table class="data-table" style="width:100%;margin-bottom:18px">
        <thead><tr><th>날짜</th><th>내용</th><th>상대</th><th>전표</th><th class="num">금액</th></tr></thead>
        <tbody>${(d.noApproval || []).map(r => `<tr>
          <td style="white-space:nowrap">${esc(r.date)}</td><td>${esc(r.description)}</td><td>${esc(r.counterpart || '—')}</td>
          <td>${r.voucherNumber ? esc(r.voucherNumber) : '<span style="color:#b45309">없음</span>'}</td>
          <td class="num" style="white-space:nowrap">${won(r.amount)}원</td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">없습니다.</td></tr>'}</tbody>
      </table>

      <div style="font-weight:600;margin-bottom:6px">결재 없는 지출</div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>날짜</th><th>내용</th><th>지급처</th><th class="num">금액</th></tr></thead>
        <tbody>${(d.directExpenses || []).map(r => `<tr>
          <td style="white-space:nowrap">${esc(r.date)}</td><td>${esc(r.description || '')}</td><td>${esc(r.payeeName || '—')}</td>
          <td class="num" style="white-space:nowrap">${won(r.amount)}원</td>
        </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">없습니다.</td></tr>'}</tbody>
      </table>`;
    qs('lgFlowSync').addEventListener('click', runSync);
  }

  async function runSync() {
    const btn = qs('lgFlowSync');
    btn.disabled = true;
    btn.textContent = '반영 중…';
    const res = await api('POST', '/api/admin-ledger-sync');
    if (!res.ok) { alert(failText(res)); btn.disabled = false; btn.textContent = '지금 반영'; return; }
    const d = dataOf(res);
    alert(`자동 승인 ${d.posted || 0}건, 분류 대기 ${d.drafts || 0}건, 취소 ${d.reversed || 0}건${d.blocked ? `, 마감된 달 미반영 ${d.blocked}건` : ''}`);
    renderFlow();
  }

  function openPay(id) {
    const r = (flowData?.unpaid || []).find(x => x.id === id);
    if (!r) return;
    const cash = masters.accounts.filter(a => a.isActive && a.parentCode === '101');
    const matches = (flowData?.noApproval || []).filter(t => t.status === 'pending' && !t.voucherId);
    const sorted = [...matches].sort((a, b) => Number(b.amount === r.amount) - Number(a.amount === r.amount));
    const today = typeof todayKST === 'function' ? todayKST() : new Date().toISOString().slice(0, 10);
    openModal('지급 확인', `
      <div style="font-size:13px;margin-bottom:10px">${esc(r.title)} · <strong>${won(r.amount)}원</strong></div>
      <label class="form-label">지급일</label>
      <input id="lgPayDate" class="input" type="date" value="${esc(today)}" style="margin-bottom:10px">
      <label class="form-label">지급 계좌</label>
      <select id="lgPayAccount" class="input" style="margin-bottom:10px">${cash.map(a =>
        `<option value="${esc(a.code)}"${a.systemRole === 'cash_default' ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <label class="form-label">통장 출금 연결 (선택)</label>
      <select id="lgPayBank" class="input">
        <option value="">연결 안 함</option>
        ${sorted.map(t => `<option value="${t.id}"${t.amount === r.amount ? ' style="font-weight:600"' : ''}>${esc(t.date)} ${won(t.amount)}원 ${esc(t.counterpart || t.description || '')}</option>`).join('')}
      </select>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px">
        <input id="lgPayEvidence" type="checkbox"> 지급 증빙을 확인했습니다
      </label>
      <div style="font-size:12px;color:var(--text-3);margin-top:6px">실제 지급액이 승인액과 다르면 체크하지 말고 정정하거나 취소 후 다시 기안합니다.</div>
    `, () => api('POST', '/api/admin-approval-pay', {
      requestId: id, paidAt: qs('lgPayDate').value, payAccountCode: qs('lgPayAccount').value,
      evidenceChecked: qs('lgPayEvidence').checked,
      bankTxnId: qs('lgPayBank').value ? Number(qs('lgPayBank').value) : undefined,
    }), renderFlow);
  }

  function openRefund(id) {
    const r = (flowData?.refunds || []).find(x => x.id === id);
    if (!r) return;
    openModal('반환 확인', `
      <div style="font-size:13px;margin-bottom:10px">${esc(r.title)} · 지급액 <strong>${won(r.amount)}원</strong></div>
      <label class="form-label">실제 돌아온 금액</label>
      <input id="lgRefundAmount" class="input" type="number" min="0" value="${r.amount}" style="margin-bottom:10px">
      <label class="form-label">메모 (돌아오지 않았으면 사유 필수)</label>
      <input id="lgRefundNote" class="input" maxlength="300">
    `, () => api('POST', '/api/admin-approval-refund', {
      requestId: id, refundAmount: Number(qs('lgRefundAmount').value), note: qs('lgRefundNote').value,
    }), renderFlow);
  }

  /* ── 월 마감 ── */
  async function renderClose() {
    const el = qs('lgClose');
    if (!el.dataset.ready) {
      el.dataset.ready = '1';
      el.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <select id="lgCloseYear" class="input-sm" style="width:110px">${yearOptions(defaultYear())}</select>
          <span id="lgCloseInfo" style="font-size:13px;color:var(--text-2)"></span>
        </div>
        <div id="lgCloseResult"></div>`;
      qs('lgCloseYear').addEventListener('change', loadClose);
    }
    loadClose();
  }

  async function loadClose() {
    const box = qs('lgCloseResult');
    const year = Number(qs('lgCloseYear').value);
    box.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', `/api/admin-ledger-close?year=${year}`);
    if (!res.ok) { box.innerHTML = `<div style="color:var(--danger);padding:12px;white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const d = dataOf(res);
    const fy = d.fiscalYear;
    qs('lgCloseInfo').textContent = `장부 기간 ${fy.startDate} ~ ${fy.endDate}${fy.closedThrough ? ` · ${fy.closedThrough}까지 마감` : ''}`;
    const nextOpen = (d.months || []).find(m => !m.closed);
    const lastClosed = [...(d.months || [])].reverse().find(m => m.closed);
    box.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead><tr><th>달</th><th>상태</th><th class="num">미결 전표</th><th class="num">미확인 통장 거래</th><th></th></tr></thead>
        <tbody>
          ${(d.months || []).map(m => {
            let action = '';
            if (!m.closed && nextOpen && m.month === nextOpen.month && canManage()) {
              action = `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_LEDGER.closeMonth(${year},${m.month})">마감</button>`;
            } else if (m.closed && lastClosed && m.month === lastClosed.month && isChair()) {
              action = `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.reopenMonth(${year},${m.month})">해제</button>`;
            } else if (!m.closed) {
              action = '<span style="font-size:12px;color:var(--text-3)">이전 달 마감 후 가능</span>';
            }
            return `<tr>
              <td>${m.month}월</td>
              <td>${m.closed ? '마감됨' : '열림'}</td>
              <td class="num"${m.openVouchers ? ' style="color:var(--danger);font-weight:600"' : ''}>${m.openVouchers}건</td>
              <td class="num">${m.pendingBankTxn}건</td>
              <td style="white-space:nowrap">${action}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${(d.suspense || []).length ? `<div style="margin-top:12px;font-size:13px;color:#b45309">결산 전에 정리해야 할 임시 계정: ${d.suspense.map(s => `${esc(s.name)} ${won(s.amount)}원`).join(', ')}</div>` : ''}`;
  }

  async function closeMonth(year, month) {
    if (!confirm(`${year}년 ${month}월을 마감할까요? 마감한 달의 전표는 승인할 수 없습니다.`)) return;
    const res = await api('POST', '/api/admin-ledger-close', { action: 'close', year, month });
    if (!res.ok) { alert(failText(res)); return; }
    const warnings = dataOf(res).warnings || [];
    if (warnings.length) alert('마감했습니다. 확인할 내용이 있습니다.\n' + warnings.map(w => '· ' + w.message).join('\n'));
    loadClose();
  }
  async function reopenMonth(year, month) {
    const reason = prompt(`${year}년 ${month}월 마감을 해제합니다. 사유를 입력해 주세요.`);
    if (!reason || !reason.trim()) return;
    const res = await api('POST', '/api/admin-ledger-close', { action: 'reopen', year, month, reason: reason.trim() });
    if (!res.ok) { alert(failText(res)); return; }
    loadClose();
  }

  /* ── 기준 정보 ── */
  function renderMasters() {
    const el = qs('lgMasters');
    const tabs = [['accounts', '계정과목표'], ['programs', '사업'], ['funds', '재원'], ['revenue', '수입 분류'], ['rules', '배분 규칙'], ['staff', '인건비 배부'], ['years', '회계연도']];
    el.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${tabs.map(([k, label]) => `<button type="button" class="btn-sm ${k === masterTab ? 'btn-sm-primary' : 'btn-sm-ghost'}" data-master="${k}">${label}</button>`).join('')}
      </div>
      <div id="lgMasterBody"></div>`;
    el.querySelectorAll('[data-master]').forEach(b => b.addEventListener('click', () => {
      masterTab = b.dataset.master;
      renderMasters();
    }));
    if (masterTab === 'accounts') renderAccounts();
    if (masterTab === 'programs') renderPrograms();
    if (masterTab === 'funds') renderFunds();
    if (masterTab === 'revenue') renderRevenueMap();
    if (masterTab === 'rules') renderRules();
    if (masterTab === 'staff') renderStaff();
    if (masterTab === 'years') renderYears();
  }

  function renderAccounts() {
    const body = qs('lgMasterBody');
    const groups = ['asset', 'liability', 'net_asset', 'revenue', 'expense'];
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-2);flex:1">공익법인회계기준에 맞춘 계정과목표입니다. 굵은 줄은 묶음이라 전표에 쓸 수 없습니다.</div>
        ${canManage() ? '<button class="btn-sm btn-sm-primary" type="button" id="lgAcctAdd">+ 계정과목 추가</button>' : ''}
      </div>
      ${groups.map(kind => {
        const list = masters.accounts.filter(a => a.kind === kind);
        return `<div style="font-weight:600;margin:14px 0 6px">${KIND_LABEL[kind]}</div>
          <table class="data-table" style="width:100%">
            <thead><tr><th style="width:80px">코드</th><th>이름</th><th>성격</th><th>활동 기본값</th><th>상태</th><th></th></tr></thead>
            <tbody>${list.map(a => `<tr${a.hasChildren ? ' style="font-weight:600"' : ''}>
              <td style="font-family:monospace">${esc(a.code)}</td>
              <td>${esc(a.name)}${a.statementLine === 'suspense' ? ' <span style="font-size:11px;color:#b45309">결산 전 정리</span>' : ''}</td>
              <td>${esc(NATURE_LABEL[a.nature] || '')}</td>
              <td>${esc(FN_LABEL[a.defaultFunction] || '')}</td>
              <td>${a.isActive ? '' : '<span style="color:var(--text-3)">사용 안 함</span>'}</td>
              <td style="text-align:right">${canManage() ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.editAccount(${a.id})">수정</button>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table>`;
      }).join('')}`;
    qs('lgAcctAdd')?.addEventListener('click', () => editAccount(0));
  }

  function editAccount(id) {
    const a = id ? masters.accounts.find(x => x.id === id) : null;
    const parents = masters.accounts.filter(x => !x.parentCode);
    const category = a?.category || 'admin_ops';
    openModal(a ? '계정과목 수정' : '계정과목 추가', `
      <label class="form-label">코드</label>
      <input id="lgAcCode" class="input" value="${esc(a?.code || '')}" ${a ? 'disabled' : ''} placeholder="숫자 2~20자리" style="margin-bottom:10px">
      <label class="form-label">이름</label>
      <input id="lgAcName" class="input" value="${esc(a?.name || '')}" style="margin-bottom:10px">
      <label class="form-label">분류</label>
      <select id="lgAcCategory" class="input" style="margin-bottom:10px"${a?.used ? ' disabled' : ''}>
        ${Object.keys(CATEGORY_LABEL).map(k => `<option value="${k}"${k === category ? ' selected' : ''}>${esc(CATEGORY_LABEL[k])}</option>`).join('')}
      </select>
      <label class="form-label">상위 계정</label>
      <select id="lgAcParent" class="input" style="margin-bottom:10px">
        <option value="">상위 없음 (묶음)</option>
        ${parents.map(p => `<option value="${esc(p.code)}"${p.code === a?.parentCode ? ' selected' : ''}>${esc(p.code)} ${esc(p.name)}</option>`).join('')}
      </select>
      <label class="form-label">비용 성격</label>
      <select id="lgAcNature" class="input" style="margin-bottom:10px">
        <option value="">해당 없음</option>
        ${Object.keys(NATURE_LABEL).map(k => `<option value="${k}"${k === a?.nature ? ' selected' : ''}>${NATURE_LABEL[k]}</option>`).join('')}
      </select>
      <label class="form-label">활동 기본값</label>
      <select id="lgAcFn" class="input" style="margin-bottom:10px">
        <option value="">직접 선택</option>
        ${Object.keys(FN_LABEL).map(k => `<option value="${k}"${k === a?.defaultFunction ? ' selected' : ''}>${FN_LABEL[k]}</option>`).join('')}
      </select>
      ${a ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="lgAcActive"${a.isActive ? ' checked' : ''}> 사용</label>` : ''}
    `, () => {
      const body = {
        name: qs('lgAcName').value.trim(),
        category: qs('lgAcCategory').value,
        parentCode: qs('lgAcParent').value || null,
        nature: qs('lgAcNature').value || null,
        defaultFunction: qs('lgAcFn').value || null,
      };
      if (a) return api('POST', '/api/admin-account-code-update', { ...body, id: a.id, isActive: qs('lgAcActive').checked });
      return api('POST', '/api/admin-account-code-create', { ...body, code: qs('lgAcCode').value.trim() });
    });
  }

  function renderPrograms() {
    const body = qs('lgMasterBody');
    const gap = masters.charterGap;
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-2);flex:1">공시 서식은 정관에 기재된 사업을 공익목적사업으로 봅니다. 정관 근거가 없는 사업은 표시해 둡니다.</div>
        ${canManage() ? '<button class="btn-sm btn-sm-primary" type="button" id="lgProgramAdd">+ 사업 추가</button>' : ''}
      </div>
      ${gap && gap.total > 0 ? `<div style="font-size:13px;margin-bottom:10px;padding:8px 10px;border:1px solid var(--border);border-radius:6px">
        올해 사업수행비용 ${won(gap.total)}원 중 정관 근거가 없는 사업 ${won(gap.outside)}원 (${gap.outsideRate}%)</div>` : ''}
      <table class="data-table" style="width:100%">
        <thead><tr><th>코드</th><th>사업</th><th>정관 근거</th><th>공시 코드</th><th>부문</th><th>상태</th><th></th></tr></thead>
        <tbody>${masters.programs.map(p => `<tr>
          <td style="font-family:monospace">${esc(p.code)}</td>
          <td>${esc(p.name)}</td>
          <td>${p.charterRef ? esc(p.charterRef) : '<span style="color:#b45309">정관 근거 없음</span>'}</td>
          <td>${esc(p.disclosureCode || '')}</td>
          <td>${p.segment === 'other' ? '기타사업' : '공익목적사업'}</td>
          <td>${p.isActive ? '사용' : '<span style="color:var(--text-3)">숨김</span>'}</td>
          <td style="text-align:right">${canManage() ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.editProgram(${p.id})">수정</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    qs('lgProgramAdd')?.addEventListener('click', () => editProgram(0));
  }

  function editProgram(id) {
    const p = id ? masters.programs.find(x => x.id === id) : null;
    openModal(p ? '사업 수정' : '사업 추가', `
      <label class="form-label">코드</label>
      <input id="lgPgCode" class="input" value="${esc(p?.code || '')}" ${p ? 'disabled' : ''} placeholder="예: P09" style="margin-bottom:10px">
      <label class="form-label">사업 이름</label>
      <input id="lgPgName" class="input" value="${esc(p?.name || '')}" style="margin-bottom:10px">
      <label class="form-label">정관 근거</label>
      <input id="lgPgCharter" class="input" value="${esc(p?.charterRef || '')}" placeholder="예: 제4조 1호. 없으면 비워 둡니다" style="margin-bottom:10px">
      <label class="form-label">공시 사업 코드</label>
      <input id="lgPgDisclosure" class="input" value="${esc(p?.disclosureCode || '')}" placeholder="예: 2300" style="margin-bottom:10px">
      <label class="form-label">부문</label>
      <select id="lgPgSegment" class="input" style="margin-bottom:10px">
        <option value="public"${p?.segment !== 'other' ? ' selected' : ''}>공익목적사업</option>
        <option value="other"${p?.segment === 'other' ? ' selected' : ''}>기타사업</option>
      </select>
      <label class="form-label">설명</label>
      <textarea id="lgPgDesc" class="input" rows="2" style="margin-bottom:10px">${esc(p?.description || '')}</textarea>
      ${p ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="lgPgActive"${p.isActive ? ' checked' : ''}> 사용 (끄면 작성 창에서 숨겨집니다)</label>` : ''}
    `, () => api('POST', '/api/admin-ledger-master-save', {
      type: 'program', id: p?.id, code: qs('lgPgCode').value.trim(), name: qs('lgPgName').value.trim(),
      charterRef: qs('lgPgCharter').value.trim(), disclosureCode: qs('lgPgDisclosure').value.trim(),
      segment: qs('lgPgSegment').value, description: qs('lgPgDesc').value.trim(),
      isActive: p ? qs('lgPgActive').checked : true,
    }));
  }

  function renderFunds() {
    const body = qs('lgMasterBody');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-2);flex:1">재원은 어떤 돈으로 들어오고 쓰였는지 구분합니다. 후원회원 후원금은 기부금, 유가족·일반회원 회비는 회비입니다.</div>
        ${canManage() ? '<button class="btn-sm btn-sm-primary" type="button" id="lgFundAdd">+ 재원 추가</button>' : ''}
      </div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>코드</th><th>재원</th><th>사용 제한</th><th>상태</th><th></th></tr></thead>
        <tbody>${masters.funds.map(f => `<tr>
          <td style="font-family:monospace">${esc(f.code)}</td>
          <td>${esc(f.name)}</td>
          <td>${f.restricted ? '있음' : '없음'}</td>
          <td>${f.isActive ? '사용' : '<span style="color:var(--text-3)">숨김</span>'}</td>
          <td style="text-align:right">${canManage() ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.editFund(${f.id})">수정</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    qs('lgFundAdd')?.addEventListener('click', () => editFund(0));
  }

  function editFund(id) {
    const f = id ? masters.funds.find(x => x.id === id) : null;
    openModal(f ? '재원 수정' : '재원 추가', `
      <label class="form-label">코드</label>
      <input id="lgFdCode" class="input" value="${esc(f?.code || '')}" ${f ? 'disabled' : ''} placeholder="예: F06" style="margin-bottom:10px">
      <label class="form-label">재원 이름</label>
      <input id="lgFdName" class="input" value="${esc(f?.name || '')}" style="margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:8px"><input type="checkbox" id="lgFdRestricted"${f?.restricted ? ' checked' : ''}> 용도가 정해진 돈</label>
      ${f && !f.isSystem ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="lgFdActive"${f.isActive ? ' checked' : ''}> 사용 (끄면 작성 창에서 숨겨집니다)</label>` : ''}
    `, () => api('POST', '/api/admin-ledger-master-save', {
      type: 'fund', id: f?.id, code: qs('lgFdCode').value.trim(), name: qs('lgFdName').value.trim(),
      restricted: qs('lgFdRestricted').checked,
      isActive: f && !f.isSystem ? qs('lgFdActive').checked : true,
    }));
  }

  function renderRevenueMap() {
    const body = qs('lgMasterBody');
    const revenue = masters.accounts.filter(a => a.kind === 'revenue' && !a.hasChildren && a.isActive);
    body.innerHTML = `
      <div style="font-size:13px;color:var(--text-2);margin-bottom:10px">후원 외 수입이 승인되면 분류에 연결된 계정으로 장부에 기록됩니다.</div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>수입 분류</th><th>계정과목</th></tr></thead>
        <tbody>${masters.revenueCategories.map(c => `<tr>
          <td>${esc(c.name)}</td>
          <td><select class="input-sm" style="width:260px" ${canManage() ? '' : 'disabled'} onchange="window.SIREN_LEDGER.saveRevenueMap(${c.id}, this.value)">
            <option value="">선택</option>
            ${revenue.map(a => `<option value="${esc(a.code)}"${a.code === c.accountCode ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select></td>
        </tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-3)">수입 분류가 없습니다.</td></tr>'}</tbody>
      </table>`;
  }
  async function saveRevenueMap(id, accountCode) {
    if (!accountCode) return;
    const res = await api('POST', '/api/admin-ledger-master-save', { type: 'revenue_category', id, accountCode });
    if (!res.ok) { alert(failText(res)); return; }
    await loadMasters();
  }

  function renderRules() {
    const body = qs('lgMasterBody');
    const describe = r => (r.lines || []).map(l => `${FN_LABEL[l.functionCode] || ''}${l.programId ? ' ' + (masters.programs.find(p => p.id === Number(l.programId))?.name || '') : ''} ${l.ratio}%`).join(', ');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-2);flex:1">임차료나 인건비처럼 여러 활동에 걸친 비용을 나누는 기준입니다. 업무시간, 사용 면적처럼 합리적인 기준을 적고 같은 기준을 계속 씁니다(회계기준 제30조). 규칙은 주석에 표시됩니다.</div>
        ${canManage() ? '<button class="btn-sm btn-sm-primary" type="button" id="lgRuleAdd">+ 규칙 추가</button>' : ''}
      </div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>이름</th><th>기준</th><th>배분</th><th>사용</th><th></th></tr></thead>
        <tbody>${masters.allocationRules.map(r => `<tr>
          <td>${esc(r.name)}</td><td>${esc(r.basis)}</td><td>${esc(describe(r))}</td><td>${r.isActive ? '사용' : '숨김'}</td>
          <td style="text-align:right">${canManage() ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.editRule(${r.id})">수정</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">등록된 규칙이 없습니다.</td></tr>'}</tbody>
      </table>`;
    qs('lgRuleAdd')?.addEventListener('click', () => editRule(0));
  }
  function ruleLineHtml(l) {
    return `<div class="lg-rule-line" style="display:flex;gap:6px;margin-bottom:6px">
      <select class="input lg-rl-fn" style="flex:1">${Object.keys(FN_LABEL).map(k => `<option value="${k}"${k === l.functionCode ? ' selected' : ''}>${FN_LABEL[k]}</option>`).join('')}</select>
      <select class="input lg-rl-pg" style="flex:1"><option value="">사업 없음</option>${masters.programs.filter(p => p.isActive).map(p => `<option value="${p.id}"${p.id === Number(l.programId) ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <input class="input lg-rl-ratio" type="number" min="0" max="100" step="0.1" value="${esc(l.ratio ?? '')}" placeholder="%" style="width:80px">
    </div>`;
  }
  function editRule(id) {
    const r = masters.allocationRules.find(x => x.id === id) || { name: '', basis: '', lines: [], isActive: true };
    const lines = r.lines.length ? r.lines : [{ functionCode: 'admin', ratio: 60 }, { functionCode: 'service', ratio: 40 }];
    openModal(id ? '배분 규칙 수정' : '배분 규칙 추가', `
      <label class="form-label">이름</label><input id="lgRlName" class="input" maxlength="120" value="${esc(r.name)}" style="margin-bottom:10px">
      <label class="form-label">기준</label><input id="lgRlBasis" class="input" maxlength="300" value="${esc(r.basis)}" placeholder="예: 최근 3개월 업무시간 비율" style="margin-bottom:10px">
      <label class="form-label">배분 (합계 100)</label>
      <div id="lgRlLines">${lines.map(ruleLineHtml).join('')}</div>
      <button class="btn-sm btn-sm-ghost" type="button" id="lgRlAdd" style="margin-bottom:10px">+ 줄 추가</button>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input id="lgRlActive" type="checkbox"${r.isActive ? ' checked' : ''}> 사용</label>
    `, () => api('POST', '/api/admin-ledger-docs', {
      type: 'rule', id: id || undefined, name: qs('lgRlName').value, basis: qs('lgRlBasis').value,
      isActive: qs('lgRlActive').checked,
      lines: [...document.querySelectorAll('#lgRlLines .lg-rule-line')].map(el => ({
        functionCode: el.querySelector('.lg-rl-fn').value,
        programId: el.querySelector('.lg-rl-pg').value ? Number(el.querySelector('.lg-rl-pg').value) : null,
        ratio: Number(el.querySelector('.lg-rl-ratio').value),
      })),
    }));
    qs('lgRlAdd').addEventListener('click', () => qs('lgRlLines').insertAdjacentHTML('beforeend', ruleLineHtml({ functionCode: 'service' })));
  }

  function renderStaff() {
    const body = qs('lgMasterBody');
    body.innerHTML = `
      <div style="font-size:13px;color:var(--text-2);margin-bottom:10px">협의회 소속 직원의 급여만 지급 확정 때 전표가 됩니다. 완료된 근로계약이 있으면 그 사업자로 판단합니다. 계약이 없는 직원은 여기서 배부를 저장해야 장부에 들어갑니다. 정하지 않은 항목은 일반관리, 기부금으로 기록합니다.</div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>직원</th><th>고용 주체</th><th>장부 반영</th><th>활동</th><th>사업</th><th>재원</th><th>배분 규칙</th><th></th></tr></thead>
        <tbody>${masters.staff.map(m => `<tr>
          <td>${esc(m.name)}</td>
          <td>${esc(m.employer || '계약 없음')}</td>
          <td>${m.inLedger ? '반영' : '제외'}</td>
          <td>${esc(FN_LABEL[m.functionCode] || '일반관리 (기본)')}</td>
          <td>${esc(masters.programs.find(p => p.id === m.programId)?.name || '')}</td>
          <td>${esc(masters.funds.find(f => f.id === m.fundId)?.name || '')}</td>
          <td>${esc(masters.allocationRules.find(r => r.id === m.ruleId)?.name || '')}</td>
          <td style="text-align:right">${canManage() ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.editStaff(${m.memberId})">수정</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">직원이 없습니다.</td></tr>'}</tbody>
      </table>`;
  }
  function editStaff(memberId) {
    const m = masters.staff.find(x => x.memberId === memberId);
    if (!m) return;
    openModal(`${m.name} 인건비 배부`, `
      <label class="form-label">활동</label>
      <select id="lgStFn" class="input" style="margin-bottom:10px">
        ${Object.keys(FN_LABEL).map(k => `<option value="${k}"${k === (m.functionCode || 'admin') ? ' selected' : ''}>${FN_LABEL[k]}</option>`).join('')}
      </select>
      <label class="form-label">사업 (사업수행일 때)</label>
      <select id="lgStPg" class="input" style="margin-bottom:10px">
        <option value="">선택</option>
        ${masters.programs.filter(p => p.isActive).map(p => `<option value="${p.id}"${p.id === m.programId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <label class="form-label">재원</label>
      <select id="lgStFd" class="input" style="margin-bottom:10px">
        <option value="">기부금 (기본)</option>
        ${masters.funds.filter(f => f.isActive).map(f => `<option value="${f.id}"${f.id === m.fundId ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
      </select>
      <label class="form-label">배분 규칙 (고르면 위 활동·사업 대신 비율로 나눕니다)</label>
      <select id="lgStRule" class="input">
        <option value="">쓰지 않음</option>
        ${masters.allocationRules.filter(r => r.isActive).map(r => `<option value="${r.id}"${r.id === m.ruleId ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}
      </select>
    `, () => api('POST', '/api/admin-ledger-master-save', {
      type: 'staff', memberId, functionCode: qs('lgStFn').value,
      programId: qs('lgStPg').value ? Number(qs('lgStPg').value) : undefined,
      fundId: qs('lgStFd').value ? Number(qs('lgStFd').value) : undefined,
      ruleId: qs('lgStRule').value ? Number(qs('lgStRule').value) : undefined,
    }));
  }

  function renderYears() {
    const body = qs('lgMasterBody');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-2);flex:1">정관 제32조에 따라 회계연도는 1월 1일부터 12월 31일까지입니다. 2026년은 장부 시작일부터 기록합니다.</div>
        ${isChair() ? '<button class="btn-sm btn-sm-primary" type="button" id="lgYearAdd">+ 회계연도 추가</button>' : ''}
      </div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>연도</th><th>시작일</th><th>종료일</th><th>마감일</th><th>상태</th><th></th></tr></thead>
        <tbody>${masters.fiscalYears.map(f => `<tr>
          <td>${f.year}</td><td>${esc(f.startDate)}</td><td>${esc(f.endDate)}</td>
          <td>${esc(f.closedThrough || '')}</td><td>${f.status === 'open' ? '진행' : '결산 완료'}</td>
          <td style="text-align:right">${isChair() && f.status === 'open' ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_LEDGER.editYear(${f.year})">수정</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    qs('lgYearAdd')?.addEventListener('click', () => editYear(0));
  }

  function editYear(year) {
    const f = year ? masters.fiscalYears.find(x => x.year === year) : null;
    const next = f ? f.year : Math.max(...masters.fiscalYears.map(x => x.year), new Date().getFullYear()) + 1;
    openModal(f ? `${f.year}년 수정` : '회계연도 추가', `
      <label class="form-label">연도</label>
      <input id="lgYrYear" class="input" type="number" value="${next}" ${f ? 'disabled' : ''} style="margin-bottom:10px">
      <label class="form-label">시작일</label>
      <input id="lgYrStart" class="input" type="date" value="${esc(f?.startDate || `${next}-01-01`)}" style="margin-bottom:10px">
      <label class="form-label">종료일</label>
      <input id="lgYrEnd" class="input" type="date" value="${esc(f?.endDate || `${next}-12-31`)}" style="margin-bottom:10px">
      <label class="form-label">변경 사유</label>
      <input id="lgYrReason" class="input" placeholder="이력에 남습니다">
    `, () => api('POST', '/api/admin-ledger-fiscal-year', {
      year: Number(qs('lgYrYear').value), startDate: qs('lgYrStart').value, endDate: qs('lgYrEnd').value,
      reason: qs('lgYrReason').value.trim(),
    }));
  }

  /* ── 변경 이력 ── */
  async function renderHistory() {
    const el = qs('lgHistory');
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', '/api/admin-ledger-history?limit=200');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:12px;white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const items = dataOf(res).items || [];
    el.innerHTML = `
      <div style="font-size:13px;color:var(--text-2);margin-bottom:10px">장부 변경 이력은 수정하거나 지울 수 없습니다. 최근 200건을 표시합니다.</div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>시각</th><th>대상</th><th>내용</th><th>작업자</th><th>사유</th></tr></thead>
        <tbody>${items.map(h => `<tr>
          <td style="white-space:nowrap">${esc(h.createdAt || '')}</td>
          <td>${esc(ENTITY_LABEL[h.entity] || h.entity)} ${esc(h.entityId)}</td>
          <td>${esc(ACTION_LABEL[h.action] || h.action)}</td>
          <td>${esc(h.actorName || '')}</td>
          <td>${esc(h.reason || '')}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">이력이 없습니다.</td></tr>'}</tbody>
      </table>`;
  }

  async function init() {
    const container = document.getElementById('page-ledger');
    if (!container) return;
    await loadRole();
    if (!container.querySelector('.panel')) {
      voucherReady = false;
      renderShell(container);
    }
    try {
      await loadMasters();
    } catch (err) {
      qs('lgVoucher').innerHTML = `<div style="color:var(--danger);padding:12px;white-space:pre-line">장부 기준 정보를 불러오지 못했습니다.\n${esc(err.message)}</div>`;
      return;
    }
    switchTab(currentTab);
  }

  window.SIREN_LEDGER = {
    init, load: init, closeMonth, reopenMonth, editAccount, editProgram, editFund, editYear,
    openPay, openRefund, saveRevenueMap, editStaff, editRule,
    viewVoucher: async id => {
      if (!voucherReady) { voucherReady = true; await window.SIREN_VOUCHER.initVoucherTab(qs('lgVoucher')); }
      window.SIREN_VOUCHER.openView(id);
    },
  };
})();
