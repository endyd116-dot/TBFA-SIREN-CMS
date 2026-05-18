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
    return new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  function toDateStr(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 10);
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

  const MODE_LABEL = { OFFICE: '🏢 사무실', REMOTE: '🏠 재택', FIELD: '🚗 외근', HYBRID: '🔀 혼합', BUSINESS_TRIP: '✈️ 출장', FLEXIBLE: '⏱ 탄력' };
  const STATUS_LABEL = { NORMAL: '정상', LATE: '지각', ABSENT: '결근', LEAVE: '휴가', REMOTE: '재택', FIELD: '외근', HOLIDAY: '공휴일' };
  const STATUS_CLASS = { NORMAL: 'normal', LATE: 'late', ABSENT: 'absent', LEAVE: 'leave', REMOTE: 'remote', FIELD: 'field', HOLIDAY: 'holiday' };

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

        if (btn.dataset.tab === 'schedule' && !window._awmSchInit) initScheduleTab();
        if (btn.dataset.tab === 'workplaces' && !window._awmWpInit) initWorkplacesTab();
        if (btn.dataset.tab === 'policy' && !window._awmPolInit) initPolicyTab();
        if (btn.dataset.tab === 'leavetypes' && !window._awmLtInit) initLeaveTypesTab();
        if (btn.dataset.tab === 'holidays' && !window._awmHolInit) initHolidaysTab();
      });
    });
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
    const rows = res.data?.data || res.data?.records || res.data || [];
    const summary = res.data?.summary || {};

    setText('awmCntCheckin', summary.checkinCount ?? (Array.isArray(rows) ? rows.filter(r => r.checkinAt).length : '—'));
    setText('awmCntLate', summary.lateCount ?? (Array.isArray(rows) ? rows.filter(r => r.status === 'LATE').length : '—'));
    setText('awmCntAbsent', summary.absentCount ?? (Array.isArray(rows) ? rows.filter(r => r.status === 'ABSENT').length : '—'));
    setText('awmCntLeave', summary.leaveCount ?? (Array.isArray(rows) ? rows.filter(r => r.status === 'LEAVE').length : '—'));

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
    const res = await api('/api/admin-att-amend-requests?status=PENDING');
    const rows = res.data?.data || res.data || [];
    const cntEl = document.getElementById('awmPendingAmendCount');
    if (cntEl) cntEl.textContent = `${Array.isArray(rows) ? rows.length : 0}건`;

    const tbody = document.getElementById('awmPendingAmendBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="att-empty">대기 중인 요청이 없습니다</td></tr>';
      return;
    }
    const typeLabel = { CHECKIN: '출근', CHECKOUT: '퇴근', BOTH: '출퇴근' };
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.memberName || '—')}</td>
        <td>${escHtml(r.targetDate || '—')}</td>
        <td>${typeLabel[r.amendType] || r.amendType || '—'}</td>
        <td style="font-size:12px">
          ${r.requestedCheckin ? '출근 ' + fmtTime(r.requestedCheckin) : ''}
          ${r.requestedCheckout ? '<br>퇴근 ' + fmtTime(r.requestedCheckout) : ''}
        </td>
        <td>${escHtml(r.reason || '—')}</td>
        <td>
          <button class="att-btn att-btn-primary att-btn-sm" onclick="awmApproveAmend(${r.id})">승인</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmRejectAmend(${r.id})">반려</button>
        </td>
      </tr>`).join('');
  }

  window.awmApproveAmend = async (id) => {
    if (!confirm('이 수정 요청을 승인하시겠습니까?')) return;
    const res = await api(`/api/admin-att-amend-requests/${id}/approve`, { method: 'POST' });
    if (!res.ok) { toast('승인 실패: ' + (res.data?.error || '')); return; }
    toast('승인되었습니다');
    await loadPendingAmends();
  };

  window.awmRejectAmend = async (id) => {
    const reason = prompt('반려 사유를 입력하세요 (선택)');
    const res = await api(`/api/admin-att-amend-requests/${id}/reject`, { method: 'POST', body: { reason: reason || '' } });
    if (!res.ok) { toast('반려 실패: ' + (res.data?.error || '')); return; }
    toast('반려되었습니다');
    await loadPendingAmends();
  };

  /* ═══════════════════════════════════
     탭 2: 직원 스케줄
  ═══════════════════════════════════ */
  async function initScheduleTab() {
    window._awmSchInit = true;
    await loadMemberDropdown('awmScheduleMember');

    document.getElementById('awmScheduleMode')?.addEventListener('change', (e) => {
      const hybrid = document.getElementById('awmHybridConfig');
      if (hybrid) hybrid.style.display = e.target.value === 'HYBRID' ? '' : 'none';
    });

    const today = toDateStr();
    const fromEl = document.getElementById('awmScheduleFrom');
    if (fromEl) fromEl.value = today;

    document.getElementById('awmBtnSaveSchedule')?.addEventListener('click', saveSchedule);
    await loadScheduleList();
  }

  async function loadMemberDropdown(selId) {
    const res = await api('/api/admin-att-members');
    const members = res.data?.data || res.data || [];
    const sel = document.getElementById(selId);
    if (!sel || !Array.isArray(members)) return;
    while (sel.options.length > 1) sel.remove(1);
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.uid || m.id;
      opt.textContent = m.name || m.username || m.uid;
      sel.appendChild(opt);
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
      const days = {};
      document.querySelectorAll('[name="hybridDay"]:checked').forEach(cb => {
        const day = cb.value;
        const modeEl = document.querySelector(`.hybrid-day-mode[data-day="${day}"]`);
        days[day] = modeEl ? modeEl.value : 'OFFICE';
      });
      hybridConfig = days;
    }

    const btn = document.getElementById('awmBtnSaveSchedule');
    if (btn) btn.disabled = true;

    const res = await api('/api/admin-att-member-schedule', {
      method: 'POST',
      body: { memberUid: uid, mode, fromDate: from, toDate: to || null, hybridConfig },
    });
    if (!res.ok) {
      toast('저장 실패: ' + (res.data?.error || ''));
      if (btn) btn.disabled = false;
      return;
    }
    toast('스케줄이 저장되었습니다');
    if (btn) btn.disabled = false;
    await loadScheduleList();
  }

  async function loadScheduleList() {
    const res = await api('/api/admin-att-member-schedule');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('awmScheduleListBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="att-empty">설정된 스케줄이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.memberName || r.memberUid || '—')}</td>
        <td><span class="awm-tag ${r.mode || ''}">${MODE_LABEL[r.mode] || r.mode || '—'}</span></td>
        <td>${escHtml(r.fromDate || '—')} ~ ${escHtml(r.toDate || '계속')}</td>
      </tr>`).join('');
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
    document.getElementById('awmBtnGeocode')?.addEventListener('click', doGeocode);
    document.getElementById('awmBtnSaveWorkplace')?.addEventListener('click', saveWorkplace);
  }

  async function loadWorkplaces() {
    const res = await api('/api/admin-att-workplaces');
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
        <td style="font-size:12px;color:#6b7280">${r.lat ? r.lat.toFixed(5) + ', ' + r.lng.toFixed(5) : '—'}</td>
        <td>
          <button class="att-btn att-btn-default att-btn-sm" onclick="awmEditWorkplace(${r.id})">수정</button>
          <button class="att-btn att-btn-danger att-btn-sm" style="margin-left:4px" onclick="awmDeleteWorkplace(${r.id})">삭제</button>
        </td>
      </tr>`).join('');
    window._awmWpRows = rows;
  }

  function clearWpForm() {
    ['awmWpId', 'awmWpName', 'awmWpAddress', 'awmWpRadius', 'awmWpLat', 'awmWpLng'].forEach(id => {
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
    document.getElementById('awmWpRadius').value = row.radius || 200;
    document.getElementById('awmWpLat').value = row.lat || '';
    document.getElementById('awmWpLng').value = row.lng || '';
    setText('awmWorkplaceFormTitle', '거점 수정');
    showEl('awmWorkplaceForm');
    document.getElementById('awmWorkplaceForm').scrollIntoView({ behavior: 'smooth' });
  };

  window.awmDeleteWorkplace = async (id) => {
    if (!confirm('이 거점을 삭제하시겠습니까?')) return;
    const res = await api(`/api/admin-att-workplaces/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || '')); return; }
    toast('삭제되었습니다');
    await loadWorkplaces();
  };

  async function doGeocode() {
    const address = document.getElementById('awmWpAddress')?.value?.trim();
    if (!address) { toast('주소를 입력하세요'); return; }
    const btn = document.getElementById('awmBtnGeocode');
    if (btn) btn.disabled = true;
    const res = await api('/api/att-geocode', { method: 'POST', body: { address } });
    if (btn) btn.disabled = false;
    const coords = res.data?.data || res.data || {};
    if (!res.ok || !coords.lat) {
      toast('좌표를 찾을 수 없습니다. 주소를 확인하세요.');
      return;
    }
    const latEl = document.getElementById('awmWpLat');
    const lngEl = document.getElementById('awmWpLng');
    if (latEl) latEl.value = coords.lat;
    if (lngEl) lngEl.value = coords.lng;
    toast('좌표가 입력되었습니다 (' + coords.lat.toFixed(5) + ', ' + coords.lng.toFixed(5) + ')');
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
    const path = id ? `/api/admin-att-workplaces/${id}` : '/api/admin-att-workplaces';
    const res = await api(path, { method, body: { name, address, radius, lat, lng } });

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

    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    setVal('awmPolicyCheckinTime', p.checkinTime || '09:00');
    setVal('awmPolicyCheckoutTime', p.checkoutTime || '18:00');
    setVal('awmPolicyLateGrace', p.lateGraceMinutes ?? 10);
    setVal('awmPolicyEarlyLeave', p.earlyLeaveMinutes ?? 0);
    setVal('awmPolicyOvertimeAfter', p.overtimeAfterHours ?? 8);
    setVal('awmPolicyAnnualLeave', p.annualLeaveDays ?? 15);
    setVal('awmPolicyWorkDaysPerWeek', p.workDaysPerWeek ?? 5);
    setVal('awmPolicyGpsCheck', p.gpsCheckEnabled !== false ? 'true' : 'false');

    document.getElementById('awmBtnSavePolicy')?.addEventListener('click', savePolicy);
  }

  async function savePolicy() {
    const val = (id) => document.getElementById(id)?.value;
    const body = {
      checkinTime: val('awmPolicyCheckinTime'),
      checkoutTime: val('awmPolicyCheckoutTime'),
      lateGraceMinutes: Number(val('awmPolicyLateGrace')) || 0,
      earlyLeaveMinutes: Number(val('awmPolicyEarlyLeave')) || 0,
      overtimeAfterHours: parseFloat(val('awmPolicyOvertimeAfter')) || 8,
      annualLeaveDays: Number(val('awmPolicyAnnualLeave')) || 15,
      workDaysPerWeek: Number(val('awmPolicyWorkDaysPerWeek')) || 5,
      gpsCheckEnabled: val('awmPolicyGpsCheck') === 'true',
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
        <td>${r.carryover ? '허용' : '미허용'}</td>
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
    document.getElementById('awmLtCarryover').value = row.carryover ? 'true' : 'false';
    document.getElementById('awmLtHalfDay').value = row.halfDayAllowed !== false ? 'true' : 'false';
    document.getElementById('awmLtDesc').value = row.description || '';
    setText('awmLeaveTypeFormTitle', '휴가 종류 수정');
    showEl('awmLeaveTypeForm');
    document.getElementById('awmLeaveTypeForm').scrollIntoView({ behavior: 'smooth' });
  };

  window.awmDeleteLeaveType = async (id) => {
    if (!confirm('이 휴가 종류를 삭제하시겠습니까?')) return;
    const res = await api(`/api/admin-att-leave-types/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || '')); return; }
    toast('삭제되었습니다');
    await loadLeaveTypes();
  };

  async function saveLeaveType() {
    const id = document.getElementById('awmLtId')?.value;
    const name = document.getElementById('awmLtName')?.value?.trim();
    const defaultDays = Number(document.getElementById('awmLtDays')?.value) || 0;
    const carryover = document.getElementById('awmLtCarryover')?.value === 'true';
    const halfDayAllowed = document.getElementById('awmLtHalfDay')?.value === 'true';
    const description = document.getElementById('awmLtDesc')?.value?.trim();

    if (!name) { toast('이름을 입력하세요'); return; }

    const btn = document.getElementById('awmBtnSaveLeaveType');
    if (btn) btn.disabled = true;

    const method = id ? 'PUT' : 'POST';
    const path = id ? `/api/admin-att-leave-types/${id}` : '/api/admin-att-leave-types';
    const res = await api(path, { method, body: { name, defaultDays, carryover, halfDayAllowed, description } });

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
        <td>${r.type === 'NATIONAL' ? '법정공휴일' : '회사 휴무일'}</td>
        <td>
          <button class="att-btn att-btn-danger att-btn-sm" onclick="awmDeleteHoliday(${r.id})">삭제</button>
        </td>
      </tr>`).join('');
  }

  window.awmDeleteHoliday = async (id) => {
    if (!confirm('이 공휴일을 삭제하시겠습니까?')) return;
    const res = await api(`/api/admin-att-holidays/${id}`, { method: 'DELETE' });
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

  /* ─── 초기화 ─── */
  async function init() {
    const admin = await checkAuth();
    if (!admin) return;

    setupTabs();
    await initRecordsTab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
