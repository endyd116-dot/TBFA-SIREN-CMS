/* =========================================================
   workspace-modals.js — 워크스페이스 v2 빠른 액션 모달 4종
   - 새 작업 / 새 일정 / 새 메모 / 알림 패널
   - 자연어 팀 피드 + 할당한 작업 패널 fetch
   - 알림 벨 카운트 + 클릭 → 알림 패널
   2026-05-12 신설
   ========================================================= */
(function () {
  'use strict';

  const API_BASE = '/api/admin';

  /* ─────── CSS 자동 주입 (모달 + 알림 + 피드 + 새 패널) ─────── */
  (function injectCss() {
    if (document.getElementById('ws-modals-css')) return;
    const css = `
      .ws-modal-overlay { position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;padding:60px 16px 16px;overflow:auto;animation:wsFadeIn .15s ease-out }
      @keyframes wsFadeIn { from{opacity:0} to{opacity:1} }
      .ws-modal-dialog { background:#fff;border-radius:14px;width:100%;max-width:560px;box-shadow:0 20px 50px rgba(0,0,0,.25);overflow:hidden;animation:wsSlideUp .2s ease-out }
      @keyframes wsSlideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
      .ws-modal-header { display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #eef0f4;background:linear-gradient(135deg,#7a1f2b,#a3303f);color:#fff }
      .ws-modal-header h2 { margin:0;font-size:16px;font-weight:700;letter-spacing:-.2px }
      .ws-modal-close { background:rgba(255,255,255,.18);border:none;color:#fff;font-size:20px;width:30px;height:30px;border-radius:6px;cursor:pointer }
      .ws-modal-close:hover { background:rgba(255,255,255,.32) }
      .ws-modal-body { padding:22px;max-height:70vh;overflow:auto }
      .ws-form-grid { display:grid;grid-template-columns:1fr 1fr;gap:14px }
      .ws-fg { display:flex;flex-direction:column;gap:6px;font-size:13px }
      .ws-fg-full { grid-column:1/-1 }
      .ws-fg span:first-child { font-weight:600;color:#1f2937;font-size:12.5px }
      .ws-fg input, .ws-fg select, .ws-fg textarea { padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font-size:13.5px;font-family:inherit;background:#fff }
      .ws-fg input:focus, .ws-fg select:focus, .ws-fg textarea:focus { outline:none;border-color:#7a1f2b;box-shadow:0 0 0 3px rgba(122,31,43,.1) }
      .ws-fg-checkbox { flex-direction:row;align-items:center;gap:8px;font-size:13px;color:#1f2937 }
      .ws-fg-callout { background:#fef9f5;border:1px solid #f5d97a;padding:10px 12px;border-radius:7px;cursor:pointer }
      .ws-fg-actions { display:flex;justify-content:flex-end;gap:8px;margin-top:6px;padding-top:14px;border-top:1px solid #f0f0f0 }
      .ws-btn { padding:9px 18px;border:none;border-radius:7px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit }
      .ws-btn-primary { background:#7a1f2b;color:#fff }
      .ws-btn-primary:hover { background:#5a141d }
      .ws-btn-ghost { background:#f3f4f6;color:#374151 }
      .ws-btn-ghost:hover { background:#e5e7eb }
      .ws-toast { position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#1f2937;color:#fff;padding:11px 18px;border-radius:8px;font-size:13.5px;box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:10000;opacity:0;transition:opacity .25s,transform .25s }
      .ws-toast.show { opacity:1;transform:translateX(-50%) translateY(0) }
      .ws-toast-root { position:fixed;bottom:0;left:0;right:0;pointer-events:none;z-index:10000 }
      .ws-toast-root .ws-toast { pointer-events:auto;margin:0 auto 12px }
      /* 알림 패널 */
      .ws-notif-tabs { display:flex;gap:4px;border-bottom:1px solid #eef0f4;margin-bottom:10px }
      .ws-notif-tab { background:transparent;border:none;padding:8px 14px;font-size:13px;cursor:pointer;color:#6b7280;border-bottom:2px solid transparent;display:flex;align-items:center;gap:5px }
      .ws-notif-tab.on { color:#7a1f2b;border-bottom-color:#7a1f2b;font-weight:700 }
      .ws-notif-tab [data-cnt] { background:#dc2626;color:#fff;border-radius:10px;padding:1px 6px;font-size:10.5px;font-weight:700;min-width:18px;text-align:center }
      .ws-notif-actions { padding:0 4px 10px;display:flex;justify-content:flex-end }
      .ws-notif-list { list-style:none;padding:0;margin:0;max-height:55vh;overflow:auto }
      .ws-notif-item { padding:10px 12px;border-bottom:1px solid #f3f4f6;cursor:pointer;transition:background .15s }
      .ws-notif-item:hover { background:#f9fafb }
      .ws-notif-item.unread { background:#fef9f5 }
      .ws-notif-item.unread .ws-notif-title { font-weight:700 }
      .ws-notif-title { font-size:13.5px;color:#1f2937;line-height:1.45 }
      .ws-notif-body { font-size:12px;color:#4b5563;margin-top:3px;line-height:1.45 }
      .ws-notif-meta { display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9ca3af;margin-top:5px }
      .ws-notif-cat { background:#e5e7eb;padding:1px 6px;border-radius:4px;font-weight:600 }
      .ws-notif-empty { padding:30px;text-align:center;color:#9ca3af;font-size:13px }
      /* 피드 — 자연어 한 줄 + 시간 그룹 */
      .ws-feed-group-label { padding:14px 8px 6px;font-size:11.5px;color:#6b7280;font-weight:700;letter-spacing:.5px;text-transform:uppercase;list-style:none }
      .ws-feed-item { display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13.5px;color:#1f2937;line-height:1.5;list-style:none }
      .ws-feed-item:hover[data-link] { background:#f9fafb }
      .ws-feed-msg { flex:1;min-width:0 }
      .ws-feed-time { font-size:11.5px;color:#9ca3af;flex-shrink:0;margin-left:10px }
      /* outbox 패널 */
      #wsPanelOutbox .ws-task-item { display:flex;gap:10px;align-items:flex-start;padding:9px 8px;border-bottom:1px solid #f3f4f6;cursor:pointer }
      #wsPanelOutbox .ws-task-item:hover { background:#f9fafb }
      #wsPanelOutbox .ws-task-status { font-size:10px;padding:2px 7px;border-radius:4px;background:#e5e7eb;color:#374151;flex-shrink:0;text-transform:uppercase;font-weight:700 }
      #wsPanelOutbox .ws-task-main { flex:1;min-width:0 }
      #wsPanelOutbox .ws-task-title { font-size:13px;color:#1f2937;margin-bottom:2px }
      #wsPanelOutbox .ws-task-meta { font-size:11.5px;color:#6b7280 }
      /* ★ 2026-05-12 v2 — 좌측 컬러 바 (sourceType/status 기반) */
      .ws-task-card { position:relative;padding-left:14px !important }
      .ws-task-card::before { content:'';position:absolute;left:0;top:8px;bottom:8px;width:4px;border-radius:2px;background:#d1d5db }
      .ws-task-card[data-source-type=incident]::before { background:#dc2626 }
      .ws-task-card[data-source-type=harassment]::before { background:#ea580c }
      .ws-task-card[data-source-type=legal]::before { background:#7c3aed }
      .ws-task-card[data-source-type=support]::before { background:#0891b2 }
      .ws-task-card[data-source-type=donation]::before { background:#ca8a04 }
      .ws-task-card[data-source-type=member]::before { background:#475569 }
      .ws-task-card[data-source-type=manual]::before { background:#71717a }
      .ws-task-card[data-source-type=ai_agent]::before { background:#9333ea }
      .ws-task-card[data-status=done]::before { background:#10b981 !important;opacity:.5 }
      .ws-inbox-card::before { background:#2563eb }
      .ws-src-badge { display:inline-flex;align-items:center;margin-right:5px }
    `;
    const style = document.createElement('style');
    style.id = 'ws-modals-css';
    style.textContent = css;
    document.head.appendChild(style);
  })();

  /* ─────── 공통 헬퍼 ─────── */
  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[ws-modals]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }
  function toast(msg) {
    const root = document.getElementById('wsToastRoot');
    if (!root) return alert(msg);
    const el = document.createElement('div');
    el.className = 'ws-toast';
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2400);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatLocalDatetimeInput(d) {
    /* yyyy-MM-ddThh:mm 형식 */
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ─────── 운영자(담당자 선택) 캐시 ─────── */
  let _operatorsCache = null;
  async function getOperators() {
    if (_operatorsCache) return _operatorsCache;
    try {
      const res = await api(API_BASE + '/service-rnr');
      const list = (res.data && res.data.data && res.data.data.operators) ||
                   (res.data && res.data.operators) || [];
      _operatorsCache = list.filter(o => o.role && o.operatorActive);
      return _operatorsCache;
    } catch (_) { return []; }
  }

  /* ─────── 공통 모달 컨테이너 ─────── */
  function ensureModalRoot() {
    let root = document.getElementById('wsModalRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'wsModalRoot';
      document.body.appendChild(root);
    }
    return root;
  }

  function openModal(title, contentHtml, onMount) {
    const root = ensureModalRoot();
    const ov = document.createElement('div');
    ov.className = 'ws-modal-overlay';
    ov.innerHTML = `
      <div class="ws-modal-dialog">
        <header class="ws-modal-header">
          <h2>${escapeHtml(title)}</h2>
          <button class="ws-modal-close" data-close>×</button>
        </header>
        <div class="ws-modal-body">${contentHtml}</div>
      </div>`;
    root.appendChild(ov);
    document.body.style.overflow = 'hidden';
    function close() {
      ov.remove();
      if (!document.querySelector('.ws-modal-overlay')) document.body.style.overflow = '';
    }
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.matches('[data-close]')) close();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
    if (onMount) onMount(ov, close);
    return { overlay: ov, close };
  }

  /* ─────── ① 새 작업 모달 ─────── */
  async function openNewTaskModal() {
    const operators = await getOperators();
    const optionsHtml = operators.map(o =>
      `<option value="${o.id}">${escapeHtml(o.name)} (${escapeHtml(o.role || '')})</option>`
    ).join('');
    const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    openModal('📋 새 작업 만들기', `
      <form id="wsmTaskForm" class="ws-form-grid">
        <label class="ws-fg ws-fg-full">
          <span>제목 *</span>
          <input type="text" name="title" required maxlength="300" placeholder="예: 월간 보고서 작성">
        </label>
        <label class="ws-fg">
          <span>담당자 (운영자만)</span>
          <select name="assignedTo">
            <option value="">-- 본인이 진행 --</option>
            ${optionsHtml}
          </select>
        </label>
        <label class="ws-fg">
          <span>우선순위</span>
          <select name="priority">
            <option value="low">낮음</option>
            <option value="normal" selected>보통</option>
            <option value="high">높음</option>
            <option value="urgent">긴급</option>
          </select>
        </label>
        <label class="ws-fg">
          <span>마감일 *</span>
          <input type="datetime-local" name="dueDate" required value="${formatLocalDatetimeInput(defaultDue)}">
        </label>
        <label class="ws-fg">
          <span>예상 시간 (h)</span>
          <input type="number" name="estimatedHours" min="0" max="999" step="0.5" placeholder="2">
        </label>
        <label class="ws-fg ws-fg-full">
          <span>설명 (선택)</span>
          <textarea name="description" rows="4" placeholder="작업 배경·체크포인트 등"></textarea>
        </label>
        <div class="ws-fg ws-fg-full ws-fg-actions">
          <button type="button" data-close class="ws-btn ws-btn-ghost">취소</button>
          <button type="submit" class="ws-btn ws-btn-primary">＋ 작업 만들기</button>
        </div>
      </form>
    `, (ov, close) => {
      const form = ov.querySelector('#wsmTaskForm');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const body = {
          title: String(fd.get('title') || '').trim(),
          description: String(fd.get('description') || '').trim() || null,
          priority: String(fd.get('priority') || 'normal'),
          dueDate: new Date(fd.get('dueDate')).toISOString(),
          assignedTo: fd.get('assignedTo') ? Number(fd.get('assignedTo')) : null,
          estimatedHours: fd.get('estimatedHours') ? Number(fd.get('estimatedHours')) : null,
        };
        const res = await api(API_BASE + '/workspace-tasks', { method: 'POST', body });
        if (!res.ok) {
          toast('작업 생성 실패: ' + (res.data?.error || ''));
          return;
        }
        toast('작업이 만들어졌어요');
        close();
        window.dispatchEvent(new Event('workspace:reload'));
      });
    });
  }

  /* ─────── ② 새 일정 모달 ─────── */
  function openNewEventModal(prefill) {
    const now = new Date();
    const start = prefill?.startAt ? new Date(prefill.startAt) : new Date(now.getTime() + 60 * 60 * 1000);
    const end = prefill?.endAt ? new Date(prefill.endAt) : new Date(start.getTime() + 60 * 60 * 1000);

    openModal('📅 새 일정 등록', `
      <form id="wsmEventForm" class="ws-form-grid">
        <label class="ws-fg ws-fg-full">
          <span>제목 *</span>
          <input type="text" name="title" required maxlength="300" placeholder="예: 운영위원회">
        </label>
        <label class="ws-fg">
          <span>시작 *</span>
          <input type="datetime-local" name="startAt" required value="${formatLocalDatetimeInput(start)}">
        </label>
        <label class="ws-fg">
          <span>종료 *</span>
          <input type="datetime-local" name="endAt" required value="${formatLocalDatetimeInput(end)}">
        </label>
        <label class="ws-fg">
          <span>종류</span>
          <select name="eventType">
            <option value="general">일반</option>
            <option value="meeting">회의</option>
            <option value="board_meeting">이사회/운영위</option>
            <option value="counseling">상담</option>
            <option value="deadline">마감</option>
          </select>
        </label>
        <label class="ws-fg">
          <span>색상</span>
          <select name="color">
            <option value="blue">파랑</option>
            <option value="red">빨강</option>
            <option value="green">초록</option>
            <option value="orange">주황</option>
            <option value="purple">보라</option>
            <option value="yellow">노랑</option>
          </select>
        </label>
        <label class="ws-fg ws-fg-full">
          <span>장소 (선택)</span>
          <input type="text" name="location" maxlength="300">
        </label>
        <label class="ws-fg ws-fg-full">
          <span>설명 (선택)</span>
          <textarea name="description" rows="3"></textarea>
        </label>
        <div class="ws-fg ws-fg-full ws-fg-actions">
          <button type="button" data-close class="ws-btn ws-btn-ghost">취소</button>
          <button type="submit" class="ws-btn ws-btn-primary">＋ 일정 등록</button>
        </div>
      </form>
    `, (ov, close) => {
      const form = ov.querySelector('#wsmEventForm');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const body = {
          title: String(fd.get('title') || '').trim(),
          startAt: new Date(fd.get('startAt')).toISOString(),
          endAt: new Date(fd.get('endAt')).toISOString(),
          eventType: String(fd.get('eventType') || 'general'),
          color: String(fd.get('color') || 'blue'),
          location: String(fd.get('location') || '').trim() || null,
          description: String(fd.get('description') || '').trim() || null,
        };
        const res = await api(API_BASE + '/workspace-events', { method: 'POST', body });
        if (!res.ok) {
          toast('일정 등록 실패: ' + (res.data?.error || ''));
          return;
        }
        toast('일정이 등록되었어요');
        close();
        window.dispatchEvent(new Event('workspace:reload'));
      });
    });
  }

  /* ─────── ③ 새 메모 모달 (캘린더 표시 옵션 포함) ─────── */
  function openNewMemoModal() {
    openModal('📝 새 메모', `
      <form id="wsmMemoForm" class="ws-form-grid">
        <label class="ws-fg ws-fg-full">
          <span>제목 (선택)</span>
          <input type="text" name="title" maxlength="200" placeholder="제목 또는 첫 줄로 자동 노출">
        </label>
        <label class="ws-fg ws-fg-full">
          <span>내용 *</span>
          <textarea name="contentHtml" rows="6" required placeholder="메모 내용을 자유롭게..."></textarea>
        </label>
        <label class="ws-fg">
          <span>색상</span>
          <select name="color">
            <option value="yellow">노랑</option>
            <option value="blue">파랑</option>
            <option value="green">초록</option>
            <option value="pink">분홍</option>
            <option value="purple">보라</option>
          </select>
        </label>
        <label class="ws-fg ws-fg-checkbox">
          <input type="checkbox" name="isPinned"> 상단 고정
        </label>
        <label class="ws-fg ws-fg-full ws-fg-checkbox ws-fg-callout">
          <input type="checkbox" name="showInCalendar" id="wsmMemoShow">
          📅 캘린더에 표시 (날짜·시간 입력)
        </label>
        <div class="ws-fg ws-fg-full" id="wsmMemoCalRow" style="display:none">
          <div class="ws-form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
            <label class="ws-fg">
              <span>시작</span>
              <input type="datetime-local" name="startAt">
            </label>
            <label class="ws-fg">
              <span>종료</span>
              <input type="datetime-local" name="endAt">
            </label>
          </div>
          <small style="color:#888">체크하지 않으면 캘린더에 노출되지 않습니다.</small>
        </div>
        <div class="ws-fg ws-fg-full ws-fg-actions">
          <button type="button" data-close class="ws-btn ws-btn-ghost">취소</button>
          <button type="submit" class="ws-btn ws-btn-primary">＋ 메모 저장</button>
        </div>
      </form>
    `, (ov, close) => {
      const showChk = ov.querySelector('#wsmMemoShow');
      const calRow = ov.querySelector('#wsmMemoCalRow');
      showChk.addEventListener('change', () => {
        calRow.style.display = showChk.checked ? '' : 'none';
        if (showChk.checked) {
          const now = new Date();
          const startInput = ov.querySelector('input[name=startAt]');
          if (startInput && !startInput.value) {
            startInput.value = formatLocalDatetimeInput(new Date(now.getTime() + 60 * 60 * 1000));
          }
        }
      });

      const form = ov.querySelector('#wsmMemoForm');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const body = {
          title: String(fd.get('title') || '').trim() || null,
          contentHtml: String(fd.get('contentHtml') || '').trim(),
          color: String(fd.get('color') || 'yellow'),
          isPinned: fd.get('isPinned') === 'on',
          showInCalendar: fd.get('showInCalendar') === 'on',
          startAt: fd.get('startAt') ? new Date(fd.get('startAt')).toISOString() : null,
          endAt: fd.get('endAt') ? new Date(fd.get('endAt')).toISOString() : null,
        };
        if (!body.contentHtml) { toast('내용을 입력하세요'); return; }
        if (body.showInCalendar && !body.startAt) { toast('캘린더 표시하려면 시작 시간이 필요해요'); return; }
        const res = await api(API_BASE + '/workspace-memos', { method: 'POST', body });
        if (!res.ok) {
          toast('메모 저장 실패: ' + (res.data?.error || ''));
          return;
        }
        toast(body.showInCalendar ? '메모 저장 + 캘린더 등록 완료' : '메모가 저장되었어요');
        close();
        window.dispatchEvent(new Event('workspace:reload'));
      });
    });
  }

  /* ─────── ④ 알림 패널 (벨 클릭 / 알림 버튼) ─────── */
  let _notifTab = 'all';
  async function openNotifPanel() {
    openModal('🔔 알림', `
      <div class="ws-notif-tabs">
        <button class="ws-notif-tab on" data-tab="all">전체 <span data-cnt="all">0</span></button>
        <button class="ws-notif-tab" data-tab="assign">할당 <span data-cnt="assign">0</span></button>
        <button class="ws-notif-tab" data-tab="due">마감 <span data-cnt="due">0</span></button>
        <button class="ws-notif-tab" data-tab="mention">멘션 <span data-cnt="mention">0</span></button>
        <button class="ws-notif-tab" data-tab="system">시스템 <span data-cnt="system">0</span></button>
      </div>
      <div class="ws-notif-actions">
        <button type="button" class="ws-btn ws-btn-ghost" id="wsmNotifMarkAll">현재 탭 모두 읽음</button>
      </div>
      <ul class="ws-notif-list" id="wsmNotifList">
        <li class="ws-loading">불러오는 중...</li>
      </ul>
    `, (ov, close) => {
      async function loadTab(tab) {
        _notifTab = tab;
        ov.querySelectorAll('.ws-notif-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
        const listEl = ov.querySelector('#wsmNotifList');
        listEl.innerHTML = '<li class="ws-loading">불러오는 중...</li>';
        const res = await api(API_BASE + '/workspace-notifications?tab=' + encodeURIComponent(tab) + '&limit=80');
        if (!res.ok) {
          listEl.innerHTML = '<li class="ws-notif-empty">조회 실패</li>';
          return;
        }
        const data = res.data?.data || res.data;
        const items = data.items || [];
        const cnts = data.unreadByTab || {};
        Object.entries(cnts).forEach(([k, v]) => {
          const el = ov.querySelector(`[data-cnt="${k}"]`);
          if (el) { el.textContent = String(v); el.style.display = v > 0 ? '' : 'none'; }
        });

        if (!items.length) {
          listEl.innerHTML = '<li class="ws-notif-empty">알림이 없습니다</li>';
          return;
        }
        listEl.innerHTML = items.map(n => `
          <li class="ws-notif-item ${n.unread ? 'unread' : ''}" data-id="${n.id}" data-url="${escapeHtml(n.actionUrl || '')}">
            <div class="ws-notif-title">${escapeHtml(n.title || '')}</div>
            ${n.body ? `<div class="ws-notif-body">${escapeHtml(String(n.body).slice(0, 200))}</div>` : ''}
            <div class="ws-notif-meta">
              <span class="ws-notif-cat">${escapeHtml(n.category)}</span>
              <span class="ws-notif-time">${new Date(n.sentAt).toLocaleString('ko-KR')}</span>
            </div>
          </li>
        `).join('');
        listEl.querySelectorAll('.ws-notif-item').forEach(li => {
          li.addEventListener('click', async () => {
            const id = Number(li.dataset.id);
            const url = li.dataset.url;
            await api(API_BASE + '/workspace-notifications?action=read', { method: 'POST', body: { ids: [id] } });
            if (url) location.href = url; else { li.classList.remove('unread'); refreshBellCount(); }
          });
        });
      }
      ov.querySelectorAll('.ws-notif-tab').forEach(b =>
        b.addEventListener('click', () => loadTab(b.dataset.tab))
      );
      ov.querySelector('#wsmNotifMarkAll').addEventListener('click', async () => {
        await api(API_BASE + '/workspace-notifications?action=read', { method: 'POST', body: { all: true, tab: _notifTab } });
        await loadTab(_notifTab);
        refreshBellCount();
      });
      loadTab('all');
    });
  }

  /* ─────── 알림 벨 카운트 ─────── */
  async function refreshBellCount() {
    const bell = document.getElementById('wsNotifBell');
    const cntEl = document.getElementById('wsNotifCount');
    if (!bell || !cntEl) return;
    const res = await api(API_BASE + '/workspace-notifications?action=unread-count');
    const n = (res.data && res.data.data && res.data.data.unreadCount) ||
              (res.data && res.data.unreadCount) || 0;
    if (n > 0) {
      cntEl.textContent = String(n);
      cntEl.style.display = '';
    } else {
      cntEl.style.display = 'none';
    }
  }

  /* ─────── 클릭 라우터: 4개 빠른 액션 ─────── */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ws-action]');
    if (!t) return;
    const action = t.dataset.wsAction;
    if (action === 'new-task') { e.preventDefault(); openNewTaskModal(); return; }
    if (action === 'new-event') { e.preventDefault(); openNewEventModal(); return; }
    if (action === 'new-memo') { e.preventDefault(); openNewMemoModal(); return; }
    if (action === 'open-notifications') { e.preventDefault(); openNotifPanel(); return; }
  });

  /* 알림 벨 클릭 */
  document.addEventListener('click', (e) => {
    if (e.target.closest('#wsNotifBell')) {
      e.preventDefault();
      openNotifPanel();
    }
  });

  /* ─────── 할당한 작업(outbox) + 자연어 피드 fetch ─────── */
  async function loadOutbox() {
    const list = document.getElementById('wsOutboxList');
    const badge = document.getElementById('wsOutboxBadge');
    const stat = document.getElementById('wsStatOutbox');
    if (!list) return;
    list.innerHTML = '<li class="ws-loading">불러오는 중...</li>';
    const res = await api(API_BASE + '/workspace-tasks?filter=assigned-by-me&limit=10');
    if (!res.ok) {
      list.innerHTML = '<li class="ws-empty">조회 실패</li>';
      return;
    }
    const items = (res.data?.data?.list || res.data?.data || res.data?.list || []);
    if (badge) badge.textContent = String(items.length);
    if (stat) stat.textContent = String(items.length);
    if (!items.length) {
      list.innerHTML = '<li class="ws-empty">할당한 작업이 없어요</li>';
      return;
    }
    list.innerHTML = items.slice(0, 10).map(t => `
      <li class="ws-task-item" data-task-id="${t.id}" onclick="location.href='/workspace-kanban.html?taskId=${t.id}'">
        <span class="ws-task-status ws-status-${escapeHtml(t.status || 'todo')}">${escapeHtml(t.status || 'todo')}</span>
        <div class="ws-task-main">
          <div class="ws-task-title">${escapeHtml(t.title || '')}</div>
          <div class="ws-task-meta">
            → ${escapeHtml(t.assignedToName || '미지정')} ·
            마감 ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('ko-KR') : '-'}
          </div>
        </div>
      </li>
    `).join('');
  }

  async function loadFeed() {
    const list = document.getElementById('wsFeedList');
    if (!list) return;
    list.innerHTML = '<li class="ws-loading">불러오는 중...</li>';
    const res = await api(API_BASE + '/workspace-feed?limit=40');
    if (!res.ok) {
      list.innerHTML = '<li class="ws-empty">조회 실패</li>';
      return;
    }
    const items = (res.data?.data?.items || res.data?.items || []);
    if (!items.length) {
      list.innerHTML = '<li class="ws-empty">최근 활동이 없어요</li>';
      return;
    }
    /* 시간 그룹화 */
    const now = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const weekStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    const groups = { today: [], yesterday: [], week: [], past: [] };
    items.forEach(it => {
      const t = new Date(it.createdAt);
      if (t >= today) groups.today.push(it);
      else if (t >= yesterday) groups.yesterday.push(it);
      else if (t >= weekStart) groups.week.push(it);
      else groups.past.push(it);
    });
    const sectionHtml = (label, arr) => arr.length === 0 ? '' : `
      <li class="ws-feed-group-label">${label}</li>
      ${arr.map(it => {
        const time = new Date(it.createdAt);
        const timeStr = time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        return `<li class="ws-feed-item" ${it.link ? `data-link="${escapeHtml(it.link)}"` : ''} style="${it.link ? 'cursor:pointer' : ''}">
          <span class="ws-feed-msg">${escapeHtml(it.message || '')}</span>
          <span class="ws-feed-time">${timeStr}</span>
        </li>`;
      }).join('')}
    `;
    list.innerHTML =
      sectionHtml('오늘', groups.today) +
      sectionHtml('어제', groups.yesterday) +
      sectionHtml('이번 주', groups.week) +
      sectionHtml('이전', groups.past.slice(0, 10));

    list.querySelectorAll('.ws-feed-item[data-link]').forEach(li => {
      li.addEventListener('click', () => { location.href = li.dataset.link; });
    });
  }

  /* ─────── 초기화 + reload 이벤트 ─────── */
  function initAll() {
    refreshBellCount();
    loadOutbox();
    loadFeed();
    /* 30초마다 벨 갱신 */
    setInterval(refreshBellCount, 30000);
  }
  window.addEventListener('workspace:reload', () => {
    refreshBellCount();
    loadOutbox();
    loadFeed();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  /* 외부 노출 (workspace.js와 협업) */
  window.WS_MODALS = {
    openNewTaskModal, openNewEventModal, openNewMemoModal, openNotifPanel,
    refreshBellCount, loadOutbox, loadFeed,
  };
})();
