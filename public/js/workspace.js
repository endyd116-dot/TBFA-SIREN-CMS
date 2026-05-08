/**
 * SIREN 워크스페이스 — Phase 3 Step 3 블록 14
 * 조회 + 렌더링 + 필터 + 로그아웃 (모달 CRUD는 Step 4)
 *
 * API:
 *  - GET /api/admin-daily-briefing?stats=1
 *  - GET /api/admin-workspace-tasks?list=1&mine=1&status=todo
 *  - GET /api/admin-workspace-tasks?list=1&assignedToMe=1
 *  - GET /api/admin-workspace-events?list=1&from=YYYY-MM-DD&to=YYYY-MM-DD
 *  - GET /api/admin-workspace-memos?list=1
 *  - GET /api/admin-workspace-tasks?feed=1&limit=20
 *
 * 인증: httpOnly 쿠키 → 첫 API 401 시 /admin.html 리다이렉트
 */
(function () {
  'use strict';

  if (window._wsInitialized) return;
  window._wsInitialized = true;

  // ────────────────────────────────────────────
  // 1. 상수 + 상태
  // ────────────────────────────────────────────
  const API = {
    briefing: '/api/admin-daily-briefing?stats=1',
    tasksMine: '/api/admin-workspace-tasks?list=1&mine=1',
    tasksInbox: '/api/admin-workspace-tasks?list=1&assignedToMe=1',
    events: '/api/admin-workspace-events?list=1',
    memos: '/api/admin-workspace-memos?list=1',
    feed: '/api/admin-workspace-tasks?feed=1&limit=20',
    logout: '/api/admin-logout'
  };

  const POLL_MS = 60000; // 60초 폴링 (briefing만)

  const STATE = {
    filterTaskStatus: 'all',
    filterFeedType: 'all',
    myTasks: [],
    inboxTasks: [],
    feed: [],
    pollTimer: null
  };

  const PRIORITY_ICON = {
    urgent: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    normal: '⚪'
  };

  const STATUS_LABEL = {
    todo: '대기',
    doing: '진행중',
    done: '완료',
    cancelled: '취소',
    blocked: '보류'
  };

  const ACTION_LABEL = {
    'task.created': '작업 생성',
    'task.updated': '작업 수정',
    'task.deleted': '작업 삭제',
    'task.status.changed': '상태 변경',
    'task.assigned': '지시',
    'task.completed': '완료',
    'task.checklist.toggle': '체크리스트',
    'memo.created': '메모 생성',
    'memo.updated': '메모 수정',
    'memo.pinned': '메모 고정',
    'event.created': '일정 생성',
    'event.updated': '일정 수정'
  };

  // ────────────────────────────────────────────
  // 2. 유틸
  // ────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d)) return '';
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    } catch { return ''; }
  }

  function fmtDateTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d)) return '';
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${mm}/${dd} ${hh}:${mi}`;
    } catch { return ''; }
  }

  function fmtDueDate(isoStr) {
    if (!isoStr) return '<span class="ws-muted">마감 미정</span>';
    try {
      const d = new Date(isoStr);
      if (isNaN(d)) return '';
      const now = new Date();
      const diffMs = d - now;
      const diffDays = Math.floor(diffMs / 86400000);
      const label = fmtDate(isoStr);
      if (diffDays < 0) return `<span class="ws-due-overdue">⏰ ${label} (${Math.abs(diffDays)}일 지남)</span>`;
      if (diffDays === 0) return `<span class="ws-due-today">📅 오늘 마감</span>`;
      if (diffDays === 1) return `<span class="ws-due-tomorrow">📅 내일 마감</span>`;
      if (diffDays <= 7) return `<span class="ws-due-soon">📅 ${label} (D-${diffDays})</span>`;
      return `<span class="ws-due-later">📅 ${label}</span>`;
    } catch { return ''; }
  }

  function getWeekRange() {
    // KST 기준 이번 주 월요일 ~ 일요일
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const day = kst.getUTCDay(); // 0(일) ~ 6(토)
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(kst);
    monday.setUTCDate(kst.getUTCDate() + mondayOffset);
    monday.setUTCHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    sunday.setUTCHours(23, 59, 59, 999);
    const fmt = (d) => d.toISOString().slice(0, 10);
    return { from: fmt(monday), to: fmt(sunday) };
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '늦은 밤이에요 🌙';
    if (h < 12) return '좋은 아침이에요 ☀️';
    if (h < 18) return '오늘도 힘내세요 💪';
    return '수고하셨어요 🌆';
  }

  async function apiGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401) {
      throw new Error('UNAUTHORIZED');
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  }

  function showToast(msg, type) {
    const root = $('#wsToastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `ws-toast ws-toast-${type || 'info'}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('ws-toast-out');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ────────────────────────────────────────────
  // 3. 로더 함수
  // ────────────────────────────────────────────
  async function loadBriefing() {
    try {
      const data = await apiGet(API.briefing);
      renderBriefing(data);
      return { ok: true };
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') throw e;
      console.warn('[ws] briefing 실패:', e);
      return { ok: false, error: e };
    }
  }

  async function loadMyTasks() {
    try {
      const data = await apiGet(API.tasksMine);
      STATE.myTasks = Array.isArray(data.items) ? data.items : [];
      renderMyTasks();
      return { ok: true };
    } catch (e) {
      console.warn('[ws] myTasks 실패:', e);
      renderMyTasksError();
      return { ok: false, error: e };
    }
  }

  async function loadInbox() {
    try {
      const data = await apiGet(API.tasksInbox);
      STATE.inboxTasks = Array.isArray(data.items) ? data.items : [];
      renderInbox();
      return { ok: true };
    } catch (e) {
      console.warn('[ws] inbox 실패:', e);
      renderInboxError();
      return { ok: false, error: e };
    }
  }

  async function loadEvents() {
    try {
      const { from, to } = getWeekRange();
      const data = await apiGet(`${API.events}&from=${from}&to=${to}`);
      const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
      renderEvents(items);
      return { ok: true };
    } catch (e) {
      console.warn('[ws] events 실패:', e);
      renderEventsError();
      return { ok: false, error: e };
    }
  }

  async function loadMemos() {
    try {
      const data = await apiGet(API.memos);
      const items = Array.isArray(data.items) ? data.items : [];
      renderMemos(items);
      return { ok: true };
    } catch (e) {
      console.warn('[ws] memos 실패:', e);
      renderMemosError();
      return { ok: false, error: e };
    }
  }

  async function loadFeed() {
    try {
      const data = await apiGet(API.feed);
      STATE.feed = Array.isArray(data.items) ? data.items : [];
      renderFeed();
      return { ok: true };
    } catch (e) {
      console.warn('[ws] feed 실패:', e);
      renderFeedError();
      return { ok: false, error: e };
    }
  }

  // ────────────────────────────────────────────
  // 4. 렌더링 함수
  // ────────────────────────────────────────────
  function renderBriefing(d) {
    const setNum = (id, v) => { const el = $(id); if (el) el.textContent = Number(v || 0); };
    setNum('#wsStatOverdue', d.overdueCount);
    setNum('#wsStatToday', d.todayDueCount);
    setNum('#wsStatTomorrow', d.tomorrowDueCount);
    setNum('#wsStatInbox', d.inboxCount);
    setNum('#wsStatUrgent', d.urgentCount);
    setNum('#wsStatEvents', d.todayEventsCount);

    // 사이드바 배지
    const setBadge = (id, v) => {
      const el = $(id);
      if (!el) return;
      const n = Number(v || 0);
      if (n > 0) {
        el.textContent = n > 99 ? '99+' : n;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    };
    setBadge('#wsNavMyTasksBadge', (d.overdueCount || 0) + (d.todayDueCount || 0));
    setBadge('#wsNavInboxBadge', d.inboxCount);
    setBadge('#wsNavDueBadge', (d.overdueCount || 0) + (d.todayDueCount || 0));

    // 알림 벨
    const notifCount = $('#wsNotifCount');
    if (notifCount) {
      const n = Number(d.unreadNotificationsCount || 0);
      if (n > 0) {
        notifCount.textContent = n > 99 ? '99+' : n;
        notifCount.style.display = '';
      } else {
        notifCount.style.display = 'none';
      }
    }

    // 인사말 + 날짜
    const greet = $('#wsGreeting');
    if (greet) greet.textContent = getGreeting();
    const dateEl = $('#wsBriefingDate');
    if (dateEl) {
      const today = new Date();
      const days = ['일', '월', '화', '수', '목', '금', '토'];
      dateEl.textContent = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${days[today.getDay()]})`;
    }
  }

  function renderMyTasks() {
    const ul = $('#wsMyTaskList');
    if (!ul) return;
    let items = STATE.myTasks;
    if (STATE.filterTaskStatus !== 'all') {
      items = items.filter(t => t.status === STATE.filterTaskStatus);
    }
    if (!items.length) {
      ul.innerHTML = '<li class="ws-empty">✅ 작업이 없습니다</li>';
      return;
    }
    ul.innerHTML = items.map(t => `
      <li class="ws-task-card" data-id="${t.id}" data-priority="${escapeHtml(t.priority || 'normal')}">
        <span class="ws-task-priority">${PRIORITY_ICON[t.priority] || '⚪'}</span>
        <div class="ws-task-body">
          <div class="ws-task-title">${escapeHtml(t.title || '(제목 없음)')}</div>
          <div class="ws-task-meta">
            ${fmtDueDate(t.dueDate)}
            ${t.status ? `<span class="ws-task-status ws-status-${escapeHtml(t.status)}">${STATUS_LABEL[t.status] || t.status}</span>` : ''}
            ${t.progress > 0 ? `<span class="ws-task-progress">${t.progress}%</span>` : ''}
          </div>
        </div>
      </li>
    `).join('');
  }

  function renderMyTasksError() {
    const ul = $('#wsMyTaskList');
    if (ul) ul.innerHTML = '<li class="ws-error">불러오기 실패 <button class="ws-retry" data-action="reload-my-tasks">재시도</button></li>';
  }

  function renderInbox() {
    const ul = $('#wsInboxList');
    const badge = $('#wsInboxBadge');
    if (!ul) return;
    const items = STATE.inboxTasks.filter(t => t.status === 'todo');
    if (badge) badge.textContent = items.length;
    if (!items.length) {
      ul.innerHTML = '<li class="ws-empty">📭 받은 지시가 없습니다</li>';
      return;
    }
    ul.innerHTML = items.map(t => `
      <li class="ws-task-card ws-inbox-card" data-id="${t.id}">
        <span class="ws-task-priority">${PRIORITY_ICON[t.priority] || '⚪'}</span>
        <div class="ws-task-body">
          <div class="ws-task-title">${escapeHtml(t.title || '(제목 없음)')}</div>
          <div class="ws-task-meta">
            ${t.assignedByName ? `<span class="ws-task-from">📤 ${escapeHtml(t.assignedByName)}</span>` : ''}
            ${fmtDueDate(t.dueDate)}
          </div>
        </div>
      </li>
    `).join('');
  }

  function renderInboxError() {
    const ul = $('#wsInboxList');
    if (ul) ul.innerHTML = '<li class="ws-error">불러오기 실패 <button class="ws-retry" data-action="reload-inbox">재시도</button></li>';
  }

  function renderEvents(items) {
    const ul = $('#wsEventList');
    if (!ul) return;
    if (!items.length) {
      ul.innerHTML = '<li class="ws-empty">📅 이번 주 일정이 없습니다</li>';
      return;
    }
    // 날짜별 그룹
    const groups = {};
    items.forEach(ev => {
      const key = fmtDate(ev.startAt);
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });
    const keys = Object.keys(groups).sort();
    ul.innerHTML = keys.map(k => `
      <li class="ws-event-group">
        <div class="ws-event-date">${escapeHtml(k)}</div>
        <ul class="ws-event-sublist">
          ${groups[k].map(ev => `
            <li class="ws-event-item" data-id="${ev.id}">
              <span class="ws-event-time">${fmtDateTime(ev.startAt).split(' ')[1] || ''}</span>
              <span class="ws-event-title">${escapeHtml(ev.title || '(제목 없음)')}</span>
              ${ev.location ? `<span class="ws-event-location">📍 ${escapeHtml(ev.location)}</span>` : ''}
            </li>
          `).join('')}
        </ul>
      </li>
    `).join('');
  }

  function renderEventsError() {
    const ul = $('#wsEventList');
    if (ul) ul.innerHTML = '<li class="ws-error">불러오기 실패 <button class="ws-retry" data-action="reload-events">재시도</button></li>';
  }

  function renderMemos(items) {
    const grid = $('#wsMemoGrid');
    if (!grid) return;
    if (!items.length) {
      grid.innerHTML = '<div class="ws-empty">📝 메모가 없습니다</div>';
      return;
    }
    grid.innerHTML = items.slice(0, 12).map(m => `
      <div class="ws-memo-card" data-id="${m.id}" style="background-color: ${escapeHtml(m.color || '#fff9c4')}">
        ${m.isPinned ? '<span class="ws-memo-pin">📌</span>' : ''}
        ${m.title ? `<div class="ws-memo-title">${escapeHtml(m.title)}</div>` : ''}
        <div class="ws-memo-content">${escapeHtml((m.content || '').slice(0, 150))}${(m.content || '').length > 150 ? '…' : ''}</div>
        <div class="ws-memo-meta">${fmtDate(m.updatedAt || m.createdAt)}</div>
      </div>
    `).join('');
  }

  function renderMemosError() {
    const grid = $('#wsMemoGrid');
    if (grid) grid.innerHTML = '<div class="ws-error">불러오기 실패 <button class="ws-retry" data-action="reload-memos">재시도</button></div>';
  }

  function renderFeed() {
    const ul = $('#wsFeedList');
    if (!ul) return;
    let items = STATE.feed;
    if (STATE.filterFeedType !== 'all') {
      items = items.filter(f => (f.actionType || '').startsWith(STATE.filterFeedType));
    }
    if (!items.length) {
      ul.innerHTML = '<li class="ws-empty">아직 활동이 없습니다</li>';
      return;
    }
    ul.innerHTML = items.map(f => `
      <li class="ws-feed-item">
        <span class="ws-feed-actor">${escapeHtml(f.actorName || '시스템')}</span>
        <span class="ws-feed-action">${ACTION_LABEL[f.actionType] || f.actionType || '-'}</span>
        ${f.targetTitle ? `<span class="ws-feed-target">"${escapeHtml(f.targetTitle)}"</span>` : ''}
        <span class="ws-feed-time">${fmtDateTime(f.createdAt)}</span>
      </li>
    `).join('');
  }

  function renderFeedError() {
    const ul = $('#wsFeedList');
    if (ul) ul.innerHTML = '<li class="ws-error">불러오기 실패 <button class="ws-retry" data-action="reload-feed">재시도</button></li>';
  }

  // ────────────────────────────────────────────
  // 5. 이벤트 바인딩
  // ────────────────────────────────────────────
  function bindEvents() {
    // 작업 상태 필터
    const f1 = $('#wsFilterTaskStatus');
    if (f1) {
      f1.addEventListener('change', (e) => {
        STATE.filterTaskStatus = e.target.value || 'all';
        renderMyTasks();
      });
    }

    // 피드 타입 필터
    const f2 = $('#wsFilterFeedType');
    if (f2) {
      f2.addEventListener('change', (e) => {
        STATE.filterFeedType = e.target.value || 'all';
        renderFeed();
      });
    }

    // 로그아웃
    const btnLogout = $('#wsBtnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        if (!confirm('로그아웃 하시겠습니까?')) return;
        try {
          await fetch(API.logout, { method: 'POST', credentials: 'include' });
        } catch {}
        location.href = '/admin.html';
      });
    }

    // 알림 벨 (블록 14는 placeholder)
    const bell = $('#wsNotifBell');
    if (bell) {
      bell.addEventListener('click', () => {
        console.log('[ws] 알림 벨 — Step 5에서 구현 예정');
        showToast('알림 기능은 곧 추가됩니다', 'info');
      });
    }

    // 재시도 버튼 (이벤트 위임)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ws-retry');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'reload-my-tasks') loadMyTasks();
      else if (action === 'reload-inbox') loadInbox();
      else if (action === 'reload-events') loadEvents();
      else if (action === 'reload-memos') loadMemos();
      else if (action === 'reload-feed') loadFeed();
    });
  }

  // ────────────────────────────────────────────
  // 6. 초기화
  // ────────────────────────────────────────────
  async function init() {
    console.log('[ws] 초기화 시작');

    // 1. briefing 먼저 (인증 체크 겸)
    try {
      await loadBriefing();
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') {
        alert('관리자 로그인이 필요합니다');
        location.href = '/admin.html';
        return;
      }
      showToast('통계 로드 실패', 'error');
    }

    // 2. 나머지 5개 병렬
    await Promise.allSettled([
      loadMyTasks(),
      loadInbox(),
      loadEvents(),
      loadMemos(),
      loadFeed()
    ]);

    // 3. 이벤트 바인딩
    bindEvents();

    // 4. 폴링 (briefing만)
    STATE.pollTimer = setInterval(() => {
      loadBriefing().catch(() => {});
    }, POLL_MS);

    console.log('[ws] 초기화 완료');
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // cleanup
  window.addEventListener('beforeunload', () => {
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
  });
})();

/* ═══════════════════════════════════════════════════════
   파일함 사이드 패널 (Phase 3-extra Step 9)
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const panel = document.getElementById('wsFilePanel');
  if (!panel) return;

  const handle      = document.getElementById('wsFilePanelHandle');
  const closeBtn    = document.getElementById('wsFilePanelClose');
  const topbarBtn   = document.querySelector('[data-ws-action="toggle-files"]');
  const searchInput = document.getElementById('wsFilePanelSearch');
  const uploadBtn   = document.getElementById('wsFilePanelUpload');
  const newFolderBtn= document.getElementById('wsFilePanelNewFolder');
  const fileInput   = document.getElementById('wsFilePanelFileInput');
  const treeEl      = document.getElementById('wsFilePanelTree');
  const recentEl    = document.getElementById('wsFilePanelRecent');

  let initialized = false;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }
  function formatSize(b) {
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
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

  function open() {
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    if (!initialized) {
      initialized = true;
      loadFolders();
      loadRecent();
    }
  }
  function close() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
  }
  function toggle() {
    panel.classList.contains('is-open') ? close() : open();
  }

  handle?.addEventListener('click', toggle);
  closeBtn?.addEventListener('click', close);
  topbarBtn?.addEventListener('click', toggle);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('is-open')) close();
  });

  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (q) location.href = '/workspace-files.html?search=' + encodeURIComponent(q);
    }
  });

  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let success = 0, failed = 0;
    for (const file of files) {
      try {
        const presign = await api('/api/admin-workspace-file-presign', {
          method: 'POST',
          body: {
            name: file.name,
            sizeBytes: file.size,
            mimeType: file.type || 'application/octet-stream',
            folderId: null
          }
        });
        const presignData = presign.data || presign;
        if (!presignData.uploadUrl || !presignData.fileId) throw new Error('업로드 URL 없음');

        const putRes = await fetch(presignData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file
        });
        if (!putRes.ok) throw new Error('R2 업로드 실패 ' + putRes.status);

        await api('/api/admin-workspace-file-confirm', {
          method: 'POST',
          body: { fileId: presignData.fileId }
        });
        success++;
      } catch (err) {
        console.error('[file-panel upload]', err);
        failed++;
      }
    }
    e.target.value = '';
    alert(`업로드 ${success}건 성공${failed ? ` / ${failed}건 실패` : ''}`);
    loadRecent();
  });

  newFolderBtn?.addEventListener('click', async () => {
    const name = prompt('새 폴더 이름 (루트에 생성):');
    if (!name || !name.trim()) return;
    try {
      await api('/api/admin-workspace-folders', {
        method: 'POST',
        body: { name: name.trim(), parentId: null }
      });
      loadFolders();
    } catch (err) {
      alert('폴더 생성 실패: ' + err.message);
    }
  });

  async function loadFolders() {
    try {
      const res = await api('/api/admin-workspace-folders?list=1');
      const items = res.data?.items || res.items || (Array.isArray(res.data) ? res.data : []) || [];
      const roots = items.filter(f => !f.parentId).slice(0, 20);
      if (!roots.length) {
        treeEl.innerHTML = '<li class="ws-file-panel-empty">폴더 없음</li>';
        return;
      }
      treeEl.innerHTML = roots.map(f =>
        `<li data-folder-id="${f.id}">
          <span class="ws-file-icon">📁</span>
          <span class="ws-file-name">${escapeHtml(f.name)}</span>
        </li>`
      ).join('');
      treeEl.querySelectorAll('li[data-folder-id]').forEach(li => {
        li.addEventListener('click', () => {
          location.href = `/workspace-files.html?folder=${li.dataset.folderId}`;
        });
      });
    } catch (err) {
      console.error('[file-panel folders]', err);
      treeEl.innerHTML = '<li class="ws-file-panel-empty">로드 실패</li>';
    }
  }

  async function loadRecent() {
    try {
      const res = await api('/api/admin-workspace-files?folderId=0&limit=10');
      const items = res.data?.items || res.items || (Array.isArray(res.data) ? res.data : []) || [];
      if (!items.length) {
        recentEl.innerHTML = '<li class="ws-file-panel-empty">최근 파일 없음</li>';
        return;
      }
      recentEl.innerHTML = items.slice(0, 10).map(f =>
        `<li data-file-id="${f.id}">
          <span class="ws-file-icon">📄</span>
          <span class="ws-file-name">${escapeHtml(f.name)}</span>
          <span class="ws-file-meta">${formatSize(f.sizeBytes)}</span>
        </li>`
      ).join('');
      recentEl.querySelectorAll('li[data-file-id]').forEach(li => {
        li.addEventListener('click', async () => {
          try {
            const dl = await api(`/api/admin-workspace-file-download?id=${li.dataset.fileId}`);
            const url = (dl.data && (dl.data.downloadUrl || dl.data.url)) || dl.downloadUrl;
            if (url) window.open(url, '_blank');
          } catch (err) {
            alert('다운로드 실패: ' + err.message);
          }
        });
      });
    } catch (err) {
      console.error('[file-panel recent]', err);
      recentEl.innerHTML = '<li class="ws-file-panel-empty">로드 실패</li>';
    }
  }
})();
