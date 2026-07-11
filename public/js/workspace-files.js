/* ═══════════════════════════════════════════════
   SIREN 파일함 — workspace-files.js (Step 7)
   Phase 3-extra Step 7 — 검색+ZIP+공유+우클릭
   ═══════════════════════════════════════════════ */
(function() {
  'use strict';
  if (window._wfInitialized) return;
  window._wfInitialized = true;

  /* ───────── 상태 관리 ───────── */
  const state = {
    currentFolderId: 0,
    currentView: 'all',
    sortBy: 'date-desc',
    searchKeyword: '',
    folders: [],
    files: [],
    selectedFileIds: new Set(),
    me: null,
    members: [],
    breadcrumbPath: [{ id: 0, name: '홈' }],
    contextTarget: null,         // { type, id, name } 우클릭 대상
    moveSelectedFolderId: 0,     // 이동 다이얼로그 선택
    fileOffset: 0,               // [감사#74] 페이지네이션 offset
    fileTotal: 0,                // [감사#74] 서버 총 파일 수
    trashFolders: [],            // [감사#21] 휴지통 폴더 목록
  };

  /* ───────── API 클라이언트 ───────── */
  async function api(path, options = {}) {
    const opts = {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    // [감사#17] noAuthRedirect 옵션이면 알럿·리다이렉트 없이 throw만 (인증 탐침용 — admin/me 폴백 도달)
    if (res.status === 401) {
      if (!options.noAuthRedirect) {
        alert('관리자 로그인이 필요합니다');
        location.href = '/admin.html';
      }
      throw new Error('unauthorized');
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
    if (!res.ok) {
      const msg = json?.error || json?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  /* ───────── 토스트 ───────── */
  function toast(msg, type = 'default') {
    const container = document.getElementById('wfToastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'wf-toast' + (type !== 'default' ? ' ' + type : '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  /* ───────── 모달 공통 ───────── */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-hidden', 'false');
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-hidden', 'true');
  }

  /* ───────── 유틸 ───────── */
  function formatSize(bytes) {
    if (!bytes || bytes < 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
    return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit' });
  }

  function fileIcon(name) {
    if (!name) return '';
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      pdf: '', doc: '', docx: '',
      xls: '', xlsx: '', csv: '',
      ppt: '', pptx: '',
      jpg: '', jpeg: '', png: '', gif: '', webp: '', svg: '',
      mp4: '', mov: '', avi: '',
      mp3: '', wav: '',
      zip: '', rar: '', '7z': '',
      txt: '', md: '',
    };
    return map[ext] || '';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ───────── 동적 스크립트 로드 (CDN fallback) ───────── */
  const loadedScripts = new Set();
  async function loadScript(urls) {
    const urlList = Array.isArray(urls) ? urls : [urls];
    const key = urlList[0];
    if (loadedScripts.has(key)) return true;
    for (const url of urlList) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = url;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
          setTimeout(() => reject(new Error('timeout')), 8000);
        });
        loadedScripts.add(key);
        return true;
      } catch (err) {
        console.warn('[loadScript] failed:', url, '→ trying next');
      }
    }
    throw new Error('모든 CDN 소스에서 로드 실패');
  }

  /* ───────── 폴더 로드 ───────── */
  async function loadFolders() {
    try {
      const res = await api('/api/admin-workspace-folders?list=1');
      state.folders = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
      renderFolderTree();
    } catch (err) {
      console.error('[folders] load failed:', err);
      const tree = document.getElementById('wfFolderTree');
      if (tree) tree.innerHTML = '<div class="wf-tree-loading">로드 실패</div>';
    }
  }

  function renderFolderTree() {
    const tree = document.getElementById('wfFolderTree');
    if (!tree) return;
    const byParent = {};
    state.folders.forEach(f => {
      const pid = f.parentId || 0;
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(f);
    });

    function renderNode(parentId, depth) {
      const children = byParent[parentId] || [];
      if (!children.length) return '';
      return children.map(f => {
        const hasChildren = (byParent[f.id] || []).length > 0;
        const isActive = f.id === state.currentFolderId;
        const shareIcon = f.isShared ? ' <span class="wf-share-indicator"></span>' : '';
        const childHtml = renderNode(f.id, depth + 1);
        return `
          <div>
            <div class="wf-tree-node ${isActive ? 'active' : ''}"
                 data-folder-id="${f.id}"
                 data-folder-name="${escapeHtml(f.name)}"
                 style="padding-left:${8 + depth * 12}px">
              <span class="wf-tree-toggle ${hasChildren ? '' : 'empty'}" data-toggle="${f.id}"></span>
              <span></span>
              <span>${escapeHtml(f.name)}${shareIcon}</span>
            </div>
            <div class="wf-tree-children" data-children="${f.id}">${childHtml}</div>
          </div>
        `;
      }).join('');
    }

    const rootHtml = `
      <div class="wf-tree-node ${state.currentFolderId === 0 ? 'active' : ''}" data-folder-id="0" data-folder-name="홈">
        <span class="wf-tree-toggle empty"></span>
        <span></span>
        <span>홈</span>
      </div>
      ${renderNode(0, 0)}
    `;
    tree.innerHTML = rootHtml;

    tree.querySelectorAll('.wf-tree-node').forEach(node => {
      node.addEventListener('click', e => {
        if (e.target.dataset.toggle) return;
        const fid = parseInt(node.dataset.folderId, 10);
        navigateToFolder(fid);
      });
      node.addEventListener('contextmenu', e => {
        e.preventDefault();
        const fid = parseInt(node.dataset.folderId, 10);
        const fname = node.dataset.folderName;
        if (fid === 0) return;
        showContextMenu(e.clientX, e.clientY, 'folder', fid, fname);
      });
    });

    tree.querySelectorAll('.wf-tree-toggle[data-toggle]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const fid = btn.dataset.toggle;
        const children = tree.querySelector(`[data-children="${fid}"]`);
        if (children) {
          children.classList.toggle('open');
          btn.classList.toggle('expanded');
        }
      });
    });
  }

  /* ───────── 브레드크럼 ───────── */
  function buildBreadcrumbPath(folderId) {
    const path = [{ id: 0, name: '홈' }];
    if (folderId === 0) return path;
    const chain = [];
    let cur = state.folders.find(f => f.id === folderId);
    while (cur) {
      chain.unshift({ id: cur.id, name: cur.name });
      if (!cur.parentId || cur.parentId === 0) break;
      cur = state.folders.find(f => f.id === cur.parentId);
    }
    return path.concat(chain);
  }

  function renderBreadcrumb() {
    const bc = document.getElementById('wfBreadcrumb');
    if (!bc) return;
    const path = state.breadcrumbPath;
    bc.innerHTML = path.map((p, idx) => {
      const isLast = idx === path.length - 1;
      return `
        ${idx > 0 ? '<span class="wf-crumb-sep">›</span>' : ''}
        <span class="wf-crumb ${isLast ? 'active' : ''}" data-folder-id="${p.id}">
          ${idx === 0 ? '' : ''}${escapeHtml(p.name)}
        </span>
      `;
    }).join('');
    bc.querySelectorAll('.wf-crumb').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('active')) return;
        const fid = parseInt(el.dataset.folderId, 10);
        navigateToFolder(fid);
      });
    });
  }

  async function navigateToFolder(folderId) {
    state.currentFolderId = folderId;
    state.selectedFileIds.clear();
    state.breadcrumbPath = buildBreadcrumbPath(folderId);
    renderFolderTree();
    renderBreadcrumb();
    await loadFiles();
  }

  /* ───────── 파일 리스트 ───────── */
  const FILE_PAGE_SIZE = 100;
  async function loadFiles(append = false) {
    const tbody = document.getElementById('wfFileListBody');
    const empty = document.getElementById('wfEmptyState');
    if (!tbody) return;
    if (!append) {
      state.fileOffset = 0;
      tbody.innerHTML = '<tr class="wf-list-loading"><td colspan="7">불러오는 중...</td></tr>';
      if (empty) empty.style.display = 'none';
    }

    try {
      const params = new URLSearchParams();
      if (state.currentView === 'trash') {
        params.set('trash', '1');
        // [감사#21] 휴지통 폴더도 함께 로드
        await loadTrashFolders();
      } else {
        params.set('folderId', String(state.currentFolderId));
        if (state.currentView === 'mine') params.set('mine', '1');
        if (state.currentView === 'shared') params.set('shared', '1');
      }
      if (state.searchKeyword) params.set('search', state.searchKeyword);
      // [감사#74] offset 페이지네이션 — 100건 초과분에 '더 보기'로 도달 가능하게
      params.set('limit', String(FILE_PAGE_SIZE));
      params.set('offset', String(state.fileOffset));
      const res = await api(`/api/admin-workspace-files?${params}`);
      const items = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
      state.fileTotal = Number(res.data?.total ?? items.length);
      state.files = append ? state.files.concat(items) : items;
      state.fileOffset = state.files.length;
      renderFileList();
    } catch (err) {
      console.error('[files] load failed:', err);
      tbody.innerHTML = `<tr class="wf-list-loading"><td colspan="7" style="color:#dc2626">로드 실패: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderFileList() {
    const tbody = document.getElementById('wfFileListBody');
    const empty = document.getElementById('wfEmptyState');
    const count = document.getElementById('wfFileCount');
    if (!tbody) return;

    let files = state.files.slice();
    files = sortFiles(files, state.sortBy);
    // [감사#74] 로드된/전체 건수 표기 — 잘린 사실을 운영자가 알 수 있게
    if (count) {
      count.textContent = (state.fileTotal > files.length)
        ? `파일 ${files.length}/${state.fileTotal}개`
        : `파일 ${files.length}개`;
    }

    const trashFolders = (state.currentView === 'trash') ? (state.trashFolders || []) : [];
    if (!files.length && !trashFolders.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    // [감사#21] 휴지통 폴더 섹션 (파일 행 위에 표시)
    const folderRowsHtml = trashFolders.map(fd => `
        <tr class="wf-list-row wf-trash-folder-row" data-folder-id="${fd.id}">
          <td class="wf-col-check"></td>
          <td class="wf-col-icon"></td>
          <td class="wf-col-name">${escapeHtml(fd.name)} <small style="color:#9ca3af">(폴더)</small></td>
          <td class="wf-col-owner">${escapeHtml(fd.ownerName || fd.ownerEmail || '—')}</td>
          <td class="wf-col-size">—</td>
          <td class="wf-col-date">${renderDday(fd.deletedAt)}</td>
          <td class="wf-col-actions">
            <div class="wf-row-actions">
              <button class="wf-row-action-btn" data-faction="restore-folder" data-fid="${fd.id}" title="복원"></button>
              <button class="wf-row-action-btn" data-faction="purge-folder" data-fid="${fd.id}" data-fname="${escapeHtml(fd.name)}" title="영구 삭제">${Icons.svg('x')}</button>
            </div>
          </td>
        </tr>`).join('');

    tbody.innerHTML = folderRowsHtml + files.map(f => {
      const isSelected = state.selectedFileIds.has(f.id);
      const ownerName = f.ownerName || f.ownerEmail || '—';
      const isTrash = state.currentView === 'trash';
      const shareIcon = f.isShared ? ' <span class="wf-share-indicator" title="공유됨"></span>' : '';
      return `
        <tr class="wf-list-row ${isSelected ? 'selected' : ''}"
            data-file-id="${f.id}"
            data-file-name="${escapeHtml(f.name)}">
          <td class="wf-col-check">
            <input type="checkbox" ${isSelected ? 'checked' : ''} data-select="${f.id}" />
          </td>
          <td class="wf-col-icon">${fileIcon(f.name)}</td>
          <td class="wf-col-name">${escapeHtml(f.name)}${shareIcon}</td>
          <td class="wf-col-owner">${escapeHtml(ownerName)}</td>
          <td class="wf-col-size">${formatSize(f.sizeBytes)}</td>
          <td class="wf-col-date">${isTrash ? renderDday(f.deletedAt) : formatDate(f.updatedAt || f.createdAt)}</td>
          <td class="wf-col-actions">
            <div class="wf-row-actions">
              ${isTrash ? `
                <button class="wf-row-action-btn" data-action="restore" data-id="${f.id}" title="복원"></button>
                <button class="wf-row-action-btn" data-action="purge" data-id="${f.id}" title="영구 삭제">${Icons.svg('x')}</button>
              ` : `
                <button class="wf-row-action-btn" data-action="download" data-id="${f.id}" title="다운로드"></button>
                <button class="wf-row-action-btn" data-action="share" data-id="${f.id}" title="공유"></button>
                <button class="wf-row-action-btn" data-action="rename" data-id="${f.id}" title="이름 변경"></button>
                <button class="wf-row-action-btn" data-action="delete" data-id="${f.id}" title="휴지통"></button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('') + ((state.currentView !== 'trash' && state.fileTotal > files.length)
      ? `<tr class="wf-load-more-row"><td colspan="7" style="text-align:center;padding:12px">
           <button class="wf-load-more-btn" data-load-more style="padding:6px 16px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer">
             더 보기 (${files.length}/${state.fileTotal})
           </button></td></tr>`
      : '');

    // [감사#21] 휴지통 폴더 복원·영구삭제 버튼
    tbody.querySelectorAll('[data-faction]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const fid = parseInt(btn.dataset.fid, 10);
        if (btn.dataset.faction === 'restore-folder') restoreFolder(fid);
        else if (btn.dataset.faction === 'purge-folder') openPurgeConfirm('folder', fid, btn.dataset.fname || '폴더');
      });
    });

    // [감사#74] 더 보기 — 다음 페이지 append 로드
    const moreBtn = tbody.querySelector('[data-load-more]');
    if (moreBtn) moreBtn.addEventListener('click', () => loadFiles(true));

    // 체크박스
    tbody.querySelectorAll('input[data-select]').forEach(cb => {
      cb.addEventListener('change', e => {
        const fid = parseInt(cb.dataset.select, 10);
        if (cb.checked) state.selectedFileIds.add(fid);
        else state.selectedFileIds.delete(fid);
        updateBulkButtons();
        const row = cb.closest('tr');
        if (row) row.classList.toggle('selected', cb.checked);
      });
    });

    // 액션 버튼
    tbody.querySelectorAll('.wf-row-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        handleFileAction(action, id);
      });
    });

    // 우클릭 컨텍스트 메뉴 (파일)
    tbody.querySelectorAll('.wf-list-row').forEach(row => {
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        const fid = parseInt(row.dataset.fileId, 10);
        const fname = row.dataset.fileName;
        showContextMenu(e.clientX, e.clientY, 'file', fid, fname);
      });
    });
  }

  function sortFiles(files, sortBy) {
    const sorted = files.slice();
    switch (sortBy) {
      case 'name-asc':  sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')); break;
      case 'name-desc': sorted.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ko')); break;
      case 'date-asc':  sorted.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0)); break;
      case 'date-desc': sorted.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)); break;
      case 'size-asc':  sorted.sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0)); break;
      case 'size-desc': sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)); break;
    }
    return sorted;
  }

  function updateBulkButtons() {
    const zipBtn = document.getElementById('wfBtnZipDownload');
    const delBtn = document.getElementById('wfBtnDelete');
    const restoreBtn = document.getElementById('wfBtnRestoreAll');
    const hasSelection = state.selectedFileIds.size > 0;
    if (zipBtn) zipBtn.disabled = !hasSelection;
    if (delBtn) delBtn.disabled = !hasSelection;
    if (restoreBtn) restoreBtn.disabled = !hasSelection;
  }

  /* ───────── 파일 액션 ───────── */
  async function handleFileAction(action, fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;
    switch (action) {
      case 'download': await downloadFile(fileId); break;
      case 'rename':   openRenameModal('file', fileId, file.name); break;
      case 'delete':
        if (!confirm(`"${file.name}" 파일을 휴지통으로 이동하시겠습니까?\n\n30일 후 자동으로 영구 삭제됩니다.\n그 전까지는 휴지통에서 복원할 수 있습니다.`)) return;
        await deleteFile(fileId); break;
      case 'share':    openShareModal('file', fileId, file.name); break;
      case 'restore':
        if (!confirm(`"${file.name}" 파일을 복원하시겠습니까?`)) return;
        await restoreFile(fileId); break;
      case 'purge':    openPurgeConfirm('file', fileId, file.name); break;
      case 'move':     openMoveDialog('file', fileId, file.name); break;
    }
  }

  async function downloadFile(fileId) {
    try {
      const res = await api(`/api/admin-workspace-file-download?id=${fileId}`);
      const url = res.data?.downloadUrl || res.data?.url || res.downloadUrl;
      if (!url) throw new Error('다운로드 URL 없음');
      window.open(url, '_blank');
    } catch (err) {
      toast('다운로드 실패: ' + err.message, 'error');
    }
  }

  async function deleteFile(fileId) {
    try {
      await api(`/api/admin-workspace-files?id=${fileId}`, { method: 'DELETE' });
      toast('휴지통으로 이동됨', 'success');
      await loadFiles();
    } catch (err) {
      toast('삭제 실패: ' + err.message, 'error');
    }
  }

  async function restoreFile(fileId) {
    try {
      await api(`/api/admin-workspace-files?id=${fileId}&action=restore`, {
        method: 'PATCH'
      });
      toast('복원됨', 'success');
      await loadFiles();
    } catch (err) {
      toast('복원 실패: ' + err.message, 'error');
    }
  }

  async function purgeFile(fileId) {
    try {
      await api(`/api/admin-workspace-file-purge?fileId=${fileId}`, { method: 'DELETE' });
      toast('영구 삭제됨', 'success');
      closeModal('wfDeleteConfirmModal');
      await loadFiles();
    } catch (err) {
      toast('영구 삭제 실패: ' + err.message, 'error');
    }
  }

  /* ───────── 휴지통 폴더 (감사#21) ───────── */
  async function loadTrashFolders() {
    try {
      const res = await api('/api/admin-workspace-folders?trash=1');
      state.trashFolders = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
    } catch (err) {
      console.warn('[files] 휴지통 폴더 로드 실패:', err);
      state.trashFolders = [];
    }
  }

  async function restoreFolder(folderId) {
    if (!confirm('이 폴더를 복원하시겠습니까?')) return;
    try {
      await api(`/api/admin-workspace-folders?id=${folderId}&action=restore`, { method: 'PATCH' });
      toast('폴더가 복원되었습니다', 'success');
      await loadFolders();
      await loadFiles();
    } catch (err) {
      toast('폴더 복원 실패: ' + err.message, 'error');
    }
  }

  /* ───────── 업로드 ───────── */
  async function uploadFiles(fileList) {
    const queue = document.getElementById('wfUploadQueue');
    if (!queue) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    for (const file of files) {
      if (file.size > 500 * 1024 * 1024) {
        toast(`"${file.name}" — 500MB 초과로 제외`, 'error');
        continue;
      }
      await uploadOne(file);
    }
    await loadFiles();
  }

  async function uploadOne(file) {
    const queue = document.getElementById('wfUploadQueue');
    const item = document.createElement('div');
    item.className = 'wf-upload-item';
    item.innerHTML = `
      <span class="wf-upload-item-name">${escapeHtml(file.name)}</span>
      <span class="wf-upload-item-size">${formatSize(file.size)}</span>
      <div style="flex-basis:100%">
        <div class="wf-upload-progress"><div class="wf-upload-progress-bar" style="width:0%"></div></div>
        <div class="wf-upload-status">준비 중...</div>
      </div>
    `;
    queue.appendChild(item);
    const bar = item.querySelector('.wf-upload-progress-bar');
    const status = item.querySelector('.wf-upload-status');

    try {
      status.textContent = 'URL 요청 중...';
      const presignRes = await api('/api/admin-workspace-file-presign', {
        method: 'POST',
        body: {
          name: file.name,
          sizeBytes: file.size,
          mimeType: file.type || 'application/octet-stream',
          folderId: state.currentFolderId || null,
        }
      });
      const { uploadUrl, r2Key, fileId } = presignRes.data || presignRes || {};
      if (!uploadUrl) throw new Error('업로드 URL 없음');

      status.textContent = '업로드 중...';
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            bar.style.width = pct + '%';
            status.textContent = `업로드 중... ${pct}%`;
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('업로드 HTTP ' + xhr.status));
        };
        xhr.onerror = () => reject(new Error('네트워크 오류'));
        xhr.send(file);
      });

      status.textContent = '완료 처리 중...';
      await api('/api/admin-workspace-file-confirm', {
        method: 'POST',
        body: { fileId, r2Key }
      });

      status.textContent = '완료';
      status.className = 'wf-upload-status success';
      bar.style.width = '100%';
    } catch (err) {
      status.textContent = '실패: ' + err.message;
      status.className = 'wf-upload-status error';
    }
  }

  /* ───────── 폴더 CRUD ───────── */
  async function createFolder(name, parentId) {
    try {
      await api('/api/admin-workspace-folders', {
        method: 'POST',
        body: { name, parentId }
      });
      toast('폴더 생성됨', 'success');
      closeModal('wfNewFolderModal');
      await loadFolders();
    } catch (err) {
      toast('폴더 생성 실패: ' + err.message, 'error');
    }
  }

  async function renameItem(type, id, newName) {
    try {
      if (type === 'folder') {
        await api(`/api/admin-workspace-folders?id=${id}`, {
          method: 'PATCH',
          body: { name: newName }
        });
      } else {
        await api(`/api/admin-workspace-files?id=${id}`, {
          method: 'PATCH',
          body: { name: newName }
        });
      }
      toast('이름 변경됨', 'success');
      closeModal('wfRenameModal');
      if (type === 'folder') await loadFolders();
      await loadFiles();
    } catch (err) {
      toast('이름 변경 실패: ' + err.message, 'error');
    }
  }

  async function deleteFolder(id, name) {
    if (!confirm(`폴더 "${name}"을(를) 휴지통으로 이동하시겠습니까?\n폴더 내 모든 파일도 함께 이동됩니다.\n\n30일 후 자동으로 영구 삭제됩니다.`)) return;
    try {
      await api(`/api/admin-workspace-folders?id=${id}`, { method: 'DELETE' });
      toast('폴더가 휴지통으로 이동됨', 'success');
      if (state.currentFolderId === id) {
        await navigateToFolder(0);
      } else {
        await loadFolders();
        await loadFiles();
      }
    } catch (err) {
      toast('폴더 삭제 실패: ' + err.message, 'error');
    }
  }


  /* ───────── 공유 관리 ───────── */
  async function loadMembers() {
    try {
      const res = await api('/api/admin-workspace-members');
      state.members = res.data?.data || res.data?.items || (Array.isArray(res.data) ? res.data : []) || [];
    } catch (err) {
      console.error('[members] load failed:', err);
      state.members = [];
    }
  }

  async function openShareModal(type, id, name) {
    const targetEl = document.getElementById('wfShareTarget');
    if (targetEl) {
      targetEl.innerHTML = `
        <span class="wf-share-icon">${type === 'folder' ? '' : ''}</span>
        <span class="wf-share-name">${escapeHtml(name)}</span>
      `;
    }
    document.getElementById('wfShareTargetType').value = type;
    document.getElementById('wfShareTargetId').value = id;

    const sel = document.getElementById('wfShareMemberSelect');
    if (sel) {
      sel.innerHTML = '<option value="">-- 멤버 선택 --</option>' +
        state.members.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.role)})</option>`).join('');
    }

    await loadShareList(type, id);
    openModal('wfShareModal');
  }


  async function loadShareList(type, id) {
    try {
      const params = new URLSearchParams();
      params.set('targetType', type);
      params.set('targetId', String(id));
      // Q3-001 fix: 소유자 검증 있는 보호판 엔드포인트로 일원화 (무검증 workspace-file-share 폐기)
      const res = await api(`/api/admin-workspace-file-share?${params}`);
      const shares = res.shares || res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
      // [감사#23] 공유목록 API엔 isShared 필드가 없음 → 현재 파일/폴더 상태에서 공개 여부를 읽음(항상 OFF로 뜨던 문제·반전 사고 방지)
      const cur = type === 'folder'
        ? (state.folders || []).find(x => Number(x.id) === Number(id))
        : (state.files || []).find(x => Number(x.id) === Number(id));
      const isPublic = cur ? !!cur.isShared : false;

      const publicToggle = document.getElementById('wfSharePublic');
      if (publicToggle) publicToggle.checked = !!isPublic;

      const list = document.getElementById('wfShareList');
      if (!list) return;
      if (!shares.length) {
        list.innerHTML = '<li class="wf-share-empty">아직 공유된 멤버가 없습니다.</li>';
      } else {
        list.innerHTML = shares.map(s => `
          <li>
            <span>${escapeHtml(s.sharedWithName || s.memberName || ('#' + s.sharedWith))} <small>(${escapeHtml(s.permission)})</small></span>
            <span style="display:flex;gap:4px;">
              <select class="wf-perm-change" data-share-id="${s.id}" style="font-size:12px;padding:2px 4px;">
                <option value="view" ${s.permission === 'view' ? 'selected' : ''}>조회</option>
                <option value="edit" ${s.permission === 'edit' ? 'selected' : ''}>편집</option>
              </select>
              <button class="wf-row-action-btn" data-remove-share="${s.id}" title="제거">${Icons.svg('x')}</button>
            </span>
          </li>
        `).join('');
        list.querySelectorAll('[data-remove-share]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const shareId = parseInt(btn.dataset.removeShare, 10);
            await removeShare(shareId, type, id);
          });
        });
        list.querySelectorAll('.wf-perm-change').forEach(sel => {
          sel.addEventListener('change', async e => {
            const shareId = parseInt(sel.dataset.shareId, 10);
            await updateSharePermission(shareId, e.target.value, type, id);
          });
        });
      }
    } catch (err) {
      console.error('[shares] load failed:', err);
      toast('공유 목록 로드 실패', 'error');
    }
  }

  async function addShare(type, id, memberId, permission) {
    try {
      const body = {
        targetType: type,
        targetId: id,
        sharedWith: memberId,
        permission,
        expiresAt: null,
      };
      await api('/api/admin-workspace-file-share', { method: 'POST', body });
      toast('공유되었습니다.', 'success');
      await loadShareList(type, id);
    } catch (err) {
      toast('공유 추가 실패: ' + err.message, 'error');
    }
  }

  async function removeShare(shareId, type, id) {
    if (!confirm('이 공유를 해제하시겠습니까?')) return;
    try {
      // Q3-001 fix: 보호판은 ?id= 쿼리로 shareId 수신 (소유자/super 검증 포함)
      await api(`/api/admin-workspace-file-share?id=${shareId}`, {
        method: 'DELETE',
      });
      toast('공유가 취소되었습니다.', 'success');
      await loadShareList(type, id);
    } catch (err) {
      toast('공유 해제 실패: ' + err.message, 'error');
    }
  }

  async function updateSharePermission(shareId, permission, type, id) {
    try {
      await api(`/api/admin-workspace-file-share?id=${shareId}`, {
        method: 'PATCH',
        body: { permission }
      });
      toast('권한 변경됨', 'success');
      await loadShareList(type, id);
    } catch (err) {
      toast('권한 변경 실패: ' + err.message, 'error');
    }
  }

  async function togglePublicShare(type, id, isPublic) {
    try {
      // [감사#23] 목표값(value)을 명시 전송 — 서버 맹목 반전으로 인한 공개/비공개 뒤집힘 방지
      const val = isPublic ? '1' : '0';
      const endpoint = type === 'folder'
        ? `/api/admin-workspace-folders?id=${id}&action=toggle-public&value=${val}`
        : `/api/admin-workspace-files?id=${id}&action=toggle-public&value=${val}`;
      await api(endpoint, { method: 'PATCH' });
      toast(isPublic ? '전체 공개됨' : '공개 해제됨', 'success');
      await loadFolders();
      await loadFiles();
    } catch (err) {
      toast('공개 설정 실패: ' + err.message, 'error');
    }
  }

  /* ───────── 모달 헬퍼 ───────── */
  function openRenameModal(type, id, currentName) {
    document.getElementById('wfRenameTargetType').value = type;
    document.getElementById('wfRenameTargetId').value = id;
    const input = document.getElementById('wfRenameInput');
    if (input) { input.value = currentName; setTimeout(() => input.focus(), 50); }
    openModal('wfRenameModal');
  }

  function openNewFolderModal(parentId) {
    const input = document.getElementById('wfNewFolderName');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
    const targetParent = parentId != null ? parentId : state.currentFolderId;
    state._newFolderParentId = targetParent;
    const parentEl = document.getElementById('wfNewFolderParent');
    if (parentEl) {
      let parentName = '홈';
      if (targetParent !== 0) {
        const f = state.folders.find(x => x.id === targetParent);
        if (f) parentName = f.name;
      }
      parentEl.innerHTML = `상위 폴더: <strong>${escapeHtml(parentName)}</strong>`;
    }
    openModal('wfNewFolderModal');
  }

  function openPurgeConfirm(type, id, name) {
    const detail = document.getElementById('wfDeleteConfirmDetail');
    if (detail) {
      detail.innerHTML = `
        <div style="margin-bottom:10px;font-size:14px;">
          <strong>${escapeHtml(name)}</strong> ${type === 'folder' ? '폴더' : '파일'}
        </div>
        <div class="wf-purge-warning">
          <strong style="color:#991b1b;font-size:13px;">영구 삭제하면 다음과 같이 처리됩니다:</strong>
          <ul>
            <li class="danger">${Icons.svg('x')} 복원할 수 없습니다</li>
            <li class="danger">${Icons.svg('x')} R2 저장소에서도 완전히 제거됩니다</li>
            ${type === 'folder' ? '<li class="danger">' + Icons.svg('x') + ' 폴더 안 모든 파일이 함께 영구 삭제됩니다</li>' : ''}
            <li class="info">${Icons.svg('check')} 삭제 내역만 감사 로그에 남습니다</li>
          </ul>
        </div>
      `;
    }
    const btn = document.getElementById('wfBtnConfirmDelete');
    if (btn) {
      btn.onclick = () => {
        if (type === 'file') purgeFile(id);
        else if (type === 'folder') purgeFolder(id);
      };
    }
    openModal('wfDeleteConfirmModal');
  }

  async function purgeFolder(folderId) {
    try {
      const res = await api(`/api/admin-workspace-folder-purge?folderId=${folderId}`, { method: 'DELETE' });
      const d = res.data || {};
      toast(`영구 삭제 완료 (폴더 ${d.foldersDeleted || 1}개, 파일 ${d.filesDeleted || 0}개)`, 'success');
      closeModal('wfDeleteConfirmModal');
      await loadFolders();
      await loadFiles();
    } catch (err) {
      toast('폴더 영구 삭제 실패: ' + err.message, 'error');
    }
  }

  /* D-day 계산 (휴지통 모드) */
  function renderDday(deletedAt) {
    if (!deletedAt) return '-';
    const deleted = new Date(deletedAt);
    if (isNaN(deleted.getTime())) return '-';
    const purgeDate = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000);
    const remainingMs = purgeDate.getTime() - Date.now();
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    if (remainingDays <= 0) return '<span class="wf-dday-urgent">곧 삭제</span>';
    const cls = remainingDays <= 7 ? 'wf-dday-urgent' : (remainingDays <= 14 ? 'wf-dday-warn' : 'wf-dday-safe');
    return `<span class="${cls}">D-${remainingDays}</span>`;
  }

  /* 일괄 복원 (휴지통 모드) */
  async function bulkRestore() {
    if (!state.selectedFileIds.size) return;
    if (!confirm(`선택된 ${state.selectedFileIds.size}개 파일을 복원하시겠습니까?`)) return;
    let success = 0, failed = 0;
    for (const fid of state.selectedFileIds) {
      try {
        await api(`/api/admin-workspace-files?id=${fid}&action=restore`, { method: 'PATCH' });
        success++;
      } catch (err) { failed++; console.error('bulk restore:', err); }
    }
    state.selectedFileIds.clear();
    updateBulkButtons();
    toast(`복원 ${success}건${failed > 0 ? ` / 실패 ${failed}건` : ''}`, success > 0 ? 'success' : 'error');
    await loadFiles();
  }

  /* ───────── 우클릭 컨텍스트 메뉴 ───────── */
  function showContextMenu(x, y, type, id, name) {
    let menu = document.getElementById('wfContextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'wfContextMenu';
      menu.className = 'wf-context-menu';
      document.body.appendChild(menu);
    }

    state.contextTarget = { type, id, name };

    const items = [];
    if (type === 'folder') {
      items.push({ icon: '', label: '하위 폴더 추가', action: 'newSubFolder' });
      items.push({ icon: '', label: '이름 변경', action: 'rename' });
      items.push({ icon: '', label: '공유 관리', action: 'share' });
      items.push({ divider: true });
      items.push({ icon: '', label: '휴지통으로 이동', action: 'delete', danger: true });
    } else {
      items.push({ icon: '', label: '다운로드', action: 'download' });
      items.push({ icon: '', label: '공유 관리', action: 'share' });
      items.push({ icon: '', label: '다른 폴더로 이동', action: 'move' });
      items.push({ icon: '', label: '이름 변경', action: 'rename' });
      items.push({ divider: true });
      items.push({ icon: '', label: '휴지통으로 이동', action: 'delete', danger: true });
    }

    menu.innerHTML = items.map(it => {
      if (it.divider) return '<div class="wf-context-divider"></div>';
      return `
        <div class="wf-context-item ${it.danger ? 'danger' : ''}" data-action="${it.action}">
          <span class="wf-context-icon">${it.icon}</span>
          <span>${escapeHtml(it.label)}</span>
        </div>
      `;
    }).join('');

    // 위치 조정 (화면 밖으로 안 나가게)
    const menuW = 180, menuH = items.length * 36;
    const finalX = Math.min(x, window.innerWidth - menuW - 8);
    const finalY = Math.min(y, window.innerHeight - menuH - 8);
    menu.style.left = finalX + 'px';
    menu.style.top = finalY + 'px';
    menu.classList.add('visible');

    menu.querySelectorAll('.wf-context-item').forEach(item => {
      item.addEventListener('click', () => {
        hideContextMenu();
        handleContextAction(item.dataset.action);
      });
    });
  }

  function hideContextMenu() {
    const menu = document.getElementById('wfContextMenu');
    if (menu) menu.classList.remove('visible');
    state.contextTarget = null;
  }

  function handleContextAction(action) {
    const t = state.contextTarget;
    if (!t) return;
    switch (action) {
      case 'newSubFolder': openNewFolderModal(t.id); break;
      case 'rename':       openRenameModal(t.type, t.id, t.name); break;
      case 'share':        openShareModal(t.type, t.id, t.name); break;
      case 'download':     downloadFile(t.id); break;
      case 'move':         openMoveDialog('file', t.id, t.name); break;
      case 'delete':
        if (t.type === 'folder') deleteFolder(t.id, t.name);
        else handleFileAction('delete', t.id);
        break;
    }
  }

  /* ───────── 이동 다이얼로그 ───────── */
  function openMoveDialog(type, id, name) {
    let modal = document.getElementById('wfMoveModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wfMoveModal';
      modal.className = 'wf-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML = `
        <div class="wf-modal-backdrop" data-close="wfMoveModal"></div>
        <div class="wf-modal-content wf-modal-sm">
          <div class="wf-modal-header">
            <h2>이동</h2>
            <button class="wf-modal-close" data-close="wfMoveModal">${Icons.svg('x')}</button>
          </div>
          <div class="wf-modal-body">
            <div class="wf-share-target" id="wfMoveTarget"></div>
            <div class="wf-field-label">이동할 폴더 선택:</div>
            <div class="wf-move-folder-list" id="wfMoveFolderList"></div>
          </div>
          <div class="wf-modal-footer">
            <button class="wf-btn wf-btn-default" data-close="wfMoveModal">취소</button>
            <button class="wf-btn wf-btn-primary" id="wfBtnConfirmMove">이동</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // 이벤트 위임
      modal.querySelectorAll('[data-close]').forEach(el => {
        el.addEventListener('click', () => closeModal('wfMoveModal'));
      });
      document.getElementById('wfBtnConfirmMove').addEventListener('click', confirmMove);
    }

    state.contextTarget = { type, id, name };
    state.moveSelectedFolderId = 0;

    const target = document.getElementById('wfMoveTarget');
    if (target) {
      target.innerHTML = `
        <span class="wf-share-icon">${type === 'folder' ? '' : ''}</span>
        <span class="wf-share-name">${escapeHtml(name)}</span>
      `;
    }

    renderMoveFolderList();
    openModal('wfMoveModal');
  }

  function renderMoveFolderList() {
    const list = document.getElementById('wfMoveFolderList');
    if (!list) return;
    const items = [{ id: 0, name: '홈 (루트)', depth: 0 }];
    state.folders.forEach(f => {
      items.push({ id: f.id, name: f.name, depth: f.depth || 0 });
    });
    list.innerHTML = items.map(it => `
      <div class="wf-move-folder-item ${it.id === state.moveSelectedFolderId ? 'selected' : ''}"
           data-folder-id="${it.id}"
           style="padding-left:${10 + (it.depth * 12)}px">
        ${it.id === 0 ? '' : ''}${escapeHtml(it.name)}
      </div>
    `).join('');
    list.querySelectorAll('.wf-move-folder-item').forEach(el => {
      el.addEventListener('click', () => {
        state.moveSelectedFolderId = parseInt(el.dataset.folderId, 10);
        renderMoveFolderList();
      });
    });
  }

  async function confirmMove() {
    const t = state.contextTarget;
    if (!t) return;
    const targetFolderId = state.moveSelectedFolderId;
    try {
      if (t.type === 'file') {
        await api(`/api/admin-workspace-files?id=${t.id}`, {
          method: 'PATCH',
          body: { folderId: targetFolderId }
        });
      } else {
        await api(`/api/admin-workspace-folders?id=${t.id}`, {
          method: 'PATCH',
          body: { parentId: targetFolderId }
        });
      }
      toast('이동 완료', 'success');
      closeModal('wfMoveModal');
      await loadFolders();
      await loadFiles();
    } catch (err) {
      toast('이동 실패: ' + err.message, 'error');
    }
  }

  /* ───────── ZIP 일괄 다운로드 ───────── */
  const JSZIP_CDNS = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  ];

  async function downloadAsZip() {
    const fileIds = Array.from(state.selectedFileIds);
    if (!fileIds.length) {
      toast('다운로드할 파일을 선택하세요', 'error');
      return;
    }

    showZipModal();
    updateZipStatus('JSZip 라이브러리 로드 중...', 0);

    try {
      await loadScript(JSZIP_CDNS);
      if (!window.JSZip) throw new Error('JSZip 로드 실패');
    } catch (err) {
      hideZipModal();
      toast('ZIP 라이브러리 로드 실패: ' + err.message, 'error');
      return;
    }

    const zip = new window.JSZip();
    const targets = fileIds
      .map(fid => state.files.find(f => f.id === fid))
      .filter(Boolean);

    let done = 0;
    const total = targets.length;

    for (const file of targets) {
      try {
        updateZipStatus(`다운로드 중: ${file.name}`, Math.round((done / total) * 80), file.name);
        const res = await api(`/api/admin-workspace-file-download?id=${file.id}`);
        const url = res.data?.downloadUrl || res.data?.url || res.downloadUrl;
        if (!url) throw new Error('URL 없음');
        const blobRes = await fetch(url);
        if (!blobRes.ok) throw new Error('HTTP ' + blobRes.status);
        const blob = await blobRes.blob();
        zip.file(file.name, blob);
        done += 1;
      } catch (err) {
        console.warn('[zip] failed:', file.name, err);
        toast(`"${file.name}" 다운로드 실패`, 'error');
      }
    }

    updateZipStatus('ZIP 압축 중...', 90);
    try {
      const blob = await zip.generateAsync({ type: 'blob' }, meta => {
        const pct = 90 + Math.round(meta.percent / 10);
        updateZipStatus('ZIP 압축 중...', pct);
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `siren-files-${ts}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      updateZipStatus(`완료 (${done}/${total} 파일)`, 100);
      setTimeout(hideZipModal, 1200);
      toast(`ZIP 다운로드 완료 (${done}/${total})`, 'success');
    } catch (err) {
      hideZipModal();
      toast('ZIP 생성 실패: ' + err.message, 'error');
    }
  }

  function showZipModal() {
    let modal = document.getElementById('wfZipModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wfZipModal';
      modal.className = 'wf-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML = `
        <div class="wf-modal-backdrop"></div>
        <div class="wf-modal-content wf-modal-sm">
          <div class="wf-modal-header">
            <h2>ZIP 다운로드</h2>
          </div>
          <div class="wf-modal-body">
            <div class="wf-zip-progress">
              <div class="wf-zip-status" id="wfZipStatus">준비 중...</div>
              <div class="wf-zip-bar"><div class="wf-zip-bar-fill" id="wfZipBarFill"></div></div>
              <div class="wf-zip-current" id="wfZipCurrent"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    openModal('wfZipModal');
  }

  function updateZipStatus(text, percent, current) {
    const status = document.getElementById('wfZipStatus');
    const fill = document.getElementById('wfZipBarFill');
    const curEl = document.getElementById('wfZipCurrent');
    if (status) status.textContent = text;
    if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (curEl) curEl.textContent = current || '';
  }

  function hideZipModal() {
    closeModal('wfZipModal');
  }

  /* ───────── 검색 ───────── */
  let searchTimer = null;
  function handleSearch(value) {
    state.searchKeyword = value.trim();
    const clearBtn = document.getElementById('wfSearchClear');
    if (clearBtn) clearBtn.classList.toggle('visible', !!state.searchKeyword);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadFiles(), 300);
  }

  /* ───────── 뷰 전환 ───────── */
  function switchView(view) {
    state.currentView = view;
    state.selectedFileIds.clear();
    document.querySelectorAll('.wf-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === view);
    });
    applyTrashModeUI(view === 'trash');
    updateBulkButtons();
    loadFiles();
  }

  function applyTrashModeUI(isTrash) {
    /* 1. 안내 배너 */
    let banner = document.getElementById('wfTrashBanner');
    if (isTrash) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'wfTrashBanner';
        banner.className = 'wf-trash-banner';
        banner.innerHTML = `
          <span style="font-size:20px;"></span>
          <div>
            <strong>휴지통 안내</strong>
            <p style="margin:0;font-size:12px;line-height:1.5;">
              휴지통의 항목은 <strong>삭제 후 30일</strong>이 지나면 자동으로 영구 삭제됩니다.<br />
              복원하려면 기한 내에 복원 버튼을 눌러주세요.
            </p>
          </div>
        `;
        const bc = document.getElementById('wfBreadcrumb');
        if (bc && bc.parentNode) bc.parentNode.insertBefore(banner, bc.nextSibling);
      }
      banner.style.display = 'flex';
    } else if (banner) {
      banner.style.display = 'none';
    }

    /* 2. 일괄 복원 버튼 (휴지통일 때만) */
    let restoreBtn = document.getElementById('wfBtnRestoreAll');
    const delBtn = document.getElementById('wfBtnDelete');
    if (isTrash) {
      if (!restoreBtn && delBtn && delBtn.parentNode) {
        restoreBtn = document.createElement('button');
        restoreBtn.id = 'wfBtnRestoreAll';
        restoreBtn.className = 'wf-btn wf-btn-default';
        restoreBtn.disabled = true;
        restoreBtn.innerHTML = '일괄 복원';
        restoreBtn.addEventListener('click', bulkRestore);
        delBtn.parentNode.insertBefore(restoreBtn, delBtn);
      }
      if (restoreBtn) restoreBtn.style.display = '';
    } else if (restoreBtn) {
      restoreBtn.style.display = 'none';
    }

    /* 3. ZIP 버튼은 휴지통에서 숨김 */
    const zipBtn = document.getElementById('wfBtnZipDownload');
    if (zipBtn) zipBtn.style.display = isTrash ? 'none' : '';

    /* 4. [삭제] 버튼 → [일괄 영구 삭제]로 변경 */
    if (delBtn) {
      if (isTrash) {
        delBtn.innerHTML = Icons.svg('x') + ' 일괄 영구 삭제';
        delBtn.dataset.bulkMode = 'purge';
      } else {
        delBtn.innerHTML = '삭제';
        delBtn.dataset.bulkMode = 'trash';
      }
    }
  }

  /* ───────── 이벤트 바인딩 ───────── */
  function bindEvents() {
    document.querySelectorAll('.wf-tab[data-view]').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    const searchInput = document.getElementById('wfSearchInput');
    if (searchInput) searchInput.addEventListener('input', e => handleSearch(e.target.value));
    const searchClear = document.getElementById('wfSearchClear');
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        handleSearch('');
      });
    }

    const sortSel = document.getElementById('wfSortSelect');
    if (sortSel) sortSel.addEventListener('change', e => { state.sortBy = e.target.value; renderFileList(); });

    const selectAll = document.getElementById('wfSelectAll');
    if (selectAll) {
      selectAll.addEventListener('change', e => {
        state.selectedFileIds.clear();
        if (e.target.checked) state.files.forEach(f => state.selectedFileIds.add(f.id));
        renderFileList();
        updateBulkButtons();
      });
    }

    const btnUpload = document.getElementById('wfBtnUpload');
    if (btnUpload) btnUpload.addEventListener('click', () => openModal('wfUploadModal'));

    const btnNewFolder = document.getElementById('wfBtnNewFolder');
    if (btnNewFolder) btnNewFolder.addEventListener('click', () => openNewFolderModal());

    const btnZip = document.getElementById('wfBtnZipDownload');
    if (btnZip) btnZip.addEventListener('click', downloadAsZip);

    const btnDelete = document.getElementById('wfBtnDelete');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        if (!state.selectedFileIds.size) return;
        const isPurge = btnDelete.dataset.bulkMode === 'purge';
        const msg = isPurge
          ? `선택된 ${state.selectedFileIds.size}개 파일을 영구 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.\nR2 저장소에서도 완전히 제거됩니다.`
          : `선택된 ${state.selectedFileIds.size}개 파일을 휴지통으로 이동하시겠습니까?\n\n30일 후 자동으로 영구 삭제됩니다.`;
        if (!confirm(msg)) return;
        let success = 0, failed = 0;
        for (const fid of state.selectedFileIds) {
          try {
            if (isPurge) await api(`/api/admin-workspace-file-purge?fileId=${fid}`, { method: 'DELETE' });
            else await api(`/api/admin-workspace-files?id=${fid}`, { method: 'DELETE' });
            success++;
          } catch (err) { failed++; console.error('bulk delete:', err); }
        }
        state.selectedFileIds.clear();
        updateBulkButtons();
        toast(`${isPurge ? '영구 삭제' : '휴지통 이동'} ${success}건${failed > 0 ? ` / 실패 ${failed}건` : ''}`, success > 0 ? 'success' : 'error');
        await loadFiles();
      });
    }

    const btnCreateFolder = document.getElementById('wfBtnCreateFolder');
    if (btnCreateFolder) {
      btnCreateFolder.addEventListener('click', () => {
        const name = (document.getElementById('wfNewFolderName').value || '').trim();
        if (!name) { toast('폴더 이름을 입력하세요', 'error'); return; }
        const parent = state._newFolderParentId != null ? state._newFolderParentId : state.currentFolderId;
        createFolder(name, parent);
      });
    }

    const btnRename = document.getElementById('wfBtnRename');
    if (btnRename) {
      btnRename.addEventListener('click', () => {
        const type = document.getElementById('wfRenameTargetType').value;
        const id = parseInt(document.getElementById('wfRenameTargetId').value, 10);
        const name = (document.getElementById('wfRenameInput').value || '').trim();
        if (!name) { toast('이름을 입력하세요', 'error'); return; }
        renameItem(type, id, name);
      });
    }

    const btnAddShare = document.getElementById('wfBtnAddShare');
    if (btnAddShare) {
      btnAddShare.addEventListener('click', () => {
        const type = document.getElementById('wfShareTargetType').value;
        const id = parseInt(document.getElementById('wfShareTargetId').value, 10);
        const memberId = parseInt(document.getElementById('wfShareMemberSelect').value, 10);
        const permission = document.getElementById('wfSharePermissionSelect').value;
        if (!memberId) { toast('멤버를 선택하세요', 'error'); return; }
        addShare(type, id, memberId, permission);
      });
    }

    const publicToggle = document.getElementById('wfSharePublic');
    if (publicToggle) {
      publicToggle.addEventListener('change', e => {
        const type = document.getElementById('wfShareTargetType').value;
        const id = parseInt(document.getElementById('wfShareTargetId').value, 10);
        togglePublicShare(type, id, e.target.checked);
      });
    }

    const fileInput = document.getElementById('wfFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        if (e.target.files.length) uploadFiles(e.target.files);
      });
    }

    const dropZone = document.getElementById('wfDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
      });
    }

    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.dataset.close));
    });

    // 컨텍스트 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', e => {
      const menu = document.getElementById('wfContextMenu');
      if (menu && !menu.contains(e.target)) hideContextMenu();
    });

    // 전역 ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        hideContextMenu();
        document.querySelectorAll('.wf-modal[aria-hidden="false"]').forEach(m => {
          m.setAttribute('aria-hidden', 'true');
        });
      }
      // Ctrl+A: 전체 선택 (입력 필드 외)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          state.files.forEach(f => state.selectedFileIds.add(f.id));
          renderFileList();
          updateBulkButtons();
          const sa = document.getElementById('wfSelectAll');
          if (sa) sa.checked = true;
        }
      }
      // Delete: 선택 항목 삭제
      if (e.key === 'Delete' && state.selectedFileIds.size > 0) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          const btn = document.getElementById('wfBtnDelete');
          if (btn) btn.click();
        }
      }
    });

    const sidebarToggle = document.getElementById('wfSidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        const sidebar = document.getElementById('wfSidebar');
        if (sidebar) sidebar.classList.toggle('open');
      });
    }
  }

  /* ───────── 사이드바 초기화 (R35-GAP-P1 H-G1: user JWT 우선 + admin JWT fallback) ───────── */
  async function initSidebar() {
    let me = null;
    try {
      // [감사#17] 인증 탐침은 noAuthRedirect — auth/me 401이어도 즉시 튕기지 않고 admin/me 폴백으로 진행
      const userRes = await api('/api/auth/me', { noAuthRedirect: true });
      if (userRes.ok) me = userRes.data?.data || userRes.data?.user || userRes.data || null;
    } catch { /* 무시 */ }
    if (!me) {
      try {
        const adminRes = await api('/api/admin/me?light=1', { noAuthRedirect: true });
        if (adminRes.ok) me = adminRes.data?.admin || adminRes.data?.data || adminRes.data || null;
      } catch { /* 무시 */ }
    }
    // [감사#17] 사용자·관리자 인증 둘 다 실패한 경우에만 로그인 페이지로 이동
    if (!me) { location.href = '/admin.html'; return; }
    if (me) {
      // R35-GAP-P2 M-G7: regular 회원은 워크스페이스 부적합
      const isAdmin = me.role === 'admin' || me.role === 'super_admin';
      if (!isAdmin && me.operatorActive === false) {
        alert('워크스페이스는 운영자(직원)만 사용할 수 있습니다.\n관리자에게 운영자 권한을 요청해 주세요.');
        location.href = '/index.html';
        return;
      }
      const nameEl = document.getElementById('wsSidebarUserName');
      if (nameEl) nameEl.textContent = me.name || me.email || '사용자';
    }

    const logoutBtn = document.getElementById('wsBtnLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (!confirm('로그아웃하시겠습니까?')) return;
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch { /* 무시 */ }
        location.href = '/admin.html';
      });
    }
  }

  /* ───────── 초기화 ───────── */
  async function init() {
    bindEvents();
    initSidebar();
    try {
      await Promise.all([loadFolders(), loadMembers()]);
      await loadFiles();
      console.log('[workspace-files] Step 8 초기화 완료');
    } catch (err) {
      console.error('[workspace-files] 초기화 실패:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
