/* =========================================================
   SIREN — mypage-match-feedback.js
   Phase 15: 매칭 종결 후 별점·후기 입력
   - 종결 매칭 + 미제출 시에만 노출
   - 별 클릭으로 1~5점 선택, textarea 후기 입력
   - 제출 성공 시 UI 숨김
   ========================================================= */
(function () {
  'use strict';

  var _selectedRating = 0;

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

  /* ─── 피드백 상태 확인 ─── */
  async function checkFeedbackStatus(matchId) {
    var r = await api('/api/user-match-feedback-status?matchId=' + encodeURIComponent(matchId));
    if (!r.ok) return null;
    return (r.data && r.data.data) || r.data || null;
  }

  /* ─── 별점 UI 렌더 ─── */
  function renderFeedbackUI(matchId, expertName) {
    var container = document.getElementById('matchFeedbackContainer');
    if (!container) return;

    _selectedRating = 0;

    container.innerHTML =
      '<div class="panel" style="margin-top:20px;border:2px solid var(--brand);border-radius:12px;padding:20px 24px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
          '<span style="font-size:20px"></span>' +
          '<strong style="font-size:15px">상담 후기 작성</strong>' +
        '</div>' +
        '<p style="font-size:13px;color:var(--text-2);margin:0 0 14px">' +
          escapeHtml(expertName) + ' 전문가와의 상담이 종결되었습니다. 후기를 남겨주시면 다른 회원에게 큰 도움이 됩니다.' +
        '</p>' +

        '<!-- 별점 선택 -->' +
        '<div style="margin-bottom:14px">' +
          '<div style="font-size:13px;font-weight:600;margin-bottom:6px">만족도 <span style="color:var(--danger)">*</span></div>' +
          '<div id="starRatingRow" style="display:flex;gap:4px;cursor:pointer">' +
            renderStarButtons() +
          '</div>' +
          '<div id="ratingLabel" style="font-size:12px;color:var(--text-3);margin-top:4px;height:18px"></div>' +
        '</div>' +

        '<!-- 후기 텍스트 -->' +
        '<div class="fg" style="margin-bottom:14px">' +
          '<label style="font-size:13px;font-weight:600">후기 <span class="hint">(선택, 최대 500자)</span></label>' +
          '<textarea id="feedbackComment" rows="4" maxlength="500" ' +
            'placeholder="전문가의 상담 내용, 도움이 된 점, 개선할 점 등을 자유롭게 작성해 주세요."></textarea>' +
        '</div>' +

        '<button class="btn btn-primary" id="btnSubmitFeedback" type="button" ' +
          'data-match-id="' + matchId + '" disabled>후기 제출</button>' +
        '<span style="font-size:12px;color:var(--text-3);margin-left:10px">별점을 선택해야 제출할 수 있습니다.</span>' +
      '</div>';

    container.style.display = '';
  }

  /* ─── 별점 버튼 HTML ─── */
  function renderStarButtons() {
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html +=
        '<button type="button" data-star="' + i + '" ' +
          'style="background:none;border:none;font-size:32px;padding:2px;cursor:pointer;' +
          'color:#d1d5db;transition:color 0.1s;line-height:1" ' +
          'aria-label="' + i + '점">★</button>';
    }
    return html;
  }

  var RATING_LABELS = ['', '매우 불만족', '불만족', '보통', '만족', '매우 만족 ★'];

  /* ─── 별점 하이라이트 갱신 ─── */
  function updateStarDisplay(hoverVal) {
    var val  = hoverVal || _selectedRating;
    var row  = document.getElementById('starRatingRow');
    var lbl  = document.getElementById('ratingLabel');
    if (!row) return;
    row.querySelectorAll('[data-star]').forEach(function (btn) {
      btn.style.color = Number(btn.dataset.star) <= val ? '#f59e0b' : '#d1d5db';
    });
    if (lbl) lbl.textContent = val ? RATING_LABELS[val] || '' : '';
  }

  /* ─── 별점 클릭 이벤트 ─── */
  document.addEventListener('click', function (e) {
    var starBtn = e.target.closest && e.target.closest('#starRatingRow [data-star]');
    if (starBtn) {
      _selectedRating = Number(starBtn.dataset.star);
      updateStarDisplay();
      var submitBtn = document.getElementById('btnSubmitFeedback');
      var hint = submitBtn && submitBtn.nextElementSibling;
      if (submitBtn) { submitBtn.disabled = false; }
      if (hint) hint.style.display = 'none';
      return;
    }

    /* 제출 버튼 */
    var submitBtn = e.target.closest && e.target.closest('#btnSubmitFeedback');
    if (submitBtn) {
      e.preventDefault();
      submitFeedback(Number(submitBtn.dataset.matchId));
      return;
    }
  });

  /* ─── 별점 hover 효과 ─── */
  document.addEventListener('mouseover', function (e) {
    var starBtn = e.target.closest && e.target.closest('#starRatingRow [data-star]');
    if (starBtn) updateStarDisplay(Number(starBtn.dataset.star));
  });
  document.addEventListener('mouseout', function (e) {
    var row = document.getElementById('starRatingRow');
    if (row && !row.contains(e.relatedTarget)) updateStarDisplay(0);
  });

  /* ─── 피드백 제출 ─── */
  async function submitFeedback(matchId) {
    if (!_selectedRating) return toast('별점을 선택해 주세요');

    var comment = ((document.getElementById('feedbackComment') || {}).value || '').trim();
    var btn = document.getElementById('btnSubmitFeedback');
    if (btn) { btn.disabled = true; btn.textContent = '제출 중...'; }

    var r = await api('/api/user-match-feedback', {
      method: 'POST',
      body: { matchId: matchId, rating: _selectedRating, comment: comment || undefined },
    });

    if (btn) { btn.disabled = false; btn.textContent = '후기 제출'; }

    if (!r.ok) {
      return toast('제출 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
    }
    toast((r.data && r.data.message) || '후기가 제출되었습니다. 감사합니다!');
    hideFeedbackUI();
  }

  /* ─── UI 숨김 ─── */
  function hideFeedbackUI() {
    var container = document.getElementById('matchFeedbackContainer');
    if (container) {
      container.innerHTML =
        '<div style="padding:16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#15803d;margin-top:16px">' +
          '후기를 제출해 주셔서 감사합니다.' +
        '</div>';
    }
  }

  /* ─── 초기화: 특정 matchId에 대한 피드백 상태 확인 ─── */
  async function init(matchId) {
    if (!matchId) return;
    var container = document.getElementById('matchFeedbackContainer');
    if (!container) return;
    container.style.display = 'none';

    var status = await checkFeedbackStatus(matchId);
    if (!status) return;

    var match = status.match || {};
    if (match.status === 'closed' && !status.submitted) {
      renderFeedbackUI(match.id, match.expertName || '전문가');
    }
  }

  /* 후기 작성 버튼 클릭 (mypage-expert-match.js 카드에서 data-em-feedback 속성으로 matchId 전달) */
  document.addEventListener('click', function (e) {
    var feedbackBtn = e.target.closest && e.target.closest('[data-em-feedback]');
    if (feedbackBtn) {
      e.preventDefault();
      var matchId = Number(feedbackBtn.dataset.emFeedback);
      if (matchId) setTimeout(function () { init(matchId); }, 50);
      return;
    }
  });

  window.SIREN_MATCH_FEEDBACK = { init: init };
})();
