/* =========================================================
   admin-service-rnr.js — 서비스별 R&R 매핑 UI
   - 운영자 관리 페이지의 [업무별 R&R] 탭에서 사용
   - GET /api/admin/service-rnr (목록 + 운영자 후보 + canEdit 플래그)
   - PATCH /api/admin/service-rnr (super_admin만 수정)
   2026-05-12 신설
   ========================================================= */
(function () {
  'use strict';

  const API = '/api/admin/service-rnr';
  let STATE = { rows: [], operators: [], canEdit: false, loaded: false };

  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); return; }
    console.info('[rnr]', msg);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function operatorOptions(selectedId) {
    const list = STATE.operators || [];
    const opts = ['<option value="">— 미지정 —</option>'];
    list.forEach(o => {
      const sel = (Number(selectedId) === Number(o.id)) ? ' selected' : '';
      const tag = o.operatorActive ? '' : ' (비활성)';
      opts.push(`<option value="${o.id}"${sel}>${escapeHtml(o.name)}${escapeHtml(tag)} · ${escapeHtml(o.role || '')}</option>`);
    });
    return opts.join('');
  }

  function renderRow(r) {
    const disabled = STATE.canEdit ? '' : 'disabled';
    const updatedAt = r.updatedAt ? new Date(r.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    return `
      <tr data-rnr-id="${r.id}" data-rnr-type="${escapeHtml(r.serviceType)}">
        <td>
          <strong>${escapeHtml(r.serviceLabel || r.serviceType)}</strong>
          <div style="font-size:11px;color:var(--text-3,#888);font-family:Inter;margin-top:2px">${escapeHtml(r.serviceType)}</div>
        </td>
        <td>
          <select class="rnr-input" data-field="primaryAssigneeId" ${disabled}
            style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12.5px">
            ${operatorOptions(r.primaryAssigneeId)}
          </select>
          ${r.primaryAssigneeId && r.primaryActive === false ? '<div style="font-size:10.5px;color:#c5293a;margin-top:2px">⚠️ 현재 비활성 — 백업으로 자동 폴백됩니다</div>' : ''}
        </td>
        <td>
          <select class="rnr-input" data-field="backupAssigneeId" ${disabled}
            style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12.5px">
            ${operatorOptions(r.backupAssigneeId)}
          </select>
        </td>
        <td style="text-align:right">
          <input type="number" class="rnr-input" data-field="slaHours" value="${r.slaHours || ''}" min="0" max="720" ${disabled}
            style="width:70px;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:12.5px;text-align:right">
          <small style="display:block;font-size:10.5px;color:#888;margin-top:2px">시간</small>
        </td>
        <td>
          <div style="font-size:11.5px;color:#666">${updatedAt}</div>
          <div style="font-size:10.5px;color:#999;margin-top:2px">${escapeHtml(r.updatedByName || '—')}</div>
          ${STATE.canEdit ? `<button class="btn-sm btn-sm-primary rnr-save-btn" style="margin-top:5px;padding:4px 10px;font-size:11px">💾 저장</button>` : ''}
        </td>
      </tr>
    `;
  }

  function attachRowEvents(tr, r) {
    if (!STATE.canEdit) return;
    const saveBtn = tr.querySelector('.rnr-save-btn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async () => {
      const body = { id: r.id };
      tr.querySelectorAll('.rnr-input').forEach(el => {
        const f = el.dataset.field;
        const v = el.value;
        if (f === 'slaHours') body[f] = v ? Number(v) : null;
        else body[f] = v ? Number(v) : null;
      });
      saveBtn.disabled = true; saveBtn.textContent = '저장 중...';
      const res = await api(API, { method: 'PATCH', body });
      saveBtn.disabled = false; saveBtn.textContent = '💾 저장';
      if (!res.ok) {
        toast('저장 실패: ' + (res.data?.error || ''));
        return;
      }
      toast('저장되었습니다');
      await loadAll();
    });
  }

  async function loadAll() {
    const tbody = document.getElementById('rnrTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';
    const res = await api(API);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:#c5293a">조회 실패: ${escapeHtml(res.data?.error || '')}</td></tr>`;
      return;
    }
    const data = res.data?.data || res.data;
    STATE.rows = data.list || [];
    STATE.operators = data.operators || [];
    STATE.canEdit = !!data.canEdit;
    STATE.loaded = true;

    if (!STATE.rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-3)">등록된 R&R 매핑이 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = STATE.rows.map(renderRow).join('');
    STATE.rows.forEach(r => {
      const tr = tbody.querySelector(`tr[data-rnr-id="${r.id}"]`);
      if (tr) attachRowEvents(tr, r);
    });

    if (!STATE.canEdit) {
      const note = document.createElement('tr');
      note.innerHTML = `<td colspan="5" style="background:#fef9f5;padding:9px 12px;font-size:12px;color:#7a5e00">🔒 super_admin만 수정 가능합니다 (현재 읽기 전용)</td>`;
      tbody.appendChild(note);
    }
  }

  /* ─────── 탭 전환 hook ─────── */
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-optab]');
    if (!tab) return;
    /* 동일 컨테이너 안의 탭들만 전환 */
    const container = tab.closest('#adm-operators');
    if (!container) return;
    const key = tab.getAttribute('data-optab');
    container.querySelectorAll('[data-optab]').forEach(t => t.classList.remove('on'));
    tab.classList.add('on');
    container.querySelectorAll('[data-optab-pane]').forEach(p => p.style.display = 'none');
    const pane = container.querySelector(`[data-optab-pane="${key}"]`);
    if (pane) pane.style.display = '';
    if (key === 'rnr' && !STATE.loaded) loadAll();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#rnrBtnReload')) { e.preventDefault(); loadAll(); }
  });

  /* 외부 호출용 */
  window.SIREN_RNR = { loadAll };
})();
