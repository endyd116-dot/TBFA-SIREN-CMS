/* admin-finance-budget.js — Phase 6: 예산·지출 관리 */
(function () {
  "use strict";

  let currentYear = new Date().getFullYear();
  let categories = [];

  function api(url, opts) {
    return fetch(url, { credentials: "include", ...opts })
      .then((r) => r.json())
      .catch((e) => ({ ok: false, error: String(e) }));
  }

  function fmtKRW(n) {
    if (!n || isNaN(n)) return "0원";
    return Number(n).toLocaleString("ko-KR") + "원";
  }

  /* ── 예산 테이블 렌더 ── */
  function renderBudgetTable(data) {
    const tbody = document.getElementById("fbBudgetTbody");
    if (!tbody) return;
    const d = data.data || data;
    const items = d.items || [];

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-3)">등록된 예산이 없습니다. [예산 편성] 버튼을 눌러 추가하세요.</td></tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((item) => {
        const rateColor = item.rate >= 90 ? "var(--danger)" : item.rate >= 70 ? "#f59e0b" : "var(--success)";
        return `<tr>
          <td>${item.name}</td>
          <td class="num">${fmtKRW(item.plannedAmount)}</td>
          <td class="num">${fmtKRW(item.executedAmount)}</td>
          <td class="num" style="color:${item.remaining < 0 ? "var(--danger)" : "inherit"}">${fmtKRW(item.remaining)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="pct-bar" style="flex:1"><div class="pct-fill" style="width:${Math.min(item.rate,100)}%;background:${rateColor}"></div></div>
              <span style="color:${rateColor};font-weight:600;min-width:36px">${item.rate}%</span>
            </div>
          </td>
          <td>
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_BUDGET.openBudgetModal(${item.id},'${item.name}',${item.plannedAmount})">수정</button>
          </td>
        </tr>`;
      })
      .join("");

    // 합계
    const totalPlanned = d.totalPlanned || 0;
    const totalExecuted = d.totalExecuted || 0;
    const totalRemaining = totalPlanned - totalExecuted;
    const totalRate = totalPlanned > 0 ? Math.round((totalExecuted / totalPlanned) * 100) : 0;

    const tfootEl = document.getElementById("fbBudgetTfoot");
    if (tfootEl) {
      tfootEl.innerHTML = `<tr style="font-weight:700">
        <td>합계</td>
        <td class="num">${fmtKRW(totalPlanned)}</td>
        <td class="num">${fmtKRW(totalExecuted)}</td>
        <td class="num">${fmtKRW(totalRemaining)}</td>
        <td><span style="font-weight:700">${totalRate}%</span></td>
        <td></td>
      </tr>`;
    }
  }

  /* ── 지출 목록 렌더 ── */
  function renderExpList(data) {
    const d = data.data || data;
    const items = d.items || [];
    const tbody = document.getElementById("fbExpTbody");
    if (!tbody) return;

    const statusLabel = { draft: "검토 중", approved: "승인", rejected: "반려" };
    const statusColor = { draft: "#f59e0b", approved: "var(--success)", rejected: "var(--danger)" };

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-3)">지출 내역이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((item) => `<tr>
        <td>${item.spent_at ? item.spent_at.slice(0, 10) : "—"}</td>
        <td>${item.category_name || "—"}</td>
        <td>${item.description}</td>
        <td class="num">${fmtKRW(item.amount)}</td>
        <td><span style="color:${statusColor[item.status] || "#888"};font-weight:600">${statusLabel[item.status] || item.status}</span></td>
        <td>${item.receipt_url ? `<a href="${item.receipt_url}" target="_blank" style="color:var(--primary)">영수증</a>` : "—"}</td>
        <td>
          ${item.status === "draft"
            ? `<button class="btn-sm btn-sm-primary" onclick="window.SIREN_FINANCE_BUDGET.approveExp(${item.id},'approve')">승인</button>
               <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_BUDGET.approveExp(${item.id},'reject')" style="margin-left:4px">반려</button>`
            : "—"}
        </td>
      </tr>`)
      .join("");
  }

  /* ── 예산 편성 모달 ── */
  function openBudgetModal(categoryId, categoryName, currentAmount) {
    const overlay = document.getElementById("fbBudgetModal");
    if (!overlay) return;
    document.getElementById("fbModalCategoryName").textContent = categoryName;
    document.getElementById("fbModalCategoryId").value = categoryId;
    document.getElementById("fbModalAmount").value = currentAmount || "";
    overlay.style.display = "flex";
  }

  function closeBudgetModal() {
    const overlay = document.getElementById("fbBudgetModal");
    if (overlay) overlay.style.display = "none";
  }

  /* ── 지출 기안 모달 ── */
  function openExpModal() {
    const overlay = document.getElementById("fbExpModal");
    if (!overlay) return;
    // 카테고리 옵션
    const sel = document.getElementById("fbExpCategory");
    if (sel && categories.length) {
      sel.innerHTML = categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    }
    overlay.style.display = "flex";
  }

  function closeExpModal() {
    const overlay = document.getElementById("fbExpModal");
    if (overlay) overlay.style.display = "none";
  }

  /* ── 지출 승인/반려 ── */
  async function approveExp(id, action) {
    const label = action === "approve" ? "승인" : "반려";
    if (!confirm(`지출 ID ${id}을(를) ${label}하시겠습니까?`)) return;
    const res = await api("/api/admin-finance-expenditure-approve", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (!res.ok) { alert("처리 실패: " + (res.error || "")); return; }
    alert(label + " 완료");
    loadExpList();
    loadBudget();
  }

  /* ── 로드 ── */
  async function loadBudget() {
    const res = await api(`/api/admin-finance-budget-list?year=${currentYear}`);
    if (res.ok) renderBudgetTable(res);
  }

  async function loadExpList() {
    const status = document.getElementById("fbStatusFilter")?.value || "all";
    const category = document.getElementById("fbCategoryFilter")?.value || "all";
    const res = await api(
      `/api/admin-finance-expenditure-list?year=${currentYear}&status=${status}&category=${category}`
    );
    if (res.ok) renderExpList(res);
  }

  async function loadCategories() {
    // budget-list에서 카테고리 추출
    const res = await api(`/api/admin-finance-budget-list?year=${currentYear}`);
    if (res.ok && res.data?.items) {
      categories = res.data.items.map((i) => ({ id: i.id, name: i.name, code: i.code }));
      const sel = document.getElementById("fbCategoryFilter");
      if (sel && categories.length) {
        const opts = categories.map((c) => `<option value="${c.code}">${c.name}</option>`).join("");
        sel.innerHTML = `<option value="all">전체 사업</option>` + opts;
      }
    }
  }

  /* ── 초기화 ── */
  function init() {
    const container = document.getElementById("adm-finance-budget");
    if (!container) return;

    container.innerHTML = `
      <div class="panel">
        <div class="p-head">
          <div class="p-title">예산·지출 관리</div>
          <div class="p-actions" style="gap:8px">
            <select id="fbYearSelect" class="input-sm" style="width:90px"></select>
            <button class="btn-sm btn-sm-primary" onclick="window.SIREN_FINANCE_BUDGET.openExpModal()">+ 지출 기안</button>
          </div>
        </div>

        <!-- 예산 테이블 -->
        <div style="font-size:14px;font-weight:700;margin:16px 0 8px">사업별 예산 집행 현황</div>
        <table class="data-table" style="width:100%;margin-bottom:24px">
          <thead><tr><th>사업명</th><th class="num">계획(원)</th><th class="num">집행(원)</th><th class="num">잔액</th><th>집행률</th><th>편성</th></tr></thead>
          <tbody id="fbBudgetTbody"><tr><td colspan="6" style="text-align:center">불러오는 중…</td></tr></tbody>
          <tfoot id="fbBudgetTfoot"></tfoot>
        </table>

        <!-- 지출 목록 -->
        <div class="p-head" style="padding:0;margin-bottom:8px">
          <div style="font-size:14px;font-weight:700">지출 내역</div>
          <div style="display:flex;gap:8px">
            <select id="fbStatusFilter" class="input-sm" onchange="window.SIREN_FINANCE_BUDGET.loadExpList()">
              <option value="all">전체 상태</option>
              <option value="draft">검토 중</option>
              <option value="approved">승인</option>
              <option value="rejected">반려</option>
            </select>
            <select id="fbCategoryFilter" class="input-sm" onchange="window.SIREN_FINANCE_BUDGET.loadExpList()">
              <option value="all">전체 사업</option>
            </select>
          </div>
        </div>
        <table class="data-table" style="width:100%">
          <thead><tr><th>날짜</th><th>사업</th><th>내용</th><th class="num">금액</th><th>상태</th><th>영수증</th><th>처리</th></tr></thead>
          <tbody id="fbExpTbody"><tr><td colspan="7" style="text-align:center">불러오는 중…</td></tr></tbody>
        </table>
      </div>

      <!-- 예산 편성 모달 -->
      <div id="fbBudgetModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:12px;padding:24px;width:360px">
          <h3 style="margin:0 0 16px" id="fbModalCategoryName">예산 편성</h3>
          <input type="hidden" id="fbModalCategoryId">
          <label style="font-size:13px;font-weight:600">계획 금액 (원)</label>
          <input type="number" id="fbModalAmount" class="input-sm" style="width:100%;margin:6px 0 16px" placeholder="50000000">
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_BUDGET.closeBudgetModal()">취소</button>
            <button class="btn-sm btn-sm-primary" id="fbModalSaveBtn">저장</button>
          </div>
        </div>
      </div>

      <!-- 지출 기안 모달 -->
      <div id="fbExpModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:12px;padding:24px;width:440px">
          <h3 style="margin:0 0 16px">지출 기안</h3>
          <div style="display:grid;gap:12px">
            <div><label style="font-size:13px;font-weight:600">사업 분류</label><br>
              <select id="fbExpCategory" class="input-sm" style="width:100%;margin-top:4px"></select></div>
            <div><label style="font-size:13px;font-weight:600">집행일</label><br>
              <input type="date" id="fbExpDate" class="input-sm" style="width:100%;margin-top:4px"></div>
            <div><label style="font-size:13px;font-weight:600">금액 (원)</label><br>
              <input type="number" id="fbExpAmount" class="input-sm" style="width:100%;margin-top:4px" placeholder="1000000"></div>
            <div><label style="font-size:13px;font-weight:600">내용</label><br>
              <input type="text" id="fbExpDesc" class="input-sm" style="width:100%;margin-top:4px" placeholder="지급 내용 입력"></div>
            <div><label style="font-size:13px;font-weight:600">지급처</label><br>
              <input type="text" id="fbExpPayee" class="input-sm" style="width:100%;margin-top:4px" placeholder="업체명 또는 개인"></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn-sm btn-sm-ghost" onclick="window.SIREN_FINANCE_BUDGET.closeExpModal()">취소</button>
            <button class="btn-sm btn-sm-primary" id="fbExpSaveBtn">기안 저장</button>
          </div>
        </div>
      </div>
    `;

    // 연도 선택
    const yearSel = document.getElementById("fbYearSelect");
    if (yearSel) {
      const ty = new Date().getFullYear();
      for (let y = ty; y >= ty - 5; y--) {
        const opt = document.createElement("option");
        opt.value = y; opt.textContent = y + "년";
        if (y === currentYear) opt.selected = true;
        yearSel.appendChild(opt);
      }
      yearSel.addEventListener("change", () => {
        currentYear = parseInt(yearSel.value);
        loadBudget(); loadCategories();
      });
    }

    // 예산 편성 저장
    document.getElementById("fbModalSaveBtn")?.addEventListener("click", async () => {
      const cid = parseInt(document.getElementById("fbModalCategoryId").value);
      const amt = parseInt(document.getElementById("fbModalAmount").value);
      if (!cid || !amt) { alert("금액을 입력해 주세요."); return; }
      const res = await api("/api/admin-finance-budget-upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear: currentYear, categoryId: cid, plannedAmount: amt }),
      });
      if (!res.ok) { alert("저장 실패: " + (res.error || "")); return; }
      closeBudgetModal(); loadBudget();
    });

    // 지출 기안 저장
    document.getElementById("fbExpSaveBtn")?.addEventListener("click", async () => {
      const cid = parseInt(document.getElementById("fbExpCategory").value);
      const date = document.getElementById("fbExpDate").value;
      const amt = parseInt(document.getElementById("fbExpAmount").value);
      const desc = document.getElementById("fbExpDesc").value.trim();
      const payee = document.getElementById("fbExpPayee").value.trim();
      if (!cid || !date || !amt || !desc) { alert("필수 항목을 모두 입력해 주세요."); return; }
      const res = await api("/api/admin-finance-expenditure-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: cid, amount: amt, spentAt: date, description: desc, payee }),
      });
      if (!res.ok) { alert("저장 실패: " + (res.error || "")); return; }
      alert("기안 저장 완료");
      closeExpModal(); loadExpList();
    });

    loadBudget(); loadCategories();
  }

  function load() {
    const el = document.getElementById("adm-finance-budget");
    if (el && el.innerHTML.trim() === "") init();
    else { loadBudget(); loadExpList(); }
  }

  window.SIREN_FINANCE_BUDGET = {
    load, init, loadBudget, loadExpList,
    openBudgetModal, closeBudgetModal,
    openExpModal, closeExpModal,
    approveExp,
  };
})();
