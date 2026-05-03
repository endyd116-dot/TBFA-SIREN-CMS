/* =========================================================
   SIREN — board.js (★ Phase M-8 자유게시판)
   - board-list / board-view / board-write 3개 페이지 통합
   ========================================================= */
(function () {
  'use strict';

  /* ============ 헬퍼 ============ */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    if (isToday) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  }

  function categoryLabel(c) {
    const map = { general: '자유', share: '경험 공유', question: '질문', info: '정보', etc: '기타' };
    return map[c] || c;
  }

  /* ============ 목록 페이지 ============ */
  let _listState = { page: 1, category: '', q: '', totalPages: 1 };

  async function loadBoardList() {
    const container = document.getElementById('boardListContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-3)">목록을 불러오는 중...</div>';

    try {
      const params = new URLSearchParams();
      params.set('page', String(_listState.page));
      params.set('limit', '20');
      if (_listState.category) params.set('category', _listState.category);
      if (_listState.q) params.set('q', _listState.q);

      const res = await fetch('/api/board/list?' + params.toString(), { credentials: 'include' });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        container.innerHTML = `<div class="board-empty"><div class="icon">⚠️</div>목록을 불러오지 못했습니다</div>`;
        return;
      }

      const list = json.data?.list || [];
      const pg = json.data?.pagination || { page: 1, totalPages: 1, total: 0 };
      _listState.totalPages = pg.totalPages;

      if (!list.length) {
        container.innerHTML = `
          <div class="board-empty">
            <div class="icon">📭</div>
            ${_listState.q ? '검색 결과가 없습니다' : (_listState.category ? '해당 카테고리에 게시글이 없습니다' : '아직 게시글이 없습니다')}
            <div style="margin-top:14px"><a href="/board-write.html" class="board-write-btn">✏️ 첫 글 작성하기</a></div>
          </div>`;
        document.getElementById('boardPagination').style.display = 'none';
        return;
      }

      let html = `
        <table class="board-table">
          <thead>
            <tr>
              <th class="col-no">번호</th>
              <th class="col-cat">분류</th>
              <th>제목</th>
              <th class="col-author">작성자</th>
              <th class="col-date">작성일</th>
              <th class="col-views">조회</th>
              <th class="col-comments">댓글</th>
            </tr>
          </thead>
          <tbody>
      `;

      list.forEach((p) => {
        const pinned = p.isPinned;
        html += `
          <tr class="${pinned ? 'pinned' : ''}" data-post-id="${p.id}">
            <td class="col-no">${pinned ? '<span class="board-pin-icon">공지</span>' : p.id}</td>
            <td class="col-cat"><span class="board-cat-badge ${escapeHtml(p.category)}">${escapeHtml(categoryLabel(p.category))}</span></td>
            <td class="col-title">${escapeHtml(p.title)}</td>
            <td class="col-author">${escapeHtml(p.authorName)}</td>
            <td class="col-date">${fmtDate(p.createdAt)}</td>
            <td class="col-views">${(p.views || 0).toLocaleString()}</td>
            <td class="col-comments">${p.commentCount > 0 ? `<span class="board-comment-count">💬 ${p.commentCount}</span>` : '—'}</td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      container.innerHTML = html;

      /* 행 클릭 → 상세 */
      container.querySelectorAll('[data-post-id]').forEach((tr) => {
        tr.addEventListener('click', () => {
          const id = tr.dataset.postId;
          location.href = '/board-view.html?id=' + id;
        });
      });

      renderPagination();
    } catch (e) {
      console.error('[board-list]', e);
      container.innerHTML = `<div class="board-empty"><div class="icon">⚠️</div>네트워크 오류</div>`;
    }
  }

  function renderPagination() {
    const box = document.getElementById('boardPagination');
    if (!box) return;
    const { page, totalPages } = _listState;

    if (totalPages <= 1) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    box.style.display = 'flex';
    let html = '';

    const maxBtns = 5;
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    html += `<button data-page="1" ${page === 1 ? 'disabled' : ''}>«</button>`;
    html += `<button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let i = start; i <= end; i++) {
      html += `<button data-page="${i}" class="${i === page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
    html += `<button data-page="${totalPages}" ${page === totalPages ? 'disabled' : ''}>»</button>`;

    box.innerHTML = html;

    box.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const p = Number(btn.dataset.page);
        if (Number.isFinite(p) && p !== _listState.page) {
          _listState.page = p;
          loadBoardList();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function setupBoardListPage() {
    /* 카테고리 탭 */
    document.querySelectorAll('.board-cat-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.board-cat-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        _listState.category = tab.dataset.cat || '';
        _listState.page = 1;
        loadBoardList();
      });
    });

    /* 검색 */
    const searchInput = document.getElementById('boardSearch');
    const searchBtn = document.getElementById('btnBoardSearch');
    const doSearch = () => {
      _listState.q = (searchInput.value || '').trim();
      _listState.page = 1;
      loadBoardList();
    };
    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (searchInput) searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });

    loadBoardList();
  }

  /* ============ 상세 페이지 ============ */
  let _currentPost = null;

  async function loadBoardView() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) { location.href = '/board.html'; return; }

    const container = document.getElementById('boardViewContainer');
    const cmtContainer = document.getElementById('boardCommentsContainer');

    try {
      const res = await fetch('/api/board/detail?id=' + encodeURIComponent(id), {
        credentials: 'include',
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        container.innerHTML = `
          <div class="board-empty">
            <div class="icon">⚠️</div>
            ${escapeHtml(json.error || '게시글을 찾을 수 없습니다')}
            <div style="margin-top:14px"><a href="/board.html" class="board-write-btn">목록으로</a></div>
          </div>`;
        return;
      }

      const post = json.data.post;
      const comments = json.data.comments || [];
      _currentPost = post;

      document.title = post.title + ' | 자유게시판';

      /* 본문 */
      let attachHtml = '';
      if (post.attachments && post.attachments.length) {
        attachHtml = '<div class="board-view-attachments"><h4>📎 첨부 파일</h4><ul style="list-style:none;padding:0;margin:0">' +
          post.attachments.map((a) => `
            <li style="padding:6px 0;font-size:13px;display:flex;align-items:center;gap:8px">
              <span>${escapeHtml(a.originalName)}</span>
              <a href="${escapeHtml(a.url)}&download=1" target="_blank" rel="noopener" style="color:var(--brand);text-decoration:none">⬇ 다운로드</a>
            </li>
          `).join('') + '</ul></div>';
      }

      const isOwner = !!post.isOwner;
      const editBtn = isOwner ? `<a href="/board-write.html?id=${post.id}" class="btn-edit">✏️ 수정</a>` : '';
      const deleteBtn = isOwner ? `<button type="button" class="btn-delete" id="btnBoardDelete">🗑 삭제</button>` : '';

      container.innerHTML = `
        <div class="board-view">
          <div class="board-view-header">
            <span class="board-view-cat board-cat-badge ${escapeHtml(post.category)}">${escapeHtml(categoryLabel(post.category))}</span>
            <h2 class="board-view-title">${escapeHtml(post.title)}</h2>
            <div class="board-view-meta">
              <span>👤 ${escapeHtml(post.authorName)}</span>
              <span>📅 ${fmtDateTime(post.createdAt)}</span>
              <span>👁 ${(post.views || 0).toLocaleString()}</span>
              <span>💬 ${post.commentCount || 0}</span>
              <span>🆔 ${escapeHtml(post.postNo)}</span>
            </div>
          </div>
          <div class="board-view-content">${post.contentHtml || ''}</div>
          ${attachHtml}
          <div class="board-view-actions">
            <div class="left">
              <a href="/board.html" class="btn-list">📋 목록</a>
            </div>
            <div class="right">
              ${editBtn}
              ${deleteBtn}
            </div>
          </div>
        </div>
      `;

      const delBtn = document.getElementById('btnBoardDelete');
      if (delBtn) delBtn.addEventListener('click', () => deletePost(post.id));

      /* 댓글 영역 */
      cmtContainer.style.display = '';
      renderComments(post.id, comments);

    } catch (e) {
      console.error('[board-view]', e);
      container.innerHTML = `<div class="board-empty"><div class="icon">⚠️</div>네트워크 오류</div>`;
    }
  }

  function renderComments(postId, comments) {
    const cmtContainer = document.getElementById('boardCommentsContainer');
    const auth = window.SIREN_AUTH;
    const isLoggedIn = !!(auth && auth.isLoggedIn());

    let html = `
      <div class="board-comments">
        <div class="board-comments-header">💬 댓글 ${comments.length}개</div>
    `;

    if (isLoggedIn) {
      html += `
        <div class="board-comment-form">
          <textarea id="commentInput" maxlength="1000" placeholder="댓글을 입력하세요... (1000자 이내)"></textarea>
          <div class="form-bottom">
            <label><input type="checkbox" id="commentAnonymous"> 익명으로 작성</label>
            <button type="button" id="btnCommentSubmit">댓글 등록</button>
          </div>
        </div>
      `;
    } else {
      html += `
        <div style="background:var(--bg-soft);padding:16px;border-radius:8px;text-align:center;margin-bottom:16px;font-size:13px;color:var(--text-3)">
          댓글을 작성하려면 <a href="javascript:void(0)" data-action="open-modal" data-target="loginModal" style="color:var(--brand);font-weight:600">로그인</a>이 필요합니다
        </div>
      `;
    }

    if (!comments.length) {
      html += `<div class="board-comment-empty">아직 댓글이 없습니다. 첫 댓글을 작성해 주세요!</div>`;
    } else {
      html += '<ul class="board-comment-list">';
      comments.forEach((c) => {
        const delBtn = c.isOwner
          ? `<button type="button" class="delete-btn" data-cmt-del="${c.id}">삭제</button>`
          : '';
        html += `
          <li class="board-comment-item" data-cmt-id="${c.id}">
            <div class="board-comment-meta">
              <span class="author">👤 ${escapeHtml(c.authorName)}</span>
              <span>
                <span class="date">${fmtDateTime(c.createdAt)}</span>
                ${delBtn}
              </span>
            </div>
            <div class="board-comment-content">${escapeHtml(c.content)}</div>
          </li>
        `;
      });
      html += '</ul>';
    }

    html += '</div>';
    cmtContainer.innerHTML = html;

    /* 댓글 등록 */
    const submitBtn = document.getElementById('btnCommentSubmit');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => createComment(postId));
    }

    /* 댓글 삭제 */
    cmtContainer.querySelectorAll('[data-cmt-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteComment(Number(btn.dataset.cmtDel), postId));
    });
  }

  async function createComment(postId) {
    const input = document.getElementById('commentInput');
    const anon = document.getElementById('commentAnonymous');
    const submitBtn = document.getElementById('btnCommentSubmit');
    if (!input) return;

    const content = String(input.value || '').trim();
    if (!content) {
      window.SIREN.toast('댓글 내용을 입력해주세요');
      return;
    }
    if (content.length > 1000) {
      window.SIREN.toast('댓글은 1000자 이내로 작성해주세요');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';

    try {
      const res = await fetch('/api/board/comment-create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          content,
          isAnonymous: anon ? !!anon.checked : false,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '등록 실패');
        return;
      }

      window.SIREN.toast('댓글이 등록되었습니다');
      input.value = '';
      /* 페이지 다시 로드 */
      await loadBoardView();
    } catch (e) {
      console.error('[comment-create]', e);
      window.SIREN.toast('네트워크 오류');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '댓글 등록';
    }
  }

  async function deleteComment(commentId, postId) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;

    try {
      const res = await fetch('/api/board/comment-delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: commentId }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '삭제 실패');
        return;
      }

      window.SIREN.toast('댓글이 삭제되었습니다');
      await loadBoardView();
    } catch (e) {
      console.error('[comment-delete]', e);
      window.SIREN.toast('네트워크 오류');
    }
  }

  async function deletePost(postId) {
    if (!confirm('게시글을 삭제하시겠습니까? 삭제된 게시글은 복구할 수 없습니다.')) return;

    try {
      const res = await fetch('/api/board/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: postId }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '삭제 실패');
        return;
      }

      window.SIREN.toast('게시글이 삭제되었습니다');
      setTimeout(() => location.href = '/board.html', 800);
    } catch (e) {
      console.error('[post-delete]', e);
      window.SIREN.toast('네트워크 오류');
    }
  }

  /* ============ 작성/수정 페이지 ============ */
  let _editor = null;
  let _attachments = null;
  let _editId = null;

  async function setupBoardWritePage() {
    const auth = window.SIREN_AUTH;
    const params = new URLSearchParams(location.search);
    const id = params.get('id');

    /* 비로그인 차단 */
    setTimeout(() => {
      if (!auth || !auth.isLoggedIn()) {
        window.SIREN.toast('로그인이 필요합니다');
        setTimeout(() => location.href = '/board.html', 1000);
      }
    }, 1500);

    /* 편집기 초기화 */
    try {
      _editor = await window.SirenEditor.create({
        el: document.getElementById('boardEditor'),
        height: '420px',
        placeholder: '내용을 입력하세요. 이미지나 링크도 자유롭게 추가하실 수 있습니다.',
        uploadContext: 'board-post',
      });
    } catch (e) {
      console.error('[board-write] editor', e);
    }

    if (window.SirenAttachment) {
      _attachments = window.SirenAttachment.create({
        el: document.getElementById('boardAttachments'),
        context: 'board-post',
        maxFiles: 10,
      });
    }

    /* 수정 모드 — 기존 데이터 로드 */
    if (id) {
      _editId = Number(id);
      document.getElementById('boardEditId').value = _editId;
      document.getElementById('boardWriteTitle').textContent = '글 수정';
      document.getElementById('boardWriteCrumb').textContent = '글 수정';
      document.getElementById('boardSubmitBtn').textContent = '수정';
      await loadEditTarget(_editId);
    }

    /* 폼 제출 */
    const form = document.getElementById('boardWriteForm');
    if (form) form.addEventListener('submit', handleWriteSubmit);
  }

  async function loadEditTarget(id) {
    try {
      const res = await fetch('/api/board/detail?id=' + id, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        window.SIREN.toast('게시글을 찾을 수 없습니다');
        setTimeout(() => location.href = '/board.html', 1000);
        return;
      }
      const post = json.data.post;
      if (!post.isOwner) {
        window.SIREN.toast('본인 게시글만 수정 가능합니다');
        setTimeout(() => location.href = '/board.html', 1000);
        return;
      }
      document.getElementById('boardCategory').value = post.category;
      document.getElementById('boardTitle').value = post.title;
      document.getElementById('boardAnonymous').checked = !!post.isAnonymous;
      if (_editor) {
        try { _editor.setHTML(post.contentHtml || ''); } catch (_) {}
      }
      /* 기존 첨부 표시 (수정 시 새로 추가만 가능, 기존 유지) */
      if (post.attachments && post.attachments.length && _attachments) {
        /* 기존 첨부의 ID를 attachments 위젯에 주입하기 위해 destroy 후 재생성 */
        try { _attachments.destroy(); } catch (_) {}
        _attachments = window.SirenAttachment.create({
          el: document.getElementById('boardAttachments'),
          context: 'board-post',
          maxFiles: 10,
          initialFiles: post.attachments,
        });
      }
    } catch (e) {
      console.error('[load-edit]', e);
      window.SIREN.toast('로드 실패');
    }
  }

  async function handleWriteSubmit(e) {
    e.preventDefault();
    const form = e.target;

    const auth = window.SIREN_AUTH;
    if (!auth || !auth.isLoggedIn()) {
      window.SIREN.toast('로그인이 필요합니다');
      return;
    }

    const fd = new FormData(form);
    const category = String(fd.get('category') || 'general');
    const title = String(fd.get('title') || '').trim();
    const isAnonymous = !!fd.get('isAnonymous');

    if (!title) {
      window.SIREN.toast('제목을 입력해 주세요');
      return;
    }

    let contentHtml = '';
    try { contentHtml = _editor ? _editor.getHTML() : ''; } catch (_) {}
    contentHtml = String(contentHtml || '').trim();

    const plain = contentHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (plain.length < 5) {
      window.SIREN.toast('내용을 5자 이상 입력해 주세요');
      return;
    }

    if (_attachments && _attachments.hasUploading && _attachments.hasUploading()) {
      window.SIREN.toast('첨부 파일이 아직 업로드 중입니다');
      return;
    }

    const attachmentIds = (_attachments && _attachments.getIds) ? _attachments.getIds() : [];

    const submitBtn = document.getElementById('boardSubmitBtn');
    const oldText = submitBtn ? submitBtn.textContent : '';
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중...';

    try {
      const isEdit = !!_editId;
      const url = isEdit ? '/api/board/update' : '/api/board/create';
      const payload = isEdit
        ? { id: _editId, category, title, contentHtml, isAnonymous, attachmentIds }
        : { category, title, contentHtml, isAnonymous, attachmentIds };

      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        window.SIREN.toast(json.error || '저장 실패');
        return;
      }

      window.SIREN.toast(isEdit ? '수정되었습니다' : '등록되었습니다');
      const targetId = isEdit ? _editId : json.data?.postId;
      setTimeout(() => location.href = '/board-view.html?id=' + targetId, 700);
    } catch (e) {
      console.error('[board-write]', e);
      window.SIREN.toast('네트워크 오류');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  }

  /* ============ 초기화 ============ */
  function init() {
    const page = document.body.dataset.page;
    if (page === 'board-list') setupBoardListPage();
    else if (page === 'board-view') loadBoardView();
    else if (page === 'board-write') setupBoardWritePage();
  }

  const prevInit = window.SIREN_PAGE_INIT;
  window.SIREN_PAGE_INIT = function () {
    if (typeof prevInit === 'function') prevInit();
    init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();