/**
 * workspace-topbar-attendance.js — R39 Stage 6
 *
 * 워크툴(workspace.html) 상단 출퇴근 버튼.
 * - 진입 시 /api/att-checkin-today 호출로 상태 결정
 *   · 미출근   → 🟢 출근
 *   · 출근 중  → 🔴 퇴근
 *   · 퇴근 완료 → ✅ 퇴근 완료 (재출근하려면 새로고침) — disabled
 * - 클릭 시 navigator.geolocation 위치 강제 수집 (timeout 30s)
 * - 권한 거부 시 안내 + 차단
 * - workspace-attendance.js와 동일 엔드포인트 사용 (충돌 0·att_records 1일 1건 UNIQUE)
 */
(function () {
  'use strict';

  // 운영자 페이지가 아닐 가능성 대비 — 버튼 없으면 종료
  if (typeof window === 'undefined') return;

  var BTN_ID   = 'wsAttBtn';
  var ICON_ID  = 'wsAttBtnIcon';
  var LABEL_ID = 'wsAttBtnLabel';

  var state = {
    today: null,       // 응답 객체 또는 null
    busy: false,
  };

  function $(id) { return document.getElementById(id); }

  function setBtn(stateName, opts) {
    opts = opts || {};
    var btn = $(BTN_ID);
    if (!btn) return;
    btn.dataset.state = stateName;
    var icon = $(ICON_ID), label = $(LABEL_ID);
    if (icon)  icon.textContent  = opts.icon  || '';
    if (label) label.textContent = opts.label || '';
    btn.title = opts.title || opts.label || '';
    btn.disabled = !!opts.disabled;
    // 색상 톤
    if (stateName === 'checkin-ready') {
      btn.style.background = '#dcfce7';
      btn.style.color = '#15803d';
      btn.style.border = '1px solid #86efac';
    } else if (stateName === 'checkout-ready') {
      btn.style.background = '#fee2e2';
      btn.style.color = '#b91c1c';
      btn.style.border = '1px solid #fca5a5';
    } else if (stateName === 'done') {
      btn.style.background = '#f3f4f6';
      btn.style.color = '#6b7280';
      btn.style.border = '1px solid #e5e7eb';
    } else {
      btn.style.background = '#f9fafb';
      btn.style.color = '#9ca3af';
      btn.style.border = '1px solid #e5e7eb';
    }
  }

  function fmtTime(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit',
      });
    } catch (_) { return ''; }
  }

  function toast(msg, ms) {
    var existing = document.getElementById('wsAttToast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'wsAttToast';
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#111;color:#fff;padding:11px 18px;border-radius:8px;font-size:13px;z-index:10000;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:380px';
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

  async function fetchToday() {
    try {
      var res = await fetch('/api/att-checkin-today', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        // 비운영자 — 버튼 숨김
        var btn = $(BTN_ID);
        if (btn) btn.style.display = 'none';
        return null;
      }
      var data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) return null;
      return (data && data.data) || null;
    } catch (_) {
      return null;
    }
  }

  function applyTodayState(rec) {
    state.today = rec;
    if (!rec || !rec.checkinAt) {
      setBtn('checkin-ready', { icon: '🟢', label: '출근', title: '출근하기' });
      return;
    }
    if (rec.checkoutAt) {
      setBtn('done', {
        icon: '✅',
        label: '퇴근 완료 (' + fmtTime(rec.checkoutAt) + ')',
        title: '재출근하려면 새로고침',
        disabled: true,
      });
      return;
    }
    // 출근 중
    setBtn('checkout-ready', {
      icon: '🔴',
      label: '퇴근 (' + fmtTime(rec.checkinAt) + ' 출근)',
      title: '퇴근하기',
    });
  }

  function geo(opts) {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('이 브라우저는 위치 정보를 지원하지 않습니다'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
        function (err) {
          if (err && err.code === 1) {
            reject(new Error('위치 권한이 필요합니다. 브라우저 주소창 좌측 자물쇠 아이콘에서 위치 권한을 [허용]으로 변경 후 다시 시도하세요.'));
          } else {
            reject(new Error('위치 정보를 가져오지 못했습니다 (' + (err && err.message || '시간 초과') + '). PC라면 Wi-Fi 연결을 확인해 주세요.'));
          }
        },
        opts || { timeout: 30000, enableHighAccuracy: false, maximumAge: 60000 }
      );
    });
  }

  async function doCheckin() {
    if (state.busy) return;
    state.busy = true;
    setBtn('loading', { icon: '⏳', label: '위치 확인 중...', disabled: true });
    try {
      var pos = await geo();
      var res = await fetch('/api/att-checkin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: pos.lat, lng: pos.lng,
          deviceType: detectDeviceType(),
        }),
      });
      var data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) {
        // FIELD 모드 거점 필요 등 — workspace-attendance 페이지로 안내
        if (data && data.needsWorkplaceSelection) {
          toast('외근지 거점 선택이 필요합니다. 근태관리 페이지에서 출근해 주세요.', 5000);
          window.location.href = '/workspace-attendance.html';
          return;
        }
        throw new Error((data && (data.error || data.detail)) || 'HTTP ' + res.status);
      }
      var door = (data && data.data && data.data.door) || null;
      var doorMsg = '';
      if (door) {
        if (door.ok && door.sim) doorMsg = ' · 🚪 문 열림(시뮬레이션)';
        else if (door.ok) doorMsg = ' · 🚪 문이 열렸습니다';
        else doorMsg = ' · ⚠️ 문 열림 실패';
      }
      toast('✅ 출근이 기록되었습니다 ' + (new Date()).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) + doorMsg);
      var fresh = await fetchToday();
      applyTodayState(fresh);
    } catch (e) {
      toast('출근 실패: ' + e.message, 6000);
      // 상태 복구
      applyTodayState(state.today);
    } finally {
      state.busy = false;
    }
  }

  async function doCheckout() {
    if (state.busy) return;
    if (!confirm('퇴근하시겠습니까?\n(퇴근 후에는 재출근하려면 페이지를 새로고침해야 합니다)')) return;
    state.busy = true;
    setBtn('loading', { icon: '⏳', label: '위치 확인 중...', disabled: true });
    try {
      var pos = await geo();
      var res = await fetch('/api/att-checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: pos.lat, lng: pos.lng,
          deviceType: detectDeviceType(),
        }),
      });
      var data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error((data && (data.error || data.detail)) || 'HTTP ' + res.status);
      toast('🔴 퇴근이 기록되었습니다 ' + (new Date()).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }));
      var fresh = await fetchToday();
      applyTodayState(fresh);
    } catch (e) {
      toast('퇴근 실패: ' + e.message, 6000);
      applyTodayState(state.today);
    } finally {
      state.busy = false;
    }
  }

  async function onClick() {
    if (state.busy) return;
    var stateName = ($(BTN_ID) && $(BTN_ID).dataset.state) || '';
    if (stateName === 'checkin-ready')  return doCheckin();
    if (stateName === 'checkout-ready') return doCheckout();
    // 'done' / 'loading' — 무시
  }

  async function init() {
    var btn = $(BTN_ID);
    if (!btn) return;
    btn.addEventListener('click', onClick);
    var today = await fetchToday();
    applyTodayState(today);

    // 다른 탭(workspace-attendance)에서 출퇴근하면 상태 동기화
    document.addEventListener('visibilitychange', async function () {
      if (document.visibilityState !== 'visible') return;
      var fresh = await fetchToday();
      applyTodayState(fresh);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
