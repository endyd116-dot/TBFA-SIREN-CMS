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
