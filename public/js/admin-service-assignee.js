/* =========================================================
   admin-service-assignee.js — 서비스 상세 담당자 변경 UI
   - 4개 서비스 상세(SIREN-사건/악성민원/법률 + 유족지원)에서 공용
   - 인라인 박스 마운트 + 변경 모달 + 양방향 동기화 (서버: /api/admin/service-assignee)
   2026-05-12 신설
   ========================================================= */
(function () {
  'use strict';

  const API = '/api/admin/service-assignee';

  /* ─────── CSS 자동 주입 ─────── */
  (function injectCss() {
    if (document.getElementById('asg-ui-css')) return;
    const css = `
      .asg-box { border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;background:#fafbfc;margin:10px 0;font-size:13px }
      .asg-box-head { display:flex;justify-content:space-between;align-items:center;margin-bottom:10px }
      .asg-box-title { font-weight:700;font-size:13px;color:#1f2937;display:flex;align-items:center;gap:6px }
      .asg-current { display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px }
      .asg-avatar { width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#7a1f2b,#a3303f);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0 }
      .asg-info { flex:1;min-width:0 }
      .asg-name { font-weight:700;font-size:13.5px;color:#111827 }
      .asg-meta { font-size:11.5px;color:#6b7280;margin-top:1px }
      .asg-empty { color:#9ca3af;font-style:italic;font-size:12.5px }
      .asg-btn-change { padding:6px 12px;font-size:11.5px;background:#7a1f2b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;flex-shrink:0 }
      .asg-btn-change:hover { background:#5a141d }
      .asg-link-task { display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:#1a5ec4;text-decoration:none;margin-top:6px }
      .asg-link-task:hover { text-decoration:underline }
      /* 모달 */
      .asg-overlay { position:fixed;inset:0;z-index:10001;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;padding:60px 16px 16px;animation:asgFade .15s ease-out }
      @keyframes asgFade { from{opacity:0} to{opacity:1} }
      .asg-modal { background:#fff;border-radius:12px;width:100%;max-width:480px;box-shadow:0 20px 50px rgba(0,0,0,.25);overflow:hidden }
      .asg-modal-head { background:linear-gradient(135deg,#7a1f2b,#a3303f);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center }
      .asg-modal-head h3 { margin:0;font-size:15px;font-weight:700 }
      .asg-modal-close { background:rgba(255,255,255,.18);border:none;color:#fff;width:28px;height:28px;border-radius:5px;cursor:pointer;font-size:18px }
      .asg-modal-body { padding:18px 20px }
      .asg-modal-body label { display:block;font-weight:600;font-size:12.5px;margin:8px 0 5px;color:#374151 }
      .asg-modal-body select, .asg-modal-body textarea, .asg-modal-body input { width:100%;padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font-size:13.5px;box-sizing:border-box;font-family:inherit }
      .asg-modal-foot { padding:12px 20px;border-top:1px solid #f0f0f0;display:flex;justify-content:flex-end;gap:8px }
      .asg-modal-foot button { padding:8px 16px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:inherit }
      .asg-modal-foot .primary { background:#7a1f2b;color:#fff }
      .asg-modal-foot .ghost { background:#f3f4f6;color:#374151 }
      .asg-note { background:#f0f7ff;border:1px solid #c5daf5;padding:8px 11px;border-radius:6px;font-size:11.5px;color:#1a5ec4;line-height:1.5;margin-bottom:12px }
    `;
    const style = document.createElement('style');
    style.id = 'asg-ui-css';
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
    if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); return; }
    console.info('[asg]', msg);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function initial(name) { return (name || '?').trim().charAt(0); }

  /* ─────── 서비스 라벨 ─────── */
  const SERVICE_LABEL = {
    incident_report:    '🚨 SIREN-사건',
    harassment_report:  '⚠️ SIREN-악성민원',
    legal_consultation: '⚖️ SIREN-법률',
    support_request:    '🎗 유족지원',
  };

  /* ─────── 인라인 박스 렌더 (서비스 상세 안 어디든 마운트) ─────── */
  async function renderInline(container, serviceType, sourceId) {
    if (!container) return;
    container.innerHTML = '<div class="asg-box"><div class="asg-empty">담당자 정보를 불러오는 중...</div></div>';
    const res = await api(`${API}?serviceType=${encodeURIComponent(serviceType)}&sourceId=${sourceId}`);
    if (!res.ok) {
      container.innerHTML = `<div class="asg-box"><div class="asg-empty" style="color:#c5293a">담당자 조회 실패: ${escapeHtml(res.data?.error || '')}</div></div>`;
      return;
    }
    const d = res.data?.data || res.data;
    const assignee = d.assignee;
    const taskId = d.workspaceTaskId;

    container.innerHTML = `
      <div class="asg-box" data-asg-service="${escapeHtml(serviceType)}" data-asg-id="${sourceId}">
        <div class="asg-box-head">
          <span class="asg-box-title">🎯 담당자 (${escapeHtml(SERVICE_LABEL[serviceType] || serviceType)})</span>
          <button type="button" class="asg-btn-change">변경</button>
        </div>
        ${assignee ? `
          <div class="asg-current">
            <div class="asg-avatar">${escapeHtml(initial(assignee.name))}</div>
            <div class="asg-info">
              <div class="asg-name">${escapeHtml(assignee.name)}
                ${assignee.operatorActive ? '' : '<small style="color:#c5293a;margin-left:4px">(비활성)</small>'}
              </div>
              <div class="asg-meta">${escapeHtml(assignee.email || '')} · ${escapeHtml(assignee.role || '')}</div>
            </div>
          </div>
        ` : `
          <div class="asg-current">
            <div class="asg-avatar" style="background:#9ca3af">?</div>
            <div class="asg-info"><span class="asg-empty">담당자 미지정 — R&R 매핑에 주 담당자가 없거나 매핑 전입니다</span></div>
          </div>
        `}
        ${taskId ? `
          <a class="asg-link-task" href="/workspace-kanban.html?taskId=${taskId}" onclick="window.location.href='/workspace-kanban.html?taskId=${taskId}';return false;">
            📋 워크스페이스 카드 #${taskId} 열기 →
          </a>` : ''}
      </div>
    `;
    container.querySelector('.asg-btn-change').addEventListener('click', () => {
      openChangeModal(serviceType, sourceId, () => renderInline(container, serviceType, sourceId));
    });
  }

  /* ─────── 변경 모달 ─────── */
  async function openChangeModal(serviceType, sourceId, onSuccess) {
    const res = await api(`${API}?serviceType=${encodeURIComponent(serviceType)}&sourceId=${sourceId}`);
    if (!res.ok) { toast('정보 조회 실패: ' + (res.data?.error || '')); return; }
    const d = res.data?.data || res.data;
    const ops = d.operators || [];
    const cur = d.assignee?.id;

    const opts = ['<option value="">— 선택 —</option>']
      .concat(ops.map(o => {
        const tag = o.operatorActive ? '' : ' (비활성)';
        const sel = Number(cur) === Number(o.id) ? ' selected disabled' : '';
        return `<option value="${o.id}"${sel}>${escapeHtml(o.name)}${escapeHtml(tag)} · ${escapeHtml(o.role || '')}</option>`;
      }))
      .join('');

    const ov = document.createElement('div');
    ov.className = 'asg-overlay';
    ov.innerHTML = `
      <div class="asg-modal">
        <div class="asg-modal-head">
          <h3>🎯 ${escapeHtml(SERVICE_LABEL[serviceType] || serviceType)} #${sourceId} — 담당자 변경</h3>
          <button class="asg-modal-close" data-asg-close>×</button>
        </div>
        <div class="asg-modal-body">
          <div class="asg-note">
            담당자를 변경하면 <strong>워크스페이스 카드</strong>와 <strong>이 서비스 상세</strong> 양쪽이 동시에 갱신되고,
            새 담당자에게 알림이 자동 발송됩니다. 토스 이력에도 한 줄 남습니다.
          </div>
          <label>새 담당자 (운영자만)</label>
          <select id="asgNew">${opts}</select>
          <label>변경 메시지 (선택)</label>
          <textarea id="asgMsg" rows="3" placeholder="인계 사유, 현재 진행 상황, 특이사항 등"></textarea>
        </div>
        <div class="asg-modal-foot">
          <button class="ghost" data-asg-close>취소</button>
          <button class="primary" id="asgSubmit">변경 실행</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    function close() {
      ov.remove();
      document.body.style.overflow = '';
    }
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.matches('[data-asg-close]')) close();
    });

    ov.querySelector('#asgSubmit').addEventListener('click', async () => {
      const newAssigneeId = Number(ov.querySelector('#asgNew').value);
      if (!newAssigneeId) { toast('새 담당자를 선택하세요'); return; }
      const message = String(ov.querySelector('#asgMsg').value || '').trim();
      const btn = ov.querySelector('#asgSubmit');
      btn.disabled = true; btn.textContent = '변경 중...';
      const r = await api(API, {
        method: 'POST',
        body: { serviceType, sourceId, newAssigneeId, message: message || null },
      });
      btn.disabled = false; btn.textContent = '변경 실행';
      if (!r.ok) { toast('변경 실패: ' + (r.data?.error || '')); return; }
      toast(r.data?.message || '담당자가 변경되었습니다');
      close();
      if (typeof onSuccess === 'function') onSuccess();
    });
  }

  /* ─────── 자동 마운트 — data-asg-mount 속성 가진 요소 자동 처리 ─────── */
  function autoMountAll() {
    document.querySelectorAll('[data-asg-mount]').forEach(el => {
      const t = el.dataset.asgServiceType;
      const id = Number(el.dataset.asgSourceId);
      if (t && Number.isFinite(id) && !el.dataset.asgMounted) {
        el.dataset.asgMounted = '1';
        renderInline(el, t, id);
      }
    });
  }

  /* MutationObserver — 동적으로 추가되는 detail 모달의 마운트 포인트도 자동 처리 */
  function startObserver() {
    if (window._asgObs) return;
    window._asgObs = new MutationObserver(() => autoMountAll());
    window._asgObs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    autoMountAll();
    startObserver();
  });
  if (document.readyState !== 'loading') {
    autoMountAll();
    startObserver();
  }

  /* 외부 호출용 — 4개 서비스 detail JS에서 직접 호출 가능 */
  window.SIREN_ASSIGNEE = {
    renderInline,
    openChangeModal,
  };
})();
