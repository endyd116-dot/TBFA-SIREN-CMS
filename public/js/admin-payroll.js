/* admin-payroll.js — 급여관리 어드민 화면 (슈퍼어드민 전용)
 *
 * - GET   /api/admin-payroll?year=&month=  → 월별 일람 + 통계 카운트(PAID 포함)
 * - GET   /api/admin-payroll?id=N          → 상세 (slip·member·audit)
 * - PATCH /api/admin-payroll?id=N          → 금액 직접편집·조정라인·공제·검토메모·상태
 * - POST  /api/admin-payroll?id=N&action=approve | hold | paid
 * - POST  /api/admin-payroll?action=recalculate&year=&month=  → 재집계 (body.force)
 * - GET   /api/admin-payroll-settings  / PUT  → 계산 기준
 * - POST  /api/admin-payroll-send  body { year, month }       → 일괄 발송
 * - GET   /api/admin-payroll-pdf?id=N   → PDF
 * - GET   /api/admin-payroll-export?year=&month=  → CSV
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let currentRows = [];
  let _curSlip = null;   // 상세 모달에서 편집 중인 명세서

  /* ── 유틸 ── */
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'show ' + (type === 'err' ? 'err' : 'ok');
    setTimeout(() => { el.className = ''; }, 2800);
  }

  async function api(url, opts) {
    opts = opts || {};
    const fetchOpts = {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
    const r = await fetch(url, fetchOpts);
    let data;
    try { data = await r.json(); } catch (_) { data = {}; }
    return { ok: r.ok, status: r.status, data };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function won(n) {
    const v = Math.round(Number(n || 0));
    return v.toLocaleString('ko-KR');
  }
  function hours(m) {
    const v = Number(m || 0);
    return (v / 60).toFixed(1);
  }
  function statusBadge(s) {
    return '<span class="status-badge s-' + esc(s) + '">' + esc(s) + '</span>';
  }
  function fmtDate(d) {
    try { return new Date(d).toLocaleString('ko-KR'); } catch (_) { return String(d || ''); }
  }

  /* ── 권한 확인 (응답 구조 fallback 강화) ── */
  async function checkSuperAdmin() {
    let isSuper = false;
    try {
      const res = await api('/api/admin/me?light=1');
      const d = res.data || {};
      const role =
        d?.data?.admin?.role ||
        d?.admin?.role ||
        d?.data?.role ||
        d?.role ||
        null;
      isSuper = role === 'super_admin';
    } catch (_) { /* 네트워크 오류 시 본문 표시·서버 가드가 차단 */ }
    document.querySelectorAll('.super-only-card').forEach(el => el.style.display = 'block');
    $('nonSuperBlock').style.display = isSuper ? 'none' : 'block';
    return isSuper;
  }

  /* ── 연·월 셀렉트 초기화 (직전 달 기본) ── */
  function initSelectors() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const curY = kst.getUTCFullYear();
    const curM = kst.getUTCMonth() + 1;
    let defY = curY, defM = curM - 1;
    if (defM < 1) { defM = 12; defY = curY - 1; }

    const ySel = $('selYear');
    for (let y = curY; y >= curY - 5; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y + '년';
      if (y === defY) opt.selected = true;
      ySel.appendChild(opt);
    }
    const mSel = $('selMonth');
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m + '월';
      if (m === defM) opt.selected = true;
      mSel.appendChild(opt);
    }
  }

  function syncExportLink() {
    const y = $('selYear').value, m = $('selMonth').value;
    const a = $('btnExport');
    if (a) a.href = '/api/admin-payroll-export?year=' + y + '&month=' + m;
  }

  /* ── 일람 로드 ── */
  async function loadList() {
    const y = $('selYear').value, m = $('selMonth').value;
    syncExportLink();
    const tbody = $('slipTbody');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="11">불러오는 중...</td></tr>';

    const res = await api('/api/admin-payroll?year=' + y + '&month=' + m);
    if (!res.ok) {
      tbody.innerHTML = '<tr class="loading-row"><td colspan="11" style="color:#dc2626">' +
        esc(res.data?.error || ('HTTP ' + res.status)) + '</td></tr>';
      return;
    }

    const d = res.data?.data || res.data;
    const rows = d?.rows || [];
    const counts = d?.counts || {};
    currentRows = rows;

    $('cntDraft').textContent    = counts.DRAFT    || 0;
    $('cntReviewed').textContent = counts.REVIEWED || 0;
    $('cntApproved').textContent = counts.APPROVED || 0;
    $('cntSent').textContent     = counts.SENT     || 0;
    $('cntPaid').textContent     = counts.PAID     || 0;
    $('cntHold').textContent     = counts.HOLD     || 0;

    if (rows.length === 0) {
      tbody.innerHTML = '<tr class="loading-row"><td colspan="11">해당 월 명세서가 없습니다. "재집계"로 자동 생성하세요. (직원별 <b>기본연봉</b>이 설정돼 있어야 생성됩니다 — 회원 상세에서 설정)</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const name = esc(r.memberName || ('회원ID:' + r.memberUid));
      const role = esc(r.memberMilestoneRole || r.memberRole || '-');
      const editMark = r.manuallyEdited ? '<span class="edit-badge" title="수동 수정됨 — 재집계가 덮어쓰지 않음">수정</span>' : '';
      const actions = [];
      actions.push('<button class="btn btn-light btn-sm" onclick="openDetail(' + r.id + ')">상세</button>');
      actions.push('<a class="btn btn-primary btn-sm" href="/api/admin-payroll-pdf?id=' + r.id + '" target="_blank" rel="noopener">PDF</a>');
      if (r.status === 'DRAFT' || r.status === 'REVIEWED') {
        actions.push('<button class="btn btn-success btn-sm" onclick="approveSlip(' + r.id + ')">승인</button>');
      }
      if (r.status === 'APPROVED' || r.status === 'SENT') {
        actions.push('<button class="btn btn-success btn-sm" onclick="paidSlip(' + r.id + ')" title="지급 확정">지급</button>');
      }
      if (r.status !== 'SENT' && r.status !== 'HOLD' && r.status !== 'PAID') {
        actions.push('<button class="btn btn-danger btn-sm" onclick="holdSlip(' + r.id + ')">보류</button>');
      }
      return '<tr>' +
        '<td>' + name + editMark + '</td>' +
        '<td>' + role + '</td>' +
        '<td class="r">' + (r.workingDays || 0) + '</td>' +
        '<td class="r">' + hours(r.overtimeMins) + '</td>' +
        '<td class="r">' + won(r.baseSalaryMonth) + '</td>' +
        '<td class="r">' + won(r.performanceBonus) + '</td>' +
        '<td class="r" style="color:#b91c1c">' + (Number(r.deductionUnpaid) > 0 ? '−' + won(r.deductionUnpaid) : '0') + '</td>' +
        '<td class="r" style="font-weight:700">' + won(r.grossPay) + '</td>' +
        '<td class="r" style="font-weight:700;color:#0f766e">' + won(r.netPay) + '</td>' +
        '<td class="c">' + statusBadge(r.status) + '</td>' +
        '<td class="c" style="white-space:nowrap">' + actions.join(' ') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── 재집계 ── */
  async function recalc(force) {
    const y = $('selYear').value, m = $('selMonth').value;
    if (force && !confirm(y + '년 ' + m + '월 명세서를 강제 재집계합니다.\n⚠ 승인·발송·지급완료는 물론 수동으로 직접 수정한 금액·조정 라인까지 모두 자동 계산값으로 덮어씁니다. 계속할까요?')) return;
    if (!force && !confirm(y + '년 ' + m + '월 명세서를 자동 재집계합니다.\n(DRAFT 상태만 갱신 · REVIEWED 이상·수동수정 건은 보존)')) return;

    $('btnRecalc').disabled = true; $('btnRecalcForce').disabled = true;
    try {
      const res = await api('/api/admin-payroll?action=recalculate&year=' + y + '&month=' + m, {
        method: 'POST', body: { force: !!force }
      });
      if (!res.ok) {
        toast('재집계 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err');
        return;
      }
      const d = res.data?.data || res.data;
      /* ★ 2026-06-03: 대상 0명이면 원인(연봉 미설정) 안내 — 빈 결과의 진짜 이유 */
      if ((d.candidateCount || 0) === 0) {
        toast('재집계 대상 0명 — 연봉(기본급)이 설정된 직원이 없습니다. 회원 상세 → 기본연봉 설정 후 다시 시도하세요.', 'err');
      } else {
        toast('재집계 완료 — 대상 ' + d.candidateCount + '명 · 신규 ' + (d.created || 0)
          + ' · 갱신 ' + (d.updated || 0) + ' · 보존 ' + (d.skipped || 0)
          + (d.errors?.length ? ' · 오류 ' + d.errors.length : ''), d.errors?.length ? 'err' : 'ok');
      }
      await loadList();
    } finally {
      $('btnRecalc').disabled = false; $('btnRecalcForce').disabled = false;
    }
  }

  /* ── AI 분석 (이상치·점검·요약) ── */
  async function analyzePayroll() {
    const y = $('selYear').value, m = $('selMonth').value;
    const btn = $('btnAnalyze');
    if (btn) { btn.disabled = true; btn.textContent = '🤖 분석 중...'; }
    try {
      const res = await api('/api/admin-payroll?action=analyze&year=' + y + '&month=' + m, { method: 'POST' });
      if (!res.ok) { toast('AI 분석 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err'); return; }
      renderAnalysis(res.data?.data || res.data || {});
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 분석'; }
    }
  }

  function renderAnalysis(d) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const won = (n) => Number(n || 0).toLocaleString();
    $('aiCard').style.display = '';
    $('aiCardMeta').textContent = '— ' + d.year + '년 ' + d.month + '월 · 명세서 ' + (d.slipCount || 0)
      + '건 · 세전 ' + won(d.sumGross) + '원 · 실수령 ' + won(d.sumNet) + '원';
    $('aiSummary').textContent = d.summary || '';

    const an = Array.isArray(d.anomalies) ? d.anomalies : [];
    $('aiAnomalies').innerHTML = an.length
      ? '<div style="margin-top:14px;font-weight:700;color:#b91c1c">⚠ 이상치 ' + an.length + '건</div>'
        + an.map(a => '<div style="padding:6px 0;border-bottom:1px dashed #eee;font-size:13px">· <strong>' + esc(a.name) + '</strong> <span style="color:#b91c1c">[' + esc(a.type) + ']</span> ' + esc(a.detail) + '</div>').join('')
      : '<div style="margin-top:14px;color:#16a34a;font-size:13px">✓ 이상치 없음</div>';

    const ck = Array.isArray(d.checklist) ? d.checklist : [];
    $('aiChecklist').innerHTML = ck.length
      ? '<div style="margin-top:14px;font-weight:700;color:#b45309">📋 점검 ' + ck.length + '건</div>'
        + ck.map(c => '<div style="padding:6px 0;border-bottom:1px dashed #eee;font-size:13px">· <strong>' + esc(c.type) + '</strong>: ' + esc(c.detail) + '</div>').join('')
      : '<div style="margin-top:14px;color:#16a34a;font-size:13px">✓ 점검 항목 없음</div>';
  }

  /* ── 일괄 발송 ── */
  async function sendAll() {
    const y = $('selYear').value, m = $('selMonth').value;
    const approved = currentRows.filter(r => r.status === 'APPROVED').length;
    if (approved === 0) {
      toast('APPROVED 상태 명세서가 없습니다.', 'err');
      return;
    }
    if (!confirm(y + '년 ' + m + '월 — APPROVED 상태 ' + approved + '건을 이메일 일괄 발송합니다. 계속할까요?')) return;

    $('btnSendAll').disabled = true;
    try {
      const res = await api('/api/admin-payroll-send', {
        method: 'POST', body: { year: Number(y), month: Number(m) }
      });
      if (!res.ok) {
        toast('발송 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err');
        return;
      }
      const d = res.data?.data || res.data;
      toast('발송 완료 — 성공 ' + (d.sent || 0) + ' · 실패 ' + (d.failed || 0), d.failed ? 'err' : 'ok');
      await loadList();
    } finally {
      $('btnSendAll').disabled = false;
    }
  }

  /* ════════════════ 상세 모달 (편집) ════════════════ */

  /* 지급 항목 (편집 가능 금액) */
  const PAY_FIELDS = [
    { f: 'baseSalaryMonth', label: '월 기본급', sign: '+' },
    { f: 'overtimePay',     label: '야근 수당', sign: '+' },
    { f: 'deductionUnpaid', label: '무급 차감', sign: '−' },
    { f: 'performanceBonus',label: '성과 보너스', sign: '+' },
    { f: 'perfectBonus',    label: '만근 보너스', sign: '+' },
  ];
  /* 공제 항목 (편집 가능) */
  const DED_FIELDS = [
    { f: 'nationalPension',     label: '국민연금' },
    { f: 'healthInsurance',     label: '건강보험' },
    { f: 'longTermCare',        label: '장기요양' },
    { f: 'employmentInsurance', label: '고용보험' },
    { f: 'incomeTax',           label: '소득세' },
    { f: 'localTax',            label: '지방소득세' },
    { f: 'otherDeduction',      label: '기타 공제' },
  ];

  function moneyInput(f, val, editable) {
    return '<input class="money" type="number" step="0.01" data-field="' + f + '" ' +
      'value="' + (Number(val || 0)) + '"' + (editable ? '' : ' disabled') +
      ' oninput="recomputePreview()">';
  }

  function adjRowHtml(a, editable) {
    a = a || { label: '', amount: 0, kind: 'ADD', reason: '' };
    const disabled = editable ? '' : ' disabled';
    return '<div class="adj-row">' +
      '<input class="adj-label" type="text" placeholder="항목명 (예: 명절 상여)" value="' + esc(a.label) + '"' + disabled + '>' +
      '<input class="adj-amount" type="number" step="1" placeholder="금액" value="' + (Number(a.amount || 0)) + '"' + disabled + ' oninput="recomputePreview()">' +
      '<select class="adj-kind"' + disabled + ' onchange="recomputePreview()">' +
        '<option value="ADD"' + (a.kind !== 'DEDUCT' ? ' selected' : '') + '>가산(+)</option>' +
        '<option value="DEDUCT"' + (a.kind === 'DEDUCT' ? ' selected' : '') + '>차감(−)</option>' +
      '</select>' +
      '<input class="adj-reason" type="text" placeholder="사유 (필수)" value="' + esc(a.reason) + '"' + disabled + '>' +
      (editable ? '<button class="adj-del" type="button" title="삭제" onclick="this.closest(\'.adj-row\').remove();recomputePreview()">×</button>' : '<span></span>') +
      '</div>';
  }

  function addAdjRow() {
    const wrap = $('adjRows');
    const empty = wrap.querySelector('.adj-empty');
    if (empty) empty.remove();
    wrap.insertAdjacentHTML('beforeend', adjRowHtml(null, true));
  }

  /* 조정 라인 합계 (DOM 읽기) */
  function readAdjustments() {
    const out = [];
    document.querySelectorAll('#adjRows .adj-row').forEach(row => {
      const label = (row.querySelector('.adj-label')?.value || '').trim();
      const amount = Number(row.querySelector('.adj-amount')?.value || 0);
      const kind = row.querySelector('.adj-kind')?.value === 'DEDUCT' ? 'DEDUCT' : 'ADD';
      const reason = (row.querySelector('.adj-reason')?.value || '').trim();
      if (!label && !amount && !reason) return; // 완전 빈 행 무시
      out.push({ label, amount, kind, reason });
    });
    return out;
  }

  function fieldVal(f) {
    const el = document.querySelector('#modalBody input.money[data-field="' + f + '"]');
    return el ? Number(el.value || 0) : 0;
  }

  /* 실시간 미리보기 (백엔드 공식과 동일) */
  function recomputePreview() {
    const base = fieldVal('baseSalaryMonth');
    const ot = fieldVal('overtimePay');
    const unp = fieldVal('deductionUnpaid');
    const perf = fieldVal('performanceBonus');
    const perfect = fieldVal('perfectBonus');
    const adj = readAdjustments();
    const adjAdd = adj.filter(a => a.kind === 'ADD').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const adjDeduct = adj.filter(a => a.kind === 'DEDUCT').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const gross = base + ot - unp + perf + perfect + adjAdd - adjDeduct;

    const totalDeduction = DED_FIELDS.reduce((s, d) => s + fieldVal(d.f), 0);
    const net = gross - totalDeduction;

    if ($('previewGross')) $('previewGross').textContent = won(gross) + ' 원';
    if ($('previewDeduction')) $('previewDeduction').textContent = won(totalDeduction) + ' 원';
    if ($('previewNet')) $('previewNet').textContent = won(net) + ' 원';
  }

  async function openDetail(id) {
    const res = await api('/api/admin-payroll?id=' + id);
    if (!res.ok) { toast('상세 조회 실패', 'err'); return; }
    const d = res.data?.data || res.data;
    const slip = d.slip, mb = d.member, audit = d.audit || [];
    _curSlip = slip;

    const editable = slip.status !== 'PAID';

    $('modalTitle').innerHTML = esc(mb?.name || ('회원ID:' + slip.memberUid)) +
      ' — ' + slip.payYear + '년 ' + String(slip.payMonth).padStart(2, '0') + '월' +
      (slip.manuallyEdited ? '<span class="edit-badge">수동 수정됨</span>' : '');

    // 지급 항목 입력칸
    let payHtml = '<table class="pay-edit"><tbody>';
    for (const p of PAY_FIELDS) {
      payHtml += '<tr><td class="lbl">' + p.sign + ' ' + p.label + '</td>' +
        '<td class="val">' + moneyInput(p.f, slip[p.f], editable) + '</td></tr>';
    }
    payHtml += '</tbody></table>';

    // 조정 라인
    const adjArr = Array.isArray(slip.adjustments) ? slip.adjustments : [];
    let adjInner = adjArr.length
      ? adjArr.map(a => adjRowHtml(a, editable)).join('')
      : '<div class="adj-empty">조정 라인 없음</div>';

    // 공제 입력칸
    let dedHtml = '<table class="pay-edit"><tbody>';
    for (const dd of DED_FIELDS) {
      dedHtml += '<tr><td class="lbl">− ' + dd.label + '</td>' +
        '<td class="val">' + moneyInput(dd.f, slip[dd.f], editable) + '</td></tr>';
    }
    dedHtml += '</tbody></table>';

    // 수정 이력
    let auditHtml;
    if (audit.length === 0) {
      auditHtml = '<div class="adj-empty">수정 이력 없음</div>';
    } else {
      auditHtml = '<div class="audit-list">' + audit.map(a => {
        const who = esc(a.changedByName || ('관리자#' + a.changedBy));
        const when = fmtDate(a.createdAt);
        const fieldKo = AUDIT_FIELD_KO[a.field] || a.field;
        const oldV = a.field === 'adjustments' ? '(조정 라인)' : won(a.oldValue);
        const newV = a.field === 'adjustments' ? '(조정 라인)' : won(a.newValue);
        return '<div class="audit-item">' +
          '<div class="a-meta">' + when + ' · ' + who + '</div>' +
          '<div class="a-change"><strong>' + esc(fieldKo) + '</strong> ' +
            esc(oldV) + ' → ' + esc(newV) + '</div>' +
          (a.reason ? '<div class="a-reason">사유: ' + esc(a.reason) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    const body = $('modalBody');
    body.innerHTML =
      '<dt>상태</dt><dd>' + statusBadge(slip.status) +
        (editable ? '' : ' <span style="color:#0f766e;font-size:12px;font-weight:600">지급 완료 — 편집 잠금</span>') + '</dd>' +
      '<dt>근태 (출근·근무·야근·지각·결근·유급·무급·만근)</dt>' +
      '<dd>' +
        (slip.workingDays || 0) + '일 · ' +
        hours(slip.workingMins) + 'h · ' +
        hours(slip.overtimeMins) + 'h · ' +
        (slip.lateCount || 0) + '회 · ' +
        (slip.absentCount || 0) + '회 · ' +
        (Number(slip.paidLeaveDays) || 0) + '일 · ' +
        (Number(slip.unpaidLeaveDays) || 0) + '일 · ' +
        (slip.perfectAttendance ? '<strong style="color:#16a34a">만근</strong>' : '아님') +
      '</dd>' +

      '<div class="pay-section-title">지급 항목' + (editable ? ' <span style="font-weight:400;color:#9ca3af">(직접 수정 가능)</span>' : '') + '</div>' +
      payHtml +

      '<div class="pay-section-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>조정 라인</span>' +
        (editable ? '<button class="btn btn-light btn-sm" type="button" onclick="addAdjRow()">+ 조정 추가</button>' : '') +
      '</div>' +
      '<div class="adj-wrap" id="adjRows">' + adjInner + '</div>' +

      '<table class="pay-edit"><tbody>' +
        '<tr class="pay-total-row"><td class="lbl">세전 총액</td>' +
        '<td class="val"><span class="pay-readonly-val" id="previewGross">' + won(slip.grossPay) + ' 원</span></td></tr>' +
      '</tbody></table>' +

      '<div class="pay-section-title">공제 항목' + (editable ? ' <span style="font-weight:400;color:#9ca3af">(직접 수정 가능)</span>' : '') + '</div>' +
      dedHtml +

      '<table class="pay-edit"><tbody>' +
        '<tr class="pay-total-row"><td class="lbl">공제 합계</td>' +
        '<td class="val"><span class="pay-readonly-val" id="previewDeduction" style="color:#b91c1c">' + won(slip.totalDeduction) + ' 원</span></td></tr>' +
        '<tr class="pay-net-row"><td class="lbl">실수령액 (Net)</td>' +
        '<td class="val"><span id="previewNet">' + won(slip.netPay) + ' 원</span></td></tr>' +
      '</tbody></table>' +

      (editable ?
        '<div class="reason-box"><label>수정 사유 (저장 시 필수 · 이력에 기록됩니다)</label>' +
        '<input type="text" id="editReason" placeholder="예: 명절 상여 추가, 소득세 정정"></div>' : '') +

      (slip.reviewNote ? '<dt>검토 메모</dt><dd>' + esc(slip.reviewNote) + '</dd>' : '') +
      (slip.sentAt ? '<dt>발송일</dt><dd>' + esc(fmtDate(slip.sentAt)) + '</dd>' : '') +
      (slip.paidAt ? '<dt>지급 확정일</dt><dd>' + esc(fmtDate(slip.paidAt)) + '</dd>' : '') +

      '<div class="pay-section-title">수정 이력</div>' + auditHtml +

      '<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12px;color:#6b7280">계산 근거 (calculation_snapshot)</summary>' +
      '<pre class="snapshot">' + esc(JSON.stringify(slip.calculationSnapshot, null, 2)) + '</pre></details>';

    const actions = $('modalActions');
    const acts = [];
    if (editable) {
      acts.push('<button class="btn btn-primary btn-sm" onclick="saveSlipEdit()">💾 저장</button>');
    }
    acts.push('<a class="btn btn-light btn-sm" href="/api/admin-payroll-pdf?id=' + slip.id + '" target="_blank" rel="noopener">PDF</a>');
    if (slip.status === 'DRAFT') {
      acts.push('<button class="btn btn-warning btn-sm" onclick="markReviewed(' + slip.id + ')">검토 완료</button>');
    }
    if (slip.status === 'DRAFT' || slip.status === 'REVIEWED') {
      acts.push('<button class="btn btn-success btn-sm" onclick="approveSlip(' + slip.id + ')">승인</button>');
    }
    if (slip.status === 'APPROVED' || slip.status === 'SENT') {
      acts.push('<button class="btn btn-success btn-sm" onclick="paidSlip(' + slip.id + ')">지급 확정</button>');
    }
    if (slip.status !== 'SENT' && slip.status !== 'HOLD' && slip.status !== 'PAID') {
      acts.push('<button class="btn btn-danger btn-sm" onclick="holdSlip(' + slip.id + ')">보류</button>');
    }
    acts.push('<button class="btn btn-light btn-sm" onclick="closeModal()">닫기</button>');
    actions.innerHTML = acts.join(' ');

    $('modal').classList.add('show');
  }

  const AUDIT_FIELD_KO = {
    base_salary_month: '월 기본급', overtime_pay: '야근 수당', deduction_unpaid: '무급 차감',
    performance_bonus: '성과 보너스', perfect_bonus: '만근 보너스',
    income_tax: '소득세', local_tax: '지방소득세', national_pension: '국민연금',
    health_insurance: '건강보험', long_term_care: '장기요양',
    employment_insurance: '고용보험', other_deduction: '기타 공제', adjustments: '조정 라인',
  };

  /* 편집 저장 (PATCH) */
  async function saveSlipEdit() {
    if (!_curSlip) return;
    const reason = ($('editReason')?.value || '').trim();
    if (!reason) { toast('수정 사유를 입력하세요.', 'err'); $('editReason')?.focus(); return; }

    const adjustments = readAdjustments();
    // 조정 라인 사유 필수
    for (const a of adjustments) {
      if (!a.reason) { toast('조정 라인의 사유는 필수입니다.', 'err'); return; }
    }

    const body = { adjustments, reason };
    for (const p of PAY_FIELDS) body[p.f] = fieldVal(p.f);
    for (const dd of DED_FIELDS) body[dd.f] = fieldVal(dd.f);

    const res = await api('/api/admin-payroll?id=' + _curSlip.id, { method: 'PATCH', body });
    if (!res.ok) { toast('저장 실패: ' + (res.data?.error || res.data?.detail || res.status), 'err'); return; }
    toast('저장 완료 — 세전·공제·실수령 재계산됨');
    await openDetail(_curSlip.id);  // 갱신된 상세 다시 열기
    await loadList();
  }

  async function approveSlip(id) {
    if (!confirm('명세서를 승인합니다. 승인 후 일괄 발송 가능합니다.\n계속할까요?')) return;
    const res = await api('/api/admin-payroll?id=' + id + '&action=approve', { method: 'POST' });
    if (!res.ok) { toast('승인 실패: ' + (res.data?.error || res.status), 'err'); return; }
    toast('승인 완료'); closeModal(); await loadList();
  }

  async function holdSlip(id) {
    const note = prompt('보류 사유 (선택):') || '';
    const res = await api('/api/admin-payroll?id=' + id + '&action=hold', {
      method: 'POST', body: { reviewNote: note }
    });
    if (!res.ok) { toast('보류 실패: ' + (res.data?.error || res.status), 'err'); return; }
    toast('보류 처리 완료'); closeModal(); await loadList();
  }

  async function markReviewed(id) {
    const res = await api('/api/admin-payroll?id=' + id, {
      method: 'PATCH', body: { status: 'REVIEWED' }
    });
    if (!res.ok) { toast('검토 처리 실패: ' + (res.data?.error || res.status), 'err'); return; }
    toast('검토 완료'); closeModal(); await loadList();
  }

  /* 지급 확정 (PAID) */
  async function paidSlip(id) {
    if (!confirm('지급을 확정합니다.\n확정 후에는 금액 편집이 잠깁니다. 계속할까요?')) return;
    const res = await api('/api/admin-payroll?id=' + id + '&action=paid', { method: 'POST' });
    if (!res.ok) { toast('지급 확정 실패: ' + (res.data?.error || res.status), 'err'); return; }
    toast('지급 확정 완료'); closeModal(); await loadList();
  }

  function closeModal() {
    $('modal').classList.remove('show');
    _curSlip = null;
  }

  /* ════════════════ 계산기준 설정 ════════════════ */
  const SETTING_FIELDS = [
    ['overtimeMultiplier', 'setOvertimeMultiplier'],
    ['annualHours',        'setAnnualHours'],
    ['monthlyWorkDays',    'setMonthlyWorkDays'],
    ['pensionRate',        'setPensionRate'],
    ['healthRate',         'setHealthRate'],
    ['longtermRate',       'setLongtermRate'],
    ['employmentRate',     'setEmploymentRate'],
    ['incomeTaxRate',      'setIncomeTaxRate'],
  ];
  // settings 행은 snake_case 컬럼 그대로 반환됨
  const SETTING_SNAKE = {
    overtimeMultiplier: 'overtime_multiplier', annualHours: 'annual_hours',
    monthlyWorkDays: 'monthly_work_days', pensionRate: 'pension_rate',
    healthRate: 'health_rate', longtermRate: 'longterm_rate',
    employmentRate: 'employment_rate', incomeTaxRate: 'income_tax_rate',
  };

  async function loadSettings() {
    const res = await api('/api/admin-payroll-settings');
    if (!res.ok) { toast('설정 조회 실패: ' + (res.data?.error || res.status), 'err'); return; }
    const s = (res.data?.data || res.data)?.settings || {};
    for (const [camel, elId] of SETTING_FIELDS) {
      const el = $(elId);
      if (el) el.value = s[SETTING_SNAKE[camel]] ?? '';
    }
    const meta = $('settingsMeta');
    if (meta && s.updated_at) meta.textContent = '최종 수정: ' + fmtDate(s.updated_at);
  }

  async function saveSettings() {
    const body = {};
    for (const [camel, elId] of SETTING_FIELDS) {
      const v = $(elId)?.value;
      if (v !== '' && v != null) body[camel] = Number(v);
    }
    $('btnSaveSettings').disabled = true;
    try {
      const res = await api('/api/admin-payroll-settings', { method: 'PUT', body });
      if (!res.ok) { toast('설정 저장 실패: ' + (res.data?.error || res.status), 'err'); return; }
      toast('계산 기준 저장 완료 — 다음 재집계부터 적용됩니다');
      await loadSettings();
    } finally {
      $('btnSaveSettings').disabled = false;
    }
  }

  let _settingsLoaded = false;
  function toggleSettings() {
    const card = $('settingsCard');
    const show = card.style.display === 'none';
    card.style.display = show ? 'block' : 'none';
    if (show && !_settingsLoaded) { _settingsLoaded = true; loadSettings(); }
  }

  /* ── 글로벌 노출 (인라인 onclick 용) ── */
  window.openDetail = openDetail;
  window.closeModal = closeModal;
  window.approveSlip = approveSlip;
  window.holdSlip = holdSlip;
  window.markReviewed = markReviewed;
  window.paidSlip = paidSlip;
  window.saveSlipEdit = saveSlipEdit;
  window.addAdjRow = addAdjRow;
  window.recomputePreview = recomputePreview;

  /* ── 초기화 ── */
  document.addEventListener('DOMContentLoaded', async () => {
    initSelectors();
    syncExportLink();
    $('selYear').addEventListener('change', syncExportLink);
    $('selMonth').addEventListener('change', syncExportLink);
    const ok = await checkSuperAdmin();
    $('btnLoad').addEventListener('click', loadList);
    $('btnRecalc').addEventListener('click', () => recalc(false));
    $('btnRecalcForce').addEventListener('click', () => recalc(true));
    $('btnAnalyze').addEventListener('click', analyzePayroll);
    $('btnSendAll').addEventListener('click', sendAll);
    $('btnSettings').addEventListener('click', toggleSettings);
    $('btnSaveSettings').addEventListener('click', saveSettings);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
    if (ok) await loadList();
  });
})();
