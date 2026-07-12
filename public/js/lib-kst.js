(function () {
  'use strict';

  function fmtKST(date, opt) {
    if (date === null || date === undefined || date === '') return '-';
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '-';
    var fmt = opt || { dateStyle: 'medium', timeStyle: 'short' };
    return d.toLocaleString('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, fmt));
  }

  function fmtKSTDate(date) {
    return fmtKST(date, { dateStyle: 'medium' });
  }

  function fmtKSTDateTime(date) {
    return fmtKST(date, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtKSTLong(date) {
    return fmtKST(date, { dateStyle: 'long', timeStyle: 'medium' });
  }

  function fmtKSTTime(date) {
    return fmtKST(date, { timeStyle: 'short' });
  }

  function fmtKSTRelative(date) {
    if (date === null || date === undefined || date === '') return '-';
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '-';
    var diff = Date.now() - d.getTime();
    if (diff < 0) return fmtKSTDateTime(d);
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    return fmtKSTDate(d);
  }

  /* ══════════════════════════════════════════════════════════════
     KST 못박기 (2026-07-12 · Swain 지시)

     이 조직은 한국에서만 운영한다. 사람이 보는 날짜·시각은 예외 없이 한국 시각이어야 한다.

     문제 1 — 표시:
       화면 코드가 `new Date(x).toLocaleString('ko-KR')` 처럼 시간대를 안 적으면
       '보는 사람 컴퓨터의 시간대'로 찍힌다. 노트북 시간대가 어긋나 있거나
       해외에서 접속하면 근태·급여·결재 시각이 다르게 보인다.
       → 시간대를 안 적었을 때의 기본값을 서울로 못박는다. 기존 코드를 한 줄도
         고치지 않아도 전 화면이 KST로 통일되고, 앞으로 새로 짜는 코드도 자동으로 KST다.
       (시간대를 명시한 코드는 그대로 존중한다. 숫자 서식(1,234)은 영향 없다 — Date만 손댄다.)

     문제 2 — '오늘':
       ISO 문자열을 잘라 날짜를 얻는 방식(toISOString 앞 10자)은 'UTC 오늘'이다.
       한국 시각 자정~아침 9시 사이에는 **하루 전 날짜**가 나온다.
       (밤에 지출을 등록하면 어제 날짜로 기록되던 원인)
       → 날짜 기본값·오늘 판정은 window.todayKST() 를 쓴다.
     ══════════════════════════════════════════════════════════════ */
  var KST = 'Asia/Seoul';

  function pinKST(name) {
    var orig = Date.prototype[name];
    if (typeof orig !== 'function' || orig.__kstPinned) return;
    var patched = function (locales, options) {
      var opt = options || {};
      /* 호출부가 시간대를 직접 정했으면 건드리지 않는다 */
      if (!opt.timeZone) {
        opt = Object.assign({}, opt, { timeZone: KST });
      }
      return orig.call(this, locales === undefined ? 'ko-KR' : locales, opt);
    };
    patched.__kstPinned = true;
    Date.prototype[name] = patched;
  }
  pinKST('toLocaleString');
  pinKST('toLocaleDateString');
  pinKST('toLocaleTimeString');

  /** 오늘 (KST, 'YYYY-MM-DD') — 날짜 입력칸 기본값·오늘 판정에 쓴다 */
  function todayKST() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  /** 어떤 시각의 KST 날짜 ('YYYY-MM-DD') */
  function dateKST(d) {
    var t = (d instanceof Date) ? d.getTime() : new Date(d).getTime();
    if (isNaN(t)) return '';
    return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  window.fmtKST = fmtKST;
  window.fmtKSTDate = fmtKSTDate;
  window.fmtKSTDateTime = fmtKSTDateTime;
  window.fmtKSTLong = fmtKSTLong;
  window.fmtKSTTime = fmtKSTTime;
  window.fmtKSTRelative = fmtKSTRelative;
  window.todayKST = todayKST;
  window.dateKST = dateKST;
})();
