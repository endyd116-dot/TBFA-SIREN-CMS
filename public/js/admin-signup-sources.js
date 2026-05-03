/* =========================================================
   SIREN — admin-signup-sources.js (★ Phase M-12)
   가입 경로 CRUD 전용 모듈
   ========================================================= */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg, ms) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg, ms);
    alert(msg);
  }
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

  const PROTECTED_CODES = ['website', 'admin', 'hyosung_csv'];

  async function loadList() {
    const tbody = document.getElementById('ssTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>';

    const res = await api('/api/admin/signup-sources?includeInactive=1');
    if (!res.ok || !res.data?.data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--danger)">조회 실패</td></tr>';
      return;
    }

    const list = res.data.data.list || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3)">등록된 가입 경로가 없습니다</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((s) => {
      const isProtected = PROTECTED_CODES.includes(s.code);
      const protectedMark = isProtected ? '<span style="color:#c47a00;font-size:10.5px;margin-left:4px" title="시스템 기본">🔒</span>' : '';
      const activeIcon = s.isActive
        ? '<span class="cm-inline-active on" data-ss-toggle="' + s.id + '" data-current="true" title="클릭하여 비활성화">●</span>'
        : '<span class="cm-inline-active off" data-ss-toggle="' + s.id + '" data-current="false" title="클릭하여 활성화">○</span>';
      const memberCount = s.memberCount || 0;
      const memberCountStyle = memberCount > 0 ? 'color:var(--brand);font-weight:700' : 'color:var(--text-3)';

      const deleteDisabled = isProtected || memberCount > 0;
      const deleteBtn = deleteDisabled
        ? `<button class="delete" disabled title="${isProtected ? '시스템 기본 항목은 삭제 불가' : '사용 중인 회원이 있어 삭제 불가'}">🗑 삭제</button>`
        : `<button class="delete" data-ss-action="delete" data-ss-id="${s.id}" data-ss-label="${escapeHtml(s.label)}">🗑 삭제</button>`;

      return `<tr>
        <td style="text-align:center;font-family:Inter;font-size:12px">${s.sortOrder || 0}</td>
        <td>
          <span style="font-family:Inter,monospace;font-size:12px;background:var(--bg-soft);padding:3px 8px;border-radius:4px">${escapeHtml(s.code)}</span>
          ${protectedMark}
        </td>
        <td><strong>${escapeHtml(s.label)}</strong></td>
        <td style="font-size:12px;color:var(--text-3);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s.description || '')}">${escapeHtml(s.description || '—')}</td>
        <td style="text-align:right;${memberCountStyle}">${memberCount.toLocaleString()}명</td>
        <td style="text-align:center">${activeIcon}</td>
        <td><div class="cm-row-actions">
          <button class="edit" data-ss-action="edit" data-ss-id="${s.id}">✏️ 수정</button>
          ${deleteBtn}
        </div></td>
      </tr>`;
    }).join('');
  }

  async function openEditModal(id) {
    const modal = document.getElementById('signupSourceEditModal');
    if (!modal) return;

    const titleEl = document.getElementById('ssModalTitle');
    const idEl = document.getElementById('ssId');
    const codeEl = document.getElementById('ssCode');
    const labelEl = document.getElementById('ssLabel');
    const descEl = document.getElementById('ssDescription');
    const sortEl = document.getElementById('ssSortOrder');
    const activeEl = document.getElementById('ssIsActive');
    const codeProtectedMsg = document.getElementById('ssCodeProtected');

    if (!id) {
      if (titleEl) titleEl.textContent = '🚪 새 가입 경로 추가';
      if (idEl) idEl.value = '';
      if (codeEl) { codeEl.value = ''; codeEl.readOnly = false; codeEl.style.background = ''; }
      if (labelEl) labelEl.value = '';
      if (descEl) descEl.value = '';
      if (sortEl) sortEl.value = '50';
      if (activeEl) activeEl.checked = true;
      if (codeProtectedMsg) codeProtectedMsg.style.display = 'none';
      modal.classList.add('show');
      setTimeout(() => codeEl?.focus(), 100);
      return;
    }

    if (titleEl) titleEl.textContent = '✏️ 가입 경로 수정';
    modal.classList.add('show');

    const res = await api('/api/admin/signup-sources?includeInactive=1');
    if (!res.ok || !res.data?.data?.list) {
      toast('데이터를 불러오지 못했습니다');
      modal.classList.remove('show');
      return;
    }
    const target = res.data.data.list.find((s) => s.id === id);
    if (!target) {
      toast('항목을 찾을 수 없습니다');
      modal.classList.remove('show');
      return;
    }

    if (idEl) idEl.value = String(target.id);
    if (codeEl) codeEl.value = target.code || '';
    if (labelEl) labelEl.value = target.label || '';
    if (descEl) descEl.value = target.description || '';
    if (sortEl) sortEl.value = String(target.sortOrder || 0);
    if (activeEl) activeEl.checked = target.isActive !== false;

    const isProtected = PROTECTED_CODES.includes(target.code);
    if (codeEl) {
      codeEl.readOnly = isProtected;
      codeEl.style.background = isProtected ? 'var(--bg-soft)' : '';
    }
    if (codeProtectedMsg) codeProtectedMsg.style.display = isProtected ? 'block' : 'none';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('ssId').value;
    const code = (document.getElementById('ssCode').value || '').trim().toLowerCase();
    const label = (document.getElementById('ssLabel').value || '').trim();
    const description = (document.getElementById('ssDescription').value || '').trim();
    const sortOrder = Number(document.getElementById('ssSortOrder').value) || 0;
    const isActive = document.getElementById('ssIsActive').checked;

    if (!code) return toast('코드를 입력해 주세요');
    if (!/^[a-z0-9_-]+$/.test(code)) return toast('코드는 영문 소문자/숫자/_/- 만 가능합니다');
    if (!label) return toast('라벨을 입력해 주세요');

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const oldText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '저장 중...'; }

    try {
      const body = { code, label, description, sortOrder, isActive };
      let res;
      if (id) {
        body.id = Number(id);
        res = await api('/api/admin/signup-sources', { method: 'PATCH', body });
      } else {
        res = await api('/api/admin/signup-sources', { method: 'POST', body });
      }

      if (res.ok) {
        toast(res.data?.message || '저장되었습니다');
        document.getElementById('signupSourceEditModal').classList.remove('show');
        loadList();
      } else {
        toast(res.data?.error || '저장 실패');
      }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = oldText; }
    }
  }

  async function toggleActive(id, currentVal) {
    const newVal = !currentVal;
    const res = await api('/api/admin/signup-sources', {
      method: 'PATCH',
      body: { id, isActive: newVal },
    });
    if (res.ok) {
      toast(newVal ? '활성화되었습니다' : '비활성화되었습니다');
      loadList();
    } else {
      toast(res.data?.error || '변경 실패');
    }
  }

  async function deleteSource(id, label) {
    if (!confirm(`가입 경로를 삭제하시겠습니까?\n\n"${label}"\n\n※ 사용 중인 회원이 있으면 거부됩니다.`)) return;
    const res = await api('/api/admin/signup-sources?id=' + id, { method: 'DELETE' });
    if (res.ok) {
      toast('삭제되었습니다');
      loadList();
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  function setupEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btnAddSignupSource')) {
        e.preventDefault();
        openEditModal(null);
        return;
      }

      const btn = e.target.closest('[data-ss-action]');
      if (btn) {
        e.preventDefault();
        const action = btn.dataset.ssAction;
        const id = Number(btn.dataset.ssId);
        if (action === 'edit' && id) openEditModal(id);
        else if (action === 'delete' && id) deleteSource(id, btn.dataset.ssLabel || '');
        return;
      }

      const toggleEl = e.target.closest('[data-ss-toggle]');
      if (toggleEl) {
        e.preventDefault();
        const id = Number(toggleEl.dataset.ssToggle);
        const current = toggleEl.dataset.current === 'true';
        if (id) toggleActive(id, current);
        return;
      }
    });

    const form = document.getElementById('signupSourceEditForm');
    if (form) form.addEventListener('submit', handleSubmit);
  }

  /* ============ 외부 노출 ============ */
  window.SIREN_ADMIN_SIGNUP_SOURCES = {
    loadList,
    openEditModal,
  };

  /* ============ 초기화 ============ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEvents);
  } else {
    setupEvents();
  }
})();