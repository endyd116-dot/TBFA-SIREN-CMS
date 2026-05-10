/* Phase 17 — 보안·감사 로그 화면 (mock 모드) */
(function () {
  'use strict';

  /* ── mock 데이터 (B 머지 후 실 API로 교체) ── */
  const USE_MOCK = true;

  const MOCK_AUDIT_LIST = {
    ok: true, total: 1240, page: 1,
    logs: [
      { id: 891, userName: '관리자1', userType: 'admin', action: 'member_blacklist',
        target: 'M-08423', detail: '블랙 처리: 규정 위반', ipAddress: '1.2.3.4',
        riskLevel: 'high', success: true, createdAt: '2026-05-11T10:30:00Z' },
      { id: 890, userName: '관리자1', userType: 'admin', action: 'login',
        target: null, detail: null, ipAddress: '1.2.3.4',
        riskLevel: 'low', success: true, createdAt: '2026-05-11T09:00:00Z' },
      { id: 889, userName: '관리자2', userType: 'admin', action: 'donation_refund',
        target: 'D-00341', detail: '환불 승인', ipAddress: '5.6.7.8',
        riskLevel: 'critical', success: true, createdAt: '2026-05-10T15:20:00Z' },
      { id: 888, userName: '관리자1', userType: 'admin', action: 'member_update',
        target: 'M-00219', detail: '회원 정보 수정', ipAddress: '1.2.3.4',
        riskLevel: 'medium', success: true, createdAt: '2026-05-10T11:00:00Z' },
      { id: 887, userName: '시스템', userType: 'system', action: 'login',
        target: null, detail: '로그인 실패', ipAddress: '9.9.9.9',
        riskLevel: 'high', success: false, createdAt: '2026-05-10T08:45:00Z' },
    ]
  };

  const MOCK_AUDIT_STATS = {
    ok: true, period: '30d',
    byAction: [
      { action: 'login', count: 450 },
      { action: 'member_update', count: 38 },
      { action: 'member_blacklist', count: 3 },
      { action: 'donation_refund', count: 7 },
    ],
    byRiskLevel: [
      { level: 'critical', count: 2 },
      { level: 'high', count: 18 },
      { level: 'medium', count: 95 },
      { level: 'low', count: 1125 },
    ],
    failedLogins: 12,
    uniqueIps: 8
  };

  /* ── 상수 ── */
  const RISK_COLOR = {
    critical: '#dc2626',
    high:     '#ea580c',
    medium:   '#ca8a04',
    low:      '#16a34a',
  };

  const RISK_LABEL = {
    critical: '심각',
    high:     '높음',
    medium:   '보통',
    low:      '낮음',
  };

  const ACTION_LABEL = {
    login:                '로그인',
    logout:               '로그아웃',
    member_blacklist:     '회원 차단',
    member_update:        '회원 정보 수정',
    member_delete:        '회원 삭제',
    donation_refund:      '후원 환불',
    donation_update:      '후원 수정',
    report_status_change: '신고 상태 변경',
    bulk_operation:       '일괄 처리',
    admin_permission_change: '권한 변경',
  };

  /* ── 상태 ── */
  let state = {
    page: 1,
    total: 0,
    period: '30d',
    riskLevel: '',
    action: '',
    search: '',
    logs: [],
    stats: null,
    chart: null,
  };

  /* ── 유틸 ── */
  function maskPhone(p) {
    return p ? p.replace(/(\d{3})-?(\d{3,4})-?(\d{4})/, '$1-****-****') : '';
  }

  function fmtDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function riskBadge(level) {
    const color = RISK_COLOR[level] || '#6b7280';
    const label = RISK_LABEL[level] || level;
    return `<span style="
      display:inline-block;padding:2px 8px;border-radius:4px;
      font-size:11px;font-weight:700;color:#fff;
      background:${color};">${label}</span>`;
  }

  /* ── API ── */
  async function fetchStats() {
    if (USE_MOCK) return MOCK_AUDIT_STATS;
    const res = await api('/api/admin-audit-stats?period=' + state.period);
    if (!res.ok) throw new Error(res.data?.error || 'stats 조회 실패');
    return res.data;
  }

  async function fetchList() {
    if (USE_MOCK) return MOCK_AUDIT_LIST;
    const params = new URLSearchParams({
      page: state.page,
      limit: 50,
      period: state.period,
    });
    if (state.riskLevel) params.set('riskLevel', state.riskLevel);
    if (state.action) params.set('action', state.action);
    const res = await api('/api/admin-audit-list?' + params);
    if (!res.ok) throw new Error(res.data?.error || '목록 조회 실패');
    return res.data;
  }

  /* ── 통계 카드 렌더 ── */
  function renderStatCards(stats) {
    const total = stats.byRiskLevel.reduce((s, r) => s + r.count, 0);
    const critical = (stats.byRiskLevel.find(r => r.level === 'critical') || {}).count || 0;
    const high     = (stats.byRiskLevel.find(r => r.level === 'high')     || {}).count || 0;

    return `
    <div class="row-4" style="margin-bottom:20px">
      <div class="panel" style="text-align:center">
        <div style="font-size:28px;font-weight:700;color:var(--ink)">${total.toLocaleString()}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">전체 감사 로그 (${stats.period})</div>
      </div>
      <div class="panel" style="text-align:center">
        <div style="font-size:28px;font-weight:700;color:#dc2626">${(critical + high).toLocaleString()}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">위험 등급 로그 (심각+높음)</div>
      </div>
      <div class="panel" style="text-align:center">
        <div style="font-size:28px;font-weight:700;color:#ea580c">${stats.failedLogins.toLocaleString()}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">로그인 실패 횟수</div>
      </div>
      <div class="panel" style="text-align:center">
        <div style="font-size:28px;font-weight:700;color:var(--brand)">${stats.uniqueIps.toLocaleString()}</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">고유 접속 IP 수</div>
      </div>
    </div>`;
  }

  /* ── 도넛 차트 ── */
  function renderDonut(stats) {
    const levels = ['critical', 'high', 'medium', 'low'];
    const data   = levels.map(l => (stats.byRiskLevel.find(r => r.level === l) || {}).count || 0);
    const colors = levels.map(l => RISK_COLOR[l]);
    const labels = levels.map(l => RISK_LABEL[l]);

    if (state.chart) { state.chart.destroy(); state.chart = null; }

    const canvas = document.getElementById('auditRiskChart');
    if (!canvas) return;

    state.chart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()}건`
            }
          }
        }
      }
    });
  }

  /* ── 필터 바 ── */
  function renderFilterBar() {
    return `
    <div class="audit-filter-bar" style="display:flex;gap:8px;flex-wrap:wrap;
      margin-bottom:14px;padding:14px;background:#fafaf8;
      border:1px solid var(--line);border-radius:8px;align-items:center">
      <select id="saFilterPeriod" style="padding:6px 10px;border:1px solid var(--line);
        border-radius:5px;font-size:13px;background:#fff">
        <option value="7d">최근 7일</option>
        <option value="30d" selected>최근 30일</option>
        <option value="90d">최근 90일</option>
      </select>
      <select id="saFilterRisk" style="padding:6px 10px;border:1px solid var(--line);
        border-radius:5px;font-size:13px;background:#fff">
        <option value="">전체 등급</option>
        <option value="critical">심각</option>
        <option value="high">높음</option>
        <option value="medium">보통</option>
        <option value="low">낮음</option>
      </select>
      <select id="saFilterAction" style="padding:6px 10px;border:1px solid var(--line);
        border-radius:5px;font-size:13px;background:#fff">
        <option value="">전체 액션</option>
        <option value="login">로그인</option>
        <option value="member_blacklist">회원 차단</option>
        <option value="member_update">회원 정보 수정</option>
        <option value="member_delete">회원 삭제</option>
        <option value="donation_refund">후원 환불</option>
        <option value="donation_update">후원 수정</option>
        <option value="bulk_operation">일괄 처리</option>
        <option value="admin_permission_change">권한 변경</option>
      </select>
      <button id="saFilterBtn" class="btn btn-primary" style="padding:6px 16px;font-size:13px">조회</button>
      <button id="saFilterReset" class="btn btn-secondary" style="padding:6px 12px;font-size:13px">초기화</button>
    </div>`;
  }

  /* ── 로그 테이블 ── */
  function renderTable(logs, total) {
    const rows = logs.map(log => {
      const rowStyle = log.success ? '' : 'background:#fff5f5';
      const actionLabel = ACTION_LABEL[log.action] || log.action;
      return `
      <tr style="${rowStyle}">
        <td style="color:var(--text-3);font-size:12px;white-space:nowrap">${fmtDateTime(log.createdAt)}</td>
        <td><strong>${log.userName || '-'}</strong><br>
          <span style="font-size:11px;color:var(--text-3)">${log.userType === 'admin' ? '관리자' : '시스템'}</span>
        </td>
        <td>${actionLabel}</td>
        <td style="font-size:12px;color:var(--text-2)">${log.target || '-'}</td>
        <td style="font-size:12px;color:var(--text-3);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${log.detail || ''}">${log.detail || '-'}</td>
        <td style="font-size:12px;font-family:monospace">${log.ipAddress || '-'}</td>
        <td>${riskBadge(log.riskLevel)}</td>
        <td style="text-align:center">${log.success
          ? '<span style="color:#16a34a;font-size:14px">✓</span>'
          : '<span style="color:#dc2626;font-size:14px">✗</span>'}</td>
      </tr>`;
    }).join('');

    return `
    <div style="overflow-x:auto">
      <table class="tbl" style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f5f5f3">
            <th style="padding:10px 12px;font-size:12px;text-align:left;white-space:nowrap">시각</th>
            <th style="padding:10px 12px;font-size:12px;text-align:left">관리자</th>
            <th style="padding:10px 12px;font-size:12px;text-align:left">액션</th>
            <th style="padding:10px 12px;font-size:12px;text-align:left">대상</th>
            <th style="padding:10px 12px;font-size:12px;text-align:left">상세</th>
            <th style="padding:10px 12px;font-size:12px;text-align:left">IP</th>
            <th style="padding:10px 12px;font-size:12px;text-align:left">등급</th>
            <th style="padding:10px 12px;font-size:12px;text-align:center">성공</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-3)">로그 없음</td></tr>'}</tbody>
      </table>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text-3)">전체 ${total.toLocaleString()}건</div>`;
  }

  /* ── 전체 화면 렌더 ── */
  async function render() {
    const sec = document.getElementById('adm-security-audit');
    if (!sec) return;

    sec.innerHTML = `<div style="padding:8px 0 16px">
      <div class="p-title">🔒 보안·감사 로그</div>
      <p style="font-size:13px;color:var(--text-3);margin-bottom:16px">
        관리자 활동과 보안 이벤트를 모니터링합니다.
        ${USE_MOCK ? '<span style="color:#ca8a04;font-size:12px">[목업 데이터]</span>' : ''}
      </p>
      <div id="saStatCards"><div class="loading">통계 불러오는 중…</div></div>
      <div class="row-1-1" style="margin-bottom:20px">
        <div class="panel">
          <div class="panel-title" style="margin-bottom:12px">위험 등급 분포</div>
          <div style="height:220px;position:relative"><canvas id="auditRiskChart"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-title" style="margin-bottom:12px">액션별 집계 (${state.period})</div>
          <div id="saActionList"></div>
        </div>
      </div>
      ${renderFilterBar()}
      <div class="panel" style="padding:0">
        <div id="saLogTable"><div class="loading" style="padding:24px">목록 불러오는 중…</div></div>
      </div>
    </div>`;

    bindFilterEvents();

    try {
      const [stats, list] = await Promise.all([fetchStats(), fetchList()]);
      state.stats = stats;
      state.logs  = list.logs;
      state.total = list.total;

      document.getElementById('saStatCards').innerHTML = renderStatCards(stats);
      renderDonut(stats);
      renderActionList(stats);
      document.getElementById('saLogTable').innerHTML = renderTable(state.logs, state.total);
    } catch (e) {
      document.getElementById('saStatCards').innerHTML =
        `<div class="err-box">데이터 불러오기 실패: ${e.message}</div>`;
    }
  }

  function renderActionList(stats) {
    const el = document.getElementById('saActionList');
    if (!el) return;
    const total = stats.byAction.reduce((s, a) => s + a.count, 0) || 1;
    el.innerHTML = stats.byAction.map(a => {
      const pct = Math.round((a.count / total) * 100);
      return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
          <span>${ACTION_LABEL[a.action] || a.action}</span>
          <span style="color:var(--text-3)">${a.count.toLocaleString()}건</span>
        </div>
        <div style="height:6px;background:#f0f0ee;border-radius:3px">
          <div style="height:100%;width:${pct}%;background:var(--brand);border-radius:3px"></div>
        </div>
      </div>`;
    }).join('');
  }

  /* ── 필터 이벤트 ── */
  function bindFilterEvents() {
    document.getElementById('saFilterBtn')?.addEventListener('click', async () => {
      state.period    = document.getElementById('saFilterPeriod')?.value || '30d';
      state.riskLevel = document.getElementById('saFilterRisk')?.value  || '';
      state.action    = document.getElementById('saFilterAction')?.value || '';
      state.page = 1;

      const tableEl = document.getElementById('saLogTable');
      const cardEl  = document.getElementById('saStatCards');
      if (tableEl) tableEl.innerHTML = '<div class="loading" style="padding:24px">조회 중…</div>';
      if (cardEl)  cardEl.innerHTML  = '<div class="loading">통계 불러오는 중…</div>';

      try {
        const [stats, list] = await Promise.all([fetchStats(), fetchList()]);
        state.stats = stats;
        state.logs  = list.logs;
        state.total = list.total;

        if (cardEl) cardEl.innerHTML = renderStatCards(stats);
        renderDonut(stats);
        renderActionList(stats);
        if (tableEl) tableEl.innerHTML = renderTable(state.logs, state.total);
      } catch (e) {
        if (tableEl) tableEl.innerHTML = `<div class="err-box" style="padding:16px">조회 실패: ${e.message}</div>`;
      }
    });

    document.getElementById('saFilterReset')?.addEventListener('click', () => {
      const period = document.getElementById('saFilterPeriod');
      const risk   = document.getElementById('saFilterRisk');
      const action = document.getElementById('saFilterAction');
      if (period) period.value = '30d';
      if (risk)   risk.value   = '';
      if (action) action.value = '';
      state.period = '30d'; state.riskLevel = ''; state.action = '';
    });
  }

  /* ── 진입점 — admin.js의 페이지 전환 이벤트 연동 ── */
  function init() {
    const observer = new MutationObserver(() => {
      const sec = document.getElementById('adm-security-audit');
      if (sec && sec.classList.contains('show') && !sec.dataset.loaded) {
        sec.dataset.loaded = '1';
        render();
      }
    });

    const content = document.querySelector('.adm-content');
    if (content) {
      observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    /* data-page 클릭 직접 감지 (fallback) */
    document.querySelectorAll('[data-page="security-audit"]').forEach(el => {
      el.addEventListener('click', () => {
        setTimeout(() => {
          const sec = document.getElementById('adm-security-audit');
          if (sec && !sec.dataset.loaded) { sec.dataset.loaded = '1'; render(); }
          else if (sec && sec.dataset.loaded) { /* 이미 로드됨 — 재진입 시 갱신 필요하면 주석 제거 후 render() */ }
        }, 80);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
