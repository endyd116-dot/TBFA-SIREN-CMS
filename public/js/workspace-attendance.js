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
    // 인자 없으면 KST '오늘'(백엔드 todayKST와 일치 — UTC 00~09시 날짜 어긋남 방지)
    const dt = d ? new Date(d) : new Date(Date.now() + 9 * 3600000);
    return dt.toISOString().slice(0, 10);
  }

  /* ─── 근무형태 표시 텍스트 ─── */
  const MODE_LABEL = {
    OFFICE: '사무실',
    REMOTE: '재택',
    FIELD: '외근',
    BUSINESS_TRIP: '출장',
    HYBRID: '혼합',
    HOLIDAY: '휴무',   // G15: 주말·공휴일 스케줄 → 배지 '미정' 대신 '휴무' 표기
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

    /* R39 Stage 8: 4개 API 직렬 호출 → Promise.allSettled 병렬화로 로딩 시간 단축
       (att-schedule-today·att-checkin-today·att-my-stats·att-my-status 모두 독립적·
        ~4 RTT → ~1 RTT) */
    const [schedRes, recRes, sumRes, statusRes] = await Promise.allSettled([
      api('/api/att-schedule-today'),
      api('/api/att-checkin-today'),
      api(`/api/att-my-stats?year=${yr}&month=${mo}`),
      api('/api/att-my-status'),
    ]);

    // 오늘 근무형태 렌더
    const schedData = (schedRes.status === 'fulfilled') ? schedRes.value : { data: {} };
    const mode = (schedData.data?.data?.mode || schedData.data?.mode || 'UNKNOWN');
    renderModeBadge(mode);

    // 오늘 기록 렌더
    const recData = (recRes.status === 'fulfilled') ? recRes.value : { data: {} };
    const rec = recData.data?.data || recData.data || {};
    renderCheckinStatus(rec, mode);

    // 이번달 요약 렌더
    const sumData = (sumRes.status === 'fulfilled') ? sumRes.value : { data: {} };
    const stats = sumData.data?.data || sumData.data || {};
    renderSummary(stats);

    // R35-GAP-P2 M-G4: 정책 안내 (att-my-status.policy 활용·이미 병렬 호출 결과 재사용)
    try {
      const policy = (statusRes.status === 'fulfilled')
        ? (statusRes.value.data?.data?.policy || statusRes.value.data?.policy || null)
        : null;
      renderPolicyNote(policy, mode);
    } catch (_) { /* 정책 안내 실패는 메인 흐름 차단 X */ }
    } catch (e) {
      console.error('[att] initCheckin 오류:', e);
      if (btnIn) { btnIn.disabled = false; btnIn.textContent = '출근 (새로고침 필요)'; }
      toast('출퇴근 정보를 불러오지 못했습니다. 새로고침해 주세요.');
    }
  }

  /* R35-GAP-P2 M-G4: 정책 안내 라인 */
  function renderPolicyNote(policy, mode) {
    const wrap = document.getElementById('attPolicyNote');
    const txt = document.getElementById('attPolicyNoteText');
    if (!wrap || !txt || !policy) return;
    const parts = [];
    if (policy.checkInTime) {
      parts.push(`표준 출근 ${policy.checkInTime} (지각 허용 ${policy.lateGraceMins ?? 0}분)`);
    }
    if (mode === 'REMOTE' || mode === 'BUSINESS_TRIP') {
      if (policy.coreStartTime) {
        parts.push(`${mode === 'REMOTE' ? '재택' : '출장'} 코어타임 ${policy.coreStartTime} (자율 출근)`);
      }
    }
    if (mode === 'REMOTE' && policy.remoteMaxPerMonth) {
      parts.push(`월 재택 한도 ${policy.remoteMaxPerMonth}일`);
    }
    if (parts.length === 0) { wrap.style.display = 'none'; return; }
    txt.textContent = parts.join(' · ');
    wrap.style.display = '';
  }

  function renderModeBadge(mode) {
    const badge = document.getElementById('attModeBadge');
    if (!badge) return;
    badge.className = `att-mode-badge ${mode}`;
    badge.textContent = MODE_LABEL[mode] || '미정';
  }

  function renderCheckinStatus(rec, mode) {
    const statusEl = document.getElementById('attCurrentStatus');
    const btnIn = document.getElementById('attBtnCheckin');
    const btnOut = document.getElementById('attBtnCheckout');
    const btnDoor = document.getElementById('attBtnDoor');
    const gpsNote = document.getElementById('attGpsNote');

    if (!btnIn || !btnOut) return;

    // 문 열기 버튼: OFFICE 근무 중일 때만 노출(사무실 문). onclick 재설정으로 리스너 중복 방지.
    const showDoor = (mode === 'OFFICE') && rec.checkinAt && !rec.checkoutAt;
    if (btnDoor) {
      btnDoor.style.display = showDoor ? 'flex' : 'none';
      btnDoor.onclick = showDoor ? doDoorOpen : null;
    }

    const noGps = (mode === 'REMOTE' || mode === 'BUSINESS_TRIP');
    if (gpsNote) gpsNote.textContent = noGps ? 'GPS 위치 확인 없이 기록됩니다' : 'GPS 위치 정보가 함께 기록됩니다';

    if (rec.checkoutAt) {
      // 퇴근 완료 — 재출근/시각수정이 가능하도록 출근 버튼을 '재출근'으로 노출
      btnIn.style.display = 'flex';
      btnIn.disabled = false;
      btnIn.textContent = '재출근 / 시각 수정';
      btnOut.style.display = 'none';
      if (statusEl) statusEl.innerHTML = `퇴근 완료<br><strong>출근 ${fmtTime(rec.checkinAt)} — 퇴근 ${fmtTime(rec.checkoutAt)}</strong>`;
      btnIn.addEventListener('click', () => doCheckin(mode));
    } else if (rec.checkinAt) {
      // 출근 후 대기
      btnIn.style.display = 'none';
      btnOut.style.display = 'flex';
      btnOut.disabled = false;
      if (statusEl) statusEl.innerHTML = `근무 중 <br>출근 시각: <strong>${fmtTime(rec.checkinAt)}</strong>`;
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

  /* ─── 수동 문 열기(모바일 키) ─── */
  function describeDoor(door) {
    if (!door) return '';
    if (door.ok && door.sim) return ' 문 열림(시뮬레이션 — 장치 연결 전)';
    if (door.ok) return ' 문이 열렸습니다';
    return ' 문 열림 실패 — 관리자에게 문의하세요';
  }

  async function doDoorOpen() {
    const btn = document.getElementById('attBtnDoor');
    if (btn) { btn.disabled = true; }
    try {
      const res = await api('/api/att-door-open', { method: 'POST' });
      if (!res.ok) throw new Error(res.data?.error || res.data?.detail || 'HTTP ' + res.status);
      const door = res.data?.data || {};
      if (door.ok && door.sim) toast('문 열림(시뮬레이션 — 장치 연결 전)');
      else if (door.ok) toast('문이 열렸습니다');
      else toast('문 열림 실패 — 관리자에게 문의하세요', 5000);
    } catch (e) {
      toast('문 열기 실패: ' + e.message, 5000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderSummary(stats) {
    // G2: 서버 응답은 { data: { monthly: { work_days, total_working_mins, late_count, remote_days, ... } } }
    //     (snake_case·monthly 중첩). 근무시간은 분→시간 환산.
    const m = stats.monthly || {};
    setText('sumWorkDays', m.work_days ?? '—');
    setText('sumWorkHours', m.total_working_mins != null ? (Number(m.total_working_mins) / 60).toFixed(1) : '—');
    setText('sumLateCount', m.late_count ?? '—');
    setText('sumRemoteDays', m.remote_days ?? '—');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /**
   * R39 Stage 5 A-3: 모든 디바이스(모바일·PC·노트북) 위치 강제 수집.
   * - 권한 거부·실패 시 출근 차단
   * - PC에선 Wi-Fi 기반(낮은 정확도)도 기록 가치 ↑ → enableHighAccuracy:false
   * - timeout 30초 (PC Wi-Fi 측위가 느린 경우 대비)
   * - 단, OFFICE/FIELD 모드는 거점 반경 검증을 위해 가급적 고정밀(enableHighAccuracy:true)
   */
  async function doCheckin(mode) {
    const btn = document.getElementById('attBtnCheckin');
    if (btn) btn.disabled = true;

    if (!navigator.geolocation) {
      toast('이 브라우저는 위치 정보를 지원하지 않습니다. PC 출퇴근은 위치 권한이 필요합니다.');
      if (btn) btn.disabled = false;
      return;
    }
    const wantHighAccuracy = (mode === 'OFFICE' || mode === 'FIELD');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendCheckin(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        const msg = (err && err.code === 1)
          ? '위치 권한이 필요합니다. 브라우저 주소창 좌측 자물쇠 아이콘에서 위치 권한을 [허용]으로 변경 후 다시 시도하세요.'
          : '위치 정보를 가져오지 못했습니다 (' + (err?.message || '시간 초과') + '). PC라면 Wi-Fi 연결을 확인해 주세요.';
        toast(msg);
        if (btn) btn.disabled = false;
      },
      { timeout: 30000, enableHighAccuracy: wantHighAccuracy, maximumAge: 60000 }
    );
  }

  async function sendCheckin(lat, lng, workplaceId, reentryMode) {
    const body = { deviceType: detectDeviceType() };
    if (lat !== null) { body.lat = lat; body.lng = lng; }
    if (workplaceId != null) body.workplaceId = workplaceId;
    if (reentryMode) body.reentryMode = reentryMode;
    const res = await api('/api/att-checkin', { method: 'POST', body });

    // 이미 퇴근한 상태에서 출근 → 재출근/퇴근취소/시각수정 선택
    if (!res.ok && res.data?.needsReentryChoice) {
      promptReentry(!!res.data.inWorkHours, async (choice) => {
        const btn = document.getElementById('attBtnCheckin');
        if (choice == null) { if (btn) btn.disabled = false; return; }
        if (choice === 'edit') { if (btn) btn.disabled = false; promptSessionEdit(); return; }
        await sendCheckin(lat, lng, workplaceId, choice); // 'new' | 'reopen'
      });
      return;
    }

    // R36 A-2: FIELD 모드 거점 선택 요청
    if (!res.ok && res.data?.needsWorkplaceSelection) {
      const list = res.data.workplaces || [];
      if (!Array.isArray(list) || list.length === 0) {
        toast('외근지 거점이 등록되어 있지 않습니다');
        const btn = document.getElementById('attBtnCheckin');
        if (btn) btn.disabled = false;
        return;
      }
      promptFieldWorkplace(list, async (chosenId) => {
        if (chosenId == null) {
          const btn = document.getElementById('attBtnCheckin');
          if (btn) btn.disabled = false;
          return;
        }
        await sendCheckin(lat, lng, chosenId, reentryMode);
      });
      return;
    }

    if (!res.ok) {
      toast('출근 기록 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      const btn = document.getElementById('attBtnCheckin');
      if (btn) btn.disabled = false;
      return;
    }
    const d = res.data?.data || res.data || {};
    const doorMsg = describeDoor(d.door);
    toast((d.reopened ? '퇴근이 취소되어 다시 근무 중입니다 '
      : (d.reentry ? '재출근이 기록되었습니다 ' : '출근이 기록되었습니다 ')) + doorMsg,
      doorMsg ? 4200 : 2600);
    setTimeout(() => location.reload(), doorMsg ? 1400 : 800);
  }

  /* 재출근/퇴근취소/시각수정 선택 모달 (동적 생성) */
  function promptReentry(inWorkHours, callback) {
    const ex = document.getElementById('reentryModal'); if (ex) ex.remove();
    const modal = document.createElement('div');
    modal.id = 'reentryModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
    const bStyle = 'padding:12px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:14px;text-align:left';
    const pStyle = 'padding:12px;border-radius:8px;border:0;background:#16a34a;color:#fff;cursor:pointer;font-size:14px;font-weight:600';
    const reopenBtn = inWorkHours ? `<button type="button" id="reReopen" style="${bStyle}">퇴근을 잘못 눌렀어요 (퇴근 취소)</button>` : '';
    const editBtn = inWorkHours ? `<button type="button" id="reEdit" style="${bStyle}">출퇴근 시각 직접 수정</button>` : '';
    const notice = inWorkHours ? '' : '<div style="font-size:12.5px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;margin-bottom:12px">업무시간이 지나 <b>재출근</b>만 가능합니다. 기존 퇴근 기록은 보존됩니다.</div>';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:24px;width:92%;max-width:420px">
        <h3 style="margin:0 0 8px;font-size:17px">이미 퇴근한 상태입니다</h3>
        <div style="font-size:13px;color:#6b7280;margin-bottom:14px">어떻게 처리할까요?</div>
        ${notice}
        <div style="display:flex;flex-direction:column;gap:8px">
          <button type="button" id="reNew" style="${pStyle}">재출근 (다시 근무 시작)</button>
          ${reopenBtn}
          ${editBtn}
          <button type="button" id="reCancel" style="padding:10px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;cursor:pointer;font-size:13px">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#reNew').addEventListener('click', () => { modal.remove(); callback('new'); });
    if (inWorkHours) {
      modal.querySelector('#reReopen').addEventListener('click', () => { modal.remove(); callback('reopen'); });
      modal.querySelector('#reEdit').addEventListener('click', () => { modal.remove(); callback('edit'); });
    }
    modal.querySelector('#reCancel').addEventListener('click', () => { modal.remove(); callback(null); });
  }

  /* 출퇴근 시각 셀프수정 모달 (업무시간 내) */
  function promptSessionEdit() {
    const ex = document.getElementById('sessEditModal'); if (ex) ex.remove();
    const modal = document.createElement('div');
    modal.id = 'sessEditModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
    const inputStyle = 'padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;margin-left:8px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:24px;width:92%;max-width:380px">
        <h3 style="margin:0 0 12px;font-size:17px">출퇴근 시각 수정</h3>
        <div style="font-size:12.5px;color:#6b7280;margin-bottom:14px">오늘 출근/퇴근 시각을 직접 수정합니다. 비워 두면 그 항목은 그대로 둡니다.</div>
        <label style="display:block;margin-bottom:10px">출근<input type="time" id="seIn" style="${inputStyle}"></label>
        <label style="display:block;margin-bottom:14px">퇴근<input type="time" id="seOut" style="${inputStyle}"></label>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" id="seCancel" style="padding:8px 14px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;cursor:pointer">취소</button>
          <button type="button" id="seSave" style="padding:8px 14px;background:#3b82f6;color:#fff;border:0;border-radius:6px;cursor:pointer">저장</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#seCancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#seSave').addEventListener('click', async () => {
      const ci = modal.querySelector('#seIn').value;
      const co = modal.querySelector('#seOut').value;
      if (!ci && !co) { toast('수정할 시각을 입력하세요'); return; }
      const reqBody = {};
      if (ci) reqBody.checkIn = ci;
      if (co) reqBody.checkOut = co;
      const res = await api('/api/att-session-edit', { method: 'POST', body: reqBody });
      if (!res.ok) { toast('수정 실패: ' + (res.data?.error || res.data?.detail || res.status)); return; }
      modal.remove();
      toast('출퇴근 시각이 수정되었습니다');
      setTimeout(() => location.reload(), 700);
    });
  }

  /* R36 A-2: 외근지 선택 모달 (동적 생성) */
  function promptFieldWorkplace(workplaces, callback) {
    const existing = document.getElementById('fieldWpModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'fieldWpModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
    const items = workplaces.map(w =>
      `<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:6px;cursor:pointer">
        <input type="radio" name="fieldWp" value="${w.id}">
        <div>
          <div style="font-weight:600">${escapeHtml(w.name)}</div>
          ${w.address ? `<div style="font-size:12px;color:#6b7280">${escapeHtml(w.address)}</div>` : ''}
        </div>
      </label>`
    ).join('');
    modal.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:24px;width:92%;max-width:420px;max-height:80vh;overflow-y:auto">
        <h3 style="margin:0 0 12px;font-size:17px">외근지 선택</h3>
        <div style="font-size:13px;color:#6b7280;margin-bottom:12px">오늘 출근할 외근지를 선택해 주세요</div>
        ${items}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button type="button" id="fieldWpCancel" style="padding:8px 14px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;cursor:pointer">취소</button>
          <button type="button" id="fieldWpOk" style="padding:8px 14px;background:#3b82f6;color:#fff;border:0;border-radius:6px;cursor:pointer">출근</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#fieldWpCancel').addEventListener('click', () => { modal.remove(); callback(null); });
    modal.querySelector('#fieldWpOk').addEventListener('click', () => {
      const sel = modal.querySelector('input[name="fieldWp"]:checked');
      if (!sel) { toast('외근지를 선택해 주세요'); return; }
      const id = Number(sel.value);
      modal.remove();
      callback(id);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* R39 Stage 7 후속 fix: 디바이스 타입 감지 (출퇴근 기록 시 서버에 전송) */
  function detectDeviceType() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)) return 'MOBILE';
    if (/ipad|tablet|kindle/.test(ua)) return 'TABLET';
    return 'DESKTOP';
  }

  /* R39 Stage 5 A-3: 퇴근도 모든 모드 위치 강제 수집 */
  async function doCheckout(mode) {
    const btn = document.getElementById('attBtnCheckout');
    if (btn) btn.disabled = true;

    if (!navigator.geolocation) {
      toast('이 브라우저는 위치 정보를 지원하지 않습니다. PC 출퇴근은 위치 권한이 필요합니다.');
      if (btn) btn.disabled = false;
      return;
    }
    const wantHighAccuracy = (mode === 'OFFICE' || mode === 'FIELD');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await sendCheckout(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        const msg = (err && err.code === 1)
          ? '위치 권한이 필요합니다. 브라우저 주소창 좌측 자물쇠 아이콘에서 위치 권한을 [허용]으로 변경 후 다시 시도하세요.'
          : '위치 정보를 가져오지 못했습니다 (' + (err?.message || '시간 초과') + '). PC라면 Wi-Fi 연결을 확인해 주세요.';
        toast(msg);
        if (btn) btn.disabled = false;
      },
      { timeout: 30000, enableHighAccuracy: wantHighAccuracy, maximumAge: 60000 }
    );
  }

  async function sendCheckout(lat, lng) {
    const body = { deviceType: detectDeviceType() };
    if (lat !== null) { body.lat = lat; body.lng = lng; }
    const cBtn = document.getElementById('attBtnCheckout');

    /* ① 근무시간 미달 확인 (DB 미반영 미리보기) — Swain 2026-05-26 */
    try {
      const pv = await api('/api/att-checkout', { method: 'POST', body: Object.assign({ preview: true }, body) });
      const p = (pv.data && (pv.data.data || pv.data)) || {};
      if (pv.ok && p.underHours) {
        const sm = p.shortfallMins || 0;
        const h = Math.floor(sm / 60), m = sm % 60;
        const lack = (h ? h + '시간 ' : '') + m + '분';
        if (!confirm('아직 근무시간이 ' + lack + ' 부족합니다.\n그래도 퇴근하시겠어요?')) {
          if (cBtn) cBtn.disabled = false;
          return;
        }
      }
    } catch (e) { /* 미리보기 실패해도 퇴근은 진행 */ }

    const res = await api('/api/att-checkout', { method: 'POST', body });
    if (!res.ok) {
      toast('퇴근 기록 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      const btn = document.getElementById('attBtnCheckout');
      if (btn) btn.disabled = false;
      return;
    }
    toast('퇴근이 기록되었습니다 ');
    // 재택근무이고 보고서 미제출이면 안내
    const resData = res.data?.data || res.data || {};
    if (resData.reportSubmitted === false) {
      setTimeout(() => {
        toast('재택보고서를 작성해주세요. "재택보고서" 탭을 확인하세요.', 4000);
      }, 900);
    }
    setTimeout(() => location.reload(), 800);
  }

  /* ═══════════════════════════════════
     탭 2: 캘린더
  ═══════════════════════════════════ */
  /* G4: 출퇴근 상태 한글 라벨 (조퇴 EARLY_LEAVE 포함) — 캘린더 이벤트 제목용 */
  const ATT_STATUS_LABEL = {
    NORMAL: '정상',
    LATE: '지각',
    EARLY_LEAVE: '조퇴',
    ABSENT: '결근',
    LEAVE: '휴가',
    HOLIDAY: '공휴일',
  };
  /* 캘린더 색상 — 실제 출퇴근 상태(status) 기준.
     REMOTE/FIELD는 근무형태(work_mode) 값이라 status 색칠에서 제외(죽은 매핑 정리).
     G4: EARLY_LEAVE(조퇴) 추가. */
  const STATUS_CLASS = {
    NORMAL: 'att-ev-normal',
    LATE: 'att-ev-late',
    EARLY_LEAVE: 'att-ev-early',
    ABSENT: 'att-ev-absent',
    LEAVE: 'att-ev-leave',
    HOLIDAY: 'att-ev-holiday',
  };
  const BG_CLASS = {
    NORMAL: 'att-bg-normal',
    LATE: 'att-bg-late',
    EARLY_LEAVE: 'att-bg-early',
    ABSENT: 'att-bg-absent',
    LEAVE: 'att-bg-leave',
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
        // P1-18 fix: info.start는 전월 말(그리드 첫 칸)이라 +2 하드코딩이 1월=13월·일요일시작달 오류.
        //           FullCalendar가 제공하는 당월 1일(currentStart)로 연·월 산출.
        const cur = info.view.currentStart;
        const yr = cur.getFullYear();
        const mo = cur.getMonth() + 1;
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
    // G3: 서버 응답은 { data: { year, month, records: [...] } } — records 배열을 꺼내야 함
    //     (기존엔 래퍼 객체 전체를 배열로 기대 → Array.isArray 실패로 빈 캘린더)
    const rows = res.data?.data?.records || res.data?.records || [];
    if (!Array.isArray(rows)) return;

    rows.forEach(row => {
      const cls = STATUS_CLASS[row.status] || '';
      const statusLabel = ATT_STATUS_LABEL[row.status] || row.status || '';
      // 출퇴근 시각 — 캘린더 셀에 직접 명시 (G16: 일별 출퇴근기록 표시)
      const ci = row.checkInTime ? fmtTime(row.checkInTime) : null;
      const co = row.checkOutTime ? fmtTime(row.checkOutTime) : null;

      // 1행: 상태 배지 (+ 출근 시각 요약)
      calendar.addEvent({
        title: ci ? `${statusLabel} ${ci}` : statusLabel,
        start: row.date,
        allDay: true,
        classNames: [cls],
      });
      // 2행: 출근~퇴근 시각 (기록이 있을 때만)
      if (ci || co) {
        calendar.addEvent({
          title: `${ci || '—'} → ${co || '근무 중'}`,
          start: row.date,
          allDay: true,
          classNames: ['att-ev-time'],
        });
      }
      // 배경 셀 착색
      const bgCls = BG_CLASS[row.status];
      if (bgCls) {
        const cell = calendar.el.querySelector(`[data-date="${row.date}"]`);
        if (cell) cell.classList.add(bgCls);
      }
    });

    // 2026-06-27: 표시 중인 달 총 근무시간 요약 (통계 탭과 동일 집계 재사용)
    try {
      const sres = await api(`/api/att-my-stats?year=${yr}&month=${mo}`);
      const mm = (sres.data?.data || sres.data || {}).monthly || {};
      const mins = Number(mm.total_working_mins || 0);
      const el = document.getElementById('attCalSummary');
      if (el) {
        const h = Math.floor(mins / 60), mn = mins % 60;
        const hhmm = mins > 0 ? `${h}시간${mn ? ' ' + mn + '분' : ''}` : '0시간';
        el.textContent = `${yr}년 ${mo}월 총 근무시간: ${hhmm} · 근무 ${mm.work_days ?? 0}일`;
        el.style.display = 'block';
      }
    } catch (_) { /* 요약 실패해도 캘린더는 정상 */ }
  }

  /* ═══════════════════════════════════
     탭 3: 통계
  ═══════════════════════════════════ */
  async function initStats() {
    window._attStatsInit = true;
    const now = new Date();
    const res = await api(`/api/att-my-stats?year=${now.getFullYear()}&month=${now.getMonth() + 1}`);
    const stats = res.data?.data || res.data || {};
    // G2: monthly 중첩·snake_case 매핑 (출퇴근 탭 요약과 동일 규약)
    const m = stats.monthly || {};

    setText('statWorkDays', m.work_days ?? '—');
    setText('statWorkHours', m.total_working_mins != null ? (Number(m.total_working_mins) / 60).toFixed(1) : '—');
    setText('statLateCount', m.late_count ?? '—');
    setText('statRemoteDays', m.remote_days ?? '—');

    renderDonut(m);
  }

  function renderDonut(monthly) {
    const ctx = document.getElementById('attDonutChart');
    if (!ctx || typeof Chart === 'undefined') return;

    // G2: 서버 monthly 집계로 근무형태 분포 구성 (기존 modeDist 가정 제거).
    //     사무실 일수 = 전체 근무일 − (재택+외근+출장)  (work_mode가 OFFICE/HYBRID/미지정인 날)
    const m = monthly || {};
    const remote = Number(m.remote_days || 0);
    const field = Number(m.field_days || 0);
    const trip = Number(m.business_trip_days || 0);
    const office = Math.max(0, Number(m.work_days || 0) - remote - field - trip);

    const labels = ['사무실', '재택', '외근', '출장'];
    const values = [office, remote, field, trip];
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
    const tbody = document.getElementById('attLeaveBalanceBody');
    if (!tbody) return;
    /* 2026-05-29 P2-4 fix — "조회 중…" 무한 멈춤 방지·실패/빈 결과별 안내 분리 */
    try {
      const res = await api('/api/att-leave-balance');
      if (res && res.ok === false) {
        tbody.innerHTML = '<tr><td colspan="4" class="att-empty">잔여 휴가를 불러오지 못했습니다 (잠시 후 다시 시도해주세요)</td></tr>';
        return;
      }
      const rows = res.data?.data || res.data || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="att-empty">아직 부여된 휴가가 없습니다. 운영자에게 휴가 부여를 요청하세요.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escHtml(r.name || r.typeName || '—')}</td>
          <td>${r.granted ?? '—'}</td>
          <td>${r.used ?? '—'}</td>
          <td><strong>${r.remaining ?? '—'}</strong></td>
        </tr>`).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="att-empty">잔여 휴가를 불러오지 못했습니다 (잠시 후 다시 시도해주세요)</td></tr>';
    }
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
        <td><span class="att-badge ${r.status || ''}">${statusLabel(r.status)}</span>${(r.status === 'PENDING' && r.id) ? ` <button type="button" class="att-leave-withdraw" data-id="${r.id}" style="margin-left:6px;font-size:11px;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer">철회</button>` : ''}</td>
      </tr>`;
    }).join('');

    // Q3-009: 본인 PENDING 신청 셀프 철회 (delegated · 1회 바인딩)
    if (tbody && !tbody.dataset.withdrawBound) {
      tbody.dataset.withdrawBound = '1';
      tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('.att-leave-withdraw');
        if (!btn) return;
        const id = btn.dataset.id;
        if (!id || !confirm('이 휴가 신청을 철회하시겠습니까?')) return;
        try {
          // P2-67 fix: api()는 실패 시 throw하지 않으므로 결과를 확인 (과거: 409 거부에도 '철회됨' 거짓 토스트 → 출근 사고 위험)
          const res = await api('/api/att-leave-request?id=' + id, { method: 'DELETE' });
          if (!res || res.ok === false) {
            toast('철회 실패: ' + (res?.data?.error || '이미 승인·반려된 신청일 수 있습니다'));
            return;
          }
          toast('신청이 철회되었습니다');
          loadLeaveHistory();
        } catch (err) {
          toast('철회 실패: ' + (err?.message || ''));
        }
      });
    }
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
  /* ── 증빙 첨부 ──
     사유만 글로 적게 하면 결재자가 출장·병원·회의 같은 정정을 글만 보고 판단해야 한다.
     서류를 붙일 수 있게 하되, 파일은 근태 시스템이 따로 쌓지 않고 **본인 파일함**에 넣는다
     (한 번 올린 서류를 다음 요청에서 다시 고를 수 있고, 본인이 직접 지울 수도 있다). */
  const AMEND_MAX_BYTES = 20 * 1024 * 1024;   // 20MB — 종류(확장자) 제한은 없음
  const AMEND_MAX_FILES = 10;
  let amendFiles = [];        // [{ fileId, name, sizeBytes, mimeType }]
  let _driveFiles = [];       // 파일함 목록 캐시

  function fmtBytes(n) {
    const b = Number(n || 0);
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + 'MB';
    if (b >= 1024) return Math.round(b / 1024) + 'KB';
    return b + 'B';
  }

  function renderAmendFiles() {
    const box = document.getElementById('attAmendFileList');
    if (!box) return;
    box.innerHTML = amendFiles.map((f, i) => `
      <div class="att-chip${f.uploading ? ' uploading' : ''}">
        <span class="siren-icon-wrap" data-icon="file-text"></span>
        <span class="att-chip-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        ${f.uploading
          ? `<span class="att-chip-bar"><i style="width:${Math.round(f.progress || 0)}%"></i></span>`
          : `<span class="att-chip-size">${fmtBytes(f.sizeBytes)}</span>
             <button type="button" class="att-chip-x" onclick="attRemoveAmendFile(${i})" title="첨부 해제">✕</button>`}
      </div>`).join('');
    if (window.SirenIcons?.render) window.SirenIcons.render(box);
  }
  window.attRemoveAmendFile = (i) => { amendFiles.splice(i, 1); renderAmendFiles(); };

  /** 파일 하나 올리기 — 브라우저가 저장소로 직접 보낸다(서버 본문 한도를 넘기지 않으려고) */
  async function uploadAmendFile(file) {
    if (amendFiles.length >= AMEND_MAX_FILES) { toast(`첨부는 최대 ${AMEND_MAX_FILES}개까지입니다`); return; }
    if (file.size > AMEND_MAX_BYTES) {
      toast(`${file.name} — 20MB를 넘습니다 (${fmtBytes(file.size)})`);
      return;
    }
    if (!file.size) { toast(`${file.name} — 빈 파일입니다`); return; }

    const entry = { name: file.name, sizeBytes: file.size, mimeType: file.type || 'application/octet-stream', uploading: true, progress: 0 };
    amendFiles.push(entry);
    renderAmendFiles();

    try {
      const pre = await api('/api/att-correction-files?action=presign', {
        method: 'POST',
        body: { name: file.name, sizeBytes: file.size, mimeType: entry.mimeType },
      });
      if (!pre.ok) throw new Error(pre.data?.error || '업로드 준비 실패');
      const d = pre.data?.data || pre.data;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', d.uploadUrl);
        xhr.setRequestHeader('Content-Type', entry.mimeType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) { entry.progress = (e.loaded / e.total) * 100; renderAmendFiles(); }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error('저장소 업로드 실패 (' + xhr.status + ')'));
        xhr.onerror = () => reject(new Error('네트워크 오류로 업로드에 실패했습니다'));
        xhr.send(file);
      });

      const conf = await api('/api/att-correction-files?action=confirm', {
        method: 'POST', body: { fileId: d.fileId },
      });
      if (!conf.ok) throw new Error(conf.data?.error || '업로드 확정 실패');

      entry.fileId = d.fileId;
      entry.uploading = false;
      renderAmendFiles();
      _driveFiles = [];   // 파일함 목록 캐시 무효화 (방금 올린 파일이 보이도록)
    } catch (err) {
      const i = amendFiles.indexOf(entry);
      if (i >= 0) amendFiles.splice(i, 1);
      renderAmendFiles();
      toast(file.name + ' — ' + (err.message || '업로드 실패'));
    }
  }

  async function addAmendFiles(fileList) {
    for (const f of Array.from(fileList || [])) await uploadAmendFile(f);
  }

  /* 내 파일함에서 고르기 — 이미 올려둔 서류를 다시 붙인다 */
  async function openFileDrive() {
    const modal = document.getElementById('attFileDriveModal');
    const list = document.getElementById('attFileDriveList');
    if (!modal || !list) return;
    modal.style.display = 'flex';
    list.innerHTML = '<div class="att-empty">불러오는 중…</div>';

    if (!_driveFiles.length) {
      const res = await api('/api/att-correction-files');
      if (!res.ok) { list.innerHTML = '<div class="att-empty">파일함을 불러오지 못했습니다</div>'; return; }
      _driveFiles = (res.data?.data?.files || res.data?.files || []);
    }
    renderFileDrive();
  }
  function renderFileDrive() {
    const list = document.getElementById('attFileDriveList');
    if (!list) return;
    const q = (document.getElementById('attFileDriveSearch')?.value || '').trim().toLowerCase();
    const rows = _driveFiles.filter(f => !q || String(f.name || '').toLowerCase().includes(q));
    if (!rows.length) {
      list.innerHTML = `<div class="att-empty">${q ? '찾는 파일이 없습니다' : '파일함이 비어 있습니다. 위에서 파일을 올려보세요.'}</div>`;
      return;
    }
    list.innerHTML = rows.map(f => {
      const already = amendFiles.some(a => a.fileId === f.id);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 8px;border-bottom:1px solid #f3f4f6">
          <span class="siren-icon-wrap" data-icon="file-text"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
          <span style="color:#9ca3af;font-size:12px;white-space:nowrap">${fmtBytes(f.sizeBytes)}</span>
          <button type="button" class="att-btn att-btn-sm ${already ? 'att-btn-default' : 'att-btn-primary'}"
                  ${already ? 'disabled' : ''} onclick="attPickDriveFile(${f.id})">${already ? '첨부됨' : '첨부'}</button>
        </div>`;
    }).join('');
    if (window.SirenIcons?.render) window.SirenIcons.render(list);
  }
  window.attPickDriveFile = (fileId) => {
    if (amendFiles.length >= AMEND_MAX_FILES) { toast(`첨부는 최대 ${AMEND_MAX_FILES}개까지입니다`); return; }
    const f = _driveFiles.find(x => x.id === fileId);
    if (!f || amendFiles.some(a => a.fileId === fileId)) return;
    amendFiles.push({ fileId: f.id, name: f.name, sizeBytes: f.sizeBytes, mimeType: f.mimeType });
    renderAmendFiles();
    renderFileDrive();
  };

  async function initAmend() {
    window._attAmendInit = true;

    const today = toDateStr();
    const dateEl = document.getElementById('attAmendDate');
    if (dateEl) dateEl.value = today;

    document.getElementById('attBtnAmendSubmit')?.addEventListener('click', submitAmend);

    /* 증빙 첨부 — 파일 선택 · 끌어다 놓기 · 파일함에서 고르기 */
    const input = document.getElementById('attAmendFileInput');
    const drop = document.getElementById('attAmendDrop');
    document.getElementById('attBtnAmendPick')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async (e) => {
      await addAmendFiles(e.target.files);
      e.target.value = '';    // 같은 파일을 다시 골라도 반응하도록
    });
    if (drop) {
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
        e.preventDefault(); drop.classList.add('dragover');
      }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => {
        e.preventDefault(); drop.classList.remove('dragover');
      }));
      drop.addEventListener('drop', (e) => addAmendFiles(e.dataTransfer?.files));
    }
    document.getElementById('attBtnAmendFromDrive')?.addEventListener('click', openFileDrive);
    document.getElementById('attFileDriveClose')?.addEventListener('click', () => {
      const m = document.getElementById('attFileDriveModal');
      if (m) m.style.display = 'none';
    });
    document.getElementById('attFileDriveSearch')?.addEventListener('input', renderFileDrive);
    document.getElementById('attFileDriveModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'attFileDriveModal') e.target.style.display = 'none';
    });

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

    if (amendFiles.some(f => f.uploading)) { toast('첨부 파일 업로드가 끝난 뒤 제출하세요'); return; }

    const btn = document.getElementById('attBtnAmendSubmit');
    if (btn) btn.disabled = true;

    // R34-P2: amend → correction 마이그
    const CORRECTION_TYPE = { CHECKIN: 'CHECK_IN', CHECKOUT: 'CHECK_OUT', BOTH: 'BOTH' };
    const res = await api('/api/att-correction-request', {
      method: 'POST',
      body: {
        targetDate: date,
        correctionType: CORRECTION_TYPE[type] || type,
        requestedCheckIn:  ci ? `${date}T${ci}:00+09:00` : null,   // KST 오프셋 명시(서버 UTC 오해석 방지)
        requestedCheckOut: co ? `${date}T${co}:00+09:00` : null,
        reason,
        evidenceFiles: amendFiles.filter(f => f.fileId).map(f => ({ fileId: f.fileId })),
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
    amendFiles = [];
    renderAmendFiles();
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
    tbody.innerHTML = rows.map(r => {
      const files = Array.isArray(r.evidenceFiles) ? r.evidenceFiles : [];
      const clips = files.length
        ? '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">' + files.map(f =>
            `<a href="#" onclick="attOpenMyEvidence(${Number(f.fileId)});return false"
                style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#2563eb;text-decoration:underline"
                title="${escHtml(f.name || '')}"><span class="siren-icon-wrap" data-icon="paperclip" style="width:11px;height:11px"></span>${escHtml(String(f.name || '첨부').slice(0, 16))}</a>`
          ).join('') + '</div>'
        : '';
      return `
      <tr>
        <td>${escHtml(r.targetDate || '—')}</td>
        <td>${typeLabel[r.correctionType] || r.correctionType || '—'}</td>
        <td style="font-size:12px">
          ${r.requestedCheckIn ? '출근 ' + fmtTime(r.requestedCheckIn) : ''}
          ${r.requestedCheckOut ? '<br>퇴근 ' + fmtTime(r.requestedCheckOut) : ''}
        </td>
        <td style="max-width:160px">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.reason || '')}">${escHtml(r.reason || '—')}</div>
          ${clips}
        </td>
        <td><span class="att-badge ${r.status || ''}">${statusLabel(r.status)}</span></td>
      </tr>`;
    }).join('');
    if (window.SirenIcons?.render) window.SirenIcons.render(tbody);
  }

  /** 내가 첨부한 증빙 열기 (본인 파일만 열린다) */
  window.attOpenMyEvidence = async (fileId) => {
    const res = await api('/api/att-correction-files?download=' + fileId);
    const d = res.data?.data || res.data;
    if (!res.ok || !d?.url) { toast(res.data?.error || '파일을 열 수 없습니다'); return; }
    window.open(d.url, '_blank');
  };

  /* ═══════════════════════════════════
     탭 6: 재택보고서
  ═══════════════════════════════════ */
  let currentReportDate = null;   // 편집 중인 보고서 날짜(히스토리 선택 지원)
  function getReportDate() { return currentReportDate || toDateStr(); }

  async function loadReport(pickDate) {
    if (pickDate) currentReportDate = pickDate;
    if (!currentReportDate) currentReportDate = toDateStr();
    const dateStr = currentReportDate;
    const statusBar = document.getElementById('attReportStatusBar');
    const statusText = document.getElementById('attReportStatusText');
    const metaEl = document.getElementById('attReportMeta');
    const wbsEl = document.getElementById('attReportWbsCards');
    const contentEl = document.getElementById('attReportContent');
    const btnDraft = document.getElementById('attBtnSaveDraft');
    const btnSubmit = document.getElementById('attBtnSubmitReport');

    if (statusText) statusText.textContent = '보고서 상태를 불러오는 중...';

    const res = await api('/api/att/remote-report?date=' + dateStr);
    // 빈 응답(envelope {ok:true,data:null})을 draft로 오인하지 않도록 정확히 추출
    const report = (res.data && Object.prototype.hasOwnProperty.call(res.data, 'data'))
      ? (res.data.data ?? null)
      : (res.data ?? null);

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
    const btnDelete = document.getElementById('attBtnDeleteReport');
    if (btnDelete && !btnDelete._bound) {
      btnDelete._bound = true;
      btnDelete.addEventListener('click', deleteReport);
    }
    const btnEdit = document.getElementById('attBtnEditReport');
    if (btnEdit && !btnEdit._bound) {
      btnEdit._bound = true;
      btnEdit.addEventListener('click', enableReportEdit);
    }
    const btnToday = document.getElementById('attBtnTodayReport');
    if (btnToday && !btnToday._bound) {
      btnToday._bound = true;
      btnToday.addEventListener('click', () => loadReport(toDateStr()));
    }

    const btnBack = document.getElementById('attBtnBackToday');
    if (btnBack && !btnBack._bound) {
      btnBack._bound = true;
      btnBack.addEventListener('click', () => loadReport(toDateStr()));
    }

    /* 어느 날짜를 쓰고 있는지 항상 보이게 — 지난 재택일 보고서를 쓸 때 헷갈리지 않도록 */
    const dateBar = document.getElementById('attReportDateBar');
    const dateText = document.getElementById('attReportDateText');
    if (dateBar && dateText) {
      const isToday = dateStr === toDateStr();
      dateBar.style.display = isToday ? 'none' : 'flex';
      if (!isToday) dateText.innerHTML = '<b>' + dateStr + '</b> 재택근무 보고서를 작성하고 있습니다.';
    }

    // 미제출 재택일 + 지난 보고서 히스토리 갱신
    loadPendingRemoteDays();
    loadReportHistory();
  }

  /* ─── 아직 안 낸 재택일 (마감 안내) ───
     기존 화면은 '오늘 보고서'만 보여줘서, 재택했는데 안 낸 날이 있어도 알 수가 없었다.
     제출 기한(재택일 +3일)이 생겼으므로 '무엇을 언제까지 내야 하는지'를 맨 위에 띄운다. */
  const PENDING_TONE = {
    danger: { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' },
    warn:   { bg: '#fffbeb', bd: '#fde68a', fg: '#b45309' },
    info:   { bg: '#f0f9ff', bd: '#bae6fd', fg: '#0369a1' },
    closed: { bg: '#f3f4f6', bd: '#d1d5db', fg: '#6b7280' },
  };

  async function loadPendingRemoteDays() {
    const box = document.getElementById('attPendingBox');
    if (!box) return;

    const res = await api('/api/att/remote-report?pending=1');
    if (!res.ok) { box.style.display = 'none'; return; }
    const d = (res.data && res.data.data) || res.data || {};
    const list = d.list || [];
    if (list.length === 0) { box.style.display = 'none'; return; }

    const open = list.filter(x => !x.closed);
    const closed = list.filter(x => x.closed);

    const chip = (x) => {
      const t = PENDING_TONE[x.badgeTone] || PENDING_TONE.info;
      const clickable = !x.closed;
      return '<button type="button" class="att-pending-chip" data-date="' + x.date + '"' +
        (clickable ? '' : ' disabled') +
        ' style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;' +
        'background:' + t.bg + ';border:1px solid ' + t.bd + ';color:' + t.fg + ';font-size:12.5px;font-weight:600;' +
        'cursor:' + (clickable ? 'pointer' : 'not-allowed') + ';font-family:inherit">' +
        '<span>' + x.date + '</span>' +
        '<span style="font-weight:700">' + x.badgeText + '</span>' +
        (x.hasDraft ? '<span style="font-weight:400;opacity:.8">임시저장 있음</span>' : '') +
        '</button>';
    };

    let html = '<div style="padding:14px 16px;border-radius:10px;background:#fff;border:1px solid #e5e7eb">';
    html += '<div style="font-size:13.5px;font-weight:700;color:#111827;margin-bottom:6px">' +
      '<span class="siren-icon-wrap" data-icon="alert-triangle"></span> 아직 제출하지 않은 재택근무 보고서' +
      '</div>';
    html += '<div style="font-size:12px;color:#6b7280;line-height:1.6;margin-bottom:10px">' +
      escapeHtml(d.notice || '') + '</div>';

    if (open.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:' + (closed.length ? '12px' : '0') + '">' +
        open.map(chip).join('') + '</div>';
    }
    if (closed.length) {
      html += '<div style="font-size:12px;color:#991b1b;font-weight:600;margin-bottom:6px">' +
        '기한이 지나 근무 불인정된 날 (' + closed.length + '일) — 제출할 수 없습니다. 사정이 있으면 관리자에게 예외 인정을 요청하세요.</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px">' + closed.map(chip).join('') + '</div>';
    }
    html += '</div>';

    box.innerHTML = html;
    box.style.display = 'block';
    if (window.Icons && Icons.hydrate) { try { Icons.hydrate(box); } catch (e) {} }

    box.querySelectorAll('.att-pending-chip:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => loadReport(btn.dataset.date));
    });
  }

  /* ─── 지난 보고서 히스토리 ─── */
  async function loadReportHistory() {
    const box = document.getElementById('attReportHistory');
    if (!box) return;
    const res = await api('/api/att/remote-report?list=1');
    const list = (res.data?.data?.list || res.data?.list || []);
    if (!Array.isArray(list) || list.length === 0) {
      box.innerHTML = '<span style="font-size:13px;color:#9ca3af">저장된 보고서가 없습니다.</span>';
      return;
    }
    const today = toDateStr();
    box.innerHTML = list.map(r => {
      const isSel = r.date === currentReportDate;
      const submitted = r.status === 'SUBMITTED';
      const badge = submitted
        ? '<span style="background:#dcfce7;color:#15803d;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600">제출</span>'
        : '<span style="background:#fef9c3;color:#854d0e;padding:1px 8px;border-radius:99px;font-size:11px;font-weight:600">임시</span>';
      const preview = escHtml(String(r.content || r.aiDraft || '').replace(/\s+/g, ' ').slice(0, 40));
      return `
      <button type="button" data-report-date="${r.date}"
        style="display:flex;align-items:center;gap:10px;text-align:left;width:100%;padding:9px 12px;border:1px solid ${isSel ? '#7c3aed' : '#e5e7eb'};background:${isSel ? '#f5f3ff' : '#fff'};border-radius:9px;cursor:pointer;font-family:inherit">
        <span style="font-weight:600;font-size:13px;color:#374151;min-width:88px">${r.date}${r.date === today ? ' (오늘)' : ''}</span>
        ${badge}
        <span style="flex:1;font-size:12.5px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview || '내용 없음'}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-report-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        loadReport(btn.dataset.reportDate);
        const panel = document.getElementById('attPanelReport');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  async function deleteReport() {
    if (!confirm('작성 중인 재택보고서를 삭제하시겠습니까?')) return;
    const res = await api('/api/att/remote-report?date=' + getReportDate(), { method: 'DELETE' });
    if (!res.ok) { toast('삭제 실패: ' + (res.data?.error || 'HTTP ' + res.status)); return; }
    toast('보고서가 삭제되었습니다 ');
    await loadReport();
  }

  // 제출 완료 보고서를 다시 편집 모드로 (재제출 가능)
  function enableReportEdit() {
    const contentEl = document.getElementById('attReportContent');
    if (contentEl) { contentEl.disabled = false; contentEl.focus(); }
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('attBtnEditReport', false);
    show('attBtnSaveDraft', true);
    show('attBtnSubmitReport', true);
    const sb = document.getElementById('attReportStatusText');
    if (sb) sb.innerHTML = '<strong>수정 중</strong> — 임시저장하거나 다시 제출하세요.';
  }

  function renderReportWbsCards(container, cards) {
    if (!container) return;
    if (!cards || cards.length === 0) {
      container.innerHTML = '<span style="font-size:13px;color:#9ca3af">오늘 할당된 WBS 카드가 없습니다</span>';
      return;
    }
    container.innerHTML = cards.map(c => `
      <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#ede9fe;color:#5b21b6;border-radius:99px;font-size:12.5px;font-weight:500">
        ${escHtml(c.title || c.name || '카드')}
      </span>`).join('');
  }

  function renderReport(report, { statusBar, statusText, metaEl, contentEl, btnDraft, btnSubmit, dateStr }) {
    const btnDelete = document.getElementById('attBtnDeleteReport');
    const btnEdit = document.getElementById('attBtnEditReport');
    const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

    if (!report) {
      // 미작성
      if (statusBar) statusBar.style.background = '#f8fafc';
      if (statusText) statusText.innerHTML = '오늘 재택보고서가 아직 작성되지 않았습니다.';
      if (metaEl) metaEl.textContent = dateStr;
      if (contentEl) { contentEl.value = ''; contentEl.disabled = false; }
      show(btnDraft, true); show(btnSubmit, true); show(btnDelete, false); show(btnEdit, false);
      if (btnDraft) btnDraft.disabled = false;
      if (btnSubmit) btnSubmit.disabled = false;
      return;
    }
    if (report.status === 'SUBMITTED') {
      if (statusBar) statusBar.style.background = '#dcfce7';
      if (statusText) statusText.innerHTML = '<strong>제출 완료</strong> — 보고서가 제출되었습니다.';
      if (metaEl) metaEl.textContent = '제출 시각: ' + fmtTime(report.submittedAt);
      if (contentEl) { contentEl.value = report.content || ''; contentEl.disabled = true; }
      // 제출 완료: '수정'으로 다시 편집·재제출 가능
      show(btnDraft, false); show(btnSubmit, false); show(btnDelete, false); show(btnEdit, true);
    } else {
      // DRAFT (임시저장 / 작성 중)
      if (statusBar) statusBar.style.background = '#fefce8';
      if (statusText) statusText.innerHTML = '<strong>임시저장</strong> — 작성 중인 보고서가 있습니다.';
      if (metaEl) metaEl.textContent = report.updatedAt ? ('마지막 저장: ' + fmtTime(report.updatedAt)) : '마지막 저장';
      if (contentEl) { contentEl.value = report.content || report.aiDraft || ''; contentEl.disabled = false; }
      show(btnDraft, true); show(btnSubmit, true); show(btnDelete, true); show(btnEdit, false);
      if (btnDraft) btnDraft.disabled = false;
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }

  async function generateAIDraft() {
    const btn = document.getElementById('attBtnAiDraft');
    const contentEl = document.getElementById('attReportContent');
    if (btn) { btn.disabled = true; btn.textContent = '생성 중...'; }

    const res = await api('/api/att/ai-draft', { method: 'POST', body: { date: getReportDate() } });

    if (btn) { btn.disabled = false; btn.textContent = 'AI 초안 생성'; }

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
      body: { date: getReportDate(), content },
    });

    if (!res.ok) {
      toast('임시저장 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      if (btn) btn.disabled = false;
      return;
    }
    toast('임시저장 완료 ');
    if (btn) btn.disabled = false;
    await loadReport();   // 상태·버튼(삭제 등) 갱신
  }

  async function submitReport() {
    const contentEl = document.getElementById('attReportContent');
    const content = contentEl?.value?.trim();
    if (!content) { toast('보고서 내용을 입력하세요'); return; }
    if (!confirm('보고서를 최종 제출하시겠습니까? (제출 후에도 필요하면 수정·재제출할 수 있습니다)')) return;

    const btn = document.getElementById('attBtnSubmitReport');
    if (btn) btn.disabled = true;

    const res = await api('/api/att/remote-report', {
      method: 'PUT',
      body: { date: getReportDate(), content },
    });

    if (!res.ok) {
      toast('제출 실패: ' + (res.data?.error || 'HTTP ' + res.status));
      if (btn) btn.disabled = false;
      return;
    }
    toast('보고서가 제출되었습니다 ');
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

    // R35-GAP-P2 M-G7: regular 회원(operatorActive=false·non-admin)은 근태 페이지 부적합 — 안내 후 홈으로
    if (!isAdmin && user.operatorActive === false) {
      alert('근태관리 페이지는 운영자(직원)만 사용할 수 있습니다.\n관리자에게 운영자 권한을 요청해 주세요.');
      location.href = '/index.html';
      return null;
    }

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
      // 사용자·관리자 세션 모두 종료 (근태 페이지는 어느 세션으로도 진입 가능)
      await api('/api/auth/logout', { method: 'POST' });
      await api('/api/admin/logout', { method: 'POST' });
      location.href = '/index.html';
    });
  }

  /* R36 A-1: 근무형태 변경 신청 모달 */
  function setupWorkmodeChange() {
    const btnOpen = document.getElementById('attBtnWorkmodeChange');
    const modal = document.getElementById('wmChangeModal');
    const btnCancel = document.getElementById('wmChangeCancel');
    const btnSubmit = document.getElementById('wmChangeSubmit');
    if (!btnOpen || !modal) return;

    async function loadHistory() {
      const histEl = document.getElementById('wmChangeHistory');
      if (!histEl) return;
      try {
        const res = await api('/api/att-workmode-change-request');
        const list = res.data?.data || res.data || [];
        if (!Array.isArray(list) || list.length === 0) {
          histEl.innerHTML = '<span style="color:#9ca3af">신청 이력이 없습니다</span>';
          return;
        }
        const STATUS = { PENDING: '대기', APPROVED: '승인', REJECTED: '반려' };
        histEl.innerHTML = list.slice(0, 10).map(r =>
          `<div style="padding:4px 0;border-bottom:1px dashed #e5e7eb">` +
          `${r.targetDate} · ${MODE_LABEL[r.targetMode] || r.targetMode} · ${STATUS[r.status] || r.status}` +
          (r.reviewNote ? ` <span style="color:#6b7280">(${r.reviewNote})</span>` : '') +
          `</div>`
        ).join('');
      } catch (e) {
        histEl.innerHTML = '<span style="color:#ef4444">이력 조회 실패</span>';
      }
    }

    function openModal() {
      modal.style.display = 'flex';
      document.getElementById('wmChangeMode').value = '';
      document.getElementById('wmChangeDate').value = toDateStr();
      document.getElementById('wmChangeReason').value = '';
      loadHistory();
    }
    function closeModal() { modal.style.display = 'none'; }

    btnOpen.addEventListener('click', openModal);
    btnCancel.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    btnSubmit.addEventListener('click', async () => {
      const targetMode = document.getElementById('wmChangeMode').value;
      const targetDate = document.getElementById('wmChangeDate').value;
      const reason = document.getElementById('wmChangeReason').value.trim();
      if (!targetMode) { toast('근무형태를 선택해 주세요'); return; }
      if (!targetDate) { toast('적용 희망일을 선택해 주세요'); return; }
      if (!reason) { toast('사유는 필수입니다'); return; }
      btnSubmit.disabled = true;
      const res = await api('/api/att-workmode-change-request', {
        method: 'POST',
        body: { targetMode, targetDate, reason },
      });
      btnSubmit.disabled = false;
      if (!res.ok) {
        toast('신청 실패: ' + (res.data?.error || 'HTTP ' + res.status));
        return;
      }
      toast('신청이 접수되었습니다 ');
      closeModal();
    });
  }

  /* ─── 초기화 ─── */
  async function init() {
    const user = await checkAuth();
    if (!user) return;

    setupTabs();
    setupLogout();
    setupWorkmodeChange();
    await initCheckin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
