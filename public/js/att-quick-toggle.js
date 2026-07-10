/**
 * att-quick-toggle.js — 어드민 공통 출퇴근 토글 (퀵이동 버튼 아래)
 *
 * 싸이렌 어드민·통합 CMS·워크스페이스 등 [data-quick-jump]가 있는 모든 화면의
 * 퀵이동 버튼 바로 아래에 출퇴근 버튼을 자동 삽입한다. (quick-jump.js가 로드)
 *
 * - 운영자만 표시 (att-checkin-today 401/403이면 숨김)
 * - 한 번 누르면 출근, 다시 누르면 퇴근 (3-상태 자동 라벨)
 * - PC·노트북·모바일 무관 navigator.geolocation 위치 강제 수집 (권한 거부 시 차단)
 * - deviceType(MOBILE/TABLET/DESKTOP) 서버 전송 → att_records.device_type 기록
 * - 출퇴근 성공 시 토스트 + 서버가 인앱 알림 발송 (att-checkin/checkout)
 * - workspace.html 상단 #wsAttBtn 이 있으면 중복 방지로 스킵
 *
 * workspace-topbar-attendance.js 와 동일 엔드포인트 사용 (att_records 1일 1건 UNIQUE).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  /* workspace.html 상단 출퇴근 버튼이 있으면 중복 방지 */
  if (document.getElementById('wsAttBtn')) return;
  /* 이미 마운트됐으면 중복 방지 */
  if (document.getElementById('attQuickWrap')) return;

  var container = document.querySelector('[data-quick-jump]');
  if (!container) return;

  var state = { today: null, busy: false };

  /* ───────── DOM 생성 (퀵이동 컨테이너 바로 뒤) ───────── */
  var wrap = document.createElement('div');
  wrap.id = 'attQuickWrap';
  wrap.style.cssText = 'margin-top:6px;display:none';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'attQuickBtn';
  btn.dataset.state = 'loading';
  btn.style.cssText =
    'display:inline-flex;align-items:center;gap:6px;width:100%;justify-content:center;' +
    'padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;' +
    'background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb;transition:all .15s';
  btn.innerHTML =
    '<span id="attQuickIcon"></span><span id="attQuickLabel">확인 중...</span>';
  wrap.appendChild(btn);

  /* 문 열기 버튼 — 근무 중일 때만 노출(잠깐 나갔다 올 때) */
  var doorBtn = document.createElement('button');
  doorBtn.type = 'button';
  doorBtn.id = 'attQuickDoorBtn';
  doorBtn.style.cssText =
    'display:none;align-items:center;gap:6px;width:100%;justify-content:center;margin-top:6px;' +
    'padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;' +
    'background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;transition:all .15s';
  doorBtn.innerHTML = '<span></span><span>문 열기</span>';
  wrap.appendChild(doorBtn);

  container.insertAdjacentElement('afterend', wrap);

  function $(id) { return document.getElementById(id); }

  /* 출퇴근/문열기 응답의 door 결과 → 안내 문구 */
  function doorMsg(door) {
    if (!door) return '';
    if (door.ok && door.sim) return ' · 문 열림(시뮬레이션)';
    if (door.ok) return ' · 문이 열렸습니다';
    return ' · 문 열림 실패';
  }

  /* 수동 문 열기 */
  async function doDoorOpen() {
    if (state.busy) return;
    doorBtn.disabled = true;
    try {
      var res = await fetch('/api/att-door-open', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      var data = null; try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error((data && (data.error || data.detail)) || 'HTTP ' + res.status);
      var d = (data && data.data) || {};
      if (d.ok && d.sim) toast('문 열림(시뮬레이션 — 장치 연결 전)');
      else if (d.ok) toast('문이 열렸습니다');
      else toast('문 열림 실패 — 관리자에게 문의하세요', 5000);
    } catch (e) {
      toast('문 열기 실패: ' + e.message, 5000);
    } finally { doorBtn.disabled = false; }
  }
  doorBtn.addEventListener('click', doDoorOpen);

  function setBtn(stateName, opts) {
    opts = opts || {};
    btn.dataset.state = stateName;
    var icon = $('attQuickIcon'), label = $('attQuickLabel');
    if (icon) icon.textContent = opts.icon || '';
    if (label) label.textContent = opts.label || '';
    btn.title = opts.title || opts.label || '';
    btn.disabled = !!opts.disabled;
    if (stateName === 'checkin-ready') {
      btn.style.background = '#dcfce7'; btn.style.color = '#15803d'; btn.style.border = '1px solid #86efac';
    } else if (stateName === 'checkout-ready') {
      btn.style.background = '#fee2e2'; btn.style.color = '#b91c1c'; btn.style.border = '1px solid #fca5a5';
    } else if (stateName === 'done') {
      btn.style.background = '#f3f4f6'; btn.style.color = '#6b7280'; btn.style.border = '1px solid #e5e7eb';
    } else {
      btn.style.background = '#f9fafb'; btn.style.color = '#9ca3af'; btn.style.border = '1px solid #e5e7eb';
    }
  }

  function fmtTime(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function toast(msg, ms) {
    var ex = document.getElementById('attQuickToast');
    if (ex) ex.remove();
    var el = document.createElement('div');
    el.id = 'attQuickToast';
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#111;color:#fff;padding:11px 18px;' +
      'border-radius:8px;font-size:13px;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:380px';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 4000);
  }

  function detectDeviceType() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)) return 'MOBILE';
    if (/ipad|tablet|kindle/.test(ua)) return 'TABLET';
    return 'DESKTOP';
  }

  function geo() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('이 브라우저는 위치 정보를 지원하지 않습니다'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        function (err) {
          if (err && err.code === 1) {
            reject(new Error('위치 권한이 필요합니다. 주소창 좌측 자물쇠 → 위치 [허용] 후 다시 시도하세요.'));
          } else {
            reject(new Error('위치 정보를 가져오지 못했습니다 (' + (err && err.message || '시간 초과') + '). PC라면 Wi-Fi 연결을 확인해 주세요.'));
          }
        },
        { timeout: 30000, enableHighAccuracy: false, maximumAge: 60000 }
      );
    });
  }

  async function fetchToday() {
    try {
      var res = await fetch('/api/att-checkin-today', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        wrap.remove();   /* 비운영자 — 위젯 제거 */
        return undefined;
      }
      var data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) return null;
      return (data && data.data) || null;
    } catch (_) { return null; }
  }

  function applyTodayState(rec) {
    if (rec === undefined) return;   /* 비운영자 — 위젯 이미 제거됨 */
    state.today = rec;
    wrap.style.display = '';
    /* 문 열기 버튼: 근무 중(출근 O·퇴근 X)일 때만 노출 */
    if (doorBtn) doorBtn.style.display = (rec && rec.checkinAt && !rec.checkoutAt) ? 'inline-flex' : 'none';
    if (!rec || !rec.checkinAt) {
      setBtn('checkin-ready', { icon: '', label: '출근', title: '출근하기' });
      return;
    }
    if (rec.checkoutAt) {
      setBtn('done', { icon: '', label: '퇴근 완료 (' + fmtTime(rec.checkoutAt) + ')', title: '재출근하려면 새로고침', disabled: true });
      return;
    }
    setBtn('checkout-ready', { icon: '', label: '퇴근 (' + fmtTime(rec.checkinAt) + ' 출근)', title: '퇴근하기' });
  }

  async function doCheckin() {
    if (state.busy) return;
    state.busy = true;
    setBtn('loading', { icon: '', label: '위치 확인 중...', disabled: true });
    try {
      var pos = await geo();
      var res = await fetch('/api/att-checkin', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng, deviceType: detectDeviceType() }),
      });
      var data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) {
        if (data && data.needsWorkplaceSelection) {
          toast('외근지 거점 선택이 필요합니다. 근태관리 페이지에서 출근해 주세요.', 5000);
          window.location.href = '/workspace-attendance.html';
          return;
        }
        throw new Error((data && (data.error || data.detail)) || 'HTTP ' + res.status);
      }
      var cin = (data && data.data) || {};
      toast('출근이 기록되었습니다 ' + (new Date()).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + doorMsg(cin.door));
      applyTodayState(await fetchToday());
    } catch (e) {
      toast('출근 실패: ' + e.message, 6000);
      applyTodayState(state.today);
    } finally { state.busy = false; }
  }

  async function doCheckout() {
    if (state.busy) return;
    if (!confirm('퇴근하시겠습니까?\n(퇴근 후 재출근하려면 페이지를 새로고침해야 합니다)')) return;
    state.busy = true;
    setBtn('loading', { icon: '', label: '위치 확인 중...', disabled: true });
    try {
      var pos = await geo();
      var res = await fetch('/api/att-checkout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng, deviceType: detectDeviceType() }),
      });
      var data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error((data && (data.error || data.detail)) || 'HTTP ' + res.status);
      var cout = (data && data.data) || {};
      toast('퇴근이 기록되었습니다 ' + (new Date()).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + doorMsg(cout.door));
      applyTodayState(await fetchToday());
    } catch (e) {
      toast('퇴근 실패: ' + e.message, 6000);
      applyTodayState(state.today);
    } finally { state.busy = false; }
  }

  btn.addEventListener('click', function () {
    if (state.busy) return;
    var s = btn.dataset.state || '';
    if (s === 'checkin-ready') return doCheckin();
    if (s === 'checkout-ready') return doCheckout();
  });

  /* 다른 탭에서 출퇴근하면 상태 동기화 */
  document.addEventListener('visibilitychange', async function () {
    if (document.visibilityState !== 'visible') return;
    applyTodayState(await fetchToday());
  });

  /* 초기 상태 로드 */
  (async function () { applyTodayState(await fetchToday()); })();
})();
