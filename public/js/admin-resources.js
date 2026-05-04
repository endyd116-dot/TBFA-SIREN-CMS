// public/js/admin-resources.js
// ★ Phase M-19-8: 자료실 어드민 관리 모듈
// - 자료 CRUD (목록/편집/삭제)
// - 카테고리 CRUD
// - 파일 업로드 (R2 via SirenEditor)

(function () {
  'use strict';

  let _rsSearchTimer = null;
  let _categoriesCache = null;

  const ACCESS_LABEL = {
    public: '<span style="background:#e7f7ec;color:#1a5e2c;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:600">🌐 공개</span>',
    members_only: '<span style="background:#fef9f5;color:#7a1f2b;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:600">🔐 회원</span>',
    private: '<span style="background:#fdecec;color:#a01e2c;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:600">🚫 비공개</span>',
  };

  /* ────────── 공통 헬퍼 ────────── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function api(path, opts = {}) {
    const o = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      credentials: 'include',
    };
    if (opts.body) o.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, o);
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.ok !== false, status: res.status, data };
    } catch (e) {
      console.error('[admin-resources] API error:', path, e);
      return { ok: false, status: 0, data: { error: '네트워크 오류' } };
    }
  }

  /* ────────── 카테고리 캐시 ────────── */
  async function loadCategoriesForSelect(forceReload) {
    if (_categoriesCache && !forceReload) return _categoriesCache;
    const res = await api('/api/admin/resource-categories');
    if (!res.ok) return [];
    _categoriesCache = res.data.data.list || [];
    return _categoriesCache;
  }

  /* ────────── 자료 목록 로드 ────────── */
  async function loadResources() {
    const tbody = document.getElementById('rsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const params = new URLSearchParams({ page: '1', limit: '100' });
    const cat = document.getElementById('rsFilterCategory')?.value || '';
    const access = document.getElementById('rsFilterAccess')?.value || '';
    const pub = document.getElementById('rsFilterPublished')?.value || '';
    const q = (document.getElementById('rsFilterQ')?.value || '').trim();
    if (cat) params.set('categoryId', cat);
    if (access) params.set('access', access);
    if (pub) params.set('published', pub);
    if (q && q.length >= 2) params.set('q', q);

    const res = await api('/api/admin/resources?' + params.toString());
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    const pag = res.data.data.pagination || {};

    /* 필터 카테고리 드롭다운 채우기 (한 번만) */
    const filterCat = document.getElementById('rsFilterCategory');
    if (filterCat && filterCat.options.length <= 1) {
      const cats = await loadCategoriesForSelect();
      filterCat.innerHTML = '<option value="">전체 카테고리</option>' +
        cats.map(function (c) {
          return '<option value="' + c.id + '">' +
            (c.icon ? c.icon + ' ' : '') + escapeHtml(c.nameKo) + '</option>';
        }).join('');
    }

    const countEl = document.getElementById('rsCount');
    if (countEl) countEl.textContent = list.length + '건 / 전체 ' + (pag.total || 0).toLocaleString();

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-3)">자료가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (r) {
      const catBadge = r.categoryIcon
        ? (r.categoryIcon + ' ' + escapeHtml(r.categoryName || ''))
        : escapeHtml(r.categoryName || '—');
      const publishedBadge = r.isPublished
        ? '<span style="color:#1a8b46;font-size:16px" title="공개">●</span>'
        : '<span style="color:var(--text-3);font-size:16px" title="비공개">○</span>';
      const fileBadge = r.fileBlobId
        ? '<span style="font-size:12px" title="파일 첨부됨">📎</span>'
        : '';

      return '<tr>' +
        '<td style="text-align:center;font-size:14px">' + (r.isPinned ? '📌' : '') + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap">' + catBadge + '</td>' +
        '<td>' +
          '<div><strong>' + escapeHtml(r.title) + '</strong> ' + fileBadge + '</div>' +
          (r.description
            ? '<div style="font-size:11px;color:var(--text-3);margin-top:2px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.description) + '</div>'
            : '') +
        '</td>' +
        '<td>' + (ACCESS_LABEL[r.accessLevel] || r.accessLevel) + '</td>' +
        '<td style="text-align:center">' + publishedBadge + '</td>' +
        '<td style="text-align:right;font-family:Inter;font-size:11.5px">' + (r.downloadCount || 0).toLocaleString() + '</td>' +
        '<td style="text-align:right;font-family:Inter;font-size:11.5px">' + (r.views || 0).toLocaleString() + '</td>' +
        '<td style="font-size:11px">' + (r.publishedAt ? new Date(r.publishedAt).toISOString().slice(0, 10) : '-') + '</td>' +
        '<td>' +
          '<button type="button" class="btn-sm btn-sm-ghost" data-rs-act="edit" data-id="' + r.id + '" style="font-size:11px">✏️ 수정</button>' +
          '<button type="button" class="btn-sm btn-sm-ghost" data-rs-act="delete" data-id="' + r.id + '" data-title="' + escapeHtml(r.title) + '" style="font-size:11px;color:var(--danger)">🗑</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  /* ────────── 자료 편집 모달 ────────── */
  async function openResourceModal(id) {
    const modal = document.getElementById('resourceEditModal');
    if (!modal) return;

    const cats = await loadCategoriesForSelect(true);
    const catSel = document.getElementById('rsCategory');
    if (catSel) {
      catSel.innerHTML = '<option value="">(선택 안 함)</option>' +
        cats.map(function (c) {
          return '<option value="' + c.id + '">' +
            (c.icon ? c.icon + ' ' : '') + escapeHtml(c.nameKo) + '</option>';
        }).join('');
    }

    const titleEl = document.getElementById('rsModalTitle');
    const deleteBtn = document.getElementById('rsDeleteBtn');

    /* 폼 초기화 */
    ['rsEditId', 'rsTitle', 'rsDescription', 'rsTags', 'rsFileBlobId'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('rsAccessLevel').value = 'public';
    document.getElementById('rsPublished').checked = true;
    document.getElementById('rsPinned').checked = false;
    const fileInput = document.getElementById('rsFileInput');
    if (fileInput) fileInput.value = '';
    const statusEl = document.getElementById('rsFileStatus');
    if (statusEl) statusEl.textContent = '미선택';

    if (!id) {
      if (titleEl) titleEl.textContent = '📁 새 자료';
      if (deleteBtn) deleteBtn.style.display = 'none';
      modal.classList.add('show');
      setTimeout(function () {
        const tEl = document.getElementById('rsTitle');
        if (tEl) tEl.focus();
      }, 100);
      return;
    }

    if (titleEl) titleEl.textContent = '✏️ 자료 수정';
    if (deleteBtn) deleteBtn.style.display = '';
    modal.classList.add('show');

    const res = await api('/api/admin/resources?id=' + id);
    if (!res.ok) {
      toast('자료 조회 실패');
      modal.classList.remove('show');
      return;
    }
    const r = res.data.data.resource;

    document.getElementById('rsEditId').value = String(r.id);
    document.getElementById('rsTitle').value = r.title || '';
    document.getElementById('rsDescription').value = r.description || '';
    document.getElementById('rsCategory').value = r.categoryId || '';
    document.getElementById('rsAccessLevel').value = r.accessLevel || 'public';
    document.getElementById('rsTags').value = Array.isArray(r.tags) ? r.tags.join(', ') : '';
    document.getElementById('rsPublished').checked = !!r.isPublished;
    document.getElementById('rsPinned').checked = !!r.isPinned;
    if (r.fileBlobId) {
      document.getElementById('rsFileBlobId').value = String(r.fileBlobId);
      const fileInfo = res.data.data.file;
      const statusEl2 = document.getElementById('rsFileStatus');
      if (statusEl2) statusEl2.textContent = (fileInfo && fileInfo.originalName) || '파일 있음';
    }
  }
  // public/js/admin-resources.js (Part 2) — 이어서

  /* ────────── 파일 업로드 ────────── */
  async function uploadFile(file) {
    if (!window.SirenEditor || typeof window.SirenEditor.uploadFile !== 'function') {
      throw new Error('업로드 모듈 미설치 (editor.js 필요)');
    }
    const result = await window.SirenEditor.uploadFile(file, 'resource');
    return (result && result.id) || null;
  }

  /* ────────── 자료 저장 ────────── */
  async function saveResource(e) {
    e.preventDefault();
    const id = document.getElementById('rsEditId').value;
    const fileInput = document.getElementById('rsFileInput');
    const existingBlobId = document.getElementById('rsFileBlobId').value;

    let fileBlobId = existingBlobId ? Number(existingBlobId) : null;

    /* 새 파일 선택 시 업로드 */
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      if (file.size > 50 * 1024 * 1024) {
        return toast('파일은 50MB 이하여야 합니다');
      }
      toast('파일 업로드 중...');
      try {
        fileBlobId = await uploadFile(file);
        if (!fileBlobId) return toast('파일 업로드 실패');
      } catch (err) {
        return toast('업로드 실패: ' + err.message);
      }
    }

    const tagsStr = document.getElementById('rsTags').value.trim();
    const tags = tagsStr
      ? tagsStr.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 10)
      : [];

    const body = {
      title: document.getElementById('rsTitle').value.trim(),
      description: document.getElementById('rsDescription').value.trim() || null,
      categoryId: Number(document.getElementById('rsCategory').value) || null,
      accessLevel: document.getElementById('rsAccessLevel').value,
      fileBlobId: fileBlobId,
      tags: tags,
      isPublished: document.getElementById('rsPublished').checked,
      isPinned: document.getElementById('rsPinned').checked,
    };

    if (!body.title) return toast('제목을 입력해주세요');

    const btn = e.target.querySelector('button[type="submit"]');
    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    try {
      const res = id
        ? await api('/api/admin/resources', { method: 'PATCH', body: Object.assign({ id: Number(id) }, body) })
        : await api('/api/admin/resources', { method: 'POST', body: body });

      if (res.ok) {
        toast((res.data && res.data.message) || '저장되었습니다');
        const modal = document.getElementById('resourceEditModal');
        if (modal) modal.classList.remove('show');
        loadResources();
      } else {
        toast((res.data && res.data.error) || '저장 실패');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
  }

  /* ────────── 자료 삭제 (모달 내) ────────── */
  async function deleteResource() {
    const id = Number(document.getElementById('rsEditId').value);
    if (!id) return;
    if (!confirm('이 자료를 삭제하시겠습니까?\n\n파일도 함께 삭제됩니다.')) return;

    const res = await api('/api/admin/resources?id=' + id, { method: 'DELETE' });
    if (res.ok) {
      toast('삭제되었습니다');
      const modal = document.getElementById('resourceEditModal');
      if (modal) modal.classList.remove('show');
      loadResources();
    } else {
      toast((res.data && res.data.error) || '삭제 실패');
    }
  }

  /* ────────── 카테고리 관리 모달 ────────── */
  async function openCategoryModal() {
    const modal = document.getElementById('resourceCategoryModal');
    const body = document.getElementById('rsCategoryBody');
    if (!modal || !body) return;

    body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3)">로딩 중...</div>';
    modal.classList.add('show');

    const res = await api('/api/admin/resource-categories');
    if (!res.ok) {
      body.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center">조회 실패</div>';
      return;
    }
    const list = res.data.data.list || [];

    const headerHtml =
      '<div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">' +
        '<p style="margin:0;font-size:12.5px;color:var(--text-3)">💡 자료 카테고리를 추가/수정/삭제할 수 있습니다.</p>' +
        '<button type="button" class="btn-sm btn-sm-primary" id="rsCatAddBtn">+ 새 카테고리</button>' +
      '</div>';

    const tableHeader =
      '<table class="tbl" style="width:100%">' +
        '<thead><tr>' +
          '<th style="width:60px;text-align:center">아이콘</th>' +
          '<th style="width:140px">코드</th>' +
          '<th>이름</th>' +
          '<th style="width:70px;text-align:right">자료수</th>' +
          '<th style="width:130px">관리</th>' +
        '</tr></thead>';

    let tableBody;
    if (list.length === 0) {
      tableBody = '<tbody><tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-3)">카테고리가 없습니다</td></tr></tbody>';
    } else {
      tableBody = '<tbody>' + list.map(function (c) {
        return '<tr>' +
          '<td style="text-align:center;font-size:18px">' + (c.icon || '—') + '</td>' +
          '<td style="font-family:Inter;font-size:11.5px;color:var(--text-3)">' + escapeHtml(c.code) + '</td>' +
          '<td>' +
            '<strong>' + escapeHtml(c.nameKo) + '</strong>' +
            (c.description
              ? '<div style="font-size:11px;color:var(--text-3);margin-top:2px">' + escapeHtml(c.description) + '</div>'
              : '') +
          '</td>' +
          '<td style="text-align:right;font-family:Inter">' + (c.resourceCount || 0) + '</td>' +
          '<td>' +
            '<button type="button" class="btn-sm btn-sm-ghost" data-rscat-act="edit" data-id="' + c.id + '" style="font-size:11px">수정</button>' +
            '<button type="button" class="btn-sm btn-sm-ghost" data-rscat-act="delete" data-id="' + c.id + '" data-name="' + escapeHtml(c.nameKo) + '" style="font-size:11px;color:var(--danger)">삭제</button>' +
          '</td>' +
        '</tr>';
      }).join('') + '</tbody>';
    }

    body.innerHTML = headerHtml + tableHeader + tableBody + '</table>';
  }

  /* ────────── 카테고리 CRUD 액션 ────────── */
  async function handleCategoryAction(action, id, name) {
    if (action === 'add' || action === 'edit') {
      const isEdit = action === 'edit';
      let initialData = {
        code: '', nameKo: '', description: '',
        icon: '', sortOrder: 0, isActive: true,
      };

      if (isEdit && id) {
        const res = await api('/api/admin/resource-categories?id=' + id);
        if (res.ok) initialData = res.data.data.category;
      }

      const code = prompt('카테고리 코드 (영문/숫자/밑줄):', initialData.code || '');
      if (code === null) return;
      const nameKo = prompt('카테고리 이름 (한글):', initialData.nameKo || '');
      if (nameKo === null) return;
      const icon = prompt('아이콘 (이모지):', initialData.icon || '');
      if (icon === null) return;
      const description = prompt('설명 (선택):', initialData.description || '') || '';

      const body = {
        code: code.trim(),
        nameKo: nameKo.trim(),
        icon: icon.trim() || null,
        description: description.trim() || null,
        sortOrder: initialData.sortOrder || 0,
        isActive: initialData.isActive !== false,
      };

      if (!body.code || !body.nameKo) {
        return toast('코드와 이름은 필수입니다');
      }

      const res = isEdit
        ? await api('/api/admin/resource-categories', { method: 'PATCH', body: Object.assign({ id: id }, body) })
        : await api('/api/admin/resource-categories', { method: 'POST', body: body });

      if (res.ok) {
        toast(isEdit ? '수정되었습니다' : '생성되었습니다');
        _categoriesCache = null;
        openCategoryModal();
      } else {
        toast((res.data && res.data.error) || '실패');
      }
      return;
    }

    if (action === 'delete') {
      if (!confirm('카테고리 "' + name + '"을(를) 삭제하시겠습니까?\n\n연결된 자료는 카테고리 없음으로 변경됩니다.')) return;
      const res = await api('/api/admin/resource-categories?id=' + id, { method: 'DELETE' });
      if (res.ok) {
        toast((res.data && res.data.message) || '삭제되었습니다');
        _categoriesCache = null;
        openCategoryModal();
      } else {
        toast((res.data && res.data.error) || '삭제 실패');
      }
    }
  }

  /* ────────── 이벤트 바인딩 ────────── */
  function setup() {
    /* 자료실 탭 활성화 감지 */
    document.addEventListener('click', function (e) {
      const tabBtn = e.target.closest('[data-tab="resources"], [data-ct="resources"]');
      if (tabBtn) {
        setTimeout(loadResources, 100);
      }

      /* 새 자료 버튼 */
      if (e.target.closest('#rsNewBtn')) {
        e.preventDefault();
        openResourceModal(null);
        return;
      }

      /* 카테고리 관리 버튼 */
      if (e.target.closest('#rsCategoryBtn')) {
        e.preventDefault();
        openCategoryModal();
        return;
      }

      /* 카테고리 추가 버튼 (모달 내) */
      if (e.target.closest('#rsCatAddBtn')) {
        e.preventDefault();
        handleCategoryAction('add');
        return;
      }

      /* 자료 삭제 버튼 (모달 내) */
      if (e.target.closest('#rsDeleteBtn')) {
        e.preventDefault();
        deleteResource();
        return;
      }

      /* 행 액션 (수정/삭제) */
      const rsBtn = e.target.closest('[data-rs-act]');
      if (rsBtn) {
        e.preventDefault();
        const act = rsBtn.dataset.rsAct;
        const id = Number(rsBtn.dataset.id);
        if (act === 'edit') {
          openResourceModal(id);
        } else if (act === 'delete') {
          const title = rsBtn.dataset.title || '';
          if (confirm('"' + title + '"을(를) 삭제하시겠습니까?')) {
            api('/api/admin/resources?id=' + id, { method: 'DELETE' }).then(function (r) {
              if (r.ok) {
                toast('삭제되었습니다');
                loadResources();
              } else {
                toast((r.data && r.data.error) || '실패');
              }
            });
          }
        }
        return;
      }

      /* 카테고리 액션 */
      const catBtn = e.target.closest('[data-rscat-act]');
      if (catBtn) {
        e.preventDefault();
        handleCategoryAction(
          catBtn.dataset.rscatAct,
          Number(catBtn.dataset.id),
          catBtn.dataset.name
        );
        return;
      }
    });

    /* 파일 선택 시 상태 표시 */
    const fileInput = document.getElementById('rsFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        const statusEl = document.getElementById('rsFileStatus');
        if (statusEl) {
          statusEl.textContent = file
            ? (file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)')
            : '미선택';
        }
      });
    }

    /* 검색 디바운스 */
    const qInput = document.getElementById('rsFilterQ');
    if (qInput) {
      qInput.addEventListener('input', function () {
        clearTimeout(_rsSearchTimer);
        _rsSearchTimer = setTimeout(loadResources, 400);
      });
    }

    /* 필터 즉시 적용 */
    ['rsFilterCategory', 'rsFilterAccess', 'rsFilterPublished'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', loadResources);
    });

    /* 폼 제출 */
    const form = document.getElementById('resourceEditForm');
    if (form) form.addEventListener('submit', saveResource);
  }

  /* 외부 노출 */
  window.SIREN_ADMIN_RESOURCES = {
    loadResources: loadResources,
    openResourceModal: openResourceModal,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();