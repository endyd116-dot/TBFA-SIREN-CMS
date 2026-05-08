/* ═══════════════════════════════════════════════
   SIREN 파일함 — workspace-files.js (Step 6 본격 구현)
   Phase 3-extra Step 6 (2026.05)
   ═══════════════════════════════════════════════ */
(function() {
  'use strict';
  if (window._wfInitialized) return;
  window._wfInitialized = true;

  /* ───────── 상태 관리 ───────── */
  const state = {
    currentFolderId: 0,          // 0 = 루트
    currentView: 'all',          // all | mine | shared | trash
    sortBy: 'date-desc',
    searchKeyword: '',
    folders: [],                 // 전체 폴더 (eager load)
    files: [],                   // 현재 폴더 파일
    selectedFileIds: new Set(),
    me: null,                    // 내 정보 (id, name, role)
    members: [],                 // 운영자 목록 (공유용)
    breadcrumbPath: [{ id: 0, name: '홈' }],
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

    // 인증 실패
    if (res.status === 401) {
      alert('관리자 로그인이 필요합니다');
      location.href = '/admin.html';
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

  /* ───────── 토스트 알림 ───────── */
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
    return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
  }

  function fileIcon(name) {
    if (!name) return '📄';
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      pdf: '📕', doc: '📘', docx: '📘',
      xls: '📗', xlsx: '📗', csv: '📗',
      ppt: '📙', pptx: '📙',
      jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
      mp4: '🎬', mov: '🎬', avi: '🎬',
      mp3: '🎵', wav: '🎵',
      zip: '📦', rar: '📦', '7z': '📦',
      txt: '📝', md: '📝',
    };
    return map[ext] || '📄';
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

  /* ───────── 폴더 트리 로드 ───────── */
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

    // 루트 + 트리 구조 조립
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
        const childHtml = renderNode(f.id, depth + 1);
        return `
          <div>
            <div class="wf-tree-node ${isActive ? 'active' : ''}"
                 data-folder-id="${f.id}"
                 style="padding-left:${8 + depth * 12}px">
              <span class="wf-tree-toggle ${hasChildren ? '' : 'empty'}" data-toggle="${f.id}">▶</span>
              <span>📁</span>
              <span>${escapeHtml(f.name)}</span>
            </div>
            <div class="wf-tree-children" data-children="${f.id}">${childHtml}</div>
          </div>
        `;
      }).join('');
    }

    const rootHtml = `
      <div class="wf-tree-node ${state.currentFolderId === 0 ? 'active' : ''}" data-folder-id="0">
        <span class="wf-tree-toggle empty"></span>
        <span>🏠</span>
        <span>홈</span>
      </div>
      ${renderNode(0, 0)}
    `;
    tree.innerHTML = rootHtml;

    // 이벤트: 트리 노드 클릭
    tree.querySelectorAll('.wf-tree-node').forEach(node => {
      node.addEventListener('click', e => {
        if (e.target.dataset.toggle) return;
        const fid = parseInt(node.dataset.folderId, 10);
        navigateToFolder(fid);
      });
    });

    // 이벤트: 펼치기/접기
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

    // 부모 체인 거슬러 올라가며 구축
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
          ${idx === 0 ? '🏠 ' : ''}${escapeHtml(p.name)}
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

  /* ───────── 폴더 이동 ───────── */
  async function navigateToFolder(folderId) {
    state.currentFolderId = folderId;
    state.selectedFileIds.clear();
    state.breadcrumbPath = buildBreadcrumbPath(folderId);
    renderFolderTree();
    renderBreadcrumb();
    await loadFiles();
  }

  /* ───────── 파일 리스트 로드 ───────── */
  async function loadFiles() {
    const tbody = document.getElementById('wfFileListBody');
    const empty = document.getElementById('wfEmptyState');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="wf-list-loading"><td colspan="7">불러오는 중...</td></tr>';
    if (empty) empty.style.display = 'none';

    try {
      const params = new URLSearchParams();
      if (state.currentView === 'trash') {
        params.set('trash', '1');
      } else {
        params.set('folderId', String(state.currentFolderId));
        if (state.currentView === 'mine') params.set('mine', '1');
        if (state.currentView === 'shared') params.set('shared', '1');
      }
      if (state.searchKeyword) params.set('q', state.searchKeyword);

      const res = await api(`/api/admin-workspace-files?${params}`);
      state.files = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
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

    if (count) count.textContent = `파일 ${files.length}개`;

    if (!files.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';

    tbody.innerHTML = files.map(f => {
      const isSelected = state.selectedFileIds.has(f.id);
      const ownerName = f.ownerName || f.ownerEmail || '—';
      const isTrash = state.currentView === 'trash';
      return `
        <tr class="wf-list-row ${isSelected ? 'selected' : ''}" data-file-id="${f.id}">
          <td class="wf-col-check">
            <input type="checkbox" ${isSelected ? 'checked' : ''} data-select="${f.id}" />
          </td>
          <td class="wf-col-icon">${fileIcon(f.name)}</td>
          <td class="wf-col-name">${escapeHtml(f.name)}</td>
          <td class="wf-col-owner">${escapeHtml(ownerName)}</td>
          <td class="wf-col-size">${formatSize(f.sizeBytes)}</td>
          <td class="wf-col-date">${formatDate(f.updatedAt || f.createdAt)}</td>
          <td class="wf-col-actions">
            <div class="wf-row-actions">
              ${isTrash ? `
                <button class="wf-row-action-btn" data-action="restore" data-id="${f.id}" title="복원">↩</button>
                <button class="wf-row-action-btn" data-action="purge" data-id="${f.id}" title="영구 삭제">✕</button>
              ` : `
                <button class="wf-row-action-btn" data-action="download" data-id="${f.id}" title="다운로드">⬇</button>
                <button class="wf-row-action-btn" data-action="share" data-id="${f.id}" title="공유">🔗</button>
                <button class="wf-row-action-btn" data-action="rename" data-id="${f.id}" title="이름 변경">✏</button>
                <button class="wf-row-action-btn" data-action="delete" data-id="${f.id}" title="휴지통">🗑</button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // 체크박스 이벤트
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

    // 행 액션 버튼
    tbody.querySelectorAll('.wf-row-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        handleFileAction(action, id);
      });
    });
  }

  function sortFiles(files, sortBy) {
    const sorted = files.slice();
    switch (sortBy) {
      case 'name-asc':
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
        break;
      case 'name-desc':
        sorted.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ko'));
        break;
      case 'date-asc':
        sorted.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
        break;
      case 'date-desc':
        sorted.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
        break;
      case 'size-asc':
        sorted.sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0));
        break;
      case 'size-desc':
        sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
        break;
    }
    return sorted;
  }

  function updateBulkButtons() {
    const zipBtn = document.getElementById('wfBtnZipDownload');
    const delBtn = document.getElementById('wfBtnDelete');
    const hasSelection = state.selectedFileIds.size > 0;
    if (zipBtn) zipBtn.disabled = !hasSelection;
    if (delBtn) delBtn.disabled = !hasSelection;
  }

  /* ───────── 파일 액션 ───────── */
  async function handleFileAction(action, fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;

    switch (action) {
      case 'download':
        await downloadFile(fileId);
        break;
      case 'rename':
        openRenameModal('file', fileId, file.name);
        break;
      case 'delete':
        if (!confirm(`"${file.name}" 파일을 휴지통으로 이동하시겠습니까?`)) return;
        await deleteFile(fileId);
        break;
      case 'share':
        openShareModal('file', fileId, file.name);
        break;
      case 'restore':
        if (!confirm(`"${file.name}" 파일을 복원하시겠습니까?`)) return;
        await restoreFile(fileId);
        break;
      case 'purge':
        openPurgeConfirm('file', fileId, file.name);
        break;
    }
  }

  async function downloadFile(fileId) {
    try {
      const res = await api(`/api/admin-workspace-file-download?fileId=${fileId}`);
      const url = res.data?.downloadUrl || res.data?.url || res.downloadUrl;
      if (!url) throw new Error('다운로드 URL 없음');
      window.open(url, '_blank');
    } catch (err) {
      toast('다운로드 실패: ' + err.message, 'error');
    }
  }

  async function deleteFile(fileId) {
    try {
      await api(`/api/admin-workspace-files?fileId=${fileId}`, { method: 'DELETE' });
      toast('휴지통으로 이동됨', 'success');
      await loadFiles();
    } catch (err) {
      toast('삭제 실패: ' + err.message, 'error');
    }
  }

  async function restoreFile(fileId) {
    try {
      await api(`/api/admin-workspace-files`, {
        method: 'PATCH',
        body: { fileId, action: 'restore' }
      });
      toast('복원됨', 'success');
      await loadFiles();
    } catch (err) {
      toast('복원 실패: ' + err.message, 'error');
    }
  }

  async function purgeFile(fileId) {
    try {
      await api(`/api/admin-workspace-files?fileId=${fileId}&purge=1`, { method: 'DELETE' });
      toast('영구 삭제됨', 'success');
      closeModal('wfDeleteConfirmModal');
      await loadFiles();
    } catch (err) {
      toast('영구 삭제 실패: ' + err.message, 'error');
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
      // 1. presign
      status.textContent = 'URL 요청 중...';
      const presignRes = await api('/api/admin-workspace-file-presign', {
        method: 'POST',
        body: {
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: file.type || 'application/octet-stream',
          folderId: state.currentFolderId,
        }
      });
      const { uploadUrl, r2Key, fileId } = presignRes.data || presignRes || {};
      if (!uploadUrl) throw new Error('업로드 URL 없음');

      // 2. PUT to R2
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

      // 3. confirm
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
        await api(`/api/admin-workspace-folders`, {
          method: 'PATCH',
          body: { folderId: id, name: newName }
        });
      } else {
        await api(`/api/admin-workspace-files`, {
          method: 'PATCH',
          body: { fileId: id, name: newName }
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
        <span class="wf-share-icon">${type === 'folder' ? '📁' : '📄'}</span>
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
      if (type === 'folder') params.set('folderId', String(id));
      else params.set('fileId', String(id));
      const res = await api(`/api/admin-workspace-file-share?${params}`);
      const shares = res.data?.items || res.data?.data || (Array.isArray(res.data) ? res.data : []) || [];
      const isPublic = res.isShared || false;

      const publicToggle = document.getElementById('wfSharePublic');
      if (publicToggle) publicToggle.checked = !!isPublic;

      const list = document.getElementById('wfShareList');
      if (!list) return;
      if (!shares.length) {
        list.innerHTML = '<li class="wf-share-empty">아직 공유된 멤버가 없습니다.</li>';
      } else {
        list.innerHTML = shares.map(s => `
          <li>
            <span>${escapeHtml(s.memberName || ('#' + s.sharedWith))} <small>(${escapeHtml(s.permission)})</small></span>
            <button class="wf-row-action-btn" data-remove-share="${s.id}" title="제거">✕</button>
          </li>
        `).join('');
        list.querySelectorAll('[data-remove-share]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const shareId = parseInt(btn.dataset.removeShare, 10);
            await removeShare(shareId, type, id);
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
      const body = { permission };
      if (type === 'folder') body.folderId = id;
      else body.fileId = id;
      body.sharedWith = memberId;
      await api('/api/admin-workspace-file-share', { method: 'POST', body });
      toast('공유 추가됨', 'success');
      await loadShareList(type, id);
    } catch (err) {
      toast('공유 추가 실패: ' + err.message, 'error');
    }
  }

  async function removeShare(shareId, type, id) {
    if (!confirm('이 공유를 해제하시겠습니까?')) return;
    try {
      await api(`/api/admin-workspace-file-share?shareId=${shareId}`, { method: 'DELETE' });
      toast('공유 해제됨', 'success');
      await loadShareList(type, id);
    } catch (err) {
      toast('공유 해제 실패: ' + err.message, 'error');
    }
  }

  async function togglePublicShare(type, id, isPublic) {
    try {
      const body = { isShared: isPublic };
      if (type === 'folder') body.folderId = id;
      else body.fileId = id;
      await api('/api/admin-workspace-file-share', { method: 'PATCH', body });
      toast(isPublic ? '전체 공개됨' : '공개 해제됨', 'success');
    } catch (err) {
      toast('공개 설정 실패: ' + err.message, 'error');
    }
  }

  /* ───────── 모달 관련 UI 헬퍼 ───────── */
  function openRenameModal(type, id, currentName) {
    document.getElementById('wfRenameTargetType').value = type;
    document.getElementById('wfRenameTargetId').value = id;
    const input = document.getElementById('wfRenameInput');
    if (input) { input.value = currentName; setTimeout(() => input.focus(), 50); }
    openModal('wfRenameModal');
  }

  function openNewFolderModal() {
    const input = document.getElementById('wfNewFolderName');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
    const parentEl = document.getElementById('wfNewFolderParent');
    if (parentEl) {
      const parentName = state.breadcrumbPath[state.breadcrumbPath.length - 1]?.name || '홈';
      parentEl.innerHTML = `상위 폴더: <strong>${escapeHtml(parentName)}</strong>`;
    }
    openModal('wfNewFolderModal');
  }

  function openPurgeConfirm(type, id, name) {
    const detail = document.getElementById('wfDeleteConfirmDetail');
    if (detail) detail.innerHTML = `<strong>${escapeHtml(name)}</strong> ${type === 'folder' ? '폴더' : '파일'}`;
    const btn = document.getElementById('wfBtnConfirmDelete');
    if (btn) {
      btn.onclick = () => {
        if (type === 'file') purgeFile(id);
      };
    }
    openModal('wfDeleteConfirmModal');
  }

  /* ───────── 검색 (디바운스) ───────── */
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
    updateBulkButtons();
    loadFiles();
  }

  /* ───────── 이벤트 바인딩 ───────── */
  function bindEvents() {
    // 탭 전환
    document.querySelectorAll('.wf-tab[data-view]').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // 검색
    const searchInput = document.getElementById('wfSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', e => handleSearch(e.target.value));
    }
    const searchClear = document.getElementById('wfSearchClear');
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        handleSearch('');
      });
    }

    // 정렬
    const sortSel = document.getElementById('wfSortSelect');
    if (sortSel) {
      sortSel.addEventListener('change', e => {
        state.sortBy = e.target.value;
        renderFileList();
      });
    }

    // 전체 선택
    const selectAll = document.getElementById('wfSelectAll');
    if (selectAll) {
      selectAll.addEventListener('change', e => {
        state.selectedFileIds.clear();
        if (e.target.checked) {
          state.files.forEach(f => state.selectedFileIds.add(f.id));
        }
        renderFileList();
        updateBulkButtons();
      });
    }

    // 업로드 버튼
    const btnUpload = document.getElementById('wfBtnUpload');
    if (btnUpload) btnUpload.addEventListener('click', () => openModal('wfUploadModal'));

    // 새 폴더 버튼
    const btnNewFolder = document.getElementById('wfBtnNewFolder');
    if (btnNewFolder) btnNewFolder.addEventListener('click', openNewFolderModal);

    // ZIP 다운로드 (Step 7 예정)
    const btnZip = document.getElementById('wfBtnZipDownload');
    if (btnZip) {
      btnZip.addEventListener('click', () => {
        toast('ZIP 일괄 다운로드는 Step 7에서 구현됩니다', 'default');
      });
    }

    // 일괄 삭제
    const btnDelete = document.getElementById('wfBtnDelete');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        if (!state.selectedFileIds.size) return;
        if (!confirm(`선택된 ${state.selectedFileIds.size}개 파일을 휴지통으로 이동하시겠습니까?`)) return;
        for (const fid of state.selectedFileIds) {
          try { await api(`/api/admin-workspace-files?fileId=${fid}`, { method: 'DELETE' }); }
          catch (err) { console.error('bulk delete:', err); }
        }
        state.selectedFileIds.clear();
        updateBulkButtons();
        toast('선택 항목 삭제 완료', 'success');
        await loadFiles();
      });
    }

    // 새 폴더 생성
    const btnCreateFolder = document.getElementById('wfBtnCreateFolder');
    if (btnCreateFolder) {
      btnCreateFolder.addEventListener('click', () => {
        const name = (document.getElementById('wfNewFolderName').value || '').trim();
        if (!name) { toast('폴더 이름을 입력하세요', 'error'); return; }
        createFolder(name, state.currentFolderId);
      });
    }

    // 이름 변경
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

    // 공유 추가
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

    // 전체 공개 토글
    const publicToggle = document.getElementById('wfSharePublic');
    if (publicToggle) {
      publicToggle.addEventListener('change', e => {
        const type = document.getElementById('wfShareTargetType').value;
        const id = parseInt(document.getElementById('wfShareTargetId').value, 10);
        togglePublicShare(type, id, e.target.checked);
      });
    }

    // 파일 input
    const fileInput = document.getElementById('wfFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        if (e.target.files.length) uploadFiles(e.target.files);
      });
    }

    // 드래그앤드롭
    const dropZone = document.getElementById('wfDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
      });
    }

    // 모달 닫기 (backdrop/X 버튼/data-close)
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.dataset.close));
    });

    // ESC로 모달 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.wf-modal[aria-hidden="false"]').forEach(m => {
          m.setAttribute('aria-hidden', 'true');
        });
      }
    });

    // 사이드바 접기 (모바일)
    const sidebarToggle = document.getElementById('wfSidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        const sidebar = document.getElementById('wfSidebar');
        if (sidebar) sidebar.classList.toggle('open');
      });
    }
  }

  /* ───────── 초기화 ───────── */
  async function init() {
    bindEvents();
    try {
      await Promise.all([loadFolders(), loadMembers()]);
      await loadFiles();
      console.log('[workspace-files] Step 6 초기화 완료');
    } catch (err) {
      console.error('[workspace-files] 초기화 실패:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
