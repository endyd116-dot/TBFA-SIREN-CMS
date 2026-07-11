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
  let _settings = null;  // 공제 요율 (자동 계산 미리보기용)

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
  /* 근무일수는 반차·반반차 때문에 소수가 나온다 (예: 10.75일). 정수면 소수점을 떼고 보여준다. */
  function days(n) {
    return (Math.round(Number(n || 0) * 100) / 100).toString();
  }

  function statusBadge(s) {
    return '<span class="status-badge s-' + esc(s) + '">' + esc(s) + '</span>';
  }
  /* 확인창 등 순수 텍스트 자리에 쓸 한글 상태명 */
  var STATUS_TEXT = {
    DRAFT: '초안', REVIEWED: '검토 완료', APPROVED: '승인됨',
    SENT: '발송됨', PAID: '지급 완료', HOLD: '보류',
  };
  function statusText(s) { return STATUS_TEXT[s] || String(s || ''); }
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
    tbody.innerHTML = '<tr class="loading-row"><td colspan="10">불러오는 중...</td></tr>';

    const res = await api('/api/admin-payroll?year=' + y + '&month=' + m);
    if (!res.ok) {
      tbody.innerHTML = '<tr class="loading-row"><td colspan="10" style="color:#dc2626">' +
        esc(res.data?.error || ('HTTP ' + res.status)) + '</td></tr>';
      return;
    }

    const d = res.data?.data || res.data;
    const rows = d?.rows || [];
    const counts = d?.counts || {};
    const ack = d?.ackCounts || {};
    currentRows = rows;

    $('cntDraft').textContent    = counts.DRAFT    || 0;
    $('cntReviewed').textContent = counts.REVIEWED || 0;
    $('cntApproved').textContent = counts.APPROVED || 0;
    $('cntSent').textContent     = counts.SENT     || 0;
    $('cntPaid').textContent     = counts.PAID     || 0;
    $('cntHold').textContent     = counts.HOLD     || 0;

    /* 수령확인 현황 — 교부된 명세서 기준 */
    const ackMeta = $('ackMeta'), btnRemind = $('btnRemind');
    if (ackMeta) {
      ackMeta.innerHTML = (ack.issued || 0) === 0 ? ''
        : ('— 교부 ' + ack.issued + '건 중 서명완료 ' + (ack.acknowledged || 0) +
           (ack.pending ? ' · <b style="color:#b45309">미서명 ' + ack.pending + '</b>' : '') +
           (ack.objected ? ' · <b style="color:#b91c1c">이의 ' + ack.objected + '</b>' : ''));
    }
    if (btnRemind) btnRemind.style.display = (ack.pending || 0) > 0 ? '' : 'none';

    loadObjections();   // 이의제기 카드 (있을 때만 표시)

    if (rows.length === 0) {
      tbody.innerHTML = '<tr class="loading-row"><td colspan="10">해당 월 명세서가 없습니다. "재집계"로 자동 생성하세요. (직원별 <b>기본연봉</b>이 설정돼 있어야 생성됩니다 — 회원 상세에서 설정)</td></tr>';
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
      /* 이 직원만 재집계 — 근태를 뒤늦게 바로잡았을 때, 그 달 다른 직원의 승인·발송·수동수정은
         건드리지 않고 이 한 명만 최신 근태로 다시 계산한다. (월 전체 강제 재집계의 안전한 대안) */
      actions.push('<button class="btn btn-warning btn-sm" onclick="recalcOne(' +
        r.id + ',\'' + String(r.memberUid).replace(/'/g, '') + '\',\'' + name.replace(/'/g, '') + '\')"' +
        ' title="이 직원만 최신 근태로 다시 계산">재집계</button>');
      /* 교부된 명세서만 증빙(서명 증적) 대상 */
      const issued = r.status === 'SENT' || r.status === 'PAID';
      if (issued) {
        actions.push('<button class="btn btn-light btn-sm" onclick="openEvidence(' + r.id + ')" title="열람·서명·이의 이력과 증빙 문서">증빙</button>');
      }
      actions.push('<button class="btn btn-light btn-sm" onclick="openMemberDocs(\'' +
        String(r.memberUid).replace(/'/g, '') + '\',\'' + name.replace(/'/g, '') + '\')" title="이 직원의 급여 문서 전체">문서함</button>');

      return '<tr>' +
        '<td>' + name + editMark + '</td>' +
        '<td>' + role + '</td>' +
        '<td class="r">' + days(r.workingDays) + '</td>' +
        '<td class="r">' + won(r.baseSalaryMonth) + '</td>' +
        '<td class="r">' + won(r.performanceBonus) + '</td>' +
        '<td class="r" style="font-weight:700">' + won(r.grossPay) + '</td>' +
        '<td class="r" style="font-weight:700;color:#0f766e">' + won(r.netPay) + '</td>' +
        '<td class="c">' + statusBadge(r.status) + '</td>' +
        '<td class="c">' + ackBadge(r) + '</td>' +
        '<td class="c" style="white-space:nowrap">' + actions.join(' ') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── 재집계 ──
     보존(건너뛴) 건이 있으면 '누구를·왜'를 반드시 화면에 띄운다.
     과거엔 "재집계 완료"만 뜨고 건너뛴 명세서는 조용히 옛 숫자로 남아, 근태를 바로잡아도
     급여에 반영이 안 되는 걸 알아챌 방법이 없었다. (2026-06 실제 발생) */
  function reportRecalcResult(d, whoLabel) {
    if ((d.candidateCount || 0) === 0) {
      toast(whoLabel
        ? (whoLabel + ' — 재집계 대상이 아닙니다 (기본연봉 미설정이거나 퇴사·비활성 직원)')
        : '재집계 대상 0명 — 연봉(기본급)이 설정된 직원이 없습니다. 회원 상세 → 기본연봉 설정 후 다시 시도하세요.', 'err');
      return;
    }
    toast('재집계 완료 — 대상 ' + d.candidateCount + '명 · 신규 ' + (d.created || 0)
      + ' · 갱신 ' + (d.updated || 0) + ' · 보존 ' + (d.skipped || 0)
      + (d.errors?.length ? ' · 오류 ' + d.errors.length : ''), d.errors?.length ? 'err' : 'ok');

    const kept = (d.skippedDetail || []).filter(s =>
      !/기록이 없음/.test(String(s.reason || '')));   // '근무기록 없음'은 보존이 아니라 대상 아님
    if (kept.length) {
      alert(
        '아래 ' + kept.length + '건은 갱신하지 않고 그대로 두었습니다.\n' +
        '이미 확정 단계이거나 금액을 직접 수정한 명세서이기 때문입니다.\n\n' +
        kept.map(s => '  · ' + (s.memberName || s.memberUid) + '  —  ' + s.reason).join('\n') +
        '\n\n최신 근태를 반영하려면 해당 직원 줄의 [재집계] 버튼을 누르세요.\n' +
        '(그 직원 한 명만 다시 계산하며, 다른 직원의 승인·발송 명세서는 건드리지 않습니다.)'
      );
    }
    if (d.errors?.length) {
      alert('재집계 중 오류 ' + d.errors.length + '건:\n\n' +
        d.errors.map(e => '  · 회원 ' + e.memberUid + ': ' + e.message).join('\n'));
    }
  }

  async function recalc(force) {
    const y = $('selYear').value, m = $('selMonth').value;
    if (force && !confirm(y + '년 ' + m + '월 명세서를 강제 재집계합니다.\n승인·발송·지급완료는 물론 수동으로 직접 수정한 금액·조정 라인까지 모두 자동 계산값으로 덮어씁니다. 계속할까요?')) return;
    if (!force && !confirm(y + '년 ' + m + '월 명세서를 최신 근태로 다시 계산합니다.\n\n· 초안·보류 건은 갱신됩니다 (보류 표시는 유지)\n· 승인·발송·지급완료·금액 직접수정 건은 그대로 보존됩니다\n  → 이 건들도 반영하려면 직원별 [재집계] 버튼을 쓰세요')) return;

    $('btnRecalc').disabled = true; $('btnRecalcForce').disabled = true;
    try {
      const res = await api('/api/admin-payroll?action=recalculate&year=' + y + '&month=' + m, {
        method: 'POST', body: { force: !!force }
      });
      if (!res.ok) {
        toast('재집계 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err');
        return;
      }
      reportRecalcResult(res.data?.data || res.data, null);
      await loadList();
    } finally {
      $('btnRecalc').disabled = false; $('btnRecalcForce').disabled = false;
    }
  }

  /* 직원 1명만 재집계 — 확정 단계(승인·발송·지급)·수동수정 건도 덮어쓴다.
     근태를 뒤늦게 바로잡은 뒤 그 직원의 급여만 다시 맞출 때 사용. */
  window.recalcOne = async function (slipId, memberUid, memberName) {
    const y = $('selYear').value, m = $('selMonth').value;
    const row = (currentRows || []).find(r => r.id === slipId) || {};
    const locked = ['REVIEWED', 'APPROVED', 'SENT', 'PAID'].indexOf(row.status) >= 0 || row.manuallyEdited;
    var msg = memberName + ' 님의 ' + y + '년 ' + m + '월 명세서를 최신 근태로 다시 계산합니다.\n\n' +
      '다른 직원의 명세서는 건드리지 않습니다.';
    if (locked) {
      msg += '\n\n[주의] 이 명세서는 현재 "' + statusText(row.status) + '"' +
        (row.manuallyEdited ? ' · 금액 직접수정됨' : '') + ' 상태입니다.\n' +
        '다시 계산하면 자동 계산값으로 덮어쓰고 초안으로 되돌아갑니다' +
        (row.manuallyEdited ? ' (직접 수정한 금액도 사라집니다)' : '') + '.\n계속할까요?';
    }
    if (!confirm(msg)) return;

    const res = await api('/api/admin-payroll?action=recalculate&year=' + y + '&month=' + m +
      '&memberUid=' + encodeURIComponent(memberUid), {
      method: 'POST', body: { force: true }
    });
    if (!res.ok) {
      toast('재집계 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err');
      return;
    }
    reportRecalcResult(res.data?.data || res.data, memberName);
    await loadList();
  };

  /* ── AI 분석 (이상치·점검·요약) ── */
  async function analyzePayroll() {
    const y = $('selYear').value, m = $('selMonth').value;
    const btn = $('btnAnalyze');
    if (btn) { btn.disabled = true; btn.textContent = '분석 중...'; }
    try {
      const res = await api('/api/admin-payroll?action=analyze&year=' + y + '&month=' + m, { method: 'POST' });
      if (!res.ok) { toast('AI 분석 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err'); return; }
      renderAnalysis(res.data?.data || res.data || {});
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'AI 분석'; }
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
      ? '<div style="margin-top:14px;font-weight:700;color:#b91c1c">이상치 ' + an.length + '건</div>'
        + an.map(a => '<div style="padding:6px 0;border-bottom:1px dashed #eee;font-size:13px">· <strong>' + esc(a.name) + '</strong> <span style="color:#b91c1c">[' + esc(a.type) + ']</span> ' + esc(a.detail) + '</div>').join('')
      : '<div style="margin-top:14px;color:#16a34a;font-size:13px">' + Icons.svg('check') + ' 이상치 없음</div>';

    const ck = Array.isArray(d.checklist) ? d.checklist : [];
    $('aiChecklist').innerHTML = ck.length
      ? '<div style="margin-top:14px;font-weight:700;color:#b45309">점검 ' + ck.length + '건</div>'
        + ck.map(c => '<div style="padding:6px 0;border-bottom:1px dashed #eee;font-size:13px">· <strong>' + esc(c.type) + '</strong>: ' + esc(c.detail) + '</div>').join('')
      : '<div style="margin-top:14px;color:#16a34a;font-size:13px">' + Icons.svg('check') + ' 점검 항목 없음</div>';
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
  /* 2026-06-03 일급제(B): 무급차감은 항상 0(무급일=출근일 미산입으로 처리)이라 편집 항목에서 제외.
     무급 일수는 '일급 산정' 줄에 정보로 표기. */
  const PAY_FIELDS = [
    { f: 'baseSalaryMonth', label: '기본급(출근일 기반)', sign: '+' },
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
    a = a || { label: '', amount: 0, kind: 'ADD', reason: '', taxable: true };
    const disabled = editable ? '' : ' disabled';
    /* taxable을 지정 안 한 옛 데이터는 '과세'로 본다 (보험료를 덜 떼는 쪽으로 기울지 않게) */
    const taxFree = a.taxable === false;
    return '<div class="adj-row">' +
      '<input class="adj-label" type="text" placeholder="항목명 (예: 성과금, 차량유지비)" value="' + esc(a.label) + '"' + disabled + '>' +
      '<input class="adj-amount" type="number" step="1" placeholder="금액" value="' + (Number(a.amount || 0)) + '"' + disabled + ' oninput="recomputePreview()">' +
      '<select class="adj-kind"' + disabled + ' onchange="recomputePreview()">' +
        '<option value="ADD"' + (a.kind !== 'DEDUCT' ? ' selected' : '') + '>가산(+)</option>' +
        '<option value="DEDUCT"' + (a.kind === 'DEDUCT' ? ' selected' : '') + '>차감(−)</option>' +
      '</select>' +
      '<select class="adj-taxable"' + disabled + ' onchange="recomputePreview()" ' +
        'title="과세: 4대보험·소득세를 매김 (성과금·상여 등) / 비과세: 안 매김 (차량유지비·식대 등 · 통상 월 20만원 한도)">' +
        '<option value="1"' + (!taxFree ? ' selected' : '') + '>과세</option>' +
        '<option value="0"' + (taxFree ? ' selected' : '') + '>비과세</option>' +
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
      const taxable = row.querySelector('.adj-taxable')?.value !== '0';
      const reason = (row.querySelector('.adj-reason')?.value || '').trim();
      if (!label && !amount && !reason) return; // 완전 빈 행 무시
      out.push({ label, amount, kind, reason, taxable });
    });
    return out;
  }

  /* 공제 자동 계산 여부 (기본 ON) */
  function autoDeductionOn() {
    const el = $('autoDedChk');
    return !el || el.checked;
  }

  /* 자동 계산 시 공제 입력칸은 잠근다 — 손으로 고쳐도 저장 때 덮어써지므로 헷갈리지 않게 */
  function syncDeductionInputs() {
    const auto = autoDeductionOn();
    DED_FIELDS.forEach(dd => {
      const el = document.querySelector('#modalBody input.money[data-field="' + dd.f + '"]');
      if (!el || el.dataset.locked === '1') return;   // 지급완료 등으로 이미 잠긴 건 건드리지 않음
      /* 기타공제는 자동 계산 대상이 아니라 항상 직접 입력 */
      if (dd.f === 'otherDeduction') return;
      el.disabled = auto;
      el.title = auto ? '공제 자동 계산 중 — 직접 넣으려면 위 체크를 해제하세요' : '';
    });
    recomputePreview();
  }
  window.syncDeductionInputs = syncDeductionInputs;

  function fieldVal(f) {
    const el = document.querySelector('#modalBody input.money[data-field="' + f + '"]');
    return el ? Number(el.value || 0) : 0;
  }

  /* 실시간 미리보기 (백엔드 공식과 동일)
     공제 자동 계산이 켜져 있으면 '과세 대상액'(세전 − 비과세 지급액) 기준으로 4대보험을 다시 계산해
     화면에 그대로 보여준다 → 저장 결과와 미리보기가 어긋나지 않는다. */
  function recomputePreview() {
    const base = fieldVal('baseSalaryMonth');
    const perf = fieldVal('performanceBonus');
    const perfect = fieldVal('perfectBonus');
    const adj = readAdjustments();
    const adjAdd = adj.filter(a => a.kind !== 'DEDUCT').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const adjDeduct = adj.filter(a => a.kind === 'DEDUCT').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const gross = base + perf + perfect + adjAdd - adjDeduct;  // 야근·무급차감 제외

    const nonTaxable = adj
      .filter(a => a.kind !== 'DEDUCT' && a.taxable === false)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const taxableBase = Math.max(0, gross - nonTaxable);

    const auto = autoDeductionOn();
    const s = _settings || {};
    let totalDeduction;
    if (auto && s.pensionRate != null) {
      const pension = taxableBase * Number(s.pensionRate || 0);
      const health = taxableBase * Number(s.healthRate || 0);
      const longterm = health * Number(s.longtermRate || 0);
      const employment = taxableBase * Number(s.employmentRate || 0);
      const incomeRate = Number(s.incomeTaxRate || 0);
      const income = incomeRate > 0 ? taxableBase * incomeRate : fieldVal('incomeTax');
      const local = income * 0.1;
      const other = fieldVal('otherDeduction');
      totalDeduction = pension + health + longterm + employment + income + local + other;

      /* 자동 계산 결과를 입력칸에 그대로 반영 (직원이 보게 될 값과 동일) */
      const put = (f, v) => {
        const el = document.querySelector('#modalBody input.money[data-field="' + f + '"]');
        if (el && el.disabled) el.value = Math.round(v);
      };
      put('nationalPension', pension);
      put('healthInsurance', health);
      put('longTermCare', longterm);
      put('employmentInsurance', employment);
      if (incomeRate > 0) { put('incomeTax', income); put('localTax', local); }
      else put('localTax', local);
    } else {
      totalDeduction = DED_FIELDS.reduce((acc, d) => acc + fieldVal(d.f), 0);
    }

    const net = gross - totalDeduction;

    if ($('previewGross')) $('previewGross').textContent = won(gross) + ' 원';
    if ($('previewDeduction')) $('previewDeduction').textContent = won(totalDeduction) + ' 원';
    if ($('previewNet')) $('previewNet').textContent = won(net) + ' 원';

    /* 비과세가 있으면 과세 대상액을 보여준다 (명세서에도 이 금액이 계산 기준으로 찍힌다) */
    const tb = $('previewTaxable');
    if (tb) {
      if (nonTaxable > 0) {
        tb.style.display = '';
        tb.innerHTML = '비과세 <b>' + won(nonTaxable) + '</b>원 제외 → 보험료·세금 기준 <b>' + won(taxableBase) + '</b>원' +
          (nonTaxable > 200000
            ? '<br><span style="color:#b45309">※ 비과세 합계가 월 20만원을 넘습니다 — 한도 초과분은 과세 대상일 수 있으니 확인하세요</span>'
            : '');
      } else {
        tb.style.display = 'none';
      }
    }
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
      '<dt>근태 (출근·근무·지각·결근·유급·무급·만근)</dt>' +
      '<dd>' +
        days(slip.workingDays) + '일 · ' +
        hours(slip.workingMins) + 'h · ' +
        (slip.lateCount || 0) + '회 · ' +
        (slip.absentCount || 0) + '회 · ' +
        (Number(slip.paidLeaveDays) || 0) + '일 · ' +
        (Number(slip.unpaidLeaveDays) || 0) + '일 · ' +
        (slip.perfectAttendance ? '<strong style="color:#16a34a">만근</strong>' : '아님') +
      '</dd>' +

      /* 2026-06-03: 출근일 기반 일급 산정 근거 */
      (function () {
        var dv = (slip.calculationSnapshot && slip.calculationSnapshot.derived) || {};
        if (dv.dailyWage == null) return '';
        var bizDays = (dv.monthBusinessDays != null) ? dv.monthBusinessDays : null;
        var payDays = (dv.paidDays != null) ? dv.paidDays : (slip.workingDays || 0);
        var unpaidDays = (bizDays != null) ? Math.max(0, bizDays - payDays) : null;
        return '<dt>일급 산정 (출근일 기반)</dt><dd>' +
          '그달 영업일수 ' + (bizDays != null ? bizDays : '—') + '일 · ' +
          '일급 ' + won(dv.dailyWage) + ' × 지급일 ' + payDays + '일' +
          ' = 기본급 ' + won(slip.baseSalaryMonth) +
          (unpaidDays != null
            ? ' <span style="color:#b45309;font-size:11px">· 미산입(무급) ' + unpaidDays + '일 — 공휴일·결근·무급휴가는 미지급</span>'
            : ' <span style="color:#94a3b8;font-size:11px">(공휴일·결근은 출근일에서 제외돼 무급)</span>') +
          '</dd>';
      })() +

      '<div class="pay-section-title">지급 항목' + (editable ? ' <span style="font-weight:400;color:#9ca3af">(직접 수정 가능)</span>' : '') + '</div>' +
      payHtml +

      '<div class="pay-section-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>조정 라인 <span style="font-weight:400;color:#9ca3af;font-size:11.5px">— 성과금·차량지원 등. 비과세로 지정하면 보험료·세금을 매기지 않습니다</span></span>' +
        (editable ? '<button class="btn btn-light btn-sm" type="button" onclick="addAdjRow()">+ 조정 추가</button>' : '') +
      '</div>' +
      '<div class="adj-wrap" id="adjRows">' + adjInner + '</div>' +

      '<table class="pay-edit"><tbody>' +
        '<tr class="pay-total-row"><td class="lbl">세전 총액</td>' +
        '<td class="val"><span class="pay-readonly-val" id="previewGross">' + won(slip.grossPay) + ' 원</span></td></tr>' +
      '</tbody></table>' +
      '<div id="previewTaxable" style="display:none;font-size:12px;color:#6b7280;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;margin-top:6px;line-height:1.6"></div>' +

      '<div class="pay-section-title" style="display:flex;justify-content:space-between;align-items:center">' +
        '<span>공제 항목</span>' +
        (editable
          ? '<label style="font-weight:400;font-size:12px;color:#4b5563;display:flex;align-items:center;gap:5px;cursor:pointer">' +
              '<input type="checkbox" id="autoDedChk" checked onchange="syncDeductionInputs()">' +
              '4대보험·소득세 자동 계산 <span style="color:#9ca3af">(과세 대상액 기준)</span>' +
            '</label>'
          : '') +
      '</div>' +
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
      acts.push('<button class="btn btn-primary btn-sm" onclick="saveSlipEdit()">저장</button>');
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

    /* 공제 요율을 가져와 자동 계산 미리보기를 켠다 (저장 결과와 화면이 같아지도록) */
    if (editable) {
      await ensureSettings();
      syncDeductionInputs();
    }
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

    /* autoDeduction=true면 서버가 '과세 대상액'(세전 − 비과세) 기준으로 4대보험·소득세를 다시 계산한다.
       → 명세서에 적히는 계산방법("과세 대상액 × 4.5%")과 실제 금액이 항상 일치한다. */
    const body = { adjustments, reason, autoDeduction: autoDeductionOn() };
    for (const p of PAY_FIELDS) body[p.f] = fieldVal(p.f);
    for (const dd of DED_FIELDS) body[dd.f] = fieldVal(dd.f);

    /* 이미 교부된 명세서를 고치면 문서·서명이 초기화된다 — 모르고 누르지 않게 미리 알린다 */
    if ((_curSlip.status === 'SENT' || _curSlip.status === 'PAID') || _curSlip.ackStatus === 'ACKNOWLEDGED') {
      if (!confirm('이미 교부된 명세서입니다.\n\n' +
        '금액을 바꾸면 지금 보관된 문서는 더 이상 유효하지 않으므로 폐기되고,\n' +
        '직원의 수령 확인(서명)도 다시 받아야 합니다.\n' +
        '(다시 발송하면 정정본으로 나갑니다. 지난 서명 기록은 그대로 보존됩니다.)\n\n계속할까요?')) return;
    }

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
  /* 2026-06-03: 야근 미운영 — 야근배율·연기준근로시간 설정 제거(미사용) */
  const SETTING_FIELDS = [
    ['monthlyWorkDays',    'setMonthlyWorkDays'],
    ['pensionRate',        'setPensionRate'],
    ['healthRate',         'setHealthRate'],
    ['longtermRate',       'setLongtermRate'],
    ['employmentRate',     'setEmploymentRate'],
    ['incomeTaxRate',      'setIncomeTaxRate'],
  ];
  // settings 행은 snake_case 컬럼 그대로 반환됨
  const SETTING_SNAKE = {
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
    cacheSettings(s);
    const meta = $('settingsMeta');
    if (meta && s.updated_at) meta.textContent = '최종 수정: ' + fmtDate(s.updated_at);
  }

  /* 공제 요율 — 상세 모달의 자동 계산 미리보기가 서버와 같은 값을 쓰도록 캐시 */
  function cacheSettings(s) {
    if (!s) return;
    _settings = {
      pensionRate:    Number(s.pension_rate    ?? s.pensionRate    ?? 0),
      healthRate:     Number(s.health_rate     ?? s.healthRate     ?? 0),
      longtermRate:   Number(s.longterm_rate   ?? s.longtermRate   ?? 0),
      employmentRate: Number(s.employment_rate ?? s.employmentRate ?? 0),
      incomeTaxRate:  Number(s.income_tax_rate ?? s.incomeTaxRate  ?? 0),
    };
  }

  /** 상세 모달을 열 때 요율이 아직 없으면 조용히 한 번 가져온다 */
  async function ensureSettings() {
    if (_settings) return;
    try {
      const res = await api('/api/admin-payroll-settings');
      if (res.ok) cacheSettings((res.data?.data || res.data)?.settings || {});
    } catch (_) { /* 실패해도 미리보기만 못 할 뿐 저장은 서버가 계산 */ }
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

  /* ── 직원 연봉 설정 (super 전용, 회원 모달 대신 여기서 관리) ── */
  const ROLE_LABEL_KO = { super_admin: '슈퍼관리자', admin: '관리자', operator: '운영자' };
  function escP(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  async function loadStaffSalaries() {
    const tb = $('staffSalaryBody');
    if (!tb) return;
    const res = await api('/api/admin-payroll?staff=1');
    if (!res.ok) { tb.innerHTML = '<tr class="loading-row"><td colspan="4">불러오기 실패</td></tr>'; return; }
    const staff = (res.data?.data?.staff || res.data?.staff || []);
    if (!staff.length) { tb.innerHTML = '<tr class="loading-row"><td colspan="4">활성 직원(운영자·관리자)이 없습니다</td></tr>'; return; }
    tb.innerHTML = staff.map(s => `
      <tr data-sid="${s.id}">
        <td>${escP(s.name)}</td>
        <td>${ROLE_LABEL_KO[s.role] || escP(s.role) || '—'}</td>
        <td><input type="number" min="0" step="100000" value="${Number(s.baseSalary) || 0}" id="staffSal_${s.id}" style="width:170px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px"> 원</td>
        <td><button class="btn btn-primary" onclick="saveStaffSalary(${s.id})">저장</button></td>
      </tr>`).join('');
  }
  async function saveStaffSalary(id) {
    const inp = document.getElementById('staffSal_' + id);
    if (!inp) return;
    const v = Number(inp.value);
    if (!Number.isFinite(v) || v < 0) { toast('0 이상의 숫자를 입력하세요', 'err'); return; }
    const res = await api('/api/admin/members', { method: 'PATCH', body: { id, baseSalary: v } });
    if (!res.ok || res.data?.ok === false) { toast(res.data?.error || '저장 실패', 'err'); return; }
    toast('연봉 저장 완료 — 해당 월 재집계 시 출근일 기반으로 반영됩니다', 'ok');
  }
  window.saveStaffSalary = saveStaffSalary;

  /* ══════════════════════════════════════════════════════════════
     증빙 보관함 — 수령확인(전자서명) 증적 · 직원별 문서함 · 이의제기
     ══════════════════════════════════════════════════════════════ */

  const ACK_LABEL = { PENDING: '미서명', ACKNOWLEDGED: '서명완료', OBJECTED: '이의제기' };

  /** 목록의 수령확인 열 — 교부 전이면 '—' */
  function ackBadge(r) {
    if (r.status !== 'SENT' && r.status !== 'PAID') return '<span style="color:#d1d5db">—</span>';
    const s = r.ackStatus || 'PENDING';
    const style = {
      ACKNOWLEDGED: 'background:#d1fae5;color:#065f46',
      OBJECTED:     'background:#fee2e2;color:#991b1b',
      PENDING:      'background:#fef3c7;color:#92400e',
    }[s] || '';
    const when = s === 'ACKNOWLEDGED' && r.ackAt ? ' ' + new Date(r.ackAt).toLocaleDateString('ko-KR') : '';
    const viewed = s === 'PENDING' && r.firstViewedAt ? ' title="열람함: ' + fmtDate(r.firstViewedAt) + '"' : '';
    const ver = Number(r.documentVersion || 1) > 1 ? ' <span style="color:#b91c1c;font-size:10px">정정' + r.documentVersion + '차</span>' : '';
    return '<span class="status-badge" style="' + style + '"' + viewed + '>' + (ACK_LABEL[s] || s) + '</span>' +
      (when ? '<div style="font-size:10.5px;color:#9ca3af;margin-top:2px">' + esc(when) + '</div>' : '') + ver;
  }

  function closeEvModal() { $('evModal').classList.remove('show'); }
  window.closeEvModal = closeEvModal;

  function evOpen(title, bodyHtml, actionsHtml) {
    $('evTitle').textContent = title;
    $('evBody').innerHTML = bodyHtml;
    $('evActions').innerHTML = actionsHtml || '<button class="btn btn-light" onclick="closeEvModal()">닫기</button>';
    $('evModal').classList.add('show');
  }

  /* ── 서명 증적 상세 ── */
  async function openEvidence(slipId) {
    evOpen('증빙 · 서명 증적', '<div style="padding:24px;text-align:center;color:#9ca3af">불러오는 중...</div>');
    const res = await api('/api/admin-payroll-evidence?slipId=' + slipId);
    if (!res.ok) {
      evOpen('증빙 · 서명 증적', '<div style="padding:20px;color:#dc2626">' +
        esc(res.data?.error || res.data?.detail || ('HTTP ' + res.status)) + '</div>');
      return;
    }
    const d = res.data?.data || res.data;
    const s = d.slip, hist = d.history || [], objs = d.objections || [];

    const ACT_LABEL = { VIEWED: '열람', ACKNOWLEDGED: '전자서명', OBJECTED: '이의제기' };
    const ACT_COLOR = { VIEWED: '#6b7280', ACKNOWLEDGED: '#047857', OBJECTED: '#b91c1c' };

    let html = '<div class="pay-section-title">문서 정보</div>' +
      '<table class="pay-edit"><tbody>' +
      '<tr><td class="lbl">대상</td><td class="val">' + esc(s.memberName || s.memberUid) + ' · ' + s.payYear + '년 ' + String(s.payMonth).padStart(2, '0') + '월</td></tr>' +
      '<tr><td class="lbl">문서 차수</td><td class="val">' + (s.documentVersion > 1 ? '<b style="color:#b91c1c">정정 ' + s.documentVersion + '차</b>' : '원본 (1차)') + '</td></tr>' +
      '<tr><td class="lbl">교부일</td><td class="val">' + esc(s.issuedAt ? fmtDate(s.issuedAt) : '—') + '</td></tr>' +
      '<tr><td class="lbl">직원 첫 열람</td><td class="val">' + (s.firstViewedAt ? esc(fmtDate(s.firstViewedAt)) : '<span style="color:#b45309">아직 열어보지 않음</span>') + '</td></tr>' +
      '<tr><td class="lbl">수령 확인</td><td class="val">' + (s.ackStatus === 'ACKNOWLEDGED'
        ? '<b style="color:#047857">서명 완료</b> · ' + esc(fmtDate(s.ackAt))
        : s.ackStatus === 'OBJECTED' ? '<b style="color:#b91c1c">이의 제기됨</b>'
        : '<b style="color:#b45309">미서명</b>' + (s.reminderCount ? ' (독촉 ' + s.reminderCount + '회)' : '')) + '</td></tr>' +
      '<tr><td class="lbl">문서 지문(무결성)</td><td class="val" style="font-family:monospace;font-size:11px;color:#6b7280">' +
        esc(s.documentSha256 ? String(s.documentSha256).slice(0, 32) + '…' : '—') + '</td></tr>' +
      '<tr><td class="lbl">보관 문서</td><td class="val">' +
        (s.hasDocument ? '<a class="btn btn-light btn-sm" href="/api/admin-payroll-evidence?slipId=' + s.id + '&download=1" target="_blank" rel="noopener">교부 원본</a> ' : '') +
        (s.hasSignedDocument ? '<a class="btn btn-success btn-sm" href="/api/admin-payroll-evidence?slipId=' + s.id + '&download=1&signed=1" target="_blank" rel="noopener">서명본</a>' : '') +
        (!s.hasDocument && !s.hasSignedDocument ? '<span style="color:#9ca3af">보관된 문서 없음 (이 명세서는 문서 고정 도입 전에 발송됨)</span>' : '') +
      '</td></tr>' +
      '</tbody></table>';

    html += '<div class="pay-section-title">열람·서명 이력 (지워지지 않는 기록)</div>';
    if (hist.length === 0) {
      html += '<div class="adj-empty">아직 기록이 없습니다.</div>';
    } else {
      html += '<div class="audit-list">' + hist.map(h => {
        const items = (h.consentItems || []).map(c => (c.agreed ? '☑ ' : '☐ ') + esc(c.text)).join('<br>');
        return '<div class="audit-item">' +
          '<div class="a-meta">' + esc(fmtDate(h.createdAt)) +
            (h.documentVersion > 1 ? ' · 정정 ' + h.documentVersion + '차 문서' : '') +
            (h.ip ? ' · IP ' + esc(h.ip) : '') + '</div>' +
          '<div class="a-change"><b style="color:' + (ACT_COLOR[h.action] || '#374151') + '">' +
            (ACT_LABEL[h.action] || esc(h.action)) + '</b>' +
            (h.signedName ? ' — ' + esc(h.signedName) + ' (' + (h.signatureType === 'DRAW' ? '손글씨 서명' : '성명 입력') + ')' : '') +
          '</div>' +
          (items ? '<div style="font-size:11.5px;color:#065f46;margin-top:4px">' + items + '</div>' : '') +
          (h.objectionReason ? '<div class="a-reason">' + esc(h.objectionReason) + '</div>' : '') +
          (h.userAgent ? '<div style="font-size:10.5px;color:#c4c9d0;margin-top:3px">' + esc(String(h.userAgent).slice(0, 90)) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    if (objs.length) {
      html += '<div class="pay-section-title">이의제기</div><div class="audit-list">' + objs.map(o =>
        '<div class="audit-item"><div class="a-meta">' + esc(fmtDate(o.createdAt)) + ' · ' + esc(o.status) + '</div>' +
        '<div class="a-change">' + esc(o.reason) + '</div>' +
        (o.resolutionNote ? '<div class="a-reason">회신: ' + esc(o.resolutionNote) + '</div>' : '') + '</div>').join('') + '</div>';
    }

    const actions =
      '<button class="btn btn-warning" onclick="reissueSlip(' + s.id + ')" title="내용을 바로잡아 새 차수로 다시 교부합니다 (직원 재서명 필요)">정정 재발행</button>' +
      '<button class="btn btn-light" onclick="closeEvModal()">닫기</button>';
    evOpen('증빙 · ' + esc(s.memberName || '') + ' ' + s.payYear + '년 ' + String(s.payMonth).padStart(2, '0') + '월', html, actions);
  }
  window.openEvidence = openEvidence;

  /* ── 정정 재발행 ── */
  async function reissueSlip(slipId) {
    const reason = prompt(
      '정정 재발행합니다.\n\n' +
      '· 지금 명세서 내용으로 새 차수 문서를 만들어 다시 교부합니다\n' +
      '· 직원의 기존 서명은 무효가 되고, 다시 서명을 받습니다 (이전 서명 기록은 그대로 보존)\n' +
      '· 금액이 틀렸다면 먼저 [재집계]나 [상세]에서 바로잡은 뒤 재발행하세요\n\n' +
      '정정 사유를 입력하세요 (증빙 추적용·필수):', '');
    if (reason == null) return;
    if (!String(reason).trim()) { toast('정정 사유는 필수입니다', 'err'); return; }

    const res = await api('/api/admin-payroll-evidence?action=reissue', {
      method: 'POST', body: { slipId, reason: String(reason).trim() },
    });
    if (!res.ok) { toast('정정 재발행 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err'); return; }
    toast(res.data?.message || '정정 재발행 완료', 'ok');
    closeEvModal();
    await loadList();
  }
  window.reissueSlip = reissueSlip;

  /* ── 직원별 문서함 ── */
  async function openMemberDocs(memberUid, memberName) {
    evOpen('문서함 · ' + memberName, '<div style="padding:24px;text-align:center;color:#9ca3af">불러오는 중...</div>');
    const res = await api('/api/admin-payroll-evidence?memberUid=' + encodeURIComponent(memberUid));
    if (!res.ok) {
      evOpen('문서함 · ' + memberName, '<div style="padding:20px;color:#dc2626">' +
        esc(res.data?.error || ('HTTP ' + res.status)) + '</div>');
      return;
    }
    const d = res.data?.data || res.data;
    const list = d.rows || [];

    let html;
    if (list.length === 0) {
      html = '<div style="padding:20px;color:#9ca3af;font-size:13px">교부된 명세서가 없습니다.</div>';
    } else {
      html = '<table class="list"><thead><tr>' +
        '<th>대상 월</th><th class="r">세전총액</th><th class="r">실수령</th>' +
        '<th class="c">수령확인</th><th class="c">문서</th></tr></thead><tbody>' +
        list.map(s => {
          const ackTxt = s.ackStatus === 'ACKNOWLEDGED'
            ? '<span style="color:#047857;font-weight:700">서명완료</span><div style="font-size:10.5px;color:#9ca3af">' + esc(new Date(s.ackAt).toLocaleDateString('ko-KR')) + '</div>'
            : s.ackStatus === 'OBJECTED' ? '<span style="color:#b91c1c;font-weight:700">이의제기</span>'
            : '<span style="color:#b45309;font-weight:700">미서명</span>';
          return '<tr>' +
            '<td><b>' + s.payYear + '년 ' + String(s.payMonth).padStart(2, '0') + '월</b>' +
              (s.documentVersion > 1 ? ' <span style="color:#b91c1c;font-size:10.5px">정정' + s.documentVersion + '차</span>' : '') + '</td>' +
            '<td class="r">' + won(s.grossPay) + '</td>' +
            '<td class="r" style="font-weight:700;color:#0f766e">' + won(s.netPay) + '</td>' +
            '<td class="c">' + ackTxt + '</td>' +
            '<td class="c" style="white-space:nowrap">' +
              (s.hasDocument ? '<a class="btn btn-light btn-sm" href="/api/admin-payroll-evidence?slipId=' + s.id + '&download=1" target="_blank" rel="noopener">원본</a> ' : '') +
              (s.hasSignedDocument ? '<a class="btn btn-success btn-sm" href="/api/admin-payroll-evidence?slipId=' + s.id + '&download=1&signed=1" target="_blank" rel="noopener">서명본</a> ' : '') +
              '<button class="btn btn-light btn-sm" onclick="openEvidence(' + s.id + ')">증적</button>' +
            '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    const actions = (list.length
        ? '<a class="btn btn-primary" href="/api/admin-payroll-evidence?memberUid=' + encodeURIComponent(memberUid) + '&zip=1" target="_blank" rel="noopener">전체 ZIP 다운로드</a>'
        : '') +
      '<button class="btn btn-light" onclick="closeEvModal()">닫기</button>';
    evOpen('문서함 · ' + memberName + ' (' + list.length + '건)', html, actions);
  }
  window.openMemberDocs = openMemberDocs;

  /* ── 미서명 독촉 ── */
  async function remindUnsigned() {
    const y = $('selYear').value, m = $('selMonth').value;
    if (!confirm(y + '년 ' + m + '월 명세서를 아직 전자서명하지 않은 직원에게\n수령 확인 요청 알림을 보냅니다. 계속할까요?')) return;
    const btn = $('btnRemind');
    btn.disabled = true;
    try {
      const res = await api('/api/admin-payroll-evidence?action=remind', {
        method: 'POST', body: { year: Number(y), month: Number(m) },
      });
      if (!res.ok) { toast('독촉 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err'); return; }
      toast(res.data?.message || '수령 확인 요청을 보냈습니다', 'ok');
      await loadList();
    } finally { btn.disabled = false; }
  }

  /* ── 이의제기 처리 ── */
  const OBJ_STATUS_KO = { OPEN: '접수됨', IN_REVIEW: '검토 중', RESOLVED: '처리 완료', REJECTED: '반려됨' };

  async function loadObjections() {
    const card = $('objCard'), tb = $('objTbody');
    if (!card || !tb) return;
    const res = await api('/api/admin-payroll-objections?status=PENDING_ALL');
    if (!res.ok) { card.style.display = 'none'; return; }
    const d = res.data?.data || res.data;
    const list = d?.rows || [];
    if (list.length === 0) { card.style.display = 'none'; return; }

    card.style.display = 'block';
    const c = d.counts || {};
    $('objMeta').textContent = '— 미처리 ' + list.length + '건' +
      (c.RESOLVED ? ' (누적 처리완료 ' + c.RESOLVED + ')' : '');

    tb.innerHTML = list.map(o =>
      '<tr>' +
      '<td><b>' + esc(o.memberName || o.memberUid) + '</b></td>' +
      '<td>' + o.payYear + '.' + String(o.payMonth).padStart(2, '0') + '</td>' +
      '<td style="font-size:12.5px;line-height:1.6">' + esc(o.reason) + '</td>' +
      '<td class="c"><span class="status-badge" style="background:' +
        (o.status === 'OPEN' ? '#fee2e2;color:#991b1b' : '#fef3c7;color:#92400e') + '">' +
        (OBJ_STATUS_KO[o.status] || o.status) + '</span></td>' +
      '<td class="c" style="font-size:11.5px;color:#6b7280">' + esc(new Date(o.createdAt).toLocaleDateString('ko-KR')) + '</td>' +
      '<td class="c" style="white-space:nowrap">' +
        (o.status === 'OPEN' ? '<button class="btn btn-light btn-sm" onclick="objSet(' + o.id + ',\'IN_REVIEW\')">검토 시작</button> ' : '') +
        '<button class="btn btn-success btn-sm" onclick="objSet(' + o.id + ',\'RESOLVED\')">처리 완료</button> ' +
        '<button class="btn btn-danger btn-sm" onclick="objSet(' + o.id + ',\'REJECTED\')">반려</button>' +
      '</td></tr>').join('');
  }

  async function objSet(id, status) {
    let note = '';
    if (status === 'RESOLVED' || status === 'REJECTED') {
      const label = status === 'RESOLVED'
        ? '직원에게 보낼 회신 내용을 입력하세요.\n(예: 6월 3일 근태를 정정하고 명세서를 다시 계산했습니다. 정정본을 확인해 주세요.)'
        : '반려 사유를 입력하세요. 직원에게 그대로 전달됩니다.';
      const r = prompt(label, '');
      if (r == null) return;
      note = String(r).trim();
      if (!note) { toast('회신 내용은 필수입니다', 'err'); return; }
    }
    const res = await api('/api/admin-payroll-objections?id=' + id, {
      method: 'PATCH', body: { status, resolutionNote: note || undefined },
    });
    if (!res.ok) { toast('처리 실패: ' + (res.data?.error || 'HTTP ' + res.status), 'err'); return; }
    toast(res.data?.message || '처리했습니다', 'ok');
    await loadList();
  }
  window.objSet = objSet;

  function syncZipLink() {
    const y = $('selYear').value, m = $('selMonth').value;
    const a = $('btnZip');
    if (a) a.href = '/api/admin-payroll-evidence?year=' + y + '&month=' + m + '&zip=1';
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
    syncZipLink();
    $('selYear').addEventListener('change', () => { syncExportLink(); syncZipLink(); });
    $('selMonth').addEventListener('change', () => { syncExportLink(); syncZipLink(); });
    const ok = await checkSuperAdmin();
    if (ok) { const sc = $('staffSalaryCard'); if (sc) sc.style.display = 'block'; loadStaffSalaries(); }
    $('btnLoad').addEventListener('click', loadList);
    $('btnRecalc').addEventListener('click', () => recalc(false));
    $('btnRecalcForce').addEventListener('click', () => recalc(true));
    $('btnAnalyze').addEventListener('click', analyzePayroll);
    $('btnSendAll').addEventListener('click', sendAll);
    $('btnSettings').addEventListener('click', toggleSettings);
    $('btnSaveSettings').addEventListener('click', saveSettings);
    const br = $('btnRemind');
    if (br) br.addEventListener('click', remindUnsigned);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
    const evm = document.getElementById('evModal');
    if (evm) evm.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeEvModal(); });
    if (ok) await loadList();
  });
})();
