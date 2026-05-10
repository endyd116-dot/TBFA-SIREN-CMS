/* admin-finance-income.js — Phase 5: 수입 집계 대시보드 */
(function () {
  "use strict";

  let currentYear = new Date().getFullYear();
  let currentMonth = null; // null = 연간, 1~12 = 월별

  /* ── api helper ── */
  function apiFetch(url) {
    return fetch(url, { credentials: "include" })
      .then((r) => r.json())
      .catch((e) => ({ ok: false, error: String(e) }));
  }

  /* ── 금액 포맷 ── */
  function fmtKRW(n) {
    if (!n || isNaN(n)) return "0원";
    return Number(n).toLocaleString("ko-KR") + "원";
  }
  function fmtShort(n) {
    if (!n || isNaN(n)) return "0원";
    const v = Number(n);
    if (v >= 100000000) return (v / 100000000).toFixed(1) + "억원";
    if (v >= 10000) return (v / 10000).toFixed(1) + "만원";
    return v.toLocaleString("ko-KR") + "원";
  }

  /* ── 차트 인스턴스 ── */
  let trendChart = null;
  let channelChart = null;

  /* ── 렌더 ── */
  function renderIncome(data) {
    const d = data.data || data;

    // KPI 카드
    document.getElementById("fiKpiTotal").textContent = fmtShort(d.totalAmount);
    document.getElementById("fiKpiCount").textContent = (d.totalCount || 0) + "건";
    document.getElementById("fiKpiDonors").textContent = (d.donorCount?.activeThisPeriod || 0) + "명";
    document.getElementById("fiKpiNewMembers").textContent = (d.donorCount?.newMembers || 0) + "명";

    // 채널별 테이블
    const ch = d.byChannel || {};
    const total = d.totalAmount || 1;
    const channelRows = [
      { label: "토스", key: "toss" },
      { label: "효성 CMS+", key: "hyosung" },
      { label: "계좌이체", key: "bank" },
      { label: "기타", key: "other" },
    ];
    const tbody = document.getElementById("fiChannelTbody");
    if (tbody) {
      tbody.innerHTML = channelRows
        .map((row) => {
          const c = ch[row.key] || { count: 0, amount: 0 };
          const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
          return `<tr>
            <td>${row.label}</td>
            <td class="num">${(c.count || 0).toLocaleString()}건</td>
            <td class="num">${fmtKRW(c.amount)}</td>
            <td><div class="pct-bar"><div class="pct-fill" style="width:${pct}%"></div></div></td>
            <td class="num">${pct}%</td>
          </tr>`;
        })
        .join("");
    }

    // 월별 추이 차트 (Chart.js)
    if (d.monthlyTrend && d.monthlyTrend.length > 0) {
      renderTrendChart(d.monthlyTrend);
    }

    // 채널 파이 차트
    renderChannelChart(ch);
  }

  function renderTrendChart(trend) {
    const labels = Array.from({ length: 12 }, (_, i) => i + 1 + "월");
    const amountData = labels.map((_, i) => {
      const found = trend.find((t) => t.month === i + 1);
      return found ? found.amount : 0;
    });

    const ctx = document.getElementById("fiTrendChart");
    if (!ctx) return;
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "수입 (원)",
            data: amountData,
            backgroundColor: "rgba(99,102,241,0.7)",
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              callback: (v) => (Number(v) / 10000).toFixed(0) + "만",
            },
          },
        },
      },
    });
  }

  function renderChannelChart(ch) {
    const ctx = document.getElementById("fiChannelChart");
    if (!ctx) return;
    if (channelChart) channelChart.destroy();
    channelChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["토스", "효성 CMS+", "계좌이체", "기타"],
        datasets: [
          {
            data: [
              ch.toss?.amount || 0,
              ch.hyosung?.amount || 0,
              ch.bank?.amount || 0,
              ch.other?.amount || 0,
            ],
            backgroundColor: ["#6366f1", "#22c55e", "#f59e0b", "#94a3b8"],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  /* ── 로드 ── */
  async function load() {
    const qs = currentMonth
      ? `?year=${currentYear}&month=${currentMonth}`
      : `?year=${currentYear}`;
    const res = await apiFetch("/api/admin-finance-income-summary" + qs);
    if (!res.ok) {
      const el = document.getElementById("fiError");
      if (el) el.textContent = "수입 집계 오류: " + (res.error || "알 수 없음");
      return;
    }
    renderIncome(res);
  }

  /* ── 초기화 ── */
  function init() {
    // 연도 선택
    const yearSel = document.getElementById("fiYearSelect");
    if (yearSel) {
      const thisYear = new Date().getFullYear();
      for (let y = thisYear; y >= thisYear - 5; y--) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y + "년";
        if (y === currentYear) opt.selected = true;
        yearSel.appendChild(opt);
      }
      yearSel.addEventListener("change", () => {
        currentYear = parseInt(yearSel.value);
        load();
      });
    }

    // 월 탭 버튼
    document.querySelectorAll(".fi-month-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".fi-month-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const m = btn.dataset.month;
        currentMonth = m === "all" ? null : parseInt(m);
        load();
      });
    });

    load();
  }

  window.SIREN_FINANCE_INCOME = { load, init };
})();
