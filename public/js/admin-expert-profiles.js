/* =========================================================
   SIREN — admin-expert-profiles.js
   Phase 15: 전문가 프로필 관리
   - 전문가 목록 조회·수정·수락 여부 토글
   ========================================================= */
(function () {
  'use strict';

  var SUBTYPE_LABEL = { lawyer: '변호사', counselor: '심리상담사' };

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

  /* ─── 별점 렌더 ─── */
  function renderStars(avg) {
    var full = Math.floor(avg);
    var half = (avg - full) >= 0.5;
    var html = '';
    for (var i = 1; i <= 5; i++) {
      if (i <= full) html += '<span style="color:#f59e0b">★</span>';
      else if (i === full + 1 && half) html += '<span style="color:#f59e0b">☆</span>';
      else html += '<span style="color:#d1d5db">★</span>';
    }
    return html + ' <span style="font-size:12px;color:var(--text-3)">' + avg.toFixed(1) + '</span>';
  }

  /* ─── 패널 껍데기 (1회 렌더) ─── */
  function renderShell() {
    var page = document.getElementById('adm-expert-profiles');
    if (!page || page.dataset.profInit === '1') return;
    page.dataset.profInit = '1';

    page.innerHTML =
      '<div class="panel">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">' +
          '<h3 style="margin:0">전문가 프로필 관리</h3>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<select id="profTypeFilter" style="padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">' +
              '<option value="">전체 유형</option>' +
              '<option value="lawyer">변호사</option>' +
              '<option value="counselor">심리상담사</option>' +
            '</select>' +
            '<button class="btn-sm btn-sm-ghost" id="btnProfRefresh" type="button">새로고침</button>' +
          '</div>' +
        '</div>' +
        '<table class="tbl">' +
          '<thead><tr>' +
            '<th>이름</th>' +
            '<th style="width:120px">유형</th>' +
            '<th>전문 분야</th>' +
            '<th style="width:160px">평점</th>' +
            '<th style="width:100px">수락 상태</th>' +
            '<th style="width:100px">작업</th>' +
          '</tr></thead>' +
          '<tbody id="profTbody">' +
            '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +

      /* ─── 편집 모달 ─── */
      '<div id="profEditModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
        'z-index:9999;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto">' +
        '<div style="background:#fff;border-radius:12px;max-width:480px;width:100%;' +
             'box-shadow:0 20px 60px rgba(0,0,0,0.3);margin:auto;overflow:hidden">' +
          '<div style="padding:16px 22px;background:var(--ink);color:#fff;' +
               'display:flex;justify-content:space-between;align-items:center">' +
            '<div style="font-weight:700;font-size:15px">전문가 프로필 수정</div>' +
            '<button id="btnProfModalClose" style="background:transparent;border:none;color:#fff;font-size:24px;cursor:pointer;line-height:1">&times;</button>' +
          '</div>' +
          '<div style="padding:20px 24px">' +
            '<div id="profEditInfo" style="background:var(--bg-soft);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px"></div>' +
            '<div class="fg">' +
              '<label>전문 분야 <span class="hint">(쉼표 구분)</span></label>' +
              '<input type="text" id="profSpecialtiesInput" maxlength="200" placeholder="예: 학교폭력, 노동법">' +
            '</div>' +
            '<div class="fg" style="margin-top:10px">' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
                '<input type="checkbox" id="profAcceptingCheck" style="width:16px;height:16px">' +
                '<span>신규 의뢰 수락 중</span>' +
              '</label>' +
            '</div>' +
            '<div style="display:flex;gap:10px;margin-top:16px">' +
              '<button class="btn btn-primary" id="btnProfSave" type="button">저장</button>' +
              '<button class="btn" id="btnProfCancelEdit" type="button" ' +
                'style="background:transparent;border:1px solid var(--line);color:var(--text-2)">취소</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ─── 행 렌더 ─── */
  function renderRow(p) {
    var subtypeLabel = SUBTYPE_LABEL[p.memberSubtype] || p.memberSubtype;
    var specialties  = (p.specialties || []).join(', ') || '-';
    var acceptBadge  = p.isAcceptingCase
      ? '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#dcfce7;color:#16a34a">수락 중</span>'
      : '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#f3f4f6;color:#6b7280">중단</span>';
    return '' +
      '<tr>' +
        '<td><strong>' + escapeHtml(p.name) + '</strong></td>' +
        '<td>' +
          '<span style="background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-size:11.5px;font-weight:600">' +
            escapeHtml(subtypeLabel) +
          '</span>' +
        '</td>' +
        '<td style="font-size:12.5px">' + escapeHtml(specialties) + '</td>' +
        '<td>' + renderStars(p.avgRating || 0) +
          ' <span style="font-size:11.5px;color:var(--text-3)">(' + (p.ratingCount || 0) + '건)</span>' +
        '</td>' +
        '<td>' + acceptBadge + '</td>' +
        '<td>' +
          '<button class="btn-sm btn-sm-ghost" data-prof-edit="' + p.memberId + '" ' +
            'data-prof-name="' + escapeHtml(p.name) + '" ' +
            'data-prof-specialties="' + escapeHtml(specialties === '-' ? '' : specialties) + '" ' +
            'data-prof-accepting="' + (p.isAcceptingCase ? '1' : '0') + '" ' +
            'type="button">편집</button>' +
        '</td>' +
      '</tr>';
  }

  /* ─── 목록 로드 ─── */
  async function load() {
    renderShell();
    var tbody = document.getElementById('profTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-3)">불러오는 중...</td></tr>';

    var typeFilter = (document.getElementById('profTypeFilter') || {}).value || '';
    var profiles = [];

    var r = await api('/api/admin-expert-profile-get?all=true');
    if (!r.ok) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#b91c1c">로드 실패: ' +
        escapeHtml((r.data && r.data.error) || ('HTTP ' + r.status)) + '</td></tr>';
      return;
    }
    profiles = (r.data && r.data.profiles) || (r.data && r.data.data && r.data.data.profiles) || [];

    if (typeFilter) {
      profiles = profiles.filter(function (p) { return p.memberSubtype === typeFilter; });
    }

    if (!profiles.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">등록된 전문가가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = profiles.map(renderRow).join('');
  }

  /* ─── 편집 모달 열기/닫기 ─── */
  var _editTarget = null;

  function openEditModal(btn) {
    _editTarget = {
      memberId:   Number(btn.dataset.profEdit),
      name:       btn.dataset.profName || '',
      specialties: btn.dataset.profSpecialties || '',
      accepting:  btn.dataset.profAccepting === '1',
    };
    var info = document.getElementById('profEditInfo');
    if (info) info.innerHTML = '<strong>' + escapeHtml(_editTarget.name) + '</strong> 프로필을 수정합니다.';
    var specInput = document.getElementById('profSpecialtiesInput');
    if (specInput) specInput.value = _editTarget.specialties;
    var check = document.getElementById('profAcceptingCheck');
    if (check) check.checked = _editTarget.accepting;
    var modal = document.getElementById('profEditModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeEditModal() {
    var modal = document.getElementById('profEditModal');
    if (modal) modal.style.display = 'none';
    _editTarget = null;
  }

  /* ─── 저장 ─── */
  async function doSave() {
    if (!_editTarget) return;
    var specInput = document.getElementById('profSpecialtiesInput');
    var check     = document.getElementById('profAcceptingCheck');
    var specialties  = (specInput && specInput.value.trim()) || '';
    var isAccepting  = check ? check.checked : false;

    var btn = document.getElementById('btnProfSave');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    var r = await api('/api/admin-expert-profile-upsert', {
      method: 'POST',
      body: {
        memberId:       _editTarget.memberId,
        specialties:    specialties.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        isAcceptingCase: isAccepting,
      },
    });
    if (!r.ok) {
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
      return toast('저장 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status)));
    }
    toast('프로필이 수정되었습니다.');

    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
    closeEditModal();
    load();
  }

  /* ─── 이벤트 위임 ─── */
  document.addEventListener('click', function (e) {
    /* 편집 버튼 */
    var editBtn = e.target.closest && e.target.closest('[data-prof-edit]');
    if (editBtn) { e.preventDefault(); openEditModal(editBtn); return; }

    /* 저장 */
    var saveBtn = e.target.closest && e.target.closest('#btnProfSave');
    if (saveBtn) { e.preventDefault(); doSave(); return; }

    /* 모달 닫기 */
    var closeBtn = e.target.closest && e.target.closest('#btnProfModalClose, #btnProfCancelEdit');
    if (closeBtn) { closeEditModal(); return; }
    var modal = document.getElementById('profEditModal');
    if (modal && e.target === modal) { closeEditModal(); return; }

    /* 새로고침 */
    var refBtn = e.target.closest && e.target.closest('#btnProfRefresh');
    if (refBtn) { e.preventDefault(); load(); return; }

    /* 사이드 메뉴 클릭 */
    var menuLink = e.target.closest && e.target.closest('[data-page="expert-profiles"]');
    if (menuLink) { setTimeout(load, 30); return; }
  });

  /* 필터 변경 */
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'profTypeFilter') load();
  });

  window.SIREN_ADMIN_EXPERT_PROFILES = { load: load };
})();
