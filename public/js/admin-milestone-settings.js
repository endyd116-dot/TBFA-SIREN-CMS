/**
 * admin-milestone-settings.js — 성과관리 설정
 * 마일스톤 정의 CRUD + 직원 역할 배정
 */
(function () {
  'use strict';

  var state = { defs: [], members: [], quarters: [], editingId: null };
  var ROLE_LABEL = { SM: 'SM — 사무국장', PM: 'PM — 정책국장', SI: 'SI — SI관리자' };
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
    $('#defRole').value = 'SM';
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
    $('#defRole').value = d.target_milestone_role;
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

      var milestoneOpts = ['', 'SM', 'PM', 'SI'].map(function(v) {
        return '<option value="' + v + '"' + (m.milestone_role === v ? ' selected' : '') + '>'
          + (v ? ROLE_LABEL[v] : '— 미배정 —') + '</option>';
      }).join('');

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

    // 탭 전환 시 데이터 로드
    $$('.mst-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.dataset.tab === 'roles' && !state.members.length) loadMembers();
        if (btn.dataset.tab === 'quarters') loadQuarters();
      });
    });

    // 모달 이벤트 — 마일스톤 정의
    $('#btnAddDef').addEventListener('click', window.openAddDef);
    $('#btnDefCancel').addEventListener('click', function(){ $('#defModal').classList.remove('open'); });
    $('#btnDefSave').addEventListener('click', saveDef);
    $('#defModal').addEventListener('click', function(e) {
      if (e.target === $('#defModal')) $('#defModal').classList.remove('open');
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
