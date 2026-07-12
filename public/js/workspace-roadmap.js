/**
 * workspace-roadmap.js — 사업 로드맵 (목표·단계) — 2026-07-02
 *
 * 목표(Objective)와 단계(Phase)를 리스트·타임라인(간트)으로 표시.
 * 슈퍼어드민·어드민 편집(생성/수정/삭제), 오퍼레이터 열람.
 * API: /api/admin-roadmap (GET 목록, POST 생성, PATCH 수정, DELETE 삭제)
 */
(function () {
  'use strict';

  const STATE = {
    me: null,
    canEdit: false,
    view: 'list',          // list | timeline
    statusFilter: '',
    objectives: [],        // [{...obj, phases:[...]}]
  };

  // 색상 이름 → HEX
  const COLORS = {
    indigo: '#4f46e5', blue: '#2563eb', green: '#16a34a', amber: '#d97706',
    rose: '#e11d48', teal: '#0d9488', slate: '#64748b',
  };
  const colorHex = (c) => COLORS[c] || COLORS.indigo;

  const OBJ_STATUS_LABEL = { planned: '예정', active: '진행중', done: '완료', paused: '보류', cancelled: '취소' };
  const PHASE_STATUS_LABEL = { planned: '예정', in_progress: '진행중', done: '완료', blocked: '막힘' };

  function $(s, root = document) { return root.querySelector(s); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  function toast(msg, type) {
    const root = $('#rmToastRoot');
    if (!root) { alert(msg); return; }
    const el = document.createElement('div');
    el.className = 'wk-toast' + (type === 'success' ? ' is-success' : type === 'error' ? ' is-error' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3200);
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

  function fmtDate(d) {
    if (!d) return '';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    return `${Number(m)}/${Number(day)}`;
  }
  function fmtDateFull(d) {
    if (!d) return '미정';
    return String(d).slice(0, 10).replace(/-/g, '.');
  }

  /* ═══════════════ 사용자 정보 ═══════════════ */
  async function loadMe() {
    let me = null;
    try {
      // [감사#17] 인증 탐침은 noAuthRedirect — auth/me 401이어도 즉시 튕기지 않고 admin/me 폴백으로 진행
      const r = await api('/api/auth/me', { noAuthRedirect: true });
      if (r.ok) me = r.data?.data?.user || r.data?.data || r.data?.user || r.data || null;
    } catch (_) {}
    if (!me) {
      try {
        const r = await api('/api/admin/me?light=1', { noAuthRedirect: true });
        if (r.ok) me = r.data?.data?.admin || r.data?.admin || r.data?.data || r.data || null;
      } catch (_) {}
    }
    // [감사#17] 사용자·관리자 인증 둘 다 실패한 경우에만 로그인 페이지로 이동
    if (!me) { location.href = '/admin.html'; return; }
    if (me) {
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
      if (nameEl) nameEl.textContent = me.name || me.email || '사용자';
    }
  }

  /* ═══════════════ 데이터 로드 ═══════════════ */
  async function load() {
    $('#rmLoading').style.display = '';
    $('#rmListView').style.display = 'none';
    $('#rmTimelineView').style.display = 'none';
    try {
      const params = new URLSearchParams();
      if (STATE.statusFilter) params.set('status', STATE.statusFilter);
      const res = await api(`/api/admin-roadmap?${params}`);
      const payload = res.data || {};
      STATE.objectives = payload.items || [];
      STATE.canEdit = !!payload.canEdit;
      document.body.classList.toggle('can-edit', STATE.canEdit);
    } catch (err) {
      console.error('[roadmap] load 실패:', err);
      toast('로드맵을 불러오지 못했습니다: ' + err.message, 'error');
      STATE.objectives = [];
    }
    $('#rmLoading').style.display = 'none';
    render();
  }

  function render() {
    if (STATE.view === 'timeline') { $('#rmListView').style.display = 'none'; $('#rmTimelineView').style.display = ''; renderTimeline(); }
    else { $('#rmTimelineView').style.display = 'none'; $('#rmListView').style.display = ''; renderList(); }
  }

  /* ═══════════════ 리스트(카드) 뷰 ═══════════════ */
  function renderList() {
    const root = $('#rmListView');
    if (!STATE.objectives.length) {
      root.innerHTML = `<div class="rm-empty">등록된 사업 목표가 없습니다.${STATE.canEdit ? '<br>우측 상단 <b>＋ 새 목표</b>로 첫 목표를 등록하세요.' : ''}</div>`;
      return;
    }
    root.innerHTML = STATE.objectives.map(o => objCardHtml(o)).join('');
  }

  function objCardHtml(o) {
    const hex = colorHex(o.color);
    const phases = o.phases || [];
    const statusLabel = OBJ_STATUS_LABEL[o.status] || o.status;
    const metaBits = [];
    if (o.ownerName) metaBits.push(`${escapeHtml(o.ownerName)}`);
    if (o.startDate || o.targetDate) metaBits.push(`${fmtDateFull(o.startDate)} → ${fmtDateFull(o.targetDate)}`);
    metaBits.push(`단계 ${phases.length}개`);

    const phasesHtml = phases.length ? `
      <div class="rm-phases">
        ${phases.map(p => phaseRowHtml(p, hex)).join('')}
        ${STATE.canEdit ? `<div class="rm-addphase editonly"><button class="rm-btn rm-btn-ghost rm-btn-sm" data-add-phase="${o.id}" type="button">＋ 단계 추가</button></div>` : ''}
      </div>` : (STATE.canEdit ? `<div class="rm-phases"><div class="rm-addphase editonly"><button class="rm-btn rm-btn-ghost rm-btn-sm" data-add-phase="${o.id}" type="button">＋ 단계 추가</button></div></div>` : '');

    return `
    <article class="rm-obj" style="--obj-color:${hex}" data-obj-id="${o.id}">
      <div class="rm-obj-head">
        <div class="rm-obj-main">
          <div class="rm-obj-titlerow">
            <h3 class="rm-obj-title">${escapeHtml(o.title)}</h3>
            ${o.category ? `<span class="rm-badge rm-cat">${escapeHtml(o.category)}</span>` : ''}
            <span class="rm-badge st-${o.status}">${statusLabel}</span>
          </div>
          <div class="rm-obj-meta">${metaBits.join('')}</div>
          ${o.description ? `<p class="rm-obj-desc">${escapeHtml(o.description)}</p>` : ''}
          <div class="rm-progress" title="진행률 ${o.progress}%"><i style="width:${o.progress}%"></i></div>
          <div class="rm-progress-label">진행률 ${o.progress}%</div>
        </div>
        <div class="rm-obj-actions editonly">
          <button class="rm-btn rm-btn-ghost rm-btn-sm" data-edit-obj="${o.id}" type="button">수정</button>
        </div>
      </div>
      ${phasesHtml}
    </article>`;
  }

  function phaseRowHtml(p, objHex) {
    const hex = p.color ? colorHex(p.color) : objHex;
    const statusLabel = PHASE_STATUS_LABEL[p.status] || p.status;
    return `
    <div class="rm-phase" data-phase-id="${p.id}">
      <span class="rm-phase-dot" style="--ph-color:${hex}"></span>
      <div class="rm-phase-main">
        <div class="rm-phase-title">${escapeHtml(p.title)} <span class="rm-badge st-${p.status}" style="font-size:10px">${statusLabel}</span></div>
        <div class="rm-phase-dates">${fmtDateFull(p.startDate)} ~ ${fmtDateFull(p.endDate)}</div>
      </div>
      <div class="rm-phase-mini">
        <div class="rm-progress-label" style="margin:0">${p.progress}%</div>
        <div class="rm-progress" style="--obj-color:${hex}"><i style="width:${p.progress}%"></i></div>
      </div>
      <div class="rm-phase-actions editonly">
        <button class="rm-btn rm-btn-ghost rm-btn-sm" data-edit-phase="${p.id}" data-obj="${p.objectiveId}" type="button"></button>
      </div>
    </div>`;
  }

  /* ═══════════════ 타임라인(간트) 뷰 ═══════════════ */
  function renderTimeline() {
    const root = $('#rmTimelineView');
    if (!STATE.objectives.length) {
      root.innerHTML = `<div class="rm-empty">표시할 목표가 없습니다.</div>`;
      return;
    }

    // 전체 날짜 범위 계산
    let min = null, max = null;
    const consider = (d) => {
      if (!d) return;
      const t = new Date(String(d).slice(0, 10) + 'T00:00:00');
      if (isNaN(t)) return;
      if (min === null || t < min) min = t;
      if (max === null || t > max) max = t;
    };
    STATE.objectives.forEach(o => {
      consider(o.startDate); consider(o.targetDate);
      (o.phases || []).forEach(p => { consider(p.startDate); consider(p.endDate); });
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    consider(today.toISOString().slice(0, 10));
    if (!min || !max) { root.innerHTML = `<div class="rm-empty">기간이 설정된 목표·단계가 없습니다. 날짜를 입력하면 타임라인에 표시됩니다.</div>`; return; }

    // 월 경계로 확장
    const rangeStart = new Date(min.getFullYear(), min.getMonth(), 1);
    const rangeEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    const totalMs = rangeEnd - rangeStart || 1;
    const pct = (d) => {
      const t = new Date(String(d).slice(0, 10) + 'T00:00:00');
      return Math.max(0, Math.min(100, ((t - rangeStart) / totalMs) * 100));
    };

    // 월 헤더
    const months = [];
    let cur = new Date(rangeStart);
    while (cur <= rangeEnd) { months.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
    const monthsHtml = months.map(m => `<div class="rm-tl-month">${m.getFullYear()}.${String(m.getMonth() + 1).padStart(2, '0')}</div>`).join('');
    const todayPct = pct(today.toISOString().slice(0, 10));

    // 행 렌더 (목표 바 + 하위 단계 바)
    const rowsHtml = STATE.objectives.map(o => {
      const hex = colorHex(o.color);
      const objBar = (o.startDate && o.targetDate)
        ? `<div class="rm-tl-bar is-obj" style="--obj-color:${hex};left:${pct(o.startDate)}%;width:${Math.max(1, pct(o.targetDate) - pct(o.startDate))}%" title="${escapeHtml(o.title)} (${o.progress}%)">${escapeHtml(o.title)} · ${o.progress}%</div>`
        : `<div style="padding:11px 8px;font-size:11px;color:#9ca3af">기간 미설정</div>`;
      const objRow = `
        <div class="rm-tl-row" data-obj-id="${o.id}">
          <div class="rm-tl-label"><div class="t">${escapeHtml(o.title)}</div><div class="s">${OBJ_STATUS_LABEL[o.status] || ''} · 진행률 ${o.progress}%</div></div>
          <div class="rm-tl-track">${objBar}</div>
        </div>`;
      const phaseRows = (o.phases || []).map(p => {
        const phHex = p.color ? colorHex(p.color) : hex;
        return `
        <div class="rm-tl-row" data-phase-id="${p.id}">
          <div class="rm-tl-label" style="padding-left:28px"><div class="t" style="font-weight:600;font-size:12px">↳ ${escapeHtml(p.title)}</div><div class="s">${PHASE_STATUS_LABEL[p.status] || ''} · ${p.progress}%</div></div>
          <div class="rm-tl-track">
            <div class="rm-tl-bar" style="background:${phHex};left:${pct(p.startDate)}%;width:${Math.max(1, pct(p.endDate) - pct(p.startDate))}%" title="${escapeHtml(p.title)} ${fmtDate(p.startDate)}~${fmtDate(p.endDate)}">${escapeHtml(p.title)}</div>
          </div>
        </div>`;
      }).join('');
      return objRow + phaseRows;
    }).join('');

    root.innerHTML = `
      <div class="rm-timeline">
        <div class="rm-tl-head">
          <div class="rm-tl-labelcol">목표 / 단계</div>
          <div class="rm-tl-months" style="position:relative">
            ${monthsHtml}
            <div class="rm-tl-today" style="left:${todayPct}%" title="오늘"></div>
          </div>
        </div>
        <div style="position:relative">
          ${rowsHtml}
        </div>
      </div>
      <p style="font-size:11.5px;color:#9ca3af;margin:10px 2px">빨간 선 = 오늘 · 막대 클릭 시 수정(편집 권한 필요)</p>`;
  }

  /* ═══════════════ 목표 모달 ═══════════════ */
  function openModal(id) { const m = $('#' + id); if (m) { m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false'); } }
  function closeModal(id) { const m = $('#' + id); if (m) { m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); } }

  function openObjModal(obj) {
    $('#rmObjModalTitle').textContent = obj ? '목표 수정' : '새 목표';
    $('#rmObjId').value = obj ? obj.id : '';
    $('#rmObjTitle').value = obj ? obj.title : '';
    $('#rmObjCategory').value = obj ? (obj.category || '') : '';
    $('#rmObjStatus').value = obj ? obj.status : 'active';
    $('#rmObjStart').value = obj && obj.startDate ? String(obj.startDate).slice(0, 10) : '';
    $('#rmObjTarget').value = obj && obj.targetDate ? String(obj.targetDate).slice(0, 10) : '';
    $('#rmObjOwner').value = obj ? (obj.ownerName || '') : '';
    $('#rmObjColor').value = obj ? (obj.color || 'indigo') : 'indigo';
    const prog = obj ? (obj.phaseCount ? 0 : obj.progress) : 0;
    $('#rmObjProgress').value = prog;
    $('#rmObjProgressVal').textContent = prog + '%';
    $('#rmObjDesc').value = obj ? (obj.description || '') : '';
    // 단계가 있으면 진행률은 자동 집계이므로 수동 입력 숨김
    $('#rmObjProgressWrap').style.display = (obj && obj.phaseCount) ? 'none' : '';
    $('#rmObjDeleteBtn').style.display = obj ? '' : 'none';
    openModal('rmObjModal');
  }

  async function saveObj() {
    const id = $('#rmObjId').value;
    const title = $('#rmObjTitle').value.trim();
    if (!title) { toast('목표명을 입력하세요', 'error'); return; }
    const body = {
      resource: 'objective',
      title,
      category: $('#rmObjCategory').value.trim() || null,
      status: $('#rmObjStatus').value,
      startDate: $('#rmObjStart').value || null,
      targetDate: $('#rmObjTarget').value || null,
      ownerName: $('#rmObjOwner').value.trim() || null,
      color: $('#rmObjColor').value,
      description: $('#rmObjDesc').value.trim() || null,
    };
    if ($('#rmObjProgressWrap').style.display !== 'none') body.progress = Number($('#rmObjProgress').value) || 0;
    // 시작/목표일 검증
    if (body.startDate && body.targetDate && body.targetDate < body.startDate) { toast('목표 완료일이 시작일보다 빠를 수 없습니다', 'error'); return; }
    try {
      if (id) await api(`/api/admin-roadmap?id=${id}`, { method: 'PATCH', body });
      else await api('/api/admin-roadmap', { method: 'POST', body });
      closeModal('rmObjModal');
      toast(id ? '목표를 수정했습니다' : '목표를 생성했습니다', 'success');
      broadcast();
      await load();
    } catch (err) { toast('저장 실패: ' + err.message, 'error'); }
  }

  async function deleteObj() {
    const id = $('#rmObjId').value;
    if (!id) return;
    if (!confirm('이 목표와 하위 단계가 모두 삭제됩니다. 계속할까요?')) return;
    try {
      await api(`/api/admin-roadmap?id=${id}&resource=objective`, { method: 'DELETE' });
      closeModal('rmObjModal');
      toast('목표를 삭제했습니다', 'success');
      broadcast();
      await load();
    } catch (err) { toast('삭제 실패: ' + err.message, 'error'); }
  }

  /* ═══════════════ 단계 모달 ═══════════════ */
  function openPhaseModal(objId, phase) {
    $('#rmPhaseModalTitle').textContent = phase ? '단계 수정' : '새 단계';
    $('#rmPhaseId').value = phase ? phase.id : '';
    $('#rmPhaseObjId').value = objId;
    $('#rmPhaseTitle').value = phase ? phase.title : '';
    $('#rmPhaseStart').value = phase && phase.startDate ? String(phase.startDate).slice(0, 10) : '';
    $('#rmPhaseEnd').value = phase && phase.endDate ? String(phase.endDate).slice(0, 10) : '';
    $('#rmPhaseStatus').value = phase ? phase.status : 'planned';
    const prog = phase ? phase.progress : 0;
    $('#rmPhaseProgress').value = prog;
    $('#rmPhaseProgressVal').textContent = prog + '%';
    $('#rmPhaseDesc').value = phase ? (phase.description || '') : '';
    $('#rmPhaseDeleteBtn').style.display = phase ? '' : 'none';
    openModal('rmPhaseModal');
  }

  async function savePhase() {
    const id = $('#rmPhaseId').value;
    const objectiveId = Number($('#rmPhaseObjId').value);
    const title = $('#rmPhaseTitle').value.trim();
    const startDate = $('#rmPhaseStart').value;
    const endDate = $('#rmPhaseEnd').value;
    if (!title) { toast('단계명을 입력하세요', 'error'); return; }
    if (!startDate || !endDate) { toast('시작일·종료일을 입력하세요', 'error'); return; }
    if (endDate < startDate) { toast('종료일이 시작일보다 빠를 수 없습니다', 'error'); return; }
    const body = {
      resource: 'phase', objectiveId, title, startDate, endDate,
      status: $('#rmPhaseStatus').value,
      progress: Number($('#rmPhaseProgress').value) || 0,
      description: $('#rmPhaseDesc').value.trim() || null,
    };
    try {
      if (id) await api(`/api/admin-roadmap?id=${id}`, { method: 'PATCH', body });
      else await api('/api/admin-roadmap', { method: 'POST', body });
      closeModal('rmPhaseModal');
      toast(id ? '단계를 수정했습니다' : '단계를 추가했습니다', 'success');
      broadcast();
      await load();
    } catch (err) { toast('저장 실패: ' + err.message, 'error'); }
  }

  async function deletePhase() {
    const id = $('#rmPhaseId').value;
    if (!id) return;
    if (!confirm('이 단계를 삭제할까요?')) return;
    try {
      await api(`/api/admin-roadmap?id=${id}&resource=phase`, { method: 'DELETE' });
      closeModal('rmPhaseModal');
      toast('단계를 삭제했습니다', 'success');
      broadcast();
      await load();
    } catch (err) { toast('삭제 실패: ' + err.message, 'error'); }
  }

  // 다른 워크스페이스 탭(캘린더 등)에 변경 알림 → 캘린더 오버레이 자동 갱신
  function broadcast() {
    try { window.WorkspaceSync?.notify?.('roadmap:changed', {}); } catch (_) {}
  }

  // id로 목표/단계 찾기
  function findObj(id) { return STATE.objectives.find(o => String(o.id) === String(id)); }
  function findPhase(objId, phaseId) {
    const o = findObj(objId); if (!o) return null;
    return (o.phases || []).find(p => String(p.id) === String(phaseId));
  }

  /* ═══════════════ 이벤트 바인딩 ═══════════════ */
  function bind() {
    $('#rmFilterStatus')?.addEventListener('change', e => { STATE.statusFilter = e.target.value; load(); });
    $('#rmBtnRefresh')?.addEventListener('click', () => load());
    $('#rmViewList')?.addEventListener('click', () => { STATE.view = 'list'; $('#rmViewList').classList.add('is-active'); $('#rmViewTimeline').classList.remove('is-active'); render(); });
    $('#rmViewTimeline')?.addEventListener('click', () => { STATE.view = 'timeline'; $('#rmViewTimeline').classList.add('is-active'); $('#rmViewList').classList.remove('is-active'); render(); });
    $('#rmBtnNewObj')?.addEventListener('click', () => openObjModal(null));

    // 진행률 슬라이더 라벨
    $('#rmObjProgress')?.addEventListener('input', e => { $('#rmObjProgressVal').textContent = e.target.value + '%'; });
    $('#rmPhaseProgress')?.addEventListener('input', e => { $('#rmPhaseProgressVal').textContent = e.target.value + '%'; });

    // 모달 버튼
    $('#rmObjSaveBtn')?.addEventListener('click', saveObj);
    $('#rmObjDeleteBtn')?.addEventListener('click', deleteObj);
    $('#rmPhaseSaveBtn')?.addEventListener('click', savePhase);
    $('#rmPhaseDeleteBtn')?.addEventListener('click', deletePhase);

    // 모달 닫기(백드롭·닫기 버튼·취소)
    document.addEventListener('click', e => {
      const close = e.target.closest('[data-close-modal]');
      if (close) { closeModal(close.dataset.closeModal); return; }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { const m = document.querySelector('.wk-modal.is-open'); if (m) { m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); } }
    });

    // 카드·타임라인 위임 클릭
    document.addEventListener('click', e => {
      if (!STATE.canEdit) return;
      const editObj = e.target.closest('[data-edit-obj]');
      if (editObj) { openObjModal(findObj(editObj.dataset.editObj)); return; }
      const addPhase = e.target.closest('[data-add-phase]');
      if (addPhase) { openPhaseModal(Number(addPhase.dataset.addPhase), null); return; }
      const editPhase = e.target.closest('[data-edit-phase]');
      if (editPhase) { openPhaseModal(Number(editPhase.dataset.obj), findPhase(editPhase.dataset.obj, editPhase.dataset.editPhase)); return; }
      // 타임라인 바 클릭
      const tlRow = e.target.closest('.rm-tl-bar');
      if (tlRow) {
        const row = tlRow.closest('[data-obj-id]');
        const prow = tlRow.closest('[data-phase-id]');
        if (prow) {
          // 단계 바: 소속 목표 찾기
          const pid = prow.dataset.phaseId;
          for (const o of STATE.objectives) {
            const ph = (o.phases || []).find(p => String(p.id) === String(pid));
            if (ph) { openPhaseModal(o.id, ph); return; }
          }
        } else if (row) { openObjModal(findObj(row.dataset.objId)); }
      }
    });

    // 로그아웃
    $('#wsBtnLogout')?.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
      location.href = '/admin.html';
    });

    // 다른 탭 로드맵 변경 수신 시 새로고침
    try {
      window.WorkspaceSync?.on?.('roadmap:changed', () => load());
    } catch (_) {}
  }

  /* ═══════════════ 초기화 ═══════════════ */
  async function init() {
    bind();
    await loadMe();
    await load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
