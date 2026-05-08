/* =========================================================
   SIREN — admin-eligibility.js
   6순위 #6: 어드민 자격 변경 심사 모듈
   ========================================================= */
(function () {
  'use strict';

  const STATUS_LABEL = {
    pending: '⏳ 대기',
    approved: '✅ 승인',
    rejected: '❌ 반려',
    all: '전체',
  };

  let _currentStatus = 'pending';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function toast(msg) {
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

  function renderRow(it) {
    var m = it.member || {};
    var rev = it.reviewer ? '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">처리: ' + escapeHtml(it.reviewer.name || '-') + ' / ' + escapeHtml(fmtDate(it.reviewedAt)) + '</div>' : '';
    var note = it.adminNote ? '<div style="margin-top:6px;color:var(--text-2);font-size:12px;background:#f8fafc;border-left:3px solid #cbd5e1;padding:6px 8px;border-radius:4px">메모: ' + escapeHtml(it.adminNote) + '</div>' : '';
    var actions = '';
    if (it.status === 'pending') {
      actions = '' +
        '<button class="btn-sm btn-sm-primary" data-elig-act="approve" data-elig-id="' + it.id + '" type="button">✅ 승인</button> ' +
        '<button class="btn-sm btn-sm-ghost" data-elig-act="reject" data-elig-id="' + it.id + '" type="button">❌ 반려</button>';
    } else {
      actions = '<span style="color:var(--text-3);font-size:12px">' + (STATUS_LABEL[it.status] || it.status) + '</span>';
    }
    return '' +
      '<tr>' +
        '<td style="white-space:nowrap">#' + it.id + '<div style="font-size:11.5px;color:var(--text-3)">' + escapeHtml(fmtDate(it.createdAt)) + '</div></td>' +
        '<td>' +
          '<strong>' + escapeHtml(m.name || '(이름?)') + '</strong>' +
          '<div style="font-size:12px;color:var(--text-3)">' + escapeHtml(m.email || '') + '</div>' +
          (m.phone ? '<div style="font-size:12px;color:var(--text-3)">' + escapeHtml(m.phone) + '</div>' : '') +
        '</td>' +
        '<td>' + escapeHtml(it.currentType || '—') + ' → <strong>' + escapeHtml(it.requestedType) + '</strong></td>' +
        '<td style="max-width:340px"><div style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(it.reason || '') + '</div>' + note + '</td>' +
        '<td>' + (STATUS_LABEL[it.status] || it.status) + rev + '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td>' +
      '</tr>';
  }

  function ensureContainer() {
    return document.getElementById('adm-eligibility');
  }

  function renderShell() {
    var page = ensureContainer();
    if (!page) return;
    if (page.dataset.eligInit === '1') return;
    page.dataset.eligInit = '1';
    page.innerHTML = '' +
      '<div class="panel">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">' +
          '<h3 style="margin:0">🎓 교원 자격 변경 심사</h3>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn-sm btn-sm-ghost" data-elig-tab="pending" type="button">⏳ 대기 <span id="eligCntPending" class="adm-badge" style="display:none">0</span></button>' +
            '<button class="btn-sm btn-sm-ghost" data-elig-tab="approved" type="button">✅ 승인</button>' +
            '<button class="btn-sm btn-sm-ghost" data-elig-tab="rejected" type="button">❌ 반려</button>' +
            '<button class="btn-sm btn-sm-ghost" data-elig-tab="all" type="button">전체</button>' +
            '<button class="btn-sm btn-sm-ghost" id="btnEligRefresh" type="button">🔄 새로고침</button>' +
          '</div>' +
        '</div>' +
        '<table class="tbl">' +
          '<thead><tr><th style="width:120px">ID/일자</th><th style="width:200px">신청자</th><th style="width:160px">변경 내용</th><th>사유 / 메모</th><th style="width:140px">상태</th><th style="width:170px">작업</th></tr></thead>' +
          '<tbody id="eligTbody"><tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">불러오는 중...</td></tr></tbody>' +
        '</table>' +
      '</div>';
  }

  function setActiveTab(status) {
    document.querySelectorAll('#adm-eligibility [data-elig-tab]').forEach(function (b) {
      b.classList.toggle('btn-sm-primary', b.dataset.eligTab === status);
      b.classList.toggle('btn-sm-ghost', b.dataset.eligTab !== status);
    });
  }

  async function load(status) {
    renderShell();
    _currentStatus = status || _currentStatus || 'pending';
    setActiveTab(_currentStatus);

    var tbody = document.getElementById('eligTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-3)">불러오는 중...</td></tr>';

    var r = await api('/api/admin-eligibility-list?status=' + encodeURIComponent(_currentStatus));
    if (!r.ok) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#b91c1c">로드 실패: ' + escapeHtml((r.data && r.data.error) || ('HTTP ' + r.status)) + '</td></tr>';
      return;
    }
    var data = (r.data && r.data.data) || r.data || {};
    var items = data.items || [];
    var counts = data.counts || {};

    var pendingBadge = document.getElementById('eligCntPending');
    if (pendingBadge) {
      var pn = Number(counts.pending || 0);
      if (pn > 0) { pendingBadge.textContent = String(pn); pendingBadge.style.display = ''; }
      else pendingBadge.style.display = 'none';
    }
    var sidebar = document.getElementById('eligibilityMenuBadge');
    if (sidebar) {
      var pn2 = Number(counts.pending || 0);
      if (pn2 > 0) { sidebar.textContent = String(pn2); sidebar.style.display = ''; }
      else sidebar.style.display = 'none';
    }

    if (!items.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-3)">해당 상태의 신청이 없습니다.</td></tr>';
      return;
    }
    if (tbody) tbody.innerHTML = items.map(renderRow).join('');
  }

  async function refreshBadge() {
    var r = await api('/api/admin-eligibility-list?status=pending&limit=1');
    if (!r.ok) return;
    var data = (r.data && r.data.data) || r.data || {};
    var counts = data.counts || {};
    var sidebar = document.getElementById('eligibilityMenuBadge');
    if (sidebar) {
      var pn = Number(counts.pending || 0);
      if (pn > 0) { sidebar.textContent = String(pn); sidebar.style.display = ''; }
      else sidebar.style.display = 'none';
    }
  }

  /* ============ 클릭 위임 ============ */
  document.addEventListener('click', async function (e) {
    var tabBtn = e.target.closest && e.target.closest('#adm-eligibility [data-elig-tab]');
    if (tabBtn) {
      e.preventDefault();
      load(tabBtn.dataset.eligTab);
      return;
    }
    var refresh = e.target.closest && e.target.closest('#btnEligRefresh');
    if (refresh) { e.preventDefault(); load(_currentStatus); return; }

    var act = e.target.closest && e.target.closest('[data-elig-act]');
    if (!act) return;
    e.preventDefault();
    var id = Number(act.dataset.eligId);
    var action = act.dataset.eligAct;
    if (!id || !action) return;

    var note = '';
    if (action === 'reject') {
      note = window.prompt('반려 사유를 입력해주세요 (5자 이상)', '');
      if (note === null) return;
      if (!note || note.trim().length < 5) { toast('반려 사유는 5자 이상 입력해주세요'); return; }
    } else {
      note = window.prompt('승인 메모(선택, Enter로 생략)', '') || '';
    }

    act.disabled = true;
    var r = await api('/api/admin-eligibility-review', {
      method: 'POST',
      body: { id: id, action: action, adminNote: note },
    });
    act.disabled = false;
    if (!r.ok) { toast('처리 실패: ' + ((r.data && r.data.error) || ('HTTP ' + r.status))); return; }
    toast((r.data && r.data.message) || (action === 'approve' ? '승인 완료' : '반려 완료'));
    load(_currentStatus);
  });

  window.SIREN_ADMIN_ELIGIBILITY = { load: load, refreshBadge: refreshBadge };
})();
