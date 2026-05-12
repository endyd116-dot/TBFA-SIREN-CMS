/* =========================================================
   SIREN — admin-siren-stats.js (Phase 13)
   신고 통계 대시보드 — 실 API(/api/admin-incident-stats) 연결
   ========================================================= */
(function () {
  'use strict';

  /* ============ 색상 팔레트 ============ */
  var SEVERITY_COLORS = {
    critical:   '#dc2626',
    high:       '#f97316',
    medium:     '#eab308',
    low:        '#22c55e',
    unanalyzed: '#9ca3af',
    unknown:    '#9ca3af',
  };

  var STATUS_COLORS = ['#3b82f6', '#8b5cf6', '#f97316', '#22c55e', '#9ca3af'];

  var STATUS_LABEL_MAP = {
    submitted:    '접수',
    ai_analyzed:  'AI분석',
    reviewing:    '검토중',
    matching:     '배정중',
    matched:      '배정완료',
    in_progress:  '처리중',
    responded:    '답변완료',
    completed:    '완료',
    closed:       '종결',
    rejected:     '반려',
  };

  var SEVERITY_LABEL_MAP = {
    critical:   '매우 심각',
    high:       '심각',
    medium:     '보통',
    low:        '낮음',
    unanalyzed: '미분석',
    unknown:    '미분석',
  };

  function statusLabel(s) { return STATUS_LABEL_MAP[s] || s || '기타'; }
  function severityLabel(s) { return SEVERITY_LABEL_MAP[s] || s || '기타'; }

  /* ============ 차트 인스턴스 저장 ============ */
  var _charts = {};

  function destroyChart(key) {
    if (_charts[key]) {
      try { _charts[key].destroy(); } catch (e) {}
      _charts[key] = null;
    }
  }

  /* ============ 유틸 ============ */
  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    alert(msg);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return iso.slice(0, 10).replace(/-/g, '.');
  }

  function toDateInput(d) {
    return d.toISOString().slice(0, 10);
  }

  /* ============ 기간 계산 ============ */
  var PRESET_PERIOD = { '1m': '30d', '3m': '90d', '6m': '180d', '1y': '365d' };

  function getPresetRange(preset) {
    var now = new Date();
    var to  = toDateInput(now);
    var from;
    if (preset === '1m') {
      var d = new Date(now); d.setMonth(d.getMonth() - 1);
      from = toDateInput(d);
    } else if (preset === '3m') {
      var d = new Date(now); d.setMonth(d.getMonth() - 3);
      from = toDateInput(d);
    } else if (preset === '6m') {
      var d = new Date(now); d.setMonth(d.getMonth() - 6);
      from = toDateInput(d);
    } else { /* 1y */
      var d = new Date(now); d.setFullYear(d.getFullYear() - 1);
      from = toDateInput(d);
    }
    return { from: from, to: to, period: PRESET_PERIOD[preset] || '365d' };
  }

  /* ============ API 호출 ============ */
  async function fetchStats(period) {
    var res = await fetch('/api/admin-incident-stats?period=' + period, {
      credentials: 'include',
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'HTTP ' + res.status);
    }
    return data.data || data;
  }

  /* ============ 상태 ============ */
  var _state = {
    from:       '',
    to:         '',
    period:     '365d',
    activeTab:  'all',
    data:       null,
  };

  /* 초기 날짜 범위 설정 (1년) */
  (function () {
    var r = getPresetRange('1y');
    _state.from   = r.from;
    _state.to     = r.to;
    _state.period = r.period;
  })();

  /* ============ 진입점 ============ */
  function init() {
    var c = document.getElementById('adm-siren-stats');
    if (!c) return;
    renderShell(c);
    loadData();
  }

  /* ============ 셸 레이아웃 ============ */
  function renderShell(c) {
    c.innerHTML = [
      '<div class="siren-stats-wrap">',

      /* 헤더 */
      '<div class="p-head no-print" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px">',
        '<div class="p-title">📊 신고 통계 대시보드</div>',
        '<button id="statsPrintBtn" class="btn-sm" style="background:#1e3a5f;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px">🖨️ PDF 출력</button>',
      '</div>',

      /* 기간 필터 */
      '<div class="no-print" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;flex-wrap:wrap;gap:10px">',
        '<span style="font-size:13px;font-weight:600;color:#374151">기간</span>',
        '<button data-preset="1m"  class="stats-preset" style="font-size:12px;padding:4px 10px;border-radius:20px;border:1px solid #d1d5db;background:#fff;cursor:pointer">최근 1개월</button>',
        '<button data-preset="3m"  class="stats-preset" style="font-size:12px;padding:4px 10px;border-radius:20px;border:1px solid #d1d5db;background:#fff;cursor:pointer">최근 3개월</button>',
        '<button data-preset="6m"  class="stats-preset" style="font-size:12px;padding:4px 10px;border-radius:20px;border:1px solid #d1d5db;background:#fff;cursor:pointer">최근 6개월</button>',
        '<button data-preset="1y"  class="stats-preset" style="font-size:12px;padding:4px 10px;border-radius:20px;border:1px solid #d1d5db;background:#fff;cursor:pointer">최근 1년</button>',
        '<input type="date" id="statsFrom" style="font-size:12px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px">',
        '<span style="color:#9ca3af">~</span>',
        '<input type="date" id="statsTo"   style="font-size:12px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px">',
        '<button id="statsQuery" style="font-size:12px;padding:5px 14px;border-radius:6px;border:none;background:#1e3a5f;color:#fff;cursor:pointer">조회</button>',
      '</div>',

      /* 요약 카드 4개 */
      '<div id="stats-summary-cards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">',
      '</div>',

      /* 탭 */
      '<div class="no-print" style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:18px">',
        '<button data-stats-tab="all"        class="stats-tab active" style="padding:10px 20px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-2px;color:#6b7280">전체</button>',
        '<button data-stats-tab="incidents"  class="stats-tab"        style="padding:10px 20px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-2px;color:#6b7280">🔍 사건 제보</button>',
        '<button data-stats-tab="harassment" class="stats-tab"        style="padding:10px 20px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-2px;color:#6b7280">⚠️ 악성민원</button>',
        '<button data-stats-tab="legal"      class="stats-tab"        style="padding:10px 20px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-2px;color:#6b7280">⚖️ 법률지원</button>',
      '</div>',

      /* 차트 콘텐츠 */
      '<div id="stats-charts-area"></div>',

      '</div>', /* .siren-stats-wrap */
    ].join('');

    /* 이벤트 */
    c.querySelectorAll('.stats-preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var range = getPresetRange(btn.dataset.preset);
        _state.from   = range.from;
        _state.to     = range.to;
        _state.period = range.period;
        var fi = document.getElementById('statsFrom');
        var ti = document.getElementById('statsTo');
        if (fi) fi.value = range.from;
        if (ti) ti.value = range.to;
        loadData();
      });
    });

    var fi = document.getElementById('statsFrom');
    var ti = document.getElementById('statsTo');
    if (fi) fi.value = _state.from;
    if (ti) ti.value = _state.to;

    var qBtn = document.getElementById('statsQuery');
    if (qBtn) {
      qBtn.addEventListener('click', function () {
        var f = document.getElementById('statsFrom');
        var t = document.getElementById('statsTo');
        _state.from   = (f && f.value) || _state.from;
        _state.to     = (t && t.value) || _state.to;
        _state.period = 'all';
        loadData();
      });
    }

    var printBtn = document.getElementById('statsPrintBtn');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        if (!_state.data) {
          toast('데이터를 먼저 불러온 후 PDF 출력해주세요.');
          return;
        }
        var wrap = document.querySelector('.siren-stats-wrap');
        var content = wrap ? wrap.innerHTML : document.getElementById('stats-charts-area').innerHTML;
        var w = window.open('', '_blank', 'width=1000,height=800');
        if (!w) { toast('팝업이 차단됐습니다. 팝업 허용 후 다시 시도해주세요.'); return; }
        w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>신고 통계 PDF</title>'
          + '<style>body{font-family:sans-serif;padding:24px;color:#1e293b}'
          + 'table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:8px 12px;font-size:13px}'
          + '.no-print{display:none!important}'
          + '</style></head><body>' + content + '<script>window.onload=function(){window.print();window.close();}<\/script></body></html>');
        w.document.close();
      });
    }

    c.querySelectorAll('.stats-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        c.querySelectorAll('.stats-tab').forEach(function (b) {
          b.classList.remove('active');
          b.style.borderBottomColor = 'transparent';
          b.style.color = '#6b7280';
        });
        btn.classList.add('active');
        btn.style.borderBottomColor = '#1e3a5f';
        btn.style.color = '#1e3a5f';
        _state.activeTab = btn.dataset.statsTab;
        renderCharts();
      });
    });
  }

  /* ============ 데이터 로드 ============ */
  async function loadData() {
    var area = document.getElementById('stats-charts-area');
    if (area) area.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:13px">불러오는 중...</div>';

    try {
      var data = await fetchStats(_state.period);
      _state.data = data;
      renderSummaryCards();
      renderCharts();
    } catch (err) {
      toast('통계를 불러오지 못했습니다: ' + (err.message || err));
      if (area) area.innerHTML = '<div style="text-align:center;padding:40px;color:#dc2626;font-size:13px">데이터 조회 실패 — 다시 시도해주세요.</div>';
    }
  }

  /* ============ 요약 카드 ============ */
  function renderSummaryCards() {
    var el = document.getElementById('stats-summary-cards');
    if (!el || !_state.data) return;
    var s = _state.data.summary;
    var cards = [
      { label: '전체 신고',   count: s.total.count,      color: '#1e3a5f', icon: '📊' },
      { label: '🔍 사건 제보', count: s.incidents.count,  color: '#3b82f6', icon: '' },
      { label: '⚠️ 악성민원', count: s.harassment.count, color: '#f97316', icon: '' },
      { label: '⚖️ 법률지원', count: s.legal.count,      color: '#8b5cf6', icon: '' },
    ];
    el.innerHTML = cards.map(function (c) {
      return [
        '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px 16px;border-top:3px solid ' + c.color + '">',
          '<div style="font-size:12px;color:#6b7280;margin-bottom:6px">' + c.label + '</div>',
          '<div style="font-size:28px;font-weight:700;color:' + c.color + '">' + c.count.toLocaleString() + '</div>',
          '<div style="font-size:11px;color:#9ca3af;margin-top:4px">' + fmtDate(_state.from) + ' ~ ' + fmtDate(_state.to) + '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  /* ============ 차트 렌더 (탭별) ============ */
  function renderCharts() {
    var area = document.getElementById('stats-charts-area');
    if (!area || !_state.data) return;

    /* 이전 차트 인스턴스 정리 */
    ['bar', 'donut', 'line'].forEach(destroyChart);

    var tab = _state.activeTab;

    if (tab === 'all') {
      renderAllTab(area);
    } else if (tab === 'incidents') {
      renderTypeTab(area, 'incidents', '🔍 사건 제보', false);
    } else if (tab === 'harassment') {
      renderTypeTab(area, 'harassment', '⚠️ 악성민원', false);
    } else if (tab === 'legal') {
      renderTypeTab(area, 'legal', '⚖️ 법률지원', true);
    }
  }

  /* ---- 전체 탭 ---- */
  function renderAllTab(area) {
    var d = _state.data;
    /* 전체 탭: 종류별 합산 bar + 각 탭 처리 현황 요약 */
    area.innerHTML = [
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">',
        '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">',
          '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:14px">신고 유형별 처리 현황</div>',
          '<canvas id="chart-all-bar" height="180"></canvas>',
        '</div>',
        '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">',
          '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:14px">유형별 건수 비교</div>',
          '<canvas id="chart-all-donut" height="180"></canvas>',
        '</div>',
      '</div>',
    ].join('');

    /* 전체 bar: 각 유형의 상태별 */
    setTimeout(function () {
      var barCtx = document.getElementById('chart-all-bar');
      if (!barCtx) return;
      /* 실제 반환된 status 키 기반으로 레이블·값 정렬 */
      var STATUS_ORDER = ['submitted', 'ai_analyzed', 'reviewing', 'matching', 'matched', 'in_progress', 'responded', 'completed', 'closed', 'rejected'];
      function byStatusToMap(arr) {
        var m = {};
        (arr || []).forEach(function (x) { m[x.status] = x.count; });
        return m;
      }
      var allStatuses = [];
      ['incidents', 'harassment', 'legal'].forEach(function (t) {
        (d[t].byStatus || []).forEach(function (x) { if (allStatuses.indexOf(x.status) < 0) allStatuses.push(x.status); });
      });
      allStatuses.sort(function (a, b) { return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b); });
      var labels = allStatuses.map(statusLabel);
      var im = byStatusToMap(d.incidents.byStatus);
      var hm = byStatusToMap(d.harassment.byStatus);
      var lm = byStatusToMap(d.legal.byStatus);
      var incidentsCounts  = allStatuses.map(function (s) { return im[s] || 0; });
      var harassmentCounts = allStatuses.map(function (s) { return hm[s] || 0; });
      var legalCounts      = allStatuses.map(function (s) { return lm[s] || 0; });
      _charts.bar = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: '사건 제보', data: incidentsCounts,  backgroundColor: '#3b82f6' },
            { label: '악성민원', data: harassmentCounts, backgroundColor: '#f97316' },
            { label: '법률지원', data: legalCounts,       backgroundColor: '#8b5cf6' },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: false }, y: { beginAtZero: true } },
        },
      });

      var donutCtx = document.getElementById('chart-all-donut');
      if (!donutCtx) return;
      _charts.donut = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['사건 제보', '악성민원', '법률지원'],
          datasets: [{
            data: [d.summary.incidents.count, d.summary.harassment.count, d.summary.legal.count],
            backgroundColor: ['#3b82f6', '#f97316', '#8b5cf6'],
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
        },
      });
    }, 50);
  }

  /* ---- 개별 유형 탭 ---- */
  function renderTypeTab(area, type, title, isLegal) {
    var d = _state.data[type];
    var severityRows = isLegal ? (d.byUrgency || []) : (d.bySeverity || []);
    var severityLabel = isLegal ? '긴급도' : 'AI 심각도';
    var trendData = d.monthlyTrend || [];
    var showTrend = trendData.length >= 2;

    area.innerHTML = [
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">',
        '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">',
          '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:14px">처리 상태</div>',
          '<canvas id="chart-status-bar" height="220"></canvas>',
        '</div>',
        '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px">',
          '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:14px">' + severityLabel + '</div>',
          '<canvas id="chart-severity-donut" height="220"></canvas>',
        '</div>',
      '</div>',
      showTrend ? [
        '<div id="trend-section" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:18px">',
          '<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:14px">월별 추이</div>',
          '<canvas id="chart-trend-line" height="100"></canvas>',
        '</div>',
      ].join('') : '',
    ].join('');

    setTimeout(function () {
      /* 수평 막대 — 처리 상태 */
      var barCtx = document.getElementById('chart-status-bar');
      if (barCtx) {
        _charts.bar = new Chart(barCtx, {
          type: 'bar',
          data: {
            labels: d.byStatus.map(function (x) { return statusLabel(x.status || x.label); }),
            datasets: [{
              label: '건수',
              data: d.byStatus.map(function (x) { return x.count; }),
              backgroundColor: STATUS_COLORS,
              borderRadius: 4,
            }],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true } },
          },
        });
      }

      /* 도넛 — 심각도/긴급도 */
      var donutCtx = document.getElementById('chart-severity-donut');
      if (donutCtx && severityRows.length) {
        _charts.donut = new Chart(donutCtx, {
          type: 'doughnut',
          data: {
            labels: severityRows.map(function (x) { return severityLabel(x.level || x.label); }),
            datasets: [{
              data: severityRows.map(function (x) { return x.count; }),
              backgroundColor: severityRows.map(function (x) { return SEVERITY_COLORS[x.level] || '#9ca3af'; }),
            }],
          },
          options: {
            responsive: true,
            plugins: { legend: { position: 'bottom' } },
          },
        });
      }

      /* 꺾은선 — 월별 추이 */
      if (showTrend) {
        var lineCtx = document.getElementById('chart-trend-line');
        if (lineCtx) {
          _charts.line = new Chart(lineCtx, {
            type: 'line',
            data: {
              labels: trendData.map(function (x) { return x.month; }),
              datasets: [{
                label: title,
                data: trendData.map(function (x) { return x.count; }),
                borderColor: '#1e3a5f',
                backgroundColor: 'rgba(30,58,95,0.08)',
                tension: 0.3,
                fill: true,
                pointRadius: 4,
              }],
            },
            options: {
              responsive: true,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true } },
            },
          });
        }
      }
    }, 50);
  }

  /* ============ 섹션 활성화 감지 ============ */
  function onSectionActivated() {
    var c = document.getElementById('adm-siren-stats');
    if (!c) return;
    if (!c.dataset.initialized) {
      c.dataset.initialized = '1';
      init();
    }
  }

  /* admin.js 탭 전환 이벤트 수신 */
  document.addEventListener('siren:page', function (e) {
    if (e.detail && e.detail.page === 'siren-stats') onSectionActivated();
  });

  /* adm-page show/hide 감지 (MutationObserver) */
  document.addEventListener('DOMContentLoaded', function () {
    var target = document.getElementById('adm-siren-stats');
    if (!target) return;
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (target.classList.contains('active') || target.style.display !== 'none') {
            onSectionActivated();
          }
        }
      });
    });
    obs.observe(target, { attributes: true });
  });

  window.SIREN_STATS = { init: init, reload: loadData };
})();
