/* workspace-payroll.js — R37 본인 급여명세서 탭 (workspace-attendance.html에 임베드)
 *
 * - GET /api/payroll-my?year=  → SENT 상태 본인 명세서 일람
 * - GET /api/payroll-my-pdf?id=N → 본인 PDF 다운로드
 *
 * workspace-attendance.js 의 탭 전환 로직 (data-tab="payroll")이 자동으로
 * attPanelPayroll 패널을 활성화하면, 본 스크립트가 첫 클릭 시 init.
 */
(function () {
  'use strict';

  let _payrollInit = false;
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function won(n) {
    return Math.round(Number(n || 0)).toLocaleString('ko-KR');
  }
  function hours(m) {
    return (Number(m || 0) / 60).toFixed(1);
  }

  async function api(url) {
    const r = await fetch(url, { credentials: 'include' });
    let data;
    try { data = await r.json(); } catch (_) { data = {}; }
    return { ok: r.ok, status: r.status, data };
  }

  function initYearSelect() {
    const sel = $('payrollYear');
    if (!sel || sel.options.length > 0) return;
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const curY = kst.getUTCFullYear();
    for (let y = curY; y >= curY - 5; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y + '년';
      if (y === curY) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  async function loadMy() {
    const y = $('payrollYear').value;
    const box = $('payrollList');
    box.innerHTML = '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:13px">불러오는 중...</div>';

    const res = await api('/api/payroll-my?year=' + y);
    if (!res.ok) {
      box.innerHTML = '<div style="padding:30px;text-align:center;color:#dc2626;font-size:13px">' +
        esc(res.data?.error || ('HTTP ' + res.status)) + '</div>';
      return;
    }

    const d = res.data?.data || res.data;
    const rows = d?.rows || [];
    if (rows.length === 0) {
      box.innerHTML = '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:13px">' + esc(y) + '년 발송된 명세서가 없습니다.</div>';
      return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr style="background:#f9fafb">' +
      '<th style="padding:9px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">월</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">근무일</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">근무</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">야근</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">월기본급</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">성과</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">세전 총액</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">공제</th>' +
      '<th style="padding:9px 12px;text-align:right;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">실수령</th>' +
      '<th style="padding:9px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">발송일</th>' +
      '<th style="padding:9px 12px;text-align:center;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px">PDF</th>' +
      '</tr></thead><tbody>';
    for (const r of rows) {
      const sentDate = r.sentAt ? new Date(r.sentAt).toLocaleDateString('ko-KR') : '-';
      html += '<tr>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-weight:600">' + r.payYear + '년 ' + String(r.payMonth).padStart(2, '0') + '월</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right">' + (r.workingDays || 0) + '일</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right">' + hours(r.workingMins) + 'h</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right">' + hours(r.overtimeMins) + 'h</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right">' + won(r.baseSalaryMonth) + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right">' + won(r.performanceBonus) + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#3730a3">' + won(r.grossPay) + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#b91c1c">' + (Number(r.totalDeduction) > 0 ? '−' + won(r.totalDeduction) : '0') + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;color:#0f766e">' + won(r.netPay) + ' 원</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px">' + esc(sentDate) + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:center"><a href="/api/payroll-my-pdf?id=' + r.id + '" target="_blank" rel="noopener" style="padding:4px 10px;background:#6366f1;color:#fff;border-radius:4px;font-size:11.5px;text-decoration:none;font-weight:600">PDF</a></td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    box.innerHTML = html;
  }

  /* 탭 클릭 시 첫 진입 init */
  document.addEventListener('DOMContentLoaded', () => {
    const tabBtn = document.querySelector('.att-tab[data-tab="payroll"]');
    if (!tabBtn) return;
    tabBtn.addEventListener('click', () => {
      if (_payrollInit) return;
      _payrollInit = true;
      initYearSelect();
      const loadBtn = $('payrollLoadBtn');
      if (loadBtn) loadBtn.addEventListener('click', loadMy);
      loadMy();
    });
  });
})();
