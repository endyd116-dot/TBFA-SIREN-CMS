/* admin-finance-group.js — Phase 20-B 재정 그룹 (수입·예산·재무 3탭) */
(function () {
  'use strict';

  const USE_MOCK = false;

  /* ─── mock 데이터 ─── */
  const MOCK = {
    ok: true,
    income: {
      total: 12500000,
      monthly: [
        { month: '2026-01', amount: 980000 },
        { month: '2026-02', amount: 1120000 },
        { month: '2026-03', amount: 1350000 },
        { month: '2026-04', amount: 1200000 },
        { month: '2026-05', amount: 890000 },
      ],
      byCategory: [
        { category: '정기 후원', amount: 5800000 },
        { category: '일시 후원', amount: 3200000 },
        { category: '효성 CMS', amount: 2100000 },
        { category: '기타', amount: 1400000 },
      ],
      recentRows: [
        { date: '2026-05-10', desc: '정기 후원 — 김철수', amount: 50000, category: '정기' },
        { date: '2026-05-09', desc: '일시 후원 — 이영희', amount: 100000, category: '일시' },
        { date: '2026-05-08', desc: '효성 CMS — 박민준', amount: 30000, category: 'CMS' },
        { date: '2026-05-07', desc: '일시 후원 — 최수연', amount: 200000, category: '일시' },
      ],
    },
    budget: {
      year: 2026,
      totalBudget: 20000000,
      totalSpent: 8750000,
      categories: [
        { name: '인건비', budget: 8000000, spent: 4200000 },
        { name: '사업비', budget: 5000000, spent: 2100000 },
        { name: '운영비', budget: 3000000, spent: 1500000 },
        { name: '홍보비', budget: 2000000, spent: 700000 },
        { name: '기타', budget: 2000000, spent: 250000 },
      ],
      recentExpenses: [
        { date: '2026-05-08', desc: '5월 인건비', category: '인건비', amount: 700000, status: 'approved' },
        { date: '2026-05-06', desc: '사무용품 구입', category: '운영비', amount: 45000, status: 'approved' },
        { date: '2026-05-03', desc: '홍보물 인쇄', category: '홍보비', amount: 120000, status: 'pending' },
        { date: '2026-04-30', desc: '법률 자문료', category: '사업비', amount: 300000, status: 'approved' },
      ],
    },
    report: {
      period: '2026년 1~5월',
      totalIncome: 12500000,
      totalExpense: 8750000,
      netBalance: 3750000,
      sections: [
        { title: '수입 합계', value: 12500000, note: '후원금·기부금 포함' },
        { title: '지출 합계', value: 8750000, note: '인건비·사업비·운영비 포함' },
        { title: '순 잉여금', value: 3750000, note: '수입 - 지출' },
        { title: '전기 이월', value: 5200000, note: '2025년 잔여금' },
        { title: '총 잔액', value: 8950000, note: '순 잉여금 + 전기 이월' },
      ],
    },
  };

  /* ─── API 헬퍼 ─── */
  async function api({ method = 'GET', url, body } = {}) {
    try {
      if (typeof window.adminApi === 'function') return await window.adminApi({ method, url, body });
      if (typeof window.api === 'function')      return await window.api({ method, url, body });
      const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      if (r.status === 401) { window.location.href = '/admin.html'; return { ok: false, status: 401, data: {} }; }
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  /* ─── 토스트 ─── */
  function showToast(msg, type = 'error') {
    const el = document.getElementById('toast') || document.getElementById('admToast');
    if (el) {
      el.textContent = msg;
      el.className = 'toast show' + (type === 'error' ? ' toast-error' : '');
      setTimeout(() => el.classList.remove('show'), 3500);
    } else {
      console.warn('[FinanceGroup]', msg);
    }
  }

  /* ─── 상태 ─── */
  let currentTab = 'income';
  let finData = null;

  /* ─── 진입 ─── */
  function init() {
    const container = document.getElementById('adm20-finance');
    if (!container) return;
    container.innerHTML = buildShell();
    bindTabs(container);
    loadData();
  }

  /* ─── 탭 셸 HTML ─── */
  function buildShell() {
    return `
      <div class="adm-card">
        <div class="adm-group-tabs">
          <button class="adm-group-tab is-active" data-tab="income">💵 수입 관리</button>
          <button class="adm-group-tab" data-tab="budget">📋 예산 집행</button>
          <button class="adm-group-tab" data-tab="report">📊 재무 보고서</button>
        </div>

        <div class="adm-group-panel is-active" data-panel="income">
          <div id="fg-income-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="budget">
          <div id="fg-budget-wrap"></div>
        </div>

        <div class="adm-group-panel" data-panel="report">
          <div id="fg-report-wrap"></div>
        </div>
      </div>`;
  }

  /* ─── 탭 바인딩 ─── */
  function bindTabs(container) {
    container.querySelectorAll('.adm-group-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const tab = this.dataset.tab;
        container.querySelectorAll('.adm-group-tab').forEach(b => b.classList.remove('is-active'));
        container.querySelectorAll('.adm-group-panel').forEach(p => p.classList.remove('is-active'));
        this.classList.add('is-active');
        const panel = container.querySelector('[data-panel="' + tab + '"]');
        if (panel) panel.classList.add('is-active');
        currentTab = tab;
        if (finData) renderTab(tab, finData);
      });
    });
  }

  /* ─── 실 API 응답 → 화면 구조 변환 ─── */
  function transformFinanceData(raw) {
    const expRows = Array.isArray(raw.income) ? raw.income : [];
    const budRows = Array.isArray(raw.budget) ? raw.budget : [];
    const rep = raw.report || {};

    const approvedExp = expRows.filter(function (r) { return r.status === 'approved'; });
    const totalSpent = approvedExp.reduce(function (s, r) { return s + Number(r.amount || 0); }, 0);

    var byCategoryMap = {};
    approvedExp.forEach(function (r) {
      var cat = r.categoryName || '기타';
      byCategoryMap[cat] = (byCategoryMap[cat] || 0) + Number(r.amount || 0);
    });
    var byCategory = Object.keys(byCategoryMap).map(function (k) { return { category: k, amount: byCategoryMap[k] }; });

    var totalBudget = rep.totalBudget || budRows.reduce(function (s, r) { return s + Number(r.plannedAmount || 0); }, 0);
    var categories = Object.keys(rep.byCategory || {}).map(function (name) {
      var vals = rep.byCategory[name];
      return { name: name, budget: vals.planned || 0, spent: vals.spent || 0 };
    });

    return {
      income: {
        total: totalSpent,
        monthly: [],
        byCategory: byCategory,
        recentRows: expRows.slice(0, 10).map(function (r) {
          return {
            date: String(r.spentAt || r.createdAt || '').slice(0, 10),
            desc: r.description || '-',
            category: r.categoryName || '기타',
            amount: Number(r.amount || 0),
          };
        }),
      },
      budget: {
        year: (budRows[0] && budRows[0].fiscalYear) || new Date().getFullYear(),
        totalBudget: totalBudget,
        totalSpent: rep.totalSpent || 0,
        categories: categories,
        recentExpenses: expRows.slice(0, 10).map(function (r) {
          return {
            date: String(r.spentAt || r.createdAt || '').slice(0, 10),
            desc: r.description || '-',
            category: r.categoryName || '기타',
            amount: Number(r.amount || 0),
            status: r.status || '-',
          };
        }),
      },
      report: {
        period: ((budRows[0] && budRows[0].fiscalYear) || new Date().getFullYear()) + '년',
        totalIncome: totalBudget,
        totalExpense: rep.totalSpent || 0,
        netBalance: rep.remaining || 0,
        sections: [
          { title: '총 예산', value: totalBudget, note: '예산 계획 합계' },
          { title: '총 지출', value: rep.totalSpent || 0, note: '승인된 지출 합계' },
          { title: '잔여 예산', value: rep.remaining || 0, note: '예산 - 지출' },
          { title: '집행률', value: (rep.utilizationRate || 0) + '%', note: '예산 대비 지출 비율' },
        ],
      },
    };
  }

  /* ─── 데이터 로드 ─── */
  async function loadData() {
    let d;
    if (USE_MOCK) {
      d = MOCK;
    } else {
      const res = await api({ url: '/api/admin-finance-unified' });
      if (!res.ok) {
        showToast((res.data?.error || res.data?.data?.error || '재정 데이터를 불러오지 못했습니다.') + (res.data?.detail ? ' — ' + res.data.detail : ''));
        d = {};
      } else {
        const raw = res.data?.data || res.data || {};
        d = transformFinanceData(raw);
      }
    }
    finData = d;
    renderTab(currentTab, d);
  }

  /* ─── 탭별 렌더 ─── */
  function renderTab(tab, d) {
    if (tab === 'income') renderIncome(d.income || {});
    else if (tab === 'budget') renderBudget(d.budget || {});
    else if (tab === 'report') renderReport(d.report || {});
  }

  /* ─── 수입 관리 ─── */
  function renderIncome(inc) {
    const wrap = document.getElementById('fg-income-wrap');
    if (!wrap) return;
    const rows = inc.recentRows || [];
    const byCategory = inc.byCategory || [];
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div class="kpi">
          <div class="kpi-label">올해 총 수입</div>
          <div class="kpi-value" style="color:var(--tok-brand)">₩ ${(inc.total || 0).toLocaleString()}</div>
        </div>
        ${byCategory.slice(0, 2).map(c => `
          <div class="kpi">
            <div class="kpi-label">${c.category}</div>
            <div class="kpi-value">₩ ${c.amount.toLocaleString()}</div>
          </div>`).join('')}
      </div>

      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--tok-text-1)">카테고리별 수입</div>
        ${byCategory.map(c => {
          const pct = inc.total ? Math.round(c.amount / inc.total * 100) : 0;
          return `
          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:12.5px">${c.category}</span>
              <span style="font-size:12.5px;font-weight:600">₩ ${c.amount.toLocaleString()} (${pct}%)</span>
            </div>
            <div style="height:6px;background:#f0f0f0;border-radius:3px">
              <div style="height:100%;width:${pct}%;background:var(--tok-brand);border-radius:3px"></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--tok-text-1)">최근 수입 내역</div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>일자</th><th>내용</th><th>카테고리</th><th style="text-align:right">금액</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-size:12px;white-space:nowrap">${r.date}</td>
                <td>${r.desc}</td>
                <td><span style="background:#f0f4ff;color:#1a5ec4;padding:2px 8px;border-radius:10px;font-size:11.5px">${r.category}</span></td>
                <td style="text-align:right;font-weight:600">₩ ${r.amount.toLocaleString()}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">mock 데이터</p>`;
  }

  /* ─── 예산 집행 ─── */
  function renderBudget(bud) {
    const wrap = document.getElementById('fg-budget-wrap');
    if (!wrap) return;
    const cats = bud.categories || [];
    const expenses = bud.recentExpenses || [];
    const statusLabel = { approved: '승인', pending: '대기', rejected: '반려' };
    const statusColor = { approved: '#1a8b46', pending: '#c47a00', rejected: '#c5293a' };
    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div class="kpi">
          <div class="kpi-label">${bud.year || ''}년 총 예산</div>
          <div class="kpi-value">₩ ${(bud.totalBudget || 0).toLocaleString()}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">집행 금액</div>
          <div class="kpi-value" style="color:#c47a00">₩ ${(bud.totalSpent || 0).toLocaleString()}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">잔여 예산</div>
          <div class="kpi-value" style="color:#1a8b46">₩ ${((bud.totalBudget || 0) - (bud.totalSpent || 0)).toLocaleString()}</div>
        </div>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--tok-text-1)">항목별 예산 현황</div>
        ${cats.map(c => {
          const pct = c.budget ? Math.round(c.spent / c.budget * 100) : 0;
          const barColor = pct > 90 ? '#c5293a' : pct > 70 ? '#c47a00' : '#1a8b46';
          return `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:12.5px;font-weight:600">${c.name}</span>
              <span style="font-size:12px;color:var(--tok-text-2)">₩ ${c.spent.toLocaleString()} / ₩ ${c.budget.toLocaleString()} (${pct}%)</span>
            </div>
            <div style="height:8px;background:#f0f0f0;border-radius:4px">
              <div style="height:100%;width:${Math.min(pct, 100)}%;background:${barColor};border-radius:4px"></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;color:var(--tok-text-1)">최근 지출 내역</div>
        <button class="btn-sm btn-sm-primary" onclick="alert('[mock] 지출 신청 모달')">+ 지출 신청</button>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead><tr><th>일자</th><th>내용</th><th>항목</th><th style="text-align:right">금액</th><th>상태</th></tr></thead>
          <tbody>
            ${expenses.map(e => `
              <tr>
                <td style="font-size:12px;white-space:nowrap">${e.date}</td>
                <td>${e.desc}</td>
                <td><span style="background:#f5f5f0;color:var(--tok-text-2);padding:2px 8px;border-radius:10px;font-size:11.5px">${e.category}</span></td>
                <td style="text-align:right;font-weight:600">₩ ${e.amount.toLocaleString()}</td>
                <td><span style="color:${statusColor[e.status] || '#666'};font-weight:600;font-size:12.5px">${statusLabel[e.status] || e.status}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--tok-text-3);margin-top:8px">mock 데이터</p>`;
  }

  /* ─── 재무 보고서 ─── */
  function renderReport(rep) {
    const wrap = document.getElementById('fg-report-wrap');
    if (!wrap) return;
    const sections = rep.sections || [];
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--tok-text-1)">${rep.period || ''} 재무 현황 보고서</div>
          <div style="font-size:12px;color:var(--tok-text-3);margin-top:2px">mock 데이터</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-sm btn-sm-ghost" onclick="window.print()">🖨️ 인쇄</button>
          <button class="btn-sm btn-sm-ghost" onclick="alert('[mock] 엑셀 다운로드')">📥 엑셀</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        <div class="kpi" style="border-left:3px solid #1a8b46">
          <div class="kpi-label">총 수입</div>
          <div class="kpi-value" style="color:#1a8b46">₩ ${(rep.totalIncome || 0).toLocaleString()}</div>
        </div>
        <div class="kpi" style="border-left:3px solid #c5293a">
          <div class="kpi-label">총 지출</div>
          <div class="kpi-value" style="color:#c5293a">₩ ${(rep.totalExpense || 0).toLocaleString()}</div>
        </div>
        <div class="kpi" style="border-left:3px solid var(--tok-brand)">
          <div class="kpi-label">순 잉여금</div>
          <div class="kpi-value" style="color:var(--tok-brand)">₩ ${(rep.netBalance || 0).toLocaleString()}</div>
        </div>
      </div>

      <table class="tbl" style="margin-bottom:16px">
        <thead><tr><th>항목</th><th style="text-align:right">금액</th><th>비고</th></tr></thead>
        <tbody>
          ${sections.map(s => `
            <tr>
              <td style="font-weight:600">${s.title}</td>
              <td style="text-align:right;font-weight:600;font-family:'Inter',monospace">₩ ${s.value.toLocaleString()}</td>
              <td style="font-size:12px;color:var(--tok-text-3)">${s.note}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p style="font-size:12px;color:var(--tok-text-3)">* 실 API 연결 후 실제 데이터로 교체됩니다.</p>`;
  }

  /* ─── 진입점 ─── */
  function tryInit() {
    const container = document.getElementById('adm20-finance');
    if (!container) return;
    if (container.dataset.finGroupInit) return;
    container.dataset.finGroupInit = '1';
    init();
  }

  const obs = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.target && m.target.id === 'adm20-finance' && m.target.classList.contains('is-active')) {
        tryInit();
      }
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    const container = document.getElementById('adm20-finance');
    if (container) {
      obs.observe(container, { attributes: true, attributeFilter: ['class'] });
      if (container.classList.contains('is-active')) tryInit();
    }
  });

})();
