/* admin-finance-report.js — Phase 7 + 22A: 재무 보고서 (손익계산서 탭 추가) */
(function () {
  'use strict';

  let lastData  = null;
  let lastPlData = null;
  let currentTab = 'report'; // 'report' | 'pl'

  function apiFetch(url) {
    return fetch(url, { credentials: 'include' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
  }

  function fmtKRW(n) {
    if (n === undefined || n === null || isNaN(n)) return '0원';
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  function fmtShort(n) {
    if (!n && n !== 0) return '—';
    const v = Number(n);
    if (v >= 100000000) return (v / 100000000).toFixed(1) + '억원';
    if (v >= 10000)     return (v / 10000).toFixed(1)     + '만원';
    return v.toLocaleString('ko-KR') + '원';
  }

  /* ── 탭 전환 ── */
  function switchTab(tab) {
    currentTab = tab;
    ['report', 'pl'].forEach(t => {
      const btn  = document.getElementById('frTab-' + t);
      const pane = document.getElementById('frPane-' + t);
      if (btn)  btn.classList.toggle('on', t === tab);
      if (pane) pane.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'pl' && !lastPlData) loadPl();
  }

  /* ── 기존 보고서 렌더 ── */
  function render(data) {
    const d = data.data || data;
    lastData = d;

    // KPI
    document.getElementById('frKpiIncome').textContent = fmtKRW(d.income?.total);
    document.getElementById('frKpiExp').textContent    = fmtKRW(d.expenditure?.total);
    const bal   = d.balance || 0;
    const balEl = document.getElementById('frKpiBalance');
    if (balEl) {
      balEl.textContent = fmtKRW(Math.abs(bal));
      balEl.style.color = bal < 0 ? 'var(--danger)' : 'var(--success)';
      const balLabel = document.getElementById('frKpiBalanceLabel');
      if (balLabel) balLabel.textContent = bal < 0 ? '적자' : '흑자';
    }

    // 예산 대비 실적
    const tbody = document.getElementById('frBvaTbody');
    if (tbody) {
      const items = d.budgetVsActual || [];
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-3)">예산 데이터 없음 (Phase 6 예산 편성 후 조회 가능)</td></tr>`;
      } else {
        tbody.innerHTML = items.map(item => {
          const rc = item.rate >= 90 ? 'var(--danger)' : item.rate >= 70 ? '#f59e0b' : 'var(--success)';
          return `<tr>
            <td>${item.name}</td>
            <td class="num">${fmtKRW(item.budget)}</td>
            <td class="num">${fmtKRW(item.actual)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div class="pct-bar" style="flex:1"><div class="pct-fill" style="width:${Math.min(item.rate||0,100)}%;background:${rc}"></div></div>
                <span style="color:${rc};font-weight:600;min-width:36px">${item.rate || 0}%</span>
              </div>
            </td>
          </tr>`;
        }).join('');
      }
    }

    // 지출 사업별
    const expTbody = document.getElementById('frExpTbody');
    if (expTbody) {
      const cats = d.expenditure?.byCategory || [];
      expTbody.innerHTML = cats.length
        ? cats.map(c => `<tr><td>${c.category_name || '—'}</td><td class="num">${fmtKRW(c.amount)}</td><td class="num">${c.count}건</td></tr>`).join('')
        : `<tr><td colspan="3" style="text-align:center;color:var(--text-3)">지출 내역 없음</td></tr>`;
    }
  }

  /* ── 손익계산서 렌더 ── */
  function renderPl(pl) {
    lastPlData = pl;
    const pane = document.getElementById('frPane-pl');
    if (!pane) return;

    const rev  = pl.revenue || {};
    const don  = rev.donations || {};
    const oth  = rev.other     || {};
    const exp  = pl.expenditure || {};
    const net  = pl.netIncome  || 0;

    const otherRows = (oth.byCategory || []).map(cat =>
      `<tr>
        <td style="padding-left:20px;color:var(--text-2)">${cat.name}</td>
        <td></td>
        <td class="num">${fmtKRW(cat.net)}</td>
      </tr>`
    ).join('');

    const expByCat = exp.byCategory || [];
    const expRows = expByCat.length
      ? expByCat.map(cat =>
          `<tr>
            <td style="padding-left:20px;color:var(--text-2)">${cat.name || cat.code || '—'}</td>
            <td></td>
            <td class="num" style="color:var(--danger)">${fmtKRW(cat.total != null ? cat.total : cat.amount)}</td>
          </tr>`
        ).join('')
      : `<tr><td colspan="3" style="padding-left:20px;color:var(--text-3);font-style:italic">지출 내역 없음</td></tr>`;

    const netColor = net >= 0 ? 'var(--success)' : 'var(--danger)';
    const netLabel = net >= 0 ? '당기 순이익' : '당기 순손실';

    pane.innerHTML = `
      <!-- 손익 요약 KPI -->
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
        <div class="kpi"><div class="kpi-label">총 매출 (순)</div><div class="kpi-value">${fmtShort(rev.totalNet)}</div></div>
        <div class="kpi"><div class="kpi-label">총 지출</div><div class="kpi-value" style="color:var(--danger)">${fmtShort(exp.total)}</div></div>
        <div class="kpi"><div class="kpi-label">${netLabel}</div><div class="kpi-value" style="color:${netColor}">${fmtShort(Math.abs(net))}</div></div>
      </div>

      <!-- 손익계산서 테이블 -->
      <table class="data-table" style="width:100%;margin-bottom:24px">
        <thead>
          <tr><th>항목</th><th class="num">총액</th><th class="num">순액</th></tr>
        </thead>
        <tbody>
          <!-- 수익 섹션 -->
          <tr style="background:var(--bg-2)">
            <td colspan="3" style="font-weight:700;color:var(--text-1)">Ⅰ. 수익</td>
          </tr>
          <tr>
            <td style="padding-left:12px">후원 수입</td>
            <td class="num">${fmtKRW(don.gross)}</td>
            <td class="num">${fmtKRW(don.net)}</td>
          </tr>
          ${don.refund > 0 ? `<tr><td style="padding-left:20px;color:var(--danger)">(-) 환불</td><td class="num" style="color:var(--danger)">${fmtKRW(don.refund)}</td><td></td></tr>` : ''}
          <tr>
            <td style="padding-left:12px">후원 외 매출</td>
            <td class="num">${fmtKRW(oth.gross)}</td>
            <td class="num">${fmtKRW(oth.net)}</td>
          </tr>
          ${oth.refund > 0 ? `<tr><td style="padding-left:20px;color:var(--danger)">(-) 환불</td><td class="num" style="color:var(--danger)">${fmtKRW(oth.refund)}</td><td></td></tr>` : ''}
          ${otherRows}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>수익 합계</td>
            <td></td>
            <td class="num">${fmtKRW(rev.totalNet)}</td>
          </tr>

          <!-- 지출 섹션 -->
          <tr style="background:var(--bg-2)">
            <td colspan="3" style="font-weight:700;color:var(--text-1)">Ⅱ. 지출</td>
          </tr>
          ${expRows}
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td>지출 합계</td>
            <td></td>
            <td class="num" style="color:var(--danger)">${fmtKRW(exp.total)}</td>
          </tr>

          <!-- 당기 순이익 -->
          <tr style="background:${net >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'};font-weight:700;border-top:2px solid var(--border)">
            <td colspan="2">${netLabel} (Ⅰ−Ⅱ)</td>
            <td class="num" style="color:${netColor};font-size:16px">${fmtKRW(Math.abs(net))}</td>
          </tr>
        </tbody>
      </table>

      <!-- 월별 손익 추이 -->
      <div style="font-size:14px;font-weight:700;margin-bottom:8px">월별 손익 추이</div>
      <table class="data-table" style="width:100%">
        <thead><tr><th>월</th><th class="num">매출</th><th class="num">지출</th><th class="num">순이익</th></tr></thead>
        <tbody>
          ${(pl.monthly || []).map(m => {
            const nc = m.net >= 0 ? 'var(--success)' : 'var(--danger)';
            return `<tr>
              <td>${m.month}월</td>
              <td class="num">${m.revenue ? fmtKRW(m.revenue) : '—'}</td>
              <td class="num">${m.expenditure ? fmtKRW(m.expenditure) : '—'}</td>
              <td class="num" style="color:${nc};font-weight:600">${m.revenue || m.expenditure ? fmtKRW(m.net) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  /* ── 엑셀 내보내기 (손익 시트 추가) ── */
  function exportExcel() {
    if (!lastData && !lastPlData) { alert('먼저 데이터를 불러와 주세요.'); return; }
    if (!window.XLSX) { alert('SheetJS 라이브러리가 로드되지 않았습니다.'); return; }

    const d  = lastData  || {};
    const pl = lastPlData || {};
    const wb = XLSX.utils.book_new();

    // 시트 1: 수입 요약
    const incomeSheet = [
      ['채널', '금액(원)'],
      ['토스',      d.income?.byChannel?.toss    || 0],
      ['효성 CMS+', d.income?.byChannel?.hyosung  || 0],
      ['계좌이체',  d.income?.byChannel?.bank     || 0],
      ['기타',      d.income?.byChannel?.other    || 0],
      ['합계',      d.income?.total               || 0],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incomeSheet), '수입');

    // 시트 2: 지출 사업별
    const expSheet = [['사업명', '금액(원)', '건수'], ...(d.expenditure?.byCategory || []).map(c => [c.category_name, c.amount, c.count])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expSheet), '지출');

    // 시트 3: 예산 대비
    const bvaSheet = [['사업명', '예산(원)', '실적(원)', '집행률(%)'], ...(d.budgetVsActual || []).map(i => [i.name, i.budget, i.actual, i.rate])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bvaSheet), '예산비교');

    // 시트 4: 손익계산서 (Phase 22A)
    if (pl.revenue) {
      const rev = pl.revenue || {};
      const exp = pl.expenditure || {};
      const plSheet = [
        ['항목', '총액(원)', '순액(원)'],
        ['Ⅰ. 수익', '', ''],
        ['후원 수입',      rev.donations?.gross || 0, rev.donations?.net || 0],
        ['후원 외 매출',   rev.other?.gross     || 0, rev.other?.net     || 0],
        ...(rev.other?.byCategory || []).map(c => ['  ' + c.name, '', c.net]),
        ['수익 합계', '', rev.totalNet || 0],
        ['', '', ''],
        ['Ⅱ. 지출', '', ''],
        ...(exp.byCategory || []).map(c => [c.name || c.code, (c.total != null ? c.total : c.amount) || 0, '']),
        ['지출 합계', '', exp.total || 0],
        ['', '', ''],
        [pl.netIncome >= 0 ? '당기 순이익' : '당기 순손실', '', Math.abs(pl.netIncome || 0)],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plSheet), '손익계산서');
    }

    const year = d.year || pl.fiscalYear || new Date().getFullYear();
    XLSX.writeFile(wb, `SIREN_재무보고서_${year}.xlsx`);
  }

  /* ── 로드 ── */
  async function load() {
    const pd = getFrPeriodQs();
    const params = new URLSearchParams({ year: pd.year, period: pd.period });
    if (pd.startDate) params.set('startDate', pd.startDate);
    if (pd.endDate)   params.set('endDate',   pd.endDate);

    const res = await apiFetch('/api/admin-finance-report?' + params);
    if (!res.ok) { alert('보고서 조회 실패: ' + (res.error || '')); return; }
    render(res);

    // 손익 탭이 활성이면 같이 갱신
    if (currentTab === 'pl') loadPl();
  }

  async function loadPl() {
    const year = getFrPeriodQs().year;
    const res  = await apiFetch(`/api/admin-finance-pl-summary?fiscalYear=${year}`);
    if (!res.ok) {
      const pane = document.getElementById('frPane-pl');
      if (pane) pane.innerHTML = `<div style="color:var(--danger);padding:20px">손익 집계 조회 실패: ${res.data?.error || res.error || ''}</div>`;
      return;
    }
    const pl = res.data?.data || res.data || res;
    renderPl(pl);
  }

  /* ── 기간 선택기 헬퍼 ── */
  function frPeriodSelectorHtml() {
    return `
      <select id="frPeriodSel" class="input-sm" style="width:120px">
        <option value="day">오늘</option>
        <option value="week">이번 주</option>
        <option value="month" selected>이번 달</option>
        <option value="half_year">반기</option>
        <option value="year">올해</option>
        <option value="custom">특정 기간</option>
      </select>
      <div id="frCustomRange" style="display:none;align-items:center;gap:6px">
        <input type="date" id="frStartDate" class="input-sm">
        <span>~</span>
        <input type="date" id="frEndDate" class="input-sm">
      </div>
    `;
  }

  function getFrPeriodQs() {
    const sel    = document.getElementById('frPeriodSel');
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
      startDate = document.getElementById('frStartDate')?.value || '';
      endDate   = document.getElementById('frEndDate')?.value   || '';
    }
    return { period, startDate, endDate,
      year: startDate ? new Date(startDate).getFullYear() : today.getFullYear() };
  }

  /* ── 초기화 ── */
  function init() {
    const container = document.getElementById('adm-finance-report') || document.getElementById('page-finance-report');
    if (!container) return;

    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">재무 보고서</div>
          <div class="p-actions" style="gap:8px;flex-wrap:wrap">
            ${frPeriodSelectorHtml()}
            <button class="btn-sm btn-sm-primary" onclick="window.SIREN_FINANCE_REPORT.load()">조회</button>
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_REPORT.exportExcel()">📊 엑셀</button>
            <button class="btn-sm btn-sm-ghost" onclick="window.print()">🖨 인쇄</button>
          </div>
        </div>

        <!-- 탭 (Phase 22A: 손익계산서 추가) -->
        <div class="content-tabs" style="margin-bottom:20px">
          <button type="button" class="ct-tab on" id="frTab-report" onclick="window.SIREN_FINANCE_REPORT.switchTab('report')">📋 예산·실적 보고서</button>
          <button type="button" class="ct-tab"    id="frTab-pl"     onclick="window.SIREN_FINANCE_REPORT.switchTab('pl')">📊 손익계산서</button>
        </div>

        <!-- 탭1: 기존 보고서 -->
        <div id="frPane-report">
          <!-- KPI 3개 -->
          <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
            <div class="kpi"><div class="kpi-label">총 수입</div><div class="kpi-value" id="frKpiIncome">—</div></div>
            <div class="kpi"><div class="kpi-label">총 지출</div><div class="kpi-value" id="frKpiExp">—</div></div>
            <div class="kpi">
              <div class="kpi-label" id="frKpiBalanceLabel">잔액</div>
              <div class="kpi-value" id="frKpiBalance">—</div>
            </div>
          </div>

          <!-- 예산 대비 실적 -->
          <div style="font-size:14px;font-weight:700;margin-bottom:8px">예산 대비 실적</div>
          <table class="data-table" style="width:100%;margin-bottom:24px">
            <thead><tr><th>사업명</th><th class="num">예산(원)</th><th class="num">실적(원)</th><th>집행률</th></tr></thead>
            <tbody id="frBvaTbody"><tr><td colspan="4" style="text-align:center">조회 버튼을 눌러 데이터를 불러오세요.</td></tr></tbody>
          </table>

          <!-- 지출 사업별 -->
          <div style="font-size:14px;font-weight:700;margin-bottom:8px">사업별 지출 내역</div>
          <table class="data-table" style="width:100%">
            <thead><tr><th>사업명</th><th class="num">지출(원)</th><th class="num">건수</th></tr></thead>
            <tbody id="frExpTbody"><tr><td colspan="3" style="text-align:center">—</td></tr></tbody>
          </table>
        </div>

        <!-- 탭2: 손익계산서 (Phase 22A) -->
        <div id="frPane-pl" style="display:none">
          <div style="text-align:center;color:var(--text-3);padding:40px">손익계산서 탭을 클릭하면 로드됩니다.</div>
        </div>
      </div>
    `;

    const sel = document.getElementById('frPeriodSel');
    if (sel) {
      sel.addEventListener('change', () => {
        const cr = document.getElementById('frCustomRange');
        if (cr) cr.style.display = sel.value === 'custom' ? 'flex' : 'none';
        if (sel.value !== 'custom') load();
      });
    }
    const startEl = document.getElementById('frStartDate');
    const endEl   = document.getElementById('frEndDate');
    if (startEl && endEl) {
      const check = () => { if (startEl.value && endEl.value) load(); };
      startEl.addEventListener('change', check);
      endEl.addEventListener('change', check);
    }

    load();
  }

  window.SIREN_FINANCE_REPORT = { load, init, exportExcel, switchTab };
})();
