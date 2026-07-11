/* =========================================================
   온라인 추모관 운영 도구 (admin-memorial.html · cms iframe)
   ① 선생님 관리(CRUD)  ② 메시지·편지 모더레이션  ③ 추모관 설정
   ========================================================= */

var _teachers = [];
var _editingTeacherId = null;
var _modType = 'message';
var _modSort = 'report'; /* ★ R41 Q2-013: 'report'(신고순) | 'recent'(최신순·미검토) */

/* ─── 토스트 ─── */
function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.className = 'toast'; }, 3000);
}

/* ─── API 헬퍼 (iframe — 쿠키 공유) ─── */
function callApi(method, url, body) {
  var opts = { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      return { ok: r.ok && d.ok !== false, status: r.status, data: d };
    });
  });
}
function pick(res, key) {
  var d = res && res.data;
  if (!d) return undefined;
  if (d.data && d.data[key] !== undefined) return d.data[key];
  if (d[key] !== undefined) return d[key];
  return undefined;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function photoUrlOf(t) {
  if (t.photoUrl) return t.photoUrl;
  if (t.photoBlobId) return '/api/blob-image?id=' + t.photoBlobId;
  return null;
}
function fmtDate(s) {
  if (!s) return '';
  var d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  var p = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
}

/* ─── 탭 전환 ─── */
function switchTab(name) {
  ['teachers', 'moderation', 'settings'].forEach(function (t) {
    document.getElementById('panel-' + t).classList.toggle('active', t === name);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (el) {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  if (name === 'moderation') loadMod();
  if (name === 'settings') loadSettings();
}

/* =========================================================
   ① 선생님 관리
   ========================================================= */
function loadTeachers() {
  var tbody = document.getElementById('teacherTbody');
  tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">불러오는 중…</td></tr>';
  callApi('GET', '/api/admin-memorial-teachers').then(function (res) {
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">목록 로드 실패</td></tr>'; toast((res.data && res.data.error) || '목록 로드 실패', 'error'); return; }
    _teachers = pick(res, 'teachers') || [];
    renderTeacherTable();
  }).catch(function (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">목록 로드 실패</td></tr>';
    toast('목록 로드 실패: ' + e.message, 'error');
  });
}
function renderTeacherTable() {
  var tbody = document.getElementById('teacherTbody');
  if (!_teachers.length) { tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">등록된 선생님이 없습니다.</td></tr>'; return; }
  tbody.innerHTML = _teachers.map(function (t) {
    var url = photoUrlOf(t);
    var thumb = url
      ? '<img src="' + esc(url) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="no-thumb"></div>';
    var pub = t.isPublic
      ? '<span class="status-pill on">공개</span>'
      : '<span class="status-pill off">비공개</span>';
    return '<tr>' +
      '<td class="thumb-cell">' + thumb + '</td>' +
      '<td style="font-weight:600">' + esc(t.name || '') + '</td>' +
      '<td>' + esc(t.schoolRegion || '') + '</td>' +
      '<td>' + pub + '</td>' +
      '<td>' + (t.sortOrder != null ? t.sortOrder : '') + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="editTeacher(' + t.id + ')">수정</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="toggleTeacherPublic(' + t.id + ',' + (t.isPublic ? 'true' : 'false') + ')">' + (t.isPublic ? '숨김' : '공개') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteTeacher(' + t.id + ')">삭제</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

function openAddTeacher() {
  _editingTeacherId = null;
  clearTeacherForm();
  document.getElementById('teacherFormTitle').textContent = '선생님 추가';
  document.getElementById('teacherForm').style.display = '';
  document.getElementById('teacherForm').scrollIntoView({ behavior: 'smooth' });
}
function editTeacher(id) {
  var t = _teachers.filter(function (x) { return x.id === id; })[0];
  if (!t) { toast('정보를 찾을 수 없습니다.', 'error'); return; }
  _editingTeacherId = id;
  clearTeacherForm();
  document.getElementById('fId').value = id;
  document.getElementById('fName').value = t.name || '';
  document.getElementById('fSchoolRegion').value = t.schoolRegion || '';
  document.getElementById('fBirthDate').value = (t.birthDate || '').slice(0, 10);
  document.getElementById('fDeathDate').value = (t.deathDate || '').slice(0, 10);
  document.getElementById('fTributeLine').value = t.tributeLine || '';
  document.getElementById('fBioHtml').value = t.bioHtml || '';
  document.getElementById('fSortOrder').value = t.sortOrder != null ? t.sortOrder : 0;
  document.getElementById('fIsPublic').value = t.isPublic ? 'true' : 'false';
  document.getElementById('fPhotoBlobId').value = t.photoBlobId || '';
  setPhotoPreview(photoUrlOf(t));

  (Array.isArray(t.timeline) ? t.timeline : []).forEach(function (e) { addTimelineRow(e); });

  document.getElementById('teacherFormTitle').textContent = '선생님 수정';
  document.getElementById('teacherForm').style.display = '';
  document.getElementById('teacherForm').scrollIntoView({ behavior: 'smooth' });
}
function closeTeacherForm() {
  document.getElementById('teacherForm').style.display = 'none';
  clearTeacherForm();
  _editingTeacherId = null;
}
function clearTeacherForm() {
  ['fId', 'fName', 'fSchoolRegion', 'fBirthDate', 'fDeathDate', 'fTributeLine', 'fBioHtml', 'fPhotoBlobId'].forEach(function (id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('fSortOrder').value = 0;
  document.getElementById('fIsPublic').value = 'true';
  document.getElementById('fPhotoFile').value = '';
  document.getElementById('timelineRows').innerHTML = '';
  setPhotoPreview(null);
}
function setPhotoPreview(url) {
  var wrap = document.getElementById('photoPreviewWrap');
  wrap.innerHTML = url
    ? '<img class="photo-preview" src="' + esc(url) + '" alt="" onerror="this.outerHTML=\'<div class=&quot;photo-preview-empty&quot;></div>\'">'
    : '<div class="photo-preview-empty"></div>';
}

/* 영정 업로드 */
function uploadPhoto() {
  var input = document.getElementById('fPhotoFile');
  var file = input.files && input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'memorial_teacher');
  fd.append('isPublic', 'true');
  toast('업로드 중…');
  fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok !== false, status: r.status, data: d }; }); })
    .then(function (res) {
      if (!res.ok) { toast((res.data && (res.data.error || res.data.message)) || '업로드 실패', 'error'); return; }
      var id = (res.data && res.data.data && res.data.data.id) || (res.data && res.data.id) || (res.data && res.data.blobId);
      if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
      document.getElementById('fPhotoBlobId').value = id;
      setPhotoPreview('/api/blob-image?id=' + id);
      toast('영정 사진이 업로드되었습니다.', 'success');
    }).catch(function (e) { toast('업로드 실패: ' + e.message, 'error'); });
}

/* 타임라인 행 */
function addTimelineRow(data) {
  data = data || {};
  var row = document.createElement('div');
  row.className = 'dyn-row';
  row.innerHTML =
    '<input type="text" class="tl-date" placeholder="날짜" value="' + esc(data.date || '') + '">' +
    '<input type="text" class="tl-title" placeholder="제목" value="' + esc(data.title || '') + '">' +
    '<input type="text" class="tl-desc" placeholder="설명(선택)" value="' + esc(data.desc || '') + '">' +
    '<button type="button" class="dyn-del" title="삭제">×</button>';
  row.querySelector('.dyn-del').addEventListener('click', function () { row.remove(); });
  document.getElementById('timelineRows').appendChild(row);
}
function collectTimeline() {
  var rows = document.querySelectorAll('#timelineRows .dyn-row');
  var out = [];
  Array.prototype.forEach.call(rows, function (r) {
    var date = r.querySelector('.tl-date').value.trim();
    var title = r.querySelector('.tl-title').value.trim();
    var desc = r.querySelector('.tl-desc').value.trim();
    if (date || title || desc) out.push({ date: date, title: title, desc: desc });
  });
  return out;
}

function saveTeacher() {
  var name = document.getElementById('fName').value.trim();
  if (!name) { toast('성함을 입력하세요.', 'error'); return; }
  var blobId = document.getElementById('fPhotoBlobId').value;
  var payload = {
    name: name,
    schoolRegion: document.getElementById('fSchoolRegion').value.trim() || null,
    birthDate: document.getElementById('fBirthDate').value || null,
    deathDate: document.getElementById('fDeathDate').value || null,
    tributeLine: document.getElementById('fTributeLine').value.trim() || null,
    bioHtml: document.getElementById('fBioHtml').value.trim() || null,
    timeline: collectTimeline(),
    photoBlobId: blobId ? parseInt(blobId, 10) : null,
    sortOrder: parseInt(document.getElementById('fSortOrder').value, 10) || 0,
    isPublic: document.getElementById('fIsPublic').value === 'true'
  };
  var method = _editingTeacherId ? 'PATCH' : 'POST';
  var url = '/api/admin-memorial-teachers' + (_editingTeacherId ? '?id=' + _editingTeacherId : '');
  callApi(method, url, payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast('저장되었습니다.', 'success');
    closeTeacherForm();
    loadTeachers();
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}
function toggleTeacherPublic(id, current) {
  callApi('PATCH', '/api/admin-memorial-teachers?id=' + id, { isPublic: !current }).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '변경 실패', 'error'); return; }
    toast(current ? '숨김 처리했습니다.' : '공개 처리했습니다.', 'success');
    loadTeachers();
  }).catch(function (e) { toast('변경 실패: ' + e.message, 'error'); });
}
function deleteTeacher(id) {
  var t = _teachers.filter(function (x) { return x.id === id; })[0];
  var nm = t ? '"' + (t.name || '이 선생님') + '"' : '이 선생님';
  if (!confirm(nm + ' 정보를 삭제할까요? 헌화·메시지·편지도 함께 정리됩니다.')) return;
  callApi('DELETE', '/api/admin-memorial-teachers?id=' + id).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
    toast('삭제되었습니다.', 'success');
    loadTeachers();
  }).catch(function (e) { toast('삭제 실패: ' + e.message, 'error'); });
}

/* =========================================================
   ② 모더레이션
   ========================================================= */
function switchModType(type) {
  _modType = type;
  Array.prototype.forEach.call(document.querySelectorAll('.mod-filter .chip[data-type]'), function (el) {
    el.classList.toggle('active', el.dataset.type === type);
  });
  loadMod();
}
/* ★ R41 Q2-013: 신고순 최신순(미검토) 전환 */
function switchModSort(sort) {
  _modSort = sort;
  Array.prototype.forEach.call(document.querySelectorAll('.mod-filter .chip[data-sort]'), function (el) {
    el.classList.toggle('active', el.dataset.sort === sort);
  });
  loadMod();
}
function loadMod() {
  var tbody = document.getElementById('modTbody');
  tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">불러오는 중…</td></tr>';
  var qs = '/api/admin-memorial-moderation?type=' + _modType + (_modSort === 'recent' ? '&sort=recent' : '');
  callApi('GET', qs).then(function (res) {
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">로드 실패</td></tr>'; toast((res.data && res.data.error) || '로드 실패', 'error'); return; }
    var items = pick(res, 'items') || [];
    renderMod(items);
  }).catch(function (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">로드 실패</td></tr>';
    toast('로드 실패: ' + e.message, 'error');
  });
}
function renderMod(items) {
  var tbody = document.getElementById('modTbody');
  if (!items.length) { tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">표시할 항목이 없습니다.</td></tr>'; return; }
  tbody.innerHTML = items.map(function (it) {
    var rc = Number(it.reportCount) || 0;
    var badge = '<span class="report-badge' + (rc ? '' : ' zero') + '">신고 ' + rc + '</span>';
    var status = it.isHidden ? '<span class="status-pill off">숨김</span>' : '<span class="status-pill on">노출</span>';
    var text = (it.title ? '【' + esc(it.title) + '】 ' : '') + esc(it.content || '');
    return '<tr>' +
      '<td>' + esc(it.authorName || '익명') + '</td>' +
      '<td><div class="mod-content' + (it.isHidden ? ' hidden-row' : '') + '">' + text + '</div></td>' +
      '<td>' + badge + '</td>' +
      '<td>' + status + '</td>' +
      '<td style="white-space:nowrap">' + fmtDate(it.createdAt) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="toggleHide(' + it.id + ',' + (it.isHidden ? 'true' : 'false') + ')">' + (it.isHidden ? '노출' : '숨김') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteModItem(' + it.id + ')">삭제</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}
function toggleHide(id, current) {
  callApi('PATCH', '/api/admin-memorial-moderation?type=' + _modType + '&id=' + id, { isHidden: !current }).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '변경 실패', 'error'); return; }
    toast(current ? '다시 노출했습니다.' : '숨김 처리했습니다.', 'success');
    loadMod();
  }).catch(function (e) { toast('변경 실패: ' + e.message, 'error'); });
}
function deleteModItem(id) {
  if (!confirm('이 글을 영구 삭제할까요? 복구할 수 없습니다.')) return;
  callApi('DELETE', '/api/admin-memorial-moderation?type=' + _modType + '&id=' + id).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
    toast('삭제되었습니다.', 'success');
    loadMod();
  }).catch(function (e) { toast('삭제 실패: ' + e.message, 'error'); });
}

/* =========================================================
   ③ 추모관 설정
   ========================================================= */
function loadSettings() {
  callApi('GET', '/api/admin-memorial-settings').then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '설정 로드 실패', 'error'); return; }
    var s = pick(res, 'settings') || {};
    document.getElementById('sHeroYoutubeId').value = s.heroYoutubeId || '';
    document.getElementById('sHeroCopy').value = s.heroCopy || '';
    var rows = document.getElementById('bgmRows');
    rows.innerHTML = '';
    var tracks = Array.isArray(s.bgmTracks) ? s.bgmTracks : [];
    tracks.forEach(function (t) { addBgmRow(t); });
  }).catch(function (e) { toast('설정 로드 실패: ' + e.message, 'error'); });
}
function addBgmRow(data) {
  data = data || {};
  var row = document.createElement('div');
  row.className = 'dyn-row bgm';
  row.innerHTML =
    '<input type="text" class="bgm-title" placeholder="곡 제목" value="' + esc(data.title || '') + '">' +
    '<input type="text" class="bgm-url" placeholder="/assets/audio/memorial-1.mp3" value="' + esc(data.url || '') + '">' +
    '<button type="button" class="dyn-del" title="삭제">×</button>';
  row.querySelector('.dyn-del').addEventListener('click', function () { row.remove(); });
  document.getElementById('bgmRows').appendChild(row);
}
function collectBgm() {
  var rows = document.querySelectorAll('#bgmRows .dyn-row');
  var out = [];
  Array.prototype.forEach.call(rows, function (r) {
    var title = r.querySelector('.bgm-title').value.trim();
    var url = r.querySelector('.bgm-url').value.trim();
    if (url) out.push({ title: title || '추모 음악', url: url });
  });
  return out;
}
function saveSettings() {
  var payload = {
    heroYoutubeId: document.getElementById('sHeroYoutubeId').value.trim() || null,
    heroCopy: document.getElementById('sHeroCopy').value.trim() || null,
    bgmTracks: collectBgm()
  };
  callApi('PATCH', '/api/admin-memorial-settings', payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast('설정이 저장되었습니다.', 'success');
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}

/* ─── 초기화 ─── */
loadTeachers();
