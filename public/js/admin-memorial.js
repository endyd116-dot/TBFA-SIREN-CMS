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
  ['teachers', 'moderation', 'spotlight', 'family', 'settings'].forEach(function (t) {
    var el = document.getElementById('panel-' + t);
    if (el) el.classList.toggle('active', t === name);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (el) {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  if (name === 'moderation') loadMod();
  if (name === 'settings') loadSettings();
  if (name === 'spotlight') loadSpots();
  if (name === 'family') loadFamilyNotes();
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

  /* ★ 2026-08-28 — 이 선생님 화면에서만 쓰는 문구 */
  var pc = (t.pageCopy && typeof t.pageCopy === 'object') ? t.pageCopy : {};
  document.getElementById('fLeadLine').value = pc.leadLine || '';
  document.getElementById('fPortraitCaption').value = pc.portraitCaption || '';
  document.getElementById('fPhotoTitle').value = pc.photoTitle || '';
  document.getElementById('fPhotoDesc').value = pc.photoDesc || '';

  document.getElementById('teacherFormTitle').textContent = '선생님 수정';
  /* ★ 2026-08-28: 이 선생님의 생전 사진 관리도 함께 켠다
     (사진 기능이 없어도 편집 자체는 되어야 하므로 감싸 둔다) */
  try { tpOpenFor(id); } catch (e) { console.warn('[사진 관리]', e); }
  document.getElementById('teacherForm').style.display = '';
  document.getElementById('teacherForm').scrollIntoView({ behavior: 'smooth' });
}
function closeTeacherForm() {
  document.getElementById('teacherForm').style.display = 'none';
  clearTeacherForm();
  _editingTeacherId = null;
  try { tpOpenFor(0); } catch (e) {}
}
function clearTeacherForm() {
  ['fId', 'fName', 'fSchoolRegion', 'fBirthDate', 'fDeathDate', 'fTributeLine', 'fBioHtml', 'fPhotoBlobId',
   'fLeadLine', 'fPortraitCaption', 'fPhotoTitle', 'fPhotoDesc'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fSortOrder').value = 0;
  document.getElementById('fIsPublic').value = 'true';
  document.getElementById('fPhotoFile').value = '';
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

/* 이 선생님 화면에서만 쓰는 문구를 모은다.
   기존에 저장돼 있던 다른 문구(사진 구간 제목 등)는 그대로 지킨다. */
function collectPageCopy() {
  var t = _editingTeacherId
    ? (_teachers || []).filter(function (x) { return x.id === _editingTeacherId; })[0]
    : null;
  var base = (t && t.pageCopy && typeof t.pageCopy === 'object') ? t.pageCopy : {};
  var out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });

  [['fLeadLine', 'leadLine'],
   ['fPortraitCaption', 'portraitCaption'],
   ['fPhotoTitle', 'photoTitle'],
   ['fPhotoDesc', 'photoDesc']].forEach(function (pair) {
    var v = ((document.getElementById(pair[0]) || {}).value || '').trim();
    if (v) out[pair[1]] = v; else delete out[pair[1]];
  });

  return Object.keys(out).length ? out : null;
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
    pageCopy: collectPageCopy(),
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
    /* ★ 2026-08-28 추모관 v2 — 밤·여명·아침 문구 채우기 */
    try { fillHallCopy(s.hallCopy); } catch (e) { /* 아래에서 정의됨 */ }
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
    showTeacherOffering: !!(document.getElementById('sShowTeacherOffering') || {}).checked,
    /* ★ 2026-08-28 추모관 v2 — 밤·여명·아침 구간 문구 */
    hallCopy: collectHallCopy()
  };
  callApi('PATCH', '/api/admin-memorial-settings', payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast('설정이 저장되었습니다.', 'success');
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}

/* ─── 초기화 ─── */
loadTeachers();

/* =========================================================
   ★ 2026-08-28 추모관 v2 — 밤·아침 문구 + 유가족 근황
   ========================================================= */

/* ─── 밤·여명·아침 문구 ─── */
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; }

function collectHallCopy() {
  var c = {
    night:   { greet: val('sNightGreet'), title: val('sNightTitle'), sub: val('sNightSub') },
    dawn:    { line:  val('sDawnLine'),   sub:   val('sDawnSub') },
    morning: { greet: val('sMornGreet'),  title: val('sMornTitle'), sub: val('sMornSub') },
    /* ★ 2026-08-28 — 선생님 화면 구간 문구 (모든 선생님 공통) */
    teacher: collectTeacherCopy()
  };
  /* 세 구간 모두 비어 있으면 아예 안 보낸다 — 서버가 기본 문구를 쓴다 */
  var any = false;
  Object.keys(c).forEach(function (k) {
    Object.keys(c[k]).forEach(function (f) { if (c[k][f]) any = true; });
  });
  return any ? c : null;
}

function fillHallCopy(hall) {
  if (!hall || typeof hall !== 'object') return;
  setVal('sNightGreet', hall.night && hall.night.greet);
  setVal('sNightTitle', hall.night && hall.night.title);
  setVal('sNightSub',   hall.night && hall.night.sub);
  setVal('sDawnLine',   hall.dawn && hall.dawn.line);
  setVal('sDawnSub',    hall.dawn && hall.dawn.sub);
  setVal('sMornGreet',  hall.morning && hall.morning.greet);
  setVal('sMornTitle',  hall.morning && hall.morning.title);
  setVal('sMornSub',    hall.morning && hall.morning.sub);
  fillTeacherCopy(hall.teacher);
}

/* 선생님 화면 문구 — 화면의 자리 이름과 입력란을 1:1로 짝지어 둔다 */
var TEACHER_COPY_FIELDS = [
  ['stLeadLine', 'leadLine'],
  ['stPortraitCaption', 'portraitCaption'],
  ['stPhotoTag', 'photoTag'],
  ['stPhotoTitle', 'photoTitle'],
  ['stPhotoDesc', 'photoDesc'],
  ['stLetterTag', 'letterTag'],
  ['stLetterTitle', 'letterTitle'],
  ['stLetterDesc', 'letterDesc'],
  ['stWriteTag', 'writeTag'],
  ['stWriteTitle', 'writeTitle'],
  ['stWriteDesc', 'writeDesc'],
  ['stOfferTag', 'offerTag'],
  ['stOfferTitle', 'offerTitle'],
  ['stOfferDesc', 'offerDesc'],
  ['stNoteTag', 'noteTag'],
  ['stNoteTitle', 'noteTitle']
];

function collectTeacherCopy() {
  var out = {};
  TEACHER_COPY_FIELDS.forEach(function (pair) {
    var v = val(pair[0]);
    if (v) out[pair[1]] = v;
  });
  return Object.keys(out).length ? out : null;
}

function fillTeacherCopy(tc) {
  if (!tc || typeof tc !== 'object') tc = {};
  TEACHER_COPY_FIELDS.forEach(function (pair) { setVal(pair[0], tc[pair[1]]); });
}

/* ─── 유가족 근황 ─── */
var FN_MOODS = { calm: '🌿 담담하게', hope: '🌤️ 희망', thanks: '💌 감사', daily: '☕ 일상' };

function fnEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function loadFamilyNotes() {
  var box = document.getElementById('fnList');
  if (!box) return;
  box.innerHTML = '<div style="padding:20px;color:#888">불러오는 중…</div>';
  callApi('GET', '/api/admin-memorial-family-notes').then(function (res) {
    if (!res.ok) {
      box.innerHTML = '<div style="padding:20px;color:#c00">불러오지 못했습니다. ' +
        fnEscape((res.data && res.data.error) || '') + '</div>';
      return;
    }
    var notes = (res.data && res.data.data && res.data.data.notes) || [];
    if (!notes.length) {
      box.innerHTML = '<div style="padding:24px;color:#888">등록된 근황이 없습니다. 위에서 첫 소식을 남겨보세요.</div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr>' +
      '<th style="width:56px">순서</th><th>제목</th><th style="width:130px">표기명</th>' +
      '<th style="width:110px">분위기</th><th style="width:80px">공개</th><th style="width:150px">관리</th>' +
      '</tr></thead><tbody>' +
      notes.map(function (n) {
        return '<tr>' +
          '<td>' + fnEscape(n.sortOrder) + '</td>' +
          '<td><b>' + fnEscape(n.title) + '</b><div style="color:#888;font-size:12px;margin-top:4px">' +
            fnEscape(String(n.content || '').slice(0, 60)) + '…</div></td>' +
          '<td>' + fnEscape(n.authorLabel || '—') + '</td>' +
          '<td>' + fnEscape(FN_MOODS[n.mood] || n.mood) + '</td>' +
          '<td>' + (n.isPublic ? '공개' : '<span style="color:#c00">숨김</span>') + '</td>' +
          '<td>' +
            '<button class="btn btn-sm" onclick="fnEdit(' + n.id + ')">수정</button> ' +
            '<button class="btn btn-sm" onclick="fnDelete(' + n.id + ')">삭제</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table>';
    window.__FN_CACHE = notes;
  }).catch(function (e) {
    box.innerHTML = '<div style="padding:20px;color:#c00">오류: ' + fnEscape(e.message) + '</div>';
  });
}

function fnEdit(id) {
  var n = (window.__FN_CACHE || []).filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  setVal('fnId', n.id);
  setVal('fnTitle', n.title);
  setVal('fnContent', n.content);
  setVal('fnAuthorLabel', n.authorLabel);
  var mood = document.getElementById('fnMood'); if (mood) mood.value = n.mood || 'calm';
  var pub = document.getElementById('fnPublic'); if (pub) pub.checked = !!n.isPublic;
  setVal('fnSort', n.sortOrder);
  var el = document.getElementById('fnTitle'); if (el) el.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fnReset() {
  ['fnId', 'fnTitle', 'fnContent', 'fnAuthorLabel'].forEach(function (id) { setVal(id, ''); });
  var mood = document.getElementById('fnMood'); if (mood) mood.value = 'calm';
  var pub = document.getElementById('fnPublic'); if (pub) pub.checked = true;
  setVal('fnSort', '0');
}

function fnSave() {
  var id = val('fnId');
  var payload = {
    title: val('fnTitle'),
    content: val('fnContent'),
    authorLabel: val('fnAuthorLabel'),
    mood: (document.getElementById('fnMood') || {}).value || 'calm',
    isPublic: !!(document.getElementById('fnPublic') || {}).checked,
    sortOrder: Number(val('fnSort')) || 0
  };
  if (!payload.title) { toast('제목을 입력해 주세요.', 'error'); return; }
  if (!payload.content) { toast('내용을 입력해 주세요.', 'error'); return; }

  var path = id
    ? '/api/admin-memorial-family-notes?action=update&id=' + encodeURIComponent(id)
    : '/api/admin-memorial-family-notes';
  callApi('POST', path, payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast(id ? '수정되었습니다.' : '등록되었습니다.', 'success');
    fnReset();
    loadFamilyNotes();
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}

function fnDelete(id) {
  if (!confirm('이 근황을 삭제할까요? 되돌릴 수 없습니다.')) return;
  callApi('POST', '/api/admin-memorial-family-notes?action=delete&id=' + encodeURIComponent(id))
    .then(function (res) {
      if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
      toast('삭제되었습니다.', 'success');
      loadFamilyNotes();
    }).catch(function (e) { toast('삭제 실패: ' + e.message, 'error'); });
}

document.addEventListener('DOMContentLoaded', function () {
  var save = document.getElementById('fnSave');
  if (save) save.addEventListener('click', fnSave);
  var reset = document.getElementById('fnReset');
  if (reset) reset.addEventListener('click', fnReset);
});

/* =========================================================
   ★ 2026-08-28 추모관 v2 — 선생님의 생전 순간 (사진)
   고인·유가족의 사진이라 운영자만 등록한다(Swain A안).
   사진 파일은 기존 업로드 경로(/api/blob-upload)를 그대로 쓴다.
   ========================================================= */
var TP_TEACHER_ID = 0;

function tpEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function tpVal(id) { var el = document.getElementById(id); return el ? String(el.value).trim() : ''; }
function tpSet(id, v) { var el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }

function tpPreview(url) {
  var wrap = document.getElementById('tpPreviewWrap');
  if (!wrap) return;
  wrap.innerHTML = url
    ? '<img src="' + tpEsc(url) + '" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:8px">'
    : '<div class="photo-preview-empty" id="tpEmpty"><span class="siren-icon-wrap" data-icon="image"></span></div>';
}

/** 선생님 편집을 열 때 함께 켠다 — 어느 선생님인지 정해져야 사진을 붙일 수 있다 */
function tpOpenFor(teacherId) {
  TP_TEACHER_ID = Number(teacherId) || 0;
  var sec = document.getElementById('tpSection');
  if (!sec) return;
  if (!TP_TEACHER_ID) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  tpReset();
  tpLoad();
}

function tpReset() {
  ['tpId', 'tpBlobId', 'tpCaption', 'tpDetail', 'tpTaken'].forEach(function (id) { tpSet(id, ''); });
  tpSet('tpSort', '0');
  var pub = document.getElementById('tpPublic'); if (pub) pub.checked = true;
  tpPreview('');
}

function tpUpload() {
  var input = document.getElementById('tpFile');
  var file = input && input.files && input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'memorial_teacher');
  fd.append('isPublic', 'true');
  toast('업로드 중…');
  fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
    .then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; });
    })
    .then(function (res) {
      if (!res.ok) { toast((res.data && (res.data.error || res.data.message)) || '업로드 실패', 'error'); return; }
      var id = (res.data && res.data.data && res.data.data.id) || (res.data && res.data.id) || (res.data && res.data.blobId);
      if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
      tpSet('tpBlobId', id);
      tpPreview('/api/blob-image?id=' + id);
      toast('사진이 업로드되었습니다.', 'success');
    })
    .catch(function (e) { toast('업로드 실패: ' + e.message, 'error'); });
}

function tpLoad() {
  var box = document.getElementById('tpList');
  if (!box || !TP_TEACHER_ID) return;
  box.innerHTML = '<div style="padding:16px;color:#888">불러오는 중…</div>';
  callApi('GET', '/api/admin-memorial-teacher-photos?teacherId=' + TP_TEACHER_ID).then(function (res) {
    if (!res.ok) {
      box.innerHTML = '<div style="padding:16px;color:#c00">' +
        tpEsc((res.data && res.data.error) || '불러오지 못했습니다') + '</div>';
      return;
    }
    var photos = (res.data && res.data.data && res.data.data.photos) || [];
    window.__TP_CACHE = photos;
    if (!photos.length) {
      box.innerHTML = '<div style="padding:18px;color:#888">등록된 사진이 없습니다.</div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr>' +
      '<th style="width:78px">사진</th><th>설명</th><th style="width:110px">시기</th>' +
      '<th style="width:56px">순서</th><th style="width:70px">공개</th><th style="width:140px">관리</th>' +
      '</tr></thead><tbody>' +
      photos.map(function (p) {
        return '<tr>' +
          '<td>' + (p.blobId
            ? '<img src="/api/blob-image?id=' + p.blobId + '" alt="" style="width:60px;height:46px;object-fit:cover;border-radius:5px">'
            : '—') + '</td>' +
          '<td><b>' + tpEsc(p.caption) + '</b>' +
            (p.detail ? '<div style="color:#888;font-size:12px;margin-top:4px">' +
              tpEsc(String(p.detail).slice(0, 50)) + '…</div>' : '') + '</td>' +
          '<td>' + tpEsc(p.takenLabel || '—') + '</td>' +
          '<td>' + tpEsc(p.sortOrder) + '</td>' +
          '<td>' + (p.isPublic ? '공개' : '<span style="color:#c00">숨김</span>') + '</td>' +
          '<td>' +
            '<button class="btn btn-sm" onclick="tpEdit(' + p.id + ')">수정</button> ' +
            '<button class="btn btn-sm" onclick="tpDelete(' + p.id + ')">삭제</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }).catch(function (e) {
    box.innerHTML = '<div style="padding:16px;color:#c00">오류: ' + tpEsc(e.message) + '</div>';
  });
}

function tpEdit(id) {
  var p = (window.__TP_CACHE || []).filter(function (x) { return x.id === id; })[0];
  if (!p) return;
  tpSet('tpId', p.id);
  tpSet('tpBlobId', p.blobId || '');
  tpSet('tpCaption', p.caption);
  tpSet('tpDetail', p.detail);
  tpSet('tpTaken', p.takenLabel);
  tpSet('tpSort', p.sortOrder);
  var pub = document.getElementById('tpPublic'); if (pub) pub.checked = !!p.isPublic;
  tpPreview(p.blobId ? '/api/blob-image?id=' + p.blobId : '');
  var el = document.getElementById('tpCaption'); if (el) el.focus();
}

function tpSave() {
  if (!TP_TEACHER_ID) { toast('선생님을 먼저 저장해 주세요.', 'error'); return; }
  var id = tpVal('tpId');
  var payload = {
    blobId: Number(tpVal('tpBlobId')) || null,
    caption: tpVal('tpCaption'),
    detail: tpVal('tpDetail'),
    takenLabel: tpVal('tpTaken'),
    sortOrder: Number(tpVal('tpSort')) || 0,
    isPublic: !!(document.getElementById('tpPublic') || {}).checked
  };
  if (!payload.caption) { toast('사진 설명을 입력해 주세요.', 'error'); return; }
  if (!id && !payload.blobId) { toast('사진을 먼저 올려주세요.', 'error'); return; }

  var path = id
    ? '/api/admin-memorial-teacher-photos?action=update&id=' + encodeURIComponent(id)
    : '/api/admin-memorial-teacher-photos?teacherId=' + TP_TEACHER_ID;
  callApi('POST', path, payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast(id ? '수정되었습니다.' : '사진이 추가되었습니다.', 'success');
    tpReset();
    tpLoad();
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}

function tpDelete(id) {
  if (!confirm('이 사진을 삭제할까요? 되돌릴 수 없습니다.')) return;
  callApi('POST', '/api/admin-memorial-teacher-photos?action=delete&id=' + encodeURIComponent(id))
    .then(function (res) {
      if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
      toast('삭제되었습니다.', 'success');
      tpLoad();
    }).catch(function (e) { toast('삭제 실패: ' + e.message, 'error'); });
}

document.addEventListener('DOMContentLoaded', function () {
  var s = document.getElementById('tpSave');
  if (s) s.addEventListener('click', tpSave);
  var r = document.getElementById('tpReset');
  if (r) r.addEventListener('click', tpReset);
});
