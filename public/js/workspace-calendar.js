/**
 * Phase 3 Step 7-C.3 — 캘린더 뷰
 *
 * 작업 마감일(workspace_tasks.dueDate)과 일정(workspace_events)을 통합 표시.
 * FullCalendar 6 (3중 CDN fallback) 기반.
 */
(function () {
  'use strict';

  const STATE = {
    calendar: null,
    me: null,
    showTasks: true,
    showEvents: true,
    scope: 'mine',     // mine | all
    rangeStart: null,
    rangeEnd: null,
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

  /* ═══════════════════ 데이터 로드 ═══════════════════ */
  async function fetchEvents(start, end) {
    STATE.rangeStart = start;
    STATE.rangeEnd = end;
    const promises = [];

    if (STATE.showTasks) promises.push(loadTasks(start, end));
    if (STATE.showEvents) promises.push(loadEvents(start, end));

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

  async function loadEvents(start, end) {
    const startDate = (start instanceof Date ? start : new Date(start)).toISOString().slice(0, 10);
    const endDate = (end instanceof Date ? end : new Date(end)).toISOString().slice(0, 10);
    const params = new URLSearchParams();
    params.set('list', '1');
    params.set('from', startDate);
    params.set('to', endDate);
    if (STATE.scope === 'mine') params.set('mine', '1');
    try {
      const res = await api(`/api/admin-workspace-events?${params}`);
      const items = res.data?.items || res.data || [];
      return items.map(ev => {
        const cls = ev.eventType && ev.eventType !== 'general'
          ? `wc-ev-event-${ev.eventType}`
          : 'wc-ev-event';
        return {
          id: `event-${ev.id}`,
          title: `[일정] ${ev.title}`,
          start: ev.startAt,
          end: ev.endAt,
          allDay: !!ev.allDay,
          classNames: [cls],
          extendedProps: {
            type: 'event',
            eventId: ev.id,
            location: ev.location,
            description: ev.description,
            eventType: ev.eventType,
          },
        };
      });
    } catch (err) {
      console.warn('[calendar] events 로드 실패:', err);
      return [];
    }
  }

  /* ═══════════════════ 이벤트 클릭 처리 ═══════════════════ */
  function onEventClick(info) {
    const ext = info.event.extendedProps;
    if (!ext) return;

    if (ext.type === 'task') {
      // 작업 → 칸반 카드 모달
      location.href = `/workspace-kanban.html#task=${ext.taskId}`;
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
      firstDay: 0,                 // 일요일 시작
      weekends: true,
      nowIndicator: true,
      navLinks: true,
      dayMaxEventRows: 4,
      eventClick: onEventClick,
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

    // WorkspaceSync: 작업 변경 시 캘린더 자동 갱신
    if (window.WorkspaceSync) {
      const refetch = () => { try { STATE.calendar?.refetchEvents(); } catch (_) {} };
      WorkspaceSync.on('task:updated', refetch);
      WorkspaceSync.on('task:created', refetch);
      WorkspaceSync.on('task:deleted', refetch);
      WorkspaceSync.on('task:status',  refetch);
      WorkspaceSync.on('page:visible', refetch);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
