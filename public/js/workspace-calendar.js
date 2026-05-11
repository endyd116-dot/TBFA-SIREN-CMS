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
      /* ★ 2026-05-12 v2 — 셀 클릭 → 빠른 추가 모달 (작업/메모/일정 선택) */
      dateClick: (info) => onDateClick(info),
      selectable: true,
      /* ★ 2026-05-12 v2 — 텍스트 자동 대비 (배경색 밝기 계산) */
      eventDidMount: (info) => {
        try {
          const el = info.el;
          const bg = window.getComputedStyle(el).backgroundColor || '';
          const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
            /* 인지 밝기 (W3C 공식) */
            const yiq = (r * 299 + g * 587 + b * 114) / 1000;
            el.style.color = yiq >= 150 ? '#1a1a1a' : '#ffffff';
            /* 내부 텍스트 요소도 강제 */
            el.querySelectorAll('.fc-event-title, .fc-event-time, .fc-event-main, .fc-list-event-title').forEach(t => {
              t.style.color = 'inherit';
            });
          }
        } catch (_) {}
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

  /* ─────── 셀 클릭 → 빠른 추가 모달 (2026-05-12 v2) ─────── */
  function onDateClick(info) {
    const dateStr = info.dateStr; // 'yyyy-MM-dd' 또는 'yyyy-MM-ddTHH:mm:ss'
    const isTimedView = /T\d/.test(dateStr);
    const baseDate = info.date || new Date(dateStr);

    /* 시간 정보가 없으면 09:00 기본 */
    const start = new Date(baseDate);
    if (!isTimedView) start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    showQuickAddPicker(start, end);
  }

  function showQuickAddPicker(start, end) {
    /* 작업/메모/일정 중 선택하는 작은 메뉴 */
    const existing = document.getElementById('wcQuickAddOverlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'wcQuickAddOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    ov.innerHTML = `
      <div style="background:#fff;border-radius:12px;width:100%;max-width:340px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden">
        <div style="padding:14px 18px;background:linear-gradient(135deg,#7a1f2b,#a3303f);color:#fff;display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:14px">＋ ${fmt(start)}</strong>
          <button data-close style="background:rgba(255,255,255,.2);border:none;color:#fff;width:26px;height:26px;border-radius:5px;cursor:pointer">×</button>
        </div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
          <button data-type="event" style="padding:12px;text-align:left;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13.5px;font-weight:600">
            📅 새 일정 만들기
            <div style="font-size:11.5px;color:#888;margin-top:2px;font-weight:400">회의·약속·이벤트</div>
          </button>
          <button data-type="memo" style="padding:12px;text-align:left;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13.5px;font-weight:600">
            📝 새 메모 (캘린더 노출)
            <div style="font-size:11.5px;color:#888;margin-top:2px;font-weight:400">시간 지정된 메모로 자동 노출</div>
          </button>
          <button data-type="task" style="padding:12px;text-align:left;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer;font-size:13.5px;font-weight:600">
            📋 새 작업 (마감일 = 이 날짜)
            <div style="font-size:11.5px;color:#888;margin-top:2px;font-weight:400">처리해야 할 업무 카드</div>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    function close() { ov.remove(); }
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.matches('[data-close]')) { close(); return; }
      const btn = e.target.closest('[data-type]');
      if (!btn) return;
      const type = btn.dataset.type;
      close();
      if (type === 'event' && window.WS_MODALS) {
        window.WS_MODALS.openNewEventModal({ startAt: start.toISOString(), endAt: end.toISOString() });
      } else if (type === 'memo' && window.WS_MODALS) {
        window.WS_MODALS.openNewMemoModal();
        /* 모달이 열린 후 시간 필드 자동 채움 */
        setTimeout(() => {
          const showChk = document.querySelector('#wsmMemoShow');
          if (showChk && !showChk.checked) { showChk.checked = true; showChk.dispatchEvent(new Event('change')); }
          const pad2 = (n) => String(n).padStart(2, '0');
          const fmtLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
          const sIn = document.querySelector('input[name=startAt]');
          const eIn = document.querySelector('input[name=endAt]');
          if (sIn) sIn.value = fmtLocal(start);
          if (eIn) eIn.value = fmtLocal(end);
        }, 200);
      } else if (type === 'task' && window.WS_MODALS) {
        window.WS_MODALS.openNewTaskModal();
        /* 마감일 자동 채움 */
        setTimeout(() => {
          const dueIn = document.querySelector('input[name=dueDate]');
          if (dueIn) {
            const pad2 = (n) => String(n).padStart(2, '0');
            dueIn.value = `${start.getFullYear()}-${pad2(start.getMonth()+1)}-${pad2(start.getDate())}T${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
          }
        }, 200);
      }
    });
    /* 모달 닫힌 후 캘린더 새로고침 (workspace:reload 이벤트 활용) */
    window.addEventListener('workspace:reload', () => {
      try { STATE.calendar?.refetchEvents(); } catch (_) {}
    }, { once: true });
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
