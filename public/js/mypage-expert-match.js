/* =========================================================
   SIREN — mypage-expert-match.js
   6순위 #8: 마이페이지 → 전문가 상담 신청 모듈
   (신청 폼 + 본인 내역 + 채팅방 진입)
   ========================================================= */
(function () {
  'use strict';

  var _currentTab = 'active';

  var STATUS_LABEL = {
    pending:   '검토 대기',
    matched:   '배정 완료',
    active:    '진행중',
    closed:    '종료',
    rejected:  '반려',
  };

  var MATCH_TYPE_LABEL = {
    lawyer:    '변호사',
    counselor: '심리상담사',
  };

  var DOMAIN_LABEL = {
    incident:  '사건 제보',
    harassment:'악성민원',
    legal:     '법률지원',
    support:   '유족지원',
  };

  /* ─── 헬퍼 ─── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    alert(msg);
  }

  function fmtDate(s) {
    if (!s) return '';
    try {
      if (typeof window.fmtKSTDateTime === 'function') return window.fmtKSTDateTime(s);
      return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    } catch (e) { return String(s); }
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    try {
      var res = await fetch(path, init);
      var data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data: data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ─── 신청 폼 + 내역 탭 껍데기 렌더 ─── */
  function renderShell() {
    return '' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
        '<span style="display:inline-block;width:4px;height:24px;background:var(--brand);border-radius:2px"></span>' +
        '<h3 class="serif" style="margin:0">전문가 상담 신청</h3>' +
      '</div>' +
      '<p class="sub">변호사 또는 심리상담사와 1:1 상담을 신청하실 수 있습니다. 신청 후 운영자가 전문가를 배정하여 채팅방이 열립니다.</p>' +

      '<div class="panel" style="margin-bottom:20px;padding:18px 22px">' +
        '<form id="expertMatchForm" style="display:grid;gap:12px;max-width:640px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="fg">' +
              '<label>상담 유형 <span style="color:var(--danger)">*</span></label>' +
              '<select id="emMatchType" required>' +
                '<option value="">선택하세요</option>' +
                '<option value="lawyer">변호사 (법률 자문)</option>' +
                '<option value="counselor">심리상담사 (심리 상담)</option>' +
              '</select>' +
            '</div>' +
            '<div class="fg">' +
              '<label>관련 영역 <span style="color:var(--danger)">*</span></label>' +
              '<select id="emSourceDomain" required>' +
                '<option value="">선택하세요</option>' +
                '<option value="incident">사건 제보</option>' +
                '<option value="harassment">악성민원</option>' +
                '<option value="legal">법률지원</option>' +
                '<option value="support">유족지원</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="fg">' +
            '<label>상담 신청 사유 <span style="color:var(--danger)">*</span> <span class="hint">(10자 이상)</span></label>' +
            '<textarea id="emReason" rows="4" maxlength="2000" placeholder="상담이 필요한 구체적인 내용을 작성해 주세요. 배정에 도움이 됩니다."></textarea>' +
          '</div>' +
          '<div class="fg">' +
            '<button type="submit" class="btn btn-primary" id="btnEmSubmit">신청 제출</button>' +
          '</div>' +
        '</form>' +
      '</div>' +

      '<div style="margin-top:28px">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
          '<h4 style="margin:0;font-size:14px;font-weight:700">내 상담 신청 내역</h4>' +
          '<button id="btnEmRefresh" class="btn-sm btn-sm-ghost" type="button">새로고침</button>' +
        '</div>' +
        '<div class="app-subtabs" id="emSubtabs">' +
          '<button class="app-subtab active" data-em-tab="active">진행중</button>' +
          '<button class="app-subtab" data-em-tab="closed">완료·종료</button>' +
        '</div>' +
        '<div id="expertMatchList"><div style="text-align:center;color:var(--text-3);padding:40px;font-size:13px">로딩 중...</div></div>' +
      '</div>';
  }

  /* ─── 매칭 카드 1개 렌더 ─── */
  function renderMatchCard(it) {
    var statusLabel = STATUS_LABEL[it.status] || it.status;
    var typeLabel   = MATCH_TYPE_LABEL[it.matchType] || it.matchType;
    var domainLabel = DOMAIN_LABEL[it.sourceDomain] || it.sourceDomain;
    var canChat     = (it.status === 'matched' || it.status === 'active') && it.chatRoomId;

    var statusCls = 'app-status-closed';
    if (it.status === 'pending')                               statusCls = 'app-status-reviewing';
    else if (it.status === 'matched' || it.status === 'active') statusCls = 'app-status-matched';
    else if (it.status === 'rejected')                          statusCls = 'app-status-rejected';

    var chatBtn = canChat
      ? '<button class="btn-detail" data-em-open-chat="' + it.chatRoomId +
        '" type="button" style="padding:7px 16px;background:var(--brand);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">채팅방 입장</button>'
      : '';

    var feedbackBtn = it.status === 'closed'
      ? '<button type="button" data-em-feedback="' + it.id +
        '" style="padding:7px 14px;background:#f0fdf4;color:#16a34a;border:1px solid #86efac;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">후기 작성</button>'
      : '';

    var expertInfo = it.expertName
      ? '<span style="font-size:12px;color:var(--text-2)">배정 전문가: ' + escapeHtml(it.expertName) + '</span>'
      : '';

    var actionBtns = (chatBtn || feedbackBtn) ? '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' + chatBtn + feedbackBtn + '</div>' : '';

    return '' +
      '<div class="app-card">' +
        '<div class="app-card-head">' +
          '<div>' +
            '<div class="app-card-no">#' + it.id + '</div>' +
            '<div style="display:flex;gap:5px;margin-top:5px;flex-wrap:wrap">' +
              '<span style="font-size:11.5px;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600">' + escapeHtml(typeLabel) + '</span>' +
              '<span style="font-size:11.5px;background:#f3f4f6;color:#525252;padding:2px 8px;border-radius:10px">' + escapeHtml(domainLabel) + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="app-card-status ' + statusCls + '">' + escapeHtml(statusLabel) + '</span>' +
        '</div>' +
        (it.reason ? '<p class="app-card-summary">' + escapeHtml(it.reason) + '</p>' : '') +
        '<div class="app-card-meta">' +
          '<span>신청: ' + escapeHtml(fmtDate(it.createdAt)) + '</span>' +
          (it.assignedAt ? '<span>배정: ' + escapeHtml(fmtDate(it.assignedAt)) + '</span>' : '') +
          expertInfo +
        '</div>' +
        actionBtns +
      '</div>';
  }

  /* ─── 내역 목록 로드 ─── */
  async function loadMatches(status) {
    _currentTab = status || 'active';
    var list = document.getElementById('expertMatchList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px;font-size:13px">로딩 중...</div>';

    /* 탭 활성 */
    document.querySelectorAll('#emSubtabs [data-em-tab]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.emTab === _currentTab);
    });

    var r = await api('/api/expert-match-list?status=' + encodeURIComponent(_currentTab));
    if (!r.ok) {
      list.innerHTML = '<div class="app-empty">' +
        '<div class="icon"></div>' +
        '<div class="title">불러오기 실패</div>' +
        '<div class="desc">' + escapeHtml((r.data && r.data.error) || ('HTTP ' + r.status)) + '</div>' +
        '</div>';
      return;
    }

    /* ★ P1-7 fix: 서버는 { active:[...], closed:[...] }로 응답 → 현재 탭 키로 읽음.
       (기존 items/matches 키는 존재하지 않아 항상 빈 목록이었음) */
    var payload = (r.data && r.data.data) || r.data || {};
    var items   = payload[_currentTab] || payload.items || payload.matches || [];

    if (!items.length) {
      var msg = _currentTab === 'active'
        ? '진행 중인 전문가 상담이 없습니다.<br><small>위 신청 폼에서 새 상담을 요청해 보세요.</small>'
        : '완료·종료된 상담 내역이 없습니다.';
      list.innerHTML = '<div class="app-empty"><div class="icon"></div><div class="title">내역 없음</div><div class="desc">' + msg + '</div></div>';
      return;
    }
    list.innerHTML = '<div class="app-list">' + items.map(renderMatchCard).join('') + '</div>';
  }

  /* ─── 신청 폼 제출 ─── */
  async function onSubmit(e) {
    e.preventDefault();
    var matchType    = ((document.getElementById('emMatchType') || {}).value   || '').trim();
    var sourceDomain = ((document.getElementById('emSourceDomain') || {}).value || '').trim();
    var reason       = ((document.getElementById('emReason') || {}).value       || '').trim();

    if (!matchType)              return toast('상담 유형을 선택해 주세요');
    if (!sourceDomain)           return toast('관련 영역을 선택해 주세요');
    if (reason.length < 10)     return toast('상담 신청 사유를 10자 이상 작성해 주세요');

    var btn = document.getElementById('btnEmSubmit');
    if (btn) { btn.disabled = true; btn.textContent = '제출 중...'; }

    var r = await api('/api/expert-match-request', {
      method: 'POST',
      body: { matchType: matchType, sourceDomain: sourceDomain, reason: reason },
    });

    if (btn) { btn.disabled = false; btn.textContent = '신청 제출'; }

    if (!r.ok) {
      var err = (r.data && r.data.error) || ('HTTP ' + r.status);
      return toast('신청 실패: ' + err);
    }
    toast((r.data && r.data.message) || '상담 신청이 접수되었습니다. 전문가 배정 후 채팅방이 열립니다.');
    var form = document.getElementById('expertMatchForm');
    if (form) form.reset();
    await loadMatches('active');
  }

  /* ─── 패널 초기화 ─── */
  function load() {
    var panel = document.querySelector('.mp-panel[data-mp-panel="expertMatch"]');
    if (!panel) return;
    panel.innerHTML = renderShell();
    var form = panel.querySelector('#expertMatchForm');
    if (form) form.addEventListener('submit', onSubmit);
    loadMatches('active');
  }

  /* ─── 이벤트 위임 ─── */
  document.addEventListener('click', function (e) {
    /* 서브탭 전환 */
    var tab = e.target && e.target.closest && e.target.closest('#emSubtabs [data-em-tab]');
    if (tab) { e.preventDefault(); loadMatches(tab.dataset.emTab); return; }

    /* 새로고침 */
    var ref = e.target && e.target.closest && e.target.closest('#btnEmRefresh');
    if (ref) { e.preventDefault(); loadMatches(_currentTab); return; }

    /* 채팅방 입장 */
    var chatBtn = e.target && e.target.closest && e.target.closest('[data-em-open-chat]');
    if (chatBtn) {
      var roomId = Number(chatBtn.dataset.emOpenChat);
      if (roomId && window.SIREN_CHAT && typeof window.SIREN_CHAT.openChatWindow === 'function') {
        window.SIREN_CHAT.openChatWindow(roomId);
      } else {
        toast('채팅 모듈이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }

    /* 사이드 메뉴 클릭 → 패널 로드 */
    var li = e.target && e.target.closest && e.target.closest('li[data-mp="expertMatch"]');
    if (li) setTimeout(load, 30);
  });

  /* hash 직접 진입 (#expertMatch) */
  document.addEventListener('DOMContentLoaded', function () {
    if ((location.hash || '').replace('#', '') === 'expertMatch') {
      setTimeout(load, 100);
    }
  });

  window.SIREN_MYPAGE_EXPERT_MATCH = { load: load };
})();
