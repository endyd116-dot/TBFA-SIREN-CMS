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

  window.fmtKST = fmtKST;
  window.fmtKSTDate = fmtKSTDate;
  window.fmtKSTDateTime = fmtKSTDateTime;
  window.fmtKSTLong = fmtKSTLong;
  window.fmtKSTTime = fmtKSTTime;
  window.fmtKSTRelative = fmtKSTRelative;
})();
