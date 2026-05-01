/* =========================================================
   SIREN — charts.js (v2 — 실 데이터 연동)
   ========================================================= */
(function () {
  'use strict';

  const instances = {};

  const COLORS = {
    brand: '#7a1f2b',
    brandDeep: '#5a141d',
    gold: '#b8935a',
    ink: '#0f0f0f',
    success: '#1a8b46',
    warn: '#c47a00',
    danger: '#c5293a',
    info: '#1a5ec4',
    mute: '#888888',
  };

  const baseFont = {
    family: "'Noto Sans KR', 'Inter', sans-serif",
    size: 11,
  };

  /* ============ API 헬퍼 ============ */
  async function getJson(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      return await res.json();
    } catch (e) {
      console.error('[charts fetch]', url, e);
      return null;
    }
  }

  /* ============ 정적 더미 차트 (참고용 — 사용 안 함) ============ */
  function initDashboard() {
    /* charts.js v2는 항상 initDashboardWithData() 사용 */
    initDashboardWithData();
  }

  function initAI() {
    initAIWithData();
  }

  /* ============ 대시보드 차트 (실 데이터) ============ */
  async function initDashboardWithData() {
    if (typeof Chart === 'undefined') {
      console.warn('[Charts] Chart.js not loaded');
      return;
    }

    const data = await getJson('/api/admin/stats');
    if (!data || !data.ok || !data.data) {
      console.warn('[Charts] Stats API failed');
      return;
    }

    const monthly = data.data.monthlyDonations || { labels: [], values: [] };
    const dist = data.data.memberDistribution || {};

    /* 1-1. 월별 후원금 (Line) */
    const c1 = document.getElementById('chart1');
    if (c1) {
      if (instances.chart1) instances.chart1.destroy();
      instances.chart1 = new Chart(c1.getContext('2d'), {
        type: 'line',
        data: {
          labels: monthly.labels,
          datasets: [{
            label: '후원금 (백만원)',
            data: monthly.values,
            borderColor: COLORS.brand,
            backgroundColor: 'rgba(122,31,43,0.08)',
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: COLORS.brand,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f0f0f',
              titleFont: baseFont,
              bodyFont: baseFont,
              padding: 12,
              cornerRadius: 6,
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { font: baseFont, color: '#888' },
              grid: { color: '#f0eeeb' },
            },
            x: {
              ticks: { font: baseFont, color: '#888' },
              grid: { display: false },
            },
          },
        },
      });
    }

    /* 1-2. 회원 분포 (Doughnut) */
    const c2 = document.getElementById('chart2');
    if (c2) {
      if (instances.chart2) instances.chart2.destroy();
      const labels = ['정기후원', '유가족', '봉사자', '관리자', '기타'];
      const values = [
        dist.regular || 0,
        dist.family || 0,
        dist.volunteer || 0,
        dist.admin || 0,
        dist.onetime || 0,
      ];
      instances.chart2 = new Chart(c2.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: [
              COLORS.brand,
              COLORS.ink,
              COLORS.success,
              COLORS.warn,
              COLORS.mute,
            ],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                font: baseFont,
                color: '#525252',
                boxWidth: 12,
                padding: 10,
              },
            },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6,
              callbacks: {
                label: function (ctx) {
                  return ctx.label + ': ' + ctx.parsed.toLocaleString() + '명';
                },
              },
            },
          },
          cutout: '62%',
        },
      });
    }
  }

  /* ============ AI 추천 차트 (실 데이터) ============ */
  async function initAIWithData() {
    if (typeof Chart === 'undefined') return;

    const c3 = document.getElementById('chart3');
    if (!c3) return;

    const data = await getJson('/api/admin/ai/distribution');
    if (!data || !data.ok || !data.data) {
      console.warn('[Charts AI] API failed');
      return;
    }

    const labels = data.data.labels || ['안전', '관심필요', '위험', '이탈예측'];
    const values = data.data.values || [0, 0, 0, 0];

    if (instances.chart3) instances.chart3.destroy();
    instances.chart3 = new Chart(c3.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '회원 수',
          data: values,
          backgroundColor: [
            COLORS.success,
            COLORS.gold,
            COLORS.warn,
            COLORS.danger,
          ],
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f0f0f',
            padding: 12,
            cornerRadius: 6,
            callbacks: {
              label: function (ctx) {
                return ctx.parsed.y.toLocaleString() + '명';
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: baseFont, color: '#888' },
            grid: { color: '#f0eeeb' },
          },
          x: {
            ticks: { font: baseFont, color: '#525252' },
            grid: { display: false },
          },
        },
      },
    });
  }

  /* ============ 활동 보고서 차트 (사용자 페이지) ============ */
  async function initReport() {
    if (typeof Chart === 'undefined') return;

    /* 3-1. 월별 후원금 (Bar) - 공개 통계 API 가 따로 없으므로 admin/stats 시도 */
    const r1 = document.getElementById('reportChart1');
    if (r1 && !instances.reportChart1) {
      const data = await getJson('/api/admin/stats');
      const monthly = (data && data.data) ? data.data.monthlyDonations : null;
      const labels = monthly ? monthly.labels.slice(-4) : ['1월', '2월', '3월', '4월'];
      const values = monthly ? monthly.values.slice(-4) : [0, 0, 0, 0];

      instances.reportChart1 = new Chart(r1.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: '후원금 (백만원)',
            data: values,
            backgroundColor: COLORS.brand,
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6,
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { font: baseFont, color: '#888' },
              grid: { color: '#f0eeeb' },
            },
            x: {
              ticks: { font: baseFont, color: '#525252' },
              grid: { display: false },
            },
          },
        },
      });
    }

    /* 3-2. 집행 비율 (Doughnut) - 정적 (실제 회계 데이터는 STEP 12 이후) */
    const r2 = document.getElementById('reportChart2');
    if (r2 && !instances.reportChart2) {
      instances.reportChart2 = new Chart(r2.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['직접 지원', '추모 사업', '장학 사업', '운영비'],
          datasets: [{
            data: [58, 17, 15, 10],
            backgroundColor: [
              COLORS.brand,
              COLORS.gold,
              COLORS.ink,
              COLORS.mute,
            ],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                font: baseFont,
                color: '#525252',
                boxWidth: 12,
                padding: 10,
              },
            },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6,
              callbacks: {
                label: function (ctx) {
                  return ctx.label + ': ' + ctx.parsed + '%';
                },
              },
            },
          },
          cutout: '60%',
        },
      });
    }
  }

  /* ============ 정리 ============ */
  function destroyAll() {
    Object.keys(instances).forEach(function (key) {
      if (instances[key] && typeof instances[key].destroy === 'function') {
        instances[key].destroy();
      }
      delete instances[key];
    });
  }

  /* ============ 자동 초기화 (활동 보고서 페이지) ============ */
  function autoInitReport() {
    const target = document.getElementById('reportChart1');
    if (!target) return;
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          initReport();
          obs.disconnect();
        }
      });
    }, { threshold: 0.2 });
    obs.observe(target);
  }

  /* ============ 전역 노출 ============ */
  window.SIREN_CHARTS = {
    initDashboard: initDashboard,
    initDashboardWithData: initDashboardWithData,
    initAI: initAI,
    initAIWithData: initAIWithData,
    initReport: initReport,
    destroyAll: destroyAll,
  };

  /* ============ SIREN_PAGE_INIT 훅 ============ */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    autoInitReport();
  };
})();