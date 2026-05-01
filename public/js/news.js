/* =========================================================
   SIREN — news.js
   공지사항 / FAQ 동적 로딩 (홈 + 소식 페이지 공용)
   ========================================================= */
(function () {
  'use strict';

  /* ------------ API 헬퍼 ------------ */
  async function getJson(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      return data;
    } catch (e) {
      console.error('[news.js fetch]', url, e);
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  }

  const CAT_TAG = {
    general: { label: '일반공지', cls: 'tag-mute' },
    member:  { label: '회원공지', cls: 'tag-sec' },
    event:   { label: '사업안내', cls: 'tag-pri' },
    media:   { label: '언론보도', cls: 'tag-mute' },
  };

  const CAT_BADGE = {
    general: { label: '일반', cls: 'b-mute' },
    member:  { label: '회원', cls: 'b-info' },
    event:   { label: '사업', cls: 'b-warn' },
    media:   { label: '언론', cls: 'b-success' },
  };

  /* ------------ 1. 홈 페이지 공지/FAQ 로딩 ------------ */
  async function loadHomeNotices() {
    const ul = document.querySelector('.notice-list');
    if (!ul) return;

    const data = await getJson('/api/notices?limit=5');
    if (!data?.ok || !data.data?.list) return;

    const list = data.data.list;
    if (list.length === 0) {
      ul.innerHTML = `<li style="text-align:center;color:var(--text-3);padding:40px">등록된 공지사항이 없습니다</li>`;
      return;
    }

    ul.innerHTML = list.map(n => {
      const t = CAT_TAG[n.category] || CAT_TAG.general;
      const pin = n.isPinned ? '📌 ' : '';
      return `
        <li data-id="${n.id}" style="cursor:pointer">
          <span class="tag ${t.cls}">${t.label}</span>
          <span class="notice-title">${pin}${escapeHtml(n.title)}</span>
          <span class="notice-date">${formatDate(n.publishedAt || n.createdAt)}</span>
        </li>
      `;
    }).join('');

    /* 클릭 시 상세 토스트 (간단 처리) */
    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const t = li.querySelector('.notice-title')?.textContent || '';
      window.SIREN?.toast(`공지사항: ${t.replace(/^📌\s*/, '')}`);
    });
  }

  async function loadHomeFaqs() {
    const wrap = document.querySelector('.info-grid > div:last-child > div:last-child');
    if (!wrap) return;
    /* FAQ 컨테이너가 있는지 추가 확인 */
    const firstFaq = wrap.querySelector('.faq-item');
    if (!firstFaq) return;

    const data = await getJson('/api/faqs');
    if (!data?.ok || !data.data?.list) return;

    const list = data.data.list.slice(0, 4); // 홈은 4개만
    if (list.length === 0) return;

    wrap.innerHTML = list.map(f => `
      <div class="faq-item">
        <div class="faq-q">
          <span class="q-mark">Q</span>${escapeHtml(f.question)}<span class="arrow">▼</span>
        </div>
        <div class="faq-a">
          <div class="faq-a-inner">${escapeHtml(f.answer)}</div>
        </div>
      </div>
    `).join('');
  }

  /* ------------ 2. 소식 페이지 (공지 테이블 + 전체 FAQ) ------------ */
  async function loadNewsTable() {
    const tbody = document.querySelector('main .panel table.tbl tbody');
    const isNewsPage = document.body.dataset.page === 'news';
    if (!isNewsPage || !tbody) return;

    const data = await getJson('/api/notices?limit=20');
    if (!data?.ok || !data.data?.list) return;

    const list = data.data.list;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-3)">등록된 공지사항이 없습니다</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(n => {
      const b = CAT_BADGE[n.category] || CAT_BADGE.general;
      const pin = n.isPinned ? '📌 ' : '';
      return `
        <tr style="cursor:pointer" data-id="${n.id}">
          <td>${n.id}</td>
          <td><span class="badge ${b.cls}">${b.label}</span></td>
          <td>${pin}${escapeHtml(n.title)}</td>
          <td>${formatDate(n.publishedAt || n.createdAt)}</td>
          <td>${(n.views || 0).toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadNewsFaqs() {
    const isNewsPage = document.body.dataset.page === 'news';
    if (!isNewsPage) return;
    const wrap = document.querySelector('#faq');
    if (!wrap) return;
    const container = wrap.querySelector('div[style*="max-width:880px"]');
    if (!container) return;

    const data = await getJson('/api/faqs');
    if (!data?.ok || !data.data?.list) return;

    const list = data.data.list;
    if (list.length === 0) return;

    container.innerHTML = list.map(f => `
      <div class="faq-item">
        <div class="faq-q">
          <span class="q-mark">Q</span>${escapeHtml(f.question)}<span class="arrow">▼</span>
        </div>
        <div class="faq-a">
          <div class="faq-a-inner">${escapeHtml(f.answer)}</div>
        </div>
      </div>
    `).join('');
  }

  /* ------------ 3. 초기화 ------------ */
  async function init() {
    const page = document.body.dataset.page;
    if (page === 'home') {
      await loadHomeNotices();
      await loadHomeFaqs();
    } else if (page === 'news') {
      await loadNewsTable();
      await loadNewsFaqs();
    }
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };
})();