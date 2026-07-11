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
    logout: '/api/admin/logout'
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
    urgent: '',
    high: '',
    medium: '',
    low: '',
    normal: ''
  };

  const STATUS_LABEL = {
    todo: '대기',
    doing: '진행중',
    done: '완료',
    cancelled: '취소',
    blocked: '보류'
  };

  // [감사#87] 서버 ACTION_LABELS(lib/workspace-logger.ts)와 키 1:1 정합 — 기존엔 'task.created' 등 없는 키라 raw 코드 노출
  const ACTION_LABEL = {
    'task.create': '작업 생성', 'task.update': '작업 수정', 'task.delete': '작업 삭제',
    'task.status': '상태 변경', 'task.complete': '작업 완료', 'task.reopen': '작업 재개',
    'task.assign': '작업 지시', 'task.unassign': '지시 취소',
    'task.checklist.add': '체크리스트 추가', 'task.checklist.toggle': '체크리스트 완료',
    'task.attachment.add': '첨부 추가', 'task.attachment.remove': '첨부 제거',
    'task.hold': '작업 보류', 'task.unhold': '보류 해제',
    'task.archive': '작업 보관', 'task.unarchive': '보관 해제',
    'event.create': '일정 등록', 'event.update': '일정 수정', 'event.delete': '일정 삭제',
    'event.rsvp.accept': '참석 수락', 'event.rsvp.decline': '참석 거절',
    'event.recurring.generate': '반복 일정 생성',
    'memo.create': '메모 작성', 'memo.update': '메모 수정', 'memo.delete': '메모 삭제', 'memo.pin': '메모 고정',
    'due.request': '마감일 변경 요청', 'due.approve': '마감일 변경 승인',
    'due.reject': '마감일 변경 반려', 'due.cancel': '마감일 변경 요청 취소',
    'agent.task.create': 'AI 자동 생성', 'agent.briefing.generate': '일일 브리핑 생성',
    'agent.reminder.send': '자동 알림 발송'
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
      if (diffDays < 0) return `<span class="ws-due-overdue">${label} (${Math.abs(diffDays)}일 지남)</span>`;
      if (diffDays === 0) return `<span class="ws-due-today">오늘 마감</span>`;
      if (diffDays === 1) return `<span class="ws-due-tomorrow">내일 마감</span>`;
      if (diffDays <= 7) return `<span class="ws-due-soon">${label} (D-${diffDays})</span>`;
      return `<span class="ws-due-later">${label}</span>`;
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
    if (h < 6) return '늦은 밤이에요 ';
    if (h < 12) return '좋은 아침이에요 ';
    if (h < 18) return '오늘도 힘내세요 ';
    return '수고하셨어요 ';
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

    /* 알림 벨 배지는 여기서 갱신하지 않는다.
       [감사#85 · 라이브 E2E fix] 브리핑(워크스페이스 알림만 집계)과 통합 알림 API(두 저장소 합산)가
       서로 다른 숫자를 같은 배지에 60초마다 번갈아 써서 숫자가 깜빡이며 오락가락했다(예: 300 ↔ 325).
       → 배지는 통합 알림 API(loadNotifications)를 단일 출처로 삼는다. */

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
      ul.innerHTML = '<li class="ws-empty">작업이 없습니다</li>';
      return;
    }
    ul.innerHTML = items.map(t => `
      <li class="ws-task-card" data-id="${t.id}" data-priority="${escapeHtml(t.priority || 'normal')}">
        <span class="ws-task-priority">${PRIORITY_ICON[t.priority] || ''}</span>
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
      ul.innerHTML = '<li class="ws-empty">받은 지시가 없습니다</li>';
      return;
    }
    ul.innerHTML = items.map(t => `
      <li class="ws-task-card ws-inbox-card" data-id="${t.id}">
        <span class="ws-task-priority">${PRIORITY_ICON[t.priority] || ''}</span>
        <div class="ws-task-body">
          <div class="ws-task-title">${escapeHtml(t.title || '(제목 없음)')}</div>
          <div class="ws-task-meta">
            ${t.assignedByName ? `<span class="ws-task-from">${escapeHtml(t.assignedByName)}</span>` : ''}
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
      ul.innerHTML = '<li class="ws-empty">이번 주 일정이 없습니다</li>';
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
              ${ev.location ? `<span class="ws-event-location">${escapeHtml(ev.location)}</span>` : ''}
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
      grid.innerHTML = '<div class="ws-empty">메모가 없습니다</div>';
      return;
    }
    grid.innerHTML = items.slice(0, 12).map(m => {
      // [감사#89] 서버 목록 API는 contentHtml 키만 반환(content 컬럼 없음) → HTML 태그 제거 후 미리보기
      const plain = String(m.contentHtml || m.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return `
      <div class="ws-memo-card" data-id="${m.id}" style="background-color: ${escapeHtml(m.color || '#fff9c4')}">
        ${m.isPinned ? '<span class="ws-memo-pin"></span>' : ''}
        ${m.title ? `<div class="ws-memo-title">${escapeHtml(m.title)}</div>` : ''}
        <div class="ws-memo-content">${escapeHtml(plain.slice(0, 150))}${plain.length > 150 ? '…' : ''}</div>
        <div class="ws-memo-meta">${fmtDate(m.updatedAt || m.createdAt)}</div>
      </div>`;
    }).join('');
  }

  function renderMemosError() {
    const grid = $('#wsMemoGrid');
    if (grid) grid.innerHTML = '<div class="ws-error">불러오기 실패 <button class="ws-retry" data-action="reload-memos">재시도</button></div>';
  }

  /* ─── 피드 항목 → 자연어 텍스트 변환 ─── */
  function feedNaturalText(f) {
    const actor = escapeHtml(f.actorName || '시스템');
    const title = f.targetTitle ? `"${escapeHtml(f.targetTitle)}"` : '';
    const meta = f.metadata || {};

    const toName = escapeHtml(meta.toName || meta.assigneeName || meta.newName || meta.newAssigneeName || '');

    // [감사#87] 서버 actionType(task.create 등)과 정합 — 기존 'task.created' 키 오타로 대부분 raw 코드가 그대로 노출됨
    switch (f.actionType) {
      case 'task.create':   return `${actor}이 작업 ${title}을 만들었어요`;
      case 'task.update':   return `${actor}이 작업 ${title}을 수정했어요`;
      case 'task.delete':   return `${actor}이 작업 ${title}을 삭제했어요`;
      case 'task.status':   return `${actor}이 작업 ${title} 상태를 변경했어요`;
      case 'task.complete': return `${actor}이 작업 ${title}을 완료했어요`;
      case 'task.reopen':   return `${actor}이 작업 ${title}을 다시 열었어요`;
      case 'task.assign':   return `${actor}이 작업 ${title}을 ${toName ? toName + '에게 ' : ''}지시했어요`;
      case 'task.unassign': return `${actor}이 작업 ${title} 지시를 취소했어요`;
      case 'task.hold':     return `${actor}이 작업 ${title}을 보류했어요`;
      case 'task.unhold':   return `${actor}이 작업 ${title} 보류를 해제했어요`;
      case 'task.archive':  return `${actor}이 작업 ${title}을 보관했어요`;
      case 'task.unarchive':return `${actor}이 작업 ${title} 보관을 해제했어요`;
      case 'task.checklist.add':    return `${actor}이 작업 ${title} 체크리스트를 추가했어요`;
      case 'task.checklist.toggle': return `${actor}이 작업 ${title} 체크리스트를 업데이트했어요`;
      case 'task.attachment.add':    return `${actor}이 작업 ${title}에 첨부를 추가했어요`;
      case 'task.attachment.remove': return `${actor}이 작업 ${title} 첨부를 제거했어요`;
      case 'memo.create': return `${actor}이 메모 ${title}를 작성했어요`;
      case 'memo.update': return `${actor}이 메모 ${title}를 수정했어요`;
      case 'memo.delete': return `${actor}이 메모 ${title}를 삭제했어요`;
      case 'memo.pin':    return `${actor}이 메모 ${title}를 상단 고정했어요`;
      case 'event.create': return `${actor}이 일정 ${title}을 등록했어요`;
      case 'event.update': return `${actor}이 일정 ${title}을 수정했어요`;
      case 'event.delete': return `${actor}이 일정 ${title}을 삭제했어요`;
      case 'due.request': return `${actor}이 작업 ${title} 마감일 변경을 요청했어요`;
      case 'due.approve': return `${actor}이 작업 ${title} 마감일 변경을 승인했어요`;
      case 'due.reject':  return `${actor}이 작업 ${title} 마감일 변경을 반려했어요`;
      case 'due.cancel':  return `${actor}이 작업 ${title} 마감일 변경 요청을 취소했어요`;
      case 'agent.task.create': return `AI가 작업 ${title}을 자동 생성했어요`;
      // 서비스 로그(다른 경로 유입 가능) — 유지
      case 'service.assignee_change': {
        const kind = escapeHtml(meta.serviceKind || ''); const id = f.targetId || '';
        return `${actor}이 ${kind} 신고 #${id} 담당을 ${toName ? toName + '에게 ' : ''}인계했어요`;
      }
      case 'service.closed': {
        const kind = escapeHtml(meta.serviceKind || ''); const id = f.targetId || '';
        return `${actor}이 ${kind} 신고 #${id}를 종결 처리했어요`;
      }
      default: return `${actor} — ${ACTION_LABEL[f.actionType] || f.actionType || '활동'}`;
    }
  }

  /* ─── 상대 시간 텍스트 ─── */
  function relativeTime(isoStr) {
    if (!isoStr) return '';
    try {
      const diff = Date.now() - new Date(isoStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1)  return '방금 전';
      if (mins < 60) return `${mins}분 전`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24)  return `${hrs}시간 전`;
      const days = Math.floor(hrs / 24);
      return `${days}일 전`;
    } catch (_) { return ''; }
  }

  /* ─── 그룹 키 계산 ─── */
  function calcGroupKey(isoStr) {
    if (!isoStr) return 'older';
    try {
      const now = new Date();
      const todayYmd = now.toISOString().slice(0, 10);
      const d = new Date(isoStr);
      const dYmd = d.toISOString().slice(0, 10);
      if (dYmd === todayYmd) return 'today';

      const yest = new Date(now);
      yest.setDate(yest.getDate() - 1);
      if (dYmd === yest.toISOString().slice(0, 10)) return 'yesterday';

      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      if (d >= weekAgo) return 'thisweek';
    } catch (_) {}
    return 'older';
  }

  const GROUP_LABEL = {
    today:     '오늘',
    yesterday: '어제',
    thisweek:  '이번 주',
    older:     '이전',
  };
  const GROUP_ORDER = ['today', 'yesterday', 'thisweek', 'older'];

  function renderFeed() {
    const container = $('#wsFeedList');
    if (!container) return;
    let items = STATE.feed;
    if (STATE.filterFeedType !== 'all') {
      items = items.filter(f => (f.actionType || '').startsWith(STATE.filterFeedType));
    }
    if (!items.length) {
      container.innerHTML = '<li class="ws-empty">아직 활동이 없습니다</li>';
      return;
    }

    // 그룹 분류 — 서버가 groupKey 보내면 우선 사용, 없으면 직접 계산
    const groups = { today: [], yesterday: [], thisweek: [], older: [] };
    for (const f of items) {
      const key = f.groupKey && groups[f.groupKey] ? f.groupKey : calcGroupKey(f.createdAt);
      groups[key].push(f);
    }

    let html = '';
    for (const key of GROUP_ORDER) {
      const arr = groups[key];
      if (!arr.length) continue;
      html += `<li class="ws-feed-group">
        <div class="ws-feed-group-header">
          <span>${escapeHtml(GROUP_LABEL[key])}</span>
          <span class="ws-feed-group-count">(${arr.length}건)</span>
        </div>
        <ul class="ws-feed-group-body">`;
      for (const f of arr) {
        const url = f.actionUrl || f.linkUrl || '';
        const canClick = !!url;
        html += `<li class="ws-feed-item-v2${canClick ? ' is-clickable' : ''}" ${canClick ? `data-feed-url="${escapeHtml(url)}"` : ''}>
          <span class="ws-feed-text">${feedNaturalText(f)}</span>
          <span class="ws-feed-time">${relativeTime(f.createdAt)}</span>
        </li>`;
      }
      html += `</ul></li>`;
    }
    container.innerHTML = html;

    // 클릭 이벤트 위임
    container.querySelectorAll('.ws-feed-item-v2.is-clickable').forEach(li => {
      li.addEventListener('click', () => {
        const url = li.dataset.feedUrl;
        if (url) location.href = url;
      });
    });
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

    // 알림 벨 — Phase 21 R2 IIFE에서 처리 (드롭다운 마운트)

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

    // "새 작업" 버튼 — 통합 작업 모달 연결
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ws-action="new-task"]');
      if (!btn) return;
      if (window.WorkspaceTaskModal) {
        WorkspaceTaskModal.openCreate({ source: 'worktool' });
      } else {
        location.href = '/workspace-kanban.html';
      }
    });

    // "새 메모" 버튼 → WorkspaceMemoModal 연결
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ws-action="new-memo"]');
      if (!btn) return;
      if (window.WorkspaceMemoModal) {
        WorkspaceMemoModal.openCreate();
      }
    });

    // "새 일정" 버튼 → 캘린더 페이지에서 새 일정 작성(워크툴엔 일정 모달 미탑재) · fix: 무반응 해결
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ws-action="new-event"]');
      if (!btn) return;
      location.href = '/workspace-calendar.html?new=event';
    });

    // 메모 모달 저장 → 목록 갱신
    window.addEventListener('wmm:saved', () => { loadMemos().catch(() => {}); });

    // 내 작업 패널 카드 클릭 → WBS #task=id 이동
    document.addEventListener('click', (e) => {
      const card = e.target.closest('#wsMyTaskList .ws-task-card');
      if (card && card.dataset.id) {
        location.href = '/workspace-kanban.html#task=' + card.dataset.id;
      }
    });

    // 지시함 패널 카드 클릭 → WBS #task=id 이동
    document.addEventListener('click', (e) => {
      const card = e.target.closest('#wsInboxList .ws-task-card');
      if (card && card.dataset.id) {
        location.href = '/workspace-kanban.html#task=' + card.dataset.id;
      }
    });

    // [감사#90] 브리핑 카드·전체보기·새로고침 죽은 버튼 활성화 (기존엔 핸들러 없어 주소 해시만 바뀜)
    document.addEventListener('click', (e) => {
      // 브리핑 카드(지연/오늘/내일/지시받음/긴급/오늘일정) → 칸반 보드(오늘 일정만 캘린더)
      const statCard = e.target.closest('[data-ws-filter]');
      if (statCard) {
        e.preventDefault();
        location.href = statCard.dataset.wsFilter === 'today-events'
          ? '/workspace-calendar.html' : '/workspace-kanban.html';
        return;
      }
      const act = e.target.closest('[data-ws-action]');
      if (!act) return;
      switch (act.dataset.wsAction) {
        case 'refresh':
          e.preventDefault();
          loadBriefing().catch(() => {}); loadMyTasks().catch(() => {}); loadInbox().catch(() => {});
          loadEvents().catch(() => {}); loadMemos().catch(() => {}); loadFeed().catch(() => {});
          showToast('새로고침했어요', 'success');
          break;
        case 'view-all-tasks':
        case 'view-all-inbox':
          e.preventDefault(); location.href = '/workspace-kanban.html'; break;
        case 'open-calendar':
        case 'view-all-memos':   // 메모 전용 목록 페이지 없음 → 캘린더(표시 메모 확인)
          e.preventDefault(); location.href = '/workspace-calendar.html'; break;
        case 'view-all-feed':
          e.preventDefault(); loadFeed().catch(() => {}); break;
        // new-task/new-memo/new-event/toggle-files 는 각자 핸들러 처리 — 여기선 무시
      }
    });

    // WorkspaceSync: 다른 탭에서 변경 시 내 작업/지시함 패널 자동 갱신
    if (window.WorkspaceSync) {
      WorkspaceSync.on('task:updated', () => { loadMyTasks().catch(() => {}); loadInbox().catch(() => {}); });
      WorkspaceSync.on('task:created', () => { loadMyTasks().catch(() => {}); loadInbox().catch(() => {}); });
      WorkspaceSync.on('task:deleted', () => { loadMyTasks().catch(() => {}); loadInbox().catch(() => {}); });
      WorkspaceSync.on('task:status',  () => { loadMyTasks().catch(() => {}); loadInbox().catch(() => {}); });
      WorkspaceSync.on('page:visible', () => { loadMyTasks().catch(() => {}); loadInbox().catch(() => {}); });
    }
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

    // 4. 폴링 (briefing만) — [감사#91] 백그라운드 탭이면 건너뜀(Neon 절전 방해·비용, a09eac89 패턴)
    STATE.pollTimer = setInterval(() => {
      if (document.hidden) return;
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
          <span class="ws-file-icon"></span>
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
          <span class="ws-file-icon"></span>
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

/* ═══════════════════════════════════════════════════════
   통합 검색 (Phase 3 Step 7-C.4.b.2)
   tasks(q) + memos(q) + files(search) → dropdown
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const wrap = document.getElementById('wsSearchWrap');
  const input = document.getElementById('wsSearchInput');
  const results = document.getElementById('wsSearchResults');
  if (!wrap || !input || !results) return;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }
  function formatSize(b) {
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return n + 'B';
    if (n < 1048576) return (n / 1024).toFixed(0) + 'KB';
    return (n / 1048576).toFixed(1) + 'MB';
  }

  let searchTimer;
  let lastQuery = '';

  function open() { results.hidden = false; }
  function close() { results.hidden = true; }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (!q) { close(); return; }
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) open();
  });

  // 외부 클릭 닫기
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) close();
  });
  // ESC 닫기
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !results.hidden) {
      close();
      input.blur();
    }
    // Ctrl+K / Cmd+K 단축키
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  async function runSearch(q) {
    if (q === lastQuery) return;
    lastQuery = q;
    open();
    results.innerHTML = '<div class="ws-search-loading">검색 중...</div>';

    const [tasks, memos, files] = await Promise.allSettled([
      fetchTasks(q),
      fetchMemos(q),
      fetchFiles(q),
    ]);

    const taskList = tasks.status === 'fulfilled' ? tasks.value : [];
    const memoList = memos.status === 'fulfilled' ? memos.value : [];
    const fileList = files.status === 'fulfilled' ? files.value : [];

    if (q !== lastQuery) return;  // 더 새로운 검색이 도착했으면 무시

    if (!taskList.length && !memoList.length && !fileList.length) {
      results.innerHTML = '<div class="ws-search-empty">"' + escapeHtml(q) + '"에 대한 결과가 없습니다.</div>';
      return;
    }

    const sections = [];
    if (taskList.length) {
      sections.push(`<div class="ws-search-section">
        <div class="ws-search-section-title">작업 (${taskList.length})</div>
        ${taskList.slice(0, 8).map(t => `
          <div class="ws-search-item" data-href="/workspace-kanban.html#task=${t.id}">
            <span class="ws-search-item-icon">${t.priority === 'urgent' ? '' : t.priority === 'high' ? '' : t.priority === 'low' ? '' : ''}</span>
            <span class="ws-search-item-title">${escapeHtml(t.title || '')}</span>
            <span class="ws-search-item-meta">${escapeHtml(t.status || '')}</span>
          </div>
        `).join('')}
      </div>`);
    }
    if (memoList.length) {
      sections.push(`<div class="ws-search-section">
        <div class="ws-search-section-title">메모 (${memoList.length})</div>
        ${memoList.slice(0, 5).map(m => `
          <div class="ws-search-item" data-href="/workspace.html#memos">
            <span class="ws-search-item-icon"></span>
            <span class="ws-search-item-title">${escapeHtml((m.title || '(제목 없음)').slice(0, 80))}</span>
            <span class="ws-search-item-meta">${m.isPinned ? '' : ''}</span>
          </div>
        `).join('')}
      </div>`);
    }
    if (fileList.length) {
      sections.push(`<div class="ws-search-section">
        <div class="ws-search-section-title">파일 (${fileList.length})</div>
        ${fileList.slice(0, 8).map(f => `
          <div class="ws-search-item" data-href="/workspace-files.html?search=${encodeURIComponent(q)}">
            <span class="ws-search-item-icon"></span>
            <span class="ws-search-item-title">${escapeHtml(f.name || '')}</span>
            <span class="ws-search-item-meta">${escapeHtml(formatSize(f.sizeBytes))}</span>
          </div>
        `).join('')}
      </div>`);
    }
    results.innerHTML = sections.join('');

    results.querySelectorAll('[data-href]').forEach(el => {
      el.addEventListener('click', () => {
        location.href = el.dataset.href;
      });
    });
  }

  async function fetchTasks(q) {
    try {
      const res = await fetch(`/api/admin-workspace-tasks?list=1&mine=1&q=${encodeURIComponent(q)}&limit=10`, {
        credentials: 'include',
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || json.items || [];
    } catch (_) { return []; }
  }
  async function fetchMemos(q) {
    try {
      // [감사#88] 서버는 list=1 또는 id=N만 처리 — list 누락 시 400 → 통합검색에서 메모가 항상 빈 결과
      const res = await fetch(`/api/admin-workspace-memos?list=1&q=${encodeURIComponent(q)}&limit=10`, {
        credentials: 'include',
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || json.items || [];
    } catch (_) { return []; }
  }
  async function fetchFiles(q) {
    try {
      const res = await fetch(`/api/admin-workspace-files?search=${encodeURIComponent(q)}&limit=10`, {
        credentials: 'include',
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data?.items || json.items || [];
    } catch (_) { return []; }
  }
})();

/* ═══════════════════════════════════════════════════════
   우선 작업 TOP 5 미니 위젯 (Phase 3 Step 7-A 하이브리드)
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const wrap = document.getElementById('wsPriorityWidget');
  const cards = document.getElementById('wsPriorityCards');
  if (!wrap || !cards) return;

  const STATUS_LABEL = {
    todo: '준비중',
    doing: '진행중',
    blocked: '보류',
    done: '완료',
    archived: '보관',
  };
  const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }
  function formatDue(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '';
    const diffDays = Math.ceil((date.getTime() - Date.now()) / 86400000);
    const dStr = `${date.getMonth() + 1}/${date.getDate()}`;
    if (diffDays < 0) return `${dStr} (지연 ${-diffDays}일)`;
    if (diffDays === 0) return `${dStr} (오늘)`;
    if (diffDays === 1) return `${dStr} (내일)`;
    if (diffDays <= 7) return `${dStr} (D-${diffDays})`;
    return dStr;
  }
  function dueClass(d) {
    if (!d) return '';
    const diffDays = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    if (diffDays < 0) return 'ws-priority-card-due-overdue';
    if (diffDays === 0) return 'ws-priority-card-due-today';
    return '';
  }

  async function loadTop5() {
    try {
      const res = await fetch('/api/admin-workspace-tasks?list=1&mine=1&limit=200', {
        credentials: 'include'
      });
      if (res.status === 401) return;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const items = json.data?.items || json.items || (Array.isArray(json.data) ? json.data : []) || [];

      const active = items.filter(t => t.status !== 'done' && t.status !== 'archived');
      active.sort((a, b) => {
        const pa = PRIORITY_RANK[a.priority] ?? 9;
        const pb = PRIORITY_RANK[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return da - db;
      });

      const top5 = active.slice(0, 5);
      if (!top5.length) {
        cards.innerHTML = '<div class="ws-priority-empty">진행 중인 작업이 없습니다.</div>';
        return;
      }
      cards.innerHTML = top5.map(t => `
<div class="ws-priority-card wp-priority-${escapeHtml(t.priority || 'normal')}" data-task-id="${t.id}">
  <span class="ws-priority-card-status">${STATUS_LABEL[t.status] || t.status}</span>
  <div class="ws-priority-card-title">${escapeHtml(t.title || '제목 없음')}</div>
  <div class="ws-priority-card-meta">
    ${t.dueDate ? `<span class="${dueClass(t.dueDate)}">${escapeHtml(formatDue(t.dueDate))}</span>` : ''}
    ${t.assignedBy ? '<span title="지시받음"></span>' : ''}
  </div>
</div>`).join('');

      cards.querySelectorAll('[data-task-id]').forEach(el => {
        el.addEventListener('click', () => {
          location.href = `/workspace-kanban.html#task=${el.dataset.taskId}`;
        });
      });
    } catch (err) {
      console.warn('[ws-priority] 로드 실패:', err);
      cards.innerHTML = '<div class="ws-priority-empty">로드 실패</div>';
    }
  }
  loadTop5();
})();

/* ═══════════════════════════════════════════════════════
   AI 브리핑 표시 (Phase 3 Step 5 — Agent-8)
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const wrap = document.getElementById('wsAiSuggestion');
  const list = document.getElementById('wsAiList');
  if (!wrap || !list) return;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  async function loadBriefing() {
    try {
      const res = await fetch('/api/admin-daily-briefing?today=1', { credentials: 'include' });
      if (res.status === 401 || !res.ok) return;
      const json = await res.json();
      const data = json.data || json;
      if (!data || data.exists === false) {
        wrap.style.display = 'none';
        return;
      }
      const suggestions = Array.isArray(data.aiSuggestions) ? data.aiSuggestions : [];
      const alerts = Array.isArray(data.riskAlerts) ? data.riskAlerts : [];
      if (!suggestions.length && !alerts.length) {
        wrap.style.display = 'none';
        return;
      }
      const items = [
        ...alerts.map(a => `<li class="ws-ai-item ws-ai-alert ws-ai-${escapeHtml(a.severity || 'medium')}">${escapeHtml(a.message || '')}</li>`),
        ...suggestions.map(s => `<li class="ws-ai-item ws-ai-${escapeHtml(s.severity || 'medium')}"><strong>${escapeHtml(s.title || '')}</strong>${s.reason ? ` <span class="ws-ai-reason">— ${escapeHtml(s.reason)}</span>` : ''}</li>`)
      ];
      list.innerHTML = items.join('');
      wrap.style.display = '';
    } catch (err) {
      console.warn('[ws] briefing today 실패:', err);
    }
  }
  loadBriefing();
})();

/* ═══════════════════════════════════════════════════════
   Phase 21 R2 — 할당한 작업·미할당 서비스 + 알림 벨 드롭다운
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const t = new Date(ts).getTime();
    if (!t) return '';
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 60) return '방금 전';
    if (sec < 3600) return Math.floor(sec / 60) + '분 전';
    if (sec < 86400) return Math.floor(sec / 3600) + '시간 전';
    if (sec < 604800) return Math.floor(sec / 86400) + '일 전';
    return (typeof window.fmtKSTDate === 'function') ? window.fmtKSTDate(ts) : new Date(ts).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    if (res.status === 401) { location.href = '/admin.html'; throw new Error('UNAUTHORIZED'); }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
    return data;
  }

  function showToast(msg, type) {
    const root = $('#wsToastRoot');
    if (!root) { console.warn('[ws-r2]', msg); return; }
    const el = document.createElement('div');
    el.className = `ws-toast ws-toast-${type || 'info'}`;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('ws-toast-out');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  /* ─────────── 할당한 작업 패널 ─────────── */
  async function loadAssignedByMe() {
    const ul = $('#wsAssignedByMeList');
    const badge = $('#wsAssignedByMeBadge');
    if (!ul) return;
    try {
      const res = await api('/api/admin-workspace-tasks?list=1&assignedByMe=1');
      const data = (res && res.data) || res || {};
      const items = Array.isArray(data.items) ? data.items : [];
      if (badge) badge.textContent = String(items.length);
      if (!items.length) {
        ul.innerHTML = '<li class="ws-empty">할당한 작업이 없습니다</li>';
        return;
      }
      ul.innerHTML = items.map(t => {
        const assigneeUid = t.assignedTo != null ? t.assignedTo : t.assigneeUid;
        const assigneeName = t.assignedToName || t.assigneeName;
        return `
        <li class="ws-task-card" data-id="${t.id}" data-priority="${escapeHtml(t.priority || 'normal')}">
          <span class="ws-task-priority">${t.priority === 'urgent' ? '' : t.priority === 'high' ? '' : t.priority === 'low' ? '' : ''}</span>
          <div class="ws-task-body">
            <div class="ws-task-title">${escapeHtml(t.title || '(제목 없음)')}</div>
            <div class="ws-task-meta">
              <span class="ws-task-assignee">현재 담당자: ${escapeHtml(assigneeName || ('#' + (assigneeUid || '?')))}</span>
              ${t.progress != null ? `<span class="ws-task-progress">${Number(t.progress) || 0}%</span>` : ''}
            </div>
          </div>
        </li>`;
      }).join('');
    } catch (err) {
      console.warn('[ws-r2] assignedByMe 실패:', err);
      ul.innerHTML = '<li class="ws-error">불러오기 실패</li>';
    }
  }

  /* ─────────── 미할당 서비스 패널 (어드민만) ─────────── */
  async function loadUnassigned(isAdmin) {
    const panel = $('#wsPanelUnassigned');
    const ul = $('#wsUnassignedList');
    const badge = $('#wsUnassignedBadge');
    if (!panel || !ul) return;

    if (!isAdmin) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';

    try {
      const res = await api('/api/admin-workspace-tasks?list=1&unassigned=1');
      const data = (res && res.data) || res || {};
      const items = Array.isArray(data.items) ? data.items : [];
      if (badge) badge.textContent = String(items.length);
      if (!items.length) {
        ul.innerHTML = '<li class="ws-empty">미할당 카드가 없습니다</li>';
        return;
      }
      ul.innerHTML = items.map(t => {
        const sourceKind = t.sourceType || t.sourceServiceKind;
        return `
        <li class="ws-task-card" data-id="${t.id}" data-priority="${escapeHtml(t.priority || 'normal')}">
          <span class="ws-task-priority"></span>
          <div class="ws-task-body">
            <div class="ws-task-title">${escapeHtml(t.title || '(제목 없음)')}</div>
            <div class="ws-task-meta">
              ${sourceKind ? `<span class="ws-task-source">${escapeHtml(sourceKind)}</span>` : ''}
              <span class="ws-task-status">미할당</span>
            </div>
          </div>
        </li>`;
      }).join('');
    } catch (err) {
      console.warn('[ws-r2] unassigned 실패:', err);
      ul.innerHTML = '<li class="ws-error">불러오기 실패</li>';
    }
  }

  /* ─────────── 알림 벨 드롭다운 ─────────── */
  const CATEGORY_BADGE = {
    assign: { label: '할당', cls: 'ws-notif-cat-assign' },
    due:    { label: '마감', cls: 'ws-notif-cat-due' },
    mention:{ label: '멘션', cls: 'ws-notif-cat-mention' },
    transfer:{ label: '토스', cls: 'ws-notif-cat-transfer' },
    watcher:{ label: '관찰', cls: 'ws-notif-cat-watcher' },
    system: { label: '시스템', cls: 'ws-notif-cat-system' },
  };

  let dropdownOpen = false;
  let lastFetchTs = 0;

  async function loadNotifications() {
    const list = $('#wsNotifDropdownList');
    if (!list) return;
    try {
      const res = await api('/api/admin-workspace-notifications?limit=10');
      const data = (res && res.data) || res || {};
      const items = Array.isArray(data.items) ? data.items : [];
      const unread = Number(data.unreadCount || 0);

      // 벨 카운트 갱신
      const count = $('#wsNotifCount');
      if (count) {
        if (unread > 0) {
          count.textContent = unread > 99 ? '99+' : String(unread);
          count.style.display = '';
        } else {
          count.style.display = 'none';
        }
      }

      if (!items.length) {
        list.innerHTML = '<li class="ws-notif-dropdown-empty">알림이 없습니다</li>';
        return;
      }

      list.innerHTML = items.map(n => {
        const cat = CATEGORY_BADGE[n.category] || { label: n.category || '-', cls: 'ws-notif-cat-system' };
        const isRead = !!n.readAt;
        // B 명세: 알림 클릭 시 이동 경로 = actionUrl (옛 linkUrl)
        const url = n.actionUrl || n.linkUrl || '';
        return `
          <li class="ws-notif-item ${isRead ? 'is-read' : 'is-unread'}" data-id="${n.id}" data-source="${escapeHtml(n.source || 'ws')}" data-url="${escapeHtml(url)}">
            <span class="ws-notif-dot">${isRead ? '○' : '●'}</span>
            <div class="ws-notif-body">
              <div class="ws-notif-title">${escapeHtml(n.title || n.message || '알림')}</div>
              <div class="ws-notif-meta">
                <span class="ws-notif-time">${escapeHtml(timeAgo(n.sentAt || n.createdAt))}</span>
                <span class="ws-notif-cat ${cat.cls}">${escapeHtml(cat.label)}</span>
              </div>
            </div>
          </li>`;
      }).join('');
    } catch (err) {
      console.warn('[ws-r2] notifications 실패:', err);
      list.innerHTML = '<li class="ws-notif-dropdown-empty">불러오기 실패</li>';
    }
  }

  function openDropdown() {
    const dd = $('#wsNotifDropdown');
    if (!dd) return;
    dd.hidden = false;
    dropdownOpen = true;
    // 마지막 호출에서 충분히 시간이 지났으면 새로 로드
    if (Date.now() - lastFetchTs > 5000) {
      lastFetchTs = Date.now();
      loadNotifications();
    }
  }

  function closeDropdown() {
    const dd = $('#wsNotifDropdown');
    if (!dd) return;
    dd.hidden = true;
    dropdownOpen = false;
  }

  function bindNotifBell() {
    const bell = $('#wsNotifBell');
    if (!bell) return;

    // 기존 placeholder 핸들러를 무력화 — 이벤트 위임으로 처리
    bell.addEventListener('click', (e) => {
      // 드롭다운 내부 클릭은 별도 처리 (외부 클릭 닫기와 분리)
      if (e.target.closest('#wsNotifDropdown')) return;
      e.stopPropagation();
      if (dropdownOpen) closeDropdown(); else openDropdown();
    });

    // 알림 항목 클릭 → 읽음 + 이동
    document.addEventListener('click', async (e) => {
      const item = e.target.closest('#wsNotifDropdownList .ws-notif-item');
      if (!item) return;
      e.stopPropagation();
      const id = Number(item.dataset.id);
      const url = item.dataset.url;
      // [감사#26] 통합 알림은 두 테이블(ws/notif) 혼재 — source를 함께 보내야 올바른 테이블이 읽음 처리됨
      const source = item.dataset.source || 'ws';
      try {
        await api('/api/admin-workspace-notifications', { method: 'POST', body: { id, source } });
      } catch (_) { /* 읽음 실패는 무시 */ }
      if (url) location.href = url;
    });

    // 모두 읽음
    const markAll = $('#wsNotifMarkAll');
    if (markAll) {
      markAll.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api('/api/admin-workspace-notifications', { method: 'POST', body: { all: true } });
          showToast('모든 알림을 읽음 처리했어요', 'success');
          await loadNotifications();
        } catch (err) {
          showToast('처리 실패: ' + err.message, 'error');
        }
      });
    }

    // 외부 클릭 닫기
    document.addEventListener('click', (e) => {
      if (!dropdownOpen) return;
      if (e.target.closest('#wsNotifBell')) return;
      closeDropdown();
    });

    // ESC 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdownOpen) closeDropdown();
    });
  }

  /* ─────────── 멘션 알림 배지 (#2) ─────────── */

  let mentionDropOpen = false;
  let mentionLastFetch = 0;

  async function loadMentions() {
    const list = $('#wsMentionDropdownList');
    if (!list) return;
    let items = [];
    try {
      const ws = (window.STATE && window.STATE.currentWorkspaceId) || 1;
      const res = await api(`/api/workspace-task-mentions?workspaceId=${ws}&unreadOnly=true`);
      items = (res.data || res).mentions || [];
    } catch (_) {
      items = [];
    }
    const countEl = $('#wsMentionCount');
    if (countEl) {
      if (items.length > 0) {
        countEl.textContent = items.length > 99 ? '99+' : String(items.length);
        countEl.style.display = '';
      } else {
        countEl.style.display = 'none';
      }
    }
    if (!items.length) {
      list.innerHTML = '<li class="ws-notif-dropdown-empty">읽지 않은 멘션이 없습니다</li>';
      return;
    }
    list.innerHTML = items.map(m => `
      <li class="ws-notif-item is-unread" data-mention-id="${m.id}" data-task-id="${m.taskId}" style="cursor:pointer">
        <span class="ws-notif-dot">@</span>
        <div class="ws-notif-body">
          <div class="ws-notif-title">${escapeHtml(m.taskTitle || '작업')}</div>
          <div class="ws-notif-meta" style="font-size:11px;color:#6b7280">${escapeHtml(m.mentionerName || '')} · ${escapeHtml(m.context || '')}</div>
        </div>
      </li>`).join('');
  }

  function bindMentionBell() {
    const bell = $('#wsMentionBell');
    if (!bell) return;

    bell.addEventListener('click', (e) => {
      if (e.target.closest('#wsMentionDropdown')) return;
      e.stopPropagation();
      const dd = $('#wsMentionDropdown');
      if (!dd) return;
      mentionDropOpen = !mentionDropOpen;
      dd.hidden = !mentionDropOpen;
      if (mentionDropOpen && Date.now() - mentionLastFetch > 5000) {
        mentionLastFetch = Date.now();
        loadMentions();
      }
    });

    // 멘션 항목 클릭 → 해당 Task 이동 + 읽음 처리
    document.addEventListener('click', async (e) => {
      const item = e.target.closest('#wsMentionDropdownList .ws-notif-item');
      if (!item) return;
      e.stopPropagation();
      const mentionId = Number(item.dataset.mentionId);
      const taskId = Number(item.dataset.taskId);
      try {
        if (mentionId) {
          // Q3-003 fix: 서버 PATCH 계약(body.ids 배열)과 일치 — 기존 ?id=&isRead 는 서버가 무시해 항상 400
          await api(`/api/workspace-task-mentions`, { method: 'PATCH', body: { ids: [mentionId] } });
        }
      } catch (_) {}
      if (taskId) location.href = `/workspace-kanban.html#task=${taskId}`;
    });

    // 외부 클릭 닫기
    document.addEventListener('click', (e) => {
      if (!mentionDropOpen) return;
      if (e.target.closest('#wsMentionBell')) return;
      const dd = $('#wsMentionDropdown');
      if (dd) dd.hidden = true;
      mentionDropOpen = false;
    });
  }

  /* ─────────── 카드 클릭 → WBS 이동 ─────────── */
  function bindPanelClicks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('#wsAssignedByMeList .ws-task-card');
      if (a && a.dataset.id) {
        location.href = '/workspace-kanban.html#task=' + a.dataset.id;
        return;
      }
      const u = e.target.closest('#wsUnassignedList .ws-task-card');
      if (u && u.dataset.id) {
        location.href = '/workspace-kanban.html#task=' + u.dataset.id;
      }
    });
  }

  /* ─────────── 권한 조회 + 초기화 ─────────── */
  async function detectAdmin() {
    try {
      const res = await api('/api/admin/me');
      const me = (res && res.data) || res || {};
      return !!(me && (me.role === 'super_admin' || me.role === 'admin' || me.isAdmin));
    } catch (_) {
      // 실패 시 false (안전)
      return false;
    }
  }

  async function init() {
    bindNotifBell();
    bindMentionBell();
    bindPanelClicks();

    const isAdmin = await detectAdmin();

    await Promise.allSettled([
      loadAssignedByMe(),
      loadUnassigned(isAdmin),
      loadNotifications(),
      loadMentions(),
    ]);

    // WorkspaceSync 채널로 알림 갱신 트리거
    if (window.WorkspaceSync) {
      WorkspaceSync.on('notification:new', () => loadNotifications().catch(() => {}));
      WorkspaceSync.on('task:updated',     () => { loadAssignedByMe().catch(() => {}); loadUnassigned(isAdmin).catch(() => {}); });
      WorkspaceSync.on('task:created',     () => { loadAssignedByMe().catch(() => {}); loadUnassigned(isAdmin).catch(() => {}); });
      WorkspaceSync.on('page:visible',     () => { loadNotifications().catch(() => {}); loadMentions().catch(() => {}); });
    }

    // 폴링 (60초) — [감사#91] 백그라운드 탭이면 건너뜀(Neon 절전 방해·비용, a09eac89 패턴)
    setInterval(() => {
      if (document.hidden) return;
      loadNotifications().catch(() => {});
      loadMentions().catch(() => {});
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
