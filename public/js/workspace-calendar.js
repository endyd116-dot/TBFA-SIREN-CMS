/**
 * Phase 21 R4 — 캘린더 뷰 (v3)
 *
 * 작업 마감일(workspace_tasks.dueDate) + 일정(workspace_events) + 메모(showInCalendar=true) 통합 표시.
 * FullCalendar 6 (3중 CDN fallback) 기반.
 *
 * R4 추가:
 *  - YIQ 명도 대비 자동 텍스트 색상
 *  - dateClick → 3옵션 팝업 (업무/일정/메모)
 *  - loadEvents에 includeMemos=1 파라미터
 */
(function () {
  'use strict';

  // mock 데이터 (B 머지 전 사용 — B 머지 후 실제 API 응답으로 자동 대체)
  const MOCK_EVENTS = [
    { type: 'event', id: 7,  title: '운영회의', startAt: '2026-05-13T10:00:00', endAt: '2026-05-13T11:00:00', allDay: false },
    { type: 'memo',  id: 12, title: '예시 메모', startAt: '2026-05-15T14:00:00', endAt: null, allDay: false, color: '#fff3cd', isPinned: false },
  ];

  const STATE = {
    calendar: null,
    me: null,
    showTasks: true,
    showEvents: true,
    showMemos: true,
    scope: 'mine',     // mine | all
    rangeStart: null,
    rangeEnd: null,
    // 빈 셀 클릭 팝업 DOM
    datePopup: null,
  };

  function $(s, root = document) { return root.querySelector(s); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toast(msg, type) {
    const root = $('#wcToastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
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

  /* ═══════════════════ FullCalendar 폴백 로드 ═══════════════════ */
  function ensureFullCalendar() {
    if (typeof FullCalendar !== 'undefined') return Promise.resolve();
    const cdns = [
      'https://unpkg.com/fullcalendar@6.1.11/index.global.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/fullcalendar/6.1.11/index.global.min.js',
    ];
    return new Promise((resolve, reject) => {
      let i = 0;
      const tryNext = () => {
        if (typeof FullCalendar !== 'undefined') return resolve();
        if (i >= cdns.length) return reject(new Error('FullCalendar 로드 실패'));
        const s = document.createElement('script');
        s.src = cdns[i++];
        s.onload = resolve;
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
  }

  /* ═══════════════════ YIQ 텍스트 색상 ═══════════════════ */
  function yiqTextColor(bgHex) {
    if (!bgHex || bgHex.length < 7) return '#fff';
    try {
      const r = parseInt(bgHex.slice(1, 3), 16);
      const g = parseInt(bgHex.slice(3, 5), 16);
      const b = parseInt(bgHex.slice(5, 7), 16);
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 128 ? '#000' : '#fff';
    } catch (_) { return '#fff'; }
  }

  /* ═══════════════════ 데이터 로드 ═══════════════════ */
  async function fetchEvents(start, end) {
    STATE.rangeStart = start;
    STATE.rangeEnd = end;
    const promises = [];

    if (STATE.showTasks) promises.push(loadTasks(start, end));
    promises.push(loadEventsAndMemos(start, end));  // 일정 + 메모 통합 (showEvents / showMemos 내부 적용)

    const results = await Promise.allSettled(promises);
    const all = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
      else if (r.status === 'rejected') console.warn('[calendar] partial fail:', r.reason);
    }
    return all;
  }

  async function loadTasks(start, end) {
    const params = new URLSearchParams();
    params.set('list', '1');
    if (STATE.scope === 'mine') params.set('mine', '1');
    params.set('limit', '500');
    const startDate = (start instanceof Date ? start : new Date(start)).toISOString();
    const endDate = (end instanceof Date ? end : new Date(end)).toISOString();
    params.set('dueBefore', endDate);
    try {
      const res = await api(`/api/admin-workspace-tasks?${params}`);
      const items = res.data?.items || res.data || [];
      return items
        .filter(t => t.dueDate && new Date(t.dueDate) >= new Date(startDate) && new Date(t.dueDate) <= new Date(endDate))
        .filter(t => t.status !== 'archived')
        .map(t => {
          const isDone = t.status === 'done';
          const cls = isDone ? 'wc-ev-task-done' : `wc-ev-task-${t.priority || 'normal'}`;
          return {
            id: `task-${t.id}`,
            title: `[작업] ${t.title}`,
            start: t.dueDate,
            allDay: true,
            classNames: [cls],
            extendedProps: { type: 'task', taskId: t.id, status: t.status, priority: t.priority },
          };
        });
    } catch (err) {
      console.warn('[calendar] tasks 로드 실패:', err);
      return [];
    }
  }

  async function loadEventsAndMemos(start, end) {
    const startDate = (start instanceof Date ? start : new Date(start)).toISOString().slice(0, 10);
    const endDate = (end instanceof Date ? end : new Date(end)).toISOString().slice(0, 10);
    const params = new URLSearchParams();
    params.set('list', '1');
    params.set('from', startDate);
    params.set('to', endDate);
    if (STATE.scope === 'mine') params.set('mine', '1');
    if (STATE.showMemos) params.set('includeMemos', '1');

    try {
      const res = await api(`/api/admin-workspace-events?${params}`);
      const items = res.data?.items || res.data || [];
      const result = [];

      for (const row of items) {
        if (row.type === 'memo') {
          // 메모 미러링 row — B 머지 후 실제 row, 전/mock 데이터
          if (!STATE.showMemos) continue;
          const bgColor = row.color || '#fff3cd';
          result.push({
            id: `memo-${row.id}`,
            title: `📝 ${row.title || '(메모)'}`,
            start: row.startAt,
            end: row.endAt || undefined,
            allDay: !!row.allDay,
            backgroundColor: bgColor,
            borderColor: bgColor,
            textColor: yiqTextColor(bgColor),
            classNames: ['wc-ev-memo'],
            extendedProps: {
              type: 'memo',
              memoId: row.id,
              isPinned: row.isPinned,
              color: bgColor,
            },
          });
        } else {
          // 일정 row
          if (!STATE.showEvents) continue;
          const cls = row.eventType && row.eventType !== 'general'
            ? `wc-ev-event-${row.eventType}`
            : 'wc-ev-event';
          result.push({
            id: `event-${row.id}`,
            title: `[일정] ${row.title}`,
            start: row.startAt,
            end: row.endAt,
            allDay: !!row.allDay,
            classNames: [cls],
            extendedProps: {
              type: 'event',
              eventId: row.id,
              location: row.location,
              description: row.description,
              eventType: row.eventType,
            },
          });
        }
      }
      return result;
    } catch (err) {
      // API 미존재(B 머지 전) 시 mock 데이터로 폴백
      console.warn('[calendar] events/memos 로드 실패 — mock 사용:', err);
      return MOCK_EVENTS.map(row => {
        if (row.type === 'memo') {
          if (!STATE.showMemos) return null;
          const bgColor = row.color || '#fff3cd';
          return {
            id: `memo-${row.id}`,
            title: `📝 ${row.title}`,
            start: row.startAt,
            allDay: !!row.allDay,
            backgroundColor: bgColor,
            borderColor: bgColor,
            textColor: yiqTextColor(bgColor),
            classNames: ['wc-ev-memo'],
            extendedProps: { type: 'memo', memoId: row.id, color: bgColor },
          };
        }
        if (!STATE.showEvents) return null;
        return {
          id: `event-${row.id}`,
          title: `[일정] ${row.title}`,
          start: row.startAt,
          end: row.endAt,
          allDay: !!row.allDay,
          classNames: ['wc-ev-event'],
          extendedProps: { type: 'event', eventId: row.id },
        };
      }).filter(Boolean);
    }
  }

  /* ═══════════════════ 날짜 팝업 (빈 셀 클릭 3옵션) ═══════════════════ */
  function showDatePopup(dateStr, anchorEl) {
    closeDatePopup();

    const popup = document.createElement('div');
    popup.id = 'wcDatePopup';
    popup.style.cssText = `
      position:absolute;z-index:8000;background:#fff;border:1px solid #e2e8f0;
      border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);padding:8px 0;min-width:160px;
    `;
    popup.innerHTML = `
      <div style="padding:6px 14px;font-size:11.5px;color:#94a3b8;font-weight:600;border-bottom:1px solid #f1f5f9;margin-bottom:4px">
        이 날짜에 추가
      </div>
      <button class="wc-popup-btn" data-action="task"  style="${popBtnStyle()}">➕ 업무</button>
      <button class="wc-popup-btn" data-action="event" style="${popBtnStyle()}">📅 일정</button>
      <button class="wc-popup-btn" data-action="memo"  style="${popBtnStyle()}">📝 메모</button>
    `;

    // anchorEl 기준 위치
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      popup.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
      popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    }

    document.body.appendChild(popup);
    STATE.datePopup = popup;

    popup.querySelectorAll('.wc-popup-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        closeDatePopup();
        if (action === 'task') {
          if (window.WorkspaceTaskModal) WorkspaceTaskModal.openCreate({ dueDate: dateStr });
          else location.href = `/workspace-kanban.html?newTask=1&date=${dateStr}`;
        } else if (action === 'event') {
          openEventModal({ startDate: dateStr });
        } else if (action === 'memo') {
          if (window.WorkspaceMemoModal) WorkspaceMemoModal.openCreate({ showInCalendar: true, eventDate: dateStr });
        }
      });
    });

    setTimeout(() => {
      document.addEventListener('click', outsidePopupClose);
    }, 10);
  }

  function popBtnStyle() {
    return 'display:block;width:100%;text-align:left;padding:9px 16px;border:none;background:none;font-size:13px;color:#374151;cursor:pointer;transition:background .1s';
  }

  function closeDatePopup() {
    if (STATE.datePopup) { STATE.datePopup.remove(); STATE.datePopup = null; }
    document.removeEventListener('click', outsidePopupClose);
  }

  function outsidePopupClose(e) {
    if (STATE.datePopup && !STATE.datePopup.contains(e.target)) closeDatePopup();
  }

  function openEventModal(opts) {
    // R2+R3에서 만든 일정 모달 연결 (있으면 사용, 없으면 기본 네비)
    if (window.WorkspaceEventModal) {
      WorkspaceEventModal.openCreate(opts);
    } else {
      const url = '/workspace-calendar.html' + (opts && opts.startDate ? '?newEvent=1&date=' + opts.startDate : '');
      location.href = url;
    }
  }

  /* ═══════════════════ 이벤트 클릭 처리 ═══════════════════ */
  function onEventClick(info) {
    const ext = info.event.extendedProps;
    if (!ext) return;

    if (ext.type === 'task') {
      location.href = `/workspace-kanban.html#task=${ext.taskId}`;
      return;
    }

    if (ext.type === 'memo') {
      // 메모 → 수정 모달
      if (window.WorkspaceMemoModal) {
        WorkspaceMemoModal.openEdit(ext.memoId);
      }
      return;
    }

    // 일정 → 인라인 모달 (간단 표시)
    $('#wcEventModalTitle').textContent = info.event.title.replace(/^\[일정\]\s?/, '');
    const start = info.event.start;
    const end = info.event.end;
    const fmt = (d) => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    };
    $('#wcEventTime').textContent = `📅 ${fmt(start)}${end ? ' ~ ' + fmt(end) : ''}`;
    $('#wcEventLocation').textContent = ext.location ? `📍 ${ext.location}` : '';
    $('#wcEventDesc').textContent = ext.description || '';
    $('#wcEventModal').classList.add('is-open');
    $('#wcEventModal').setAttribute('aria-hidden', 'false');
  }

  /* ═══════════════════ 사용자 정보 ═══════════════════ */
  async function loadMe() {
    try {
      const res = await api('/api/admin/me');
      const me = res.data || res;
      STATE.me = me;
      const nameEl = $('#wsSidebarUserName');
      if (nameEl) nameEl.textContent = me.name || me.email || '사용자';
    } catch (_) {}
  }

  /* ═══════════════════ 캘린더 초기화 ═══════════════════ */
  function initCalendar() {
    const el = $('#wcCalendar');
    if (!el) return;

    STATE.calendar = new FullCalendar.Calendar(el, {
      locale: 'ko',
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
      },
      buttonText: {
        today: '오늘',
        month: '월',
        week: '주',
        day: '일',
        list: '목록',
      },
      height: 'auto',
      firstDay: 0,
      weekends: true,
      nowIndicator: true,
      navLinks: true,
      dayMaxEventRows: 4,
      eventClick: onEventClick,
      // YIQ 텍스트 색상 자동 적용
      eventDidMount(info) {
        const bgColor = info.event.backgroundColor;
        if (bgColor) {
          const textColor = yiqTextColor(bgColor);
          info.el.style.color = textColor;
          const titleEl = info.el.querySelector('.fc-event-title');
          if (titleEl) titleEl.style.color = textColor;
        }
      },
      // 빈 셀 클릭 → 3옵션 팝업
      dateClick(info) {
        // 이벤트 클릭과 충돌 방지 — 이벤트 있는 날짜 클릭은 eventClick이 먼저 처리
        const dateStr = info.dateStr;  // YYYY-MM-DD
        showDatePopup(dateStr, info.dayEl);
      },
      events: async (info, success, failure) => {
        try {
          const items = await fetchEvents(info.start, info.end);
          success(items);
        } catch (err) {
          failure(err);
        }
      },
    });

    STATE.calendar.render();
  }

  /* ═══════════════════ 이벤트 바인딩 ═══════════════════ */
  function bind() {
    $('#wcFilterTasks')?.addEventListener('change', e => {
      STATE.showTasks = e.target.checked;
      STATE.calendar?.refetchEvents();
    });
    $('#wcFilterEvents')?.addEventListener('change', e => {
      STATE.showEvents = e.target.checked;
      STATE.calendar?.refetchEvents();
    });
    $('#wcFilterMemos')?.addEventListener('change', e => {
      STATE.showMemos = e.target.checked;
      STATE.calendar?.refetchEvents();
    });
    $('#wcFilterScope')?.addEventListener('change', e => {
      STATE.scope = e.target.value;
      STATE.calendar?.refetchEvents();
    });
    $('#wcBtnRefresh')?.addEventListener('click', () => STATE.calendar?.refetchEvents());

    // 모달 닫기
    document.addEventListener('click', e => {
      const close = e.target.closest('[data-close-modal]');
      if (close) {
        const m = $('#' + close.dataset.closeModal);
        if (m) {
          m.classList.remove('is-open');
          m.setAttribute('aria-hidden', 'true');
        }
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = document.querySelector('.wk-modal.is-open');
        if (m) {
          m.classList.remove('is-open');
          m.setAttribute('aria-hidden', 'true');
        }
      }
    });

    // 로그아웃
    $('#wsBtnLogout')?.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
      location.href = '/admin.html';
    });
  }

  /* ═══════════════════ 초기화 ═══════════════════ */
  async function init() {
    bind();
    try {
      await ensureFullCalendar();
    } catch (err) {
      $('#wcCalendar').innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626">캘린더 라이브러리 로드 실패. 페이지 새로고침 또는 잠시 후 다시 시도해주세요.</div>';
      return;
    }
    await Promise.all([loadMe(), Promise.resolve()]);
    initCalendar();

    // WorkspaceSync: 작업·메모 변경 시 캘린더 자동 갱신
    if (window.WorkspaceSync) {
      const refetch = () => { try { STATE.calendar?.refetchEvents(); } catch (_) {} };
      WorkspaceSync.on('task:updated', refetch);
      WorkspaceSync.on('task:created', refetch);
      WorkspaceSync.on('task:deleted', refetch);
      WorkspaceSync.on('task:status',  refetch);
      WorkspaceSync.on('page:visible', refetch);
      WorkspaceSync.on('memo:created', refetch);
      WorkspaceSync.on('memo:updated', refetch);
    }

    // 메모 모달 저장 이벤트 → 캘린더 갱신
    window.addEventListener('wmm:saved', () => {
      try { STATE.calendar?.refetchEvents(); } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
