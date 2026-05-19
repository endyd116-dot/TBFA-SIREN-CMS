/**
 * admin-milestone-settings.js — 성과관리 설정
 * 마일스톤 정의 CRUD + 직원 역할 배정
 */
(function () {
  'use strict';

  var state = { defs: [], members: [], quarters: [], editingId: null, roles: [] };
  /* R39 Stage 3: ROLE_LABEL 상수 제거 — 헬퍼·DB 카탈로그에서 동적 해석.
     fallback 함수: 카탈로그 응답 도착 전에도 코드 그대로 노출. */
  function _roleLabel(code) {
    if (!code) return '— 미배정 —';
    var r = (state.roles || []).find(function(x){ return x.code === code; });
    return r ? (r.code + ' — ' + (r.name || r.code)) : code;
  }
  var CAT_LABEL  = { REVENUE_LINKED: '매출연동', NON_REVENUE: '비매출' };

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }
  function esc(s) { return String(s||'').replace(/[&<>"']/g, function(m){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m]; }); }

  async function api(path, opts) {
    opts = opts || {};
    var r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: opts.method || 'GET',
      body: opts.body != null ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    var data = null;
    try { data = await r.json(); } catch(_) {}
    if (!r.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + r.status);
    return data;
  }

  function toast(msg, type) {
    var root = $('#mstToast') || document.body;
    var el = document.createElement('div');
    el.style.cssText = 'padding:12px 18px;border-radius:8px;color:#fff;font-size:13.5px;box-shadow:0 4px 12px rgba(0,0,0,.15);'
      + 'background:' + (type==='error' ? '#dc2626' : type==='success' ? '#16a34a' : '#334155');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function(){ el.remove(); }, 3000);
  }

  /* ── 탭 전환 ── */
  function initTabs() {
    $$('.mst-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        $$('.mst-tab').forEach(function(b){ b.classList.remove('active'); });
        $$('.mst-tab-panel').forEach(function(p){ p.classList.remove('active'); });
        btn.classList.add('active');
        var panelId = 'tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
        var panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
      });
    });
  }

  /* ════════════════════════════════════════
     마일스톤 정의 탭
  ════════════════════════════════════════ */
  async function loadDefs() {
    try {
      var res = await api('/api/admin-milestone-definitions');
      /* ★ R29-GAP-P2-M2: 정의 API 응답 표준화 — { data: { milestones } } 우선, 옛 키도 흡수 */
      state.defs =
        (res && res.data && res.data.milestones) ||
        (res && res.data && res.data.definitions) ||
        (Array.isArray(res && res.data) ? res.data : null) ||
        res.defs ||
        [];
      renderDefsTable();
    } catch(e) {
      $('#defTableBody').innerHTML = '<tr><td colspan="9" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderDefsTable() {
    var tbody = $('#defTableBody');
    if (!state.defs.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#9ca3af;padding:32px">등록된 마일스톤 정의가 없습니다. 위의 "+ 마일스톤 추가" 버튼으로 추가하세요.</td></tr>';
      return;
    }
    tbody.innerHTML = state.defs.map(function(d) {
      var catBadge = d.category === 'REVENUE_LINKED'
        ? '<span class="mst-badge rev">매출연동</span>'
        : '<span class="mst-badge nonrev">비매출</span>';
      var roleBadge = d.target_milestone_role
        ? '<span class="mst-badge ' + d.target_milestone_role.toLowerCase() + '">' + esc(d.target_milestone_role) + '</span>'
        : '<span class="mst-badge none">-</span>';
      var activeBadge = d.is_active
        ? '<span class="mst-badge active">활성</span>'
        : '<span class="mst-badge inactive">비활성</span>';
      var threshold = d.threshold_enabled
        ? esc(d.threshold_value || '-') + ' ' + esc(d.threshold_unit || '')
        : '<span style="color:#9ca3af">-</span>';
      return '<tr>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px">' + esc(d.code) + '</code></td>' +
        '<td style="font-weight:500">' + esc(d.name) + '</td>' +
        '<td>' + catBadge + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + threshold + '</td>' +
        '<td style="color:#6b7280;font-size:12.5px">' + esc(d.quarter_applicable || '전체') + '</td>' +
        '<td>' + activeBadge + '</td>' +
        '<td style="color:#6b7280;font-size:12.5px">' + esc(d.sort_order ?? 0) + '</td>' +
        '<td><div style="display:flex;gap:6px">' +
          '<button class="mst-btn secondary" style="padding:4px 10px;font-size:12px" onclick="editDef(' + d.id + ')">수정</button>' +
          '<button class="mst-btn danger" style="padding:4px 10px;font-size:12px" onclick="deleteDef(' + d.id + ',\'' + esc(d.name) + '\')">삭제</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  /* 모달 열기 — 신규 */
  window.openAddDef = function() {
    state.editingId = null;
    $('#defModalTitle').textContent = '마일스톤 추가';
    $('#defId').value = '';
    $('#defCode').value = '';
    $('#defCode').disabled = false;
    $('#defCategory').value = 'REVENUE_LINKED';
    $('#defName').value = '';
    /* R39 Stage 3: 첫 옵션을 기본값 (역할 카탈로그 동적·SM 고정 불가) */
    (function(){ var r = $('#defRole'); if (r && r.options.length > 0) r.selectedIndex = 0; })();
    $('#defQuarter').value = '';
    $('#defThresholdEnabled').checked = false;
    $('#defThresholdValue').value = '';
    $('#defThresholdUnit').value = '';
    $('#defBusinessUnit').value = '';
    $('#defRevenueSource').value = '';
    $('#defBonusFormula').value = '{}';
    $('#defEffectiveFrom').value = '';
    $('#defEffectiveTo').value = '';
    $('#defSortOrder').value = '0';
    $('#defIsActive').checked = true;
    $('#defActiveGroup').style.display = 'none';
    $('#defModal').classList.add('open');
  };

  /* 모달 열기 — 수정 */
  window.editDef = function(id) {
    var d = state.defs.find(function(x){ return x.id === id; });
    if (!d) return;
    state.editingId = id;
    $('#defModalTitle').textContent = '마일스톤 수정';
    $('#defId').value = id;
    $('#defCode').value = d.code;
    $('#defCode').disabled = true;
    $('#defCategory').value = d.category;
    $('#defName').value = d.name;
    /* R39 Stage 3: 옛 정의의 역할 코드가 카탈로그에서 비활성/삭제된 경우 옵션 추가 후 선택 */
    (function(){
      var sel = $('#defRole');
      var code = d.target_milestone_role || '';
      if (sel && code) {
        var has = false;
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === code) { has = true; break; }
        }
        if (!has) {
          var o = document.createElement('option');
          o.value = code;
          o.textContent = code + ' (비활성·이전 정의)';
          sel.appendChild(o);
        }
        sel.value = code;
      }
    })();
    $('#defQuarter').value = d.quarter_applicable || '';
    $('#defThresholdEnabled').checked = !!d.threshold_enabled;
    $('#defThresholdValue').value = d.threshold_value || '';
    $('#defThresholdUnit').value = d.threshold_unit || '';
    $('#defBusinessUnit').value = d.business_unit || '';
    $('#defRevenueSource').value = d.revenue_source || '';
    $('#defBonusFormula').value = typeof d.bonus_formula === 'object'
      ? JSON.stringify(d.bonus_formula, null, 2)
      : (d.bonus_formula || '{}');
    $('#defEffectiveFrom').value = d.effective_from ? String(d.effective_from).slice(0,10) : '';
    $('#defEffectiveTo').value = d.effective_to ? String(d.effective_to).slice(0,10) : '';
    $('#defSortOrder').value = d.sort_order ?? 0;
    $('#defIsActive').checked = !!d.is_active;
    $('#defActiveGroup').style.display = '';
    $('#defModal').classList.add('open');
  };

  /* 모달 닫기 */
  function closeModal() { $('#defModal').classList.remove('open'); }

  /* 저장 */
  async function saveDef() {
    var formulaStr = ($('#defBonusFormula').value || '{}').trim();
    try { JSON.parse(formulaStr); } catch(_) {
      toast('보너스 공식이 유효한 JSON이 아닙니다', 'error'); return;
    }
    var payload = {
      code:               $('#defCode').value.trim(),
      name:               $('#defName').value.trim(),
      category:           $('#defCategory').value,
      targetMilestoneRole:$('#defRole').value,
      quarterApplicable:  $('#defQuarter').value || null,
      thresholdEnabled:   $('#defThresholdEnabled').checked,
      thresholdValue:     $('#defThresholdValue').value ? Number($('#defThresholdValue').value) : null,
      thresholdUnit:      $('#defThresholdUnit').value.trim() || null,
      businessUnit:       $('#defBusinessUnit').value.trim() || null,
      revenueSource:      $('#defRevenueSource').value.trim() || null,
      bonusFormula:       JSON.parse(formulaStr),
      effectiveFrom:      $('#defEffectiveFrom').value || null,
      effectiveTo:        $('#defEffectiveTo').value || null,
      sortOrder:          Number($('#defSortOrder').value || 0),
      isActive:           $('#defIsActive').checked,
    };
    if (!payload.code || !payload.name) { toast('코드와 이름은 필수입니다', 'error'); return; }

    try {
      if (state.editingId) {
        payload.id = state.editingId;
        await api('/api/admin-milestone-definitions', { method: 'PUT', body: payload });
        toast('마일스톤 수정 완료', 'success');
      } else {
        await api('/api/admin-milestone-definitions', { method: 'POST', body: payload });
        toast('마일스톤 추가 완료', 'success');
      }
      closeModal();
      await loadDefs();
    } catch(e) {
      toast('저장 실패: ' + e.message, 'error');
    }
  }

  /* 삭제 */
  window.deleteDef = async function(id, name) {
    if (!confirm('[' + name + '] 마일스톤을 삭제하시겠습니까?\n연결된 실적 데이터가 있으면 삭제되지 않을 수 있습니다.')) return;
    try {
      await api('/api/admin-milestone-definitions?id=' + id, { method: 'DELETE' });
      toast('삭제 완료', 'success');
      await loadDefs();
    } catch(e) {
      toast('삭제 실패: ' + e.message, 'error');
    }
  };

  /* ════════════════════════════════════════
     직원 역할 배정 탭
  ════════════════════════════════════════ */
  async function loadMembers() {
    try {
      var res = await api('/api/admin-milestone-role-assign');
      state.members = res.data || [];
      renderRoleTable();
    } catch(e) {
      $('#roleTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderRoleTable() {
    var tbody = $('#roleTableBody');
    if (!state.members.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:32px">등록된 어드민 계정이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML = state.members.map(function(m) {
      var roleLabel = {
        super_admin: '<span class="mst-badge sm">슈퍼어드민</span>',
        admin: '<span class="mst-badge pm">어드민</span>',
        operator: '<span class="mst-badge si">오퍼레이터</span>',
      }[m.role] || '<span class="mst-badge none">' + esc(m.role||'-') + '</span>';

      /* R39 Stage 3: 옵션 동적 — 활성 역할 카탈로그 기준 */
      var roleCodes = (state.roles || []).map(function(x){ return x.code; });
      var milestoneOpts = [''].concat(roleCodes).map(function(v) {
        var label = v ? (function(){
          var rr = (state.roles || []).find(function(x){ return x.code === v; });
          return rr ? (rr.code + ' — ' + (rr.name || rr.code)) : v;
        })() : '— 미배정 —';
        return '<option value="' + v + '"' + (m.milestone_role === v ? ' selected' : '') + '>'
          + label + '</option>';
      }).join('');
      /* 현재 직원의 역할이 카탈로그에 없는 경우(비활성 코드) 옵션 추가 */
      if (m.milestone_role && !roleCodes.includes(m.milestone_role)) {
        milestoneOpts += '<option value="' + m.milestone_role + '" selected>' + m.milestone_role + ' (비활성)</option>';
      }

      return '<tr id="member-row-' + m.id + '">' +
        '<td style="font-weight:500">' + esc(m.name) + '</td>' +
        '<td style="color:#6b7280;font-size:13px">' + esc(m.email) + '</td>' +
        '<td>' + roleLabel + '</td>' +
        '<td><select class="role-select" data-member-id="' + m.id + '">' + milestoneOpts + '</select></td>' +
        '<td><button class="mst-btn primary" style="padding:5px 12px;font-size:12.5px" onclick="saveRole(' + m.id + ')">저장</button></td>' +
      '</tr>';
    }).join('');
  }

  window.saveRole = async function(memberId) {
    var sel = document.querySelector('select[data-member-id="' + memberId + '"]');
    if (!sel) return;
    var milestoneRole = sel.value || null;
    try {
      await api('/api/admin-milestone-role-assign', {
        method: 'PUT',
        body: { memberId: memberId, milestoneRole: milestoneRole },
      });
      toast('역할 저장 완료', 'success');
    } catch(e) {
      toast('저장 실패: ' + e.message, 'error');
    }
  };

  /* ════════════════════════════════════════
     분기 관리 탭
  ════════════════════════════════════════ */
  var Q_STATUS_LABEL = { UPCOMING: '예정', ACTIVE: '활성', ENDED: '마감', SETTLED: '정산완료' };
  var Q_STATUS_STYLE = {
    UPCOMING: 'background:#dbeafe;color:#1d4ed8',
    ACTIVE:   'background:#dcfce7;color:#15803d',
    ENDED:    'background:#fef3c7;color:#92400e',
    SETTLED:  'background:#f3f4f6;color:#6b7280',
  };
  var Q_NEXT = { UPCOMING: 'ACTIVE', ACTIVE: 'ENDED', ENDED: 'SETTLED' };
  var Q_NEXT_LABEL = { UPCOMING: '활성화', ACTIVE: '마감', ENDED: '정산완료 처리' };

  async function loadQuarters() {
    try {
      var res = await api('/api/milestone-quarters');
      state.quarters = (res.data && res.data.quarters) || res.quarters || [];
      renderQuartersTable();
    } catch(e) {
      $('#quarterTableBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderQuartersTable() {
    var tbody = $('#quarterTableBody');
    if (!state.quarters.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:32px">등록된 분기가 없습니다. "+ 분기 추가" 버튼으로 분기를 추가하세요.</td></tr>';
      return;
    }
    tbody.innerHTML = state.quarters.map(function(q) {
      var statusStyle = Q_STATUS_STYLE[q.status] || 'background:#f3f4f6;color:#6b7280';
      var statusLabel = Q_STATUS_LABEL[q.status] || q.status;
      var nextStatus = Q_NEXT[q.status];
      var actionBtn = nextStatus
        ? '<button class="mst-btn primary" style="padding:4px 10px;font-size:12px" onclick="setQuarterStatus(' + q.id + ',\'' + nextStatus + '\')">' + Q_NEXT_LABEL[q.status] + '</button>'
        : '<span style="color:#9ca3af;font-size:12px">—</span>';
      return '<tr>' +
        '<td style="font-weight:600">' + esc(q.year) + '</td>' +
        '<td><span class="mst-badge" style="' + statusStyle + ';font-size:12px">Q' + esc(q.quarter) + '</span></td>' +
        '<td style="font-size:13px">' + esc(q.startDate || q.start_date || '') + '</td>' +
        '<td style="font-size:13px">' + esc(q.endDate || q.end_date || '') + '</td>' +
        '<td style="font-size:13px">' + esc(q.settlementDate || q.settlement_date || '') + '</td>' +
        '<td><span class="mst-badge" style="' + statusStyle + '">' + statusLabel + '</span></td>' +
        '<td>' + actionBtn + '</td>' +
      '</tr>';
    }).join('');
  }

  window.setQuarterStatus = async function(id, nextStatus) {
    var labelMap = { ACTIVE: '활성화', ENDED: '마감', SETTLED: '정산완료 처리' };
    if (!confirm('이 분기를 ' + (labelMap[nextStatus] || nextStatus) + ' 하시겠습니까?')) return;
    try {
      await api('/api/milestone-quarters?id=' + id, { method: 'PATCH', body: { status: nextStatus } });
      toast('상태 변경 완료 (' + (Q_STATUS_LABEL[nextStatus] || nextStatus) + ')', 'success');
      await loadQuarters();
    } catch(e) {
      toast('상태 변경 실패: ' + e.message, 'error');
    }
  };

  function openAddQuarter() {
    var now = new Date();
    var year = now.getFullYear();
    var mon = now.getMonth() + 1;
    var q = Math.ceil(mon / 3);
    $('#qYear').value = year;
    $('#qQuarter').value = String(q);
    autoFillQuarterDates();
    $('#quarterModal').classList.add('open');
  }

  function autoFillQuarterDates() {
    var year = parseInt($('#qYear').value) || new Date().getFullYear();
    var q = parseInt($('#qQuarter').value) || 1;
    var starts = [[1,1],[4,1],[7,1],[10,1]];
    var ends   = [[3,31],[6,30],[9,30],[12,31]];
    var s = starts[q-1], e = ends[q-1];
    var pad = function(n){ return n < 10 ? '0'+n : String(n); };
    $('#qStartDate').value = year + '-' + pad(s[0]) + '-' + pad(s[1]);
    $('#qEndDate').value   = year + '-' + pad(e[0]) + '-' + pad(e[1]);
    var sd = new Date(year, e[0]-1, e[1] + 10);
    $('#qSettlementDate').value = sd.getFullYear() + '-' + pad(sd.getMonth()+1) + '-' + pad(sd.getDate());
  }

  async function saveQuarter() {
    var year = parseInt($('#qYear').value);
    var quarter = parseInt($('#qQuarter').value);
    var startDate = $('#qStartDate').value;
    var endDate = $('#qEndDate').value;
    var settlementDate = $('#qSettlementDate').value;
    if (!year || !quarter || !startDate || !endDate || !settlementDate) {
      toast('모든 필드를 입력해 주세요', 'error'); return;
    }
    try {
      await api('/api/milestone-quarters', { method: 'POST', body: { year: year, quarter: quarter, startDate: startDate, endDate: endDate, settlementDate: settlementDate } });
      toast(year + 'Q' + quarter + ' 분기 추가 완료', 'success');
      $('#quarterModal').classList.remove('open');
      await loadQuarters();
    } catch(e) {
      toast('저장 실패: ' + e.message, 'error');
    }
  }

  /* ════════════════════════════════════════
     R39 Stage 3: 역할 카탈로그 로드 + 드롭다운 동적 채움
  ════════════════════════════════════════ */
  async function loadRolesAndFillDropdowns() {
    try {
      if (window.MilestoneRoles) {
        state.roles = await window.MilestoneRoles.loadActiveRoles();
      } else {
        var res = await api('/api/milestone-roles');
        state.roles = (res && res.data && res.data.roles) || [];
      }
    } catch (e) {
      state.roles = [];
    }
    // defRole 동적 채움
    var defRole = $('#defRole');
    if (defRole) {
      defRole.innerHTML = state.roles.map(function(r) {
        return '<option value="' + r.code + '">' + r.code + ' — ' + (r.name || r.code) + '</option>';
      }).join('');
    }
  }

  /* ════════════════════════════════════════
     R38 A-1: 직원별 마일스톤 탭
     - 직원 일람 (이름·이메일·성과 역할·정의 수·매출 수)
     - 행 클릭 → 모달: 해당 직원 milestoneRole 정의 일람 + CRUD
  ════════════════════════════════════════ */
  state.bmCurrent = null; // 현재 모달이 보고 있는 직원

  async function loadByMember() {
    var tbody = $('#byMemberTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">로딩 중...</td></tr>';
    try {
      // 직원 목록과 정의 목록을 병렬 로드
      var tasks = [api('/api/admin-milestone-role-assign')];
      if (!state.defs.length) tasks.push(api('/api/admin-milestone-definitions'));
      var results = await Promise.all(tasks);
      var memRes = results[0];
      state.members = (memRes && memRes.data) || [];
      if (results[1]) {
        var defRes = results[1];
        state.defs =
          (defRes && defRes.data && defRes.data.milestones) ||
          (defRes && defRes.data && defRes.data.definitions) ||
          (Array.isArray(defRes && defRes.data) ? defRes.data : null) ||
          defRes.defs || [];
      }
      renderByMemberTable();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderByMemberTable() {
    var tbody = $('#byMemberTableBody');
    if (!state.members.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">등록된 어드민 계정이 없습니다</td></tr>';
      return;
    }
    // milestoneRole별 정의 수 집계
    var defCountByRole = { SM: 0, PM: 0, SI: 0 };
    var revCountByRole = { SM: 0, PM: 0, SI: 0 };
    state.defs.forEach(function(d) {
      var r = d.target_milestone_role || d.targetMilestoneRole;
      if (!r || !(r in defCountByRole)) return;
      if (d.is_active === false) return;
      defCountByRole[r] += 1;
      if (d.category === 'REVENUE_LINKED') revCountByRole[r] += 1;
    });

    tbody.innerHTML = state.members.map(function(m) {
      var mr = m.milestone_role || '';
      var roleBadge = mr
        ? '<span class="mst-badge ' + mr.toLowerCase() + '">' + esc(mr) + '</span>'
        : '<span class="mst-badge none">— 미배정 —</span>';
      var defCnt = mr ? (defCountByRole[mr] || 0) : 0;
      var revCnt = mr ? (revCountByRole[mr] || 0) : 0;
      var manageBtn = mr
        ? '<button class="mst-btn secondary" style="padding:4px 10px;font-size:12px" onclick="openByMember(' + m.id + ')">상세</button>'
        : '<span style="color:#9ca3af;font-size:12px">역할 배정 필요</span>';
      return '<tr>' +
        '<td style="font-weight:500">' + esc(m.name) + '</td>' +
        '<td style="color:#6b7280;font-size:13px">' + esc(m.email) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="text-align:right;font-variant-numeric:tabular-nums">' + defCnt + '</td>' +
        '<td style="text-align:right;font-variant-numeric:tabular-nums;color:#5b21b6">' + revCnt + '</td>' +
        '<td>' + manageBtn + '</td>' +
      '</tr>';
    }).join('');
  }

  window.openByMember = function(memberId) {
    var m = state.members.find(function(x){ return x.id === memberId; });
    if (!m || !m.milestone_role) return;
    state.bmCurrent = m;
    $('#byMemberModalTitle').textContent = m.name + '의 ' + m.milestone_role + ' 마일스톤';
    $('#byMemberModalSubtitle').textContent =
      m.email + ' · 성과 역할 ' + m.milestone_role + ' — 본 직원이 담당하는 마일스톤 정의 일람';
    renderByMemberDefsBody(m.milestone_role);
    $('#byMemberModal').classList.add('open');
  };

  function renderByMemberDefsBody(role) {
    var tbody = $('#byMemberDefsBody');
    var rows = state.defs.filter(function(d) {
      var r = d.target_milestone_role || d.targetMilestoneRole;
      return r === role;
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:24px">' + esc(role) + ' 역할로 정의된 마일스톤이 없습니다. 우측 상단 [+ 마일스톤 추가] 버튼으로 추가하세요.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(d) {
      var catBadge = d.category === 'REVENUE_LINKED'
        ? '<span class="mst-badge rev">매출연동</span>'
        : '<span class="mst-badge nonrev">비매출</span>';
      var activeBadge = d.is_active
        ? '<span class="mst-badge active">활성</span>'
        : '<span class="mst-badge inactive">비활성</span>';
      var threshold = d.threshold_enabled
        ? esc(d.threshold_value || '-') + ' ' + esc(d.threshold_unit || '')
        : '<span style="color:#9ca3af">-</span>';
      var toggleLabel = d.is_active ? '비활성화' : '활성화';
      return '<tr>' +
        '<td>' + activeBadge + '</td>' +
        '<td><code style="font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:4px">' + esc(d.code) + '</code></td>' +
        '<td style="font-weight:500">' + esc(d.name) + '</td>' +
        '<td>' + catBadge + '</td>' +
        '<td>' + threshold + '</td>' +
        '<td style="color:#6b7280;font-size:12.5px">' + esc(d.quarter_applicable || '전체') + '</td>' +
        '<td><div style="display:flex;gap:6px">' +
          '<button class="mst-btn secondary" style="padding:4px 8px;font-size:11.5px" onclick="bmEditDef(' + d.id + ')">편집</button>' +
          '<button class="mst-btn ' + (d.is_active ? 'danger' : 'primary') + '" style="padding:4px 8px;font-size:11.5px" onclick="bmToggleDef(' + d.id + ')">' + toggleLabel + '</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function closeByMemberModal() {
    $('#byMemberModal').classList.remove('open');
  }

  // 편집은 기존 editDef 흐름에 위임 (모달 닫고 정의 모달 오픈)
  window.bmEditDef = function(id) {
    closeByMemberModal();
    window.editDef(id);
  };

  // 활성/비활성 토글 — 기존 PUT 활용 (id + 기존 필드 전체)
  window.bmToggleDef = async function(id) {
    var d = state.defs.find(function(x){ return x.id === id; });
    if (!d) return;
    var nextActive = !d.is_active;
    if (!confirm('[' + d.name + '] 마일스톤을 ' + (nextActive ? '활성화' : '비활성화') + '하시겠습니까?')) return;
    try {
      await api('/api/admin-milestone-definitions', {
        method: 'PUT',
        body: {
          id: d.id,
          name: d.name,
          category: d.category,
          targetMilestoneRole: d.target_milestone_role || d.targetMilestoneRole,
          businessUnit: d.business_unit || null,
          revenueSource: d.revenue_source || null,
          thresholdEnabled: d.threshold_enabled,
          thresholdValue: d.threshold_value,
          thresholdUnit: d.threshold_unit,
          bonusFormula: d.bonus_formula || {},
          quarterApplicable: d.quarter_applicable || null,
          isSharedThreshold: d.is_shared_threshold,
          sharedThresholdGroup: d.shared_threshold_group,
          isActive: nextActive,
          effectiveFrom: d.effective_from || null,
          effectiveTo: d.effective_to || null,
          sortOrder: d.sort_order ?? 0,
        },
      });
      toast(nextActive ? '활성화 완료' : '비활성화 완료', 'success');
      // 정의 목록 새로 받아오고 모달 갱신
      var defRes = await api('/api/admin-milestone-definitions');
      state.defs =
        (defRes && defRes.data && defRes.data.milestones) ||
        (defRes && defRes.data && defRes.data.definitions) || [];
      if (state.bmCurrent) renderByMemberDefsBody(state.bmCurrent.milestone_role);
      renderByMemberTable();
    } catch (e) {
      toast('변경 실패: ' + e.message, 'error');
    }
  };

  /* ════════════════════════════════════════
     R39 Stage 3: 대상 역할 관리 탭 (5번째 탭)
     - /api/milestone-roles GET·POST·PATCH·DELETE 사용
     - 변경 시 sessionStorage 캐시 무효화 + 드롭다운 재구성
  ════════════════════════════════════════ */
  state.editingRoleId = null;

  async function loadRoleMgmt() {
    var tbody = $('#roleMgmtBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">로딩 중...</td></tr>';
    try {
      // 비활성 포함 — 관리 화면이므로 전체 노출
      var res = await api('/api/milestone-roles?includeInactive=1');
      var roles = (res && res.data && res.data.roles) || [];
      renderRoleMgmtTable(roles);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px">로드 실패: ' + esc(e.message) + '</td></tr>';
    }
  }

  function renderRoleMgmtTable(roles) {
    var tbody = $('#roleMgmtBody');
    if (!roles.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:32px">등록된 역할이 없습니다. "+ 신규 등록" 버튼을 누르세요.</td></tr>';
      return;
    }
    // id 매핑 캐시 (편집·삭제 버튼에서 사용)
    state._rolesById = {};
    roles.forEach(function(r){ state._rolesById[r.id] = r; });

    tbody.innerHTML = roles.map(function(r) {
      var activeBadge = r.isActive
        ? '<span class="mst-badge active">활성</span>'
        : '<span class="mst-badge inactive">비활성</span>';
      var actionBtns = r.isActive
        ? '<button class="mst-btn secondary" style="padding:4px 10px;font-size:12px" onclick="editRole(' + r.id + ')">편집</button>'
          + '<button class="mst-btn danger" style="padding:4px 10px;font-size:12px;margin-left:6px" onclick="deactivateRole(' + r.id + ')">비활성화</button>'
        : '<button class="mst-btn secondary" style="padding:4px 10px;font-size:12px" onclick="editRole(' + r.id + ')">편집</button>'
          + '<button class="mst-btn primary" style="padding:4px 10px;font-size:12px;margin-left:6px" onclick="reactivateRole(' + r.id + ')">활성화</button>';
      return '<tr>' +
        '<td><code style="font-size:12.5px;background:#f1f5f9;padding:2px 6px;border-radius:4px;font-weight:600">' + esc(r.code) + '</code></td>' +
        '<td style="font-weight:500">' + esc(r.name) + '</td>' +
        '<td style="color:#6b7280;font-size:12.5px">' + esc(r.description || '-') + '</td>' +
        '<td style="text-align:right;font-variant-numeric:tabular-nums">' + (r.sortOrder ?? 0) + '</td>' +
        '<td>' + activeBadge + '</td>' +
        '<td>' + actionBtns + '</td>' +
      '</tr>';
    }).join('');
  }

  function openAddRole() {
    state.editingRoleId = null;
    $('#roleModalTitle').textContent = '역할 등록';
    $('#roleId').value = '';
    $('#roleCode').value = '';
    $('#roleCode').disabled = false;
    $('#roleName').value = '';
    $('#roleDescription').value = '';
    $('#roleSortOrder').value = '0';
    $('#roleIsActive').checked = true;
    $('#roleActiveGroup').style.display = 'none';
    $('#roleModal').classList.add('open');
    setTimeout(function(){ $('#roleCode').focus(); }, 50);
  }

  window.editRole = function(id) {
    var r = state._rolesById && state._rolesById[id];
    if (!r) return;
    state.editingRoleId = id;
    $('#roleModalTitle').textContent = '역할 편집';
    $('#roleId').value = id;
    $('#roleCode').value = r.code;
    $('#roleCode').disabled = true; // 코드는 변경 불가
    $('#roleName').value = r.name || '';
    $('#roleDescription').value = r.description || '';
    $('#roleSortOrder').value = r.sortOrder ?? 0;
    $('#roleIsActive').checked = !!r.isActive;
    $('#roleActiveGroup').style.display = '';
    $('#roleModal').classList.add('open');
  };

  window.deactivateRole = async function(id) {
    var r = state._rolesById && state._rolesById[id];
    if (!r) return;
    if (!confirm('[' + r.code + ' (' + r.name + ')] 역할을 비활성화하시겠습니까?\n과거 결산·정의는 그대로 보존되고 드롭다운에서만 사라집니다.')) return;
    try {
      await api('/api/milestone-roles/' + id, { method: 'DELETE' });
      toast('비활성화 완료', 'success');
      if (window.MilestoneRoles) window.MilestoneRoles.invalidateCache();
      await loadRoleMgmt();
      await loadRolesAndFillDropdowns();
    } catch (e) {
      toast('비활성화 실패: ' + e.message, 'error');
    }
  };

  window.reactivateRole = async function(id) {
    var r = state._rolesById && state._rolesById[id];
    if (!r) return;
    try {
      await api('/api/milestone-roles/' + id, {
        method: 'PATCH',
        body: { isActive: true },
      });
      toast('활성화 완료', 'success');
      if (window.MilestoneRoles) window.MilestoneRoles.invalidateCache();
      await loadRoleMgmt();
      await loadRolesAndFillDropdowns();
    } catch (e) {
      toast('활성화 실패: ' + e.message, 'error');
    }
  };

  async function saveRole() {
    var codeRaw = ($('#roleCode').value || '').trim().toUpperCase();
    var name = ($('#roleName').value || '').trim();
    var description = ($('#roleDescription').value || '').trim();
    var sortOrder = Number($('#roleSortOrder').value || 0);
    var isActive = $('#roleIsActive').checked;

    if (!state.editingRoleId) {
      // 신규: 코드 형식 검증
      if (!/^[A-Z]{2,10}$/.test(codeRaw)) {
        toast('코드는 영문 대문자 2~10자 (예: SM, MARKETING)', 'error'); return;
      }
    }
    if (!name) { toast('이름은 필수입니다', 'error'); return; }
    if (name.length > 50) { toast('이름은 50자 이내', 'error'); return; }

    try {
      if (state.editingRoleId) {
        await api('/api/milestone-roles/' + state.editingRoleId, {
          method: 'PATCH',
          body: {
            name: name,
            description: description || null,
            sortOrder: sortOrder,
            isActive: isActive,
          },
        });
        toast('역할 수정 완료', 'success');
      } else {
        await api('/api/milestone-roles', {
          method: 'POST',
          body: {
            code: codeRaw,
            name: name,
            description: description || null,
            sortOrder: sortOrder,
          },
        });
        toast('역할 등록 완료', 'success');
      }
      $('#roleModal').classList.remove('open');
      if (window.MilestoneRoles) window.MilestoneRoles.invalidateCache();
      await loadRoleMgmt();
      await loadRolesAndFillDropdowns();
    } catch (e) {
      // 중복 코드 409·검증 400 등 서버 detail 노출
      toast('저장 실패: ' + e.message, 'error');
    }
  }

  /* ── 초기화 ── */
  document.addEventListener('DOMContentLoaded', async function() {
    // super_admin 체크
    try {
      var meRes = await api('/api/admin/me?light=1');
      var me = (meRes.data && meRes.data.admin) || meRes.admin || {};
      if (me.role !== 'super_admin') {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:16px;color:#6b7280">슈퍼어드민만 접근할 수 있습니다.</div>';
        return;
      }
      $('#mstSubtitle').textContent = me.name + ' · 슈퍼어드민 · 성과관리 설정';
    } catch(e) {
      window.location.href = '/admin-hub.html';
      return;
    }

    initTabs();

    /* R39 Stage 3: 역할 카탈로그 1회 로드 → defRole 동적 채움 (이후 역할 관리 탭에서 갱신) */
    await loadRolesAndFillDropdowns();

    // 탭 전환 시 데이터 로드
    $$('.mst-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.dataset.tab === 'roles' && !state.members.length) loadMembers();
        if (btn.dataset.tab === 'quarters') loadQuarters();
        if (btn.dataset.tab === 'bymember') loadByMember();
        if (btn.dataset.tab === 'rolemgmt') loadRoleMgmt();
      });
    });

    // 모달 이벤트 — 마일스톤 정의
    $('#btnAddDef').addEventListener('click', window.openAddDef);
    $('#btnDefCancel').addEventListener('click', function(){ $('#defModal').classList.remove('open'); });
    $('#btnDefSave').addEventListener('click', saveDef);
    $('#defModal').addEventListener('click', function(e) {
      if (e.target === $('#defModal')) $('#defModal').classList.remove('open');
    });

    // 모달 이벤트 — 직원별 마일스톤 (R38 A-1)
    $('#btnBmClose').addEventListener('click', closeByMemberModal);
    $('#byMemberModal').addEventListener('click', function(e) {
      if (e.target === $('#byMemberModal')) closeByMemberModal();
    });
    $('#btnBmAddDef').addEventListener('click', function() {
      if (!state.bmCurrent) return;
      closeByMemberModal();
      window.openAddDef();
      // 새 마일스톤은 해당 직원의 성과 역할로 강제 — 사용자가 자유롭게 변경 가능
      var roleSel = $('#defRole');
      if (roleSel && state.bmCurrent.milestone_role) {
        roleSel.value = state.bmCurrent.milestone_role;
      }
    });

    // 모달 이벤트 — 대상 역할 관리 (R39 Stage 3)
    $('#btnAddRole').addEventListener('click', openAddRole);
    $('#btnRoleCancel').addEventListener('click', function(){ $('#roleModal').classList.remove('open'); });
    $('#btnRoleSave').addEventListener('click', saveRole);
    $('#roleModal').addEventListener('click', function(e) {
      if (e.target === $('#roleModal')) $('#roleModal').classList.remove('open');
    });
    // 코드 입력 시 자동 대문자 변환
    $('#roleCode').addEventListener('input', function(e) {
      var v = e.target.value;
      var up = v.toUpperCase().replace(/[^A-Z]/g, '');
      if (v !== up) e.target.value = up;
    });

    // 모달 이벤트 — 분기 관리
    $('#btnAddQuarter').addEventListener('click', openAddQuarter);
    $('#btnQCancel').addEventListener('click', function(){ $('#quarterModal').classList.remove('open'); });
    $('#btnQSave').addEventListener('click', saveQuarter);
    $('#quarterModal').addEventListener('click', function(e) {
      if (e.target === $('#quarterModal')) $('#quarterModal').classList.remove('open');
    });
    $('#qYear').addEventListener('change', autoFillQuarterDates);
    $('#qQuarter').addEventListener('change', autoFillQuarterDates);

    // 초기 데이터 로드
    await loadDefs();
  });
})();
