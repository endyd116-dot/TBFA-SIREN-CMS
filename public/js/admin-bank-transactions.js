/* admin-bank-transactions.js — Phase 22-D-R2: 통장 거래내역 자동화 + 입출금 대사
   화면: 업로드 / 대사 요약 / 거래 목록 / 관리자 확인 모달 / 거래처 마스터 / 설정
   데이터 API는 B 작성 — A는 호출·렌더만. 응답 키 다중 fallback. */
(function () {
  'use strict';

  /* ── 상태 ── */
  let currentTab   = 'transactions';  // transactions | counterparties | accountCodes
  let txnList      = [];
  let importList   = [];
  let cpList       = [];
  let summaryData  = null;
  let acctList     = [];   // 계정과목 마스터 (sort_order 정렬)

  /* ── API 헬퍼 ── */
  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => null);
      return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: data?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  /* 응답 본문 fallback — B 표준: { ok, data: {...} } */
  function unwrap(res) { return res.data?.data || res.data || {}; }
  function pickArr(res, key) {
    const d = res.data;
    const v = d?.data?.[key] ?? d?.[key];
    if (Array.isArray(v)) return v;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d)) return d;
    return [];
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
            <button class="btn-sm btn-sm-ghost" id="btTabAcct" type="button">계정과목 관리</button>
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

        <!-- ─── 계정과목 관리 뷰 ─── -->
        <div id="btViewAcct" style="display:none">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <div style="font-size:13px;color:var(--text-2,#5b6577);flex:1">
              NPO 표준 계정과목 마스터입니다. 통장 거래 자동 분류·전표 작성에 쓰입니다.
              ▲▼로 표시 순서를 바꿀 수 있고, 비활성 처리하면 신규 선택 목록에서 숨겨집니다(기존 전표는 유지).
            </div>
            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-2,#5b6577)">
              <input type="checkbox" id="btAcctShowInactive"> 비활성 포함
            </label>
            <button class="btn-sm btn-sm-primary" type="button" id="btAcctAddBtn">+ 계정과목 추가</button>
          </div>
          <div id="btAcctList"></div>
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
            <span class="modal-title">신뢰도 임계값 대사 실행</span>
            <button class="modal-close" type="button" id="btSettingsCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <label class="form-label">AI 분류 신뢰도 임계값 (%)</label>
            <div style="font-size:12px;color:var(--text-3,#94a0b3);margin-bottom:6px">
              이 값 이상이면 전표가 자동 생성되고, 미만이면 관리자 확인 대기로 분류됩니다.
              입력한 임계값으로 즉시 대사를 재실행합니다.
            </div>
            <input type="number" id="btThresholdInput" class="input" min="0" max="100" value="75">
            <div id="btSettingsError" style="color:var(--danger);font-size:13px;margin-top:6px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="btSettingsCancelBtn">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="btSettingsSaveBtn">이 임계값으로 대사 실행</button>
          </div>
        </div>
      </div>

      <!-- ─── 계정과목 추가·수정 모달 ─── -->
      <div id="btAcctModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:440px">
          <div class="modal-head">
            <span class="modal-title" id="btAcctModalTitle">계정과목 추가</span>
            <button class="modal-close" type="button" id="btAcctCloseBtn">×</button>
          </div>
          <div class="modal-body">
            <label class="form-label">코드 <span style="color:var(--danger)">*</span></label>
            <input type="text" id="btAcctCode" class="input" placeholder="예: 5046 (2~20자리 숫자)" style="margin-bottom:4px">
            <div style="font-size:11.5px;color:var(--text-3,#94a0b3);margin-bottom:10px">
              코드는 전표가 참조하는 식별자라 추가 후 변경할 수 없습니다.
            </div>
            <label class="form-label">계정과목명 <span style="color:var(--danger)">*</span></label>
            <input type="text" id="btAcctName" class="input" placeholder="예: 행사대행비" style="margin-bottom:10px">
            <label class="form-label">분류 <span style="color:var(--danger)">*</span></label>
            <select id="btAcctCategory" class="input" style="margin-bottom:10px">
              <option value="income">수익</option>
              <option value="personnel">인건비</option>
              <option value="program">사업비</option>
              <option value="admin_ops">관리운영비</option>
              <option value="fundraising">모금비</option>
            </select>
            <label class="form-label">상위 코드 (선택)</label>
            <select id="btAcctParent" class="input" style="margin-bottom:10px">
              <option value="">— 대분류 (상위 없음) —</option>
            </select>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-2,#5b6577)" id="btAcctActiveRow">
              <input type="checkbox" id="btAcctActive" checked> 활성 (비활성 시 신규 선택 목록에서 숨김)
            </label>
            <div id="btAcctModalError" style="color:var(--danger);font-size:13px;margin-top:8px;display:none"></div>
          </div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="btAcctCancelBtn">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="btAcctSaveBtn">저장</button>
          </div>
        </div>
      </div>
    `;

    /* 탭 전환 */
    document.getElementById('btTabTxn')?.addEventListener('click', () => switchTab('transactions'));
    document.getElementById('btTabCp')?.addEventListener('click', () => switchTab('counterparties'));
    document.getElementById('btTabAcct')?.addEventListener('click', () => switchTab('accountCodes'));
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

    /* 계정과목 관리 */
    document.getElementById('btAcctAddBtn')?.addEventListener('click', () => openAcctModal(null));
    document.getElementById('btAcctShowInactive')?.addEventListener('change', loadAccountCodes);
    document.getElementById('btAcctCloseBtn')?.addEventListener('click', closeAcctModal);
    document.getElementById('btAcctCancelBtn')?.addEventListener('click', closeAcctModal);
    document.getElementById('btAcctSaveBtn')?.addEventListener('click', saveAcct);
  }

  /* ── 탭 전환 ── */
  function switchTab(tab) {
    currentTab = tab;
    const views = {
      transactions:  document.getElementById('btViewTxn'),
      counterparties: document.getElementById('btViewCp'),
      accountCodes:  document.getElementById('btViewAcct'),
    };
    const btns = {
      transactions:  document.getElementById('btTabTxn'),
      counterparties: document.getElementById('btTabCp'),
      accountCodes:  document.getElementById('btTabAcct'),
    };
    Object.keys(views).forEach(k => {
      if (views[k]) views[k].style.display = k === tab ? '' : 'none';
      if (btns[k])  btns[k].className = 'btn-sm ' + (k === tab ? 'btn-sm-primary' : 'btn-sm-ghost');
    });
    if (tab === 'transactions')      { loadSummary(); loadTransactions(); loadImportList(); }
    else if (tab === 'counterparties') loadCounterparties();
    else if (tab === 'accountCodes')   loadAccountCodes();
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

    /* 4) 데이터 행 파싱 (헤더 다음 행부터, 합계행 제외)
       → B admin-bank-import rows 키 명세: txnDateTime, withdrawal, deposit, balanceAfter,
         description, counterpartAccount, counterpartBank, memo, txnMethod, cmsCode, counterpartName */
    const rowsOut = [];
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

      rowsOut.push({
        txnDateTime:        rawDate.replace(/[.\/]/g, '-'),
        withdrawal:         parseNum(cell('withdraw')),
        deposit:            parseNum(cell('deposit')),
        balanceAfter:       parseNum(cell('balanceAfter')),
        description:        String(cell('description') || '').trim(),
        counterpartAccount: String(cell('counterpartAccount') || '').trim(),
        counterpartBank:    String(cell('counterpartBank') || '').trim(),
        memo:               String(cell('memo') || '').trim(),
        txnMethod:          String(cell('txnMethod') || '').trim(),
        cmsCode:            String(cell('cmsCode') || '').trim(),
        counterpartName:    String(cell('counterpartName') || '').trim(),
      });
    }
    if (!rowsOut.length) throw new Error('파싱된 거래가 없습니다. 엑셀 내용을 확인해 주세요.');
    return { rows: rowsOut, meta };
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

    setStatus('#e0f2fe', '#0369a1', `📤 ${parsed.rows.length}건 파싱 완료 — 서버 적재·대사 중…`);

    /* 2) 정규화 거래 배열 JSON POST — B admin-bank-import 명세:
       { filename, bankName?, periodFrom?, periodTo?, rows:[...] } */
    const res = await api('POST', '/api/admin-bank-import', {
      filename:   file.name,
      bankName:   'IBK기업은행',
      periodFrom: parsed.meta.periodStart || undefined,
      periodTo:   parsed.meta.periodEnd   || undefined,
      rows:       parsed.rows,
    });
    if (!res.ok) {
      setStatus('#fee2e2', '#b91c1c', '업로드 실패: ' + escapeHtml(res.data?.error || res.error || '')
        + (res.data?.detail ? ' — ' + escapeHtml(res.data.detail) : ''));
      return;
    }
    const d = unwrap(res);
    const inserted = d.insertedRows ?? d.inserted ?? 0;
    const skipped  = d.duplicateCount ?? d.skipped ?? 0;
    const invalid  = d.skippedInvalid ?? 0;

    const fileInput = document.getElementById('btFileInput');
    if (fileInput) fileInput.value = '';

    /* 신규 적재분이 있으면 즉시 입출금 대사 실행 (UI 안내문 "업로드 시 대사 실행" 충족) */
    let reconcileMsg = '';
    if (inserted > 0) {
      setStatus('#e0f2fe', '#0369a1',
        `📤 신규 ${inserted}건 적재 완료 — 입출금 대사 실행 중…`);
      /* threshold 미전달 시 서버 기본 0.75 적용. importId로 이번 업로드분만 대사 */
      const recRes = await api('POST', '/api/admin-bank-reconcile',
        d.importId ? { importId: d.importId } : {});
      if (recRes.ok) {
        const rd = unwrap(recRes);
        reconcileMsg = rd.message ? ' · ' + rd.message : ' · 대사 완료';
      } else {
        reconcileMsg = ' · 대사 실행 실패 — "🔄 대사 재실행"으로 다시 시도하세요';
      }
    }

    setStatus('#dcfce7', '#15803d',
      `✅ 업로드 완료 — 신규 ${inserted}건 적재`
      + (skipped ? `, 중복 ${skipped}건 제외` : '')
      + (invalid ? `, 무효 ${invalid}건 제외` : '')
      + reconcileMsg);

    /* 업로드·대사 후 자동 갱신 */
    loadSummary();
    loadTransactions();
    loadImportList();
  }

  /* ── 대사 재실행 ── */
  async function runReconcile() {
    if (!confirm('미처리·확인필요 거래에 대해 입출금 대사 엔진을 다시 실행하시겠습니까?')) return;
    const btn = document.getElementById('btReconcileBtn');
    if (btn) { btn.disabled = true; btn.textContent = '대사 실행 중…'; }
    /* threshold 미전달 시 서버 기본 0.75 적용 */
    const res = await api('POST', '/api/admin-bank-reconcile', {});
    if (btn) { btn.disabled = false; btn.textContent = '🔄 대사 재실행'; }
    if (!res.ok) { alert('대사 실행 실패: ' + (res.data?.error || res.error || '')); return; }
    const d = unwrap(res);
    if (d.message) {
      const statusEl = document.getElementById('btUploadStatus');
      if (statusEl) {
        statusEl.style.display = '';
        statusEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:#dcfce7;color:#15803d;font-size:13px">🔄 ${escapeHtml(d.message)}</div>`;
      }
    }
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
    /* B 명세: data.income{ matched, batch, revenue, pending, ignored },
       data.expense{ voucherCreated, pending, ignored } */
    const s   = summaryData || {};
    const inc = s.income  || {};
    const exp = s.expense || {};
    const inMatched   = inc.matched       ?? 0;
    const inPending   = inc.pending       ?? 0;
    const outVoucher  = exp.voucherCreated ?? 0;
    const outPending  = exp.pending       ?? 0;
    const batchCount  = inc.batch         ?? 0;
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
    /* B 명세: { id, filename, bankName, periodFrom, periodTo, totalRows,
       autoMatched, pendingReview, ignoredRows, importedBy, importedAt, status } */
    el.innerHTML = `
      <table class="data-table" style="width:100%;font-size:13px">
        <thead><tr>
          <th>업로드일시</th><th>파일명</th><th>은행</th><th>조회기간</th>
          <th class="num">건수</th><th class="num">자동매칭</th><th class="num">확인대기</th>
        </tr></thead>
        <tbody>
          ${importList.map(im => `
            <tr>
              <td>${fmtDateTime(im.importedAt || im.imported_at)}</td>
              <td>${escapeHtml(im.filename || im.fileName || '—')}</td>
              <td>${escapeHtml(im.bankName || im.bank_name || '—')}</td>
              <td>${fmtDate(im.periodFrom || im.period_from)} ~ ${fmtDate(im.periodTo || im.period_to)}</td>
              <td class="num">${im.totalRows ?? im.total_rows ?? '—'}</td>
              <td class="num">${im.autoMatched ?? im.auto_matched ?? 0}</td>
              <td class="num">${im.pendingReview ?? im.pending_review ?? 0}</td>
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
    /* B 명세: txnType=credit(입금)|debit(출금) */
    if (dir === 'in')  qs.set('txnType', 'credit');
    if (dir === 'out') qs.set('txnType', 'debit');
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
    /* 일괄 전표 확정 대상: 미처리(pending) 출금 거래 */
    const batchTarget = txnList.filter(t => {
      const mt = t.matchType || t.match_type || 'pending';
      const isOut = t.txnType ? t.txnType === 'debit' : Number(t.amount ?? 0) < 0;
      return mt === 'pending' && isOut;
    });
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <button class="btn-sm btn-sm-primary" type="button" id="btBatchVoucherBtn"
          style="background:#7c3aed" ${batchTarget.length ? '' : 'disabled'}>
          ✅ 선택 일괄 전표 확정 (<span id="btBatchSelCount">0</span>)
        </button>
        <span style="font-size:11.5px;color:var(--text-3,#94a0b3)">
          미처리 출금 거래 중 추정 계정과목이 있는 건만 일괄 확정됩니다. 추정값 없는 건은 단건 '확인'으로 처리하세요.
        </span>
      </div>
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th style="width:34px"><input type="checkbox" id="btSelectAllTxn"></th>
            <th>거래일시</th><th>입출</th><th class="num">금액</th>
            <th>거래내용</th><th>거래처</th><th>매칭상태</th><th>액션</th>
          </tr>
        </thead>
        <tbody>
          ${txnList.map(t => {
            const id      = t.id;
            const amount  = Number(t.amount ?? 0);
            /* B 명세: txnType=credit(입금)|debit(출금) — 없으면 금액 부호로 폴백 */
            const isIn    = t.txnType ? t.txnType === 'credit' : amount >= 0;
            const matchType = t.matchType || t.match_type || 'pending';
            const desc    = escapeHtml(t.description || '—');
            /* 거래처 마스터 매칭명 우선, 없으면 통장 예금주명 */
            const cpName  = escapeHtml(t.counterpartyMasterName || t.counterpartName || '—');
            /* 일괄 대상(미처리 출금)만 체크박스 노출 */
            const isBatchable = matchType === 'pending' && !isIn;
            const checkbox = isBatchable
              ? `<input type="checkbox" class="bt-txn-chk" data-id="${id}">`
              : '';
            /* 액션 버튼: pending=확인 / ignored=무시 해제 / 그 외=보기 */
            let actionBtn = '';
            if (matchType === 'pending') {
              actionBtn = `<button class="btn-sm btn-sm-primary" type="button" onclick="window.SIREN_BANK_TXN.openConfirm(${id})">확인</button>`;
            } else if (matchType === 'ignored') {
              actionBtn = `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_BANK_TXN.unignore(${id})">무시 해제</button>`;
            } else {
              actionBtn = `<button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_BANK_TXN.openConfirm(${id})">보기</button>`;
            }
            return `<tr>
              <td>${checkbox}</td>
              <td style="white-space:nowrap">${fmtDateTime(t.txnDate)}</td>
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

    /* 체크박스 이벤트 바인딩 */
    const updateBatchCount = () => {
      const n = el.querySelectorAll('.bt-txn-chk:checked').length;
      const cntEl = document.getElementById('btBatchSelCount');
      if (cntEl) cntEl.textContent = String(n);
    };
    el.querySelectorAll('.bt-txn-chk').forEach(cb => cb.addEventListener('change', updateBatchCount));
    const selAll = document.getElementById('btSelectAllTxn');
    if (selAll) {
      selAll.addEventListener('change', () => {
        el.querySelectorAll('.bt-txn-chk').forEach(cb => { cb.checked = selAll.checked; });
        updateBatchCount();
      });
    }
    const batchBtn = document.getElementById('btBatchVoucherBtn');
    if (batchBtn) batchBtn.addEventListener('click', runBatchVoucher);
  }

  /* ── 무시 해제 ── */
  async function unignore(txnId) {
    if (!confirm('이 거래의 무시를 해제하고 미처리 상태로 되돌리시겠습니까?')) return;
    const res = await api('POST', '/api/admin-bank-transaction-confirm', {
      transactionId: txnId, action: 'unignore',
    });
    if (!res.ok) { alert('무시 해제 실패: ' + (res.data?.error || res.error || '')); return; }
    loadSummary();
    loadTransactions();
  }

  /* ── 일괄 전표 확정 ── */
  async function runBatchVoucher() {
    const ids = Array.from(document.querySelectorAll('.bt-txn-chk:checked'))
      .map(cb => parseInt(cb.dataset.id, 10)).filter(Boolean);
    if (ids.length === 0) { alert('일괄 확정할 거래를 선택하세요.'); return; }
    if (!confirm(`${ids.length}건을 일괄 전표 확정합니다.\n추정 계정과목이 있는 건만 확정되며, 추정값 없는 건은 건너뜁니다.\n진행하시겠습니까?`)) return;
    const btn = document.getElementById('btBatchVoucherBtn');
    if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }
    const res = await api('POST', '/api/admin-bank-batch-voucher', { transactionIds: ids });
    if (btn) { btn.disabled = false; }
    if (!res.ok) { alert('일괄 전표 확정 실패: ' + (res.data?.error || res.error || '')); loadTransactions(); return; }
    const d = unwrap(res);
    const skippedReasons = (d.results || []).filter(r => !r.ok).slice(0, 5)
      .map(r => `· #${r.id}: ${r.error}`).join('\n');
    alert((d.message || '일괄 전표 확정 완료')
      + (skippedReasons ? '\n\n[건너뜀/실패 상세]\n' + skippedReasons : ''));
    loadSummary();
    loadTransactions();
  }

  /* ════════════════════════════════════════════════
     관리자 확인 모달
  ════════════════════════════════════════════════ */
  function openConfirm(txnId) {
    const t = txnList.find(x => x.id === txnId);
    if (!t) return;
    const modal = document.getElementById('btConfirmModal');
    const body  = document.getElementById('btConfirmBody');
    const title = document.getElementById('btConfirmTitle');
    if (!modal || !body) return;

    const amount = Number(t.amount ?? 0);
    /* B 명세: txnType=credit(입금)|debit(출금) — 없으면 금액 부호로 폴백 */
    const isIn   = t.txnType ? t.txnType === 'credit' : amount >= 0;
    if (title) title.textContent = isIn ? '미매칭 입금 처리' : '미매칭 출금 처리';

    /* 거래 정보 요약 */
    const infoHtml = `
      <div style="background:#f8fafc;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.7">
        <div><strong>거래일시</strong> ${fmtDateTime(t.txnDate)}</div>
        <div><strong>금액</strong> <span style="color:${isIn ? '#15803d' : '#b91c1c'};font-weight:600">${fmtSigned(amount)}</span></div>
        <div><strong>거래내용</strong> ${escapeHtml(t.description || '—')}</div>
        <div><strong>거래처</strong> ${escapeHtml(t.counterpartyMasterName || t.counterpartName || '—')}</div>
        ${t.aiAccountCode ? `<div><strong>AI 추정 계정과목</strong> ${escapeHtml(t.aiAccountCode)} (신뢰도 ${t.aiConfidence != null ? Math.round(t.aiConfidence * 100) + '%' : '—'})</div>` : ''}
        ${t.aiReasoning ? `<div style="color:var(--text-3,#94a0b3);font-size:12px;margin-top:4px">${escapeHtml(t.aiReasoning)}</div>` : ''}
      </div>`;

    /* 거래처 자동 학습 체크박스 (기본 ON) */
    const learnHtml = `
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2,#5b6577);margin-bottom:12px">
        <input type="checkbox" id="btConfirmLearn" checked>
        이 거래처 분류 룰을 저장해 다음부터 자동 매핑
      </label>`;

    modal.style.display = 'flex';

    if (isIn) {
      /* 미매칭 입금 → [후원 등록 / 매출 등록 / 무시]
         후원: 입금자명으로 /api/admin/members 검색 → 회원 select. 선택 시 memberId,
               미선택 시 donorName 텍스트 폴백
         매출: revenueCategoryId 필수 */
      const inName = escapeHtml(t.counterpartName || '');
      body.innerHTML = infoHtml + `
        <div style="margin-bottom:10px;border:1px solid var(--border,#e3e6eb);border-radius:8px;padding:10px 12px;background:#f6fbf7">
          <label class="form-label" style="color:#15803d">후원 등록</label>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <input type="text" id="btConfirmDonorName" class="input" value="${inName}" placeholder="입금자명" style="flex:1">
            <button class="btn-sm btn-sm-ghost" type="button" id="btConfirmMemberSearch">회원 검색</button>
          </div>
          <select id="btConfirmMemberSel" class="input" style="display:none;margin-bottom:4px"></select>
          <div id="btConfirmMemberHint" style="font-size:11.5px;color:var(--text-3,#94a0b3)">
            입금자명으로 회원을 검색해 연결할 수 있습니다. 미선택 시 입금자명 텍스트로 등록됩니다.
          </div>
        </div>
        <div style="margin-bottom:10px;border:1px solid var(--border,#e3e6eb);border-radius:8px;padding:10px 12px;background:#fffaf3">
          <label class="form-label" style="color:#b45309">매출 등록</label>
          <input type="number" id="btConfirmRevenueCat" class="input" placeholder="후원 외 매출 분류 ID (필수)" style="margin-bottom:6px">
          <input type="text" id="btConfirmPayerName" class="input" value="${inName}" placeholder="지급처명 (선택)">
        </div>
        ${learnHtml}
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn-sm btn-sm-ghost" type="button" id="btConfirmIgnore">무시</button>
          <button class="btn-sm btn-sm-primary" type="button" id="btConfirmRevenue" style="background:#b45309">매출 등록</button>
          <button class="btn-sm btn-sm-primary" type="button" id="btConfirmDonation" style="background:#15803d">후원 등록</button>
        </div>`;

      document.getElementById('btConfirmMemberSearch')?.addEventListener('click', () => {
        const q = document.getElementById('btConfirmDonorName')?.value.trim();
        searchMemberCandidates(q);
      });
      document.getElementById('btConfirmDonation')?.addEventListener('click', () => {
        const memberId  = document.getElementById('btConfirmMemberSel')?.value;
        const donorName = document.getElementById('btConfirmDonorName')?.value.trim();
        /* 회원 선택 시 memberId, 미선택 시 donorName 폴백 */
        if (memberId) {
          submitConfirm(txnId, 'donation', { memberId: Number(memberId) });
        } else {
          if (!donorName) { alert('후원자명을 입력하거나 회원을 검색·선택해 주세요.'); return; }
          submitConfirm(txnId, 'donation', { donorName });
        }
      });
      document.getElementById('btConfirmRevenue')?.addEventListener('click', () => {
        const catId = parseInt(document.getElementById('btConfirmRevenueCat')?.value, 10);
        if (isNaN(catId)) { alert('매출 분류 ID를 입력해 주세요.'); return; }
        const payerName = document.getElementById('btConfirmPayerName')?.value.trim() || undefined;
        submitConfirm(txnId, 'revenue', { revenueCategoryId: catId, payerName });
      });
      document.getElementById('btConfirmIgnore')?.addEventListener('click', () => submitConfirm(txnId, 'ignored', {}));
    } else {
      /* 미매칭 출금 → [전표 확정 / 무시] — voucher: accountCode 필수 */
      body.innerHTML = infoHtml + `
        <div style="margin-bottom:10px">
          <label class="form-label">계정과목 코드 <span style="color:var(--danger)">*</span></label>
          <input type="text" id="btConfirmAcctCode" class="input" value="${escapeHtml(t.aiAccountCode || '')}" placeholder="예: admin_ops">
        </div>
        <div style="margin-bottom:10px">
          <label class="form-label">예산 항목 ID (선택)</label>
          <input type="number" id="btConfirmBudgetLine" class="input" placeholder="budget_line ID">
        </div>
        <div style="margin-bottom:10px">
          <label class="form-label">보조 계정 (선택)</label>
          <input type="text" id="btConfirmSubAccount" class="input" placeholder="subAccount">
        </div>
        ${learnHtml}
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn-sm btn-sm-ghost" type="button" id="btConfirmIgnore">무시</button>
          <button class="btn-sm btn-sm-primary" type="button" id="btConfirmVoucher" style="background:#7c3aed">전표 확정</button>
        </div>`;

      document.getElementById('btConfirmVoucher')?.addEventListener('click', () => {
        const accountCode = document.getElementById('btConfirmAcctCode')?.value.trim();
        if (!accountCode) { alert('계정과목 코드를 입력해 주세요.'); return; }
        const budgetLineId = parseInt(document.getElementById('btConfirmBudgetLine')?.value, 10);
        const subAccount   = document.getElementById('btConfirmSubAccount')?.value.trim() || undefined;
        submitConfirm(txnId, 'voucher', {
          accountCode,
          budgetLineId: isNaN(budgetLineId) ? undefined : budgetLineId,
          subAccount,
        });
      });
      document.getElementById('btConfirmIgnore')?.addEventListener('click', () => submitConfirm(txnId, 'ignored', {}));
    }
  }

  /* 입금자명으로 회원 검색 → select 채우기 (기존 /api/admin/members 재사용) */
  async function searchMemberCandidates(q) {
    const sel  = document.getElementById('btConfirmMemberSel');
    const hint = document.getElementById('btConfirmMemberHint');
    if (!sel) return;
    if (!q) {
      if (hint) hint.textContent = '검색할 입금자명을 입력해 주세요.';
      return;
    }
    if (hint) hint.textContent = '회원 검색 중…';
    sel.style.display = 'none';
    const res = await api('GET', '/api/admin/members?q=' + encodeURIComponent(q) + '&limit=30');
    if (!res.ok) {
      if (hint) hint.textContent = '회원 검색 실패: ' + (res.data?.error || res.error || '');
      return;
    }
    const d = res.data || {};
    const items = (d.data && (d.data.list || d.data.items || d.data.members))
      || d.list || d.items || d.members || [];
    /* 관리자 계정 제외 — 후원자 연결 대상 아님 */
    const candidates = items.filter(m => m.type !== 'admin');
    if (!candidates.length) {
      if (hint) hint.textContent = `"${q}"와 일치하는 회원이 없습니다. 입금자명 텍스트로 등록됩니다.`;
      sel.style.display = 'none';
      sel.innerHTML = '';
      return;
    }
    sel.innerHTML = '<option value="">— 회원 선택 안 함 (입금자명 텍스트로 등록) —</option>'
      + candidates.map(m =>
          `<option value="${m.id}">${escapeHtml(m.name || '(이름 없음)')} #${m.id}`
          + `${m.phone ? ' · ' + escapeHtml(m.phone) : ''}${m.email ? ' · ' + escapeHtml(m.email) : ''}</option>`
        ).join('');
    sel.style.display = '';
    if (hint) hint.textContent = `회원 후보 ${candidates.length}명 — 선택 시 해당 회원으로 후원 등록됩니다.`;
  }

  async function submitConfirm(txnId, action, extra) {
    /* B 명세: { transactionId, action, learnCounterparty?(기본 true), ...action별 }
       무시는 거래처 학습 불필요 */
    const learnEl = document.getElementById('btConfirmLearn');
    const payload = {
      transactionId: txnId,
      action,
      ...extra,
    };
    if (action !== 'ignored' && learnEl) payload.learnCounterparty = learnEl.checked;
    const res = await api('POST', '/api/admin-bank-transaction-confirm', payload);
    if (!res.ok) { alert('처리 실패: ' + (res.data?.error || res.error || '')); return; }
    closeConfirmModal();
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
              <td>${escapeHtml(c.accountNo || '—')}</td>
              <td>${escapeHtml(c.bankName || '—')}</td>
              <td>${cpMatchTypeLabel(c.defaultMatchType)}</td>
              <td>${escapeHtml(c.defaultAccountName || c.defaultAccountCode || '—')}</td>
              <td class="num">${c.txnCount ?? 0}</td>
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
    const mt   = c.defaultMatchType || '';
    const acct = c.defaultAccountCode || '';
    const note = c.note || '';
    body.innerHTML = `
      <div style="font-size:13px;margin-bottom:12px;color:var(--text-2,#5b6577)">
        <strong>${escapeHtml(c.name || '')}</strong>
        ${c.accountNo ? ' · ' + escapeHtml(c.accountNo) : ''}
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
    /* B 명세: { id(필수), ...전달 필드만 갱신 } */
    const res = await api('PUT', '/api/admin-counterparty-update', {
      id: cpId,
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
     설정 — 신뢰도 임계값 지정 대사 실행
     (B admin-bank-reconcile threshold 0~1 파라미터. 별도 설정 저장 API 없음 →
      입력한 임계값으로 즉시 대사 재실행)
  ════════════════════════════════════════════════ */
  function openSettingsModal() {
    const modal = document.getElementById('btSettingsModal');
    const errEl = document.getElementById('btSettingsError');
    if (errEl) errEl.style.display = 'none';
    if (modal) modal.style.display = 'flex';
  }
  async function saveSettings() {
    const input = document.getElementById('btThresholdInput');
    const errEl = document.getElementById('btSettingsError');
    const pct   = parseInt(input?.value, 10);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      if (errEl) { errEl.textContent = '0~100 사이의 값을 입력해 주세요.'; errEl.style.display = ''; }
      return;
    }
    /* B 명세: threshold 0~1 — % 입력을 소수로 변환 */
    const threshold = pct / 100;
    const res = await api('POST', '/api/admin-bank-reconcile', { threshold });
    if (!res.ok) {
      if (errEl) { errEl.textContent = '대사 실행 실패: ' + (res.data?.error || res.error || ''); errEl.style.display = ''; }
      return;
    }
    closeSettingsModal();
    const d = unwrap(res);
    alert(`신뢰도 임계값 ${pct}% 기준으로 대사를 재실행했습니다.` + (d.message ? '\n' + d.message : ''));
    loadSummary();
    loadTransactions();
  }
  function closeSettingsModal() {
    const modal = document.getElementById('btSettingsModal');
    if (modal) modal.style.display = 'none';
  }

  /* ════════════════════════════════════════════════
     계정과목 관리 (NPO 표준 계정과목 마스터)
  ════════════════════════════════════════════════ */
  const ACCT_CAT_LABEL = {
    income: '수익', personnel: '인건비', program: '사업비',
    admin_ops: '관리운영비', fundraising: '모금비',
  };
  let editingAcctId = null;

  async function loadAccountCodes() {
    const el = document.getElementById('btAcctList');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-3);padding:12px">불러오는 중…</div>';
    const showInactive = document.getElementById('btAcctShowInactive')?.checked;
    const res = await api('GET', '/api/admin-account-codes-list?activeOnly=' + (showInactive ? 'false' : 'true'));
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);padding:12px">계정과목 목록 조회 실패: ${escapeHtml(res.error || '')}</div>`; return; }
    acctList = pickArr(res, 'codes');
    if (!Array.isArray(acctList)) acctList = [];
    renderAccountCodes(el);
  }

  function renderAccountCodes(el) {
    if (!acctList.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:16px;text-align:center">등록된 계정과목이 없습니다. "+ 계정과목 추가"로 등록하세요.</div>';
      return;
    }
    el.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th style="width:90px">코드</th><th>계정과목명</th><th style="width:110px">분류</th>
            <th style="width:90px">상위코드</th><th style="width:70px">상태</th>
            <th style="width:80px">순서</th><th style="width:140px">액션</th>
          </tr>
        </thead>
        <tbody>
          ${acctList.map((a, i) => {
            const isParent = !a.parentCode;
            const nameCell = isParent
              ? `<strong>${escapeHtml(a.name || '—')}</strong>`
              : `<span style="color:var(--text-2,#5b6577)">└ ${escapeHtml(a.name || '—')}</span>`;
            const statusBadge = a.isActive
              ? '<span style="color:#15803d;font-weight:600">활성</span>'
              : '<span style="color:#94a0b3">비활성</span>';
            return `<tr style="${a.isActive ? '' : 'opacity:.55'}">
              <td style="font-family:monospace">${escapeHtml(a.code || '')}</td>
              <td>${nameCell}</td>
              <td>${ACCT_CAT_LABEL[a.category] || escapeHtml(a.category || '—')}</td>
              <td style="font-family:monospace;color:var(--text-3,#94a0b3)">${escapeHtml(a.parentCode || '—')}</td>
              <td>${statusBadge}</td>
              <td style="white-space:nowrap">
                <button class="btn-sm btn-sm-ghost" type="button" ${i === 0 ? 'disabled' : ''} onclick="window.SIREN_BANK_TXN.moveAcct(${i},-1)" title="위로">▲</button>
                <button class="btn-sm btn-sm-ghost" type="button" ${i === acctList.length - 1 ? 'disabled' : ''} onclick="window.SIREN_BANK_TXN.moveAcct(${i},1)" title="아래로">▼</button>
              </td>
              <td style="white-space:nowrap">
                <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_BANK_TXN.openAcctEdit(${a.id})">수정</button>
                <button class="btn-sm btn-sm-ghost" type="button" onclick="window.SIREN_BANK_TXN.toggleAcct(${a.id})">${a.isActive ? '비활성' : '활성'}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /* 상위 코드 select 채우기 — 대분류(상위 없는 코드)만 후보로 */
  function fillAcctParentSelect(selectedCode) {
    const sel = document.getElementById('btAcctParent');
    if (!sel) return;
    const parents = acctList.filter(a => !a.parentCode);
    sel.innerHTML = '<option value="">— 대분류 (상위 없음) —</option>'
      + parents.map(p =>
          `<option value="${escapeHtml(p.code)}" ${p.code === selectedCode ? 'selected' : ''}>${escapeHtml(p.code)} ${escapeHtml(p.name)}</option>`
        ).join('');
  }

  /* acct=null → 추가, acct 객체 → 수정 */
  function openAcctModal(acct) {
    editingAcctId = acct ? acct.id : null;
    const modal  = document.getElementById('btAcctModal');
    const title  = document.getElementById('btAcctModalTitle');
    const codeEl = document.getElementById('btAcctCode');
    const nameEl = document.getElementById('btAcctName');
    const catEl  = document.getElementById('btAcctCategory');
    const actEl  = document.getElementById('btAcctActive');
    const actRow = document.getElementById('btAcctActiveRow');
    const errEl  = document.getElementById('btAcctModalError');
    if (errEl) errEl.style.display = 'none';
    if (title) title.textContent = acct ? '계정과목 수정' : '계정과목 추가';
    if (codeEl) {
      codeEl.value = acct ? acct.code : '';
      /* 코드는 전표가 참조하는 식별자라 수정 시 변경 불가 */
      codeEl.disabled = !!acct;
    }
    if (nameEl) nameEl.value = acct ? (acct.name || '') : '';
    if (catEl)  catEl.value  = acct ? acct.category : 'admin_ops';
    if (actEl)  actEl.checked = acct ? !!acct.isActive : true;
    /* 활성 체크박스는 수정 시에만 — 추가는 항상 활성 */
    if (actRow) actRow.style.display = acct ? 'flex' : 'none';
    fillAcctParentSelect(acct ? acct.parentCode : '');
    if (modal) modal.style.display = 'flex';
  }

  function openAcctEdit(id) {
    const a = acctList.find(x => x.id === id);
    if (a) openAcctModal(a);
  }

  function closeAcctModal() {
    const modal = document.getElementById('btAcctModal');
    if (modal) modal.style.display = 'none';
    editingAcctId = null;
  }

  async function saveAcct() {
    const errEl = document.getElementById('btAcctModalError');
    const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };
    const code       = document.getElementById('btAcctCode')?.value.trim();
    const name       = document.getElementById('btAcctName')?.value.trim();
    const category   = document.getElementById('btAcctCategory')?.value;
    const parentCode = document.getElementById('btAcctParent')?.value || null;
    const isActive   = document.getElementById('btAcctActive')?.checked;
    if (!name) { showErr('계정과목명을 입력하세요.'); return; }
    let res;
    if (editingAcctId) {
      res = await api('POST', '/api/admin-account-code-update', {
        id: editingAcctId, name, category, parentCode, isActive,
      });
    } else {
      if (!code || !/^[0-9]{2,20}$/.test(code)) { showErr('코드는 2~20자리 숫자여야 합니다.'); return; }
      res = await api('POST', '/api/admin-account-code-create', {
        code, name, category, parentCode,
      });
    }
    if (!res.ok) {
      showErr('저장 실패: ' + (res.data?.error || res.error || '')
        + (res.data?.detail ? ' — ' + res.data.detail : ''));
      return;
    }
    closeAcctModal();
    loadAccountCodes();
  }

  /* 비활성/활성 토글 — 삭제 대신 (전표에 쓰인 코드 보호) */
  async function toggleAcct(id) {
    const a = acctList.find(x => x.id === id);
    if (!a) return;
    const next = !a.isActive;
    if (!confirm(`"${a.name}" 계정과목을 ${next ? '활성' : '비활성'} 처리하시겠습니까?`
      + (next ? '' : '\n비활성 시 신규 선택 목록에서 숨겨집니다. 기존 전표는 그대로 유지됩니다.'))) return;
    const res = await api('POST', '/api/admin-account-code-update', { id, isActive: next });
    if (!res.ok) { alert('상태 변경 실패: ' + (res.data?.error || res.error || '')); return; }
    loadAccountCodes();
  }

  /* ▲▼ 순서 이동 — 인접 항목과 교환 후 전체 순서 전송 */
  async function moveAcct(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= acctList.length) return;
    const arr = acctList.slice();
    const tmp = arr[index]; arr[index] = arr[target]; arr[target] = tmp;
    const res = await api('POST', '/api/admin-account-code-reorder', {
      orderedIds: arr.map(a => a.id),
    });
    if (!res.ok) { alert('순서 변경 실패: ' + (res.data?.error || res.error || '')); return; }
    loadAccountCodes();
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
    else if (currentTab === 'accountCodes') loadAccountCodes();
    else loadCounterparties();
  }

  window.SIREN_BANK_TXN = {
    init,
    load,
    openConfirm,
    openCpEdit,
    unignore,
    runBatchVoucher,
    openAcctEdit,
    toggleAcct,
    moveAcct,
  };
})();
