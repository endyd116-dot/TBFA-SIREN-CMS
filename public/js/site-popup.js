/* =========================================================
   site-popup.js — 사이트 팝업 오버레이 렌더러
   GET /api/site-popups?page=xxx → 팝업 노출
   localStorage로 세션/하루/주간 빈도 제어
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'siren_popup_seen';
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;

  /* 현재 페이지 경로 */
  const currentPage = location.pathname;

  /* localStorage 유틸 */
  function getSeenMap() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function setSeenMap(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
  }

  /* 팝업을 이번에 표시해야 하는지 결정 */
  function shouldShow(popup) {
    const freq = popup.displayFrequency || popup.frequency || 'once_day';
    if (freq === 'always') return true;

    const seen = getSeenMap();
    const key = 'p_' + popup.id;
    const last = seen[key];

    if (freq === 'session') {
      /* sessionStorage로 세션 추적 */
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

  /* 팝업을 "봤다"고 기록 */
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

  /* 팝업 오버레이 DOM 생성 */
  function buildOverlay(popup) {
    const overlay = document.createElement('div');
    overlay.id = 'site-popup-' + popup.id;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.55)',
      'z-index:99999', 'display:flex', 'align-items:center',
      'justify-content:center', 'padding:20px',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#fff', 'border-radius:14px',
      'width:100%', 'max-width:480px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.25)',
      'overflow:hidden', 'animation:popupFadeIn 0.25s ease',
    ].join(';');

    /* 이미지 */
    let imgHtml = '';
    if (popup.imageUrl) {
      const clickWrap = popup.linkUrl ? `href="${popup.linkUrl}"` : '';
      imgHtml = `<a ${clickWrap} target="${popup.linkUrl ? '_blank' : '_self'}" rel="noopener"
        style="display:block;line-height:0">
        <img src="${popup.imageUrl}" alt="${popup.title}"
          style="width:100%;max-height:280px;object-fit:cover;display:block">
      </a>`;
    }

    /* 본문 */
    const hasContent = popup.content || popup.title;
    const contentHtml = hasContent ? `
      <div style="padding:20px 24px 0">
        <div style="font-size:16px;font-weight:700;color:#1a2035;margin-bottom:8px">${popup.title}</div>
        ${popup.content ? `<div style="font-size:13px;color:#4b5563;line-height:1.6;white-space:pre-line">${popup.content}</div>` : ''}
        ${popup.linkUrl && !popup.imageUrl ? `<a href="${popup.linkUrl}" target="_blank" rel="noopener"
          style="display:inline-block;margin-top:12px;color:#1e40af;font-size:13px;font-weight:600;text-decoration:underline">자세히 보기 →</a>` : ''}
      </div>` : '';

    /* 하단 버튼 */
    const footHtml = `
      <div style="padding:14px 24px 20px;display:flex;justify-content:flex-end;gap:8px">
        <button class="siren-popup-close-today" data-popup-id="${popup.id}"
          style="padding:7px 14px;background:#f3f4f6;color:#374151;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">
          오늘 하루 닫기
        </button>
        <button class="siren-popup-close" data-popup-id="${popup.id}"
          style="padding:7px 14px;background:#1e40af;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">
          닫기
        </button>
      </div>`;

    box.innerHTML = imgHtml + contentHtml + footHtml;
    overlay.appendChild(box);
    return overlay;
  }

  /* 팝업 닫기 */
  function closePopup(popupId, todayOnly) {
    const overlay = document.getElementById('site-popup-' + popupId);
    if (!overlay) return;
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s';
    setTimeout(() => overlay.remove(), 220);
    if (todayOnly) {
      const map = getSeenMap();
      map['p_' + popupId] = Date.now();
      setSeenMap(map);
    }
  }

  /* 팝업 렌더 */
  function renderPopup(popup) {
    if (!shouldShow(popup)) return;
    markSeen(popup);

    const overlay = buildOverlay(popup);
    document.body.appendChild(overlay);

    /* 오버레이 바깥 클릭 닫기 */
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closePopup(popup.id, false);
    });
  }

  /* 팝업 이벤트 (동적 요소라 document에 위임) */
  document.addEventListener('click', e => {
    const closeBtn = e.target.closest('.siren-popup-close');
    if (closeBtn) { closePopup(Number(closeBtn.dataset.popupId), false); return; }

    const todayBtn = e.target.closest('.siren-popup-close-today');
    if (todayBtn) { closePopup(Number(todayBtn.dataset.popupId), true); }
  });

  /* CSS 애니메이션 */
  const style = document.createElement('style');
  style.textContent = '@keyframes popupFadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}';
  document.head.appendChild(style);

  /* API 호출 + 렌더 */
  async function init() {
    try {
      const r = await fetch('/api/site-popups?page=' + encodeURIComponent(currentPage));
      if (!r.ok) return;
      const json = await r.json();
      const popups = (json.data?.popups || json.data || json.popups || []);
      /* 순서대로 표시 (z-index 역순으로 쌓이므로 첫 번째가 맨 위) */
      popups.forEach((p, i) => {
        setTimeout(() => renderPopup(p), i * 150);
      });
    } catch { /* 팝업 오류는 조용히 무시 */ }
  }

  /* DOM 준비 후 실행 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
