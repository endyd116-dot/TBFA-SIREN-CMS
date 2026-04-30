/* =========================================================
   SIREN — charts.js
   Chart.js 기반 데이터 시각화
   ========================================================= */
(function () {
  'use strict';

  // 차트 인스턴스 저장 (중복 생성 방지)
  const instances = {};

  /* ------------ 공통 옵션 ------------ */
  const COLORS = {
    brand: '#7a1f2b',
    brandDeep: '#5a141d',
    gold: '#b8935a',
    ink: '#0f0f0f',
    success: '#1a8b46',
    warn: '#c47a00',
    danger: '#c5293a',
    info: '#1a5ec4',
    mute: '#888888'
  };

  const baseFont = {
    family: "'Noto Sans KR', 'Inter', sans-serif",
    size: 11
  };

  /* ------------ 1. 대시보드 차트 ------------ */
  function initDashboard() {
    if (typeof Chart === 'undefined') {
      console.warn('[Charts] Chart.js not loaded');
      return;
    }

    // 1-1. 월별 후원금 추이 (Line)
    const c1 = document.getElementById('chart1');
    if (c1 && !instances.chart1) {
      instances.chart1 = new Chart(c1.getContext('2d'), {
        type: 'line',
        data: {
          labels: ['5월','6월','7월','8월','9월','10월','11월','12월','1월','2월','3월','4월'],
          datasets: [{
            label: '후원금 (백만원)',
            data: [18, 22, 24, 28, 32, 30, 35, 42, 38, 36, 38, 38.4],
            borderColor: COLORS.brand,
            backgroundColor: 'rgba(122,31,43,0.08)',
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: COLORS.brand,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            borderWidth: 2
          }]
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
              cornerRadius: 6
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { font: baseFont, color: '#888' },
              grid: { color: '#f0eeeb' }
            },
            x: {
              ticks: { font: baseFont, color: '#888' },
              grid: { display: false }
            }
          }
        }
      });
    }

    // 1-2. 회원 분포 (Doughnut)
    const c2 = document.getElementById('chart2');
    if (c2 && !instances.chart2) {
      instances.chart2 = new Chart(c2.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['정기후원', '일시후원', '유가족', '봉사자', '일반'],
          datasets: [{
            data: [3527, 2104, 128, 186, 2482],
            backgroundColor: [
              COLORS.brand,
              COLORS.gold,
              COLORS.ink,
              COLORS.brandDeep,
              COLORS.mute
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { font: baseFont, color: '#525252', boxWidth: 12, padding: 10 }
            },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6,
              callbacks: {
                label: (ctx) => `${ctx.label}: ${ctx.parsed.toLocaleString()}명`
              }
            }
          },
          cutout: '62%'
        }
      });
    }
  }

  /* ------------ 2. AI 페이지 차트 ------------ */
  function initAI() {
    if (typeof Chart === 'undefined') return;

    const c3 = document.getElementById('chart3');
    if (c3 && !instances.chart3) {
      instances.chart3 = new Chart(c3.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['안전', '관심필요', '위험', '이탈예측'],
          datasets: [{
            label: '회원 수',
            data: [2847, 468, 124, 12],
            backgroundColor: [
              COLORS.success,
              COLORS.gold,
              COLORS.warn,
              COLORS.danger
            ],
            borderRadius: 6,
            borderSkipped: false
          }]
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
                label: (ctx) => `${ctx.parsed.y.toLocaleString()}명`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { font: baseFont, color: '#888' },
              grid: { color: '#f0eeeb' }
            },
            x: {
              ticks: { font: baseFont, color: '#525252' },
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  /* ------------ 3. 활동 보고서 페이지 차트 ------------ */
  function initReport() {
    if (typeof Chart === 'undefined') return;

    // 3-1. 월별 후원금 (Bar)
    const r1 = document.getElementById('reportChart1');
    if (r1 && !instances.reportChart1) {
      instances.reportChart1 = new Chart(r1.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['1월', '2월', '3월', '4월'],
          datasets: [{
            label: '후원금 (백만원)',
            data: [36, 38, 38, 38.4],
            backgroundColor: COLORS.brand,
            borderRadius: 6,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { font: baseFont, color: '#888' },
              grid: { color: '#f0eeeb' }
            },
            x: {
              ticks: { font: baseFont, color: '#525252' },
              grid: { display: false }
            }
          }
        }
      });
    }

    // 3-2. 집행 비율 (Doughnut)
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
              COLORS.mute
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: baseFont, color: '#525252', boxWidth: 12, padding: 10 }
            },
            tooltip: {
              backgroundColor: '#0f0f0f',
              padding: 12,
              cornerRadius: 6,
              callbacks: {
                label: (ctx) => `${ctx.label}: ${ctx.parsed}%`
              }
            }
          },
          cutout: '60%'
        }
      });
    }
  }

  /* ------------ 4. 차트 정리 (페이지 이탈 시) ------------ */
  function destroyAll() {
    Object.keys(instances).forEach(key => {
      if (instances[key] && typeof instances[key].destroy === 'function') {
        instances[key].destroy();
      }
      delete instances[key];
    });
  }

  /* ------------ 5. 자동 초기화 (활동 보고서 페이지) ------------ */
  function autoInitReport() {
    // 페이지에 reportChart1이 있으면 IntersectionObserver로 가시성 진입 시 초기화
    const target = document.getElementById('reportChart1');
    if (!target) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          initReport();
          obs.disconnect();
        }
      });
    }, { threshold: 0.2 });
    obs.observe(target);
  }

  /* ------------ 6. 전역 노출 ------------ */
  window.SIREN_CHARTS = {
    initDashboard,
    initAI,
    initReport,
    destroyAll
  };

  /* ------------ 7. 초기화 ------------ */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    autoInitReport();
  };
})();