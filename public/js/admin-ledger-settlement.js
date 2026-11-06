/* admin-ledger-settlement.js — 재정 관리 › 장부 › 결산 (2026-11-06)
 * 점검표 / 재무상태표 / 운영성과표 / 주석 / 수지결산서 / 사업실적서 / 재산목록 / 다음 해 계획·예산 / 확정·승인 / 공익법인
 * 설계: docs/active/2026-11-06-ledger-settlement-design.md
 * window.SIREN_SETTLEMENT = { render }
 */
(function () {
  'use strict';

  let root = null;
  let role = 'admin';
  let masters = { accounts: [], programs: [], funds: [], fiscalYears: [] };
  let year = null;
  let data = null;
  let tab = 'checks';

  const TABS = [
    ['checks', '점검표'], ['balance', '재무상태표'], ['operating', '운영성과표'], ['notes', '주석'],
    ['settlement', '수지결산서'], ['programs', '사업실적서'], ['property', '재산목록'],
    ['next', '다음 해 계획·예산'], ['approval', '확정·승인'], ['public', '공익법인'],
  ];
  const STATE_LABEL = { ok: '통과', warn: '확인 권장', block: '해결 필요' };
  const STATE_COLOR = { ok: 'var(--success)', warn: '#b45309', block: 'var(--danger)' };
  const FN_LABEL = { service: '사업수행', admin: '일반관리', fundraising: '모금' };

  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const json = await r.json().catch(() => null);
      return { ok: r.ok && json && json.ok !== false, status: r.status, data: json, error: json?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  const dataOf = res => res.data?.data || res.data || {};
  const failText = res => [res.data?.error || res.error || '요청 실패', ...(res.data?.missing || []), res.data?.detail || ''].filter(Boolean).join('\n');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const won = n => Number(n || 0).toLocaleString('ko-KR');
  /* 음수는 괄호, 0은 줄표. 재무제표 관례 */
  const amt = n => { const v = Number(n || 0); return v === 0 ? '-' : v < 0 ? `(${won(-v)})` : won(v); };
  const qs = sel => root.querySelector(sel);
  const canManage = () => role === 'super_admin' || role === 'admin';
  const isChair = () => role === 'super_admin';
  const editable = () => data && !data.frozen && data.settlement.status === 'draft' && canManage();
  const koDate = d => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${y}년 ${Number(m)}월 ${Number(day)}일`; };

  /* ── 문서 표 ── */
  function statementTable(doc) {
    const rows = doc.rows || [];
    const hasPrev = rows.some(r => r.previous);
    const cells = a => a ? `<td class="num">${amt(a.total)}</td><td class="num">${amt(a.public)}</td><td class="num">${amt(a.other)}</td>`
      : '<td></td><td></td><td></td>';
    return `<table class="ls-table">
      <thead>
        <tr><th rowspan="2">과목</th><th colspan="3">당기</th>${hasPrev ? '<th colspan="3">전기</th>' : ''}</tr>
        <tr><th>통합</th><th>공익목적사업</th><th>기타사업</th>${hasPrev ? '<th>통합</th><th>공익목적사업</th><th>기타사업</th>' : ''}</tr>
      </thead>
      <tbody>${rows.map(r => {
        const bold = r.type === 'total' || r.type === 'head' || r.type === 'subtotal' ? 'font-weight:600;' : '';
        const line = r.type === 'total' ? 'background:var(--ls-total,#f5f3f0);' : '';
        const head = r.type === 'head';
        return `<tr style="${line}">
          <td style="padding-left:${8 + r.level * 14}px;${bold}">${esc(r.label)}${r.warning ? ` <span style="color:var(--danger);font-size:11px;font-weight:400">${esc(r.warning)}</span>` : ''}</td>
          ${head ? `<td colspan="${hasPrev ? 6 : 3}"></td>` : cells(r.current) + (hasPrev ? cells(r.previous) : '')}
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function natureTable(p) {
    return `<table class="ls-table"><thead><tr><th>구분</th><th>분배비용</th><th>인력비용</th><th>시설비용</th><th>기타비용</th><th>합계</th></tr></thead>
      <tbody>${p.nature.rows.map(r => `<tr>
        <td style="padding-left:${8 + r.level * 14}px;${r.level === 0 ? 'font-weight:600' : ''}">${esc(r.label)}</td>
        <td class="num">${amt(r.distribution)}</td><td class="num">${amt(r.personnel)}</td>
        <td class="num">${amt(r.facility)}</td><td class="num">${amt(r.other)}</td><td class="num">${amt(r.total)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  function netAssetTable(p) {
    return `<table class="ls-table"><thead><tr><th>구분</th><th>기본순자산</th><th>보통순자산</th><th>순자산조정</th><th>합계</th></tr></thead>
      <tbody>${p.netAssets.rows.map(r => `<tr>
        <td>${esc(r.label)}</td><td class="num">${amt(r.basic)}</td><td class="num">${amt(r.ordinary)}</td>
        <td class="num">${amt(r.adjustment)}</td><td class="num">${amt(r.total)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  function fundTable(p) {
    return `<table class="ls-table"><thead><tr><th>재원</th><th>사용 제한</th><th>기초</th><th>수입</th><th>지출</th><th>기말</th></tr></thead>
      <tbody>${p.funds.map(f => `<tr>
        <td>${esc(f.name)}</td><td>${f.restricted ? '있음' : '없음'}</td><td class="num">${amt(f.opening)}</td>
        <td class="num">${amt(f.income)}</td><td class="num">${amt(f.spent)}</td><td class="num">${amt(f.closing)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  function majorTable(p) {
    if (!p.major.rows.length) return '';
    return `<table class="ls-table"><thead><tr><th>거래처</th><th>계정과목</th><th>건수</th><th>금액</th></tr></thead>
      <tbody>${p.major.rows.map(r => `<tr><td>${esc(r.payeeName)}</td><td>${esc(r.accountName)}</td><td class="num">${r.count}</td><td class="num">${amt(r.amount)}</td></tr>`).join('')}</tbody></table>`;
  }
  function ruleTable(p) {
    if (!(p.rules || []).length) return '';
    const program = id => masters.programs.find(x => x.id === Number(id))?.name || '';
    return `<table class="ls-table"><thead><tr><th>규칙</th><th>기준</th><th>배분</th></tr></thead>
      <tbody>${p.rules.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.basis)}</td><td>${(r.lines || []).map(l =>
        `${esc(FN_LABEL[l.functionCode] || '')}${l.programId ? ` ${esc(program(l.programId))}` : ''} ${esc(l.ratio)}%`).join(', ')}</td></tr>`).join('')}</tbody></table>`;
  }
  const NOTE_TABLES = { nature: natureTable, netAssets: netAssetTable, funds: fundTable, major: majorTable, rules: ruleTable };

  function settlementTables(p) {
    const s = p.settlement;
    const rowHtml = r => `<tr>
      <td style="padding-left:${8 + (r.level || 0) * 14}px;${(r.level || 0) === 0 ? 'font-weight:600' : ''}">${esc(r.label)}</td>
      <td class="num">${amt(r.planned)}</td><td class="num">${amt(r.actual)}</td><td class="num">${amt(r.difference)}</td>
      <td class="num">${r.rate == null ? '-' : r.rate + '%'}</td>
    </tr>`;
    const carryRow = (label, value) => `<tr><td style="padding-left:8px;font-weight:600">${esc(label)}</td><td></td><td class="num">${amt(value)}</td><td></td><td></td></tr>`;
    const head = '<thead><tr><th>과목</th><th>예산액</th><th>결산액</th><th>증감</th><th>집행률</th></tr></thead>';
    return `
      ${s.plan ? '' : `<div class="ls-note">${p.year}년 예산안이 없어 예산액은 비어 있습니다.</div>`}
      <div class="ls-sub">수입</div>
      <table class="ls-table">${head}<tbody>
        ${carryRow('전기이월금', s.carryIn)}
        ${s.revenueRows.map(rowHtml).join('')}
        ${s.otherChange > 0 ? carryRow('기타 자금 증가', s.otherChange) : ''}
        <tr style="background:#f5f3f0"><td style="padding-left:8px;font-weight:600">합계</td><td class="num">${amt(s.revenueTotal.planned)}</td><td class="num" style="font-weight:600">${amt(s.incomeSide)}</td><td></td><td></td></tr>
      </tbody></table>
      <div class="ls-sub">지출</div>
      <table class="ls-table">${head}<tbody>
        ${s.expenseRows.map(rowHtml).join('')}
        ${s.otherChange < 0 ? carryRow('기타 자금 감소', -s.otherChange) : ''}
        ${carryRow('차기이월금', s.carryOut)}
        <tr style="background:#f5f3f0"><td style="padding-left:8px;font-weight:600">합계</td><td class="num">${amt(s.expenseTotal.planned)}</td><td class="num" style="font-weight:600">${amt(s.outflowSide)}</td><td></td><td></td></tr>
      </tbody></table>
      <div class="ls-note">장부는 발생주의입니다. 미수금, 미지급금, 감가상각처럼 수입·지출과 현금 증감이 다른 금액은 «기타 자금» 행에 표시합니다.</div>`;
  }

  function programResultTable(p, forPrint) {
    const list = p.programs.filter(x => !forPrint || x.actual > 0 || x.resultBody || x.events != null || x.beneficiaries != null);
    return `<table class="ls-table"><thead><tr><th>사업</th><th>정관 근거</th><th>실적</th><th>횟수</th><th>인원</th><th>예산</th><th>집행</th>${forPrint ? '' : '<th></th>'}</tr></thead>
      <tbody>${list.map(x => `<tr>
        <td>${esc(x.name)}</td><td>${esc(x.charterRef || '없음')}</td>
        <td style="white-space:pre-wrap">${esc(x.resultBody) || (x.actual > 0 ? '<span style="color:var(--danger)">작성 필요</span>' : '')}</td>
        <td class="num">${x.events ?? ''}</td><td class="num">${x.beneficiaries ?? ''}</td>
        <td class="num">${amt(x.planned)}</td><td class="num">${amt(x.actual)}</td>
        ${forPrint ? '' : `<td style="text-align:right">${editable() ? `<button class="btn-sm btn-sm-ghost" type="button" data-act="edit-result" data-id="${x.id}">작성</button>` : ''}</td>`}
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-3)">사업이 없습니다.</td></tr>'}</tbody></table>`;
  }

  function propertyTables(p, forPrint) {
    const pr = p.property;
    const group = (cls, label) => {
      const items = pr.items.filter(i => i.propertyClass === cls);
      return `<div class="ls-sub">${label}</div>
      <table class="ls-table"><thead><tr><th>재산명</th><th>내역</th><th>수량</th><th>금액</th><th>비고</th>${forPrint ? '' : '<th></th>'}</tr></thead>
      <tbody>${items.map(i => `<tr>
        <td>${esc(i.name)}</td><td>${esc(i.detail || '')}</td><td>${esc(i.quantity || '')}</td>
        <td class="num">${amt(i.amount)}</td><td>${esc(i.note || '')}</td>
        ${forPrint ? '' : `<td style="text-align:right;white-space:nowrap">${editable() ? `<button class="btn-sm btn-sm-ghost" type="button" data-act="edit-property" data-id="${i.id}">수정</button> <button class="btn-sm btn-sm-ghost" type="button" data-act="del-property" data-id="${i.id}">삭제</button>` : ''}</td>`}
      </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text-3)">없습니다.</td></tr>`}</tbody></table>`;
    };
    const liabilities = p.balance.totals.liabilities.total;
    const assets = pr.basicTotal + pr.ordinaryTotal;
    return `${group('basic', '기본재산')}${group('ordinary', '보통재산')}
      <table class="ls-table" style="margin-top:12px"><tbody>
        <tr><td>자산 합계</td><td class="num">${amt(assets)}</td></tr>
        <tr><td>부채 합계</td><td class="num">${amt(liabilities)}</td></tr>
        <tr style="background:#f5f3f0"><td style="font-weight:600">순재산</td><td class="num" style="font-weight:600">${amt(assets - liabilities)}</td></tr>
      </tbody></table>`;
  }

  function programPlanTable(p, forPrint) {
    const list = p.next.programs.filter(x => !forPrint || x.planBody || x.planTarget || x.planned > 0);
    return `<table class="ls-table"><thead><tr><th>사업</th><th>목표</th><th>시기</th><th>내용</th><th>예산</th>${forPrint ? '' : '<th></th>'}</tr></thead>
      <tbody>${list.map(x => `<tr>
        <td>${esc(x.name)}</td><td>${esc(x.planTarget)}</td><td>${esc(x.planPeriod)}</td>
        <td style="white-space:pre-wrap">${esc(x.planBody)}</td><td class="num">${amt(x.planned)}</td>
        ${forPrint ? '' : `<td style="text-align:right">${canManage() ? `<button class="btn-sm btn-sm-ghost" type="button" data-act="edit-plan" data-id="${x.id}">작성</button>` : ''}</td>`}
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-3)">작성한 사업계획이 없습니다.</td></tr>'}</tbody></table>`;
  }

  function budgetTables(p) {
    const b = p.next.budget;
    if (!b) return `<div class="ls-note">${p.next.year}년 예산안이 없습니다. 재정 관리 › 예산 관리에서 작성해 주세요.</div>`;
    const status = { draft: '작성중', submitted: '상신됨', approved: '승인됨', rejected: '반려됨' }[b.status] || b.status;
    return `
      <div class="ls-note">예산안 상태: ${esc(status)}</div>
      <div class="ls-sub">수입</div>
      <table class="ls-table"><thead><tr><th>과목</th><th>재원</th><th>예산액</th></tr></thead><tbody>
        <tr><td style="font-weight:600">전기이월금</td><td></td><td class="num">${amt(b.carryIn)}</td></tr>
        ${b.revenueRows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.fundName || '')}</td><td class="num">${amt(r.planned)}</td></tr>`).join('')}
        <tr style="background:#f5f3f0"><td style="font-weight:600">합계</td><td></td><td class="num" style="font-weight:600">${amt(b.carryIn + b.revenueTotal)}</td></tr>
      </tbody></table>
      <div class="ls-sub">지출</div>
      <table class="ls-table"><thead><tr><th>과목</th><th>예산액</th></tr></thead><tbody>
        ${b.expenseRows.map(r => `<tr><td style="padding-left:${8 + r.level * 14}px;${r.level === 0 ? 'font-weight:600' : ''}">${esc(r.label)}</td><td class="num">${amt(r.planned)}</td></tr>`).join('')}
        <tr><td style="font-weight:600">차기이월금</td><td class="num">${amt(b.carryOut)}</td></tr>
        <tr style="background:#f5f3f0"><td style="font-weight:600">합계</td><td class="num" style="font-weight:600">${amt(b.expenseTotal + b.carryOut)}</td></tr>
      </tbody></table>`;
  }

  /* ── 인쇄 묶음 ── */
  const periodText = p => `${koDate(p.period.from)}부터 ${koDate(p.period.to)}까지`;
  function printSections(p) {
    return {
      balance: { title: '재무상태표', sub: `${koDate(p.period.to)} 현재`, html: statementTable(p.balance) },
      operating: { title: '운영성과표', sub: periodText(p), html: statementTable(p.operating) },
      notes: {
        title: '주석', sub: periodText(p),
        html: p.notes.map(n => `<div class="ls-note-block"><div class="ls-note-title">주석 ${n.no}. ${esc(n.title)}</div>
          <div style="white-space:pre-wrap">${esc(n.body)}</div>${n.table ? NOTE_TABLES[n.table](p) : ''}</div>`).join(''),
      },
      settlement: { title: '수지결산서', sub: periodText(p), html: settlementTables(p) },
      programs: { title: '사업실적서', sub: periodText(p), html: programResultTable(p, true) },
      property: { title: '재산목록', sub: `${koDate(p.period.to)} 현재`, html: propertyTables(p, true) },
      nextPlan: { title: `${p.next.year}년 사업계획서`, sub: '', html: programPlanTable(p, true) },
      nextBudget: { title: `${p.next.year}년 수지예산서`, sub: '', html: budgetTables(p) },
    };
  }

  function openPrint(keys) {
    const p = data.package;
    const sections = printSections(p);
    const body = keys.map(k => {
      const s = sections[k];
      return `<section><div class="org">${esc(p.org.name)}</div><h1>${esc(s.title)}</h1>
        ${s.sub ? `<div class="sub">${esc(s.sub)}</div>` : ''}<div class="unit">(단위: 원)</div>${s.html}</section>`;
    }).join('');
    const win = window.open('', '_blank');
    if (!win) { alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.'); return; }
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(p.org.name)} ${p.year} 결산 서류</title><style>
      body{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;font-size:12px;color:#222;margin:24px}
      section{page-break-after:always} section:last-child{page-break-after:auto}
      h1{font-size:20px;text-align:center;margin:6px 0} .org{text-align:center;font-size:13px}
      .sub{text-align:center;margin-bottom:6px} .unit{text-align:right;font-size:11px;margin-bottom:4px}
      table{width:100%;border-collapse:collapse;margin-bottom:10px} th,td{border:1px solid #999;padding:4px 6px;font-size:11px}
      th{background:#eee;font-weight:600} .num{text-align:right;white-space:nowrap}
      .ls-sub{font-weight:600;margin:12px 0 4px} .ls-note{font-size:11px;color:#555;margin:6px 0}
      .ls-note-block{margin-bottom:14px;page-break-inside:avoid} .ls-note-title{font-weight:600;margin-bottom:4px}
      @page{size:A4;margin:14mm}
    </style></head><body>${body}<script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  function exportExcel(extra, fileName) {
    if (!window.XLSX) { alert('엑셀 변환 라이브러리가 로드되지 않았습니다.'); return; }
    const p = data.package;
    const wb = window.XLSX.utils.book_new();
    const sheet = (name, doc) => {
      const hasPrev = doc.rows.some(r => r.previous);
      const aoa = [['과목', '당기 통합', '당기 공익목적사업', '당기 기타사업', ...(hasPrev ? ['전기 통합', '전기 공익목적사업', '전기 기타사업'] : [])]];
      doc.rows.forEach(r => {
        const line = ['  '.repeat(r.level) + r.label];
        if (r.type !== 'head') {
          line.push(r.current.total, r.current.public, r.current.other);
          if (hasPrev) line.push(r.previous?.total ?? 0, r.previous?.public ?? 0, r.previous?.other ?? 0);
        }
        aoa.push(line);
      });
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), name);
    };
    sheet('재무상태표', p.balance);
    sheet('운영성과표', p.operating);
    const s = p.settlement;
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([
      ['구분', '과목', '예산액', '결산액', '증감'],
      ['수입', '전기이월금', '', s.carryIn, ''],
      ...s.revenueRows.map(r => ['수입', r.label, r.planned, r.actual, r.difference]),
      ...s.expenseRows.map(r => ['지출', '  '.repeat(r.level) + r.label, r.planned, r.actual, r.difference]),
      ['지출', '차기이월금', '', s.carryOut, ''],
      ['', '기타 자금 증감', '', s.otherChange, ''],
    ]), '수지결산서');
    if (typeof extra === 'function') extra(wb);
    window.XLSX.writeFile(wb, fileName || `결산서류_${p.year}.xlsx`);
  }

  /* ── 탭 화면 ── */
  function renderChecks() {
    const c = data.checks || { items: [], blockers: 0 };
    const manual = data.manualChecks || [];
    const saved = data.settlement.checklist || {};
    return `
      <div class="ls-note">해결 필요 ${c.blockers}건. 모두 해결해야 확정할 수 있습니다.</div>
      <table class="ls-table"><thead><tr><th>항목</th><th>상태</th><th>내용</th></tr></thead>
        <tbody>${c.items.filter(i => !i.key.startsWith('manual_')).map(i => `<tr>
          <td>${esc(i.label)}</td>
          <td style="white-space:nowrap;color:${STATE_COLOR[i.state]};font-weight:600">${STATE_LABEL[i.state]}</td>
          <td>${esc(i.detail)}</td>
        </tr>`).join('')}</tbody></table>
      <div class="ls-sub">사람이 확인할 항목</div>
      ${manual.map(m => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0">
        <input type="checkbox" class="ls-manual" data-key="${esc(m.key)}"${saved[m.key] === true ? ' checked' : ''}${editable() ? '' : ' disabled'}> ${esc(m.label)}
      </label>`).join('')}
      ${editable() ? '<button class="btn-sm btn-sm-primary" type="button" data-act="save-checks" style="margin-top:8px">확인 저장</button>' : ''}`;
  }

  function renderNotes() {
    const p = data.package;
    return p.notes.map(n => `
      <div class="ls-note-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="font-weight:600;flex:1">주석 ${n.no}. ${esc(n.title)} <span style="font-weight:400;color:var(--text-3);font-size:12px">${esc(n.clause)}</span></div>
          ${n.confirm && !n.saved ? '<span style="color:var(--danger);font-size:12px">사실 확인 필요</span>' : ''}
          ${n.saved ? `<span style="color:var(--text-3);font-size:12px">${esc(n.updatedByName || '')} 확인</span>` : ''}
        </div>
        ${editable()
          ? `<textarea class="input ls-note-body" data-key="${n.key}" rows="${Math.min(12, String(n.body).split('\n').length + 1)}" style="width:100%">${esc(n.body)}</textarea>
             <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">
               ${n.saved ? `<button class="btn-sm btn-sm-ghost" type="button" data-act="reset-note" data-key="${n.key}">자동 문구로</button>` : ''}
               <button class="btn-sm btn-sm-primary" type="button" data-act="save-note" data-key="${n.key}">${n.saved ? '저장' : '확인하고 저장'}</button>
             </div>`
          : `<div style="white-space:pre-wrap;font-size:13px">${esc(n.body)}</div>`}
        ${n.table ? `<div style="margin-top:8px">${NOTE_TABLES[n.table](p)}</div>` : ''}
      </div>`).join('');
  }

  function renderProperty() {
    const p = data.package;
    const pr = p.property;
    return `
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px">
        ${editable() ? `<button class="btn-sm btn-sm-ghost" type="button" data-act="fill-property">장부 잔액으로 채우기</button>
          <button class="btn-sm btn-sm-primary" type="button" data-act="edit-property" data-id="0">+ 재산 추가</button>` : ''}
      </div>
      ${propertyTables(p, false)}
      <div class="ls-sub">장부와 대조 ${pr.matched ? '<span style="color:var(--success)">일치</span>' : '<span style="color:var(--danger)">불일치</span>'}</div>
      <table class="ls-table"><thead><tr><th>계정</th><th>장부 잔액</th><th>재산목록 합계</th><th>차이</th></tr></thead>
        <tbody>${pr.reconcile.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${amt(r.ledger)}</td><td class="num">${amt(r.listed)}</td>
          <td class="num" style="${r.difference ? 'color:var(--danger);font-weight:600' : ''}">${amt(r.difference)}</td></tr>`).join('')
          || '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">자산 잔액이 없습니다.</td></tr>'}</tbody></table>`;
  }

  function renderNext() {
    const p = data.package;
    return `
      <div class="ls-sub">${p.next.year}년 사업계획서</div>
      ${programPlanTable(p, false)}
      <div style="display:flex;align-items:center;margin-top:16px">
        <div class="ls-sub" style="flex:1;margin:0">${p.next.year}년 수지예산서</div>
        <button class="btn-sm btn-sm-ghost" type="button" data-act="print" data-keys="nextPlan,nextBudget">인쇄</button>
      </div>
      ${budgetTables(p)}`;
  }

  function renderApproval() {
    const s = data.settlement;
    const order = ['locked', 'audited', 'board_approved', 'assembly_approved', 'submitted'];
    const reached = st => order.indexOf(s.status) >= order.indexOf(st);
    const stepRow = (st, label, detail) => `<tr>
      <td style="font-weight:600">${label}</td>
      <td style="color:${reached(st) ? 'var(--success)' : 'var(--text-3)'}">${reached(st) ? '완료' : '대기'}</td>
      <td>${esc(detail || '')}</td></tr>`;
    const next = { draft: 'lock', locked: 'audit', audited: 'board', board_approved: 'assembly', assembly_approved: 'submit' }[s.status];
    const nextLabel = { lock: '결산 확정', audit: '감사 기록', board: '이사회 의결 기록', assembly: '총회 승인 기록', submit: '제출 기록' }[next];
    return `
      <div class="ls-note">정관 제33·34조 순서입니다. 확정하면 그해 장부가 닫히고 서류가 승인본으로 고정됩니다.</div>
      <table class="ls-table"><thead><tr><th>단계</th><th>상태</th><th>내용</th></tr></thead><tbody>
        ${stepRow('locked', '결산 확정', s.lockedByName ? `${s.lockedByName} ${String(s.lockedAt || '').slice(0, 10)}` : '')}
        ${stepRow('audited', '감사', s.auditedOn ? `${String(s.auditedOn).slice(0, 10)} ${s.auditorName || ''} ${s.auditOpinion || ''}` : '')}
        ${stepRow('board_approved', '이사회 의결', s.boardOn ? `${String(s.boardOn).slice(0, 10)} ${s.boardNote || ''}` : '')}
        ${stepRow('assembly_approved', '총회 승인', s.assemblyOn ? `${String(s.assemblyOn).slice(0, 10)} ${s.assemblyNote || ''}` : '')}
        ${stepRow('submitted', '주무관청 제출', s.submittedOn ? `${String(s.submittedOn).slice(0, 10)} ${s.submittedTo || ''} ${s.submittedNote || ''}` : '')}
      </tbody></table>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">
        ${isChair() && s.status !== 'draft' ? '<button class="btn-sm btn-sm-ghost" type="button" data-act="reopen">확정 해제</button>' : ''}
        ${isChair() && next ? `<button class="btn-sm btn-sm-primary" type="button" data-act="step" data-step="${next}">${nextLabel}</button>` : ''}
        ${!isChair() ? '<span style="font-size:12px;color:var(--text-3)">확정과 승인 기록은 이사장이 합니다.</span>' : ''}
      </div>`;
  }

  /* ── 공익법인 대응 ── */
  let publicData = null;
  async function loadPublic() {
    const res = await api('GET', `/api/admin-ledger-public?year=${year}`);
    if (!res.ok) { qs('#lsBody').innerHTML = `<div style="color:var(--danger);white-space:pre-line">${esc(failText(res))}</div>`; return; }
    publicData = dataOf(res);
    paintPublic();
  }

  function paintPublic() {
    const p = publicData;
    if (!p || tab !== 'public') return;
    const pct = v => (v == null ? '-' : v + '%');
    const three = (label, a) => `<tr><td>${esc(label)}</td><td class="num">${amt(a.total)}</td><td class="num">${amt(a.public)}</td><td class="num">${amt(a.other)}</td></tr>`;
    const head = '<thead><tr><th>구분</th><th>총계</th><th>공익목적사업</th><th>기타사업</th></tr></thead>';
    const r = p.ratios;
    const pass = r.serviceOfExpense != null && r.serviceOfExpense >= r.target;
    const d = p.disclosure;
    qs('#lsBody').innerHTML = `
      <div class="ls-sub">사업수행 비율</div>
      <table class="ls-table"><tbody>
        <tr><td>사업비용 중 사업수행비용</td><td class="num" style="font-weight:600">${pct(r.serviceOfExpense)}</td><td>${r.serviceOfExpense == null ? '' : pass ? '<span style="color:var(--success)">기준 이상</span>' : '<span style="color:var(--danger)">기준 미달</span>'}</td></tr>
        <tr><td>사업수익 중 사업수행비용</td><td class="num">${pct(r.serviceOfRevenue)}</td><td></td></tr>
        <tr><td>일반관리비용 비중</td><td class="num">${pct(r.adminOfExpense)}</td><td></td></tr>
        <tr><td>모금비용 비중</td><td class="num">${pct(r.fundraisingOfExpense)}</td><td></td></tr>
      </tbody></table>
      <div class="ls-note">참고 기준 ${r.target}%. 법령상 기준은 세무 확인 뒤 맞춥니다.
        ${isChair() ? '<button class="btn-sm btn-sm-ghost" type="button" data-act="public-target">기준 변경</button>' : ''}</div>

      <div class="ls-sub">공시 자료 — ${esc(p.form.label)}</div>
      <div class="ls-note">총자산 ${won(p.form.totalAssets)}원, 수입금액과 출연재산 합계 ${won(p.form.incomeBase)}원 기준입니다. 간편서식은 총자산 5억 원 미만이고 수입금액과 출연재산 합계가 3억 원 미만일 때 씁니다.</div>
      <table class="ls-table">${head}<tbody>
        ${three('자산 합계', p.assets.total)}${three('금융자산', p.assets.financial)}${three('기타자산', p.assets.other)}${three('부채', p.assets.liabilities)}
        ${three('수익 합계', p.revenue.total)}${three('기부금', p.revenue.donation)}${three('보조금', p.revenue.grant)}${three('회비수익', p.revenue.fee)}${three('기타 사업수익', p.revenue.other)}${three('사업외수익', p.revenue.nonOperating)}
        ${three('비용 합계', p.expense.total)}${three('사업수행비용', p.expense.service)}${three('일반관리비용', p.expense.admin)}${three('모금비용', p.expense.fundraising)}${three('사업외비용', p.expense.nonOperating)}${three('법인세비용', p.expense.tax)}
      </tbody></table>

      <div class="ls-sub">공익목적사업 사업별 실적</div>
      <table class="ls-table"><thead><tr><th>코드</th><th>사업명</th><th>사업수행비용</th><th>사업내용</th></tr></thead>
        <tbody>${p.programs.map(x => `<tr><td>${esc(x.disclosureCode || '')}</td><td>${esc(x.name)}${x.charterRef ? '' : ' <span style="color:#b45309;font-size:11px">정관 근거 없음</span>'}</td><td class="num">${amt(x.amount)}</td><td style="white-space:pre-wrap">${esc(x.resultBody)}</td></tr>`).join('')
          || '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">사업수행비용이 없습니다.</td></tr>'}</tbody></table>

      <div class="ls-sub">기부금품 수입 및 지출 명세(부표 1)</div>
      <table class="ls-table"><thead><tr><th>월</th><th>수입</th><th>지출</th><th>잔액</th></tr></thead><tbody>
        <tr><td>전기이월</td><td></td><td></td><td class="num">${amt(p.donations.carryIn)}</td></tr>
        ${p.donations.months.map(m => `<tr><td>${m.month}월</td><td class="num">${amt(m.income)}</td><td class="num">${amt(m.spent)}</td><td class="num">${amt(m.balance)}</td></tr>`).join('')}
        <tr style="background:#f5f3f0"><td style="font-weight:600">합계</td><td class="num">${amt(p.donations.totalIncome)}</td><td class="num">${amt(p.donations.totalSpent)}</td><td class="num">${amt(p.donations.carryOut)}</td></tr>
      </tbody></table>

      <div class="ls-sub">전용계좌 외 거래</div>
      <table class="ls-table"><thead><tr><th>날짜</th><th>전표</th><th>내용</th><th>계정</th><th>입금</th><th>출금</th></tr></thead>
        <tbody>${p.dedicated.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.voucherNumber)}</td><td>${esc(x.description)}</td><td>${esc(x.accountName)}</td><td class="num">${amt(x.debit)}</td><td class="num">${amt(x.credit)}</td></tr>`).join('')
          || '<tr><td colspan="6" style="text-align:center;color:var(--text-3)">없습니다.</td></tr>'}</tbody></table>

      <div class="ls-sub">재정 공개 ${d?.status === 'published' ? '<span style="color:var(--success)">공개 중</span>' : '<span style="color:var(--text-3)">비공개</span>'}</div>
      <div class="ls-note">정관 제35조②에 따라 매년 4월 안에 홈페이지에 공개합니다. 공개하면 그 순간의 숫자로 고정되고, 장부가 바뀌면 다시 공개합니다.</div>
      ${canManage() ? `<input id="lsPubTitle" class="input" style="width:100%;margin-bottom:6px" value="${esc(d?.title || year + '년 재정 공개')}">
        <textarea id="lsPubIntro" class="input" rows="3" style="width:100%" placeholder="공개 페이지에 보일 안내 문구">${esc(d?.intro || '')}</textarea>
        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
          <button class="btn-sm btn-sm-ghost" type="button" data-act="public-save">문구 저장</button>
          ${isChair() ? `${d?.status === 'published' ? '<button class="btn-sm btn-sm-ghost" type="button" data-act="public-unpublish">내리기</button>' : ''}<button class="btn-sm btn-sm-primary" type="button" data-act="public-publish">${d?.status === 'published' ? '다시 공개' : '공개'}</button>` : ''}
        </div>` : ''}

      <div class="ls-sub">세무사 전달 파일</div>
      <button class="btn-sm btn-sm-ghost" type="button" data-act="public-tax-file">엑셀 내려받기</button>
      <div class="ls-note">재무상태표, 운영성과표, 수지결산서, 분개 전체, 기부금 명세를 한 파일로 만듭니다.</div>

      <div class="ls-sub">공익법인 지정</div>
      <div class="ls-note">지정일을 넣으면 그날부터 후원회원 회비 납부 확인서가 기부금 영수증 서식으로 바뀝니다. 지금 지정일: ${esc(p.designatedOn || '없음')}</div>
      ${isChair() ? `<input id="lsDesignated" class="input-sm" type="date" value="${esc(p.designatedOn || '')}"> <button class="btn-sm btn-sm-ghost" type="button" data-act="public-designate">저장</button>` : ''}`;
  }

  async function exportTaxFile() {
    if (!window.XLSX) { alert('엑셀 변환 라이브러리가 로드되지 않았습니다.'); return; }
    const res = await api('GET', `/api/admin-ledger-public?year=${year}&doc=vouchers`);
    if (!res.ok) { alert(failText(res)); return; }
    const rows = dataOf(res).rows || [];
    exportExcel(wb => {
      const X = window.XLSX;
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
        ['날짜', '전표번호', '구분', '적요', '거래처', '증빙', '출처', '계정코드', '계정', '차변', '대변', '활동', '사업', '재원'],
        ...rows.map(r => [r.date, r.number, r.type, r.description, r.payee, r.evidence, r.source, r.accountCode, r.accountName, r.debit, r.credit, FN_LABEL[r.functionCode] || '', r.program || '', r.fund || '']),
      ]), '분개');
      const p = publicData;
      if (p) {
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
          ['월', '수입', '지출', '잔액'], ['전기이월', '', '', p.donations.carryIn],
          ...p.donations.months.map(m => [m.month + '월', m.income, m.spent, m.balance]),
          ['합계', p.donations.totalIncome, p.donations.totalSpent, p.donations.carryOut],
        ]), '기부금 명세');
      }
    }, `세무사전달_${year}.xlsx`);
  }

  function paint() {
    const body = qs('#lsBody');
    if (!data) return;
    if (tab === 'public') {
      root.querySelectorAll('[data-ls]').forEach(b => b.classList.toggle('on', b.dataset.ls === tab));
      body.innerHTML = '<div style="color:var(--text-3);padding:16px">불러오는 중…</div>';
      loadPublic();
      return;
    }
    const p = data.package;
    const docHead = (keys) => `<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px">
      <button class="btn-sm btn-sm-ghost" type="button" data-act="print" data-keys="${keys}">인쇄</button></div>`;
    const firstYear = p.previousYear == null ? '<div class="ls-note">전기 장부가 없어 비교를 생략합니다(회계기준 부칙 제3조).</div>' : '';
    const balanced = p.balance.balanced ? '' : '<div class="ls-note" style="color:var(--danger)">자산과 부채·순자산 합계가 맞지 않습니다.</div>';
    const html = {
      checks: renderChecks,
      balance: () => docHead('balance') + firstYear + balanced + statementTable(p.balance),
      operating: () => docHead('operating') + firstYear + statementTable(p.operating),
      notes: () => docHead('notes') + renderNotes(),
      settlement: () => docHead('settlement') + settlementTables(p),
      programs: () => docHead('programs') + programResultTable(p, false),
      property: () => docHead('property') + renderProperty(),
      next: renderNext,
      approval: renderApproval,
    }[tab]();
    body.innerHTML = html;
    root.querySelectorAll('[data-ls]').forEach(b => b.classList.toggle('on', b.dataset.ls === tab));
  }

  async function reload() {
    const body = qs('#lsBody');
    body.innerHTML = '<div style="color:var(--text-3);padding:16px">불러오는 중…</div>';
    const res = await api('GET', `/api/admin-ledger-settlement?year=${year}`);
    if (!res.ok) { body.innerHTML = `<div style="color:var(--danger);white-space:pre-line;padding:12px">${esc(failText(res))}</div>`; return; }
    data = dataOf(res);
    qs('#lsStatus').textContent = data.settlement.statusLabel + (data.frozen ? ' · 승인본' : '');
    paint();
  }

  /* ── 입력 창 ── */
  function modal(title, html, onSave) {
    qs('#lsModalTitle').textContent = title;
    qs('#lsModalBody').innerHTML = html;
    qs('#lsModalError').style.display = 'none';
    qs('#lsModal').style.display = 'flex';
    qs('#lsModalSave').onclick = async () => {
      const res = await onSave();
      if (res && !res.ok) {
        qs('#lsModalError').textContent = failText(res);
        qs('#lsModalError').style.display = '';
        return;
      }
      qs('#lsModal').style.display = 'none';
      await reload();
    };
  }
  const field = (label, html) => `<label class="form-label">${label}</label>${html}`;
  const input = (id, value, type) => `<input id="${id}" class="input" type="${type || 'text'}" value="${esc(value ?? '')}" style="width:100%;margin-bottom:10px">`;
  const area = (id, value, rows) => `<textarea id="${id}" class="input" rows="${rows || 5}" style="width:100%;margin-bottom:10px">${esc(value ?? '')}</textarea>`;
  const val = id => qs('#' + id)?.value ?? '';

  function editResult(id) {
    const x = data.package.programs.find(p => p.id === id);
    if (!x) return;
    modal(`${x.name} 실적`, field('사업 실적', area('lsResult', x.resultBody, 7))
      + field('횟수', input('lsEvents', x.events, 'number')) + field('수혜·참여 인원', input('lsBenef', x.beneficiaries, 'number')),
      () => api('POST', '/api/admin-ledger-docs', {
        type: 'program', year, programId: id, planTarget: x.planTarget, planPeriod: x.planPeriod, planBody: x.planBody,
        resultBody: val('lsResult'), events: val('lsEvents'), beneficiaries: val('lsBenef'),
      }));
  }
  function editPlan(id) {
    const x = data.package.next.programs.find(p => p.id === id);
    if (!x) return;
    modal(`${data.package.next.year}년 ${x.name} 계획`, field('목표', input('lsTarget', x.planTarget)) + field('시기', input('lsPeriod', x.planPeriod))
      + field('내용', area('lsPlan', x.planBody, 6)),
      () => api('POST', '/api/admin-ledger-docs', {
        type: 'program', year: data.package.next.year, programId: id, planTarget: val('lsTarget'), planPeriod: val('lsPeriod'),
        planBody: val('lsPlan'), resultBody: x.resultBody, events: x.events, beneficiaries: x.beneficiaries,
      }));
  }
  function editProperty(id) {
    const i = data.package.property.items.find(x => x.id === id) || { propertyClass: 'ordinary', accountCode: '', name: '', amount: 0 };
    const accounts = masters.accounts.filter(a => a.kind === 'asset' && !masters.accounts.some(b => b.parentCode === a.code));
    modal(id ? '재산 수정' : '재산 추가',
      field('구분', `<select id="lsCls" class="input" style="width:100%;margin-bottom:10px">
        <option value="ordinary"${i.propertyClass === 'ordinary' ? ' selected' : ''}>보통재산</option>
        <option value="basic"${i.propertyClass === 'basic' ? ' selected' : ''}>기본재산</option></select>`)
      + field('계정', `<select id="lsAcc" class="input" style="width:100%;margin-bottom:10px">
        ${accounts.map(a => `<option value="${esc(a.code)}"${a.code === i.accountCode ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`)
      + field('재산명', input('lsName', i.name)) + field('내역(은행·계좌·소재지 등)', input('lsDetail', i.detail))
      + field('수량', input('lsQty', i.quantity)) + field('금액', input('lsAmt', i.amount, 'number')) + field('비고', input('lsNote', i.note)),
      () => api('POST', '/api/admin-ledger-docs', {
        type: 'property', year, id: id || undefined, propertyClass: val('lsCls'), accountCode: val('lsAcc'), name: val('lsName'),
        detail: val('lsDetail'), quantity: val('lsQty'), amount: Number(val('lsAmt')), note: val('lsNote'),
      }));
  }
  function stepForm(step) {
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const post = extra => api('POST', '/api/admin-ledger-settlement', { action: step, year, date: val('lsDate'), ...extra });
    if (step === 'lock') {
      if (!confirm(`${year}년 결산을 확정할까요? 그해 장부가 닫히고 서류가 승인본으로 고정됩니다.`)) return;
      api('POST', '/api/admin-ledger-settlement', { action: 'lock', year }).then(res => {
        if (!res.ok) alert(failText(res));
        reload();
      });
      return;
    }
    const date = field('날짜', input('lsDate', today, 'date'));
    if (step === 'audit') {
      modal('감사 기록', date + field('감사 이름', input('lsAud')) + field('감사 의견', area('lsOp', '', 3)),
        () => post({ auditorName: val('lsAud'), opinion: val('lsOp') }));
    } else if (step === 'submit') {
      modal('제출 기록', date + field('제출처', input('lsTo', '교육부')) + field('메모', area('lsMemo', '', 3)),
        () => post({ to: val('lsTo'), note: val('lsMemo') }));
    } else {
      modal(step === 'board' ? '이사회 의결 기록' : '총회 승인 기록', date + field('메모', area('lsMemo', '', 3)), () => post({ note: val('lsMemo') }));
    }
  }

  async function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (t) {
      const id = Number(t.dataset.id) || 0;
      const act = t.dataset.act;
      if (act === 'print') openPrint(t.dataset.keys.split(','));
      if (act === 'print-all') openPrint(['balance', 'operating', 'notes', 'settlement', 'programs', 'property', 'nextPlan', 'nextBudget']);
      if (act === 'excel') exportExcel();
      if (act === 'public-tax-file') await exportTaxFile();
      if (act === 'public-save' || act === 'public-publish' || act === 'public-unpublish') {
        const save = await api('POST', '/api/admin-ledger-public', { action: 'disclosure_save', year, title: qs('#lsPubTitle').value, intro: qs('#lsPubIntro').value });
        if (!save.ok) { alert(failText(save)); return; }
        if (act !== 'public-save') {
          if (act === 'public-publish' && !confirm('홈페이지에 공개할까요? 지금 장부의 숫자로 고정됩니다.')) return;
          const r = await api('POST', '/api/admin-ledger-public', { action: act === 'public-publish' ? 'publish' : 'unpublish', year });
          if (!r.ok) { alert(failText(r)); return; }
        }
        await loadPublic();
      }
      if (act === 'public-target') {
        const v = prompt('사업수행 비율 참고 기준(%)', publicData?.ratios?.target);
        if (v === null) return;
        const r = await api('POST', '/api/admin-ledger-public', { action: 'target_save', target: Number(v) });
        if (!r.ok) alert(failText(r)); else await loadPublic();
      }
      if (act === 'public-designate') {
        const on = qs('#lsDesignated').value;
        if (!confirm(on ? `${on}부터 기부금 영수증 서식으로 발급합니다. 저장할까요?` : '지정일을 비웁니다. 저장할까요?')) return;
        const r = await api('POST', '/api/admin-ledger-public', { action: 'designate', designatedOn: on });
        if (!r.ok) alert(failText(r)); else await loadPublic();
      }
      if (act === 'edit-result') editResult(id);
      if (act === 'edit-plan') editPlan(id);
      if (act === 'edit-property') editProperty(id);
      if (act === 'step') stepForm(t.dataset.step);
      if (act === 'del-property' && confirm('이 재산을 지울까요?')) {
        const res = await api('POST', '/api/admin-ledger-docs', { type: 'property_delete', year, id });
        if (!res.ok) alert(failText(res)); else await reload();
      }
      if (act === 'fill-property') {
        const res = await api('POST', '/api/admin-ledger-docs', { type: 'property_fill', year });
        if (!res.ok) alert(failText(res)); else await reload();
      }
      if (act === 'save-note' || act === 'reset-note') {
        const key = t.dataset.key;
        const noteBody = root.querySelector(`.ls-note-body[data-key="${key}"]`)?.value;
        const res = await api('POST', '/api/admin-ledger-docs', act === 'save-note'
          ? { type: 'note', year, key, body: noteBody } : { type: 'note_reset', year, key });
        if (!res.ok) alert(failText(res)); else await reload();
      }
      if (act === 'save-checks') {
        const checklist = {};
        root.querySelectorAll('.ls-manual').forEach(c => { checklist[c.dataset.key] = c.checked; });
        const res = await api('POST', '/api/admin-ledger-settlement', { action: 'checklist', year, checklist });
        if (!res.ok) alert(failText(res)); else await reload();
      }
      if (act === 'reopen') {
        const reason = prompt('확정을 해제하는 사유를 입력하세요. 감사·이사회·총회 기록도 함께 지워집니다.');
        if (!reason) return;
        const res = await api('POST', '/api/admin-ledger-settlement', { action: 'reopen', year, reason });
        if (!res.ok) alert(failText(res));
        await reload();
      }
      return;
    }
    const tabBtn = e.target.closest('[data-ls]');
    if (tabBtn) { tab = tabBtn.dataset.ls; paint(); }
  }

  async function render(container, ctx) {
    role = ctx.role || 'admin';
    masters = ctx.masters;
    root = container;
    const list = masters.fiscalYears;
    if (!year || !list.some(f => f.year === year)) {
      const y = new Date().getFullYear();
      year = (list.find(f => f.year === y) || list[0] || { year: y }).year;
    }
    container.innerHTML = `
      <style>
        .ls-table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:13px}
        .ls-table th,.ls-table td{border-bottom:1px solid var(--line,#e5e0d8);padding:6px 8px;text-align:left}
        .ls-table th{background:var(--bg-2,#faf8f6);font-weight:600;white-space:nowrap}
        .ls-table .num{text-align:right;white-space:nowrap}
        .ls-table th:not(:first-child){text-align:right}
        .ls-sub{font-weight:600;margin:14px 0 6px}
        .ls-note{font-size:12px;color:var(--text-3);margin:6px 0}
        .ls-note-card{border:1px solid var(--line,#e5e0d8);border-radius:8px;padding:12px;margin-bottom:10px}
      </style>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <select id="lsYear" class="input-sm">${list.map(f => `<option value="${f.year}"${f.year === year ? ' selected' : ''}>${f.year}년</option>`).join('')}</select>
        <span id="lsStatus" style="font-size:13px;font-weight:600"></span>
        <span style="flex:1"></span>
        <button class="btn-sm btn-sm-ghost" type="button" data-act="excel">엑셀</button>
        <button class="btn-sm btn-sm-primary" type="button" data-act="print-all">전체 인쇄</button>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">
        ${TABS.map(([k, label]) => `<button class="btn-sm btn-sm-ghost" type="button" data-ls="${k}">${label}</button>`).join('')}
      </div>
      <div id="lsBody"></div>
      <div id="lsModal" class="modal-backdrop" style="display:none">
        <div class="modal" style="max-width:520px">
          <div class="modal-head"><span class="modal-title" id="lsModalTitle"></span><button class="modal-close" type="button" id="lsModalClose">×</button></div>
          <div class="modal-body" id="lsModalBody"></div>
          <div id="lsModalError" style="color:var(--danger);font-size:13px;padding:0 20px 8px;white-space:pre-line;display:none"></div>
          <div class="modal-foot">
            <button class="btn-sm btn-sm-ghost" type="button" id="lsModalCancel">취소</button>
            <button class="btn-sm btn-sm-primary" type="button" id="lsModalSave">저장</button>
          </div>
        </div>
      </div>`;
    container.onclick = onClick;
    qs('#lsYear').addEventListener('change', e => { year = Number(e.target.value); reload(); });
    const close = () => { qs('#lsModal').style.display = 'none'; };
    qs('#lsModalClose').addEventListener('click', close);
    qs('#lsModalCancel').addEventListener('click', close);
    await reload();
  }

  window.SIREN_SETTLEMENT = { render };
})();
