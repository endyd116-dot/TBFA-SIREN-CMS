/* =========================================================
   SIREN — news.js (K-5 공지/FAQ 동적 로드)
   - /api/notices: 페이징, 카테고리 필터, 상세 모달 + 조회수
   - /api/faqs:    카테고리별 그룹, 아코디언 펼치기/닫기
   ========================================================= */
(function () {
  'use strict';

  /* ============ 상수 ============ */
  const NOTICE_LIMIT = 10;

  let _currentCategory = '';
  let _currentPage = 1;
  let _totalPages = 1;

  /* 분류는 운영자가 백오피스에서 만들고 지운다 — 목록을 받아와서 탭과 배지를 그린다.
     못 받아오면 '일반공지' 하나만 있는 것으로 보고 화면은 계속 뜨게 한다. */
  let _categories = [];

  function categoryLabel(slug) {
    const c = _categories.find((x) => x.slug === slug);
    return c ? c.label : (slug === 'general' ? '일반공지' : slug);
  }

  function categoryBadge(slug) {
    const c = _categories.find((x) => x.slug === slug);
    const color = c ? c.color : 'mute';
    return '<span class="badge b-' + escapeHtml(color) + '">' + escapeHtml(categoryLabel(slug)) + '</span>';
  }

  /* ============ 헬퍼 ============ */
  async function fetchJson(path) {
    try {
      const res = await fetch(path, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (err) {
      console.error('[news fetch]', path, err);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  /* ============ 분류 탭 로드 ============ */
  async function loadCategories() {
    const tabs = document.getElementById('newsTabs');
    if (!tabs) return;

    const res = await fetchJson('/api/notice-categories');
    const list = (res.ok && res.data?.data?.list) || [];
    _categories = list;
    if (list.length === 0) return;   // 못 받아오면 HTML 에 있던 '전체' 탭만 남긴다

    tabs.innerHTML =
      '<button type="button" class="tab-btn' + (_currentCategory ? '' : ' on') + '" data-cat="">전체</button>' +
      list.map((c) =>
        '<button type="button" class="tab-btn' + (_currentCategory === c.slug ? ' on' : '') +
        '" data-cat="' + escapeHtml(c.slug) + '">' + escapeHtml(c.label) + '</button>'
      ).join('');
  }

  /* ============ 공지사항 목록 로드 ============ */
  async function loadNotices() {
    const tbody = document.getElementById('newsTableBody');
    if (!tbody) return;

    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;padding:60px;color:var(--text-3);font-size:13px">공지사항을 불러오는 중...</td></tr>';

    const params = new URLSearchParams();
    params.set('page', String(_currentPage));
    params.set('limit', String(NOTICE_LIMIT));
    if (_currentCategory) params.set('category', _currentCategory);

    const res = await fetchJson('/api/notices?' + params.toString());

    if (!res.ok || !res.data?.data) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;padding:60px;color:var(--danger);font-size:13px">공지사항을 불러오지 못했습니다</td></tr>';
      hidePagination();
      return;
    }

    const list = res.data.data.list || [];
    const pagination = res.data.data.pagination || {};
    _totalPages = pagination.totalPages || 1;

    if (list.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;padding:60px;color:var(--text-3);font-size:13px">' +
        (_currentCategory ? '해당 분류의 공지사항이 없습니다' : '등록된 공지사항이 없습니다') +
        '</td></tr>';
      hidePagination();
      return;
    }

    /* 행 렌더 — 번호는 목록에 보이는 자리 그대로 1, 2, 3 …
       (예전엔 저장소 내부 번호를 그대로 찍어 5번·10번처럼 띄엄띄엄 보였다) */
    const startNo = (_currentPage - 1) * NOTICE_LIMIT;
    tbody.innerHTML = list.map((n, i) => {
      const no = n.displayNo || (startNo + i + 1);
      const pinMark = n.isPinned ? '<span class="news-pin">고정</span>' : '';
      const date = formatDate(n.publishedAt || n.createdAt);
      const views = (n.views || 0).toLocaleString();
      return '<tr data-news-id="' + n.id + '">' +
        '<td>' + no + '</td>' +
        '<td>' + categoryBadge(n.category) + '</td>' +
        '<td>' + pinMark + escapeHtml(n.title) + '</td>' +
        '<td>' + date + '</td>' +
        '<td>' + views + '</td>' +
        '</tr>';
    }).join('');

    /* 페이지네이션 */
    renderPagination();
  }

  /* ============ 페이지네이션 렌더 ============ */
  function renderPagination() {
    const box = document.getElementById('newsPagination');
    if (!box) return;

    if (_totalPages <= 1) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    box.style.display = 'flex';

    /* 표시할 페이지 번호 계산 (현재 ± 2개) */
    const maxButtons = 5;
    let start = Math.max(1, _currentPage - 2);
    let end = Math.min(_totalPages, start + maxButtons - 1);
    if (end - start < maxButtons - 1) {
      start = Math.max(1, end - maxButtons + 1);
    }

    let html = '';
    /* 처음 */
    html += '<button type="button" data-news-page="1" ' + (_currentPage === 1 ? 'disabled' : '') + '>«</button>';
    /* 이전 */
    html += '<button type="button" data-news-page="' + (_currentPage - 1) + '" ' + (_currentPage <= 1 ? 'disabled' : '') + '>‹</button>';
    /* 번호들 */
    for (let i = start; i <= end; i++) {
      html += '<button type="button" data-news-page="' + i + '" class="' + (i === _currentPage ? 'active' : '') + '">' + i + '</button>';
    }
    /* 다음 */
    html += '<button type="button" data-news-page="' + (_currentPage + 1) + '" ' + (_currentPage >= _totalPages ? 'disabled' : '') + '>›</button>';
    /* 마지막 */
    html += '<button type="button" data-news-page="' + _totalPages + '" ' + (_currentPage === _totalPages ? 'disabled' : '') + '>»</button>';

    box.innerHTML = html;
  }

  function hidePagination() {
    const box = document.getElementById('newsPagination');
    if (box) {
      box.style.display = 'none';
      box.innerHTML = '';
    }
  }

  /* ============ 공지 상세 모달 ============ */
  async function openNoticeDetail(id) {
    const modal = document.getElementById('noticeViewModal');
    if (!modal) return;

    const titleEl = document.getElementById('nvTitle');
    const metaEl = document.getElementById('nvMeta');
    const bodyEl = document.getElementById('nvBody');

    if (titleEl) titleEl.textContent = '불러오는 중...';
    if (metaEl) metaEl.textContent = '—';
    if (bodyEl) bodyEl.innerHTML = '<div class="nv-loading">잠시만 기다려 주세요...</div>';

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    const res = await fetchJson('/api/notices?id=' + id);

    if (!res.ok || !res.data?.data?.notice) {
      if (bodyEl) bodyEl.innerHTML = '<div class="nv-loading" style="color:var(--danger)">공지를 불러오지 못했습니다</div>';
      return;
    }

    const n = res.data.data.notice;
    if (titleEl) titleEl.textContent = (n.isPinned ? '' : '') + n.title;
    if (metaEl) {
      metaEl.innerHTML =
        categoryBadge(n.category) + ' · ' +
        '<span style="font-family:Inter">' + formatDateTime(n.publishedAt || n.createdAt) + '</span>' +
        ' · 조회 ' + (n.views || 0).toLocaleString() +
        (n.authorName ? ' · ' + escapeHtml(n.authorName) : '');
    }
    /* 본문은 HTML 그대로 출력 (관리자가 작성한 신뢰 가능한 콘텐츠) */
    if (bodyEl) bodyEl.innerHTML = n.content || '<div class="nv-loading">본문이 비어 있습니다</div>';
  }

  function closeNoticeDetail() {
    const modal = document.getElementById('noticeViewModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  /* ============ FAQ 로드 ============ */
  async function loadFaqs() {
    const container = document.getElementById('faqContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">FAQ를 불러오는 중...</div>';

    const res = await fetchJson('/api/faqs');

    if (!res.ok || !res.data?.data) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);font-size:13px">FAQ를 불러오지 못했습니다</div>';
      return;
    }

    const list = res.data.data.list || [];
    if (list.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">등록된 FAQ가 없습니다</div>';
      return;
    }

    container.innerHTML = list.map((f) => {
      return '<div class="faq-item" data-faq-id="' + f.id + '">' +
        '<div class="faq-q"><span class="q-mark">Q</span>' + escapeHtml(f.question) + '<span class="arrow">▼</span></div>' +
        '<div class="faq-a"><div class="faq-a-inner">' + (f.answer || '') + '</div></div>' +
        '</div>';
    }).join('');
  }

  /* ============ 이벤트 위임 ============ */
  function setupEvents() {
    /* 카테고리 탭 클릭 */
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('#newsTabs .tab-btn');
      if (tab) {
        e.preventDefault();
        const cat = tab.dataset.cat || '';
        if (cat === _currentCategory) return;
        _currentCategory = cat;
        _currentPage = 1;
        /* on 클래스 갱신 */
        document.querySelectorAll('#newsTabs .tab-btn').forEach((b) => b.classList.remove('on'));
        tab.classList.add('on');
        loadNotices();
        return;
      }

      /* 페이지네이션 클릭 */
      const pageBtn = e.target.closest('[data-news-page]');
      if (pageBtn) {
        e.preventDefault();
        if (pageBtn.disabled) return;
        const newPage = Number(pageBtn.dataset.newsPage);
        if (!Number.isFinite(newPage) || newPage === _currentPage) return;
        if (newPage < 1 || newPage > _totalPages) return;
        _currentPage = newPage;
        loadNotices();
        /* 표 상단으로 스크롤 */
        const tbl = document.querySelector('.news-table');
        if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      /* 공지 행 클릭 → 상세 모달 */
      const row = e.target.closest('[data-news-id]');
      if (row) {
        const id = Number(row.dataset.newsId);
        if (id) openNoticeDetail(id);
        return;
      }

      /* 공지 상세 모달 닫기 */
      if (e.target.closest('[data-nv-close]')) {
        closeNoticeDetail();
        return;
      }
      /* 모달 배경 클릭 */
      if (e.target.id === 'noticeViewModal') {
        closeNoticeDetail();
        return;
      }

      /* FAQ 아코디언 토글 */
      const faqQ = e.target.closest('.faq-item .faq-q');
      if (faqQ) {
        const item = faqQ.parentElement;
        if (item) item.classList.toggle('on');
        return;
      }
    });

    /* ESC 키로 모달 닫기 */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('noticeViewModal');
        if (modal && modal.classList.contains('show')) {
          closeNoticeDetail();
        }
      }
    });
  }

  /* ============ URL 해시 처리 (#media 등) ============ */
  function applyHashFilter() {
    const hash = (location.hash || '').replace('#', '').trim();
    if (!hash) return;

    /* news.html#media → 언론보도 탭 자동 활성화 */
    const tab = document.querySelector('#newsTabs .tab-btn[data-cat="' + hash + '"]');
    if (tab) {
      document.querySelectorAll('#newsTabs .tab-btn').forEach((b) => b.classList.remove('on'));
      tab.classList.add('on');
      _currentCategory = hash;
    }

    /* news.html#faq → FAQ 섹션으로 스크롤 */
    if (hash === 'faq') {
      setTimeout(() => {
        const faqEl = document.getElementById('faq');
        if (faqEl) faqEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  }

  /* ============ 초기화 ============ */
  let _initExecuted = false;

  async function init() {
    if (_initExecuted) return;
    /* news = 소식/참여(혼합 화면), notice = 공지사항 전용 화면 */
    const page = document.body.dataset.page;
    if (page !== 'news' && page !== 'notice') return;
    _initExecuted = true;

    setupEvents();

    /* 분류 탭을 먼저 받아야 주소 뒤 #분류 로 들어온 요청을 알아볼 수 있다 */
    await loadCategories();
    applyHashFilter();
    if (_currentCategory) await loadCategories();   // 해시로 고른 탭에 표시 반영

    /* 공지 목록 — FAQ 는 소식/참여 화면에만 있다 */
    await Promise.all([loadNotices(), page === 'news' ? loadFaqs() : Promise.resolve()]);
  }

  /* 3가지 경로로 init 보장 (auth.js 패턴 유지) */
  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  document.addEventListener('partials:loaded', () => init());

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }
})();