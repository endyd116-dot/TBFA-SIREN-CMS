/**
 * Phase 21 R1 — 통합 작업 모달
 *
 * WBS 페이지: 기존 #wkNewModal·#wkCardModal 마크업 그대로 사용
 * 다른 페이지: WBS 페이지로 이동 (location.href = /workspace-kanban.html)
 *
 * 전역:
 *   WorkspaceTaskModal.openCreate(opts)   // 새 작업 생성 모달
 *   WorkspaceTaskModal.openDetail(taskId) // 작업 상세 모달
 *   WorkspaceTaskModal.close()
 */
(function () {
  'use strict';

  const IS_KANBAN = window.location.pathname.includes('workspace-kanban');

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]);
    });
  }

  function $(sel) { return document.querySelector(sel); }

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-hidden', 'false');
    el.style.display = 'flex';
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-hidden', 'true');
    el.style.display = '';
  }

  /* ────────────────────────────────────────
     새 작업 생성 — WBS 페이지 전용
  ──────────────────────────────────────── */
  function _openCreateOnKanban(opts) {
    opts = opts || {};
    const titleEl = $('#wkNewTitle');
    const descEl  = $('#wkNewDescription');
    const priEl   = $('#wkNewPriority');
    const dueEl   = $('#wkNewDueDate');
    const tplEl   = $('#wkNewTemplate');
    const hintEl  = $('#wkNewTemplateHint');

    if (titleEl) titleEl.value = '';
    if (descEl)  descEl.value = '';
    if (priEl)   priEl.value = 'normal';
    if (dueEl)   dueEl.value = '';
    if (tplEl)   tplEl.value = '';
    if (hintEl)  hintEl.textContent = '템플릿을 선택하면 설명·우선순위·태그·체크리스트가 자동 채워집니다.';

    if (opts.source) {
      const modal = document.getElementById('wkNewModal');
      if (modal) modal.dataset.source = opts.source;
    }

    openModal('wkNewModal');

    // 기존 kanban.js의 템플릿 로드 함수 위임
    if (typeof window.wkLoadTemplatesIntoSelect === 'function') {
      window.wkLoadTemplatesIntoSelect();
    }
    setTimeout(function () { if (titleEl) titleEl.focus(); }, 50);
  }

  /* ────────────────────────────────────────
     작업 상세 — WBS 페이지 전용
  ──────────────────────────────────────── */
  function _openDetailOnKanban(taskId) {
    taskId = Number(taskId);
    if (!taskId) return;

    // 기존 kanban.js의 openCardById 위임
    if (typeof window.wkOpenCardById === 'function') {
      window.wkOpenCardById(taskId);
      return;
    }

    // fallback: API 직접 조회 후 상세 모달 오픈
    fetch('/api/admin-workspace-tasks?id=' + taskId, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        const task = json.data || json;
        if (!task || !task.id) {
          _showToast('작업을 찾을 수 없어요. 삭제됐을 수 있습니다.', 'error');
          return;
        }
        _fillCardModal(task);
        openModal('wkCardModal');
        if (window.wkOnCardOpen) {
          try { window.wkOnCardOpen(task, null); } catch (_) {}
        }
      })
      .catch(function (err) {
        console.warn('[WorkspaceTaskModal] 상세 조회 실패:', err);
        _showToast('작업을 찾을 수 없어요. 삭제됐을 수 있습니다.', 'error');
      });
  }

  function _fillCardModal(t) {
    function set(id, val) { const el = document.getElementById(id); if (el) el.value = String(val == null ? '' : val); }
    set('wkCardId',          t.id);
    set('wkCardTitle',       t.title || '');
    set('wkCardDescription', t.description || '');
    set('wkCardPriority',    t.priority || 'normal');
    set('wkCardDueDate',     t.dueDate ? t.dueDate.slice(0, 16) : '');
    set('wkCardEstHours',    t.estimatedHours == null ? '' : t.estimatedHours);
    set('wkCardActHours',    t.actualHours == null ? '' : t.actualHours);
    set('wkCardProgress',    t.progress || 0);
    set('wkCardTags',        Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || ''));

    const progVal = document.getElementById('wkCardProgressVal');
    if (progVal) progVal.textContent = (t.progress || 0) + '%';
  }

  function _showToast(msg, type) {
    const root = document.getElementById('wkToastRoot') ||
                 document.getElementById('wcToastRoot') ||
                 document.getElementById('wsToastRoot');
    if (!root) { console.warn('[WorkspaceTaskModal]', msg); return; }
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  /* ────────────────────────────────────────
     공개 API
  ──────────────────────────────────────── */
  window.WorkspaceTaskModal = {
    /**
     * 새 작업 생성 모달 열기
     * @param {object} opts  { source: 'worktool' | 'calendar' | ... }
     */
    openCreate: function (opts) {
      if (IS_KANBAN) {
        _openCreateOnKanban(opts || {});
      } else {
        // 다른 페이지: WBS 페이지로 이동 (모달은 거기서 자동 열림 불가 — 직접 이동)
        location.href = '/workspace-kanban.html';
      }
    },

    /**
     * 작업 상세 모달 열기
     * @param {number} taskId
     */
    openDetail: function (taskId) {
      if (IS_KANBAN) {
        _openDetailOnKanban(taskId);
      } else {
        location.href = '/workspace-kanban.html#task=' + taskId;
      }
    },

    close: function () {
      closeModal('wkNewModal');
      closeModal('wkCardModal');
    }
  };
})();
