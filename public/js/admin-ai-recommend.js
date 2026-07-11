/* =========================================================
   SIREN — admin-ai-recommend.js
   Phase 15: AI 전문가 추천 패널
   - 배정 모달 내 [AI 추천받기] 버튼 삽입 + 추천 결과 테이블 렌더
   ========================================================= */
(function () {
  'use strict';

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

  /* ─── 배정 모달 내 AI 추천 UI 삽입 ─── */
  function injectAiPanel(matchId, matchType) {
    var modalBody = document.querySelector('#emAssignModal > div > div:last-child');
    if (!modalBody) return;

    /* 이미 삽입돼 있으면 현재 matchId/type으로 갱신만 */
    var existing = document.getElementById('aiRecommendSection');
    if (existing) {
      existing.dataset.matchId   = matchId;
      existing.dataset.matchType = matchType;
      /* 이전 결과 초기화 */
      var panel = document.getElementById('aiRecommendPanel');
      if (panel) panel.style.display = 'none';
      return;
    }

    /* 전문가 선택 드롭다운 바로 위에 AI 추천 섹션 삽입 */
    var expertFg = modalBody.querySelector('.fg');
    if (!expertFg) return;

    var section = document.createElement('div');
    section.id = 'aiRecommendSection';
    section.dataset.matchId   = matchId;
    section.dataset.matchType = matchType;
    section.style.marginBottom = '14px';
    section.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<button class="btn-sm btn-sm-primary" id="btnAiRecommend" type="button">AI 추천받기</button>' +
        '<span id="aiRecommendSpinner" style="display:none;font-size:12px;color:var(--text-3)">AI가 최적 전문가를 분석 중입니다 (3~5초)...</span>' +
      '</div>' +
      '<div id="aiRecommendPanel" style="display:none">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px">AI 추천 순위</div>' +
        '<table class="tbl" style="font-size:12.5px">' +
          '<thead><tr>' +
            '<th style="width:36px">순위</th>' +
            '<th>이름</th>' +
            '<th style="width:60px">점수</th>' +
            '<th>추천 이유</th>' +
            '<th style="width:60px">평점</th>' +
            '<th style="width:70px">선택</th>' +
          '</tr></thead>' +
          '<tbody id="aiRecommendTbody"></tbody>' +
        '</table>' +
        '<div id="aiRecommendError" style="display:none;color:#b91c1c;font-size:12.5px;padding:8px 0">' +
          'AI 추천을 불러오지 못했습니다. 직접 선택해주세요.' +
        '</div>' +
      '</div>';

    modalBody.insertBefore(section, expertFg);
  }

  /* ─── 추천 결과 행 렌더 ─── */
  function renderRecommendRow(rec, rank) {
    var scoreColor = rec.score >= 80 ? '#16a34a' : rec.score >= 60 ? '#d97706' : '#6b7280';
    return '' +
      '<tr>' +
        '<td style="text-align:center;font-weight:700;color:var(--text-3)">' + rank + '</td>' +
        '<td><strong>' + escapeHtml(rec.name) + '</strong>' +
          (rec.specialties && rec.specialties.length
            ? '<div style="font-size:11px;color:var(--text-3)">' + escapeHtml(rec.specialties.join(', ')) + '</div>'
            : '') +
        '</td>' +
        '<td style="text-align:center">' +
          '<span style="font-size:13px;font-weight:700;color:' + scoreColor + '">' + rec.score + '</span>' +
        '</td>' +
        '<td style="font-size:11.5px;color:var(--text-2)">' + escapeHtml(rec.reason || '') + '</td>' +
        '<td style="text-align:center;font-size:12px">' +
          (rec.avgRating ? rec.avgRating.toFixed(1) + ' ' + Icons.svg('star') : '-') +
          (rec.ratingCount ? '<div style="font-size:10.5px;color:var(--text-3)">(' + rec.ratingCount + ')</div>' : '') +
        '</td>' +
        '<td>' +
          '<button class="btn-sm btn-sm-ghost" data-ai-pick="' + rec.expertId + '" ' +
            'data-ai-name="' + escapeHtml(rec.name) + '" type="button" style="font-size:11px">선택</button>' +
        '</td>' +
      '</tr>';
  }

  /* ─── AI 추천 실행 ─── */
  async function runAiRecommend() {
    var section = document.getElementById('aiRecommendSection');
    if (!section) return;

    var matchId   = section.dataset.matchId;
    var matchType = section.dataset.matchType;

    var spinner = document.getElementById('aiRecommendSpinner');
    var panel   = document.getElementById('aiRecommendPanel');
    var errDiv  = document.getElementById('aiRecommendError');
    var tbody   = document.getElementById('aiRecommendTbody');
    var btn     = document.getElementById('btnAiRecommend');

    if (btn)     { btn.disabled = true; btn.textContent = '분석 중...'; }
    if (spinner) spinner.style.display = '';
    if (panel)   panel.style.display   = 'none';
    if (errDiv)  errDiv.style.display  = 'none';

    var recs = [];
    var success = false;

    var r = await api('/api/admin-ai-expert-recommend', {
      method: 'POST',
      body: { matchId: Number(matchId), matchType: matchType },
    });
    if (r.ok) {
      recs    = (r.data && r.data.recommendations) || (r.data && r.data.data && r.data.data.recommendations) || [];
      success = true;
    }

    if (btn)     { btn.disabled = false; btn.textContent = 'AI 추천받기'; }
    if (spinner) spinner.style.display = 'none';

    if (!success || !recs.length) {
      if (panel)  panel.style.display = '';
      if (errDiv) errDiv.style.display = '';
      if (tbody)  tbody.innerHTML = '';
      return;
    }

    /* 점수 내림차순 정렬 */
    recs = recs.slice().sort(function (a, b) { return b.score - a.score; });

    if (tbody) tbody.innerHTML = recs.map(renderRecommendRow).join('');
    if (panel)  panel.style.display  = '';
    if (errDiv) errDiv.style.display = 'none';
  }

  /* ─── 추천 목록에서 전문가 선택 → 드롭다운에 자동 선택 ─── */
  function pickExpert(expertId, name) {
    var sel = document.getElementById('emExpertSelect');
    if (!sel) return;

    /* 드롭다운에 해당 옵션이 있으면 선택 */
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (String(sel.options[i].value) === String(expertId)) {
        sel.selectedIndex = i;
        found = true;
        break;
      }
    }

    if (!found) {
      /* 목록에 없으면 동적 추가 */
      var opt = document.createElement('option');
      opt.value = expertId;
      opt.textContent = name;
      sel.appendChild(opt);
      sel.value = expertId;
    }

    toast('AI 추천 전문가 ' + name + '이(가) 선택되었습니다. 배정하기 버튼을 눌러 확정하세요.');
  }

  /* ─── 이벤트 위임 ─── */
  document.addEventListener('click', function (e) {
    /* AI 추천받기 버튼 */
    var aiBtn = e.target.closest && e.target.closest('#btnAiRecommend');
    if (aiBtn) { e.preventDefault(); runAiRecommend(); return; }

    /* 추천 목록에서 전문가 선택 */
    var pickBtn = e.target.closest && e.target.closest('[data-ai-pick]');
    if (pickBtn) {
      e.preventDefault();
      pickExpert(pickBtn.dataset.aiPick, pickBtn.dataset.aiName || '');
      return;
    }
  });

  /* ─── 배정 모달 열림 감지 → AI 패널 삽입 ─── */
  // admin-expert.js의 openAssignModal 실행 후 DOM이 준비되는 시점을 감지
  var _observer = null;
  function startObserving() {
    if (_observer) return;
    var target = document.getElementById('emAssignModal');
    if (!target) return;

    _observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          var modal = document.getElementById('emAssignModal');
          if (!modal || modal.style.display === 'none') return;
          // 모달이 열린 직후 — matchId는 admin-expert.js의 _assignTarget에서 파악 불가이므로
          // data attribute로 패널 삽입 (matchId는 버튼 클릭 시 data-em-assign에서 추출)
          var assignBtn = document.querySelector('[data-em-assign][data-em-match-type]');
          if (assignBtn) {
            injectAiPanel(assignBtn.dataset.emAssign, assignBtn.dataset.emMatchType);
          } else {
            injectAiPanel('', '');
          }
        }
      });
    });
    _observer.observe(target, { attributes: true });
  }

  /* 배정 버튼 클릭 시 matchId 캡처 */
  document.addEventListener('click', function (e) {
    var assignBtn = e.target.closest && e.target.closest('[data-em-assign]');
    if (assignBtn) {
      // 모달이 열릴 때까지 잠깐 대기 후 패널 삽입
      setTimeout(function () {
        injectAiPanel(assignBtn.dataset.emAssign, assignBtn.dataset.emMatchType || '');
      }, 80);
    }
  }, true); // capture phase — admin-expert.js보다 먼저 실행

  /* DOM 준비 후 observer 시작 */
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(startObserving, 500);
  });

  window.SIREN_ADMIN_AI_RECOMMEND = { inject: injectAiPanel, run: runAiRecommend };
})();
