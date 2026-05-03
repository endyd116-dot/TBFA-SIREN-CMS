/* =========================================================
   SIREN — admin-content.js (★ Phase M-11)
   콘텐츠 관리 통합 모듈
   - 5개 탭: notices / faqs / about / activity / media
   - notices/faqs는 기존 admin.js 핸들러 유지 (탭 전환만 처리)
   - about/activity/media는 이 파일에서 관리
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
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
  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return fmtDate(iso) + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }
  function toIsoDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
  }
  function toast(msg, ms) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg, ms);
    alert(msg);
  }
  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[admin-content]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }
  function htmlToText(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* ============ 카테고리 라벨 ============ */
  const ACT_CAT_LABEL = { report: '📋 활동보고서', photo: '📷 사진', news: '📰 활동뉴스' };
  const MED_CAT_LABEL = { press: '📰 언론보도', photo: '📷 사진', event: '🎯 행사' };

  /* ============ 상태 ============ */
  let _currentTab = 'notices';
  let _aboutLoaded = false;
  let _apFilters = {};
  let _mpFilters = {};
  let _apSearchTimer = null;
  let _mpSearchTimer = null;

  /* 편집기 인스턴스 (모달별) */
  const _editors = { cpe: null, ape: null, mpe: null };
  /* 첨부 위젯 (활동 모달용) */
  let _apeAttachments = null;

  /* ============ 탭 전환 ============ */
  function switchTab(tabKey) {
    if (!tabKey) return;
    _currentTab = tabKey;

    document.querySelectorAll('#contentTabs .ct-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.ct === tabKey);
    });
    document.querySelectorAll('[data-ct-pane]').forEach((p) => {
      p.style.display = p.dataset.ctPane === tabKey ? '' : 'none';
    });

    /* 탭별 자동 로드 */
    if (tabKey === 'about') loadAbout();
    else if (tabKey === 'activity') loadActivities();
    else if (tabKey === 'media') loadMedia();
    /* notices/faqs는 admin.js에서 처리됨 — 탭 전환 시 자동 로드는 없음.
       기존 admin.js의 loadContent()는 페이지 진입 시 이미 호출됨 */
  }

  /* ============ 협의회 소개 (about) ============ */
  async function loadAbout() {
    const grid = document.getElementById('aboutSectionGrid');
    if (!grid) return;

    grid.innerHTML = '<div style="grid-column:1 / -1;text-align:center;padding:40px;color:var(--text-3)">불러오는 중...</div>';

    const res = await api('/api/admin/content-pages');
    if (!res.ok || !res.data?.data) {
      grid.innerHTML = '<div style="grid-column:1 / -1;text-align:center;padding:40px;color:var(--danger)">조회 실패</div>';
      return;
    }

    /* 키 별로 한 건씩 로드 (목록은 메타데이터만) */
    const list = res.data.data.list || [];
    const aboutPages = list.filter((p) => String(p.pageKey || '').startsWith('about_'));

    if (aboutPages.length === 0) {
      grid.innerHTML = '<div style="grid-column:1 / -1;text-align:center;padding:40px;color:var(--text-3)">시드된 섹션이 없습니다. 마이그레이션을 먼저 실행하세요.</div>';
      return;
    }

    /* 본문 미리보기는 단일 GET으로 한 번에 받기 (keys 파라미터 활용 — 공개 API 사용) */
    const keys = aboutPages.map((p) => p.pageKey).join(',');
    const detailRes = await api('/api/content-pages?keys=' + encodeURIComponent(keys));
    const pagesMap = (detailRes.ok && detailRes.data?.data?.pages) || {};

    grid.innerHTML = aboutPages.map((p) => {
      const detail = pagesMap[p.pageKey] || {};
      const preview = htmlToText(detail.contentHtml).slice(0, 100);
      return `<div class="about-section-card" data-cp-edit="${p.id}" data-cp-key="${escapeHtml(p.pageKey)}">
        <div class="key">${escapeHtml(p.pageKey)}</div>
        <div class="title">${escapeHtml(p.title || '(제목 없음)')}</div>
        <div class="preview">${escapeHtml(preview || '(본문 없음)')}</div>
        <div class="meta">
          <span>최종 수정: ${fmtDate(p.updatedAt)}</span>
          <button type="button" class="edit-btn">✏️ 편집</button>
        </div>
      </div>`;
    }).join('');

    _aboutLoaded = true;
  }

  async function openAboutEditModal(id, pageKey) {
    const modal = document.getElementById('contentPageEditModal');
    if (!modal) return;

    document.getElementById('cpeId').value = id || '';
    document.getElementById('cpePageKey').value = pageKey || '';
    document.getElementById('cpeKeyDisplay').textContent = pageKey || '—';
    document.getElementById('cpeTitle').value = '';

    modal.classList.add('show');

    /* 데이터 로드 */
    const res = await api('/api/admin/content-pages?key=' + encodeURIComponent(pageKey));
    if (!res.ok || !res.data?.data?.page) {
      toast('페이지 데이터 로드 실패');
      modal.classList.remove('show');
      return;
    }

    const p = res.data.data.page;
    document.getElementById('cpeTitle').value = p.title || '';

    /* 편집기 초기화 */
    if (!_editors.cpe) {
      try {
        _editors.cpe = await window.SirenEditor.create({
          el: document.getElementById('cpeEditor'),
          height: '380px',
          initialValue: p.contentHtml || '',
          uploadContext: 'content-page',
        });
      } catch (e) {
        console.error('[about editor]', e);
        toast('편집기 로드 실패');
        return;
      }
    } else {
      try { _editors.cpe.setHTML(p.contentHtml || ''); } catch (_) {}
    }
  }

  async function saveAboutSection(e) {
    e.preventDefault();
    const id = document.getElementById('cpeId').value;
    const pageKey = document.getElementById('cpePageKey').value;
    const title = document.getElementById('cpeTitle').value.trim();
    let contentHtml = '';
    try { contentHtml = _editors.cpe ? _editors.cpe.getHTML() : ''; } catch (_) {}

    const submitBtn = document.querySelector('#contentPageEditForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }

    try {
      const body = pageKey ? { pageKey, title, contentHtml } : { id: Number(id), title, contentHtml };
      const res = await api('/api/admin/content-pages', { method: 'PATCH', body });

      if (res.ok) {
        toast(res.data?.message || '저장되었습니다');
        document.getElementById('contentPageEditModal').classList.remove('show');
        _aboutLoaded = false;
        loadAbout();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 저장'; }
    }
  }

  /* ============ 주요 활동 (activity) ============ */
  async function loadActivities() {
    const tbody = document.getElementById('apTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams({ limit: '50', page: '1' });
    if (_apFilters.category) params.set('category', _apFilters.category);
    if (_apFilters.year) params.set('year', _apFilters.year);
    if (_apFilters.published) params.set('published', _apFilters.published);
    if (_apFilters.q && _apFilters.q.length >= 2) params.set('q', _apFilters.q);

    const res = await api('/api/admin/activity-posts?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">게시글이 없습니다</td></tr>';
      populateYearSelect([]);
      return;
    }

    tbody.innerHTML = list.map((p) => {
      const yearMonth = p.month ? `${p.year}.${String(p.month).padStart(2, '0')}` : String(p.year);
      const pinIcon = p.isPinned ? '<span style="color:var(--brand)">📌</span>' : '<span style="color:var(--text-3)">—</span>';
      const pubIcon = p.isPublished
        ? '<span style="color:var(--success);font-size:13px">●</span>'
        : '<span style="color:var(--text-3);font-size:13px">○</span>';
      return `<tr>
        <td><span class="ap-cat-badge ${escapeHtml(p.category)}">${escapeHtml(ACT_CAT_LABEL[p.category] || p.category)}</span></td>
        <td style="font-family:Inter;font-size:12px">${yearMonth}</td>
        <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</td>
        <td style="text-align:right;font-family:Inter;font-size:11.5px">${(p.views || 0).toLocaleString()}</td>
        <td style="text-align:center">${pinIcon}</td>
        <td style="text-align:center">${pubIcon}</td>
        <td><div class="cm-row-actions">
          <button class="edit" data-ap-action="edit" data-ap-id="${p.id}">✏️ 수정</button>
          <button class="delete" data-ap-action="delete" data-ap-id="${p.id}" data-ap-title="${escapeHtml(p.title)}">🗑 삭제</button>
        </div></td>
      </tr>`;
    }).join('');

    /* 연도 셀렉트 채우기 */
    const years = [...new Set(list.map((p) => p.year))].sort((a, b) => b - a);
    populateYearSelect(years);
  }

  function populateYearSelect(years) {
    const sel = document.getElementById('apFilterYear');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">전체 연도</option>' +
      years.map((y) => `<option value="${y}" ${y === Number(current) ? 'selected' : ''}>${y}년</option>`).join('');
    if (current) sel.value = current;
  }

  async function openActivityEditModal(id) {
    const modal = document.getElementById('activityPostEditModal');
    if (!modal) return;

    /* 폼 초기화 */
    const form = document.getElementById('activityPostEditForm');
    if (form) form.reset();
    document.getElementById('apeId').value = id || '';
    document.getElementById('apeYear').value = new Date().getFullYear();
    document.getElementById('apeThumbId').value = '';
    document.getElementById('apeThumbPreview').style.backgroundImage = '';
    document.getElementById('apePublished').checked = true;
    document.getElementById('apePinned').checked = false;

    const titleEl = document.getElementById('apeModalTitle');
    if (titleEl) titleEl.textContent = id ? '✏️ 활동 게시글 수정' : '📊 활동 게시글 작성';

    modal.classList.add('show');

    /* 편집기 초기화 */
    if (!_editors.ape) {
      try {
        _editors.ape = await window.SirenEditor.create({
          el: document.getElementById('apeEditor'),
          height: '320px',
          initialValue: '',
          uploadContext: 'activity-post',
        });
      } catch (e) {
        console.error('[activity editor]', e);
      }
    } else {
      try { _editors.ape.setHTML(''); } catch (_) {}
    }

    /* 첨부 위젯 초기화 (매번 destroy + 새로 만들기) */
    const attachContainer = document.getElementById('apeAttachments');
    if (attachContainer && window.SirenAttachment) {
      if (_apeAttachments) {
        try { _apeAttachments.destroy(); } catch (_) {}
        _apeAttachments = null;
      }
      _apeAttachments = window.SirenAttachment.create({
        el: attachContainer,
        context: 'activity-post',
        maxFiles: 10,
      });
    }

    /* 수정 모드: 데이터 로드 */
    if (id) {
      const res = await api('/api/admin/activity-posts?id=' + id);
      if (!res.ok || !res.data?.data?.post) {
        toast('게시글 로드 실패');
        modal.classList.remove('show');
        return;
      }
      const p = res.data.data.post;
      document.getElementById('apeCategory').value = p.category || 'news';
      document.getElementById('apeYear').value = p.year || new Date().getFullYear();
      document.getElementById('apeMonth').value = p.month || '';
      document.getElementById('apeTitle').value = p.title || '';
      document.getElementById('apeSummary').value = p.summary || '';
      document.getElementById('apePublished').checked = p.isPublished !== false;
      document.getElementById('apePinned').checked = !!p.isPinned;

      if (p.thumbnailBlobId) {
        document.getElementById('apeThumbId').value = String(p.thumbnailBlobId);
        document.getElementById('apeThumbPreview').style.backgroundImage =
          `url('/api/blob-image?id=${p.thumbnailBlobId}')`;
      }

      if (_editors.ape) {
        try { _editors.ape.setHTML(p.contentHtml || ''); } catch (_) {}
      }

      /* 기존 첨부 표시 */
      if (p.attachmentIds && _apeAttachments) {
        try {
          const ids = JSON.parse(p.attachmentIds);
          if (Array.isArray(ids) && ids.length) {
            try { _apeAttachments.destroy(); } catch (_) {}
            _apeAttachments = window.SirenAttachment.create({
              el: attachContainer,
              context: 'activity-post',
              maxFiles: 10,
              initialFiles: ids.map((bid) => ({
                id: bid,
                originalName: `첨부 #${bid}`,
                mimeType: '',
                sizeBytes: 0,
                url: `/api/blob-image?id=${bid}`,
              })),
            });
          }
        } catch (_) {}
      }
    }
  }

  async function saveActivityPost(e) {
    e.preventDefault();
    const id = document.getElementById('apeId').value;
    const category = document.getElementById('apeCategory').value;
    const year = Number(document.getElementById('apeYear').value);
    const monthRaw = document.getElementById('apeMonth').value;
    const month = monthRaw ? Number(monthRaw) : null;
    const title = document.getElementById('apeTitle').value.trim();
    const summary = document.getElementById('apeSummary').value.trim();
    const thumbIdRaw = document.getElementById('apeThumbId').value;
    const thumbnailBlobId = thumbIdRaw ? Number(thumbIdRaw) : null;
    const isPublished = document.getElementById('apePublished').checked;
    const isPinned = document.getElementById('apePinned').checked;

    let contentHtml = '';
    try { contentHtml = _editors.ape ? _editors.ape.getHTML() : ''; } catch (_) {}

    if (!title) return toast('제목을 입력해 주세요');
    if (!Number.isFinite(year)) return toast('연도가 유효하지 않습니다');

    if (_apeAttachments && _apeAttachments.hasUploading && _apeAttachments.hasUploading()) {
      return toast('첨부 파일이 아직 업로드 중입니다');
    }
    const attachmentIds = (_apeAttachments && _apeAttachments.getIds) ? _apeAttachments.getIds() : [];

    const submitBtn = document.querySelector('#activityPostEditForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }

    try {
      const body = {
        category, year, month, title, summary, contentHtml,
        thumbnailBlobId, attachmentIds, isPublished, isPinned,
      };
      let res;
      if (id) {
        body.id = Number(id);
        res = await api('/api/admin/activity-posts', { method: 'PATCH', body });
      } else {
        res = await api('/api/admin/activity-posts', { method: 'POST', body });
      }

      if (res.ok) {
        toast(res.data?.message || '저장되었습니다');
        document.getElementById('activityPostEditModal').classList.remove('show');
        loadActivities();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 저장'; }
    }
  }

  async function deleteActivityPost(id, title) {
    if (!confirm(`활동 게시글을 삭제하시겠습니까?\n\n"${title}"\n\n※ 삭제 후 복구할 수 없습니다.`)) return;
    const res = await api('/api/admin/activity-posts?id=' + id, { method: 'DELETE' });
    if (res.ok) {
      toast('삭제되었습니다');
      loadActivities();
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  /* ============ 언론보도/갤러리 (media) ============ */
  async function loadMedia() {
    const tbody = document.getElementById('mpTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams({ limit: '50', page: '1' });
    if (_mpFilters.category) params.set('category', _mpFilters.category);
    if (_mpFilters.published) params.set('published', _mpFilters.published);
    if (_mpFilters.q && _mpFilters.q.length >= 2) params.set('q', _mpFilters.q);

    const res = await api('/api/admin/media-posts?' + params.toString());
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-3)">게시글이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((m) => {
      const pubIcon = m.isPublished
        ? '<span style="color:var(--success);font-size:13px">●</span>'
        : '<span style="color:var(--text-3);font-size:13px">○</span>';
      return `<tr>
        <td><span class="mp-cat-badge ${escapeHtml(m.category)}">${escapeHtml(MED_CAT_LABEL[m.category] || m.category)}</span></td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</td>
        <td style="font-size:11.5px">${escapeHtml(m.source || '—')}</td>
        <td style="font-size:11.5px">${fmtDate(m.publishedAt)}</td>
        <td style="text-align:center">${pubIcon}</td>
        <td><div class="cm-row-actions">
          <button class="edit" data-mp-action="edit" data-mp-id="${m.id}">✏️ 수정</button>
          <button class="delete" data-mp-action="delete" data-mp-id="${m.id}" data-mp-title="${escapeHtml(m.title)}">🗑 삭제</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  async function openMediaEditModal(id) {
    const modal = document.getElementById('mediaPostEditModal');
    if (!modal) return;

    const form = document.getElementById('mediaPostEditForm');
    if (form) form.reset();
    document.getElementById('mpeId').value = id || '';
    document.getElementById('mpeThumbId').value = '';
    document.getElementById('mpeThumbPreview').style.backgroundImage = '';
    document.getElementById('mpePublished').checked = true;
    document.getElementById('mpePublishedAt').value = toIsoDate(new Date());

    const titleEl = document.getElementById('mpeModalTitle');
    if (titleEl) titleEl.textContent = id ? '✏️ 게시글 수정' : '📰 언론보도/갤러리 작성';

    modal.classList.add('show');

    if (!_editors.mpe) {
      try {
        _editors.mpe = await window.SirenEditor.create({
          el: document.getElementById('mpeEditor'),
          height: '320px',
          initialValue: '',
          uploadContext: 'media-post',
        });
      } catch (e) {
        console.error('[media editor]', e);
      }
    } else {
      try { _editors.mpe.setHTML(''); } catch (_) {}
    }

    if (id) {
      const res = await api('/api/admin/media-posts?id=' + id);
      if (!res.ok || !res.data?.data?.post) {
        toast('게시글 로드 실패');
        modal.classList.remove('show');
        return;
      }
      const m = res.data.data.post;
      document.getElementById('mpeCategory').value = m.category || 'press';
      document.getElementById('mpePublishedAt').value = toIsoDate(m.publishedAt);
      document.getElementById('mpeTitle').value = m.title || '';
      document.getElementById('mpeSource').value = m.source || '';
      document.getElementById('mpeExternalUrl').value = m.externalUrl || '';
      document.getElementById('mpeSummary').value = m.summary || '';
      document.getElementById('mpePublished').checked = m.isPublished !== false;

      if (m.thumbnailBlobId) {
        document.getElementById('mpeThumbId').value = String(m.thumbnailBlobId);
        document.getElementById('mpeThumbPreview').style.backgroundImage =
          `url('/api/blob-image?id=${m.thumbnailBlobId}')`;
      }

      if (_editors.mpe) {
        try { _editors.mpe.setHTML(m.contentHtml || ''); } catch (_) {}
      }
    }
  }

  async function saveMediaPost(e) {
    e.preventDefault();
    const id = document.getElementById('mpeId').value;
    const category = document.getElementById('mpeCategory').value;
    const publishedAt = document.getElementById('mpePublishedAt').value;
    const title = document.getElementById('mpeTitle').value.trim();
    const source = document.getElementById('mpeSource').value.trim();
    const externalUrl = document.getElementById('mpeExternalUrl').value.trim();
    const summary = document.getElementById('mpeSummary').value.trim();
    const thumbIdRaw = document.getElementById('mpeThumbId').value;
    const thumbnailBlobId = thumbIdRaw ? Number(thumbIdRaw) : null;
    const isPublished = document.getElementById('mpePublished').checked;

    let contentHtml = '';
    try { contentHtml = _editors.mpe ? _editors.mpe.getHTML() : ''; } catch (_) {}

    if (!title) return toast('제목을 입력해 주세요');

    const submitBtn = document.querySelector('#mediaPostEditForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }

    try {
      const body = {
        category, title, source, externalUrl, summary, contentHtml,
        thumbnailBlobId, isPublished,
      };
      if (publishedAt) body.publishedAt = publishedAt;

      let res;
      if (id) {
        body.id = Number(id);
        res = await api('/api/admin/media-posts', { method: 'PATCH', body });
      } else {
        res = await api('/api/admin/media-posts', { method: 'POST', body });
      }

      if (res.ok) {
        toast(res.data?.message || '저장되었습니다');
        document.getElementById('mediaPostEditModal').classList.remove('show');
        loadMedia();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 저장'; }
    }
  }

  async function deleteMediaPost(id, title) {
    if (!confirm(`게시글을 삭제하시겠습니까?\n\n"${title}"\n\n※ 삭제 후 복구할 수 없습니다.`)) return;
    const res = await api('/api/admin/media-posts?id=' + id, { method: 'DELETE' });
    if (res.ok) {
      toast('삭제되었습니다');
      loadMedia();
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  /* ============ 썸네일 업로드 (활동/미디어 공용) ============ */
  async function handleThumbUpload(file, idFieldId, previewElId) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return toast('이미지 파일만 업로드 가능합니다');
    }
    if (file.size > 10 * 1024 * 1024) {
      return toast('이미지는 10MB 이하여야 합니다');
    }

    toast('썸네일 업로드 중...');

    try {
      /* SirenEditor의 uploadFile 재사용 (R2 직접 업로드) */
      let compressed = file;
      if (window.SirenEditor && typeof window.SirenEditor.compressImage === 'function') {
        try { compressed = await window.SirenEditor.compressImage(file, 1200, 0.85); } catch (_) {}
      }

      if (!window.SirenEditor || typeof window.SirenEditor.uploadFile !== 'function') {
        return toast('업로드 모듈을 찾을 수 없습니다');
      }

      const result = await window.SirenEditor.uploadFile(compressed, 'thumbnail');
      if (!result || !result.id) return toast('업로드 실패');

      document.getElementById(idFieldId).value = String(result.id);
      const preview = document.getElementById(previewElId);
      if (preview) preview.style.backgroundImage = `url('${result.url}')`;
      toast('썸네일이 업로드되었습니다');
    } catch (e) {
      console.error('[thumb upload]', e);
      toast('업로드 중 오류 발생');
    }
  }

  /* ============ 글로벌 이벤트 위임 ============ */
  function setupEvents() {
    /* 탭 전환 */
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('#contentTabs .ct-tab');
      if (tab) {
        e.preventDefault();
        switchTab(tab.dataset.ct);
        return;
      }

      /* 협의회 소개 카드 클릭 */
      const aboutCard = e.target.closest('[data-cp-edit]');
      if (aboutCard) {
        e.preventDefault();
        const id = Number(aboutCard.dataset.cpEdit);
        const key = aboutCard.dataset.cpKey;
        if (id) openAboutEditModal(id, key);
        return;
      }

      /* 활동 게시글 액션 */
      const apBtn = e.target.closest('[data-ap-action]');
      if (apBtn) {
        e.preventDefault();
        const action = apBtn.dataset.apAction;
        const id = Number(apBtn.dataset.apId);
        if (action === 'new') openActivityEditModal(null);
        else if (action === 'edit' && id) openActivityEditModal(id);
        else if (action === 'delete' && id) deleteActivityPost(id, apBtn.dataset.apTitle || '');
        return;
      }

      /* 미디어 게시글 액션 */
      const mpBtn = e.target.closest('[data-mp-action]');
      if (mpBtn) {
        e.preventDefault();
        const action = mpBtn.dataset.mpAction;
        const id = Number(mpBtn.dataset.mpId);
        if (action === 'new') openMediaEditModal(null);
        else if (action === 'edit' && id) openMediaEditModal(id);
        else if (action === 'delete' && id) deleteMediaPost(id, mpBtn.dataset.mpTitle || '');
        return;
      }

      /* 활동 썸네일 버튼 */
      if (e.target.closest('#apeThumbBtn')) {
        e.preventDefault();
        document.getElementById('apeThumbInput').click();
        return;
      }
      if (e.target.closest('#apeThumbClearBtn')) {
        e.preventDefault();
        document.getElementById('apeThumbId').value = '';
        document.getElementById('apeThumbPreview').style.backgroundImage = '';
        return;
      }

      /* 미디어 썸네일 버튼 */
      if (e.target.closest('#mpeThumbBtn')) {
        e.preventDefault();
        document.getElementById('mpeThumbInput').click();
        return;
      }
      if (e.target.closest('#mpeThumbClearBtn')) {
        e.preventDefault();
        document.getElementById('mpeThumbId').value = '';
        document.getElementById('mpeThumbPreview').style.backgroundImage = '';
        return;
      }
    });

    /* 폼 제출 */
    const cpeForm = document.getElementById('contentPageEditForm');
    if (cpeForm) cpeForm.addEventListener('submit', saveAboutSection);

    const apeForm = document.getElementById('activityPostEditForm');
    if (apeForm) apeForm.addEventListener('submit', saveActivityPost);

    const mpeForm = document.getElementById('mediaPostEditForm');
    if (mpeForm) mpeForm.addEventListener('submit', saveMediaPost);

    /* 썸네일 파일 선택 */
    const apeThumbInput = document.getElementById('apeThumbInput');
    if (apeThumbInput) {
      apeThumbInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) handleThumbUpload(f, 'apeThumbId', 'apeThumbPreview');
        e.target.value = '';
      });
    }
    const mpeThumbInput = document.getElementById('mpeThumbInput');
    if (mpeThumbInput) {
      mpeThumbInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) handleThumbUpload(f, 'mpeThumbId', 'mpeThumbPreview');
        e.target.value = '';
      });
    }

    /* 활동 필터 */
    ['apFilterCat', 'apFilterYear', 'apFilterPublished'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          const key = id === 'apFilterCat' ? 'category' :
                      id === 'apFilterYear' ? 'year' : 'published';
          _apFilters[key] = e.target.value;
          loadActivities();
        });
      }
    });
    const apQ = document.getElementById('apFilterQ');
    if (apQ) {
      apQ.addEventListener('input', (e) => {
        clearTimeout(_apSearchTimer);
        _apFilters.q = e.target.value || '';
        _apSearchTimer = setTimeout(loadActivities, 400);
      });
    }

    /* 미디어 필터 */
    ['mpFilterCat', 'mpFilterPublished'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          const key = id === 'mpFilterCat' ? 'category' : 'published';
          _mpFilters[key] = e.target.value;
          loadMedia();
        });
      }
    });
    const mpQ = document.getElementById('mpFilterQ');
    if (mpQ) {
      mpQ.addEventListener('input', (e) => {
        clearTimeout(_mpSearchTimer);
        _mpFilters.q = e.target.value || '';
        _mpSearchTimer = setTimeout(loadMedia, 400);
      });
    }
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_ADMIN_CONTENT = {
    switchTab,
    loadAbout,
    loadActivities,
    loadMedia,
  };

  /* ============ 초기화 ============ */
  function init() {
    setupEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();