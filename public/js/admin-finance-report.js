/* admin-finance-report.js — Phase 7: 재무 보고서 */
(function () {
  "use strict";

  let lastData = null;

  function api(url) {
    return fetch(url, { credentials: "include" }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  }

  function fmtKRW(n) {
    if (!n || isNaN(n)) return "0원";
    return Number(n).toLocaleString("ko-KR") + "원";
  }

  function render(data) {
    const d = data.data || data;
    lastData = d;

    // 수입·지출·잔액 KPI
    document.getElementById("frKpiIncome").textContent = fmtKRW(d.income?.total);
    document.getElementById("frKpiExp").textContent = fmtKRW(d.expenditure?.total);
    const bal = d.balance || 0;
    const balEl = document.getElementById("frKpiBalance");
    if (balEl) {
      balEl.textContent = fmtKRW(Math.abs(bal));
      balEl.style.color = bal < 0 ? "var(--danger)" : "var(--success)";
      const balLabel = document.getElementById("frKpiBalanceLabel");
      if (balLabel) balLabel.textContent = bal < 0 ? "적자" : "흑자";
    }

    // 예산 대비 실적 테이블
    const tbody = document.getElementById("frBvaTbody");
    if (tbody) {
      const items = d.budgetVsActual || [];
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-3)">예산 데이터 없음 (Phase 6 예산 편성 후 조회 가능)</td></tr>`;
      } else {
        tbody.innerHTML = items
          .map((item) => {
            const rc = item.rate >= 90 ? "var(--danger)" : item.rate >= 70 ? "#f59e0b" : "var(--success)";
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
          })
          .join("");
      }
    }

    // 지출 사업별 테이블
    const expTbody = document.getElementById("frExpTbody");
    if (expTbody) {
      const cats = d.expenditure?.byCategory || [];
      expTbody.innerHTML = cats.length
        ? cats.map((c) => `<tr><td>${c.category_name || "—"}</td><td class="num">${fmtKRW(c.amount)}</td><td class="num">${c.count}건</td></tr>`).join("")
        : `<tr><td colspan="3" style="text-align:center;color:var(--text-3)">지출 내역 없음</td></tr>`;
    }
  }

  /* ── 엑셀 내보내기 (SheetJS) ── */
  function exportExcel() {
    if (!lastData) { alert("먼저 데이터를 불러와 주세요."); return; }
    if (!window.XLSX) { alert("SheetJS 라이브러리가 로드되지 않았습니다."); return; }

    const d = lastData;
    const wb = XLSX.utils.book_new();

    // 시트 1: 수입 요약
    const incomeSheet = [
      ["채널", "금액(원)"],
      ["토스", d.income?.byChannel?.toss || 0],
      ["효성 CMS+", d.income?.byChannel?.hyosung || 0],
      ["계좌이체", d.income?.byChannel?.bank || 0],
      ["기타", d.income?.byChannel?.other || 0],
      ["합계", d.income?.total || 0],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incomeSheet), "수입");

    // 시트 2: 지출 사업별
    const expSheet = [["사업명", "금액(원)", "건수"], ...(d.expenditure?.byCategory || []).map((c) => [c.category_name, c.amount, c.count])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expSheet), "지출");

    // 시트 3: 예산 대비
    const bvaSheet = [
      ["사업명", "예산(원)", "실적(원)", "집행률(%)"],
      ...(d.budgetVsActual || []).map((i) => [i.name, i.budget, i.actual, i.rate]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bvaSheet), "예산비교");

    const filename = `SIREN_재무보고서_${d.year}${d.month ? "_" + d.month + "월" : ""}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  /* ── 로드 ── */
  async function load() {
    const year = document.getElementById("frYearSelect")?.value || new Date().getFullYear();
    const period = document.getElementById("frPeriodSelect")?.value || "annual";
    let qs = `?year=${year}`;
    if (period.startsWith("q")) qs += `&quarter=${period.slice(1)}`;
    else if (period !== "annual") qs += `&month=${period}`;

    const res = await api("/api/admin-finance-report" + qs);
    if (!res.ok) { alert("보고서 조회 실패: " + (res.error || "")); return; }
    render(res);
  }

  /* ── 초기화 ── */
  function init() {
    const container = document.getElementById("adm-finance-report");
    if (!container) return;

    const ty = new Date().getFullYear();
    const yearOpts = Array.from({ length: 6 }, (_, i) => `<option value="${ty - i}">${ty - i}년</option>`).join("");
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
    `;

    load();
  }

  window.SIREN_FINANCE_REPORT = { load, init, exportExcel };
})();
