/* =========================================================
   workspace-kanban-v2.js — 칸반 카드 v2 보강
   - 출처 배지(자동 생성 카드)
   - 할당 이력 탭 (히스토리에 통합)
   - 양방향 토스 버튼 (담당자 변경)
   - 관전자(Watcher) 토글
   - sourceType 컬러 매핑
   2026-05-12 신설
   ========================================================= */
(function () {
  'use strict';

  const API = '/api/admin';

  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (t) {
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2400);
      return;
    }
    alert(msg);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ─────── sourceType 컬러/라벨 매핑 ─────── */
  const SOURCE_BADGE = {
    incident:   { color: '#dc2626', bg: '#fee2e2', label: '🚨 SIREN-사건' },
    harassment: { color: '#ea580c', bg: '#ffedd5', label: '⚠️ SIREN-악성민원' },
    legal:      { color: '#7c3aed', bg: '#ede9fe', label: '⚖️ SIREN-법률' },
    support:    { color: '#0891b2', bg: '#cffafe', label: '🎗 유족지원' },
    donation:   { color: '#ca8a04', bg: '#fef9c3', label: '💝 후원' },
    campaign:   { color: '#0d9488', bg: '#ccfbf1', label: '📣 캠페인' },
    member:     { color: '#475569', bg: '#e2e8f0', label: '👤 회원' },
    manual:     { color: '#71717a', bg: '#f4f4f5', label: '✍️ 수기' },
    ai_agent:   { color: '#9333ea', bg: '#f3e8ff', label: '🤖 AI 자동' },
  };

  /* ─────── CSS 자동 주입 ─────── */
  (function injectCss() {
    if (document.getElementById('wkb-v2-css')) return;
    const css = `
      .wkb-source-badge { display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:14px;font-size:11.5px;font-weight:700;margin-left:8px;border:1.5px solid }
      .wkb-card-toolbar { display:flex;gap:8px;margin:8px 0 4px;flex-wrap:wrap }
      .wkb-toolbar-btn { padding:6px 12px;font-size:12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-weight:600;color:#374151 }
      .wkb-toolbar-btn:hover { background:#f9fafb;border-color:#7a1f2b }
      .wkb-toolbar-btn.active { background:#7a1f2b;color:#fff;border-color:#7a1f2b }
      .wkb-transfer-list { list-style:none;padding:0;margin:14px 0 0;border-top:1px solid #e5e7eb }
      .wkb-transfer-item { padding:9px 4px;border-bottom:1px solid #f3f4f6;font-size:12.5px;display:flex;gap:10px;align-items:flex-start }
      .wkb-transfer-icon { font-size:14px;flex-shrink:0 }
      .wkb-transfer-main { flex:1 }
      .wkb-transfer-arrow { color:#6b7280;font-weight:700;margin:0 4px }
      .wkb-transfer-meta { font-size:11px;color:#9ca3af;margin-top:2px }
      .wkb-transfer-msg { font-size:12px;color:#4b5563;font-style:italic;margin-top:3px;padding:5px 8px;background:#f9fafb;border-left:2px solid #d1d5db;border-radius:0 3px 3px 0 }
      .wkb-transfer-type-auto_create  { color:#0891b2 }
      .wkb-transfer-type-manual       { color:#7a1f2b }
      .wkb-transfer-type-fallback_backup { color:#ea580c }
      /* 토스/관전자 모달 (workspace-modals의 .ws-modal 재사용 — 없으면 자체 스타일) */
      .wkb-mini-modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px }
      .wkb-mini-modal { background:#fff;border-radius:12px;width:100%;max-width:480px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden }
      .wkb-mini-modal h3 { margin:0;padding:16px 20px;background:linear-gradient(135deg,#7a1f2b,#a3303f);color:#fff;font-size:15px;display:flex;justify-content:space-between;align-items:center }
      .wkb-mini-modal h3 button { background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:5px;cursor:pointer;font-size:18px }
      .wkb-mini-body { padding:18px 20px;max-height:60vh;overflow:auto }
      .wkb-mini-body label { display:block;font-size:12.5px;font-weight:600;margin-bottom:5px;color:#374151 }
      .wkb-mini-body select, .wkb-mini-body input, .wkb-mini-body textarea { width:100%;padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font-size:13.5px;margin-bottom:12px;box-sizing:border-box;font-family:inherit }
      .wkb-mini-footer { padding:12px 20px;border-top:1px solid #f0f0f0;display:flex;justify-content:flex-end;gap:8px }
      .wkb-mini-footer button { padding:8px 16px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;border:none }
      .wkb-mini-footer .primary { background:#7a1f2b;color:#fff }
      .wkb-mini-footer .ghost { background:#f3f4f6;color:#374151 }
      .wkb-watcher-row { display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #f3f4f6;font-size:13px }
      .wkb-watcher-row input[type=checkbox] { width:auto;margin:0 }
    `;
    const style = document.createElement('style');
    style.id = 'wkb-v2-css';
    style.textContent = css;
    document.head.appendChild(style);
  })();

  /* ─────── DOM 패치 (한 번만) ─────── */
  let _domPatched = false;
  function patchModalDom() {
    if (_domPatched) return;
    const header = document.querySelector('#wkCardModal .wk-modal-header');
    const footer = document.querySelector('#wkCardModal .wk-modal-footer');
    if (!header || !footer) return;

    /* 헤더에 출처 배지 공간 */
    const badgeWrap = document.createElement('span');
    badgeWrap.id = 'wkbSourceBadge';
    badgeWrap.style.display = 'none';
    header.querySelector('h2')?.appendChild(badgeWrap);

    /* 푸터에 토스/관전자 버튼 */
    const transferBtn = document.createElement('button');
    transferBtn.id = 'wkbBtnTransfer';
    transferBtn.type = 'button';
    transferBtn.className = 'wk-btn-secondary';
    transferBtn.textContent = '📨 토스';
    transferBtn.style.marginRight = '4px';

    const watchBtn = document.createElement('button');
    watchBtn.id = 'wkbBtnWatch';
    watchBtn.type = 'button';
    watchBtn.className = 'wk-btn-secondary';
    watchBtn.textContent = '👀 관전';
    watchBtn.style.marginRight = '4px';

    /* 보관 버튼 앞에 삽입 */
    const archiveBtn = footer.querySelector('#wkCardArchive');
    if (archiveBtn) {
      archiveBtn.parentNode.insertBefore(transferBtn, archiveBtn);
      archiveBtn.parentNode.insertBefore(watchBtn, archiveBtn);
    }

    transferBtn.addEventListener('click', () => openTransferModal());
    watchBtn.addEventListener('click', () => openWatcherModal());

    _domPatched = true;
  }

  /* ─────── 현재 카드 ID 가져오기 ─────── */
  function getCurrentTaskId() {
    const v = document.getElementById('wkCardId')?.value;
    return v ? Number(v) : null;
  }

  /* ─────── 출처 배지 표시 ─────── */
  function renderSourceBadge(task) {
    const wrap = document.getElementById('wkbSourceBadge');
    if (!wrap) return;
    const meta = SOURCE_BADGE[task.sourceType];
    if (!meta) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }
    const label = meta.label + (task.sourceId ? ` #${task.sourceId}` : '');
    wrap.style.display = 'inline-flex';
    wrap.className = 'wkb-source-badge';
    wrap.style.color = meta.color;
    wrap.style.background = meta.bg;
    wrap.style.borderColor = meta.color;
    wrap.innerHTML = task.sourceRefUrl
      ? `<a href="${escapeHtml(task.sourceRefUrl)}" style="color:inherit;text-decoration:none">${escapeHtml(label)} ↗</a>`
      : escapeHtml(label);
  }

  /* ─────── 히스토리 탭에 할당 이력 렌더 ─────── */
  const TRANSFER_ICONS = {
    auto_create: '🆕',
    manual: '📨',
    fallback_backup: '↩️',
  };
  async function renderTransferHistory(taskId) {
    const list = document.getElementById('wkHistoryList');
    if (!list) return;
    list.innerHTML = '<li class="wk-history-loading">불러오는 중...</li>';
    const res = await api(API + '/workspace-task-transfer?taskId=' + taskId);
    if (!res.ok) {
      list.innerHTML = '<li class="wk-history-empty">이력 조회 실패</li>';
      return;
    }
    const items = (res.data?.data?.list || res.data?.list || []);
    if (!items.length) {
      list.innerHTML = '<li class="wk-history-empty">아직 할당 이력이 없습니다.</li>';
      return;
    }
    list.className = 'wkb-transfer-list';
    list.innerHTML = items.map(t => {
      const icon = TRANSFER_ICONS[t.transferType] || '📨';
      const fromName = t.fromMemberName || '시스템';
      const toName = t.toMemberName || '—';
      const time = new Date(t.createdAt).toLocaleString('ko-KR');
      const typeLabel = {
        auto_create: '자동 생성',
        manual: '운영자 토스',
        fallback_backup: '백업 자동 폴백',
      }[t.transferType] || t.transferType;
      return `<li class="wkb-transfer-item">
        <span class="wkb-transfer-icon">${icon}</span>
        <div class="wkb-transfer-main">
          <div>
            <strong>${escapeHtml(fromName)}</strong>
            <span class="wkb-transfer-arrow">→</span>
            <strong>${escapeHtml(toName)}</strong>
            <span class="wkb-transfer-type-${t.transferType}" style="margin-left:6px;font-size:11px">${escapeHtml(typeLabel)}</span>
          </div>
          ${t.message ? `<div class="wkb-transfer-msg">${escapeHtml(t.message)}</div>` : ''}
          <div class="wkb-transfer-meta">
            ${time}
            ${t.snapshotProgress != null ? ` · 시점 진행률 ${t.snapshotProgress}%` : ''}
            ${t.snapshotStatus ? ` · ${escapeHtml(t.snapshotStatus)}` : ''}
          </div>
        </div>
      </li>`;
    }).join('');
  }

  /* ─────── 운영자 명단 캐시 ─────── */
  let _operatorsCache = null;
  async function getOperators() {
    if (_operatorsCache) return _operatorsCache;
    const res = await api(API + '/service-rnr');
    const list = res.data?.data?.operators || res.data?.operators || [];
    _operatorsCache = list.filter(o => o.role && o.operatorActive);
    return _operatorsCache;
  }

  /* ─────── 토스 모달 ─────── */
  function makeMiniModal(title, bodyHtml, footerHtml, onMount) {
    const ov = document.createElement('div');
    ov.className = 'wkb-mini-modal-overlay';
    ov.innerHTML = `
      <div class="wkb-mini-modal">
        <h3>${escapeHtml(title)} <button data-close>×</button></h3>
        <div class="wkb-mini-body">${bodyHtml}</div>
        <div class="wkb-mini-footer">${footerHtml}</div>
      </div>`;
    document.body.appendChild(ov);
    function close() { ov.remove(); }
    ov.addEventListener('click', e => { if (e.target === ov || e.target.matches('[data-close]')) close(); });
    if (onMount) onMount(ov, close);
    return { overlay: ov, close };
  }

  async function openTransferModal() {
    const taskId = getCurrentTaskId();
    if (!taskId) return;
    const operators = await getOperators();
    const opts = operators.map(o => `<option value="${o.id}">${escapeHtml(o.name)} (${escapeHtml(o.role || '')})</option>`).join('');
    makeMiniModal(
      '📨 작업 토스 (담당자 변경)',
      `
        <label>새 담당자 (운영자)</label>
        <select id="wkbTrTo">
          <option value="">-- 선택 --</option>
          ${opts}
        </select>
        <label>메시지 (선택)</label>
        <textarea id="wkbTrMsg" rows="3" placeholder="토스 사유나 인계 메모..."></textarea>
        <small style="color:#666;display:block">토스 시 이력에 자동 기록 + 새 담당자에게 알림이 발송됩니다.</small>
      `,
      `<button class="ghost" data-close>취소</button><button class="primary" id="wkbTrSubmit">토스 실행</button>`,
      (ov, close) => {
        ov.querySelector('#wkbTrSubmit').addEventListener('click', async () => {
          const toMemberId = Number(ov.querySelector('#wkbTrTo').value);
          if (!toMemberId) return toast('새 담당자를 선택하세요');
          const message = String(ov.querySelector('#wkbTrMsg').value || '').trim();
          const res = await api(API + '/workspace-task-transfer', {
            method: 'POST',
            body: { taskId, toMemberId, message: message || null },
          });
          if (!res.ok) return toast('토스 실패: ' + (res.data?.error || ''));
          toast(res.data?.message || '토스 완료');
          close();
          /* 카드 모달 새로고침 위해 페이지 리로드 또는 칸반 reload 이벤트 */
          window.dispatchEvent(new Event('workspace:reload'));
          /* 카드 자체는 다시 fetch가 필요하므로 모달 닫기 */
          document.querySelector('[data-close-modal="wkCardModal"]')?.click();
        });
      }
    );
  }

  /* ─────── 관전자 모달 ─────── */
  async function openWatcherModal() {
    const taskId = getCurrentTaskId();
    if (!taskId) return;
    const [operatorsRes, currentRes] = await Promise.all([
      getOperators(),
      api(API + '/workspace-task-watchers?taskId=' + taskId),
    ]);
    const current = (currentRes.data?.data?.list || currentRes.data?.list || []).map(w => Number(w.memberId));
    const opts = operatorsRes.map(o =>
      `<div class="wkb-watcher-row">
         <input type="checkbox" id="wkbW${o.id}" value="${o.id}" ${current.includes(o.id) ? 'checked' : ''}>
         <label for="wkbW${o.id}" style="margin:0;font-weight:500">${escapeHtml(o.name)} <small style="color:#888">${escapeHtml(o.role || '')}</small></label>
       </div>`).join('');
    makeMiniModal(
      '👀 카드 관전자 관리',
      `
        <small style="color:#666;display:block;margin-bottom:10px">관전자는 담당자가 아니지만 상태 변화·댓글에 대한 알림을 받습니다.</small>
        <div id="wkbWatcherList">${opts}</div>
      `,
      `<button class="ghost" data-close>취소</button><button class="primary" id="wkbWatcherSubmit">저장</button>`,
      (ov, close) => {
        ov.querySelector('#wkbWatcherSubmit').addEventListener('click', async () => {
          const checked = Array.from(ov.querySelectorAll('input[type=checkbox]:checked')).map(c => Number(c.value));
          const toAdd = checked.filter(id => !current.includes(id));
          const toRemove = current.filter(id => !checked.includes(id));
          if (toAdd.length) {
            await api(API + '/workspace-task-watchers', { method: 'POST', body: { taskId, memberIds: toAdd } });
          }
          for (const mid of toRemove) {
            await api(API + '/workspace-task-watchers?taskId=' + taskId + '&memberId=' + mid, { method: 'DELETE' });
          }
          toast(`관전자 ${toAdd.length}명 추가, ${toRemove.length}명 해제`);
          close();
        });
      }
    );
  }

  /* ─────── workspace-kanban.js의 wkOnCardOpen hook 등록 ─────── */
  window.wkOnCardOpen = function (task, me) {
    patchModalDom();
    renderSourceBadge(task);
    if (task.id) renderTransferHistory(task.id);
  };

  /* 외부 노출 */
  window.WKB_V2 = { openTransferModal, openWatcherModal };
})();
