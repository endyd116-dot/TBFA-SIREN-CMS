/**
 * public/js/admin-site-pages.js — 메인 화면 편집 › 페이지 관리
 * 설계서: docs/active/2026-08-03-page-menu-redesign.md §2.2·§7 4단계
 *
 * 메뉴가 가리키는 페이지를 만들고, 그 내용을 **통째로** 편집한다.
 * 예전처럼 정해진 칸만 채우는 게 아니라 문단·사진·표를 자유롭게 넣고 뺄 수 있다.
 *
 * 화면 두 개를 같은 자리에서 오간다.
 *   ① 목록 — 어떤 페이지가 있는지, 어디에 노출되는지
 *   ② 편집 — 제목·본문 편집 + 설정 + 이전 버전 되돌리기
 *
 * 저장은 임시저장 → 배포 2단계다. 다른 편집 영역과 같은 [모든 변경사항 배포] 버튼으로 함께 나간다.
 */
(function () {
  'use strict';

  var _view = 'list';       // 'list' | 'edit'
  var _page = null;         // 편집 중인 페이지
  var _list = [];           // 목록 (순서 변경에 쓴다)
  var _ed = null;           // 편집기 핸들
  var _dirty = false;       // 저장 안 된 변경이 있는지

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg) {
    var t = $('#toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._sptt);
    window._sptt = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    try {
      var res = await fetch(path, init);
      var data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data: data };
    } catch (e) {
      console.error('[site-pages]', path, e);
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /** 서버가 응답을 한 번 더 감싸서 보내는 경우가 있어 단계별로 풀어서 쓴다 */
  function unwrap(res, key) {
    var d = res && res.data;
    if (!d) return null;
    if (d.data && d.data[key] !== undefined) return d.data[key];
    if (d[key] !== undefined) return d[key];
    return null;
  }

  function fmtDate(v) {
    if (!v) return '-';
    try {
      var d = new Date(v);
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    } catch (_) { return String(v).slice(0, 16); }
  }

  function setPreview(path) {
    try {
      if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.setPreviewPath) {
        window.SIREN_SITE_BUILDER.setPreviewPath(path);
      }
    } catch (_) {}
  }

  function refreshDraftBadge() {
    try {
      if (window.SIREN_SITE_BUILDER && window.SIREN_SITE_BUILDER.refreshDraftCount) {
        window.SIREN_SITE_BUILDER.refreshDraftCount();
      }
    } catch (_) {}
  }

  /* =========================================================
     ① 목록 화면
     ========================================================= */
  async function render() {
    _view = 'list';
    _page = null;
    destroyEditor();
    setPreview('/index.html');

    var inner = $('#sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div class="sb-placeholder"><p>페이지 목록을 불러오는 중…</p></div>';

    var res = await api('/api/admin/site-pages');
    if (!res.ok) {
      inner.innerHTML =
        '<div class="sb-placeholder"><h3>페이지 목록을 불러오지 못했습니다</h3>' +
        '<p>' + esc((res.data && res.data.error) || '알 수 없는 오류') + '</p>' +
        '<small>저장소 준비(마이그레이션)가 아직 안 되었을 수 있습니다.</small></div>';
      return;
    }

    var list = unwrap(res, 'list') || [];
    var stats = unwrap(res, 'stats') || {};
    _list = list;

    var rows = list.map(function (p, idx) {
      var visible = p.status === 'published';
      return '' +
        '<tr data-page-id="' + p.id + '">' +
          '<td style="width:56px;white-space:nowrap">' +
            '<button type="button" class="sp-ico" data-act="up" title="위로"' +
              (idx === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="sp-ico" data-act="down" title="아래로"' +
              (idx === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '</td>' +
          '<td>' +
            '<div class="sp-name">' + esc(p.title) + '</div>' +
            (p.subtitle ? '<div class="sp-sub">' + esc(p.subtitle) + '</div>' : '') +
          '</td>' +
          '<td><a href="/p/' + esc(p.slug) + '" target="_blank" rel="noopener" class="sp-slug">/p/' + esc(p.slug) + '</a></td>' +
          '<td style="text-align:center">' +
            '<span class="sp-chip ' + (visible ? 'on' : 'off') + '">' + (visible ? '보임' : '숨김') + '</span>' +
          '</td>' +
          '<td style="text-align:center">' +
            (p.hasDraft ? '<span class="sp-chip draft">임시저장</span>' : '<span class="sp-muted">-</span>') +
          '</td>' +
          '<td class="sp-muted" style="white-space:nowrap">' + fmtDate(p.updatedAt) + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            '<button type="button" class="sp-btn primary" data-act="edit">내용 편집</button> ' +
            '<button type="button" class="sp-btn" data-act="delete">삭제</button>' +
          '</td>' +
        '</tr>';
    }).join('');

    inner.innerHTML = '' +
      '<div class="sp-wrap">' +
        '<div class="sp-head">' +
          '<div>' +
            '<h2 class="sp-h2">페이지 관리</h2>' +
            '<p class="sp-intro">메뉴가 가리키는 페이지를 만들고 내용을 통째로 편집합니다. ' +
            '문단·사진·표를 자유롭게 넣고 뺄 수 있습니다. 저장한 내용은 [모든 변경사항 배포]를 눌러야 사이트에 나갑니다.</p>' +
          '</div>' +
          '<button type="button" class="sp-btn primary lg" id="spNewBtn">＋ 새 페이지 만들기</button>' +
        '</div>' +

        '<div class="sp-stats">' +
          '<span>전체 <strong>' + (stats.total || 0) + '</strong>개</span>' +
          '<span>임시저장 <strong>' + (stats.drafts || 0) + '</strong>개</span>' +
        '</div>' +

        (list.length === 0
          ? '<div class="sb-placeholder" style="margin-top:20px"><h3>아직 만든 페이지가 없습니다</h3>' +
            '<p>[＋ 새 페이지 만들기]를 눌러 첫 페이지를 만들어 보세요.</p></div>'
          : '<div class="sp-table-wrap"><table class="sp-table">' +
              '<thead><tr>' +
                '<th style="width:56px">순서</th>' +
                '<th>페이지 이름</th><th>주소</th>' +
                '<th style="text-align:center;width:80px">노출</th>' +
                '<th style="text-align:center;width:90px">상태</th>' +
                '<th style="width:140px">마지막 수정</th>' +
                '<th style="width:180px"></th>' +
              '</tr></thead><tbody>' + rows + '</tbody></table></div>') +
      '</div>';

    injectStyles();

    var newBtn = $('#spNewBtn');
    if (newBtn) newBtn.addEventListener('click', createPageFlow);

    inner.querySelectorAll('.sp-table [data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tr = btn.closest('tr');
        var id = Number(tr && tr.getAttribute('data-page-id'));
        if (!id) return;
        var act = btn.getAttribute('data-act');
        if (act === 'edit') return openEditor(id);
        if (act === 'up' || act === 'down') return movePage(id, act);
        deletePage(id, tr.querySelector('.sp-name').textContent);
      });
    });
  }

  /**
   * 목록에서 페이지 차례를 바꾼다.
   * 옮긴 뒤 전체에 번호를 다시 매긴다 — 처음 만들어진 페이지들은 차례 값이 겹치거나 비어 있어서,
   * 두 개만 맞바꾸면 순서가 그대로인 것처럼 보이는 일이 생긴다.
   */
  async function movePage(id, dir) {
    var idx = -1;
    for (var i = 0; i < _list.length; i++) { if (Number(_list[i].id) === Number(id)) { idx = i; break; } }
    if (idx < 0) return;

    var to = dir === 'up' ? idx - 1 : idx + 1;
    if (to < 0 || to >= _list.length) return;

    var arr = _list.slice();
    var tmp = arr[idx]; arr[idx] = arr[to]; arr[to] = tmp;

    var jobs = [];
    arr.forEach(function (p, i) {
      var want = (i + 1) * 10;
      if (Number(p.sortOrder) !== want) {
        jobs.push(api('/api/admin/site-pages?action=meta', { method: 'PATCH', body: { id: p.id, sortOrder: want } }));
      }
    });

    if (jobs.length === 0) return;
    var results = await Promise.all(jobs);
    var failed = results.filter(function (r) { return !r.ok; }).length;
    if (failed > 0) toast('일부 순서를 저장하지 못했습니다');
    else toast('순서를 바꿨습니다');
    render();
  }

  /* =========================================================
     새 페이지 만들기
     ========================================================= */
  async function createPageFlow() {
    var title = prompt('새 페이지의 이름을 입력하세요.\n(주소는 이름에서 자동으로 만들어집니다)');
    if (title == null) return;
    title = String(title).trim();
    if (!title) return toast('페이지 이름을 입력해주세요');

    var res = await api('/api/admin/site-pages', { method: 'POST', body: { title: title } });
    if (!res.ok) return toast((res.data && res.data.error) || '페이지를 만들지 못했습니다');

    var id = unwrap(res, 'id');
    var slug = unwrap(res, 'slug');
    toast('페이지가 만들어졌습니다 (주소 /p/' + slug + ')');
    refreshDraftBadge();
    if (id) openEditor(id);
  }

  async function deletePage(id, name) {
    if (!confirm('“' + name + '” 페이지를 삭제할까요?\n\n' +
      '· 이 페이지를 가리키던 메뉴는 연결이 끊깁니다\n' +
      '· 저장해 둔 이전 버전도 함께 사라집니다\n' +
      '· 되돌릴 수 없습니다')) return;

    var res = await api('/api/admin/site-pages?id=' + id, { method: 'DELETE' });
    if (!res.ok) return toast((res.data && res.data.error) || '삭제하지 못했습니다');
    toast((res.data && res.data.message) || '삭제했습니다');
    refreshDraftBadge();
    render();
  }

  /* =========================================================
     ② 편집 화면
     ========================================================= */
  function destroyEditor() {
    if (_ed) { try { _ed.destroy(); } catch (_) {} _ed = null; }
    _dirty = false;
  }

  async function openEditor(id) {
    var inner = $('#sbContentInner');
    if (!inner) return;
    inner.innerHTML = '<div class="sb-placeholder"><p>페이지를 불러오는 중…</p></div>';

    var res = await api('/api/admin/site-pages?id=' + id);
    if (!res.ok) return toast((res.data && res.data.error) || '페이지를 불러오지 못했습니다');

    var page = unwrap(res, 'page');
    if (!page) return toast('페이지를 찾을 수 없습니다');

    _view = 'edit';
    _page = page;
    _dirty = false;

    /* 임시저장본이 있으면 그것부터 보여준다 — 이어서 편집하는 게 자연스럽다 */
    var useDraft = !!page.hasDraft;
    var curTitle = useDraft && page.draftTitle != null ? page.draftTitle : page.title;
    var curEyebrow = useDraft && page.draftEyebrow != null ? page.draftEyebrow : page.eyebrow;
    var curSubtitle = useDraft && page.draftSubtitle != null ? page.draftSubtitle : page.subtitle;
    var curBody = useDraft && page.draftContentHtml != null ? page.draftContentHtml : page.contentHtml;

    inner.innerHTML = '' +
      '<div class="sp-wrap">' +
        '<div class="sp-edit-top">' +
          '<button type="button" class="sp-btn" id="spBackBtn">← 목록</button>' +
          '<div class="sp-edit-title">' + esc(page.title) +
            (useDraft ? ' <span class="sp-chip draft">임시저장 있음</span>' : '') +
            (page.status !== 'published' ? ' <span class="sp-chip off">숨김</span>' : '') +
          '</div>' +
          '<div class="sp-edit-actions">' +
            '<button type="button" class="sp-btn" id="spSettingsBtn">설정</button>' +
            '<button type="button" class="sp-btn" id="spHistoryBtn">이전 버전</button>' +
            (useDraft ? '<button type="button" class="sp-btn" id="spDiscardBtn">임시저장 버리기</button>' : '') +
            '<button type="button" class="sp-btn primary" id="spSaveBtn">임시저장</button>' +
            '<button type="button" class="sp-btn publish" id="spPublishBtn">이 페이지 배포</button>' +
          '</div>' +
        '</div>' +

        '<div class="sp-fields">' +
          '<label class="sp-field"><span>페이지 제목</span>' +
            '<input type="text" id="spTitle" value="' + esc(curTitle || '') + '" placeholder="예) 인사말" /></label>' +
          '<label class="sp-field sm"><span>제목 위 영문 (선택)</span>' +
            '<input type="text" id="spEyebrow" value="' + esc(curEyebrow || '') + '" placeholder="예) GREETING" /></label>' +
          '<label class="sp-field"><span>한 줄 설명 (선택)</span>' +
            '<input type="text" id="spSubtitle" value="' + esc(curSubtitle || '') + '" placeholder="제목 아래에 작게 표시됩니다" /></label>' +
        '</div>' +

        '<div class="sp-insert-bar">' +
          '<span class="sp-insert-label">본문에 넣기</span>' +
          '<button type="button" class="sp-btn xs" data-sc="map">지도</button>' +
          '<button type="button" class="sp-btn xs" data-sc="donate">후원 버튼</button>' +
          '<button type="button" class="sp-btn xs" data-sc="apply">신청 버튼</button>' +
          '<button type="button" class="sp-btn xs" data-sc="button">일반 버튼</button>' +
          '<span class="sp-insert-hint">누르면 본문에 표시 자리가 들어갑니다. 사이트에서는 실제 지도·버튼으로 보입니다.</span>' +
        '</div>' +

        '<div id="spEditorHost"><textarea id="spEditor"></textarea></div>' +

        '<div class="sp-edit-foot">' +
          '<span class="sp-muted">주소 <a href="/p/' + esc(page.slug) + '" target="_blank" rel="noopener">/p/' + esc(page.slug) + '</a></span>' +
          '<span class="sp-muted">Ctrl+S 로도 임시저장됩니다</span>' +
        '</div>' +
      '</div>';

    injectStyles();
    setPreview('/p/' + page.slug);

    $('#spBackBtn').addEventListener('click', backToList);
    $('#spSaveBtn').addEventListener('click', function () { saveDraft(true); });
    $('#spPublishBtn').addEventListener('click', publishThis);
    $('#spSettingsBtn').addEventListener('click', openSettings);
    $('#spHistoryBtn').addEventListener('click', openHistory);
    var discardBtn = $('#spDiscardBtn');
    if (discardBtn) discardBtn.addEventListener('click', discardDraft);

    ['spTitle', 'spEyebrow', 'spSubtitle'].forEach(function (id) {
      var el = $('#' + id);
      if (el) el.addEventListener('input', function () { _dirty = true; });
    });

    inner.querySelectorAll('[data-sc]').forEach(function (b) {
      b.addEventListener('click', function () { insertShortcode(b.getAttribute('data-sc')); });
    });

    /* 편집기 띄우기 */
    try {
      if (!window.SirenPageEditor) throw new Error('편집기 파일을 불러오지 못했습니다');
      _ed = await window.SirenPageEditor.create({
        el: '#spEditor',
        initialValue: curBody || '',
        height: '620px',
        uploadContext: 'site-page',
        placeholder: '내용을 입력하세요. 사진은 끌어다 놓으면 올라갑니다.',
        onChange: function () { _dirty = true; },
        onSave: function () { saveDraft(true); }
      });
    } catch (e) {
      var host = $('#spEditorHost');
      if (host) {
        host.innerHTML = '<div class="sb-placeholder"><h3>편집기를 불러오지 못했습니다</h3>' +
          '<p>' + esc(e && e.message ? e.message : '알 수 없는 오류') + '</p>' +
          '<small>인터넷 연결을 확인한 뒤 화면을 새로고침해 주세요.</small></div>';
      }
    }
  }

  function backToList() {
    if (_dirty && !confirm('저장하지 않은 변경이 있습니다. 목록으로 나갈까요?')) return;
    destroyEditor();
    render();
  }

  function insertShortcode(kind) {
    if (!_ed) return toast('편집기가 아직 준비되지 않았습니다');

    if (kind === 'map') {
      var addr = prompt('지도에 표시할 주소를 입력하세요', '서울특별시 강서구 공항대로 426');
      if (!addr) return;
      var info = prompt('지도 위에 띄울 안내 문구 (선택, 비워도 됩니다)', '(사)교사유가족협의회');
      _ed.insertShortcode('map', info ? addr + '|' + info : addr);
    } else if (kind === 'donate') {
      _ed.insertShortcode('donate');
    } else if (kind === 'apply') {
      _ed.insertShortcode('apply', 'support');
    } else if (kind === 'button') {
      var label = prompt('버튼에 쓸 문구', '자세히 보기');
      if (!label) return;
      var href = prompt('눌렀을 때 이동할 주소', '/resources.html');
      if (!href) return;
      _ed.insertShortcode('button', label + '|' + href);
    }
    _dirty = true;
  }

  /* =========================================================
     저장 · 배포
     ========================================================= */
  async function saveDraft(showToast) {
    if (!_page) return;
    var body = {
      id: _page.id,
      title: ($('#spTitle') || {}).value || '',
      eyebrow: ($('#spEyebrow') || {}).value || '',
      subtitle: ($('#spSubtitle') || {}).value || '',
      contentHtml: _ed ? _ed.getHTML() : undefined
    };
    if (!String(body.title).trim()) return toast('페이지 제목을 입력해주세요');

    var res = await api('/api/admin/site-pages', { method: 'PATCH', body: body });
    if (!res.ok) return toast((res.data && res.data.error) || '임시저장에 실패했습니다');

    _dirty = false;
    if (showToast) toast('임시저장했습니다 — 사이트 반영은 [배포]');
    refreshDraftBadge();
    setPreview('/p/' + _page.slug);
    return true;
  }

  async function publishThis() {
    if (!_page) return;
    if (_dirty) {
      var saved = await saveDraft(false);
      if (!saved) return;
    }
    if (!confirm('이 페이지를 사이트에 반영할까요?\n\n지금 저장된 내용이 방문자에게 바로 보입니다.')) return;

    var res = await api('/api/admin/site-pages?action=publish', {
      method: 'POST', body: { action: 'publish', id: _page.id }
    });
    if (!res.ok) return toast((res.data && res.data.error) || '배포에 실패했습니다');

    toast((res.data && res.data.message) || '사이트에 반영되었습니다');
    refreshDraftBadge();
    openEditor(_page.id);
  }

  async function discardDraft() {
    if (!_page) return;
    if (!confirm('임시저장한 내용을 버리고 지금 사이트에 나가 있는 내용으로 되돌릴까요?')) return;

    var res = await api('/api/admin/site-pages?id=' + _page.id + '&action=discard', { method: 'DELETE' });
    if (!res.ok) return toast((res.data && res.data.error) || '되돌리지 못했습니다');
    toast('발행본으로 되돌렸습니다');
    refreshDraftBadge();
    openEditor(_page.id);
  }

  /* =========================================================
     설정 (주소·노출·레이아웃·검색)
     ========================================================= */
  function openSettings() {
    if (!_page) return;
    var p = _page;

    var html = '' +
      '<div class="sp-modal-bg" id="spModalBg">' +
        '<div class="sp-modal">' +
          '<div class="sp-modal-head"><strong>페이지 설정</strong>' +
            '<button type="button" class="sp-modal-x" data-close>×</button></div>' +
          '<div class="sp-modal-body">' +
            '<p class="sp-modal-note">아래 항목은 [배포]를 기다리지 않고 저장 즉시 반영됩니다.</p>' +

            '<label class="sp-field"><span>사이트에 보이기</span>' +
              '<select id="spmStatus">' +
                '<option value="published"' + (p.status === 'published' ? ' selected' : '') + '>보임 — 방문자가 볼 수 있음</option>' +
                '<option value="hidden"' + (p.status !== 'published' ? ' selected' : '') + '>숨김 — 주소를 알아도 볼 수 없음</option>' +
              '</select></label>' +

            '<label class="sp-field"><span>주소 (영문)</span>' +
              '<input type="text" id="spmSlug" value="' + esc(p.slug) + '" />' +
              '<small class="sp-help">/p/여기 부분입니다. 바꾸면 이전 주소로는 들어올 수 없게 되니 주의하세요.</small></label>' +

            '<label class="sp-field"><span>본문 너비</span>' +
              '<select id="spmLayout">' +
                '<option value="default"' + (p.layout === 'default' ? ' selected' : '') + '>기본 — 읽기 좋은 너비</option>' +
                '<option value="wide"' + (p.layout === 'wide' ? ' selected' : '') + '>넓게 — 사진·표가 많을 때</option>' +
                '<option value="plain"' + (p.layout === 'plain' ? ' selected' : '') + '>약관형 — 조문이 긴 문서</option>' +
              '</select></label>' +

            '<hr class="sp-hr" />' +
            '<div class="sp-modal-subhead">검색·공유 (비워두면 위 제목·설명을 씁니다)</div>' +

            '<label class="sp-field"><span>검색 결과 제목</span>' +
              '<input type="text" id="spmSeoTitle" value="' + esc(p.seoTitle || '') + '" /></label>' +
            '<label class="sp-field"><span>검색 결과 설명</span>' +
              '<textarea id="spmSeoDesc" rows="2">' + esc(p.seoDescription || '') + '</textarea></label>' +
            '<label class="sp-field"><span>공유 썸네일 주소</span>' +
              '<input type="text" id="spmOg" value="' + esc(p.ogImageUrl || '') + '" placeholder="/api/blob-image?id=..." /></label>' +
          '</div>' +
          '<div class="sp-modal-foot">' +
            '<button type="button" class="sp-btn" data-close>취소</button>' +
            '<button type="button" class="sp-btn primary" id="spmSave">저장</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);

    var bg = $('#spModalBg');
    bg.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { bg.remove(); });
    });
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });

    $('#spmSave').addEventListener('click', async function () {
      var body = {
        id: p.id,
        status: $('#spmStatus').value,
        slug: $('#spmSlug').value,
        layout: $('#spmLayout').value,
        seoTitle: $('#spmSeoTitle').value,
        seoDescription: $('#spmSeoDesc').value,
        ogImageUrl: $('#spmOg').value
      };
      var res = await api('/api/admin/site-pages?action=meta', { method: 'PATCH', body: body });
      if (!res.ok) return toast((res.data && res.data.error) || '저장에 실패했습니다');
      bg.remove();
      toast('설정이 반영되었습니다');
      openEditor(p.id);
    });
  }

  /* =========================================================
     이전 버전 되돌리기
     ========================================================= */
  async function openHistory() {
    if (!_page) return;
    var res = await api('/api/admin/site-page-revisions?pageId=' + _page.id);
    if (!res.ok) return toast((res.data && res.data.error) || '이전 버전을 불러오지 못했습니다');

    var list = unwrap(res, 'list') || [];

    var rows = list.length === 0
      ? '<p class="sp-modal-note">아직 저장된 이전 버전이 없습니다. 한 번 저장하면 이때부터 쌓입니다.</p>'
      : '<table class="sp-table"><thead><tr>' +
          '<th>저장 시각</th><th>구분</th><th>작성자</th><th style="text-align:right">글 길이</th><th></th>' +
        '</tr></thead><tbody>' +
        list.map(function (r) {
          return '<tr>' +
            '<td style="white-space:nowrap">' + fmtDate(r.savedAt) + '</td>' +
            '<td class="sp-muted">' + esc(r.note || '-') + '</td>' +
            '<td class="sp-muted">' + esc(r.savedByName || '-') + '</td>' +
            '<td style="text-align:right" class="sp-muted">' + (r.contentLength || 0).toLocaleString() + '자</td>' +
            '<td style="text-align:right">' +
              '<button type="button" class="sp-btn xs" data-rev="' + r.id + '">이 시점으로</button>' +
            '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>';

    var html = '' +
      '<div class="sp-modal-bg" id="spHistBg">' +
        '<div class="sp-modal lg">' +
          '<div class="sp-modal-head"><strong>이전 버전으로 되돌리기</strong>' +
            '<button type="button" class="sp-modal-x" data-close>×</button></div>' +
          '<div class="sp-modal-body">' +
            '<p class="sp-modal-note">저장·배포할 때마다 직전 내용이 자동으로 보관됩니다 (최근 20개). ' +
            '되돌려도 바로 사이트에 나가지 않고 <strong>임시저장</strong> 상태가 되니, 확인한 뒤 [배포]하세요.</p>' +
            rows +
          '</div>' +
          '<div class="sp-modal-foot"><button type="button" class="sp-btn" data-close>닫기</button></div>' +
        '</div>' +
      '</div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);

    var bg = $('#spHistBg');
    bg.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { bg.remove(); });
    });
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });

    bg.querySelectorAll('[data-rev]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('이 시점의 내용으로 되돌릴까요?\n\n지금 편집 중인 내용은 이전 버전으로 보관됩니다.')) return;
        var r = await api('/api/admin/site-page-revisions', {
          method: 'POST', body: { pageId: _page.id, revisionId: Number(b.getAttribute('data-rev')) }
        });
        if (!r.ok) return toast((r.data && r.data.error) || '되돌리지 못했습니다');
        bg.remove();
        toast('되돌렸습니다 — 확인 후 [배포]하세요');
        _dirty = false;
        refreshDraftBadge();
        openEditor(_page.id);
      });
    });
  }

  /* =========================================================
     스타일 (한 번만 삽입)
     ========================================================= */
  function injectStyles() {
    if (document.getElementById('spStyles')) return;
    var css = '' +
      '.sp-wrap{background:#fff;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.04)}' +
      '.sp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:18px}' +
      '.sp-h2{margin:0 0 6px;font-family:"Noto Serif KR",serif;font-size:20px}' +
      '.sp-intro{margin:0;font-size:13px;color:#6b7280;line-height:1.7;max-width:640px}' +
      '.sp-stats{display:flex;gap:18px;font-size:13px;color:#6b7280;margin-bottom:14px}' +
      '.sp-stats strong{color:#111}' +
      '.sp-table-wrap{overflow-x:auto}' +
      '.sp-table{width:100%;border-collapse:collapse;font-size:14px}' +
      '.sp-table th{text-align:left;padding:10px 12px;background:#f7f8fa;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;font-weight:600}' +
      '.sp-table td{padding:12px;border-bottom:1px solid #f0f1f3;vertical-align:middle}' +
      '.sp-name{font-weight:600}' +
      '.sp-sub{font-size:12px;color:#9ca3af;margin-top:2px}' +
      '.sp-slug{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#1f5eff;text-decoration:none}' +
      '.sp-slug:hover{text-decoration:underline}' +
      '.sp-muted{color:#9ca3af;font-size:12px}' +
      '.sp-chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600}' +
      '.sp-chip.on{background:#e7f6ec;color:#137333}' +
      '.sp-chip.off{background:#f1f3f5;color:#868e96}' +
      '.sp-chip.draft{background:#fef3c7;color:#92400e}' +
      '.sp-btn{padding:7px 13px;border:1px solid #d5d7db;background:#fff;border-radius:6px;font-size:13px;cursor:pointer;color:#374151}' +
      '.sp-btn:hover{background:#f7f8fa}' +
      '.sp-btn.primary{background:#1f5eff;border-color:#1f5eff;color:#fff}' +
      '.sp-btn.primary:hover{filter:brightness(1.07)}' +
      '.sp-btn.publish{background:linear-gradient(135deg,#7a1f2b,#a3303f);border:none;color:#fff}' +
      '.sp-btn.lg{padding:11px 18px;font-size:14px;white-space:nowrap}' +
      '.sp-btn.xs{padding:5px 10px;font-size:12px}' +
      '.sp-ico{width:24px;height:24px;border:1px solid #e5e7eb;background:#fff;border-radius:5px;cursor:pointer;color:#6b7280;font-size:12px;line-height:1;padding:0;margin-right:2px}' +
      '.sp-ico:hover:not(:disabled){background:#f1f3f5;color:#111}' +
      '.sp-ico:disabled{opacity:.3;cursor:default}' +
      '.sp-edit-top{display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid #eceef1;margin-bottom:16px;flex-wrap:wrap}' +
      '.sp-edit-title{font-weight:700;font-size:16px;flex:1}' +
      '.sp-edit-actions{display:flex;gap:6px;flex-wrap:wrap}' +
      '.sp-fields{display:grid;grid-template-columns:1fr 200px 1fr;gap:12px;margin-bottom:14px}' +
      '.sp-field{display:flex;flex-direction:column;gap:5px;font-size:13px}' +
      '.sp-field>span{font-weight:600;color:#374151}' +
      '.sp-field input,.sp-field select,.sp-field textarea{padding:9px 11px;border:1px solid #d5d7db;border-radius:6px;font-size:14px;font-family:inherit;width:100%;box-sizing:border-box}' +
      '.sp-help{font-size:11px;color:#9ca3af;font-weight:400}' +
      '.sp-insert-bar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 12px;background:#f7f8fa;border-radius:8px;margin-bottom:12px}' +
      '.sp-insert-label{font-size:12px;font-weight:700;color:#374151}' +
      '.sp-insert-hint{font-size:11px;color:#9ca3af;margin-left:4px}' +
      '.sp-edit-foot{display:flex;justify-content:space-between;margin-top:12px;font-size:12px}' +
      '.sp-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}' +
      '.sp-modal{background:#fff;border-radius:12px;width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.22)}' +
      '.sp-modal.lg{max-width:760px}' +
      '.sp-modal-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eceef1;font-size:15px}' +
      '.sp-modal-x{background:none;border:none;font-size:22px;cursor:pointer;color:#9ca3af;line-height:1}' +
      '.sp-modal-body{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}' +
      '.sp-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid #eceef1}' +
      '.sp-modal-note{font-size:12px;color:#6b7280;line-height:1.7;margin:0;background:#f7f8fa;padding:10px 12px;border-radius:6px}' +
      '.sp-modal-subhead{font-size:13px;font-weight:700;color:#374151}' +
      '.sp-hr{border:0;border-top:1px solid #eceef1;margin:2px 0}' +
      '@media(max-width:900px){.sp-fields{grid-template-columns:1fr}.sp-head{flex-direction:column}}';

    var st = document.createElement('style');
    st.id = 'spStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* 편집 중 창을 닫으려 하면 알려준다 */
  window.addEventListener('beforeunload', function (e) {
    if (_view === 'edit' && _dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  window.SIREN_SITE_PAGES = {
    render: render,
    openEditor: openEditor,
    isDirty: function () { return _view === 'edit' && _dirty; },
    cleanup: function () { destroyEditor(); }
  };
})();
