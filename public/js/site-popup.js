/* =========================================================
   site-popup.js — 사이트 팝업 플로팅 박스 렌더러
   GET /api/site-popups?page=xxx → 팝업 노출
   localStorage로 세션/하루/주간 빈도 제어
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'siren_popup_seen';
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;

  const currentPage = location.pathname;

  function getSeenMap() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function setSeenMap(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
  }

  function shouldShow(popup) {
    const freq = popup.displayFrequency || popup.frequency || 'once_day';
    if (freq === 'always') return true;

    const seen = getSeenMap();
    const key = 'p_' + popup.id;
    const last = seen[key];

    if (freq === 'session') {
      const sKey = 'siren_popup_session_' + popup.id;
      if (sessionStorage.getItem(sKey)) return false;
      return true;
    }
    if (freq === 'daily' || freq === 'once_day') {
      if (!last) return true;
      return (Date.now() - last) > ONE_DAY;
    }
    if (freq === 'weekly') {
      if (!last) return true;
      return (Date.now() - last) > ONE_WEEK;
    }
    return true;
  }

  function markSeen(popup) {
    const freq = popup.displayFrequency || popup.frequency || 'once_day';
    if (freq === 'session') {
      try { sessionStorage.setItem('siren_popup_session_' + popup.id, '1'); } catch {}
      return;
    }
    if (freq === 'always') return;
    const map = getSeenMap();
    map['p_' + popup.id] = Date.now();
    setSeenMap(map);
  }

  /* 우하단 플로팅 박스 DOM 생성 */
  function buildFloat(popup, index) {
    var layout = popup.layoutConfig || {};
    var imgSizeMap = { small: '120px', medium: '160px', large: '200px', full: '300px' };
    var imgMaxH = imgSizeMap[layout.imgSize] || '180px';
    var imgAlign = layout.imgAlign || 'center';

    const wrap = document.createElement('div');
    wrap.id = 'site-popup-' + popup.id;
    const offset = index * 10;
    wrap.style.cssText = [
      'position:fixed',
      'bottom:' + (24 + offset) + 'px',
      'right:' + (24 + offset) + 'px',
      'z-index:' + (99999 - index),
      'width:320px',
      'max-width:calc(100vw - 48px)',
      'background:#fff',
      'border-radius:14px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
      'overflow:hidden',
      'animation:popupSlideUp 0.3s ease',
    ].join(';');

    /* 이미지 */
    let imgHtml = '';
    if (popup.imageUrl) {
      const href = popup.linkUrl ? 'href="' + popup.linkUrl + '" target="_blank" rel="noopener"' : '';
      imgHtml = '<a ' + href + ' style="display:block;line-height:0">'
        + '<img src="' + popup.imageUrl + '" alt="' + popup.title + '"'
        + ' style="width:100%;max-height:' + imgMaxH + ';object-fit:cover;object-position:' + imgAlign + ';display:block">'
        + '</a>';
    }

    /* 헤더 (제목 + X 닫기) */
    const headerHtml = '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:14px 14px 0">'
      + '<div style="font-size:14px;font-weight:700;color:#1a2035;flex:1;margin-right:8px;line-height:1.4">' + popup.title + '</div>'
      + '<button class="siren-popup-close" data-popup-id="' + popup.id + '"'
      + ' style="flex-shrink:0;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:20px;line-height:1;padding:0;margin-top:-2px">×</button>'
      + '</div>';

    /* 본문 */
    const bodyHtml = popup.content
      ? '<div style="padding:8px 14px 0;font-size:12.5px;color:#4b5563;line-height:1.6;white-space:pre-line">' + popup.content + '</div>'
      : '';

    /* 링크 버튼 (이미지 없고 linkUrl 있을 때) */
    const linkHtml = popup.linkUrl && !popup.imageUrl
      ? '<div style="padding:6px 14px 0"><a href="' + popup.linkUrl + '" target="_blank" rel="noopener"'
        + ' style="color:#1e40af;font-size:12px;font-weight:600;text-decoration:underline">자세히 보기 →</a></div>'
      : '';

    /* 하단 — 오늘 하루 닫기 */
    const footHtml = '<div style="padding:10px 14px 14px;display:flex;justify-content:flex-end">'
      + '<button class="siren-popup-close-today" data-popup-id="' + popup.id + '"'
      + ' style="padding:5px 12px;background:#f3f4f6;color:#6b7280;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">'
      + '오늘 하루 닫기</button>'
      + '</div>';

    wrap.innerHTML = imgHtml + headerHtml + bodyHtml + linkHtml + footHtml;
    return wrap;
  }

  /* 팝업 닫기 */
  function closePopup(popupId, todayOnly) {
    const el = document.getElementById('site-popup-' + popupId);
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => el.remove(), 220);
    if (todayOnly) {
      const map = getSeenMap();
      map['p_' + popupId] = Date.now();
      setSeenMap(map);
    }
  }

  function renderPopup(popup, index) {
    if (!shouldShow(popup)) return;
    markSeen(popup);
    const el = buildFloat(popup, index);
    document.body.appendChild(el);
  }

  /* 이벤트 위임 */
  document.addEventListener('click', function (e) {
    var closeBtn = e.target.closest('.siren-popup-close');
    if (closeBtn) { closePopup(Number(closeBtn.dataset.popupId), false); return; }

    var todayBtn = e.target.closest('.siren-popup-close-today');
    if (todayBtn) { closePopup(Number(todayBtn.dataset.popupId), true); }
  });

  /* 슬라이드업 애니메이션 */
  var style = document.createElement('style');
  style.textContent = '@keyframes popupSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);

  async function init() {
    try {
      var r = await fetch('/api/site-popups?page=' + encodeURIComponent(currentPage));
      if (!r.ok) return;
      var json = await r.json();
      var popups = json.data?.popups || json.data || json.popups || [];
      popups.forEach(function (p, i) {
        setTimeout(function () { renderPopup(p, i); }, i * 200);
      });
    } catch (_) { /* 팝업 오류는 조용히 무시 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
