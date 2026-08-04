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
  ['teachers', 'moderation', 'spotlight', 'settings'].forEach(function (t) {
    var el = document.getElementById('panel-' + t);
    if (el) el.classList.toggle('active', t === name);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (el) {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  if (name === 'moderation') loadMod();
  if (name === 'settings') loadSettings();
  if (name === 'spotlight') loadSpots();
}

/* =========================================================
   ★ 2026-08-04: 이달에 기억할 선생님
   생신·기일처럼 특별한 날을 맞은 선생님을 그달에 추모관에 소개한다.
   날짜의 '월'만 보므로 한 번 등록하면 해마다 그달에 자동으로 나타난다.
   ========================================================= */
var SPOT_OCCASION = { birth: '생신', death: '기일', other: '기억하는 날' };
var _spots = [];

function loadSpots() {
  var tb = document.getElementById('spotTbody');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="7" class="tbl-empty">불러오는 중…</td></tr>';

  callApi('GET', '/api/admin-memorial-spotlights').then(function (res) {
    if (!res.ok) {
      tb.innerHTML = '<tr><td colspan="7" class="tbl-empty">불러오지 못했습니다</td></tr>';
      return;
    }
    var d = (res.data && res.data.data) || res.data || {};
    _spots = d.items || [];

    /* 코너 문구 */
    var t = document.getElementById('spTitle');
    if (t) t.value = d.title || '';
    var ds = document.getElementById('spDesc');
    if (ds) ds.value = d.desc || '';

    /* 선생님 후보 */
    var sel = document.getElementById('spfTeacherId');
    if (sel) {
      sel.innerHTML = '<option value="">연결하지 않음 (성함 직접 입력)</option>' +
        (d.teachers || []).map(function (x) {
          return '<option value="' + x.id + '">' + esc(x.name) + '</option>';
        }).join('');
    }

    if (d.ready === false) {
      tb.innerHTML = '<tr><td colspan="7" class="tbl-empty">저장소 준비가 아직 끝나지 않았습니다. ' +
        '관리자 주소창에 <code>/api/migrate-memorial-spotlight?run=1</code> 을 한 번 실행해 주세요.</td></tr>';
      return;
    }

    if (_spots.length === 0) {
      tb.innerHTML = '<tr><td colspan="7" class="tbl-empty">등록된 항목이 없습니다. [+ 항목 추가]로 만들어 보세요.</td></tr>';
      return;
    }

    tb.innerHTML = _spots.map(function (s) {
      var photo = s.photoUrl
        ? '<img src="' + esc(s.photoUrl) + '" alt="">'
        : '<div class="no-thumb"><span class="siren-icon-wrap" data-icon="user"></span></div>';
      var md = s.occasionDate ? (Number(s.occasionDate.slice(5, 7)) + '월 ' + Number(s.occasionDate.slice(8, 10)) + '일') : '-';
      var msg = (s.familyMessage || '').replace(/\s+/g, ' ').slice(0, 30);
      return '<tr>' +
        '<td class="thumb-cell">' + photo + '</td>' +
        '<td><b>' + esc(s.displayName) + '</b></td>' +
        '<td style="white-space:nowrap">' + md + '</td>' +
        '<td>' + (SPOT_OCCASION[s.occasion] || '기억하는 날') + '</td>' +
        '<td class="mod-content">' + esc(msg) + (msg.length >= 30 ? '…' : '') + '</td>' +
        '<td><span class="status-pill ' + (s.isActive ? 'on' : 'off') + '">' + (s.isActive ? '공개' : '숨김') + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-ghost btn-sm" onclick="editSpot(' + s.id + ')">수정</button>' +
          '<button class="btn btn-danger btn-sm" onclick="removeSpot(' + s.id + ')">삭제</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    if (window.Icons && window.Icons.hydrate) { try { window.Icons.hydrate(tb); } catch (_) {} }
  });
}

function saveSpotText() {
  callApi('PATCH', '/api/admin-memorial-spotlights?action=text', {
      title: document.getElementById('spTitle').value,
      desc: document.getElementById('spDesc').value
    }).then(function (res) {
    toast(res.ok ? '코너 문구가 저장되었습니다.' : '저장 실패', res.ok ? 'success' : 'error');
  });
}

function setSpotPhotoPreview(url) {
  var wrap = document.getElementById('spPhotoWrap');
  if (!wrap) return;
  wrap.innerHTML = url
    ? '<img class="photo-preview" src="' + esc(url) + '" alt="">'
    : '<div class="photo-preview-empty"><span class="siren-icon-wrap" data-icon="user"></span></div>';
}

function uploadSpotPhoto() {
  var input = document.getElementById('spfPhotoFile');
  var file = input.files && input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'memorial_spotlight');
  fd.append('isPublic', 'true');
  toast('업로드 중…');
  fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; }); })
    .then(function (res) {
      if (!res.ok) { toast((res.data && (res.data.error || res.data.message)) || '업로드 실패', 'error'); return; }
      var id = (res.data && res.data.data && res.data.data.id) || (res.data && res.data.id) || (res.data && res.data.blobId);
      if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
      document.getElementById('spfPhotoBlobId').value = id;
      setSpotPhotoPreview('/api/blob-image?id=' + id);
      toast('사진이 업로드되었습니다.', 'success');
    }).catch(function (e) { toast('업로드 실패: ' + e.message, 'error'); });
}

/* 선생님을 고르면 성함을 자동으로 채워준다 (비어 있을 때만) */
function onSpotTeacherPick() {
  var sel = document.getElementById('spfTeacherId');
  var nameEl = document.getElementById('spfDisplayName');
  if (!sel || !nameEl || nameEl.value.trim()) return;
  var opt = sel.options[sel.selectedIndex];
  if (opt && opt.value) nameEl.value = opt.textContent;
}

function openAddSpot() {
  document.getElementById('spotFormTitle').textContent = '항목 추가';
  document.getElementById('spfId').value = '';
  document.getElementById('spfTeacherId').value = '';
  document.getElementById('spfDisplayName').value = '';
  document.getElementById('spfOccasionDate').value = '';
  document.getElementById('spfOccasion').value = 'other';
  document.getElementById('spfFamilyMessage').value = '';
  document.getElementById('spfFamilyName').value = '';
  document.getElementById('spfSortOrder').value = '0';
  document.getElementById('spfIsActive').checked = true;
  document.getElementById('spfPhotoBlobId').value = '';
  setSpotPhotoPreview('');
  document.getElementById('spotForm').style.display = '';
  document.getElementById('spotForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editSpot(id) {
  var s = null;
  for (var i = 0; i < _spots.length; i++) if (Number(_spots[i].id) === Number(id)) s = _spots[i];
  if (!s) return;

  document.getElementById('spotFormTitle').textContent = '항목 수정 — ' + s.displayName;
  document.getElementById('spfId').value = s.id;
  document.getElementById('spfTeacherId').value = s.teacherId || '';
  document.getElementById('spfDisplayName').value = s.displayName || '';
  document.getElementById('spfOccasionDate').value = s.occasionDate || '';
  document.getElementById('spfOccasion').value = s.occasion || 'other';
  document.getElementById('spfFamilyMessage').value = s.familyMessage || '';
  document.getElementById('spfFamilyName').value = s.familyName || '';
  document.getElementById('spfSortOrder').value = s.sortOrder || 0;
  document.getElementById('spfIsActive').checked = s.isActive !== false;
  document.getElementById('spfPhotoBlobId').value = s.photoBlobId || '';
  setSpotPhotoPreview(s.photoUrl || '');
  document.getElementById('spotForm').style.display = '';
  document.getElementById('spotForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeSpotForm() {
  document.getElementById('spotForm').style.display = 'none';
}

function saveSpot() {
  var id = document.getElementById('spfId').value;
  var body = {
    teacherId: document.getElementById('spfTeacherId').value || null,
    displayName: document.getElementById('spfDisplayName').value.trim(),
    occasion: document.getElementById('spfOccasion').value,
    occasionDate: document.getElementById('spfOccasionDate').value || null,
    photoBlobId: document.getElementById('spfPhotoBlobId').value || null,
    familyMessage: document.getElementById('spfFamilyMessage').value,
    familyName: document.getElementById('spfFamilyName').value.trim(),
    isActive: document.getElementById('spfIsActive').checked,
    sortOrder: Number(document.getElementById('spfSortOrder').value) || 0
  };
  if (!body.displayName) { toast('화면에 보일 성함을 입력해주세요.', 'error'); return; }
  if (!body.occasionDate) { toast('기억할 날짜를 입력해주세요.', 'error'); return; }

  if (id) body.id = Number(id);

  callApi(id ? 'PATCH' : 'POST', '/api/admin-memorial-spotlights', body)
    .then(function (res) {
      if (!res.ok) {
        toast((res.data && (res.data.error || res.data.message)) || '저장 실패', 'error');
        return;
      }
      toast(id ? '저장되었습니다.' : '등록되었습니다.', 'success');
      closeSpotForm();
      loadSpots();
    });
}

function removeSpot(id) {
  if (!confirm('이 항목을 삭제할까요?')) return;
  callApi('DELETE', '/api/admin-memorial-spotlights?id=' + id).then(function (res) {
    toast(res.ok ? '삭제되었습니다.' : '삭제 실패', res.ok ? 'success' : 'error');
    if (res.ok) loadSpots();
  });
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
    /* 2026-08-04: 선생님 페이지 표시 설정 */
    var bioEl = document.getElementById('sBioLabel');
    if (bioEl) bioEl.value = s.bioLabel || '';
    var tlEl = document.getElementById('sTimelineLabel');
    if (tlEl) tlEl.value = s.timelineLabel || '';
    var offEl = document.getElementById('sShowTeacherOffering');
    if (offEl) offEl.checked = s.showTeacherOffering !== false;
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
    bgmTracks: collectBgm(),
    /* 2026-08-04: 선생님 페이지 표시 설정 (비우면 서버가 기본 문구를 쓴다) */
    bioLabel: (document.getElementById('sBioLabel') || {}).value || '',
    timelineLabel: (document.getElementById('sTimelineLabel') || {}).value || '',
    showTeacherOffering: !!(document.getElementById('sShowTeacherOffering') || {}).checked
  };
  callApi('PATCH', '/api/admin-memorial-settings', payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast('설정이 저장되었습니다.', 'success');
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}

/* ─── 초기화 ─── */
loadTeachers();
