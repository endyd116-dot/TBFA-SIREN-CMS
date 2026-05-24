/* ---- 유가족 이야기 운영자 도구 ---- */

var _stories = [];
var _editingId = null;

/* ─── 토스트 ─── */
function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.className = 'toast'; }, 3000);
}

/* ─── API 헬퍼 (iframe 내부 — 쿠키 공유됨) ─── */
function callApi(method, url, body) {
  var opts = {
    method: method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; });
  });
}

/* ─── 목록 로드 ─── */
function loadList() {
  var tbody = document.getElementById('storyTbody');
  tbody.innerHTML = '<tr><td colspan="7" class="tbl-empty">불러오는 중…</td></tr>';

  callApi('GET', '/api/admin-family-stories').then(function(res) {
    if (!res.ok) { toast(res.data && res.data.error || '목록 로드 실패', 'error'); return; }
    var stories = (res.data && res.data.data && res.data.data.stories) ||
                  (res.data && res.data.stories) || [];
    _stories = stories;
    renderTable(stories);
  }).catch(function(e) {
    toast('목록 로드 실패: ' + e.message, 'error');
  });
}

var CAT_LABELS = {voice:'목소리',intro:'소개',tribute:'헌정',interview:'인터뷰'};

function renderTable(stories) {
  var tbody = document.getElementById('storyTbody');
  if (!stories.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="tbl-empty">등록된 영상이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = stories.map(function(s) {
    var thumbHtml = s.thumbnailUrl
      ? '<img src="' + s.thumbnailUrl + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="no-thumb">없음</div>';
    var statusPill = '<span class="status-pill ' + (s.status || 'draft') + '">' +
      (s.status === 'published' ? '발행' : '초안') + '</span>';
    return '<tr>' +
      '<td class="thumb-cell">' + thumbHtml + '</td>' +
      '<td style="max-width:260px;word-break:break-word">' + (s.title || '') + '</td>' +
      '<td>' + statusPill + '</td>' +
      '<td>' + (CAT_LABELS[s.category] || s.category || '') + '</td>' +
      '<td>' + (s.sortOrder !== undefined ? s.sortOrder : '') + '</td>' +
      '<td>' + (s.viewCount || 0) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="editStory(' + s.id + ')">수정</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="togglePublish(' + s.id + ', \'' + s.status + '\')">' +
          (s.status === 'published' ? '숨김' : '발행') +
        '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteStory(' + s.id + ')">삭제</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

/* ─── 폼 열기/닫기 ─── */
function openAddForm() {
  _editingId = null;
  clearForm();
  document.getElementById('formTitle').textContent = '영상 추가';
  document.getElementById('formPanel').style.display = '';
  document.getElementById('formPanel').scrollIntoView({ behavior: 'smooth' });
}

function editStory(id) {
  var s = _stories.filter(function(x) { return x.id === id; })[0];
  if (!s) { toast('영상 정보를 찾을 수 없습니다.', 'error'); return; }
  _editingId = id;
  document.getElementById('fId').value = id;
  document.getElementById('fYoutubeUrl').value = s.youtubeUrl || '';
  document.getElementById('fTitle').value = s.title || '';
  document.getElementById('fSubtitle').value = s.subtitle || '';
  document.getElementById('fSummary').value = s.summary || '';
  document.getElementById('fAdminNotes').value = s.adminNotes || '';
  document.getElementById('fDetailHtml').value = s.detailHtml || '';
  document.getElementById('fCategory').value = s.category || 'voice';
  document.getElementById('fSortOrder').value = s.sortOrder !== undefined ? s.sortOrder : 0;
  document.getElementById('fStatus').value = s.status || 'draft';

  if (s.thumbnailUrl) {
    document.getElementById('ytPreviewImg').src = s.thumbnailUrl;
    document.getElementById('ytPreviewInfo').textContent = '저장된 썸네일';
    document.getElementById('ytPreview').style.display = 'flex';
  } else {
    document.getElementById('ytPreview').style.display = 'none';
  }

  document.getElementById('formTitle').textContent = '영상 수정';
  document.getElementById('formPanel').style.display = '';
  document.getElementById('formPanel').scrollIntoView({ behavior: 'smooth' });
}

function closeForm() {
  document.getElementById('formPanel').style.display = 'none';
  clearForm();
  _editingId = null;
}

function clearForm() {
  ['fId','fYoutubeUrl','fTitle','fSubtitle','fSummary','fAdminNotes','fDetailHtml'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('fCategory').value = 'voice';
  document.getElementById('fSortOrder').value = 0;
  document.getElementById('fStatus').value = 'draft';
  document.getElementById('ytPreview').style.display = 'none';
  document.getElementById('aiNote').textContent = '';
}

/* ─── 유튜브 정보 가져오기 ─── */
function fetchYtInfo() {
  var url = document.getElementById('fYoutubeUrl').value.trim();
  if (!url) { toast('유튜브 URL을 입력하세요.', 'error'); return; }

  var btn = document.getElementById('btnFetchYt');
  btn.disabled = true;
  btn.textContent = '가져오는 중…';

  callApi('GET', '/api/admin-family-stories?ytOembed=' + encodeURIComponent(url))
    .then(function(res) {
      btn.disabled = false;
      btn.textContent = '정보 가져오기';
      var info = (res.data && res.data.data && res.data.data.oembed) ||
                 (res.data && res.data.oembed) || null;
      if (!info) {
        toast('유튜브 정보를 가져올 수 없습니다. 서버 연동 전 수동 입력을 이용해 주세요.', 'error');
        return;
      }
      if (info.title && !document.getElementById('fTitle').value) {
        document.getElementById('fTitle').value = info.title;
      }
      if (info.thumbnailUrl) {
        document.getElementById('ytPreviewImg').src = info.thumbnailUrl;
        document.getElementById('ytPreviewInfo').textContent = info.title || '';
        document.getElementById('ytPreview').style.display = 'flex';
      }
      toast('정보를 가져왔습니다.', 'success');
    }).catch(function(e) {
      btn.disabled = false;
      btn.textContent = '정보 가져오기';
      toast('가져오기 실패: ' + e.message, 'error');
    });
}

/* ─── AI 초안 생성 ─── */
function requestAiDraft() {
  var youtubeUrl = document.getElementById('fYoutubeUrl').value.trim();
  var title = document.getElementById('fTitle').value.trim();
  var adminNotes = document.getElementById('fAdminNotes').value.trim();

  if (!title && !youtubeUrl) {
    toast('제목 또는 유튜브 URL을 먼저 입력하세요.', 'error');
    return;
  }

  var btn = document.getElementById('btnAiDraft');
  var note = document.getElementById('aiNote');
  btn.disabled = true;
  btn.textContent = '⏳ 생성 중…';
  note.textContent = '';

  callApi('POST', '/api/admin-family-story-ai', {
    youtubeUrl: youtubeUrl || null,
    title: title || null,
    adminNotes: adminNotes || null
  }).then(function(res) {
    btn.disabled = false;
    btn.textContent = '✨ AI 초안 생성';
    if (!res.ok) {
      toast((res.data && res.data.error) || 'AI 초안 생성 실패', 'error');
      note.textContent = 'AI 호출 실패 — 직접 입력해 주세요.';
      return;
    }
    var draft = (res.data && res.data.data && res.data.data.draft) ||
                (res.data && res.data.draft) || {};
    if (draft.subtitle) document.getElementById('fSubtitle').value = draft.subtitle;
    if (draft.summary)  document.getElementById('fSummary').value  = draft.summary;
    if (draft.detailHtml) document.getElementById('fDetailHtml').value = draft.detailHtml;
    note.textContent = '초안이 채워졌습니다. 검수 후 저장하세요.';
    toast('AI 초안이 생성되었습니다.', 'success');
  }).catch(function(e) {
    btn.disabled = false;
    btn.textContent = '✨ AI 초안 생성';
    toast('AI 초안 실패: ' + e.message, 'error');
    document.getElementById('aiNote').textContent = 'AI 호출 실패 — 직접 입력해 주세요.';
  });
}

/* ─── 저장 ─── */
function saveStory() {
  var title = document.getElementById('fTitle').value.trim();
  if (!title) { toast('제목을 입력하세요.', 'error'); return; }

  var payload = {
    youtubeUrl:  document.getElementById('fYoutubeUrl').value.trim() || null,
    title:       title,
    subtitle:    document.getElementById('fSubtitle').value.trim() || null,
    summary:     document.getElementById('fSummary').value.trim() || null,
    adminNotes:  document.getElementById('fAdminNotes').value.trim() || null,
    detailHtml:  document.getElementById('fDetailHtml').value.trim() || null,
    category:    document.getElementById('fCategory').value,
    sortOrder:   parseInt(document.getElementById('fSortOrder').value, 10) || 0,
    status:      document.getElementById('fStatus').value
  };

  var method = _editingId ? 'PATCH' : 'POST';
  var url = '/api/admin-family-stories' + (_editingId ? '?id=' + _editingId : '');

  callApi(method, url, payload).then(function(res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast('저장되었습니다.', 'success');
    closeForm();
    loadList();
  }).catch(function(e) {
    toast('저장 실패: ' + e.message, 'error');
  });
}

/* ─── 발행 토글 ─── */
function togglePublish(id, currentStatus) {
  var newStatus = currentStatus === 'published' ? 'draft' : 'published';
  callApi('PATCH', '/api/admin-family-stories?id=' + id, { status: newStatus })
    .then(function(res) {
      if (!res.ok) { toast((res.data && res.data.error) || '변경 실패', 'error'); return; }
      toast(newStatus === 'published' ? '발행 처리했습니다.' : '숨김 처리했습니다.', 'success');
      loadList();
    }).catch(function(e) { toast('변경 실패: ' + e.message, 'error'); });
}

/* ─── 삭제 ─── */
function deleteStory(id) {
  var s = _stories.filter(function(x) { return x.id === id; })[0];
  var name = s ? '"' + (s.title || '이 영상') + '"' : '이 영상';
  if (!confirm(name + '을(를) 삭제할까요? 복구할 수 없습니다.')) return;

  callApi('DELETE', '/api/admin-family-stories?id=' + id)
    .then(function(res) {
      if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
      toast('삭제되었습니다.', 'success');
      loadList();
    }).catch(function(e) { toast('삭제 실패: ' + e.message, 'error'); });
}

/* ─── 초기화 ─── */
loadList();
