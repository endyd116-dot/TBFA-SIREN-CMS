/* =========================================================
   SIREN — admin-report.js
   Phase 4: 대표 보고 시스템 어드민 모듈
   ========================================================= */
(function () {
  'use strict';

  var _chartDonut = null;
  var _chartBar   = null;

  /* ---- 유틸 ---- */

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
    try { return new Date(s).toLocaleDateString('ko-KR'); } catch (e) { return String(s); }
  }

  function fmtDateTime(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleString('ko-KR'); } catch (e) { return String(s); }
  }

  function fmtAmount(n) {
    return (Number(n) || 0).toLocaleString() + '원';
  }

  function fmtNum(n) {
    return (Number(n) || 0).toLocaleString();
  }

  function toDateInput(d) {
    return d.toISOString().slice(0, 10);
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    try {
      var res = await fetch(path, init);
      var data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data: data };
    } catch (e) {
      return { status: 0, ok: false, data: { error: '네트워크 오류' } };
    }
  }

  /* ---- 진입점 ---- */

  function getContainer() {
    return document.getElementById('adm-report');
  }

  async function load() {
    var c = getContainer();
    if (!c) return;
    renderShell(c);
    await loadList();
  }

  /* ---- 셸 레이아웃 (한 번만 그림) ---- */

  function renderShell(c) {
    destroyCharts();
    c.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">' +
        '<h2 style="font-size:20px;font-weight:700;margin:0">📊 주간 보고서</h2>' +
        '<button class="btn-sm btn-sm-primary" id="rptBtnGenerate" type="button">+ 보고서 생성</button>' +
      '</div>' +

      /* 대표 보고서 탭 (월간 / 분기 / 연간) */
      '<div class="panel" style="padding:20px;margin-bottom:24px">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:14px">📋 대표 보고서</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:16px" id="rptBoardTabs">' +
          '<button class="btn-sm rpt-board-tab active" data-board-type="monthly" type="button">월간</button>' +
          '<button class="btn-sm rpt-board-tab" data-board-type="quarterly" type="button">분기</button>' +
          '<button class="btn-sm rpt-board-tab" data-board-type="yearly" type="button">연간</button>' +
        '</div>' +
        '<div id="rptBoardContent" style="color:var(--text-3,#6b7280);font-size:13px">탭을 선택하면 집계를 불러옵니다.</div>' +
      '</div>' +

      '<div id="rptList"></div>' +
      '<div id="rptDetail" style="display:none"></div>';

    /* 이벤트: 생성 버튼 */
    c.querySelector('#rptBtnGenerate').addEventListener('click', function () {
      showGenerateModal();
    });

    /* 이벤트: 대표 보고서 탭 */
    c.querySelector('#rptBoardTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.rpt-board-tab[data-board-type]');
      if (!btn) return;
      c.querySelectorAll('.rpt-board-tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      loadBoardReport(btn.dataset.boardType);
    });

    /* 이벤트 위임: 목록 클릭 (목록 재렌더 후에도 살아있음) */
    c.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-rpt-open]');
      if (btn) {
        loadDetail(parseInt(btn.dataset.rptOpen, 10));
        return;
      }
      var row = e.target.closest('.rpt-row[data-rpt-id]');
      if (row) loadDetail(parseInt(row.dataset.rptId, 10));
    });
  }

  /* ---- 대표 보고서 집계 (월간 / 분기 / 연간) ---- */

  async function loadBoardReport(type) {
    var el = document.getElementById('rptBoardContent');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--text-3,#6b7280)">불러오는 중...</p>';

    var res = await api('/api/admin-report-board?type=' + encodeURIComponent(type));
    if (!res.ok) {
      el.innerHTML = '<p style="color:var(--danger,#ef4444)">집계 불러오기 실패: ' +
        escapeHtml((res.data && res.data.error) || '알 수 없는 오류') + '</p>';
      return;
    }

    var d = res.data.data || res.data;
    renderBoardReport(el, d, type);
  }

  function renderBoardReport(el, d, type) {
    var TYPE_LABEL = { monthly: '월간', quarterly: '분기', yearly: '연간' };
    var typeLabel = TYPE_LABEL[type] || type;
    var period = d.period || '';
    var donation = d.donation || {};
    var member = d.member || {};
    var siren = d.siren || {};
    var beneficiary = d.beneficiary || {};

    var cards = [
      { label: typeLabel + ' 총 후원', value: fmtAmount(donation.totalAmount), icon: '💰' },
      { label: '정기 후원', value: fmtAmount(donation.regularAmount), icon: '🔄' },
      { label: '신규 후원자', value: fmtNum(donation.newDonors) + '명', icon: '🙋' },
      { label: '활성 회원', value: fmtNum(member.totalActive) + '명', icon: '👥' },
      { label: '신규 회원', value: fmtNum(member.newCount) + '명', icon: '📈' },
      { label: '사이렌 처리', value: fmtNum(siren.resolvedCount) + '/' + fmtNum(siren.totalHandled) + '건', icon: '🚨' },
      { label: '상담 지원', value: fmtNum(beneficiary.counselingCount) + '건', icon: '🤝' },
      { label: '법률 지원', value: fmtNum(beneficiary.legalCount) + '건', icon: '⚖️' }
    ];

    el.innerHTML =
      (period ? '<div style="font-size:13px;color:var(--text-3,#6b7280);margin-bottom:12px">기준 기간: ' + escapeHtml(period) + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">' +
      cards.map(function (c) {
        return '<div style="background:var(--bg-2,#f9fafb);border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:20px;margin-bottom:6px">' + c.icon + '</div>' +
          '<div style="font-size:18px;font-weight:700;color:var(--text-1,#111)">' + escapeHtml(c.value) + '</div>' +
          '<div style="font-size:11px;color:var(--text-3,#6b7280);margin-top:3px">' + escapeHtml(c.label) + '</div>' +
          '</div>';
      }).join('') +
      '</div>';
  }

  /* ---- 목록 ---- */

  async function loadList() {
    var listEl = document.getElementById('rptList');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color:var(--text-3);padding:20px 0">불러오는 중...</p>';

    var res = await api('/api/admin-report-list');
    if (!res.ok) {
      listEl.innerHTML =
        '<p style="color:var(--danger);padding:20px 0">목록 불러오기 실패: ' +
        escapeHtml((res.data && res.data.error) || '') + '</p>';
      return;
    }

    var payload = (res.data.data || res.data) || {};
    var reports  = payload.reports || [];
    renderList(reports, listEl);
  }

  function renderList(reports, listEl) {
    if (!reports.length) {
      listEl.innerHTML =
        '<p style="color:var(--text-3);padding:20px 0">보고서가 없습니다. 위 버튼으로 첫 보고서를 생성하세요.</p>';
      return;
    }

    var rows = reports.map(function (r) {
      var typeBadge = r.reportType === 'weekly'
        ? '<span style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:10px;font-size:11px;white-space:nowrap">주간</span>'
        : '<span style="background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:10px;font-size:11px;white-space:nowrap">수동</span>';
      var sentBadge = r.sentEmailAt
        ? '<span style="color:#64748b;font-size:11px;white-space:nowrap">✉ ' + fmtDate(r.sentEmailAt) + '</span>'
        : '<span style="color:#94a3b8;font-size:11px">미발송</span>';
      var firstLine = r.aiSummary ? String(r.aiSummary).split('\n')[0] : '';
      var preview = firstLine
        ? '<span title="' + escapeHtml(r.aiSummary) + '">' +
            escapeHtml(firstLine.slice(0, 60)) + (firstLine.length > 60 ? '…' : '') +
          '</span>'
        : '<span style="color:var(--text-3)">AI 요약 없음</span>';

      return '<tr class="rpt-row" data-rpt-id="' + r.id + '" style="cursor:pointer">' +
        '<td style="white-space:nowrap">#' + r.id +
          '<div style="font-size:11px;color:var(--text-3)">' + fmtDateTime(r.createdAt) + '</div></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td style="white-space:nowrap">' + fmtDate(r.periodStart) + ' ~ ' + fmtDate(r.periodEnd) + '</td>' +
        '<td style="max-width:300px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + preview + '</td>' +
        '<td>' + sentBadge + '</td>' +
        '<td><button class="btn-sm btn-sm-ghost" data-rpt-open="' + r.id + '" type="button">상세보기</button></td>' +
      '</tr>';
    }).join('');

    listEl.innerHTML =
      '<div style="overflow-x:auto">' +
      '<table class="adm-table" style="width:100%">' +
        '<thead><tr>' +
          '<th>번호</th><th>유형</th><th>기간</th><th>AI 요약 미리보기</th><th>이메일 발송</th><th></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>';
  }

  /* ---- 상세 보기 ---- */

  async function loadDetail(id) {
    var listEl   = document.getElementById('rptList');
    var detailEl = document.getElementById('rptDetail');
    if (!listEl || !detailEl) return;

    destroyCharts();
    listEl.style.display = 'none';
    detailEl.style.display = '';
    detailEl.innerHTML = '<p style="color:var(--text-3);padding:20px 0">불러오는 중...</p>';

    var res = await api('/api/admin-report-detail?id=' + id);
    if (!res.ok) {
      detailEl.innerHTML =
        '<button class="btn-sm btn-sm-ghost" id="rptBackBtn" type="button">← 목록으로</button>' +
        '<p style="color:var(--danger);margin-top:12px">상세 불러오기 실패: ' +
        escapeHtml((res.data && res.data.error) || '') + '</p>';
      detailEl.querySelector('#rptBackBtn').addEventListener('click', showList);
      return;
    }

    var payload = (res.data.data || res.data) || {};
    var report  = payload.report || payload;
    renderDetail(report);
  }

  function showList() {
    destroyCharts();
    var detailEl = document.getElementById('rptDetail');
    var listEl   = document.getElementById('rptList');
    if (detailEl) detailEl.style.display = 'none';
    if (listEl)   { listEl.style.display = ''; loadList(); }
  }

  function destroyCharts() {
    if (_chartDonut) { try { _chartDonut.destroy(); } catch (e) {} _chartDonut = null; }
    if (_chartBar)   { try { _chartBar.destroy();   } catch (e) {} _chartBar   = null; }
  }

  /* ---- 상세 렌더 ---- */

  function renderDetail(report) {
    var detailEl = document.getElementById('rptDetail');
    if (!detailEl) return;

    var stats = report.stats || {};
    var m     = stats.members      || {};
    var d     = stats.donations    || {};
    var s     = stats.siren        || {};
    var em    = stats.expertMatches || {};
    var sup   = stats.support      || {};
    var mbt   = m.byType  || {};
    var dbt   = d.byType  || {};
    var embt  = em.byType || {};
    var subc  = sup.byCategory || {};

    /* AI 요약 */
    var summaryHtml = '';
    if (report.aiSummary) {
      var lines = String(report.aiSummary).split('\n').filter(Boolean);
      summaryHtml =
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px">' +
          '<h3 style="font-size:15px;font-weight:600;margin:0 0 10px">🤖 AI 요약</h3>' +
          '<ol style="margin:0;padding-left:20px;line-height:2">' +
            lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('') +
          '</ol>' +
        '</div>';
    }

    /* 위험경보 */
    var alerts = Array.isArray(report.aiAlerts) ? report.aiAlerts : [];
    var alertsHtml = '';
    if (alerts.length) {
      var alertRows = alerts.map(function (a) {
        var color = a.severity === 'high' ? '#dc2626' : a.severity === 'medium' ? '#d97706' : '#2563eb';
        var bg    = a.severity === 'high' ? '#fef2f2' : a.severity === 'medium' ? '#fffbeb' : '#eff6ff';
        return '<div style="background:' + bg + ';border-left:3px solid ' + color + ';' +
          'padding:10px 14px;margin-bottom:8px;border-radius:0 6px 6px 0;font-size:13px">' +
          '<strong style="color:' + color + '">[' + escapeHtml(a.type || '') + ']</strong> ' +
          escapeHtml(a.message || '') + '</div>';
      }).join('');
      alertsHtml =
        '<div style="margin-bottom:24px">' +
          '<h3 style="font-size:15px;font-weight:600;margin:0 0 10px">⚠️ 위험경보</h3>' +
          alertRows +
        '</div>';
    }

    var typeLabel = report.reportType === 'weekly' ? '주간 자동' : '수동 생성';

    detailEl.innerHTML =
      /* 상단 툴바 */
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">' +
        '<button class="btn-sm btn-sm-ghost" id="rptBackBtn" type="button">← 목록으로</button>' +
        '<h3 style="flex:1;font-size:17px;font-weight:700;margin:0">' +
          '📊 ' + fmtDate(report.periodStart) + ' ~ ' + fmtDate(report.periodEnd) + ' 보고서' +
          ' <span style="font-size:12px;color:var(--text-3);font-weight:400">(' + typeLabel + ')</span>' +
        '</h3>' +
        '<button class="btn-sm btn-sm-ghost" id="rptBtnPrint" type="button">🖨️ 인쇄</button>' +
        '<button class="btn-sm btn-sm-ghost" id="rptBtnEmail" type="button">📧 이메일 재발송</button>' +
      '</div>' +

      '<div id="rptDetailBody">' +
        summaryHtml +
        alertsHtml +

        /* 통계 4-그리드 */
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-bottom:24px">' +

          /* 1. 회원 현황 */
          '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px">' +
            '<h4 style="font-size:14px;font-weight:600;margin:0 0 12px;color:#1e40af">👥 회원 현황</h4>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 신규 가입</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(m.newThisPeriod) + '명</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 탈퇴</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(m.withdrawnThisPeriod) + '명</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">전체 활성 회원</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(m.totalActive) + '명</td></tr>' +
              '<tr style="border-top:1px solid #f1f5f9">' +
                  '<td style="padding:6px 0 4px;color:var(--text-3)">일반 회원</td>' +
                  '<td style="text-align:right">' + fmtNum(mbt.user) + '명</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">유가족 회원</td>' +
                  '<td style="text-align:right">' + fmtNum(mbt.family) + '명</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">자원봉사 회원</td>' +
                  '<td style="text-align:right">' + fmtNum(mbt.volunteer) + '명</td></tr>' +
            '</table>' +
          '</div>' +

          /* 2. 후원 현황 */
          '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px">' +
            '<h4 style="font-size:14px;font-weight:600;margin:0 0 12px;color:#15803d">💰 후원 현황</h4>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 후원 건수</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(d.count) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 후원 총액</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtAmount(d.totalAmount) + '</td></tr>' +
              '<tr style="border-top:1px solid #f1f5f9">' +
                  '<td style="padding:6px 0 4px;color:var(--text-3)">정기 후원 건수</td>' +
                  '<td style="text-align:right">' + fmtNum(dbt.regular) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">일시 후원 건수</td>' +
                  '<td style="text-align:right">' + fmtNum(dbt.onetime) + '건</td></tr>' +
              '<tr style="border-top:1px solid #f1f5f9">' +
                  '<td style="padding:6px 0 4px;color:var(--text-3)">정기후원 활성 회원</td>' +
                  '<td style="text-align:right">' + fmtNum(d.regularActive) + '명</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">정기후원 잠재 회원</td>' +
                  '<td style="text-align:right">' + fmtNum(d.regularProspect) + '명</td></tr>' +
            '</table>' +
          '</div>' +

          /* 3. SIREN 신고 */
          '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px">' +
            '<h4 style="font-size:14px;font-weight:600;margin:0 0 12px;color:#dc2626">🚨 SIREN 신고</h4>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<thead><tr style="color:var(--text-3);font-size:11px">' +
                '<th style="text-align:left;padding:0 0 8px;font-weight:500">유형</th>' +
                '<th style="text-align:right;font-weight:500">기간 신규</th>' +
                '<th style="text-align:right;font-weight:500">처리 중</th>' +
              '</tr></thead>' +
              '<tr><td style="padding:5px 0">사건 제보</td>' +
                  '<td style="text-align:right">' + fmtNum((s.incident || {}).newThisPeriod) + '</td>' +
                  '<td style="text-align:right">' + fmtNum((s.incident || {}).totalOpen) + '</td></tr>' +
              '<tr><td style="padding:5px 0">악성민원 신고</td>' +
                  '<td style="text-align:right">' + fmtNum((s.harassment || {}).newThisPeriod) + '</td>' +
                  '<td style="text-align:right">' + fmtNum((s.harassment || {}).totalOpen) + '</td></tr>' +
              '<tr><td style="padding:5px 0">법률지원 상담</td>' +
                  '<td style="text-align:right">' + fmtNum((s.legal || {}).newThisPeriod) + '</td>' +
                  '<td style="text-align:right">' + fmtNum((s.legal || {}).totalOpen) + '</td></tr>' +
            '</table>' +
          '</div>' +

          /* 4. 전문가 매칭 + 유족지원 */
          '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px">' +
            '<h4 style="font-size:14px;font-weight:600;margin:0 0 12px;color:#7c3aed">🤝 전문가 매칭</h4>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 신규</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(em.newThisPeriod) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">진행 중</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(em.active) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 완료</td>' +
                  '<td style="text-align:right">' + fmtNum(em.closedThisPeriod) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">변호사 매칭</td>' +
                  '<td style="text-align:right">' + fmtNum(embt.lawyer) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">상담사 매칭</td>' +
                  '<td style="text-align:right">' + fmtNum(embt.counselor) + '건</td></tr>' +
            '</table>' +
            '<h4 style="font-size:14px;font-weight:600;margin:16px 0 10px;color:#0891b2">❤️ 유족지원</h4>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">기간 내 신청</td>' +
                  '<td style="text-align:right;font-weight:600">' + fmtNum(sup.newThisPeriod) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">심리상담</td>' +
                  '<td style="text-align:right">' + fmtNum(subc.counseling) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">법률자문</td>' +
                  '<td style="text-align:right">' + fmtNum(subc.legal) + '건</td></tr>' +
              '<tr><td style="padding:4px 0;color:var(--text-3)">장학금</td>' +
                  '<td style="text-align:right">' + fmtNum(subc.scholarship) + '건</td></tr>' +
            '</table>' +
          '</div>' +

        '</div>' + /* /통계 그리드 */

        /* 차트 */
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">' +
          '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px">' +
            '<h4 style="font-size:14px;font-weight:600;margin:0 0 12px">회원 유형 분포</h4>' +
            '<div style="max-width:220px;margin:0 auto"><canvas id="rptChartDonut"></canvas></div>' +
          '</div>' +
          '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px">' +
            '<h4 style="font-size:14px;font-weight:600;margin:0 0 12px">후원 유형 비교 (건수)</h4>' +
            '<canvas id="rptChartBar"></canvas>' +
          '</div>' +
        '</div>' +

      '</div>'; /* /rptDetailBody */

    detailEl.querySelector('#rptBackBtn').addEventListener('click', showList);
    detailEl.querySelector('#rptBtnPrint').addEventListener('click', function () { window.print(); });
    detailEl.querySelector('#rptBtnEmail').addEventListener('click', function () { sendEmail(report.id); });

    setTimeout(function () { renderCharts(stats); }, 80);
  }

  /* ---- 차트 ---- */

  function renderCharts(stats) {
    if (!window.Chart) return;

    var m   = stats.members   || {};
    var d   = stats.donations || {};
    var mbt = m.byType || {};
    var dbt = d.byType || {};

    var donutCtx = document.getElementById('rptChartDonut');
    if (donutCtx) {
      _chartDonut = new window.Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['일반', '유가족', '자원봉사'],
          datasets: [{
            data: [mbt.user || 0, mbt.family || 0, mbt.volunteer || 0],
            backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'],
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } },
        },
      });
    }

    var barCtx = document.getElementById('rptChartBar');
    if (barCtx) {
      _chartBar = new window.Chart(barCtx, {
        type: 'bar',
        data: {
          labels: ['정기 후원', '일시 후원'],
          datasets: [{
            label: '건수',
            data: [dbt.regular || 0, dbt.onetime || 0],
            backgroundColor: ['#6366f1', '#f97316'],
            borderRadius: 4,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
      });
    }
  }

  /* ---- 보고서 생성 모달 ---- */

  function showGenerateModal() {
    var end   = new Date();
    var start = new Date();
    start.setDate(start.getDate() - 7);

    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;' +
      'display:flex;align-items:center;justify-content:center';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:12px;padding:28px;min-width:360px;max-width:440px;width:90%">' +
        '<h3 style="font-size:17px;font-weight:700;margin:0 0 20px">📊 보고서 생성</h3>' +
        '<div style="margin-bottom:14px">' +
          '<label style="font-size:13px;color:var(--text-2);display:block;margin-bottom:5px">시작일</label>' +
          '<input type="date" id="rptModalStart" value="' + toDateInput(start) + '"' +
            ' style="width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;font-size:14px;box-sizing:border-box">' +
        '</div>' +
        '<div style="margin-bottom:18px">' +
          '<label style="font-size:13px;color:var(--text-2);display:block;margin-bottom:5px">종료일</label>' +
          '<input type="date" id="rptModalEnd" value="' + toDateInput(end) + '"' +
            ' style="width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;font-size:14px;box-sizing:border-box">' +
        '</div>' +
        '<p style="font-size:12px;color:var(--text-3);margin:0 0 18px">AI 요약 생성까지 약 10~30초 소요될 수 있습니다.</p>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
          '<button class="btn-sm btn-sm-ghost" id="rptModalCancel" type="button">취소</button>' +
          '<button class="btn-sm btn-sm-primary" id="rptModalSubmit" type="button">생성</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#rptModalCancel').addEventListener('click', function () {
      document.body.removeChild(overlay);
    });

    overlay.querySelector('#rptModalSubmit').addEventListener('click', async function () {
      var startVal = overlay.querySelector('#rptModalStart').value;
      var endVal   = overlay.querySelector('#rptModalEnd').value;
      if (!startVal || !endVal) { toast('날짜를 모두 입력해주세요'); return; }
      if (startVal > endVal)    { toast('시작일이 종료일보다 늦습니다'); return; }

      var submitBtn = overlay.querySelector('#rptModalSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = '생성 중...';

      var res = await api('/api/admin-report-generate', {
        method: 'POST',
        body: {
          periodStart: startVal + 'T00:00:00.000Z',
          periodEnd:   endVal   + 'T23:59:59.999Z',
        },
      });

      document.body.removeChild(overlay);

      if (!res.ok) {
        toast('보고서 생성 실패: ' + ((res.data && res.data.error) || '알 수 없는 오류'));
        return;
      }

      toast('보고서가 생성되었습니다');
      showList();
    });
  }

  /* ---- 이메일 재발송 ---- */

  async function sendEmail(id) {
    if (!confirm('이 보고서를 대표 이메일로 재발송하시겠습니까?')) return;

    var res = await api('/api/admin-report-send-email', {
      method: 'POST',
      body: { reportId: id },
    });

    if (!res.ok) {
      toast('이메일 발송 실패: ' + ((res.data && res.data.error) || '알 수 없는 오류'));
      return;
    }
    toast('이메일이 재발송되었습니다');
  }

  /* ---- 노출 ---- */

  window.SIREN_ADMIN_REPORT = { load: load };
})();
