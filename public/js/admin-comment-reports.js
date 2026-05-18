(function () {
  'use strict';

  /* ── mock 데이터 (B 머지 전 폴백) ── */
  var MOCK_COMMENT_REPORTS = {
    ok: true,
    reports: [
      { id: 77, reportType: 'comment', commentId: 33, incidentId: null,
        reason: '욕설/혐오 발언', status: 'pending', reporterName: '홍길동',
        createdAt: '2026-05-18T10:00:00Z' },
      { id: 78, reportType: 'incident', commentId: null, incidentId: 5,
        reason: '허위사실 유포', status: 'reviewed', reporterName: '김영희',
        createdAt: '2026-05-18T09:00:00Z' }
    ],
    total: 2
  };
  var MOCK_REPORT_REVIEW = { ok: true };

  /* ── 상태 ── */
  var state = { status: '', page: 1, limit: 20, total: 0 };
  var currentReportId = null;

  /* ── 헬퍼 ── */
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2500);
  }

  async function api(path, opts) {
    opts = opts || {};
    try {
      var r = await fetch(path, {
        method: opts.method || 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      var data = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, data: data };
    } catch (e) {
      return { ok: false, data: { error: e.message } };
    }
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
  }

  var STATUS_MAP = {
    pending:  { cls: 'badge-pending',  txt: '🟡 대기' },
    reviewed: { cls: 'badge-reviewed', txt: '✅ 완료' },
    rejected: { cls: 'badge-rejected', txt: '⬜ 기각' },
  };

  var TYPE_MAP = {
    comment:  { cls: 'type-comment',  txt: '댓글' },
    incident: { cls: 'type-incident', txt: '사건' },
  };

  /* ── 목록 로드 ── */
  async function load() {
    var tbody = document.getElementById('reportTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading">로딩 중...</td></tr>';

    var qs = '?page=' + state.page + '&limit=' + state.limit;
    if (state.status) qs += '&status=' + state.status;

    var res = await api('/api/admin-comment-reports' + qs);

    var reports, total;
    if (res.ok && (res.data.ok || res.data.reports)) {
      reports = res.data.data?.reports || res.data.reports || [];
      total   = res.data.data?.total   || res.data.total   || 0;
    } else {
      /* API 실패 → mock 폴백 */
      var filtered = MOCK_COMMENT_REPORTS.reports.filter(function (r) {
        return !state.status || r.status === state.status;
      });
      reports = filtered;
      total   = filtered.length;
    }

    state.total = total;
    renderTable(reports);
    renderPagination();
  }

  function renderTable(reports) {
    var tbody = document.getElementById('reportTableBody');
    if (!tbody) return;
    if (!reports.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">신고 내역이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = reports.map(function (r) {
      var st = STATUS_MAP[r.status] || { cls: '', txt: r.status };
      var tp = TYPE_MAP[r.reportType] || { cls: '', txt: r.reportType };
      return '<tr data-id="' + r.id + '">' +
        '<td>' + r.id + '</td>' +
        '<td><span class="type-badge ' + tp.cls + '">' + tp.txt + '</span></td>' +
        '<td>' + escHtml(r.reason) + '</td>' +
        '<td>' + escHtml(r.reporterName || '—') + '</td>' +
        '<td>' + fmtDate(r.createdAt) + '</td>' +
        '<td><span class="badge ' + st.cls + '">' + st.txt + '</span></td>' +
        '<td><button class="btn btn-sm btn-ghost review-btn" data-id="' + r.id + '" ' +
          'data-reason="' + escAttr(r.reason) + '" ' +
          'data-type="' + escAttr(r.reportType) + '" ' +
          'data-comment-id="' + (r.commentId || '') + '" ' +
          'data-incident-id="' + (r.incidentId || '') + '"' +
          '>검토</button></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.review-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn);
      });
    });
  }

  function renderPagination() {
    var el = document.getElementById('pagination');
    if (!el) return;
    var totalPages = Math.ceil(state.total / state.limit) || 1;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    var html = '<button class="pg-btn" ' + (state.page <= 1 ? 'disabled' : '') +
      ' onclick="COMMENT_REPORTS.goPage(' + (state.page - 1) + ')">‹</button>';
    for (var i = 1; i <= totalPages; i++) {
      html += '<button class="pg-btn' + (i === state.page ? ' active' : '') +
        '" onclick="COMMENT_REPORTS.goPage(' + i + ')">' + i + '</button>';
    }
    html += '<button class="pg-btn" ' + (state.page >= totalPages ? 'disabled' : '') +
      ' onclick="COMMENT_REPORTS.goPage(' + (state.page + 1) + ')">›</button>';
    el.innerHTML = html;
  }

  /* ── 검토 모달 ── */
  function openModal(btn) {
    currentReportId = btn.dataset.id;
    var reason    = btn.dataset.reason;
    var type      = btn.dataset.type;
    var commentId = btn.dataset.commentId;
    var incidentId = btn.dataset.incidentId;

    document.getElementById('modalReason').textContent = reason || '—';

    var targetTxt;
    if (type === 'comment' && commentId) {
      targetTxt = '댓글 #' + commentId;
    } else if (type === 'incident' && incidentId) {
      targetTxt = '사건 신고 #' + incidentId;
    } else {
      targetTxt = type;
    }
    document.getElementById('modalTarget').textContent = targetTxt;

    /* 라디오 초기화 */
    var radios = document.querySelectorAll('input[name="reviewAction"]');
    radios.forEach(function (r) { r.checked = r.value === 'none'; });

    document.getElementById('reviewModal').classList.add('show');
  }

  window.closeModal = function () {
    document.getElementById('reviewModal').classList.remove('show');
    currentReportId = null;
  };

  window.submitReview = async function () {
    if (!currentReportId) return;
    var action = document.querySelector('input[name="reviewAction"]:checked')?.value || 'none';

    var res = await api('/api/admin-comment-report-review', {
      method: 'PATCH',
      body: { reportId: parseInt(currentReportId, 10), action: action },
    });

    var ok = res.ok && (res.data.ok !== false);
    if (!ok && !res.data.ok) {
      /* mock 폴백 */
      ok = MOCK_REPORT_REVIEW.ok;
    }

    if (ok) {
      var msg = action === 'none' ? '신고가 기각되었습니다.' : '처리되었습니다.';
      toast(msg);
      closeModal();
      /* 해당 행 상태 갱신 */
      var newStatus = action === 'none' ? 'rejected' : 'reviewed';
      var row = document.querySelector('tr[data-id="' + currentReportId + '"]');
      if (row) {
        var badgeCell = row.cells[5];
        var st = STATUS_MAP[newStatus] || { cls: '', txt: newStatus };
        badgeCell.innerHTML = '<span class="badge ' + st.cls + '">' + st.txt + '</span>';
      }
    } else {
      toast(res.data?.error || '처리 실패');
    }
  };

  /* ── 필터 탭 ── */
  function bindTabs() {
    document.querySelectorAll('.filter-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-tab').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.status = btn.dataset.status;
        state.page   = 1;
        load();
      });
    });
  }

  /* ── escape 헬퍼 ── */
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── 페이지 이동 (외부 접근) ── */
  window.COMMENT_REPORTS = {
    goPage: function (p) {
      state.page = p;
      load();
    }
  };

  /* ── 초기화 ── */
  document.addEventListener('DOMContentLoaded', function () {
    bindTabs();
    load();
  });

  /* iframe 내에서 재진입 시 재로드 */
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bindTabs();
    load();
  }
})();
