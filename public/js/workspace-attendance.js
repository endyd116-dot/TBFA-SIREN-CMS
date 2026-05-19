/* =========================================================
   workspace-attendance.js — Phase 26 근태관리 (직원용)
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
      console.error('[Att API]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ─── 토스트 ─── */
  function toast(msg, ms = 2600) {
    const el = document.getElementById('attToast');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(window._attToast);
    window._attToast = setTimeout(() => { el.style.opacity = '0'; }, ms);
  }

  /* ─── 날짜 포맷 (KST 통일) ─── */
  function fmtDate(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  function fmtTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
  }
  function toDateStr(d) {
    const dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 10);
  }

  /* ─── 근무형태 표시 텍스트 ─── */
  const MODE_LABEL = {
    OFFICE: '🏢 사무실',
    REMOTE: '🏠 재택',
    FIELD: '🚗 외근',
    BUSINESS_TRIP: '✈️ 출장',
    HYBRID: '🔀 혼합',
  };

  /* ─── 탭 전환 ─── */
  function setupTabs() {
    document.querySelectorAll('.att-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.att-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.att-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panelId = 'attPanel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');

        // 지연 초기화
        if (btn.dataset.tab === 'calendar' && !window._attCalInit) initCalendar();
        if (btn.dataset.tab === 'stats' && !window._attStatsInit) initStats();
        if (btn.dataset.tab === 'leave' && !window._attLeaveInit) initLeave();
        if (btn.dataset.tab === 'amend' && !window._attAmendInit) initAmend();
        if (btn.dataset.tab === 'report') loadReport();
      });
    });
  }

  /* ═══════════════════════════════════
     탭 1: 출퇴근
  ═══════════════════════════════════ */
  async function initCheckin() {
    const btnIn = document.getElementById('attBtnCheckin');
    try {
    // 오늘 날짜 표시
    const now = new Date();
    const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    const el = document.getElementById('attTodayDate');
    const dayEl = document.getElementById('attTodayDay');
    if (el) el.textContent = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    if (dayEl) dayEl.textContent = days[now.getDay()];

    const yr = now.getFullYear(), mo = now.getMonth() + 1;
    const smEl = document.getElementById('attSummaryMonth');
    if (smEl) smEl.textContent = `${yr}년 ${mo}월`;

    // 오늘 근무형태 조회
    const schedRes = await api('/api/att-schedule-today');
    const mode = (schedRes.data?.data?.mode || schedRes.data?.mode || 'UNKNOWN');
    renderModeBadge(mode);

    // 오늘 기록 조회
    const recRes = await api('/api/att-checkin-today');
    const rec = recRes.data?.data || recRes.data || {};
    renderCheckinStatus(rec, mode);

    // 이번달 요약
    const sumRes = await api(`/api/att-my-stats?year=${yr}&month=${mo}`);
    const stats = sumRes.data?.data || sumRes.data || {};
    renderSummary(stats);
    } catch (e) {
      console.error('[att] initCheckin 오류:', e);
      if (btnIn) { btnIn.disabled = false; btnIn.textContent = '🟢 출근 (새로고침 필요)'; }
      toast('출퇴근 정보를 불러오지 못했습니다. 새로고침해 주세요.');
    }
  }

  function renderModeBadge(mode) {
    const badge = document.getElementById('attModeBadge');
    if (!badge) return;
    badge.className = `att-mode-badge ${mode}`;
    badge.textContent = MODE_LABEL[mode] || '⏳ 미정';
  }

  function renderCheckinStatus(rec, mode) {
    const statusEl = document.getElementById('attCurrentStatus');
    const btnIn = document.getElementById('attBtnCheckin');
    const btnOut = document.getElementById('attBtnCheckout');
    const gpsNote = document.getElementById('attGpsNote');

    if (!btnIn || !btnOut) return;

    const noGps = (mode === 'REMOTE' || mode === 'BUSINESS_TRIP');
    if (gpsNote) gpsNote.textContent = noGps ? '📡 GPS 위치 확인 없이 기록됩니다' : '📍 GPS 위치 정보가 함께 기록됩니다';

    if (rec.checkoutAt) {
      // 퇴근 완료
      btnIn.style.display = 'none';
      btnOut.style.display = 'none';
      if (statusEl) statusEl.innerHTML = `✅ 퇴근 완료<br><strong>출근 ${fmtTime(rec.checkinAt)} — 퇴근 ${fmtTime(rec.checkoutAt)}</strong>`;
      const doneBtn = document.createElement('button');
      doneBtn.className = 'att-btn-checkin att-btn-done';
      doneBtn.textContent = '✅ 오늘 근무 완료';
      btnIn.parentElement.appendChild(doneBtn);
    } else if (rec.checkinAt) {
      // 출근 후 대기
      btnIn.style.display = 'none';
      btnOut.style.display = 'flex';
      btnOut.disabled = false;
      if (statusEl) statusEl.innerHTML = `근무 중 🟢<br>출근 시각: <strong>${fmtTime(rec.checkinAt)}</strong>`;
      btnOut.addEventListener('click', () => doCheckout(mode));
    } else {
      // 미출근
      btnIn.style.display = 'flex';
      btnIn.disabled = false;
      btnOut.style.display = 'none';
      if (statusEl) statusEl.textContent = '아직 출근 기록이 없습니다.';
      btnIn.addEventListener('click', () => doCheckin(mode));
    }
  }

  function renderSummary(stats) {
    setText('sumWorkDays', stats.workDays ?? '—');
    setText('sumWorkHours', stats.workHours ?? '—');
    setText('sumLateCount', stats.lateCount ?? '—');
    setText('sumRemoteDays', stats.remoteDays ?? '—');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  async function doCheckin(mode) {
    const btn = document.getElementById('attBtnCheckin');
    if (btn) btn.disabled = true;

    const noGps = (mode === 'REMOTE' || mode === 'BUSINESS_TRIP');
    const needsGps = (mode === 'OFFICE' || mode === 'FIELD');
    if (noGps) {
      await sendCheckin(null, null);
      return;
    }
    if (!navigator.geolocation) {
      if (!needsGps) {
        await sendCheckin(null, null);
      } else {
        toast('이 기기에서는 위치 정보를 사용할 수 없습니다');
        if (btn) btn.disabled = false;
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendCheckin(pos.coords.latitude, pos.coords.longitude);
      },
      async (err) => {
        if (!needsGps) {
          // 사무실·외근 모드가 아니면 GPS 없이 출근 허용
          toast('위치 권한 없음 — GPS 없이 출근합니다 📡');
          await sendCheckin(null, null);
        } else {
          toast('위치 정보를 허용해주세요 (설정 → 권한 → 위치)');
          if (btn) btn.disabled = false;
        }
      },
      { timeout: 8000 }
    );
  }

  async function sendCheckin(lat, lng) {
    const body = {};
    if (lat !== null) { body.lat = lat; body.lng = lng; }
    const res = await api('/api/att-checkin', { method: 'POST', body });
    if (!res.ok) {
      toast('출근 기록 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      const btn = document.getElementById('attBtnCheckin');
      if (btn) btn.disabled = false;
      return;
    }
    toast('출근이 기록되었습니다 🟢');
    setTimeout(() => location.reload(), 800);
  }

  async function doCheckout(mode) {
    const btn = document.getElementById('attBtnCheckout');
    if (btn) btn.disabled = true;

    const noGps = (mode === 'REMOTE' || mode === 'BUSINESS_TRIP');
    if (noGps) {
      await sendCheckout(null, null);
      return;
    }
    if (!navigator.geolocation) {
      toast('이 기기에서는 위치 정보를 사용할 수 없습니다');
      if (btn) btn.disabled = false;
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendCheckout(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        toast('위치 정보를 허용해주세요 (설정 → 권한 → 위치)');
        if (btn) btn.disabled = false;
      },
      { timeout: 10000 }
    );
  }

  async function sendCheckout(lat, lng) {
    const body = {};
    if (lat !== null) { body.lat = lat; body.lng = lng; }
    const res = await api('/api/att-checkout', { method: 'POST', body });
    if (!res.ok) {
      toast('퇴근 기록 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      const btn = document.getElementById('attBtnCheckout');
      if (btn) btn.disabled = false;
      return;
    }
    toast('퇴근이 기록되었습니다 🔴');
    // 재택근무이고 보고서 미제출이면 안내
    const resData = res.data?.data || res.data || {};
    if (resData.reportSubmitted === false) {
      setTimeout(() => {
        toast('📝 재택보고서를 작성해주세요. "재택보고서" 탭을 확인하세요.', 4000);
      }, 900);
    }
    setTimeout(() => location.reload(), 800);
  }

  /* ═══════════════════════════════════
     탭 2: 캘린더
  ═══════════════════════════════════ */
  const STATUS_CLASS = {
    NORMAL: 'att-ev-normal',
    LATE: 'att-ev-late',
    ABSENT: 'att-ev-absent',
    LEAVE: 'att-ev-leave',
    REMOTE: 'att-ev-remote',
    FIELD: 'att-ev-field',
    HOLIDAY: 'att-ev-holiday',
  };
  const BG_CLASS = {
    NORMAL: 'att-bg-normal',
    LATE: 'att-bg-late',
    ABSENT: 'att-bg-absent',
    LEAVE: 'att-bg-leave',
    REMOTE: 'att-bg-remote',
    FIELD: 'att-bg-field',
    HOLIDAY: 'att-bg-holiday',
  };

  async function initCalendar() {
    window._attCalInit = true;
    const container = document.getElementById('attCalendar');
    if (!container || typeof FullCalendar === 'undefined') return;

    const calendar = new FullCalendar.Calendar(container, {
      initialView: 'dayGridMonth',
      locale: 'ko',
      height: 'auto',
      headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
      datesSet: async (info) => {
        const yr = info.start.getFullYear();
        const mo = info.start.getMonth() + 2; // datesSet start is prev month end
        await loadCalendarData(calendar, yr, mo);
      },
      dayCellDidMount(info) {
        // 배경색은 events 데이터 기반으로 datesSet 후 적용
      },
    });
    calendar.render();
    window._attCalendar = calendar;
  }

  async function loadCalendarData(calendar, yr, mo) {
    calendar.removeAllEvents();
    const res = await api(`/api/att-my-calendar?year=${yr}&month=${mo}`);
    const rows = res.data?.data || res.data?.rows || res.data || [];
    if (!Array.isArray(rows)) return;

    rows.forEach(row => {
      const cls = STATUS_CLASS[row.status] || '';
      calendar.addEvent({
        title: row.label || row.status || '',
        start: row.date,
        allDay: true,
        classNames: [cls],
      });
      // 배경 셀 착색
      const bgCls = BG_CLASS[row.status];
      if (bgCls) {
        const cell = calendar.el.querySelector(`[data-date="${row.date}"]`);
        if (cell) cell.classList.add(bgCls);
      }
    });
  }

  /* ═══════════════════════════════════
     탭 3: 통계
  ═══════════════════════════════════ */
  async function initStats() {
    window._attStatsInit = true;
    const now = new Date();
    const res = await api(`/api/att-my-stats?year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
    const stats = res.data?.data || res.data || {};

    setText('statWorkDays', stats.workDays ?? '—');
    setText('statWorkHours', stats.workHours ?? '—');
    setText('statLateCount', stats.lateCount ?? '—');
    setText('statRemoteDays', stats.remoteDays ?? '—');

    renderDonut(stats);
  }

  function renderDonut(stats) {
    const ctx = document.getElementById('attDonutChart');
    if (!ctx || typeof Chart === 'undefined') return;

    const dist = stats.modeDist || {};
    const labels = ['사무실', '재택', '외근', '출장'];
    const values = [
      dist.OFFICE || 0,
      dist.REMOTE || 0,
      dist.FIELD || 0,
      dist.BUSINESS_TRIP || 0,
    ];
    const colors = ['#3b82f6', '#8b5cf6', '#f97316', '#f59e0b'];

    if (window._attDonut) { window._attDonut.destroy(); }
    window._attDonut = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderWidth: 2 }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
        },
      },
    });
  }

  /* ═══════════════════════════════════
     탭 4: 휴가
  ═══════════════════════════════════ */
  async function initLeave() {
    window._attLeaveInit = true;
    await loadLeaveTypes();
    await loadLeaveBalance();
    await loadLeaveHistory();

    const today = toDateStr();
    const startEl = document.getElementById('attLeaveStart');
    const endEl = document.getElementById('attLeaveEnd');
    if (startEl) startEl.value = today;
    if (endEl) endEl.value = today;

    document.getElementById('attBtnLeaveSubmit')?.addEventListener('click', submitLeave);
  }

  async function loadLeaveTypes() {
    const res = await api('/api/att-leave-types');
    const types = res.data?.data || res.data || [];
    const sel = document.getElementById('attLeaveType');
    if (!sel || !Array.isArray(types)) return;
    types.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }

  async function loadLeaveBalance() {
    const res = await api('/api/att-leave-balance');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('attLeaveBalanceBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="att-empty">조회된 휴가 정보가 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.name || r.typeName || '—')}</td>
        <td>${r.granted ?? '—'}</td>
        <td>${r.used ?? '—'}</td>
        <td><strong>${r.remaining ?? '—'}</strong></td>
      </tr>`).join('');
  }

  async function loadLeaveHistory() {
    const res = await api('/api/att-leave-history');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('attLeaveHistoryBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="att-empty">신청 내역이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const halfLabel = r.isHalfDay
        ? (r.halfDayPeriod === 'AM' ? ' · 반차(오전)' : r.halfDayPeriod === 'PM' ? ' · 반차(오후)' : ' · 반차')
        : '';
      const periodText = r.startDate === r.endDate
        ? fmtDate(r.startDate)
        : `${fmtDate(r.startDate)} ~ ${fmtDate(r.endDate)}`;
      return `
      <tr>
        <td>${escHtml(r.typeName || '—')}${halfLabel}</td>
        <td>${periodText}</td>
        <td>${r.days ?? '—'}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.reason || '')}">${escHtml(r.reason || '—')}</td>
        <td><span class="att-badge ${r.status || ''}">${statusLabel(r.status)}</span></td>
      </tr>`;
    }).join('');
  }

  async function submitLeave() {
    const typeId = document.getElementById('attLeaveType')?.value;
    const half = document.getElementById('attLeaveHalf')?.value;  // '' | 'AM' | 'PM'
    const start = document.getElementById('attLeaveStart')?.value;
    const end = document.getElementById('attLeaveEnd')?.value;
    const reason = document.getElementById('attLeaveReason')?.value?.trim();

    if (!typeId) { toast('휴가 종류를 선택하세요'); return; }
    if (!start || !end) { toast('날짜를 입력하세요'); return; }
    if (start > end) { toast('종료일이 시작일보다 빠를 수 없습니다'); return; }

    // 반차 — 시작=종료 단일 날짜 강제
    const isHalfDay = half === 'AM' || half === 'PM';
    if (isHalfDay && start !== end) {
      toast('반차는 단일 날짜만 신청할 수 있습니다');
      return;
    }

    const btn = document.getElementById('attBtnLeaveSubmit');
    if (btn) btn.disabled = true;

    const res = await api('/api/att-leave-request', {
      method: 'POST',
      body: {
        leaveTypeId: typeId,
        startDate: start,
        endDate: end,
        reason,
        // 반차 정보 — R29-ATT-GAP2 PHASE D
        isHalfDay,
        halfDayPeriod: isHalfDay ? half : null,
      },
    });

    if (!res.ok) {
      toast('신청 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      if (btn) btn.disabled = false;
      return;
    }
    const d = res.data?.data || res.data || {};
    toast(`휴가가 신청되었습니다 (${d.days ?? ''}일${isHalfDay ? ' · 반차' : ''})`);
    if (btn) btn.disabled = false;
    await loadLeaveBalance();
    await loadLeaveHistory();
  }

  /* ═══════════════════════════════════
     탭 5: 수정 요청
  ═══════════════════════════════════ */
  async function initAmend() {
    window._attAmendInit = true;

    const today = toDateStr();
    const dateEl = document.getElementById('attAmendDate');
    if (dateEl) dateEl.value = today;

    document.getElementById('attBtnAmendSubmit')?.addEventListener('click', submitAmend);

    // 수정 유형 변경 시 시각 필드 표시 조정
    document.getElementById('attAmendType')?.addEventListener('change', (e) => {
      const row = document.getElementById('attAmendTimeRow');
      if (!row) return;
      const ci = document.getElementById('attAmendCheckin');
      const co = document.getElementById('attAmendCheckout');
      if (e.target.value === 'CHECKIN') {
        if (ci) ci.closest('.att-form-group').style.display = '';
        if (co) co.closest('.att-form-group').style.display = 'none';
      } else if (e.target.value === 'CHECKOUT') {
        if (ci) ci.closest('.att-form-group').style.display = 'none';
        if (co) co.closest('.att-form-group').style.display = '';
      } else {
        if (ci) ci.closest('.att-form-group').style.display = '';
        if (co) co.closest('.att-form-group').style.display = '';
      }
    });

    await loadAmendHistory();
  }

  async function submitAmend() {
    const date = document.getElementById('attAmendDate')?.value;
    const type = document.getElementById('attAmendType')?.value;
    const ci = document.getElementById('attAmendCheckin')?.value;
    const co = document.getElementById('attAmendCheckout')?.value;
    const reason = document.getElementById('attAmendReason')?.value?.trim();

    if (!date) { toast('날짜를 입력하세요'); return; }
    if (!reason) { toast('사유를 입력하세요'); return; }
    if (type === 'CHECKIN' && !ci) { toast('출근 시각을 입력하세요'); return; }
    if (type === 'CHECKOUT' && !co) { toast('퇴근 시각을 입력하세요'); return; }
    if (type === 'BOTH' && (!ci || !co)) { toast('출퇴근 시각을 모두 입력하세요'); return; }

    const btn = document.getElementById('attBtnAmendSubmit');
    if (btn) btn.disabled = true;

    // R34-P2: amend → correction 마이그
    const CORRECTION_TYPE = { CHECKIN: 'CHECK_IN', CHECKOUT: 'CHECK_OUT', BOTH: 'BOTH' };
    const res = await api('/api/att-correction-request', {
      method: 'POST',
      body: {
        targetDate: date,
        correctionType: CORRECTION_TYPE[type] || type,
        requestedCheckIn:  ci ? `${date}T${ci}:00` : null,
        requestedCheckOut: co ? `${date}T${co}:00` : null,
        reason,
      },
    });

    if (!res.ok) {
      toast('요청 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      if (btn) btn.disabled = false;
      return;
    }
    toast('수정 요청이 제출되었습니다');
    if (btn) btn.disabled = false;
    document.getElementById('attAmendReason').value = '';
    await loadAmendHistory();
  }

  async function loadAmendHistory() {
    // R34-P2: amend → correction 마이그 (GET /api/att-correction-request)
    const res = await api('/api/att-correction-request');
    const rows = res.data?.data || res.data || [];
    const tbody = document.getElementById('attAmendHistoryBody');
    if (!tbody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="att-empty">요청 내역이 없습니다</td></tr>';
      return;
    }
    const typeLabel = { CHECK_IN: '출근', CHECK_OUT: '퇴근', BOTH: '출퇴근' };
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escHtml(r.targetDate || '—')}</td>
        <td>${typeLabel[r.correctionType] || r.correctionType || '—'}</td>
        <td style="font-size:12px">
          ${r.requestedCheckIn ? '출근 ' + fmtTime(r.requestedCheckIn) : ''}
          ${r.requestedCheckOut ? '<br>퇴근 ' + fmtTime(r.requestedCheckOut) : ''}
        </td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.reason || '')}">${escHtml(r.reason || '—')}</td>
        <td><span class="att-badge ${r.status || ''}">${statusLabel(r.status)}</span></td>
      </tr>`).join('');
  }

  /* ═══════════════════════════════════
     탭 6: 재택보고서
  ═══════════════════════════════════ */
  async function loadReport() {
    const dateStr = toDateStr();
    const statusBar = document.getElementById('attReportStatusBar');
    const statusText = document.getElementById('attReportStatusText');
    const metaEl = document.getElementById('attReportMeta');
    const wbsEl = document.getElementById('attReportWbsCards');
    const contentEl = document.getElementById('attReportContent');
    const btnDraft = document.getElementById('attBtnSaveDraft');
    const btnSubmit = document.getElementById('attBtnSubmitReport');

    if (statusText) statusText.textContent = '보고서 상태를 불러오는 중...';

    const res = await api('/api/att/remote-report?date=' + dateStr);
    const report = res.data?.data || res.data || null;

    // WBS 카드 목록 (보고서 응답 내 포함 or 별도 조회)
    const wbsCards = (report && Array.isArray(report.wbsCards)) ? report.wbsCards : [];
    renderReportWbsCards(wbsEl, wbsCards);

    renderReport(report, { statusBar, statusText, metaEl, contentEl, btnDraft, btnSubmit, dateStr });

    // 버튼 이벤트 (중복 방지)
    if (btnDraft && !btnDraft._bound) {
      btnDraft._bound = true;
      btnDraft.addEventListener('click', saveReportDraft);
    }
    if (btnSubmit && !btnSubmit._bound) {
      btnSubmit._bound = true;
      btnSubmit.addEventListener('click', submitReport);
    }
    const btnAi = document.getElementById('attBtnAiDraft');
    if (btnAi && !btnAi._bound) {
      btnAi._bound = true;
      btnAi.addEventListener('click', generateAIDraft);
    }
  }

  function renderReportWbsCards(container, cards) {
    if (!container) return;
    if (!cards || cards.length === 0) {
      container.innerHTML = '<span style="font-size:13px;color:#9ca3af">오늘 할당된 WBS 카드가 없습니다</span>';
      return;
    }
    container.innerHTML = cards.map(c => `
      <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#ede9fe;color:#5b21b6;border-radius:99px;font-size:12.5px;font-weight:500">
        📌 ${escHtml(c.title || c.name || '카드')}
      </span>`).join('');
  }

  function renderReport(report, { statusBar, statusText, metaEl, contentEl, btnDraft, btnSubmit, dateStr }) {
    if (!report) {
      // 미작성
      if (statusBar) statusBar.style.background = '#f8fafc';
      if (statusText) statusText.innerHTML = '⬜ 오늘 재택보고서가 아직 작성되지 않았습니다.';
      if (metaEl) metaEl.textContent = dateStr;
      if (contentEl) { contentEl.value = ''; contentEl.disabled = false; }
      if (btnDraft) { btnDraft.style.display = ''; btnDraft.disabled = false; }
      if (btnSubmit) { btnSubmit.style.display = ''; btnSubmit.disabled = false; }
      return;
    }
    if (report.status === 'SUBMITTED') {
      if (statusBar) statusBar.style.background = '#dcfce7';
      if (statusText) statusText.innerHTML = '✅ <strong>제출 완료</strong> — 보고서가 제출되었습니다.';
      if (metaEl) metaEl.textContent = '제출 시각: ' + fmtTime(report.submittedAt);
      if (contentEl) { contentEl.value = report.content || ''; contentEl.disabled = true; }
      if (btnDraft) btnDraft.style.display = 'none';
      if (btnSubmit) { btnSubmit.style.display = 'none'; }
    } else {
      // DRAFT
      if (statusBar) statusBar.style.background = '#fefce8';
      if (statusText) statusText.innerHTML = '📝 <strong>임시저장</strong> — 작성 중인 보고서가 있습니다.';
      if (metaEl) metaEl.textContent = '마지막 저장';
      if (contentEl) { contentEl.value = report.content || report.aiDraft || ''; contentEl.disabled = false; }
      if (btnDraft) { btnDraft.style.display = ''; btnDraft.disabled = false; }
      if (btnSubmit) { btnSubmit.style.display = ''; btnSubmit.disabled = false; }
    }
  }

  async function generateAIDraft() {
    const btn = document.getElementById('attBtnAiDraft');
    const contentEl = document.getElementById('attReportContent');
    if (btn) { btn.disabled = true; btn.textContent = '✨ 생성 중...'; }

    const res = await api('/api/att/ai-draft', { method: 'POST', body: { date: toDateStr() } });

    if (btn) { btn.disabled = false; btn.textContent = '✨ AI 초안 생성'; }

    if (!res.ok) {
      toast('AI 초안 생성 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      return;
    }
    const draft = res.data?.draft || res.data?.data?.draft || '';
    if (contentEl && draft) {
      contentEl.value = draft;
      toast('AI 초안이 생성되었습니다. 내용을 검토 후 수정하세요.');
    }
  }

  async function saveReportDraft() {
    const contentEl = document.getElementById('attReportContent');
    const content = contentEl?.value?.trim();
    if (!content) { toast('보고서 내용을 입력하세요'); return; }

    const btn = document.getElementById('attBtnSaveDraft');
    if (btn) btn.disabled = true;

    const res = await api('/api/att/remote-report', {
      method: 'POST',
      body: { date: toDateStr(), content },
    });

    if (!res.ok) {
      toast('임시저장 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      if (btn) btn.disabled = false;
      return;
    }
    toast('임시저장 완료 💾');
    if (btn) btn.disabled = false;
  }

  async function submitReport() {
    const contentEl = document.getElementById('attReportContent');
    const content = contentEl?.value?.trim();
    if (!content) { toast('보고서 내용을 입력하세요'); return; }
    if (!confirm('보고서를 최종 제출하시겠습니까? 제출 후에는 수정할 수 없습니다.')) return;

    const btn = document.getElementById('attBtnSubmitReport');
    if (btn) btn.disabled = true;

    const res = await api('/api/att/remote-report', {
      method: 'PUT',
      body: { date: toDateStr(), content },
    });

    if (!res.ok) {
      toast('제출 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      if (btn) btn.disabled = false;
      return;
    }
    toast('보고서가 제출되었습니다 📤');
    // 상태 갱신
    await loadReport();
  }

  /* ─── 유틸 ─── */
  function statusLabel(s) {
    return { PENDING: '대기', APPROVED: '승인', REJECTED: '반려' }[s] || s || '—';
  }
  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ─── 인증 확인 (R34-P1: user JWT 우선 + admin JWT fallback) ─── */
  async function checkAuth() {
    // 1) 일반 사용자 토큰 우선
    let user = null;
    let isAdmin = false;
    try {
      const userRes = await api('/api/auth/me');
      if (userRes.ok) {
        user = userRes.data?.data || userRes.data?.user || userRes.data || null;
      }
    } catch (_) {}

    // 2) 사용자 토큰 없으면 어드민 토큰 fallback
    if (!user) {
      try {
        const adminRes = await api('/api/admin/me?light=1');
        if (adminRes.ok) {
          user = adminRes.data?.admin || adminRes.data?.data || adminRes.data || null;
          isAdmin = !!user;
        }
      } catch (_) {}
    }

    // 3) 둘 다 실패 → 로그인 페이지
    if (!user) { location.href = '/login.html'; return null; }

    const roleLabel = isAdmin
      ? '관리자'
      : (user.operatorActive ? '운영자' : '직원');

    const nameEl = document.getElementById('wsSidebarUserName');
    if (nameEl) nameEl.textContent = user.name || user.username || '사용자';
    const subtitleEl = document.getElementById('attUserSubtitle');
    if (subtitleEl) subtitleEl.textContent = `${user.name || ''}님의 근태 현황 · ${roleLabel}`;
    return user;
  }

  /* ─── 로그아웃 ─── */
  async function setupLogout() {
    document.getElementById('wsBtnLogout')?.addEventListener('click', async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      await api('/api/logout', { method: 'POST' });
      location.href = '/index.html';
    });
  }

  /* ─── 초기화 ─── */
  async function init() {
    const user = await checkAuth();
    if (!user) return;

    setupTabs();
    setupLogout();
    await initCheckin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
