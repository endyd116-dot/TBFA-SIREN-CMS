/* SIREN PWA — 서비스워커 등록 + '앱 설치' 안내 배너
 * - 안드로이드/PC 크롬: beforeinstallprompt 가로채 커스텀 버튼으로 설치
 * - 아이폰 사파리: 설치 API 미지원 → '공유 → 홈 화면에 추가' 안내 표시
 * - 이미 설치(standalone)·최근 닫음(14일)·이미 설치 완료 시 미노출
 */
(function () {
  'use strict';

  // 1) 서비스워커 등록 (페이지 로드 후 — 첫 렌더 방해 안 하게)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* 무음 */ });
    });
  }

  var DISMISS_KEY = 'siren_pwa_dismissed_at';
  var DISMISS_DAYS = 14;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function recentlyDismissed() {
    try {
      var t = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return t && (Date.now() - t) < DISMISS_DAYS * 86400000;
    } catch (e) { return false; }
  }
  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
    removeBanner();
  }
  function isiOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isSafari() {
    return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
  }

  function removeBanner() {
    var el = document.getElementById('siren-pwa-banner');
    if (el) el.parentNode.removeChild(el);
  }

  function injectStyle() {
    if (document.getElementById('siren-pwa-style')) return;
    var s = document.createElement('style');
    s.id = 'siren-pwa-style';
    s.textContent =
      '#siren-pwa-banner{position:fixed;left:12px;right:12px;z-index:9999;' +
      'max-width:520px;margin:0 auto;background:#fff;border:1px solid #ecdfe1;' +
      'box-shadow:0 8px 28px rgba(122,31,43,.18);border-radius:14px;padding:14px 14px 14px 16px;' +
      'display:flex;align-items:center;gap:12px;font-family:inherit}' +
      /* 하단(안드로이드/PC) — 홈바 안전영역 보정, 아래서 위로 등장 */
      '#siren-pwa-banner.pwa-bottom{bottom:calc(12px + env(safe-area-inset-bottom,0px));animation:sirenPwaUp .3s ease}' +
      '@keyframes sirenPwaUp{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}' +
      /* 상단(아이폰) — 노치 안전영역 보정, 위서 아래로 등장 */
      '#siren-pwa-banner.pwa-top{top:calc(12px + env(safe-area-inset-top,0px));animation:sirenPwaDown .3s ease}' +
      '@keyframes sirenPwaDown{from{transform:translateY(-20px);opacity:0}to{transform:none;opacity:1}}' +
      '#siren-pwa-banner img{width:44px;height:44px;border-radius:10px;flex:0 0 auto}' +
      '#siren-pwa-banner .pwa-tx{flex:1;min-width:0}' +
      '#siren-pwa-banner .pwa-tt{font-weight:700;font-size:.95rem;color:#3a2a2c;margin:0 0 2px}' +
      '#siren-pwa-banner .pwa-ds{font-size:.8rem;color:#7a6a6c;line-height:1.4;margin:0}' +
      '#siren-pwa-banner .pwa-ds b{color:#7a1f2b}' +
      '#siren-pwa-banner button{font-family:inherit;cursor:pointer;border:0;border-radius:9px}' +
      '#siren-pwa-banner .pwa-go{background:#7a1f2b;color:#fff;font-weight:700;font-size:.9rem;padding:10px 16px;flex:0 0 auto}' +
      '#siren-pwa-banner .pwa-x{background:transparent;color:#b6a8aa;font-size:1.3rem;line-height:1;padding:4px 8px;flex:0 0 auto}';
    document.head.appendChild(s);
  }

  function buildBanner(title, descHtml, btnLabel, onGo, position) {
    injectStyle();
    removeBanner();
    var wrap = document.createElement('div');
    wrap.id = 'siren-pwa-banner';
    wrap.className = (position === 'top') ? 'pwa-top' : 'pwa-bottom';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', '앱 설치 안내');

    var icon = document.createElement('img');
    icon.src = '/img/icon-192.png?v=1';
    icon.alt = '교사유가족협의회';

    var tx = document.createElement('div');
    tx.className = 'pwa-tx';
    var tt = document.createElement('p'); tt.className = 'pwa-tt'; tt.textContent = title;
    var ds = document.createElement('p'); ds.className = 'pwa-ds'; ds.innerHTML = descHtml;
    tx.appendChild(tt); tx.appendChild(ds);

    var xBtn = document.createElement('button');
    xBtn.className = 'pwa-x'; xBtn.setAttribute('aria-label', '닫기'); xBtn.innerHTML = '&times;';
    xBtn.addEventListener('click', dismiss);

    wrap.appendChild(icon);
    wrap.appendChild(tx);

    if (onGo) {
      var go = document.createElement('button');
      go.className = 'pwa-go'; go.textContent = btnLabel;
      go.addEventListener('click', onGo);
      wrap.appendChild(go);
    }
    wrap.appendChild(xBtn);
    document.body.appendChild(wrap);
  }

  // 2) 안드로이드/PC — 설치 프롬프트 가로채기
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (isStandalone() || recentlyDismissed()) return;
    buildBanner('앱으로 설치하기', '홈 화면에 추가하면 더 빠르게 이용할 수 있어요.', '설치', function () {
      removeBanner();
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    }, 'bottom');
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    removeBanner();
  });

  // 3) 아이폰 사파리 — 설치 API 없음 → 수동 안내
  document.addEventListener('DOMContentLoaded', function () {
    if (isStandalone() || recentlyDismissed()) return;
    if (isiOS() && isSafari()) {
      // 안드로이드 배너와 충돌 없게 약간 지연
      setTimeout(function () {
        if (document.getElementById('siren-pwa-banner')) return;
        buildBanner('앱처럼 홈 화면에 추가', '화면 맨 아래 <b>공유 버튼</b>을 누르고 <b>"홈 화면에 추가"</b>를 선택하세요 ', null, null, 'top');
      }, 1500);
    }
  });
})();
