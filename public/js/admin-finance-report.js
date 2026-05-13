/* admin-finance-report.js — Phase 7 + 22A: 재무 보고서 (손익계산서 탭 추가) */
(function () {
  'use strict';

  let lastData  = null;
  let lastPlData = null;
  let currentTab = 'report'; // 'report' | 'pl'

  /* ── mock 손익 데이터 (B 머지 전) ── */
  const MOCK_PL_SUMMARY = {
    fiscalYear: 2026,
    revenue: {
      donations: { gross: 50000000, refund: 500000, net: 49500000 },
      other: {
        gross: 12500000, refund: 200000, net: 12300000,
        byCategory: [
          { code: 'lecture',      name: '강연·교육 수익',                    net: 3000000 },
          { code: 'govgrant',     name: '정부·지자체 지원금',                net: 5000000 },
          { code: 'corp_sponsor', name: '기업 협찬·제휴 수익',               net: 2000000 },
          { code: 'twork_on',     name: '함께워크_On (사업지원·자리대여)', net: 1500000 },
          { code: 'twork_si',     name: '함께워크_SI (AI·AX·SI)',           net:  800000 },
          { code: 'etc',          name: '기타',                              net:        0 },
        ],
      },
      totalNet: 61800000,
    },
    expenditure: {
      total: 55000000,
      byCategory: [
        { code: 'ops',     name: '운영비', total: 20000000 },
        { code: 'program', name: '사업비', total: 25000000 },
        { code: 'admin',   name: '관리비', total: 10000000 },
      ],
    },
    netIncome: 6800000,
    monthly: [
      { month:  1, revenue: 5000000, expenditure: 4500000, net:  500000 },
      { month:  2, revenue: 5200000, expenditure: 4600000, net:  600000 },
      { month:  3, revenue: 5100000, expenditure: 4700000, net:  400000 },
      { month:  4, revenue: 5500000, expenditure: 4800000, net:  700000 },
      { month:  5, revenue: 6000000, expenditure: 4900000, net: 1100000 },
      { month:  6, revenue: 0, expenditure: 0, net: 0 },
      { month:  7, revenue: 0, expenditure: 0, net: 0 },
      { month:  8, revenue: 0, expenditure: 0, net: 0 },
      { month:  9, revenue: 0, expenditure: 0, net: 0 },
      { month: 10, revenue: 0, expenditure: 0, net: 0 },
      { month: 11, revenue: 0, expenditure: 0, net: 0 },
      { month: 12, revenue: 0, expenditure: 0, net: 0 },
    ],
  };

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

    const expRows = (exp.byCategory || []).map(cat =>
      `<tr>
        <td style="padding-left:20px;color:var(--text-2)">${cat.name}</td>
        <td></td>
        <td class="num" style="color:var(--danger)">${fmtKRW(cat.total)}</td>
      </tr>`
    ).join('');

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
        ...(exp.byCategory || []).map(c => [c.name, c.total, '']),
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
    const year   = document.getElementById('frYearSelect')?.value   || new Date().getFullYear();
    const period = document.getElementById('frPeriodSelect')?.value || 'annual';
    let qs = `?year=${year}`;
    if (period.startsWith('q'))  qs += `&quarter=${period.slice(1)}`;
    else if (period !== 'annual') qs += `&month=${period}`;

    const res = await apiFetch('/api/admin-finance-report' + qs);
    if (!res.ok) { alert('보고서 조회 실패: ' + (res.error || '')); return; }
    render(res);

    // 손익 탭이 활성이면 같이 갱신
    if (currentTab === 'pl') loadPl();
  }

  async function loadPl() {
    const year = document.getElementById('frYearSelect')?.value || new Date().getFullYear();
    const res  = await apiFetch(`/api/admin-finance-pl-summary?year=${year}`);
    const pl   = res.ok ? (res.data || res) : MOCK_PL_SUMMARY;
    renderPl(pl);
  }

  /* ── 초기화 ── */
  function init() {
    const container = document.getElementById('adm-finance-report');
    if (!container) return;

    const ty = new Date().getFullYear();
    const yearOpts = Array.from({ length: 6 }, (_, i) => `<option value="${ty - i}">${ty - i}년</option>`).join('');
    const periodOpts = `
      <option value="annual">연간</option>
      <option value="q1">1분기</option><option value="q2">2분기</option>
      <option value="q3">3분기</option><option value="q4">4분기</option>
      <option value="1">1월</option><option value="2">2월</option><option value="3">3월</option>
      <option value="4">4월</option><option value="5">5월</option><option value="6">6월</option>
      <option value="7">7월</option><option value="8">8월</option><option value="9">9월</option>
      <option value="10">10월</option><option value="11">11월</option><option value="12">12월</option>
    `;

    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">재무 보고서</div>
          <div class="p-actions" style="gap:8px">
            <select id="frYearSelect" class="input-sm" style="width:90px">${yearOpts}</select>
            <select id="frPeriodSelect" class="input-sm" style="width:100px">${periodOpts}</select>
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

    load();
  }

  window.SIREN_FINANCE_REPORT = { load, init, exportExcel, switchTab };
})();
