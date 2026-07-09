/**
 * Phase 21 R4 — 메모 작성·수정 모달
 *
 * window.WorkspaceMemoModal = {
 *   openCreate(opts)    opts: { showInCalendar?, eventDate?, eventTime? }
 *   openEdit(memoId, opts)
 *   close()
 * }
 *
 * API:
 *   POST  /api/admin-workspace-memos  { title, contentHtml, color, isPinned, showInCalendar, eventDate, eventTime }
 *   PATCH /api/admin-workspace-memos?id=N  (동일 필드)
 */
(function () {
  'use strict';

  const MOCK_ENABLED = typeof window.__WMM_USE_MOCK__ !== 'undefined' ? window.__WMM_USE_MOCK__ : false;

  const COLORS = [
    { hex: '#ffffff', label: '흰색' },
    { hex: '#fff3cd', label: '노랑' },
    { hex: '#d1fae5', label: '초록' },
    { hex: '#dbeafe', label: '파랑' },
    { hex: '#fce7f3', label: '분홍' },
    { hex: '#f3e8ff', label: '보라' },
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  function toast(msg, type) {
    const roots = ['#wkToastRoot', '#wcToastRoot', '#wsToastRoot', '#mpToastRoot'];
    let root = null;
    for (const id of roots) {
      root = document.querySelector(id);
      if (root) break;
    }
    if (!root) root = document.body;
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    el.style.cssText = root === document.body
      ? 'position:fixed;bottom:24px;right:24px;padding:12px 18px;background:#334155;color:#fff;border-radius:6px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.15)'
      : '';
    root.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'POST',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data;
  }

  /* ─── 모달 HTML ─── */
  function buildModalHtml(opts, existingMemo) {
    const showCal = !!(opts && opts.showInCalendar) || !!(existingMemo && existingMemo.showInCalendar);
    const eventDate = (opts && opts.eventDate) || (existingMemo && existingMemo.eventDate) || '';
    const eventTime = (opts && opts.eventTime) || (existingMemo && existingMemo.eventTime) || '';
    const title = (existingMemo && existingMemo.title) || '';
    const color = (existingMemo && existingMemo.color) || '#ffffff';
    const isPinned = !!(existingMemo && existingMemo.isPinned);

    const colorDots = COLORS.map(c =>
      `<button type="button" class="wmm-color-dot${color === c.hex ? ' is-selected' : ''}" data-color="${escapeHtml(c.hex)}" style="background:${escapeHtml(c.hex)}" title="${escapeHtml(c.label)}"></button>`
    ).join('');

    return `
<div id="wmmOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center">
  <div id="wmmModal" role="dialog" aria-modal="true" aria-label="메모 작성" style="background:#fff;border-radius:12px;padding:28px 28px 22px;width:min(520px,95vw);max-height:85vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,.2);position:relative">
    <h2 style="font-size:16px;font-weight:700;margin:0 0 16px;color:#1e293b">${existingMemo ? '메모 수정' : '메모 작성'}</h2>

    <label style="display:block;font-size:12.5px;color:#64748b;margin-bottom:4px">제목</label>
    <input id="wmmTitle" type="text" maxlength="200" value="${escapeHtml(title)}" placeholder="메모 제목을 입력하세요"
      style="width:100%;padding:9px 11px;border:1px solid #e2e8f0;border-radius:7px;font-size:13.5px;box-sizing:border-box;margin-bottom:14px">

    <label style="display:block;font-size:12.5px;color:#64748b;margin-bottom:4px">내용</label>
    <textarea id="wmmContent" rows="5" maxlength="5000" placeholder="메모 내용을 입력하세요"
      style="width:100%;padding:9px 11px;border:1px solid #e2e8f0;border-radius:7px;font-size:13px;resize:vertical;box-sizing:border-box;margin-bottom:14px">${existingMemo && existingMemo.contentHtml ? escapeHtml(existingMemo.contentHtml) : ''}</textarea>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <label style="font-size:13px;color:#374151;display:flex;align-items:center;gap:6px;cursor:pointer">
        <input id="wmmShowInCalendar" type="checkbox" ${showCal ? 'checked' : ''}
          style="width:15px;height:15px;cursor:pointer">
        📅 캘린더에 표시
      </label>
    </div>

    <div id="wmmCalendarFields" style="display:${showCal ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
      <div>
        <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px">날짜 <span style="color:#dc2626">*</span></label>
        <input id="wmmEventDate" type="date" value="${escapeHtml(eventDate)}"
          style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
      </div>
      <div>
        <label style="display:block;font-size:12px;color:#64748b;margin-bottom:4px">시간 <span style="color:#94a3b8">(선택)</span></label>
        <input id="wmmEventTime" type="time" value="${escapeHtml(eventTime ? eventTime.slice(0,5) : '')}"
          style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px">
      <span style="font-size:12.5px;color:#64748b">색상:</span>
      ${colorDots}
    </div>

    <label style="font-size:13px;color:#374151;display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:18px">
      <input id="wmmIsPinned" type="checkbox" ${isPinned ? 'checked' : ''}
        style="width:15px;height:15px;cursor:pointer">
      📌 상단 고정
    </label>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="wmmCancel" type="button"
        style="padding:9px 18px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;font-size:13.5px;cursor:pointer;color:#475569">취소</button>
      <button id="wmmSave" type="button"
        style="padding:9px 18px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:13.5px;cursor:pointer;font-weight:600">저장</button>
    </div>
  </div>
</div>`;
  }

  /* ─── 모달 마운트 ─── */
  function mount(opts, existingMemo) {
    // 기존 모달 정리
    const prev = document.getElementById('wmmOverlay');
    if (prev) prev.remove();

    const div = document.createElement('div');
    div.innerHTML = buildModalHtml(opts, existingMemo);
    document.body.appendChild(div.firstElementChild);

    const overlay = document.getElementById('wmmOverlay');
    let selectedColor = (existingMemo && existingMemo.color) || '#ffffff';

    // 색상 dot 클릭
    overlay.querySelectorAll('.wmm-color-dot').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.wmm-color-dot').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        selectedColor = btn.dataset.color;
      });
    });

    // 캘린더 표시 체크박스 토글
    const calCheck = document.getElementById('wmmShowInCalendar');
    const calFields = document.getElementById('wmmCalendarFields');
    calCheck.addEventListener('change', () => {
      calFields.style.display = calCheck.checked ? 'grid' : 'none';
    });

    // 취소
    document.getElementById('wmmCancel').addEventListener('click', () => {
      overlay.remove();
    });

    // 오버레이 배경 클릭
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });

    // ESC
    function onEsc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    }
    document.addEventListener('keydown', onEsc);

    // 저장
    document.getElementById('wmmSave').addEventListener('click', async () => {
      const titleVal = document.getElementById('wmmTitle').value.trim();
      const contentVal = document.getElementById('wmmContent').value;
      const showCalVal = document.getElementById('wmmShowInCalendar').checked;
      const eventDateVal = document.getElementById('wmmEventDate').value;
      const eventTimeVal = document.getElementById('wmmEventTime').value;
      const isPinnedVal = document.getElementById('wmmIsPinned').checked;

      if (!titleVal) { toast('제목을 입력해주세요', 'error'); return; }
      if (showCalVal && !eventDateVal) {
        toast('캘린더에 표시하려면 날짜를 입력해주세요', 'error');
        return;
      }

      const btn = document.getElementById('wmmSave');
      btn.disabled = true;
      btn.textContent = '저장 중...';

      const body = {
        title: titleVal,
        contentHtml: contentVal,
        color: selectedColor,
        isPinned: isPinnedVal,
        showInCalendar: showCalVal,
        eventDate: showCalVal ? eventDateVal : null,
        eventTime: showCalVal && eventTimeVal ? eventTimeVal : null,
      };

      try {
        if (MOCK_ENABLED) {
          await new Promise(r => setTimeout(r, 300));
          toast('메모가 저장됐어요 (mock)', 'success');
        } else if (existingMemo) {
          await api(`/api/admin-workspace-memos?id=${existingMemo.id}`, { method: 'PATCH', body });
          toast('메모가 저장됐어요', 'success');
        } else {
          await api('/api/admin-workspace-memos', { method: 'POST', body });
          toast('메모가 저장됐어요', 'success');
        }
        overlay.remove();

        // 상위 페이지에 갱신 이벤트 발행
        window.dispatchEvent(new CustomEvent('wmm:saved', { detail: { body } }));

        // WorkspaceSync 브로드캐스트 (다른 탭 동기화) — 성공 흐름을 깨지 않도록 방어
        // ★ fix: 존재하지 않는 emit() 호출로 TypeError→거짓 실패 토스트 나던 버그. notify가 올바른 메서드.
        if (window.WorkspaceSync && typeof WorkspaceSync.notify === 'function') {
          try { WorkspaceSync.notify('memo:created', {}); } catch (_) {}
        }
      } catch (err) {
        toast('저장 실패: ' + (err.message || '알 수 없는 오류'), 'error');
        btn.disabled = false;
        btn.textContent = '저장';
      }
    });
  }

  /* ─── 공개 API ─── */
  window.WorkspaceMemoModal = {
    openCreate(opts) {
      mount(opts || {}, null);
    },
    openEdit(memoId, opts) {
      // memoId가 객체이면 기존 메모 데이터로 직접 사용
      if (memoId && typeof memoId === 'object') {
        mount(opts || {}, memoId);
        return;
      }
      if (!memoId) return;
      // ID로 조회 후 열기
      fetch(`/api/admin-workspace-memos?id=${memoId}`, { credentials: 'include' })
        .then(r => r.json())
        .then(res => {
          const memo = (res.data && res.data.item) || (res.data && res.data.items && res.data.items[0]) || res.data || res;
          mount(opts || {}, memo);
        })
        .catch(() => mount(opts || {}, { id: memoId }));
    },
    close() {
      const el = document.getElementById('wmmOverlay');
      if (el) el.remove();
    },
  };

})();
