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
    return new Date(d).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
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

        if (btn.dataset.tab === 'leaves' && !window._awmLvInit) initLeavesTab();
        if (btn.dataset.tab === 'balances' && !window._awmBalInit) initBalancesTab();
        if (btn.dataset.tab === 'schedule' && !window._awmSchInit) initScheduleTab();
        if (btn.dataset.tab === 'workplaces' && !window._awmWpInit) initWorkplacesTab();
        if (btn.dataset.tab === 'policy' && !window._awmPolInit) initPolicyTab();
        if (btn.dataset.tab === 'leavetypes' && !window._awmLtInit) initLeaveTypesTab();
        if (btn.dataset.tab === 'holidays' && !window._awmHolInit) initHolidaysTab();
        if (btn.dataset.tab === 'monthrecords' && !window._awmMrInit) initMonthRecordsTab();
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
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.memberName || '—')}</td>
        <td>${escHtml(r.targetDate || '—')}</td>
        <td>${typeLabel[r.correctionType] || r.correctionType || '—'}</td>
        <td style="font-size:12px">
          ${r.requestedCheckIn ? '출근 ' + fmtTime(r.requestedCheckIn) : ''}
          ${r.requestedCheckOut ? '<br>퇴근 ' + fmtTime(r.requestedCheckOut) : ''}
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
    const res = await api('/api/admin-att-correction-review', {
      method: 'POST',
      body: { requestId: id, action: 'APPROVED', note: '' },
    });
    if (!res.ok) { toast('승인 실패: ' + (res.data?.error || '')); return; }
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
  async function initScheduleTab() {
    window._awmSchInit = true;
    await loadMemberDropdown('awmScheduleMember');
    await loadWorkplaceDropdown('awmScheduleWorkplace');

    // R34-P2 (P2): FIELD 모드 선택 시 거점 셀렉트 노출
    document.getElementById('awmScheduleMode')?.addEventListener('change', (e) => {
      const hybrid = document.getElementById('awmHybridConfig');
      const wpWrap = document.getElementById('awmScheduleWorkplaceWrap');
      if (hybrid) hybrid.style.display = e.target.value === 'HYBRID' ? '' : 'none';
      if (wpWrap) wpWrap.style.display = e.target.value === 'FIELD' ? '' : 'none';
    });

    const today = toDateStr();
    const fromEl = document.getElementById('awmScheduleFrom');
    if (fromEl) fromEl.value = today;

    document.getElementById('awmBtnSaveSchedule')?.addEventListener('click', saveSchedule);
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
      /* ★ R33-FIX H-G1: 체크박스 value "1"~"7" → 서버 키 "MON"~"SUN" 변환 (att-utils.getScheduledWorkMode 기대 형식) */
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

    const res = await api('/api/admin-att-schedules', {
      method: 'POST',
      body: { memberUid: uid, workMode: mode, startDate: from, endDate: to || null, recurringRule: hybridConfig, workplaceId },
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
    const res = await api('/api/admin-att-schedules');
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
        <td><span class="awm-tag ${r.workMode || ''}">${MODE_LABEL[r.workMode] || r.workMode || '—'}</span></td>
        <td>${escHtml(r.startDate || '—')} ~ ${escHtml(r.endDate || '계속')}</td>
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

    document.getElementById('awmBtnSavePolicy')?.addEventListener('click', savePolicy);
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
      tbody.innerHTML = '<tr><td colspan="7" class="att-empty">잔여 휴가 정보가 없습니다</td></tr>';
      return;
    }
    /* R39 Stage 7: [+1] [-1] [상세] 빠른 조정 버튼 + 기존 폼 */
    tbody.innerHTML = filtered.map(r => `
      <tr>
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
      </tr>`).join('');
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
            }))})" style="padding:2px 6px;font-size:11px" title="출근 위치">📍출</button>` : '';
        const outBtn = (coLat != null && coLng != null)
          ? `<button class="att-btn att-btn-default att-btn-sm" onclick="awmShowLiveLocation(${escAttr(JSON.stringify({
              name: memberName + ' — ' + ln.date, type:'out', lat:coLat, lng:coLng, workplaceId:wpId, workMode:wm,
            }))})" style="padding:2px 6px;font-size:11px;margin-left:3px" title="퇴근 위치">📍퇴</button>` : '';
        mapCells = (inBtn + outBtn) || '—';
      }
      const leaveTxt = ln.leaves.length
        ? ln.leaves.map(lv => (lv.is_half_day || lv.isHalfDay) ? '반차' : '휴가').join(', ')
        : '—';
      /* R39 Stage 7 A-2: 어드민 수정 버튼 — 기록이 있는 일자만 */
      const recId = r && r.id;
      const editBtn = recId
        ? `<button class="att-btn att-btn-default att-btn-sm" style="padding:2px 6px;font-size:11px;margin-left:3px" onclick="awmOpenRecordEdit(${recId})" title="어드민 직접 수정">✏️</button>`
        : '';
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
    if (ci) body.checkInTime  = new Date(ci).toISOString();
    if (co) body.checkOutTime = new Date(co).toISOString();
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
    toast('📨 직원에게 확인 요청 알림을 보냈습니다');
  }

  /* ═══════════════════════════════════
     R39 Stage 5 A-1: 실시간 출퇴근 현황 (자동 새로고침 30초)
     ═══════════════════════════════════ */
  var _liveTimer = null;
  var _liveMembersById = {}; // 직원 uid → { name, email, role }
  var _liveWorkplacesById = {}; // 거점 id → { name, lat, lng }

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
          }))})" style="padding:3px 8px;font-size:11px" title="출근 위치 보기">📍 출근</button>`
        : '—';
      const checkOutBtn = r.checkOutTime
        ? `<button class="att-btn att-btn-default att-btn-sm" onclick="awmShowLiveLocation(${escAttr(JSON.stringify({
            name, type:'out', lat:r.checkOutLat, lng:r.checkOutLng, workplaceId:r.workplaceId, workMode:r.workMode,
          }))})" style="padding:3px 8px;font-size:11px" title="퇴근 위치 보기">📍 퇴근</button>`
        : '—';
      html += `<tr>
        <td style="font-weight:600">${escHtml(name)}</td>
        <td>${modeTag}</td>
        <td>${statusBadge}</td>
        <td>${fmtTime(r.checkInTime)}</td>
        <td>${fmtTime(r.checkOutTime)}</td>
        <td>${checkInBtn} ${checkOutBtn}</td>
      </tr>`;
    });
    absent.forEach(m => {
      html += `<tr style="opacity:.65">
        <td style="font-weight:600">${escHtml(m.name)}</td>
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

  /* ─── 초기화 ─── */
  async function init() {
    const admin = await checkAuth();
    if (!admin) return;

    setupTabs();
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
