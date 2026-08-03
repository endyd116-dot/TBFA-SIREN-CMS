/**
 * public/js/page-widgets.js — 페이지 본문 속 특수 요소 살리기
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §4.3
 *
 * 서버가 본문에 자리만 만들어 둔 것들을 실제로 동작하게 만든다.
 *  · 지도(.pw-map) — 카카오 지도를 띄운다. 지도가 있는 페이지에서만 지도 기능을 불러온다.
 *  · 버튼(.pw-btn) — 후원·신청 창 열기는 기존 공통 처리(data-action="open-modal")가 맡으므로
 *                    여기서 따로 할 일이 없다.
 *
 * 본문이 나중에 채워지는 경우(편집 미리보기 등)를 위해 여러 번 불러도 안전하게 만들었다.
 */
(function () {
  'use strict';

  /* about.html에서 쓰던 것과 같은 공개 키 */
  var KAKAO_KEY = '6082d30d107baf30d2fd17f14a2f48e7';
  var sdkLoading = null;

  function loadKakaoSdk() {
    if (window.kakao && window.kakao.maps) return Promise.resolve();
    if (sdkLoading) return sdkLoading;

    sdkLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_KEY +
              '&autoload=false&libraries=services';
      s.onload = function () {
        try { window.kakao.maps.load(function () { resolve(); }); }
        catch (e) { reject(e); }
      };
      s.onerror = function () { reject(new Error('지도 기능을 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
    return sdkLoading;
  }

  function renderMap(box) {
    var address = (box.getAttribute('data-address') || '').trim();
    if (!address) return;

    var info = box.getAttribute('data-info') || '';
    box.innerHTML = '';
    box.style.minHeight = box.style.minHeight || '300px';

    var defaultLatLng = new window.kakao.maps.LatLng(37.5663, 126.8008);
    var map = new window.kakao.maps.Map(box, { center: defaultLatLng, level: 3 });

    function placeMarker(latlng) {
      var marker = new window.kakao.maps.Marker({ map: map, position: latlng });
      if (info) {
        new window.kakao.maps.InfoWindow({
          content: '<div style="padding:6px 10px;font-size:13px;white-space:nowrap">' + info + '</div>'
        }).open(map, marker);
      }
      map.setCenter(latlng);
    }

    try {
      var geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.addressSearch(address, function (result, status) {
        if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
          placeMarker(new window.kakao.maps.LatLng(result[0].y, result[0].x));
        } else {
          placeMarker(defaultLatLng);
        }
      });
    } catch (_) {
      placeMarker(defaultLatLng);
    }
  }

  /** 본문 안의 특수 요소를 살린다. 이미 처리한 것은 건너뛴다. */
  function init(root) {
    var scope = root || document;
    var maps = scope.querySelectorAll('.pw-map:not([data-pw-ready])');
    if (!maps.length) return;

    loadKakaoSdk().then(function () {
      maps.forEach(function (box) {
        if (box.getAttribute('data-pw-ready')) return;
        box.setAttribute('data-pw-ready', '1');
        try { renderMap(box); } catch (e) { console.warn('[page-widgets] 지도 표시 실패', e); }
      });
    }).catch(function (e) {
      console.warn('[page-widgets]', e);
      maps.forEach(function (box) {
        box.setAttribute('data-pw-ready', '1');
        var fb = box.querySelector('.pw-map-fallback');
        if (fb) fb.textContent = '지도를 표시할 수 없습니다.';
      });
    });
  }

  window.SirenPageWidgets = { init: init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
