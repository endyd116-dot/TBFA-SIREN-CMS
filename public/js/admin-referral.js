/* ============================================================
   admin-referral.js — Phase 14 인계 이력 + 인계 실행
   섹션: adm-referral-history
   ============================================================ */

(function () {
  'use strict';

  /* ── mock 스위치 ── */
  var USE_MOCK = false;

  var MOCK_AGENCIES = {
    ok: true,
    agencies: [
      { id: 1, name: '서울강남경찰서', agencyType: 'police', contactName: '김철수',
        contactPhone: '02-1234-5678', jurisdiction: '서울 강남구', hasTemplate: true, isActive: true }
    ]
  };

  var MOCK_REFERRAL_LIST = {
    ok: true,
    total: 2,
    logs: [
      {
        id: 1,
        agencyName: '서울강남경찰서',
        sourceType: 'incident',
        sourceNo: 'IR-20260501-001',
        referredAt: '2026-05-01T10:00:00Z',
        status: 'reviewing',
        statusMemo: '담당자 배정 완료',
        statusUpdatedAt: '2026-05-03T14:00:00Z'
      },
      {
        id: 2,
        agencyName: '서울시교육청',
        sourceType: 'harassment',
        sourceNo: 'HR-20260503-005',
        referredAt: '2026-05-03T09:00:00Z',
        status: 'sent',
        statusMemo: null,
        statusUpdatedAt: null
      }
    ]
  };

  /* ── 상수 ── */
  var SOURCE_TYPE_LABELS = {
    incident: '사건 신고',
    harassment: '괴롭힘 신고',
    legal: '법률 상담'
  };

  var STATUS_LABELS = {
    pending: '대기 중',
    sent: '발송됨',
    reviewing: '검토 중',
    in_progress: '처리 중',
    completed: '완료',
    rejected: '반려'
  };

  var STATUS_COLORS = {
    pending: '#6c757d',
    sent: '#6c757d',
    reviewing: '#007bff',
    in_progress: '#fd7e14',
    completed: '#28a745',
    rejected: '#dc3545'
  };

  /* ── 상태 변수 ── */
  var logs = [];
  var logTotal = 0;
  var currentPage = 1;
  var pageLimit = 20;
  var agencies = [];
  var selectedLogId = null;

  /* ── DOM 진입점 ── */
  var $section = null;

  /* ────────────────────────────────────────────────
     초기화
  ──────────────────────────────────────────────── */
  function init() {
    $section = document.getElementById('adm-referral-history');
    if (!$section) return;

    renderShell();
    bindEvents();
    loadAgencies(function () { loadLogs(); });
  }

  /* ── 빈 HTML 골격 렌더 ── */
  function renderShell() {
    $section.innerHTML = [
      '<div class="adm-page-header">',
      '  <h2 class="serif" style="margin:0">📤 인계 이력</h2>',
      '  <button id="refBtnCreate" class="btn-primary" style="margin-left:auto">+ 인계 실행</button>',
      '</div>',

      '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">',
      '  <select id="refFilterSource" style="padding:7px 12px;border:1px solid var(--line);border-radius:6px;font-size:12.5px">',
      '    <option value="">전체 신고 유형</option>',
      '    <option value="incident">사건 신고</option>',
      '    <option value="harassment">괴롭힘 신고</option>',
      '    <option value="legal">법률 상담</option>',
      '  </select>',
      '  <select id="refFilterStatus" style="padding:7px 12px;border:1px solid var(--line);border-radius:6px;font-size:12.5px">',
      '    <option value="">전체 상태</option>',
      '    <option value="sent">발송됨</option>',
      '    <option value="reviewing">검토 중</option>',
      '    <option value="in_progress">처리 중</option>',
      '    <option value="completed">완료</option>',
      '    <option value="rejected">반려</option>',
      '  </select>',
      '  <button id="refBtnRefresh" style="padding:7px 14px;border:1px solid var(--line);border-radius:6px;background:#fff;font-size:12.5px;cursor:pointer">새로고침</button>',
      '</div>',

      '<div id="refList"></div>',
      '<div id="refPager" style="text-align:center;margin-top:16px"></div>',

      /* ── 인계 실행 모달 ── */
      '<div id="refCreateModal" class="modal">',
      '  <div class="modal-content" style="max-width:520px">',
      '    <div class="modal-header">',
      '      <h3 class="serif">인계 실행</h3>',
      '      <button class="modal-close" id="refCreateClose">&times;</button>',
      '    </div>',
      '    <div class="modal-body">',
      '      <p style="font-size:12.5px;color:var(--text-2);margin-bottom:16px;line-height:1.6">',
      '        인계 실행 시 기관에 등록된 양식으로 PDF가 생성되고 이력이 기록됩니다.',
      '      </p>',
      '      <div style="display:grid;gap:14px">',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px">대상 기관 <span style="color:var(--danger)">*</span></label>',
      '          <select id="refFldAgency" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">',
      '            <option value="">기관 선택…</option>',
      '          </select>',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px">신고 유형 <span style="color:var(--danger)">*</span></label>',
      '          <select id="refFldSourceType" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">',
      '            <option value="">선택…</option>',
      '            <option value="incident">사건 신고</option>',
      '            <option value="harassment">괴롭힘 신고</option>',
      '            <option value="legal">법률 상담</option>',
      '          </select>',
      '        </div>',
      '        <div>',
      '          <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px">신고 ID <span style="color:var(--danger)">*</span></label>',
      '          <input id="refFldSourceId" type="number" min="1" placeholder="신고 레코드 ID 입력" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box">',
      '          <p style="font-size:11.5px;color:var(--text-3);margin:4px 0 0">신고 관리 목록에서 확인할 수 있는 숫자 ID입니다.</p>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--line)">',
      '      <button id="refCreateCancel" style="padding:8px 18px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer">취소</button>',
      '      <button id="refCreateSubmit" class="btn-primary">PDF 생성 & 인계</button>',
      '    </div>',
      '  </div>',
      '</div>',

      /* ── 상태 갱신 모달 ── */
      '<div id="refStatusModal" class="modal">',
      '  <div class="modal-content" style="max-width:440px">',
      '    <div class="modal-header">',
      '      <h3 class="serif">인계 상태 갱신</h3>',
      '      <button class="modal-close" id="refStatusClose">&times;</button>',
      '    </div>',
      '    <div class="modal-body" style="display:grid;gap:14px">',
      '      <div>',
      '        <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px">상태</label>',
      '        <select id="refFldStatus" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px">',
      '          <option value="pending">대기 중</option>',
      '          <option value="sent">발송됨</option>',
      '          <option value="reviewing">검토 중</option>',
      '          <option value="in_progress">처리 중</option>',
      '          <option value="completed">완료</option>',
      '          <option value="rejected">반려</option>',
      '        </select>',
      '      </div>',
      '      <div>',
      '        <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px">메모</label>',
      '        <textarea id="refFldMemo" rows="3" placeholder="기관 회신 내용, 처리 메모 등" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;font-family:inherit"></textarea>',
      '      </div>',
      '    </div>',
      '    <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--line)">',
      '      <button id="refStatusCancel" style="padding:8px 18px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer">취소</button>',
      '      <button id="refStatusSave" class="btn-primary">저장</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ────────────────────────────────────────────────
     이벤트 바인딩
  ──────────────────────────────────────────────── */
  function bindEvents() {
    $section.addEventListener('click', function (e) {
      var t = e.target;

      if (t.id === 'refBtnCreate') openCreateModal();
      if (t.id === 'refBtnRefresh') { currentPage = 1; loadLogs(); }
      if (t.id === 'refCreateClose' || t.id === 'refCreateCancel') closeCreateModal();
      if (t.id === 'refCreateSubmit') submitCreate();
      if (t.id === 'refStatusClose' || t.id === 'refStatusCancel') closeStatusModal();
      if (t.id === 'refStatusSave') saveStatus();

      /* 행 액션 */
      var statusBtn = t.closest('[data-ref-status]');
      if (statusBtn) openStatusModal(parseInt(statusBtn.dataset.refStatus, 10));

      var pdfBtn = t.closest('[data-ref-pdf]');
      if (pdfBtn) downloadPdf(parseInt(pdfBtn.dataset.refPdf, 10));

      var pageBtn = t.closest('[data-ref-page]');
      if (pageBtn) {
        currentPage = parseInt(pageBtn.dataset.refPage, 10);
        loadLogs();
      }
    });

    $section.addEventListener('change', function (e) {
      if (e.target.id === 'refFilterSource' || e.target.id === 'refFilterStatus') {
        currentPage = 1;
        loadLogs();
      }
    });
  }

  /* ────────────────────────────────────────────────
     기관 목록 로드 (인계 실행 모달용)
  ──────────────────────────────────────────────── */
  function loadAgencies(callback) {
    if (USE_MOCK) {
      agencies = MOCK_AGENCIES.agencies.filter(function (a) { return a.isActive; });
      if (callback) callback();
      return;
    }
    api({ url: '/api/admin-agency-list?active=1' }).then(function (res) {
      var d = res.data.data || res.data;
      agencies = d.agencies || [];
    }).catch(function () {
      agencies = [];
    }).finally(function () {
      if (callback) callback();
    });
  }

  /* ────────────────────────────────────────────────
     인계 이력 로드
  ──────────────────────────────────────────────── */
  function loadLogs() {
    var listEl = document.getElementById('refList');
    var pagerEl = document.getElementById('refPager');
    if (!listEl) return;
    listEl.innerHTML = '<p style="text-align:center;color:var(--text-3);padding:30px">로딩 중…</p>';
    if (pagerEl) pagerEl.innerHTML = '';

    if (USE_MOCK) {
      logs = MOCK_REFERRAL_LIST.logs.slice();
      logTotal = MOCK_REFERRAL_LIST.total;
      renderLogs();
      return;
    }

    var sourceType = (document.getElementById('refFilterSource') || {}).value || '';
    var status = (document.getElementById('refFilterStatus') || {}).value || '';
    var qs = ['page=' + currentPage, 'limit=' + pageLimit];
    if (sourceType) qs.push('sourceType=' + encodeURIComponent(sourceType));
    if (status) qs.push('status=' + encodeURIComponent(status));

    api({ url: '/api/admin-referral-list?' + qs.join('&') }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
      var d = res.data.data || res.data;
      logs = d.logs || [];
      logTotal = d.total || 0;
      renderLogs();
    }).catch(function (err) {
      listEl.innerHTML = '<p style="color:var(--danger);text-align:center;padding:20px">불러오기 실패: ' + err.message + '</p>';
    });
  }

  /* ────────────────────────────────────────────────
     이력 목록 렌더
  ──────────────────────────────────────────────── */
  function renderLogs() {
    var listEl = document.getElementById('refList');
    var pagerEl = document.getElementById('refPager');
    if (!listEl) return;

    if (!logs.length) {
      listEl.innerHTML = '<p style="text-align:center;color:var(--text-3);padding:40px">인계 이력이 없습니다.</p>';
      return;
    }

    var rows = logs.map(function (log) {
      var typeLabel = SOURCE_TYPE_LABELS[log.sourceType] || log.sourceType;
      var statusLabel = STATUS_LABELS[log.status] || log.status;
      var color = STATUS_COLORS[log.status] || '#6c757d';
      var statusBadge = '<span style="background:' + color + '1a;color:' + color + ';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">' + esc(statusLabel) + '</span>';
      var referredAt = formatDate(log.referredAt);
      var updatedAt = log.statusUpdatedAt ? formatDate(log.statusUpdatedAt) : '-';

      return [
        '<tr style="border-bottom:1px solid var(--line)">',
        '  <td style="padding:11px 10px;font-size:12px;color:var(--text-3)">#' + log.id + '</td>',
        '  <td style="padding:11px 10px;font-weight:600">' + esc(log.agencyName) + '</td>',
        '  <td style="padding:11px 10px">' + esc(typeLabel) + '</td>',
        '  <td style="padding:11px 10px;font-size:12px;color:var(--text-2)">' + esc(log.sourceNo) + '</td>',
        '  <td style="padding:11px 10px;font-size:12px">' + esc(referredAt) + '</td>',
        '  <td style="padding:11px 10px">' + statusBadge + '</td>',
        '  <td style="padding:11px 10px;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(log.statusMemo || '') + '">' + esc(log.statusMemo || '-') + '</td>',
        '  <td style="padding:11px 10px;font-size:12px">' + esc(updatedAt) + '</td>',
        '  <td style="padding:11px 10px;white-space:nowrap">',
        '    <button data-ref-status="' + log.id + '" style="padding:4px 10px;border:1px solid var(--line);border-radius:5px;background:#fff;cursor:pointer;font-size:11.5px;margin-right:4px">상태 변경</button>',
        '    <button data-ref-pdf="' + log.id + '" style="padding:4px 10px;border:1px solid var(--line);border-radius:5px;background:#fff;cursor:pointer;font-size:11.5px">PDF</button>',
        '  </td>',
        '</tr>'
      ].join('');
    });

    listEl.innerHTML = [
      '<table style="width:100%;border-collapse:collapse;font-size:13px">',
      '  <thead>',
      '    <tr style="background:var(--surface);text-align:left">',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">#</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">기관</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">유형</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">신고번호</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">인계일시</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">상태</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">메모</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">상태 갱신일</th>',
      '      <th style="padding:10px;font-weight:600;border-bottom:2px solid var(--line)">관리</th>',
      '    </tr>',
      '  </thead>',
      '  <tbody>' + rows.join('') + '</tbody>',
      '</table>'
    ].join('');

    /* 페이저 */
    if (pagerEl) {
      var totalPages = Math.ceil(logTotal / pageLimit);
      if (totalPages > 1) {
        var pages = [];
        for (var p = 1; p <= totalPages; p++) {
          var active = p === currentPage;
          pages.push('<button data-ref-page="' + p + '" style="padding:5px 10px;border:1px solid ' + (active ? 'var(--primary)' : 'var(--line)') + ';border-radius:5px;background:' + (active ? 'var(--primary)' : '#fff') + ';color:' + (active ? '#fff' : 'inherit') + ';cursor:pointer;font-size:12px;margin:2px">' + p + '</button>');
        }
        pagerEl.innerHTML = '<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">' + pages.join('') + '</div>';
      }
    }
  }

  /* ────────────────────────────────────────────────
     인계 실행 모달
  ──────────────────────────────────────────────── */
  function openCreateModal() {
    var modal = document.getElementById('refCreateModal');
    if (!modal) return;

    /* 기관 셀렉트 채우기 */
    var agencySelect = document.getElementById('refFldAgency');
    if (agencySelect) {
      agencySelect.innerHTML = '<option value="">기관 선택…</option>';
      agencies.forEach(function (ag) {
        var opt = document.createElement('option');
        opt.value = ag.id;
        opt.textContent = ag.name + (ag.hasTemplate ? '' : ' (양식 없음)');
        agencySelect.appendChild(opt);
      });
    }

    var stEl = document.getElementById('refFldSourceType');
    var siEl = document.getElementById('refFldSourceId');
    if (stEl) stEl.value = '';
    if (siEl) siEl.value = '';

    modal.classList.add('show');
  }

  function closeCreateModal() {
    var modal = document.getElementById('refCreateModal');
    if (modal) modal.classList.remove('show');
  }

  function submitCreate() {
    var agencyId = parseInt((document.getElementById('refFldAgency') || {}).value || '0', 10);
    var sourceType = (document.getElementById('refFldSourceType') || {}).value;
    var sourceId = parseInt((document.getElementById('refFldSourceId') || {}).value || '0', 10);

    if (!agencyId || !sourceType || !sourceId) {
      showToast('기관·신고 유형·신고 ID를 모두 입력하세요.', 'error');
      return;
    }

    if (USE_MOCK) {
      closeCreateModal();
      var newId = logs.length ? Math.max.apply(null, logs.map(function (l) { return l.id; })) + 1 : 1;
      var ag = agencies.find(function (a) { return a.id === agencyId; }) || {};
      logs.unshift({
        id: newId,
        agencyName: ag.name || '알 수 없음',
        sourceType: sourceType,
        sourceNo: (sourceType === 'incident' ? 'IR' : sourceType === 'harassment' ? 'HR' : 'LC') + '-MOCK-' + sourceId,
        referredAt: new Date().toISOString(),
        status: 'sent',
        statusMemo: null,
        statusUpdatedAt: null
      });
      logTotal++;
      renderLogs();
      showToast('(Mock) 인계가 기록되었습니다. 실 API 연결 후 PDF가 다운로드됩니다.', 'success');
      return;
    }

    var submitBtn = document.getElementById('refCreateSubmit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '처리 중…'; }

    fetch('/api/admin-referral-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ agencyId: agencyId, sourceType: sourceType, sourceId: sourceId })
    }).then(function (res) {
      return res.json().then(function (d) {
        if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status);
        return d;
      });
    }).then(function (d) {
      var logId = d.logId;
      closeCreateModal();
      currentPage = 1;
      loadLogs();
      showToast('인계 기록이 저장되었습니다. PDF를 다운로드합니다.', 'success');
      /* PDF 별도 다운로드 */
      if (logId) {
        fetch('/api/admin-referral-pdf?referralId=' + logId, { credentials: 'include' })
          .then(function (r) {
            if (!r.ok) throw new Error('PDF HTTP ' + r.status);
            return r.blob();
          })
          .then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'referral-' + sourceType + '-' + sourceId + '.pdf';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
          })
          .catch(function (err) {
            showToast('PDF 다운로드 실패: ' + err.message, 'error');
          });
      }
    }).catch(function (err) {
      showToast('인계 실패: ' + err.message, 'error');
    }).finally(function () {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'PDF 생성 & 인계'; }
    });
  }

  /* ────────────────────────────────────────────────
     상태 갱신 모달
  ──────────────────────────────────────────────── */
  function openStatusModal(logId) {
    selectedLogId = logId;
    var log = logs.find(function (l) { return l.id === logId; });
    if (!log) return;

    var modal = document.getElementById('refStatusModal');
    if (!modal) return;

    var statusEl = document.getElementById('refFldStatus');
    var memoEl = document.getElementById('refFldMemo');
    if (statusEl) statusEl.value = log.status || 'sent';
    if (memoEl) memoEl.value = log.statusMemo || '';

    modal.classList.add('show');
  }

  function closeStatusModal() {
    var modal = document.getElementById('refStatusModal');
    if (modal) modal.classList.remove('show');
    selectedLogId = null;
  }

  function saveStatus() {
    if (!selectedLogId) return;
    var status = (document.getElementById('refFldStatus') || {}).value;
    var memo = ((document.getElementById('refFldMemo') || {}).value || '').trim();

    if (!status) { showToast('상태를 선택하세요.', 'error'); return; }

    if (USE_MOCK) {
      var log = logs.find(function (l) { return l.id === selectedLogId; });
      if (log) {
        log.status = status;
        log.statusMemo = memo || null;
        log.statusUpdatedAt = new Date().toISOString();
      }
      closeStatusModal();
      renderLogs();
      showToast('상태를 갱신했습니다.', 'success');
      return;
    }

    var saveBtn = document.getElementById('refStatusSave');
    if (saveBtn) saveBtn.disabled = true;

    api({
      url: '/api/admin-referral-status-update',
      method: 'POST',
      body: { referralId: selectedLogId, status: status, statusMemo: memo }
    }).then(function (res) {
      if (!res.ok) throw new Error(res.data && res.data.error || 'HTTP ' + res.status);
      closeStatusModal();
      loadLogs();
      showToast('상태를 갱신했습니다.', 'success');
    }).catch(function (err) {
      showToast('갱신 실패: ' + err.message, 'error');
    }).finally(function () {
      if (saveBtn) saveBtn.disabled = false;
    });
  }

  /* ────────────────────────────────────────────────
     PDF 재다운로드
  ──────────────────────────────────────────────── */
  function downloadPdf(logId) {
    if (USE_MOCK) {
      showToast('(Mock) 실 API 연결 후 PDF를 다운로드할 수 있습니다.', 'info');
      return;
    }

    fetch('/api/admin-referral-pdf?referralId=' + logId, { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'referral-' + logId + '.pdf';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
      })
      .catch(function (err) {
        showToast('PDF 다운로드 실패: ' + err.message, 'error');
      });
  }

  /* ────────────────────────────────────────────────
     유틸
  ──────────────────────────────────────────────── */
  function formatDate(iso) {
    if (!iso) return '-';
    try {
      var d = new Date(iso);
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return iso; }
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
  document.addEventListener('adm:page', function (e) {
    if (e.detail && e.detail.page === 'referral-history') {
      if (!$section) init();
      else { currentPage = 1; loadAgencies(function () { loadLogs(); }); }
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (window.location.hash === '#referral-history') init();
  });

  window.adminReferral = { init: init, reload: loadLogs };

})();
