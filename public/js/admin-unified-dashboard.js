/* =========================================================
   SIREN — admin-unified-dashboard.js
   Phase 16: 통합 분석 대시보드 (실 API 연결)
   ========================================================= */
(function () {
  'use strict';

  /* ---- Chart 인스턴스 관리 ---- */
  var _chartTrend = null;
  var _chartSiren = null;
  var _chartSirenWeekly = null;

  function destroyCharts() {
    if (_chartTrend) { try { _chartTrend.destroy(); } catch (e) {} _chartTrend = null; }
    if (_chartSiren) { try { _chartSiren.destroy(); } catch (e) {} _chartSiren = null; }
    if (_chartSirenWeekly) { try { _chartSirenWeekly.destroy(); } catch (e) {} _chartSirenWeekly = null; }
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
    try { return new Date(s).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }); } catch (e) { return String(s); }
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

  var _currentPeriod = '30d';

  function getContainer() {
    return document.getElementById('adm-unified-dashboard');
  }

  async function load() {
    var c = getContainer();
    if (!c) return;
    destroyCharts();
    _currentPeriod = '30d';
    renderShell(c);
    await Promise.all([loadKpi(_currentPeriod), loadCohort(), loadChurn()]);
  }

  /* ---- 셸 레이아웃 ---- */

  function renderShell(c) {
    c.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">' +
        '<h2 style="font-size:20px;font-weight:700;margin:0">📈 통합 분석 대시보드</h2>' +
        '<div style="display:flex;gap:6px" id="ud-period-btns">' +
          '<button class="btn-sm ud-period-btn active" data-period="30d" type="button">30일</button>' +
          '<button class="btn-sm ud-period-btn" data-period="90d" type="button">90일</button>' +
          '<button class="btn-sm ud-period-btn" data-period="180d" type="button">180일</button>' +
          '<button class="btn-sm ud-period-btn" data-period="365d" type="button">365일</button>' +
        '</div>' +
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

      /* ★ 2026-05-16 #3: SIREN 주별 신고 추이 라인 차트 (임원 회의·사업 보고용) */
      '<div class="panel" style="padding:20px;margin-bottom:28px">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:14px">📈 SIREN 주별 신고 추이 (최근 12주)</div>' +
        '<canvas id="ud-chart-siren-weekly" height="120"></canvas>' +
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

  async function loadKpi(period) {
    period = period || '30d';
    var res = await apiCall('/api/admin-dashboard-kpi?period=' + encodeURIComponent(period));
    if (!res.ok) {
      document.getElementById('ud-kpi').innerHTML =
        '<p style="color:var(--danger,#ef4444);font-size:13px">KPI 데이터를 불러오지 못했습니다: ' +
        escapeHtml((res.data && res.data.error) || '') + '</p>';
      return;
    }
    var data = res.data.data || res.data;
    renderKpi(data);
    renderTrendChart(data.donation || {});
    renderSirenChart(data.siren || {});
    renderSirenWeeklyChart(data.siren || {});
  }

  function renderKpi(d) {
    var el = document.getElementById('ud-kpi');
    if (!el) return;
    var donation = d.donation || {};
    var member = d.member || {};
    /* ★ 2026-05-16 #3: SIREN KPI 2종 추가 — 신규 신고 + 처리율 */
    var siren = d.siren || {};
    var cards = [
      { label: '월간 후원 수입', value: fmtAmount(donation.totalAmount), icon: '💰', color: '#10b981' },
      { label: '신규 후원자', value: fmtNum(donation.newDonors) + '명', icon: '🙋', color: '#3b82f6' },
      { label: '정기 유지율', value: fmtPct(donation.regularRetentionRate), icon: '🔄', color: '#8b5cf6' },
      { label: '신규 회원', value: fmtNum(member.newCount) + '명', icon: '👤', color: '#f59e0b' },
      { label: 'SIREN 신규 신고', value: fmtNum(siren.totalNew) + '건', icon: '🚨', color: '#ef4444' },
      { label: 'SIREN 처리율', value: fmtPct(siren.resolvedRate), icon: '✅', color: '#0ea5e9' }
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

  /* ★ 2026-05-16 #3: SIREN 주별 신고 추이 (라인 차트) ---- */
  function renderSirenWeeklyChart(siren) {
    var canvas = document.getElementById('ud-chart-siren-weekly');
    if (!canvas || !window.Chart) return;
    if (_chartSirenWeekly) { _chartSirenWeekly.destroy(); _chartSirenWeekly = null; }

    var trend = siren.weeklyTrend || [];
    if (!trend.length) {
      var parent = canvas.parentElement;
      if (parent) parent.innerHTML = '<div style="font-size:15px;font-weight:600;margin-bottom:14px">📈 SIREN 주별 신고 추이</div><p style="color:#9ca3af;font-size:13px;padding:20px 0;text-align:center">최근 12주간 신고 내역이 없습니다.</p>';
      return;
    }
    var labels = trend.map(function (t) { return t.week; });
    var counts = trend.map(function (t) { return t.count; });

    _chartSirenWeekly = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '주별 신고 건수',
          data: counts,
          backgroundColor: 'rgba(239,68,68,0.15)',
          borderColor: '#ef4444',
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: '#ef4444',
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  /* ---- 코호트 분석 테이블 ---- */

  async function loadCohort() {
    var res = await apiCall('/api/admin-dashboard-cohort?months=6');
    if (!res.ok) {
      var errMsg = (res.data && res.data.error) || '';
      var errDetail = (res.data && res.data.detail) || '';
      document.getElementById('ud-cohort').innerHTML =
        '<p style="color:var(--danger,#ef4444);font-size:13px">코호트 데이터를 불러오지 못했습니다: ' +
        escapeHtml(errMsg) + (errDetail ? '<br><small style="font-size:11px;opacity:.7">' + escapeHtml(errDetail) + '</small>' : '') + '</p>';
      return;
    }
    var data = res.data.data || res.data;
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
    var res = await apiCall('/api/admin-dashboard-churn?level=all');
    if (!res.ok) {
      document.getElementById('ud-churn').innerHTML =
        '<p style="color:var(--danger,#ef4444);font-size:13px">이탈 위험 데이터를 불러오지 못했습니다: ' +
        escapeHtml((res.data && res.data.error) || '') + '</p>';
      return;
    }
    var data = res.data.data || res.data;
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
    if (!confirm(memberName + ' 님에게 재참여 메시지를 발송할까요?')) return;
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

  /* ---- 기간 선택 버튼 이벤트 ---- */

  document.addEventListener('click', function (e) {
    var periodBtn = e.target.closest && e.target.closest('.ud-period-btn[data-period]');
    if (!periodBtn) return;
    var period = periodBtn.dataset.period;
    if (!period) return;
    _currentPeriod = period;
    /* 버튼 active 상태 갱신 */
    document.querySelectorAll('.ud-period-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.period === period);
    });
    destroyCharts();
    loadKpi(period);
  });

  /* ---- 페이지 전환 수신 ---- */

  window.SIREN_UNIFIED_DASHBOARD = { load: load };

  document.addEventListener('siren:page', function (e) {
    if (e.detail && e.detail.page === 'unified-dashboard') load();
  });

  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-page="unified-dashboard"]');
    if (link) setTimeout(load, 80);
  });

})();
