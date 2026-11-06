/* admin-docs.js — 내부결재 (2026-11-06)
 * 결재 홈 / 문서 작성 / 내 문서함 / 결재 문서함 / 지출완료 확인 / 예산 진행현황 / 취소 및 보존함 / 결재선 및 양식 설정
 * 설계: docs/active/2026-11-06-approval-docs-design.md
 * window.SIREN_DOCS = { open, openDoc }
 *
 * 급여 지급 결재: 급여 관리의 «지급 결재 올리기»가 만든 지출결의서다(formData.payroll).
 * 대상과 금액은 급여 명세에서 오므로 화면에서 고치지 않는다. 직원별 금액은 이사장에게만 온다.
 */
(function () {
  'use strict';

  let meta = null;      // 문서 유형·설정·내 정보
  let people = [];      // 결재선 후보
  let tags = null;      // 활동·사업·재원
  let draft = null;     // 작성 중 문서
  let budgets = null;   // 예산 선택지
  let boxState = {};    // 문서함별 필터
  let autoTimer = null; // 자동저장 타이머
  let lastSaved = '';   // 마지막으로 저장한 내용
  let saving = null;    // 진행 중인 저장. 겹치면 문서가 두 건 생긴다
  let pendingDoc = null; // 다른 화면에서 열어 달라고 한 문서

  const FN_LABEL = { service: '사업수행', admin: '일반관리', fundraising: '모금' };
  const ROLE_LABEL = { operator: '직원', admin: '국장', super_admin: '이사장' };
  const SEAL_TYPES = ['법인인감', '사용인감', '직인'];
  const EVIDENCE_TYPES = ['세금계산서', '계산서', '카드매출전표', '현금영수증', '영수증', '기타'];
  const HALF_PERIODS = { '': '종일', AM: '오전 반차', PM: '오후 반차', LATE_IN: '반반차(늦게 출근)', EARLY_OUT: '반반차(일찍 퇴근)' };
  const DOC_ORDER = ['internal', 'proposal', 'expense', 'card', 'seal'];
  /* 브라우저가 형식을 비워 보내는 파일이 있어 확장자로 정한다 */
  const FILE_TYPES = {
    pdf: 'application/pdf', hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  const fileType = f => FILE_TYPES[String(f.name).split('.').pop().toLowerCase()] || f.type || 'application/octet-stream';

  function api(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(async r => {
      const json = await r.json().catch(() => null);
      return { ok: r.ok && json && json.ok !== false, status: r.status, data: json, error: json?.error };
    }).catch(e => ({ ok: false, error: String(e) }));
  }
  const post = body => api('POST', '/api/admin-docs', body);
  const get = qs => api('GET', '/api/admin-docs?' + qs);
  const dataOf = res => res.data?.data || res.data || {};
  const failText = res => [res.data?.error || res.error || '요청 실패', ...(res.data?.missing || []), res.data?.detail || ''].filter(Boolean).join('\n');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const won = n => Number(n || 0).toLocaleString('ko-KR');
  const day = s => (s ? String(s).slice(0, 10) : '');
  const page = view => document.getElementById('page-docs-' + view);
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const isChair = () => meta?.me?.role === 'super_admin';
  const myTitle = () => people.find(p => p.id === meta.me.id)?.title || ROLE_LABEL[meta.me.role] || '';
  const cardRuleOn = () => !!meta.settings.cardRuleEffectiveOn && today() >= meta.settings.cardRuleEffectiveOn;
  /* 통합 CMS 탭은 사이드바 클릭으로 바꾼다 */
  const go = view => document.querySelector(`a[data-tab="docs-${view}"]`)?.click();

  async function ensureMeta() {
    if (meta) return true;
    const [f, p, t] = await Promise.all([get('view=form'), get('view=people'), api('GET', '/api/admin-ledger-tags')]);
    if (!f.ok) return false;
    meta = dataOf(f);
    people = dataOf(p).people || [];
    tags = t.ok ? dataOf(t) : { functions: [], programs: [], funds: [] };
    return true;
  }

  const STYLE = `<style id="docsStyle">
    .dc-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
    .dc-card{background:#fff;border:1px solid var(--line,#e5e0d8);border-radius:10px;padding:14px;margin-bottom:12px}
    .dc-card h4{font-size:14px;font-weight:600;margin:0 0 8px}
    .dc-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
    .dc-kpi{background:#fff;border:1px solid var(--line,#e5e0d8);border-radius:10px;padding:14px;cursor:pointer;text-align:left}
    .dc-kpi b{display:block;font-size:22px;color:#7a1f2b;margin-top:6px}
    .dc-types{display:flex;gap:8px;flex-wrap:wrap}
    .dc-paper{background:#fff;border:1px solid var(--line,#e5e0d8);border-radius:10px;padding:20px}
    .dc-paper h2{text-align:center;letter-spacing:6px;font-size:22px;margin:4px 0 14px}
    .dc-sign{border-collapse:collapse;margin-left:auto;margin-bottom:14px}
    .dc-sign th,.dc-sign td{border:1px solid var(--line,#e5e0d8);padding:6px 10px;font-size:12px;text-align:center;min-width:70px}
    .dc-sign th{background:#faf8f6}
    .dc-row{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;align-items:center;margin-bottom:8px}
    .dc-row label{font-size:13px;color:var(--text-2)}
    .dc-row2{display:grid;grid-template-columns:96px minmax(0,1fr) 96px minmax(0,1fr);gap:8px;align-items:center;margin-bottom:8px}
    .dc-row2 label{font-size:13px;color:var(--text-2)}
    .dc-editor{border:1px solid var(--line,#e5e0d8);border-radius:8px;min-height:180px;padding:10px;font-size:14px;line-height:1.7;background:#fff}
    .dc-editor ul{list-style:disc;padding-left:22px;margin:4px 0}
    .dc-editor ol{list-style:decimal;padding-left:22px;margin:4px 0}
    .dc-tools{display:flex;gap:4px;margin-bottom:6px}
    .dc-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
    .dc-table th,.dc-table td{border:1px solid #d9d3c9;padding:5px 6px}
    .dc-table th{background:#faf8f6;font-weight:600;white-space:nowrap}
    .dc-table .num{text-align:right;white-space:nowrap}
    .dc-table input,.dc-table select{width:100%;border:0;background:#fdfcfb;font-size:13px;padding:3px}
    .dc-table input:focus,.dc-table select:focus{outline:1px solid #7a1f2b;background:#fff}
    .dc-line{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:4px;margin-bottom:6px;align-items:center}
    .dc-line select{padding-left:6px;padding-right:2px}
    .dc-line .btn-sm,.dc-table .btn-sm{padding:2px 6px;min-width:0;font-size:12px}
    .dc-badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:12px;font-weight:600;background:#f3f4f6;color:#555}
    .dc-badge.ok{background:#d1fae5;color:#059669}.dc-badge.wait{background:#fef3c7;color:#b45309}.dc-badge.bad{background:#fee2e2;color:#dc2626}
    .dc-note{font-size:12px;color:var(--text-3);margin:4px 0}
    .dc-bar{height:9px;border-radius:5px;background:#e5e7eb;overflow:hidden;margin-top:6px}
    .dc-bar i{display:block;height:100%;background:#7a1f2b}
    .dc-kv{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
    @media(max-width:1100px){.dc-grid{grid-template-columns:1fr}.dc-kpis{grid-template-columns:repeat(2,1fr)}}
  </style>`;
  /* 스타일은 문서 머리에 한 번만 넣는다. 화면 안에 두면 그 화면을 다시 그릴 때 함께 지워진다 */
  function styled(html) {
    if (!document.getElementById('docsStyle')) document.head.insertAdjacentHTML('beforeend', STYLE);
    return html;
  }

  function badge(row) {
    const cls = { approved: 'ok', pending: 'wait', rejected: 'bad', recalled: 'bad', canceled: 'bad' }[row.status] || '';
    return `<span class="dc-badge ${cls}">${esc(row.statusLabel)}</span>`;
  }
  function cancelText(r) {
    if (r.deleteStatus === 'deleted') return '삭제됨';
    return { requested: '취소 진행', approved: '취소됨', rejected: '취소 반려' }[r.cancelStatus] || '';
  }

  function listTable(items, opts = {}) {
    if (!items.length) return '<div style="color:var(--text-3);padding:20px;text-align:center">해당 문서가 없습니다.</div>';
    const wide = !opts.compact;
    return `<table class="data-table" style="width:100%"><thead><tr>
      <th>문서번호</th><th>제목</th>${wide ? '<th>유형</th>' : ''}<th>결재 상태</th>${wide ? '<th>현재 담당</th>' : ''}<th>지출 상태</th><th>취소</th><th class="num">금액</th>${wide ? '<th>기안자</th><th>작성일</th>' : ''}
      ${opts.action ? '<th></th>' : ''}</tr></thead>
      <tbody>${items.map(r => `<tr>
        <td style="white-space:nowrap">${esc(r.docNo || '(번호 없음)')}${r.version > 1 ? ` <span class="dc-note">v${r.version}</span>` : ''}</td>
        <td><a href="#" data-doc="${r.id}">${esc(r.title)}</a></td>
        ${wide ? `<td style="white-space:nowrap">${esc(r.docLabel)}</td>` : ''}
        <td>${badge(r)}</td>
        ${wide ? `<td>${esc(r.currentAssignee || '')}</td>` : ''}
        <td style="white-space:nowrap">${esc(r.paymentLabel)}</td>
        <td style="white-space:nowrap">${esc(cancelText(r))}</td>
        <td class="num" style="white-space:nowrap">${r.amount ? won(r.amount) : ''}</td>
        ${wide ? `<td>${esc(r.drafterName || '')}</td>
        <td style="white-space:nowrap">${esc(day(r.submittedAt || r.createdAt))}</td>` : ''}
        ${opts.action ? `<td style="text-align:right">${opts.action(r)}</td>` : ''}
      </tr>`).join('')}</tbody></table>`;
  }

  function bindDocLinks(el, back) {
    el.querySelectorAll('[data-doc]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      openDetail(el.closest('.cms-page') || el, Number(a.dataset.doc), back);
    }));
  }

  /* ── 결재 홈 ── */
  async function renderHome() {
    const c = page('home');
    c.innerHTML = styled('<div class="panel"><div class="p-head"><div class="p-title">내부결재 / 결재 홈</div></div><div id="dcHome">불러오는 중…</div></div>');
    const res = await get('view=home');
    if (!res.ok) { c.querySelector('#dcHome').innerHTML = `<div style="color:var(--danger);white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const d = dataOf(res);
    const n = d.counts || {};
    const el = c.querySelector('#dcHome');
    const kpi = (label, value, go) => `<button type="button" class="dc-kpi" data-go="${go}">${label}<b>${won(value)}</b></button>`;
    el.innerHTML = `
      <div class="dc-kpis">
        ${kpi('결재대기', n.waiting, 'inbox')}${kpi('내 진행문서', n.inProgress, 'mine')}
        ${kpi('지출확인 대기', n.payWait, 'pay')}${kpi('취소 승인 대기', n.cancelWait, 'archive')}
      </div>
      ${n.followup ? `<div class="dc-card" style="color:#b45309">사후 품의 연결이 필요한 긴급 지출 ${n.followup}건이 있습니다.</div>` : ''}
      <div class="dc-card"><h4>문서 작성</h4><div class="dc-types">
        ${DOC_ORDER.map(k => `<button class="btn-sm btn-sm-ghost" type="button" data-new="${k}">${esc(meta.docTypes[k].label)}</button>`).join('')}
      </div></div>
      <div class="dc-card"><h4>최근 문서</h4><div id="dcRecent">${listTable(d.recent || [])}</div></div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => { startNew(b.dataset.new); }));
    bindDocLinks(el, renderHome);
  }

  function startNew(docType, extra) {
    draft = { id: null, docType, formData: { ...(extra || {}) }, references: [], watchers: [], files: [] };
    go('new');
  }

  /* ── 문서함 ── */
  const BOXES = {
    mine: { title: '내 문서함', tabs: [['mine', '상신문서함'], ['reference', '참조·열람']] },
    inbox: { title: '결재 문서함', tabs: [['todo', '결재대기'], ['processed', '처리내역'], ['all', '전체']] },
  };
  async function renderBox(view) {
    const c = page(view);
    const conf = BOXES[view];
    const st = boxState[view] || (boxState[view] = { box: conf.tabs[0][0], q: '', docType: '', status: '', from: '', to: '' });
    c.innerHTML = styled(`<div class="panel">
      <div class="p-head"><div class="p-title">${conf.title}</div>
        ${view === 'mine' ? '<div class="p-actions"><button class="btn-sm btn-sm-primary" type="button" id="dcNew">+ 문서 작성</button></div>' : ''}</div>
      <div style="display:flex;gap:6px;margin-bottom:10px">${conf.tabs.map(([k, l]) =>
        `<button class="btn-sm ${st.box === k ? 'btn-sm-primary' : 'btn-sm-ghost'}" type="button" data-box="${k}">${l}</button>`).join('')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <input id="dcQ" class="input-sm" placeholder="제목·문서번호·기안자" value="${esc(st.q)}" style="width:200px">
        <select id="dcType" class="input-sm"><option value="">유형 전체</option>${DOC_ORDER.map(k => `<option value="${k}"${st.docType === k ? ' selected' : ''}>${esc(meta.docTypes[k].label)}</option>`).join('')}</select>
        <select id="dcStatus" class="input-sm"><option value="">상태 전체</option>${['draft', 'pending', 'approved', 'rejected', 'recalled', 'canceled'].map(k =>
          `<option value="${k}"${st.status === k ? ' selected' : ''}>${{ draft: '임시저장', pending: '진행중', approved: '완료', rejected: '반려', recalled: '회수', canceled: '취소' }[k]}</option>`).join('')}</select>
        <input id="dcFrom" class="input-sm" type="date" value="${esc(st.from)}"><input id="dcTo" class="input-sm" type="date" value="${esc(st.to)}">
        <button class="btn-sm btn-sm-ghost" type="button" id="dcSearch">검색</button>
      </div>
      <div id="dcList">불러오는 중…</div></div>`);
    c.querySelector('#dcNew')?.addEventListener('click', () => { draft = null; go('new'); });
    c.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => { st.box = b.dataset.box; renderBox(view); }));
    c.querySelector('#dcSearch').addEventListener('click', () => {
      st.q = c.querySelector('#dcQ').value; st.docType = c.querySelector('#dcType').value; st.status = c.querySelector('#dcStatus').value;
      st.from = c.querySelector('#dcFrom').value; st.to = c.querySelector('#dcTo').value;
      renderBox(view);
    });
    const qs = new URLSearchParams({ view: 'list', box: st.box });
    ['q', 'docType', 'status', 'from', 'to'].forEach(k => { if (st[k]) qs.set(k, st[k]); });
    const res = await get(qs.toString());
    const el = c.querySelector('#dcList');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);white-space:pre-line">${esc(failText(res))}</div>`; return; }
    el.innerHTML = listTable(dataOf(res).items || []);
    bindDocLinks(el, () => renderBox(view));
  }

  /* ── 작성 화면 ── */
  function lineHtml(s, i, total) {
    return `<div class="dc-line">
      <select class="input-sm" data-line-type="${i}"><option value="approve"${s.type === 'approve' ? ' selected' : ''}>결재</option><option value="consult"${s.type === 'consult' ? ' selected' : ''}>합의</option></select>
      <select class="input-sm" data-line-member="${i}"><option value="">담당자</option>${people.filter(p => p.id !== meta.me.id || isChair()).map(p =>
        `<option value="${p.id}"${p.id === s.memberId ? ' selected' : ''}>${esc(p.name)} ${esc(p.title || ROLE_LABEL[p.role] || '')}</option>`).join('')}</select>
      <span style="white-space:nowrap">
        <button class="btn-sm btn-sm-ghost" type="button" data-line-up="${i}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn-sm btn-sm-ghost" type="button" data-line-down="${i}"${i === total - 1 ? ' disabled' : ''}>↓</button>
        <button class="btn-sm btn-sm-ghost" type="button" data-line-del="${i}">×</button>
      </span></div>`;
  }

  function signTable(line) {
    const heads = ['기안', ...line.map(s => s.type === 'consult' ? '합의' : '결재')];
    const names = [meta.me.name, ...line.map(s => people.find(p => p.id === s.memberId)?.name || '')];
    return `<table class="dc-sign"><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr><tr>${names.map(n => `<td>${esc(n)}</td>`).join('')}</tr></table>`;
  }

  function typeFields(d) {
    const f = d.formData;
    const period = (a, b) => `<input class="input" type="date" data-f="${a}" value="${esc(f[a] || '')}"><input class="input" type="date" data-f="${b}" value="${esc(f[b] || '')}">`;
    if (d.docType === 'proposal') {
      return `
        <div class="dc-row"><label>사업명</label><input class="input" data-f="projectName" value="${esc(f.projectName || '')}"></div>
        <div class="dc-row2"><label>시행기간 *</label><input class="input" type="date" data-f="periodFrom" value="${esc(f.periodFrom || '')}"><label>종료</label><input class="input" type="date" data-f="periodTo" value="${esc(f.periodTo || '')}"></div>
        <div class="dc-row2"><label>재원</label><input class="input" data-f="fundText" value="${esc(f.fundText || '')}">
          <label>지출 방식 *</label><select class="input" id="dcPayMethod"><option value="">선택</option>${Object.entries(meta.payMethods).map(([k, v]) => `<option value="${k}"${d.payMethod === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>`;
    }
    if (d.docType === 'internal') {
      const kind = meta.internalKinds[f.kind];
      return `
        <div class="dc-row"><label>신청 구분 *</label><select class="input" data-f="kind" id="dcKind"><option value="">선택</option>${Object.entries(meta.internalKinds).map(([k, v]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        ${kind?.leave ? `<div class="dc-row2"><label>휴가 종류 *</label><select class="input" data-f="leaveTypeId"><option value="">선택</option>${(meta.leaveTypes || []).map(t => `<option value="${t.id}"${Number(f.leaveTypeId) === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          <label>시간</label><select class="input" data-f="halfDayPeriod">${Object.entries(HALF_PERIODS).map(([k, v]) => `<option value="${k}"${(f.halfDayPeriod || '') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>` : ''}
        <div class="dc-row2"><label>시작일 *</label><input class="input" type="date" data-f="periodFrom" value="${esc(f.periodFrom || '')}"><label>종료일 *</label><input class="input" type="date" data-f="periodTo" value="${esc(f.periodTo || '')}"></div>
        ${kind?.leave ? '' : `<div class="dc-row"><label>시간</label><input class="input" data-f="timeText" placeholder="예: 09:00~18:00" value="${esc(f.timeText || '')}"></div>
          <div class="dc-row2"><label>장소</label><input class="input" data-f="place" value="${esc(f.place || '')}"><label>대상</label><input class="input" data-f="target" value="${esc(f.target || '')}"></div>`}`;
    }
    if (d.docType === 'card') {
      return `
        <div class="dc-row"><label>사용 목적 *</label><input class="input" data-f="usePurpose" value="${esc(f.usePurpose || '')}"></div>
        <div class="dc-row2"><label>사용 시작 *</label><input class="input" type="date" data-f="periodFrom" value="${esc(f.periodFrom || '')}"><label>사용 종료</label><input class="input" type="date" data-f="periodTo" value="${esc(f.periodTo || '')}"></div>
        <div class="dc-row2"><label>예정금액 *</label><input class="input" type="number" min="0" data-f="plannedAmount" value="${esc(f.plannedAmount || '')}"><label>카드 *</label><input class="input" data-f="cardLabel" placeholder="카드 끝 4자리 등" value="${esc(f.cardLabel || '')}"></div>
        ${substituteRow(d, '카드결제로 승인된 품의로 별도 결재 없이 처리')}`;
    }
    if (d.docType === 'seal') {
      return `
        <div class="dc-row2"><label>인감 종류 *</label><select class="input" data-f="sealType"><option value="">선택</option>${SEAL_TYPES.map(t => `<option${f.sealType === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <label>부수</label><input class="input" type="number" min="1" data-f="copies" value="${esc(f.copies || '')}"></div>
        <div class="dc-row"><label>사용 목적 *</label><input class="input" data-f="usePurpose" value="${esc(f.usePurpose || '')}"></div>
        <div class="dc-row2"><label>제출처 *</label><input class="input" data-f="submitTo" value="${esc(f.submitTo || '')}"><label>사용일 *</label><input class="input" type="date" data-f="useDate" value="${esc(f.useDate || '')}"></div>
        <div class="dc-row"><label>날인 대상 *</label><input class="input" data-f="sealTarget" value="${esc(f.sealTarget || '')}"></div>
        ${substituteRow(d, '날인 대상이 첨부된 품의로 승인 갈음')}`;
    }
    return '';
  }

  function substituteRow(d, label) {
    const f = d.formData;
    const proposals = (d.references || []).filter(r => r.docLabel === '품의서' || r.docType === 'proposal');
    return `<div class="dc-row"><label>승인 갈음</label><div>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="dcSubstitute"${f.substitute ? ' checked' : ''}> ${esc(label)}</label>
      <select class="input" data-f="basisId" style="margin-top:4px"><option value="">근거 품의 선택 (오른쪽 문서 연결에서 추가)</option>${proposals.map(r =>
        `<option value="${r.id}"${Number(f.basisId) === r.id ? ' selected' : ''}>${esc(r.docNo)} ${esc(r.title)}</option>`).join('')}</select>
      ${d.docType === 'card' && !cardRuleOn() ? `<div class="dc-note">${meta.settings.cardRuleEffectiveOn ? `규정 시행일(${esc(meta.settings.cardRuleEffectiveOn)}) 전이라` : '카드 규정 시행일이 정해지지 않아'} 지금은 품의서를 연결하고 결재선으로 상신합니다.</div>` : ''}
      ${d.scope ? `<div class="dc-note">품의 금액 ${won(d.scope.approved)}원, 사용 누계 ${won(d.scope.used)}원, 남은 승인범위 ${won(d.scope.remaining)}원</div>` : ''}
    </div></div>`;
  }

  /* ── 급여 지급 결재 ── */
  const payrollOf = d => (d && d.formData && d.formData.payroll && Array.isArray(d.formData.payroll.slipIds) ? d.formData.payroll : null);

  function payrollTable(p) {
    const summary = `<table class="dc-table"><tbody>
      <tr><th style="width:120px">대상</th><td>${esc(p.year)}년 ${esc(p.month)}월 급여 · 직원 ${won(p.count)}명</td></tr>
      <tr><th>지급총액</th><td class="num"><strong>${won(p.gross)}</strong></td></tr>
      <tr><th>공제액</th><td class="num">${won(p.deduction)}</td></tr>
      <tr><th>실지급액</th><td class="num"><strong>${won(p.net)}</strong></td></tr>
      ${(p.budget || []).map(b => `<tr><th>예산</th><td>${esc(b.label)} <span style="float:right">${won(b.amount)}</span></td></tr>`).join('')}
    </tbody></table>`;
    const rows = (p.rows || []).length
      ? `<table class="dc-table"><thead><tr><th>직원</th><th>직책</th><th>지급총액</th><th>공제액</th><th>실지급액</th><th>급여 근거</th></tr></thead>
          <tbody>${p.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.position || '')}</td><td class="num">${won(r.gross)}</td>
            <td class="num">${won(r.deduction)}</td><td class="num">${won(r.net)}</td><td>${r.contract ? '근로계약' : '계약 미등록'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="dc-note">직원별 금액은 이사장만 볼 수 있습니다. 인원과 합계만 표시합니다.</div>';
    return summary + rows;
  }

  function payrollFields(d) {
    const p = payrollOf(d);
    return `
      <div class="dc-note" style="margin-bottom:8px">급여 지급 결재입니다. 대상과 금액은 급여 관리의 명세를 따르며 이 화면에서는 고칠 수 없습니다.
        상신하는 순간의 급여 명세로 다시 맞춘 뒤 고정합니다. 명세를 바꿨다면 급여 관리에서 [지급 결재 올리기]를 다시 눌러 주세요.</div>
      ${payrollTable(p)}
      <div class="dc-note">공제액(소득세·4대보험)은 납부할 때까지 장부에 예수금으로 남습니다. 승인 뒤 지출완료를 확인하면 급여 명세 ${won(p.count)}건이 지급 완료로 바뀝니다.</div>
      ${p.noContract ? `<div class="dc-note" style="color:#b45309">근로계약이 등록되지 않은 직원 ${won(p.noContract)}명이 있습니다. 급여 근거가 되는 승인 문서를 오른쪽에서 연결하거나 품의 근거로 첨부해야 상신할 수 있습니다.</div>` : ''}`;
  }

  function payrollBudgetCard(d) {
    const p = payrollOf(d);
    const kv = (k, v) => `<div class="dc-kv"><span>${k}</span><strong>${won(v)}</strong></div>`;
    return `<div class="dc-card"><h4>예산 진행현황</h4>
      ${(p.budget || []).map(b => {
        const o = (budgets?.options || []).find(x => x.budgetAccountId === b.budgetAccountId);
        const after = o ? o.available - b.amount : null;
        return `<div style="font-size:13px;font-weight:600;margin-top:6px">${esc(b.label)}</div>
          ${o ? kv('사용가능액', o.available) : ''}${kv('이 결재 금액', b.amount)}${o ? kv('승인 후 예상 가용액', after) : ''}
          ${o && budgets.hasPlan && after < 0 ? '<div class="dc-note" style="color:var(--danger)">사용가능액을 넘습니다. 이대로는 최종 승인이 막힙니다.</div>' : ''}`;
      }).join('')}
      ${budgets && !budgets.hasPlan ? `<div class="dc-note">${budgets.year}년 승인 예산이 없어 사용가능액을 검사하지 않습니다.</div>` : ''}
    </div>`;
  }

  function itemTable(d) {
    const items = d.formData.items || (d.formData.items = [{}]);
    const total = items.reduce((t, i) => t + (Number(i.supply) || 0) + (Number(i.vat) || 0), 0);
    return `<div style="display:flex;align-items:center;margin:10px 0 4px"><strong style="flex:1">지출내역</strong>
        <button class="btn-sm btn-sm-ghost" type="button" id="dcItemAdd">행 추가</button></div>
      <table class="dc-table"><thead><tr><th>용도</th><th>내용</th><th>지급처 *</th><th>공급가액</th><th>부가세</th><th>합계</th><th></th></tr></thead>
      <tbody>${items.map((it, i) => `<tr>
        <td><input data-item="${i}" data-k="use" value="${esc(it.use || '')}"></td>
        <td><input data-item="${i}" data-k="content" value="${esc(it.content || '')}"></td>
        <td><input data-item="${i}" data-k="payee" value="${esc(it.payee || '')}"></td>
        <td><input data-item="${i}" data-k="supply" type="number" min="0" value="${esc(it.supply || '')}"></td>
        <td><input data-item="${i}" data-k="vat" type="number" min="0" value="${esc(it.vat || '')}"></td>
        <td class="num">${won((Number(it.supply) || 0) + (Number(it.vat) || 0))}</td>
        <td><button class="btn-sm btn-sm-ghost" type="button" data-item-del="${i}">×</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="5" style="text-align:right">총 지급액</th><th class="num" id="dcItemTotal">${won(total)}</th><th></th></tr></tfoot></table>`;
  }

  function payeeTable(d) {
    const rows = d.formData.payees || (d.formData.payees = [{}]);
    return `<div style="display:flex;align-items:center;margin:10px 0 4px"><strong style="flex:1">지급 정보</strong>
        <button class="btn-sm btn-sm-ghost" type="button" id="dcPayeeAdd">행 추가</button></div>
      <table class="dc-table"><thead><tr><th style="width:16%">지급처</th><th style="width:12%">은행</th><th style="width:21%">계좌</th><th style="width:13%">예금주</th><th style="width:17%">지급예정일</th><th style="width:16%">증빙</th><th></th></tr></thead>
      <tbody>${rows.map((p, i) => `<tr>
        <td><input data-payee="${i}" data-k="payee" value="${esc(p.payee || '')}"></td>
        <td><input data-payee="${i}" data-k="bank" value="${esc(p.bank || '')}"></td>
        <td><input data-payee="${i}" data-k="account" value="${esc(p.account || '')}"></td>
        <td><input data-payee="${i}" data-k="holder" value="${esc(p.holder || '')}"></td>
        <td><input data-payee="${i}" data-k="payDate" type="date" value="${esc(p.payDate || '')}"></td>
        <td><select data-payee="${i}" data-k="evidence"><option value="">선택</option>${EVIDENCE_TYPES.map(t => `<option${p.evidence === t ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><button class="btn-sm btn-sm-ghost" type="button" data-payee-del="${i}">×</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  function budgetRowTable(d) {
    const rows = d.formData.budgetRows || (d.formData.budgetRows = [{}]);
    return `<div style="display:flex;align-items:center;margin:10px 0 4px"><strong style="flex:1">소요예산 <span class="dc-note">계획 금액이며 예약하지 않습니다</span></strong>
        <button class="btn-sm btn-sm-ghost" type="button" id="dcRowAdd">행 추가</button></div>
      <table class="dc-table"><thead><tr><th>항목</th><th>금액</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td><input data-row="${i}" data-k="item" value="${esc(r.item || '')}"></td>
        <td><input data-row="${i}" data-k="amount" type="number" min="0" value="${esc(r.amount || '')}"></td>
        <td><button class="btn-sm btn-sm-ghost" type="button" data-row-del="${i}">×</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  function budgetOptions(d, query) {
    const q = String(query || '').trim().toLowerCase();
    const opts = (budgets?.options || []).filter(o => !q || `${o.label} ${o.code || ''}`.toLowerCase().includes(q));
    return '<option value="">예산 선택</option>' + opts.map(o =>
      `<option value="${esc(o.key)}"${o.key === d.budgetKey ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  }

  function expenseFields(d) {
    const opts = budgets?.options || [];
    const sel = opts.find(o => o.key === d.budgetKey);
    const manual = !sel || !sel.locked;
    return `
      <div class="dc-row"><label>예산 *</label><div>
        <input class="input-sm" id="dcBudgetQ" placeholder="예산명·코드·사업으로 찾기" style="width:100%;margin-bottom:4px">
        <select class="input" id="dcBudget">${budgetOptions(d, '')}</select></div></div>
      ${budgets && !budgets.hasPlan ? `<div class="dc-note">${budgets.year}년 승인 예산이 없어 사용가능액을 검사하지 않습니다.</div>` : ''}
      ${manual ? `<div class="dc-row2"><label>활동 *</label><select class="input" id="dcFn"><option value="">선택</option>${(tags.functions || []).map(f => `<option value="${f.code}"${d.functionCode === f.code ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
        <label>재원 *</label><select class="input" id="dcFund"><option value="">선택</option>${(tags.funds || []).map(f => `<option value="${f.id}"${d.fundId === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="dc-row"><label>사업</label><select class="input" id="dcProgram"${d.functionCode === 'service' ? '' : ' disabled'}><option value="">선택</option>${(tags.programs || []).map(p => `<option value="${p.id}"${d.programId === p.id ? ' selected' : ''}>${esc(p.name)}${p.charterRef ? '' : ' (정관 근거 없음)'}</option>`).join('')}</select></div>`
        : `<div class="dc-note">활동·사업·재원은 선택한 예산에서 가져옵니다: ${esc(FN_LABEL[sel.functionCode] || '')} ${esc(sel.programName || '')} ${esc(sel.fundName || '')}</div>`}
      <div class="dc-row2"><label>지급방법 *</label><select class="input" id="dcPayMethod"><option value="">선택</option>${Object.entries(meta.payMethods).filter(([k]) => k !== 'none').map(([k, v]) => `<option value="${k}"${d.payMethod === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <label>지출 구분 *</label><select class="input" id="dcExpenseKind"><option value="">선택</option>${Object.entries(meta.expenseKinds).map(([k, v]) => `<option value="${k}"${d.expenseKind === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      ${d.expenseKind === 'urgent' ? `<div class="dc-row"><label>긴급 사유 *</label><input class="input" data-f="urgentReason" value="${esc(d.formData.urgentReason || '')}"></div>` : ''}
      ${itemTable(d)}${payeeTable(d)}`;
  }

  function budgetCard(d) {
    const sel = (budgets?.options || []).find(o => o.key === d.budgetKey);
    const total = (d.formData.items || []).reduce((t, i) => t + (Number(i.supply) || 0) + (Number(i.vat) || 0), 0);
    if (!sel) return '<div class="dc-card"><h4>예산 진행현황</h4><div class="dc-note">예산을 고르면 표시됩니다.</div></div>';
    const kv = (k, v) => `<div class="dc-kv"><span>${k}</span><strong>${won(v)}</strong></div>`;
    return `<div class="dc-card" id="dcBudgetCard"><h4>예산 진행현황</h4>
      ${kv('현재예산', sel.planned)}${kv('지출완료 집행액', sel.executed)}${kv('미집행 예약액', sel.reserved)}
      ${kv('예산잔액', sel.remaining)}${kv('사용가능액', sel.available)}
      <hr style="border:0;border-top:1px solid var(--line,#e5e0d8);margin:6px 0">
      ${kv('작성금액', total)}${kv('승인 후 예상 가용액', sel.available - total)}
      ${budgets.hasPlan && sel.available - total < 0 ? '<div class="dc-note" style="color:var(--danger)">사용가능액을 넘습니다. 이대로는 최종 승인이 막힙니다.</div>' : ''}
    </div>`;
  }

  function sideHtml(d) {
    const line = d.formData.line || (d.formData.line = []);
    return `
      <div class="dc-card"><h4>결재라인 <span class="dc-note">${line.length}명</span></h4>
        ${d.formData.substitute ? '<div class="dc-note">승인 갈음은 결재선이 필요 없습니다.</div>' : ''}
        <div id="dcLines">${line.map((s, i) => lineHtml(s, i, line.length)).join('')}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn-sm btn-sm-ghost" type="button" id="dcLineApprove">+ 결재</button>
          <button class="btn-sm btn-sm-ghost" type="button" id="dcLineConsult">+ 합의</button>
          <button class="btn-sm btn-sm-ghost" type="button" id="dcLineRecommend">추천 결재선</button>
        </div>
        <div style="display:flex;gap:4px;margin-top:6px">
          <select class="input-sm" id="dcLineSaved" style="flex:1"><option value="">저장된 결재선</option></select>
          <button class="btn-sm btn-sm-ghost" type="button" id="dcLineSave">저장</button>
        </div>
        <div class="dc-note">담당자는 기안자가 정합니다. 마지막 단계는 결재입니다.</div>
      </div>
      <div class="dc-card"><h4>참조자</h4>
        <div id="dcWatchers">${(d.watchers || []).map(id => `<span class="dc-badge" style="margin:2px">${esc(people.find(p => p.id === id)?.name || id)} <a href="#" data-watch-del="${id}">×</a></span>`).join('')}</div>
        <select class="input-sm" id="dcWatchAdd" style="width:100%;margin-top:4px"><option value="">참조자 추가</option>${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div class="dc-card"><h4>근거 및 관련 문서 <span class="dc-note">${(d.references || []).length}건</span></h4>
        <div id="dcRefs">${(d.references || []).map(r => `<div class="dc-kv"><span>${esc(r.docNo)} ${esc(r.title)}</span>
          <span style="white-space:nowrap"><select class="input-sm" data-ref-kind="${r.id}"><option value="related"${r.refKind !== 'basis' ? ' selected' : ''}>관련</option><option value="basis"${r.refKind === 'basis' ? ' selected' : ''}>근거</option></select>
          <a href="#" data-ref-del="${r.id}">×</a></span></div>`).join('') || '<div class="dc-note">연결된 문서가 없습니다.</div>'}</div>
        <div style="display:flex;gap:4px;margin-top:6px"><input class="input-sm" id="dcRefQ" placeholder="문서번호·제목·작성자" style="flex:1;min-width:0">
          <select class="input-sm" id="dcRefType" style="width:84px"><option value="">유형</option>${DOC_ORDER.map(k => `<option value="${k}">${esc(meta.docTypes[k].label)}</option>`).join('')}</select></div>
        <div style="display:flex;gap:4px;margin-top:4px"><input class="input-sm" id="dcRefFrom" type="date" style="flex:1;min-width:0"><input class="input-sm" id="dcRefTo" type="date" style="flex:1;min-width:0">
          <button class="btn-sm btn-sm-ghost" type="button" id="dcRefSearch">검색</button></div>
        <div id="dcRefResult"></div>
      </div>
      <div class="dc-card"><h4>첨부파일 <span class="dc-note">${(d.files || []).length}개</span></h4>
        <div id="dcFiles">${(d.files || []).map(f => `<div class="dc-kv"><span><a href="/api/admin-docs-file?id=${f.id}" target="_blank" rel="noopener">${esc(f.fileName)}</a> <span class="dc-note">${esc(meta.fileKinds[f.fileKind] || '')}</span></span><a href="#" data-file-del="${f.id}">×</a></span></div>`).join('')}</div>
        <select class="input-sm" id="dcFileKind" style="width:100%;margin-top:4px">${Object.entries(meta.fileKinds).filter(([k]) => k !== 'additional').map(([k, v]) =>
          `<option value="${k}"${d.docType === 'expense' && k === (payrollOf(d) ? 'proposal' : 'payment') ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <input type="file" id="dcFile" style="margin-top:6px;width:100%">
        ${payrollOf(d) ? '<div class="dc-note">직원별 금액이 담긴 파일은 붙이지 마세요. 문서를 여는 사람 모두에게 보입니다.</div>' : ''}
      </div>
      ${d.docType === 'expense' ? (payrollOf(d) ? payrollBudgetCard(d) : budgetCard(d)) : ''}`;
  }

  function composeHtml() {
    const d = draft;
    const guide = meta.guides?.[d.docType]?.guide;
    const form = d.formData;
    return `
      <div class="panel">
        <div class="p-head"><div class="p-title">결재문서 작성</div>
          <div class="p-actions">
            <span class="dc-note" id="dcAutoNote"></span>
            <button class="btn-sm btn-sm-ghost" type="button" id="dcSave">임시저장</button>
            <button class="btn-sm btn-sm-ghost" type="button" id="dcPreview">미리보기</button>
            <button class="btn-sm btn-sm-primary" type="button" id="dcSubmit">상신</button>
          </div></div>
        ${d.id ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${DOC_ORDER.map(k =>
          `<button class="btn-sm ${d.docType === k ? 'btn-sm-primary' : 'btn-sm-ghost'}" type="button" data-type="${k}">${esc(meta.docTypes[k].label)}</button>`).join('')}</div>`}
        <div id="dcError" style="display:none;color:var(--danger);white-space:pre-line;font-size:13px;margin-bottom:8px"></div>
        <div class="dc-grid">
          <div class="dc-paper">
            <h2>${esc(meta.docTypes[d.docType].label.replace(/ /g, ' '))}</h2>
            ${signTable(form.line || [])}
            <div class="dc-row2"><label>문서번호</label><div style="font-size:13px;color:var(--text-3)">${esc(d.docNo || '상신 시 자동 부여')}</div>
              <label>작성일</label><div style="font-size:13px">${today()}</div></div>
            <div class="dc-row2"><label>기안자</label><div style="font-size:13px">${esc(meta.me.name)}</div>
              <label>직책</label><div style="font-size:13px">${esc(myTitle())}</div></div>
            <div class="dc-row"><label>제목 *</label><input class="input" id="dcTitle" value="${esc(d.title || '')}"></div>
            ${d.docType === 'expense' ? (payrollOf(d) ? payrollFields(d) : expenseFields(d)) : typeFields(d)}
            ${d.docType === 'proposal' ? budgetRowTable(d) : ''}
            ${guide ? `<div class="dc-note" style="white-space:pre-line;margin-top:8px">${esc(guide)}</div>` : ''}
            <div style="margin-top:10px"><strong>${d.docType === 'internal' ? '신청 내용' : d.docType === 'proposal' ? '품의 내용 *' : '내용'}</strong></div>
            <div class="dc-tools">
              <button class="btn-sm btn-sm-ghost" type="button" data-cmd="bold"><b>가</b></button>
              <button class="btn-sm btn-sm-ghost" type="button" data-cmd="underline"><u>가</u></button>
              <button class="btn-sm btn-sm-ghost" type="button" data-cmd="insertUnorderedList">• 목록</button>
              <button class="btn-sm btn-sm-ghost" type="button" data-cmd="removeFormat">서식 지우기</button>
            </div>
            <div class="dc-editor" id="dcBody" contenteditable="true">${d.body || ''}</div>
          </div>
          <div id="dcSide">${sideHtml(d)}</div>
        </div>
      </div>`;
  }

  /* 입력값을 draft로 옮긴다. 화면을 다시 그리기 전에 부른다 */
  function collect() {
    const c = page('new');
    const d = draft;
    d.title = c.querySelector('#dcTitle')?.value ?? d.title;
    const editor = c.querySelector('#dcBody');
    if (editor) d.body = editor.innerHTML;
    c.querySelectorAll('[data-f]').forEach(el => { d.formData[el.dataset.f] = el.value; });
    const sub = c.querySelector('#dcSubstitute');
    if (sub) d.formData.substitute = sub.checked;
    const pay = c.querySelector('#dcPayMethod');
    if (pay) d.payMethod = pay.value;
    const kind = c.querySelector('#dcExpenseKind');
    if (kind) d.expenseKind = kind.value;
    const fn = c.querySelector('#dcFn');
    if (fn) d.functionCode = fn.value || null;
    const fund = c.querySelector('#dcFund');
    if (fund) d.fundId = Number(fund.value) || null;
    const program = c.querySelector('#dcProgram');
    if (program) d.programId = Number(program.value) || null;
    const set = (attr, list) => c.querySelectorAll(`[data-${attr}]`).forEach(el => {
      const i = Number(el.dataset[attr]);
      if (list[i]) list[i][el.dataset.k] = el.value;
    });
    set('item', d.formData.items || []);
    set('payee', d.formData.payees || []);
    set('row', d.formData.budgetRows || []);
    c.querySelectorAll('[data-line-type]').forEach(el => { const s = (d.formData.line || [])[Number(el.dataset.lineType)]; if (s) s.type = el.value; });
    c.querySelectorAll('[data-line-member]').forEach(el => {
      const s = (d.formData.line || [])[Number(el.dataset.lineMember)];
      if (!s) return;
      s.memberId = Number(el.value) || 0;
      const p = people.find(x => x.id === s.memberId);
      s.name = p?.name || '';
      s.title = p?.title || ROLE_LABEL[p?.role] || null;
    });
    c.querySelectorAll('[data-ref-kind]').forEach(el => {
      const r = (d.references || []).find(x => x.id === Number(el.dataset.refKind));
      if (r) r.refKind = el.value;
    });
    const plain = (editor?.innerText || '').trim();
    d.formData.reasonText = plain.slice(0, 500);
    const firstPay = (d.formData.payees || []).find(p => p.payDate);
    if (firstPay) d.formData.payDate = firstPay.payDate;
  }

  function payload() {
    const d = draft;
    const opt = (budgets?.options || []).find(o => o.key === d.budgetKey);
    return {
      id: d.id || undefined, docType: d.docType, title: d.title, body: d.body, formData: d.formData,
      payMethod: d.payMethod, expenseKind: d.expenseKind,
      budgetAccountId: opt?.budgetAccountId ?? null, budgetSplitId: opt?.splitId ?? null, budgetYear: budgets?.year ?? null,
      functionCode: opt?.locked ? undefined : d.functionCode, programId: opt?.locked ? undefined : d.programId,
      fundId: opt?.locked ? undefined : d.fundId,
      references: (d.references || []).map(r => ({ targetId: r.id, refKind: r.refKind })), watchers: d.watchers || [],
    };
  }

  function showError(text) {
    const el = page('new').querySelector('#dcError');
    if (!el) { alert(text); return; }
    el.textContent = text;
    el.style.display = text ? '' : 'none';
    if (text) el.scrollIntoView({ block: 'center' });
  }

  async function saveNow() {
    if (saving) await saving;
    collect();
    saving = post({ action: 'save', ...payload() });
    const res = await saving;
    saving = null;
    if (res.ok && draft) {
      draft.id = dataOf(res).id;
      lastSaved = JSON.stringify(payload());
    }
    return res;
  }

  async function saveCurrent() {
    const res = await saveNow();
    if (!res.ok) { showError(failText(res)); return false; }
    showError('');
    return true;
  }

  /* 1분마다 바뀐 내용만 저장한다. 화면이 숨겨져 있거나 빈 문서면 저장하지 않는다 */
  function startAutosave() {
    if (autoTimer) return;
    autoTimer = setInterval(async () => {
      const c = page('new');
      if (!draft || !c || !c.offsetParent || !c.querySelector('#dcTitle') || document.hidden || saving) return;
      collect();
      if (!(draft.title || '').trim() && !(draft.formData.reasonText || '').trim()) return;
      if (JSON.stringify(payload()) === lastSaved) return;
      const res = await saveNow();
      const note = c.querySelector('#dcAutoNote');
      if (res.ok && note) note.textContent = '자동 저장 ' + new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);
    }, 60000);
  }

  async function reloadFiles() {
    const res = await get(`view=detail&id=${draft.id}`);
    if (res.ok) draft.files = dataOf(res).files || [];
    repaint();
  }

  function repaint() {
    const c = page('new');
    c.innerHTML = styled(composeHtml());
    bindCompose();
  }

  async function uploadFile(file, fileKind) {
    if (!draft.id && !(await saveCurrent())) return;
    const contentType = fileType(file);
    const pres = await post({ action: 'file_presign', fileName: file.name, contentType, sizeBytes: file.size });
    if (!pres.ok) { showError(failText(pres)); return; }
    const { id: blobId, uploadUrl } = dataOf(pres);
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: buffer });
    if (!put.ok) { showError('파일 업로드 실패: HTTP ' + put.status); return; }
    await api('POST', '/api/blob-confirm', { id: blobId });
    const add = await post({ action: 'file_add', id: draft.id, blobId, fileKind, sha256 });
    if (!add.ok) { showError(failText(add)); return; }
    await reloadFiles();
  }

  function bindCompose() {
    const c = page('new');
    const d = draft;
    const on = (sel, fn) => c.querySelector(sel)?.addEventListener('click', fn);
    c.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { draft = { id: null, docType: b.dataset.type, formData: {}, references: [], watchers: [], files: [] }; repaint(); }));
    c.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => { document.execCommand(b.dataset.cmd); c.querySelector('#dcBody').focus(); }));
    on('#dcSave', async () => { if (await saveCurrent()) { alert('임시저장했습니다.'); repaint(); } });
    on('#dcPreview', () => { collect(); printDoc(previewDoc(), true); });
    on('#dcSubmit', async () => {
      if (!(await saveCurrent())) return;
      if (!confirm(payrollOf(draft)
        ? '상신하면 급여 명세의 지금 금액으로 문서를 다시 맞춘 뒤 승인 대상으로 고정합니다. 결재가 끝날 때까지 이 급여는 급여 관리에서 고칠 수 없습니다. 상신할까요?'
        : '상신하면 본문·첨부·참조·결재선이 승인 대상으로 고정됩니다. 상신할까요?')) return;
      const res = await post({ action: 'submit', id: draft.id });
      if (!res.ok) { showError(failText(res)); return; }
      alert(`상신했습니다. ${dataOf(res).docNo}`);
      draft = null;
      go('mine');
    });
    c.querySelector('#dcKind')?.addEventListener('change', () => { collect(); repaint(); });
    c.querySelector('#dcExpenseKind')?.addEventListener('change', () => { collect(); repaint(); });
    c.querySelector('#dcFn')?.addEventListener('change', () => { collect(); repaint(); });
    c.querySelector('#dcBudget')?.addEventListener('change', e => { collect(); d.budgetKey = e.target.value; repaint(); });
    c.querySelector('#dcBudgetQ')?.addEventListener('input', e => { c.querySelector('#dcBudget').innerHTML = budgetOptions(d, e.target.value); });
    c.querySelector('#dcSubstitute')?.addEventListener('change', () => { collect(); repaint(); });

    const rowOps = (addId, list, attrDel) => {
      on(addId, () => { collect(); list().push({}); repaint(); });
      c.querySelectorAll(`[data-${attrDel}]`).forEach(b => b.addEventListener('click', () => {
        collect(); list().splice(Number(b.dataset[attrDel.replace(/-(\w)/g, (m, x) => x.toUpperCase())]), 1); repaint();
      }));
    };
    rowOps('#dcItemAdd', () => d.formData.items, 'item-del');
    rowOps('#dcPayeeAdd', () => d.formData.payees, 'payee-del');
    rowOps('#dcRowAdd', () => d.formData.budgetRows, 'row-del');
    c.querySelectorAll('[data-item]').forEach(el => el.addEventListener('change', () => { collect(); repaint(); }));

    /* 결재선 */
    const line = () => d.formData.line;
    on('#dcLineApprove', () => { collect(); line().push({ type: 'approve', memberId: 0 }); repaint(); });
    on('#dcLineConsult', () => { collect(); line().splice(Math.max(0, line().length - 1), 0, { type: 'consult', memberId: 0 }); repaint(); });
    c.querySelectorAll('[data-line-member],[data-line-type]').forEach(el => el.addEventListener('change', () => { collect(); repaint(); }));
    c.querySelectorAll('[data-line-del]').forEach(b => b.addEventListener('click', () => { collect(); line().splice(Number(b.dataset.lineDel), 1); repaint(); }));
    const swap = (i, j) => { collect(); const l = line(); [l[i], l[j]] = [l[j], l[i]]; repaint(); };
    c.querySelectorAll('[data-line-up]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.lineUp), Number(b.dataset.lineUp) - 1)));
    c.querySelectorAll('[data-line-down]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.lineDown), Number(b.dataset.lineDown) + 1)));
    on('#dcLineRecommend', async () => {
      collect();
      const amount = (d.formData.items || []).reduce((t, i) => t + (Number(i.supply) || 0) + (Number(i.vat) || 0), 0)
        || (d.formData.budgetRows || []).reduce((t, r) => t + (Number(r.amount) || 0), 0) || Number(d.formData.plannedAmount) || 0;
      const res = await get(`view=recommend&amount=${amount}`);
      const r = dataOf(res);
      if (!r.steps?.length) { alert('이 금액의 추천 결재선이 없습니다.'); return; }
      d.formData.line = r.steps;
      repaint();
    });
    get('view=lines').then(res => {
      const sel = c.querySelector('#dcLineSaved');
      if (!sel || !res.ok) return;
      const lines = dataOf(res).lines || [];
      sel.insertAdjacentHTML('beforeend', lines.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join(''));
      sel.addEventListener('change', () => {
        const l = lines.find(x => x.id === Number(sel.value));
        if (!l) return;
        collect();
        d.formData.line = l.steps;
        repaint();
      });
    });
    on('#dcLineSave', async () => {
      collect();
      const name = prompt('결재선 이름');
      if (!name) return;
      const res = await post({ action: 'line_save', name, steps: d.formData.line });
      if (!res.ok) showError(failText(res)); else repaint();
    });

    /* 참조자 */
    c.querySelector('#dcWatchAdd')?.addEventListener('change', e => {
      collect();
      const id = Number(e.target.value);
      if (id && !d.watchers.includes(id)) d.watchers.push(id);
      repaint();
    });
    c.querySelectorAll('[data-watch-del]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault(); collect(); d.watchers = d.watchers.filter(x => x !== Number(a.dataset.watchDel)); repaint();
    }));

    /* 문서 연결 */
    on('#dcRefSearch', async () => {
      const box = c.querySelector('#dcRefResult');
      const qs = new URLSearchParams({ view: 'search', q: c.querySelector('#dcRefQ').value, exclude: d.id || 0 });
      [['docType', '#dcRefType'], ['from', '#dcRefFrom'], ['to', '#dcRefTo']].forEach(([k, sel]) => { const v = c.querySelector(sel).value; if (v) qs.set(k, v); });
      const res = await get(qs.toString());
      const items = dataOf(res).items || [];
      box.innerHTML = items.map(r => `<div class="dc-kv"><span>${esc(r.docNo)} ${esc(r.title)} <span class="dc-note">${esc(r.docLabel)} · ${esc(r.statusLabel)}</span></span><button class="btn-sm btn-sm-ghost" type="button" data-ref-add="${r.id}">연결</button></div>`).join('')
        || '<div class="dc-note">찾은 문서가 없습니다.</div>';
      box.querySelectorAll('[data-ref-add]').forEach(b => b.addEventListener('click', () => {
        collect();
        const r = items.find(x => x.id === Number(b.dataset.refAdd));
        if (r && !d.references.some(x => x.id === r.id)) {
          d.references.push({ id: r.id, docNo: r.docNo, title: r.title, docLabel: r.docLabel, docType: r.docType, refKind: r.docType === 'proposal' ? 'basis' : 'related' });
        }
        repaint();
      }));
    });
    c.querySelectorAll('[data-ref-del]').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault(); collect(); d.references = d.references.filter(x => x.id !== Number(a.dataset.refDel)); repaint();
    }));

    /* 첨부 */
    c.querySelector('#dcFile')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) { showError('파일은 50MB 이하여야 합니다.'); return; }
      collect();
      await uploadFile(file, c.querySelector('#dcFileKind').value);
    });
    c.querySelectorAll('[data-file-del]').forEach(a => a.addEventListener('click', async ev => {
      ev.preventDefault();
      const res = await post({ action: 'file_remove', id: d.id, fileId: Number(a.dataset.fileDel) });
      if (!res.ok) showError(failText(res)); else await reloadFiles();
    }));
  }

  async function renderCompose(editId) {
    const c = page('new');
    if (editId) {
      const res = await get(`view=detail&id=${editId}`);
      if (!res.ok) { c.innerHTML = `<div class="panel" style="color:var(--danger)">${esc(failText(res))}</div>`; return; }
      const x = dataOf(res);
      draft = {
        id: x.id, docNo: x.docNo, docType: x.docType, title: x.title, body: x.body, formData: x.formData || {}, payMethod: x.payMethod,
        expenseKind: x.expenseKind, functionCode: x.functionCode, programId: x.programId, fundId: x.fundId,
        budgetKey: x.budgetSplitId ? `s${x.budgetSplitId}` : x.budgetAccountId ? `m${x.budgetAccountId}` : '',
        references: x.references.map(r => ({ id: r.id, docNo: r.docNo, title: r.title, docLabel: r.docLabel, refKind: r.refKind })),
        watchers: x.watchers.filter(w => w.kind === 'reference').map(w => w.memberId), files: x.files,
      };
    }
    if (!draft) {
      const params = new URLSearchParams(location.search);
      const docType = params.get('docType') || 'proposal';
      const formData = {};
      [['kind', 'kind'], ['from', 'periodFrom'], ['to', 'periodTo'], ['leaveTypeId', 'leaveTypeId'], ['half', 'halfDayPeriod']].forEach(([q, k]) => {
        if (params.get(q)) formData[k] = params.get(q);
      });
      draft = { id: null, docType, formData, references: [], watchers: [], files: [] };
    }
    const res = await get('view=budgets');
    budgets = res.ok ? dataOf(res) : (budgets || { options: [], hasPlan: false });
    repaint();
    collect();
    lastSaved = JSON.stringify(payload());
    startAutosave();
  }

  function previewDoc() {
    const d = draft;
    const f = d.formData;
    const opt = (budgets?.options || []).find(o => o.key === d.budgetKey);
    const sum = (list, read) => (list || []).reduce((t, r) => t + read(r), 0);
    const amount = d.docType === 'expense' ? sum(f.items, i => (Number(i.supply) || 0) + (Number(i.vat) || 0))
      : d.docType === 'proposal' ? sum(f.budgetRows, r => Number(r.amount) || 0) : Number(f.plannedAmount) || 0;
    return {
      docLabel: meta.docTypes[d.docType].label, docNo: d.docNo || '(상신 시 부여)', title: d.title, body: d.body, formData: f,
      docType: d.docType, drafterName: meta.me.name, amount, isPayroll: !!payrollOf(d),
      payMethodLabel: meta.payMethods[d.payMethod] || null, expenseKindLabel: meta.expenseKinds[d.expenseKind] || null,
      internalKindLabel: meta.internalKinds[f.kind]?.label || null,
      functionCode: opt?.locked ? opt.functionCode : d.functionCode,
      budgetInfo: d.docType === 'expense' ? {
        path: opt ? opt.label.split(' · ')[0] : null,
        programName: opt?.locked ? opt.programName : (tags.programs || []).find(p => p.id === d.programId)?.name,
        fundName: opt?.locked ? opt.fundName : (tags.funds || []).find(p => p.id === d.fundId)?.name,
      } : null,
      steps: (d.formData.line || []).map(s => ({ stepType: s.type, assigneeName: s.name, decision: 'pending' })),
      references: d.references || [], files: d.files || [],
    };
  }

  /* ── 문서 상세 ── */
  function fieldRows(x) {
    const f = x.formData || {};
    const row = (k, v) => (v ? `<tr><th style="width:120px">${k}</th><td style="white-space:pre-wrap">${esc(v)}</td></tr>` : '');
    const period = f.periodFrom ? `${f.periodFrom}${f.periodTo ? ' ~ ' + f.periodTo : ''}` : '';
    if (x.docType === 'proposal') {
      return row('사업명', f.projectName) + row('시행기간', period) + row('재원', f.fundText) + row('지출 방식', x.payMethodLabel);
    }
    if (x.docType === 'internal') {
      return row('신청 구분', x.internalKindLabel) + row('기간', period) + row('장소', f.place) + row('대상', f.target)
        + row('시간', f.timeText || (HALF_PERIODS[f.halfDayPeriod || ''] === '종일' ? '' : HALF_PERIODS[f.halfDayPeriod || '']));
    }
    if (x.docType === 'card') {
      return row('사용 목적', f.usePurpose) + row('사용 기간', period) + row('예정금액', won(f.plannedAmount)) + row('카드', f.cardLabel)
        + row('사용자', x.drafterName) + row('사용일', f.usedOn) + row('실제 사용액', f.actualAmount != null ? won(f.actualAmount) : '')
        + row('승인 방식', x.approvalMode === 'substituted' ? '승인 갈음' : '');
    }
    if (x.docType === 'seal') {
      return row('인감 종류', f.sealType) + row('사용 목적', f.usePurpose) + row('제출처', f.submitTo) + row('사용일', f.useDate)
        + row('날인 대상', f.sealTarget) + row('부수', f.copies);
    }
    if (x.docType === 'expense') {
      const info = x.budgetInfo || {};
      return row('예산', x.isPayroll ? '' : info.path) + row('활동', FN_LABEL[x.functionCode]) + row('사업', info.programName) + row('재원', info.fundName)
        + row('지출 구분', x.expenseKindLabel) + row('지급방법', x.payMethodLabel) + row('긴급 사유', f.urgentReason)
        + row('결의번호', x.resolutionNo) + row('지급일', x.paidAt) + (x.paidAmount != null && x.paidAmount !== x.amount ? row('실제 지급액', won(x.paidAmount)) : '');
    }
    return '';
  }
  function expenseTables(x) {
    const f = x.formData || {};
    if (x.docType === 'proposal' && (f.budgetRows || []).length) {
      return `<table class="dc-table"><thead><tr><th>소요예산 항목</th><th>금액</th></tr></thead><tbody>${f.budgetRows.map(r =>
        `<tr><td>${esc(r.item)}</td><td class="num">${won(r.amount)}</td></tr>`).join('')}</tbody></table>`;
    }
    if (x.docType !== 'expense') return '';
    if (payrollOf(x)) return payrollTable(payrollOf(x));
    return `<table class="dc-table"><thead><tr><th>용도</th><th>내용</th><th>지급처</th><th>공급가액</th><th>부가세</th><th>합계</th></tr></thead>
      <tbody>${(f.items || []).map(i => `<tr><td>${esc(i.use)}</td><td>${esc(i.content)}</td><td>${esc(i.payee)}</td>
        <td class="num">${won(i.supply)}</td><td class="num">${won(i.vat)}</td><td class="num">${won((Number(i.supply) || 0) + (Number(i.vat) || 0))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="5" style="text-align:right">총 지급액</th><th class="num">${won(x.amount)}</th></tr></tfoot></table>
      ${(f.payees || []).some(p => p.payee || p.bank) ? `<table class="dc-table"><thead><tr><th>지급처</th><th>은행</th><th>계좌</th><th>예금주</th><th>지급예정일</th><th>증빙</th></tr></thead><tbody>${f.payees.map(p =>
        `<tr><td>${esc(p.payee)}</td><td>${esc(p.bank)}</td><td>${esc(p.account)}</td><td>${esc(p.holder)}</td><td>${esc(p.payDate)}</td><td>${esc(p.evidence)}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }
  const CARD_BASIS_NOTE = x => (x.formData?.actualAmount != null ? '거래 취소·반환 확인 필요' : '취소 대상');
  const DECISION_LABEL = { approved: '승인', rejected: '반려', pending: '대기', canceled: '중단' };
  function stepTable(steps) {
    return `<table class="dc-table"><thead><tr><th>구분</th><th>담당</th><th>처리</th><th>시각</th><th>의견</th></tr></thead>
      <tbody>${steps.map(s => `<tr><td>${s.stepType === 'consult' ? '합의' : '결재'}</td><td>${esc(s.assigneeName || '')} ${esc(s.assigneeTitle || '')}</td>
        <td>${s.stepType === 'consult' && s.decision === 'approved' ? '동의' : DECISION_LABEL[s.decision] || s.decision}</td><td>${esc(String(s.decidedAt || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(s.comment || '')}</td></tr>`).join('')
        || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">결재선이 없습니다.</td></tr>'}</tbody></table>`;
  }

  async function openDetail(container, id, back) {
    if (!container) return;
    container.innerHTML = styled('<div class="panel">불러오는 중…</div>');
    const res = await get(`view=detail&id=${id}`);
    if (!res.ok) { container.innerHTML = `<div class="panel" style="color:var(--danger);white-space:pre-line">${esc(failText(res))}</div>`; return; }
    const x = dataOf(res);
    const a = x.actions || {};
    const btn = (label, act, cls) => `<button class="btn-sm ${cls || 'btn-sm-ghost'}" type="button" data-act="${act}">${label}</button>`;
    const buttons = [
      a.edit ? btn('수정', 'edit', 'btn-sm-primary') : '',
      a.recall ? btn('회수', 'recall') : '',
      a.decide ? btn(a.decide === 'consult' ? '동의' : '승인', 'approve', 'btn-sm-primary') + btn('반려', 'reject', 'btn-sm-danger') : '',
      a.cancelDecide ? btn('취소 승인', 'cancel-approve', 'btn-sm-primary') + btn('취소 반려', 'cancel-reject', 'btn-sm-danger') : '',
      a.pay ? btn('지출완료 확인', 'pay', 'btn-sm-primary') : '',
      a.refund ? btn('반환 확인', 'refund', 'btn-sm-primary') : '',
      a.followup ? btn('사후 품의 연결', 'followup', 'btn-sm-primary') : '',
      a.cardUse ? btn('카드 사용 등록', 'card-use', 'btn-sm-primary') : '',
      a.cardUsage ? btn(x.formData?.actualAmount != null ? '사용 내역 수정' : '사용 내역 등록', 'card-usage') : '',
      a.cancelRequest ? btn('취소 요청', 'cancel-request') : '',
      a.delete ? btn('일반 삭제', 'delete', 'btn-sm-danger') : '',
      a.purge ? btn('완전삭제', 'purge', 'btn-sm-danger') : '',
      isChair() && x.deleteStatus === 'deleted' ? btn(x.holdReason ? '보존 중지 해제' : '보존 중지', 'hold') : '',
      x.resolutionPdfUrl ? `<a class="btn-sm btn-sm-ghost" style="text-decoration:none" href="${esc(x.resolutionPdfUrl)}" target="_blank" rel="noopener">결의서 PDF</a>` : '',
      btn('인쇄', 'print'),
    ].filter(Boolean).join(' ');
    const b = x.budget;
    const kv = (k, v) => `<div class="dc-kv"><span>${k}</span><strong>${won(v)}</strong></div>`;
    container.innerHTML = styled(`
      <div class="panel">
        <div class="p-head"><div class="p-title"><a href="#" id="dcBack" style="font-weight:400;font-size:13px">← 목록</a> ${esc(x.docLabel)} ${esc(x.docNo || '')} ${x.version > 1 ? `<span class="dc-note">버전 ${x.version}</span>` : ''}</div>
          <div class="p-actions">${buttons}</div></div>
        <div class="dc-grid">
          <div class="dc-paper">
            <h2>${esc(x.docLabel)}</h2>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              ${badge(x)}
              ${x.docType === 'expense' ? `<span class="dc-badge">${x.paymentStatus === 'paid' ? '지출완료' : x.paymentStatus === 'unpaid' ? '지출확인 대기' : '미지출'}</span>` : ''}
              ${x.cancelStatus !== 'none' ? `<span class="dc-badge bad">${esc(cancelText(x))}</span>` : ''}
              ${x.refundStatus === 'required' ? '<span class="dc-badge wait">반환 확인 대기</span>' : ''}
              ${x.followupDue ? '<span class="dc-badge wait">사후 품의 필요</span>' : ''}
              ${x.isPayroll ? '<span class="dc-badge">급여 지급 결재</span>' : ''}
              ${x.basisCanceled ? `<span class="dc-badge bad">근거 품의 취소: ${esc(CARD_BASIS_NOTE(x))}</span>` : ''}
            </div>
            <table class="dc-table"><tbody>
              <tr><th style="width:120px">제목</th><td>${esc(x.title)}</td></tr>
              <tr><th>기안자</th><td>${esc(x.drafterName)} · ${esc(day(x.submittedAt || x.createdAt))}</td></tr>
              ${fieldRows(x)}
            </tbody></table>
            ${expenseTables(x)}
            ${x.body ? `<div class="dc-editor" style="min-height:0">${x.body}</div>` : ''}
            ${x.cancelReason ? `<div class="dc-card" style="margin-top:10px"><h4>취소 사유</h4>${esc(x.cancelReason)}</div>` : ''}
            <div class="dc-card" style="margin-top:12px"><h4>결재 이력</h4>${stepTable(x.steps)}
              ${x.cancelSteps.length ? `<h4>취소 결재</h4>${stepTable(x.cancelSteps)}` : ''}
              ${x.versions.length > 1 ? `<div class="dc-note">이전 버전: ${x.versions.filter(v => v.version !== x.version).map(v => `<a href="#" data-version="${v.version}">v${v.version}</a>`).join(' ')}</div>` : ''}
            </div>
            <div class="dc-card"><h4>댓글</h4>
              ${x.comments.map(cm => `<div style="font-size:13px;margin-bottom:4px"><strong>${esc(cm.name)}</strong> ${esc(cm.body)} <span class="dc-note">${esc(String(cm.createdAt).slice(0, 16).replace('T', ' '))}</span></div>`).join('')}
              <div style="display:flex;gap:4px"><input class="input-sm" id="dcComment" style="flex:1"><button class="btn-sm btn-sm-ghost" type="button" data-act="comment">등록</button></div>
            </div>
          </div>
          <div>
            <div class="dc-card"><h4>근거 및 관련 문서</h4>
              ${x.references.map(r => `<div class="dc-kv"><a href="#" data-doc="${r.id}">${esc(r.docNo)} ${esc(r.title)}</a><span class="dc-note">${r.refKind === 'basis' ? '근거' : '관련'} · v${r.linkedVersion || 1} · ${esc(r.deleted ? '삭제' : r.canceled ? '취소' : r.statusLabel)}</span></div>`).join('') || '<div class="dc-note">없습니다.</div>'}
              ${x.referencedBy.length ? `<div class="dc-note" style="margin-top:6px">이 문서를 참조한 문서</div>${x.referencedBy.map(r => `<div class="dc-kv"><a href="#" data-doc="${r.id}">${esc(r.docNo)} ${esc(r.title)}</a><span class="dc-note">${esc(r.statusLabel)}</span></div>`).join('')}` : ''}
            </div>
            <div class="dc-card"><h4>첨부파일</h4>
              ${x.files.map(f => `<div class="dc-kv"><a href="/api/admin-docs-file?id=${f.id}" target="_blank" rel="noopener">${esc(f.fileName)}</a><span class="dc-note">${esc(meta.fileKinds[f.fileKind] || '')}</span></div>`).join('') || '<div class="dc-note">없습니다.</div>'}
              ${a.addFile ? '<div class="dc-note" style="margin-top:6px">추가증빙 첨부 (승인본은 그대로 보존됩니다)</div><input type="file" id="dcAddFile" style="width:100%">' : ''}
            </div>
            ${x.watchers.length ? `<div class="dc-card"><h4>참조자</h4>${x.watchers.map(w => esc(w.name)).join(', ')}</div>` : ''}
            ${x.cardScope ? `<div class="dc-card"><h4>카드 승인범위</h4>${kv('품의 금액', x.cardScope.approved)}${kv('사용 누계', x.cardScope.used)}${kv('남은 범위', x.cardScope.remaining)}</div>` : ''}
            ${x.isPayroll && x.status === 'approved' && x.paymentStatus === 'unpaid' && !a.pay ? '<div class="dc-card"><h4>급여 지급 확인</h4><div class="dc-note">급여 지급 확인은 이사장이 합니다. 확인하면 급여 명세가 한꺼번에 지급 완료로 바뀌고 장부에 급여 전표가 만들어집니다.</div></div>' : ''}
            ${(x.payrollBudget || []).length ? `<div class="dc-card"><h4>예산 진행현황</h4>${x.payrollBudget.map(pb => `<div style="font-size:13px;font-weight:600;margin-top:6px">${esc(pb.label)}</div>
              ${pb.hasPlan ? kv('현재예산', pb.planned) + kv('지출완료 집행액', pb.executed) + kv('미집행 예약액', pb.reserved) + kv('사용가능액', pb.available) : ''}${kv('이 결재 금액', pb.amount)}
              ${pb.hasPlan && x.status !== 'approved' && x.status !== 'canceled' ? kv('승인 후 예상 가용액', pb.expectedAvailable) : ''}`).join('')}
              ${x.payrollBudget.some(pb => !pb.hasPlan) ? '<div class="dc-note">승인된 예산안이 없어 사용가능액을 검사하지 않습니다.</div>' : ''}</div>` : ''}
            ${b ? `<div class="dc-card"><h4>예산 진행현황</h4>${kv('현재예산', b.planned)}${kv('지출완료 집행액', b.executed)}${kv('미집행 예약액', b.reserved)}${kv('예산잔액', b.remaining)}${kv('사용가능액', b.available)}
              ${b.draftAmount ? `${kv('이 문서 금액', b.draftAmount)}${kv('승인 후 예상 가용액', b.expectedAvailable)}` : ''}</div>` : ''}
            ${(x.purgeProblems || []).length ? `<div class="dc-card"><h4>완전삭제 불가 사유</h4>${x.purgeProblems.map(p => `<div class="dc-note">${esc(p)}</div>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>`);
    container.querySelector('#dcBack').addEventListener('click', e => { e.preventDefault(); (back || renderHome)(); });
    bindDocLinks(container, back);
    const reload = () => openDetail(container, id, back);
    const run = async (body, done) => {
      const r = await post({ id, ...body });
      if (!r.ok) { alert(failText(r)); return; }
      if (done) done(dataOf(r));
      reload();
    };
    container.querySelector('#dcAddFile')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      draft = { id, formData: {}, files: [] };
      await uploadFile(file, 'additional');
      draft = null;
      reload();
    });
    container.querySelectorAll('[data-version]').forEach(l => l.addEventListener('click', async e => {
      e.preventDefault();
      const r = await get(`view=version&id=${id}&version=${l.dataset.version}`);
      if (!r.ok) { alert(failText(r)); return; }
      const v = dataOf(r);
      printDoc({ ...x, ...v.snapshot, docNo: `${x.docNo} (버전 ${v.version})`, steps: x.history.filter(s => s.kind === 'approval' && s.version === v.version), files: [], references: [] });
    }));
    container.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', async () => {
      const act = el.dataset.act;
      if (act === 'edit') { await renderCompose(id); go('new'); return; }
      if (act === 'print') { printDoc(x); return; }
      if (act === 'recall' && confirm('문서를 회수할까요? 다시 올리면 처음부터 승인받습니다.')) run({ action: 'recall' });
      if (act === 'approve') run({ action: 'decide', decision: 'approve', expectedVersion: x.version, comment: prompt('의견 (없으면 비워 두세요)') || '' }, d => { if (d.resolutionNo) alert(`최종 승인했습니다. 지출결의서 ${d.resolutionNo}`); });
      if (act === 'reject') { const c = prompt('반려 사유'); if (c) run({ action: 'decide', decision: 'reject', comment: c, expectedVersion: x.version }); }
      if (act === 'cancel-request') { const c = prompt('취소 사유. 원승인 결재선으로 다시 승인받습니다.'); if (c) run({ action: 'cancel_request', reason: c }); }
      if (act === 'cancel-approve') run({ action: 'cancel_decide', decision: 'approve', comment: prompt('의견 (없으면 비워 두세요)') || '' });
      if (act === 'cancel-reject') { const c = prompt('반려 사유'); if (c) run({ action: 'cancel_decide', decision: 'reject', comment: c }); }
      if (act === 'delete') { const c = prompt('삭제 사유. 문서함에서 빠지고 내부 보존됩니다.'); if (c) run({ action: 'delete', reason: c }, () => {}); }
      if (act === 'hold') { const c = x.holdReason ? '' : prompt('보존 중지 사유'); if (x.holdReason || c) run({ action: 'hold', reason: c }); }
      if (act === 'comment') { const c = container.querySelector('#dcComment').value; if (c.trim()) run({ action: 'comment', body: c }); }
      if (act === 'pay') (payrollOf(x) ? openPayrollPayModal : openPayModal)(x, reload);
      if (act === 'refund') openRefundModal(x, reload);
      if (act === 'followup') openFollowupModal(x, reload);
      if (act === 'card-usage') openCardUsageModal(x, reload);
      if (act === 'card-use') {
        const on = cardRuleOn();
        draft = {
          id: null, docType: 'card', scope: x.cardScope, watchers: [], files: [],
          formData: { usePurpose: x.formData?.projectName || x.title, substitute: on, basisId: on ? String(x.id) : '' },
          references: [{ id: x.id, docNo: x.docNo, title: x.title, docLabel: x.docLabel, docType: 'proposal', refKind: 'basis' }],
        };
        go('new');
      }
      if (act === 'purge') openPurgeModal(x, () => (back || renderHome)());
    }));
  }

  function modal(title, html, onSave, saveLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.style.display = 'flex';
    wrap.innerHTML = `<div class="modal" style="max-width:480px">
      <div class="modal-head"><span class="modal-title">${esc(title)}</span><button class="modal-close" type="button" data-x>×</button></div>
      <div class="modal-body">${html}</div>
      <div data-err style="display:none;color:var(--danger);font-size:13px;padding:0 20px 8px;white-space:pre-line"></div>
      <div class="modal-foot"><button class="btn-sm btn-sm-ghost" type="button" data-x>취소</button><button class="btn-sm btn-sm-primary" type="button" data-ok>${esc(saveLabel || '저장')}</button></div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => wrap.remove()));
    wrap.querySelector('[data-ok]').addEventListener('click', async () => {
      const res = await onSave(wrap);
      if (res && !res.ok) {
        const e = wrap.querySelector('[data-err]');
        e.textContent = failText(res);
        e.style.display = '';
        return;
      }
      wrap.remove();
    });
    return wrap;
  }

  async function openPayModal(x, done) {
    const [ms, flow] = await Promise.all([api('GET', '/api/admin-ledger-masters'), api('GET', '/api/admin-ledger-flow')]);
    const accounts = (dataOf(ms).accounts || []).filter(a => a.isActive && a.parentCode === '101');
    const bank = (dataOf(flow).noApproval || []).filter(t => t.status === 'pending' && !t.voucherId);
    bank.sort((a, b) => Number(b.amount === x.amount) - Number(a.amount === x.amount));
    modal('지출완료 확인', `
      <div style="font-size:13px;margin-bottom:10px">${esc(x.title)} · 승인액 <strong>${won(x.amount)}원</strong></div>
      <label class="form-label">지급일</label><input id="dcPayDate" class="input" type="date" value="${today()}" style="width:100%;margin-bottom:10px">
      <label class="form-label">실제 지급액 (승인액보다 적으면 차액 예약이 풀립니다)</label>
      <input id="dcPayAmount" class="input" type="number" min="1" max="${x.amount}" value="${x.amount}" style="width:100%;margin-bottom:10px">
      <label class="form-label">지급 계좌</label>
      <select id="dcPayAccount" class="input" style="width:100%;margin-bottom:10px">${accounts.map(a => `<option value="${esc(a.code)}"${a.systemRole === 'cash_default' ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <label class="form-label">통장 출금 연결 (선택)</label>
      <select id="dcPayBank" class="input" style="width:100%"><option value="">연결 안 함</option>${bank.map(t => `<option value="${t.id}">${esc(t.date)} ${won(t.amount)}원 ${esc(t.counterpart || t.description || '')}</option>`).join('')}</select>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px"><input id="dcPayEvidence" type="checkbox"> 지급 증빙을 확인했습니다</label>
    `, async w => {
      const r = await api('POST', '/api/admin-approval-pay', {
        requestId: x.id, paidAt: w.querySelector('#dcPayDate').value, paidAmount: Number(w.querySelector('#dcPayAmount').value),
        payAccountCode: w.querySelector('#dcPayAccount').value, evidenceChecked: w.querySelector('#dcPayEvidence').checked,
        bankTxnId: w.querySelector('#dcPayBank').value ? Number(w.querySelector('#dcPayBank').value) : undefined,
      });
      if (r.ok) done();
      return r;
    }, '확인');
  }

  /* 급여 지급 확인. 금액은 승인액 그대로이고, 확인하면 급여 명세가 한꺼번에 지급 완료가 된다 */
  function openPayrollPayModal(x, done) {
    const p = payrollOf(x);
    modal('급여 지급 확인', `
      <div style="font-size:13px;margin-bottom:10px">${esc(x.title)} · 직원 ${won(p.count)}명<br>실지급액 <strong>${won(p.net)}원</strong> <span class="dc-note">지급총액 ${won(p.gross)}원, 공제액 ${won(p.deduction)}원</span></div>
      <label class="form-label">실제 지급일 (계좌이체일)</label><input id="dcPayDate" class="input" type="date" value="${today()}" style="width:100%;margin-bottom:10px">
      <div class="dc-note">확인하면 급여 명세 ${won(p.count)}건이 지급 완료로 바뀌고 장부에 급여 전표가 만들어집니다. 원천징수 신고는 이 지급일 기준으로 집계됩니다. 확인한 뒤에는 취소할 수 없습니다.</div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:12px"><input id="dcPayEvidence" type="checkbox"> 이체 내역을 확인했습니다</label>
    `, async w => {
      const r = await api('POST', '/api/admin-approval-pay', {
        requestId: x.id, paidAt: w.querySelector('#dcPayDate').value, evidenceChecked: w.querySelector('#dcPayEvidence').checked,
      });
      if (r.ok) {
        const d = dataOf(r);
        const lg = d.ledger || {};
        const made = (Number(lg.posted) || 0) + (Number(lg.drafts) || 0);
        alert(`급여 명세 ${won(d.payroll?.slips ?? p.count)}건을 지급 완료로 바꿨습니다.\n`
          + (made ? `장부에 급여 전표 ${won(made)}건을 만들었습니다.${lg.drafts ? ` 그중 ${won(lg.drafts)}건은 확인이 필요해 작성중으로 두었습니다.` : ''}`
            : lg.blocked ? '마감된 기간이라 장부 전표는 만들지 못했습니다. 장부에서 확인해 주세요.'
              : '장부 시작일 이전이거나 반영할 전표가 없어 장부에는 기록하지 않았습니다.'));
        done();
      }
      return r;
    }, '확인');
  }

  function openRefundModal(x, done) {
    modal('반환 확인', `
      <div style="font-size:13px;margin-bottom:10px">${esc(x.title)} · 지급액 <strong>${won(x.paidAmount ?? x.amount)}원</strong></div>
      <label class="form-label">실제 돌아온 금액</label><input id="dcRefund" class="input" type="number" min="0" value="${x.paidAmount ?? x.amount}" style="width:100%;margin-bottom:10px">
      <label class="form-label">메모 (돌아오지 않았으면 사유 필수)</label><input id="dcRefundNote" class="input" style="width:100%">
    `, async w => {
      const r = await api('POST', '/api/admin-approval-refund', { requestId: x.id, refundAmount: Number(w.querySelector('#dcRefund').value), note: w.querySelector('#dcRefundNote').value });
      if (r.ok) done();
      return r;
    }, '확인');
  }

  function openFollowupModal(x, done) {
    const wrap = modal('사후 품의 연결', `
      <div class="dc-note" style="margin-bottom:8px">승인된 품의서를 고르면 근거로 연결됩니다. 승인본은 바뀌지 않습니다.</div>
      <div style="display:flex;gap:4px"><input id="dcFuQ" class="input-sm" placeholder="문서번호·제목" style="flex:1"><button class="btn-sm btn-sm-ghost" type="button" id="dcFuSearch">검색</button></div>
      <select id="dcFuPick" class="input" style="width:100%;margin-top:8px"><option value="">품의서 선택</option></select>
    `, async w => {
      const targetId = Number(w.querySelector('#dcFuPick').value);
      if (!targetId) return { ok: false, error: '품의서를 고르세요' };
      const r = await post({ action: 'followup_link', id: x.id, targetId });
      if (r.ok) done();
      return r;
    }, '연결');
    const search = async () => {
      const res = await get(`view=search&docType=proposal&exclude=${x.id}&q=${encodeURIComponent(wrap.querySelector('#dcFuQ').value)}`);
      const items = (dataOf(res).items || []).filter(r => r.status === 'approved' && r.cancelStatus !== 'requested');
      wrap.querySelector('#dcFuPick').innerHTML = `<option value="">품의서 선택 (${items.length}건)</option>`
        + items.map(r => `<option value="${r.id}">${esc(r.docNo)} ${esc(r.title)}</option>`).join('');
    };
    wrap.querySelector('#dcFuSearch').addEventListener('click', search);
    search();
  }

  function openCardUsageModal(x, done) {
    const f = x.formData || {};
    modal('카드 사용 내역', `
      <div style="font-size:13px;margin-bottom:10px">${esc(x.title)} · 승인 금액 <strong>${won(x.amount)}원</strong></div>
      <label class="form-label">사용일</label><input id="dcUsedOn" class="input" type="date" value="${esc(f.usedOn || today())}" style="width:100%;margin-bottom:10px">
      <label class="form-label">실제 사용액</label><input id="dcUsedAmount" class="input" type="number" min="0" max="${x.amount}" value="${esc(f.actualAmount ?? x.amount)}" style="width:100%">
      <div class="dc-note" style="margin-top:6px">증빙은 문서의 추가증빙으로 첨부합니다. 예산 반영은 지출결의서에서 합니다.</div>
    `, async w => {
      const r = await post({ action: 'card_usage', id: x.id, usedOn: w.querySelector('#dcUsedOn').value, actualAmount: Number(w.querySelector('#dcUsedAmount').value) });
      if (r.ok) done();
      return r;
    });
  }

  function openPurgeModal(x, done) {
    if ((x.purgeProblems || []).length) { alert('완전삭제할 수 없습니다.\n' + x.purgeProblems.join('\n')); return; }
    modal('완전삭제', `
      <div style="font-size:13px;margin-bottom:10px;color:var(--danger)">${esc(x.docNo)}의 본문, 첨부, 승인 내역을 지웁니다. 되돌릴 수 없습니다. 예산 원장과 지출 기록은 남습니다.</div>
      <div class="dc-note">상태: 취소 최종 승인, 일반 삭제 완료${x.deleteReason ? ' · 삭제 사유 ' + esc(x.deleteReason) : ''}</div>
      <div class="dc-note">지울 범위: 본문, 첨부 ${x.files.length}개, 버전 ${x.versions.length}개, 결재 내역</div>
      <div class="dc-note" style="margin-bottom:8px">이 문서를 참조한 문서 ${x.referencedBy.length}건은 연결이 유지되고 «완전삭제된 문서»로 표시됩니다.</div>
      <label class="form-label">삭제 사유</label><input id="dcPurgeWhy" class="input" style="width:100%;margin-bottom:10px">
      <label class="form-label">비밀번호 다시 입력</label><input id="dcPurgePw" class="input" type="password" style="width:100%">
    `, async w => {
      const r = await post({ action: 'purge', id: x.id, reason: w.querySelector('#dcPurgeWhy').value, password: w.querySelector('#dcPurgePw').value });
      if (r.ok) done();
      return r;
    }, '완전삭제');
  }

  /* 인쇄·미리보기. 브라우저 인쇄 창에서 PDF로 저장할 수 있다 */
  function printDoc(x, preview) {
    const win = window.open('', '_blank');
    if (!win) { alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.'); return; }
    const steps = x.steps || [];
    const heads = ['기안', ...steps.map(s => s.stepType === 'consult' ? '합의' : '결재')];
    const names = [x.drafterName, ...steps.map(s => s.assigneeName || '')];
    const marks = ['', ...steps.map(s => (s.decision === 'approved' ? day(s.decidedAt) : s.decision === 'rejected' ? '반려' : ''))];
    const substituted = x.approvalMode === 'substituted';
    const basis = (x.references || []).find(r => r.id === x.substituteBasisId);
    const refs = x.references || [];
    const files = x.files || [];
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(x.docNo || x.docLabel)}</title><style>
      body{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;font-size:12px;color:#222;margin:24px}
      h1{text-align:center;letter-spacing:6px;font-size:22px} table{border-collapse:collapse;width:100%;margin-bottom:10px}
      th,td{border:1px solid #999;padding:5px 7px;font-size:11px;text-align:left} th{background:#eee}
      .sign{width:auto;margin-left:auto} .sign th,.sign td{text-align:center;min-width:64px} .num{text-align:right;white-space:nowrap}
      .body{border:1px solid #999;padding:10px;min-height:120px;line-height:1.7} .dc-table{width:100%}
      @page{size:A4;margin:14mm}
    </style></head><body>
      <h1>${esc(x.docLabel)}</h1>
      ${preview ? '<button onclick="window.print()" style="float:right">인쇄</button>' : ''}
      ${substituted ? `<p style="text-align:right">승인 갈음: ${esc(basis?.docNo || '근거 품의')}의 승인으로 처리 (별도 결재 없음)</p>`
        : `<table class="sign"><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr><tr>${names.map(n => `<td>${esc(n)}</td>`).join('')}</tr><tr>${marks.map(n => `<td>${esc(n)}</td>`).join('')}</tr></table>`}
      <table><tr><th style="width:110px">문서번호</th><td>${esc(x.docNo || '')}</td></tr><tr><th>제목</th><td>${esc(x.title || '')}</td></tr><tr><th>기안자</th><td>${esc(x.drafterName || '')}</td></tr>${fieldRows(x)}</table>
      ${expenseTables(x)}
      <div class="body">${x.body || ''}</div>
      ${refs.length ? `<table style="margin-top:10px"><tr><th colspan="3">근거 및 관련 문서</th></tr>${refs.map(r => `<tr><td style="width:130px">${esc(r.docNo)}</td><td>${esc(r.title)}</td><td style="width:50px">${r.refKind === 'basis' ? '근거' : '관련'}</td></tr>`).join('')}</table>` : ''}
      ${files.length ? `<table style="margin-top:10px"><tr><th colspan="2">첨부파일</th></tr>${files.map(f => `<tr><td>${esc(f.fileName)}</td><td style="width:90px">${esc(meta.fileKinds[f.fileKind] || '')}</td></tr>`).join('')}</table>` : ''}
      ${preview ? '' : '<script>window.onload=function(){window.print()}<\/script>'}</body></html>`);
    win.document.close();
  }

  /* ── 지출완료 확인 ── */
  async function renderPay() {
    const c = page('pay');
    c.innerHTML = styled('<div class="panel"><div class="p-head"><div class="p-title">지출완료 확인</div></div><div class="dc-note">최종 승인된 지출결의서입니다. 실제 지급 후 확인하면 예약이 집행으로 바뀌고 장부에 기록됩니다.</div><div id="dcPayList">불러오는 중…</div><div id="dcRefundList"></div></div>');
    const [res, flow] = await Promise.all([get('view=list&box=pay'), api('GET', '/api/admin-ledger-flow')]);
    const el = c.querySelector('#dcPayList');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger)">${esc(failText(res))}</div>`; return; }
    el.innerHTML = listTable(dataOf(res).items || []);
    bindDocLinks(el, renderPay);
    const refunds = dataOf(flow).refunds || [];
    if (refunds.length) {
      const box = c.querySelector('#dcRefundList');
      box.innerHTML = `<div style="font-weight:600;margin:16px 0 6px">반환 확인 대기</div>${refunds.map(r => `<div class="dc-kv"><a href="#" data-doc="${r.id}">${esc(r.resolutionNo || '')} ${esc(r.title)}</a><span>${won(r.amount)}원</span></div>`).join('')}`;
      bindDocLinks(box, renderPay);
    }
  }

  /* ── 예산 진행현황 ── */
  async function renderBudget() {
    const c = page('budget');
    c.innerHTML = styled(`<div class="panel"><div class="p-head"><div class="p-title">예산 진행현황</div></div>
      <div style="display:flex;gap:6px;margin-bottom:10px"><select id="dcBudgetPick" class="input-sm" style="min-width:320px"></select></div>
      <div class="dc-grid"><div id="dcBudgetDocs"></div><div id="dcBudgetSide"></div></div></div>`);
    const res = await get('view=budgets');
    const data = dataOf(res);
    const pick = c.querySelector('#dcBudgetPick');
    const seen = new Set();
    const moks = (data.options || []).filter(o => { if (seen.has(o.budgetAccountId)) return false; seen.add(o.budgetAccountId); return true; });
    pick.innerHTML = moks.map(o => `<option value="${o.budgetAccountId}">${esc(o.label.split(' · ')[0])}</option>`).join('');
    const load = async () => {
      if (!pick.value) return;
      const r = await get(`view=budget&year=${data.year}&budgetAccountId=${pick.value}`);
      if (!r.ok) { c.querySelector('#dcBudgetDocs').innerHTML = esc(failText(r)); return; }
      const d = dataOf(r);
      const p = d.position;
      const kv = (k, v) => `<div class="dc-kv"><span>${k}</span><strong>${won(v)}</strong></div>`;
      c.querySelector('#dcBudgetSide').innerHTML = `<div class="dc-card"><h4>예산 진행현황</h4>
        ${kv('현재예산', p.planned)}${kv('지출완료 집행액', p.executed)}${kv('미집행 예약액', p.reserved)}${kv('예산잔액', p.remaining)}${kv('사용가능액', p.available)}
        <div class="dc-kv" style="margin-top:6px"><span>집행률</span><strong>${d.rate == null ? '계산 불가' : d.rate + '%'}</strong></div>
        <div class="dc-bar"><i style="width:${Math.min(100, d.rate || 0)}%"></i></div>
        ${p.hasPlan ? '' : '<div class="dc-note">승인된 예산안이 없습니다.</div>'}</div>`;
      const docs = c.querySelector('#dcBudgetDocs');
      docs.innerHTML = `<div style="font-weight:600;margin-bottom:6px">선택 예산의 결재 및 지출 현황</div>${listTable(d.documents || [], { compact: true })}`;
      bindDocLinks(docs, renderBudget);
    };
    pick.addEventListener('change', load);
    await load();
  }

  /* ── 취소 및 보존함 ── */
  async function renderArchive() {
    const c = page('archive');
    const st = boxState.archive || (boxState.archive = { box: 'cancel' });
    c.innerHTML = styled(`<div class="panel"><div class="p-head"><div class="p-title">취소 및 보존함</div></div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button class="btn-sm ${st.box === 'cancel' ? 'btn-sm-primary' : 'btn-sm-ghost'}" type="button" data-box="cancel">취소 진행·완료</button>
        <button class="btn-sm ${st.box === 'archive' ? 'btn-sm-primary' : 'btn-sm-ghost'}" type="button" data-box="archive">보존함</button>
      </div>
      <div class="dc-note">취소가 최종 승인된 문서는 재정 기록 권한자가 일반 삭제할 수 있습니다. 삭제해도 원문과 승인 이력은 보존함에 남고 집행 기록은 바뀌지 않습니다.</div>
      <div id="dcList">불러오는 중…</div></div>`);
    c.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => { st.box = b.dataset.box; renderArchive(); }));
    const res = await get(`view=list&box=${st.box}`);
    const el = c.querySelector('#dcList');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger)">${esc(failText(res))}</div>`; return; }
    el.innerHTML = listTable(dataOf(res).items || []);
    bindDocLinks(el, renderArchive);
  }

  /* ── 결재선 및 양식 설정 ── */
  async function renderSettings() {
    const c = page('settings');
    c.innerHTML = styled('<div class="panel"><div class="p-head"><div class="p-title">결재선 및 양식 설정</div></div><div id="dcSet">불러오는 중…</div></div>');
    const res = await get('view=settings');
    const el = c.querySelector('#dcSet');
    if (!res.ok) { el.innerHTML = `<div style="color:var(--danger)">${esc(failText(res))}</div>`; return; }
    const d = dataOf(res);
    const s = d.settings;
    const chair = isChair();
    el.innerHTML = `
      <div class="dc-card"><h4>저장된 결재선</h4>
        ${(d.lines || []).map(l => `<div class="dc-kv"><span>${esc(l.name)} ${l.shared ? '<span class="dc-note">공용</span>' : ''} <span class="dc-note">${(l.steps || []).map(x => `${x.type === 'consult' ? '합의' : '결재'} ${esc(x.name)}`).join(' → ')}</span></span><a href="#" data-line-del="${l.id}">삭제</a></div>`).join('') || '<div class="dc-note">문서 작성 화면에서 결재선을 저장할 수 있습니다.</div>'}
        <div class="dc-note"><a href="#" id="dcGoLines">금액별 추천 결재선 설정</a></div>
      </div>
      <div class="dc-card"><h4>운영 기준</h4>
        <div class="dc-row"><label>사전 품의</label><label style="font-size:13px"><input type="checkbox" id="dcReq"${s.requireProposal ? ' checked' : ''}${chair ? '' : ' disabled'}> 일반 지출은 승인된 품의 근거가 있어야 상신</label></div>
        <div class="dc-row"><label>품의 면제 금액</label><div><input id="dcMin" class="input" type="number" min="0" value="${esc(s.proposalMinAmount || 0)}"${chair ? '' : ' disabled'}> <span class="dc-note">이 금액 미만은 품의 없이 상신. 0이면 전부 필요</span></div></div>
        <div class="dc-row"><label>카드 규정 시행일</label><div><input id="dcCardDate" class="input" type="date" value="${esc(s.cardRuleEffectiveOn || '')}"${chair ? '' : ' disabled'}> <span class="dc-note">비워 두면 승인 갈음이 꺼져 있습니다</span></div></div>
        <div class="dc-row"><label>카드 규정 메모</label><input id="dcCardNote" class="input" value="${esc(s.cardRuleNote || '')}"${chair ? '' : ' disabled'}></div>
        <div class="dc-row"><label>보존기간(년)</label><div><input id="dcYears" class="input" type="number" min="1" value="${esc(s.retentionYears || '')}"${chair ? '' : ' disabled'}> <span class="dc-note">비워 두면 완전삭제를 할 수 없습니다</span></div></div>
        ${chair ? '<button class="btn-sm btn-sm-primary" type="button" id="dcSetSave">저장</button>' : ''}
      </div>
      <div class="dc-card"><h4>양식 안내 문구</h4>
        <div class="dc-note">작성 화면에 보이는 안내입니다. 저장할 때마다 새 버전으로 남습니다.</div>
        ${DOC_ORDER.map(k => `<div class="dc-row"><label>${esc(meta.docTypes[k].label)}</label><div>
          <textarea class="input" rows="2" data-guide="${k}" style="width:100%"${chair ? '' : ' disabled'}>${esc(d.guides?.[k]?.guide || '')}</textarea>
          ${chair ? `<button class="btn-sm btn-sm-ghost" type="button" data-guide-save="${k}">저장</button>` : ''} <span class="dc-note">${d.guides?.[k]?.version ? 'v' + d.guides[k].version : '기본 문구'}</span></div></div>`).join('')}
      </div>
      ${chair ? `<div class="dc-card"><h4>완전삭제 담당자</h4>
        <div class="dc-note">담당자가 없으면 완전삭제 메뉴와 실행이 잠겨 있습니다. 지정과 해제는 기록에 남습니다.</div>
        ${(d.grants || []).map(g => `<div class="dc-kv"><span>${esc(g.memberName)} ${esc(g.startOn)} ~ ${esc(g.endOn)} <span class="dc-note">${esc(g.reason)} · 지정 ${esc(g.grantedByName || '')}${g.revokedAt ? ' · 해제됨' : ''}</span></span>${g.revokedAt ? '' : `<a href="#" data-grant-del="${g.id}">해제</a>`}</div>`).join('')}
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
          <select id="dcGrantMember" class="input-sm"><option value="">담당자</option>${people.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <input id="dcGrantFrom" class="input-sm" type="date"><input id="dcGrantTo" class="input-sm" type="date">
          <input id="dcGrantWhy" class="input-sm" placeholder="지정 사유" style="flex:1;min-width:160px">
          <button class="btn-sm btn-sm-ghost" type="button" id="dcGrantAdd">지정</button>
        </div></div>` : ''}`;
    const act = async (body) => {
      const r = await post(body);
      if (!r.ok) { alert(failText(r)); return; }
      meta = null;
      await ensureMeta();
      renderSettings();
    };
    el.querySelector('#dcGoLines')?.addEventListener('click', e => {
      e.preventDefault();
      document.querySelector('a[data-tab="approval-lines"]')?.click();
    });
    el.querySelector('#dcSetSave')?.addEventListener('click', () => act({
      action: 'settings_save', requireProposal: el.querySelector('#dcReq').checked, proposalMinAmount: Number(el.querySelector('#dcMin').value) || 0,
      cardRuleEffectiveOn: el.querySelector('#dcCardDate').value, cardRuleNote: el.querySelector('#dcCardNote').value, retentionYears: Number(el.querySelector('#dcYears').value) || null,
    }));
    el.querySelectorAll('[data-guide-save]').forEach(b => b.addEventListener('click', () => act({
      action: 'guide_save', docType: b.dataset.guideSave, guide: el.querySelector(`[data-guide="${b.dataset.guideSave}"]`).value,
    })));
    el.querySelectorAll('[data-line-del]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); act({ action: 'line_delete', lineId: Number(a.dataset.lineDel) }); }));
    el.querySelectorAll('[data-grant-del]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const reason = prompt('해제 사유');
      if (reason) act({ action: 'grant_revoke', grantId: Number(a.dataset.grantDel), reason });
    }));
    el.querySelector('#dcGrantAdd')?.addEventListener('click', () => act({
      action: 'grant_save', memberId: Number(el.querySelector('#dcGrantMember').value), startOn: el.querySelector('#dcGrantFrom').value,
      endOn: el.querySelector('#dcGrantTo').value, reason: el.querySelector('#dcGrantWhy').value,
    }));
  }

  /* 다른 화면(급여 관리)에서 문서를 바로 연다. 고칠 수 있는 내 문서면 작성 화면을, 아니면 상세를 보여 준다 */
  async function openDoc(id, edit) {
    if (!(await ensureMeta())) return;
    if (edit) {
      const res = await get(`view=detail&id=${id}`);
      if (res.ok && dataOf(res).actions?.edit) { await renderCompose(id); go('new'); return; }
    }
    pendingDoc = Number(id);
    go('mine');
  }

  async function open(view) {
    const c = page(view);
    if (!c) return;
    if (!(await ensureMeta())) { c.innerHTML = '<div class="panel" style="color:var(--danger)">내부결재를 불러오지 못했습니다. 마이그 적용 여부를 확인해 주세요.</div>'; return; }
    if (view === 'mine' && pendingDoc) {
      const id = pendingDoc;
      pendingDoc = null;
      return openDetail(c, id, () => renderBox('mine'));
    }
    if (view === 'home') return renderHome();
    if (view === 'new') return renderCompose();
    if (view === 'mine' || view === 'inbox') return renderBox(view);
    if (view === 'pay') return renderPay();
    if (view === 'budget') return renderBudget();
    if (view === 'archive') return renderArchive();
    if (view === 'settings') return renderSettings();
  }

  window.SIREN_DOCS = { open, openDoc };
})();
