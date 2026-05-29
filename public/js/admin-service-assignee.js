/**
 * Phase 21 R2 — 서비스 상세 담당자 박스 자동 마운트
 *
 * 대상: 사이렌 상세 모달(#sirenDetailModal)이 열릴 때 모달 본문 최상단에 담당자 박스 prepend
 *
 * API:
 *   POST /api/admin-service-assignee  { serviceKind, serviceId, newAssigneeUid, reason }
 *
 * 모드:
 *   - admin-siren.js가 #srnModalBody의 innerHTML을 갈아끼우므로 MutationObserver로 감지
 *   - data-srn-row[data-srn-kind][data-srn-id] 또는 모달 내부의 식별자에서 (kind, id) 추출
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 18px;background:' +
      (type === 'error' ? '#b91c1c' : type === 'success' ? '#15803d' : '#334155') +
      ';color:#fff;border-radius:6px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(path, opts) {
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

  // 현재 모달이 어떤 (kind, id)인지 추출 — admin-siren.js의 _currentDetailKind / _currentDetailId 비공개 변수 대신
  // 모달 헤더 텍스트 + 모달이 열리기 직전 클릭된 row에서 추론
  let _lastClickedKind = null;
  let _lastClickedId = null;

  function rememberLastClick() {
    document.addEventListener('click', (e) => {
      // admin.html에서 row 클릭은 보통 [data-srn-row], [data-srn-kind] 식으로 구조화
      const row = e.target.closest('[data-srn-id]');
      if (row) {
        _lastClickedKind = row.dataset.srnKind || row.dataset.kind || null;
        _lastClickedId = Number(row.dataset.srnId || row.dataset.id) || null;
        return;
      }
      // tbody 열 직접 클릭 — tbody의 data-srn-tbody에서 kind 추출
      const tr = e.target.closest('tbody[data-srn-tbody] tr[data-id]');
      if (tr) {
        const tbody = tr.closest('tbody[data-srn-tbody]');
        _lastClickedKind = tbody ? tbody.dataset.srnTbody : null;
        _lastClickedId = Number(tr.dataset.id) || null;
      }
    }, true);
  }

  // 담당자 박스 HTML
  function renderAssigneeBox(serviceKind, serviceId, members, currentUid) {
    const supportedKinds = ['incident', 'harassment', 'legal', 'support'];
    if (!supportedKinds.includes(serviceKind) || !serviceId) return '';

    const current = members.find(m => Number(m.id || m.uid) === Number(currentUid));
    const currentName = current ? (current.name || current.email || ('#' + (current.id || current.uid))) : (currentUid ? '#' + currentUid : '미할당');
    const currentAway = current && current.outOfOffice;

    // 백업 정보는 모달 진입 후 R&R에서 조회 — 일단 placeholder
    const opts = ['<option value="">— 운영자 선택 —</option>']
      .concat(members.map(m => {
        const uid = m.id || m.uid;
        const name = m.name || m.email || ('#' + uid);
        const away = m.outOfOffice ? ' (부재 중 ⚠️)' : '';
        const sel = Number(uid) === Number(currentUid) ? ' selected' : '';
        return `<option value="${uid}"${sel}>${escapeHtml(name + away)}</option>`;
      })).join('');

    return `
      <div class="srn-modal-section" data-assignee-box style="border:1px solid #e5e7eb;background:#f8fafc;border-radius:8px;padding:12px 14px;margin-bottom:14px">
        <h5 style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0f172a">📌 담당자</h5>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;margin-bottom:10px">
          <span>현재: <strong>${escapeHtml(currentName)}</strong></span>
          ${currentAway ? '<span style="color:#a01e2c">⚠️ 부재 중</span>' : ''}
          <span data-assignee-backup-info style="color:#64748b;font-size:12.5px"></span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select data-assignee-select class="wk-input" style="min-width:200px;padding:6px 10px;font-size:13px">${opts}</select>
          <input type="text" data-assignee-reason placeholder="변경 사유 (선택)" class="wk-input" style="flex:1;min-width:200px;padding:6px 10px;font-size:13px">
          <button type="button" data-assignee-save class="btn-sm btn-sm-primary">담당자 변경</button>
          <button type="button" data-assignee-card class="btn-sm btn-sm-ghost" style="display:none">🔗 원본 카드 보기</button>
        </div>
      </div>
    `;
  }

  // 백업·R&R 정보 추가 조회
  async function fetchBackupInfo(serviceKind, serviceCategory) {
    try {
      const res = await api('/api/admin-service-rnr');
      const data = (res && res.data) || res || {};
      const mappings = Array.isArray(data.mappings) ? data.mappings : [];
      const m = mappings.find(x => x.serviceKind === serviceKind && (x.serviceCategory || null) === (serviceCategory || null));
      if (m && m.backupUid) {
        return { uid: m.backupUid, name: m.backupName || ('#' + m.backupUid) };
      }
    } catch (_) { /* mock 시점에는 실패 — 무시 */ }
    return null;
  }

  // 멤버 목록 캐시
  let _membersCache = null;
  async function getMembers() {
    if (_membersCache) return _membersCache;
    try {
      const res = await api('/api/admin-workspace-members');
      // AD-016: 엔드포인트가 ok({ data: rows })로 이중 래핑(body.data.data=rows) → data.data까지 확인
      const items = (res && res.data && Array.isArray(res.data.data) && res.data.data)
        || (res && res.data && res.data.items)
        || (res && res.items)
        || (res && res.data)
        || [];
      _membersCache = Array.isArray(items) ? items : [];
    } catch (_) {
      _membersCache = [];
    }
    return _membersCache;
  }

  // 모달 본문에 박스 마운트
  async function mount(modalBody) {
    if (!modalBody) return;
    // 이미 마운트했으면 skip
    if (modalBody.querySelector('[data-assignee-box]')) return;

    const kind = _lastClickedKind;
    const id = _lastClickedId;
    if (!kind || !id) return;
    if (!['incident', 'harassment', 'legal', 'support'].includes(kind)) return;

    const members = await getMembers();

    // 현재 담당자 UID 추출 — 모달 본문 안에서 텍스트로 표시되지 않을 수 있어
    // 명시 data attribute가 있으면 우선 사용. 없으면 null로 표시 (서버가 정확한 currentUid 별도 안내해야 함)
    let currentUid = null;
    const meta = modalBody.querySelector('[data-current-assignee-uid]');
    if (meta) currentUid = Number(meta.dataset.currentAssigneeUid) || null;

    const html = renderAssigneeBox(kind, id, members, currentUid);
    if (!html) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const box = wrap.firstElementChild;
    modalBody.insertBefore(box, modalBody.firstChild);

    // 백업 정보 보강
    const backupInfoEl = box.querySelector('[data-assignee-backup-info]');
    const serviceCategory = modalBody.querySelector('[data-service-category]')?.dataset?.serviceCategory || null;
    fetchBackupInfo(kind, serviceCategory).then(backup => {
      if (backup && backupInfoEl) {
        const bMember = members.find(m => Number(m.id || m.uid) === Number(backup.uid));
        const bAway = bMember && bMember.outOfOffice ? ' (부재 중 ⚠️)' : '';
        backupInfoEl.textContent = '백업: ' + (backup.name || ('#' + backup.uid)) + bAway;
      }
    });

    // 카드 링크 (workspaceTaskId가 있으면)
    const taskIdEl = modalBody.querySelector('[data-workspace-task-id]');
    if (taskIdEl) {
      const cardBtn = box.querySelector('[data-assignee-card]');
      const taskId = Number(taskIdEl.dataset.workspaceTaskId);
      if (cardBtn && taskId) {
        cardBtn.style.display = '';
        cardBtn.addEventListener('click', () => {
          location.href = '/workspace-kanban.html#task=' + taskId;
        });
      }
    }

    // 저장 버튼
    const saveBtn = box.querySelector('[data-assignee-save]');
    const sel = box.querySelector('[data-assignee-select]');
    const reasonEl = box.querySelector('[data-assignee-reason]');
    if (saveBtn && sel) {
      saveBtn.addEventListener('click', async () => {
        const newUid = Number(sel.value) || null;
        if (!newUid) {
          toast('변경할 담당자를 선택하세요', 'error');
          return;
        }
        if (Number(newUid) === Number(currentUid)) {
          toast('이미 현재 담당자입니다', 'info');
          return;
        }
        saveBtn.disabled = true;
        try {
          await api('/api/admin-service-assignee', {
            method: 'POST',
            body: {
              serviceKind: kind,
              serviceId: id,
              newAssigneeUid: newUid,
              reason: reasonEl ? reasonEl.value.trim() : ''
            }
          });
          const opt = sel.options[sel.selectedIndex];
          const newName = opt ? opt.textContent.replace(/\s\(부재 중 ⚠️\)$/, '') : '담당자';
          toast(newName + '님께 인계됐어요', 'success');
          // 모달 본문 새로고침 — admin-siren.js가 직접 갱신하지 않으므로 박스 갱신
          // 카드 모달 동기화를 위해 BroadcastChannel 발신
          if (window.WorkspaceSync) {
            WorkspaceSync.notify('task:updated', { serviceKind: kind, serviceId: id });
            WorkspaceSync.notify('notification:new', { serviceKind: kind, serviceId: id });
          }
          // 다시 로드를 위해 모달 다시 열기 트리거 (가능하면)
          if (typeof window.reloadSirenDetail === 'function') {
            try { window.reloadSirenDetail(kind, id); } catch (_) {}
          } else {
            // 백업: 박스만 다시 마운트
            box.remove();
            setTimeout(() => mount(modalBody), 100);
          }
        } catch (err) {
          toast('담당자 변경 실패: ' + err.message, 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }
  }

  // 모달 열림 감지 (admin-siren.js가 .show 클래스 추가)
  function watchModal() {
    const modal = document.getElementById('sirenDetailModal');
    if (!modal) return;
    const body = document.getElementById('srnModalBody');
    if (!body) return;

    // 1) class 변경 감지 (모달 open)
    const classObserver = new MutationObserver(() => {
      if (modal.classList.contains('show')) {
        // 본문 로드가 끝난 뒤(로딩 → 실제 콘텐츠) 박스 마운트 — 본문 변경 감지 별도 처리
      }
    });
    classObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });

    // 2) 본문 자식 변경 감지 (admin-siren.js가 innerHTML 갈아끼울 때)
    const bodyObserver = new MutationObserver(() => {
      // 로딩 텍스트가 사라지고 실제 콘텐츠가 들어왔을 때만 마운트
      if (modal.classList.contains('show') && body.querySelector('.srn-modal-section, .srn-modal-info-grid')) {
        mount(body);
      }
    });
    bodyObserver.observe(body, { childList: true, subtree: false });
  }

  function init() {
    rememberLastClick();
    watchModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
