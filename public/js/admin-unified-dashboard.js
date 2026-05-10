/* =========================================================
   SIREN — admin-unified-dashboard.js
   Phase 16: 통합 분석 대시보드 (mock 모드 — B 머지 후 실 API 전환)
   ========================================================= */
(function () {
  'use strict';

  /* ---- mock 데이터 (B 머지 전 사용) ---- */
  var USE_MOCK = true;

  var MOCK_KPI = {
    ok: true, period: '30d',
    donation: {
      totalAmount: 4500000, totalCount: 38, newDonors: 12, regularRetentionRate: 0.87,
      monthlyTrend: [
        { month: '2026-03', amount: 2100000, count: 18 },
        { month: '2026-04', amount: 2400000, count: 20 }
      ]
    },
    member: {
      newCount: 25, activeCount: 312, withdrawnCount: 3,
      monthlyTrend: [{ month: '2026-03', newCount: 14, withdrawnCount: 1 }]
    },
    siren: {
      totalNew: 17, resolvedRate: 0.71,
      byType: [
        { type: 'incident', count: 7 },
        { type: 'harassment', count: 6 },
        { type: 'legal', count: 4 }
      ]
    },
    send: { totalJobs: 8, successRate: 0.94, openRate: 0.42 }
  };

  var MOCK_COHORT = {
    ok: true,
    cohorts: [
      { month: '2026-01', newMembers: 22, firstDonationRate: 0.45, regularConvertRate: 0.18, churnRate: 0.09, avgDaysToFirstDonation: 12 },
      { month: '2026-02', newMembers: 18, firstDonationRate: 0.39, regularConvertRate: 0.22, churnRate: 0.06, avgDaysToFirstDonation: 9 }
    ]
  };

  var MOCK_CHURN = {
    ok: true,
    summary: { highRisk: 14, mediumRisk: 38, total: 52 },
    members: [
      {
        id: 42, name: '홍길동', churnRiskScore: 85, churnRiskLevel: 'high',
        lastLoginAt: '2026-03-10T08:00:00Z', lastDonationAt: '2026-02-01T00:00:00Z',
        totalDonationAmount: 360000
      }
    ]
  };

  /* ---- Chart 인스턴스 관리 ---- */
  var _chartTrend = null;
  var _chartSiren = null;

  function destroyCharts() {
    if (_chartTrend) { try { _chartTrend.destroy(); } catch (e) {} _chartTrend = null; }
    if (_chartSiren) { try { _chartSiren.destroy(); } catch (e) {} _chartSiren = null; }
  }

  /* ---- 유틸 ---- */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    alert(msg);
  }

  function fmtAmount(n) {
    return (Number(n) || 0).toLocaleString() + '원';
  }

  function fmtPct(n) {
    return (Math.round((Number(n) || 0) * 100)) + '%';
  }

  function fmtDate(s) {
    if (!s) return '-';
    try { return new Date(s).toLocaleDateString('ko-KR'); } catch (e) { return String(s); }
  }

  function fmtNum(n) {
    return (Number(n) || 0).toLocaleString();
  }

  async function apiCall(path) {
    try {
      var res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      var data = await res.json().catch(function () { return {}; });
      return { ok: res.ok && data.ok !== false, data: data };
    } catch (e) {
      return { ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ---- 진입점 ---- */

  function getContainer() {
    return document.getElementById('adm-unified-dashboard');
  }

  async function load() {
    var c = getContainer();
    if (!c) return;
    destroyCharts();
    renderShell(c);
    await Promise.all([loadKpi(), loadCohort(), loadChurn()]);
  }

  /* ---- 셸 레이아웃 ---- */

  function renderShell(c) {
    c.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">' +
        '<h2 style="font-size:20px;font-weight:700;margin:0">📈 통합 분석 대시보드</h2>' +
        (USE_MOCK ? '<span style="font-size:12px;color:#f59e0b;background:#fef3c7;padding:2px 8px;border-radius:4px;font-weight:600">MOCK 데이터</span>' : '') +
      '</div>' +

      /* KPI 카드 영역 */
      '<div id="ud-kpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px">' +
        '<div style="background:var(--bg-2,#f9fafb);border-radius:10px;padding:20px;text-align:center;color:var(--text-3,#6b7280);font-size:13px">불러오는 중...</div>' +
      '</div>' +

      /* 차트 영역 */
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:28px">' +
        '<div class="panel" style="padding:20px">' +
          '<div style="font-size:15px;font-weight:600;margin-bottom:14px">📆 후원 월별 추이</div>' +
          '<canvas id="ud-chart-trend" height="200"></canvas>' +
        '</div>' +
        '<div class="panel" style="padding:20px">' +
          '<div style="font-size:15px;font-weight:600;margin-bottom:14px">🚨 사이렌 처리 현황</div>' +
          '<canvas id="ud-chart-siren" height="200"></canvas>' +
        '</div>' +
      '</div>' +

      /* 코호트 테이블 */
      '<div class="panel" style="padding:20px;margin-bottom:28px">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:14px">🔬 코호트 분석</div>' +
        '<div id="ud-cohort" style="color:var(--text-3,#6b7280);font-size:13px">불러오는 중...</div>' +
      '</div>' +

      /* 이탈 위험 회원 목록 */
      '<div class="panel" style="padding:20px">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:14px">⚠️ 이탈 위험 회원</div>' +
        '<div id="ud-churn" style="color:var(--text-3,#6b7280);font-size:13px">불러오는 중...</div>' +
      '</div>';
  }

  /* ---- KPI 카드 로드 ---- */

  async function loadKpi() {
    var data;
    if (USE_MOCK) {
      data = MOCK_KPI;
    } else {
      var res = await apiCall('/api/admin-dashboard-kpi?period=30d');
      if (!res.ok) {
        document.getElementById('ud-kpi').innerHTML =
          '<p style="color:var(--danger,#ef4444);font-size:13px">KPI 데이터를 불러오지 못했습니다.</p>';
        return;
      }
      data = res.data.data || res.data;
    }
    renderKpi(data);
    renderTrendChart(data.donation);
    renderSirenChart(data.siren);
  }

  function renderKpi(d) {
    var el = document.getElementById('ud-kpi');
    if (!el) return;
    var cards = [
      { label: '월간 후원 수입', value: fmtAmount(d.donation.totalAmount), icon: '💰', color: '#10b981' },
      { label: '신규 후원자', value: fmtNum(d.donation.newDonors) + '명', icon: '🙋', color: '#3b82f6' },
      { label: '정기 유지율', value: fmtPct(d.donation.regularRetentionRate), icon: '🔄', color: '#8b5cf6' },
      { label: '신규 회원', value: fmtNum(d.member.newCount) + '명', icon: '👤', color: '#f59e0b' }
    ];
    el.innerHTML = cards.map(function (c) {
      return '<div style="background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:20px;text-align:center">' +
        '<div style="font-size:28px;margin-bottom:8px">' + c.icon + '</div>' +
        '<div style="font-size:22px;font-weight:700;color:' + c.color + ';margin-bottom:4px">' + escapeHtml(c.value) + '</div>' +
        '<div style="font-size:12px;color:var(--text-3,#6b7280)">' + escapeHtml(c.label) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ---- 후원 월별 추이 차트 ---- */

  function renderTrendChart(donation) {
    var canvas = document.getElementById('ud-chart-trend');
    if (!canvas || !window.Chart) return;
    if (_chartTrend) { _chartTrend.destroy(); _chartTrend = null; }

    var trend = donation.monthlyTrend || [];
    var labels = trend.map(function (t) { return t.month; });
    var amounts = trend.map(function (t) { return Math.round(t.amount / 10000); });

    _chartTrend = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '후원 수입 (만원)',
          data: amounts,
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: function (v) { return v + '만'; } }
          }
        }
      }
    });
  }

  /* ---- 사이렌 처리 현황 차트 ---- */

  var SIREN_TYPE_LABELS = { incident: '사건·사고', harassment: '괴롭힘', legal: '법률' };

  function renderSirenChart(siren) {
    var canvas = document.getElementById('ud-chart-siren');
    if (!canvas || !window.Chart) return;
    if (_chartSiren) { _chartSiren.destroy(); _chartSiren = null; }

    var types = siren.byType || [];
    var labels = types.map(function (t) { return SIREN_TYPE_LABELS[t.type] || t.type; });
    var counts = types.map(function (t) { return t.count; });

    _chartSiren = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: counts,
          backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } }
        }
      }
    });
  }

  /* ---- 코호트 분석 테이블 ---- */

  async function loadCohort() {
    var data;
    if (USE_MOCK) {
      data = MOCK_COHORT;
    } else {
      var res = await apiCall('/api/admin-cohort-analysis');
      if (!res.ok) {
        document.getElementById('ud-cohort').innerHTML =
          '<p style="color:var(--danger,#ef4444);font-size:13px">코호트 데이터를 불러오지 못했습니다.</p>';
        return;
      }
      data = res.data.data || res.data;
    }
    renderCohortTable(data.cohorts || []);
  }

  function renderCohortTable(cohorts) {
    var el = document.getElementById('ud-cohort');
    if (!el) return;
    if (!cohorts.length) {
      el.innerHTML = '<p style="color:var(--text-3,#6b7280)">코호트 데이터가 없습니다.</p>';
      return;
    }
    var rows = cohorts.map(function (c) {
      return '<tr>' +
        '<td style="padding:10px 12px">' + escapeHtml(c.month) + '</td>' +
        '<td style="padding:10px 12px;text-align:right">' + fmtNum(c.newMembers) + '명</td>' +
        '<td style="padding:10px 12px;text-align:right">' + fmtPct(c.firstDonationRate) + '</td>' +
        '<td style="padding:10px 12px;text-align:right">' + fmtPct(c.regularConvertRate) + '</td>' +
        '<td style="padding:10px 12px;text-align:right">' + fmtPct(c.churnRate) + '</td>' +
        '<td style="padding:10px 12px;text-align:right">' + fmtNum(c.avgDaysToFirstDonation) + '일</td>' +
        '</tr>';
    }).join('');

    el.innerHTML =
      '<div style="overflow-x:auto">' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead>' +
          '<tr style="background:var(--bg-2,#f9fafb);color:var(--text-3,#6b7280);font-size:12px">' +
            '<th style="padding:10px 12px;text-align:left;white-space:nowrap">가입 월</th>' +
            '<th style="padding:10px 12px;text-align:right;white-space:nowrap">신규 회원</th>' +
            '<th style="padding:10px 12px;text-align:right;white-space:nowrap">첫 후원율</th>' +
            '<th style="padding:10px 12px;text-align:right;white-space:nowrap">정기 전환율</th>' +
            '<th style="padding:10px 12px;text-align:right;white-space:nowrap">이탈율</th>' +
            '<th style="padding:10px 12px;text-align:right;white-space:nowrap">첫 후원까지(일)</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>';
  }

  /* ---- 이탈 위험 회원 목록 ---- */

  async function loadChurn() {
    var data;
    if (USE_MOCK) {
      data = MOCK_CHURN;
    } else {
      var res = await apiCall('/api/admin-churn-members');
      if (!res.ok) {
        document.getElementById('ud-churn').innerHTML =
          '<p style="color:var(--danger,#ef4444);font-size:13px">이탈 위험 데이터를 불러오지 못했습니다.</p>';
        return;
      }
      data = res.data.data || res.data;
    }
    renderChurnList(data);
  }

  function renderChurnList(data) {
    var el = document.getElementById('ud-churn');
    if (!el) return;

    var summary = data.summary || {};
    var members = data.members || [];

    var summaryHtml =
      '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">' +
        '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 20px;min-width:140px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:#ef4444">' + fmtNum(summary.highRisk || 0) + '명</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:2px">고위험</div>' +
        '</div>' +
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 20px;min-width:140px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:#f59e0b">' + fmtNum(summary.mediumRisk || 0) + '명</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:2px">중위험</div>' +
        '</div>' +
        '<div style="background:var(--bg-2,#f9fafb);border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px 20px;min-width:140px;text-align:center">' +
          '<div style="font-size:24px;font-weight:700;color:var(--text-1,#111)">' + fmtNum(summary.total || 0) + '명</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:2px">전체 위험</div>' +
        '</div>' +
      '</div>';

    if (!members.length) {
      el.innerHTML = summaryHtml + '<p style="color:var(--text-3,#6b7280);font-size:13px">이탈 위험 회원이 없습니다.</p>';
      return;
    }

    var RISK_STYLE = {
      high: 'background:#fef2f2;color:#ef4444;border:1px solid #fecaca',
      medium: 'background:#fff7ed;color:#f59e0b;border:1px solid #fed7aa',
      low: 'background:#f0fdf4;color:#22c55e;border:1px solid #bbf7d0'
    };

    var rows = members.map(function (m) {
      var riskStyle = RISK_STYLE[m.churnRiskLevel] || RISK_STYLE.medium;
      return '<tr style="border-bottom:1px solid var(--border,#e5e7eb)">' +
        '<td style="padding:10px 12px">' + escapeHtml(m.name) + '</td>' +
        '<td style="padding:10px 12px;text-align:center">' +
          '<span style="' + riskStyle + ';border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">' +
          escapeHtml(String(m.churnRiskScore)) + '점</span>' +
        '</td>' +
        '<td style="padding:10px 12px;text-align:center">' + fmtDate(m.lastLoginAt) + '</td>' +
        '<td style="padding:10px 12px;text-align:center">' + fmtDate(m.lastDonationAt) + '</td>' +
        '<td style="padding:10px 12px;text-align:right">' + fmtAmount(m.totalDonationAmount) + '</td>' +
        '<td style="padding:10px 12px;text-align:center">' +
          '<button class="btn-sm btn-sm-ghost ud-churn-msg" data-member-id="' + escapeHtml(String(m.id)) + '" data-member-name="' + escapeHtml(m.name) + '" type="button" style="font-size:11px">재참여 메시지 발송</button>' +
        '</td>' +
        '</tr>';
    }).join('');

    el.innerHTML = summaryHtml +
      '<div style="overflow-x:auto">' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead>' +
          '<tr style="background:var(--bg-2,#f9fafb);color:var(--text-3,#6b7280);font-size:12px">' +
            '<th style="padding:10px 12px;text-align:left">회원명</th>' +
            '<th style="padding:10px 12px;text-align:center">위험 점수</th>' +
            '<th style="padding:10px 12px;text-align:center">마지막 로그인</th>' +
            '<th style="padding:10px 12px;text-align:center">마지막 후원</th>' +
            '<th style="padding:10px 12px;text-align:right">총 후원액</th>' +
            '<th style="padding:10px 12px;text-align:center">액션</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>';

    /* 재참여 메시지 발송 버튼 이벤트 */
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('.ud-churn-msg');
      if (!btn) return;
      sendReengageMessage(btn.dataset.memberId, btn.dataset.memberName);
    });
  }

  async function sendReengageMessage(memberId, memberName) {
    if (!confirm(escapeHtml(memberName) + ' 님에게 재참여 메시지를 발송할까요?')) return;
    if (USE_MOCK) {
      toast('(MOCK) ' + memberName + ' 님에게 재참여 메시지를 발송했습니다.');
      return;
    }
    var res = await fetch('/api/admin-send-reengage', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: memberId })
    });
    var data = await res.json().catch(function () { return {}; });
    if (data.ok !== false && res.ok) {
      toast(memberName + ' 님에게 재참여 메시지를 발송했습니다.');
    } else {
      toast('발송 실패: ' + (data.error || '알 수 없는 오류'));
    }
  }

  /* ---- 페이지 전환 수신 ---- */

  window.SIREN_UNIFIED_DASHBOARD = { load: load };

  /* admin.html의 페이지 전환 이벤트 수신 */
  document.addEventListener('siren:page', function (e) {
    if (e.detail && e.detail.page === 'unified-dashboard') load();
  });

  /* data-page 클릭 기반 페이지 전환 폴백 */
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-page="unified-dashboard"]');
    if (link) setTimeout(load, 80);
  });

})();
