/* admin-finance-income.js — Phase 5 + 22A: 수입 집계 대시보드 (KPI 6개 + 통합 차트) */
(function () {
  'use strict';

  let currentYear  = new Date().getFullYear();
  let currentMonth = null; // null = 연간, 1~12 = 월별

  /* ── mock 데이터 (Phase 22A 확장분 — B 머지 전) ── */
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

  /* ── api helper ── */
  function apiFetch(url) {
    return fetch(url, { credentials: 'include' })
      .then(r => r.json())
      .catch(e => ({ ok: false, error: String(e) }));
  }

  /* ── 금액 포맷 ── */
  function fmtKRW(n) {
    if (!n || isNaN(n)) return '0원';
    return Number(n).toLocaleString('ko-KR') + '원';
  }
  function fmtShort(n) {
    if (!n || isNaN(n)) return '0원';
    const v = Number(n);
    if (v >= 100000000) return (v / 100000000).toFixed(1) + '억원';
    if (v >= 10000)     return (v / 10000).toFixed(1)     + '만원';
    return v.toLocaleString('ko-KR') + '원';
  }

  /* ── 차트 인스턴스 ── */
  let trendChart   = null;
  let channelChart = null;
  let combinedChart = null;

  /* ── KPI 6개 렌더 (Phase 22A 확장) ── */
  function renderKpi6(donationData, plData) {
    const d    = donationData.data || donationData;
    const pl   = plData || {};
    const rev  = pl.revenue || {};
    const don  = rev.donations || {};
    const oth  = rev.other     || {};
    const exp  = pl.expenditure || {};

    // KPI 1: 총 매출 (후원 + 기타 순합)
    const totalRevenue = rev.totalNet || (don.net || d.totalAmount || 0) + (oth.net || 0);
    setKpi('fiKpiTotal',     fmtShort(totalRevenue));

    // KPI 2: 후원 순 수입
    const donNet = don.net || d.totalAmount || 0;
    setKpi('fiKpiDonation',  fmtShort(donNet));

    // KPI 3: 후원 외 순 매출
    const othNet = oth.net || 0;
    setKpi('fiKpiOther',     fmtShort(othNet));

    // KPI 4: 환불 합계
    const totalRefund = (don.refund || 0) + (oth.refund || 0);
    setKpi('fiKpiRefund',    fmtShort(totalRefund), totalRefund > 0 ? 'var(--danger)' : '');

    // KPI 5: 총 지출
    const totalExp = exp.total || 0;
    setKpi('fiKpiExpend',    fmtShort(totalExp));

    // KPI 6: 당기 순이익
    const netIncome = pl.netIncome !== undefined ? pl.netIncome : (totalRevenue - totalExp);
    setKpi('fiKpiNet',       fmtShort(Math.abs(netIncome)), netIncome < 0 ? 'var(--danger)' : 'var(--success)');
    const netLabel = document.getElementById('fiKpiNetLabel');
    if (netLabel) netLabel.textContent = netIncome < 0 ? '당기 순손실' : '당기 순이익';
  }

  function setKpi(id, text, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (color !== undefined) el.style.color = color;
  }

  /* ── 기존 채널별 렌더 (후원) ── */
  function renderDonationDetail(data) {
    const d   = data.data || data;
    const ch  = d.byChannel || {};
    const total = d.totalAmount || 1;

    const channelRows = [
      { label: '토스',       key: 'toss' },
      { label: '효성 CMS+', key: 'hyosung' },
      { label: '계좌이체',   key: 'bank' },
      { label: '기타',       key: 'other' },
    ];
    const tbody = document.getElementById('fiChannelTbody');
    if (tbody) {
      tbody.innerHTML = channelRows.map(row => {
        const c   = ch[row.key] || { count: 0, amount: 0 };
        const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
        return `<tr>
          <td>${row.label}</td>
          <td class="num">${(c.count || 0).toLocaleString()}건</td>
          <td class="num">${fmtKRW(c.amount)}</td>
          <td><div class="pct-bar"><div class="pct-fill" style="width:${pct}%"></div></div></td>
          <td class="num">${pct}%</td>
        </tr>`;
      }).join('');
    }

    if (d.monthlyTrend && d.monthlyTrend.length > 0) renderTrendChart(d.monthlyTrend);
    renderChannelChart(ch);
  }

  /* ── 통합 월별 차트 (후원+기타+지출+순이익) ── */
  function renderCombinedChart(monthly) {
    const ctx = document.getElementById('fiCombinedChart');
    if (!ctx || !window.Chart) return;
    if (combinedChart) combinedChart.destroy();

    const labels = monthly.map(m => m.month + '월');
    combinedChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '총 매출',  data: monthly.map(m => m.revenue),     backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4 },
          { label: '총 지출',  data: monthly.map(m => m.expenditure), backgroundColor: 'rgba(239,68,68,0.5)',  borderRadius: 4 },
          { label: '순이익',   data: monthly.map(m => m.net),
            type: 'line', borderColor: '#22c55e', backgroundColor: 'transparent',
            pointRadius: 4, tension: 0.3, yAxisID: 'y' },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: ctx => ctx.dataset.label + ': ' + fmtKRW(ctx.parsed.y),
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: v => (Number(v) / 10000).toFixed(0) + '만' },
          },
        },
      },
    });
  }

  function renderTrendChart(trend) {
    const labels     = Array.from({ length: 12 }, (_, i) => i + 1 + '월');
    const amountData = labels.map((_, i) => {
      const found = trend.find(t => t.month === i + 1);
      return found ? found.amount : 0;
    });

    const ctx = document.getElementById('fiTrendChart');
    if (!ctx) return;
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '후원 수입 (원)', data: amountData, backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4 }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => (Number(v) / 10000).toFixed(0) + '만' } } },
      },
    });
  }

  function renderChannelChart(ch) {
    const ctx = document.getElementById('fiChannelChart');
    if (!ctx) return;
    if (channelChart) channelChart.destroy();
    channelChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['토스', '효성 CMS+', '계좌이체', '기타'],
        datasets: [{ data: [ch.toss?.amount || 0, ch.hyosung?.amount || 0, ch.bank?.amount || 0, ch.other?.amount || 0], backgroundColor: ['#6366f1', '#22c55e', '#f59e0b', '#94a3b8'] }],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    });
  }

  /* ── 로드 ── */
  async function load() {
    const qs = currentMonth
      ? `?year=${currentYear}&month=${currentMonth}`
      : `?year=${currentYear}`;

    /* 후원 집계 */
    const donRes = await apiFetch('/api/admin-finance-income-summary' + qs);
    if (!donRes.ok) {
      const el = document.getElementById('fiError');
      if (el) { el.textContent = '수입 집계 오류: ' + (donRes.error || '알 수 없음'); el.style.display = 'block'; }
      return;
    }

    /* 손익 집계 (Phase 22A — mock 또는 실 API) */
    let plData = null;
    const plRes = await apiFetch('/api/admin-finance-pl-summary' + qs);
    if (plRes.ok) {
      plData = plRes.data || plRes;
    } else {
      /* mock fallback */
      plData = MOCK_PL_SUMMARY;
    }

    renderKpi6(donRes, plData);
    renderDonationDetail(donRes);
    if (plData && plData.monthly) renderCombinedChart(plData.monthly);
  }

  /* ── 초기화 ── */
  function init() {
    /* KPI 그리드를 6칸으로 교체 */
    const kpiGrid = document.querySelector('#adm-finance-income .kpi-grid');
    if (kpiGrid) {
      kpiGrid.style.gridTemplateColumns = 'repeat(3,1fr)';
      kpiGrid.innerHTML = `
        <div class="kpi"><div class="kpi-label">총 매출</div><div class="kpi-value" id="fiKpiTotal">—</div></div>
        <div class="kpi"><div class="kpi-label">후원 순 수입</div><div class="kpi-value" id="fiKpiDonation">—</div></div>
        <div class="kpi"><div class="kpi-label">후원 외 순 매출</div><div class="kpi-value" id="fiKpiOther">—</div></div>
        <div class="kpi"><div class="kpi-label">환불 합계</div><div class="kpi-value" id="fiKpiRefund">—</div></div>
        <div class="kpi"><div class="kpi-label">총 지출</div><div class="kpi-value" id="fiKpiExpend">—</div></div>
        <div class="kpi">
          <div class="kpi-label" id="fiKpiNetLabel">당기 순이익</div>
          <div class="kpi-value" id="fiKpiNet">—</div>
        </div>
      `;
    }

    /* 통합 차트 캔버스 삽입 (차트 2개 아래) */
    const chartArea = document.querySelector('#adm-finance-income .kpi-grid + div + div');
    /* 좀더 안정적인 방법: 채널 테이블 바로 앞에 삽입 */
    const channelSection = document.querySelector('#adm-finance-income [style*="font-size:13px"]');
    if (channelSection && !document.getElementById('fiCombinedChart')) {
      const wrap = document.createElement('div');
      wrap.style.marginBottom = '24px';
      wrap.innerHTML = `
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-bottom:8px">월별 통합 현황 (매출·지출·순이익)</div>
        <canvas id="fiCombinedChart" height="100"></canvas>
      `;
      channelSection.parentNode.insertBefore(wrap, channelSection);
    }

    /* 연도 선택 */
    const yearSel = document.getElementById('fiYearSelect');
    if (yearSel) {
      const ty = new Date().getFullYear();
      for (let y = ty + 1; y >= ty - 5; y--) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y + '년';
        if (y === currentYear) opt.selected = true;
        yearSel.appendChild(opt);
      }
      yearSel.addEventListener('change', () => { currentYear = parseInt(yearSel.value); load(); });
    }

    /* 월 탭 버튼 */
    document.querySelectorAll('.fi-month-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fi-month-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const m = btn.dataset.month;
        currentMonth = m === 'all' ? null : parseInt(m);
        load();
      });
    });

    load();
  }

  window.SIREN_FINANCE_INCOME = { load, init };
})();
