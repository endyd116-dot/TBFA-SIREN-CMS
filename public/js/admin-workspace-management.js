/* =========================================================
   admin-workspace-management.js — Phase 26 어드민 워크스페이스 관리
   ========================================================= */
(function () {
  'use strict';

  /* ─── API 헬퍼 ─── */
  async function api(path, opts = {}) {
    try {
      const res = await fetch(path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        credentials: 'include',
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      console.error('[AWM API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ─── 흡수 코드(재택보고서·근무형태 관리)용 API 헬퍼 ───
     구 admin-attendance-settings.js의 api()는 응답 본문을 반환하고 실패 시 throw하는 계약이었음.
     흡수 함수의 응답 파싱(res.data.X || res.X)을 그대로 보존하기 위해 awm api()를 한 번 더 감싼다. */
  async function apiThrow(path, opts = {}) {
    const r = await api(path, opts);
    if (!r.ok) throw new Error((r.data && (r.data.error || r.data.message)) || 'HTTP ' + r.status);
    return r.data;
  }

  /* ─── 토스트 ─── */
  function toast(msg, ms = 2600) {
    const el = document.getElementById('awmToast');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(window._awmToast);
    window._awmToast = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  /* ─── 유틸 ─── */
  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  }
  function toDateStr(d) {
    // KST 기준 날짜 (P1-21: UTC면 KST 0~9시에 어제로 잡혀 실시간 현황이 전원 미출근 오표시)
    const dt = d ? new Date(d) : new Date();
    return new Date(dt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function showEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }
  function hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  const MODE_LABEL = { OFFICE: '사무실', REMOTE: '재택', FIELD: '외근', HYBRID: '혼합', BUSINESS_TRIP: '출장', FLEXIBLE: '탄력' };
  const STATUS_LABEL = { NORMAL: '정상', LATE: '지각', EARLY_LEAVE: '조퇴', ABSENT: '결근', LEAVE: '휴가', REMOTE: '재택', FIELD: '외근', HOLIDAY: '공휴일' };
  const STATUS_CLASS = { NORMAL: 'normal', LATE: 'late', EARLY_LEAVE: 'early', ABSENT: 'absent', LEAVE: 'leave', REMOTE: 'remote', FIELD: 'field', HOLIDAY: 'holiday' };

  /* ─── 탭 전환 ─── */
  function setupTabs() {
    document.querySelectorAll('.att-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.att-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.att-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const id = 'awmPanel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
        const panel = document.getElementById(id);
        if (panel) panel.classList.add('active');

        if (btn.dataset.tab === 'leaves' && !window._awmLvInit) initLeavesTab();
        if (btn.dataset.tab === 'balances' && !window._awmBalInit) initBalancesTab();
        if (btn.dataset.tab === 'schedule' && !window._awmSchInit) initScheduleTab();
        if (btn.dataset.tab === 'workplaces' && !window._awmWpInit) initWorkplacesTab();
        if (btn.dataset.tab === 'policy' && !window._awmPolInit) initPolicyTab();
        if (btn.dataset.tab === 'leavetypes' && !window._awmLtInit) initLeaveTypesTab();
        if (btn.dataset.tab === 'holidays' && !window._awmHolInit) initHolidaysTab();
        if (btn.dataset.tab === 'monthrecords' && !window._awmMrInit) initMonthRecordsTab();
        if (btn.dataset.tab === 'workmodeChanges' && !window._awmWmcInit) initWorkmodeChangesTab();
        if (btn.dataset.tab === 'remotereports' && !window._awmRrInit) initRemoteReportsTab();
        /* 2026-06-03 R46-3: '근무형태 관리' 탭 흡수(직원 스케줄로 통합) — 진입분기 제거. */
      });
    });
  }

  /* ─── group 필터 (?group=ops|config) — 해당 그룹 탭만 노출 + 첫 탭 활성화 ─── */
  function applyGroupFilter(group) {
    const g = (group === 'config') ? 'config' : 'ops';
    let firstVisible = null;
    document.querySelectorAll('#awmTabs .att-tab').forEach(btn => {
      const show = (btn.dataset.group || 'ops') === g;
      btn.style.display = show ? '' : 'none';
      if (show && !firstVisible) firstVisible = btn;
    });
    // 헤더 타이틀 + 돌아가기 버튼
    setText('awmTitle', g === 'config' ? '근태 설정' : '근태 현황');
    const backBtn = document.getElementById('awmBackToOps');
    if (backBtn) backBtn.style.display = (g === 'config') ? '' : 'none';
    // 현재 활성 탭이 숨겨졌으면 첫 노출 탭으로 전환 (click → 패널 활성화 + lazy init)
    const active = document.querySelector('#awmTabs .att-tab.active');
    if ((!active || active.style.display === 'none') && firstVisible) firstVisible.click();
  }

  /* ═══════════════════════════════════
     인증 (super_admin 확인)
  ═══════════════════════════════════ */
  async function checkAuth() {
    const res = await api('/api/admin/me');
    if (res.status === 401 || res.status === 403 || !res.ok) {
      alert('접근 권한이 없습니다. 어드민으로 로그인하세요.');
      location.href = '/admin.html';
      return null;
    }
    const admin = res.data?.data?.admin || res.data?.admin || {};
    setText('awmAdminName', admin.name || admin.username || '관리자');
    return admin;
  }

  /* ═══════════════════════════════════
     탭 1: 근태 현황
  ═══════════════════════════════════ */
  async function initRecordsTab() {
    const today = toDateStr();
    const dateEl = document.getElementById('awmRecordsDate');
    if (dateEl) dateEl.value = today;

    document.getElementById('awmBtnLoadRecords')?.addEventListener('click', loadRecords);
    await loadRecords();
    await loadPendingAmends();
  }

  async function loadRecords() {
    const date = document.getElementById('awmRecordsDate')?.value || toDateStr();
    const res = await api(`/api/admin-att-records?date=${date}`);
    // R34-P2 (round2 M3): 응답 구조 { ok, data: { date, records, summary } }
    const payload = res.data?.data || res.data || {};
    const rows = Array.isArray(payload.records) ? payload.records : [];
    const summary = payload.summary || {};

    setText('awmCntCheckin', summary.checkinCount ?? '—');
    setText('awmCntLate',    summary.lateCount    ?? '—');
    setText('awmCntAbsent',  summary.absentCount  ?? '—');
    setText('awmCntLeave',   summary.leaveCount   ?? '—');
    // R35-GAP-P2 M-G1: work_mode별 카드 노출
    setText('awmCntOffice',       summary.officeCount       ?? '—');
    setText('awmCntRemote',       summary.remoteCount       ?? '—');
    setText('awmCntField',        summary.fieldCount        ?? '—');
    setText('awmCntBusinessTrip', summary.businessTripCount ?? '—');

    const tbody = document.getElementById('awmRecordsBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="att-empty">해당 날짜에 기록이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.memberName || r.name || '—')}</td>
        <td><span class="awm-tag ${r.mode || ''}">${MODE_LABEL[r.mode] || r.mode || '—'}</span></td>
        <td>${fmtTime(r.checkinAt)}</td>
        <td>${fmtTime(r.checkoutAt)}</td>
        <td><span class="att-badge ${STATUS_CLASS[r.status] || ''}">${STATUS_LABEL[r.status] || r.status || '—'}</span></td>
        <td style="font-size:12px;color:#6b7280">${escHtml(r.note || '')}</td>
      </tr>`).join('');
  }

  async function loadPendingAmends() {
    const res = await api('/api/admin-att-correction-review?status=PENDING');
    const rows = res.data?.data?.corrections || res.data?.corrections || [];
    const cntEl = document.getElementById('awmPendingAmendCount');
    if (cntEl) cntEl.textContent = `${Array.isArray(rows) ? rows.length : 0}건`;

    const tbody = document.getElementById('awmPendingAmendBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="att-empty">대기 중인 요청이 없습니다</td></tr>';
      return;
    }
    const typeLabel = { CHECK_IN: '출근', CHECK_OUT: '퇴근', BOTH: '출퇴근' };
    tbody.innerHTML = rows.map(r => {
      /* 직원이 붙인 증빙 서류 — 결재 전에 열어볼 수 있게 사유 밑에 붙인다 */
      const files = Array.isArray(r.evidenceFiles) ? r.evidenceFiles : [];
      const clips = files.length
        ? '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">' + files.map(f =>
            `<a href="#" onclick="awmOpenEvidence(${r.id},${Number(f.fileId)});return false"
                style="display:inline-flex;align-items:center;gap:3px;font-size:11.5px;color:#2563eb;
                       border:1px solid #bfdbfe;background:#eff6ff;border-radius:6px;padding:2px 7px;text-decoration:none"
                title="${escHtml(f.name || '')} — 내려받기"><span class="siren-icon-wrap" data-icon="paperclip" style="width:12px;height:12px"></span>${escHtml(String(f.name || '첨부').slice(0, 20))}</a>`
          ).join('') + '</div>'
        : '';
      return `
      <tr>
        <td>${escHtml(r.memberName || '—')}</td>
        <td>${escHtml(r.targetDate || '—')}</td>
        <td>${typeLabel[r.correctionType] || r.correctionType || '—'}</td>
        <td style="font-size:12px">
          ${r.requestedCheckIn ? '출근 ' + fmtTime(r.requestedCheckIn) : ''}
          ${r.requestedCheckOut ? '<br>퇴근 ' + fmtTime(r.requestedCheckOut) : ''}
        </td>
        <td>${escHtml(r.reason || '—')}${clips}</td>
        <td>
          <button class="att-btn att-btn-primary att-btn-sm" onclick="awmApproveAmend(${r.id})">승인</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmRejectAmend(${r.id})">반려</button>
        </td>
      </tr>`;
    }).join('');
    if (window.SirenIcons?.render) window.SirenIcons.render(tbody);
  }

  /** 정정 요청에 붙은 증빙 열기 — 그 요청에 첨부된 파일만 열린다(직원의 다른 파일은 못 본다) */
  window.awmOpenEvidence = async (correctionId, fileId) => {
    const res = await api('/api/admin-att-correction-file?correctionId=' + correctionId + '&fileId=' + fileId);
    const d = res.data?.data || res.data;
    if (!res.ok || !d?.url) { toast(res.data?.error || '파일을 열 수 없습니다'); return; }
    window.open(d.url, '_blank');
  };

  window.awmApproveAmend = async (id) => {
    if (!confirm('이 수정 요청을 승인하시겠습니까?')) return;
    const res = await api('/api/admin-att-correction-review', {
      method: 'POST',
      body: { requestId: id, action: 'APPROVED', note: '' },
    });
    if (!res.ok) { toast('승인 실패: ' + (res.data?.error || '') + (res.data?.detail ? ' — ' + res.data.detail : '')); return; }
    toast('수정요청 승인 완료');
    await loadPendingAmends();
  };

  window.awmRejectAmend = async (id) => {
    const reason = prompt('반려 사유를 입력하세요 (선택)');
    const res = await api('/api/admin-att-correction-review', {
      method: 'POST',
      body: { requestId: id, action: 'REJECTED', note: reason || '' },
    });
    if (!res.ok) { toast('반려 실패: ' + (res.data?.error || '')); return; }
    toast('수정요청 반려 완료');
    await loadPendingAmends();
  };

  /* ═══════════════════════════════════
     탭 2: 직원 스케줄
  ═══════════════════════════════════ */
  /* 스케줄 편집 상태 — null이면 신규 등록, 값이 있으면 해당 id 수정 모드 */
  let _awmSchEditId = null;
  /* 직원 uid → 이름 매핑 (스케줄 목록·기록 표시용) */
  const _awmSchMembers = {};
  /* 스케줄 목록 행 캐시 (id → row) — 수정 버튼에서 재사용 */
  let _awmSchRows = {};

  async function initScheduleTab() {
    window._awmSchInit = true;
    await loadMemberDropdown('awmScheduleMember');
    await loadWorkplaceDropdown('awmScheduleWorkplace');

    // FIELD/HYBRID 모드 선택 시 해당 영역 노출
    document.getElementById('awmScheduleMode')?.addEventListener('change', (e) => {
      const hybrid = document.getElementById('awmHybridConfig');
      const wpWrap = document.getElementById('awmScheduleWorkplaceWrap');
      /* 2026-06-25 FIX: '.awm-schedule-hybrid'는 CSS에 display:none이 걸려 있어
         style.display=''(인라인 제거)면 CSS none으로 되돌아가 영영 안 보임 → 'block' 명시.
         (혼합 선택 시 요일별 재택/사무실 선택 UI가 통합 후 사라진 원인) */
      if (hybrid) hybrid.style.display = e.target.value === 'HYBRID' ? 'block' : 'none';
      if (wpWrap) wpWrap.style.display = e.target.value === 'FIELD' ? '' : 'none';
    });

    _resetScheduleForm();

    document.getElementById('awmBtnSaveSchedule')?.addEventListener('click', saveSchedule);
    document.getElementById('awmBtnCancelScheduleEdit')?.addEventListener('click', _resetScheduleForm);
    await loadScheduleList();
  }

  /* 폼을 신규 등록 상태로 초기화 */
  function _resetScheduleForm() {
    _awmSchEditId = null;
    const memberEl = document.getElementById('awmScheduleMember');
    const modeEl = document.getElementById('awmScheduleMode');
    if (memberEl) { memberEl.value = ''; memberEl.disabled = false; }
    if (modeEl) modeEl.value = 'OFFICE';
    document.getElementById('awmScheduleFrom') && (document.getElementById('awmScheduleFrom').value = toDateStr());
    document.getElementById('awmScheduleTo') && (document.getElementById('awmScheduleTo').value = '');
    const wpEl = document.getElementById('awmScheduleWorkplace');
    if (wpEl) wpEl.value = '';
    // 혼합 체크박스·요일별 모드 초기화
    document.querySelectorAll('[name="hybridDay"]').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('.hybrid-day-mode').forEach(s => { s.value = 'OFFICE'; });
    const hybrid = document.getElementById('awmHybridConfig');
    const wpWrap = document.getElementById('awmScheduleWorkplaceWrap');
    if (hybrid) hybrid.style.display = 'none';
    if (wpWrap) wpWrap.style.display = 'none';
    // 버튼 라벨 복원
    const saveBtn = document.getElementById('awmBtnSaveSchedule');
    if (saveBtn) saveBtn.textContent = '스케줄 저장';
    hideEl('awmBtnCancelScheduleEdit');
    const titleEl = document.getElementById('awmScheduleFormTitle');
    if (titleEl) titleEl.textContent = '직원 근무 스케줄 설정';
  }

  /* 목록의 '수정' 클릭 → 폼에 기존 값 채우고 수정 모드 진입 */
  function _editSchedule(row) {
    _awmSchEditId = Number(row.id);
    const memberEl = document.getElementById('awmScheduleMember');
    const modeEl = document.getElementById('awmScheduleMode');
    // 직원은 수정 대상 고정 (다른 직원으로 옮기는 건 신규 등록으로 처리)
    if (memberEl) { memberEl.value = String(row.memberUid); memberEl.disabled = true; }
    if (modeEl) modeEl.value = row.workMode || 'OFFICE';
    const fromEl = document.getElementById('awmScheduleFrom');
    const toEl = document.getElementById('awmScheduleTo');
    if (fromEl) fromEl.value = (row.startDate || '').slice(0, 10);
    if (toEl) toEl.value = row.endDate ? String(row.endDate).slice(0, 10) : '';

    // 거점(FIELD)
    const wpWrap = document.getElementById('awmScheduleWorkplaceWrap');
    const wpEl = document.getElementById('awmScheduleWorkplace');
    if (wpEl) wpEl.value = row.workplaceId != null ? String(row.workplaceId) : '';
    if (wpWrap) wpWrap.style.display = row.workMode === 'FIELD' ? '' : 'none';

    // 혼합(요일별) — recurringRule {MON:'OFFICE',...} 복원
    const hybrid = document.getElementById('awmHybridConfig');
    document.querySelectorAll('[name="hybridDay"]').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('.hybrid-day-mode').forEach(s => { s.value = 'OFFICE'; });
    if (row.workMode === 'HYBRID' && row.recurringRule && typeof row.recurringRule === 'object') {
      const KEY_DAY = { MON: '1', TUE: '2', WED: '3', THU: '4', FRI: '5', SAT: '6', SUN: '7' };
      Object.keys(row.recurringRule).forEach(k => {
        const dayVal = KEY_DAY[String(k).toUpperCase()] || String(k);
        const cb = document.querySelector(`[name="hybridDay"][value="${dayVal}"]`);
        const modeSel = document.querySelector(`.hybrid-day-mode[data-day="${dayVal}"]`);
        if (cb) cb.checked = true;
        if (modeSel) modeSel.value = row.recurringRule[k];
      });
    }
    if (hybrid) hybrid.style.display = row.workMode === 'HYBRID' ? 'block' : 'none';

    // 버튼·제목 수정 모드로
    const saveBtn = document.getElementById('awmBtnSaveSchedule');
    if (saveBtn) saveBtn.textContent = '수정 저장';
    showEl('awmBtnCancelScheduleEdit');
    const titleEl = document.getElementById('awmScheduleFormTitle');
    if (titleEl) titleEl.textContent = '스케줄 수정 — ' + (_awmSchMembers[String(row.memberUid)] || row.memberUid);
    // 폼으로 스크롤
    document.getElementById('awmScheduleMode')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function _deleteSchedule(id) {
    if (!id) return;
    if (!confirm('이 스케줄을 삭제하시겠습니까?')) return;
    const res = await api('/api/admin-att-schedules?id=' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || '')); return; }
    toast('스케줄이 삭제되었습니다');
    if (_awmSchEditId === Number(id)) _resetScheduleForm();
    await loadScheduleList();
  }

  async function loadWorkplaceDropdown(selId) {
    const res = await api('/api/admin-att-workplaces');
    const wps = res.data?.data || res.data || [];
    const sel = document.getElementById(selId);
    if (!sel || !Array.isArray(wps)) return;
    while (sel.options.length > 1) sel.remove(1);
    wps.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.name}${w.type ? ' [' + w.type + ']' : ''}`;
      sel.appendChild(opt);
    });
  }

  async function loadMemberDropdown(selId) {
    const res = await api('/api/admin-att-members');
    const members = res.data?.data?.members ?? [];
    const sel = document.getElementById(selId);
    if (!sel || !Array.isArray(members)) return;
    while (sel.options.length > 1) sel.remove(1);
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.uid || m.id;
      opt.textContent = m.name || m.username || m.uid;
      sel.appendChild(opt);
      // 스케줄 목록에서 uid → 이름 표시용 매핑 축적
      _awmSchMembers[String(m.uid || m.id)] = m.name || m.username || String(m.uid || m.id);
    });
  }

  async function saveSchedule() {
    const uid = document.getElementById('awmScheduleMember')?.value;
    const mode = document.getElementById('awmScheduleMode')?.value;
    const from = document.getElementById('awmScheduleFrom')?.value;
    const to = document.getElementById('awmScheduleTo')?.value;

    if (!uid) { toast('직원을 선택하세요'); return; }
    if (!from) { toast('적용 시작일을 입력하세요'); return; }

    let hybridConfig = null;
    if (mode === 'HYBRID') {
      /* R33-FIX H-G1: 체크박스 value "1"~"7" → 서버 키 "MON"~"SUN" 변환 (att-utils.getScheduledWorkMode 기대 형식) */
      const DAY_MAP = { "1":"MON", "2":"TUE", "3":"WED", "4":"THU", "5":"FRI", "6":"SAT", "7":"SUN" };
      const days = {};
      document.querySelectorAll('[name="hybridDay"]:checked').forEach(cb => {
        const day = cb.value;
        const dayKey = DAY_MAP[day] || day;
        const modeEl = document.querySelector(`.hybrid-day-mode[data-day="${day}"]`);
        days[dayKey] = modeEl ? modeEl.value : 'OFFICE';
      });
      hybridConfig = days;
    }

    const btn = document.getElementById('awmBtnSaveSchedule');
    if (btn) btn.disabled = true;

    // R34-P2 (P2): FIELD 모드면 workplaceId 첨부
    const workplaceId = mode === 'FIELD'
      ? Number(document.getElementById('awmScheduleWorkplace')?.value) || null
      : null;

    const body = { memberUid: uid, workMode: mode, startDate: from, endDate: to || null, recurringRule: hybridConfig, workplaceId };
    // 수정 모드면 PUT, 신규면 POST
    const res = _awmSchEditId
      ? await api('/api/admin-att-schedules?id=' + encodeURIComponent(_awmSchEditId), { method: 'PUT', body })
      : await api('/api/admin-att-schedules', { method: 'POST', body });
    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast(_awmSchEditId ? '스케줄이 수정되었습니다' : '스케줄이 저장되었습니다');
    if (btn) btn.disabled = false;
    _resetScheduleForm();
    await loadScheduleList();
  }

  /* 혼합(요일별) 규칙을 사람이 읽는 텍스트로 — {MON:'OFFICE',TUE:'REMOTE'} → "월 사무실 · 화 재택" */
  function _hybridSummary(rule) {
    if (!rule || typeof rule !== 'object') return '';
    const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
    const MODE_SHORT = { OFFICE: '사무실', REMOTE: '재택', FIELD: '외근', BUSINESS_TRIP: '출장' };
    const ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    return ORDER.filter(d => rule[d]).map(d => `${DAY_LABEL[d]} ${MODE_SHORT[rule[d]] || rule[d]}`).join(' · ');
  }

  async function loadScheduleList() {
    const res = await api('/api/admin-att-schedules');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('awmScheduleListBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="att-empty">설정된 스케줄이 없습니다</td></tr>';
      return;
    }
    // 행 데이터를 id로 캐싱해 수정 버튼에서 재사용
    _awmSchRows = {};
    tbody.innerHTML = rows.map(r => {
      _awmSchRows[String(r.id)] = r;
      const name = r.memberName || _awmSchMembers[String(r.memberUid)] || r.memberUid || '—';
      const hybridTxt = r.workMode === 'HYBRID' ? _hybridSummary(r.recurringRule) : '';
      return `
      <tr>
        <td>${escHtml(name)}</td>
        <td>
          <span class="awm-tag ${r.workMode || ''}">${MODE_LABEL[r.workMode] || r.workMode || '—'}</span>
          ${hybridTxt ? `<div style="font-size:11px;color:#6b7280;margin-top:3px">${escHtml(hybridTxt)}</div>` : ''}
        </td>
        <td>${escHtml((r.startDate || '—').slice(0, 10))} ~ ${escHtml(r.endDate ? String(r.endDate).slice(0, 10) : '계속')}</td>
        <td style="white-space:nowrap">
          <button type="button" class="awm-sch-edit" data-id="${r.id}" style="font-size:12px;padding:3px 9px;border:1px solid #d1d5db;border-radius:5px;background:#fff;cursor:pointer">수정</button>
          <button type="button" class="awm-sch-del" data-id="${r.id}" style="font-size:12px;padding:3px 9px;border:1px solid #fecaca;color:#dc2626;border-radius:5px;background:#fff;cursor:pointer;margin-left:4px">삭제</button>
        </td>
      </tr>`;
    }).join('');

    // 버튼 이벤트 위임 (1회 바인딩)
    if (!tbody.dataset.crudBound) {
      tbody.dataset.crudBound = '1';
      tbody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.awm-sch-edit');
        const delBtn = e.target.closest('.awm-sch-del');
        if (editBtn) { const row = _awmSchRows[String(editBtn.dataset.id)]; if (row) _editSchedule(row); }
        else if (delBtn) { _deleteSchedule(delBtn.dataset.id); }
      });
    }
  }

  /* ═══════════════════════════════════
     탭 3: 거점 관리
  ═══════════════════════════════════ */
  async function initWorkplacesTab() {
    window._awmWpInit = true;
    await loadWorkplaces();

    document.getElementById('awmBtnAddWorkplace')?.addEventListener('click', () => {
      clearWpForm();
      setText('awmWorkplaceFormTitle', '거점 추가');
      showEl('awmWorkplaceForm');
    });
    document.getElementById('awmBtnCancelWorkplace')?.addEventListener('click', () => hideEl('awmWorkplaceForm'));
    document.getElementById('awmBtnSearchAddress')?.addEventListener('click', openAddrModal);
    document.getElementById('awmBtnAddrModalClose')?.addEventListener('click', closeAddrModal);
    document.getElementById('awmBtnAddrSearch')?.addEventListener('click', searchAddress);
    document.getElementById('awmAddrQuery')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); searchAddress(); }
    });
    document.getElementById('awmAddrModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'awmAddrModal') closeAddrModal();
    });
    document.getElementById('awmBtnSaveWorkplace')?.addEventListener('click', saveWorkplace);
  }

  async function loadWorkplaces() {
    // R35-GAP-P2 M-G2: 어드민 거점 관리는 비활성 포함 전체 보기
    const res = await api('/api/admin-att-workplaces?includeInactive=1');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('awmWorkplacesBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="att-empty">등록된 거점이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${escHtml(r.name || '—')}</strong></td>
        <td>${escHtml(r.address || '—')}</td>
        <td>${r.radius ?? '—'}</td>
        <td style="font-size:12px;color:#6b7280">${r.lat != null && r.lng != null ? Number(r.lat).toFixed(5) + ', ' + Number(r.lng).toFixed(5) : '—'}</td>
        <td>
          <button class="att-btn att-btn-default att-btn-sm" onclick="awmEditWorkplace(${r.id})">수정</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmDeleteWorkplace(${r.id})">삭제</button>
        </td>
      </tr>`).join('');
    window._awmWpRows = rows;
  }

  function clearWpForm() {
    ['awmWpId', 'awmWpName', 'awmWpAddress', 'awmWpRoadAddress', 'awmWpRadius', 'awmWpLat', 'awmWpLng'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'awmWpRadius' ? '200' : '';
    });
  }

  window.awmEditWorkplace = (id) => {
    const row = (window._awmWpRows || []).find(r => r.id === id);
    if (!row) return;
    document.getElementById('awmWpId').value = id;
    document.getElementById('awmWpName').value = row.name || '';
    document.getElementById('awmWpAddress').value = row.address || '';
    const roadEl = document.getElementById('awmWpRoadAddress');
    if (roadEl) roadEl.value = '';
    document.getElementById('awmWpRadius').value = row.radius || 200;
    document.getElementById('awmWpLat').value = row.lat || '';
    document.getElementById('awmWpLng').value = row.lng || '';
    setText('awmWorkplaceFormTitle', '거점 수정');
    showEl('awmWorkplaceForm');
    document.getElementById('awmWorkplaceForm').scrollIntoView({ behavior: 'smooth' });
  };

  window.awmDeleteWorkplace = async (id) => {
    if (!confirm('이 거점을 삭제하시겠습니까?')) return;
    const res = await api(`/api/admin-att-workplaces?id=${id}`, { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || '')); return; }
    toast('삭제되었습니다');
    await loadWorkplaces();
  };

  function openAddrModal() {
    const modal = document.getElementById('awmAddrModal');
    if (!modal) return;
    modal.style.display = 'flex';
    const q = document.getElementById('awmAddrQuery');
    if (q) {
      const existing = document.getElementById('awmWpAddress')?.value || '';
      q.value = existing;
      setTimeout(() => q.focus(), 30);
    }
    const results = document.getElementById('awmAddrResults');
    if (results && !q?.value) {
      results.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:30px 0">주소를 입력 후 검색하세요</div>';
    }
  }

  function closeAddrModal() {
    const modal = document.getElementById('awmAddrModal');
    if (modal) modal.style.display = 'none';
  }

  async function searchAddress() {
    const query = document.getElementById('awmAddrQuery')?.value?.trim();
    if (!query) { toast('검색어를 입력하세요'); return; }

    const btn = document.getElementById('awmBtnAddrSearch');
    if (btn) btn.disabled = true;
    const resultsEl = document.getElementById('awmAddrResults');
    if (resultsEl) resultsEl.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:30px 0">검색 중...</div>';

    const res = await api(`/api/att-geocode-search?query=${encodeURIComponent(query)}`);
    if (btn) btn.disabled = false;

    if (res.status === 503) {
      const errMsg = res.data?.error || '거점 주소 검색 환경변수가 등록되지 않았습니다 (KAKAO_REST_API_KEY)';
      toast(errMsg);
      if (resultsEl) resultsEl.innerHTML = `<div style="text-align:center;color:#dc2626;font-size:12.5px;padding:30px 14px;line-height:1.5">${escHtml(errMsg)}</div>`;
      return;
    }
    if (!res.ok) {
      toast('검색 실패: ' + (res.data?.error || ''));
      if (resultsEl) resultsEl.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:30px 0">검색 결과 없음</div>';
      return;
    }

    const results = res.data?.data?.results || res.data?.results || [];
    if (!Array.isArray(results) || results.length === 0) {
      if (resultsEl) resultsEl.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:30px 0">검색 결과가 없습니다</div>';
      return;
    }
    window._awmAddrResults = results;
    if (!resultsEl) return;
    resultsEl.innerHTML = results.map((r, idx) => `
      <button type="button" data-idx="${idx}" class="awm-addr-item"
        style="display:block;width:100%;text-align:left;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;margin-bottom:6px;cursor:pointer;font-family:inherit">
        <div style="font-weight:600;font-size:13px">${escHtml(r.roadAddress || r.address || '주소 없음')}</div>
        ${r.address && r.address !== r.roadAddress ? `<div style="font-size:11.5px;color:#6b7280;margin-top:2px">지번: ${escHtml(r.address)}</div>` : ''}
        ${r.placeName ? `<div style="font-size:11.5px;color:#3b82f6;margin-top:2px">${escHtml(r.placeName)}</div>` : ''}
      </button>
    `).join('');
    resultsEl.querySelectorAll('.awm-addr-item').forEach(el => {
      el.addEventListener('click', () => pickAddress(Number(el.dataset.idx)));
    });
  }

  function pickAddress(idx) {
    const result = (window._awmAddrResults || [])[idx];
    if (!result) return;
    const addrEl = document.getElementById('awmWpAddress');
    const roadEl = document.getElementById('awmWpRoadAddress');
    const latEl = document.getElementById('awmWpLat');
    const lngEl = document.getElementById('awmWpLng');
    if (addrEl) addrEl.value = result.address || result.roadAddress || '';
    if (roadEl) roadEl.value = result.roadAddress || '';
    if (latEl) latEl.value = result.lat;
    if (lngEl) lngEl.value = result.lng;
    closeAddrModal();
    toast('주소가 입력되었습니다');
  }

  async function saveWorkplace() {
    const id = document.getElementById('awmWpId')?.value;
    const name = document.getElementById('awmWpName')?.value?.trim();
    const address = document.getElementById('awmWpAddress')?.value?.trim();
    const radius = Number(document.getElementById('awmWpRadius')?.value) || 200;
    const lat = parseFloat(document.getElementById('awmWpLat')?.value);
    const lng = parseFloat(document.getElementById('awmWpLng')?.value);

    if (!name) { toast('거점명을 입력하세요'); return; }
    if (!lat || !lng) { toast('좌표를 입력하거나 주소로 조회하세요'); return; }

    const btn = document.getElementById('awmBtnSaveWorkplace');
    if (btn) btn.disabled = true;

    const method = id ? 'PUT' : 'POST';
    const path = id ? `/api/admin-att-workplaces?id=${id}` : '/api/admin-att-workplaces';
    const body = { name, address, radius, lat, lng };
    if (!id) body.type = 'OFFICE';
    const res = await api(path, { method, body });

    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('저장되었습니다');
    if (btn) btn.disabled = false;
    hideEl('awmWorkplaceForm');
    await loadWorkplaces();
  }

  /* ═══════════════════════════════════
     탭 4: 근무 정책
  ═══════════════════════════════════ */
  async function initPolicyTab() {
    window._awmPolInit = true;
    const res = await api('/api/admin-att-policy');
    const p = res.data?.data || res.data || {};

    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
    setVal('awmPolicyCheckInTime', p.checkInTime || '09:00');
    setVal('awmPolicyCheckOutTime', p.checkOutTime || '18:00');
    setVal('awmPolicyLateGraceMins', p.lateGraceMins ?? 10);
    setVal('awmPolicyEarlyLeaveGraceMins', p.earlyLeaveGraceMins ?? 10);
    setVal('awmPolicyDailyHours', p.dailyHours ?? 8);
    setVal('awmPolicyBreakMins', p.breakMins ?? 60);
    setVal('awmPolicyBreakThresholdHours', p.breakThresholdHours ?? 4);
    setVal('awmPolicyWeeklyMaxHours', p.weeklyMaxHours ?? 52);
    setVal('awmPolicyCoreStartTime', p.coreStartTime || '10:00');
    setVal('awmPolicyCoreEndTime', p.coreEndTime || '16:00');
    setVal('awmPolicyFlexEnabled', p.flexEnabled ? 'true' : 'false');
    setVal('awmPolicyRemoteMaxPerMonth', p.remoteMaxPerMonth ?? 10);
    setVal('awmPolicyFlexRangeMins', p.flexRangeMins ?? 120);

    document.getElementById('awmBtnSavePolicy')?.addEventListener('click', savePolicy);

    // 연차 산정 정책 (같은 패널·별도 저장)
    await loadLeavePolicy();
    document.getElementById('awmBtnSaveLeavePolicy')?.addEventListener('click', saveLeavePolicy);
    document.querySelectorAll('input[name="awmLeaveMode"]').forEach(function (r) {
      r.addEventListener('change', toggleLeaveModeUI);
    });
  }

  /* ── 연차 산정 정책 ── */
  async function loadLeavePolicy() {
    const res = await api('/api/admin-att-leave-policy');
    if (!res.ok) { toast('연차 정책 로드 실패: ' + (res.data?.error || '')); return; }
    const lp = res.data?.data || res.data || {};
    const mode = lp.leaveAccrualMode === 'B' ? 'B' : 'A';
    const radio = document.querySelector('input[name="awmLeaveMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
    setVal('awmLeavePerfectBonus', lp.perfectBonusPerMonth ?? 1);
    setVal('awmLeaveBaseDays', lp.annualBaseDays ?? 12);
    setVal('awmLeaveIncDays', lp.annualIncrementDays ?? 1);
    setVal('awmLeaveIncYears', lp.annualIncrementYears ?? 2);
    setVal('awmLeaveCapDays', lp.annualCapDays ?? 25);
    toggleLeaveModeUI();
  }

  function toggleLeaveModeUI() {
    const checked = document.querySelector('input[name="awmLeaveMode"]:checked');
    const mode = checked ? checked.value : 'A';
    const a = document.getElementById('awmLeaveModeA');
    const b = document.getElementById('awmLeaveModeB');
    if (a) a.style.display = mode === 'A' ? '' : 'none';
    if (b) b.style.display = mode === 'B' ? '' : 'none';
  }

  async function saveLeavePolicy() {
    const val = (id) => document.getElementById(id)?.value;
    const checked = document.querySelector('input[name="awmLeaveMode"]:checked');
    const mode = checked ? checked.value : 'A';
    const body = {
      leaveAccrualMode:     mode,
      perfectBonusPerMonth: parseFloat(val('awmLeavePerfectBonus')) || 0,
      annualBaseDays:       parseFloat(val('awmLeaveBaseDays')) || 0,
      annualIncrementDays:  parseFloat(val('awmLeaveIncDays')) || 0,
      annualIncrementYears: Number(val('awmLeaveIncYears')) || 1,
      annualCapDays:        parseFloat(val('awmLeaveCapDays')) || 0,
    };
    const btn = document.getElementById('awmBtnSaveLeavePolicy');
    if (btn) btn.disabled = true;
    const res = await api('/api/admin-att-leave-policy', { method: 'PUT', body });
    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('연차 산정 정책이 저장되었습니다');
    if (btn) btn.disabled = false;
  }

  async function savePolicy() {
    const val = (id) => document.getElementById(id)?.value;
    const body = {
      checkInTime:         val('awmPolicyCheckInTime'),
      checkOutTime:        val('awmPolicyCheckOutTime'),
      lateGraceMins:       Number(val('awmPolicyLateGraceMins')) || 0,
      earlyLeaveGraceMins: Number(val('awmPolicyEarlyLeaveGraceMins')) || 0,
      dailyHours:          parseFloat(val('awmPolicyDailyHours')) || 8,
      breakMins:           Number(val('awmPolicyBreakMins')) || 0,
      breakThresholdHours: parseFloat(val('awmPolicyBreakThresholdHours')) || 4,
      weeklyMaxHours:      Number(val('awmPolicyWeeklyMaxHours')) || 52,
      coreStartTime:       val('awmPolicyCoreStartTime') || null,
      coreEndTime:         val('awmPolicyCoreEndTime') || null,
      flexEnabled:         val('awmPolicyFlexEnabled') === 'true',
      remoteMaxPerMonth:   Number(val('awmPolicyRemoteMaxPerMonth')) || 0,
      flexRangeMins:       Number(val('awmPolicyFlexRangeMins')) || 0,
    };
    const btn = document.getElementById('awmBtnSavePolicy');
    if (btn) btn.disabled = true;
    const res = await api('/api/admin-att-policy', { method: 'PUT', body });
    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('정책이 저장되었습니다');
    if (btn) btn.disabled = false;
  }

  /* ═══════════════════════════════════
     탭 5: 휴가 종류
  ═══════════════════════════════════ */
  async function initLeaveTypesTab() {
    window._awmLtInit = true;
    await loadLeaveTypes();

    document.getElementById('awmBtnAddLeaveType')?.addEventListener('click', () => {
      clearLtForm();
      setText('awmLeaveTypeFormTitle', '휴가 종류 추가');
      showEl('awmLeaveTypeForm');
    });
    document.getElementById('awmBtnCancelLeaveType')?.addEventListener('click', () => hideEl('awmLeaveTypeForm'));
    document.getElementById('awmBtnSaveLeaveType')?.addEventListener('click', saveLeaveType);
  }

  async function loadLeaveTypes() {
    const res = await api('/api/admin-att-leave-types');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('awmLeaveTypesBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="att-empty">등록된 휴가 종류가 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><strong>${escHtml(r.name || '—')}</strong></td>
        <td>${r.defaultDays ?? '—'}</td>
        <td>${r.allowHalfDay ? '가능' : '불가'}</td>
        <td>${escHtml(r.description || '—')}</td>
        <td>
          <button class="att-btn att-btn-default att-btn-sm" onclick="awmEditLeaveType(${r.id})">수정</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmDeleteLeaveType(${r.id})">삭제</button>
        </td>
      </tr>`).join('');
    window._awmLtRows = rows;
  }

  function clearLtForm() {
    ['awmLtId', 'awmLtName', 'awmLtDesc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const days = document.getElementById('awmLtDays');
    if (days) days.value = '0';
  }

  window.awmEditLeaveType = (id) => {
    const row = (window._awmLtRows || []).find(r => r.id === id);
    if (!row) return;
    document.getElementById('awmLtId').value = id;
    document.getElementById('awmLtName').value = row.name || '';
    document.getElementById('awmLtDays').value = row.defaultDays ?? 0;
    // R34-P2 (M4): carryover 제거 — DB·API 미지원 필드. allowHalfDay만 사용
    const hdEl = document.getElementById('awmLtHalfDay');
    if (hdEl) hdEl.value = row.allowHalfDay !== false ? 'true' : 'false';
    document.getElementById('awmLtDesc').value = row.description || '';
    setText('awmLeaveTypeFormTitle', '휴가 종류 수정');
    showEl('awmLeaveTypeForm');
    document.getElementById('awmLeaveTypeForm').scrollIntoView({ behavior: 'smooth' });
  };

  window.awmDeleteLeaveType = async (id) => {
    if (!confirm('이 휴가 종류를 삭제하시겠습니까?')) return;
    const res = await api(`/api/admin-att-leave-types?id=${id}`, { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || '')); return; }
    toast('삭제되었습니다');
    await loadLeaveTypes();
  };

  async function saveLeaveType() {
    const id = document.getElementById('awmLtId')?.value;
    const name = document.getElementById('awmLtName')?.value?.trim();
    const defaultDays = Number(document.getElementById('awmLtDays')?.value) || 0;
    // R34-P2 (M4): carryover 필드 제거
    const halfDayAllowed = document.getElementById('awmLtHalfDay')?.value === 'true';
    const description = document.getElementById('awmLtDesc')?.value?.trim();

    if (!name) { toast('이름을 입력하세요'); return; }

    const btn = document.getElementById('awmBtnSaveLeaveType');
    if (btn) btn.disabled = true;

    const method = id ? 'PUT' : 'POST';
    const path = id ? `/api/admin-att-leave-types?id=${id}` : '/api/admin-att-leave-types';
    const res = await api(path, { method, body: { name, defaultDays, allowHalfDay: halfDayAllowed, description } });

    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('저장되었습니다');
    if (btn) btn.disabled = false;
    hideEl('awmLeaveTypeForm');
    await loadLeaveTypes();
  }

  /* ═══════════════════════════════════
     탭 6: 공휴일
  ═══════════════════════════════════ */
  async function initHolidaysTab() {
    window._awmHolInit = true;

    const sel = document.getElementById('awmHolidayYear');
    const curYear = new Date().getFullYear();
    if (sel) {
      for (let y = curYear - 1; y <= curYear + 2; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y + '년';
        if (y === curYear) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', loadHolidays);
    }

    await loadHolidays();

    document.getElementById('awmBtnAddHoliday')?.addEventListener('click', () => {
      document.getElementById('awmHolidayDate').value = toDateStr();
      document.getElementById('awmHolidayName').value = '';
      showEl('awmHolidayForm');
    });
    document.getElementById('awmBtnCancelHoliday')?.addEventListener('click', () => hideEl('awmHolidayForm'));
    document.getElementById('awmBtnSaveHoliday')?.addEventListener('click', saveHoliday);
  }

  async function loadHolidays() {
    const year = document.getElementById('awmHolidayYear')?.value || new Date().getFullYear();
    const res = await api(`/api/admin-att-holidays?year=${year}`);
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('awmHolidaysBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="att-empty">등록된 공휴일이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.date || '—')}</td>
        <td>${escHtml(r.name || '—')}</td>
        <td>${r.type === 'COMPANY' ? '회사 휴무일' : '법정공휴일'}</td>
        <td>
          <button class="att-btn att-btn-danger att-btn-sm" onclick="awmDeleteHoliday(${r.id})">삭제</button>
        </td>
      </tr>`).join('');
  }

  window.awmDeleteHoliday = async (id) => {
    if (!confirm('이 공휴일을 삭제하시겠습니까?')) return;
    const res = await api(`/api/admin-att-holidays?id=${id}`, { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || '')); return; }
    toast('삭제되었습니다');
    await loadHolidays();
  };

  async function saveHoliday() {
    const date = document.getElementById('awmHolidayDate')?.value;
    const name = document.getElementById('awmHolidayName')?.value?.trim();
    const type = document.getElementById('awmHolidayType')?.value;

    if (!date) { toast('날짜를 입력하세요'); return; }
    if (!name) { toast('명칭을 입력하세요'); return; }

    const btn = document.getElementById('awmBtnSaveHoliday');
    if (btn) btn.disabled = true;
    const res = await api('/api/admin-att-holidays', { method: 'POST', body: { date, name, type } });
    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('공휴일이 추가되었습니다');
    if (btn) btn.disabled = false;
    hideEl('awmHolidayForm');
    await loadHolidays();
  }

  /* ═══════════════════════════════════
     탭 신규: 휴가 결재
  ═══════════════════════════════════ */
  async function initLeavesTab() {
    window._awmLvInit = true;
    await loadPendingLeaves();
  }

  async function loadPendingLeaves() {
    const res = await api('/api/admin-att-leave-review?status=PENDING');
    const rows = res.data?.data?.leaves || res.data?.leaves || [];
    const cntEl = document.getElementById('awmLvPendingCount');
    if (cntEl) cntEl.textContent = `${Array.isArray(rows) ? rows.length : 0}건`;

    const tbody = document.getElementById('awmLeavesBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="att-empty">대기 중인 휴가 신청이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const halfTag = r.isHalfDay
        ? `<span class="awm-tag" style="background:#fef3c7;color:#92400e;margin-left:4px">${escHtml(r.halfDayPeriod || '반차')}</span>`
        : '';
      return `
      <tr>
        <td>${escHtml(r.memberName || '—')}<div style="font-size:11px;color:#9ca3af">${escHtml(r.memberEmail || '')}</div></td>
        <td>${escHtml(r.leaveTypeName || '—')}${halfTag}</td>
        <td>${escHtml(r.startDate || '—')}</td>
        <td>${escHtml(r.endDate || '—')}</td>
        <td>${escHtml(String(r.days ?? '—'))}</td>
        <td style="font-size:12px;max-width:240px;word-break:break-word">${escHtml(r.reason || '—')}</td>
        <td style="font-size:12px;color:#6b7280">${r.submittedAt ? new Date(r.submittedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
        <td>
          <button class="att-btn att-btn-primary att-btn-sm" onclick="awmApproveLeave(${r.id})">승인</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmRejectLeave(${r.id})">반려</button>
        </td>
      </tr>`;
    }).join('');
  }

  window.awmApproveLeave = async (id) => {
    if (!confirm('이 휴가 신청을 승인하시겠습니까?')) return;
    const res = await api('/api/admin-att-leave-review', {
      method: 'POST',
      body: { requestId: id, action: 'APPROVED' },
    });
    if (!res.ok) { toast('승인 실패: ' + (res.data?.error || '')); return; }
    toast('휴가 신청 승인 완료');
    await loadPendingLeaves();
  };

  window.awmRejectLeave = async (id) => {
    const reason = prompt('반려 사유를 입력하세요');
    if (reason === null) return;
    const res = await api('/api/admin-att-leave-review', {
      method: 'POST',
      body: { requestId: id, action: 'REJECTED', note: reason || '' },
    });
    if (!res.ok) { toast('반려 실패: ' + (res.data?.error || '')); return; }
    toast('휴가 신청 반려 완료');
    await loadPendingLeaves();
  };

  /* ═══════════════════════════════════
     탭 신규: 근무형태 변경 결재 (G1 — 직원 신청어드민 결재 연결)
     결재 API는 이미 구현됨. 승인 시 att_schedule_overrides 단발 재정의 자동 반영.
  ═══════════════════════════════════ */
  async function initWorkmodeChangesTab() {
    window._awmWmcInit = true;
    await loadPendingWorkmodeChanges();
  }

  async function loadPendingWorkmodeChanges() {
    const res = await api('/api/admin-att-workmode-change-review?status=PENDING');
    const rows = res.data?.data?.requests || res.data?.requests || [];
    const cntEl = document.getElementById('awmWmcPendingCount');
    if (cntEl) cntEl.textContent = `${Array.isArray(rows) ? rows.length : 0}건`;

    const tbody = document.getElementById('awmWmcBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="att-empty">대기 중인 근무형태 변경 신청이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.memberName || '—')}<div style="font-size:11px;color:#9ca3af">${escHtml(r.memberEmail || '')}</div></td>
        <td>${escHtml(r.targetDate || '—')}</td>
        <td><span class="awm-tag ${escHtml(r.targetMode || '')}">${MODE_LABEL[r.targetMode] || escHtml(r.targetMode) || '—'}</span></td>
        <td style="font-size:12px;max-width:240px;word-break:break-word">${escHtml(r.reason || '—')}</td>
        <td style="font-size:12px;color:#6b7280">${r.submittedAt ? new Date(r.submittedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
        <td>
          <button class="att-btn att-btn-primary att-btn-sm" onclick="awmApproveWorkmodeChange(${r.id})">승인</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmRejectWorkmodeChange(${r.id})">반려</button>
        </td>
      </tr>`).join('');
  }

  window.awmApproveWorkmodeChange = async (id) => {
    if (!confirm('이 근무형태 변경 신청을 승인하시겠습니까?\n승인 시 해당 날짜 근무형태가 자동 반영됩니다.')) return;
    const res = await api('/api/admin-att-workmode-change-review', {
      method: 'POST',
      body: { requestId: id, action: 'APPROVED' },
    });
    if (!res.ok) { toast('승인 실패: ' + (res.data?.error || '')); return; }
    toast('근무형태 변경 승인 완료');
    await loadPendingWorkmodeChanges();
  };

  window.awmRejectWorkmodeChange = async (id) => {
    const reason = prompt('반려 사유를 입력하세요');
    if (reason === null) return;
    const res = await api('/api/admin-att-workmode-change-review', {
      method: 'POST',
      body: { requestId: id, action: 'REJECTED', note: reason || '' },
    });
    if (!res.ok) { toast('반려 실패: ' + (res.data?.error || '')); return; }
    toast('근무형태 변경 반려 완료');
    await loadPendingWorkmodeChanges();
  };

  /* ═══════════════════════════════════
     탭 신규: 잔여 휴가
  ═══════════════════════════════════ */
  async function initBalancesTab() {
    window._awmBalInit = true;

    const sel = document.getElementById('awmBalanceYear');
    const curYear = new Date().getFullYear();
    if (sel) {
      for (let y = curYear - 1; y <= curYear + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y + '년';
        if (y === curYear) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', loadBalances);
    }

    const searchEl = document.getElementById('awmBalanceSearch');
    if (searchEl) {
      searchEl.addEventListener('input', () => renderBalances(window._awmBalRows || []));
    }

    document.getElementById('awmBtnCancelBalanceAdjust')?.addEventListener('click',
      () => hideEl('awmBalanceAdjustForm'));
    document.getElementById('awmBtnSaveBalanceAdjust')?.addEventListener('click', saveBalanceAdjust);

    /* 신규 휴가 부여/회수 폼 (직원·종류 선택) */
    document.getElementById('awmBtnOpenGrant')?.addEventListener('click', () => openGrantForm());
    document.getElementById('awmBtnCancelGrant')?.addEventListener('click', () => hideEl('awmBalanceGrantForm'));
    document.getElementById('awmBtnSaveGrant')?.addEventListener('click', saveGrant);

    await loadBalances();
  }

  /* 신규 휴가 부여/회수 — 잔여 기록이 없는 직원에게도 처음 부여 가능 */
  let _grantDropdownsLoaded = false;
  /* 잔여 휴가 표의 '+ 부여' 버튼(미부여 직원)에서 호출 — 해당 직원 프리필 */
  window.awmOpenGrantFor = (uid) => openGrantForm(uid);
  async function openGrantForm(prefillUid) {
    if (!_grantDropdownsLoaded) {
      try {
        const resM = await api('/api/admin-att-members');
        const memberList = resM.data?.data?.members || resM.data?.members || [];
        const mSel = document.getElementById('awmGrantMember');
        if (mSel) mSel.innerHTML = '<option value="">— 직원 선택 —</option>' +
          memberList.map(m => `<option value="${escHtml(String(m.uid || m.id))}">${escHtml(m.name)} (${escHtml(m.email || '')})</option>`).join('');
      } catch (e) { console.warn('[휴가 부여] 직원 목록 로드 실패', e); }
      try {
        const resT = await api('/api/admin-att-leave-types');
        const types = resT.data?.data || resT.data || [];
        const tSel = document.getElementById('awmGrantType');
        if (tSel) tSel.innerHTML = '<option value="">— 종류 선택 —</option>' +
          (Array.isArray(types) ? types : []).map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
      } catch (e) { console.warn('[휴가 부여] 휴가 종류 로드 실패', e); }
      _grantDropdownsLoaded = true;
    }
    ['awmGrantMember', 'awmGrantType', 'awmGrantDays', 'awmGrantReason'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    if (prefillUid) {
      const mSel = document.getElementById('awmGrantMember');
      if (mSel) mSel.value = String(prefillUid);
    }
    showEl('awmBalanceGrantForm');
    document.getElementById('awmBalanceGrantForm')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function saveGrant() {
    const memberUid = document.getElementById('awmGrantMember')?.value;
    const leaveTypeId = Number(document.getElementById('awmGrantType')?.value);
    const year = Number(document.getElementById('awmBalanceYear')?.value) || new Date().getFullYear();
    const deltaDays = parseFloat(document.getElementById('awmGrantDays')?.value);
    const reason = document.getElementById('awmGrantReason')?.value?.trim();

    if (!memberUid) { toast('직원을 선택하세요'); return; }
    if (!leaveTypeId) { toast('휴가 종류를 선택하세요'); return; }
    if (!Number.isFinite(deltaDays) || deltaDays === 0) { toast('일수를 입력하세요 (부여 +N / 회수 -N)'); return; }
    if (!reason) { toast('사유는 필수입니다 (감사 추적용)'); return; }

    const btn = document.getElementById('awmBtnSaveGrant');
    if (btn) btn.disabled = true;
    const res = await api('/api/admin-att-leave-balances', {
      method: 'PUT',
      body: { memberUid, leaveTypeId, year, deltaDays, reason },
    });
    if (!res.ok) { toast('처리 실패: ' + (res.data?.error || '')); if (btn) btn.disabled = false; return; }
    toast(`${deltaDays > 0 ? '부여' : '회수'} 완료 (${deltaDays > 0 ? '+' : ''}${deltaDays}일)`);
    if (btn) btn.disabled = false;
    hideEl('awmBalanceGrantForm');
    await loadBalances();
  }

  async function loadBalances() {
    const year = document.getElementById('awmBalanceYear')?.value || new Date().getFullYear();
    const res = await api(`/api/admin-att-leave-balances?year=${year}`);
    const rows = res.data?.data || res.data || [];
    window._awmBalRows = Array.isArray(rows) ? rows : [];
    renderBalances(window._awmBalRows);
  }

  function renderBalances(rows) {
    const tbody = document.getElementById('awmBalancesBody');
    if (!tbody) return;

    const q = (document.getElementById('awmBalanceSearch')?.value || '').trim().toLowerCase();
    const filtered = q
      ? rows.filter(r => (r.memberName || '').toLowerCase().includes(q) || (r.memberEmail || '').toLowerCase().includes(q))
      : rows;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="att-empty">표시할 직원이 없습니다</td></tr>';
      return;
    }
    /* 직원 전체 표시 — 잔여 기록 없는 직원(hasBalance=false)은 '부여' 버튼만 */
    tbody.innerHTML = filtered.map(r => {
      if (r.hasBalance === false) {
        return `<tr style="opacity:.75">
          <td>${escHtml(r.memberName || '—')}</td>
          <td style="font-size:12px;color:#6b7280">${escHtml(r.memberEmail || '')}</td>
          <td colspan="3" style="color:#9ca3af">부여된 휴가 없음</td>
          <td><strong>0</strong></td>
          <td style="white-space:nowrap">
            <button class="att-btn att-btn-primary att-btn-sm" title="휴가 부여"
              onclick="awmOpenGrantFor('${escHtml(r.memberUid)}')">+ 부여</button>
          </td>
        </tr>`;
      }
      return `<tr>
        <td>${escHtml(r.memberName || '—')}</td>
        <td style="font-size:12px;color:#6b7280">${escHtml(r.memberEmail || '')}</td>
        <td>${escHtml(r.leaveTypeName || '—')}</td>
        <td>${escHtml(String(r.totalDays ?? '—'))}</td>
        <td>${escHtml(String(r.usedDays ?? '—'))}</td>
        <td><strong>${escHtml(String(r.remainingDays ?? '—'))}</strong></td>
        <td style="white-space:nowrap">
          <button class="att-btn att-btn-default att-btn-sm" title="+1일 부여"
            onclick="awmQuickBalanceAdjust('${escHtml(r.memberUid)}', ${r.leaveTypeId}, ${r.year}, '${escHtml(r.memberName)}', '${escHtml(r.leaveTypeName)}', 1)">+1</button>
          <button class="att-btn att-btn-default att-btn-sm" title="-1일 차감" style="margin-left:3px"
            onclick="awmQuickBalanceAdjust('${escHtml(r.memberUid)}', ${r.leaveTypeId}, ${r.year}, '${escHtml(r.memberName)}', '${escHtml(r.leaveTypeName)}', -1)">-1</button>
          <button class="att-btn att-btn-default att-btn-sm" title="직접 입력" style="margin-left:3px"
            onclick="awmOpenBalanceAdjust('${escHtml(r.memberUid)}', ${r.leaveTypeId}, ${r.year}, '${escHtml(r.memberName)}', '${escHtml(r.leaveTypeName)}')">상세</button>
        </td>
      </tr>`;
    }).join('');
  }

  /* R39 Stage 7: +1/-1 빠른 조정 — 사유 prompt 후 즉시 PUT */
  window.awmQuickBalanceAdjust = async (memberUid, typeId, year, memberName, typeName, delta) => {
    const direction = delta > 0 ? '부여' : '차감';
    const reason = prompt(
      `${memberName} · ${typeName} · ${year}년\n잔여 휴가를 ${Math.abs(delta)}일 ${direction}합니다.\n\n사유를 입력하세요 (필수·감사 추적용):`,
      ''
    );
    if (reason == null) return; // 취소
    const trimmed = String(reason).trim();
    if (!trimmed) { toast('사유는 필수입니다'); return; }

    const res = await api('/api/admin-att-leave-balances', {
      method: 'PUT',
      body: { memberUid, leaveTypeId: typeId, year, deltaDays: delta, reason: trimmed },
    });
    if (!res.ok) { toast('조정 실패: ' + (res.data?.error || '')); return; }
    toast(`${memberName} · ${typeName} · ${delta > 0 ? '+' : ''}${delta}일 조정 완료`);
    await loadBalances();
  };

  window.awmOpenBalanceAdjust = (memberUid, typeId, year, memberName, typeName) => {
    document.getElementById('awmBalAdjMemberUid').value = memberUid;
    document.getElementById('awmBalAdjTypeId').value = typeId;
    document.getElementById('awmBalAdjYear').value = year;
    document.getElementById('awmBalAdjDelta').value = '';
    document.getElementById('awmBalAdjReason').value = '';
    setText('awmBalanceAdjustTarget', `${memberName} · ${typeName} · ${year}년`);
    showEl('awmBalanceAdjustForm');
    document.getElementById('awmBalanceAdjustForm').scrollIntoView({ behavior: 'smooth' });
  };

  async function saveBalanceAdjust() {
    const memberUid = document.getElementById('awmBalAdjMemberUid')?.value;
    const leaveTypeId = Number(document.getElementById('awmBalAdjTypeId')?.value);
    const year = Number(document.getElementById('awmBalAdjYear')?.value);
    const deltaDays = parseFloat(document.getElementById('awmBalAdjDelta')?.value);
    const reason = document.getElementById('awmBalAdjReason')?.value?.trim();

    if (!memberUid || !leaveTypeId || !year) { toast('대상 정보가 비어있습니다'); return; }
    if (!Number.isFinite(deltaDays) || deltaDays === 0) { toast('증감 일수를 입력하세요'); return; }
    /* R39 Stage 7: 사유 필수 검증 */
    if (!reason) { toast('사유는 필수입니다 (감사 추적용)'); return; }

    const btn = document.getElementById('awmBtnSaveBalanceAdjust');
    if (btn) btn.disabled = true;

    const res = await api('/api/admin-att-leave-balances', {
      method: 'PUT',
      body: { memberUid, leaveTypeId, year, deltaDays, reason },
    });
    if (!res.ok) {
      toast('조정 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('잔여 휴가가 조정되었습니다');
    if (btn) btn.disabled = false;
    hideEl('awmBalanceAdjustForm');
    await loadBalances();
  }

  /* ═══════════════════════════════════
     R38 A-2: 출퇴근 기록 (월/기간) 탭
  ═══════════════════════════════════ */
  async function initMonthRecordsTab() {
    window._awmMrInit = true;

    // 직원 드롭다운
    try {
      const res = await api('/api/admin-att-members');
      const members = res.data?.data?.members || res.data?.members || [];
      const sel = document.getElementById('awmMrMember');
      if (sel) {
        const opts = ['<option value="">— 직원 선택 —</option>'];
        members.forEach(m => {
          opts.push('<option value="' + m.uid + '">' + escHtml(m.name) + ' (' + escHtml(m.email || '') + ')</option>');
        });
        sel.innerHTML = opts.join('');
      }
    } catch (e) {
      console.warn('[월 기록] 직원 목록 로드 실패', e);
    }

    // 월 빠른 선택 — 최근 12개월
    const monthSel = document.getElementById('awmMrMonth');
    if (monthSel) {
      const now = new Date();
      const months = ['<option value="">— 월 선택 —</option>'];
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const ym = y + '-' + m;
        months.push('<option value="' + ym + '">' + y + '년 ' + (d.getMonth() + 1) + '월</option>');
      }
      monthSel.innerHTML = months.join('');

      monthSel.addEventListener('change', () => {
        const ym = monthSel.value;
        if (!ym) return;
        const [yy, mm] = ym.split('-').map(Number);
        const firstDay = new Date(yy, mm - 1, 1);
        const lastDay = new Date(yy, mm, 0);
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('awmMrFrom').value = firstDay.getFullYear() + '-' + pad(firstDay.getMonth() + 1) + '-' + pad(firstDay.getDate());
        document.getElementById('awmMrTo').value   = lastDay.getFullYear()  + '-' + pad(lastDay.getMonth() + 1)  + '-' + pad(lastDay.getDate());
      });
    }

    // 기본 기간 — 이번 달
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const pad = n => String(n).padStart(2, '0');
    const fromStr = firstDay.getFullYear() + '-' + pad(firstDay.getMonth() + 1) + '-01';
    const toStr   = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
    document.getElementById('awmMrFrom').value = fromStr;
    document.getElementById('awmMrTo').value   = toStr;

    document.getElementById('awmBtnMrLoad')?.addEventListener('click', loadMonthRecords);
    document.getElementById('awmBtnMrCsv')?.addEventListener('click', downloadMonthRecordsCsv);
  }

  // 기간 내 일자별 라인 빌드 (records + leaves 병합)
  function buildMonthLines(payload) {
    const dateFrom = payload.dateFrom;
    const dateTo   = payload.dateTo;
    const recs = Array.isArray(payload.records) ? payload.records : [];
    const leaves = Array.isArray(payload.leaves) ? payload.leaves : [];

    // 날짜 → 레코드 매핑
    const recByDate = new Map();
    recs.forEach(r => { recByDate.set(String(r.date).slice(0, 10), r); });

    // 날짜 → 휴가 매핑
    const leaveByDate = new Map();
    leaves.forEach(lv => {
      const start = new Date(String(lv.start_date).slice(0, 10) + 'T00:00:00');
      const end   = new Date(String(lv.end_date).slice(0, 10) + 'T00:00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        if (!leaveByDate.has(ds)) leaveByDate.set(ds, []);
        leaveByDate.get(ds).push(lv);
      }
    });

    // 기간 전체 일자 순회
    const fromDt = new Date(dateFrom + 'T00:00:00');
    const toDt   = new Date(dateTo + 'T00:00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const lines = [];
    for (let d = new Date(fromDt); d <= toDt; d.setDate(d.getDate() + 1)) {
      const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const r = recByDate.get(ds);
      const lvs = leaveByDate.get(ds) || [];
      lines.push({ date: ds, dayName: days[d.getDay()], record: r, leaves: lvs });
    }
    return lines;
  }

  function fmtMins(mins) {
    if (mins == null) return '—';
    const n = Number(mins);
    if (!isFinite(n) || n <= 0) return '—';
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h === 0) return m + '분';
    if (m === 0) return h + '시간';
    return h + '시간 ' + m + '분';
  }

  async function fetchMonthRecords() {
    const memberUid = document.getElementById('awmMrMember').value;
    const dateFrom  = document.getElementById('awmMrFrom').value;
    const dateTo    = document.getElementById('awmMrTo').value;
    if (!memberUid) { toast('직원을 선택하세요'); return null; }
    if (!dateFrom || !dateTo) { toast('기간을 선택하세요'); return null; }
    if (dateFrom > dateTo) { toast('기간 시작이 종료보다 늦습니다'); return null; }

    const qs = '?dateFrom=' + encodeURIComponent(dateFrom)
             + '&dateTo='   + encodeURIComponent(dateTo)
             + '&memberUid=' + encodeURIComponent(memberUid);
    const res = await api('/api/admin-att-records' + qs);
    if (!res.ok) {
      toast('조회 실패: ' + (res.data?.error || ''));
      return null;
    }
    const payload = res.data?.data || res.data || {};
    return { memberUid, payload };
  }

  async function loadMonthRecords() {
    const result = await fetchMonthRecords();
    if (!result) return;
    const payload = result.payload;
    const lines = buildMonthLines(payload);

    // 요약
    let workdays = 0, totalMins = 0, leaveDays = 0;
    lines.forEach(ln => {
      if (ln.record && ln.record.check_in_time) workdays++;
      if (ln.record && ln.record.working_mins) totalMins += Number(ln.record.working_mins) || 0;
      if (ln.leaves.length) leaveDays++;
    });
    document.getElementById('awmMrSummary').textContent =
      payload.dateFrom + ' ~ ' + payload.dateTo + ' · ' +
      '근무 ' + workdays + '일 / 휴가 ' + leaveDays + '일 / 총 근무시간 ' + fmtMins(totalMins);

    // 표
    const tbody = document.getElementById('awmMrBody');
    if (!lines.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="att-empty">기간 내 데이터 없음</td></tr>';
      return;
    }
    /* R39 Stage 5: drizzle .select() 응답은 camelCase. snake_case·camelCase 양쪽 호환. */
    const _g = (o, ca, sn) => (o && (o[ca] != null ? o[ca] : o[sn]));
    const memberSel = document.getElementById('awmMrMember');
    const memberName = memberSel ? (memberSel.options[memberSel.selectedIndex]?.text || '직원') : '직원';
    tbody.innerHTML = lines.map(ln => {
      const r = ln.record;
      const isWeekend = (ln.dayName === '토' || ln.dayName === '일');
      const dayColor = ln.dayName === '일' ? '#ef4444' : (ln.dayName === '토' ? '#3b82f6' : '#374151');
      let workMode = '—', status = '—', checkIn = '—', checkOut = '—', mins = '—', ot = '—';
      let mapCells = '—';
      if (r) {
        const wm  = _g(r, 'workMode', 'work_mode');
        const stt = r.status;
        const cit = _g(r, 'checkInTime', 'check_in_time');
        const cot = _g(r, 'checkOutTime', 'check_out_time');
        const wmins = _g(r, 'workingMins', 'working_mins');
        const otm = _g(r, 'overtimeMins', 'overtime_mins');
        const ciLat = _g(r, 'checkInLat', 'check_in_lat');
        const ciLng = _g(r, 'checkInLng', 'check_in_lng');
        const coLat = _g(r, 'checkOutLat', 'check_out_lat');
        const coLng = _g(r, 'checkOutLng', 'check_out_lng');
        const wpId  = _g(r, 'workplaceId', 'workplace_id');
        workMode = wm ? (MODE_LABEL[wm] || wm) : '—';
        status   = stt ? (STATUS_LABEL[stt] || stt) : '—';
        checkIn  = fmtTime(cit);
        checkOut = fmtTime(cot);
        mins     = fmtMins(wmins);
        ot       = otm ? fmtMins(otm) : '—';

        const inBtn = (ciLat != null && ciLng != null)
          ? `<button class="att-btn att-btn-default att-btn-sm" onclick="awmShowLiveLocation(${escAttr(JSON.stringify({
              name: memberName + ' — ' + ln.date, type:'in', lat:ciLat, lng:ciLng, workplaceId:wpId, workMode:wm,
            }))})" style="padding:2px 6px;font-size:11px" title="출근 위치">출</button>` : '';
        const outBtn = (coLat != null && coLng != null)
          ? `<button class="att-btn att-btn-default att-btn-sm" onclick="awmShowLiveLocation(${escAttr(JSON.stringify({
              name: memberName + ' — ' + ln.date, type:'out', lat:coLat, lng:coLng, workplaceId:wpId, workMode:wm,
            }))})" style="padding:2px 6px;font-size:11px;margin-left:3px" title="퇴근 위치">퇴</button>` : '';
        mapCells = (inBtn + outBtn) || '—';
      }
      const leaveTxt = ln.leaves.length
        ? ln.leaves.map(lv => (lv.is_half_day || lv.isHalfDay) ? '반차' : '휴가').join(', ')
        : '—';
      /* R39 Stage 7 A-2: 어드민 수정 버튼 / 슈퍼어드민 생성·삭제 (기록 유무로 분기) */
      const recId = r && r.id;
      const editBtn = recId
        ? `<button class="att-btn att-btn-default att-btn-sm" style="padding:2px 6px;font-size:11px;margin-left:3px" onclick="awmOpenRecordEdit(${recId})" title="어드민 직접 수정"></button>` +
          `<button class="att-btn att-btn-default att-btn-sm" style="padding:2px 6px;font-size:11px;margin-left:3px;color:#dc2626" onclick="awmDeleteRecord(${recId})" title="기록 삭제"></button>`
        : `<button class="att-btn att-btn-default att-btn-sm" style="padding:2px 6px;font-size:11px;margin-left:3px" onclick="awmCreateRecordForDate('${ln.date}')" title="기록 생성">＋</button>`;
      return '<tr' + (isWeekend ? ' style="background:#fafbfc"' : '') + '>' +
        '<td style="font-variant-numeric:tabular-nums">' + ln.date + '</td>' +
        '<td style="color:' + dayColor + ';font-weight:600">' + ln.dayName + '</td>' +
        '<td>' + escHtml(workMode) + '</td>' +
        '<td>' + escHtml(status) + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + checkIn + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + checkOut + '</td>' +
        '<td>' + mins + '</td>' +
        '<td>' + ot + '</td>' +
        '<td>' + (ln.leaves.length ? '<span style="color:#3b82f6;font-weight:600">' + leaveTxt + '</span>' : leaveTxt) + '</td>' +
        '<td>' + mapCells + editBtn + '</td>' +
      '</tr>';
    }).join('');
  }

  function csvEsc(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  async function downloadMonthRecordsCsv() {
    const result = await fetchMonthRecords();
    if (!result) return;
    const payload = result.payload;
    const lines = buildMonthLines(payload);
    const memberSel = document.getElementById('awmMrMember');
    const memberLabel = memberSel.options[memberSel.selectedIndex]?.text || result.memberUid;

    const header = ['날짜', '요일', '근무형태', '상태', '출근', '퇴근', '근무시간(분)', '야근(분)', '휴가'];
    const csvLines = [header.map(csvEsc).join(',')];
    /* R39 Stage 5: camelCase·snake_case 양쪽 호환 */
    const _g = (o, ca, sn) => (o && (o[ca] != null ? o[ca] : o[sn]));
    lines.forEach(ln => {
      const r = ln.record;
      const wm  = r ? _g(r, 'workMode', 'work_mode') : null;
      const stt = r && r.status;
      const cit = r ? _g(r, 'checkInTime', 'check_in_time') : null;
      const cot = r ? _g(r, 'checkOutTime', 'check_out_time') : null;
      const wmins = r ? _g(r, 'workingMins', 'working_mins') : null;
      const otm = r ? _g(r, 'overtimeMins', 'overtime_mins') : null;
      const workMode = wm ? (MODE_LABEL[wm] || wm) : '';
      const status   = stt ? (STATUS_LABEL[stt] || stt) : '';
      const checkIn  = cit ? fmtTime(cit) : '';
      const checkOut = cot ? fmtTime(cot) : '';
      const mins     = wmins != null ? wmins : '';
      const ot       = otm != null ? otm : '';
      const leaveTxt = ln.leaves.length
        ? ln.leaves.map(lv => (lv.is_half_day || lv.isHalfDay) ? '반차' : '휴가').join('; ')
        : '';
      csvLines.push([ln.date, ln.dayName, workMode, status, checkIn, checkOut, mins, ot, leaveTxt].map(csvEsc).join(','));
    });
    // UTF-8 BOM
    const blob = new Blob(['﻿' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '출퇴근_' + memberLabel.replace(/[<>:"/\\|?*]/g, '_') + '_' + payload.dateFrom + '_' + payload.dateTo + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('CSV 다운로드 완료');
  }

  /* ═══════════════════════════════════
     R39 Stage 7 A-2/A-3: 어드민 출퇴근 직접 수정 모달 + 직원 확인 요청
  ═══════════════════════════════════ */
  let _recEditCurrent = null; // { id, date, member }

  function _toLocalDateTimeInputValue(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      // datetime-local은 YYYY-MM-DDTHH:MM 로 표시 (브라우저 로컬 타임존)
      const pad = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (_) { return ''; }
  }

  window.awmOpenRecordEdit = async function (recordId) {
    if (!recordId) return;
    // 월별 표 데이터에서 해당 record 찾기 (이미 로드된 lines 사용)
    // 별도 API 호출 없이 client 상태에서 매칭 — buildMonthLines를 재계산
    // 단, 별도 호출 API가 없으니 직접 SELECT가 어려움 → 클라가 가진 last payload에서 추출
    // 가장 간단: 현재 month records 조회 결과 재활용
    let foundRec = null, foundDate = null;
    try {
      // memberUid·dateFrom·dateTo 그대로 재호출
      const memberUid = document.getElementById('awmMrMember').value;
      const dateFrom  = document.getElementById('awmMrFrom').value;
      const dateTo    = document.getElementById('awmMrTo').value;
      if (memberUid && dateFrom && dateTo) {
        const qs = '?dateFrom=' + encodeURIComponent(dateFrom)
                 + '&dateTo='   + encodeURIComponent(dateTo)
                 + '&memberUid=' + encodeURIComponent(memberUid);
        const res = await api('/api/admin-att-records' + qs);
        if (res.ok) {
          const payload = res.data?.data || res.data || {};
          const recs = Array.isArray(payload.records) ? payload.records : [];
          foundRec = recs.find(r => Number(r.id) === Number(recordId));
        }
      }
    } catch (e) { console.warn('[record-edit] 조회 실패', e); }

    if (!foundRec) { toast('해당 출퇴근 기록을 찾을 수 없습니다 (재조회 후 다시 시도)'); return; }

    const _g = (o, ca, sn) => (o && (o[ca] != null ? o[ca] : o[sn]));
    const cit = _g(foundRec, 'checkInTime', 'check_in_time');
    const cot = _g(foundRec, 'checkOutTime', 'check_out_time');
    const wm  = _g(foundRec, 'workMode', 'work_mode');
    const note = foundRec.note || '';
    foundDate = _g(foundRec, 'date', 'date');

    _recEditCurrent = {
      id: Number(recordId),
      date: foundDate,
      memberUid: _g(foundRec, 'memberUid', 'member_uid'),
    };

    document.getElementById('awmRecEditId').value = recordId;
    document.getElementById('awmRecEditMeta').innerHTML =
      '<strong>' + escHtml(_liveMemberName(_recEditCurrent.memberUid)) + '</strong> · '
      + escHtml(String(foundDate || '')).slice(0, 10);
    document.getElementById('awmRecEditCheckIn').value  = _toLocalDateTimeInputValue(cit);
    document.getElementById('awmRecEditCheckOut').value = _toLocalDateTimeInputValue(cot);
    document.getElementById('awmRecEditWorkMode').value = wm || '';
    document.getElementById('awmRecEditNote').value = note;
    document.getElementById('awmRecEditReason').value = '';

    document.getElementById('awmRecEditModal').style.display = 'flex';
  };

  function _closeRecEditModal() {
    document.getElementById('awmRecEditModal').style.display = 'none';
    _recEditCurrent = null;
  }

  async function _saveRecEdit() {
    if (!_recEditCurrent) return;
    const recordId = _recEditCurrent.id;
    const ci = document.getElementById('awmRecEditCheckIn').value;
    const co = document.getElementById('awmRecEditCheckOut').value;
    const wm = document.getElementById('awmRecEditWorkMode').value;
    const note = document.getElementById('awmRecEditNote').value;
    const reason = document.getElementById('awmRecEditReason').value.trim();

    if (!reason) { toast('사유는 필수입니다'); return; }

    const body = { recordId, reason };
    // datetime-local 입력은 로컬 타임존 — Date로 ISO 변환
    if (ci) body.checkInTime  = kstLocalToISO(ci);
    if (co) body.checkOutTime = kstLocalToISO(co);
    if (wm) body.workMode = wm;
    if (note !== '') body.note = note;

    const btn = document.getElementById('awmBtnRecEditSave');
    if (btn) btn.disabled = true;
    try {
      const res = await api('/api/admin-att-record-edit', { method: 'PATCH', body });
      if (!res.ok) { toast('수정 실패: ' + (res.data?.error || res.data?.detail || '')); return; }
      toast('출퇴근 기록이 수정되었습니다 (이력 적재 완료)');
      _closeRecEditModal();
      // 표 새로고침
      try { await loadMonthRecords(); } catch (_) {}
      try { await loadLiveStatus(); } catch (_) {}
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function _requestConfirm() {
    if (!_recEditCurrent) return;
    const message = prompt(
      '직원에게 보낼 안내 메시지를 입력하세요 (비워두면 기본 안내문 사용):',
      ''
    );
    if (message == null) return; // 취소

    const res = await api('/api/admin-att-record-request-confirm', {
      method: 'POST',
      body: { recordId: _recEditCurrent.id, message: message || '' },
    });
    if (!res.ok) { toast('알림 발송 실패: ' + (res.data?.error || res.data?.detail || '')); return; }
    toast('직원에게 확인 요청 알림을 보냈습니다');
  }

  /* ───────────────────────────────────────────────
     슈퍼어드민 출퇴근 기록 삭제 (D)
     ─────────────────────────────────────────────── */
  window.awmDeleteRecord = async function (recordId) {
    if (!recordId) return;
    const reason = prompt('이 출퇴근 기록을 삭제합니다. 삭제 사유를 입력하세요 (감사 추적용·필수):', '');
    if (reason == null) return;            // 취소
    if (!reason.trim()) { toast('삭제 사유는 필수입니다'); return; }
    if (!confirm('정말 이 기록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;

    const res = await api('/api/admin-att-record-edit', {
      method: 'DELETE',
      body: { recordId: Number(recordId), reason: reason.trim() },
    });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || res.data?.detail || '')); return; }
    toast('출퇴근 기록이 삭제되었습니다');
    try { await loadMonthRecords(); } catch (_) {}
  };

  /* ───────────────────────────────────────────────
     슈퍼어드민 출퇴근 기록 생성 (C) — 기록 없는 날짜에 직접 추가
     ─────────────────────────────────────────────── */
  let _recCreateCtx = null;  // { memberUid, date }

  window.awmCreateRecordForDate = function (dateStr) {
    const memberUid = document.getElementById('awmMrMember')?.value;
    if (!memberUid) { toast('먼저 직원을 선택하세요'); return; }
    if (!dateStr) return;
    _recCreateCtx = { memberUid, date: dateStr };

    const memberSel = document.getElementById('awmMrMember');
    const memberName = memberSel ? (memberSel.options[memberSel.selectedIndex]?.text || '직원') : '직원';
    setText('awmRecCreateMeta', memberName + ' · ' + dateStr);
    // 폼 초기화
    document.getElementById('awmRecCreateWorkMode').value = 'OFFICE';
    // datetime-local 기본값 = 해당 날짜 09:00 / 18:00
    document.getElementById('awmRecCreateCheckIn').value  = dateStr + 'T09:00';
    document.getElementById('awmRecCreateCheckOut').value = dateStr + 'T18:00';
    document.getElementById('awmRecCreateNote').value = '';
    document.getElementById('awmRecCreateReason').value = '';
    document.getElementById('awmRecCreateModal').style.display = 'flex';
  };

  function _closeRecCreateModal() {
    document.getElementById('awmRecCreateModal').style.display = 'none';
    _recCreateCtx = null;
  }

  async function _saveRecCreate() {
    if (!_recCreateCtx) return;
    const ci = document.getElementById('awmRecCreateCheckIn').value;
    const co = document.getElementById('awmRecCreateCheckOut').value;
    const wm = document.getElementById('awmRecCreateWorkMode').value;
    const note = document.getElementById('awmRecCreateNote').value;
    const reason = document.getElementById('awmRecCreateReason').value.trim();
    if (!reason) { toast('생성 사유는 필수입니다'); return; }

    const body = { memberUid: _recCreateCtx.memberUid, date: _recCreateCtx.date, reason };
    if (wm) body.workMode = wm;
    if (ci) body.checkInTime  = kstLocalToISO(ci);
    if (co) body.checkOutTime = kstLocalToISO(co);
    if (note !== '') body.note = note;

    const btn = document.getElementById('awmBtnRecCreateSave');
    if (btn) btn.disabled = true;
    try {
      const res = await api('/api/admin-att-record-edit', { method: 'POST', body });
      if (!res.ok) { toast('생성 실패: ' + (res.data?.error || res.data?.detail || '')); return; }
      toast('출퇴근 기록이 생성되었습니다');
      _closeRecCreateModal();
      try { await loadMonthRecords(); } catch (_) {}
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ═══════════════════════════════════
     R39 Stage 5 A-1: 실시간 출퇴근 현황 (자동 새로고침 30초)
     ═══════════════════════════════════ */
  var _liveTimer = null;
  var _liveMembersById = {}; // 직원 uid → { name, email, role }
  var _liveWorkplacesById = {}; // 거점 id → { name, lat, lng }
  var _liveOrderedRows = []; // 전체보기용 — 오늘 출근 기록 행(좌표 포함)

  async function loadLiveMembersAndPlaces() {
    // 직원 목록 1회 로드 후 캐싱
    try {
      const resM = await api('/api/admin-att-members');
      const list = resM.data?.data?.members || resM.data?.members || [];
      list.forEach(m => { _liveMembersById[String(m.uid || m.id)] = m; });
    } catch (e) { console.warn('[실시간] 직원 목록 로드 실패', e); }

    // 거점 목록 — 위치 보기에서 거점 핀 표시용
    try {
      const resW = await api('/api/admin-att-workplaces');
      const wps = resW.data?.data?.workplaces || resW.data?.workplaces || [];
      wps.forEach(w => { _liveWorkplacesById[Number(w.id)] = w; });
    } catch (e) { console.warn('[실시간] 거점 목록 로드 실패', e); }
  }

  function _liveMemberName(uid) {
    const m = _liveMembersById[String(uid)];
    return (m && m.name) || ('직원 #' + uid);
  }

  async function loadLiveStatus() {
    const today = toDateStr();
    const res = await api(`/api/admin-att-records?date=${today}`);
    const payload = res.data?.data || res.data || {};
    const rows = Array.isArray(payload.records) ? payload.records : [];

    // 분류: 출근 중·퇴근 완료
    let working = [], done = [];
    rows.forEach(r => {
      // attRecords는 camelCase로 반환됨 (checkInTime·checkOutTime·workMode·memberUid·workplaceId)
      if (r.checkInTime) {
        if (r.checkOutTime) done.push(r);
        else working.push(r);
      }
    });

    // 미출근 = 활성 직원 - 오늘 출근 기록 보유 직원
    const todayUids = new Set(rows.filter(r => r.checkInTime).map(r => String(r.memberUid)));
    const allActive = Object.values(_liveMembersById);
    const absent = allActive.filter(m => !todayUids.has(String(m.uid || m.id)));

    setText('awmLiveCntWorking', working.length);
    setText('awmLiveCntDone', done.length);
    setText('awmLiveCntAbsent', absent.length);

    // 갱신 시각 표시
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    setText('awmLiveRefreshAt', '갱신: ' + hh + ':' + mm + ':' + ss);

    // 표 렌더
    const tbody = document.getElementById('awmLiveBody');
    if (!tbody) return;

    // 출근 중 → 퇴근 완료 순 정렬, 미출근은 아래
    const ordered = working.concat(done);
    _liveOrderedRows = ordered;   // 전체보기용 저장

    if (ordered.length === 0 && absent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="att-empty">오늘 등록된 직원이 없습니다</td></tr>';
      return;
    }

    let html = '';
    ordered.forEach(r => {
      const name = _liveMemberName(r.memberUid);
      const modeTag = `<span class="awm-tag ${r.workMode || ''}">${MODE_LABEL[r.workMode] || r.workMode || '—'}</span>`;
      const statusBadge = r.checkOutTime
        ? '<span class="att-badge holiday" style="background:#f3f4f6;color:#6b7280">퇴근</span>'
        : '<span class="att-badge normal" style="background:#dcfce7;color:#15803d">근무 중</span>';
      const checkInBtn = r.checkInTime
        ? `<button class="att-btn att-btn-default att-btn-sm" onclick="awmShowLiveLocation(${escAttr(JSON.stringify({
            name, type:'in', lat:r.checkInLat, lng:r.checkInLng, workplaceId:r.workplaceId, workMode:r.workMode,
          }))})" style="padding:3px 8px;font-size:11px" title="출근 위치 보기">출근</button>`
        : '—';
      const checkOutBtn = r.checkOutTime
        ? `<button class="att-btn att-btn-default att-btn-sm" onclick="awmShowLiveLocation(${escAttr(JSON.stringify({
            name, type:'out', lat:r.checkOutLat, lng:r.checkOutLng, workplaceId:r.workplaceId, workMode:r.workMode,
          }))})" style="padding:3px 8px;font-size:11px" title="퇴근 위치 보기">퇴근</button>`
        : '—';
      html += `<tr>
        <td style="font-weight:600"><a href="javascript:void(0)" onclick="awmGoToMemberRecords('${String(r.memberUid)}')" style="color:#c2410c;cursor:pointer;text-decoration:none" title="이 직원의 출퇴근 기록 보기">${escHtml(name)}</a></td>
        <td>${modeTag}</td>
        <td>${statusBadge}</td>
        <td>${fmtTime(r.checkInTime)}</td>
        <td>${fmtTime(r.checkOutTime)}</td>
        <td>${checkInBtn} ${checkOutBtn}</td>
      </tr>`;
    });
    absent.forEach(m => {
      html += `<tr style="opacity:.65">
        <td style="font-weight:600"><a href="javascript:void(0)" onclick="awmGoToMemberRecords('${String(m.uid || m.id)}')" style="color:#c2410c;cursor:pointer;text-decoration:none" title="이 직원의 출퇴근 기록 보기">${escHtml(m.name)}</a></td>
        <td><span style="color:#9ca3af;font-size:12px">—</span></td>
        <td><span class="att-badge absent" style="background:#fee2e2;color:#b91c1c">미출근</span></td>
        <td>—</td><td>—</td><td>—</td>
      </tr>`;
    });
    tbody.innerHTML = html;
  }

  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /** 실시간 표에서 호출 — 위치 모달 오픈 (인자가 JSON 문자열로 직렬화되어 들어옴) */
  window.awmShowLiveLocation = function (jsonStr) {
    let data;
    try { data = (typeof jsonStr === 'string') ? JSON.parse(jsonStr) : jsonStr; } catch (_) { return; }
    if (!window.AttMap) { alert('지도 헬퍼 로드 실패'); return; }

    const place = data.workplaceId ? _liveWorkplacesById[Number(data.workplaceId)] : null;
    window.AttMap.show({
      title: data.name + ' — ' + (data.type === 'in' ? '출근' : '퇴근') + ' 위치',
      userLat: data.lat, userLng: data.lng,
      placeLat: place ? place.lat : null,
      placeLng: place ? place.lng : null,
      placeName: place ? place.name : null,
      workMode: data.workMode,
    });
  };

  /** 전체보기 — 좌표가 기록된 모든 직원의 출퇴근 위치를 한 지도에 표시 */
  window.awmShowAllLocations = function () {
    if (!window.AttMap || !window.AttMap.showAll) { alert('지도 헬퍼 로드 실패'); return; }
    const points = [];
    (_liveOrderedRows || []).forEach(function (r) {
      const name = _liveMemberName(r.memberUid);
      if (r.checkInLat != null && r.checkInLng != null) points.push({ name: name, lat: r.checkInLat, lng: r.checkInLng, type: 'in', workMode: r.workMode });
      if (r.checkOutLat != null && r.checkOutLng != null) points.push({ name: name, lat: r.checkOutLat, lng: r.checkOutLng, type: 'out', workMode: r.workMode });
    });
    if (points.length === 0) { toast('좌표가 기록된 출퇴근이 없습니다 (재택·구버전 기록은 좌표 미수집)'); return; }
    window.AttMap.showAll({ title: '전체 출퇴근 위치 — ' + toDateStr(), points: points });
  };

  /** 실시간 현황에서 직원 이름 클릭 → '출퇴근 기록' 탭으로 이동 + 해당 직원 자동 조회 */
  window.awmGoToMemberRecords = async function (memberUid) {
    const uid = String(memberUid);
    const tabBtn = document.querySelector('.att-tab[data-tab="monthrecords"]');
    if (tabBtn) tabBtn.click();   // 탭 전환 + lazy init 트리거
    // 직원 드롭다운이 채워질 때까지 대기 (initMonthRecordsTab 내부 비동기 로드 완료 보장)
    const sel = document.getElementById('awmMrMember');
    for (let i = 0; i < 40; i++) {
      if (sel && sel.options.length > 1) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (!sel || sel.options.length <= 1) { toast('직원 목록 로딩 실패 — 다시 시도해 주세요'); return; }
    sel.value = uid;
    if (sel.value !== uid) { toast('해당 직원의 출퇴근 기록을 찾을 수 없습니다'); return; }
    await loadMonthRecords();
  };

  function startLiveAutoRefresh() {
    stopLiveAutoRefresh();
    _liveTimer = setInterval(function () {
      if (document.visibilityState !== 'visible') return; // 비활성 탭은 새로고침 스킵 (배터리)
      // 근태 현황 탭 활성 상태일 때만
      const recPanel = document.getElementById('awmPanelRecords');
      if (!recPanel || !recPanel.classList.contains('active')) return;
      loadLiveStatus().catch(function (e) { console.warn('[실시간 새로고침]', e); });
    }, 30_000);
  }
  function stopLiveAutoRefresh() {
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
  }

  async function initLiveStatus() {
    await loadLiveMembersAndPlaces();
    await loadLiveStatus();
    document.getElementById('awmBtnLiveRefresh')?.addEventListener('click', loadLiveStatus);
    document.getElementById('awmBtnLiveMap')?.addEventListener('click', window.awmShowAllLocations);
    startLiveAutoRefresh();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        // 다시 활성화 시 즉시 1회 갱신
        const recPanel = document.getElementById('awmPanelRecords');
        if (recPanel && recPanel.classList.contains('active')) {
          loadLiveStatus().catch(function () {});
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     흡수: 재택보고서 모니터링 (구 admin-attendance-settings.js)
     ═══════════════════════════════════════════════════════════ */
  var _rrCurrentId = null;

  async function loadAttMemberList(selId) {
    try {
      const res = await apiThrow('/api/admin-att-members');
      const members = (res.data && res.data.members) || res.members || [];
      const sel = document.getElementById(selId);
      if (!sel) return;
      sel.innerHTML = '<option value="">-- 직원 선택 --</option>';
      members.forEach(function (m) {
        const opt = document.createElement('option');
        opt.value = m.uid || m.id;
        opt.textContent = (m.name || m.username || '?') + ' (' + (m.email || '') + ')';
        sel.appendChild(opt);
      });
    } catch (e) {
      console.warn('[loadAttMemberList]', e.message);
    }
  }

  async function loadRemoteReports(memberUid) {
    const startDate = document.getElementById('rrStartDate').value;
    const endDate = document.getElementById('rrEndDate').value;
    const status = document.getElementById('rrStatusFilter').value;
    const tbody = document.getElementById('rrListBody');
    tbody.innerHTML = '<tr><td colspan="6" class="att-empty">조회 중...</td></tr>';

    loadRemotePending();   // 미제출 현황도 함께 갱신

    try {
      let qs = '?memberUid=' + encodeURIComponent(memberUid || '');
      if (startDate) qs += '&startDate=' + startDate;
      if (endDate)   qs += '&endDate='   + endDate;
      if (status)    qs += '&status='    + status;

      const res = await apiThrow('/api/admin/att/remote-reports' + qs);
      const rows = (res.data && Array.isArray(res.data.data)) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
      renderReportList(rows);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + escHtml(e.message) + '</td></tr>';
    }
  }

  /* ─── 미제출 현황 (기한 임박·경과) + 예외 인정 ───
     2026-07-12: 재택보고서를 내지 않으면 그 날은 근무로 인정하지 않는다(재택일 +3일 마감).
     관리자는 여기서 누가 언제까지 내야 하는지 보고, 사정이 있는 건은 예외 인정으로 근무를 되살린다. */
  var RR_TONE = {
    danger: { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' },
    warn:   { bg: '#fffbeb', bd: '#fde68a', fg: '#b45309' },
    info:   { bg: '#f0f9ff', bd: '#bae6fd', fg: '#0369a1' },
    closed: { bg: '#f3f4f6', bd: '#d1d5db', fg: '#6b7280' },
  };

  async function loadRemotePending() {
    const box = document.getElementById('rrPendingBox');
    if (!box) return;
    try {
      const res = await apiThrow('/api/admin/att/remote-reports?pending=1');
      const d = (res.data && res.data.data) || res.data || {};
      const list = d.list || [];
      if (list.length === 0) { box.style.display = 'none'; return; }

      const row = function (x) {
        const t = RR_TONE[x.badgeTone] || RR_TONE.info;
        return '<tr>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">' + escHtml(x.memberName) + '</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">' + escHtml(x.date) + '</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#6b7280;font-size:12px">' + escHtml(x.deadline) + ' 자정</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">' +
            '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;' +
            'background:' + t.bg + ';border:1px solid ' + t.bd + ';color:' + t.fg + '">' + escHtml(x.badgeText) + '</span>' +
            (x.hasDraft ? ' <span style="font-size:11px;color:#9ca3af">임시저장 있음</span>' : '') +
          '</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center">' +
            (x.closed
              ? '<button type="button" class="rr-exempt" data-uid="' + escHtml(x.memberUid) + '" data-date="' + escHtml(x.date) + '" data-name="' + escHtml(x.memberName) + '" ' +
                'style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:4px 10px;border-radius:6px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit">예외 인정</button>'
              : '<span style="font-size:11.5px;color:#9ca3af">제출 대기</span>') +
          '</td></tr>';
      };

      const closed = list.filter(function (x) { return x.closed; });
      box.innerHTML =
        '<div style="padding:14px 16px;border-radius:10px;background:#fff;border:1px solid ' + (closed.length ? '#fecaca' : '#e5e7eb') + '">' +
          '<div style="font-size:13.5px;font-weight:700;color:#111827;margin-bottom:4px">' +
            '재택보고서 미제출 현황 — 대기 ' + d.openCount + '건' +
            (d.unrecognizedCount ? ' · <span style="color:#b91c1c">근무 불인정 ' + d.unrecognizedCount + '건</span>' : '') +
          '</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;line-height:1.6">' +
            '재택일로부터 ' + (d.deadlineDays || 3) + '일 안에 보고서를 내지 않으면 그 날은 근무로 인정되지 않습니다(급여 산정 제외). ' +
            '사정이 있으면 [예외 인정]으로 근무를 되살릴 수 있습니다.' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
            '<thead><tr style="background:#f9fafb">' +
              '<th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">직원</th>' +
              '<th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">재택일</th>' +
              '<th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">제출 마감</th>' +
              '<th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">상태</th>' +
              '<th style="padding:7px 10px;text-align:center;font-size:12px;color:#6b7280">처리</th>' +
            '</tr></thead><tbody>' + list.map(row).join('') + '</tbody></table>' +
        '</div>';
      box.style.display = 'block';

      box.querySelectorAll('.rr-exempt').forEach(function (btn) {
        btn.addEventListener('click', function () {
          exemptRemoteDay(btn.dataset.uid, btn.dataset.date, btn.dataset.name);
        });
      });
    } catch (e) {
      box.style.display = 'none';
      console.warn('[loadRemotePending]', e.message);
    }
  }

  async function exemptRemoteDay(memberUid, date, memberName) {
    const reason = prompt(
      memberName + ' 님의 ' + date + ' 재택근무를 예외 인정합니다.\n\n' +
      '보고서 미제출로 근무 불인정된 날을 다시 근무로 인정합니다.\n' +
      '(급여 재집계 시 출근일에 다시 포함됩니다)\n\n' +
      '인정 사유를 입력하세요 (기록에 남습니다):', '');
    if (reason == null) return;
    if (!String(reason).trim()) { toast('예외 인정 사유는 필수입니다'); return; }

    try {
      await apiThrow('/api/admin/att/remote-reports?action=exempt', {
        method: 'POST',
        body: { memberUid: memberUid, date: date, reason: String(reason).trim() },
      });
      toast('예외 인정 완료 — 급여 재집계 시 근무일에 다시 포함됩니다');
      loadRemotePending();
      const sel = document.getElementById('rrMemberSel');
      if (sel) loadRemoteReports(sel.value);
    } catch (e) {
      toast('예외 인정 실패: ' + e.message);
    }
  }

  function renderReportList(rows) {
    const tbody = document.getElementById('rrListBody');
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="att-empty">보고서가 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      const statusBadge = r.status === 'SUBMITTED'
        ? '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600">제출완료</span>'
        : '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600">임시저장</span>';
      const star = r.isStarred ? '' : Icons.svg('star');
      const score = r.qualityScore != null ? r.qualityScore : '—';
      return '<tr>'
        + '<td style="font-family:Inter;font-size:13px">' + escHtml(r.date || '—') + '</td>'
        + '<td style="font-weight:500">' + escHtml(r.memberName || r.name || '—') + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="text-align:center;font-weight:600;color:#2563eb">' + score + '</td>'
        + '<td style="text-align:center;font-size:16px;cursor:pointer" onclick="toggleStar(' + r.id + ',' + (r.isStarred ? 'true' : 'false') + ')" title="별표 토글">' + star + '</td>'
        + '<td><button class="att-btn att-btn-default att-btn-sm" onclick="openReportDetail(' + r.id + ',\'' + escHtml(r.date) + '\',\'' + escHtml(r.memberName || '') + '\')">상세</button></td>'
        + '</tr>';
    }).join('');
  }

  function renderReportDetail(report) {
    const area = document.getElementById('rrDetailArea');
    const title = document.getElementById('rrDetailTitle');
    const content = document.getElementById('rrDetailContent');
    const noteInput = document.getElementById('rrNoteInput');
    if (!area) return;
    area.style.display = '';
    if (title) title.textContent = (report.date || '') + ' — ' + (report.memberName || report.name || '');
    if (content) content.textContent = report.content || report.aiDraft || '(내용 없음)';
    if (noteInput) noteInput.value = report.supervisorNote || '';
  }

  window.toggleStar = async function (id, currentStarred) {
    try {
      await apiThrow('/api/admin/att/remote-reports', { method: 'PUT', body: { id: id, isStarred: !currentStarred } });
      toast(!currentStarred ? '별표 추가됨' : '별표 제거됨');
      const memberUid = document.getElementById('rrMemberSel').value;
      await loadRemoteReports(memberUid);
    } catch (e) { toast('별표 변경 실패: ' + e.message); }
  };

  window.openReportDetail = async function (id, date, memberName) {
    _rrCurrentId = id;
    try {
      const res = await apiThrow('/api/admin/att/remote-reports?id=' + id);
      const report = (res.data && (res.data.data || res.data)) || { id: id, date: date, memberName: memberName };
      renderReportDetail(report);
    } catch (e) {
      renderReportDetail({ id: id, date: date, memberName: memberName });
    }
  };

  async function starReport(id, isStarred) {
    await apiThrow('/api/admin/att/remote-reports', { method: 'PUT', body: { id: id, isStarred: isStarred } });
  }

  async function addSupervisorNote(id, note) {
    await apiThrow('/api/admin/att/remote-reports', { method: 'PUT', body: { id: id, supervisorNote: note } });
  }

  function initRemoteReportsTab() {
    window._awmRrInit = true;
    loadAttMemberList('rrMemberSel');
    /* 직원을 고르지 않아도 미제출·불인정 현황은 바로 보여야 한다 (운영자가 놓치지 않게) */
    loadRemotePending();

    // 기본 날짜: 이번 달 1일 ~ 오늘
    (function () {
      const now = new Date();
      const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const startEl = document.getElementById('rrStartDate');
      const endEl = document.getElementById('rrEndDate');
      if (startEl) startEl.value = y + '-' + m + '-01';
      if (endEl) endEl.value = y + '-' + m + '-' + d;
    })();

    document.getElementById('btnRrSearch')?.addEventListener('click', function () {
      const uid = document.getElementById('rrMemberSel').value;
      if (!uid) { toast('직원을 선택하세요'); return; }
      loadRemoteReports(uid);
    });

    document.getElementById('rrBtnCloseDetail')?.addEventListener('click', function () {
      document.getElementById('rrDetailArea').style.display = 'none';
      _rrCurrentId = null;
    });

    document.getElementById('rrBtnStar')?.addEventListener('click', async function () {
      if (!_rrCurrentId) return;
      try {
        await starReport(_rrCurrentId, true);
        toast('별표 추가됨');
      } catch (e) { toast('실패: ' + e.message); }
    });

    document.getElementById('rrBtnSaveNote')?.addEventListener('click', async function () {
      if (!_rrCurrentId) { toast('보고서를 먼저 선택하세요'); return; }
      const note = document.getElementById('rrNoteInput').value.trim();
      try {
        await addSupervisorNote(_rrCurrentId, note);
        toast('코멘트 저장 완료');
      } catch (e) { toast('저장 실패: ' + e.message); }
    });
  }

  /* ─── 초기화 ─── */
  async function init() {
    /* 2026-06-02 fix(탭 깜빡임): 그룹 필터를 인증·데이터 API 대기 '전에' 즉시 적용.
       기존엔 checkAuth/initRecordsTab/initLiveStatus(수 초)를 다 기다린 뒤 필터해서
       그동안 ops+config 탭이 전부 보이다가 뒤늦게 걸러지는 깜빡임 발생. */
    setupTabs();
    const group = new URLSearchParams(location.search).get('group') || 'ops';
    applyGroupFilter(group);
    document.getElementById('awmBackToOps')?.addEventListener('click', function () {
      const url = new URL(location.href);
      url.searchParams.set('group', 'ops');
      history.replaceState(null, '', url);
      applyGroupFilter('ops');
    });

    const admin = await checkAuth();
    if (!admin) return;

    await initRecordsTab();
    await initLiveStatus();

    /* R39 Stage 7: 어드민 출퇴근 수정 모달 이벤트 */
    document.getElementById('awmBtnRecEditClose')?.addEventListener('click', _closeRecEditModal);
    document.getElementById('awmBtnRecEditCancel')?.addEventListener('click', _closeRecEditModal);
    document.getElementById('awmBtnRecEditSave')?.addEventListener('click', _saveRecEdit);
    document.getElementById('awmBtnRecRequestConfirm')?.addEventListener('click', _requestConfirm);
    document.getElementById('awmRecEditModal')?.addEventListener('click', function (e) {
      if (e.target === this) _closeRecEditModal();
    });

    /* 슈퍼어드민 출퇴근 기록 생성 모달 이벤트 */
    document.getElementById('awmBtnRecCreateClose')?.addEventListener('click', _closeRecCreateModal);
    document.getElementById('awmBtnRecCreateCancel')?.addEventListener('click', _closeRecCreateModal);
    document.getElementById('awmBtnRecCreateSave')?.addEventListener('click', _saveRecCreate);
    document.getElementById('awmRecCreateModal')?.addEventListener('click', function (e) {
      if (e.target === this) _closeRecCreateModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
