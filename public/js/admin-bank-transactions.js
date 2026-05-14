/* admin-bank-transactions.js — Phase 22-D-R2: 통장 거래내역 자동화 + 입출금 대사
   화면: 업로드 / 대사 요약 / 거래 목록 / 관리자 확인 모달 / 거래처 마스터 / 설정
   데이터 API는 B 작성 — A는 호출·렌더만. 응답 키 다중 fallback. */
(function () {
  'use strict';

  /* ── 상태 ── */
  let currentTab   = 'transactions';  // transactions | counterparties
  let txnList      = [];
  let importList   = [];
  let cpList       = [];
  let summaryData  = null;
  let memberCandidates = {};          // { transactionId: [후보...] }

  /* ── API 헬퍼 ── */
  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  /* 응답 본문 다중 fallback */
  function unwrap(res) { return res.data?.data || res.data || {}; }
  function pickArr(res, key) {
    const d = res.data;
    return d?.data?.[key] || d?.[key] || d?.data || (Array.isArray(d) ? d : []) || [];
  }

  /* ── 포맷 ── */
  function fmtKRW(n) {
    if (n === null || n === undefined || n === '') return '0원';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function fmtSigned(n) {
    const v = Number(n) || 0;
    const s = Math.abs(v).toLocaleString('ko-KR') + '원';
    return v < 0 ? '−' + s : '+' + s;
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    return String(s).replace('T', ' ').slice(0, 19);
  }
  function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 매칭 상태 배지 (6종) ── */
  function matchBadge(matchType) {
    const map = {
      donation_batch: { label: '정산확인', color: '#0369a1', bg: '#e0f2fe' },
      donation:       { label: '후원매칭', color: '#15803d', bg: '#dcfce7' },
      voucher:        { label: '전표생성', color: '#7c3aed', bg: '#ede9fe' },
      revenue:        { label: '매출',     color: '#b45309', bg: '#fef3c7' },
      pending:        { label: '확인필요', color: '#b91c1c', bg: '#fee2e2' },
      ignored:        { label: '무시',     color: '#6b7280', bg: '#f3f4f6' },
    };
    const m = map[matchType] || { label: matchType || '미처리', color: '#6b7280', bg: '#f3f4f6' };
    return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;color:${m.color};background:${m.bg}">${m.label}</span>`;
  }

  /* ════════════════════════════════════════════════
     기간 선택기 (22-B-R1 공통 패턴)
  ════════════════════════════════════════════════ */
  function periodSelectorHtml() {
    return `
      <select id="btPeriodSel" class="input-sm" style="width:120px">
        <option value="day">오늘</option>
        <option value="week">이번 주</option>
        <option value="month" selected>이번 달</option>
        <option value="half_year">반기</option>
        <option value="year">올해</option>
        <option value="custom">특정 기간</option>
      </select>
      <div id="btCustomRange" style="display:none;align-items:center;gap:6px">
        <input type="date" id="btStartDate" class="input-sm">
        <span>~</span>
        <input type="date" id="btEndDate" class="input-sm">
      </div>
    `;
  }
  function getPeriodQs() {
    const sel    = document.getElementById('btPeriodSel');
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
      startDate = document.getElementById('btStartDate')?.value || '';
      endDate   = document.getElementById('btEndDate')?.value   || '';
    }
    return { period, startDate, endDate };
  }
  function bindPeriodSelector(onChange) {
    const sel = document.getElementById('btPeriodSel');
    if (sel) {
      sel.addEventListener('change', () => {
        const isCustom = sel.value === 'custom';
        const range = document.getElementById('btCustomRange');
        if (range) range.style.display = isCustom ? 'flex' : 'none';
        if (!isCustom) onChange();
      });
    }
    document.getElementById('btStartDate')?.addEventListener('change', onChange);
    document.getElementById('btEndDate')?.addEventListener('change', onChange);
  }

  /* ════════════════════════════════════════════════
     화면 셸
  ════════════════════════════════════════════════ */
  function renderShell(container) {
    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">🏦 통장 거래내역</div>
          <div class="p-actions">
            <button class="btn-sm btn-sm-ghost" id="btTabTxn" type="button">거래 목록</button>
            <button class="btn-sm btn-sm-ghost" id="btTabCp" type="button">거래처 마스터</button>
            <button class="btn-sm btn-sm-ghost" id="btSettingsBtn" type="button">⚙ 설정</button>
          </div>
        </div>

        <!-- ─── 거래 목록 뷰 ─── -->
        <div id="btViewTxn">
          <!-- 업로드 영역 -->
          <div id="btUploadZone" style="border:2px dashed var(--border,#d4d8e0);border-radius:12px;padding:24px;text-align:center;background:#fafbfc;margin-bottom:16px;cursor:pointer;transition:.2s">
            <div style="font-size:28px;margin-bottom:6px">📤</div>
            <div style="font-weight:600;margin-bottom:4px">IBK 기업은행 거래내역 엑셀을 끌어다 놓거나 클릭해서 업로드</div>
            <div style="font-size:12px;color:var(--text-3,#94a0b3)">.xlsx · .csv 지원 — 업로드 시 자동 파싱 + 입출금 대사 실행</div>
            <input type="file" id="btFileInput" accept=".xlsx,.xls,.csv" style="display:none">
          </div>
          <div id="btUploadStatus" style="margin-bottom:16px;display:none"></div>

          <!-- 대사 요약 -->
          <div id="btSummary" style="margin-bottom:18px"></div>

          <!-- 거래 목록 필터 -->
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            ${periodSelectorHtml()}
            <select id="btDirFilter" class="input-sm" style="width:110px">
              <option value="">입출 전체</option>
              <option value="in">입금</option>
              <option value="out">출금</option>
            </select>
            <select id="btMatchFilter" class="input-sm" style="width:130px">
              <option value="">매칭상태 전체</option>
              <option value="donation_batch">정산확인</option>
              <option value="donation">후원매칭</option>
              <option value="voucher">전표생성</option>
              <option value="revenue">매출</option>
              <option value="pending">확인필요</option>
              <option value="ignored">무시</option>
            </select>
            <button class="btn-sm btn-sm-primary" id="btReloadBtn" type="button">조회</button>
            <button class="btn-sm btn-sm-ghost" id="btReconcileBtn" type="button" style="margin-left:auto">🔄 대사 재실행</button>
          </div>

          <!-- 업로드 이력 (접이식) -->
          <details style="margin-bottom:12px">
            <summary style="cursor:pointer;font-size:13px;color:var(--text-2,#5b6577);font-weight:600">📋 업로드 이력</summary>
            <div id="btImportList" style="margin-top:8px"></div>
          </details>

          <!-- 거래 목록 테이블 -->
          <div id="btTxnList"></div>
        </div>

        <!-- ─── 거래처 마스터 뷰 ─── -->
        <div id="btViewCp" style="display:none">
          <div style="margin-bottom:12px;font-size:13px;color:var(--text-2,#5b6577)">
            한 번 분류한 거래처는 다음 업로드부터 자동 매핑됩니다. 분류 룰을 수정할 수 있습니다.
          </div>
          <div id="btCpList"></div>
        </div>
      </div>

      <!-- ─── 관리자 확인 모달 ─── -->
      <div id="btConfirmModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:520px">
          <div class="modal-head">
            <span class="modal-title" id="btConfirmTitle">거래 확인</span>
            <button class="modal-close" type="button" id="btConfirmCloseBtn">×</button>
          </div>
          <div class="modal-body" id="btConfirmBody"></div>
        </div>
      </div>

      <!-- ─── 거래처 수정 모달 ─── -->
      <div id="btCpModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:480px">
          <div class="modal-head">
            <span class="modal-title">거래처 분류 룰 수정</span>
            <button class="modal-close" type="button" id="btCpCloseBtn">×</button>
          </div>
          <div class="modal-body" id="btCpModalBody"></div>
        </div>
      </div>

      <!-- ─── 설정 모달 ─── -->
      <div id="btSettingsModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:420px">
          <div class="modal-head">
            <span class="modal-title">통장 대사 설정</span>
            <button class="modal-close" type="button" id="btSettingsCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <label class="form-label">AI 분류 신뢰도 임계값 (%)</label>
            <div style="font-size:12px;color:var(--text-3,#94a0b3);margin-bottom:6px">
              이 값 이상이면 전표가 자동 생성되고, 미만이면 관리자 확인 대기로 분류됩니다.
            </div>
            <input type="number" id="btThresholdInput" class="input" min="0" max="100" value="75">
            <div id="btSettingsError" style="color:var(--danger);font-size:13px;margin-top:6px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="btSettingsCancelBtn">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="btSettingsSaveBtn">저장</button>
          </div>
        </div>
      </div>
    `;

    /* 탭 전환 */
    document.getElementById('btTabTxn')?.addEventListener('click', () => switchTab('transactions'));
    document.getElementById('btTabCp')?.addEventListener('click', () => switchTab('counterparties'));
    document.getElementById('btSettingsBtn')?.addEventListener('click', openSettingsModal);

    /* 업로드 */
    const zone  = document.getElementById('btUploadZone');
    const input = document.getElementById('btFileInput');
    zone?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => { if (input.files?.length) uploadFile(input.files[0]); });
    zone?.addEventListener('dragover', e => { e.preventDefault(); zone.style.background = '#eef2ff'; zone.style.borderColor = 'var(--primary,#4f6df5)'; });
    zone?.addEventListener('dragleave', () => { zone.style.background = '#fafbfc'; zone.style.borderColor = 'var(--border,#d4d8e0)'; });
    zone?.addEventListener('drop', e => {
      e.preventDefault();
      zone.style.background = '#fafbfc'; zone.style.borderColor = 'var(--border,#d4d8e0)';
      const f = e.dataTransfer?.files?.[0];
      if (f) uploadFile(f);
    });

    /* 필터·조회 */
    document.getElementById('btReloadBtn')?.addEventListener('click', loadTransactions);
    document.getElementById('btReconcileBtn')?.addEventListener('click', runReconcile);
    bindPeriodSelector(loadTransactions);

    /* 모달 닫기 */
    document.getElementById('btConfirmCloseBtn')?.addEventListener('click', closeConfirmModal);
    document.getElementById('btCpCloseBtn')?.addEventListener('click', closeCpModal);
    document.getElementById('btSettingsCloseBtn')?.addEventListener('click', closeSettingsModal);
    document.getElementById('btSettingsCancelBtn')?.addEventListener('click', closeSettingsModal);
    document.getElementById('btSettingsSaveBtn')?.addEventListener('click', saveSettings);
  }

  /* ── 탭 전환 ── */
  function switchTab(tab) {
    currentTab = tab;
    const txnView = document.getElementById('btViewTxn');
    const cpView  = document.getElementById('btViewCp');
    const txnBtn  = document.getElementById('btTabTxn');
    const cpBtn   = document.getElementById('btTabCp');
    if (txnView) txnView.style.display = tab === 'transactions' ? '' : 'none';
    if (cpView)  cpView.style.display  = tab === 'counterparties' ? '' : 'none';
    if (txnBtn)  txnBtn.className = 'btn-sm ' + (tab === 'transactions' ? 'btn-sm-primary' : 'btn-sm-ghost');
    if (cpBtn)   cpBtn.className  = 'btn-sm ' + (tab === 'counterparties' ? 'btn-sm-primary' : 'btn-sm-ghost');
    if (tab === 'transactions') { loadSummary(); loadTransactions(); loadImportList(); }
    else loadCounterparties();
  }

  /* ════════════════════════════════════════════════
     IBK 엑셀 클라이언트 파싱 (설계서 §1 — SheetJS CDN)
     메타데이터가 상단에 흩어짐 → "거래일시" 헤더 셀 탐지 → 그 행부터 데이터
  ════════════════════════════════════════════════ */
  /* 콤마·공백 제거 후 숫자화 */
  function parseNum(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[,\s원]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  /* IBK 12컬럼 헤더 명칭 → 정규화 키 매핑 (헤더 텍스트는 공백 제거 후 비교) */
  const IBK_HEADER_MAP = {
    '거래일시': 'txnDate',
    '출금': 'withdraw',
    '출금금액': 'withdraw',
    '입금': 'deposit',
    '입금금액': 'deposit',
    '거래후잔액': 'balanceAfter',
    '잔액': 'balanceAfter',
    '거래내용': 'description',
    '상대계좌번호': 'counterpartAccount',
    '상대은행': 'counterpartBank',
    '메모': 'memo',
    '거래구분': 'txnMethod',
    '수표어음금액': 'noteAmount',
    'CMS코드': 'cmsCode',
    '상대계좌예금주명': 'counterpartName',
  };
  function normHeader(s) { return String(s == null ? '' : s).replace(/\s/g, ''); }

  /* 엑셀 파일 → { transactions:[...], meta:{...} } */
  async function parseIbkExcel(file) {
    if (typeof XLSX === 'undefined') {
      throw new Error('엑셀 파서(SheetJS)가 로드되지 않았습니다. 페이지를 새로고침해 주세요.');
    }
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.');
    /* 행 배열(셀 값 그대로) — 헤더 행을 직접 탐지 */
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

    /* 1) "거래일시" 헤더 셀이 있는 행 탐지 */
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      if (r.some(c => normHeader(c) === '거래일시')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('"거래일시" 헤더를 찾을 수 없습니다. IBK 기업은행 거래내역 엑셀이 맞는지 확인해 주세요.');

    /* 2) 헤더 행 → 컬럼 인덱스 매핑 */
    const headerRow = rows[headerIdx] || [];
    const colIdx = {};  // { 정규화키: 컬럼인덱스 }
    headerRow.forEach((cell, idx) => {
      const key = IBK_HEADER_MAP[normHeader(cell)];
      if (key && colIdx[key] === undefined) colIdx[key] = idx;
    });
    if (colIdx.txnDate === undefined) throw new Error('거래일시 컬럼을 인식하지 못했습니다.');

    /* 3) 메타데이터 추출 — 헤더 위쪽 행들에서 계좌번호·예금주명·조회기간 찾기 */
    const meta = { accountNo: '', accountHolder: '', periodStart: '', periodEnd: '' };
    const metaText = rows.slice(0, headerIdx).map(r => (r || []).join(' ')).join(' ');
    const acctM   = metaText.match(/(\d{2,4}-\d{2,6}-\d{2,4}-\d{2,4}|\d{10,16})/);
    if (acctM) meta.accountNo = acctM[1];
    const holderM = metaText.match(/예금주\s*명?\s*[:：]?\s*([^\s]+)/);
    if (holderM) meta.accountHolder = holderM[1];
    const periodM = metaText.match(/(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*[~\-]\s*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/);
    if (periodM) {
      meta.periodStart = periodM[1].replace(/[.\/]/g, '-');
      meta.periodEnd   = periodM[2].replace(/[.\/]/g, '-');
    }

    /* 4) 데이터 행 파싱 (헤더 다음 행부터, 합계행 제외) */
    const transactions = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const cell = k => (colIdx[k] !== undefined ? r[colIdx[k]] : '');
      const rawDate = String(cell('txnDate') || '').trim();
      /* 빈 행 스킵 */
      if (!rawDate) continue;
      /* 합계 행 스킵 — 거래일시 칸에 "합계" 등이 들어오는 케이스 */
      if (/합\s*계|소\s*계|총\s*계/.test(r.join(''))) continue;
      /* 거래일시가 날짜 형태가 아니면 스킵 (안내문 행 등) */
      if (!/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(rawDate)) continue;

      const withdraw = parseNum(cell('withdraw'));
      const deposit  = parseNum(cell('deposit'));
      /* 금액 정규화 1차: 출금→음수, 입금→양수, 단일 amount */
      const amount = deposit > 0 ? deposit : -withdraw;

      transactions.push({
        txnDate:           rawDate.replace(/[.\/]/g, '-'),
        amount,
        balanceAfter:      parseNum(cell('balanceAfter')),
        description:       String(cell('description') || '').trim(),
        counterpartAccount: String(cell('counterpartAccount') || '').trim(),
        counterpartBank:   String(cell('counterpartBank') || '').trim(),
        memo:              String(cell('memo') || '').trim(),
        txnMethod:         String(cell('txnMethod') || '').trim(),
        noteAmount:        parseNum(cell('noteAmount')),
        cmsCode:           String(cell('cmsCode') || '').trim(),
        counterpartName:   String(cell('counterpartName') || '').trim(),
      });
    }
    if (!transactions.length) throw new Error('파싱된 거래가 없습니다. 엑셀 내용을 확인해 주세요.');
    return { transactions, meta };
  }

  /* ════════════════════════════════════════════════
     업로드 — 클라이언트 파싱 후 application/json POST
  ════════════════════════════════════════════════ */
  async function uploadFile(file) {
    const statusEl = document.getElementById('btUploadStatus');
    const setStatus = (bg, color, html) => {
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:${bg};color:${color};font-size:13px">${html}</div>`;
      }
    };
    setStatus('#e0f2fe', '#0369a1', `📤 "${escapeHtml(file.name)}" 파싱 중…`);

    /* 1) 클라이언트 엑셀 파싱 */
    let parsed;
    try {
      parsed = await parseIbkExcel(file);
    } catch (e) {
      setStatus('#fee2e2', '#b91c1c', '파싱 실패: ' + escapeHtml(String(e?.message || e)));
      return;
    }

    setStatus('#e0f2fe', '#0369a1', `📤 ${parsed.transactions.length}건 파싱 완료 — 서버 적재·대사 중…`);

    /* 2) 정규화 거래 배열 JSON POST */
    const res = await api('POST', '/api/admin-bank-import', {
      fileName:     file.name,
      meta:         parsed.meta,
      transactions: parsed.transactions,
    });
    if (!res.ok) {
      setStatus('#fee2e2', '#b91c1c', '업로드 실패: ' + escapeHtml(res.data?.error || res.error || '')
        + (res.data?.detail ? ' — ' + escapeHtml(res.data.detail) : ''));
      return;
    }
    const d = unwrap(res);
    const inserted = d.inserted ?? d.insertedCount ?? d.count ?? 0;
    const skipped  = d.skipped  ?? d.duplicateCount ?? 0;
    setStatus('#dcfce7', '#15803d',
      `✅ 업로드 완료 — 신규 ${inserted}건 적재${skipped ? `, 중복 ${skipped}건 제외` : ''}. 대사 결과를 확인하세요.`);

    const fileInput = document.getElementById('btFileInput');
    if (fileInput) fileInput.value = '';
    /* 업로드 후 자동 갱신 */
    loadSummary();
    loadTransactions();
    loadImportList();
  }

  /* ── 대사 재실행 ── */
  async function runReconcile() {
    if (!confirm('미처리·확인필요 거래에 대해 입출금 대사 엔진을 다시 실행하시겠습니까?')) return;
    const btn = document.getElementById('btReconcileBtn');
    if (btn) { btn.disabled = true; btn.textContent = '대사 실행 중…'; }
    const res = await api('POST', '/api/admin-bank-reconcile', {});
    if (btn) { btn.disabled = false; btn.textContent = '🔄 대사 재실행'; }
    if (!res.ok) { alert('대사 실행 실패: ' + (res.data?.error || res.error || '')); return; }
    loadSummary();
    loadTransactions();
  }

  /* ════════════════════════════════════════════════
     대사 요약
  ════════════════════════════════════════════════ */
  async function loadSummary() {
    const el = document.getElementById('btSummary');
    if (!el) return;
    const pd = getPeriodQs();
    const qs = new URLSearchParams();
    if (pd.startDate) qs.set('startDate', pd.startDate);
    if (pd.endDate)   qs.set('endDate', pd.endDate);
    const res = await api('GET', '/api/admin-bank-reconcile-summary?' + qs.toString());
    if (!res.ok) { el.innerHTML = ''; return; }
    summaryData = unwrap(res);
    renderSummary(el);
  }
  function renderSummary(el) {
    const s = summaryData || {};
    const inMatched   = s.inMatched   ?? s.in_matched   ?? 0;
    const inPending   = s.inPending   ?? s.in_pending   ?? 0;
    const outVoucher  = s.outVoucher  ?? s.out_voucher  ?? 0;
    const outPending  = s.outPending  ?? s.out_pending  ?? 0;
    const batchCount  = s.batchCount  ?? s.batch_count  ?? 0;
    const card = (label, value, color) => `
      <div class="kpi" style="border:1px solid var(--border,#e3e6eb);border-radius:10px;padding:12px 14px;background:#fff">
        <div class="kpi-label" style="font-size:12px;color:var(--text-3,#94a0b3)">${label}</div>
        <div class="kpi-value" style="font-size:20px;font-weight:700;color:${color}">${value}건</div>
      </div>`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
        ${card('입금 매칭', inMatched, '#15803d')}
        ${card('입금 미확인', inPending, '#b91c1c')}
        ${card('출금 전표생성', outVoucher, '#7c3aed')}
        ${card('출금 확인대기', outPending, '#b91c1c')}
        ${card('묶음정산', batchCount, '#0369a1')}
      </div>`;
  }

  /* ════════════════════════════════════════════════
     업로드 이력
  ════════════════════════════════════════════════ */
  async function loadImportList() {
    const el = document.getElementById('btImportList');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:8px;font-size:13px">불러오는 중…</div>';
    const res = await api('GET', '/api/admin-bank-import-list');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:8px;font-size:13px">이력 조회 실패: ${escapeHtml(res.error || '')}</div>`; return; }
    importList = pickArr(res, 'imports');
    if (!Array.isArray(importList)) importList = [];
    if (!importList.length) { el.innerHTML = '<div style="color:var(--text-3);padding:8px;font-size:13px">업로드 이력이 없습니다.</div>'; return; }
    el.innerHTML = `
      <table class="data-table" style="width:100%;font-size:13px">
        <thead><tr><th>업로드일시</th><th>파일명</th><th>계좌</th><th>조회기간</th><th class="num">건수</th></tr></thead>
        <tbody>
          ${importList.map(im => `
            <tr>
              <td>${fmtDateTime(im.created_at || im.createdAt || im.uploaded_at)}</td>
              <td>${escapeHtml(im.file_name || im.fileName || im.filename || '—')}</td>
              <td>${escapeHtml(im.account_no || im.accountNo || '—')}</td>
              <td>${fmtDate(im.period_start || im.periodStart)} ~ ${fmtDate(im.period_end || im.periodEnd)}</td>
              <td class="num">${im.txn_count ?? im.txnCount ?? im.row_count ?? '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* ════════════════════════════════════════════════
     거래 목록
  ════════════════════════════════════════════════ */
  async function loadTransactions() {
    const el = document.getElementById('btTxnList');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const pd  = getPeriodQs();
    const qs  = new URLSearchParams();
    if (pd.startDate) qs.set('startDate', pd.startDate);
    if (pd.endDate)   qs.set('endDate', pd.endDate);
    const dir   = document.getElementById('btDirFilter')?.value;
    const match = document.getElementById('btMatchFilter')?.value;
    if (dir)   qs.set('direction', dir);
    if (match) qs.set('matchType', match);
    const res = await api('GET', '/api/admin-bank-transactions-list?' + qs.toString());
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:12px">거래 목록 조회 실패: ${escapeHtml(res.error || '')}</div>`; return; }
    txnList = pickArr(res, 'transactions');
    if (!Array.isArray(txnList)) txnList = [];
    renderTransactions(el);
  }
  function renderTransactions(el) {
    if (!txnList.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:16px;text-align:center">조회된 거래가 없습니다. 통장 엑셀을 업로드하세요.</div>';
      return;
    }
    el.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>거래일시</th><th>입출</th><th class="num">금액</th>
            <th>거래내용</th><th>거래처</th><th>매칭상태</th><th>액션</th>
          </tr>
        </thead>
        <tbody>
          ${txnList.map(t => {
            const id      = t.id;
            const amount  = Number(t.amount ?? 0);
            const isIn    = amount >= 0;
            const matchType = t.match_type || t.matchType || 'pending';
            const desc    = escapeHtml(t.description || '—');
            const cpName  = escapeHtml(t.counterpart_name || t.counterpartName || t.counterparty_name || '—');
            /* 확인필요(pending) 거래만 액션 버튼 노출 */
            const actionBtn = matchType === 'pending'
              ? `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_BANK_TXN.openConfirm(${id})">확인</button>`
              : (matchType !== 'ignored'
                ? `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_BANK_TXN.openConfirm(${id})">보기</button>`
                : '');
            return `<tr>
              <td style="white-space:nowrap">${fmtDateTime(t.txn_date || t.txnDate)}</td>
              <td><span style="color:${isIn ? '#15803d' : '#b91c1c'};font-weight:600">${isIn ? '입금' : '출금'}</span></td>
              <td class="num" style="color:${isIn ? '#15803d' : '#b91c1c'};font-weight:600">${fmtSigned(amount)}</td>
              <td>${desc}</td>
              <td>${cpName}</td>
              <td>${matchBadge(matchType)}</td>
              <td>${actionBtn}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /* ════════════════════════════════════════════════
     관리자 확인 모달
  ════════════════════════════════════════════════ */
  async function openConfirm(txnId) {
    const t = txnList.find(x => x.id === txnId);
    if (!t) return;
    const modal = document.getElementById('btConfirmModal');
    const body  = document.getElementById('btConfirmBody');
    const title = document.getElementById('btConfirmTitle');
    if (!modal || !body) return;

    const amount = Number(t.amount ?? 0);
    const isIn   = amount >= 0;
    if (title) title.textContent = isIn ? '미매칭 입금 처리' : '미매칭 출금 처리';

    /* 거래 정보 요약 */
    const infoHtml = `
      <div style="background:#f8fafc;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.7">
        <div><strong>거래일시</strong> ${fmtDateTime(t.txn_date || t.txnDate)}</div>
        <div><strong>금액</strong> <span style="color:${isIn ? '#15803d' : '#b91c1c'};font-weight:600">${fmtSigned(amount)}</span></div>
        <div><strong>거래내용</strong> ${escapeHtml(t.description || '—')}</div>
        <div><strong>거래처</strong> ${escapeHtml(t.counterpart_name || t.counterpartName || '—')}</div>
        ${t.ai_account_code || t.aiAccountCode ? `<div><strong>AI 추정 계정과목</strong> ${escapeHtml(t.ai_account_code || t.aiAccountCode)} (신뢰도 ${t.ai_confidence ?? t.aiConfidence ?? '—'}%)</div>` : ''}
      </div>`;

    body.innerHTML = infoHtml + '<div style="color:var(--text-3);font-size:13px">불러오는 중…</div>';
    modal.style.display = 'flex';

    if (isIn) {
      /* 미매칭 입금 → 회원 후보 조회 후 [후원 등록 / 매출 등록 / 무시] */
      let candidates = memberCandidates[txnId];
      if (!candidates) {
        const cres = await api('GET', `/api/admin-bank-transaction-list?candidates=1&id=${txnId}`);
        /* B가 transactions-list 또는 별도 후보 키로 줄 수 있음 — 다중 fallback */
        const cd = unwrap(cres);
        candidates = cd.memberCandidates || cd.candidates || cd.members || [];
        memberCandidates[txnId] = candidates;
      }
      const candHtml = candidates.length
        ? `<div style="margin-bottom:10px">
             <label class="form-label">입금자명 일치 회원 후보</label>
             <select id="btConfirmMemberSel" class="input">
               <option value="">— 회원 선택 안 함 —</option>
               ${candidates.map(m => `<option value="${m.id || m.memberId}">${escapeHtml(m.name || m.memberName || '')}${m.phone ? ' (' + escapeHtml(m.phone) + ')' : ''}</option>`).join('')}
             </select>
           </div>`
        : '<div style="font-size:12px;color:var(--text-3);margin-bottom:10px">입금자명과 일치하는 회원 후보가 없습니다.</div>';

      body.innerHTML = infoHtml + candHtml + `
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn-sm btn-sm-ghost" type="button" id="btConfirmIgnore">무시</button>
          <button class="btn-sm btn-sm-primary" type="button" id="btConfirmRevenue" style="background:#b45309">매출 등록</button>
          <button class="btn-sm btn-sm-primary" type="button" id="btConfirmDonation" style="background:#15803d">후원 등록</button>
        </div>`;

      document.getElementById('btConfirmDonation')?.addEventListener('click', () => {
        const memberId = document.getElementById('btConfirmMemberSel')?.value || null;
        submitConfirm(txnId, 'donation', { memberId: memberId ? Number(memberId) : null });
      });
      document.getElementById('btConfirmRevenue')?.addEventListener('click', () => submitConfirm(txnId, 'revenue', {}));
      document.getElementById('btConfirmIgnore')?.addEventListener('click', () => submitConfirm(txnId, 'ignored', {}));
    } else {
      /* 미매칭 출금 → [전표 확정 / 무시] */
      body.innerHTML = infoHtml + `
        <div style="margin-bottom:10px">
          <label class="form-label">계정과목 코드</label>
          <input type="text" id="btConfirmAcctCode" class="input" value="${escapeHtml(t.ai_account_code || t.aiAccountCode || '')}" placeholder="예: admin_ops">
        </div>
        <div style="margin-bottom:10px">
          <label class="form-label">적요 / 메모</label>
          <input type="text" id="btConfirmVoucherNote" class="input" value="${escapeHtml(t.description || '')}">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn-sm btn-sm-ghost" type="button" id="btConfirmIgnore">무시</button>
          <button class="btn-sm btn-sm-primary" type="button" id="btConfirmVoucher" style="background:#7c3aed">전표 확정</button>
        </div>`;

      document.getElementById('btConfirmVoucher')?.addEventListener('click', () => {
        const accountCode = document.getElementById('btConfirmAcctCode')?.value.trim();
        const note        = document.getElementById('btConfirmVoucherNote')?.value.trim();
        if (!accountCode) { alert('계정과목 코드를 입력해 주세요.'); return; }
        submitConfirm(txnId, 'voucher', { accountCode, note });
      });
      document.getElementById('btConfirmIgnore')?.addEventListener('click', () => submitConfirm(txnId, 'ignored', {}));
    }
  }

  async function submitConfirm(txnId, action, extra) {
    const res = await api('POST', '/api/admin-bank-transaction-confirm', {
      transactionId: txnId,
      id: txnId,
      action,
      ...extra,
    });
    if (!res.ok) { alert('처리 실패: ' + (res.data?.error || res.error || '')); return; }
    closeConfirmModal();
    delete memberCandidates[txnId];
    loadSummary();
    loadTransactions();
  }
  function closeConfirmModal() {
    const modal = document.getElementById('btConfirmModal');
    if (modal) modal.style.display = 'none';
  }

  /* ════════════════════════════════════════════════
     거래처 마스터
  ════════════════════════════════════════════════ */
  async function loadCounterparties() {
    const el = document.getElementById('btCpList');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const res = await api('GET', '/api/admin-counterparties-list');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:12px">거래처 목록 조회 실패: ${escapeHtml(res.error || '')}</div>`; return; }
    cpList = pickArr(res, 'counterparties');
    if (!Array.isArray(cpList)) cpList = [];
    renderCounterparties(el);
  }
  function cpMatchTypeLabel(t) {
    return { donation: '후원', revenue: '매출', voucher: '지출(전표)' }[t] || t || '—';
  }
  function renderCounterparties(el) {
    if (!cpList.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:16px;text-align:center">등록된 거래처가 없습니다. 거래를 확인하면 거래처가 자동 학습됩니다.</div>';
      return;
    }
    el.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>거래처명</th><th>계좌번호</th><th>은행</th>
            <th>분류</th><th>계정과목</th><th class="num">학습횟수</th><th>액션</th>
          </tr>
        </thead>
        <tbody>
          ${cpList.map(c => `
            <tr>
              <td>${escapeHtml(c.name || '—')}</td>
              <td>${escapeHtml(c.account_no || c.accountNo || '—')}</td>
              <td>${escapeHtml(c.bank_name || c.bankName || '—')}</td>
              <td>${cpMatchTypeLabel(c.default_match_type || c.defaultMatchType)}</td>
              <td>${escapeHtml(c.default_account_code || c.defaultAccountCode || '—')}</td>
              <td class="num">${c.txn_count ?? c.txnCount ?? 0}</td>
              <td><button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_BANK_TXN.openCpEdit(${c.id})">수정</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function openCpEdit(cpId) {
    const c = cpList.find(x => x.id === cpId);
    if (!c) return;
    const modal = document.getElementById('btCpModal');
    const body  = document.getElementById('btCpModalBody');
    if (!modal || !body) return;
    const mt   = c.default_match_type || c.defaultMatchType || '';
    const acct = c.default_account_code || c.defaultAccountCode || '';
    const note = c.note || '';
    body.innerHTML = `
      <div style="font-size:13px;margin-bottom:12px;color:var(--text-2,#5b6577)">
        <strong>${escapeHtml(c.name || '')}</strong>
        ${c.account_no || c.accountNo ? ' · ' + escapeHtml(c.account_no || c.accountNo) : ''}
      </div>
      <label class="form-label">기본 분류</label>
      <select id="btCpMatchType" class="input" style="margin-bottom:10px">
        <option value="">— 선택 —</option>
        <option value="donation" ${mt === 'donation' ? 'selected' : ''}>후원</option>
        <option value="revenue" ${mt === 'revenue' ? 'selected' : ''}>매출</option>
        <option value="voucher" ${mt === 'voucher' ? 'selected' : ''}>지출(전표)</option>
      </select>
      <label class="form-label">기본 계정과목 코드</label>
      <input type="text" id="btCpAcctCode" class="input" value="${escapeHtml(acct)}" placeholder="예: admin_ops" style="margin-bottom:10px">
      <label class="form-label">메모</label>
      <textarea id="btCpNote" class="input" rows="2">${escapeHtml(note)}</textarea>
      <div id="btCpModalError" style="color:var(--danger);font-size:13px;margin-top:6px;display:none"></div>
      <div class="modal-foot" style="margin-top:14px">
        <button class="btn-sm btn-sm-ghost" type="button" id="btCpModalCancel">취소</button>
        <button class="btn-sm btn-sm-primary" type="button" id="btCpModalSave">저장</button>
      </div>`;
    modal.style.display = 'flex';
    document.getElementById('btCpModalCancel')?.addEventListener('click', closeCpModal);
    document.getElementById('btCpModalSave')?.addEventListener('click', () => saveCpEdit(cpId));
  }
  async function saveCpEdit(cpId) {
    const matchType    = document.getElementById('btCpMatchType')?.value || null;
    const accountCode  = document.getElementById('btCpAcctCode')?.value.trim() || null;
    const note         = document.getElementById('btCpNote')?.value.trim() || null;
    const errEl        = document.getElementById('btCpModalError');
    const res = await api('PUT', '/api/admin-counterparty-update', {
      id: cpId,
      counterpartyId: cpId,
      defaultMatchType: matchType,
      defaultAccountCode: accountCode,
      note,
    });
    if (!res.ok) {
      if (errEl) { errEl.textContent = '저장 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; }
      return;
    }
    closeCpModal();
    loadCounterparties();
  }
  function closeCpModal() {
    const modal = document.getElementById('btCpModal');
    if (modal) modal.style.display = 'none';
  }

  /* ════════════════════════════════════════════════
     설정 (신뢰도 임계값)
  ════════════════════════════════════════════════ */
  async function openSettingsModal() {
    const modal = document.getElementById('btSettingsModal');
    const input = document.getElementById('btThresholdInput');
    const errEl = document.getElementById('btSettingsError');
    if (errEl) errEl.style.display = 'none';
    if (modal) modal.style.display = 'flex';
    /* 현재 임계값 조회 — reconcile-summary 응답에 포함될 수 있음 */
    const res = await api('GET', '/api/admin-bank-reconcile-summary');
    if (res.ok) {
      const d = unwrap(res);
      const th = d.confidenceThreshold ?? d.threshold ?? d.confidence_threshold;
      if (input && th != null) input.value = th;
    }
  }
  async function saveSettings() {
    const input = document.getElementById('btThresholdInput');
    const errEl = document.getElementById('btSettingsError');
    const val   = parseInt(input?.value, 10);
    if (isNaN(val) || val < 0 || val > 100) {
      if (errEl) { errEl.textContent = '0~100 사이의 값을 입력해 주세요.'; errEl.style.display = ''; }
      return;
    }
    const res = await api('POST', '/api/admin-bank-reconcile', { confidenceThreshold: val, settingsOnly: true });
    if (!res.ok) {
      if (errEl) { errEl.textContent = '저장 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; }
      return;
    }
    closeSettingsModal();
    alert('신뢰도 임계값이 저장되었습니다.');
  }
  function closeSettingsModal() {
    const modal = document.getElementById('btSettingsModal');
    if (modal) modal.style.display = 'none';
  }

  /* ════════════════════════════════════════════════
     초기화 / 재진입
  ════════════════════════════════════════════════ */
  function init() {
    const container = document.getElementById('page-bank-transactions') || document.getElementById('adm-bank-transactions');
    if (!container) return;
    if (!container.querySelector('.panel')) {
      renderShell(container);
    }
    switchTab('transactions');
  }
  function load() {
    const container = document.getElementById('page-bank-transactions');
    if (container && !container.querySelector('.panel')) { init(); return; }
    if (currentTab === 'transactions') { loadSummary(); loadTransactions(); loadImportList(); }
    else loadCounterparties();
  }

  window.SIREN_BANK_TXN = {
    init,
    load,
    openConfirm,
    openCpEdit,
  };
})();
