/* =========================================================
   SIREN — news-media.js (★ Phase M-11)
   - news.html 갤러리 영역 (언론보도 + 사진 + 행사)
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

  let _currentCat = '';

  async function loadMedia() {
    const grid = document.getElementById('mediaGrid');
    if (!grid) return;

    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">불러오는 중...</div>';

    const params = new URLSearchParams({ limit: '12', page: '1' });
    if (_currentCat) params.set('category', _currentCat);

    try {
      const res = await fetch('/api/media-posts?' + params.toString(), { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);font-size:13px">불러오기 실패</div>';
        return;
      }

      const list = json.data?.list || [];
      if (list.length === 0) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">조회된 게시글이 없습니다</div>';
        return;
      }

      grid.innerHTML = '<div class="media-grid">' + list.map((m) => {
        const isExternal = m.category === 'press' && m.externalUrl;
        const href = isExternal ? m.externalUrl : `/api/media-posts?id=${m.id}`;
        const targetAttr = isExternal ? 'target="_blank" rel="noopener"' : '';

        /* 외부 링크가 아니면 모달이 더 적합하지만 단순화를 위해 alert로 본문 표시 */
        const dataAttrs = !isExternal ? `data-media-id="${m.id}"` : '';

        return `
          <a class="media-card" href="${escapeHtml(href)}" ${targetAttr} ${dataAttrs}>
            <div class="media-card-thumb">
              ${m.thumbnailUrl
                ? `<img src="${escapeHtml(m.thumbnailUrl)}" alt="${escapeHtml(m.title)}">`
                : `<span class="placeholder">${m.category === 'press' ? '📰' : m.category === 'photo' ? '📷' : '🎯'}</span>`}
            </div>
            <div class="media-card-body">
              ${m.source ? `<div class="media-card-source">${escapeHtml(m.source)}</div>` : ''}
              <h4 class="media-card-title">${escapeHtml(m.title)}</h4>
              <div class="media-card-date">${fmtDate(m.publishedAt)}${isExternal ? ' · 🔗 외부 링크' : ''}</div>
            </div>
          </a>
        `;
      }).join('') + '</div>';

      /* 사진/행사 클릭 시 본문 모달 (간단한 alert로 처리, 외부링크는 그냥 이동) */
      grid.querySelectorAll('[data-media-id]').forEach((el) => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          const id = el.dataset.mediaId;
          const r = await fetch('/api/media-posts?id=' + id);
          const j = await r.json();
          if (j.ok && j.data?.post) {
            openMediaModal(j.data.post);
          }
        });
      });
    } catch (e) {
      console.error('[news-media]', e);
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);font-size:13px">네트워크 오류</div>';
    }
  }

  /* 사진/행사 본문은 기존 noticeViewModal 재활용 */
  function openMediaModal(p) {
    const modal = document.getElementById('noticeViewModal');
    if (!modal) {
      alert(p.title + '\n\n' + (p.summary || '') + '\n\n자세한 내용은 관리자에게 문의해 주세요.');
      return;
    }

    const titleEl = document.getElementById('nvTitle');
    const metaEl = document.getElementById('nvMeta');
    const bodyEl = document.getElementById('nvBody');

    if (titleEl) titleEl.textContent = p.title;
    if (metaEl) {
      const catKr = p.category === 'photo' ? '📷 사진' :
                    p.category === 'event' ? '🎯 행사' : '📰 언론보도';
      metaEl.innerHTML = `${catKr}${p.source ? ' · ' + escapeHtml(p.source) : ''} · ${fmtDate(p.publishedAt)}`;
    }
    if (bodyEl) {
      let html = '';
      if (p.thumbnailUrl) {
        html += `<img src="${escapeHtml(p.thumbnailUrl)}" alt="" style="width:100%;border-radius:8px;margin-bottom:14px">`;
      }
      if (p.summary) {
        html += `<p style="color:var(--text-2);font-size:14px;line-height:1.7;border-left:3px solid var(--brand);padding-left:14px;margin-bottom:14px">${escapeHtml(p.summary)}</p>`;
      }
      html += p.contentHtml || '';
      if (p.externalUrl) {
        html += `<p style="margin-top:18px"><a href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener" style="color:var(--brand)">🔗 원문 보기</a></p>`;
      }
      bodyEl.innerHTML = html;
    }

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function setupTabs() {
    document.querySelectorAll('#mediaCatTabs .act-cat-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#mediaCatTabs .act-cat-tab').forEach((t) => t.classList.remove('on'));
        tab.classList.add('on');
        _currentCat = tab.dataset.mc || '';
        loadMedia();
      });
    });
  }

  function init() {
    if (document.body.dataset.page !== 'news') return;
    setupTabs();
    loadMedia();
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