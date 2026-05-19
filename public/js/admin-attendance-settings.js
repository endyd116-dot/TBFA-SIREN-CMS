/**
 * admin-attendance-settings.js — 재택·근무형태 설정
 *
 * R29-GAP-P2 (2026-05-19): 거점·휴가 종류·근태 정책·공휴일 관리는
 * admin-workspace-management.html(워크스페이스 관리)로 이전.
 * 본 화면은 재택보고서 모니터링과 직원별 근무형태 스케줄만 담당.
 */
(function () {
  'use strict';

  var state = {};

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
        // 재택보고서·근무형태 탭은 버튼 클릭으로 수동 조회 (회원 미선택 상태이므로 자동 로드 X)
      });
    });
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

  // R34-P2 (round2 M7): recurringRule을 요일별 사람 친화 텍스트로 포맷
  function formatRecurringRule(rule) {
    if (!rule || typeof rule !== 'object') return '—';
    var DAY_LABEL = { MON:'월', TUE:'화', WED:'수', THU:'목', FRI:'금', SAT:'토', SUN:'일' };
    var MODE_SHORT = { OFFICE:'사무', REMOTE:'재택', FIELD:'외근' };
    var parts = [];
    DAY_KEYS.forEach(function(k) {
      if (rule[k]) parts.push(DAY_LABEL[k] + '=' + (MODE_SHORT[rule[k]] || rule[k]));
    });
    return parts.length ? parts.join(' · ') : '—';
  }

  function renderWorkModeEditor(data) {
    var schedules = Array.isArray(data.schedules) ? data.schedules : [];
    var tbody = document.getElementById('wmScheduleBody');

    // R34-P2 (round2 M8): 가장 최근 스케줄을 라디오·요일 셀렉트에 prefill
    if (schedules.length) {
      var latest = schedules[schedules.length - 1];
      var radio = document.querySelector('input[name="wmMode"][value="' + latest.workMode + '"]');
      if (radio) radio.checked = true;
      var hybridDays = document.getElementById('wmHybridDays');
      if (hybridDays) hybridDays.style.display = latest.workMode === 'HYBRID' ? '' : 'none';
      if (latest.workMode === 'HYBRID' && latest.recurringRule && typeof latest.recurringRule === 'object') {
        DAY_KEYS.forEach(function(k) {
          var sel = document.getElementById('wmDay_' + k);
          if (sel) sel.value = latest.recurringRule[k] || '';
        });
      }
      var startEl = document.getElementById('wmStartDate');
      var endEl = document.getElementById('wmEndDate');
      if (startEl && latest.startDate) startEl.value = latest.startDate;
      if (endEl) endEl.value = latest.endDate || '';
    }

    if (!schedules.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px">등록된 스케줄이 없습니다</td></tr>';
    } else {
      var modeLabel = { OFFICE:'🏢 사무실', REMOTE:'🏠 재택', FIELD:'🚗 외근', HYBRID:'🔀 HYBRID' };
      tbody.innerHTML = schedules.map(function(s) {
        return '<tr>'
          + '<td style="font-weight:500">' + (modeLabel[s.workMode] || esc(s.workMode)) + '</td>'
          + '<td style="font-family:Inter;font-size:12.5px">' + esc(s.startDate || '—') + '</td>'
          + '<td style="font-family:Inter;font-size:12.5px">' + esc(s.endDate || '무기한') + '</td>'
          + '<td style="font-size:12px;color:#6b7280">' + esc(formatRecurringRule(s.recurringRule)) + '</td>'
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
      var obj = {};
      DAY_KEYS.forEach(function(key) {
        var sel = document.getElementById('wmDay_' + key);
        if (sel && sel.value) obj[key] = sel.value;
      });
      if (Object.keys(obj).length) recurringRule = obj;
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
      var me = (meRes.data && meRes.data.admin) || meRes.admin || meRes.data || {};
      if (me.role !== 'super_admin') {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:16px;color:#6b7280">슈퍼어드민만 접근할 수 있습니다.</div>';
        return;
      }
      $('#attSubtitle').textContent = me.name + ' · 슈퍼어드민 · 재택·근무형태 설정';
    } catch(e) {
      window.location.href = '/admin-hub.html';
      return;
    }

    initTabs();

    // 회원 목록 미리 로드 (재택보고서·근무형태 탭 공통)
    await Promise.all([loadMemberList('rrMemberSel'), loadMemberList('wmMemberSel')]);

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

  });
})();
