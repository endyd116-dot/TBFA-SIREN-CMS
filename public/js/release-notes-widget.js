/* ============================================================================
 * SIREN 업데이트 소식 위젯 — release-notes-widget.js
 * ----------------------------------------------------------------------------
 * 포함 페이지(운영자 진입점: workspace.html·admin-hub.html·cms-tbfa.html)에서
 *  1) 발행된 업데이트 소식 중 안 본 것이 있으면 우하단 "새 소식" 칩 표시
 *  2) 칩 클릭 → 소식 모달(항목별 '가보기' 링크)
 *  3) 새 배포 감지 시 "새 버전 — 새로고침" 안내 토스트 (15분 간격·백그라운드 탭 스킵)
 * 로그인 안 된 상태(401/403)면 조용히 아무것도 안 함.
 * ==========================================================================*/
(function () {
  'use strict';

  var SEEN_KEY = 'siren_release_seen_id';
  var state = { notes: [], latestId: 0, version: null };

  function icon(name) {
    try { if (window.Icons && Icons.svg) return Icons.svg(name); } catch (e) {}
    return '';
  }

  function injectStyle() {
    if (document.getElementById('rnw-style')) return;
    var css = [
      /* 우하단은 AI 비서 버튼(.aiw-fab)·AI 선제제안(.ai-pro-wrap)이 이미 점유 → 좌하단(사이드바 옆)에 배치.
         left 값은 좌측 고정 사이드바 폭을 실측해 런타임 지정(placeChip). */
      '#rnwChip{position:fixed;bottom:18px;left:18px;z-index:9400;display:flex;align-items:center;gap:7px;',
      'background:#7a1f2b;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;',
      'box-shadow:0 4px 14px rgba(0,0,0,.22);cursor:pointer;font-family:inherit}',
      '#rnwChip:hover{background:#641823}',
      '#rnwChip .siren-icon{width:1.1em;height:1.1em}',
      /* AI 선제제안(99999)·세션모달(99999)보다는 아래, AI 버튼(9998)·PWA배너(9999)보다는 위 */
      '#rnwOverlay{position:fixed;inset:0;z-index:99990;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px}',
      '#rnwModal{background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3)}',
      '#rnwModal header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb}',
      '#rnwModal header h2{margin:0;font-size:16px;color:#111827}',
      '#rnwClose{background:none;border:none;cursor:pointer;font-size:15px;color:#6b7280;padding:4px}',
      '#rnwBody{overflow-y:auto;padding:14px 20px 20px}',
      '.rnw-note{margin-bottom:18px}',
      '.rnw-note h3{margin:0 0 4px;font-size:14px;color:#7a1f2b}',
      '.rnw-note time{font-size:11.5px;color:#9ca3af}',
      '.rnw-note ul{margin:8px 0 0;padding-left:18px}',
      '.rnw-note li{font-size:13px;color:#374151;margin-bottom:6px;line-height:1.5}',
      '.rnw-go{margin-left:6px;font-size:12px;color:#2563eb;text-decoration:none;white-space:nowrap}',
      '.rnw-go:hover{text-decoration:underline}',
      '#rnwToast{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:10000;background:#111827;color:#fff;',
      'border-radius:10px;padding:12px 16px;font-size:13px;display:flex;align-items:center;gap:12px;box-shadow:0 6px 20px rgba(0,0,0,.3)}',
      '#rnwToast button{background:#7a1f2b;color:#fff;border:none;border-radius:7px;padding:6px 12px;font-size:12.5px;cursor:pointer;font-weight:600}',
    ].join('');
    var el = document.createElement('style');
    el.id = 'rnw-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
    } catch (e) { return ''; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  /* 좌측 고정 사이드바(워크스페이스·통합CMS)가 있으면 그 옆으로 비켜 놓는다.
     우하단은 AI 비서 버튼·AI 선제제안 카드가 쓰므로 침범하지 않는다. */
  function placeChip(btn) {
    var left = 18;
    var bars = document.querySelectorAll('.ws-sidebar, .cms-sidebar, aside[class*="sidebar"]');
    for (var i = 0; i < bars.length; i++) {
      var r = bars[i].getBoundingClientRect();
      // 화면 좌측에 붙어 있고 실제로 보이는 사이드바만 고려
      if (r.width > 0 && r.height > 0 && r.left <= 2) {
        left = Math.max(left, Math.round(r.right) + 16);
      }
    }
    btn.style.left = left + 'px';
  }

  function renderChip(unseen) {
    var old = document.getElementById('rnwChip');
    if (old) old.remove();
    if (!unseen) return;
    var btn = document.createElement('button');
    btn.id = 'rnwChip';
    btn.type = 'button';
    btn.innerHTML = icon('sparkles') + ' 새 소식 ' + unseen + '건';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
    placeChip(btn);
    // 사이드바 접힘·창 크기 변경 시 재배치
    if (!renderChip._bound) {
      renderChip._bound = true;
      window.addEventListener('resize', function () {
        var c = document.getElementById('rnwChip');
        if (c) placeChip(c);
      });
    }
  }

  function openModal() {
    closeModal();
    var ov = document.createElement('div');
    ov.id = 'rnwOverlay';
    var notesHtml = state.notes.map(function (n) {
      var items = (Array.isArray(n.items) ? n.items : []).map(function (it) {
        var go = it.link ? '<a class="rnw-go" href="' + esc(it.link) + '">가보기 →</a>' : '';
        return '<li>' + esc(it.text) + go + '</li>';
      }).join('');
      return '<div class="rnw-note"><h3>' + esc(n.title) + '</h3>' +
        '<time>' + fmtDate(n.publishedAt || n.createdAt) + '</time>' +
        '<ul>' + items + '</ul></div>';
    }).join('') || '<p style="color:#6b7280;font-size:13px">아직 등록된 소식이 없습니다.</p>';
    ov.innerHTML = '<div id="rnwModal"><header><h2>업데이트 소식</h2>' +
      '<button id="rnwClose" type="button" aria-label="닫기">' + (icon('x') || '닫기') + '</button></header>' +
      '<div id="rnwBody">' + notesHtml + '</div></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    document.getElementById('rnwClose').addEventListener('click', closeModal);
    // 읽음 처리 — 최신 id 저장 + 칩 제거
    try { localStorage.setItem(SEEN_KEY, String(state.latestId)); } catch (e) {}
    renderChip(0);
  }

  function closeModal() {
    var ov = document.getElementById('rnwOverlay');
    if (ov) ov.remove();
  }

  async function loadNotes() {
    try {
      var res = await fetch('/api/release-notes?list=1&published=1&limit=20', { credentials: 'include' });
      if (!res.ok) return; // 미로그인·권한 없음 → 조용히 종료
      var json = await res.json();
      var items = (json.data && json.data.items) || [];
      state.notes = items;
      state.latestId = items.length ? Number(items[0].id) : 0;
      var seen = 0;
      try { seen = Number(localStorage.getItem(SEEN_KEY) || 0); } catch (e) {}
      var unseen = items.filter(function (n) { return Number(n.id) > seen; }).length;
      renderChip(unseen);
    } catch (e) { /* 네트워크 오류 무시 */ }
  }

  /* ── 새 배포 감지 → 새로고침 안내 ── */
  function showRefreshToast() {
    if (document.getElementById('rnwToast')) return;
    var t = document.createElement('div');
    t.id = 'rnwToast';
    t.innerHTML = '<span>새 버전이 배포되었습니다. 새로고침하면 최신 기능이 적용됩니다.</span>' +
      '<button type="button">새로고침</button>';
    t.querySelector('button').addEventListener('click', function () { location.reload(); });
    document.body.appendChild(t);
  }

  async function checkVersion() {
    if (document.hidden) return; // 백그라운드 탭 스킵 (비용·절전)
    try {
      var res = await fetch('/api/app-version', { cache: 'no-store' });
      if (!res.ok) return;
      var json = await res.json();
      var v = json.version;
      if (!v) return;
      if (state.version === null) { state.version = v; return; }
      if (v !== state.version) showRefreshToast();
    } catch (e) { /* 무시 */ }
  }

  function init() {
    injectStyle();
    loadNotes();
    checkVersion();
    setInterval(checkVersion, 15 * 60 * 1000); // 15분 간격
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkVersion();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
