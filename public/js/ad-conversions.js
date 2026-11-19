/* =========================================================
   SIREN — 구글 광고 전환 측정 (2026-11-19 Swain 승인 · 1차 4종)

   무엇을 세나 (구글 애드 그랜츠 협의회 계정 · 전환 ID AW-18579687200 · 공개값)
     donate  : 카드 일시 회비 결제 완료      — payment-success.html
     regular : 월 정기 회비 첫 결제 완료      — billing-success.html (실제로 결제된 경우만)
     signup  : 신규 회원 가입 완료            — 가입 창 · 회비 창 안 가입
     event   : 발족식 신청 완료               — form.html (EVENT_FORM_SLUGS 신청폼만)

   지키는 것
     - 구글에 보내는 값은 금액 · 통화 · 거래 번호뿐. 이름 · 연락처 · 이메일 등 개인 정보는 보내지 않는다.
     - 맞춤형 광고(리마케팅) 신호는 끈다(allow_ad_personalization_signals:false) — 전환 측정만 한다.
     - 운영 주소(tbfa.co.kr)의 공개 화면에서만 움직인다. 관리자 · 업무 화면 · 미리보기 · 로컬은 아무것도 안 한다.
     - 같은 거래는 한 브라우저에서 한 번만 보낸다(새로고침 · 뒤로가기 중복 방지). 구글도 거래 번호로 한 번 더 거른다.
     - 구글 스크립트는 화면이 다 뜬 뒤 한가할 때 불러온다(첫 화면 속도 보호). 전환을 보낼 때는 바로 불러온다.
     - 광고를 눌러 들어온 주소의 클릭 번호(gclid·gbraid·wbraid)는 siren_adclick 쿠키에 90일 담아 둔다
       → 회비 시작 때 서버가 그 회비 기록에 붙이고, 화면이 못 보는 완료는 cron-ads-offline이 AM으로 알린다.

   화면에서 부르는 법 (이 파일이 아직 안 왔어도 줄 세워 두면 도착 즉시 처리)
     (window.SirenAdsQ = window.SirenAdsQ || []).push(['donate', 금액, '거래번호']);
     (window.SirenAdsQ = window.SirenAdsQ || []).push(['form', 'slug', 신청번호]);
   ========================================================= */
(function () {
  'use strict';
  if (window.SirenAds && window.SirenAds.__ready) return;   // 두 번 불려도 한 번만

  var AW_ID = 'AW-18579687200';

  /* 전환 라벨 — 구글 광고 계정에서 전환 액션을 만들면 나오는 값(AM이 만들어 전달).
     비어 있는 전환은 보내지 않는다. */
  var LABELS = {
    donate:  '',   // 카드 일시 회비 결제 완료
    regular: '',   // 월 정기 회비 첫 결제
    signup:  '',   // 신규 회원 가입
    event:   ''    // 발족식 신청
  };

  /* 발족식 신청으로 셀 신청폼 주소 이름(form.html?slug=...) */
  var EVENT_FORM_SLUGS = ['rememberlight1'];

  var path = location.pathname || '/';
  var host = location.hostname || '';
  var INTERNAL = /^\/(admin|cms|workspace|ws-|manual-admin)/i.test(path) ||
    !!(document.body && document.body.dataset && document.body.dataset.page === 'admin');
  var LIVE = /(^|\.)tbfa\.co\.kr$/i.test(host);
  var ACTIVE = LIVE && !INTERNAL;

  function noop() { return false; }
  if (!ACTIVE) {
    /* 줄 세운 것은 버리고, 부르는 쪽이 깨지지 않게 빈 껍데기만 둔다 */
    window.SirenAdsQ = [];
    window.SirenAds = { __ready: true, active: false, track: noop, formSubmit: noop, flush: noop };
    return;
  }

  /* 광고 클릭 번호를 1st-party 쿠키에 담아 둔다(2026-11-19 Swain 승인 «화면이 못 보는 완료도»).
     회비를 시작할 때 서버가 이 쿠키를 읽어 그 회비 기록에 붙이고, 완료가 확정되면(결제사 늦은 통보·
     정기 자동 결제·입금 확인·효성 확인) 광고 성과로 들여온다(lib/ads-click.ts · cron-ads-offline).
     클릭 번호와 누른 시각만 — 90일. */
  (function keepClickId() {
    try {
      var q = new URLSearchParams(location.search);
      var keys = ['gclid', 'gbraid', 'wbraid'];
      for (var i = 0; i < keys.length; i++) {
        var v = q.get(keys[i]);
        if (v && /^[A-Za-z0-9._~\-]{8,300}$/.test(v)) {
          document.cookie = 'siren_adclick=' + encodeURIComponent(JSON.stringify({ k: keys[i], v: v, t: Date.now() })) +
            '; Max-Age=' + (90 * 24 * 60 * 60) + '; Path=/; Secure; SameSite=Lax';
          break;
        }
      }
    } catch (e) { /* 무시 */ }
  })();

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  window.gtag('js', new Date());
  window.gtag('config', AW_ID, { allow_ad_personalization_signals: false });

  var libRequested = false;
  function loadLib() {
    if (libRequested) return;
    libRequested = true;
    try {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(AW_ID);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 광고 측정 실패는 화면에 영향 없음 */ }
  }
  function whenIdle(fn) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 3000 });
    else setTimeout(fn, 1200);
  }
  if (document.readyState === 'complete') whenIdle(loadLib);
  else window.addEventListener('load', function () { whenIdle(loadLib); }, { once: true });

  function seen(key) { try { return window.localStorage.getItem(key) === '1'; } catch (e) { return false; } }
  function mark(key) { try { window.localStorage.setItem(key, '1'); } catch (e) { /* 저장 못 해도 구글이 거래 번호로 거른다 */ } }

  /* 전환 한 건 보내기 — kind: donate | regular | signup | event */
  function track(kind, value, tid) {
    var label = LABELS[kind];
    if (!label) return false;
    tid = String(tid == null ? '' : tid).replace(/[^\w-]/g, '').slice(0, 64);
    var key = 'siren:aw:' + kind + ':' + tid;
    if (tid && seen(key)) return false;
    var params = { send_to: AW_ID + '/' + label };
    var v = Number(value);
    if (v > 0 && isFinite(v)) { params.value = Math.round(v); params.currency = 'KRW'; }
    if (tid) params.transaction_id = tid;
    window.gtag('event', 'conversion', params);
    if (tid) mark(key);
    loadLib();
    return true;
  }

  /* 신청폼 제출 — 발족식 신청폼일 때만 «event» 전환 */
  function formSubmit(slug, submissionId) {
    if (EVENT_FORM_SLUGS.indexOf(String(slug || '')) < 0) return false;
    if (!submissionId) return false;
    return track('event', 0, 'F' + submissionId);
  }

  function run(item) {
    try {
      if (!item || !item.length) return;
      if (item[0] === 'form') formSubmit(item[1], item[2]);
      else track(item[0], item[1], item[2]);
    } catch (e) { /* 무시 */ }
  }
  function flush() {
    var q = window.SirenAdsQ;
    window.SirenAdsQ = { push: function (item) { run(item); return 0; } };
    if (q && q.length) for (var i = 0; i < q.length; i++) run(q[i]);
  }

  /* 가입 창 — 가입 처리 파일(보호 파일)은 고치지 않고, 밖에서 가입 함수를 감싸 성공만 알아챈다 */
  function wrapSignup() {
    var A = window.SIREN_AUTH;
    if (!A || typeof A.signup !== 'function') return false;
    if (A.signup.__sirenAds) return true;
    var orig = A.signup;
    var wrapped = function () {
      return Promise.resolve(orig.apply(this, arguments)).then(function (res) {
        try {
          if (res && res.ok) {
            var d = (res.data && (res.data.data || res.data)) || {};
            var m = d.member || d.user || {};
            if (m && m.id) track('signup', 0, 'M' + m.id);
          }
        } catch (e) { /* 무시 */ }
        return res;
      });
    };
    wrapped.__sirenAds = true;
    A.signup = wrapped;
    return true;
  }
  if (!wrapSignup()) {
    var tries = 0;
    var timer = setInterval(function () {
      if (wrapSignup() || ++tries > 40) clearInterval(timer);
    }, 250);
  }

  window.SirenAds = { __ready: true, active: true, track: track, formSubmit: formSubmit, flush: flush };
  flush();
})();
