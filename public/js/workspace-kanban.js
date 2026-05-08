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

    // 탭 모듈 hook (Step 7-B.3)
    if (window.wkOnCardOpen) {
      try { window.wkOnCardOpen(t, STATE.me); } catch (e) { console.warn('[kanban-tabs hook]', e); }
    }
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

/* ═══════════════════════════════════════════════════════
   카드 모달 7개 탭 (Step 7-B.3) — 독립 모듈
   메인 IIFE의 openCardModal에서 window.wkOnCardOpen(task, me) 호출 시 발동
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TAB_STATE = {
    currentTask: null,
    me: null,
    loadedTabs: new Set(),  // 한 카드당 캐시
    members: [],            // 멘션용
  };

  function $(s, root = document) { return root.querySelector(s); }
  function $$(s, root = document) { return Array.from(root.querySelectorAll(s)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function formatTime(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return '방금 전';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    if (diff < 86400000 * 7) return `${Math.floor(diff / 86400000)}일 전`;
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function formatSize(b) {
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return n + 'B';
    if (n < 1048576) return (n / 1024).toFixed(0) + 'KB';
    return (n / 1048576).toFixed(1) + 'MB';
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    if (res.status === 401) { location.href = '/admin.html'; throw new Error('인증 만료'); }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data;
  }

  function toast(msg, type) {
    const root = $('#wkToastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /* ═══════════════════ 탭 전환 ═══════════════════ */
  function switchTab(tabName) {
    $$('.wk-tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tabName));
    $$('.wk-tab-panel').forEach(p => {
      p.hidden = p.dataset.panel !== tabName;
    });
    if (TAB_STATE.currentTask && !TAB_STATE.loadedTabs.has(tabName)) {
      TAB_STATE.loadedTabs.add(tabName);
      lazyLoadTab(tabName);
    }
  }

  function lazyLoadTab(tabName) {
    const id = TAB_STATE.currentTask?.id;
    if (!id) return;
    if (tabName === 'comments') loadComments(id);
    if (tabName === 'files') loadFiles(id);
    if (tabName === 'reports') loadReports(id);
    if (tabName === 'history') loadHistory(id);
    if (tabName === 'ai') renderAi();
  }

  /* ═══════════════════ 히스토리 탭 (Step 7-C.4.a) ═══════════════════ */
  const ACTION_LABELS = {
    'task.create':              { icon: '📋', label: '작업 생성' },
    'task.update':              { icon: '✏️', label: '작업 수정' },
    'task.delete':              { icon: '🗑', label: '작업 삭제' },
    'task.status':              { icon: '🔄', label: '상태 변경' },
    'task.complete':            { icon: '✅', label: '작업 완료' },
    'task.reopen':              { icon: '↻', label: '재개' },
    'task.assign':              { icon: '📥', label: '작업 지시' },
    'task.unassign':            { icon: '↩', label: '지시 취소' },
    'task.archive':             { icon: '📦', label: '보관' },
    'task.unarchive':           { icon: '📂', label: '보관 해제' },
    'task.hold':                { icon: '⏸', label: '보류 시작' },
    'task.unhold':              { icon: '▶', label: '보류 해제' },
    'task.checklist.add':       { icon: '➕', label: '체크리스트 추가' },
    'task.checklist.toggle':    { icon: '✓', label: '체크리스트 토글' },
    'task.attachment.add':      { icon: '📎', label: '파일 첨부' },
    'task.attachment.remove':   { icon: '✂', label: '첨부 해제' },
  };

  async function loadHistory(taskId) {
    const list = $('#wkHistoryList');
    list.innerHTML = '<li class="wk-history-empty">불러오는 중...</li>';
    try {
      const res = await api(`/api/admin-workspace-tasks?feed=1&taskId=${taskId}&limit=100`);
      const items = res.data?.items || res.items || [];
      if (!items.length) {
        list.innerHTML = '<li class="wk-history-empty">아직 활동 기록이 없습니다.</li>';
        return;
      }
      list.innerHTML = items.map(it => {
        const map = ACTION_LABELS[it.actionType] || { icon: '📌', label: it.actionType };
        const sub = it.metadata?.subType ? ` · ${escapeHtml(it.metadata.subType)}` : '';
        const detail = formatHistoryDetail(it);
        return `
<li class="wk-history-item">
  <span>${map.icon} <strong>${escapeHtml(map.label)}</strong>${sub}</span>
  ${detail ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${detail}</div>` : ''}
  <span class="wk-history-time" style="display:block;margin-top:2px">
    ${escapeHtml(it.actorName || '시스템')} · ${escapeHtml(formatTime(it.createdAt))}
  </span>
</li>`;
      }).join('');
    } catch (err) {
      list.innerHTML = `<li class="wk-history-empty">로드 실패: ${escapeHtml(err.message)}</li>`;
    }
  }

  function formatHistoryDetail(item) {
    const m = item.metadata || {};
    if (item.actionType === 'task.status') {
      return `${escapeHtml(m.prevStatus || '?')} → ${escapeHtml(m.newStatus || '?')}`;
    }
    if (item.actionType === 'task.assign') {
      return m.newAssignee ? `대상자 #${escapeHtml(String(m.newAssignee))}` : '';
    }
    if (item.actionType === 'task.update' && m.subType) {
      return m.subType;
    }
    if (item.actionType === 'task.attachment.add' && m.fileName) {
      return `📄 ${escapeHtml(m.fileName)}`;
    }
    if (item.actionType === 'task.checklist.toggle') {
      return m.done ? '체크 ✓' : '체크 해제';
    }
    return '';
  }

  /* ═══════════════════ 카드 모달 hook ═══════════════════ */
  window.wkOnCardOpen = function (task, me) {
    TAB_STATE.currentTask = task;
    TAB_STATE.me = me;
    TAB_STATE.loadedTabs.clear();

    // 탭 카운트 미리 갱신용 — 첫 진입 시 탭 클릭하면 로드
    $('#wkTabCountComments').textContent = '';
    $('#wkTabCountFiles').textContent = '';
    $('#wkTabCountReports').textContent = '';

    // 활성 탭 = 개요로 초기화
    switchTab('overview');

    // 댓글 폼 초기화
    $('#wkCommentInput').value = '';
    $('#wkCommentReplyTo').value = '';
    $('#wkCommentReplyHint').style.display = 'none';

    // 보고 폼 초기화
    $('#wkReportType').value = 'progress';
    $('#wkReportTitle').value = '';
    $('#wkReportContent').value = '';

    // 백그라운드로 멤버 목록 로드 (멘션용)
    loadMembers();
  };

  async function loadMembers() {
    if (TAB_STATE.members.length > 0) return;
    try {
      const res = await api('/api/admin-workspace-members');
      const items = res.data?.items || res.data || res.items || [];
      TAB_STATE.members = Array.isArray(items) ? items : [];
    } catch (_) { /* 실패 무시 — 멘션 자동완성만 비활성 */ }
  }

  /* ═══════════════════ 댓글 탭 ═══════════════════ */
  async function loadComments(taskId) {
    const list = $('#wkCommentList');
    list.innerHTML = '<li class="wk-comment-loading">불러오는 중...</li>';
    try {
      const res = await api(`/api/admin-workspace-task-comments?taskId=${taskId}`);
      const items = res.data?.items || res.data || [];
      $('#wkTabCountComments').textContent = items.length;
      if (!items.length) {
        list.innerHTML = '<li class="wk-comment-empty">아직 댓글이 없습니다. 첫 댓글을 작성해보세요.</li>';
        return;
      }
      // 부모/대댓글 정렬
      const parents = items.filter(c => !c.parentCommentId).reverse();  // 오래된 순으로 표시
      const replies = items.filter(c => c.parentCommentId).reverse();
      const repliesByParent = {};
      replies.forEach(r => {
        const k = r.parentCommentId;
        (repliesByParent[k] = repliesByParent[k] || []).push(r);
      });

      const html = parents.map(c => {
        const childHtml = (repliesByParent[c.id] || []).map(r => renderCommentItem(r, true)).join('');
        return renderCommentItem(c, false) + childHtml;
      }).join('');
      list.innerHTML = html;
      bindCommentItemActions();
    } catch (err) {
      list.innerHTML = `<li class="wk-comment-empty">로드 실패: ${escapeHtml(err.message)}</li>`;
    }
  }

  function renderCommentItem(c, isReply) {
    const meId = TAB_STATE.me?.id;
    const isMine = meId && c.memberId === meId;
    const mentions = Array.isArray(c.mentions) ? c.mentions : [];
    let content = escapeHtml(c.content || '');
    // @멘션 하이라이트 (단순)
    if (mentions.length) {
      const memberMap = Object.fromEntries(TAB_STATE.members.map(m => [m.id, m.name || m.email]));
      mentions.forEach(mid => {
        const name = memberMap[mid];
        if (name) {
          content = content.replace(
            new RegExp('@' + escapeRegex(name), 'g'),
            `<span class="wk-comment-mention">@${escapeHtml(name)}</span>`
          );
        }
      });
    }
    return `
<li class="wk-comment-item${isReply ? ' is-reply' : ''}" data-comment-id="${c.id}" data-author-id="${c.memberId}">
  <div>
    <span class="wk-comment-author">${escapeHtml(c.authorName || ('회원 #' + c.memberId))}</span>
    <span class="wk-comment-time">${escapeHtml(formatTime(c.createdAt))}</span>
  </div>
  <div class="wk-comment-content">${content}</div>
  <div class="wk-comment-actions">
    ${!isReply ? `<button data-comment-reply="${c.id}">↩ 답글</button>` : ''}
    ${isMine ? `<button data-comment-delete="${c.id}">🗑 삭제</button>` : ''}
  </div>
</li>`;
  }

  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function bindCommentItemActions() {
    $$('[data-comment-reply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.commentReply;
        $('#wkCommentReplyTo').value = id;
        $('#wkCommentReplyHint').style.display = '';
        $('#wkCommentInput').focus();
      });
    });
    $$('[data-comment-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 댓글을 삭제하시겠습니까?')) return;
        const id = btn.dataset.commentDelete;
        try {
          await api(`/api/admin-workspace-task-comments?id=${id}`, { method: 'DELETE' });
          toast('댓글 삭제됨', 'success');
          loadComments(TAB_STATE.currentTask.id);
        } catch (err) {
          toast('삭제 실패: ' + err.message, 'error');
        }
      });
    });
  }

  async function submitComment() {
    const taskId = TAB_STATE.currentTask?.id;
    if (!taskId) return;
    const content = $('#wkCommentInput').value.trim();
    if (!content) { toast('내용을 입력하세요', 'error'); return; }
    const parentId = $('#wkCommentReplyTo').value;
    const mentions = extractMentions(content);

    try {
      await api('/api/admin-workspace-task-comments', {
        method: 'POST',
        body: {
          taskId,
          content,
          mentions,
          parentCommentId: parentId ? Number(parentId) : null,
        }
      });
      $('#wkCommentInput').value = '';
      $('#wkCommentReplyTo').value = '';
      $('#wkCommentReplyHint').style.display = 'none';
      toast('댓글 작성됨', 'success');
      loadComments(taskId);
    } catch (err) {
      toast('작성 실패: ' + err.message, 'error');
    }
  }

  function extractMentions(content) {
    const found = [];
    const memberMap = TAB_STATE.members;
    if (!memberMap.length) return found;
    for (const m of memberMap) {
      const name = m.name || m.email;
      if (!name) continue;
      const re = new RegExp('@' + escapeRegex(name) + '(?=\\b|\\s|$)', 'g');
      if (re.test(content)) found.push(m.id);
    }
    return found.slice(0, 20);
  }

  /* ═══════════════════ 파일 탭 ═══════════════════ */
  async function loadFiles(taskId) {
    const list = $('#wkFileList');
    list.innerHTML = '<li class="wk-file-loading">불러오는 중...</li>';
    try {
      const res = await api(`/api/admin-workspace-task-attachments?taskId=${taskId}`);
      const items = res.data?.items || res.data || [];
      $('#wkTabCountFiles').textContent = items.length;
      if (!items.length) {
        list.innerHTML = '<li class="wk-file-loading">연결된 파일이 없습니다.</li>';
        return;
      }
      list.innerHTML = items.map(it => `
<li data-attach-id="${it.id}">
  <span class="wk-file-icon">📄</span>
  <span class="wk-file-name">
    ${escapeHtml(it.fileName || ('파일 #' + it.fileId))}
    ${it.fileDeletedAt ? '<span class="wk-file-deleted"> (삭제됨)</span>' : ''}
  </span>
  <span class="wk-file-size">${escapeHtml(formatSize(it.fileSize))}</span>
  <button class="wk-file-remove" data-file-remove="${it.id}" title="연결 해제">✕</button>
</li>`).join('');
      $$('[data-file-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('이 파일 연결을 해제하시겠습니까? (파일함의 파일 자체는 삭제되지 않습니다)')) return;
          try {
            await api(`/api/admin-workspace-task-attachments?id=${btn.dataset.fileRemove}`, { method: 'DELETE' });
            toast('연결 해제됨', 'success');
            loadFiles(taskId);
          } catch (err) {
            toast('해제 실패: ' + err.message, 'error');
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<li class="wk-file-loading">로드 실패: ${escapeHtml(err.message)}</li>`;
    }
  }

  async function openFilePicker() {
    const list = $('#wkFilePickerList');
    const search = $('#wkFilePickerSearch');
    search.value = '';
    list.innerHTML = '<li class="wk-file-loading">불러오는 중...</li>';
    document.getElementById('wkFilePickerModal').classList.add('is-open');
    document.getElementById('wkFilePickerModal').setAttribute('aria-hidden', 'false');
    await renderFilePickerList('');
  }

  async function renderFilePickerList(searchQ) {
    const list = $('#wkFilePickerList');
    const taskId = TAB_STATE.currentTask?.id;
    if (!taskId) return;
    try {
      // 현재 task의 첨부 ID 목록 (중복 비활성화용)
      const attachRes = await api(`/api/admin-workspace-task-attachments?taskId=${taskId}`);
      const attachedIds = new Set((attachRes.data?.items || []).map(it => it.fileId));

      // 파일함 검색 또는 전체 (root)
      const url = searchQ
        ? `/api/admin-workspace-files?search=${encodeURIComponent(searchQ)}&limit=50`
        : `/api/admin-workspace-files?folderId=0&limit=50`;
      const res = await api(url);
      const items = res.data?.items || res.data || [];
      if (!items.length) {
        list.innerHTML = '<li class="wk-file-loading">파일이 없습니다.</li>';
        return;
      }
      list.innerHTML = items.map(f => {
        const isAttached = attachedIds.has(f.id);
        return `
<li>
  <span class="wk-file-icon">📄</span>
  <span class="wk-file-name">${escapeHtml(f.name)}</span>
  <span class="wk-file-size">${escapeHtml(formatSize(f.sizeBytes))}</span>
  <button class="wk-file-pick-btn ${isAttached ? 'is-attached' : ''}" data-pick-file="${f.id}" ${isAttached ? 'disabled' : ''}>
    ${isAttached ? '연결됨' : '연결'}
  </button>
</li>`;
      }).join('');
      $$('[data-pick-file]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (btn.classList.contains('is-attached')) return;
          const fileId = Number(btn.dataset.pickFile);
          try {
            await api('/api/admin-workspace-task-attachments', {
              method: 'POST',
              body: { taskId, fileId }
            });
            toast('파일 연결됨', 'success');
            btn.textContent = '연결됨';
            btn.classList.add('is-attached');
            btn.disabled = true;
            loadFiles(taskId);
          } catch (err) {
            toast('연결 실패: ' + err.message, 'error');
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<li class="wk-file-loading">로드 실패: ${escapeHtml(err.message)}</li>`;
    }
  }

  /* ═══════════════════ 보고 탭 ═══════════════════ */
  async function loadReports(taskId) {
    const list = $('#wkReportList');
    list.innerHTML = '<li class="wk-comment-loading">불러오는 중...</li>';
    try {
      const res = await api(`/api/admin-workspace-task-reports?taskId=${taskId}`);
      const items = res.data?.items || res.data || [];
      $('#wkTabCountReports').textContent = items.length;
      if (!items.length) {
        list.innerHTML = '<li class="wk-comment-empty">아직 보고서가 없습니다.</li>';
        return;
      }
      list.innerHTML = items.map(renderReportItem).join('');
      bindReportActions();
    } catch (err) {
      list.innerHTML = `<li class="wk-comment-empty">로드 실패: ${escapeHtml(err.message)}</li>`;
    }
  }

  function renderReportItem(r) {
    const meId = TAB_STATE.me?.id;
    const isMine = r.memberId === meId;
    const task = TAB_STATE.currentTask;
    const canReview = task && (
      (TAB_STATE.me && (task.memberId === meId || task.assignedBy === meId))
      || (TAB_STATE.me && TAB_STATE.me.role === 'super_admin')
    );
    const reviewBlock = r.reviewStatus === 'pending'
      ? (canReview && !isMine
          ? `<div class="wk-report-actions">
              <button class="wk-btn-secondary" data-report-review="${r.id}" data-status="approved">✅ 승인</button>
              <button class="wk-btn-danger" data-report-review="${r.id}" data-status="rejected">❌ 반려</button>
            </div>`
          : `<div class="wk-report-meta">검토 대기 중</div>`)
      : `<div class="wk-report-review${r.reviewStatus === 'approved' ? ' is-approved' : ' is-rejected'}">
          ${r.reviewStatus === 'approved' ? '✅ 승인됨' : '❌ 반려됨'} · ${escapeHtml(formatTime(r.reviewedAt))}
          ${r.reviewReason ? `<div style="margin-top:4px">${escapeHtml(r.reviewReason)}</div>` : ''}
        </div>`;

    return `
<li class="wk-report-item" data-report-id="${r.id}">
  <div class="wk-report-header">
    <span class="wk-report-type-badge wk-report-type-${escapeHtml(r.type)}">${r.type === 'completion' ? '✅ 완료 보고' : '🔄 중간 보고'}</span>
    <span class="wk-comment-author">${escapeHtml(r.authorName || ('회원 #' + r.memberId))}</span>
    <span class="wk-comment-time">${escapeHtml(formatTime(r.createdAt))}</span>
    <span class="wk-report-status wk-report-status-${escapeHtml(r.reviewStatus)}">${
      r.reviewStatus === 'pending' ? '검토 대기' : r.reviewStatus === 'approved' ? '승인됨' : '반려됨'
    }</span>
  </div>
  ${r.title ? `<div class="wk-report-title">${escapeHtml(r.title)}</div>` : ''}
  <div class="wk-report-content">${escapeHtml(r.content || '')}</div>
  ${reviewBlock}
  ${isMine && r.reviewStatus === 'pending' ? `<div class="wk-report-actions"><button class="wk-btn-danger" data-report-delete="${r.id}">🗑 삭제</button></div>` : ''}
</li>`;
  }

  function bindReportActions() {
    $$('[data-report-review]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.reportReview;
        const status = btn.dataset.status;
        let reason = null;
        if (status === 'rejected') {
          reason = prompt('반려 사유 (선택, 1000자 이내):');
          if (reason === null) return;
        }
        try {
          await api(`/api/admin-workspace-task-reports?id=${id}&action=review`, {
            method: 'PATCH',
            body: { reviewStatus: status, reviewReason: reason }
          });
          toast(status === 'approved' ? '승인됨' : '반려됨', 'success');
          loadReports(TAB_STATE.currentTask.id);
        } catch (err) {
          toast('처리 실패: ' + err.message, 'error');
        }
      });
    });
    $$('[data-report-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 보고서를 삭제하시겠습니까?')) return;
        try {
          await api(`/api/admin-workspace-task-reports?id=${btn.dataset.reportDelete}`, { method: 'DELETE' });
          toast('삭제됨', 'success');
          loadReports(TAB_STATE.currentTask.id);
        } catch (err) {
          toast('삭제 실패: ' + err.message, 'error');
        }
      });
    });
  }

  async function submitReport() {
    const taskId = TAB_STATE.currentTask?.id;
    if (!taskId) return;
    const type = $('#wkReportType').value;
    const title = $('#wkReportTitle').value.trim();
    const content = $('#wkReportContent').value.trim();
    if (!content) { toast('내용 필수', 'error'); return; }
    try {
      await api('/api/admin-workspace-task-reports', {
        method: 'POST',
        body: { taskId, type, title: title || null, content }
      });
      $('#wkReportTitle').value = '';
      $('#wkReportContent').value = '';
      toast('보고서 등록됨', 'success');
      loadReports(taskId);
    } catch (err) {
      toast('등록 실패: ' + err.message, 'error');
    }
  }

  /* ═══════════════════ AI 탭 ═══════════════════ */
  function renderAi() {
    const t = TAB_STATE.currentTask;
    if (!t) return;
    const sumBox = $('#wkAiSummaryBox');
    if (t.aiSummary) {
      sumBox.innerHTML = escapeHtml(t.aiSummary);
    } else {
      sumBox.innerHTML = '<span class="wk-ai-empty">아직 AI 요약이 없습니다. (Step 7-C에서 자동 생성)</span>';
    }
    const riskBox = $('#wkAiRiskBox');
    if (t.aiRiskScore != null) {
      const score = Number(t.aiRiskScore);
      const level = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
      const label = score >= 70 ? '높음 — 지연 가능성 큼' : score >= 40 ? '보통 — 주의' : '낮음 — 안정적';
      riskBox.className = `wk-ai-risk is-${level}`;
      riskBox.textContent = `리스크 점수 ${score}/100 — ${label}`;
    } else {
      riskBox.className = 'wk-ai-risk';
      riskBox.innerHTML = '<span class="wk-ai-empty">아직 분석되지 않았습니다.</span>';
    }
  }

  /* ═══════════════════ AI 재생성 ═══════════════════ */
  async function regenerateAi(type, btn) {
    const taskId = TAB_STATE.currentTask?.id;
    if (!taskId) return;
    if (!confirm(`AI ${type === 'summary' ? '요약' : type === 'risk' ? '리스크 점수' : '완료 보고서 초안'}을 ${type === 'completion' ? '생성' : '재계산'}하시겠습니까?\n\n외부 AI 호출이 발생하므로 5~15초 정도 걸릴 수 있습니다.`)) return;

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ 처리 중...';

    try {
      const res = await api(`/api/admin-task-ai-regenerate?id=${taskId}&type=${type}`, { method: 'POST', body: {} });
      const inner = res.data || res;

      if (inner && inner.ok === false) {
        toast(`AI ${type} 실패: ${inner.error || '알 수 없는 오류'}`, 'error');
      } else {
        toast(`${type === 'summary' ? '요약' : type === 'risk' ? '리스크' : '완료 보고서'} ${type === 'completion' ? '생성됨' : '재계산됨'}`, 'success');

        if (type === 'summary' && inner.summary) {
          TAB_STATE.currentTask.aiSummary = inner.summary;
          renderAi();
        } else if (type === 'risk' && typeof inner.score === 'number') {
          TAB_STATE.currentTask.aiRiskScore = inner.score;
          renderAi();
        } else if (type === 'completion') {
          // 보고 탭 캐시 무효화
          TAB_STATE.loadedTabs.delete('reports');
          $('#wkTabCountReports').textContent = '';
          // 보고 탭으로 이동 (사용자에게 결과 보여주기)
          switchTab('reports');
        }
      }
    } catch (err) {
      toast(`AI 호출 실패: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  /* ═══════════════════ 이벤트 바인딩 ═══════════════════ */
  document.addEventListener('DOMContentLoaded', bindTabs);
  if (document.readyState !== 'loading') bindTabs();

  function bindTabs() {
    $$('.wk-tab').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
    $('#wkCommentSubmit')?.addEventListener('click', submitComment);
    $('#wkCommentReplyCancel')?.addEventListener('click', () => {
      $('#wkCommentReplyTo').value = '';
      $('#wkCommentReplyHint').style.display = 'none';
    });
    $('#wkFileAttach')?.addEventListener('click', openFilePicker);
    $('#wkReportSubmit')?.addEventListener('click', submitReport);

    // AI 재생성 버튼
    $('#wkAiRegenSummary')?.addEventListener('click', e => regenerateAi('summary', e.currentTarget));
    $('#wkAiRegenRisk')?.addEventListener('click', e => regenerateAi('risk', e.currentTarget));
    $('#wkAiRegenCompletion')?.addEventListener('click', e => regenerateAi('completion', e.currentTarget));

    // 파일 선택 모달 검색
    let pickerTimer;
    $('#wkFilePickerSearch')?.addEventListener('input', e => {
      clearTimeout(pickerTimer);
      pickerTimer = setTimeout(() => renderFilePickerList(e.target.value.trim()), 300);
    });
  }
})();
