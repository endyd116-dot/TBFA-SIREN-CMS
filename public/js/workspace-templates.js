/**
 * Phase 3 Step 7-C.4 후속 — 템플릿 관리 페이지
 *
 * 작업 템플릿 CRUD UI. 칸반 새 작업 모달의 셀렉트와 동일한 데이터 소스 사용.
 */
(function () {
  'use strict';

  const STATE = {
    me: null,
    items: [],
    filter: 'all',     // all | shared | mine
    search: '',
  };

  function $(s, root = document) { return root.querySelector(s); }
  function $$(s, root = document) { return Array.from(root.querySelectorAll(s)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toast(msg, type) {
    const root = $('#wtToastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false'); }
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); }
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
    // [감사#17] noAuthRedirect 옵션이면 401에도 리다이렉트하지 않고 throw만 (인증 탐침용)
    if (res.status === 401) { if (!opts.noAuthRedirect) location.href = '/admin.html'; throw new Error('인증 만료'); }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data;
  }

  /* ═══════════════════ 데이터 ═══════════════════ */
  async function loadTemplates() {
    const list = $('#wtList');
    list.innerHTML = '<li class="wt-loading">불러오는 중...</li>';
    try {
      const res = await api('/api/admin-workspace-task-templates?list=1');
      STATE.items = res.data?.items || res.items || [];
      render();
    } catch (err) {
      list.innerHTML = `<li class="wt-empty">로드 실패: ${escapeHtml(err.message)}</li>`;
    }
  }

  function render() {
    const list = $('#wtList');
    let items = STATE.items;
    if (STATE.filter === 'shared') items = items.filter(t => t.isShared);
    else if (STATE.filter === 'mine') items = items.filter(t => STATE.me && t.createdBy === STATE.me.id);

    if (STATE.search) {
      const q = STATE.search.toLowerCase();
      items = items.filter(t =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }

    if (!items.length) {
      list.innerHTML = '<li class="wt-empty">조건에 맞는 템플릿이 없습니다.<br>＋ 새 템플릿 버튼으로 만들어보세요.</li>';
      return;
    }

    list.innerHTML = items.map(renderCard).join('');
    list.querySelectorAll('[data-tmpl-id]').forEach(el => {
      el.addEventListener('click', () => openEdit(Number(el.dataset.tmplId)));
    });
  }

  function renderCard(t) {
    const tags = Array.isArray(t.defaultTags) ? t.defaultTags : [];
    const subN = Array.isArray(t.defaultSubtasks) ? t.defaultSubtasks.length : 0;
    return `
<li class="wt-card wt-priority-${escapeHtml(t.priority || 'normal')}" data-tmpl-id="${t.id}">
  <div class="wt-card-header">
    ${t.isShared
      ? '<span class="wt-card-shared-badge">공유</span>'
      : '<span class="wt-card-private-badge">비공개</span>'}
    <span>${escapeHtml(t.authorName || '')}</span>
  </div>
  <h3 class="wt-card-title">${escapeHtml(t.name || '')}</h3>
  <p class="wt-card-desc">${escapeHtml((t.description || '').slice(0, 200) || '(설명 없음)')}</p>
  <div class="wt-card-meta">
    ${subN > 0 ? `<span>${subN}항목</span>` : ''}
    ${t.estimatedHours ? `<span>${escapeHtml(String(t.estimatedHours))}h</span>` : ''}
    ${tags.slice(0, 3).map(x => `<span class="wt-card-tag">${escapeHtml(x)}</span>`).join('')}
    ${tags.length > 3 ? `<span class="wt-card-tag">+${tags.length - 3}</span>` : ''}
    <span class="wt-card-usage">사용 ${t.usageCount || 0}회</span>
  </div>
</li>`;
  }

  /* ═══════════════════ 편집 모달 ═══════════════════ */
  function openNew() {
    $('#wtEditTitle').textContent = '새 템플릿';
    $('#wtEditId').value = '';
    $('#wtEditName').value = '';
    $('#wtEditDescription').value = '';
    $('#wtEditPriority').value = 'normal';
    $('#wtEditEstHours').value = '';
    $('#wtEditSubtasks').value = '';
    $('#wtEditTags').value = '';
    $('#wtEditShared').checked = true;
    $('#wtEditDelete').style.display = 'none';
    openModal('wtEditModal');
    setTimeout(() => $('#wtEditName').focus(), 50);
  }

  function openEdit(id) {
    const t = STATE.items.find(x => x.id === id);
    if (!t) return;
    const isMine = STATE.me && t.createdBy === STATE.me.id;
    const isSuperAdmin = STATE.me && STATE.me.role === 'super_admin';
    const canEdit = isMine || isSuperAdmin;

    $('#wtEditTitle').textContent = canEdit ? '템플릿 편집' : '템플릿 (조회만)';
    $('#wtEditId').value = String(id);
    $('#wtEditName').value = t.name || '';
    $('#wtEditDescription').value = t.description || '';
    $('#wtEditPriority').value = t.priority || 'normal';
    $('#wtEditEstHours').value = t.estimatedHours == null ? '' : t.estimatedHours;
    const subtasks = Array.isArray(t.defaultSubtasks) ? t.defaultSubtasks : [];
    $('#wtEditSubtasks').value = subtasks.map(s => s.text || '').filter(Boolean).join('\n');
    const tags = Array.isArray(t.defaultTags) ? t.defaultTags : [];
    $('#wtEditTags').value = tags.join(', ');
    $('#wtEditShared').checked = !!t.isShared;

    // 권한 없으면 수정·삭제 버튼 비활성
    const fields = ['wtEditName', 'wtEditDescription', 'wtEditPriority', 'wtEditEstHours', 'wtEditSubtasks', 'wtEditTags', 'wtEditShared'];
    fields.forEach(id => { $('#' + id).disabled = !canEdit; });
    $('#wtEditSave').disabled = !canEdit;
    $('#wtEditSave').style.display = canEdit ? '' : 'none';
    $('#wtEditDelete').style.display = canEdit ? '' : 'none';

    openModal('wtEditModal');
  }

  function collectFormData() {
    const subtasksText = $('#wtEditSubtasks').value.trim();
    const subtasks = subtasksText
      ? subtasksText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(text => ({ text, done: false }))
      : [];
    const tagsText = $('#wtEditTags').value.trim();
    const tags = tagsText
      ? tagsText.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const estHours = $('#wtEditEstHours').value;
    return {
      name: $('#wtEditName').value.trim(),
      description: $('#wtEditDescription').value,
      priority: $('#wtEditPriority').value,
      estimatedHours: estHours === '' ? null : Number(estHours),
      defaultSubtasks: subtasks,
      defaultTags: tags,
      isShared: $('#wtEditShared').checked,
    };
  }

  async function saveTemplate() {
    const id = $('#wtEditId').value;
    const data = collectFormData();
    if (!data.name) { toast('이름 필수', 'error'); return; }

    try {
      if (id) {
        await api(`/api/admin-workspace-task-templates?id=${id}`, { method: 'PATCH', body: data });
        toast('수정됨', 'success');
      } else {
        await api('/api/admin-workspace-task-templates', { method: 'POST', body: data });
        toast('생성됨', 'success');
      }
      closeModal('wtEditModal');
      await loadTemplates();
    } catch (err) {
      toast('저장 실패: ' + err.message, 'error');
    }
  }

  async function deleteTemplate() {
    const id = $('#wtEditId').value;
    if (!id) return;
    const t = STATE.items.find(x => x.id === Number(id));
    if (!confirm(`템플릿 "${t?.name || ''}"을 삭제하시겠습니까? 이미 사용된 작업은 영향 없습니다.`)) return;

    try {
      await api(`/api/admin-workspace-task-templates?id=${id}`, { method: 'DELETE' });
      toast('삭제됨', 'success');
      closeModal('wtEditModal');
      await loadTemplates();
    } catch (err) {
      toast('삭제 실패: ' + err.message, 'error');
    }
  }

  /* ═══════════════════ 사용자 정보 (R35-GAP-P1 H-G1: user JWT 우선 + admin JWT fallback) ═══════════════════ */
  async function loadMe() {
    let me = null;
    try {
      // [감사#17] 인증 탐침은 noAuthRedirect — auth/me 401이어도 즉시 튕기지 않고 admin/me 폴백으로 진행
      const userRes = await api('/api/auth/me', { noAuthRedirect: true });
      if (userRes.ok) me = userRes.data?.data?.user || userRes.data?.data || userRes.data?.user || userRes.data || null;
    } catch (_) {}
    if (!me) {
      try {
        const adminRes = await api('/api/admin/me?light=1', { noAuthRedirect: true });
        if (adminRes.ok) me = adminRes.data?.data?.admin || adminRes.data?.admin || adminRes.data?.data || adminRes.data || null;
      } catch (_) {}
    }
    // [감사#17] 사용자·관리자 인증 둘 다 실패한 경우에만 로그인 페이지로 이동
    if (!me) { location.href = '/admin.html'; return; }
    if (me) {
      // R35-GAP-P2 M-G7: regular 회원은 워크스페이스 부적합
      const isAdmin = me.role === 'admin' || me.role === 'super_admin';
      /* 직원(관리자·운영자)만 통과 — 서버 판정(isAdmin·isOperator)과 계정 종류를 함께 본다.
         운영자 토글 하나로만 보면 토글이 꺼진 관리자가 자기 워크스페이스에서 튕긴다 (2026-07-12) */
      const isStaff = isAdmin || me.isAdmin === true || me.isOperator === true
        || me.type === 'admin' || me.operatorActive === true;
      if (!isStaff) {
        alert('워크스페이스는 운영자(직원)만 사용할 수 있습니다.\n관리자에게 운영자 권한을 요청해 주세요.');
        location.href = '/index.html';
        return;
      }
      STATE.me = me;
      const nameEl = $('#wsSidebarUserName');
      if (nameEl) nameEl.textContent = STATE.me.name || STATE.me.email || '사용자';
    }
  }

  /* ═══════════════════ 이벤트 ═══════════════════ */
  function bind() {
    $('#wtBtnNew')?.addEventListener('click', openNew);
    $('#wtEditSave')?.addEventListener('click', saveTemplate);
    $('#wtEditDelete')?.addEventListener('click', deleteTemplate);
    $('#wtFilter')?.addEventListener('change', e => {
      STATE.filter = e.target.value;
      render();
    });
    let timer;
    $('#wtSearch')?.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        STATE.search = e.target.value.trim();
        render();
      }, 200);
    });

    document.addEventListener('click', e => {
      const close = e.target.closest('[data-close-modal]');
      if (close) closeModal(close.dataset.closeModal);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const m = document.querySelector('.wk-modal.is-open');
        if (m) closeModal(m.id);
      }
    });

    $('#wsBtnLogout')?.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
      location.href = '/admin.html';
    });
  }

  /* ═══════════════════ 초기화 ═══════════════════ */
  async function init() {
    bind();
    await Promise.all([loadMe(), loadTemplates()]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
