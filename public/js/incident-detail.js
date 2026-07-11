/* =========================================================
   SIREN — incident-detail.js (B-2: 사건 댓글 시스템)
   - 댓글 목록 로드 / 작성 / 대댓글 / 좋아요·싫어요 / 신고 / 삭제
   - incident.html 상세 페이지에서만 동작
   ========================================================= */
(function () {
  'use strict';

  let _incidentId = null;
  let _isLoggedIn = false;
  let _userId = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${mm}/${dd} ${hh}:${mi}`;
  }

  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) { window.SIREN.toast(msg); return; }
    const t = document.getElementById('toast');
    if (t) { t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400); }
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (opts.body) init.body = JSON.stringify(opts.body);
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok !== false, data };
  }

  /* ============ 댓글 목록 로드 ============ */
  async function loadComments() {
    if (!_incidentId) return;

    const listEl = document.getElementById('commentList');
    const countEl = document.getElementById('commentCount');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-3)">댓글 불러오는 중...</div>';

    const res = await api('/api/incident-comments?incidentId=' + _incidentId);
    if (!res.ok) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--danger)">댓글 조회 실패</div>';
      return;
    }

    const comments = res.data?.data?.comments || [];
    const total = res.data?.data?.total || 0;
    if (countEl) countEl.textContent = `(${total})`;

    if (comments.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-3);font-size:13px">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</div>';
      return;
    }

    listEl.innerHTML = comments.map(c => renderComment(c)).join('');
  }

  function renderComment(c) {
    const badges = [];
    if (c.isAnonymous) badges.push('<span class="comment-badge anon">익명</span>');
    if (c.isPrivate) badges.push('<span class="comment-badge private">비공개</span>');

    const likeVoted = c.myVote === 'like' ? ' voted' : '';
    const dislikeVoted = c.myVote === 'dislike' ? ' voted' : '';

    const actions = `
      <div class="comment-actions">
        <button type="button" class="comment-action-btn${likeVoted}" data-cmt-action="vote" data-cmt-id="${c.id}" data-vote="like">${c.likeCount}</button>
        <button type="button" class="comment-action-btn${dislikeVoted}" data-cmt-action="vote" data-cmt-id="${c.id}" data-vote="dislike">${c.dislikeCount}</button>
        ${_isLoggedIn ? `<button type="button" class="comment-action-btn reply-btn" data-cmt-action="reply" data-cmt-id="${c.id}">답글</button>` : ''}
        ${_isLoggedIn ? `<button type="button" class="comment-action-btn report-btn" data-cmt-action="report" data-cmt-id="${c.id}">신고</button>` : ''}
        ${c.isMine ? `<button type="button" class="comment-action-btn delete-btn" data-cmt-action="delete" data-cmt-id="${c.id}">삭제</button>` : ''}
      </div>
    `;

    const repliesHtml = (c.replies && c.replies.length > 0)
      ? '<div class="comment-replies">' + c.replies.map(r => renderReply(r)).join('') + '</div>'
      : '';

    const cls = [
      'comment-item',
      c.isPrivate ? 'private-comment' : '',
      c.isHidden ? 'hidden-comment' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cls}" data-comment-id="${c.id}">
        <div class="comment-meta">
          <span class="comment-author">${esc(c.authorName)}</span>
          ${badges.join('')}
          <span class="comment-time">${fmtTime(c.createdAt)}</span>
        </div>
        <div class="comment-content">${esc(c.content)}</div>
        ${actions}
        <div class="comment-inline-form" data-inline-for="${c.id}"></div>
        ${repliesHtml}
      </div>
    `;
  }

  function renderReply(r) {
    const badges = [];
    if (r.isAnonymous) badges.push('<span class="comment-badge anon">익명</span>');
    if (r.isPrivate) badges.push('<span class="comment-badge private">비공개</span>');

    const likeVoted = r.myVote === 'like' ? ' voted' : '';
    const dislikeVoted = r.myVote === 'dislike' ? ' voted' : '';

    return `
      <div class="comment-item${r.isPrivate ? ' private-comment' : ''}${r.isHidden ? ' hidden-comment' : ''}" data-comment-id="${r.id}">
        <div class="comment-meta">
          <span class="comment-author">${esc(r.authorName)}</span>
          ${badges.join('')}
          <span class="comment-time">${fmtTime(r.createdAt)}</span>
        </div>
        <div class="comment-content">${esc(r.content)}</div>
        <div class="comment-actions">
          <button type="button" class="comment-action-btn${likeVoted}" data-cmt-action="vote" data-cmt-id="${r.id}" data-vote="like">${r.likeCount}</button>
          <button type="button" class="comment-action-btn${dislikeVoted}" data-cmt-action="vote" data-cmt-id="${r.id}" data-vote="dislike">${r.dislikeCount}</button>
          ${_isLoggedIn ? `<button type="button" class="comment-action-btn report-btn" data-cmt-action="report" data-cmt-id="${r.id}"></button>` : ''}
          ${r.isMine ? `<button type="button" class="comment-action-btn delete-btn" data-cmt-action="delete" data-cmt-id="${r.id}"></button>` : ''}
        </div>
      </div>
    `;
  }

  /* ============ 댓글 작성 ============ */
  async function submitComment(parentId) {
    const inputEl = parentId
      ? document.querySelector(`[data-inline-for="${parentId}"] textarea`)
      : document.getElementById('commentInput');
    const content = inputEl ? inputEl.value.trim() : '';

    if (!content || content.length < 2) { toast('댓글은 2자 이상 입력해주세요'); return; }

    const isAnonymous = parentId ? false : !!document.getElementById('commentAnonymous')?.checked;
    const isPrivate = parentId ? false : !!document.getElementById('commentPrivate')?.checked;

    const res = await api('/api/incident-comments', {
      method: 'POST',
      body: { action: 'create', incidentId: _incidentId, parentId, content, isAnonymous, isPrivate },
    });

    if (res.ok) {
      toast('댓글이 등록되었습니다');
      if (inputEl) inputEl.value = '';
      loadComments();
    } else {
      toast(res.data?.error || '댓글 작성 실패');
    }
  }

  /* ============ 투표 ============ */
  async function voteComment(commentId, voteType) {
    if (!_isLoggedIn) { toast('로그인이 필요합니다'); return; }

    const res = await api('/api/incident-comments', {
      method: 'POST',
      body: { action: 'vote', commentId, voteType },
    });

    if (res.ok) {
      loadComments();
    } else {
      toast(res.data?.error || '투표 실패');
    }
  }

  /* ============ 신고 ============ */
  function showReportForm(commentId) {
    const container = document.querySelector(`[data-inline-for="${commentId}"]`);
    if (!container) return;

    if (container.querySelector('.report-form-inline')) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="report-form-inline">
        <textarea placeholder="신고 사유를 5자 이상 입력해주세요" maxlength="500"></textarea>
        <button type="button" data-report-submit="${commentId}">신고 접수</button>
      </div>
    `;
  }

  async function submitReport(commentId) {
    const container = document.querySelector(`[data-inline-for="${commentId}"]`);
    const textarea = container?.querySelector('textarea');
    const reason = textarea ? textarea.value.trim() : '';

    if (!reason || reason.length < 5) { toast('신고 사유를 5자 이상 입력해주세요'); return; }

    const res = await api('/api/incident-comments', {
      method: 'POST',
      body: { action: 'report', commentId, reason },
    });

    if (res.ok) {
      toast('신고가 접수되었습니다');
      if (container) container.innerHTML = '';
    } else {
      toast(res.data?.error || '신고 실패');
    }
  }

  /* ============ 삭제 ============ */
  async function deleteComment(commentId) {
    if (!confirm('이 댓글을 삭제하시겠습니까?')) return;

    const res = await api('/api/incident-comments?id=' + commentId, { method: 'DELETE' });
    if (res.ok) {
      toast('댓글이 삭제되었습니다');
      loadComments();
    } else {
      toast(res.data?.error || '삭제 실패');
    }
  }

  /* ============ 답글 폼 ============ */
  function showReplyForm(parentId) {
    const container = document.querySelector(`[data-inline-for="${parentId}"]`);
    if (!container) return;

    if (container.querySelector('.reply-form-inline')) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="reply-form-inline">
        <textarea placeholder="답글을 작성해주세요" maxlength="1000"></textarea>
        <button type="button" data-reply-submit="${parentId}">등록</button>
      </div>
    `;
  }

  /* ============ 이벤트 위임 ============ */
  function setupEvents() {
    /* 댓글 작성 버튼 */
    document.addEventListener('click', (e) => {
      if (e.target.closest('#commentSubmitBtn')) {
        e.preventDefault();
        submitComment(null);
        return;
      }

      const actionBtn = e.target.closest('[data-cmt-action]');
      if (actionBtn) {
        e.preventDefault();
        const action = actionBtn.dataset.cmtAction;
        const id = Number(actionBtn.dataset.cmtId);

        if (action === 'vote') {
          voteComment(id, actionBtn.dataset.vote);
        } else if (action === 'reply') {
          showReplyForm(id);
        } else if (action === 'report') {
          showReportForm(id);
        } else if (action === 'delete') {
          deleteComment(id);
        }
        return;
      }

      /* 답글 제출 */
      const replySubmit = e.target.closest('[data-reply-submit]');
      if (replySubmit) {
        e.preventDefault();
        submitComment(Number(replySubmit.dataset.replySubmit));
        return;
      }

      /* 신고 제출 */
      const reportSubmit = e.target.closest('[data-report-submit]');
      if (reportSubmit) {
        e.preventDefault();
        submitReport(Number(reportSubmit.dataset.reportSubmit));
        return;
      }
    });
  }

  /* ============ 초기화 ============ */
  function init() {
    if (document.body.dataset.page !== 'incident-detail') return;

    /* URL에서 incidentId 추출 */
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('slug');
    const id = params.get('id');

    /* incident.js가 사건 상세를 로드한 후 incidentId를 설정하는 시점을 기다림 */
    const waitForIncident = setInterval(() => {
      const heroTitle = document.getElementById('incidentTitle');
      if (!heroTitle || heroTitle.textContent === '잠시만 기다려 주세요') return;

      clearInterval(waitForIncident);

      /* incidentId 결정: URL에서 또는 전역 변수에서 */
      _incidentId = window._currentIncidentId || Number(id) || null;

      if (!_incidentId) {
        /* slug로 API 조회해서 id 획득 */
        if (slug) {
          fetch('/api/incidents?slug=' + encodeURIComponent(slug), { credentials: 'include' })
            .then(r => r.json())
            .then(d => {
              if (d.ok && d.data?.incident?.id) {
                _incidentId = d.data.incident.id;
                window._currentIncidentId = _incidentId;
                startComments();
              }
            }).catch(() => {});
        }
        return;
      }

      startComments();
    }, 500);

    /* 10초 후 대기 포기 */
    setTimeout(() => clearInterval(waitForIncident), 10000);
  }

  function startComments() {
    const auth = window.SIREN_AUTH;
    _isLoggedIn = !!(auth && auth.isLoggedIn());
    _userId = _isLoggedIn ? auth.user?.uid : null;

    /* UI 표시 */
    const section = document.getElementById('commentSection');
    if (section) section.style.display = '';

    const formWrap = document.getElementById('commentFormWrap');
    const loginNotice = document.getElementById('commentLoginNotice');

    if (_isLoggedIn) {
      if (formWrap) formWrap.style.display = '';
      if (loginNotice) loginNotice.style.display = 'none';
    } else {
      if (formWrap) formWrap.style.display = 'none';
      if (loginNotice) loginNotice.style.display = '';
    }

    loadComments();
  }

  setupEvents();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();