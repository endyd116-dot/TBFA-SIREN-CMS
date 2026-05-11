/**
 * Phase 21 R1 — 통합 작업 모달 + R2 확장 (토스·워처·거쳐온 체인·원본 서비스)
 *
 * WBS 페이지: 기존 #wkNewModal·#wkCardModal 마크업 그대로 사용
 * 다른 페이지: WBS 페이지로 이동 (location.href = /workspace-kanban.html)
 *
 * 전역:
 *   WorkspaceTaskModal.openCreate(opts)
 *   WorkspaceTaskModal.openDetail(taskId)
 *   WorkspaceTaskModal.openTransfer(taskId)   // R2 추가
 *   WorkspaceTaskModal.toggleWatcher(taskId)  // R2 추가
 *   WorkspaceTaskModal.mountAssignBar(task)   // R2 — 카드 모달 진입 시 자동 호출
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

  async function _api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      method: opts.method || 'GET',
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
    return data;
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

    if (typeof window.wkOpenCardById === 'function') {
      window.wkOpenCardById(taskId);
      return;
    }

    fetch('/api/admin-workspace-tasks?id=' + taskId, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        const task = (json && json.data) || json;
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

  /* ────────────────────────────────────────
     R2 — 담당자·워처·원본 서비스 영역 마운트
  ──────────────────────────────────────── */
  const SERVICE_KIND_LABEL = {
    incident: '신고',
    harassment: '괴롭힘',
    legal: '법률',
    support: '유족지원',
  };
  const SERVICE_KIND_PATH = {
    incident: '/admin.html#siren-incidents',
    harassment: '/admin.html#siren-harassment',
    legal: '/admin.html#siren-legal',
    support: '/admin.html#support',
  };

  function mountAssignBar(task) {
    const bar = document.getElementById('wkAssignBar');
    if (!bar || !task) return;
    bar.style.display = '';

    const nameEl = document.getElementById('wkAssignName');
    if (nameEl) {
      // B 명세: 작업 카드의 현재 담당자 = assignedTo (members.id), 표시명 = assignedToName
      const uid = task.assignedTo != null ? task.assignedTo : task.assigneeUid;
      const display = task.assignedToName || task.assigneeName;
      const name = display || (uid ? '#' + uid : '미할당');
      nameEl.textContent = name;
    }

    // 거쳐온 담당자 체인 (최근 5명)
    const chainEl = document.getElementById('wkAssignChain');
    if (chainEl) {
      const chain = Array.isArray(task.transferChain) ? task.transferChain : [];
      if (chain.length > 0) {
        const names = chain.slice(-5).map(function (n) {
          return '<span class="wk-chain-step">' + escapeHtml(n) + '</span>';
        }).join('<span class="wk-chain-arrow"> → </span>');
        chainEl.innerHTML = '<span class="wk-chain-label">거쳐온 담당자:</span> ' + names;
      } else {
        chainEl.innerHTML = '';
      }
    }

    // 워처 버튼 상태
    const watcherIcon = document.getElementById('wkBtnWatcherIcon');
    const watcherLabel = document.getElementById('wkBtnWatcherLabel');
    const watcherBtn = document.getElementById('wkBtnWatcher');
    const isWatching = !!task.isWatchedByMe;
    if (watcherIcon) watcherIcon.textContent = isWatching ? '🙈' : '👁';
    if (watcherLabel) watcherLabel.textContent = isWatching ? '관찰 해제' : '관찰하기';
    if (watcherBtn) watcherBtn.dataset.watching = isWatching ? '1' : '0';

    // 원본 서비스 버튼 — B 명세: sourceType / sourceId
    const srcBtn = document.getElementById('wkBtnSourceService');
    if (srcBtn) {
      const kind = task.sourceType || task.sourceServiceKind;
      const id = task.sourceId != null ? task.sourceId : task.sourceServiceId;
      if (kind && id) {
        srcBtn.style.display = '';
        const label = SERVICE_KIND_LABEL[kind] || kind;
        srcBtn.textContent = '🔗 원본 ' + label + ' 보기';
        srcBtn.dataset.serviceKind = kind;
        srcBtn.dataset.serviceId = String(id);
      } else {
        srcBtn.style.display = 'none';
        srcBtn.dataset.serviceKind = '';
        srcBtn.dataset.serviceId = '';
      }
    }
  }

  /* ────────────────────────────────────────
     R2 — 토스 모달
  ──────────────────────────────────────── */
  async function openTransfer(taskId) {
    taskId = Number(taskId);
    if (!taskId) return;

    const modalEl = document.getElementById('wkTransferModal');
    if (!modalEl) {
      _showToast('토스 모달이 없습니다. WBS 페이지로 이동하세요.', 'error');
      return;
    }

    // 받는 사람 드롭다운 로드
    const sel = document.getElementById('wkTransferToUid');
    const hint = document.getElementById('wkTransferAwayHint');
    const reasonEl = document.getElementById('wkTransferReason');
    const taskIdEl = document.getElementById('wkTransferTaskId');

    if (taskIdEl) taskIdEl.value = String(taskId);
    if (reasonEl) reasonEl.value = '';
    if (hint) hint.style.display = 'none';

    if (sel) {
      sel.innerHTML = '<option value="">— 운영자 선택 —</option>';
      try {
        const res = await _api('/api/admin-workspace-members');
        const items = (res && res.data && res.data.items) || (res && res.items) || (res && res.data) || [];
        if (Array.isArray(items)) {
          items.forEach(function (m) {
            const uid = m.id || m.uid;
            if (!uid) return;
            const name = m.name || m.email || ('#' + uid);
            const away = m.outOfOffice ? ' (부재 중 ⚠️)' : '';
            const opt = document.createElement('option');
            opt.value = String(uid);
            opt.textContent = name + away;
            opt.dataset.away = m.outOfOffice ? '1' : '0';
            sel.appendChild(opt);
          });
        }
      } catch (err) {
        console.warn('[WorkspaceTaskModal] 운영자 목록 로드 실패:', err);
      }
    }

    openModal('wkTransferModal');
  }

  async function confirmTransfer() {
    const taskIdEl = document.getElementById('wkTransferTaskId');
    const sel = document.getElementById('wkTransferToUid');
    const reasonEl = document.getElementById('wkTransferReason');
    if (!taskIdEl || !sel) return;

    const taskId = Number(taskIdEl.value);
    const toUid = Number(sel.value);
    const reason = reasonEl ? reasonEl.value.trim() : '';

    if (!taskId || !toUid) {
      _showToast('받는 사람을 선택하세요.', 'error');
      return;
    }

    // 본인 → 본인 검증 (서버에서도 막지만 즉시 안내)
    const me = window.WorkspaceTaskModal && window.WorkspaceTaskModal._me;
    if (me && me.id && Number(me.id) === toUid) {
      _showToast('자기 자신에게는 토스할 수 없어요', 'error');
      return;
    }

    const btn = document.getElementById('wkTransferConfirm');
    if (btn) btn.disabled = true;
    try {
      const res = await _api('/api/admin-workspace-task-transfer', {
        method: 'POST',
        body: { taskId: taskId, toUid: toUid, reason: reason || undefined }
      });
      const opt = sel.options[sel.selectedIndex];
      const toName = opt ? opt.textContent.replace(/\s\(부재 중 ⚠️\)$/, '') : '받는 사람';
      _showToast(toName + '님께 토스했어요', 'success');
      closeModal('wkTransferModal');

      // BroadcastChannel 발신
      if (window.WorkspaceSync) {
        WorkspaceSync.notify('task:updated', { id: taskId });
        WorkspaceSync.notify('notification:new', { taskId: taskId });
      }

      // 카드 모달도 닫고 보드 리로드
      closeModal('wkCardModal');
      if (typeof window.wkReloadTasks === 'function') {
        try { window.wkReloadTasks(); } catch (_) {}
      }
    } catch (err) {
      _showToast('토스 실패: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // 부재 안내 — 받는 사람 선택 변경 시
  function bindTransferAwayHint() {
    const sel = document.getElementById('wkTransferToUid');
    const hint = document.getElementById('wkTransferAwayHint');
    if (!sel || !hint) return;
    sel.addEventListener('change', function () {
      const opt = sel.options[sel.selectedIndex];
      hint.style.display = (opt && opt.dataset.away === '1') ? '' : 'none';
    });
  }

  /* ────────────────────────────────────────
     R2 — 워처 토글
  ──────────────────────────────────────── */
  async function toggleWatcher(taskId) {
    taskId = Number(taskId);
    if (!taskId) return;
    const btn = document.getElementById('wkBtnWatcher');
    const isWatching = btn && btn.dataset.watching === '1';

    try {
      if (isWatching) {
        await _api('/api/admin-workspace-task-watchers?taskId=' + taskId, { method: 'DELETE' });
        _showToast('관찰을 해제했어요', 'success');
        if (btn) btn.dataset.watching = '0';
        const icon = document.getElementById('wkBtnWatcherIcon');
        const label = document.getElementById('wkBtnWatcherLabel');
        if (icon) icon.textContent = '👁';
        if (label) label.textContent = '관찰하기';
      } else {
        await _api('/api/admin-workspace-task-watchers', { method: 'POST', body: { taskId: taskId } });
        _showToast('이 작업을 관찰합니다', 'success');
        if (btn) btn.dataset.watching = '1';
        const icon = document.getElementById('wkBtnWatcherIcon');
        const label = document.getElementById('wkBtnWatcherLabel');
        if (icon) icon.textContent = '🙈';
        if (label) label.textContent = '관찰 해제';
      }
    } catch (err) {
      _showToast('처리 실패: ' + err.message, 'error');
    }
  }

  /* ────────────────────────────────────────
     R2 — 원본 서비스 이동
  ──────────────────────────────────────── */
  function gotoSourceService(kind, id) {
    const path = SERVICE_KIND_PATH[kind];
    if (!path) {
      _showToast('원본 서비스 위치를 알 수 없어요', 'error');
      return;
    }
    // 서비스 id를 query로 전달 → 어드민 페이지가 자동 모달 오픈 (admin-siren.js 측 처리 기대)
    location.href = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'openId=' + encodeURIComponent(id);
  }

  /* ────────────────────────────────────────
     이벤트 바인딩 (페이지 진입 시 1회)
  ──────────────────────────────────────── */
  function bindOnce() {
    // 토스 버튼
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('#wkBtnTransfer');
      if (!btn) return;
      const idEl = document.getElementById('wkCardId');
      const taskId = idEl ? Number(idEl.value) : 0;
      if (taskId) openTransfer(taskId);
    });

    // 워처 토글
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('#wkBtnWatcher');
      if (!btn) return;
      const idEl = document.getElementById('wkCardId');
      const taskId = idEl ? Number(idEl.value) : 0;
      if (taskId) toggleWatcher(taskId);
    });

    // 원본 서비스 보기
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('#wkBtnSourceService');
      if (!btn) return;
      const kind = btn.dataset.serviceKind || '';
      const id = btn.dataset.serviceId || '';
      if (kind && id) gotoSourceService(kind, id);
    });

    // 토스 확정
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('#wkTransferConfirm');
      if (!btn) return;
      confirmTransfer();
    });

    // 토스 모달 닫기 (배경·X)
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-close-modal="wkTransferModal"]');
      if (!btn) return;
      closeModal('wkTransferModal');
    });

    bindTransferAwayHint();
  }

  if (IS_KANBAN) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindOnce);
    } else {
      bindOnce();
    }
  }

  /* ────────────────────────────────────────
     공개 API
  ──────────────────────────────────────── */
  window.WorkspaceTaskModal = {
    _me: null,  // 카드 모달 hook에서 채워짐

    openCreate: function (opts) {
      if (IS_KANBAN) {
        _openCreateOnKanban(opts || {});
      } else {
        location.href = '/workspace-kanban.html#new-task';
      }
    },

    openDetail: function (taskId) {
      if (IS_KANBAN) {
        _openDetailOnKanban(taskId);
      } else {
        location.href = '/workspace-kanban.html#task=' + taskId;
      }
    },

    openTransfer: openTransfer,
    toggleWatcher: toggleWatcher,
    mountAssignBar: mountAssignBar,

    close: function () {
      closeModal('wkNewModal');
      closeModal('wkCardModal');
      closeModal('wkTransferModal');
    }
  };
})();
