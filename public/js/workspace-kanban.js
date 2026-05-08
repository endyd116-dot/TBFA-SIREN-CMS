/**
 * Phase 3 Step 7-A.4 — 칸반 보드 핵심 로직
 *
 * 5컬럼: todo / doing / blocked / done / archived
 * SortableJS 기반 드래그앤드롭, 보류 컬럼 드롭 시 사유 모달.
 */
(function () {
  'use strict';

  /* ═══════════════════ 상태 ═══════════════════ */
  const STATE = {
    tasks: [],
    scope: 'mine',          // mine | inbox | all
    priority: '',
    search: '',
    me: null,
    sortables: [],
  };

  const COLUMNS = ['todo', 'doing', 'blocked', 'done', 'archived'];

  /* ═══════════════════ 유틸 ═══════════════════ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function toast(msg, type = 'info') {
    const root = $('#wkToastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function openModal(id) {
    const m = $('#' + id);
    if (m) {
      m.classList.add('is-open');
      m.setAttribute('aria-hidden', 'false');
    }
  }
  function closeModal(id) {
    const m = $('#' + id);
    if (m) {
      m.classList.remove('is-open');
      m.setAttribute('aria-hidden', 'true');
    }
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    if (res.status === 401) {
      location.href = '/admin.html';
      throw new Error('인증 만료');
    }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  /* ═══════════════════ 데이터 로드 ═══════════════════ */
  async function loadTasks() {
    showLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('list', '1');
      params.set('limit', '500');
      if (STATE.scope === 'mine') params.set('mine', '1');
      else if (STATE.scope === 'inbox') params.set('assignedToMe', '1');
      // 'all'은 super_admin이면 백엔드에서 전체 반환
      if (STATE.priority) params.set('priority', STATE.priority);
      if (STATE.search) params.set('q', STATE.search);

      const res = await api(`/api/admin-workspace-tasks?${params}`);
      const items = res.data?.items || res.items || res.data || (Array.isArray(res) ? res : []) || [];
      STATE.tasks = Array.isArray(items) ? items : [];
      render();
    } catch (err) {
      console.error('[kanban] loadTasks:', err);
      toast('작업 목록 로드 실패: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  function showLoading(on) {
    const el = $('#wkLoading');
    if (el) el.style.display = on ? '' : 'none';
  }

  /* ═══════════════════ 렌더링 ═══════════════════ */
  function render() {
    // 컬럼별 분류
    const groups = { todo: [], doing: [], blocked: [], done: [], archived: [] };
    for (const t of STATE.tasks) {
      const s = (t.status || 'todo').toLowerCase();
      if (groups[s]) groups[s].push(t);
      else groups.todo.push(t);
    }

    // 각 컬럼 정렬: sortOrder asc → dueDate asc → id desc
    for (const k of COLUMNS) {
      groups[k].sort((a, b) => {
        const ao = Number(a.sortOrder || 0), bo = Number(b.sortOrder || 0);
        if (ao !== bo) return ao - bo;
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
        return Number(b.id) - Number(a.id);
      });
    }

    let totalVisible = 0;
    for (const status of COLUMNS) {
      const body = $(`.wk-col-body[data-droppable="${status}"]`);
      const countEl = $(`[data-count-for="${status}"]`);
      if (!body) continue;
      const arr = groups[status];
      countEl && (countEl.textContent = String(arr.length));
      totalVisible += arr.length;
      if (!arr.length) {
        body.innerHTML = '<div class="wk-col-empty" style="padding:8px 4px;color:#9ca3af;font-size:12px;font-style:italic">비어 있음</div>';
        continue;
      }
      body.innerHTML = arr.map(renderCard).join('');
    }

    const empty = $('#wkEmpty');
    if (empty) empty.style.display = totalVisible === 0 ? '' : 'none';

    setupSortables();
    setupCardHandlers();
  }

  function renderCard(t) {
    const dueText = formatDue(t.dueDate);
    const dueClass = dueClassFor(t.dueDate, t.status);
    const checklist = Array.isArray(t.checklistItems) ? t.checklistItems : [];
    const doneCount = checklist.filter(c => c.done).length;
    const totalCheck = checklist.length;
    const tags = Array.isArray(t.tags) ? t.tags : [];
    const bookmarked = Array.isArray(t.bookmarkedBy) && STATE.me
      ? t.bookmarkedBy.includes(STATE.me.id)
      : false;
    const progress = Number(t.progress || 0);

    const holdReason = t.status === 'blocked' && t.holdReason
      ? `<div class="wk-card-hold-reason">${escapeHtml(String(t.holdReason).slice(0, 80))}</div>`
      : '';

    return `
<article class="wk-card wk-priority-${escapeHtml(t.priority || 'normal')}" data-task-id="${t.id}" data-status="${escapeHtml(t.status || 'todo')}">
  <button class="wk-card-bookmark${bookmarked ? ' is-marked' : ''}" data-bookmark="${t.id}" type="button" title="북마크">★</button>
  <h3 class="wk-card-title">${escapeHtml(t.title || '제목 없음')}</h3>
  <div class="wk-card-meta">
    ${dueText ? `<span class="wk-card-due ${dueClass}">📅 ${escapeHtml(dueText)}</span>` : ''}
    ${totalCheck > 0 ? `<span class="wk-card-checklist">✅ ${doneCount}/${totalCheck}</span>` : ''}
    ${t.assignedBy ? `<span title="지시받은 작업">📥</span>` : ''}
  </div>
  ${progress > 0 ? `<div class="wk-card-progress"><div class="wk-card-progress-bar" style="width:${progress}%"></div></div>` : ''}
  ${tags.length ? `<div class="wk-card-tags">${tags.slice(0, 4).map(x => `<span class="wk-card-tag">${escapeHtml(x)}</span>`).join('')}</div>` : ''}
  ${holdReason}
</article>`;
  }

  function formatDue(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / 86400000);
    const dStr = `${date.getMonth() + 1}/${date.getDate()}`;
    if (diffDays < 0) return `${dStr} (지연 ${-diffDays}일)`;
    if (diffDays === 0) return `${dStr} (오늘)`;
    if (diffDays === 1) return `${dStr} (내일)`;
    if (diffDays <= 7) return `${dStr} (D-${diffDays})`;
    return dStr;
  }

  function dueClassFor(d, status) {
    if (!d || status === 'done' || status === 'archived') return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const diffMs = date.getTime() - Date.now();
    const diffDays = Math.ceil(diffMs / 86400000);
    if (diffDays < 0) return 'wk-card-due-overdue';
    if (diffDays === 0) return 'wk-card-due-today';
    if (diffDays <= 2) return 'wk-card-due-soon';
    return '';
  }

  /* ═══════════════════ SortableJS 드래그 ═══════════════════ */
  function setupSortables() {
    // 기존 인스턴스 정리
    STATE.sortables.forEach(s => { try { s.destroy(); } catch (_) {} });
    STATE.sortables = [];

    if (typeof Sortable === 'undefined') {
      console.warn('[kanban] SortableJS 미로드 — 드래그앤드롭 비활성');
      return;
    }

    for (const status of COLUMNS) {
      const body = $(`.wk-col-body[data-droppable="${status}"]`);
      if (!body) continue;
      const sortable = Sortable.create(body, {
        group: 'wk-board',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: handleSortEnd,
      });
      STATE.sortables.push(sortable);
    }
  }

  async function handleSortEnd(evt) {
    const card = evt.item;
    const newCol = evt.to.dataset.droppable;
    const taskId = Number(card.dataset.taskId);
    const oldStatus = card.dataset.status;

    if (!taskId || newCol === oldStatus) return;

    // blocked로 이동 시 사유 입력 모달
    if (newCol === 'blocked') {
      // 일단 카드 위치 되돌리고 모달 열기
      pendingMove(taskId, oldStatus, evt);
      $('#wkHoldTaskId').value = String(taskId);
      $('#wkHoldReason').value = '';
      openModal('wkHoldModal');
      $('#wkHoldReason').focus();
      return;
    }

    // archived로 이동 시
    if (newCol === 'archived') {
      try {
        await api(`/api/admin-workspace-tasks?id=${taskId}&action=archive`, {
          method: 'PATCH', body: {}
        });
        toast('보관 처리됨', 'success');
        await loadTasks();
      } catch (err) {
        toast('보관 실패: ' + err.message, 'error');
        await loadTasks();
      }
      return;
    }

    // blocked → 다른 곳: unhold
    if (oldStatus === 'blocked' && (newCol === 'todo' || newCol === 'doing')) {
      try {
        await api(`/api/admin-workspace-tasks?id=${taskId}&action=unhold`, {
          method: 'PATCH',
          body: { resumeStatus: newCol }
        });
        toast('보류 해제됨', 'success');
        await loadTasks();
      } catch (err) {
        toast('보류 해제 실패: ' + err.message, 'error');
        await loadTasks();
      }
      return;
    }

    // archived → 다른 곳: unarchive (단순화: done으로만)
    if (oldStatus === 'archived' && newCol !== 'archived') {
      try {
        await api(`/api/admin-workspace-tasks?id=${taskId}&action=unarchive`, {
          method: 'PATCH', body: {}
        });
        if (newCol !== 'done') {
          // 다시 status 변경
          await api(`/api/admin-workspace-tasks?id=${taskId}&action=status`, {
            method: 'PATCH', body: { status: newCol }
          });
        }
        toast('보관 해제됨', 'success');
        await loadTasks();
      } catch (err) {
        toast('보관 해제 실패: ' + err.message, 'error');
        await loadTasks();
      }
      return;
    }

    // 일반 status 변경
    try {
      await api(`/api/admin-workspace-tasks?id=${taskId}&action=status`, {
        method: 'PATCH', body: { status: newCol }
      });
      toast('상태 변경됨', 'success');
      // 캐시 갱신 (재로드 안 해도 dataset 갱신)
      const t = STATE.tasks.find(x => x.id === taskId);
      if (t) t.status = newCol;
      card.dataset.status = newCol;
    } catch (err) {
      toast('상태 변경 실패: ' + err.message, 'error');
      await loadTasks();
    }
  }

  function pendingMove(taskId, oldStatus, evt) {
    // SortableJS가 카드를 새 컬럼에 옮긴 상태. 모달 취소 시 원래대로 돌리기 위해 보관.
    STATE.pendingHold = { taskId, oldStatus, item: evt.item, originalParent: evt.from };
  }

  function rollbackPendingHold() {
    const p = STATE.pendingHold;
    if (!p) return;
    try {
      p.originalParent.appendChild(p.item);
      p.item.dataset.status = p.oldStatus;
    } catch (_) {}
    STATE.pendingHold = null;
  }

  /* ═══════════════════ 카드 클릭/북마크 ═══════════════════ */
  function setupCardHandlers() {
    $$('.wk-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.wk-card-bookmark')) return; // 북마크 버튼은 별도
        const id = Number(card.dataset.taskId);
        if (id) openCardModal(id);
      });
    });
    $$('.wk-card-bookmark').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = Number(btn.dataset.bookmark);
        if (!id) return;
        const isMarked = btn.classList.contains('is-marked');
        try {
          await api(`/api/admin-workspace-tasks?id=${id}&action=${isMarked ? 'unbookmark' : 'bookmark'}`, {
            method: 'PATCH', body: {}
          });
          btn.classList.toggle('is-marked');
          toast(isMarked ? '북마크 해제' : '북마크 추가', 'success');
          // 상태 캐시 갱신
          const t = STATE.tasks.find(x => x.id === id);
          if (t && STATE.me) {
            const arr = Array.isArray(t.bookmarkedBy) ? t.bookmarkedBy : [];
            t.bookmarkedBy = isMarked
              ? arr.filter(x => x !== STATE.me.id)
              : [...arr, STATE.me.id];
          }
        } catch (err) {
          toast('북마크 실패: ' + err.message, 'error');
        }
      });
    });
  }

  /* ═══════════════════ 카드 모달 ═══════════════════ */
  function openCardModal(id) {
    const t = STATE.tasks.find(x => x.id === id);
    if (!t) return;
    $('#wkCardId').value = String(id);
    $('#wkCardTitle').value = t.title || '';
    $('#wkCardDescription').value = t.description || '';
    $('#wkCardPriority').value = t.priority || 'normal';
    $('#wkCardDueDate').value = t.dueDate ? t.dueDate.slice(0, 16) : '';
    $('#wkCardEstHours').value = t.estimatedHours == null ? '' : t.estimatedHours;
    $('#wkCardActHours').value = t.actualHours == null ? '' : t.actualHours;
    $('#wkCardProgress').value = String(t.progress || 0);
    $('#wkCardProgressVal').textContent = (t.progress || 0) + '%';
    $('#wkCardTags').value = Array.isArray(t.tags) ? t.tags.join(', ') : '';

    renderChecklistInModal(Array.isArray(t.checklistItems) ? t.checklistItems : []);

    const bookmarkBtn = $('#wkCardBookmark');
    const isMarked = Array.isArray(t.bookmarkedBy) && STATE.me && t.bookmarkedBy.includes(STATE.me.id);
    bookmarkBtn.classList.toggle('is-marked', !!isMarked);

    openModal('wkCardModal');
  }

  function renderChecklistInModal(items) {
    const ul = $('#wkCardChecklist');
    if (!ul) return;
    if (!items.length) { ul.innerHTML = ''; return; }
    ul.innerHTML = items.map(it => `
      <li class="${it.done ? 'is-done' : ''}" data-cl-id="${escapeHtml(it.id || '')}">
        <input type="checkbox" data-cl-toggle="${escapeHtml(it.id || '')}" ${it.done ? 'checked' : ''}>
        <span class="wk-checklist-text">${escapeHtml(it.text || '')}</span>
        <button type="button" class="wk-checklist-remove" data-cl-remove="${escapeHtml(it.id || '')}">✕</button>
      </li>
    `).join('');
    ul.querySelectorAll('[data-cl-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.parentElement.classList.toggle('is-done', cb.checked);
      });
    });
    ul.querySelectorAll('[data-cl-remove]').forEach(btn => {
      btn.addEventListener('click', () => btn.parentElement.remove());
    });
  }

  function collectChecklistFromModal() {
    return $$('#wkCardChecklist li').map(li => ({
      id: li.dataset.clId || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: li.querySelector('.wk-checklist-text')?.textContent || '',
      done: !!li.querySelector('input[type=checkbox]')?.checked,
      doneAt: li.querySelector('input[type=checkbox]')?.checked ? new Date().toISOString() : null,
    }));
  }

  async function saveCardModal() {
    const id = Number($('#wkCardId').value);
    if (!id) return;
    const body = {
      title: $('#wkCardTitle').value.trim(),
      description: $('#wkCardDescription').value,
      priority: $('#wkCardPriority').value,
      progress: Number($('#wkCardProgress').value),
      tags: $('#wkCardTags').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 20),
      checklistItems: collectChecklistFromModal(),
    };
    const est = $('#wkCardEstHours').value;
    const act = $('#wkCardActHours').value;
    if (est !== '') body.estimatedHours = Number(est);
    if (act !== '') body.actualHours = Number(act);

    try {
      await api(`/api/admin-workspace-tasks?id=${id}`, { method: 'PATCH', body });
      toast('저장됨', 'success');
      closeModal('wkCardModal');
      await loadTasks();
    } catch (err) {
      toast('저장 실패: ' + err.message, 'error');
    }
  }

  async function archiveFromModal() {
    const id = Number($('#wkCardId').value);
    if (!id) return;
    if (!confirm('이 작업을 보관함으로 이동하시겠습니까?')) return;
    try {
      await api(`/api/admin-workspace-tasks?id=${id}&action=archive`, { method: 'PATCH', body: {} });
      toast('보관됨', 'success');
      closeModal('wkCardModal');
      await loadTasks();
    } catch (err) {
      toast('보관 실패: ' + err.message, 'error');
    }
  }

  async function deleteFromModal() {
    const id = Number($('#wkCardId').value);
    if (!id) return;
    if (!confirm('이 작업을 영구 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    try {
      await api(`/api/admin-workspace-tasks?id=${id}`, { method: 'DELETE' });
      toast('삭제됨', 'success');
      closeModal('wkCardModal');
      await loadTasks();
    } catch (err) {
      toast('삭제 실패: ' + err.message, 'error');
    }
  }

  async function bookmarkFromModal() {
    const id = Number($('#wkCardId').value);
    if (!id) return;
    const btn = $('#wkCardBookmark');
    const wasMarked = btn.classList.contains('is-marked');
    try {
      await api(`/api/admin-workspace-tasks?id=${id}&action=${wasMarked ? 'unbookmark' : 'bookmark'}`, {
        method: 'PATCH', body: {}
      });
      btn.classList.toggle('is-marked');
      toast(wasMarked ? '북마크 해제' : '북마크 추가', 'success');
      const t = STATE.tasks.find(x => x.id === id);
      if (t && STATE.me) {
        const arr = Array.isArray(t.bookmarkedBy) ? t.bookmarkedBy : [];
        t.bookmarkedBy = wasMarked ? arr.filter(x => x !== STATE.me.id) : [...arr, STATE.me.id];
      }
    } catch (err) {
      toast('북마크 실패: ' + err.message, 'error');
    }
  }

  /* ═══════════════════ 보류 모달 ═══════════════════ */
  async function confirmHold() {
    const id = Number($('#wkHoldTaskId').value);
    const reason = $('#wkHoldReason').value.trim();
    if (!id) return;
    if (!reason) {
      toast('사유를 입력하세요', 'error');
      return;
    }
    try {
      await api(`/api/admin-workspace-tasks?id=${id}&action=hold`, {
        method: 'PATCH', body: { reason }
      });
      toast('보류 처리됨', 'success');
      closeModal('wkHoldModal');
      STATE.pendingHold = null;
      await loadTasks();
    } catch (err) {
      toast('보류 실패: ' + err.message, 'error');
      rollbackPendingHold();
      closeModal('wkHoldModal');
    }
  }

  /* ═══════════════════ 새 작업 모달 ═══════════════════ */
  async function createNewTask() {
    const title = $('#wkNewTitle').value.trim();
    const description = $('#wkNewDescription').value;
    const priority = $('#wkNewPriority').value;
    const dueDate = $('#wkNewDueDate').value;

    if (!title) { toast('제목 필수', 'error'); return; }
    if (!dueDate) { toast('마감일 필수', 'error'); return; }

    try {
      await api('/api/admin-workspace-tasks', {
        method: 'POST',
        body: { title, description, priority, dueDate: new Date(dueDate).toISOString() }
      });
      toast('생성됨', 'success');
      closeModal('wkNewModal');
      $('#wkNewTitle').value = '';
      $('#wkNewDescription').value = '';
      $('#wkNewDueDate').value = '';
      await loadTasks();
    } catch (err) {
      toast('생성 실패: ' + err.message, 'error');
    }
  }

  /* ═══════════════════ 사용자 정보 ═══════════════════ */
  async function loadMe() {
    try {
      const res = await api('/api/admin/me');
      const me = res.data || res;
      STATE.me = me;
      const nameEl = $('#wsSidebarUserName');
      if (nameEl) nameEl.textContent = me.name || me.email || '사용자';
    } catch (err) {
      // loadTasks가 401 처리하므로 여기서는 무시
    }
  }

  /* ═══════════════════ 이벤트 바인딩 ═══════════════════ */
  function bind() {
    // 필터
    $('#wkFilterScope')?.addEventListener('change', e => {
      STATE.scope = e.target.value;
      loadTasks();
    });
    $('#wkFilterPriority')?.addEventListener('change', e => {
      STATE.priority = e.target.value;
      loadTasks();
    });
    let searchTimer;
    $('#wkSearch')?.addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        STATE.search = e.target.value.trim();
        loadTasks();
      }, 300);
    });
    $('#wkBtnRefresh')?.addEventListener('click', () => loadTasks());

    // 새 작업
    $('#wkBtnNew')?.addEventListener('click', () => {
      $('#wkNewTitle').value = '';
      $('#wkNewDescription').value = '';
      $('#wkNewPriority').value = 'normal';
      $('#wkNewDueDate').value = '';
      openModal('wkNewModal');
      setTimeout(() => $('#wkNewTitle').focus(), 50);
    });
    $('#wkNewConfirm')?.addEventListener('click', createNewTask);

    // 카드 모달
    $('#wkCardSave')?.addEventListener('click', saveCardModal);
    $('#wkCardArchive')?.addEventListener('click', archiveFromModal);
    $('#wkCardDelete')?.addEventListener('click', deleteFromModal);
    $('#wkCardBookmark')?.addEventListener('click', bookmarkFromModal);
    $('#wkCardProgress')?.addEventListener('input', e => {
      $('#wkCardProgressVal').textContent = e.target.value + '%';
    });
    $('#wkCardChecklistAdd')?.addEventListener('click', () => {
      const input = $('#wkCardChecklistInput');
      const text = input.value.trim();
      if (!text) return;
      const ul = $('#wkCardChecklist');
      const id = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const li = document.createElement('li');
      li.dataset.clId = id;
      li.innerHTML = `
        <input type="checkbox" data-cl-toggle="${id}">
        <span class="wk-checklist-text">${escapeHtml(text)}</span>
        <button type="button" class="wk-checklist-remove" data-cl-remove="${id}">✕</button>
      `;
      ul.appendChild(li);
      li.querySelector('input').addEventListener('change', e => {
        li.classList.toggle('is-done', e.target.checked);
      });
      li.querySelector('[data-cl-remove]').addEventListener('click', () => li.remove());
      input.value = '';
      input.focus();
    });

    // 보류 모달
    $('#wkHoldConfirm')?.addEventListener('click', confirmHold);

    // 모달 닫기 (백드롭/X)
    document.addEventListener('click', e => {
      const close = e.target.closest('[data-close-modal]');
      if (close) {
        const id = close.dataset.closeModal;
        closeModal(id);
        if (id === 'wkHoldModal') rollbackPendingHold();
      }
    });

    // ESC 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const open = document.querySelector('.wk-modal.is-open');
        if (open) {
          closeModal(open.id);
          if (open.id === 'wkHoldModal') rollbackPendingHold();
        }
      }
    });

    // 보관 컬럼 토글
    $('#wkColArchivedHeader')?.addEventListener('click', () => {
      $('#wkColArchived').classList.toggle('wk-col-collapsed');
    });

    // 로그아웃
    $('#wsBtnLogout')?.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      try {
        await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      location.href = '/admin.html';
    });
  }

  /* ═══════════════════ SortableJS 폴백 로드 ═══════════════════ */
  function ensureSortable() {
    if (typeof Sortable !== 'undefined') return Promise.resolve();
    const cdns = [
      'https://unpkg.com/sortablejs@1.15.2/Sortable.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
    ];
    return new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (typeof Sortable !== 'undefined') return resolve();
        if (i >= cdns.length) return resolve(); // 실패해도 진행
        const s = document.createElement('script');
        s.src = cdns[i++];
        s.onload = resolve;
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
  }

  /* ═══════════════════ 초기화 ═══════════════════ */
  async function init() {
    bind();
    await ensureSortable();
    await Promise.all([loadMe(), loadTasks()]);

    // URL 해시 #task=N 자동 열기 (대시보드 미니 위젯에서 진입)
    const m = location.hash.match(/#task=(\d+)/);
    if (m) {
      setTimeout(() => openCardModal(Number(m[1])), 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
