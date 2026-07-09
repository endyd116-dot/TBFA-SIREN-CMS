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

  // mock 데이터 — RSVP (B 머지 전)
  const MOCK_RSVPS = {
    ok: true,
    data: { rsvps: [], summary: { yes: 0, no: 0, maybe: 0 } },
  };

  // mock 데이터 — 구글 캘린더 연동 상태 (B 머지 전)
  const MOCK_GCAL_STATUS = { ok: true, data: { connected: false } };

  const STATE = {
    calendar: null,
    me: null,
    showTasks: true,
    showEvents: true,
    showMemos: true,
    showRoadmap: true, // 로드맵 단계 오버레이
    scope: 'all',      // mine | all — 기본 '전체'(공유 캘린더: 모든 운영자 일정 표시)
    rangeStart: null,
    rangeEnd: null,
    // 빈 셀 클릭 팝업 DOM
    datePopup: null,
    currentEventId: null,   // 현재 열린 일정 ID (RSVP 용)
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

  /* ═══════════════════ YIQ 텍스트 색상 ═══════════════════
     ★ 2026-05-16: 옛 코드는 짧은 hex(#fff)·잘못된 색 입력 시 흰색 반환 →
     흰 배경 메모에 흰 글씨가 박혀 안 보이는 직관성 결함. 짧은 hex 정규화 +
     색 파싱 실패 시 검은 글씨로 폴백(밝은 배경이 가장 흔하므로 더 안전). */
  function yiqTextColor(bgHex) {
    const DARK = '#1f2937'; // 폴백 — 어두운 글씨 (밝은 배경에서 가독성)
    const LIGHT = '#ffffff';
    if (!bgHex) return DARK;
    let hex = String(bgHex).trim();
    /* #rgb → #rrggbb 정규화 */
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return DARK;
    try {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) return DARK;
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 128 ? DARK : LIGHT;
    } catch (_) { return DARK; }
  }

  /* ═══════════════════ 데이터 로드 ═══════════════════ */
  async function fetchEvents(start, end) {
    STATE.rangeStart = start;
    STATE.rangeEnd = end;
    const promises = [];

    if (STATE.showTasks) promises.push(loadTasks(start, end));
    promises.push(loadEventsAndMemos(start, end));  // 일정 + 메모 통합 (showEvents / showMemos 내부 적용)
    if (STATE.showRoadmap) promises.push(loadRoadmapPhases(start, end));

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
      /* ★ 2026-05-16 #4-2-2: classNames만 적용하면 FullCalendar가 기본 흰 글씨로
         .fc-event-title을 렌더 → 작업 카드 제목이 흰색으로 안 보임. priority별
         배경·테두리·글씨 색을 직접 inline으로 지정해 강제 적용. */
      const TASK_PALETTE = {
        urgent:  { bg: '#fef2f2', border: '#dc2626', text: '#991b1b' },
        high:    { bg: '#fff7ed', border: '#ea580c', text: '#9a3412' },
        medium:  { bg: '#fefce8', border: '#ca8a04', text: '#854d0e' },
        normal:  { bg: '#f0fdf4', border: '#16a34a', text: '#166534' },
        low:     { bg: '#f9fafb', border: '#9ca3af', text: '#4b5563' },
        done:    { bg: '#e5e7eb', border: '#9ca3af', text: '#6b7280' },
      };
      return items
        .filter(t => t.dueDate && new Date(t.dueDate) >= new Date(startDate) && new Date(t.dueDate) <= new Date(endDate))
        .filter(t => t.status !== 'archived')
        .map(t => {
          const isDone = t.status === 'done';
          const palette = TASK_PALETTE[isDone ? 'done' : (t.priority || 'normal')] || TASK_PALETTE.normal;
          const cls = isDone ? 'wc-ev-task-done' : `wc-ev-task-${t.priority || 'normal'}`;
          return {
            id: `task-${t.id}`,
            title: `[작업] ${t.title}`,
            start: t.dueDate,
            allDay: true,
            classNames: [cls],
            backgroundColor: palette.bg,
            borderColor: palette.border,
            textColor: palette.text,
            extendedProps: { type: 'task', taskId: t.id, status: t.status, priority: t.priority },
          };
        });
    } catch (err) {
      console.warn('[calendar] tasks 로드 실패:', err);
      return [];
    }
  }

  // 로드맵 단계 → 기간 막대(종일 스팬)로 캘린더에 오버레이
  const RM_COLORS = { indigo: '#4f46e5', blue: '#2563eb', green: '#16a34a', amber: '#d97706', rose: '#e11d48', teal: '#0d9488', slate: '#64748b' };
  async function loadRoadmapPhases(start, end) {
    const from = (start instanceof Date ? start : new Date(start)).toISOString().slice(0, 10);
    const to = (end instanceof Date ? end : new Date(end)).toISOString().slice(0, 10);
    try {
      const res = await api(`/api/admin-roadmap?calendar=1&from=${from}&to=${to}`);
      const items = res.data?.items || [];
      return items.map(p => {
        const hex = RM_COLORS[p.color] || RM_COLORS.indigo;
        // FullCalendar 종일 이벤트의 end는 배타적 → 종료일 +1일
        let endExclusive = null;
        try { const d = new Date(String(p.endDate).slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + 1); endExclusive = d.toISOString().slice(0, 10); } catch (_) {}
        const isObj = p.kind === 'objective';
        const label = isObj
          ? `🎯 ${p.title}`
          : `[단계] ${p.objectiveTitle ? p.objectiveTitle + ' · ' : ''}${p.title}`;
        return {
          id: isObj ? `roadmap-obj-${p.objectiveId}` : `roadmap-phase-${p.phaseId}`,
          title: label,
          start: String(p.startDate).slice(0, 10),
          end: endExclusive || undefined,
          allDay: true,
          classNames: isObj ? ['wc-ev-roadmap', 'wc-ev-roadmap-obj'] : ['wc-ev-roadmap'],
          backgroundColor: hex,
          borderColor: hex,
          textColor: '#ffffff',
          extendedProps: { type: 'roadmap', kind: p.kind, phaseId: p.phaseId, objectiveId: p.objectiveId, status: p.status, progress: p.progress },
        };
      });
    } catch (err) {
      console.warn('[calendar] roadmap 로드 실패:', err);
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
          /* ★ 2026-05-16: row.color에 named color('red')·잘못된 hex가 박힐 수 있음.
             유효한 hex만 통과시키고 그 외엔 안전한 메모 기본색(연한 노랑)으로 폴백. */
          const _rawColor = row.color || '';
          const bgColor = /^#[0-9a-fA-F]{3,6}$/.test(_rawColor) ? _rawColor : '#fff3cd';
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
          /* ★ 2026-05-16: row.color에 named color('red')·잘못된 hex가 박힐 수 있음.
             유효한 hex만 통과시키고 그 외엔 안전한 메모 기본색(연한 노랑)으로 폴백. */
          const _rawColor = row.color || '';
          const bgColor = /^#[0-9a-fA-F]{3,6}$/.test(_rawColor) ? _rawColor : '#fff3cd';
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

  /* ═══════════════════ 일정 생성/수정 모달 (Q3-005) ═══════════════════
     기존엔 openEventModal이 정의되지 않은 window.WorkspaceEventModal을 호출하거나
     읽히지 않는 ?newEvent= URL로 폴백해, 캘린더에서 일정을 만들 방법이 없었다.
     실제 생성/수정 폼 모달을 admin-workspace-events POST/PATCH에 연결한다. */
  function toLocalInput(d) {
    // Date|string → datetime-local 값(YYYY-MM-DDTHH:mm, 로컬 시각)
    const dt = d ? new Date(d) : new Date();
    if (isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  function openEventEditModal(opts) {
    opts = opts || {};
    const isEdit = opts.mode === 'edit' && opts.event;
    const ev = opts.event || {};
    $('#wcEventEditId').value = isEdit ? (ev.id || '') : '';
    $('#wcEventEditTitleInput').value = isEdit ? (ev.title || '') : '';
    $('#wcEventEditAllDay').checked = isEdit ? !!ev.allDay : false;
    $('#wcEventEditLocation').value = isEdit ? (ev.location || '') : '';
    $('#wcEventEditDesc').value = isEdit ? (ev.description || '') : '';
    if (isEdit) {
      $('#wcEventEditStart').value = toLocalInput(ev.start);
      $('#wcEventEditEnd').value = toLocalInput(ev.end || ev.start);
    } else {
      const base = opts.startDate ? `${opts.startDate}T09:00` : toLocalInput(new Date());
      $('#wcEventEditStart').value = base;
      const endD = new Date(base);
      if (!isNaN(endD.getTime())) { endD.setHours(endD.getHours() + 1); $('#wcEventEditEnd').value = toLocalInput(endD); }
    }
    const titleEl = $('#wcEventEditTitle');
    if (titleEl) titleEl.textContent = isEdit ? '일정 수정' : '새 일정';
    const m = $('#wcEventEditModal');
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
  }

  async function saveEvent() {
    const id = $('#wcEventEditId').value;
    const title = $('#wcEventEditTitleInput').value.trim();
    const startVal = $('#wcEventEditStart').value;
    const endVal = $('#wcEventEditEnd').value;
    if (!title) { toast('제목을 입력하세요', 'error'); return; }
    if (!startVal || !endVal) { toast('시작·종료 시각을 입력하세요', 'error'); return; }
    const startAt = new Date(startVal);
    const endAt = new Date(endVal);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) { toast('시각 형식 오류', 'error'); return; }
    if (endAt < startAt) { toast('종료가 시작보다 빠릅니다', 'error'); return; }
    const payload = {
      title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allDay: $('#wcEventEditAllDay').checked,
      location: $('#wcEventEditLocation').value.trim() || null,
      description: $('#wcEventEditDesc').value.trim() || null,
    };
    const btn = $('#wcEventSaveBtn');
    if (btn) btn.disabled = true;
    try {
      if (id) {
        await api(`/api/admin-workspace-events?id=${id}`, { method: 'PATCH', body: payload });
        toast('일정이 수정되었습니다', 'success');
      } else {
        await api('/api/admin-workspace-events', { method: 'POST', body: payload });
        toast('일정이 등록되었습니다', 'success');
      }
      ['wcEventEditModal', 'wcEventModal'].forEach(mid => {
        const m = $('#' + mid);
        if (m) { m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); }
      });
      try { STATE.calendar?.refetchEvents(); } catch (_) {}
    } catch (err) {
      toast('저장 실패: ' + (err?.message || ''), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openEventModal(opts) {
    openEventEditModal({ mode: 'create', startDate: opts && opts.startDate });
  }

  // 외부(다른 모듈)에서도 호출 가능하도록 노출
  window.WorkspaceEventModal = {
    openCreate: (o) => openEventEditModal({ mode: 'create', startDate: o && o.startDate }),
    openEdit: (ev) => openEventEditModal({ mode: 'edit', event: ev }),
  };

  /* ═══════════════════ 이벤트 클릭 처리 ═══════════════════ */
  function onEventClick(info) {
    const ext = info.event.extendedProps;
    if (!ext) return;

    if (ext.type === 'task') {
      location.href = `/workspace-kanban.html#task=${ext.taskId}`;
      return;
    }

    if (ext.type === 'roadmap') {
      // 로드맵 단계 → 로드맵 페이지로 이동
      location.href = '/workspace-roadmap.html';
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

    // RSVP 초기화
    STATE.currentEventId = ext.eventId || null;
    // Q3-005: 보기 모달의 '수정' 버튼이 쓸 현재 일정 상세 보관
    STATE.currentEventDetail = {
      id: ext.eventId || null,
      title: info.event.title.replace(/^\[일정\]\s?/, ''),
      start, end,
      allDay: !!info.event.allDay,
      location: ext.location || '',
      description: ext.description || '',
    };
    resetRsvpButtons();
    if (STATE.currentEventId) loadRsvps(STATE.currentEventId);

    $('#wcEventModal').classList.add('is-open');
    $('#wcEventModal').setAttribute('aria-hidden', 'false');
  }

  /* ═══════════════════ RSVP ═══════════════════ */
  function resetRsvpButtons() {
    ['wcRsvpYes', 'wcRsvpNo', 'wcRsvpMaybe'].forEach(id => {
      const btn = $('#' + id);
      if (btn) btn.classList.remove('is-active');
    });
    const summary = $('#wcRsvpSummary');
    if (summary) summary.textContent = '';
  }

  async function loadRsvps(eventId) {
    let data;
    try {
      const res = await api(`/api/workspace-event-rsvps?eventId=${eventId}`);
      data = res.data || res;
    } catch (_) {
      data = MOCK_RSVPS.data;
    }
    const summary = data.summary || { yes: 0, no: 0, maybe: 0 };
    const summaryEl = $('#wcRsvpSummary');
    if (summaryEl) summaryEl.textContent = `✓ ${summary.yes} · ✗ ${summary.no} · ? ${summary.maybe}`;

    // 내 응답 하이라이트
    const myUid = STATE.me?.id;
    const myRsvp = Array.isArray(data.rsvps)
      ? data.rsvps.find(r => r.memberId === myUid)
      : null;
    if (myRsvp) {
      const map = { yes: 'wcRsvpYes', no: 'wcRsvpNo', maybe: 'wcRsvpMaybe' };
      const btn = $('#' + map[myRsvp.status]);
      if (btn) btn.classList.add('is-active');
    }
  }

  async function submitRsvp(status) {
    const eventId = STATE.currentEventId;
    if (!eventId) return;
    try {
      await api('/api/workspace-event-rsvp', {
        method: 'POST',
        body: { eventId, status },
      });
      toast(status === 'yes' ? '참석 예정으로 등록됐어요' : status === 'no' ? '불참으로 등록됐어요' : '미정으로 등록됐어요', 'success');
      // 버튼 활성화 갱신
      resetRsvpButtons();
      const map = { yes: 'wcRsvpYes', no: 'wcRsvpNo', maybe: 'wcRsvpMaybe' };
      const btn = $('#' + map[status]);
      if (btn) btn.classList.add('is-active');
      // 요약 재로드
      loadRsvps(eventId);
    } catch (err) {
      toast('참석 여부 저장 실패: ' + err.message, 'error');
    }
  }

  /* ═══════════════════ 구글 캘린더 상태 ═══════════════════ */
  async function loadGcalStatus() {
    let connected = false;
    try {
      const res = await api('/api/google-calendar-status');
      connected = !!((res.data || res).connected);
    } catch (_) {
      connected = MOCK_GCAL_STATUS.data.connected;
    }
    const connectBtn = $('#wcBtnGcalConnect');
    const syncBtn = $('#wcBtnGcalSync');
    if (connectBtn) connectBtn.style.display = connected ? 'none' : '';
    if (syncBtn) syncBtn.style.display = connected ? '' : 'none';
  }

  /* ═══════════════════ 사용자 정보 (R35-GAP-P1 H-G1: user JWT 우선 + admin JWT fallback) ═══════════════════ */
  async function loadMe() {
    let me = null;
    try {
      const userRes = await api('/api/auth/me');
      if (userRes.ok) me = userRes.data?.data || userRes.data?.user || userRes.data || null;
    } catch (_) {}
    if (!me) {
      try {
        const adminRes = await api('/api/admin/me?light=1');
        if (adminRes.ok) me = adminRes.data?.admin || adminRes.data?.data || adminRes.data || null;
      } catch (_) {}
    }
    if (me) {
      // R35-GAP-P2 M-G7: regular 회원은 워크스페이스 부적합
      const isAdmin = me.role === 'admin' || me.role === 'super_admin';
      if (!isAdmin && me.operatorActive === false) {
        alert('워크스페이스는 운영자(직원)만 사용할 수 있습니다.\n관리자에게 운영자 권한을 요청해 주세요.');
        location.href = '/index.html';
        return;
      }
      STATE.me = me;
      const nameEl = $('#wsSidebarUserName');
      if (nameEl) nameEl.textContent = me.name || me.email || '사용자';
    }
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
        /* ★ 2026-05-16 #4-2-2: 작업 카드는 priority별 의미 있는 글씨색을 명시
           지정했으므로 YIQ로 덮어쓰지 말 것. 메모만 YIQ 자동 계산 (사용자가
           고른 임의 배경색 대비). 일정은 textColor 미지정 → FullCalendar 기본. */
        const type = info.event.extendedProps && info.event.extendedProps.type;
        const explicitText = info.event.textColor;
        let textColor;
        if (explicitText) {
          textColor = explicitText;
        } else if (type === 'memo' || !type) {
          const bgColor = info.event.backgroundColor;
          if (bgColor) textColor = yiqTextColor(bgColor);
        }
        if (textColor) {
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
    $('#wcFilterRoadmap')?.addEventListener('change', e => {
      STATE.showRoadmap = e.target.checked;
      STATE.calendar?.refetchEvents();
    });
    // 로드맵 페이지에서 목표·단계 변경 시 캘린더 자동 갱신
    try { window.WorkspaceSync?.on?.('roadmap:changed', () => { try { STATE.calendar?.refetchEvents(); } catch (_) {} }); } catch (_) {}
    $('#wcFilterScope')?.addEventListener('change', e => {
      STATE.scope = e.target.value;
      STATE.calendar?.refetchEvents();
    });
    $('#wcBtnRefresh')?.addEventListener('click', () => STATE.calendar?.refetchEvents());

    /* ★ 2026-05-16 #1-2: 헤더 빠른 추가 버튼 — 메모/일정 */
    $('#wcBtnNewMemo')?.addEventListener('click', () => {
      const today = new Date().toISOString().slice(0, 10);
      if (window.WorkspaceMemoModal) {
        WorkspaceMemoModal.openCreate({ showInCalendar: true, eventDate: today });
      } else {
        toast('메모 모듈 로드 실패 — 페이지 새로고침 후 다시 시도하세요', 'error');
      }
    });
    $('#wcBtnNewEvent')?.addEventListener('click', () => {
      const today = new Date().toISOString().slice(0, 10);
      openEventModal({ startDate: today });
    });
    // Q3-005: 일정 저장(생성/수정) + 보기 모달의 수정 버튼
    $('#wcEventSaveBtn')?.addEventListener('click', saveEvent);
    $('#wcEventEditBtn')?.addEventListener('click', () => {
      if (STATE.currentEventDetail && STATE.currentEventDetail.id) {
        openEventEditModal({ mode: 'edit', event: STATE.currentEventDetail });
      } else {
        toast('수정할 일정 정보를 찾을 수 없습니다', 'error');
      }
    });

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

    // RSVP 버튼
    ['wcRsvpYes', 'wcRsvpNo', 'wcRsvpMaybe'].forEach(id => {
      $('#' + id)?.addEventListener('click', () => {
        const btn = $('#' + id);
        submitRsvp(btn.dataset.rsvp);
      });
    });

    // 구글 캘린더 연동 버튼
    $('#wcBtnGcalConnect')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/google-calendar-auth');
        const authUrl = (res.data || res).authUrl;
        if (authUrl) {
          window.open(authUrl, 'gcal_auth', 'width=600,height=700');
          // 팝업 완료 후 상태 재확인 (5초 후)
          setTimeout(() => loadGcalStatus(), 5000);
        } else {
          toast('인증 URL을 받지 못했어요', 'error');
        }
      } catch (err) {
        toast('구글 캘린더 연동 실패: ' + err.message, 'error');
      }
    });

    // 구글 캘린더 동기화 버튼
    $('#wcBtnGcalSync')?.addEventListener('click', async () => {
      const btn = $('#wcBtnGcalSync');
      if (!btn) return;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '동기화 중...';
      try {
        await api('/api/google-calendar-sync', { method: 'POST', body: {} });
        toast('구글 캘린더 동기화 완료', 'success');
        try { STATE.calendar?.refetchEvents(); } catch (_) {}
      } catch (err) {
        toast('동기화 실패: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
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
    await Promise.all([loadMe(), loadGcalStatus()]);
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

    // 워크툴 '새 일정'에서 넘어온 경우(?new=event) 자동으로 새 일정 모달 열기
    try {
      if (/[?&]new=event/.test(location.search)) {
        const today = new Date().toISOString().slice(0, 10);
        openEventModal({ startDate: today });
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
