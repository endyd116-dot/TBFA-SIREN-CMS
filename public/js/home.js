/* =========================================================
   SIREN — home.js (★ Phase B: 통계 API 연동)
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
        startSlideAuto();
      });
    });

    const hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('mouseenter', stopSlideAuto);
      hero.addEventListener('mouseleave', startSlideAuto);
    }

    startSlideAuto();
  }

  /* ------------ 2-A. ★ Phase B: 공개 통계 API에서 값 가져와 data-target 갱신 ------------ */
  async function fetchAndApplyStats() {
    try {
      const previewParam = new URLSearchParams(location.search).get('preview') === '1' ? '?preview=1' : '';
      const res = await fetch('/api/public/stats' + previewParam, { credentials: 'include' });
      if (!res.ok) {
        console.warn('[home.js] /api/public/stats 응답 실패:', res.status);
        return;
      }
      const json = await res.json();
      if (!json.ok || !json.data) return;

      const d = json.data;

      /* ★ HTML의 data-stat-key 속성을 가진 요소에 값 매핑 */
      const mapping = {
        'donations.totalAmount': d.donations?.totalAmount,
        'support.totalCount': d.support?.totalCount,
        'members.regularDonors': d.members?.regularDonors,
        'members.volunteers': d.members?.volunteers,
        'distribution.directSupport': d.distribution?.directSupport,
        'distribution.memorial': d.distribution?.memorial,
        'distribution.scholarship': d.distribution?.scholarship,
        'distribution.operation': d.distribution?.operation,
        'transparency.grade': d.transparency?.grade,
      };

      Object.keys(mapping).forEach((key) => {
        const value = mapping[key];
        if (value === undefined || value === null) return;
        const els = document.querySelectorAll('[data-stat-key="' + key + '"]');
        els.forEach((el) => {
          /* 숫자형: data-target 갱신 (counter 애니메이션 대상) */
          if (el.classList.contains('stat-num')) {
            el.dataset.target = String(value);
            el.dataset.done = ''; // 카운팅 다시 실행되도록 리셋
          } else {
            /* 텍스트형: 직접 textContent 갱신 (예: 투명성 등급 "A+") */
            el.textContent = String(value);
          }
        });
      });

      /* ★ totalAmount는 별도 처리 (만원 단위 변환 가능성) */
      const totalAmtEls = document.querySelectorAll('[data-stat-key="donations.totalAmount"]');
      totalAmtEls.forEach((el) => {
        if (el.classList.contains('stat-num')) {
          /* 만원 단위로 표시되도록 (예: 128300000 → 12830) */
          const manwon = Math.floor(Number(d.donations?.totalAmount || 0) / 10000);
          el.dataset.target = String(manwon);
          el.dataset.done = '';
          /* suffix가 '만원'이 아니면 강제 설정 */
          if (!el.dataset.suffix) el.dataset.suffix = '만원';
        }
      });

      console.log('[home.js] 통계 API 값 적용 완료', json.data._meta);
    } catch (e) {
      console.warn('[home.js] 통계 fetch 실패, HTML 하드코딩 값 사용', e);
    }
  }

  /* ------------ 2-B. 통계 카운팅 애니메이션 ------------ */
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
  async function init() {
    setupSlider();
    /* ★ Phase B: API 값 먼저 적용한 뒤 카운터 옵저버 설정 */
    await fetchAndApplyStats();
    setupCounterObserver();
    setupFAQ();
    setupProgressBar();
    setupNoticeList();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();/* =========================================================
   SIREN — home.js  (Phase B Step 6-C — 메인 콘텐츠 API 연동)
   홈페이지 전용 인터랙션
   ========================================================= */
(function () {
  'use strict';

  /* ------------ 1. Hero 슬라이더 (기본값 — API 응답으로 덮어씀) ------------ */
  let HERO_SLIDES = [
    { title: `교사 유가족들의 <em>지원과 수사</em>,<br />모든 교사들의 <em>사회적 문제 해결</em>을 위해<br />싸이렌 홈페이지의 문을 열었습니다.` },
    { title: `<em>"기억의 약속"</em> 추모 주간이<br />4월 한 달간 진행되고 있습니다.<br />여러분의 동참을 기다립니다.` },
    { title: `투명한 회계, 정직한 동행.<br /><em>2025년 활동 보고서</em>가<br />지금 공개되었습니다.` }
  ];

  let slideIdx = 0;
  let slideTimer = null;
  let _autoplaySpeed = 7000;
  let _autoplayEnabled = true;

  function setSlide(i) {
    const titleEl = document.getElementById('heroTitle');
    const counterEl = document.getElementById('slideCounter');
    let dots = document.querySelectorAll('.slide-dot');
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
    if (!_autoplayEnabled) return;
    slideTimer = setInterval(() => {
      setSlide((slideIdx + 1) % HERO_SLIDES.length);
    }, _autoplaySpeed);
  }
  function stopSlideAuto() {
    if (slideTimer) clearInterval(slideTimer);
  }

  /* slide-dot DOM을 슬라이드 개수에 맞게 다시 생성 */
  function rebuildSlideDots() {
    const wrap = document.querySelector('.slide-dots');
    if (!wrap) return;
    wrap.innerHTML = HERO_SLIDES.map((_, i) =>
      `<span class="slide-dot${i === 0 ? ' on' : ''}"></span>`
    ).join('');

    /* 새 dot 이벤트 바인딩 */
    document.querySelectorAll('.slide-dot').forEach((dot, i) => {
      dot.addEventListener('click', () => {
        setSlide(i);
        startSlideAuto();
      });
    });
  }

  function setupSlider() {
    rebuildSlideDots();
    setSlide(0);

    const hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('mouseenter', stopSlideAuto);
      hero.addEventListener('mouseleave', startSlideAuto);
    }
    startSlideAuto();
  }

  /* ------------ 2. 통계 API 연동 (v10 유지) ------------ */
  async function fetchAndApplyStats() {
    try {
      const previewParam = new URLSearchParams(location.search).get('preview') === '1' ? '?preview=1' : '';
      const res = await fetch('/api/public/stats' + previewParam, { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.ok || !json.data) return;
      const d = json.data;

      const mapping = {
        'donations.totalAmount': d.donations?.totalAmount,
        'support.totalCount': d.support?.totalCount,
        'members.regularDonors': d.members?.regularDonors,
        'members.volunteers': d.members?.volunteers,
        'distribution.directSupport': d.distribution?.directSupport,
        'distribution.memorial': d.distribution?.memorial,
        'distribution.scholarship': d.distribution?.scholarship,
        'distribution.operation': d.distribution?.operation,
        'transparency.grade': d.transparency?.grade,
      };

      Object.keys(mapping).forEach((key) => {
        const value = mapping[key];
        if (value === undefined || value === null) return;
        const els = document.querySelectorAll('[data-stat-key="' + key + '"]');
        els.forEach((el) => {
          if (el.classList.contains('stat-num')) {
            el.dataset.target = String(value);
            el.dataset.done = '';
          } else {
            el.textContent = String(value);
          }
        });
      });

      const totalAmtEls = document.querySelectorAll('[data-stat-key="donations.totalAmount"]');
      totalAmtEls.forEach((el) => {
        if (el.classList.contains('stat-num')) {
          const manwon = Math.floor(Number(d.donations?.totalAmount || 0) / 10000);
          el.dataset.target = String(manwon);
          el.dataset.done = '';
          if (!el.dataset.suffix) el.dataset.suffix = '만원';
        }
      });

      console.log('[home.js] 통계 API 값 적용 완료', json.data._meta);
    } catch (e) {
      console.warn('[home.js] 통계 fetch 실패', e);
    }
  }

  /* ------------ ★ Step 6-C: 메인 콘텐츠 API 연동 ------------ */
  async function fetchAndApplyHomeContent() {
    try {
      const previewParam = new URLSearchParams(location.search).get('preview') === '1' ? '?preview=1' : '';
      const res = await fetch('/api/public/home-content' + previewParam, { credentials: 'include' });
      if (!res.ok) {
        console.warn('[home.js] /api/public/home-content 응답 실패:', res.status);
        return;
      }
      const json = await res.json();
      if (!json.ok || !json.data) return;

      const d = json.data;
      console.log('[home.js] 메인 콘텐츠 API 적용', json._meta);
        /* ---- 퀵메뉴 박스 1개 HTML 생성 ---- */
  function renderQuickItem(item) {
    const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const isSiren = !!item.isSirenGroup;
    const cls = 'quick-item' + (isSiren ? ' siren-item' : '');
    const sirenBadge = isSiren ? '<span class="siren-badge">SIREN</span>' : '';
    const icon = escHtml(item.icon || '');
    const label = escHtml(item.label || '');

    /* 모달 vs 링크 */
    if (item.opensModal) {
      return `<div class="${cls}" data-action="open-modal" data-target="${escHtml(item.opensModal)}" style="cursor:pointer">
        ${sirenBadge}
        <span class="qi-arrow"></span>
        <div class="qi-icon">${icon}</div>
        <div class="qi-label">${label}</div>
      </div>`;
    }
    return `<a class="${cls}" href="${escHtml(item.href || '#')}">
      ${sirenBadge}
      <span class="qi-arrow"></span>
      <div class="qi-icon">${icon}</div>
      <div class="qi-label">${label}</div>
    </a>`;
  }

      /* ---- 2-1. HERO ---- */
      if (d.hero) {
        /* 슬라이드 배열 갱신 */
        if (Array.isArray(d.hero.slides) && d.hero.slides.length > 0) {
          const active = d.hero.slides.filter((s) => s.isActive !== false);
          if (active.length > 0) {
            HERO_SLIDES = active.map((s) => ({ title: s.title || '' }));
            rebuildSlideDots();
            setSlide(0);
          }
        }
        /* eyebrow 라벨 */
        if (d.hero.eyebrow) {
          const el = document.querySelector('.hero-eyebrow');
          if (el) {
            const dot = el.querySelector('.dot');
            const dotHtml = dot ? dot.outerHTML : '<span class="dot"></span>';
            el.innerHTML = dotHtml + d.hero.eyebrow;
          }
        }
        /* lead 본문 */
        if (d.hero.lead) {
          const el = document.querySelector('.hero p.lead');
          if (el) el.textContent = d.hero.lead;
        }
        /* 자동재생 속도/켜기 */
        if (typeof d.hero.autoplaySpeed === 'number' && d.hero.autoplaySpeed > 0) {
          _autoplaySpeed = d.hero.autoplaySpeed * 1000;
        }
        if (typeof d.hero.autoplayEnabled === 'boolean') {
          _autoplayEnabled = d.hero.autoplayEnabled;
        }
        startSlideAuto();
      }

      /* ---- 2-2. 퀵메뉴 영역 표시/숨김 + 6개 박스 동적 렌더 ---- */
      if (d.quickMenu) {
        const wrapEl = document.querySelector('.quick-wrap');
        const gridEl = document.querySelector('.quick-grid');

        /* 영역 자체 표시/숨김 */
        if (wrapEl && typeof d.quickMenu.sectionVisible === 'boolean') {
          wrapEl.style.display = d.quickMenu.sectionVisible ? '' : 'none';
        }

        /* 박스 N개 동적 렌더 */
        if (gridEl && Array.isArray(d.quickMenu.items)) {
          const activeItems = d.quickMenu.items
            .filter((it) => it && it.isActive !== false)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

          if (activeItems.length > 0) {
            gridEl.innerHTML = activeItems.map(renderQuickItem).join('');
          }
        }
      }

      /* ---- 2-3. 캠페인 영역 제목/부제/표시 ---- */
      if (d.campaign) {
        const sec = document.getElementById('homeCampaignSection');
        if (sec) {
          /* sectionVisible=false면 home-campaigns.js와 무관하게 숨김 */
          if (d.campaign.sectionVisible === false) {
            sec.style.display = 'none';
          }
          /* 제목 */
          if (d.campaign.title) {
            const titleEl = sec.querySelector('.sec-head .sec-title');
            if (titleEl) titleEl.textContent = d.campaign.title;
          }
          /* 부제 — 첫 번째 p 태그 */
          if (d.campaign.subtitle) {
            const subEl = sec.querySelector('p');
            if (subEl) subEl.innerHTML = String(d.campaign.subtitle).replace(/\n/g, '<br />');
          }
        }
      }

      /* ---- 2-4. 공지 영역 제목/표시 ---- */
      if (d.notice) {
        const noticeBlock = document.querySelector('.info-grid > div:first-child');
        if (noticeBlock) {
          if (d.notice.sectionVisible === false) noticeBlock.style.display = 'none';
          if (d.notice.title) {
            const t = noticeBlock.querySelector('.sec-head .sec-title');
            if (t) t.textContent = d.notice.title;
          }
        }
      }

      /* ---- 2-5. FAQ 영역 제목/표시 ---- */
      if (d.faq) {
        const faqBlock = document.querySelector('.info-grid > div:last-child');
        if (faqBlock) {
          if (d.faq.sectionVisible === false) faqBlock.style.display = 'none';
          if (d.faq.title) {
            const t = faqBlock.querySelector('.sec-head .sec-title');
            if (t) t.textContent = d.faq.title;
          }
        }
      }

      /* ---- 2-6. 특별 캠페인 배너 ---- */
      if (d.specialBanner) {
        const camp = document.querySelector('.campaign');
        if (camp) {
          if (d.specialBanner.visible === false) {
            camp.parentElement?.parentElement?.style && (camp.parentElement.parentElement.style.display = 'none');
          }
          /* 태그 */
          if (d.specialBanner.tag) {
            const tagEl = camp.querySelector('.camp-tag');
            if (tagEl) tagEl.textContent = d.specialBanner.tag;
          }
          /* 제목 */
          if (d.specialBanner.title) {
            const h3 = camp.querySelector('h3');
            if (h3) h3.innerHTML = d.specialBanner.title;
          }
          /* 본문 */
          if (d.specialBanner.lead) {
            const lead = camp.querySelector('p.lead');
            if (lead) lead.textContent = d.specialBanner.lead;
          }
          /* 모금 진행률 */
          const goal = Number(d.specialBanner.goalAmount || 0);
          const raised = Number(d.specialBanner.raisedAmount || 0);
          if (goal > 0) {
            const pct = Math.min(100, Math.round((raised / goal) * 100));
            const bar = camp.querySelector('.progress-bar');
            if (bar) bar.style.width = pct + '%';
            const stats = camp.querySelector('.progress-stats');
            if (stats) {
              stats.innerHTML = `
                <span>모금 진행률 <strong>${pct}%</strong></span>
                <span>목표 <strong>${goal.toLocaleString()}원</strong> 중 <strong>${raised.toLocaleString()}원</strong></span>
              `;
            }
          }
        }
      }

      /* ---- 2-7. 효과 속도 (CSS 변수 + 모듈 변수) ---- */
      if (d.effects) {
        if (typeof d.effects.counterDuration === 'number') {
          window.__SIREN_COUNTER_DURATION__ = d.effects.counterDuration;
        }
        if (typeof d.effects.progressBarDuration === 'number') {
          document.documentElement.style.setProperty(
            '--progress-bar-duration', d.effects.progressBarDuration + 'ms'
          );
        }
        if (d.effects.sirenPulseEnabled === false) {
          /* 사이렌 펄스 끄기 */
          document.querySelectorAll('.siren-icon, .siren-badge').forEach((el) => {
            el.style.animation = 'none';
          });
        }
      }
    } catch (e) {
      console.warn('[home.js] 메인 콘텐츠 fetch 실패, 정적 폴백 사용', e);
    }
  }

  /* ------------ 3. 통계 카운팅 애니메이션 ------------ */
  function animateCounters() {
    const dur = window.__SIREN_COUNTER_DURATION__ || 1600;
    document.querySelectorAll('.stat-num').forEach(el => {
      const target = +el.dataset.target;
      const suf = el.dataset.suffix || '';
      if (!target || el.dataset.done) return;
      el.dataset.done = '1';

      let cur = 0;
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

  /* ------------ 4. FAQ 아코디언 ------------ */
  function setupFAQ() {
    document.addEventListener('click', (e) => {
      const q = e.target.closest('.faq-q');
      if (!q) return;
      const item = q.parentElement;
      const isOpen = item.classList.contains('open');
      item.classList.toggle('open', !isOpen);
    });
  }

  /* ------------ 5. 진행률 게이지 애니메이션 ------------ */
  function setupProgressBar() {
    const bar = document.querySelector('.progress-bar');
    if (!bar) return;
    const target = bar.style.width || '68%';
    bar.style.width = '0%';

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          requestAnimationFrame(() => { bar.style.width = target; });
          obs.disconnect();
        }
      });
    }, { threshold: 0.4 });

    obs.observe(bar);
  }

  /* ------------ 6. 공지사항 클릭 ------------ */
  function setupNoticeList() {
    document.querySelectorAll('.notice-list li').forEach(li => {
      li.addEventListener('click', () => {
        const t = li.querySelector('.notice-title');
        if (t && window.SIREN) SIREN.toast('공지사항 상세 페이지로 이동합니다');
      });
    });
  }

  /* ------------ 7. 초기화 ------------ */
  async function init() {
    /* 슬라이더는 기본값으로 먼저 작동시키고, API 응답이 오면 갱신 */
    setupSlider();

    /* 통계 + 메인 콘텐츠를 병렬로 가져오기 */
    await Promise.all([
      fetchAndApplyStats(),
      fetchAndApplyHomeContent(),
    ]);

    setupCounterObserver();
    setupFAQ();
    setupProgressBar();
    setupNoticeList();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();
    init();
  };
})();