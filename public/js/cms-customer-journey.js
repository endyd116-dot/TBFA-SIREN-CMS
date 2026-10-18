/* ============================================================
   고객 여정 패널 (2026-10-18) — 순수 JS(TS 문법 금지)
   잠재·예비·정기 어느 표에서든 이름을 누르면 오른쪽에서 열린다.
   사용: window.openCustomerJourney({ memberId: N }) 또는 ({ potentialId: N })
   API : GET  /api/admin/customer-journey?member=N|potential=N
         GET/POST/PATCH/DELETE /api/admin/customer-notes
         POST /api/admin/donor-stage-move
   AM 리드관리 드로어(슬라이드·통합 타임라인·최근순 메모)를 참고하되 후원·결제(효성 계좌·카드·입금)·단계 이동을 더 담았다.
   ============================================================ */
(function () {
  'use strict';

  var STAGE = {
    potential:          { label: '잠재',       cls: 'cj-s-potential' },
    prospect_onetime:   { label: '예비 · 일시', cls: 'cj-s-onetime' },
    prospect_cancelled: { label: '예비 · 해지', cls: 'cj-s-cancelled' },
    regular:            { label: '정기',       cls: 'cj-s-regular' },
    member:             { label: '회원(미후원)', cls: 'cj-s-member' }
  };
  var MOVE_OPTIONS = [['potential', '잠재'], ['prospect_onetime', '예비 · 일시 후원'], ['prospect_cancelled', '예비 · 해지'], ['regular', '정기 후원자']];
  var KIND = {
    potential: ['🌱', '잠재'], signup: ['👤', '가입'], stage: ['🔁', '단계'], donation: ['💝', '후원'], hyosung: ['🏦', '효성'],
    billing: ['💳', '청구'], card: ['💳', '카드'], contract: ['📄', '약정'], receipt: ['🧾', '확인서'], bank: ['🏧', '입금'],
    nurture: ['💌', '너처링'], send: ['📨', '발송'], notification: ['🔔', '알림'], support: ['🤝', '지원'], note: ['📝', '메모'], admin: ['🛠', '관리']
  };
  var FILTER_GROUPS = {
    all: null,
    donation: ['donation', 'receipt', 'bank', 'hyosung'],
    pay: ['billing', 'card', 'contract', 'hyosung', 'bank'],
    comm: ['nurture', 'send', 'notification'],
    stage: ['stage', 'signup', 'potential'],
    note: ['note', 'admin'],
    etc: ['support']
  };
  var FILTERS = [['all', '전체'], ['donation', '후원'], ['pay', '결제·약정'], ['comm', '발송'], ['stage', '단계'], ['note', '메모·관리'], ['etc', '기타']];
  var STATUS_KO = { completed: '완료', pending: '대기', pending_hyosung: '효성 대기', failed: '실패', cancelled: '취소', refunded: '환불', success: '성공', received: '수납', unpaid: '미납', active: '활성', deactivated: '해지', sent: '발송', opened: '열람', confirmed: '확정', matched: '매칭', suspended: '정지', expired: '만료', terminated: '종료' };
  var FAR_FUTURE = '2999-01-01';
  function isOpenEnded(iso) { return !!iso && String(iso) >= FAR_FUTURE; }

  var state = { subject: null, data: null, filter: 'all', tlLimit: 60, lastFocus: null, busy: false, reqId: 0, showAll: {} };

  /* ───────── 유틸 ───────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(iso) {
    if (!iso) return '-';
    if (typeof window.fmtKSTDate === 'function') { try { return window.fmtKSTDate(iso); } catch (e) { /* 폴백 */ } }
    var d = new Date(iso); if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
  }
  function fmtDateTime(iso) {
    if (!iso) return '-';
    if (typeof window.fmtKSTDateTime === 'function') { try { return window.fmtKSTDateTime(iso); } catch (e) { /* 폴백 */ } }
    var d = new Date(iso); if (isNaN(d.getTime())) return '-';
    return fmtDate(iso) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function won(n) { return '₩' + Number(n || 0).toLocaleString(); }
  function stageBadge(stage, extra) {
    var s = STAGE[stage] || STAGE.member;
    return '<span class="cj-stage ' + s.cls + '">' + esc(s.label) + (extra ? ' ' + esc(extra) : '') + '</span>';
  }
  function ko(status) { return STATUS_KO[status] || status || ''; }
  function toast(msg) { if (typeof window._cmsToast === 'function') window._cmsToast(msg); else if (typeof window.toast === 'function') window.toast(msg); else alert(msg); }

  async function api(path, opts) {
    opts = opts || {};
    try {
      var res = await fetch(path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      var data = await res.json().catch(function () { return {}; });
      return { status: res.status, ok: res.ok && data.ok !== false, data: data };
    } catch (e) { return { status: 0, ok: false, data: { error: '네트워크 오류' } }; }
  }
  function unwrap(d) { return (d && d.data && typeof d.data === 'object') ? d.data : (d || {}); }

  /* ───────── DOM 생성·열기·닫기 ───────── */
  function ensureDom() {
    if (document.getElementById('cjOverlay')) return;
    var ov = document.createElement('div');
    ov.className = 'cj-overlay'; ov.id = 'cjOverlay'; ov.hidden = true;
    ov.innerHTML = '<aside class="cj-drawer" id="cjDrawer" role="dialog" aria-modal="true" aria-labelledby="cjName" tabindex="-1">'
      + '<div class="cj-head"><div class="cj-head-titles"><h3 id="cjName">고객 여정</h3><div class="cj-sub" id="cjSub"></div></div>'
      + '<button class="cj-close" id="cjClose" type="button" aria-label="닫기">✕</button></div>'
      + '<div class="cj-body" id="cjBody"></div>'
      + '<div class="cj-foot" id="cjFoot"></div></aside>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.getElementById('cjClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ov.hidden) close(); });
  }
  function open(subject) {
    ensureDom();
    state.subject = subject; state.data = null; state.filter = 'all'; state.tlLimit = 60; state.showAll = {};
    state.lastFocus = document.activeElement;
    var ov = document.getElementById('cjOverlay');
    ov.hidden = false;
    requestAnimationFrame(function () { ov.classList.add('open'); });
    document.getElementById('cjName').textContent = subject.name || '불러오는 중…';
    document.getElementById('cjSub').innerHTML = '';
    document.getElementById('cjBody').innerHTML = '<div class="cj-skel" style="width:60%"></div><div class="cj-skel" style="width:85%"></div><div class="cj-skel" style="width:40%"></div><div class="cj-skel" style="height:80px"></div><div class="cj-skel" style="height:120px"></div>';
    document.getElementById('cjFoot').innerHTML = '';
    load();
    setTimeout(function () { var c = document.getElementById('cjClose'); if (c) c.focus(); }, 60);
  }
  function close() {
    var ov = document.getElementById('cjOverlay');
    if (!ov || ov.hidden) return;
    ov.classList.remove('open');
    setTimeout(function () { ov.hidden = true; }, 200);
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) { /* 무시 */ } }
  }
  window.openCustomerJourney = open;
  window.closeCustomerJourney = close;

  async function load() {
    var sub = state.subject; if (!sub) return;
    var reqId = ++state.reqId;
    var qs = sub.memberId ? 'member=' + Number(sub.memberId) : 'potential=' + Number(sub.potentialId);
    var res = await api('/api/admin/customer-journey?' + qs);
    if (reqId !== state.reqId) return;
    if (!res.ok) {
      document.getElementById('cjBody').innerHTML = '<div class="cj-danger">불러오지 못했습니다: ' + esc(res.data && (res.data.error || res.data.detail) || ('HTTP ' + res.status)) + '</div>'
        + '<button class="cms-btn cms-btn-ghost" type="button" onclick="window.__cjReload()">다시 시도</button>';
      return;
    }
    state.data = unwrap(res.data);
    render();
  }
  window.__cjReload = load;

  /* ───────── 렌더 ───────── */
  function render() {
    var d = state.data; if (!d) return;
    var p = d.profile; var pot = d.potential || []; var first = pot[0] || null;
    var name = (p && p.name) || (first && first.name) || '이름 없음';
    var stageInfo = d.stageInfo || {}; var ov = stageInfo.override || null;

    document.getElementById('cjName').innerHTML = esc(name) + ' ' + stageBadge(d.stage) + (ov ? '<span class="cj-chip manual" title="실데이터가 바뀌면 자동 해제">수동 지정</span>' : '');
    var sub = [];
    if (p) sub.push('<span>M-' + String(p.id).padStart(5, '0') + '</span>');
    if (first) sub.push('<span>PD-' + String(first.id).padStart(5, '0') + '</span>');
    var phone = (p && p.phone) || (first && first.phone);
    if (phone) sub.push('<a href="tel:' + esc(phone) + '">' + esc(phone) + '</a>');
    var email = (p && p.email) || (first && first.email);
    if (email) sub.push('<span>' + esc(email) + '</span>');
    if (p && p.grade) sub.push('<span class="cj-chip">' + esc((p.grade.icon ? p.grade.icon + ' ' : '') + (p.grade.nameKo || p.grade.code || '등급')) + '</span>');
    document.getElementById('cjSub').innerHTML = sub.join('');

    var html = '';
    if (p && p.blacklistedAt) html += '<div class="cj-danger">⛔ 차단된 회원 (' + fmtDate(p.blacklistedAt) + ')' + (p.blacklistReason ? ' — ' + esc(p.blacklistReason) : '') + '</div>';
    if (p && p.withdrawnAt) html += '<div class="cj-warn">탈퇴 회원 (' + fmtDate(p.withdrawnAt) + ')' + (p.withdrawnReason ? ' — ' + esc(p.withdrawnReason) : '') + '</div>';
    if (d.meta && d.meta.warnings && d.meta.warnings.length) html += '<div class="cj-warn">일부 정보를 못 읽었습니다: ' + esc(d.meta.warnings.join(' / ')) + '</div>';

    html += secStage(d);
    html += secProfile(d);
    html += secOrigin(d);
    html += secDonations(d);
    html += secPayment(d);
    html += secComms(d);
    html += secSupport(d);
    html += secTimeline(d);
    html += secNotes(d);
    document.getElementById('cjBody').innerHTML = html;

    var foot = '<button class="cms-btn cms-btn-ghost" type="button" onclick="window.__cjReload()">새로고침</button>';
    if (p) foot += '<a class="cms-btn cms-btn-ghost" href="#members" onclick="location.hash=\'#members\';window.closeCustomerJourney();return false;">통합 회원 관리</a>';
    if (d.stage === 'regular') foot += '<a class="cms-btn cms-btn-ghost" href="#donor-regular" onclick="location.hash=\'#donor-regular\';window.closeCustomerJourney();return false;">정기 후원자 표</a>';
    else if (d.stage === 'prospect_onetime' || d.stage === 'prospect_cancelled') foot += '<a class="cms-btn cms-btn-ghost" href="#donor-prospect" onclick="location.hash=\'#donor-prospect\';window.closeCustomerJourney();return false;">예비 후원자 표</a>';
    if (pot.length) foot += '<a class="cms-btn cms-btn-ghost" href="#donor-potential" onclick="location.hash=\'#donor-potential\';window.closeCustomerJourney();return false;">잠재 후원자 표</a>';
    foot += '<span style="margin-left:auto" class="cj-muted">' + (d.meta && d.meta.elapsedMs != null ? d.meta.elapsedMs + 'ms · ' : '') + fmtDateTime(d.meta && d.meta.generatedAt) + '</span>';
    document.getElementById('cjFoot').innerHTML = foot;
  }

  function sec(title, body, count) {
    return '<div class="cj-sec"><div class="cj-sec-title">' + title + (count != null ? ' <span class="cj-count">' + count + '</span>' : '') + '</div>' + body + '</div>';
  }
  function kv(pairs) {
    var out = '<dl class="cj-kv">';
    pairs.forEach(function (pr) { if (pr[1] == null || pr[1] === '' || pr[1] === '-') return; out += '<dt>' + esc(pr[0]) + '</dt><dd>' + pr[1] + '</dd>'; });
    return out + '</dl>';
  }

  /* 단계 레일 + 수동 이동 + 이력 */
  function secStage(d) {
    var si = d.stageInfo || {}; var cur = d.stage; var ov = si.override;
    var order = ['potential', 'prospect_onetime', 'regular'];
    var rank = { potential: 0, member: 0, prospect_onetime: 1, prospect_cancelled: 1, regular: 2 };
    var rail = '<div class="cj-rail">';
    order.forEach(function (s, i) {
      var cls = 'cj-rail-step';
      if (s === cur || (s === 'prospect_onetime' && cur === 'prospect_cancelled')) cls += ' cur';
      else if (rank[s] < (rank[cur] || 0)) cls += ' done';
      var label = s === 'prospect_onetime' ? (cur === 'prospect_cancelled' ? '예비 · 해지' : '예비') : STAGE[s].label;
      rail += '<span class="' + cls + '">' + esc(label) + '</span>' + (i < order.length - 1 ? '<span class="cj-rail-arrow">›</span>' : '');
    });
    rail += '</div>';
    var info = '';
    if (si.auto && si.auto !== cur) info += '<div class="cj-muted">자동 판정은 <b>' + esc(si.autoLabel || si.auto) + '</b>' + (ov ? ' — 운영자 수동 지정(' + esc(ov.changedByName || '') + ' · ' + fmtDate(ov.createdAt) + (ov.reason ? ' · ' + esc(ov.reason) : '') + ')이 우선 적용 중입니다. 실제 약정·해지·후원이 생기면 자동으로 풀립니다.' : ' — 다음 재평가(후원·해지가 생길 때 또는 매일 새벽 3시) 때 <b>' + esc(si.autoLabel || si.auto) + '</b>(으)로 바뀝니다.') + '</div>';
    else if (ov) info += '<div class="cj-muted">운영자 수동 지정(' + esc(ov.changedByName || '') + ' · ' + fmtDate(ov.createdAt) + (ov.reason ? ' · ' + esc(ov.reason) : '') + ')</div>';
    var sig = si.autoSignals;
    if (sig) {
      var bits = [];
      if (sig.tossActive) bits.push('카드 정기 ' + sig.tossActive + '건 활성');
      if (sig.hyosungStatus) bits.push('효성 ' + sig.hyosungStatus);
      if (sig.tossDeact) bits.push('카드 해지 ' + sig.tossDeact + '건');
      if (sig.paidCount) bits.push('완료 후원 ' + sig.paidCount + '건');
      if (sig.hyosungReceived) bits.push('효성 수납 ' + won(sig.hyosungReceived));
      if (sig.lastPaid) bits.push('마지막 납부 ' + fmtDate(sig.lastPaid));
      if (bits.length) info += '<div class="cj-muted" style="margin-top:3px">판정 근거: ' + esc(bits.join(' · ')) + '</div>';
    }
    var move = '<div class="cj-move">'
      + '<select id="cjMoveStage">' + MOVE_OPTIONS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'
      + '<input id="cjMoveReason" type="text" maxlength="300" placeholder="이동 사유(선택) — 이력에 남습니다">'
      + '<button class="cms-btn cms-btn-primary" type="button" onclick="window.__cjMoveStage()">단계 이동</button></div>';
    var events = si.events || [];
    var hist = '';
    if (events.length) {
      var showAll = !!state.showAll.stage;
      var list = showAll ? events : events.slice(0, 4);
      hist = '<table class="cj-table" style="margin-top:8px"><thead><tr><th>시각</th><th>변화</th><th>구분</th><th>사유·담당</th></tr></thead><tbody>'
        + list.map(function (e) {
          return '<tr><td style="white-space:nowrap">' + fmtDateTime(e.createdAt) + '</td><td>' + esc(e.fromLabel || '—') + ' → <b>' + esc(e.toLabel || e.toStage) + '</b></td>'
            + '<td>' + (e.source === 'manual' ? '<span class="cj-chip manual">수동</span>' : e.source === 'system' ? '시스템' : '자동') + (e.isOverride ? '<span class="cj-chip on">유지 중</span>' : (e.releasedAt ? '<span class="cj-chip">해제</span>' : '')) + '</td>'
            + '<td>' + esc([e.changedByName, e.reason].filter(Boolean).join(' · ') || '—') + '</td></tr>';
        }).join('') + '</tbody></table>'
        + (events.length > 4 ? '<button class="cj-more" type="button" onclick="window.__cjToggle(\'stage\')">' + (showAll ? '접기' : '이력 ' + events.length + '건 전체 보기') + '</button>' : '');
    } else if (!d.profile) {
      hist = '<div class="cj-muted" style="margin-top:6px">아직 회원이 아닌 잠재 후원자입니다. 단계를 옮기면 가벼운 회원 기록을 만들어 연결합니다.</div>';
    }
    return sec('단계 · 전환', rail + info + move + hist);
  }

  function secProfile(d) {
    var p = d.profile; var pot = d.potential || [];
    var rows = [];
    if (p) {
      rows.push(['회원 상태', esc([p.type, p.status].filter(Boolean).join(' · ')) + (p.isLeadShell ? ' <span class="cj-chip" title="효성 등록·잠재 동기화 등으로 시스템이 만든 회원 기록(본인 로그인 없음)">자동 생성 기록 · 로그인 없음</span>' : '')]);
      rows.push(['분류', esc([p.memberCategory, p.memberSubtype].filter(Boolean).join(' · ') || '-')]);
      rows.push(['가입', fmtDate(p.createdAt) + (p.signupSource ? ' · ' + esc(p.signupSource.label || p.signupSource.code) : '')]);
      if (p.prospectEventName || p.prospectEntryPath) rows.push(['유입', esc([p.prospectEventName, p.prospectEntryPath].filter(Boolean).join(' · '))]);
      if (p.schoolName) rows.push(['소속 학교', esc(p.schoolName)]);
      if (p.lastLoginAt) rows.push(['마지막 로그인', fmtDateTime(p.lastLoginAt)]);
      var c = p.consents || {};
      rows.push(['수신 동의', '<span class="cj-chip ' + (c.sms ? 'on' : 'off') + '">문자</span><span class="cj-chip ' + (c.kakaoConsentAt ? 'on' : 'off') + '">카톡</span><span class="cj-chip ' + (c.email ? 'on' : 'off') + '">이메일</span><span class="cj-chip ' + (c.mail ? 'on' : 'off') + '">우편</span>'
        + (c.phoneVerifiedAt ? '<span class="cj-muted">휴대폰 인증 ' + fmtDate(c.phoneVerifiedAt) + '</span>' : '')]);
      if (p.churn) rows.push(['이탈 위험', esc(p.churn.level || '-') + (p.churn.score != null ? ' (' + p.churn.score + '점)' : '') + (p.churn.evaluatedAt ? ' <span class="cj-muted">' + fmtDate(p.churn.evaluatedAt) + '</span>' : '')]);
      if (p.memo) rows.push(['회원 메모', esc(p.memo)]);
    }
    pot.forEach(function (q) {
      rows.push(['잠재 기록', '<b>' + esc(q.eventName || '이벤트 미상') + '</b> · ' + fmtDate(q.participatedAt || q.createdAt) + (q.entryPath ? ' · ' + esc(q.entryPath) : '')
        + (q.linkedMemberId ? ' <span class="cj-chip">' + (q.linkMethod === 'manual' ? '수동 연결' : '자동 연결') + ' ' + fmtDate(q.linkedAt) + '</span>' : ' <span class="cj-chip off">미연결</span>')
        + (q.memo ? '<div class="cj-muted">' + esc(q.memo) + '</div>' : '')]);
    });
    return sec('기본 정보', rows.length ? kv(rows) : '<div class="cj-muted">정보 없음</div>');
  }

  function secOrigin(d) {
    var steps = (d.origin && d.origin.steps) || [];
    if (!steps.length) return '';
    var body = '<div class="cj-tl">' + steps.map(function (s) {
      return '<div class="cj-tl-item k-stage"><div class="cj-tl-ic">' + (s.key === 'potential' ? '🌱' : s.key === 'signup' ? '👤' : s.key === 'first_donation' ? '💝' : s.key === 'regular' ? '🔁' : '⏹') + '</div>'
        + '<div class="cj-tl-row1"><span class="cj-tl-label">' + esc(s.label) + '</span><span class="cj-tl-at">' + fmtDate(s.at) + '</span></div>'
        + (s.detail ? '<div class="cj-tl-detail">' + esc(s.detail) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    return sec('시작 → 전환 경로', body);
  }

  function secDonations(d) {
    var s = (d.donations && d.donations.summary) || {}; var list = (d.donations && d.donations.list) || []; var r = d.regular || {};
    var tiles = '<div class="cj-tiles">'
      + '<div class="cj-tile"><div class="l">후원 합계</div><div class="v">' + won(s.completedAmount) + '</div><div class="s">완료 ' + (s.completedCount || 0) + '건</div></div>'
      + '<div class="cj-tile"><div class="l">첫 후원</div><div class="v" style="font-size:13px">' + fmtDate(s.firstPaidAt) + '</div><div class="s">마지막 ' + fmtDate(s.lastPaidAt) + '</div></div>'
      + '<div class="cj-tile"><div class="l">정기 / 일시</div><div class="v">' + (s.regularCount || 0) + ' / ' + (s.onetimeCount || 0) + '</div><div class="s">평균 ' + won(s.avgAmount) + '</div></div>'
      + '<div class="cj-tile"><div class="l">' + (r.isActive ? '월 정기' : '정기 상태') + '</div><div class="v">' + (r.isActive ? (r.monthlyAmount ? won(r.monthlyAmount) : '금액 미상') : (d.stage === 'prospect_cancelled' ? '해지' : '없음')) + '</div><div class="s">' + (r.isActive ? (r.nextBillingDate ? '다음 ' + fmtDate(r.nextBillingDate) : (r.regularMonthsCount ? '누적 ' + r.regularMonthsCount + '개월' : '')) : (r.monthlyAmount ? '약정 ' + won(r.monthlyAmount) : '')) + '</div></div>'
      + '</div>';
    if ((s.pendingCount || 0) + (s.failedCount || 0) > 0) tiles += '<div class="cj-muted" style="margin-bottom:8px">대기 ' + (s.pendingCount || 0) + '건 · 실패/취소/환불 ' + (s.failedCount || 0) + '건</div>';
    var bars = '';
    var by = s.byYear || [];
    if (by.length) {
      var max = Math.max.apply(null, by.map(function (y) { return y.amount; })) || 1;
      bars += '<div class="cj-bars">' + by.map(function (y) { return '<div class="cj-bar"><span>' + y.year + '년</span><span class="t"><i style="width:' + Math.round(y.amount / max * 100) + '%"></i></span><span class="n">' + won(y.amount) + ' · ' + y.count + '건</span></div>'; }).join('') + '</div>';
    }
    var byc = s.byCampaign || [];
    if (byc.length) bars += '<div class="cj-muted" style="margin-top:8px">대상: ' + esc(byc.map(function (c) { return c.label + ' ' + won(c.amount) + '(' + c.count + ')'; }).join(' · ')) + '</div>';
    var bym = s.byMethod || [];
    if (bym.length) bars += '<div class="cj-muted" style="margin-top:3px">수단: ' + esc(bym.map(function (c) { return c.method + ' ' + won(c.amount) + '(' + c.count + ')'; }).join(' · ')) + '</div>';
    var table = '';
    if (list.length) {
      var showAll = !!state.showAll.donations; var rows = showAll ? list : list.slice(0, 8);
      table = '<table class="cj-table" style="margin-top:8px"><thead><tr><th>일시</th><th>종류</th><th class="r">금액</th><th>수단·대상</th><th>상태</th></tr></thead><tbody>'
        + rows.map(function (x) {
          return '<tr><td style="white-space:nowrap">' + fmtDate(x.paidAt || x.createdAt) + '</td><td>' + (x.type === 'regular' ? '정기' : '일시') + '</td><td class="r">' + won(x.amount) + '</td>'
            + '<td>' + esc([x.payMethod, x.pgProvider, x.campaign, x.hyosungBillingMonth, x.bankDepositorName ? '입금자 ' + x.bankDepositorName : null].filter(Boolean).join(' · ')) + (x.receiptNumber ? ' <span class="cj-chip">확인서 ' + esc(x.receiptNumber) + '</span>' : '') + '</td>'
            + '<td>' + esc(ko(x.status)) + (x.failureReason ? ' <span class="cj-muted">' + esc(x.failureReason) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>'
        + (list.length > 8 ? '<button class="cj-more" type="button" onclick="window.__cjToggle(\'donations\')">' + (showAll ? '접기' : '후원 ' + list.length + '건 전체 보기') + '</button>' : '');
    }
    return sec('후원', tiles + bars + table, list.length ? list.length + '건' : null);
  }

  function secPayment(d) {
    var r = d.regular || {}; var out = '';
    var hy = r.hyosung;
    (r.contracts || []).forEach(function (c) {
      out += '<div class="cj-card"><div class="cj-card-head">🏦 효성 CMS 약정'
        + '<span class="cj-chip ' + (String(c.contractStatus || '').toLowerCase() === 'active' ? 'on' : 'off') + '">' + esc(c.contractStatus || '상태 미상') + '</span>'
        + (c.productAmount != null ? '<span>' + won(c.productAmount) + (c.promiseDay ? ' · 매월 ' + c.promiseDay + '일' : '') + '</span>' : '') + '</div>'
        + kv([
          ['효성 회원번호', esc(c.memberNo)], ['결제 수단', esc([c.paymentMethod, c.paymentTool].filter(Boolean).join(' · '))],
          ['계좌·카드', esc(c.paymentInfo)], ['예금주', esc(c.accountHolder)], ['상품', esc(c.productName)],
          ['약정 기간', (c.billingStart ? fmtDate(c.billingStart) : '-') + ' ~ ' + (c.billingEnd ? (isOpenEnded(c.billingEnd) ? '무기한' : fmtDate(c.billingEnd)) : '')],
          ['등록·동의', esc([c.registrationStatus, c.agreementStatus, c.electronicContract].filter(Boolean).join(' · '))],
          ['회원 상태', esc([c.memberStatus, c.memberType].filter(Boolean).join(' · '))], ['담당', esc(c.managerName)], ['갱신', c.updatedAt ? fmtDate(c.updatedAt) : null]
        ]) + '</div>';
    });
    if (!(r.contracts || []).length && hy) {
      out += '<div class="cj-card"><div class="cj-card-head">🏦 효성 CMS (회원 정보 기준)<span class="cj-chip">' + esc(hy.contractStatus || '-') + '</span></div>'
        + kv([['효성 회원번호', esc(hy.memberNo)], ['결제 수단', esc([hy.paymentMethod, hy.paymentTool].filter(Boolean).join(' · '))], ['계좌 정보', esc(hy.bankInfo)], ['출금일', hy.promiseDay ? '매월 ' + hy.promiseDay + '일' : null], ['동기화', hy.syncedAt ? fmtDateTime(hy.syncedAt) : null]]) + '</div>';
    }
    var hb = r.hyosungBillings || {};
    if (hb.count) {
      var showAllH = !!state.showAll.hyosung; var hl = hb.list || []; var rowsH = showAllH ? hl : hl.slice(0, 6);
      out += '<div class="cj-card"><div class="cj-card-head">효성 수납 내역 <span class="cj-muted">' + hb.count + '건 · 수납 ' + won(hb.receivedSum) + (hb.unpaidSum ? ' · 미납 ' + won(hb.unpaidSum) : '') + (hb.lastPaymentDate ? ' · 마지막 ' + fmtDate(hb.lastPaymentDate) : '') + '</span></div>'
        + '<table class="cj-table"><thead><tr><th>청구월</th><th class="r">청구</th><th class="r">수납</th><th class="r">미납</th><th>결과</th><th>납부일</th></tr></thead><tbody>'
        + rowsH.map(function (h) { return '<tr><td>' + esc(h.billingMonth || '-') + '</td><td class="r">' + won(h.billingAmount) + '</td><td class="r">' + won(h.receivedAmount) + '</td><td class="r">' + (h.unpaidAmount ? won(h.unpaidAmount) : '-') + '</td><td>' + esc([h.receiptStatus, h.paymentStatus, h.paymentResult].filter(Boolean).join(' · ') || '-') + '</td><td style="white-space:nowrap">' + fmtDate(h.paymentDate) + '</td></tr>'; }).join('')
        + '</tbody></table>' + (hl.length > 6 ? '<button class="cj-more" type="button" onclick="window.__cjToggle(\'hyosung\')">' + (showAllH ? '접기' : hl.length + '건 전체 보기') + '</button>' : '') + '</div>';
    }
    (r.billingKeys || []).forEach(function (b) {
      out += '<div class="cj-card"><div class="cj-card-head">💳 카드 정기 (' + esc(b.pgProvider || 'PG') + ')<span class="cj-chip ' + (b.isActive ? 'on' : 'off') + '">' + (b.isActive ? '활성' : '해지') + '</span>' + (b.amount ? '<span>' + won(b.amount) + '</span>' : '') + '</div>'
        + kv([['카드', esc([b.cardCompany, b.cardNumberMasked, b.cardType].filter(Boolean).join(' '))], ['등록', fmtDate(b.createdAt)], ['다음 청구', b.nextChargeAt ? fmtDate(b.nextChargeAt) : null], ['마지막 청구', b.lastChargedAt ? fmtDate(b.lastChargedAt) : null],
          ['연속 실패', b.consecutiveFailCount ? b.consecutiveFailCount + '회' + (b.lastFailureReason ? ' — ' + esc(b.lastFailureReason) : '') : null], ['해지', b.deactivatedAt ? fmtDate(b.deactivatedAt) + (b.deactivatedReason ? ' — ' + esc(b.deactivatedReason) : '') : null]]) + '</div>';
    });
    var bl = r.billingLogs || [];
    if (bl.length) {
      var showAllB = !!state.showAll.billing; var rowsB = showAllB ? bl : bl.slice(0, 5);
      out += '<div class="cj-card"><div class="cj-card-head">카드 청구 시도 <span class="cj-muted">' + bl.length + '건</span></div><table class="cj-table"><thead><tr><th>요청</th><th>구분</th><th class="r">금액</th><th>결과</th></tr></thead><tbody>'
        + rowsB.map(function (l) { return '<tr><td style="white-space:nowrap">' + fmtDateTime(l.requestedAt) + '</td><td>' + esc(l.attemptType || '-') + (l.attemptNumber ? ' #' + l.attemptNumber : '') + '</td><td class="r">' + won(l.amount) + '</td><td>' + esc(ko(l.status)) + (l.pgResponseMessage ? ' <span class="cj-muted">' + esc(l.pgResponseMessage) + '</span>' : '') + '</td></tr>'; }).join('')
        + '</tbody></table>' + (bl.length > 5 ? '<button class="cj-more" type="button" onclick="window.__cjToggle(\'billing\')">' + (showAllB ? '접기' : bl.length + '건 전체 보기') + '</button>' : '') + '</div>';
    }
    var bm = r.bankMatches || [];
    if (bm.length) {
      out += '<div class="cj-card"><div class="cj-card-head">🏧 계좌 입금 매칭 <span class="cj-muted">' + bm.length + '건</span></div><table class="cj-table"><thead><tr><th>입금일</th><th>입금자</th><th class="r">금액</th><th>계좌 끝</th><th>상태</th></tr></thead><tbody>'
        + bm.slice(0, 10).map(function (b) { return '<tr><td style="white-space:nowrap">' + fmtDate(b.parsedDate) + '</td><td>' + esc(b.parsedName || '-') + '</td><td class="r">' + won(b.parsedAmount) + '</td><td>' + esc(b.parsedAccountTail4 || '-') + '</td><td>' + esc(ko(b.status)) + (b.matchReason ? ' <span class="cj-muted">' + esc(b.matchReason) + '</span>' : '') + '</td></tr>'; }).join('')
        + '</tbody></table></div>';
    }
    if (!out) out = '<div class="cj-muted">등록된 약정·카드·입금 기록이 없습니다.</div>';
    return sec('결제 수단 · 약정 · 입금', out);
  }

  function secComms(d) {
    var c = d.comms || {}; var n = c.nurture || {}; var enr = n.enrollments || []; var ns = n.sends || []; var sends = c.sends || []; var noti = c.notifications || [];
    if (!enr.length && !ns.length && !sends.length && !noti.length) return sec('발송 · 너처링', '<div class="cj-muted">발송 기록이 없습니다.</div>');
    var out = '';
    if (enr.length) out += '<div style="margin-bottom:6px">' + enr.map(function (e) { return '<span class="cj-chip ' + (e.status === 'active' ? 'on' : '') + '">💌 ' + esc(e.journeyName || e.segment || '여정') + ' · ' + esc(e.status || '') + ' · ' + fmtDate(e.enrolledAt) + '</span>'; }).join('') + '</div>';
    var cnt = {}; ns.concat(sends).forEach(function (x) { var k = x.channel || '기타'; cnt[k] = (cnt[k] || 0) + 1; });
    var keys = Object.keys(cnt);
    if (keys.length) out += '<div class="cj-muted" style="margin-bottom:6px">발송 ' + esc(keys.map(function (k) { return k + ' ' + cnt[k] + '건'; }).join(' · ')) + (noti.length ? ' · 알림 ' + noti.length + '건' : '') + '</div>';
    var recent = ns.map(function (x) { return { at: x.sentAt, t: '너처링 ' + (x.journeyName || '') + ' ' + (x.stepLabel || (x.dayOffset != null ? 'D+' + x.dayOffset : '')), ch: x.channel, st: x.status }; })
      .concat(sends.map(function (x) { return { at: x.sentAt || x.createdAt, t: x.jobName || x.subject || '발송', ch: x.channel, st: x.status + (x.openedAt ? ' · 열람' : '') + (x.clickedAt ? ' · 클릭' : '') }; }))
      .concat(noti.map(function (x) { return { at: x.sentAt || x.createdAt, t: '알림 ' + (x.eventType || ''), ch: x.channel, st: x.status }; }))
      .filter(function (x) { return x.at; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var showAll = !!state.showAll.comms; var rows = showAll ? recent : recent.slice(0, 5);
    if (rows.length) out += '<table class="cj-table"><thead><tr><th>시각</th><th>내용</th><th>채널</th><th>상태</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td style="white-space:nowrap">' + fmtDateTime(x.at) + '</td><td>' + esc(x.t) + '</td><td>' + esc(x.ch || '-') + '</td><td>' + esc(ko(x.st)) + '</td></tr>'; }).join('') + '</tbody></table>'
      + (recent.length > 5 ? '<button class="cj-more" type="button" onclick="window.__cjToggle(\'comms\')">' + (showAll ? '접기' : recent.length + '건 전체 보기') + '</button>' : '');
    return sec('발송 · 너처링', out, recent.length ? recent.length + '건' : null);
  }

  function secSupport(d) {
    var s = d.support; if (!s || !s.total) return '';
    return sec('유족 지원 신청', '<div class="cj-muted" style="margin-bottom:4px">총 ' + s.total + '건 · 진행 중 ' + s.inProgress + '건</div><table class="cj-table"><tbody>'
      + s.list.map(function (x) { return '<tr><td style="white-space:nowrap">' + fmtDate(x.createdAt) + '</td><td>' + esc(x.title || x.requestNo || '-') + '</td><td>' + esc([x.category, x.status].filter(Boolean).join(' · ')) + '</td></tr>'; }).join('') + '</tbody></table>', s.total + '건');
  }

  function secTimeline(d) {
    var tl = d.timeline || [];
    var allow = FILTER_GROUPS[state.filter];
    var items = allow ? tl.filter(function (x) { return allow.indexOf(x.kind) >= 0; }) : tl;
    var chips = '<div class="cj-filters">' + FILTERS.map(function (f) { return '<button type="button" class="' + (state.filter === f[0] ? 'on' : '') + '" onclick="window.__cjFilter(\'' + f[0] + '\')">' + f[1] + '</button>'; }).join('') + '</div>';
    if (!items.length) return sec('통합 타임라인', chips + '<div class="cj-muted">기록이 없습니다.</div>', tl.length ? tl.length + '건' : null);
    var shown = items.slice(0, state.tlLimit);
    var body = '<div class="cj-tl">' + shown.map(function (x) {
      var k = KIND[x.kind] || ['•', x.kind];
      var cls = 'cj-tl-item k-' + esc(x.kind) + (x.status ? ' st-' + esc(String(x.status)) : '');
      return '<div class="' + cls + '"><div class="cj-tl-ic">' + k[0] + '</div><div class="cj-tl-row1"><span class="cj-tl-label">' + esc(k[1]) + '</span><span class="cj-tl-at">' + fmtDateTime(x.at) + '</span></div>'
        + '<div class="cj-tl-title">' + esc(x.title) + (x.amount ? '<span class="amt">' + won(x.amount) + '</span>' : '') + '</div>'
        + (x.detail ? '<div class="cj-tl-detail">' + esc(x.detail) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    if (items.length > shown.length) body += '<button class="cj-more" type="button" onclick="window.__cjMore()">더 보기 (' + (items.length - shown.length) + '건 남음)</button>';
    return sec('통합 타임라인', chips + body, tl.length + '건' + (d.meta && d.meta.timelineTotal > tl.length ? ' (최근 ' + tl.length + '건만)' : ''));
  }

  function secNotes(d) {
    var n = d.notes || { ready: true, list: [] };
    var box = '<div class="cj-note-box"><textarea id="cjNoteText" placeholder="상담 내용·약속·특이사항 — 작성자와 시각이 함께 남습니다 (Ctrl+Enter 저장)"' + (n.ready ? '' : ' disabled') + '></textarea>'
      + '<div class="cj-note-row"><span class="cj-muted">' + (n.ready ? '관리자 공유 메모 · 고객에게는 보이지 않음' : '메모 저장소 준비 전 — migrate-customer-journey 실행 필요') + '</span>'
      + '<button class="cms-btn cms-btn-primary" type="button" onclick="window.__cjAddNote()"' + (n.ready ? '' : ' disabled') + '>메모 저장</button></div></div>';
    var list = n.list || [];
    var items = list.length ? '<div class="cj-notes">' + list.map(function (x) {
      return '<div class="cj-note' + (x.pinned ? ' pinned' : '') + '"><div class="cj-note-head"><span>' + fmtDateTime(x.createdAt) + '</span><span>' + esc(x.createdByName || '관리자') + '</span>' + (x.pinned ? '<span class="cj-chip">고정</span>' : '')
        + '<button class="cj-more" type="button" onclick="window.__cjPinNote(' + x.id + ',' + (x.pinned ? 'false' : 'true') + ')">' + (x.pinned ? '고정 해제' : '고정') + '</button>'
        + '<button class="cj-more" type="button" style="color:#c5293a" onclick="window.__cjDeleteNote(' + x.id + ')">삭제</button></div>'
        + '<div class="cj-note-body">' + esc(x.body) + '</div></div>';
    }).join('') + '</div>' : '<div class="cj-muted" style="margin-top:8px">아직 메모가 없습니다.</div>';
    return sec('관리자 메모', box + items, list.length ? list.length + '건' : null);
  }

  /* ───────── 동작 ───────── */
  window.__cjFilter = function (f) { state.filter = f; state.tlLimit = 60; render(); };
  window.__cjMore = function () { state.tlLimit += 80; render(); };
  window.__cjToggle = function (key) { state.showAll[key] = !state.showAll[key]; render(); };

  function noteTarget() {
    var d = state.data || {}; var sub = d.subject || {};
    if (sub.memberId) return { memberId: sub.memberId };
    if (sub.potentialId) return { potentialId: sub.potentialId };
    return state.subject.memberId ? { memberId: state.subject.memberId } : { potentialId: state.subject.potentialId };
  }
  window.__cjAddNote = async function () {
    if (state.busy) return;
    var ta = document.getElementById('cjNoteText'); var text = (ta && ta.value || '').trim();
    if (!text) { toast('메모 내용을 입력하세요'); return; }
    state.busy = true;
    var body = noteTarget(); body.body = text;
    var res = await api('/api/admin/customer-notes', { method: 'POST', body: body });
    state.busy = false;
    if (!res.ok) { toast('메모 저장 실패: ' + (res.data && (res.data.error || res.data.detail) || res.status)); return; }
    toast('메모를 저장했습니다'); load();
  };
  window.__cjPinNote = async function (id, pinned) {
    var res = await api('/api/admin/customer-notes', { method: 'PATCH', body: { id: id, pinned: pinned } });
    if (!res.ok) { toast('실패: ' + (res.data && res.data.error || res.status)); return; }
    load();
  };
  window.__cjDeleteNote = async function (id) {
    if (!confirm('이 메모를 삭제할까요?')) return;
    var res = await api('/api/admin/customer-notes', { method: 'DELETE', body: { id: id } });
    if (!res.ok) { toast('삭제 실패: ' + (res.data && res.data.error || res.status)); return; }
    toast('삭제했습니다'); load();
  };
  window.__cjMoveStage = async function () {
    if (state.busy) return;
    var sel = document.getElementById('cjMoveStage'); var reason = (document.getElementById('cjMoveReason') || {}).value || '';
    var to = sel && sel.value; if (!to) return;
    var cur = state.data && state.data.stage;
    if (to === cur && !confirm('현재 단계와 같습니다. 그래도 수동 지정으로 기록할까요?')) return;
    var label = (STAGE[to] || {}).label || to;
    if (!confirm('이 고객을 «' + label + '» 단계로 옮깁니다. 이력에 남습니다. 진행할까요?')) return;
    state.busy = true;
    var body = noteTarget(); body.toStage = to; body.reason = reason;
    var res = await api('/api/admin/donor-stage-move', { method: 'POST', body: body });
    state.busy = false;
    if (!res.ok) { toast('단계 이동 실패: ' + (res.data && (res.data.error || res.data.detail) || res.status)); return; }
    toast(res.data && res.data.message || '단계를 옮겼습니다');
    var moved = unwrap(res.data);
    if (moved && moved.memberId) state.subject = { memberId: moved.memberId, name: state.subject.name };
    load();
    /* 표도 새로 그리기(열려 있는 화면의 렌더 함수가 있으면) */
    ['renderPotentialDonor', 'renderDonorRegular', 'renderDonorProspect'].forEach(function (fn) { if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) { /* 무시 */ } } });
  };
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target && e.target.id === 'cjNoteText') { e.preventDefault(); window.__cjAddNote(); }
  });
})();
