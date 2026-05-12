/* ============================================================
   admin-agency-mgmt.js — Phase 14 외부 기관 관리
   섹션: adm-agency-mgmt
   ============================================================ */

(function () {
  'use strict';

  /* ── 기관 유형 레이블 ── */
  var AGENCY_TYPE_LABELS = {
    police: '경찰',
    education: '교육청',
    legal: '법률기관',
    other: '기타'
  };

  /* ── 상태 변수 ── */
  var agencies = [];
  var editingAgencyId = null;

  /* ── DOM 진입점 ── */
  var $section = null;

  /* ────────────────────────────────────────────────
     초기화
  ──────────────────────────────────────────────── */
  function init() {
    $section = document.getElementById('adm-agency-mgmt');
    if (!$section) return;

    if (!document.getElementById('amgList')) {
      renderShell();
      bindEvents();
    }
    loadAgencies();
  }

  /* ── 빈 HTML 골격 렌더 ── */
  function renderShell() {
    $section.innerHTML = [
      '<div class="panel">',
      '  <div class="adm-page-header" style="margin-bottom:20px">',
      '    <h2 class="serif" style="margin:0">🏛️ 외부 기관 관리</h2>',
      '    <button id="amgBtnAdd" class="btn-primary" style="margin-left:auto">+ 기관 등록</button>',
      '  </div>',
      '  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">',
      '    <select id="amgFilterType" style="padding:7px 12px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;background:#fff">',
      '      <option value="">전체 유형</option>',
      '      <option value="police">경찰</option>',
      '      <option value="education">교육청</option>',
      '      <option value="legal">법률기관</option>',
      '      <option value="other">기타</option>',
      '    </select>',
      '    <select id="amgFilterActive" style="padding:7px 12px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;background:#fff">',
      '      <option value="true">활성 기관만</option>',
      '      <option value="">전체</option>',
      '      <option value="false">비활성</option>',
      '    </select>',
      '    <button id="amgBtnRefresh" class="btn-sm btn-sm-ghost">새로고침</button>',
      '  </div>',
      '  <div id="amgList"></div>',
      '</div>',
      '<div id="amgModal" class="modal">',
      '  <div class="modal-content" style="max-width:640px">',
      '    <div class="modal-header">',
      '      <h3 class="serif" id="amgModalTitle">기관 등록</h3>',
      '      <button class="modal-close" id="amgModalClose">&times;</button>',
      '    </div>',
      '    <div class="modal-body">',
      '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">기관명 <span style="color:var(--danger)">*</span></label>',
      '          <input id="amgFldName" type="text" placeholder="예: 서울강남경찰서" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box">',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">기관 유형 <span style="color:var(--danger)">*</span></label>',
      '          <select id="amgFldType" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;background:#fff">',
      '            <option value="">선택</option>',
      '            <option value="police">경찰</option>',
      '            <option value="education">교육청</option>',
      '            <option value="legal">법률기관</option>',
      '            <option value="other">기타</option>',
      '          </select>',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">담당자명</label>',
      '          <input id="amgFldContactName" type="text" placeholder="홍길동" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box">',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">전화번호</label>',
      '          <input id="amgFldPhone" type="text" placeholder="02-0000-0000" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box">',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">이메일</label>',
      '          <input id="amgFldEmail" type="email" placeholder="contact@agency.go.kr" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box">',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">관할 영역</label>',
      '          <input id="amgFldJurisdiction" type="text" placeholder="예: 서울 강남구" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box">',
      '        </div>',
      '      </div>',
      '      <div style="margin-top:14px">',
      '        <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:5px">',
      '          인계 양식 본문',
      '          <span style="font-weight:400;color:var(--text-3);margin-left:6px;font-size:11px">{{기관명}} {{신고번호}} {{피해자명}} {{발생일시}} {{사건내용}} {{AI요약}} {{AI심각도}} {{인계일시}} {{인계담당자}} 사용 가능</span>',
      '        </label>',
      '        <textarea id="amgFldTemplate" rows="8" placeholder="수신: {{기관명}}&#10;발신: (사)교사유가족협의회&#10;제목: 사건 인계 요청&#10;&#10;사건번호: {{신고번호}}&#10;피해자: {{피해자명}}&#10;발생일시: {{발생일시}}&#10;&#10;사건 내용:&#10;{{사건내용}}&#10;&#10;위 사건을 귀 기관에 인계하오니 검토 부탁드립니다." style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.6"></textarea>',
      '      </div>',
      '    </div>',
      '    <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--line)">',
      '      <button id="amgBtnCancel" class="btn-sm btn-sm-ghost">취소</button>',
      '      <button id="amgBtnSave" class="btn-sm btn-sm-primary">저장</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('
');
  }

  /* ────────────────────────────────────────────────
     이벤트 바인딩
  ──────────────────────────────────────────────── */
  function bindEvents() {
    $section.addEventListener('click', function (e) {
      var t = e.target;

      if (t.id === 'amgBtnAdd') openModal(null);
      if (t.id === 'amgBtnRefresh') loadAgencies();
      if (t.id === 'amgModalClose' || t.id === 'amgBtnCancel') closeModal();
      if (t.id === 'amgBtnSave') saveAgency();

      /* 행 액션 버튼 */
      var editBtn = t.closest('[data-amg-edit]');
      if (editBtn) openModal(parseInt(editBtn.dataset.amgEdit, 10));

      var deleteBtn = t.closest('[data-amg-delete]');
      if (deleteBtn) confirmDelete(parseInt(deleteBtn.dataset.amgDelete, 10));
    });

    $section.addEventListener('change', function (e) {
      if (e.target.id === 'amgFilterType' || e.target.id === 'amgFilterActive') {
        loadAgencies();
      }
    });
  }

  /* ────────────────────────────────────────────────
     데이터 로드
  ──────────────────────────────────────────────── */
  function loadAgencies() {
    var listEl = document.getElementById('amgList');
    if (!listEl) return;
    listEl.innerHTML = '<p style="text-align:center;color:var(--text-3);padding:30px">로딩 중…</p>';

    var type = (document.getElementById('amgFilterType') || {}).value || '';
    var active = (document.getElementById('amgFilterActive') || {}).value;
    var qs = [];
    if (type) qs.push('type=' + encodeURIComponent(type));
    if (active === 'true') qs.push('active=1');
    else if (active === 'false') qs.push('active=0');
    var url = '/api/admin-agency-list' + (qs.length ? '?' + qs.join('&') : '');

    api({ url: url }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
      var d = res.data.data || res.data;
      agencies = (d.agencies || []);
      renderList();
    }).catch(function (err) {
      listEl.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">불러오기 실패: ' + err.message + '</p>';
    });
  }

  /* ────────────────────────────────────────────────
     목록 렌더
  ──────────────────────────────────────────────── */
  function renderList() {
    var listEl = document.getElementById('amgList');
    if (!listEl) return;

    if (!agencies.length) {
      listEl.innerHTML = [
        '<div style="text-align:center;padding:60px 20px">',
        '  <p style="font-size:36px;margin:0 0 12px">📭</p>',
        '  <p style="color:var(--text-3);margin:0 0 20px;font-size:14px">등록된 기관이 없습니다.</p>',
        '  <button id="amgBtnAddEmpty" class="btn-sm btn-sm-primary">+ 기관 등록</button>',
        '</div>'
      ].join('');
      var addEmptyBtn = document.getElementById('amgBtnAddEmpty');
      if (addEmptyBtn) addEmptyBtn.addEventListener('click', function () { openModal(null); });
      return;
    }

    var rows = agencies.map(function (ag) {
      var typeLabel = AGENCY_TYPE_LABELS[ag.agencyType] || ag.agencyType;
      var activeBadge = ag.isActive
        ? '<span class="badge b-success">활성</span>'
        : '<span class="badge b-mute">비활성</span>';
      var templateBadge = ag.hasTemplate
        ? '<span class="badge b-info">양식 있음</span>'
        : '<span class="badge b-mute">양식 없음</span>';
      return [
        '<tr>',
        '  <td style="font-weight:600">' + esc(ag.name) + '</td>',
        '  <td>' + esc(typeLabel) + '</td>',
        '  <td>' + esc(ag.contactName || '-') + '</td>',
        '  <td>' + esc(ag.contactPhone || '-') + '</td>',
        '  <td>' + esc(ag.jurisdiction || '-') + '</td>',
        '  <td>' + templateBadge + '</td>',
        '  <td>' + activeBadge + '</td>',
        '  <td style="white-space:nowrap">',
        '    <button data-amg-edit="' + ag.id + '" class="btn-sm btn-sm-ghost" style="margin-right:4px">수정</button>',
        '    <button data-amg-delete="' + ag.id + '" class="btn-sm" style="background:var(--danger);color:#fff;border-color:var(--danger)">비활성화</button>',
        '  </td>',
        '</tr>'
      ].join('');
    });

    listEl.innerHTML = [
      '<table class="tbl">',
      '  <thead><tr>',
      '    <th>기관명</th><th>유형</th><th>담당자</th><th>전화</th><th>관할</th><th>양식</th><th>상태</th><th style="width:160px">관리</th>',
      '  </tr></thead>',
      '  <tbody>' + rows.join('') + '</tbody>',
      '</table>'
    ].join('');
  }

  /* ────────────────────────────────────────────────
     모달
  ──────────────────────────────────────────────── */
  function openModal(id) {
    editingAgencyId = id;
    var modal = document.getElementById('amgModal');
    var title = document.getElementById('amgModalTitle');
    if (!modal) return;

    /* 필드 초기화 */
    setField('amgFldName', '');
    setField('amgFldType', '');
    setField('amgFldContactName', '');
    setField('amgFldPhone', '');
    setField('amgFldEmail', '');
    setField('amgFldJurisdiction', '');
    setField('amgFldTemplate', '');

    if (id !== null) {
      title.textContent = '기관 수정';
      var ag = agencies.find(function (a) { return a.id === id; });
      if (ag) {
        setField('amgFldName', ag.name || '');
        setField('amgFldType', ag.agencyType || '');
        setField('amgFldContactName', ag.contactName || '');
        setField('amgFldPhone', ag.contactPhone || '');
        setField('amgFldEmail', ag.contactEmail || '');
        setField('amgFldJurisdiction', ag.jurisdiction || '');
        setField('amgFldTemplate', ag.templateBody || '');
      }
    } else {
      title.textContent = '기관 등록';
    }

    modal.classList.add('show');
  }

  function closeModal() {
    var modal = document.getElementById('amgModal');
    if (modal) modal.classList.remove('show');
    editingAgencyId = null;
  }

  /* ────────────────────────────────────────────────
     저장
  ──────────────────────────────────────────────── */
  function saveAgency() {
    var name = getField('amgFldName').trim();
    var agencyType = getField('amgFldType');
    if (!name || !agencyType) {
      showToast('기관명과 기관 유형은 필수입니다.', 'error');
      return;
    }

    var body = {
      name: name,
      agencyType: agencyType,
      contactName: getField('amgFldContactName').trim(),
      contactPhone: getField('amgFldPhone').trim(),
      contactEmail: getField('amgFldEmail').trim(),
      jurisdiction: getField('amgFldJurisdiction').trim(),
      templateBody: getField('amgFldTemplate').trim()
    };
    if (editingAgencyId !== null) body.id = editingAgencyId;

    var saveBtn = document.getElementById('amgBtnSave');
    if (saveBtn) saveBtn.disabled = true;

    api({ url: '/api/admin-agency-upsert', method: 'POST', body: body }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
      closeModal();
      loadAgencies();
      showToast(editingAgencyId !== null ? '기관 정보를 수정했습니다.' : '기관을 등록했습니다.', 'success');
    }).catch(function (err) {
      showToast('저장 실패: ' + err.message, 'error');
    }).finally(function () {
      if (saveBtn) saveBtn.disabled = false;
    });
  }

  /* ────────────────────────────────────────────────
     비활성화
  ──────────────────────────────────────────────── */
  function confirmDelete(id) {
    var ag = agencies.find(function (a) { return a.id === id; });
    if (!ag) return;
    if (!confirm('"' + ag.name + '"을(를) 비활성화하시겠습니까?')) return;

    api({ url: '/api/admin-agency-delete', method: 'POST', body: { id: id } }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
      loadAgencies();
      showToast('기관을 비활성화했습니다.', 'success');
    }).catch(function (err) {
      showToast('비활성화 실패: ' + err.message, 'error');
    });
  }

  /* ────────────────────────────────────────────────
     유틸
  ──────────────────────────────────────────────── */
  function getField(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function setField(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }
  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function showToast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    alert(msg);
  }
  function api(opts) {
    if (typeof window.api === 'function') return window.api(opts);
    /* 폴백 fetch */
    return fetch(opts.url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'include'
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  }

  /* ────────────────────────────────────────────────
     SPA 페이지 전환 감지
  ──────────────────────────────────────────────── */
  document.addEventListener('siren:page', function (e) {
    if (e.detail && e.detail.page === 'agency-mgmt') {
      init();
    }
  });

  /* 직접 진입(새로고침) 대응 */
  document.addEventListener('DOMContentLoaded', function () {
    if (window.location.hash === '#agency-mgmt') init();
  });

  /* 전역 노출 (SPA 라우터가 호출할 수 있도록) */
  function reload() { init(); }
  window.adminAgencyMgmt = { init: init, reload: reload };

})();
