/* =========================================================
   SIREN — mypage-eligibility.js
   6순위 #6: 마이페이지 → 교원 자격 변경 신청 모듈
   ========================================================= */
(function () {
  'use strict';

  const TYPES = ['현직', '은퇴', '예비', '일반'];
  const STATUS_LABEL = {
    pending: '⏳ 검토 대기',
    approved: '✅ 승인',
    rejected: '❌ 반려',
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg, kind) {
    if (window.SIREN && window.SIREN.toast) return window.SIREN.toast(msg);
    alert(msg);
  }

  function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleString('ko-KR'); } catch { return String(s); }
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  function renderHistory(items) {
    if (!items || !items.length) {
      return '<p style="color:var(--text-3);text-align:center;padding:24px">아직 신청 이력이 없습니다.</p>';
    }
    var rows = items.map(function (it) {
      var note = it.adminNote ? '<div style="margin-top:6px;color:var(--text-2);font-size:12.5px">메모: ' + escapeHtml(it.adminNote) + '</div>' : '';
      var reviewed = it.reviewedAt ? '<div style="font-size:12px;color:var(--text-3)">심사: ' + escapeHtml(fmtDate(it.reviewedAt)) + '</div>' : '';
      return '' +
        '<tr>' +
          '<td style="white-space:nowrap">' + escapeHtml(fmtDate(it.createdAt)) + '</td>' +
          '<td>' + escapeHtml(it.currentType || '—') + ' → <strong>' + escapeHtml(it.requestedType) + '</strong></td>' +
          '<td style="max-width:280px"><div style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(it.reason || '') + '</div>' + note + '</td>' +
          '<td>' + (STATUS_LABEL[it.status] || it.status) + reviewed + '</td>' +
        '</tr>';
    }).join('');
    return '' +
      '<table class="tbl" style="margin-top:14px">' +
        '<thead><tr><th>신청일</th><th>변경 내용</th><th>사유</th><th>상태</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  function renderPanel(state) {
    var disabled = state.hasPending ? 'disabled' : '';
    var cur = state.currentType ? '<strong>' + escapeHtml(state.currentType) + '</strong>' : '<span style="color:var(--text-3)">미설정</span>';
    return '' +
      '<h3 class="serif">🎓 교원 자격 변경</h3>' +
      '<p class="sub">현직/은퇴/예비/일반 자격을 변경 신청하실 수 있습니다. 신청 후 운영자 검토를 거쳐 결과를 알려드립니다.</p>' +
      '<div class="panel" style="margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
          '<div><span style="color:var(--text-3);font-size:13px">현재 자격</span> ' + cur + '</div>' +
          (state.hasPending ? '<span style="background:#fef3c7;color:#92400e;border-radius:14px;padding:4px 10px;font-size:12px">⏳ 검토 대기 중인 신청이 있습니다</span>' : '') +
        '</div>' +
      '</div>' +

      '<form id="eligForm" style="display:grid;gap:12px;max-width:640px">' +
        '<div class="fg">' +
          '<label>변경할 자격 <span style="color:var(--danger)">*</span></label>' +
          '<select id="eligType" required ' + disabled + '>' +
            '<option value="">선택하세요</option>' +
            TYPES.map(function (t) {
              var sel = (state.currentType === t) ? ' style="color:var(--text-3)"' : '';
              return '<option value="' + t + '"' + sel + '>' + t + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="fg">' +
          '<label>변경 사유 <span style="color:var(--danger)">*</span> <span class="hint">(10자 이상)</span></label>' +
          '<textarea id="eligReason" rows="4" maxlength="2000" placeholder="자격 변경이 필요한 사유를 작성해주세요" ' + disabled + '></textarea>' +
        '</div>' +
        '<div class="fg" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<button type="submit" class="btn btn-primary" ' + disabled + '>신청 제출</button>' +
          (state.hasPending ? '<span style="color:var(--text-3);font-size:12.5px">검토가 끝난 뒤 새로 신청할 수 있습니다.</span>' : '') +
        '</div>' +
      '</form>' +

      '<div style="margin-top:20px">' +
        '<h4 style="margin:0 0 6px;font-size:14px">📋 신청 이력</h4>' +
        renderHistory(state.items) +
      '</div>';
  }

  async function load() {
    var panel = document.querySelector('.mp-panel[data-mp-panel="eligibility"]');
    if (!panel) return;
    panel.innerHTML = '<p style="color:var(--text-3);padding:24px">불러오는 중...</p>';

    var r = await api('/api/eligibility-status');
    if (!r.ok) {
      panel.innerHTML = '<div class="panel" style="border-color:#fca5a5;background:#fff5f5">로드 실패: ' +
        escapeHtml((r.data && r.data.error) || ('HTTP ' + r.status)) + '</div>';
      return;
    }
    var data = (r.data && r.data.data) || r.data || {};
    panel.innerHTML = renderPanel({
      currentType: data.currentType || null,
      hasPending: !!data.hasPending,
      items: data.items || [],
    });

    var form = panel.querySelector('#eligForm');
    if (form) form.addEventListener('submit', onSubmit);
  }

  async function onSubmit(e) {
    e.preventDefault();
    var typeEl = document.getElementById('eligType');
    var reasonEl = document.getElementById('eligReason');
    var requestedType = (typeEl && typeEl.value) || '';
    var reason = ((reasonEl && reasonEl.value) || '').trim();
    if (!TYPES.includes(requestedType)) return toast('자격 유형을 선택해주세요');
    if (reason.length < 10) return toast('변경 사유를 10자 이상 작성해주세요');

    var btn = e.target.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.textContent = '제출 중...'; }

    var r = await api('/api/eligibility-request', {
      method: 'POST',
      body: { requestedType: requestedType, reason: reason },
    });
    if (btn) { btn.disabled = false; btn.textContent = '신청 제출'; }

    if (!r.ok) {
      var msg = (r.data && r.data.error) || ('HTTP ' + r.status);
      return toast('신청 실패: ' + msg);
    }
    toast((r.data && r.data.message) || '신청이 접수되었습니다');
    load();
  }

  /* mp 메뉴 클릭 시 자동 로드 (mypage.html의 activatePanel 다음 호출) */
  document.addEventListener('click', function (e) {
    var li = e.target && e.target.closest && e.target.closest('li[data-mp="eligibility"]');
    if (!li) return;
    setTimeout(load, 30);
  });

  /* 페이지 진입 시 hash가 #eligibility면 자동 로드 */
  document.addEventListener('DOMContentLoaded', function () {
    if ((location.hash || '').replace('#', '') === 'eligibility') {
      setTimeout(load, 100);
    }
  });

  window.SIREN_MYPAGE_ELIGIBILITY = { load: load };
})();
