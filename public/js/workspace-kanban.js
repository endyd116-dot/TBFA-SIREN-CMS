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
    // R4: 보기 모드 (board | list | calendar)
    viewMode: localStorage.getItem('wkViewMode') || 'board',
    // R4: AI 검색 결과 표시용
    aiFilter: null,
    calendarInstance: null,
  };

  // mock 데이터 (B 머지 전) — AI 검색 응답
  const MOCK_AI_RESULT = {
    ok: true,
    data: {
      items: [{ id: 42, title: '월간 보고서 작성', assignedTo: 7, assignedToName: '박OO', dueDate: '2026-05-16', status: 'doing', priority: 'high' }],
      interpretedFilter: { assigneeName: '박OO', dueWithin: 'thisweek' },
      aiCallDurationMs: 1234,
    },
  };
  // mock 데이터 — user preferences
  const MOCK_PREFS = { ok: true, data: { outOfOffice: false, defaultWbsView: 'board' } };

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

  /* ═══════════════════ 보기 모드 전환 ═══════════════════ */

  function switchViewMode(mode) {
    /* ★ 2026-05-16 (2차 fix): WBS 내 캘린더 모드는 deprecated. 단 init()에서
       자동으로 switchViewMode('calendar')가 호출되면 무한 redirect 발생 →
       WBS 화면 자체로 진입 불가. 따라서 calendar 모드 진입 시도는 board로
       강제 정정 (자동 redirect 제거). 사용자가 명시적으로 캘린더 버튼을
       눌렀을 때만 별도 캘린더 페이지로 이동 (click 핸들러에서 처리). */
    if (mode === 'calendar') {
      mode = 'board';
      try { localStorage.setItem('wkViewMode', 'board'); } catch (_) {}
    }
    STATE.viewMode = mode;
    localStorage.setItem('wkViewMode', mode);
    // 토글 버튼 활성화
    $$('.wk-view-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.view === mode);
    });
    // 영역 표시/숨김
    const board = $('#wkBoard');
    const listView = $('#wkListView');
    const calView = $('#wkCalView');
    if (board)    board.style.display    = mode === 'board'    ? '' : 'none';
    if (listView) listView.style.display = mode === 'list'     ? '' : 'none';
    if (calView)  calView.style.display  = mode === 'calendar' ? '' : 'none';

    if (mode === 'board') {
      render();
    } else if (mode === 'list') {
      renderListView();
    } else if (mode === 'calendar') {
      renderCalView();
    }
  }

  /* ─── 리스트 뷰 ─── */
  const STATUS_LABEL_KAN = { todo: '대기', doing: '진행중', blocked: '보류', done: '완료', archived: '보관' };
  const PRIORITY_LABEL_KAN = { urgent: '🔴 긴급', high: '🟠 높음', medium: '🟡 중간', normal: '⚪ 보통', low: '🟢 낮음' };

  function renderListView() {
    const container = $('#wkListView');
    if (!container) return;
    const tasks = STATE.tasks.filter(t => t.status !== 'archived');
    if (!tasks.length) {
      container.innerHTML = '<div style="padding:32px;text-align:center;color:#9ca3af">작업이 없습니다</div>';
      return;
    }

    // 상태별 그룹
    const order = ['todo', 'doing', 'blocked', 'done'];
    const groups = {};
    for (const s of order) groups[s] = [];
    for (const t of tasks) {
      const s = t.status || 'todo';
      if (groups[s]) groups[s].push(t);
      else groups.todo.push(t);
    }

    let rows = '';
    for (const s of order) {
      if (!groups[s].length) continue;
      rows += `<tr class="wk-list-group-row"><td colspan="5">
        ${escapeHtml(STATUS_LABEL_KAN[s] || s)} (${groups[s].length})
      </td></tr>`;
      for (const t of groups[s]) {
        const dueText = t.dueDate ? t.dueDate.slice(0, 10) : '—';
        const dueCls = t.dueDate && t.status !== 'done'
          ? dueClassForList(t.dueDate)
          : '';
        rows += `<tr data-task-id="${t.id}">
          <td><span class="wk-lv-status wk-lv-status-${escapeHtml(s)}">${escapeHtml(STATUS_LABEL_KAN[s] || s)}</span></td>
          <td>${escapeHtml(t.title || '(제목 없음)')}</td>
          <td style="color:#64748b">${escapeHtml(t.assignedToName || t.assignedByName || '—')}</td>
          <td class="${dueCls}">${escapeHtml(dueText)}</td>
          <td class="wk-lv-priority">${escapeHtml(PRIORITY_LABEL_KAN[t.priority] || t.priority || '—')}</td>
        </tr>`;
      }
    }

    container.innerHTML = `<table class="wk-list-view" style="width:100%">
      <thead>
        <tr>
          <th style="width:80px">상태</th>
          <th>제목</th>
          <th style="width:90px">담당</th>
          <th style="width:90px">마감일</th>
          <th style="width:90px">우선순위</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

    // 행 클릭 → 카드 상세 모달
    container.querySelectorAll('tbody tr[data-task-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = Number(row.dataset.taskId);
        if (id) openCardModal(id);
      });
    });
  }

  function dueClassForList(d) {
    if (!d) return '';
    const diff = Math.ceil((new Date(d) - Date.now()) / 86400000);
    if (diff < 0) return 'wk-lv-due-overdue';
    if (diff === 0) return 'wk-lv-due-today';
    if (diff <= 2) return 'wk-lv-due-soon';
    return '';
  }

  /* ─── 캘린더 뷰 (FullCalendar 임베드) ─── */
  async function renderCalView() {
    const container = $('#wkCalView');
    if (!container) return;

    if (STATE.calendarInstance) {
      STATE.calendarInstance.refetchEvents();
      return;
    }

    // FullCalendar 로드
    if (typeof FullCalendar === 'undefined') {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8">캘린더 로드 중...</div>';
      const cdns = [
        'https://unpkg.com/fullcalendar@6.1.11/index.global.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/fullcalendar/6.1.11/index.global.min.js',
      ];
      await new Promise((resolve) => {
        let i = 0;
        const tryNext = () => {
          if (typeof FullCalendar !== 'undefined') return resolve();
          if (i >= cdns.length) return resolve();
          const s = document.createElement('script');
          s.src = cdns[i++];
          s.onload = resolve;
          s.onerror = tryNext;
          document.head.appendChild(s);
        };
        tryNext();
      });
    }

    if (typeof FullCalendar === 'undefined') {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626">FullCalendar 로드 실패</div>';
      return;
    }

    container.innerHTML = '<div id="wkCalInner" class="wk-cal-embed"></div>';
    const calEl = container.querySelector('#wkCalInner');

    STATE.calendarInstance = new FullCalendar.Calendar(calEl, {
      locale: 'ko',
      initialView: 'dayGridMonth',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' },
      buttonText: { today: '오늘', month: '월', week: '주', list: '목록' },
      height: 'auto',
      firstDay: 0,
      events: async (info, success, failure) => {
        try {
          const tasks = STATE.tasks.filter(t => t.dueDate && t.status !== 'archived');
          success(tasks.map(t => ({
            id: `task-${t.id}`,
            title: t.title,
            start: t.dueDate,
            allDay: true,
            backgroundColor: t.priority === 'urgent' ? '#fca5a5'
              : t.priority === 'high' ? '#fdba74'
              : t.priority === 'medium' ? '#fde68a'
              : '#bfdbfe',
            borderColor: 'transparent',
            textColor: '#1e293b',
            extendedProps: { taskId: t.id },
          })));
        } catch (err) { failure(err); }
      },
      eventClick(info) {
        const taskId = info.event.extendedProps.taskId;
        if (taskId) openCardModal(taskId);
      },
    });
    STATE.calendarInstance.render();
  }

  /* ─── 자연어 검색 ─── */
  async function runAiSearch(query) {
    const banner = $('#wkAiFilterBanner');
    const searchInput = $('#wkSearch');

    toast('AI가 검색어를 해석 중이에요...', 'info');

    try {
      let res;
      try {
        res = await api('/api/admin-workspace-task-search', {
          method: 'POST',
          body: { query },
        });
      } catch (_) {
        // API 미존재 시 mock
        res = MOCK_AI_RESULT;
      }

      const data = res.data || res;
      if (!res.ok && res.ok !== undefined) {
        toast('AI 검색 실패 — 키워드 검색으로 시도해주세요', 'error');
        if (searchInput) { searchInput.value = query; STATE.search = query; }
        loadTasks();
        return;
      }

      const items = data.items || [];
      const filter = data.interpretedFilter || {};
      STATE.tasks = items;
      STATE.aiFilter = filter;

      // 현재 보기 모드에 맞게 렌더
      if (STATE.viewMode === 'board') render();
      else if (STATE.viewMode === 'list') renderListView();

      // AI 해석 결과 배너
      if (banner) {
        const parts = [];
        if (filter.assigneeName) parts.push(`담당: ${filter.assigneeName}`);
        if (filter.dueWithin) {
          const due = { today: '오늘 마감', thisweek: '이번 주 마감', thismonth: '이번 달 마감', overdue: '마감 초과' };
          parts.push(due[filter.dueWithin] || filter.dueWithin);
        }
        if (filter.textQuery) parts.push(`키워드: ${filter.textQuery}`);
        banner.innerHTML = `<span>🤖 ${parts.length ? parts.join(' + ') + '으로 해석' : '검색 결과'} (${items.length}건)</span>
          <button onclick="document.getElementById('wkAiFilterBanner').style.display='none';window.wkClearAiFilter()">✕</button>`;
        banner.style.display = 'flex';
      }

      toast(`${items.length}건 찾았어요`, 'success');
    } catch (err) {
      toast('AI 검색 실패 — 키워드 검색으로 시도해주세요', 'error');
      if (searchInput) { searchInput.value = query; STATE.search = query; }
      loadTasks();
    }
  }

  window.wkClearAiFilter = function () {
    STATE.aiFilter = null;
    loadTasks();
  };

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
    const isSub = !!t.parentTaskId;

    const holdReason = t.status === 'blocked' && t.holdReason
      ? `<div class="wk-card-hold-reason">${escapeHtml(String(t.holdReason).slice(0, 80))}</div>`
      : '';

    return `
<article class="wk-card wk-priority-${escapeHtml(t.priority || 'normal')}${isSub ? ' wk-card--sub' : ''}" data-task-id="${t.id}" data-status="${escapeHtml(t.status || 'todo')}">
  <button class="wk-card-bookmark${bookmarked ? ' is-marked' : ''}" data-bookmark="${t.id}" type="button" title="북마크">★</button>
  ${isSub ? '<div class="wk-card-sub-label">서브태스크</div>' : ''}
  <h3 class="wk-card-title">${escapeHtml(t.title || '제목 없음')}</h3>
  <div class="wk-card-meta">
    ${dueText ? `<span class="wk-card-due ${dueClass}">📅 ${escapeHtml(dueText)}</span>` : ''}
    ${totalCheck > 0 ? `<span class="wk-card-checklist">✅ ${doneCount}/${totalCheck}</span>` : ''}
    ${(t.subtaskCount > 0) ? `<span class="wk-card-subtask">📋 ${t.subtaskDoneCount || 0}/${t.subtaskCount}</span>` : ''}
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
      if (window.WorkspaceSync) WorkspaceSync.notify('task:status', { id: taskId, status: newCol });
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

    // archived 카드: 복원 버튼 표시, 보관 버튼 숨김
    const isArchived = t.status === 'archived';
    const restoreBtn = $('#wkCardRestore');
    const archiveBtn = $('#wkCardArchive');
    if (restoreBtn) restoreBtn.style.display = isArchived ? '' : 'none';
    if (archiveBtn) archiveBtn.style.display = isArchived ? 'none' : '';

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
      history.replaceState(null, '', '/workspace-kanban.html');
      if (window.WorkspaceSync) WorkspaceSync.notify('task:updated', { id });
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
      history.replaceState(null, '', '/workspace-kanban.html');
      if (window.WorkspaceSync) WorkspaceSync.notify('task:updated', { id });
      await loadTasks();
    } catch (err) {
      toast('보관 실패: ' + err.message, 'error');
    }
  }

  async function restoreFromModal() {
    const id = Number($('#wkCardId').value);
    if (!id) return;
    try {
      await api(`/api/admin-workspace-tasks?id=${id}&action=restore`, { method: 'PATCH', body: {} });
      toast('복원됐어요 — todo로 이동', 'success');
      closeModal('wkCardModal');
      history.replaceState(null, '', '/workspace-kanban.html');
      if (window.WorkspaceSync) WorkspaceSync.notify('task:updated', { id });
      await loadTasks();
    } catch (err) {
      toast('복원 실패: ' + err.message, 'error');
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
      history.replaceState(null, '', '/workspace-kanban.html');
      if (window.WorkspaceSync) WorkspaceSync.notify('task:deleted', { id });
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
  let TEMPLATES_CACHE = null;
  let SELECTED_TEMPLATE_ID = null;

  async function loadTemplatesIntoSelect() {
    const sel = $('#wkNewTemplate');
    if (!sel) return;
    if (TEMPLATES_CACHE) return;  // 한 번만 로드, 모달 재오픈 시 재사용
    try {
      const res = await api('/api/admin-workspace-task-templates?list=1');
      const items = res.data?.items || res.items || [];
      TEMPLATES_CACHE = items;
      const opts = ['<option value="">— 템플릿 없이 직접 입력 —</option>']
        .concat(items.map(t =>
          `<option value="${t.id}">${escapeHtmlGlobal(t.name)} (사용 ${t.usageCount}회${t.isShared ? '' : ' · 비공개'})</option>`
        ));
      sel.innerHTML = opts.join('');
    } catch (err) {
      sel.innerHTML = '<option value="">템플릿 로드 실패</option>';
    }
  }

  function escapeHtmlGlobal(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  async function applySelectedTemplate() {
    const sel = $('#wkNewTemplate');
    const id = sel.value;
    if (!id) {
      SELECTED_TEMPLATE_ID = null;
      $('#wkNewTemplateHint').textContent = '템플릿을 선택하면 설명·우선순위·태그·체크리스트가 자동 채워집니다.';
      return;
    }
    SELECTED_TEMPLATE_ID = Number(id);
    const tmpl = (TEMPLATES_CACHE || []).find(t => t.id === SELECTED_TEMPLATE_ID);
    if (!tmpl) return;
    if (tmpl.description && !$('#wkNewDescription').value) {
      $('#wkNewDescription').value = tmpl.description;
    }
    if (tmpl.priority) {
      $('#wkNewPriority').value = tmpl.priority;
    }
    if (!$('#wkNewTitle').value && tmpl.name) {
      $('#wkNewTitle').value = tmpl.name;
    }
    const subN = Array.isArray(tmpl.defaultSubtasks) ? tmpl.defaultSubtasks.length : 0;
    const tagN = Array.isArray(tmpl.defaultTags) ? tmpl.defaultTags.length : 0;
    $('#wkNewTemplateHint').textContent = `✅ 적용됨 — 제목·설명·우선순위 미리보기 채움. 체크리스트 ${subN}개, 태그 ${tagN}개는 생성 후 자동 적용됩니다.`;
    toast(`템플릿 "${tmpl.name}" 적용`, 'success');
  }

  async function createNewTask() {
    const title = $('#wkNewTitle').value.trim();
    const description = $('#wkNewDescription').value;
    const priority = $('#wkNewPriority').value;
    const dueDate = $('#wkNewDueDate').value;

    if (!title) { toast('제목 필수', 'error'); return; }
    if (!dueDate) { toast('마감일 필수', 'error'); return; }

    const body = { title, description, priority, dueDate: new Date(dueDate).toISOString() };
    if (SELECTED_TEMPLATE_ID) body.templateId = SELECTED_TEMPLATE_ID;

    try {
      const result = await api('/api/admin-workspace-tasks', { method: 'POST', body });
      toast('작업이 추가됐어요', 'success');
      closeModal('wkNewModal');
      $('#wkNewTitle').value = '';
      $('#wkNewDescription').value = '';
      $('#wkNewDueDate').value = '';
      $('#wkNewTemplate').value = '';
      SELECTED_TEMPLATE_ID = null;
      $('#wkNewTemplateHint').textContent = '템플릿을 선택하면 설명·우선순위·태그·체크리스트가 자동 채워집니다.';
      const newId = result?.data?.id || result?.id;
      if (window.WorkspaceSync) WorkspaceSync.notify('task:created', { id: newId });
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
    // 보기 모드 토글 버튼
    document.addEventListener('click', e => {
      const btn = e.target.closest('.wk-view-btn');
      if (!btn) return;
      const mode = btn.dataset.view;
      /* ★ 2026-05-16: WBS 내 캘린더 보기 모드는 작업만 표시 (단일 데이터).
         별도 캘린더 페이지(workspace-calendar.html)가 작업·일정·메모를 통합
         표시하므로 캘린더 버튼은 그 통합 화면으로 이동 처리. 우선순위 색상·
         월/주/목록 보기 등 핵심 기능은 통합 캘린더에 이미 갖춰져 있음. */
      if (mode === 'calendar') {
        window.location.href = '/workspace-calendar.html';
        return;
      }
      if (mode && mode !== STATE.viewMode) {
        switchViewMode(mode);
        // 서버에 기본 보기 저장 (debounce)
        clearTimeout(STATE._viewSaveTimer);
        STATE._viewSaveTimer = setTimeout(() => {
          api('/api/admin-user-preferences', {
            method: 'POST',
            body: { defaultWbsView: mode },
          }).then(() => toast('기본 보기 모드 저장됐어요', 'success'))
            .catch(() => {});
        }, 1000);
      }
    });

    // AI 검색 버튼
    $('#wkAiSearchBtn')?.addEventListener('click', () => {
      const q = $('#wkSearch')?.value.trim() || $('#wkAiSearchInput')?.value.trim();
      if (!q) { toast('검색어를 입력해주세요', 'error'); return; }
      runAiSearch(q);
    });

    // AI 검색 전용 입력창 엔터
    $('#wkAiSearchInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) runAiSearch(q);
      }
    });

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
        STATE.aiFilter = null;
        const banner = $('#wkAiFilterBanner');
        if (banner) banner.style.display = 'none';
        loadTasks();
      }, 300);
    });
    // 검색 엔터키 (일반 검색)
    $('#wkSearch')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimer);
        STATE.search = e.target.value.trim();
        STATE.aiFilter = null;
        loadTasks();
      }
    });
    $('#wkBtnRefresh')?.addEventListener('click', () => loadTasks());

    // 새 작업
    $('#wkBtnNew')?.addEventListener('click', () => {
      $('#wkNewTitle').value = '';
      $('#wkNewDescription').value = '';
      $('#wkNewPriority').value = 'normal';
      $('#wkNewDueDate').value = '';
      $('#wkNewTemplate').value = '';
      SELECTED_TEMPLATE_ID = null;
      $('#wkNewTemplateHint').textContent = '템플릿을 선택하면 설명·우선순위·태그·체크리스트가 자동 채워집니다.';
      openModal('wkNewModal');
      loadTemplatesIntoSelect();  // 첫 호출 시 템플릿 로드
      setTimeout(() => $('#wkNewTitle').focus(), 50);
    });
    $('#wkNewConfirm')?.addEventListener('click', createNewTask);
    $('#wkNewTemplateApply')?.addEventListener('click', applySelectedTemplate);
    $('#wkNewTemplate')?.addEventListener('change', () => {
      // 사용자가 셀렉트 변경 시 hint만 업데이트, 적용은 버튼 또는 즉시 적용
      const sel = $('#wkNewTemplate');
      if (sel.value) {
        $('#wkNewTemplateHint').textContent = '"적용" 버튼을 누르면 폼에 자동 입력됩니다.';
      } else {
        SELECTED_TEMPLATE_ID = null;
        $('#wkNewTemplateHint').textContent = '템플릿을 선택하면 설명·우선순위·태그·체크리스트가 자동 채워집니다.';
      }
    });

    // 카드 모달
    $('#wkCardSave')?.addEventListener('click', saveCardModal);
    $('#wkCardRestore')?.addEventListener('click', restoreFromModal);
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
        if (id === 'wkCardModal') history.replaceState(null, '', '/workspace-kanban.html');
      }
    });

    // ESC 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const open = document.querySelector('.wk-modal.is-open');
        if (open) {
          closeModal(open.id);
          if (open.id === 'wkHoldModal') rollbackPendingHold();
          if (open.id === 'wkCardModal') history.replaceState(null, '', '/workspace-kanban.html');
        }
      }
    });

    // 보관 컬럼 토글
    $('#wkColArchivedHeader')?.addEventListener('click', () => {
      $('#wkColArchived').classList.toggle('wk-col-collapsed');
    });

    // ★ Phase 25: 성과별 완료 카드 보기 토글
    $('#wkBtnMilestoneView')?.addEventListener('click', toggleMilestoneGroupView);

    // 로그아웃
    $('#wsBtnLogout')?.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      try {
        await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      location.href = '/admin.html';
    });
  }

  /* ★ Phase 25: 완료 카드 성과별 그룹 보기 */
  let _msGroupViewOpen = false;
  async function toggleMilestoneGroupView() {
    const view = $('#wkMilestoneGroupView');
    const colBody = $('.wk-col-body[data-droppable="done"]');
    const btn = $('#wkBtnMilestoneView');
    if (!view) return;
    _msGroupViewOpen = !_msGroupViewOpen;
    view.style.display = _msGroupViewOpen ? '' : 'none';
    if (colBody) colBody.style.display = _msGroupViewOpen ? 'none' : '';
    if (btn) btn.style.background = _msGroupViewOpen ? '#eff6ff' : '#fff';
    if (!_msGroupViewOpen) return;
    view.innerHTML = '<div style="font-size:12px;color:#9ca3af;padding:8px">불러오는 중...</div>';
    try {
      const res = await fetch('/api/workspace-milestone-done-tasks', { credentials: 'include' });
      const data = await res.json();
      if (!data.ok || !data.data) { view.innerHTML = '<div style="font-size:12px;color:#ef4444;padding:8px">로드 실패</div>'; return; }
      const grouped = data.data.grouped || [];
      const unmatched = data.data.unmatched || [];
      if (!grouped.length && !unmatched.length) {
        view.innerHTML = '<div style="font-size:12px;color:#9ca3af;padding:8px">이번 분기 완료 카드가 없습니다.</div>';
        return;
      }
      const esc = s => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
      const parts = [];
      grouped.forEach(g => {
        parts.push('<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:#374151;padding:4px 0;border-bottom:1px solid #f3f4f6;margin-bottom:4px">🏆 ' + esc(g.name) + ' (' + g.tasks.length + '건)</div>' +
          g.tasks.map(t => '<div style="font-size:11.5px;color:#6b7280;padding:2px 8px">' + esc(t.title) + '</div>').join('') + '</div>');
      });
      if (unmatched.length) {
        parts.push('<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:#9ca3af;padding:4px 0;border-bottom:1px solid #f3f4f6;margin-bottom:4px">미분류 (' + unmatched.length + '건)</div>' +
          unmatched.map(t => '<div style="font-size:11.5px;color:#9ca3af;padding:2px 8px">' + esc(t.title) + '</div>').join('') + '</div>');
      }
      view.innerHTML = '<div style="padding:4px 2px">' + parts.join('') + '</div>';
    } catch {
      view.innerHTML = '<div style="font-size:12px;color:#ef4444;padding:8px">로드 중 오류</div>';
    }
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

  /* ─── 사용자 기본 보기 모드 로드 ─── */
  async function loadDefaultViewMode() {
    try {
      let res;
      try {
        res = await api('/api/admin-user-preferences');
      } catch (_) {
        res = MOCK_PREFS;
      }
      const prefs = (res && res.data) || res || {};
      const serverView = prefs.defaultWbsView;
      /* ★ 2026-05-16 (2차 fix): WBS 내 캘린더 모드는 deprecated. 서버 prefs에
         'calendar'가 박혀있어도 'board'로 강제 정정 (자동 redirect 무한루프 방지). */
      const normalized = serverView === 'calendar' ? 'board' : serverView;
      if (normalized && ['board', 'list'].includes(normalized)) {
        STATE.viewMode = normalized;
        localStorage.setItem('wkViewMode', normalized);
      }
    } catch (_) {}
  }

  /* ═══════════════════ 초기화 ═══════════════════ */
  async function init() {
    bind();
    await ensureSortable();

    // 기본 보기 모드 서버에서 로드
    await loadDefaultViewMode();

    // 보기 모드 초기 적용
    switchViewMode(STATE.viewMode);

    await Promise.all([loadMe(), loadTasks()]);

    // URL 해시 #task=N 자동 열기 — 못 찾으면 토스트 안내
    const m = location.hash.match(/#task=(\d+)/);
    if (m) {
      const wantId = Number(m[1]);
      setTimeout(() => {
        const found = STATE.tasks.find(x => x.id === wantId);
        if (found) {
          openCardModal(wantId);
        } else {
          toast('작업을 찾을 수 없어요. 삭제됐을 수 있습니다.', 'error');
          history.replaceState(null, '', '/workspace-kanban.html');
        }
      }, 100);
    }

    // URL 해시 #new-task 자동 새 작업 모달 (워크툴·다른 페이지에서 새 작업 진입)
    if (location.hash === '#new-task') {
      setTimeout(() => {
        if (window.WorkspaceTaskModal) {
          WorkspaceTaskModal.openCreate({ source: 'hash' });
        }
        history.replaceState(null, '', '/workspace-kanban.html');
      }, 100);
    }

    // WorkspaceSync: 다른 탭에서 변경 시 자동 갱신
    if (window.WorkspaceSync) {
      WorkspaceSync.on('task:updated', () => loadTasks().catch(() => {}));
      WorkspaceSync.on('task:created', () => loadTasks().catch(() => {}));
      WorkspaceSync.on('task:deleted', () => loadTasks().catch(() => {}));
      WorkspaceSync.on('task:status',  () => loadTasks().catch(() => {}));
      WorkspaceSync.on('page:visible', () => loadTasks().catch(() => {}));
    }
  }

  // openCardModal을 WorkspaceTaskModal에서 호출할 수 있도록 전역 노출
  window.wkOpenCardById = function (taskId) {
    openCardModal(Number(taskId));
  };

  // R2 — 외부에서 보드 리로드 트리거 (토스 후 등)
  window.wkReloadTasks = function () {
    return loadTasks().catch(function (err) { console.warn('[wkReloadTasks]', err); });
  };

  // loadTemplatesIntoSelect를 WorkspaceTaskModal에서 호출할 수 있도록 전역 노출
  window.wkLoadTemplatesIntoSelect = function () {
    loadTemplatesIntoSelect();
  };

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

  /* ═══════════════════ 히스토리·타임라인 탭 (Step 7-C.4.a + Phase 21 R1) ═══════════════════ */
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
    'task.move':                { icon: '🔀', label: '컬럼 이동' },
    'task.comment':             { icon: '💬', label: '댓글' },
    'task.attachment':          { icon: '📎', label: '파일 첨부' },
  };

  const STATUS_LABEL_KR = {
    todo: '할 일', doing: '진행 중', blocked: '차단', done: '완료', archived: '보관'
  };

  const FIELD_LABEL_KR = {
    title: '제목', description: '설명', priority: '우선순위',
    dueDate: '마감일', estimatedHours: '예상시간', actualHours: '실제시간',
    progress: '진행률', tags: '태그'
  };

  function formatActivityNatural(item) {
    const actor = escapeHtml(item.actorName || '시스템');
    const m = item.metadata || {};
    switch (item.actionType) {
      case 'task.create':
        return `${actor}이(가) 이 작업을 만들었어요`;
      case 'task.update': {
        const fields = Array.isArray(m.fields) ? m.fields.map(f => FIELD_LABEL_KR[f] || f).join(', ') : '';
        return fields ? `${actor}이(가) ${escapeHtml(fields)} 수정했어요` : `${actor}이(가) 작업을 수정했어요`;
      }
      case 'task.status': {
        const from = STATUS_LABEL_KR[m.from] || STATUS_LABEL_KR[m.prevStatus] || m.from || m.prevStatus || '?';
        const to   = STATUS_LABEL_KR[m.to]   || STATUS_LABEL_KR[m.newStatus]  || m.to   || m.newStatus  || '?';
        return `${actor}이(가) 상태를 ${escapeHtml(from)}→${escapeHtml(to)}로 변경했어요`;
      }
      case 'task.assign':
        return m.assigneeName
          ? `${actor}이(가) ${escapeHtml(m.assigneeName)}에게 할당했어요`
          : `${actor}이(가) 작업을 지시했어요`;
      case 'task.move': {
        const from = m.from || '?';
        const to   = m.to   || '?';
        return `${actor}이(가) ${escapeHtml(from)}에서 ${escapeHtml(to)}으로 이동했어요`;
      }
      case 'task.comment':
        return `${actor}이(가) 댓글을 달았어요`;
      case 'task.attachment':
      case 'task.attachment.add':
        return m.fileName
          ? `${actor}이(가) 파일을 첨부했어요 (${escapeHtml(m.fileName)})`
          : `${actor}이(가) 파일을 첨부했어요`;
      default:
        return `${actor}이(가) 작업을 갱신했어요`;
    }
  }

  function formatActivityTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffH   = Math.floor(diffMs / 3600000);
    const diffD   = Math.floor(diffMs / 86400000);
    if (diffMin < 1)  return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffH < 24)   return `${diffH}시간 전`;
    if (diffD === 1)  return '어제';
    if (diffD < 7)    return `${diffD}일 전`;
    return d.toLocaleDateString('ko-KR');
  }

  function renderActivityItems(items, listEl) {
    if (!items || !items.length) {
      listEl.innerHTML = '<li class="wk-history-empty">활동 기록이 없어요</li>';
      return;
    }
    listEl.innerHTML = items.map(it => {
      const natural = formatActivityNatural(it);
      const relTime = formatActivityTime(it.createdAt);
      const absTime = it.createdAt ? new Date(it.createdAt).toLocaleString('ko-KR') : '';
      return `
<li class="wk-history-item">
  <span>${natural}</span>
  <span class="wk-history-time" style="display:block;margin-top:2px" title="${escapeHtml(absTime)}">
    ${escapeHtml(relTime)}
  </span>
</li>`;
    }).join('');
  }

  async function loadHistory(taskId) {
    const list = $('#wkHistoryList');
    if (!list) return;
    list.innerHTML = '<li class="wk-history-empty">불러오는 중...</li>';

    // R1: 단건 조회로 activityLog 포함 응답 시도 (B 작업 머지 후 동작)
    try {
      const res = await api(`/api/admin-workspace-tasks?id=${taskId}`);
      const task = res.data || res;
      const activityLog = Array.isArray(task?.activityLog) ? task.activityLog : null;
      if (activityLog !== null) {
        renderActivityItems(activityLog, list);
        return;
      }
    } catch (_) { /* activityLog 키 없음 — fallback으로 진행 */ }

    // fallback: 기존 feed API
    try {
      const res = await api(`/api/admin-workspace-tasks?feed=1&taskId=${taskId}&limit=100`);
      const items = res.data?.items || res.items || [];
      if (!items.length) {
        list.innerHTML = '<li class="wk-history-empty">활동 기록이 없어요</li>';
        return;
      }
      // feed API 응답도 자연어 렌더러 사용
      renderActivityItems(items, list);
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

    // R2 — 담당자·워처·원본 서비스 영역 마운트 (task 자체 정보 + 워처 비동기 보강)
    if (window.WorkspaceTaskModal && WorkspaceTaskModal.mountAssignBar) {
      WorkspaceTaskModal._me = me;
      WorkspaceTaskModal.mountAssignBar(task);

      // 워처 상태를 별도 API로 확인 (task에 없을 수 있음)
      if (task && task.id) {
        api('/api/admin-workspace-task-watchers?taskId=' + task.id)
          .then(function (res) {
            const items = (res && res.data && res.data.items) || (res && res.items) || [];
            const meId = me && me.id;
            const isWatching = meId && Array.isArray(items) && items.some(function (w) {
              return Number(w.watcherUid || w.uid) === Number(meId);
            });
            task.isWatchedByMe = !!isWatching;
            WorkspaceTaskModal.mountAssignBar(task);
          })
          .catch(function (_) { /* mock 시점에는 실패 — 무시 */ });
      }
    }
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

/* ═══════════════════════════════════════════════════════
   라운드 9 — 서브태스크 / 체크리스트 즉시 PATCH / 리마인더 / 반복 작업
   ★ B 머지 전: API 실패 시 mock 폴백 사용
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';


  const STATUS_LABEL_KR = {
    todo: '할 일', doing: '진행 중', in_progress: '진행 중',
    blocked: '차단', done: '완료', archived: '보관',
  };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])
    );
  }

  function toast(msg, type) {
    const root = document.getElementById('wkToastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
    return data;
  }

  /* ─────── 현재 카드 정보 ─────── */
  function currentTaskId() {
    const el = document.getElementById('wkCardId');
    const id = el && Number(el.value);
    return id > 0 ? id : null;
  }

  /* ─────── 서브태스크 ─────── */
  async function loadSubtasks(parentId) {
    const listEl = $('#wkCardSubtaskList');
    const countEl = $('#wkTabCountSubtasks');
    if (!listEl) return;
    listEl.innerHTML = '<li class="wk-history-empty">불러오는 중...</li>';

    let res;
    try {
      res = await api('/api/admin-workspace-subtasks?parentId=' + parentId);
    } catch (err) {
      toast('서브태스크 불러오기 실패: ' + err.message, 'error');
      listEl.innerHTML = '<li class="wk-history-empty">불러오기 실패</li>';
      return;
    }
    const items = (res && res.subtasks) || (res && res.data && res.data.subtasks) || [];
    if (countEl) countEl.textContent = items.length ? String(items.length) : '';

    if (!items.length) {
      listEl.innerHTML = '<li class="wk-history-empty">아직 서브태스크가 없습니다.</li>';
      return;
    }

    listEl.innerHTML = items.map(it => {
      const status = STATUS_LABEL_KR[it.status] || it.status || '';
      const due = it.dueDate ? ' · 마감 ' + String(it.dueDate).slice(0, 10) : '';
      const assignee = it.assignedToName ? ' · ' + escapeHtml(it.assignedToName) : '';
      const progress = (it.progress != null && it.progress > 0) ? ' · ' + it.progress + '%' : '';
      return `
<li class="wk-subtask-item" data-subtask-id="${it.id}" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;cursor:pointer">
  <div style="flex:1;min-width:0">
    <div style="font-weight:600;font-size:13px">${escapeHtml(it.title || '제목 없음')}</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">${escapeHtml(status)}${assignee}${due}${progress}</div>
  </div>
  <button type="button" class="wk-btn-secondary" data-subtask-open="${it.id}" style="font-size:11px;padding:4px 10px">열기 →</button>
</li>`;
    }).join('');

    listEl.querySelectorAll('[data-subtask-open]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const sid = Number(btn.dataset.subtaskOpen);
        if (sid && typeof window.wkOpenCardById === 'function') {
          window.wkOpenCardById(sid);
        }
      });
    });
  }

  async function addSubtask() {
    const parentId = currentTaskId();
    if (!parentId) return;
    const input = $('#wkCardSubtaskInput');
    const title = input ? input.value.trim() : '';
    if (!title) { toast('서브태스크 제목을 입력하세요.', 'error'); return; }

    const btn = $('#wkCardSubtaskAdd');
    if (btn) btn.disabled = true;
    try {
      const res = await api('/api/admin-workspace-subtask-create', {
        method: 'POST',
        body: { parentTaskId: parentId, title: title, priority: 'normal' },
      });
      if (!res || res.ok === false) {
        toast((res && res.error) || '생성 실패', 'error');
        return;
      }
      if (input) input.value = '';
      toast('서브태스크가 추가되었습니다.', 'success');
      await loadSubtasks(parentId);
      if (window.WorkspaceSync) WorkspaceSync.notify('task:created', { id: res.id || 0 });
      if (typeof window.wkReloadTasks === 'function') window.wkReloadTasks();
    } catch (err) {
      toast('생성 실패: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ─────── 체크리스트 즉시 PATCH ─────── */
  function collectChecklist() {
    return $$('#wkCardChecklist li').map(li => ({
      id: li.dataset.clId || ('cl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
      text: (li.querySelector('.wk-checklist-text')?.textContent || '').trim(),
      done: !!li.querySelector('input[type=checkbox]')?.checked,
      doneAt: li.querySelector('input[type=checkbox]')?.checked ? new Date().toISOString() : null,
    }));
  }

  async function saveChecklistImmediate() {
    const taskId = currentTaskId();
    if (!taskId) return;
    const items = collectChecklist();
    try {
      const res = await api('/api/admin-workspace-task-checklist', {
        method: 'PATCH',
        body: { taskId: taskId, items: items },
      });
      if (res && res.ok === false) {
        toast((res && res.error) || '체크리스트 저장 실패', 'error');
        return;
      }
      // 조용히 처리 (즉시 저장은 시각적 변화로 피드백되니 토스트 생략)
    } catch (err) {
      toast('체크리스트 저장 실패: ' + err.message, 'error');
    }
  }

  /* ─────── 리마인더 ─────── */
  function fillReminderForm(task) {
    const cfg = (task && task.reminderConfig) || {};
    const enabled = $('#wkCardReminderEnabled');
    const minutes = $('#wkCardReminderMinutes');
    if (enabled) enabled.checked = !!cfg.enabled;
    if (minutes) minutes.value = cfg.minutesBefore != null ? cfg.minutesBefore : 60;
    const channels = Array.isArray(cfg.channels) ? cfg.channels : ['inapp'];
    $$('.wk-card-reminder-channel').forEach(cb => {
      cb.checked = channels.indexOf(cb.value) >= 0;
    });
  }

  async function saveReminder() {
    const taskId = currentTaskId();
    if (!taskId) return;
    const enabled = $('#wkCardReminderEnabled')?.checked || false;
    const minutesBefore = Math.max(5, Number($('#wkCardReminderMinutes')?.value) || 60);
    const channels = $$('.wk-card-reminder-channel').filter(cb => cb.checked).map(cb => cb.value);
    if (enabled && channels.length === 0) {
      toast('알림 채널을 한 개 이상 선택하세요.', 'error');
      return;
    }

    const btn = $('#wkCardReminderSave');
    if (btn) btn.disabled = true;
    try {
      const res = await api('/api/admin-workspace-task-reminder', {
        method: 'PATCH',
        body: { taskId: taskId, reminderConfig: { enabled, minutesBefore, channels } },
      });
      if (res && res.ok === false) {
        toast((res && res.error) || '리마인더 저장 실패', 'error');
        return;
      }
      toast('리마인더가 저장되었습니다.', 'success');
      if (window.WorkspaceSync) WorkspaceSync.notify('task:updated', { id: taskId });
    } catch (err) {
      toast('리마인더 저장 실패: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ─────── 반복 작업 생성 ─────── */
  async function createRecurring() {
    const parentTaskId = currentTaskId();
    if (!parentTaskId) return;
    const dueEl = $('#wkCardRecurringDue');
    const titleEl = $('#wkCardRecurringTitle');
    const due = dueEl ? dueEl.value : '';
    if (!due) { toast('새 마감일을 입력하세요.', 'error'); return; }
    const title = titleEl ? titleEl.value.trim() : '';

    const btn = $('#wkCardRecurringCreate');
    if (btn) btn.disabled = true;
    try {
      const body = { parentTaskId: parentTaskId, dueDate: new Date(due).toISOString() };
      if (title) body.title = title;
      const res = await api('/api/admin-workspace-task-recurring', { method: 'POST', body });
      if (res && res.ok === false) {
        toast((res && res.error) || '반복 작업 생성 실패', 'error');
        return;
      }
      toast('반복 작업이 생성되었습니다.', 'success');
      if (dueEl) dueEl.value = '';
      if (titleEl) titleEl.value = '';
      if (window.WorkspaceSync) WorkspaceSync.notify('task:created', { id: (res && res.id) || 0 });
      if (typeof window.wkReloadTasks === 'function') window.wkReloadTasks();
    } catch (err) {
      toast('반복 작업 생성 실패: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ─────── wkOnCardOpen 훅 wrap ─────── */
  const prevOnCardOpen = window.wkOnCardOpen;
  window.wkOnCardOpen = function (task, me) {
    if (typeof prevOnCardOpen === 'function') {
      try { prevOnCardOpen(task, me); } catch (e) { console.warn('[R9 wrap prev]', e); }
    }
    // 서브태스크 카운트는 탭 진입 시 채워짐 (lazy)
    const countEl = document.getElementById('wkTabCountSubtasks');
    if (countEl) countEl.textContent = '';

    // 자동화 탭 - 리마인더 폼 채우기
    fillReminderForm(task);

    // 서브태스크 탭 - 자동 한 번 로드 (백그라운드)
    if (task && task.id) {
      loadSubtasks(task.id);
    }
  };

  /* ─────── 이벤트 바인딩 ─────── */
  function bindR9() {
    $('#wkCardSubtaskAdd')?.addEventListener('click', addSubtask);
    $('#wkCardSubtaskInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
    });
    $('#wkCardReminderSave')?.addEventListener('click', saveReminder);
    $('#wkCardRecurringCreate')?.addEventListener('click', createRecurring);

    // 체크리스트 즉시 PATCH — 토글/추가/삭제 모두 감지
    const ul = $('#wkCardChecklist');
    if (ul) {
      ul.addEventListener('change', e => {
        if (e.target.matches('input[type=checkbox]')) saveChecklistImmediate();
      });
      // 추가 버튼 클릭 후엔 메인 IIFE가 DOM에 li 삽입 → 다음 tick에 PATCH
      $('#wkCardChecklistAdd')?.addEventListener('click', () => {
        setTimeout(saveChecklistImmediate, 30);
      });
      $('#wkCardChecklistInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') setTimeout(saveChecklistImmediate, 30);
      });
      // 항목 삭제 (이벤트 위임)
      ul.addEventListener('click', e => {
        if (e.target.matches('[data-cl-remove]') || e.target.closest('[data-cl-remove]')) {
          setTimeout(saveChecklistImmediate, 30);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindR9);
  } else {
    bindR9();
  }
})();
