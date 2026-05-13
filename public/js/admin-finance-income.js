/* admin-finance-income.js — Phase 5 + 22A: 수입 집계 대시보드 (KPI 6개 + 통합 차트) */
(function () {
  'use strict';

  let currentYear  = new Date().getFullYear();
  let currentMonth = null; // null = 연간, 1~12 = 월별

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
  let expenseChart = null;

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

  /* ── Phase 22C: 지출 카테고리 분해 (바 차트 + 테이블) ── */
  function renderExpenseCats(expenditure) {
    const exp        = expenditure || {};
    const byCategory = exp.byCategory || [];
    const totalExp   = Number(exp.total || byCategory.reduce((a, c) => a + Number(c.total || c.amount || 0), 0));

    /* 테이블 */
    const tbody = document.getElementById('fiExpenseCatTbody');
    if (tbody) {
      if (!byCategory.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3)">지출 내역 없음</td></tr>';
      } else {
        tbody.innerHTML = byCategory.map(cat => {
          const amt = Number(cat.total || cat.amount || 0);
          const pct = totalExp > 0 ? Math.round((amt / totalExp) * 100) : 0;
          return `<tr>
            <td>${cat.name || cat.code || '—'}</td>
            <td class="num">${fmtKRW(amt)}</td>
            <td class="num">${pct}%</td>
          </tr>`;
        }).join('');
      }
    }

    /* 바 차트 */
    const ctx = document.getElementById('fiExpenseChart');
    if (!ctx || !window.Chart) return;
    if (expenseChart) { expenseChart.destroy(); expenseChart = null; }
    if (!byCategory.length) return;

    expenseChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: byCategory.map(c => c.name || c.code),
        datasets: [{
          label: '지출액',
          data: byCategory.map(c => Number(c.total || c.amount || 0)),
          backgroundColor: ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#84cc16', '#ec4899'],
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => fmtKRW(ctx.parsed.x) },
          },
        },
        scales: {
          x: { ticks: { callback: v => (Number(v) / 10000).toFixed(0) + '만' } },
        },
      },
    });
  }

  /* ── 후원 외 카테고리 테이블 ── */
  function renderOtherCats(other) {
    const tbody = document.getElementById('fiOtherCatTbody');
    if (!tbody) return;
    const byCategory = (other && other.byCategory) ? other.byCategory : [];
    const totalNet   = (other && other.net) ? other.net : 1;
    if (!byCategory.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">데이터 없음</td></tr>';
      return;
    }
    tbody.innerHTML = byCategory.map(cat => {
      const pct = totalNet > 0 ? Math.round((cat.net / totalNet) * 100) : 0;
      return `<tr>
        <td>${cat.name}</td>
        <td class="num">${fmtKRW(cat.net)}</td>
        <td><div class="pct-bar"><div class="pct-fill" style="width:${pct}%"></div></div></td>
        <td class="num">${pct}%</td>
      </tr>`;
    }).join('');
  }

  /* ── 통합 월별 차트 (매출·지출·순이익 — fiTrendChart 캔버스 사용) ── */
  function renderCombinedChart(monthly) {
    const ctx = document.getElementById('fiTrendChart');
    if (!ctx || !window.Chart) return;
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    if (combinedChart) combinedChart.destroy();

    const labels = monthly.map(m => m.month + '월');
    trendChart = combinedChart = new Chart(ctx, {
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

    /* 손익 집계 (Phase 22A) — 실패 시 빈 객체로 계속 */
    let plData = {};
    try {
      const plRes = await apiFetch('/api/admin-finance-pl-summary?fiscalYear=' + currentYear);
      if (plRes.ok) plData = plRes.data?.data || plRes.data || plRes;
    } catch (e) { console.warn('[finance-income] P&L 조회 실패', e); }

    renderKpi6(donRes, plData);
    renderDonationDetail(donRes);
    if (plData.monthly && plData.monthly.length) renderCombinedChart(plData.monthly);
    if (plData.revenue && plData.revenue.other)  renderOtherCats(plData.revenue.other);
    renderExpenseCats(plData.expenditure);
  }

  /* ── 초기화 ── */
  function init() {
    /* 연도 선택 */
    const yearSel = document.getElementById('fiYearSelect');
    if (yearSel && !yearSel.options.length) {
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
