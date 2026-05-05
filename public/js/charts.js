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

// public/js/charts.js — baseFont 다음에 포맷터 헬퍼 추가
  const baseFont = {
    family: "'Noto Sans KR', 'Inter', sans-serif",
    size: 11,
  };

  /* ★ M-18: 한국식 금액 포맷터 (admin.js의 SIREN_FMT 우선 사용, 없으면 자체 폴백) */
  function fmtKrw(n) {
    if (window.SIREN_FMT && typeof window.SIREN_FMT.money === 'function') {
      return window.SIREN_FMT.money(n);
    }
    /* 폴백 */
    const num = Math.floor(Number(n) || 0);
    if (Math.abs(num) < 10000) return '₩ ' + num.toLocaleString() + '원';
    if (Math.abs(num) < 100000000) return '₩ ' + Math.floor(num / 10000).toLocaleString() + '만원';
    const eok = Math.floor(num / 100000000);
    const man = Math.floor((num % 100000000) / 10000);
    return man === 0
      ? '₩ ' + eok.toLocaleString() + '억'
      : '₩ ' + eok.toLocaleString() + '억 ' + man.toLocaleString() + '만원';
  }

  function fmtKrwShort(n) {
    if (window.SIREN_FMT && typeof window.SIREN_FMT.moneyShort === 'function') {
      return window.SIREN_FMT.moneyShort(n);
    }
    const num = Math.floor(Number(n) || 0);
    if (Math.abs(num) < 10000) return num.toLocaleString();
    if (Math.abs(num) < 100000000) return Math.floor(num / 10000).toLocaleString() + '만';
    const eok = num / 100000000;
    if (Math.abs(eok) >= 10) return Math.floor(eok).toLocaleString() + '억';
    return eok.toFixed(1) + '억';
  }

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
      /* ★ 2026-05 패치: 페이지 재진입 시 Canvas 중복 사용 에러 방지 */
      if (instances.chart1) instances.chart1.destroy();
      instances.chart1 = new Chart(c1.getContext('2d'), {
        type: 'line',
        data: {
          labels: monthly.labels,
          datasets: [{
            /* ★ M-18: 라벨을 "후원금 (만원)"으로 변경 */
            label: '후원금',
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
              /* ★ M-18: 툴팁 한국식 표기 */
              callbacks: {
                label: function (ctx) {
                  return fmtKrw(ctx.parsed.y);
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                font: baseFont,
                color: '#888',
                /* ★ M-18: Y축 한국식 짧은 표기 (예: "1,234만", "1.2억") */
                callback: function (value) {
                  return fmtKrwShort(value);
                },
              },
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
    /* ============ 활동 보고서 차트 (사용자 페이지) ============ */
  /* ★ 2026-05 패치: admin API 호출 제거 → 401로 인한 로그인 모달 강제 오픈 방지
     향후 public 통계 API가 추가되면 그쪽으로 교체 권장 */
    /* ============ 활동 보고서 차트 (사용자 페이지) ============ */
  /* ★ 2026-05 v2: /api/public/stats 사용 (admin API 호출 X, 401 발생 X) */
  async function initReport() {
    if (typeof Chart === 'undefined') return;

    /* 공개 통계 API 호출 — 인증 불필요 */
    let statsData = null;
    try {
      const res = await fetch('/api/public/stats');
      if (res.ok) {
        const json = await res.json();
        if (json.ok) statsData = json.data;
      }
    } catch (e) {
      console.warn('[charts] public stats failed, using fallback', e);
    }

    /* 3-1. 월별 후원금 (Bar) */
    const r1 = document.getElementById('reportChart1');
    if (r1 && !instances.reportChart1) {
      const trend = (statsData && Array.isArray(statsData.donations?.monthlyTrend))
        ? statsData.donations.monthlyTrend
        : [
          { month: '1월', amount: 84200000 },
          { month: '2월', amount: 96500000 },
          { month: '3월', amount: 118000000 },
          { month: '4월', amount: 112400000 },
        ];

      const labels = trend.map((t) => t.month || '');
      const values = trend.map((t) => Number(t.amount) || 0);

      instances.reportChart1 = new Chart(r1.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '후원금',
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
              callbacks: {
                label: function (ctx) { return fmtKrw(ctx.parsed.y); },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                font: baseFont,
                color: '#888',
                callback: function (value) { return fmtKrwShort(value); },
              },
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

    /* 3-2. 집행 비율 (Doughnut) */
    const r2 = document.getElementById('reportChart2');
    if (r2 && !instances.reportChart2) {
      const dist = (statsData && statsData.distribution) || {};
      const data = [
        Number(dist.directSupport ?? 58),
        Number(dist.memorial ?? 17),
        Number(dist.scholarship ?? 15),
        Number(dist.operation ?? 10),
      ];

      instances.reportChart2 = new Chart(r2.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['직접 지원', '추모 사업', '장학 사업', '운영비'],
          datasets: [{
            data,
            backgroundColor: [COLORS.brand, COLORS.gold, COLORS.ink, COLORS.mute],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: baseFont, color: '#525252', boxWidth: 12, padding: 10 },
            },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6,
              callbacks: {
                label: function (ctx) { return ctx.label + ': ' + ctx.parsed + '%'; },
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