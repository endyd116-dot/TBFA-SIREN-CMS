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
    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td>${escHtml(r.memberName || '—')}</td>
        <td style="font-size:12px;color:#6b7280">${escHtml(r.memberEmail || '')}</td>
        <td>${escHtml(r.leaveTypeName || '—')}</td>
        <td>${escHtml(String(r.totalDays ?? '—'))}</td>
        <td>${escHtml(String(r.usedDays ?? '—'))}</td>
        <td><strong>${escHtml(String(r.remainingDays ?? '—'))}</strong></td>
        <td>
          <button class="att-btn att-btn-default att-btn-sm"
            onclick="awmOpenBalanceAdjust('${escHtml(r.memberUid)}', ${r.leaveTypeId}, ${r.year}, '${escHtml(r.memberName)}', '${escHtml(r.leaveTypeName)}')">조정</button>
        </td>
      </tr>`).join('');
  }

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

    const btn = document.getElementById('awmBtnSaveBalanceAdjust');
    if (btn) btn.disabled = true;

    const res = await api('/api/admin-att-leave-balances', {
      method: 'PUT',
      body: { memberUid, leaveTypeId, year, deltaDays, reason: reason || null },
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
