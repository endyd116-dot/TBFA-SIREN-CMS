/* workspace-payroll.js — 본인 급여명세서 (workspace-attendance.html '급여명세서' 탭)
 *
 * 2026-07-11 고도화:
 *   - 명세서를 누르면 A4 서류 모양 모달이 열린다 (인쇄 가능)
 *   - 금액뿐 아니라 '어떻게 나온 금액인지(계산방법)'를 항목마다 보여준다 (법정 기재사항)
 *   - 수령 확인 + 이의 없음 동의를 전자서명으로 받는다 (손글씨 또는 성명 입력)
 *   - 서명하면 서명란이 찍힌 증빙본이 보관되고, 언제든 다시 내려받을 수 있다
 *   - 이의가 있으면 사유를 적어 제기할 수 있다
 *
 * API
 *   GET  /api/payroll-my?year=            목록 (수령확인 상태 포함)
 *   GET  /api/payroll-my-detail?id=N      상세 + 계산근거 + 서명 증적
 *   POST /api/payroll-my-ack              서명 제출 · 이의 제기
 *   GET  /api/payroll-my-pdf?id=N[&signed=1]  문서 내려받기
 */
(function () {
  'use strict';

  var _init = false;
  var _detail = null;          // 현재 열린 명세서 상세
  var _sigMode = 'DRAW';       // DRAW | TYPE
  var _sigDrawn = false;
  var _busy = false;

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function won(n) { return Math.round(Number(n || 0)).toLocaleString('ko-KR'); }
  function hoursOf(m) { return (Number(m || 0) / 60).toFixed(1); }
  function dt(d) {
    if (!d) return '-';
    try { return new Date(d).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return String(d); }
  }
  function dateOnly(d) {
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString('ko-KR'); } catch (e) { return String(d); }
  }
  function icon(name) {
    try { if (window.Icons && Icons.svg) return Icons.svg(name); } catch (e) {}
    return '';
  }
  function toast(msg, type) {
    try {
      if (window.toast) return window.toast(msg, type);
      if (window.showToast) return window.showToast(msg, type);
    } catch (e) {}
    alert(msg);
  }

  async function api(url, opts) {
    var o = opts || {};
    var init = { credentials: 'include', method: o.method || 'GET' };
    if (o.body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(o.body);
    }
    var r = await fetch(url, init);
    var data;
    try { data = await r.json(); } catch (e) { data = {}; }
    return { ok: r.ok, status: r.status, data: data };
  }

  /* ══════════════ 스타일 (모달·서류) ══════════════ */
  function injectStyle() {
    if ($('wpStyle')) return;
    var css = [
      '#wpOverlay{position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto}',
      '#wpSheet{background:#fff;width:100%;max-width:760px;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.3);position:relative}',
      '#wpClose{position:absolute;top:12px;right:12px;background:#f3f4f6;border:none;border-radius:6px;width:30px;height:30px;cursor:pointer;color:#6b7280;display:flex;align-items:center;justify-content:center}',
      '#wpClose:hover{background:#e5e7eb}',
      '.wp-doc{padding:36px 40px 28px}',
      '.wp-org{font-size:12px;color:#6b7280;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
      '.wp-title{font-size:26px;font-weight:800;color:#111827;margin:14px 0 2px;letter-spacing:-.5px}',
      '.wp-period{font-size:14px;color:#374151;font-weight:600}',
      '.wp-issued{font-size:11.5px;color:#9ca3af;text-align:right}',
      '.wp-rule{height:2px;background:#111827;margin:12px 0 18px;border:none}',
      '.wp-rule-thin{height:1px;background:#e5e7eb;margin:16px 0;border:none}',
      '.wp-who{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;font-size:13px;margin-bottom:6px}',
      '.wp-who b{color:#6b7280;font-weight:600;display:inline-block;min-width:52px}',
      '.wp-sec{font-size:13.5px;font-weight:700;color:#1e3a8a;margin:20px 0 10px;display:flex;align-items:center;gap:6px}',
      '.wp-sec.ded{color:#991b1b}',
      '.wp-att{display:grid;grid-template-columns:repeat(2,1fr);gap:7px 20px;font-size:12.5px}',
      '.wp-att div{display:flex;justify-content:space-between;padding:6px 10px;background:#f9fafb;border-radius:5px}',
      '.wp-att span:first-child{color:#6b7280}',
      '.wp-att span:last-child{font-weight:600;color:#111827}',
      '.wp-att .hint{display:block;font-size:10.5px;color:#9ca3af;font-weight:400;margin-top:1px}',
      '.wp-tbl{width:100%;border-collapse:collapse;font-size:13px}',
      '.wp-tbl th{text-align:left;font-size:11px;color:#9ca3af;font-weight:600;padding:0 0 6px;border-bottom:1px solid #e5e7eb}',
      '.wp-tbl th.r,.wp-tbl td.r{text-align:right}',
      '.wp-tbl td{padding:9px 0;border-bottom:1px solid #f3f4f6;vertical-align:top}',
      '.wp-tbl .lbl{font-weight:600;color:#111827;white-space:nowrap;padding-right:12px}',
      '.wp-tbl .mth{font-size:11.5px;color:#6b7280;line-height:1.5}',
      '.wp-tbl .amt{font-weight:600;white-space:nowrap;padding-left:12px;font-variant-numeric:tabular-nums}',
      '.wp-tbl .minus .lbl,.wp-tbl .minus .amt{color:#b91c1c}',
      '.wp-sum{display:flex;justify-content:space-between;align-items:center;padding:11px 0;font-size:14px;font-weight:700;border-top:2px solid #d1d5db;margin-top:2px}',
      '.wp-sum.gross{color:#1e3a8a}.wp-sum.ded{color:#991b1b}',
      '.wp-net{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;margin-top:18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px}',
      '.wp-net .l{font-size:14px;font-weight:700;color:#065f46}',
      '.wp-net .v{font-size:24px;font-weight:800;color:#047857;font-variant-numeric:tabular-nums}',
      '.wp-note{font-size:11px;color:#9ca3af;line-height:1.7;margin-top:14px}',
      /* 서명 영역 */
      '.wp-sign{margin-top:22px;border:1.5px solid #e5e7eb;border-radius:10px;padding:18px 20px;background:#fafafa}',
      '.wp-sign h4{margin:0 0 12px;font-size:14px;font-weight:700;color:#111827;display:flex;align-items:center;gap:6px}',
      '.wp-consent{display:block;font-size:13px;color:#374151;margin-bottom:8px;cursor:pointer;line-height:1.6}',
      '.wp-consent input{margin-right:8px;transform:translateY(1px)}',
      '.wp-tabs{display:flex;gap:6px;margin:14px 0 10px}',
      '.wp-tab{flex:0 0 auto;padding:7px 14px;font-size:12.5px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;color:#6b7280;font-weight:600}',
      '.wp-tab.on{background:#1e3a8a;color:#fff;border-color:#1e3a8a}',
      '#wpCanvasWrap{position:relative;background:#fff;border:1.5px dashed #cbd5e1;border-radius:8px;overflow:hidden}',
      '#wpCanvas{display:block;width:100%;height:150px;touch-action:none;cursor:crosshair}',
      '#wpCanvasHint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12.5px;color:#cbd5e1;pointer-events:none}',
      '.wp-sigrow{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}',
      '.wp-sigrow input[type=text]{flex:1;min-width:160px;padding:9px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit}',
      '.wp-btn{padding:10px 18px;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}',
      '.wp-btn.primary{background:#1e3a8a;color:#fff}.wp-btn.primary:hover{background:#1e40af}',
      '.wp-btn.primary:disabled{background:#9ca3af;cursor:not-allowed}',
      '.wp-btn.ghost{background:#fff;color:#6b7280;border:1px solid #d1d5db}.wp-btn.ghost:hover{background:#f9fafb}',
      '.wp-btn.warn{background:#fff;color:#b91c1c;border:1px solid #fecaca}.wp-btn.warn:hover{background:#fef2f2}',
      '.wp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
      '.wp-done{margin-top:22px;border:1.5px solid #a7f3d0;background:#f0fdf4;border-radius:10px;padding:18px 20px}',
      '.wp-done h4{margin:0 0 10px;font-size:14px;font-weight:700;color:#065f46;display:flex;align-items:center;gap:6px}',
      '.wp-done dl{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12.5px;margin:0}',
      '.wp-done dt{color:#6b7280}.wp-done dd{margin:0;color:#111827;font-weight:600}',
      '.wp-obj{margin-top:22px;border:1.5px solid #fde68a;background:#fffbeb;border-radius:10px;padding:18px 20px}',
      '.wp-obj h4{margin:0 0 8px;font-size:14px;font-weight:700;color:#92400e;display:flex;align-items:center;gap:6px}',
      '.wp-obj p{margin:0 0 6px;font-size:12.5px;color:#374151;line-height:1.6}',
      /* 목록 배지 */
      '.wp-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}',
      '.wp-badge.need{background:#fef3c7;color:#92400e}',
      '.wp-badge.ok{background:#d1fae5;color:#065f46}',
      '.wp-badge.obj{background:#fee2e2;color:#991b1b}',
      '.wp-row{cursor:pointer}.wp-row:hover{background:#f9fafb}',
      '.siren-icon{width:1em;height:1em;vertical-align:-2px}',
      /* 인쇄 — 서류만 남기고 서명 조작부는 숨김 */
      '@media print{',
      '  body>*{display:none!important}',
      '  #wpOverlay{display:block!important;position:static;background:#fff;padding:0;overflow:visible}',
      '  #wpSheet{box-shadow:none;max-width:none}',
      '  #wpClose,.wp-actions,.wp-tabs,#wpCanvasWrap,.wp-sigrow{display:none!important}',
      '}',
    ].join('');
    var el = document.createElement('style');
    el.id = 'wpStyle';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ══════════════ 목록 ══════════════ */
  function initYearSelect() {
    var sel = $('payrollYear');
    if (!sel || sel.options.length > 0) return;
    var kst = new Date(Date.now() + 9 * 3600 * 1000);
    var curY = kst.getUTCFullYear();
    for (var y = curY; y >= curY - 5; y--) {
      var opt = document.createElement('option');
      opt.value = y; opt.textContent = y + '년';
      if (y === curY) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function ackBadge(r) {
    if (r.ackStatus === 'ACKNOWLEDGED') return '<span class="wp-badge ok">서명 완료</span>';
    if (r.ackStatus === 'OBJECTED') return '<span class="wp-badge obj">이의 제기</span>';
    return '<span class="wp-badge need">서명 필요</span>';
  }

  function syncAnnualLink() {
    var a = $('payrollAnnualBtn');
    if (a) a.href = '/api/payroll-my-annual?year=' + $('payrollYear').value + '&pdf=1';
  }

  async function loadMy() {
    var y = $('payrollYear').value;
    var box = $('payrollList');
    syncAnnualLink();
    box.innerHTML = '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:13px">불러오는 중...</div>';

    var res = await api('/api/payroll-my?year=' + y);
    if (!res.ok) {
      box.innerHTML = '<div style="padding:30px;text-align:center;color:#dc2626;font-size:13px">' +
        esc((res.data && res.data.error) || ('HTTP ' + res.status)) + '</div>';
      return;
    }
    var d = (res.data && res.data.data) || res.data || {};
    var rows = d.rows || [];
    if (rows.length === 0) {
      box.innerHTML = '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:13px">' +
        esc(y) + '년 교부된 명세서가 없습니다.</div>';
      return;
    }

    var pending = d.pendingAck || 0;
    var head = pending > 0
      ? '<div style="padding:10px 14px;margin-bottom:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;font-size:12.5px;color:#92400e;font-weight:600">' +
        icon('alert-triangle') + ' 수령 확인이 필요한 명세서가 ' + pending + '건 있습니다. 명세서를 눌러 내용을 확인하고 서명해 주세요.</div>'
      : '';

    var th = function (t, align) {
      return '<th style="padding:9px 12px;text-align:' + (align || 'left') +
        ';border-bottom:1px solid #e5e7eb;font-weight:600;font-size:12px;color:#6b7280">' + t + '</th>';
    };
    var html = head + '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr style="background:#f9fafb">' +
      th('월') + th('근무일', 'right') + th('세전 총액', 'right') + th('공제', 'right') +
      th('실수령', 'right') + th('교부일') + th('수령확인', 'center') + th('문서', 'center') +
      '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var td = 'padding:9px 12px;border-bottom:1px solid #f3f4f6';
      var docBtns = '<a href="/api/payroll-my-pdf?id=' + r.id + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" ' +
        'style="padding:4px 9px;background:#eef2ff;color:#3730a3;border-radius:4px;font-size:11px;text-decoration:none;font-weight:700">PDF</a>';
      if (r.hasSignedDocument) {
        docBtns += ' <a href="/api/payroll-my-pdf?id=' + r.id + '&signed=1" target="_blank" rel="noopener" onclick="event.stopPropagation()" ' +
          'style="padding:4px 9px;background:#d1fae5;color:#065f46;border-radius:4px;font-size:11px;text-decoration:none;font-weight:700">서명본</a>';
      }
      html += '<tr class="wp-row" data-id="' + r.id + '">' +
        '<td style="' + td + ';font-weight:700">' + r.payYear + '년 ' + String(r.payMonth).padStart(2, '0') + '월</td>' +
        '<td style="' + td + ';text-align:right">' + (r.workingDays || 0) + '일</td>' +
        '<td style="' + td + ';text-align:right;font-weight:600;color:#3730a3">' + won(r.grossPay) + '</td>' +
        '<td style="' + td + ';text-align:right;color:#b91c1c">' + (Number(r.totalDeduction) > 0 ? '−' + won(r.totalDeduction) : '0') + '</td>' +
        '<td style="' + td + ';text-align:right;font-weight:700;color:#0f766e">' + won(r.netPay) + ' 원</td>' +
        '<td style="' + td + ';color:#6b7280;font-size:12px">' + esc(dateOnly(r.issuedAt || r.sentAt)) + '</td>' +
        '<td style="' + td + ';text-align:center">' + ackBadge(r) + '</td>' +
        '<td style="' + td + ';text-align:center;white-space:nowrap">' + docBtns + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    box.innerHTML = html;

    var trs = box.querySelectorAll('.wp-row');
    for (var k = 0; k < trs.length; k++) {
      trs[k].addEventListener('click', function () { openDetail(Number(this.getAttribute('data-id'))); });
    }
  }

  /* ══════════════ 상세 서류 모달 ══════════════ */
  async function openDetail(id) {
    injectStyle();
    closeDetail();

    var ov = document.createElement('div');
    ov.id = 'wpOverlay';
    ov.innerHTML = '<div id="wpSheet"><div class="wp-doc" style="padding:60px;text-align:center;color:#9ca3af">불러오는 중...</div></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeDetail(); });
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';

    var res = await api('/api/payroll-my-detail?id=' + id);
    if (!res.ok) {
      $('wpSheet').innerHTML = '<div class="wp-doc" style="text-align:center;color:#dc2626">' +
        esc((res.data && (res.data.error || res.data.detail)) || ('HTTP ' + res.status)) +
        '</div><div class="wp-actions" style="padding:0 40px 24px"><button class="wp-btn ghost" onclick="wpClose()">닫기</button></div>';
      return;
    }
    _detail = (res.data && res.data.data) || res.data;
    renderDoc();
  }

  function renderDoc() {
    var d = _detail;
    var slip = d.slip, org = d.org, mem = d.member, bd = d.breakdown;

    var attHtml = bd.attendance.map(function (a) {
      return '<div><span>' + esc(a.label) + (a.hint ? '<span class="hint">' + esc(a.hint) + '</span>' : '') +
        '</span><span>' + esc(a.value) + '</span></div>';
    }).join('');

    var rowHtml = function (r) {
      var minus = r.kind === 'DEDUCT';
      return '<tr' + (minus ? ' class="minus"' : '') + '>' +
        '<td class="lbl">' + (minus ? '−' : '+') + ' ' + esc(r.label) + '</td>' +
        '<td class="mth">' + esc(r.method) + '</td>' +
        '<td class="amt r">' + won(r.amount) + '</td></tr>';
    };

    var earnHtml = bd.earnings.map(rowHtml).join('');
    var dedHtml = bd.deductions.map(function (r) {
      return '<tr class="minus"><td class="lbl">− ' + esc(r.label) + '</td>' +
        '<td class="mth">' + esc(r.method) + '</td>' +
        '<td class="amt r">' + won(r.amount) + '</td></tr>';
    }).join('');

    var verTag = slip.documentVersion > 1
      ? ' <span style="font-size:12px;color:#b91c1c;font-weight:700">정정 ' + slip.documentVersion + '차</span>' : '';

    var html =
      '<button id="wpClose" type="button" aria-label="닫기">' + (icon('x') || '✕') + '</button>' +
      '<div class="wp-doc">' +
        '<div class="wp-org">' +
          '<div><b style="color:#374151;font-size:13px">' + esc(org.name) + '</b>' +
            (org.regNo ? '<br>사업자번호 ' + esc(org.regNo) : '') +
            (org.representative ? ' · 대표 ' + esc(org.representative) : '') +
          '</div>' +
          '<div class="wp-issued">교부일<br><b style="color:#4b5563">' + esc(dt(slip.issuedAt)) + '</b></div>' +
        '</div>' +
        '<div class="wp-title">급여명세서' + verTag + '</div>' +
        '<div class="wp-period">' + slip.payYear + '년 ' + String(slip.payMonth).padStart(2, '0') + '월</div>' +
        '<hr class="wp-rule">' +

        '<div class="wp-who">' +
          '<div><b>성명</b> ' + esc(mem.name) + '</div>' +
          '<div><b>직책</b> ' + esc(mem.role || '-') + '</div>' +
          '<div><b>사번</b> ' + esc(String(mem.id)) + '</div>' +
          '<div><b>지급일</b> ' + esc(slip.paidAt ? dateOnly(slip.paidAt) : '지급 예정') + '</div>' +
        '</div>' +

        '<div class="wp-sec">' + icon('calendar') + ' 근태 집계</div>' +
        '<div class="wp-att">' + attHtml + '</div>' +

        '<div class="wp-sec">' + icon('plus') + ' 지급 항목</div>' +
        '<table class="wp-tbl"><thead><tr><th>항목</th><th>계산방법</th><th class="r">금액</th></tr></thead>' +
        '<tbody>' + earnHtml + '</tbody></table>' +
        '<div class="wp-sum gross"><span>세전 총액</span><span>' + won(bd.grossPay) + ' 원</span></div>' +

        '<div class="wp-sec ded">' + icon('minus') + ' 공제 항목</div>' +
        '<table class="wp-tbl"><thead><tr><th>항목</th><th>계산방법</th><th class="r">금액</th></tr></thead>' +
        '<tbody>' + dedHtml + '</tbody></table>' +
        '<div class="wp-sum ded"><span>공제 합계</span><span>' + won(bd.totalDeduction) + ' 원</span></div>' +

        '<div class="wp-net"><span class="l">실수령액</span><span class="v">' + won(bd.netPay) + ' 원</span></div>' +

        '<div class="wp-note">' +
          '※ 실수령액 = 세전 총액 − 공제 합계.<br>' +
          '※ 위 계산방법은 협의회 급여 기준 설정값을 그대로 적용한 것입니다.' +
          (bd.basis.calculatedAt ? '<br>※ 산출 기준 시각: ' + esc(dt(bd.basis.calculatedAt)) : '') +
          (slip.documentSha256 ? '<br>※ 문서 지문: ' + esc(String(slip.documentSha256).slice(0, 16)) + '…' : '') +
        '</div>' +

        signBlock() +

        '<div class="wp-actions">' +
          '<button class="wp-btn ghost" onclick="window.print()">' + icon('printer') + ' 인쇄</button>' +
          '<a class="wp-btn ghost" href="/api/payroll-my-pdf?id=' + slip.id + '" target="_blank" rel="noopener">' + icon('download') + ' PDF</a>' +
          (slip.hasSignedDocument
            ? '<a class="wp-btn ghost" href="/api/payroll-my-pdf?id=' + slip.id + '&signed=1" target="_blank" rel="noopener">' + icon('file-check') + ' 서명본</a>'
            : '') +
          '<button class="wp-btn ghost" onclick="wpClose()">닫기</button>' +
        '</div>' +
      '</div>';

    $('wpSheet').innerHTML = html;
    $('wpClose').addEventListener('click', closeDetail);

    if (slip.ackStatus === 'PENDING') bindSignUI();
  }

  /* 서명 영역 — 상태별로 다르게 */
  function signBlock() {
    var d = _detail, slip = d.slip;

    if (slip.ackStatus === 'ACKNOWLEDGED' && d.signature) {
      var s = d.signature;
      var items = (s.consentItems || []).map(function (c) {
        return '<div style="font-size:12.5px;color:#065f46;margin-bottom:3px">' +
          (c.agreed ? '☑' : '☐') + ' ' + esc(c.text) + '</div>';
      }).join('');
      return '<div class="wp-done">' +
        '<h4>' + icon('file-check') + ' 수령 확인 완료</h4>' +
        items +
        '<dl style="margin-top:10px">' +
          '<dt>서명자</dt><dd>' + esc(s.signedName) + '</dd>' +
          '<dt>서명일시</dt><dd>' + esc(dt(s.signedAt)) + '</dd>' +
          '<dt>서명방식</dt><dd>' + (s.signatureType === 'DRAW' ? '손글씨 서명' : '성명 입력') + '</dd>' +
        '</dl>' +
        '<div style="font-size:11px;color:#6b7280;margin-top:10px;line-height:1.6">' +
          '본 서명은 전자문서 및 전자거래 기본법에 따른 전자적 의사표시로, 서면 서명과 동일한 효력을 가집니다.' +
        '</div></div>';
    }

    if (slip.ackStatus === 'OBJECTED' && d.objection) {
      var o = d.objection;
      var stLabel = { OPEN: '접수됨', IN_REVIEW: '검토 중', RESOLVED: '처리 완료', REJECTED: '반려됨' }[o.status] || o.status;
      return '<div class="wp-obj">' +
        '<h4>' + icon('alert-triangle') + ' 이의 제기 — ' + esc(stLabel) + '</h4>' +
        '<p><b>제기 내용</b><br>' + esc(o.reason) + '</p>' +
        '<p style="color:#9ca3af;font-size:11.5px">' + esc(dt(o.createdAt)) + '</p>' +
        (o.resolutionNote
          ? '<p style="margin-top:10px;padding-top:10px;border-top:1px solid #fde68a"><b>담당자 회신</b><br>' +
            esc(o.resolutionNote) + '</p><p style="color:#9ca3af;font-size:11.5px">' + esc(dt(o.resolvedAt)) + '</p>'
          : '<p style="color:#92400e;font-size:12px;margin-top:8px">담당자가 확인 중입니다. 처리되면 알려드립니다.</p>') +
        '</div>';
    }

    /* 미서명 — 서명 UI */
    return '<div class="wp-sign">' +
      '<h4>' + icon('pen-tool') + ' 수령 확인 및 이의 없음 동의</h4>' +
      '<label class="wp-consent"><input type="checkbox" id="wpC1"> 위 급여명세 내용을 확인하였습니다.</label>' +
      '<label class="wp-consent"><input type="checkbox" id="wpC2"> 기재된 내용에 이의가 없음에 동의합니다.</label>' +
      '<div class="wp-tabs">' +
        '<button type="button" class="wp-tab on" id="wpTabDraw">손글씨 서명</button>' +
        '<button type="button" class="wp-tab" id="wpTabType">성명 입력</button>' +
      '</div>' +
      '<div id="wpCanvasWrap">' +
        '<canvas id="wpCanvas"></canvas>' +
        '<div id="wpCanvasHint">이 칸에 서명해 주세요 (마우스 또는 손가락)</div>' +
      '</div>' +
      '<div class="wp-sigrow">' +
        '<input type="text" id="wpName" placeholder="성명" maxlength="80">' +
        '<button type="button" class="wp-btn ghost" id="wpClear">지우기</button>' +
      '</div>' +
      '<div class="wp-actions">' +
        '<button type="button" class="wp-btn warn" id="wpObject">' + icon('alert-triangle') + ' 이의 제기</button>' +
        '<button type="button" class="wp-btn primary" id="wpSubmit" disabled>' + icon('check') + ' 동의하고 서명 제출</button>' +
      '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:10px;line-height:1.6">' +
        '서명하면 서명란이 찍힌 증빙본이 보관되며, 언제든 다시 내려받을 수 있습니다.<br>' +
        '내용이 사실과 다르면 서명 대신 [이의 제기]를 눌러 주세요.' +
      '</div></div>';
  }

  /* ══════════════ 서명 캔버스 ══════════════ */
  function bindSignUI() {
    var cv = $('wpCanvas');
    var hint = $('wpCanvasHint');
    var nameInput = $('wpName');
    _sigMode = 'DRAW';
    _sigDrawn = false;

    if (_detail && _detail.member && _detail.member.name) nameInput.value = _detail.member.name;

    /* 캔버스 해상도 — 화면 배율 반영 (안 하면 서명이 흐릿하게 저장됨) */
    function sizeCanvas() {
      var rect = cv.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    }
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    var drawing = false;
    var ctx = cv.getContext('2d');

    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (_sigMode !== 'DRAW') return;
      drawing = true;
      cv.setPointerCapture(e.pointerId);
      var p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!_sigDrawn) { _sigDrawn = true; hint.style.display = 'none'; }
      refreshSubmit();
      e.preventDefault();
    });
    var stop = function () { drawing = false; };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointerleave', stop);
    cv.addEventListener('pointercancel', stop);

    $('wpClear').addEventListener('click', function () {
      ctx.clearRect(0, 0, cv.width, cv.height);
      _sigDrawn = false;
      hint.style.display = 'flex';
      refreshSubmit();
    });

    $('wpTabDraw').addEventListener('click', function () {
      _sigMode = 'DRAW';
      this.classList.add('on');
      $('wpTabType').classList.remove('on');
      $('wpCanvasWrap').style.display = 'block';
      refreshSubmit();
    });
    $('wpTabType').addEventListener('click', function () {
      _sigMode = 'TYPE';
      this.classList.add('on');
      $('wpTabDraw').classList.remove('on');
      $('wpCanvasWrap').style.display = 'none';
      nameInput.focus();
      refreshSubmit();
    });

    $('wpC1').addEventListener('change', refreshSubmit);
    $('wpC2').addEventListener('change', refreshSubmit);
    nameInput.addEventListener('input', refreshSubmit);
    $('wpSubmit').addEventListener('click', submitSignature);
    $('wpObject').addEventListener('click', submitObjection);
    refreshSubmit();
  }

  /* 동의 2개 + (손글씨면 서명 그림) + 성명 — 전부 충족해야 제출 가능 */
  function refreshSubmit() {
    var btn = $('wpSubmit');
    if (!btn) return;
    var ok = $('wpC1').checked && $('wpC2').checked && $('wpName').value.trim().length > 0;
    if (_sigMode === 'DRAW' && !_sigDrawn) ok = false;
    btn.disabled = !ok || _busy;
  }

  async function submitSignature() {
    if (_busy) return;
    var slip = _detail.slip;
    var name = $('wpName').value.trim();
    var consentItems = [
      { key: 'read',   text: '위 급여명세 내용을 확인하였습니다.',        agreed: $('wpC1').checked },
      { key: 'noobj',  text: '기재된 내용에 이의가 없음에 동의합니다.',  agreed: $('wpC2').checked },
    ];
    if (!consentItems.every(function (c) { return c.agreed; })) {
      toast('동의 항목에 모두 체크해 주세요'); return;
    }

    var body = {
      id: slip.id,
      action: 'acknowledge',
      signatureType: _sigMode,
      signedName: name,
      consentItems: consentItems,
    };
    if (_sigMode === 'DRAW') {
      if (!_sigDrawn) { toast('서명을 그려 주세요'); return; }
      try { body.signatureDataUrl = $('wpCanvas').toDataURL('image/png'); }
      catch (e) { toast('서명 이미지를 만들지 못했습니다. 성명 입력 방식을 이용해 주세요'); return; }
    }

    if (!confirm(slip.payYear + '년 ' + slip.payMonth + '월 급여명세서에 전자서명합니다.\n\n' +
      '· 내용을 확인했고 이의가 없다는 동의로 기록됩니다\n' +
      '· 서명 후에는 취소할 수 없습니다 (내용이 틀렸다면 [이의 제기]를 이용하세요)\n\n계속할까요?')) return;

    _busy = true;
    var btn = $('wpSubmit');
    btn.disabled = true;
    btn.textContent = '제출 중...';
    try {
      var res = await api('/api/payroll-my-ack', { method: 'POST', body: body });
      if (!res.ok) {
        toast('서명 실패: ' + ((res.data && (res.data.error || res.data.detail)) || ('HTTP ' + res.status)), 'err');
        return;
      }
      toast('수령 확인이 완료되었습니다. 서명본이 보관되었습니다.', 'ok');
      await openDetail(slip.id);     // 서명 완료 상태로 다시 렌더
      loadMy();
    } finally {
      _busy = false;
      var b = $('wpSubmit');
      if (b) { b.disabled = false; b.textContent = '동의하고 서명 제출'; }
    }
  }

  async function submitObjection() {
    var slip = _detail.slip;
    var reason = prompt('어떤 부분이 사실과 다른지 구체적으로 적어 주세요.\n(예: 6월 3일 출근했는데 결근으로 되어 있습니다)', '');
    if (reason == null) return;
    reason = String(reason).trim();
    if (!reason) { toast('이의 내용을 입력해 주세요'); return; }

    var res = await api('/api/payroll-my-ack', {
      method: 'POST',
      body: { id: slip.id, action: 'object', reason: reason },
    });
    if (!res.ok) {
      toast('이의 제기 실패: ' + ((res.data && (res.data.error || res.data.detail)) || ('HTTP ' + res.status)), 'err');
      return;
    }
    toast('이의가 접수되었습니다. 담당자가 확인 후 회신드립니다.', 'ok');
    await openDetail(slip.id);
    loadMy();
  }

  function closeDetail() {
    var ov = $('wpOverlay');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    _detail = null;
  }
  window.wpClose = closeDetail;

  /* ══════════════ 진입 ══════════════ */
  function boot() {
    if (_init) return;
    _init = true;
    injectStyle();
    initYearSelect();
    syncAnnualLink();
    var loadBtn = $('payrollLoadBtn');
    if (loadBtn) loadBtn.addEventListener('click', loadMy);
    var sel = $('payrollYear');
    if (sel) sel.addEventListener('change', syncAnnualLink);
    loadMy();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var tabBtn = document.querySelector('.att-tab[data-tab="payroll"]');
    if (tabBtn) tabBtn.addEventListener('click', boot);

    /* 알림에서 바로 열기 — /workspace-attendance.html#payroll-slip=123 */
    var m = /#payroll-slip=(\d+)/.exec(location.hash || '');
    if (m && tabBtn) {
      tabBtn.click();
      boot();
      setTimeout(function () { openDetail(Number(m[1])); }, 400);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('wpOverlay')) closeDetail();
  });
})();
