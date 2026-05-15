/* admin-finance-report.js — Phase 22-B-R3: NPO 표준 회계 보고서
   탭1 운영성과표(Statement of Operations) / 탭2 예산 대비 실적표(Budget vs Actual)
   출력 3종: 인쇄(window.print) · 엑셀(SheetJS) · PDF(admin-finance-report-pdf API) */
(function () {
  'use strict';

  let lastPlData       = null;   // 운영성과표 데이터
  let lastBudgetData   = null;   // 예산 대비 실적표 데이터
  let lastBalanceData  = null;   // 재정상태표 데이터
  let lastCashflowData = null;   // 현금흐름표 데이터
  let orgName        = '(사)교사유가족협의회';
  let currentTab     = 'pl';   // 'pl' | 'budget' | 'balance' | 'cashflow'
  let anomalyMap     = {};     // { accountCode: { rate, current, prev } } — 이상 지출 패턴

  /* NPO 표준 4분류 (지출) */
  const NPO_EXP_CLASSES = [
    { code: 'personnel',   label: '인건비' },
    { code: 'program',     label: '사업비' },
    { code: 'admin_ops',   label: '관리운영비' },
    { code: 'fundraising', label: '모금비' },
  ];

  function apiFetch(url) {
    return fetch(url, { credentials: 'include' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
  }

  function fmtKRW(n) {
    if (n === undefined || n === null || isNaN(n)) return '0원';
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  function fmtNum(n) {
    if (n === undefined || n === null || isNaN(n)) return 0;
    return Number(n);
  }

  function nowStr() {
    const d = new Date();
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ── 협회명 조회 (보고서 머리말용) ── */
  async function loadOrgName() {
    try {
      const res = await apiFetch('/api/admin/receipt-settings');
      const s = res?.data?.data?.settings || {};
      if (s.orgName) orgName = s.orgName;
    } catch { /* 기본값 유지 */ }
  }

  /* ── 이상 지출 패턴 조회 (계정과목별 전월 대비 급증) ── */
  async function loadAnomaly() {
    try {
      const res = await apiFetch('/api/admin-finance-anomaly');
      const d = res?.data?.data || res?.data || res || {};
      /* 백엔드는 items에 급증·비급증 모두 담고 surge 플래그로 구분 — surgeItems만 배지 대상 */
      const items = d.surgeItems || (d.items || d.anomalies || (Array.isArray(d) ? d : [])).filter(it => it.surge);
      anomalyMap = {};
      (items || []).forEach(it => {
        const code = it.accountCode || it.account_code || it.code;
        if (!code) return;
        anomalyMap[String(code)] = {
          rate:    it.changeRate ?? it.increaseRate ?? it.increase_rate ?? it.rate ?? null,
          current: it.thisMonth ?? it.currentAmount ?? it.current_amount ?? it.current ?? 0,
          prev:    it.prevSync ?? it.prevAmount ?? it.prev_amount ?? it.previous ?? 0,
        };
      });
    } catch { anomalyMap = {}; }
  }

  function anomalyBadge(code) {
    const a = anomalyMap[String(code)];
    if (!a) return '';
    const rateText = (a.rate == null) ? '신규' : `+${Math.round(a.rate)}%`;
    return ` <span class="print-hide" title="전월 대비 급증" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;border:1px solid #fde68a">⚠️ 급증 ${rateText}</span>`;
  }

  /* ── 보고서 머리말 ── */
  function reportHeaderHtml(title, periodLabel) {
    return `
      <div class="fr-report-header report-header">
        <div class="fr-org-name">${orgName}</div>
        <h2 class="report-title">${title}</h2>
        <div class="report-period">기간: ${periodLabel || '—'}</div>
        <div class="fr-generated">생성일시: ${nowStr()}</div>
      </div>
    `;
  }

  /* ── 탭 전환 ── */
  function switchTab(tab) {
    currentTab = tab;
    ['pl', 'budget', 'balance', 'cashflow'].forEach(t => {
      const btn  = document.getElementById('frTab-' + t);
      const pane = document.getElementById('frPane-' + t);
      if (btn)  btn.classList.toggle('on', t === tab);
      if (pane) pane.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'pl'       && !lastPlData)       loadPl();
    if (tab === 'budget'   && !lastBudgetData)   loadBudget();
    if (tab === 'balance'  && !lastBalanceData)  loadBalance();
    if (tab === 'cashflow' && !lastCashflowData) loadCashflow();
  }

  /* ════════════════════════════════════════════
     운영성과표 (Statement of Operations)
     ════════════════════════════════════════════ */
  async function loadPl() {
    const pd = getFrPeriodQs();
    const params = new URLSearchParams({ period: pd.period });
    if (pd.startDate) params.set('startDate', pd.startDate);
    if (pd.endDate)   params.set('endDate',   pd.endDate);

    const pane = document.getElementById('frPane-pl');
    if (pane) pane.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:40px">불러오는 중…</div>`;

    const res = await apiFetch('/api/admin-finance-pl-summary?' + params);
    if (!res.ok) {
      if (pane) pane.innerHTML = `<div style="color:var(--danger);padding:20px">운영성과표 조회 실패: ${res.data?.error || res.error || ''}</div>`;
      return;
    }
    const pl = res.data?.data || res.data || res;
    pl.__periodLabel = periodLabel(pd);
    renderPl(pl);
  }

  function renderPl(pl) {
    lastPlData = pl;
    const pane = document.getElementById('frPane-pl');
    if (!pane) return;

    const rev = pl.revenue || {};
    const don = rev.donations || {};
    const oth = rev.other || {};
    const exp = pl.expenditure || {};

    // Ⅰ 사업수익
    const donNet      = fmtNum(don.net);
    const othNet      = fmtNum(oth.net);
    const revTotalNet = fmtNum(rev.totalNet);

    const othCatRows = (oth.byCategory || []).map(c =>
      `<tr>
        <td class="fr-indent2">· ${c.name}</td>
        <td class="num"></td>
        <td class="num">${fmtKRW(c.net)}</td>
      </tr>`
    ).join('');

    // Ⅱ 사업비용 — NPO 4분류로 매핑
    const expByCat = exp.byCategory || [];
    const expClassMap = {};
    let expClassified = 0;
    for (const c of expByCat) {
      const amt = fmtNum(c.total != null ? c.total : c.amount);
      const key = NPO_EXP_CLASSES.some(x => x.code === c.code) ? c.code : '__etc';
      expClassMap[key] = (expClassMap[key] || 0) + amt;
    }
    const expClassRows = NPO_EXP_CLASSES.map((cls, idx) => {
      const amt = fmtNum(expClassMap[cls.code]);
      expClassified += amt;
      return `<tr>
        <td class="fr-indent1">${idx + 1}. ${cls.label}</td>
        <td class="num"></td>
        <td class="num">${fmtKRW(amt)}</td>
      </tr>`;
    }).join('');
    const etcExp = fmtNum(expClassMap['__etc']);
    const etcRow = etcExp > 0
      ? `<tr><td class="fr-indent1">5. 기타비용</td><td class="num"></td><td class="num">${fmtKRW(etcExp)}</td></tr>`
      : '';
    const expTotal = fmtNum(exp.total);

    // Ⅲ 운영성과
    const result      = fmtNum(pl.netIncome);
    const resultColor = result >= 0 ? 'var(--success)' : 'var(--danger)';
    const resultLabel = result >= 0 ? '운영성과 (잉여)' : '운영성과 (부족)';

    pane.innerHTML = `
      ${reportHeaderHtml('운영성과표', pl.__periodLabel)}

      <div style="background:#f0f7ff;border:1px solid #c5daf5;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1a5ec4;line-height:1.6">
        💡 <strong>운영성과표 = 수익(승인·완료된 거래) − 비용(승인된 지출)</strong>.
        후원·후원 외 매출·지출의 상태가 <strong>"승인"</strong> 인 행만 집계됩니다.
        직접 계좌이체로 신청만 하고 입금 확인 안 된 건(<code>pending_bank</code>)은 매출로 잡히지 않습니다 — [📥 입금 매칭·통과]에서 통과 처리해야 합산됩니다.
      </div>

      <table class="data-table report-table fr-statement" style="width:100%">
        <thead>
          <tr><th style="width:60%">계정과목</th><th class="num">소계</th><th class="num">금액</th></tr>
        </thead>
        <tbody>
          <!-- Ⅰ 사업수익 -->
          <tr class="fr-section"><td colspan="3">Ⅰ. 사업수익</td></tr>
          <tr>
            <td class="fr-indent1">1. 후원금수익</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(donNet)}</td>
          </tr>
          <tr>
            <td class="fr-indent1">2. 사업수익 (후원 외)</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(othNet)}</td>
          </tr>
          ${othCatRows}
          <tr class="fr-subtotal">
            <td>사업수익 계</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(revTotalNet)}</td>
          </tr>

          <!-- Ⅱ 사업비용 -->
          <tr class="fr-section"><td colspan="3">Ⅱ. 사업비용</td></tr>
          ${expClassRows}
          ${etcRow}
          <tr class="fr-subtotal">
            <td>사업비용 계</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(expTotal)}</td>
          </tr>

          <!-- Ⅲ 운영성과 -->
          <tr class="fr-result" style="background:${result >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}">
            <td colspan="2">Ⅲ. ${resultLabel} (Ⅰ − Ⅱ)</td>
            <td class="num" style="color:${resultColor};font-size:15px;font-weight:700">${fmtKRW(result)}</td>
          </tr>
        </tbody>
      </table>

      <div class="fr-note">※ 수익·비용은 모두 환불 차감 후 순액 기준입니다.</div>
    `;
  }

  /* ════════════════════════════════════════════
     예산 대비 실적표 (Budget vs Actual)
     ════════════════════════════════════════════ */
  async function loadBudget() {
    const pd = getFrPeriodQs();
    const year = pd.year;

    const pane = document.getElementById('frPane-budget');
    if (pane) pane.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:40px">불러오는 중…</div>`;

    const res = await apiFetch('/api/admin-finance-budget-list?year=' + year);
    if (!res.ok) {
      if (pane) pane.innerHTML = `<div style="color:var(--danger);padding:20px">예산 대비 실적표 조회 실패: ${res.data?.error || res.error || ''}</div>`;
      return;
    }
    const bd = res.data?.data || res.data || res;
    bd.__year = year;
    renderBudget(bd);
  }

  function renderBudget(bd) {
    lastBudgetData = bd;
    const pane = document.getElementById('frPane-budget');
    if (!pane) return;

    const fiscalLabel = `${bd.year || bd.__year} 회계연도`;

    // 승인 예산안 없음
    if (bd.noPlan) {
      pane.innerHTML = `
        ${reportHeaderHtml('예산 대비 실적표', fiscalLabel)}
        <div class="fr-noplan">
          <div style="font-size:32px;margin-bottom:8px">📋</div>
          <div style="font-weight:700;margin-bottom:6px">승인된 예산안이 없습니다</div>
          <div style="color:var(--text-3)">${bd.message || `${bd.year}년도 예산안을 편성·승인 후 집행률 확인이 가능합니다.`}</div>
        </div>
      `;
      return;
    }

    const items = bd.items || [];
    const planTitle = bd.plan?.title ? ` — 승인 예산안: "${bd.plan.title}"` : '';

    const rows = items.map(item => {
      const planned   = fmtNum(item.plannedAmount);
      const executed  = fmtNum(item.executedAmount);
      const remaining = fmtNum(item.remaining);
      const rate      = fmtNum(item.rate);
      const rc = rate >= 90 ? 'var(--danger)' : rate >= 70 ? '#f59e0b' : 'var(--success)';
      return `<tr>
        <td>${item.categoryName || item.categoryCode || '—'}${anomalyBadge(item.categoryCode || item.categoryName)}</td>
        <td class="num">${fmtKRW(planned)}</td>
        <td class="num">${fmtKRW(executed)}</td>
        <td class="num" style="color:${remaining < 0 ? 'var(--danger)' : 'inherit'}">${fmtKRW(remaining)}</td>
        <td class="num" style="color:${rc};font-weight:600">${rate}%</td>
      </tr>`;
    }).join('');

    const totalPlanned   = fmtNum(bd.totalPlanned);
    const totalExecuted  = fmtNum(bd.totalExecuted);
    const totalRemaining = fmtNum(bd.totalRemaining != null ? bd.totalRemaining : totalPlanned - totalExecuted);
    const totalRate      = fmtNum(bd.executionRate != null ? bd.executionRate : (totalPlanned > 0 ? Math.round(totalExecuted / totalPlanned * 100) : 0));

    pane.innerHTML = `
      ${reportHeaderHtml('예산 대비 실적표', fiscalLabel + planTitle)}

      <div style="background:#f0f7ff;border:1px solid #c5daf5;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1a5ec4;line-height:1.6">
        💡 <strong>예산 = "승인" 상태 예산서</strong>의 항목별 계획 / <strong>실적 = "승인" 상태 지출</strong>의 발생액.
        예산서가 "작성중·검토중" 상태면 이 표에 안 나타납니다 — [📋 예산 관리]에서 결재 진행 → 승인까지 완료해야 반영됩니다.
      </div>

      <table class="data-table report-table fr-statement" style="width:100%">
        <thead>
          <tr>
            <th>계정과목</th>
            <th class="num">편성액</th>
            <th class="num">집행액</th>
            <th class="num">잔여액</th>
            <th class="num">집행률</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5" style="text-align:center;color:var(--text-3)">예산 항목이 없습니다.</td></tr>`}
          <tr class="fr-result">
            <td style="font-weight:700">합계</td>
            <td class="num" style="font-weight:700">${fmtKRW(totalPlanned)}</td>
            <td class="num" style="font-weight:700">${fmtKRW(totalExecuted)}</td>
            <td class="num" style="font-weight:700;color:${totalRemaining < 0 ? 'var(--danger)' : 'inherit'}">${fmtKRW(totalRemaining)}</td>
            <td class="num" style="font-weight:700">${totalRate}%</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  /* ════════════════════════════════════════════
     재정상태표 (간이판 — 통장 잔액 기반 현금성 자산)
     ════════════════════════════════════════════ */
  async function loadBalance() {
    const pane = document.getElementById('frPane-balance');
    if (pane) pane.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:40px">불러오는 중…</div>`;

    const res = await apiFetch('/api/admin-finance-balance-sheet');
    if (!res.ok) {
      if (pane) pane.innerHTML = `<div style="color:var(--danger);padding:20px">재정상태표 조회 실패: ${res.data?.error || res.error || ''}</div>`;
      return;
    }
    const bs = res.data?.data || res.data || res;
    renderBalance(bs);
  }

  function renderBalance(bs) {
    lastBalanceData = bs;
    const pane = document.getElementById('frPane-balance');
    if (!pane) return;

    const asset_   = bs.assets || {};
    const liab_    = bs.liabilities || {};
    const asOf      = bs.asOf || bs.asOfDate || bs.as_of_date || bs.date || '—';
    const cashAsset = fmtNum(asset_.cash ?? bs.cashAssets ?? bs.cash_assets ?? bs.cashAsset ?? bs.bankBalance ?? bs.bank_balance ?? 0);
    const totalAssets = fmtNum(asset_.total ?? bs.totalAssets ?? bs.total_assets ?? cashAsset);
    const totalLiab   = fmtNum(liab_.total ?? bs.totalLiabilities ?? bs.total_liabilities ?? 0);
    const netAssets   = fmtNum(bs.netAsset ?? bs.netAssets ?? bs.net_assets ?? (totalAssets - totalLiab));

    /* 통장별 잔액 내역 (있으면) */
    const accounts = bs.accounts || bs.bankAccounts || bs.bank_accounts || [];
    const acctRows = accounts.map(a => `<tr>
      <td class="fr-indent2">· ${a.name || a.bankName || a.bank_name || a.accountName || '통장'}</td>
      <td class="num"></td>
      <td class="num">${fmtKRW(fmtNum(a.balance ?? a.balanceAfter ?? a.balance_after ?? 0))}</td>
    </tr>`).join('');

    pane.innerHTML = `
      ${reportHeaderHtml('재정상태표', `${asOf} 기준`)}

      <div style="background:#fff7e6;border:1px solid #f5d8a8;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#7d5400;line-height:1.6">
        ⚠️ <strong>이 표는 IBK 통장 거래내역으로만 산정</strong>됩니다.
        후원·후원외 매출·지출 입력값이 아니라 실제 통장의 잔액 변동만 반영하므로,
        IBK CSV를 한 번도 업로드하지 않았다면 자산이 0으로 표시됩니다.
        [📥 입금 매칭·통과 → 자료 업로드·통과]에서 IBK 거래내역 CSV를 통과 처리해야 채워집니다.
      </div>

      <table class="data-table report-table fr-statement" style="width:100%">
        <thead>
          <tr><th style="width:60%">계정과목</th><th class="num">소계</th><th class="num">금액</th></tr>
        </thead>
        <tbody>
          <tr class="fr-section"><td colspan="3">【자산】</td></tr>
          <tr>
            <td class="fr-indent1">현금성 자산 (통장 잔액)</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(cashAsset)}</td>
          </tr>
          ${acctRows}
          <tr>
            <td class="fr-indent1" style="color:var(--text-3)">비현금 자산</td>
            <td class="num"></td>
            <td class="num" style="color:var(--text-3)">해당 없음</td>
          </tr>
          <tr class="fr-subtotal">
            <td>자산 총계</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(totalAssets)}</td>
          </tr>

          <tr class="fr-section"><td colspan="3">【부채】</td></tr>
          <tr>
            <td class="fr-indent1" style="color:var(--text-3)">부채</td>
            <td class="num"></td>
            <td class="num" style="color:var(--text-3)">해당 없음</td>
          </tr>
          <tr class="fr-subtotal">
            <td>부채 총계</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(totalLiab)}</td>
          </tr>

          <tr class="fr-result">
            <td colspan="2">【순자산】 (자산 − 부채)</td>
            <td class="num" style="font-size:15px;font-weight:700">${fmtKRW(netAssets)}</td>
          </tr>
        </tbody>
      </table>

      <div class="fr-note">※ 간이 재정상태표입니다. 통장 잔액을 현금성 자산으로 집계하며, 비현금 자산·부채는 데이터가 없어 "해당 없음"으로 표기합니다.</div>
    `;
  }

  /* ════════════════════════════════════════════
     현금흐름표 (단순 입출금 흐름)
     ════════════════════════════════════════════ */
  async function loadCashflow() {
    const pd = getFrPeriodQs();
    const params = new URLSearchParams({ period: pd.period });
    if (pd.startDate) params.set('startDate', pd.startDate);
    if (pd.endDate)   params.set('endDate',   pd.endDate);

    const pane = document.getElementById('frPane-cashflow');
    if (pane) pane.innerHTML = `<div style="text-align:center;color:var(--text-3);padding:40px">불러오는 중…</div>`;

    const res = await apiFetch('/api/admin-finance-cashflow?' + params);
    if (!res.ok) {
      if (pane) pane.innerHTML = `<div style="color:var(--danger);padding:20px">현금흐름표 조회 실패: ${res.data?.error || res.error || ''}</div>`;
      return;
    }
    const cf = res.data?.data || res.data || res;
    cf.__periodLabel = periodLabel(pd);
    renderCashflow(cf);
  }

  function renderCashflow(cf) {
    lastCashflowData = cf;
    const pane = document.getElementById('frPane-cashflow');
    if (!pane) return;

    const opening = fmtNum(cf.openingBalance ?? cf.opening_balance ?? cf.opening ?? 0);
    const closing = fmtNum(cf.closingBalance ?? cf.closing_balance ?? cf.closing ?? 0);
    const inflow  = cf.inflow || cf.inflows || {};
    const outflow = cf.outflow || cf.outflows || {};
    const inTotal  = fmtNum(inflow.total ?? cf.totalInflow ?? cf.total_inflow ?? 0);
    const outTotal = fmtNum(outflow.total ?? cf.totalOutflow ?? cf.total_outflow ?? 0);
    const netFlow  = fmtNum(cf.netCashFlow ?? cf.netCashflow ?? cf.net_cashflow ?? (inTotal - outTotal));

    const inCats  = inflow.byCategory || inflow.categories || cf.inflowCategories || [];
    const outCats = outflow.byCategory || outflow.categories || cf.outflowCategories || [];

    const inRows = inCats.map(c => `<tr>
      <td class="fr-indent2">· ${c.name || c.label || c.categoryName || '항목'}</td>
      <td class="num"></td>
      <td class="num">${fmtKRW(fmtNum(c.amount ?? c.total ?? 0))}</td>
    </tr>`).join('');
    const outRows = outCats.map(c => `<tr>
      <td class="fr-indent2">· ${c.name || c.label || c.categoryName || '항목'}</td>
      <td class="num"></td>
      <td class="num">${fmtKRW(fmtNum(c.amount ?? c.total ?? 0))}</td>
    </tr>`).join('');

    const netColor = netFlow >= 0 ? 'var(--success)' : 'var(--danger)';

    pane.innerHTML = `
      ${reportHeaderHtml('현금흐름표', cf.__periodLabel)}

      <div style="background:#fff7e6;border:1px solid #f5d8a8;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#7d5400;line-height:1.6">
        ⚠️ <strong>이 표는 IBK 통장 거래내역으로만 산정</strong>됩니다.
        기초·기말 잔액과 입출금은 IBK CSV 거래만 반영하므로, 통장 거래내역을 통과 처리해야 채워집니다.
        후원·후원외 매출·지출 입력값은 별도 — 운영성과표(손익)에서 확인하세요.
      </div>

      <table class="data-table report-table fr-statement" style="width:100%">
        <thead>
          <tr><th style="width:60%">구분</th><th class="num">소계</th><th class="num">금액</th></tr>
        </thead>
        <tbody>
          <tr class="fr-subtotal">
            <td>기초 잔액</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(opening)}</td>
          </tr>

          <tr class="fr-section"><td colspan="3">입금 합계 (+)</td></tr>
          ${inRows || '<tr><td class="fr-indent2" style="color:var(--text-3)">· 내역 없음</td><td class="num"></td><td class="num">0원</td></tr>'}
          <tr class="fr-subtotal">
            <td>입금 계</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(inTotal)}</td>
          </tr>

          <tr class="fr-section"><td colspan="3">출금 합계 (−)</td></tr>
          ${outRows || '<tr><td class="fr-indent2" style="color:var(--text-3)">· 내역 없음</td><td class="num"></td><td class="num">0원</td></tr>'}
          <tr class="fr-subtotal">
            <td>출금 계</td>
            <td class="num"></td>
            <td class="num">${fmtKRW(outTotal)}</td>
          </tr>

          <tr class="fr-result" style="background:${netFlow >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}">
            <td colspan="2">순현금흐름 (입금 − 출금)</td>
            <td class="num" style="color:${netColor};font-size:15px;font-weight:700">${fmtKRW(netFlow)}</td>
          </tr>
          <tr class="fr-result">
            <td colspan="2">기말 잔액</td>
            <td class="num" style="font-size:15px;font-weight:700">${fmtKRW(closing)}</td>
          </tr>
        </tbody>
      </table>

      <div class="fr-note">※ 통장 입출금 내역 기준입니다. 카테고리 내역은 대사 완료된 거래만 분류되며, 미대사 거래는 "미분류"로 집계됩니다.</div>
    `;
  }

  /* ════════════════════════════════════════════
     출력 — 인쇄
     ════════════════════════════════════════════ */
  function printReport() {
    if (currentTab === 'pl'       && !lastPlData)       { alert('먼저 운영성과표를 조회해 주세요.'); return; }
    if (currentTab === 'budget'   && !lastBudgetData)   { alert('먼저 예산 대비 실적표를 조회해 주세요.'); return; }
    if (currentTab === 'balance'  && !lastBalanceData)  { alert('먼저 재정상태표를 조회해 주세요.'); return; }
    if (currentTab === 'cashflow' && !lastCashflowData) { alert('먼저 현금흐름표를 조회해 주세요.'); return; }
    window.print();
  }

  /* ════════════════════════════════════════════
     출력 — 엑셀 (SheetJS)
     ════════════════════════════════════════════ */
  function exportExcel() {
    if (!window.XLSX) { alert('엑셀 변환 라이브러리가 로드되지 않았습니다.'); return; }

    if (currentTab === 'pl') {
      if (!lastPlData) { alert('먼저 운영성과표를 조회해 주세요.'); return; }
      exportExcelPl();
    } else if (currentTab === 'budget') {
      if (!lastBudgetData) { alert('먼저 예산 대비 실적표를 조회해 주세요.'); return; }
      exportExcelBudget();
    } else if (currentTab === 'balance') {
      if (!lastBalanceData) { alert('먼저 재정상태표를 조회해 주세요.'); return; }
      exportExcelBalance();
    } else {
      if (!lastCashflowData) { alert('먼저 현금흐름표를 조회해 주세요.'); return; }
      exportExcelCashflow();
    }
  }

  function exportExcelBalance() {
    const bs = lastBalanceData;
    const asset_   = bs.assets || {};
    const liab_    = bs.liabilities || {};
    const asOf      = bs.asOf || bs.asOfDate || bs.as_of_date || bs.date || '';
    const cashAsset = fmtNum(asset_.cash ?? bs.cashAssets ?? bs.cash_assets ?? bs.cashAsset ?? bs.bankBalance ?? bs.bank_balance ?? 0);
    const totalAssets = fmtNum(asset_.total ?? bs.totalAssets ?? bs.total_assets ?? cashAsset);
    const totalLiab   = fmtNum(liab_.total ?? bs.totalLiabilities ?? bs.total_liabilities ?? 0);
    const netAssets   = fmtNum(bs.netAsset ?? bs.netAssets ?? bs.net_assets ?? (totalAssets - totalLiab));
    const accounts = bs.accounts || bs.bankAccounts || bs.bank_accounts || [];

    const aoa = [
      [orgName],
      ['재정상태표'],
      ['기준일', asOf],
      ['생성일시', nowStr()],
      [],
      ['계정과목', '금액(원)'],
      ['【자산】', ''],
      ['  현금성 자산 (통장 잔액)', cashAsset],
      ...accounts.map(a => ['    · ' + (a.name || a.bankName || a.bank_name || a.accountName || '통장'),
        fmtNum(a.balance ?? a.balanceAfter ?? a.balance_after ?? 0)]),
      ['  비현금 자산', '해당 없음'],
      ['  자산 총계', totalAssets],
      ['【부채】', ''],
      ['  부채', '해당 없음'],
      ['  부채 총계', totalLiab],
      ['【순자산】 (자산 − 부채)', netAssets],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '재정상태표');
    XLSX.writeFile(wb, `SIREN_재정상태표_${String(asOf).replace(/[~\s]/g, '')}.xlsx`);
  }

  function exportExcelCashflow() {
    const cf = lastCashflowData;
    const opening = fmtNum(cf.openingBalance ?? cf.opening_balance ?? cf.opening ?? 0);
    const closing = fmtNum(cf.closingBalance ?? cf.closing_balance ?? cf.closing ?? 0);
    const inflow  = cf.inflow || cf.inflows || {};
    const outflow = cf.outflow || cf.outflows || {};
    const inTotal  = fmtNum(inflow.total ?? cf.totalInflow ?? cf.total_inflow ?? 0);
    const outTotal = fmtNum(outflow.total ?? cf.totalOutflow ?? cf.total_outflow ?? 0);
    const netFlow  = fmtNum(cf.netCashFlow ?? cf.netCashflow ?? cf.net_cashflow ?? (inTotal - outTotal));
    const inCats  = inflow.byCategory || inflow.categories || cf.inflowCategories || [];
    const outCats = outflow.byCategory || outflow.categories || cf.outflowCategories || [];

    const aoa = [
      [orgName],
      ['현금흐름표'],
      ['기간', cf.__periodLabel || ''],
      ['생성일시', nowStr()],
      [],
      ['구분', '금액(원)'],
      ['기초 잔액', opening],
      ['입금 합계 (+)', ''],
      ...inCats.map(c => ['  · ' + (c.name || c.label || c.categoryName || '항목'), fmtNum(c.amount ?? c.total ?? 0)]),
      ['  입금 계', inTotal],
      ['출금 합계 (−)', ''],
      ...outCats.map(c => ['  · ' + (c.name || c.label || c.categoryName || '항목'), fmtNum(c.amount ?? c.total ?? 0)]),
      ['  출금 계', outTotal],
      ['순현금흐름 (입금 − 출금)', netFlow],
      ['기말 잔액', closing],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '현금흐름표');
    XLSX.writeFile(wb, `SIREN_현금흐름표_${(cf.__periodLabel || '').replace(/[~\s]/g, '')}.xlsx`);
  }

  function exportExcelPl() {
    const pl  = lastPlData;
    const rev = pl.revenue || {};
    const don = rev.donations || {};
    const oth = rev.other || {};
    const exp = pl.expenditure || {};

    const expByCat = exp.byCategory || [];
    const expClassMap = {};
    for (const c of expByCat) {
      const amt = fmtNum(c.total != null ? c.total : c.amount);
      const key = NPO_EXP_CLASSES.some(x => x.code === c.code) ? c.code : '__etc';
      expClassMap[key] = (expClassMap[key] || 0) + amt;
    }

    const aoa = [
      [orgName],
      ['운영성과표'],
      ['기간', pl.__periodLabel || ''],
      ['생성일시', nowStr()],
      [],
      ['계정과목', '금액(원)'],
      ['Ⅰ. 사업수익', ''],
      ['  1. 후원금수익', fmtNum(don.net)],
      ['  2. 사업수익 (후원 외)', fmtNum(oth.net)],
      ...(oth.byCategory || []).map(c => ['    · ' + c.name, fmtNum(c.net)]),
      ['  사업수익 계', fmtNum(rev.totalNet)],
      ['Ⅱ. 사업비용', ''],
      ...NPO_EXP_CLASSES.map((cls, i) => [`  ${i + 1}. ${cls.label}`, fmtNum(expClassMap[cls.code])]),
      ...(fmtNum(expClassMap['__etc']) > 0 ? [['  5. 기타비용', fmtNum(expClassMap['__etc'])]] : []),
      ['  사업비용 계', fmtNum(exp.total)],
      ['Ⅲ. 운영성과 (Ⅰ − Ⅱ)', fmtNum(pl.netIncome)],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '운영성과표');
    XLSX.writeFile(wb, `SIREN_운영성과표_${(pl.__periodLabel || '').replace(/[~\s]/g, '')}.xlsx`);
  }

  function exportExcelBudget() {
    const bd = lastBudgetData;
    if (bd.noPlan) { alert('승인된 예산안이 없어 엑셀로 내보낼 데이터가 없습니다.'); return; }

    const items = bd.items || [];
    const aoa = [
      [orgName],
      ['예산 대비 실적표'],
      ['회계연도', `${bd.year || bd.__year} 회계연도`],
      ['승인 예산안', bd.plan?.title || ''],
      ['생성일시', nowStr()],
      [],
      ['계정과목', '편성액(원)', '집행액(원)', '잔여액(원)', '집행률(%)'],
      ...items.map(i => [
        i.categoryName || i.categoryCode || '',
        fmtNum(i.plannedAmount),
        fmtNum(i.executedAmount),
        fmtNum(i.remaining),
        fmtNum(i.rate),
      ]),
      [
        '합계',
        fmtNum(bd.totalPlanned),
        fmtNum(bd.totalExecuted),
        fmtNum(bd.totalRemaining != null ? bd.totalRemaining : fmtNum(bd.totalPlanned) - fmtNum(bd.totalExecuted)),
        fmtNum(bd.executionRate),
      ],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '예산대비실적');
    XLSX.writeFile(wb, `SIREN_예산대비실적표_${bd.year || bd.__year}.xlsx`);
  }

  /* ════════════════════════════════════════════
     출력 — PDF (admin-finance-report-pdf API — B 작성)
     ════════════════════════════════════════════ */
  async function exportPdf() {
    const pd = getFrPeriodQs();
    let url, fname;

    if (currentTab === 'pl') {
      if (!lastPlData) { alert('먼저 운영성과표를 조회해 주세요.'); return; }
      const params = new URLSearchParams({ type: 'pl', period: pd.period });
      if (pd.startDate) params.set('startDate', pd.startDate);
      if (pd.endDate)   params.set('endDate',   pd.endDate);
      url = '/api/admin-finance-report-pdf?' + params;
      fname = `SIREN_운영성과표_${(lastPlData.__periodLabel || '').replace(/[~\s]/g, '')}.pdf`;
    } else if (currentTab === 'budget') {
      if (!lastBudgetData) { alert('먼저 예산 대비 실적표를 조회해 주세요.'); return; }
      if (lastBudgetData.noPlan) { alert('승인된 예산안이 없어 PDF로 내보낼 데이터가 없습니다.'); return; }
      url = '/api/admin-finance-report-pdf?type=budget&year=' + pd.year;
      fname = `SIREN_예산대비실적표_${pd.year}.pdf`;
    } else if (currentTab === 'balance') {
      if (!lastBalanceData) { alert('먼저 재정상태표를 조회해 주세요.'); return; }
      url = '/api/admin-finance-report-pdf?type=balance';
      fname = `SIREN_재정상태표_${(lastBalanceData.asOf || lastBalanceData.asOfDate || lastBalanceData.as_of_date || lastBalanceData.date || '').replace(/[~\s]/g, '')}.pdf`;
    } else {
      if (!lastCashflowData) { alert('먼저 현금흐름표를 조회해 주세요.'); return; }
      const params = new URLSearchParams({ type: 'cashflow', period: pd.period });
      if (pd.startDate) params.set('startDate', pd.startDate);
      if (pd.endDate)   params.set('endDate',   pd.endDate);
      url = '/api/admin-finance-report-pdf?' + params;
      fname = `SIREN_현금흐름표_${(lastCashflowData.__periodLabel || '').replace(/[~\s]/g, '')}.pdf`;
    }

    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        let msg = 'HTTP ' + resp.status;
        try { const j = await resp.json(); msg = j.error || j.detail || msg; } catch { /* binary or empty */ }
        alert('PDF 생성 실패: ' + msg);
        return;
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      alert('PDF 다운로드 실패: ' + String(e));
    }
  }

  /* ════════════════════════════════════════════
     기간 선택기 (22-B-R1 공통 패턴)
     ════════════════════════════════════════════ */
  function frPeriodSelectorHtml() {
    return `
      <select id="frPeriodSel" class="input-sm" style="width:120px">
        <option value="day">오늘</option>
        <option value="week">이번 주</option>
        <option value="month">이번 달</option>
        <option value="half_year">반기</option>
        <option value="year" selected>올해</option>
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
    const period = sel?.value || 'year';
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

  function periodLabel(pd) {
    if (pd.startDate && pd.endDate) {
      return pd.startDate === pd.endDate ? pd.startDate : `${pd.startDate} ~ ${pd.endDate}`;
    }
    return '—';
  }

  /* ── 조회 (현재 탭 갱신) ── */
  function load() {
    if      (currentTab === 'pl')       loadPl();
    else if (currentTab === 'budget')   loadBudget();
    else if (currentTab === 'balance')  loadBalance();
    else                                loadCashflow();
  }

  /* ── 초기화 ── */
  function init() {
    const container = document.getElementById('adm-finance-report') || document.getElementById('page-finance-report');
    if (!container) return;

    container.innerHTML = `
      <div class="panel">
        <div class="p-head print-hide">
          <div class="p-title">재무 보고서</div>
          <div class="p-actions" style="gap:8px;flex-wrap:wrap">
            ${frPeriodSelectorHtml()}
            <button class="btn-sm btn-sm-primary" onclick="window.SIREN_FINANCE_REPORT.load()">조회</button>
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_REPORT.printReport()">🖨 인쇄</button>
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_REPORT.exportExcel()">📊 엑셀</button>
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_REPORT.exportPdf()">📄 PDF</button>
          </div>
        </div>

        <!-- 탭 -->
        <div class="content-tabs print-hide" style="margin-bottom:20px">
          <button type="button" class="ct-tab on" id="frTab-pl"       onclick="window.SIREN_FINANCE_REPORT.switchTab('pl')">📊 운영성과표</button>
          <button type="button" class="ct-tab"    id="frTab-budget"   onclick="window.SIREN_FINANCE_REPORT.switchTab('budget')">📋 예산 대비 실적표</button>
          <button type="button" class="ct-tab"    id="frTab-balance"  onclick="window.SIREN_FINANCE_REPORT.switchTab('balance')">🏦 재정상태표</button>
          <button type="button" class="ct-tab"    id="frTab-cashflow" onclick="window.SIREN_FINANCE_REPORT.switchTab('cashflow')">💵 현금흐름표</button>
        </div>

        <!-- 탭1: 운영성과표 -->
        <div id="frPane-pl">
          <div style="text-align:center;color:var(--text-3);padding:40px">불러오는 중…</div>
        </div>

        <!-- 탭2: 예산 대비 실적표 -->
        <div id="frPane-budget" style="display:none">
          <div style="text-align:center;color:var(--text-3);padding:40px">예산 대비 실적표 탭을 클릭하면 로드됩니다.</div>
        </div>

        <!-- 탭3: 재정상태표 -->
        <div id="frPane-balance" style="display:none">
          <div style="text-align:center;color:var(--text-3);padding:40px">재정상태표 탭을 클릭하면 로드됩니다.</div>
        </div>

        <!-- 탭4: 현금흐름표 -->
        <div id="frPane-cashflow" style="display:none">
          <div style="text-align:center;color:var(--text-3);padding:40px">현금흐름표 탭을 클릭하면 로드됩니다.</div>
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

    Promise.all([loadOrgName(), loadAnomaly()]).then(() => loadPl());
  }

  window.SIREN_FINANCE_REPORT = { load, init, switchTab, printReport, exportExcel, exportPdf };
})();
