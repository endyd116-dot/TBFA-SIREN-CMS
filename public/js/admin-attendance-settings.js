/**
 * admin-attendance-settings.js — 근태관리 설정
 * 거점 CRUD + 휴가 종류 CRUD + 근태 정책 수정
 */
(function () {
  'use strict';

  var state = { wps: [], lts: [], policy: null };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function(m){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m]; }); }

  async function api(path, opts) {
    opts = opts || {};
    var r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: opts.method || 'GET',
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    var data = null;
    try { data = await r.json(); } catch(_) {}
    if (!r.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + r.status);
    return data;
  }

  function toast(msg, type) {
    var root = $('#attToast') || document.body;
    var el = document.createElement('div');
    el.style.cssText = 'padding:12px 18px;border-radius:8px;color:#fff;font-size:13.5px;box-shadow:0 4px 12px rgba(0,0,0,.15);'
      + 'background:' + (type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#334155');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function() { el.remove(); }, 3000);
  }

  /* ── 탭 전환 ── */
  function initTabs() {
    $$('.att-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        $$('.att-tab').forEach(function(b) { b.classList.remove('active'); });
        $$('.att-tab-panel').forEach(function(p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var panelId = 'tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
        var panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
        if (btn.dataset.tab === 'leavetypes' && !state.lts.length) loadLeaveTypes();
        if (btn.dataset.tab === 'policy' && !state.policy) loadPolicy();
        // 재택보고서·근무형태 탭은 버튼 클릭으로 수동 조회 (회원 미선택 상태이므로 자동 로드 X)
      });
    });
  }

  /* ════════════════════════════════════════
     거점 관리
  ════════════════════════════════════════ */
  async function loadWorkplaces() {
    try {
      var res = await api('/api/admin-att-workplaces');
      state.wps = (res.data && res.data.workplaces) || res.workplaces || [];
      renderWpTable();
    } catch(e) {
      $('#wpBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderWpTable() {
    var tbody = $('#wpBody');
    if (!state.wps.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:32px">등록된 거점이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = state.wps.map(function(w) {
      var badge = w.isActive !== false
        ? '<span class="att-badge active">활성</span>'
        : '<span class="att-badge inactive">비활성</span>';
      return '<tr>'
        + '<td style="font-weight:500">' + esc(w.name) + '</td>'
        + '<td style="font-size:12.5px;color:#6b7280">' + esc(w.address || '—') + '</td>'
        + '<td style="font-family:Inter;font-size:12px">' + (w.lat != null ? w.lat : '—') + '</td>'
        + '<td style="font-family:Inter;font-size:12px">' + (w.lng != null ? w.lng : '—') + '</td>'
        + '<td>' + esc(w.allowedRadius || 200) + 'm</td>'
        + '<td>' + badge + '</td>'
        + '<td><div style="display:flex;gap:6px">'
          + '<button class="att-btn secondary" style="padding:4px 10px;font-size:12px" onclick="editWp(' + w.id + ')">수정</button>'
          + '<button class="att-btn danger" style="padding:4px 10px;font-size:12px" onclick="deleteWp(' + w.id + ',\'' + esc(w.name) + '\')">삭제</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
  }

  function openWpModal(wp) {
    $('#wpModalTitle').textContent = wp ? '거점 수정' : '거점 추가';
    $('#wpId').value = wp ? wp.id : '';
    $('#wpName').value = wp ? wp.name : '';
    $('#wpAddress').value = wp ? (wp.address || '') : '';
    $('#wpLat').value = wp && wp.lat != null ? wp.lat : '';
    $('#wpLng').value = wp && wp.lng != null ? wp.lng : '';
    $('#wpRadius').value = wp ? (wp.allowedRadius || 200) : 200;
    $('#wpModal').classList.add('open');
  }

  window.editWp = function(id) {
    var w = state.wps.find(function(x) { return x.id === id; });
    if (w) openWpModal(w);
  };

  window.deleteWp = async function(id, name) {
    if (!confirm('[' + name + '] 거점을 삭제하시겠습니까?')) return;
    try {
      await api('/api/admin-att-workplaces?id=' + id, { method: 'DELETE' });
      toast('삭제 완료', 'success');
      await loadWorkplaces();
    } catch(e) { toast('삭제 실패: ' + e.message, 'error'); }
  };

  async function saveWp() {
    var id = $('#wpId').value;
    var payload = {
      name: $('#wpName').value.trim(),
      address: $('#wpAddress').value.trim(),
      lat: $('#wpLat').value ? parseFloat($('#wpLat').value) : null,
      lng: $('#wpLng').value ? parseFloat($('#wpLng').value) : null,
      allowedRadius: parseInt($('#wpRadius').value || 200),
    };
    if (!payload.name) { toast('거점명은 필수입니다', 'error'); return; }
    try {
      if (id) {
        payload.id = Number(id);
        await api('/api/admin-att-workplaces', { method: 'PUT', body: payload });
        toast('거점 수정 완료', 'success');
      } else {
        await api('/api/admin-att-workplaces', { method: 'POST', body: payload });
        toast('거점 추가 완료', 'success');
      }
      $('#wpModal').classList.remove('open');
      await loadWorkplaces();
    } catch(e) { toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ════════════════════════════════════════
     휴가 종류
  ════════════════════════════════════════ */
  async function loadLeaveTypes() {
    try {
      var res = await api('/api/admin-att-leave-types');
      state.lts = (res.data && res.data.leaveTypes) || res.leaveTypes || [];
      renderLtTable();
    } catch(e) {
      $('#ltBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderLtTable() {
    var tbody = $('#ltBody');
    if (!state.lts.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:32px">등록된 휴가 종류가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = state.lts.map(function(lt) {
      var badge = lt.isActive !== false
        ? '<span class="att-badge active">활성</span>'
        : '<span class="att-badge inactive">비활성</span>';
      return '<tr>'
        + '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px">' + esc(lt.code) + '</code></td>'
        + '<td style="font-weight:500">' + esc(lt.name) + '</td>'
        + '<td style="text-align:center">' + esc(lt.defaultDays != null ? lt.defaultDays : '—') + '일</td>'
        + '<td style="text-align:center">' + (lt.allowHalfDay ? '✅' : '—') + '</td>'
        + '<td style="text-align:center">' + (lt.isPaid !== false ? '✅' : '무급') + '</td>'
        + '<td>' + badge + '</td>'
        + '<td><div style="display:flex;gap:6px">'
          + '<button class="att-btn secondary" style="padding:4px 10px;font-size:12px" onclick="editLt(' + lt.id + ')">수정</button>'
          + '<button class="att-btn danger" style="padding:4px 10px;font-size:12px" onclick="deleteLt(' + lt.id + ',\'' + esc(lt.name) + '\')">삭제</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
  }

  function openLtModal(lt) {
    $('#ltModalTitle').textContent = lt ? '휴가 종류 수정' : '휴가 종류 추가';
    $('#ltId').value = lt ? lt.id : '';
    $('#ltCode').value = lt ? lt.code : '';
    $('#ltCode').disabled = !!lt;
    $('#ltName').value = lt ? lt.name : '';
    $('#ltDefaultDays').value = lt && lt.defaultDays != null ? lt.defaultDays : '';
    $('#ltMaxDays').value = lt && lt.maxDays != null ? lt.maxDays : '';
    $('#ltHalfDay').checked = !!(lt && lt.allowHalfDay);
    $('#ltPaid').checked = !(lt && lt.isPaid === false);
    $('#ltDesc').value = lt ? (lt.description || '') : '';
    $('#ltModal').classList.add('open');
  }

  window.editLt = function(id) {
    var lt = state.lts.find(function(x) { return x.id === id; });
    if (lt) openLtModal(lt);
  };

  window.deleteLt = async function(id, name) {
    if (!confirm('[' + name + '] 휴가 종류를 삭제하시겠습니까?')) return;
    try {
      await api('/api/admin-att-leave-types?id=' + id, { method: 'DELETE' });
      toast('삭제 완료', 'success');
      await loadLeaveTypes();
    } catch(e) { toast('삭제 실패: ' + e.message, 'error'); }
  };

  async function saveLt() {
    var id = $('#ltId').value;
    var payload = {
      code: $('#ltCode').value.trim(),
      name: $('#ltName').value.trim(),
      defaultDays: $('#ltDefaultDays').value ? parseFloat($('#ltDefaultDays').value) : null,
      maxDays: $('#ltMaxDays').value ? parseFloat($('#ltMaxDays').value) : null,
      allowHalfDay: $('#ltHalfDay').checked,
      isPaid: $('#ltPaid').checked,
      description: $('#ltDesc').value.trim() || null,
    };
    if (!payload.code || !payload.name) { toast('코드와 이름은 필수입니다', 'error'); return; }
    try {
      if (id) {
        payload.id = Number(id);
        await api('/api/admin-att-leave-types', { method: 'PUT', body: payload });
        toast('수정 완료', 'success');
      } else {
        await api('/api/admin-att-leave-types', { method: 'POST', body: payload });
        toast('추가 완료', 'success');
      }
      $('#ltModal').classList.remove('open');
      await loadLeaveTypes();
    } catch(e) { toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ════════════════════════════════════════
     근태 정책
  ════════════════════════════════════════ */
  async function loadPolicy() {
    try {
      var res = await api('/api/admin-att-policy');
      state.policy = (res.data && res.data.policy) || res.policy || {};
      renderPolicy();
    } catch(e) {
      $('#policyView').innerHTML = '<div style="color:#ef4444">로드 실패: ' + esc(e.message) + '</div>';
    }
  }

  var _policyEditing = false;
  var POLICY_FIELDS = [
    { key: 'workStartTime',     label: '업무 시작 시간',       unit: '' },
    { key: 'workEndTime',       label: '업무 종료 시간',       unit: '' },
    { key: 'lateThresholdMin',  label: '지각 기준 (분)',       unit: '분' },
    { key: 'earlyLeaveThresholdMin', label: '조기퇴근 기준', unit: '분' },
    { key: 'defaultLocationRadius', label: '기본 위치 허용 반경', unit: 'm' },
    { key: 'overtimeThresholdMin',  label: '야근 기준 (분)',  unit: '분' },
  ];

  function renderPolicy() {
    var p = state.policy || {};
    var html = POLICY_FIELDS.map(function(f) {
      var val = p[f.key] != null ? p[f.key] : '미설정';
      return '<div class="att-policy-field">'
        + '<div class="att-policy-label">' + esc(f.label) + '</div>'
        + '<div class="att-policy-value" id="pv-' + f.key + '">' + esc(String(val)) + (val !== '미설정' && f.unit ? ' ' + f.unit : '') + '</div>'
        + '<div class="att-policy-edit" id="pe-' + f.key + '">'
          + '<input type="text" style="width:120px;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px" id="pi-' + f.key + '" value="' + esc(val !== '미설정' ? String(val) : '') + '">'
          + (f.unit ? '<span style="font-size:12px;color:#6b7280">' + f.unit + '</span>' : '')
        + '</div>'
        + '</div>';
    }).join('');
    $('#policyView').innerHTML = html;
    document.getElementById('policyEditRow').style.display = _policyEditing ? '' : 'none';
    POLICY_FIELDS.forEach(function(f) {
      var view = document.getElementById('pv-' + f.key);
      var edit = document.getElementById('pe-' + f.key);
      if (view) view.style.display = _policyEditing ? 'none' : '';
      if (edit) edit.style.display = _policyEditing ? 'flex' : 'none';
    });
    if (!_policyEditing) {
      var editBtn = document.createElement('button');
      editBtn.className = 'att-btn secondary';
      editBtn.textContent = '✏️ 수정';
      editBtn.style.marginTop = '16px';
      editBtn.addEventListener('click', function() { _policyEditing = true; renderPolicy(); });
      $('#policyView').appendChild(editBtn);
    }
  }

  async function savePolicy() {
    var p = {};
    POLICY_FIELDS.forEach(function(f) {
      var el = document.getElementById('pi-' + f.key);
      if (el && el.value.trim()) {
        var v = el.value.trim();
        p[f.key] = isNaN(Number(v)) ? v : (v.includes(':') ? v : Number(v));
      }
    });
    try {
      await api('/api/admin-att-policy', { method: 'PUT', body: { policy: p } });
      state.policy = Object.assign(state.policy || {}, p);
      _policyEditing = false;
      renderPolicy();
      toast('근태 정책 저장 완료', 'success');
    } catch(e) { toast('저장 실패: ' + e.message, 'error'); }
  }

  /* ════════════════════════════════════════
     재택보고서 모니터링
  ════════════════════════════════════════ */
  var _rrCurrentId = null;

  async function loadMemberList(selId) {
    try {
      var res = await api('/api/admin-att-members');
      var members = (res.data && res.data.members) || res.members || [];
      var sel = document.getElementById(selId);
      if (!sel) return;
      sel.innerHTML = '<option value="">-- 직원 선택 --</option>';
      members.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.uid || m.id;
        opt.textContent = (m.name || m.username || '?') + ' (' + (m.email || '') + ')';
        sel.appendChild(opt);
      });
    } catch(e) {
      console.warn('[loadMemberList]', e.message);
    }
  }

  async function loadRemoteReports(memberUid) {
    var startDate = document.getElementById('rrStartDate').value;
    var endDate = document.getElementById('rrEndDate').value;
    var status = document.getElementById('rrStatusFilter').value;
    var tbody = document.getElementById('rrListBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:24px">조회 중...</td></tr>';

    try {
      var qs = '?memberUid=' + encodeURIComponent(memberUid || '');
      if (startDate) qs += '&startDate=' + startDate;
      if (endDate)   qs += '&endDate='   + endDate;
      if (status)    qs += '&status='    + status;

      var res = await api('/api/admin/att/remote-reports' + qs);
      var rows = (res.data && Array.isArray(res.data.data)) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
      renderReportList(rows);
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderReportList(rows) {
    var tbody = document.getElementById('rrListBody');
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">보고서가 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(r) {
      var statusBadge = r.status === 'SUBMITTED'
        ? '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600">제출완료</span>'
        : '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:99px;font-size:11.5px;font-weight:600">임시저장</span>';
      var star = r.isStarred ? '⭐' : '☆';
      var score = r.qualityScore != null ? r.qualityScore : '—';
      return '<tr>'
        + '<td style="font-family:Inter;font-size:13px">' + esc(r.date || '—') + '</td>'
        + '<td style="font-weight:500">' + esc(r.memberName || r.name || '—') + '</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="text-align:center;font-weight:600;color:#2563eb">' + score + '</td>'
        + '<td style="text-align:center;font-size:16px;cursor:pointer" onclick="toggleStar(' + r.id + ',' + (r.isStarred ? 'true' : 'false') + ')" title="별표 토글">' + star + '</td>'
        + '<td><button class="att-btn secondary" style="padding:4px 10px;font-size:12px" onclick="openReportDetail(' + r.id + ',\'' + esc(r.date) + '\',\'' + esc(r.memberName || '') + '\')">상세</button></td>'
        + '</tr>';
    }).join('');
  }

  function renderReportDetail(report) {
    var area = document.getElementById('rrDetailArea');
    var title = document.getElementById('rrDetailTitle');
    var content = document.getElementById('rrDetailContent');
    var noteInput = document.getElementById('rrNoteInput');
    if (!area) return;
    area.style.display = '';
    if (title) title.textContent = (report.date || '') + ' — ' + (report.memberName || report.name || '');
    if (content) content.textContent = report.content || report.aiDraft || '(내용 없음)';
    if (noteInput) noteInput.value = report.supervisorNote || '';
  }

  window.toggleStar = async function(id, currentStarred) {
    try {
      await api('/api/admin/att/remote-reports', { method: 'PUT', body: { id: id, isStarred: !currentStarred } });
      toast(!currentStarred ? '별표 추가됨' : '별표 제거됨', 'success');
      var memberUid = document.getElementById('rrMemberSel').value;
      await loadRemoteReports(memberUid);
    } catch(e) { toast('별표 변경 실패: ' + e.message, 'error'); }
  };

  window.openReportDetail = async function(id, date, memberName) {
    _rrCurrentId = id;
    try {
      var res = await api('/api/admin/att/remote-reports?id=' + id);
      var report = (res.data && (res.data.data || res.data)) || { id: id, date: date, memberName: memberName };
      renderReportDetail(report);
    } catch(e) {
      renderReportDetail({ id: id, date: date, memberName: memberName });
    }
  };

  async function starReport(id, isStarred) {
    await api('/api/admin/att/remote-reports', { method: 'PUT', body: { id: id, isStarred: isStarred } });
  }

  async function addSupervisorNote(id, note) {
    await api('/api/admin/att/remote-reports', { method: 'PUT', body: { id: id, supervisorNote: note } });
  }

  /* ════════════════════════════════════════
     근무형태 관리
  ════════════════════════════════════════ */
  var _wmCurrentUid = null;
  var DAYS = ['월', '화', '수', '목', '금', '토', '일'];
  var DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  function buildDayGrid() {
    var grid = document.getElementById('wmDayGrid');
    if (!grid || grid.children.length) return;
    DAY_KEYS.forEach(function(key, i) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px';
      wrap.innerHTML = '<div style="font-size:12.5px;font-weight:600;color:#374151;margin-bottom:6px">' + DAYS[i] + '</div>'
        + '<select id="wmDay_' + key + '" style="width:100%;padding:5px 7px;border:1px solid #d1d5db;border-radius:6px;font-size:12px">'
        + '<option value="OFFICE">🏢 사무실</option>'
        + '<option value="REMOTE">🏠 재택</option>'
        + '<option value="FIELD">🚗 외근</option>'
        + '<option value="">—</option>'
        + '</select>';
      grid.appendChild(wrap);
    });
  }

  async function loadWorkModes(memberUid) {
    var editorArea = document.getElementById('wmEditorArea');
    var editorTitle = document.getElementById('wmEditorTitle');
    var schedBody = document.getElementById('wmScheduleBody');

    _wmCurrentUid = memberUid;
    if (editorArea) editorArea.style.display = '';
    if (editorTitle) editorTitle.textContent = document.getElementById('wmMemberSel')?.selectedOptions[0]?.textContent + ' — 근무형태 설정';

    schedBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px">조회 중...</td></tr>';

    try {
      var res = await api('/api/admin/att/work-mode?memberUid=' + encodeURIComponent(memberUid));
      var data = (res.data && (res.data.data || res.data)) || {};
      renderWorkModeEditor(data);
    } catch(e) {
      schedBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderWorkModeEditor(data) {
    var schedules = Array.isArray(data.schedules) ? data.schedules : [];
    var tbody = document.getElementById('wmScheduleBody');

    // 기존 스케줄 테이블
    if (!schedules.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px">등록된 스케줄이 없습니다</td></tr>';
    } else {
      var modeLabel = { OFFICE:'🏢 사무실', REMOTE:'🏠 재택', FIELD:'🚗 외근', HYBRID:'🔀 HYBRID' };
      tbody.innerHTML = schedules.map(function(s) {
        return '<tr>'
          + '<td style="font-weight:500">' + (modeLabel[s.workMode] || esc(s.workMode)) + '</td>'
          + '<td style="font-family:Inter;font-size:12.5px">' + esc(s.startDate || '—') + '</td>'
          + '<td style="font-family:Inter;font-size:12.5px">' + esc(s.endDate || '무기한') + '</td>'
          + '<td style="font-size:12px;color:#6b7280">' + esc(s.recurringRule || '—') + '</td>'
          + '<td><button class="att-btn danger" style="padding:3px 8px;font-size:12px" onclick="deleteWorkMode(' + s.id + ',\'schedule\')">삭제</button></td>'
          + '</tr>';
      }).join('');
    }
  }

  async function saveWorkMode() {
    if (!_wmCurrentUid) { toast('직원을 선택하세요', 'error'); return; }
    var modeEl = document.querySelector('input[name="wmMode"]:checked');
    if (!modeEl) { toast('근무형태를 선택하세요', 'error'); return; }
    var workMode = modeEl.value;
    var startDate = document.getElementById('wmStartDate').value;
    var endDate = document.getElementById('wmEndDate').value;
    if (!startDate) { toast('시작일을 입력하세요', 'error'); return; }

    var recurringRule = null;
    if (workMode === 'HYBRID') {
      var parts = [];
      DAY_KEYS.forEach(function(key) {
        var sel = document.getElementById('wmDay_' + key);
        if (sel && sel.value) parts.push(key + ':' + sel.value);
      });
      if (parts.length) recurringRule = parts.join(',');
    }

    try {
      await api('/api/admin/att/work-mode', {
        method: 'POST',
        body: {
          memberUid: _wmCurrentUid,
          workMode: workMode,
          recurringRule: recurringRule,
          startDate: startDate,
          endDate: endDate || null,
        },
      });
      toast('근무형태 저장 완료', 'success');
      await loadWorkModes(_wmCurrentUid);
    } catch(e) { toast('저장 실패: ' + e.message, 'error'); }
  }

  window.deleteWorkMode = async function(id, type) {
    if (!confirm('이 스케줄을 삭제하시겠습니까?')) return;
    try {
      await api('/api/admin/att/work-mode', { method: 'DELETE', body: { id: id, type: type } });
      toast('삭제 완료', 'success');
      if (_wmCurrentUid) await loadWorkModes(_wmCurrentUid);
    } catch(e) { toast('삭제 실패: ' + e.message, 'error'); }
  };

  /* ── 초기화 ── */
  document.addEventListener('DOMContentLoaded', async function() {
    try {
      var meRes = await api('/api/admin/me?light=1');
      var me = (meRes.data && meRes.data.admin) || meRes.admin || {};
      if (me.role !== 'super_admin') {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:16px;color:#6b7280">슈퍼어드민만 접근할 수 있습니다.</div>';
        return;
      }
      $('#attSubtitle').textContent = me.name + ' · 슈퍼어드민 · 근태관리 설정';
    } catch(e) {
      window.location.href = '/admin-hub.html';
      return;
    }

    initTabs();

    // 회원 목록 미리 로드 (재택보고서·근무형태 탭 공통)
    await loadMemberList('rrMemberSel');
    await loadMemberList('wmMemberSel');

    // 재택보고서 탭 이벤트
    (function() {
      var now = new Date();
      var y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
      var d = String(now.getDate()).padStart(2, '0');
      var startEl = document.getElementById('rrStartDate');
      var endEl = document.getElementById('rrEndDate');
      if (startEl) startEl.value = y + '-' + m + '-01';
      if (endEl) endEl.value = y + '-' + m + '-' + d;
    })();

    document.getElementById('btnRrSearch')?.addEventListener('click', function() {
      var uid = document.getElementById('rrMemberSel').value;
      if (!uid) { toast('직원을 선택하세요', 'error'); return; }
      loadRemoteReports(uid);
    });

    document.getElementById('rrBtnCloseDetail')?.addEventListener('click', function() {
      document.getElementById('rrDetailArea').style.display = 'none';
      _rrCurrentId = null;
    });

    document.getElementById('rrBtnStar')?.addEventListener('click', async function() {
      if (!_rrCurrentId) return;
      try {
        await starReport(_rrCurrentId, true);
        toast('별표 추가됨', 'success');
      } catch(e) { toast('실패: ' + e.message, 'error'); }
    });

    document.getElementById('rrBtnSaveNote')?.addEventListener('click', async function() {
      if (!_rrCurrentId) { toast('보고서를 먼저 선택하세요', 'error'); return; }
      var note = document.getElementById('rrNoteInput').value.trim();
      try {
        await addSupervisorNote(_rrCurrentId, note);
        toast('코멘트 저장 완료', 'success');
      } catch(e) { toast('저장 실패: ' + e.message, 'error'); }
    });

    // 근무형태 관리 탭 이벤트
    buildDayGrid();

    document.getElementById('btnWmLoad')?.addEventListener('click', function() {
      var uid = document.getElementById('wmMemberSel').value;
      if (!uid) { toast('직원을 선택하세요', 'error'); return; }
      loadWorkModes(uid);
    });

    document.getElementById('btnWmSave')?.addEventListener('click', saveWorkMode);

    // HYBRID 선택 시 요일별 설정 표시
    document.querySelectorAll('input[name="wmMode"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var hybridDays = document.getElementById('wmHybridDays');
        if (hybridDays) hybridDays.style.display = radio.value === 'HYBRID' ? '' : 'none';
      });
    });

    // 근무형태 탭 기본 시작일 오늘
    (function() {
      var today = new Date().toISOString().slice(0, 10);
      var el = document.getElementById('wmStartDate');
      if (el) el.value = today;
    })();

    // 거점 모달
    $('#btnAddWp').addEventListener('click', function() { openWpModal(null); });
    $('#btnWpCancel').addEventListener('click', function() { $('#wpModal').classList.remove('open'); });
    $('#btnWpSave').addEventListener('click', saveWp);
    $('#wpModal').addEventListener('click', function(e) { if (e.target === $('#wpModal')) $('#wpModal').classList.remove('open'); });

    // 휴가 종류 모달
    $('#btnAddLt').addEventListener('click', function() { openLtModal(null); });
    $('#btnLtCancel').addEventListener('click', function() { $('#ltModal').classList.remove('open'); });
    $('#btnLtSave').addEventListener('click', saveLt);
    $('#ltModal').addEventListener('click', function(e) { if (e.target === $('#ltModal')) $('#ltModal').classList.remove('open'); });

    // 정책 버튼
    $('#btnPolicySave').addEventListener('click', savePolicy);
    $('#btnPolicyCancel').addEventListener('click', function() { _policyEditing = false; renderPolicy(); });

    await loadWorkplaces();
  });
})();
