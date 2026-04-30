/* =========================================================
   SIREN — home.js
   홈페이지 전용 인터랙션 (메인 슬라이더 / 카운터 / FAQ)
   ========================================================= */
(function () {
  'use strict';

  /* ------------ 1. Hero 슬라이더 ------------ */
  const HERO_SLIDES = [
    {
      title: `교사 유가족들의 <em>지원과 수사</em>,<br />
              모든 교사들의 <em>사회적 문제 해결</em>을 위해<br />
              싸이렌 홈페이지의 문을 열었습니다.`
    },
    {
      title: `<em>"기억의 약속"</em> 추모 주간이<br />
              4월 한 달간 진행되고 있습니다.<br />
              여러분의 동참을 기다립니다.`
    },
    {
      title: `투명한 회계, 정직한 동행.<br />
              <em>2025년 활동 보고서</em>가<br />
              지금 공개되었습니다.`
    }
  ];

  let slideIdx = 0;
  let slideTimer = null;

  function setSlide(i) {
    const titleEl = document.getElementById('heroTitle');
    const counterEl = document.getElementById('slideCounter');
    const dots = document.querySelectorAll('.slide-dot');
    if (!titleEl || !HERO_SLIDES[i]) return;

    slideIdx = i;
    titleEl.innerHTML = HERO_SLIDES[i].title;
    if (counterEl) {
      const cur = String(i + 1).padStart(2, '0');
      const total = String(HERO_SLIDES.length).padStart(2, '0');
      counterEl.textContent = `${cur} / ${total}`;
    }
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }

  function startSlideAuto() {
    stopSlideAuto();
    slideTimer = setInterval(() => {
      setSlide((slideIdx + 1) % HERO_SLIDES.length);
    }, 7000);
  }
  function stopSlideAuto() {
    if (slideTimer) clearInterval(slideTimer);
  }

  function setupSlider() {
    const dots = document.querySelectorAll('.slide-dot');
    if (!dots.length) return;

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        setSlide(i);
        startSlideAuto(); // 사용자가 누르면 타이머 리셋
      });
    });

    // 마우스 호버 시 일시정지
    const hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('mouseenter', stopSlideAuto);
      hero.addEventListener('mouseleave', startSlideAuto);
    }

    startSlideAuto();
  }

  /* ------------ 2. 통계 카운팅 애니메이션 ------------ */
  function animateCounters() {
    document.querySelectorAll('.stat-num').forEach(el => {
      const target = +el.dataset.target;
      const suf = el.dataset.suffix || '';
      if (!target || el.dataset.done) return;
      el.dataset.done = '1';

      let cur = 0;
      const dur = 1600;
      const step = target / (dur / 16);

      const timer = setInterval(() => {
        cur += step;
        if (cur >= target) {
          cur = target;
          clearInterval(timer);
        }
        el.innerHTML = Math.floor(cur).toLocaleString() + `<small>${suf}</small>`;
      }, 16);
    });
  }

  function setupCounterObserver() {
    const stats = document.querySelector('.stats');
    if (!stats) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          animateCounters();
          obs.disconnect();
        }
      });
    }, { threshold: 0.3 });

    obs.observe(stats);
  }

  /* ------------ 3. FAQ 아코디언 ------------ */
  function setupFAQ() {
    document.addEventListener('click', (e) => {
      const q = e.target.closest('.faq-q');
      if (!q) return;
      const item = q.parentElement;
      const isOpen = item.classList.contains('open');

      // 같은 그룹 내 다른 아이템 닫기 (선택사항)
      // item.parentElement.querySelectorAll('.faq-item.open').forEach(it => {
      //   if (it !== item) it.classList.remove('open');
      // });

      item.classList.toggle('open', !isOpen);
    });
  }

  /* ------------ 4. 진행률 게이지 애니메이션 ------------ */
  function setupProgressBar() {
    const bar = document.querySelector('.progress-bar');
    if (!bar) return;

    const target = bar.style.width || '68%';
    bar.style.width = '0%';

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          requestAnimationFrame(() => {
            bar.style.width = target;
          });
          obs.disconnect();
        }
      });
    }, { threshold: 0.4 });

    obs.observe(bar);
  }

  /* ------------ 5. 공지사항 클릭 ------------ */
  function setupNoticeList() {
    document.querySelectorAll('.notice-list li').forEach(li => {
      li.addEventListener('click', () => {
        const t = li.querySelector('.notice-title');
        if (t && window.SIREN) {
          SIREN.toast('공지사항 상세 페이지로 이동합니다');
        }
      });
    });
  }

  /* ------------ 6. 초기화 ------------ */
  function init() {
    setupSlider();
    setupCounterObserver();
    setupFAQ();
    setupProgressBar();
    setupNoticeList();
  }

  // common.js의 파셜 로드가 끝난 뒤 실행되도록 SIREN_PAGE_INIT 사용
  // (이미 다른 페이지 init 훅이 등록돼 있으면 합쳐서 실행)
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();