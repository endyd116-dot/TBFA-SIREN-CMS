/**
 * lib-att-map.js — 카카오 지도 출퇴근 위치 모달 헬퍼
 *
 * R39 Stage 5 A-2: 어드민 화면에서 직원의 출근·퇴근 좌표 + 거점 좌표 동시 표시.
 *
 * 사용법:
 *   await window.AttMap.show({
 *     title:    '홍길동 — 출근 위치',
 *     userLat:  37.123, userLng: 127.456,
 *     placeLat: 37.124, placeLng: 127.457,   // 거점 좌표 (선택)
 *     placeName: '본사',
 *     workMode: 'OFFICE',
 *   });
 *
 * SDK 로드: /api/site-config 응답으로 KAKAO_JS_APP_KEY 받아 autoload=false 패턴.
 */
(function () {
  'use strict';

  var _sdkLoadPromise = null;
  var _configPromise = null;

  /* ★ 위치보기 fix: site-config(KAKAO_JS_APP_KEY) 미설정 시 about.html과 동일한
     도메인 등록 카카오 JS 키로 폴백(클라이언트 키·도메인 제한·비밀 아님) → env 없이도 지도 동작. */
  var FALLBACK_KAKAO_JS_KEY = '6082d30d107baf30d2fd17f14a2f48e7';

  function loadConfig() {
    if (_configPromise) return _configPromise;
    _configPromise = (async function () {
      try {
        var res = await fetch('/api/site-config', { credentials: 'include' });
        var data = null;
        try { data = await res.json(); } catch (_) {}
        if (!res.ok) return { kakaoJsAppKey: null, kakaoJsAvailable: false };
        return (data && data.data) || { kakaoJsAppKey: null, kakaoJsAvailable: false };
      } catch (_) {
        return { kakaoJsAppKey: null, kakaoJsAvailable: false };
      }
    })();
    return _configPromise;
  }

  function loadSdk(appKey) {
    if (_sdkLoadPromise) return _sdkLoadPromise;
    _sdkLoadPromise = new Promise(function (resolve, reject) {
      if (window.kakao && window.kakao.maps) { resolve(); return; }
      var s = document.createElement('script');
      s.src = '//dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=' + encodeURIComponent(appKey);
      s.async = true;
      s.onload = function () {
        try {
          window.kakao.maps.load(function () { resolve(); });
        } catch (e) { reject(e); }
      };
      s.onerror = function () { reject(new Error('카카오 SDK 로드 실패')); };
      document.head.appendChild(s);
    });
    return _sdkLoadPromise;
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
          * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function fmtDist(m) {
    if (m == null || isNaN(m)) return '—';
    if (m < 1000) return Math.round(m) + 'm';
    return (m / 1000).toFixed(2) + 'km';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function buildModal(opts) {
    var existing = document.getElementById('attMapModal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'attMapModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
    modal.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:min(720px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.25)">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e5e7eb">'
      +     '<strong style="font-size:15px">' + esc(opts.title || '출퇴근 위치') + '</strong>'
      +     '<button id="attMapClose" style="background:none;border:0;font-size:20px;cursor:pointer;color:#6b7280">✕</button>'
      +   '</div>'
      +   '<div id="attMapInfo" style="padding:10px 18px;font-size:12.5px;color:#374151;background:#f8fafc;border-bottom:1px solid #e5e7eb"></div>'
      +   '<div id="attMapCanvas" style="flex:1;min-height:380px;background:#f3f4f6"></div>'
      +   '<div id="attMapFooter" style="padding:10px 18px;font-size:11.5px;color:#9ca3af;border-top:1px solid #e5e7eb"></div>'
      + '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('attMapClose').addEventListener('click', function () { modal.remove(); });
    return modal;
  }

  async function show(opts) {
    opts = opts || {};
    var modal = buildModal(opts);
    var canvas = modal.querySelector('#attMapCanvas');
    var info = modal.querySelector('#attMapInfo');
    var footer = modal.querySelector('#attMapFooter');

    var userLat = Number(opts.userLat);
    var userLng = Number(opts.userLng);
    var hasUser = isFinite(userLat) && isFinite(userLng) && (userLat !== 0 || userLng !== 0);

    var placeLat = opts.placeLat != null ? Number(opts.placeLat) : null;
    var placeLng = opts.placeLng != null ? Number(opts.placeLng) : null;
    var hasPlace = placeLat != null && placeLng != null && isFinite(placeLat) && isFinite(placeLng);

    var dist = (hasUser && hasPlace) ? haversineMeters(userLat, userLng, placeLat, placeLng) : null;

    // 정보 헤더
    var lines = [];
    if (hasUser) lines.push('직원 좌표: ' + userLat.toFixed(6) + ', ' + userLng.toFixed(6));
    else lines.push('직원 좌표: 미기록');
    if (hasPlace) lines.push('' + (opts.placeName ? esc(opts.placeName) + ' ' : '거점 ') + '좌표: ' + placeLat.toFixed(6) + ', ' + placeLng.toFixed(6));
    if (dist != null) lines.push('거점과의 거리: <strong>' + fmtDist(dist) + '</strong>');
    if (opts.workMode) lines.push('근무형태: ' + esc(opts.workMode));
    info.innerHTML = lines.join(' &nbsp;·&nbsp; ');

    if (!hasUser) {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:13px">기록된 좌표가 없습니다</div>';
      return;
    }

    // 카카오 키 로드 — env(site-config) 우선, 없으면 도메인 등록 폴백 키
    var cfg = await loadConfig();
    var appKey = (cfg && cfg.kakaoJsAppKey) || FALLBACK_KAKAO_JS_KEY;
    if (!appKey) {
      canvas.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;color:#6b7280;font-size:13px;line-height:1.7">'
        + '🛈 카카오 지도 키가 없습니다.<br><br>'
        + '<a href="https://map.kakao.com/?q=' + encodeURIComponent(userLat + ',' + userLng) + '" target="_blank" style="color:#2563eb;text-decoration:underline">'
        + '카카오맵에서 좌표 확인하기 </a>'
        + '</div>';
      footer.textContent = '좌표: ' + userLat.toFixed(6) + ', ' + userLng.toFixed(6) + (dist != null ? ' · 거점 거리 ' + fmtDist(dist) : '');
      return;
    }

    try {
      await loadSdk(appKey);
    } catch (e) {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:13px">카카오 SDK 로드 실패: ' + esc(e.message || e) + '</div>';
      return;
    }

    // 지도 렌더
    canvas.innerHTML = '';
    var centerLat = hasPlace ? (userLat + placeLat) / 2 : userLat;
    var centerLng = hasPlace ? (userLng + placeLng) / 2 : userLng;
    var level = (dist == null || dist < 100) ? 3 : (dist < 500 ? 4 : (dist < 2000 ? 5 : 6));
    var map = new kakao.maps.Map(canvas, {
      center: new kakao.maps.LatLng(centerLat, centerLng),
      level: level,
    });

    // 직원 마커
    var userPos = new kakao.maps.LatLng(userLat, userLng);
    var userMarker = new kakao.maps.Marker({ position: userPos, map: map });
    var userInfo = new kakao.maps.InfoWindow({
      content: '<div style="padding:6px 10px;font-size:12px;font-weight:600;color:#16a34a">직원 위치</div>',
    });
    userInfo.open(map, userMarker);

    if (hasPlace) {
      var placePos = new kakao.maps.LatLng(placeLat, placeLng);
      var placeMarker = new kakao.maps.Marker({
        position: placePos, map: map,
        image: new kakao.maps.MarkerImage(
          'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="%231d4ed8" stroke="white" stroke-width="3"/></svg>'),
          new kakao.maps.Size(32, 32),
          { offset: new kakao.maps.Point(16, 16) }
        ),
      });
      var placeInfo = new kakao.maps.InfoWindow({
        content: '<div style="padding:6px 10px;font-size:12px;font-weight:600;color:#1d4ed8">' + esc(opts.placeName || '거점') + '</div>',
      });
      placeInfo.open(map, placeMarker);

      // 두 지점 연결 선
      new kakao.maps.Polyline({
        path: [userPos, placePos],
        strokeWeight: 3, strokeColor: '#1d4ed8',
        strokeOpacity: 0.6, strokeStyle: 'dashed',
        map: map,
      });

      // 모두 보이도록 bounds 조정
      var bounds = new kakao.maps.LatLngBounds();
      bounds.extend(userPos); bounds.extend(placePos);
      map.setBounds(bounds);
    }

    footer.innerHTML = '좌표: ' + userLat.toFixed(6) + ', ' + userLng.toFixed(6)
      + (dist != null ? ' &nbsp;·&nbsp; 거점 거리 <strong>' + fmtDist(dist) + '</strong>' : '');
  }

  /* ★ 전체보기: 여러 직원의 출퇴근 좌표를 한 지도에 모두 표시.
     opts.points = [{ name, lat, lng, type:'in'|'out', workMode }] */
  async function showAll(opts) {
    opts = opts || {};
    var points = (opts.points || []).filter(function (p) {
      return p && p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng))
        && (Number(p.lat) !== 0 || Number(p.lng) !== 0);
    });
    var modal = buildModal({ title: opts.title || ('전체 출퇴근 위치 (' + points.length + '건)') });
    var canvas = modal.querySelector('#attMapCanvas');
    var info = modal.querySelector('#attMapInfo');
    var footer = modal.querySelector('#attMapFooter');

    info.innerHTML = '좌표가 기록된 ' + points.length + '건';
    if (points.length === 0) {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:13px">표시할 위치 좌표가 없습니다 (좌표 미기록 출퇴근은 제외)</div>';
      return;
    }

    var cfg = await loadConfig();
    var appKey = (cfg && cfg.kakaoJsAppKey) || FALLBACK_KAKAO_JS_KEY;
    if (!appKey) {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:13px">카카오 지도 키가 없습니다</div>';
      return;
    }
    try { await loadSdk(appKey); }
    catch (e) { canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;font-size:13px">카카오 SDK 로드 실패</div>'; return; }

    canvas.innerHTML = '';
    var map = new kakao.maps.Map(canvas, {
      center: new kakao.maps.LatLng(Number(points[0].lat), Number(points[0].lng)),
      level: 7,
    });
    var bounds = new kakao.maps.LatLngBounds();
    points.forEach(function (p) {
      var pos = new kakao.maps.LatLng(Number(p.lat), Number(p.lng));
      var marker = new kakao.maps.Marker({ position: pos, map: map });
      var label = esc(p.name || '직원') + (p.type ? ' (' + (p.type === 'in' ? '출근' : '퇴근') + ')' : '');
      new kakao.maps.InfoWindow({ content: '<div style="padding:4px 8px;font-size:11.5px;font-weight:600">' + label + '</div>' }).open(map, marker);
      bounds.extend(pos);
    });
    map.setBounds(bounds);
    footer.textContent = '총 ' + points.length + '건 표시';
  }

  window.AttMap = {
    show: show,
    showAll: showAll,
    haversineMeters: haversineMeters,
    fmtDist: fmtDist,
  };
})();
