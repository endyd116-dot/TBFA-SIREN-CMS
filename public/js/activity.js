/* =========================================================
   SIREN — activity.js (★ Phase M-11)
   - /activities.html: 앨범 목록 + 필터 + 페이징
   - /activity.html?slug=xxx: 게시글 상세
   ========================================================= */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }
  function categoryLabel(c) {
    return c === 'report' ? '📋 활동보고서' :
           c === 'photo'  ? '📷 사진' :
           c === 'news'   ? '📰 뉴스' : c;
  }

  /* ============ 목록 페이지 ============ */
  let _state = { page: 1, category: '', year: '', totalPages: 1 };

  async function loadList() {
    const album = document.getElementById('actAlbum');
    if (!album) return;

    album.innerHTML = `
      <div class="act-empty">
        <div class="icon">⏳</div>
        <div class="title">불러오는 중...</div>
      </div>`;

    const params = new URLSearchParams();
    params.set('page', String(_state.page));
    params.set('limit', '12');
    if (_state.category) params.set('category', _state.category);
    if (_state.year) params.set('year', _state.year);

    try {
      const res = await fetch('/api/activity-posts?' + params.toString(), { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        album.innerHTML = `
          <div class="act-empty">
            <div class="icon">⚠️</div>
            <div class="title">불러오기 실패</div>
            <div class="desc">${escapeHtml(json.error || '잠시 후 다시 시도해 주세요')}</div>
          </div>`;
        return;
      }

      const list = json.data?.list || [];
      const pg = json.data?.pagination || { page: 1, totalPages: 1 };
      const yearStats = json.data?.yearStats || [];
      _state.totalPages = pg.totalPages;

      /* 연도 셀렉트 채우기 */
      populateYearSelect(yearStats);

      if (list.length === 0) {
        album.innerHTML = `
          <div class="act-empty">
            <div class="icon">📭</div>
            <div class="title">조회된 활동이 없습니다</div>
            <div class="desc">필터를 변경하거나 다른 연도/분류로 확인해 보세요.</div>
          </div>`;
        document.getElementById('actPagination').style.display = 'none';
        return;
      }

      album.innerHTML = '<div class="act-album">' + list.map((p) => `
        <a class="act-card" href="/activity.html?slug=${encodeURIComponent(p.slug)}">
          <div class="act-card-thumb">
            ${p.thumbnailUrl
              ? `<img src="${escapeHtml(p.thumbnailUrl)}" alt="${escapeHtml(p.title)}">`
              : `<span class="placeholder">📊</span>`}
            <span class="cat-mark">${escapeHtml(categoryLabel(p.category))}</span>
            ${p.isPinned ? '<span class="pin-mark">📌 고정</span>' : ''}
          </div>
          <div class="act-card-body">
            <div class="act-card-meta">${p.year}${p.month ? '.' + String(p.month).padStart(2, '0') : ''}</div>
            <h3 class="act-card-title">${escapeHtml(p.title)}</h3>
            <p class="act-card-summary">${escapeHtml(p.summary || '')}</p>
            <div class="act-card-bottom">
              <span>${fmtDate(p.publishedAt)}</span>
              <span>👁 ${(p.views || 0).toLocaleString()}</span>
            </div>
          </div>
        </a>
      `).join('') + '</div>';

      renderPagination();
    } catch (e) {
      console.error('[activity list]', e);
      album.innerHTML = `
        <div class="act-empty">
          <div class="icon">⚠️</div>
          <div class="title">네트워크 오류</div>
        </div>`;
    }
  }

  function populateYearSelect(yearStats) {
    const sel = document.getElementById('actYearFilter');
    if (!sel) return;
    const current = sel.value;
    let html = '<option value="">전체 연도</option>';
    yearStats.forEach((s) => {
      html += `<option value="${s.year}">${s.year}년 (${s.count})</option>`;
    });
    sel.innerHTML = html;
    if (current) sel.value = current;
  }

  function renderPagination() {
    const box = document.getElementById('actPagination');
    if (!box) return;
    const { page, totalPages } = _state;

    if (totalPages <= 1) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    box.style.display = 'flex';
    let html = '';
    const maxBtns = 5;
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    html += `<button data-page="1" ${page === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = start; i <= end; i++) {
      html += `<button data-page="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button data-page="${totalPages}" ${page === totalPages ? 'disabled' : ''}>»</button>`;

    box.innerHTML = html;
    box.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.page);
        if (Number.isFinite(p) && p !== _state.page) {
          _state.page = p;
          loadList();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function setupListPage() {
    /* 카테고리 탭 */
    document.querySelectorAll('.act-cat-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.act-cat-tab').forEach((t) => t.classList.remove('on'));
        tab.classList.add('on');
        _state.category = tab.dataset.cat || '';
        _state.page = 1;
        loadList();
      });
    });

    /* 연도 필터 */
    const yearSel = document.getElementById('actYearFilter');
    if (yearSel) {
      yearSel.addEventListener('change', (e) => {
        _state.year = e.target.value;
        _state.page = 1;
        loadList();
      });
    }

    loadList();
  }

  /* ============ 상세 페이지 ============ */
  async function loadDetail() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('slug');
    if (!slug) { location.href = '/activities.html'; return; }

    const heroEl = document.getElementById('actHero');
    const bodyEl = document.getElementById('actDetailBody');

    try {
      const res = await fetch('/api/activity-posts?slug=' + encodeURIComponent(slug), {
        credentials: 'include',
      });
      const json = await res.json();

      if (!res.ok || !json.ok || !json.data?.post) {
        document.getElementById('actDetailTitle').textContent = '⚠️ 게시글을 찾을 수 없습니다';
        bodyEl.innerHTML = `
          <div style="text-align:center;padding:40px">
            <a href="/activities.html" class="btn btn-primary">목록으로 돌아가기</a>
          </div>`;
        return;
      }

      const p = json.data.post;
      document.title = p.title + ' | 교사유가족협의회';

      /* 헤로 영역 */
      const heroContainer = heroEl.querySelector('.container');
      const yearMonth = p.month ? `${p.year}.${String(p.month).padStart(2, '0')}` : String(p.year);
      heroContainer.innerHTML = `
        <span class="eyebrow">${escapeHtml(categoryLabel(p.category))} · ${yearMonth}</span>
        <h1>${escapeHtml(p.title)}</h1>
        <div class="meta">
          <span>📅 ${fmtDate(p.publishedAt)}</span>
          <span>👁 ${(p.views || 0).toLocaleString()}</span>
        </div>
      `;

      /* 본문 + 첨부 */
      let attachmentsHtml = '';
      if (p.attachments && p.attachments.length) {
        attachmentsHtml = '<div class="act-detail-attachments"><h4>📎 첨부 파일</h4><ul>' +
          p.attachments.map((a) => `
            <li>
              <a href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener">
                📄 ${escapeHtml(a.originalName)}
              </a>
            </li>
          `).join('') +
          '</ul></div>';
      }

      bodyEl.innerHTML = `
        ${p.summary ? `<p style="font-size:16px;color:var(--brand);font-weight:500;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:24px">${escapeHtml(p.summary)}</p>` : ''}
        ${p.contentHtml || '<p style="color:var(--text-3)">본문이 없습니다.</p>'}
        ${attachmentsHtml}
        <div class="act-detail-actions">
          <a href="/activities.html" class="btn btn-outline" style="background:transparent;border:1px solid var(--line);color:var(--text-2)">← 목록으로</a>
          <a href="/index.html" class="btn btn-primary">홈으로</a>
        </div>
      `;
    } catch (e) {
      console.error('[activity detail]', e);
      bodyEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">네트워크 오류</div>';
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    const page = document.body.dataset.page;
    if (page === 'activities') setupListPage();
    else if (page === 'activity-detail') loadDetail();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();