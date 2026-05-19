/* admin-payroll.js — R37 급여관리 어드민 화면 (슈퍼어드민 전용)
 *
 * - GET /api/admin-payroll?year=&month=  → 월별 일람 + 통계 카운트
 * - GET /api/admin-payroll?id=N          → 상세 (calculation_snapshot 포함)
 * - PATCH /api/admin-payroll?id=N        → 검토 (status=REVIEWED) / 메모 수정
 * - POST /api/admin-payroll?id=N&action=approve  → 승인
 * - POST /api/admin-payroll?id=N&action=hold     → 보류
 * - POST /api/admin-payroll?action=recalculate&year=&month=  → 재집계 (body.force)
 * - POST /api/admin-payroll-send  body { year, month }       → 일괄 발송
 * - GET  /api/admin-payroll-pdf?id=N  → PDF 다운로드
 * - GET  /api/admin-payroll-export?year=&month=  → CSV
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let currentRows = [];

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
    /* 본문은 기본 표시 — CSS의 display:none을 인라인으로 덮어쓰기 (block 명시) */
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
    /* 직전 달 */
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

  /* ── 일람 로드 ── */
  async function loadList() {
    const y = $('selYear').value, m = $('selMonth').value;
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
    currentRows = rows;

    $('cntDraft').textContent    = counts.DRAFT    || 0;
    $('cntReviewed').textContent = counts.REVIEWED || 0;
    $('cntApproved').textContent = counts.APPROVED || 0;
    $('cntSent').textContent     = counts.SENT     || 0;
    $('cntHold').textContent     = counts.HOLD     || 0;

    if (rows.length === 0) {
      tbody.innerHTML = '<tr class="loading-row"><td colspan="10">해당 월 명세서가 없습니다. "재집계" 버튼으로 자동 생성하세요.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const name = esc(r.memberName || ('회원ID:' + r.memberUid));
      const role = esc(r.memberMilestoneRole || r.memberRole || '-');
      const actions = [];
      actions.push('<button class="btn btn-light btn-sm" onclick="openDetail(' + r.id + ')">상세</button>');
      actions.push('<a class="btn btn-primary btn-sm" href="/api/admin-payroll-pdf?id=' + r.id + '" target="_blank" rel="noopener">PDF</a>');
      if (r.status === 'DRAFT' || r.status === 'REVIEWED') {
        actions.push('<button class="btn btn-success btn-sm" onclick="approveSlip(' + r.id + ')">승인</button>');
      }
      if (r.status !== 'SENT' && r.status !== 'HOLD') {
        actions.push('<button class="btn btn-danger btn-sm" onclick="holdSlip(' + r.id + ')">보류</button>');
      }
      return '<tr>' +
        '<td>' + name + '</td>' +
        '<td>' + role + '</td>' +
        '<td class="r">' + (r.workingDays || 0) + '</td>' +
        '<td class="r">' + hours(r.overtimeMins) + '</td>' +
        '<td class="r">' + won(r.baseSalaryMonth) + '</td>' +
        '<td class="r">' + won(r.performanceBonus) + '</td>' +
        '<td class="r" style="color:#b91c1c">' + (Number(r.deductionUnpaid) > 0 ? '−' + won(r.deductionUnpaid) : '0') + '</td>' +
        '<td class="r" style="font-weight:700">' + won(r.grossPay) + '</td>' +
        '<td class="c">' + statusBadge(r.status) + '</td>' +
        '<td class="c" style="white-space:nowrap">' + actions.join(' ') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ── 재집계 ── */
  async function recalc(force) {
    const y = $('selYear').value, m = $('selMonth').value;
    if (force && !confirm(y + '년 ' + m + '월 명세서를 강제 재집계합니다.\n승인·발송된 명세서도 덮어씁니다. 계속할까요?')) return;
    if (!force && !confirm(y + '년 ' + m + '월 명세서를 자동 재집계합니다.\n(DRAFT 상태만 갱신·REVIEWED 이상은 보존)')) return;

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
      toast('재집계 완료 — 대상 ' + (d.candidateCount || 0) + '명 · 신규 ' + (d.created || 0)
        + ' · 갱신 ' + (d.updated || 0) + ' · 보존 ' + (d.skipped || 0)
        + (d.errors?.length ? ' · 오류 ' + d.errors.length : ''), d.errors?.length ? 'err' : 'ok');
      await loadList();
    } finally {
      $('btnRecalc').disabled = false; $('btnRecalcForce').disabled = false;
    }
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

  /* ── 상세 모달 ── */
  async function openDetail(id) {
    const res = await api('/api/admin-payroll?id=' + id);
    if (!res.ok) { toast('상세 조회 실패', 'err'); return; }
    const d = res.data?.data || res.data;
    const slip = d.slip, mb = d.member;

    $('modalTitle').textContent = (mb?.name || '회원ID:' + slip.memberUid) +
      ' — ' + slip.payYear + '년 ' + String(slip.payMonth).padStart(2, '0') + '월';

    const body = $('modalBody');
    body.innerHTML =
      '<dt>상태</dt><dd>' + statusBadge(slip.status) + '</dd>' +
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
      '<dt>급여 구성</dt><dd>' +
        '+ 월 기본급: <strong>' + won(slip.baseSalaryMonth) + ' 원</strong><br>' +
        '+ 야근 수당: ' + won(slip.overtimePay) + ' 원<br>' +
        '− 무급 차감: <span style="color:#b91c1c">' + won(slip.deductionUnpaid) + ' 원</span><br>' +
        '+ 성과 보너스: ' + won(slip.performanceBonus) + ' 원<br>' +
        '+ 만근 보너스: ' + won(slip.perfectBonus) + ' 원<br>' +
        '<hr style="margin:8px 0"> 세전 총액: <strong style="font-size:15px;color:#3730a3">' + won(slip.grossPay) + ' 원</strong>' +
      '</dd>' +
      (slip.reviewNote ? '<dt>검토 메모</dt><dd>' + esc(slip.reviewNote) + '</dd>' : '') +
      (slip.sentAt ? '<dt>발송일</dt><dd>' + esc(new Date(slip.sentAt).toLocaleString('ko-KR')) + '</dd>' : '') +
      '<dt>계산 근거 (calculation_snapshot)</dt>' +
      '<dd><pre class="snapshot">' + esc(JSON.stringify(slip.calculationSnapshot, null, 2)) + '</pre></dd>';

    const actions = $('modalActions');
    const acts = [];
    acts.push('<a class="btn btn-primary btn-sm" href="/api/admin-payroll-pdf?id=' + slip.id + '" target="_blank" rel="noopener">PDF 다운로드</a>');
    if (slip.status === 'DRAFT') {
      acts.push('<button class="btn btn-warning btn-sm" onclick="markReviewed(' + slip.id + ')">검토 완료</button>');
    }
    if (slip.status === 'DRAFT' || slip.status === 'REVIEWED') {
      acts.push('<button class="btn btn-success btn-sm" onclick="approveSlip(' + slip.id + ')">승인</button>');
    }
    if (slip.status !== 'SENT' && slip.status !== 'HOLD') {
      acts.push('<button class="btn btn-danger btn-sm" onclick="holdSlip(' + slip.id + ')">보류</button>');
    }
    acts.push('<button class="btn btn-light btn-sm" onclick="closeModal()">닫기</button>');
    actions.innerHTML = acts.join(' ');

    $('modal').classList.add('show');
  }

  function closeModal() {
    $('modal').classList.remove('show');
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

  /* ── 글로벌 노출 (인라인 onclick 용) ── */
  window.openDetail = openDetail;
  window.closeModal = closeModal;
  window.approveSlip = approveSlip;
  window.holdSlip = holdSlip;
  window.markReviewed = markReviewed;

  /* ── 초기화 ── */
  document.addEventListener('DOMContentLoaded', async () => {
    initSelectors();
    const ok = await checkSuperAdmin();
    $('btnLoad').addEventListener('click', loadList);
    $('btnRecalc').addEventListener('click', () => recalc(false));
    $('btnRecalcForce').addEventListener('click', () => recalc(true));
    $('btnSendAll').addEventListener('click', sendAll);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
    if (ok) await loadList();
  });
})();
