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
  ['teachers', 'moderation', 'spotlight', 'family', 'timeline', 'settings'].forEach(function (t) {
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
  if (name === 'timeline') tlLoad();
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
  /* ★ 2026-10-07 — 이 선생님만의 편지 목표 통수 + 초대 링크 */
  var lg = document.getElementById('fLetterGoal');
  if (lg) lg.value = pc.letterGoal ? String(pc.letterGoal) : '';
  var iu = document.getElementById('fInviteUrl');
  if (iu) iu.value = tInviteUrl(id);
  var iq = document.getElementById('fInviteQr');
  if (iq) iq.innerHTML = '';

  document.getElementById('teacherFormTitle').textContent = '선생님 수정';
  /* ★ 2026-08-28: 이 선생님의 생전 사진 관리도 함께 켠다
     (사진 기능이 없어도 편집 자체는 되어야 하므로 감싸 둔다) */
  try { tpOpenFor(id); } catch (e) { console.warn('[사진 관리]', e); }
  try { tsOpenFor(id); } catch (e) { console.warn('[자유 구간]', e); }
  document.getElementById('teacherForm').style.display = '';
  document.getElementById('teacherForm').scrollIntoView({ behavior: 'smooth' });
}
function closeTeacherForm() {
  document.getElementById('teacherForm').style.display = 'none';
  clearTeacherForm();
  _editingTeacherId = null;
  try { tpOpenFor(0); } catch (e) {}
  try { tsOpenFor(0); } catch (e) {}
}
function clearTeacherForm() {
  ['fId', 'fName', 'fSchoolRegion', 'fBirthDate', 'fDeathDate', 'fTributeLine', 'fBioHtml', 'fPhotoBlobId',
   'fLeadLine', 'fPortraitCaption', 'fPhotoTitle', 'fPhotoDesc', 'fLetterGoal', 'fInviteUrl'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var iq = document.getElementById('fInviteQr');
  if (iq) iq.innerHTML = '';
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

  /* ★ 2026-10-07 — 편지 목표 통수(숫자). 비우면 공통 설정을 따른다 */
  var goal = parseInt(((document.getElementById('fLetterGoal') || {}).value || '').trim(), 10);
  if (goal > 0) out.letterGoal = goal; else delete out.letterGoal;

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
  loadPhotoPending();
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
    /* ★ 2026-10-07 — 편지는 출판 동의 여부·비회원 작성을 함께 보여준다 (책 엮기용) */
    var who = esc(it.authorName || '익명');
    var photoActions = '';
    if (_modType === 'letter') {
      if (it.publishConsent) who += '<div style="margin-top:5px"><span class="status-pill on">출판 동의</span></div>';
      if (it.isMemberWriter === false) who += '<div style="margin-top:5px"><span class="status-pill off">비회원</span></div>';
      /* ★ 2026-11-12 사진이 붙은 편지 — 사진 상태(누르면 사진 원본) + 공개 중인 편지의 사진 내리기·다시 싣기 */
      if (it.photoUrl) {
        var pr = it.photoReview;
        var pl = pr === 'approved' ? '사진 공개' : (pr === 'pending' ? '사진 검토 대기' : '사진 뺌');
        who += '<div style="margin-top:5px"><a class="photo-pill-link" href="' + esc(it.photoUrl) + '" target="_blank" rel="noopener" title="사진 원본 보기">' +
          '<span class="status-pill ' + (pr === 'approved' ? 'on' : 'off') + '">' + pl + '</span></a></div>';
        if (!it.isHidden && pr === 'approved') {
          photoActions = '<button class="btn btn-ghost btn-sm" onclick="decidePhoto(' + it.id + ',\'strip\')">사진 내리기</button>';
        } else if (!it.isHidden && pr === 'rejected') {
          photoActions = '<button class="btn btn-ghost btn-sm" onclick="decidePhoto(' + it.id + ',\'approve\')">사진 싣기</button>';
        }
      }
    }
    if (_modType === 'letter' && it.photoReview === 'pending') {
      /* 사진 검토 대기 — 노출을 눌러도 위 «사진 편지 검토 대기»에서 정하기 전에는 공개되지 않는다 */
      status = it.isHidden
        ? '<span class="status-pill off">숨김</span><div style="margin-top:5px"><span class="status-pill off">사진 확인 대기</span></div>'
        : '<span class="status-pill off">비공개 · 사진 확인 대기</span>';
    }
    return '<tr>' +
      '<td>' + who + '</td>' +
      '<td><div class="mod-content' + (it.isHidden ? ' hidden-row' : '') + '">' + text + '</div></td>' +
      '<td>' + badge + '</td>' +
      '<td>' + status + '</td>' +
      '<td style="white-space:nowrap">' + fmtDate(it.createdAt) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="toggleHide(' + it.id + ',' + (it.isHidden ? 'true' : 'false') + ')">' + (it.isHidden ? '노출' : '숨김') + '</button>' +
        photoActions +
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
   ★ 2026-11-12 사진 편지 검토 대기
   Swain 결정: 누구나 편지에 사진 한 장을 붙일 수 있고, 사진이 붙은 편지는 운영자가 확인한 뒤 공개한다.
   [공개] 사진과 함께 공개(사진이 봉투 표지가 된다) · [사진 빼고 공개] 편지 글만 · [숨김] 편지를 감춘다.
   사진은 확인 전까지 비공개라 관리자 화면에서만 보인다.
   ========================================================= */
var PHOTO_DECISION_ASK = {
  approve: '이 편지를 사진과 함께 공개할까요?\n사진이 «기억의 편지» 봉투의 표지로 보이게 됩니다.',
  strip: '사진은 싣지 않고 편지 글만 공개할까요?',
  hide: '이 편지를 숨길까요?\n편지와 사진 모두 공개되지 않습니다.'
};

function loadPhotoPending() {
  var box = document.getElementById('lpBox');
  var list = document.getElementById('lpList');
  if (!box || !list) return;
  callApi('GET', '/api/admin-memorial-moderation?type=letter&photo=pending').then(function (res) {
    if (!res.ok) {
      box.style.display = '';
      list.innerHTML = '<div class="lp-empty">불러오지 못했습니다. ' + esc((res.data && res.data.error) || '') + '</div>';
      return;
    }
    /* 사진 첨부 저장 칸이 아직 없으면(마이그 전) 칸 자체를 감춘다 */
    if (pick(res, 'photoReady') === false) { box.style.display = 'none'; return; }
    renderPhotoPending(pick(res, 'items') || []);
    box.style.display = '';
  }).catch(function (e) {
    box.style.display = '';
    list.innerHTML = '<div class="lp-empty">불러오지 못했습니다. ' + esc(e.message) + '</div>';
  });
}

function renderPhotoPending(items) {
  var list = document.getElementById('lpList');
  var cnt = document.getElementById('lpCount');
  if (cnt) {
    cnt.textContent = String(items.length);
    cnt.className = 'lp-count' + (items.length ? '' : ' zero');
  }
  if (!list) return;
  if (!items.length) { list.innerHTML = '<div class="lp-empty">확인을 기다리는 사진 편지가 없습니다.</div>'; return; }
  list.innerHTML = items.map(function (it) {
    var tags = [];
    if (it.isMemberWriter === false) tags.push('<span class="status-pill off">비회원</span>');
    if (it.publishConsent) tags.push('<span class="status-pill on">출판 동의</span>');
    if (it.isHidden) tags.push('<span class="status-pill off">숨김 상태(글 자동 검토 보류 또는 운영자 숨김)</span>');
    if (Number(it.reportCount) > 0) tags.push('<span class="report-badge">신고 ' + Number(it.reportCount) + '</span>');
    var photo = it.photoUrl
      ? '<a class="lp-photo" href="' + esc(it.photoUrl) + '" target="_blank" rel="noopener" title="사진 원본을 새 창에서 보기">' +
          '<img src="' + esc(it.photoUrl) + '" alt="편지에 붙은 사진" loading="lazy"><span>누르면 원본</span></a>'
      : '<div class="lp-photo"><span>사진 없음</span></div>';
    return '<div class="lp-card" data-lp-id="' + it.id + '">' +
      photo +
      '<div>' +
        /* 저장된 이름에 이미 «선생님»이 붙어 있으면 «께»만 (공개 화면 «○○ 선생님께»와 같은 표기 — «선생님 선생님께» 방지) */
        '<div class="lp-meta"><b>' + esc(it.teacherName
          ? (/선생님\s*$/.test(it.teacherName) ? it.teacherName + '께' : it.teacherName + ' 선생님께')
          : '선생님 #' + it.teacherId + '께') + '</b>' +
          '<span>· ' + esc(it.authorName || '익명') + '</span><span>· ' + fmtDate(it.createdAt) + '</span>' + tags.join('') + '</div>' +
        (it.title ? '<div class="lp-title">【' + esc(it.title) + '】</div>' : '') +
        '<div class="lp-text">' + esc(it.content || '') + '</div>' +
        '<div class="lp-actions">' +
          '<button class="btn btn-success btn-sm" onclick="decidePhoto(' + it.id + ',\'approve\')">공개</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="decidePhoto(' + it.id + ',\'strip\')">사진 빼고 공개</button>' +
          '<button class="btn btn-danger btn-sm" onclick="decidePhoto(' + it.id + ',\'hide\')">숨김</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function decidePhoto(id, decision) {
  var ask = PHOTO_DECISION_ASK[decision];
  if (!ask || !confirm(ask)) return;
  callApi('PATCH', '/api/admin-memorial-moderation?type=letter&id=' + id, { photoDecision: decision }).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '처리 실패', 'error'); return; }
    toast((res.data && res.data.message) || '처리했습니다.', 'success');
    loadMod();
  }).catch(function (e) { toast('처리 실패: ' + e.message, 'error'); });
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
/* ─── ★ 2026-11-12 BGM 트랙: 음원 파일 올리기 · 유튜브 주소 · 줄마다 종류 표시 ───
   대표 결정: 관리자가 음원 파일을 직접 올리거나, 유튜브 주소를 넣으면 그 노래가 나오게.
   - 음원 파일은 관리자 전용 경로(/api/admin-memorial-bgm-upload)로 받은 주소에 브라우저가 R2로 바로 올린다
     (함수 본문 6MB 한도 우회) → 확인이 끝나면 그 줄 URL 칸에 재생 주소(/api/blob-image?id=N)가 들어간다.
   - 트랙 주소 판별 규칙은 lib/memorial-bgm.ts · public/js/memorial-bgm.js 와 같다(바꾸면 세 곳 함께). */
var BGM_MAX_BYTES = 30 * 1024 * 1024;
var BGM_EXT_TYPE = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav' };
var BGM_FILE_ACCEPT = '.mp3,.m4a,.mp4,.aac,.ogg,.oga,.wav';
var BGM_TYPE_MSG = 'mp3 · m4a · mp4(음성) · aac · ogg · wav 파일만 올릴 수 있습니다.';
var BGM_KIND_LABEL = { audio: '음원 파일', youtube: '유튜브', invalid: '재생할 수 없는 주소' };
var BGM_YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
var BGM_YT_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];
var _bgmUploading = 0;

function bgmFileExt(name) {
  var m = /\.([a-z0-9]{1,8})$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}
/* 유튜브 주소 → 영상 번호(11자) · list= 등 다른 매개변수는 무시 */
function bgmYouTubeId(raw) {
  var s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s) && /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(s)) s = 'https://' + s;
  var u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  var host = u.hostname.toLowerCase().replace(/^www\./, '');
  var id = '';
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] || '';
  } else if (BGM_YT_HOSTS.indexOf(host) >= 0) {
    if (/^\/watch\/?$/.test(u.pathname)) id = u.searchParams.get('v') || '';
    else {
      var m = /^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/.exec(u.pathname);
      if (m) id = m[1];
    }
  }
  return BGM_YT_ID_RE.test(id) ? id : null;
}
/* 'audio'(음원 파일) | 'youtube' | 'invalid'(재생할 수 없는 주소) | 'empty' */
function bgmKindOf(raw) {
  var s = String(raw || '').trim();
  if (!s) return 'empty';
  if (s.length > 2000) return 'invalid';
  if (bgmYouTubeId(s)) return 'youtube';
  var isRootPath = /^\/(?!\/)/.test(s);
  var isAbsolute = /^https?:\/\//i.test(s);
  if (!isRootPath && !isAbsolute) return 'invalid';
  var u;
  try { u = new URL(s, 'https://tbfa.co.kr'); } catch (e) { return 'invalid'; }
  var host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (isAbsolute && (host === 'youtu.be' || BGM_YT_HOSTS.indexOf(host) >= 0)) return 'invalid';
  if (u.pathname === '/api/blob-image' && /^\d+$/.test(u.searchParams.get('id') || '')) return 'audio';
  if (BGM_EXT_TYPE[bgmFileExt(u.pathname)]) return 'audio';
  return 'invalid';
}

function updateBgmKind(row) {
  var kind = bgmKindOf(row.querySelector('.bgm-url').value);
  var el = row.querySelector('.bgm-kind');
  el.className = 'bgm-kind' + (kind === 'empty' ? '' : ' ' + kind);
  el.textContent = BGM_KIND_LABEL[kind] || '';
  row.classList.toggle('bgm-invalid', kind === 'invalid');
}
function setBgmStatus(row, msg, type) {
  var el = row.querySelector('.bgm-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'bgm-status' + (type ? ' ' + type : '');
}

function addBgmRow(data) {
  data = data || {};
  var row = document.createElement('div');
  row.className = 'dyn-row bgm';
  row.innerHTML =
    '<input type="text" class="bgm-title" placeholder="곡 제목" maxlength="100" value="' + esc(data.title || '') + '">' +
    '<input type="text" class="bgm-url" placeholder="유튜브 주소 또는 «음원 파일 올리기»" value="' + esc(data.url || '') + '">' +
    '<button type="button" class="btn btn-ghost btn-sm bgm-upload">음원 파일 올리기</button>' +
    '<input type="file" class="bgm-file" accept="' + BGM_FILE_ACCEPT + '" style="display:none">' +
    '<button type="button" class="dyn-del" title="삭제">×</button>' +
    '<div class="bgm-meta"><span class="bgm-kind"></span><span class="bgm-status"></span></div>';
  row.querySelector('.dyn-del').addEventListener('click', function () { row.remove(); });
  var urlEl = row.querySelector('.bgm-url');
  urlEl.addEventListener('input', function () { updateBgmKind(row); setBgmStatus(row, ''); });
  var fileEl = row.querySelector('.bgm-file');
  row.querySelector('.bgm-upload').addEventListener('click', function () { fileEl.value = ''; fileEl.click(); });
  fileEl.addEventListener('change', function () {
    var f = fileEl.files && fileEl.files[0];
    if (f) uploadBgmFile(row, f);
  });
  document.getElementById('bgmRows').appendChild(row);
  updateBgmKind(row);
  return row;
}

function bgmErrMsg(res, fallback) {
  var d = (res && res.data) || {};
  var msg = d.error || d.message || (fallback + ' (HTTP ' + (res && res.status) + ')');
  if (d.detail) msg += ' — ' + String(d.detail).slice(0, 160);
  return msg;
}
/* 받은 사전 서명 주소로 R2에 바로 올리기 (진행률 표시 위해 XHR) */
function bgmPutFile(uploadUrl, file, contentType, onProgress) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('저장소에 올리지 못했습니다 (HTTP ' + xhr.status + ')'));
    };
    xhr.onerror = function () { reject(new Error('저장소에 연결하지 못했습니다')); };
    xhr.send(file);
  });
}

function uploadBgmFile(row, file) {
  var btn = row.querySelector('.bgm-upload');
  if (!BGM_EXT_TYPE[bgmFileExt(file.name)]) {
    setBgmStatus(row, BGM_TYPE_MSG, 'error'); toast(BGM_TYPE_MSG, 'error'); return;
  }
  if (!file.size) {
    setBgmStatus(row, '빈 파일입니다.', 'error'); toast('빈 파일입니다.', 'error'); return;
  }
  if (file.size > BGM_MAX_BYTES) {
    setBgmStatus(row, '음원 파일은 30MB 이하만 올릴 수 있습니다.', 'error');
    toast('음원 파일은 30MB 이하만 올릴 수 있습니다.', 'error');
    return;
  }

  _bgmUploading++;
  btn.disabled = true;
  setBgmStatus(row, '올리는 중… 0%');
  var blobId = null;
  callApi('POST', '/api/admin-memorial-bgm-upload', {
    action: 'presign', originalName: file.name, mimeType: file.type || '', sizeBytes: file.size
  }).then(function (res) {
    if (!res.ok) throw new Error(bgmErrMsg(res, '올릴 주소를 받지 못했습니다'));
    blobId = pick(res, 'id');
    var uploadUrl = pick(res, 'uploadUrl');
    var contentType = pick(res, 'contentType') || BGM_EXT_TYPE[bgmFileExt(file.name)];
    if (!blobId || !uploadUrl) throw new Error('올릴 주소 응답이 비어 있습니다');
    return bgmPutFile(uploadUrl, file, contentType, function (pct) { setBgmStatus(row, '올리는 중… ' + pct + '%'); });
  }).then(function () {
    setBgmStatus(row, '확인 중…');
    return callApi('POST', '/api/admin-memorial-bgm-upload', { action: 'confirm', id: blobId });
  }).then(function (res) {
    if (!res.ok) throw new Error(bgmErrMsg(res, '올린 파일을 확인하지 못했습니다'));
    var url = pick(res, 'url') || ('/api/blob-image?id=' + blobId);
    row.querySelector('.bgm-url').value = url;
    var titleEl = row.querySelector('.bgm-title');
    if (!titleEl.value.trim()) titleEl.value = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
    updateBgmKind(row);
    setBgmStatus(row, '«' + file.name + '» 올림 — «설정 저장»을 눌러야 추모관에 반영됩니다.', 'ok');
    toast('음원 파일을 올렸습니다. «설정 저장»을 눌러 주세요.', 'success');
  }).catch(function (e) {
    setBgmStatus(row, '올리기 실패: ' + e.message, 'error');
    toast('음원 파일 올리기 실패: ' + e.message, 'error');
  }).then(function () {
    _bgmUploading = Math.max(0, _bgmUploading - 1);
    btn.disabled = false;
  });
}

/* 빈 줄은 무시 · 재생할 수 없는 주소는 bad 로 모은다(저장 막음) */
function collectBgm() {
  var rows = document.querySelectorAll('#bgmRows .dyn-row');
  var out = [];
  var bad = [];
  Array.prototype.forEach.call(rows, function (r, i) {
    var title = r.querySelector('.bgm-title').value.trim();
    var url = r.querySelector('.bgm-url').value.trim();
    if (!url) return;
    if (bgmKindOf(url) === 'invalid') { bad.push({ n: i + 1, row: r }); return; }
    out.push({ title: title || '추모 음악', url: url });
  });
  return { tracks: out, bad: bad };
}
function saveSettings() {
  if (_bgmUploading > 0) { toast('음원 파일을 올리는 중입니다. 끝난 뒤 저장해 주세요.', 'error'); return; }
  var bgm = collectBgm();
  if (bgm.bad.length) {
    bgm.bad.forEach(function (b) { updateBgmKind(b.row); });
    toast('재생할 수 없는 주소가 있습니다 (' + bgm.bad.map(function (b) { return b.n; }).join(', ') +
      '번째 트랙). 음원 파일을 올리거나 유튜브 주소를 넣어 주세요.', 'error');
    var firstUrl = bgm.bad[0].row.querySelector('.bgm-url');
    if (firstUrl) firstUrl.focus();
    return;
  }
  var payload = {
    heroYoutubeId: document.getElementById('sHeroYoutubeId').value.trim() || null,
    heroCopy: document.getElementById('sHeroCopy').value.trim() || null,
    bgmTracks: bgm.tracks,
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
    morning: {
      greet: val('sMornGreet'),  title: val('sMornTitle'), sub: val('sMornSub'),
      /* ★ 2026-10-07 — 아침관 안쪽 구간 제목 */
      notesTitle: val('sNotesTitle'), notesSub: val('sNotesSub'),
      timelineTitle: val('sTlTitle'), timelineSub: val('sTlSub')
    },
    /* ★ 2026-08-28 — 선생님 화면 구간 문구 (모든 선생님 공통) */
    teacher: collectTeacherCopy()
  };
  /* 세 구간 모두 비어 있으면 아예 안 보낸다 — 서버가 기본 문구를 쓴다 */
  var any = false;
  Object.keys(c).forEach(function (k) {
    /* ★ 2026-11-12 fix: 선생님 화면 문구를 모두 비워 두면 teacher 가 null 이라 여기서 오류가 나
       «설정 저장»이 아무 반응 없이 멈췄다(BGM 트랙도 저장 불가). 빈 구간은 건너뛴다. */
    Object.keys(c[k] || {}).forEach(function (f) { if (c[k][f]) any = true; });
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
  setVal('sNotesTitle', hall.morning && hall.morning.notesTitle);
  setVal('sNotesSub',   hall.morning && hall.morning.notesSub);
  setVal('sTlTitle',    hall.morning && hall.morning.timelineTitle);
  setVal('sTlSub',      hall.morning && hall.morning.timelineSub);
  fillTeacherCopy(hall.teacher);
}

/* 선생님 화면 문구 — 화면의 자리 이름과 입력란을 1:1로 짝지어 둔다 */
var TEACHER_COPY_FIELDS = [
  ['stLeadLine', 'leadLine'],
  ['stPortraitCaption', 'portraitCaption'],
  ['stPhotoTag', 'photoTag'],
  ['stPhotoTitle', 'photoTitle'],
  ['stPhotoDesc', 'photoDesc'],
  ['stPhotoEmptyLine', 'photoEmptyLine'],
  ['stPhotoEmptySub', 'photoEmptySub'],
  ['stLetterTag', 'letterTag'],
  ['stLetterTitle', 'letterTitle'],
  ['stLetterDesc', 'letterDesc'],
  ['stOfferTag', 'offerTag'],
  ['stOfferTitle', 'offerTitle'],
  ['stOfferDesc', 'offerDesc'],
  ['stNoteTag', 'noteTag'],
  ['stNoteTitle', 'noteTitle'],
  /* ★ 2026-10-07 — 서신 작성 구간: 30통 목표·질문 카드·안내·초대장 */
  ['stLetterGoal', 'letterGoal'],
  ['stLetterGoalLine', 'letterGoalLine'],
  ['stLetterGoalDone', 'letterGoalDone'],
  ['stLetterGoalSub', 'letterGoalSub'],
  ['stLetterQuestions', 'letterQuestions'],
  ['stLetterPlaceholder', 'letterPlaceholder'],
  ['stLetterHint', 'letterHint'],
  ['stInviteTitle', 'inviteTitle'],
  ['stInviteDesc', 'inviteDesc']
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
/* ★ 2026-11-12 대표 결정 — 분위기 표시는 관리자가 문구·색상 목록을 직접 관리한다.
   목록 API: /api/admin-memorial-family-moods (저장 위치·규칙은 lib/memorial-moods.ts).
   목록을 불러오지 못하면 예전 네 가지로 선택지를 채워 글쓰기는 계속할 수 있게 한다. */
var FM_DEFAULT_COLOR = '#3b584e';
var FM_FALLBACK = [
  { key: 'calm', text: '🌿 담담한 하루', color: FM_DEFAULT_COLOR },
  { key: 'hope', text: '🌤️ 희망', color: FM_DEFAULT_COLOR },
  { key: 'thanks', text: '💌 감사', color: FM_DEFAULT_COLOR },
  { key: 'daily', text: '☕ 일상', color: FM_DEFAULT_COLOR }
];
var _fmMoods = FM_FALLBACK.slice();
var _fmUsage = {};
var _fmSaved = false;
var _fnMoodTouched = false;   /* 새 글에서 분위기를 직접 골랐는지 — 안 골랐으면 목록의 첫 표시가 기본 */

function fnEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmColorOk(c) { return /^#[0-9a-fA-F]{6}$/.test(String(c || '')); }
/* 글자색 = 고른 색, 바탕 = 같은 색을 옅게 (공개 화면과 같은 계산) */
function fmStyle(color) {
  if (!fmColorOk(color)) return '';
  var r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  return 'color:' + color + ';background-color:rgba(' + r + ',' + g + ',' + b + ',.12)';
}
function fmFind(key) {
  for (var i = 0; i < _fmMoods.length; i++) if (_fmMoods[i].key === key) return _fmMoods[i];
  return null;
}
/* 표에 넣는 칩 — 목록에 없으면 «표시 없음» */
function fmChipHtml(key) {
  var m = key ? fmFind(key) : null;
  if (!m) return '<span class="fm-chip none">' + (key ? '표시 없음 (지운 표시)' : '표시 없음') + '</span>';
  return '<span class="fm-chip" style="' + fmStyle(m.color) + '">' + fnEscape(m.text) + '</span>';
}

/* 서버가 돌려준 목록·글 수를 반영하고 목록·선택지를 다시 그린다 */
function fmApply(res) {
  var moods = pick(res, 'moods');
  if (Array.isArray(moods)) _fmMoods = moods;
  _fmUsage = pick(res, 'usage') || {};
  _fmSaved = !!pick(res, 'saved');
  fmRenderList();
  fmFillSelect();
}

function fmLoad() {
  var box = document.getElementById('fmList');
  return callApi('GET', '/api/admin-memorial-family-moods').then(function (res) {
    if (!res.ok) {
      if (box) box.innerHTML = '<div class="hint" style="color:#c00">표시 목록을 불러오지 못했습니다. ' +
        fnEscape((res.data && (res.data.error || res.data.detail)) || ('HTTP ' + res.status)) +
        ' — 글쓰기 선택지는 기본 네 가지로 보입니다.</div>';
      fmFillSelect();
      return false;
    }
    fmApply(res);
    return true;
  }).catch(function (e) {
    if (box) box.innerHTML = '<div class="hint" style="color:#c00">표시 목록 오류: ' + fnEscape(e.message) + '</div>';
    fmFillSelect();
    return false;
  });
}

function fmRenderList() {
  var box = document.getElementById('fmList');
  if (!box) return;
  if (!_fmMoods.length) {
    box.innerHTML = '<div class="hint">표시가 하나도 없습니다. 아래에서 추가해 주세요. (지금은 모든 근황이 표시 없이 보입니다)</div>';
    return;
  }
  var editing = val('fmKey');
  box.innerHTML = _fmMoods.map(function (m) {
    var n = Number(_fmUsage[m.key] || 0);
    return '<div class="fm-row' + (editing === m.key ? ' editing' : '') + '">' +
      '<span class="fm-chip" style="' + fmStyle(m.color) + '">' + fnEscape(m.text) + '</span>' +
      '<span class="fm-color-code">' + fnEscape(fmColorOk(m.color) ? m.color : '기본색') + '</span>' +
      '<span class="fm-count">' + (n ? '근황 ' + n + '개에 쓰는 중' : '쓰는 근황 없음') + '</span>' +
      '<span class="fm-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-fm-edit="' + fnEscape(m.key) + '">수정</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-fm-del="' + fnEscape(m.key) + '">삭제</button>' +
      '</span></div>';
  }).join('') +
  (_fmSaved ? '' : '<div class="hint">처음 기본 목록입니다. 고치거나 추가하면 이 목록이 저장됩니다.</div>');
}

/* 글쓰기의 «분위기 표시» 선택지를 목록으로 채운다 */
function fmFillSelect() {
  var sel = document.getElementById('fnMood');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">(표시 없음)</option>' + _fmMoods.map(function (m) {
    return '<option value="' + fnEscape(m.key) + '">' + fnEscape(m.text) + '</option>';
  }).join('');
  /* 새 글을 쓰는 중이고 아직 고르지 않았으면 목록의 첫 표시를 기본으로 */
  if (!val('fnId') && !_fnMoodTouched) cur = _fmMoods[0] ? _fmMoods[0].key : '';
  fmSetSelect(cur);
}
/* 목록에 없는 표시(지운 것)를 가진 글은 «표시 없음»으로 보인다 */
function fmSetSelect(key) {
  var sel = document.getElementById('fnMood');
  if (!sel) return;
  sel.value = (key && fmFind(key)) ? key : '';
  fmPreviewSelected();
}
function fmPreviewSelected() {
  var sel = document.getElementById('fnMood'), pv = document.getElementById('fnMoodPreview');
  if (!sel || !pv) return;
  var m = fmFind(sel.value);
  if (!m) { pv.textContent = ''; pv.style.cssText = 'display:none'; return; }
  pv.textContent = m.text;
  pv.style.cssText = fmStyle(m.color);
}

/* 추가·고치기 입력 줄의 미리보기 */
function fmPreviewEdit() {
  var pv = document.getElementById('fmPreview');
  if (!pv) return;
  var text = val('fmText');
  var color = (document.getElementById('fmColor') || {}).value || FM_DEFAULT_COLOR;
  pv.textContent = text || '미리보기';
  pv.style.cssText = fmStyle(color);
}

function fmEdit(key) {
  var m = fmFind(key);
  if (!m) return;
  setVal('fmKey', m.key);
  setVal('fmText', m.text);
  var c = document.getElementById('fmColor');
  if (c) c.value = fmColorOk(m.color) ? String(m.color).toLowerCase() : FM_DEFAULT_COLOR;
  var b = document.getElementById('fmSave'); if (b) b.textContent = '고친 내용 저장';
  var x = document.getElementById('fmCancel'); if (x) x.style.display = '';
  fmPreviewEdit();
  fmRenderList();
  var t = document.getElementById('fmText'); if (t) t.focus();
}

function fmCancelEdit() {
  setVal('fmKey', '');
  setVal('fmText', '');
  var c = document.getElementById('fmColor'); if (c) c.value = FM_DEFAULT_COLOR;
  var b = document.getElementById('fmSave'); if (b) b.textContent = '표시 추가';
  var x = document.getElementById('fmCancel'); if (x) x.style.display = 'none';
  fmPreviewEdit();
  fmRenderList();
}

function fmSave() {
  var key = val('fmKey');
  var text = val('fmText');
  var color = (document.getElementById('fmColor') || {}).value || FM_DEFAULT_COLOR;
  if (!text) { toast('표시 문구를 입력해 주세요.', 'error'); return; }
  var path = key
    ? '/api/admin-memorial-family-moods?action=update&key=' + encodeURIComponent(key)
    : '/api/admin-memorial-family-moods?action=create';
  var btn = document.getElementById('fmSave');
  if (btn) btn.disabled = true;
  callApi('POST', path, { text: text, color: color }).then(function (res) {
    if (btn) btn.disabled = false;
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    fmApply(res);
    fmCancelEdit();
    if (window.__FN_CACHE) fnRenderTable(window.__FN_CACHE);
    toast(key ? '표시를 고쳤습니다.' : '표시를 추가했습니다.', 'success');
  }).catch(function (e) {
    if (btn) btn.disabled = false;
    toast('저장 실패: ' + e.message, 'error');
  });
}

function fmDelete(key) {
  var m = fmFind(key);
  if (!m) return;
  /* 지우기 직전에 쓰는 글 수를 다시 센다 — 그사이 다른 관리자가 글을 고쳤을 수 있다 */
  callApi('GET', '/api/admin-memorial-family-moods').then(function (res) {
    var usage = res.ok ? (pick(res, 'usage') || {}) : _fmUsage;
    var n = Number(usage[key] || 0);
    var msg = n
      ? '«' + m.text + '» 표시를 쓰는 근황이 ' + n + '개 있습니다.\n삭제하면 그 근황들은 표시 없이 보입니다(글은 그대로 남습니다).\n\n삭제할까요?'
      : '«' + m.text + '» 표시를 삭제할까요?';
    if (!confirm(msg)) return;
    return callApi('POST', '/api/admin-memorial-family-moods?action=delete&key=' + encodeURIComponent(key)).then(function (r2) {
      if (!r2.ok) { toast((r2.data && r2.data.error) || '삭제 실패', 'error'); return; }
      var wasEditing = val('fmKey') === key;
      fmApply(r2);
      if (wasEditing) fmCancelEdit();          /* 고치던 표시를 지웠으면 입력 줄을 비운다 */
      if (window.__FN_CACHE) fnRenderTable(window.__FN_CACHE);
      toast('표시를 삭제했습니다.', 'success');
    });
  }).catch(function (e) { toast('삭제 실패: ' + e.message, 'error'); });
}

function loadFamilyNotes() {
  var box = document.getElementById('fnList');
  if (!box) return;
  box.innerHTML = '<div style="padding:20px;color:#888">불러오는 중…</div>';
  /* 표시 목록을 먼저 받아야 표의 칩을 그릴 수 있다 — 목록을 못 받아도 근황은 계속 불러온다 */
  fmLoad().then(function () {
    return callApi('GET', '/api/admin-memorial-family-notes');
  }).then(function (res) {
    if (!res.ok) {
      box.innerHTML = '<div style="padding:20px;color:#c00">불러오지 못했습니다. ' +
        fnEscape((res.data && res.data.error) || '') + '</div>';
      return;
    }
    var notes = (res.data && res.data.data && res.data.data.notes) || [];
    window.__FN_CACHE = notes;
    fnRenderTable(notes);
  }).catch(function (e) {
    box.innerHTML = '<div style="padding:20px;color:#c00">오류: ' + fnEscape(e.message) + '</div>';
  });
}

function fnRenderTable(notes) {
  var box = document.getElementById('fnList');
  if (!box) return;
  if (!notes.length) {
    box.innerHTML = '<div style="padding:24px;color:#888">등록된 근황이 없습니다. 위에서 첫 소식을 남겨보세요.</div>';
    return;
  }
  box.innerHTML = '<table class="tbl"><thead><tr>' +
    '<th style="width:56px">순서</th><th style="width:78px">사진</th><th>제목</th><th style="width:130px">표기명</th>' +
    '<th style="width:150px">분위기</th><th style="width:80px">공개</th><th style="width:150px">관리</th>' +
    '</tr></thead><tbody>' +
    notes.map(function (n) {
      var thumb = n.photoUrl
        ? '<img src="' + fnEscape(n.photoUrl) + '" alt="" style="width:60px;height:42px;object-fit:cover;border-radius:5px">'
        : '<span style="color:#bbb">—</span>';
      return '<tr>' +
        '<td>' + fnEscape(n.sortOrder) + '</td>' +
        '<td>' + thumb + '</td>' +
        '<td><b>' + fnEscape(n.title) + '</b><div style="color:#888;font-size:12px;margin-top:4px">' +
          fnEscape(String(n.content || '').slice(0, 60)) + '…</div></td>' +
        '<td>' + fnEscape(n.authorLabel || '—') + '</td>' +
        '<td>' + fmChipHtml(n.mood) + '</td>' +
        '<td>' + (n.isPublic ? '공개' : '<span style="color:#c00">숨김</span>') + '</td>' +
        '<td>' +
          '<button class="btn btn-sm" onclick="fnEdit(' + n.id + ')">수정</button> ' +
          '<button class="btn btn-sm" onclick="fnDelete(' + n.id + ')">삭제</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table>';
}

function fnEdit(id) {
  var n = (window.__FN_CACHE || []).filter(function (x) { return x.id === id; })[0];
  if (!n) return;
  setVal('fnId', n.id);
  setVal('fnTitle', n.title);
  setVal('fnContent', n.content);
  setVal('fnAuthorLabel', n.authorLabel);
  /* 목록에서 지운 표시를 쓰던 글은 «표시 없음»으로 보인다 — 그대로 저장하면 표시 없이 남는다 */
  _fnMoodTouched = true;
  fmSetSelect(n.mood || '');
  var pub = document.getElementById('fnPublic'); if (pub) pub.checked = !!n.isPublic;
  setVal('fnSort', n.sortOrder);
  setVal('fnPhotoBlobId', n.photoBlobId || '');
  fnPhotoPreview(n.photoUrl || '');
  var el = document.getElementById('fnTitle'); if (el) el.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fnReset() {
  ['fnId', 'fnTitle', 'fnContent', 'fnAuthorLabel'].forEach(function (id) { setVal(id, ''); });
  /* 새 글의 분위기 표시는 목록의 첫 표시가 기본 */
  _fnMoodTouched = false;
  fmSetSelect(_fmMoods[0] ? _fmMoods[0].key : '');
  var pub = document.getElementById('fnPublic'); if (pub) pub.checked = true;
  setVal('fnSort', '0');
  fnClearPhoto();
}

function fnSave() {
  var id = val('fnId');
  var payload = {
    title: val('fnTitle'),
    content: val('fnContent'),
    authorLabel: val('fnAuthorLabel'),
    /* 빈 값은 «표시 없음» */
    mood: (document.getElementById('fnMood') || {}).value || '',
    isPublic: !!(document.getElementById('fnPublic') || {}).checked,
    sortOrder: Number(val('fnSort')) || 0,
    /* ★ 2026-10-07 — 사진. 없으면 null 로 보내 '지우기'도 저장된다 */
    photoBlobId: Number(val('fnPhotoBlobId')) || null
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

  /* ★ 2026-11-12 분위기 표시 목록 — 추가·고치기·삭제 */
  var sel = document.getElementById('fnMood');
  if (sel) sel.addEventListener('change', function () { _fnMoodTouched = true; fmPreviewSelected(); });
  var fs = document.getElementById('fmSave');
  if (fs) fs.addEventListener('click', fmSave);
  var fc = document.getElementById('fmCancel');
  if (fc) fc.addEventListener('click', fmCancelEdit);
  var ft = document.getElementById('fmText');
  if (ft) {
    ft.addEventListener('input', fmPreviewEdit);
    ft.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fmSave(); }
    });
  }
  var fcol = document.getElementById('fmColor');
  if (fcol) fcol.addEventListener('input', fmPreviewEdit);
  var fl = document.getElementById('fmList');
  if (fl) fl.addEventListener('click', function (e) {
    var ed = e.target.closest && e.target.closest('[data-fm-edit]');
    if (ed) { fmEdit(ed.getAttribute('data-fm-edit')); return; }
    var del = e.target.closest && e.target.closest('[data-fm-del]');
    if (del) fmDelete(del.getAttribute('data-fm-del'));
  });
  /* 목록을 받기 전에도 선택지가 비지 않게 기본 네 가지로 먼저 채운다 */
  fmFillSelect();
  fmPreviewEdit();
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

/* =========================================================
   ★ 2026-08-28 — 선생님 화면 '자유 구간'
   정해진 칸으로 다 담기지 않는 이야기를, 운영자가 원하는 만큼 만들어 넣는다.
   ========================================================= */
var _tsTeacherId = 0;
var _tsItems = [];

function tsOpenFor(teacherId) {
  _tsTeacherId = Number(teacherId) || 0;
  var box = document.getElementById('tsSection');
  if (!box) return;
  box.style.display = _tsTeacherId ? '' : 'none';
  tsResetForm();
  if (_tsTeacherId) tsLoad();
}

function tsResetForm() {
  ['tsId', 'tsTitle', 'tsBody', 'tsBlobId'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var f = document.getElementById('tsFile'); if (f) f.value = '';
  var sort = document.getElementById('tsSort'); if (sort) sort.value = 0;
  var pub = document.getElementById('tsPublic'); if (pub) pub.value = 'true';
  tsPreview(null);
}

function tsPreview(url) {
  var wrap = document.getElementById('tsPreviewWrap');
  if (!wrap) return;
  wrap.innerHTML = url
    ? '<img class="photo-preview" style="border-radius:8px" src="' + esc(url) + '" alt="">'
    : '<div class="photo-preview-empty" style="border-radius:8px"><span class="siren-icon-wrap" data-icon="image"></span></div>';
  if (window.Icons && window.Icons.hydrate) { try { window.Icons.hydrate(wrap); } catch (_) {} }
}

function tsUpload() {
  var input = document.getElementById('tsFile');
  var file = input && input.files && input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'memorial_section');
  fd.append('isPublic', 'true');
  toast('업로드 중…');
  fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; }); })
    .then(function (res) {
      if (!res.ok) { toast((res.data && (res.data.error || res.data.message)) || '업로드 실패', 'error'); return; }
      var id = (res.data && res.data.data && res.data.data.id) || (res.data && res.data.id) || (res.data && res.data.blobId);
      if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
      document.getElementById('tsBlobId').value = id;
      tsPreview('/api/blob-image?id=' + id);
      toast('사진이 업로드되었습니다.', 'success');
    })
    .catch(function (e) { toast('업로드 실패: ' + e.message, 'error'); });
}

function tsLoad() {
  var list = document.getElementById('tsList');
  if (!list) return;
  list.innerHTML = '<div class="tbl-empty">불러오는 중…</div>';
  callApi('GET', '/api/admin-memorial-teacher-sections?teacherId=' + _tsTeacherId).then(function (res) {
    if (!res.ok) { list.innerHTML = '<div class="tbl-empty">불러오지 못했습니다</div>'; return; }
    var ready = pick(res, 'ready');
    _tsItems = pick(res, 'sections') || [];
    if (ready === false) {
      list.innerHTML = '<div class="tbl-empty">저장소 준비가 아직 끝나지 않았습니다. ' +
        '관리자 주소창에 <code>/api/migrate-memorial-sections?run=1</code> 을 한 번 실행해 주세요.</div>';
      return;
    }
    if (!_tsItems.length) {
      list.innerHTML = '<div class="tbl-empty">아직 만든 구간이 없습니다. 위에서 하나 만들어 보세요.</div>';
      return;
    }
    list.innerHTML = '<div class="tbl-wrap"><table><thead><tr>' +
      '<th style="width:60px">사진</th><th>제목</th><th style="width:70px">정렬</th>' +
      '<th style="width:70px">공개</th><th style="width:130px"></th>' +
      '</tr></thead><tbody>' +
      _tsItems.map(function (x) {
        var img = x.imageUrl
          ? '<img src="' + esc(x.imageUrl) + '" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px">'
          : '<div class="no-thumb" style="width:44px;height:44px;border-radius:6px"></div>';
        return '<tr>' +
          '<td>' + img + '</td>' +
          '<td><b>' + esc(x.title || '') + '</b></td>' +
          '<td>' + (x.sortOrder != null ? x.sortOrder : 0) + '</td>' +
          '<td><span class="status-pill ' + (x.isPublic ? 'on' : 'off') + '">' + (x.isPublic ? '공개' : '숨김') + '</span></td>' +
          '<td><div class="row-actions">' +
            '<button class="btn btn-ghost btn-sm" onclick="tsEdit(' + x.id + ')">수정</button>' +
            '<button class="btn btn-danger btn-sm" onclick="tsDelete(' + x.id + ')">삭제</button>' +
          '</div></td></tr>';
      }).join('') +
      '</tbody></table></div>';
  });
}

function tsEdit(id) {
  var x = _tsItems.filter(function (v) { return v.id === id; })[0];
  if (!x) return;
  document.getElementById('tsId').value = x.id;
  document.getElementById('tsTitle').value = x.title || '';
  document.getElementById('tsBody').value = x.body || '';
  document.getElementById('tsBlobId').value = x.imageBlobId || '';
  document.getElementById('tsSort').value = x.sortOrder != null ? x.sortOrder : 0;
  document.getElementById('tsPublic').value = x.isPublic ? 'true' : 'false';
  tsPreview(x.imageUrl);
  document.getElementById('tsTitle').focus();
}

function tsSave() {
  if (!_tsTeacherId) { toast('선생님을 먼저 저장해 주세요.', 'error'); return; }
  var title = document.getElementById('tsTitle').value.trim();
  if (!title) { toast('구간 제목을 입력하세요.', 'error'); return; }

  var blobId = document.getElementById('tsBlobId').value;
  var payload = {
    teacherId: _tsTeacherId,
    title: title,
    body: document.getElementById('tsBody').value.trim() || null,
    imageBlobId: blobId ? parseInt(blobId, 10) : null,
    sortOrder: parseInt(document.getElementById('tsSort').value, 10) || 0,
    isPublic: document.getElementById('tsPublic').value === 'true'
  };
  var id = document.getElementById('tsId').value;
  var method = id ? 'PATCH' : 'POST';
  var url = '/api/admin-memorial-teacher-sections' + (id ? '?id=' + id : '');

  callApi(method, url, payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    toast(id ? '수정되었습니다.' : '구간이 추가되었습니다.', 'success');
    tsResetForm();
    tsLoad();
  });
}

function tsDelete(id) {
  if (!confirm('이 구간을 지울까요? 되돌릴 수 없습니다.')) return;
  callApi('DELETE', '/api/admin-memorial-teacher-sections?id=' + id).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
    toast('삭제되었습니다.', 'success');
    tsResetForm();
    tsLoad();
  });
}

document.addEventListener('DOMContentLoaded', function () {
  var save = document.getElementById('tsSave');
  if (save) save.addEventListener('click', tsSave);
  var reset = document.getElementById('tsReset');
  if (reset) reset.addEventListener('click', tsResetForm);
});

/* =========================================================
   ★ 2026-10-07 정책국장 요청 — 유가족 근황 사진
   사진 파일은 기존 업로드 경로(/api/blob-upload)를 그대로 쓴다.
   ========================================================= */
function fnPhotoPreview(url) {
  var wrap = document.getElementById('fnPhotoWrap');
  if (!wrap) return;
  wrap.innerHTML = url
    ? '<img class="photo-preview" style="border-radius:10px;width:120px;height:80px" src="' + esc(url) + '" alt="">'
    : '<div class="photo-preview-empty" style="border-radius:10px"><span class="siren-icon-wrap" data-icon="image"></span></div>';
  if (window.Icons && window.Icons.hydrate) { try { window.Icons.hydrate(wrap); } catch (_) {} }
}
function fnClearPhoto() {
  setVal('fnPhotoBlobId', '');
  var f = document.getElementById('fnPhotoFile'); if (f) f.value = '';
  fnPhotoPreview('');
}
function fnUploadPhoto() {
  var input = document.getElementById('fnPhotoFile');
  var file = input && input.files && input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'memorial_family');
  fd.append('isPublic', 'true');
  toast('업로드 중…');
  fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; }); })
    .then(function (res) {
      if (!res.ok) { toast((res.data && (res.data.error || res.data.message)) || '업로드 실패', 'error'); return; }
      var id = (res.data && res.data.data && res.data.data.id) || (res.data && res.data.id) || (res.data && res.data.blobId);
      if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
      setVal('fnPhotoBlobId', id);
      fnPhotoPreview('/api/blob-image?id=' + id);
      toast('사진이 업로드되었습니다.', 'success');
    })
    .catch(function (e) { toast('업로드 실패: ' + e.message, 'error'); });
}

/* =========================================================
   ★ 2026-10-07 정책국장 요청 — 온기의 징검다리 (협의회가 걸어온 길, 시간순)
   ========================================================= */
var _tlItems = [];

function tlPhotoPreview(url) {
  var wrap = document.getElementById('tlPhotoWrap');
  if (!wrap) return;
  wrap.innerHTML = url
    ? '<img class="photo-preview" style="border-radius:10px;width:120px;height:80px" src="' + esc(url) + '" alt="">'
    : '<div class="photo-preview-empty" style="border-radius:10px"><span class="siren-icon-wrap" data-icon="image"></span></div>';
  if (window.Icons && window.Icons.hydrate) { try { window.Icons.hydrate(wrap); } catch (_) {} }
}
function tlClearPhoto() {
  setVal('tlBlobId', '');
  var f = document.getElementById('tlFile'); if (f) f.value = '';
  tlPhotoPreview('');
}
function tlUpload() {
  var input = document.getElementById('tlFile');
  var file = input && input.files && input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('file', file);
  fd.append('context', 'memorial_timeline');
  fd.append('isPublic', 'true');
  toast('업로드 중…');
  fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; }); })
    .then(function (res) {
      if (!res.ok) { toast((res.data && (res.data.error || res.data.message)) || '업로드 실패', 'error'); return; }
      var id = (res.data && res.data.data && res.data.data.id) || (res.data && res.data.id) || (res.data && res.data.blobId);
      if (!id) { toast('업로드 응답에 ID가 없습니다.', 'error'); return; }
      setVal('tlBlobId', id);
      tlPhotoPreview('/api/blob-image?id=' + id);
      toast('사진이 업로드되었습니다.', 'success');
    })
    .catch(function (e) { toast('업로드 실패: ' + e.message, 'error'); });
}

function tlReset() {
  ['tlId', 'tlDate', 'tlDateLabel', 'tlCategory', 'tlTitle', 'tlSummary', 'tlDetail', 'tlLink'].forEach(function (id) { setVal(id, ''); });
  setVal('tlSort', '0');
  var pub = document.getElementById('tlPublic'); if (pub) pub.checked = true;
  tlClearPhoto();
}

function tlLoad() {
  var box = document.getElementById('tlList');
  if (!box) return;
  box.innerHTML = '<div style="padding:20px;color:#888">불러오는 중…</div>';
  callApi('GET', '/api/admin-memorial-timeline').then(function (res) {
    if (!res.ok) {
      box.innerHTML = '<div style="padding:20px;color:#c00">불러오지 못했습니다. ' + esc((res.data && res.data.error) || '') + '</div>';
      return;
    }
    if (pick(res, 'ready') === false) {
      box.innerHTML = '<div class="tbl-empty">저장소 준비가 아직 끝나지 않았습니다. ' +
        '관리자 주소창에 <code>https://tbfa.co.kr/api/migrate-memorial-v3?run=1</code> 을 한 번 실행해 주세요.</div>';
      return;
    }
    _tlItems = pick(res, 'items') || [];
    if (!_tlItems.length) {
      box.innerHTML = '<div style="padding:24px;color:#888">등록된 징검다리가 없습니다. 위에서 첫 기록을 남겨보세요. (항목이 없으면 추모관 화면에서 이 구간은 보이지 않습니다)</div>';
      return;
    }
    box.innerHTML = '<table class="tbl"><thead><tr>' +
      '<th style="width:56px">순서</th><th style="width:120px">날짜</th><th style="width:70px">사진</th><th>제목</th>' +
      '<th style="width:120px">구분</th><th style="width:70px">공개</th><th style="width:150px">관리</th>' +
      '</tr></thead><tbody>' +
      _tlItems.map(function (x) {
        var thumb = x.photoUrl
          ? '<img src="' + esc(x.photoUrl) + '" alt="" style="width:56px;height:40px;object-fit:cover;border-radius:5px">'
          : '<span style="color:#bbb">—</span>';
        return '<tr>' +
          '<td>' + esc(x.sortOrder) + '</td>' +
          '<td style="white-space:nowrap">' + esc(x.dateLabel || '—') + '</td>' +
          '<td>' + thumb + '</td>' +
          '<td><b>' + esc(x.title) + '</b>' +
            (x.summary ? '<div style="color:#888;font-size:12px;margin-top:4px">' + esc(String(x.summary).slice(0, 60)) + '…</div>' : '') + '</td>' +
          '<td>' + esc(x.category || '—') + '</td>' +
          '<td>' + (x.isPublic ? '공개' : '<span style="color:#c00">숨김</span>') + '</td>' +
          '<td>' +
            '<button class="btn btn-sm" onclick="tlEdit(' + x.id + ')">수정</button> ' +
            '<button class="btn btn-sm" onclick="tlDelete(' + x.id + ')">삭제</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }).catch(function (e) {
    box.innerHTML = '<div style="padding:20px;color:#c00">오류: ' + esc(e.message) + '</div>';
  });
}

function tlEdit(id) {
  var x = _tlItems.filter(function (v) { return Number(v.id) === Number(id); })[0];
  if (!x) return;
  setVal('tlId', x.id);
  setVal('tlDate', x.eventDate || '');
  setVal('tlDateLabel', x.dateLabel && x.dateLabel !== (x.eventDate || '').replace(/-/g, '.') ? x.dateLabel : '');
  setVal('tlCategory', x.category || '');
  setVal('tlTitle', x.title || '');
  setVal('tlSummary', x.summary || '');
  setVal('tlDetail', x.detail || '');
  setVal('tlLink', x.linkUrl || '');
  setVal('tlSort', x.sortOrder != null ? x.sortOrder : 0);
  var pub = document.getElementById('tlPublic'); if (pub) pub.checked = x.isPublic !== false;
  setVal('tlBlobId', x.imageBlobId || '');
  tlPhotoPreview(x.photoUrl || '');
  var el = document.getElementById('tlTitle'); if (el) el.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function tlSave() {
  var id = val('tlId');
  var payload = {
    eventDate: val('tlDate') || null,
    dateLabel: val('tlDateLabel') || null,
    category: val('tlCategory') || null,
    title: val('tlTitle'),
    summary: val('tlSummary') || null,
    detail: val('tlDetail') || null,
    imageBlobId: Number(val('tlBlobId')) || null,
    linkUrl: val('tlLink') || null,
    sortOrder: Number(val('tlSort')) || 0,
    isPublic: !!(document.getElementById('tlPublic') || {}).checked
  };
  if (!payload.title) { toast('제목을 입력해 주세요.', 'error'); return; }
  if (!payload.eventDate && !payload.dateLabel) { toast('날짜 또는 날짜 표기 중 하나는 적어주세요.', 'error'); return; }

  var method = id ? 'PATCH' : 'POST';
  var url = '/api/admin-memorial-timeline' + (id ? '?id=' + encodeURIComponent(id) : '');
  callApi(method, url, payload).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '저장 실패', 'error'); return; }
    if (pick(res, 'ready') === false) { toast('저장소 준비(마이그레이션)가 아직 끝나지 않았습니다.', 'error'); return; }
    toast(id ? '수정되었습니다.' : '징검다리를 추가했습니다.', 'success');
    tlReset();
    tlLoad();
  }).catch(function (e) { toast('저장 실패: ' + e.message, 'error'); });
}

function tlDelete(id) {
  if (!confirm('이 징검다리를 삭제할까요? 되돌릴 수 없습니다.')) return;
  callApi('DELETE', '/api/admin-memorial-timeline?id=' + encodeURIComponent(id)).then(function (res) {
    if (!res.ok) { toast((res.data && res.data.error) || '삭제 실패', 'error'); return; }
    toast('삭제되었습니다.', 'success');
    tlReset();
    tlLoad();
  }).catch(function (e) { toast('삭제 실패: ' + e.message, 'error'); });
}

document.addEventListener('DOMContentLoaded', function () {
  var save = document.getElementById('tlSave');
  if (save) save.addEventListener('click', tlSave);
  var reset = document.getElementById('tlReset');
  if (reset) reset.addEventListener('click', tlReset);
});

/* =========================================================
   ★ 2026-10-07 정책국장 요청 — 고인별 초대 링크 · QR (선생님 편집)
   링크는 늘 공식 도메인(tbfa.co.kr)으로 만든다. QR은 누를 때만 작은 생성기를
   불러와 브라우저에서 그린다(외부 서비스 의존 없음).
   ========================================================= */
var INVITE_BASE = 'https://tbfa.co.kr/memorial-teacher.html';
var QR_LIB_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

function tInviteUrl(id) {
  return INVITE_BASE + '?id=' + encodeURIComponent(id) + '&invite=1';
}
function tInviteCopy() {
  var url = val('fInviteUrl');
  if (!url) { toast('선생님을 먼저 저장해 주세요.', 'error'); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () { toast('초대 링크를 복사했습니다.', 'success'); },
      function () { window.prompt('아래 링크를 복사해 주세요', url); });
  } else {
    window.prompt('아래 링크를 복사해 주세요', url);
  }
}
function loadQrLib() {
  return new Promise(function (resolve, reject) {
    if (window.qrcode) { resolve(); return; }
    var s = document.createElement('script');
    s.src = QR_LIB_SRC; s.async = true;
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('QR 생성기를 불러오지 못했습니다')); };
    document.head.appendChild(s);
  });
}
function tInviteQr() {
  var url = val('fInviteUrl');
  var box = document.getElementById('fInviteQr');
  if (!url || !box) { toast('선생님을 먼저 저장해 주세요.', 'error'); return; }
  box.innerHTML = '<span class="hint">QR을 그리는 중…</span>';
  loadQrLib().then(function () {
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var dataUrl = qr.createDataURL(6, 12);
    var t = _teachers.filter(function (x) { return x.id === _editingTeacherId; })[0];
    var fname = (t && t.name ? t.name + '-' : '') + '초대장-QR.png';
    box.innerHTML =
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
        '<img src="' + dataUrl + '" alt="초대 링크 QR" style="width:150px;height:150px;border:1px solid #e5e7eb;border-radius:8px;background:#fff">' +
        '<div><a class="btn btn-ghost btn-sm" href="' + dataUrl + '" download="' + esc(fname) + '" style="text-decoration:none;display:inline-block">QR 이미지 저장</a>' +
        '<div class="hint" style="margin-top:6px">인쇄물·안내문에 넣어 쓰실 수 있습니다.</div></div>' +
      '</div>';
  }).catch(function (e) {
    box.innerHTML = '<span class="hint" style="color:#c00">' + esc(e.message || 'QR 코드를 만들지 못했습니다') + '</span>';
  });
}
