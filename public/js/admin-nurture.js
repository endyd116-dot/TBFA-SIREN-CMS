/* 후원자 너처링 어드민 — 카드형 타임라인 편집 + 미리보기 (2026-06-26 고도화) */
(function () {
  'use strict';
  var API = '/api/admin-nurture';
  var STATE = null;
  var CHANNELS = [['sms', '💬 문자'], ['kakao', '📨 알림톡(승인필요)'], ['email', '📧 메일'], ['inapp', '🔔 앱']];
  var CADENCES = [['monthly', '매월'], ['quarterly', '분기'], ['anniversary', '기념일'], ['yearend', '연말']];
  var TAB_SEG = { regular: ['regular'], prospect: ['prospect_onetime', 'prospect_cancelled'], potential: ['potential'] };
  var curTab = 'regular';

  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(window._t); window._t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function api(method, body) {
    return fetch(API, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (r.status === 401 || r.status === 403) { location.href = '/admin.html'; throw new Error('auth'); } return r.json().then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function load() {
    fetch(API, { credentials: 'include' }).then(function (r) { if (r.status === 401 || r.status === 403) { location.href = '/admin.html'; throw new Error('auth'); } return r.json(); })
      .then(function (d) { STATE = d.data; render(); })
      .catch(function (e) { if (e.message !== 'auth') document.getElementById('content').innerHTML = '<div class="hint">불러오기 실패</div>'; });
  }

  function tpls() { return (STATE.templates || []); }
  function tplById(id) { for (var i = 0; i < tpls().length; i++) { if (Number(tpls()[i].id) === Number(id)) return tpls()[i]; } return null; }
  function tplOptions(sel, ch) {
    var o = '<option value="">— 선택 —</option>';
    tpls().forEach(function (t) {
      if (ch && t.channel !== ch) return;
      o += '<option value="' + t.id + '"' + (Number(sel) === Number(t.id) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    });
    return o;
  }
  function selOptions(list, sel) { return list.map(function (x) { return '<option value="' + x[0] + '"' + (sel === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join(''); }

  /* 미리보기 — 템플릿 본문을 샘플 이름으로 렌더(문자=텍스트, 메일=HTML 일부 텍스트화) */
  function renderPreview(id) {
    var t = tplById(id);
    if (!t) return '<span class="pv-empty">템플릿을 선택하면 실제 발송 문구가 여기 보입니다.</span>';
    var body = String(t.body || '');
    if (t.channel === 'email') body = body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    body = body.replace(/\{\{\s*([^}]+)\s*\}\}/g, function (_, k) { return /이름|name/.test(k) ? '김후원' : ''; }).trim();
    var sub = t.subject ? '<div class="pv-sub">📧 ' + esc(t.subject.replace(/\{\{[^}]+\}\}/g, '김후원')) + '</div>' : '';
    return sub + esc(body);
  }

  function render() {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === curTab); });
    if (curTab === 'analytics') { renderAnalytics(); return; }
    var segs = TAB_SEG[curTab];
    var html = '';
    segs.forEach(function (seg) {
      var j = (STATE.journeys || []).find(function (x) { return x.segment === seg; });
      if (j) html += journeyCard(j);
    });
    if (!html) html = '<div class="hint">이 세그먼트 여정이 없습니다.</div>';
    document.getElementById('content').innerHTML = html;
    wire();
  }

  function journeyCard(j) {
    var k = (STATE.kpi || []).find(function (x) { return Number(x.journeyId) === Number(j.id); }) || {};
    var steps = (STATE.steps || []).filter(function (s) { return Number(s.journeyId) === Number(j.id); });
    var evs = (STATE.evergreen || []).filter(function (e) { return Number(e.journeyId) === Number(j.id); });
    var h = '<div class="jcard" data-jid="' + j.id + '">';
    h += '<div class="jhead"><div><div class="jname">' + esc(j.name) + '</div>';
    h += '<div class="kpi">활성 <b>' + (k.activeCount || 0) + '</b>명 · 전환 <b>' + (k.convertedCount || 0) + '</b>명 · 누적발송 <b>' + (k.sentCount || 0) + '</b>건</div></div>';
    h += '<div class="toggle" data-act="toggle"><span>' + (j.isActive ? '발송 ON' : '발송 OFF') + '</span><div class="switch ' + (j.isActive ? 'on' : '') + '"><i></i></div></div></div>';
    if (!j.isActive) h += '<div class="off-note">⚠ 현재 OFF — 단계를 검토·테스트한 뒤 켜면 매일 자동 발송됩니다.</div>';

    h += '<div class="sec-title">📅 타임라인 (D0~D365) <span class="hint">문자/카톡이 1차, 메일은 보조(있으면 추가 발송)</span></div>';
    h += '<div class="cards">';
    steps.forEach(function (s) { h += stepCard(j.id, s); });
    h += '</div>';
    h += '<button class="btn add-step" data-act="addStep" data-jid="' + j.id + '">＋ 단계 추가</button>';

    h += '<div class="sec-title">🔁 D365 이후 영구 규칙</div>';
    h += '<div class="cards">';
    evs.forEach(function (e) { h += evCard(j.id, e); });
    h += '</div>';
    h += '<button class="btn add-ev" data-act="addEv" data-jid="' + j.id + '">＋ 영구 규칙 추가</button>';

    h += '<div class="foot"><button class="btn btn-p" data-act="preview">👁 오늘 발송 미리보기</button>';
    h += '<input type="email" placeholder="테스트 받을 이메일" class="testEmail" style="width:200px"></div>';
    h += '</div>';
    return h;
  }

  /* 단계 카드 — s=null이면 새 입력 카드 */
  function stepCard(jid, s) {
    var ch = s ? s.channel : 'sms';
    return '<div class="step-card' + (s ? '' : ' new') + '" data-sid="' + (s ? s.id : '') + '" data-jid="' + jid + '">' +
      '<div class="sc-top">' +
        '<span class="sc-day">D+<input class="f-day" type="number" min="0" max="365" value="' + (s ? s.dayOffset : '') + '"></span>' +
        '<input class="f-label sc-label" value="' + esc(s ? s.label : '') + '" placeholder="단계 이름 (예: 환영 인사)">' +
        '<label class="sc-active"><input type="checkbox" class="f-active"' + (!s || s.isActive ? ' checked' : '') + '> 사용</label>' +
      '</div>' +
      '<div class="sc-grid">' +
        '<div class="sc-f"><label>1차 채널</label><select class="f-ch">' + selOptions(CHANNELS, ch) + '</select></div>' +
        '<div class="sc-f sc-grow"><label>1차 템플릿</label><select class="f-tpl">' + tplOptions(s ? s.templateId : '') + '</select></div>' +
      '</div>' +
      '<div class="sc-preview" data-prev="tpl">' + renderPreview(s ? s.templateId : '') + '</div>' +
      '<div class="sc-grid">' +
        '<div class="sc-f sc-grow"><label>보조 메일(선택)</label><select class="f-emailtpl">' + tplOptions(s ? s.emailTemplateId : '', 'email') + '</select></div>' +
      '</div>' +
      '<div class="sc-actions">' +
        '<button class="btn btn-sm btn-p" data-act="saveStep">' + (s ? '저장' : '추가') + '</button>' +
        (s ? '<button class="btn btn-sm" data-act="testStep">✉ 테스트</button><button class="btn btn-sm btn-del" data-act="delStep">삭제</button>' : '<button class="btn btn-sm" data-act="cancelNew">취소</button>') +
      '</div>' +
    '</div>';
  }

  function evCard(jid, e) {
    return '<div class="step-card' + (e ? '' : ' new') + '" data-eid="' + (e ? e.id : '') + '" data-jid="' + jid + '">' +
      '<div class="sc-top">' +
        '<span class="sc-day"><select class="f-cad">' + selOptions(CADENCES, e ? e.cadence : 'quarterly') + '</select></span>' +
        '<input class="f-label sc-label" value="' + esc(e ? e.label : '') + '" placeholder="규칙 이름 (예: 분기 소식)">' +
        '<label class="sc-active"><input type="checkbox" class="f-active"' + (!e || e.isActive ? ' checked' : '') + '> 사용</label>' +
      '</div>' +
      '<div class="sc-grid">' +
        '<div class="sc-f"><label>1차 채널</label><select class="f-ch">' + selOptions(CHANNELS, e ? e.channel : 'sms') + '</select></div>' +
        '<div class="sc-f sc-grow"><label>1차 템플릿</label><select class="f-tpl">' + tplOptions(e ? e.templateId : '') + '</select></div>' +
      '</div>' +
      '<div class="sc-preview" data-prev="tpl">' + renderPreview(e ? e.templateId : '') + '</div>' +
      '<div class="sc-grid">' +
        '<div class="sc-f sc-grow"><label>보조 메일(선택)</label><select class="f-emailtpl">' + tplOptions(e ? e.emailTemplateId : '', 'email') + '</select></div>' +
      '</div>' +
      '<div class="sc-actions">' +
        '<button class="btn btn-sm btn-p" data-act="saveEv">' + (e ? '저장' : '추가') + '</button>' +
        (e ? '<button class="btn btn-sm btn-del" data-act="delEv">삭제</button>' : '<button class="btn btn-sm" data-act="cancelNew">취소</button>') +
      '</div>' +
    '</div>';
  }

  function renderAnalytics() {
    var box = document.getElementById('content');
    box.innerHTML = '<div class="hint">성과 불러오는 중…</div>';
    var SEGNAME = { regular: '정기', prospect_onetime: '예비-일시', prospect_cancelled: '예비-이탈', potential: '잠재' };
    api('POST', { action: 'analytics' }).then(function (r) {
      if (!r.ok) { box.innerHTML = '<div class="hint">성과 불러오기 실패</div>'; return; }
      var d = r.data.data || {};
      var fm = {}, sm = {}, ch = {}; var rec = d.recent || {};
      (d.funnel || []).forEach(function (f) { fm[f.journeyId] = f; });
      (d.sentByJourney || []).forEach(function (s) { sm[s.journeyId] = s.sent; });
      (d.channelTotals || []).forEach(function (c) { ch[c.channel] = c.cnt; });
      var h = '<div class="jcard"><div class="jname">📈 전체 발송</div>';
      h += '<div class="kpi" style="font-size:14px;margin-top:6px">최근 7일 <b>' + (rec.d7 || 0) + '</b>건 · 30일 <b>' + (rec.d30 || 0) + '</b>건 · 누적 <b>' + (rec.total || 0) + '</b>건</div>';
      h += '<div class="kpi" style="margin-top:8px">채널: 💬 문자 <b>' + (ch.sms || 0) + '</b> · 📨 카톡 <b>' + (ch.kakao || 0) + '</b> · 📧 메일 <b>' + (ch.email || 0) + '</b> · 🔔 앱 <b>' + (ch.inapp || 0) + '</b></div>';
      var et = d.emailTracking || {};
      var or = et.sent ? Math.round((et.opens || 0) * 1000 / et.sent) / 10 : 0;
      var cr = et.sent ? Math.round((et.clicks || 0) * 1000 / et.sent) / 10 : 0;
      h += '<div class="kpi" style="margin-top:6px">보조 메일 추적: 발송 <b>' + (et.sent || 0) + '</b> · 오픈 <b>' + (et.opens || 0) + '</b> (' + or + '%) · 클릭 <b>' + (et.clicks || 0) + '</b> (' + cr + '%)</div></div>';
      (d.journeys || []).forEach(function (j) {
        var f = fm[j.id] || {}; var sent = sm[j.id] || 0;
        var conv = f.converted || 0; var denom = conv + (f.active || 0) + (f.exited || 0);
        var rate = denom ? Math.round(conv * 1000 / denom) / 10 : 0;
        h += '<div class="jcard"><div class="jhead"><div class="jname">' + esc(SEGNAME[j.segment] || j.segment) + ' — ' + esc(j.name) + '</div>';
        h += '<div class="kpi">' + (j.isActive ? '<span style="color:#1a8b46">발송 ON</span>' : '<span style="color:#c47a00">OFF</span>') + '</div></div>';
        h += '<div class="kpi" style="font-size:13.5px;margin-top:6px">등록 <b>' + (f.enrolled || 0) + '</b> · 활성 <b>' + (f.active || 0) + '</b> · 전환 <b>' + conv + '</b> · 이탈 <b>' + (f.exited || 0) + '</b> · 발송 <b>' + sent + '</b>건</div>';
        h += '<div class="kpi" style="margin-top:4px">전환율 <b style="color:#7a1f2b">' + rate + '%</b></div></div>';
      });
      box.innerHTML = h;
    }).catch(function () { box.innerHTML = '<div class="hint">성과 불러오기 실패</div>'; });
  }

  function collectStep(card) {
    return { dayOffset: Number(card.querySelector('.f-day').value), channel: card.querySelector('.f-ch').value, templateId: card.querySelector('.f-tpl').value || null, emailTemplateId: card.querySelector('.f-emailtpl').value || null, label: card.querySelector('.f-label').value, isActive: card.querySelector('.f-active').checked };
  }

  function wire() {
    document.querySelectorAll('[data-act="toggle"]').forEach(function (el) {
      el.onclick = function () {
        var card = el.closest('.jcard'); var jid = Number(card.dataset.jid);
        var j = STATE.journeys.find(function (x) { return Number(x.id) === jid; });
        var next = !j.isActive;
        if (next && !confirm('이 여정을 켜면 매일 자동으로 후원자에게 메시지가 발송됩니다.\n단계·문구를 검토하셨나요?')) return;
        api('POST', { action: 'toggleJourney', journeyId: jid, isActive: next }).then(function (r) { if (r.ok) { toast(next ? '발송 ON' : '발송 OFF'); load(); } else toast('실패'); });
      };
    });

    /* 템플릿 선택 변경 → 미리보기 즉시 갱신 */
    document.querySelectorAll('.step-card .f-tpl').forEach(function (sel) {
      sel.onchange = function () {
        var pv = sel.closest('.step-card').querySelector('[data-prev="tpl"]');
        if (pv) pv.innerHTML = renderPreview(sel.value);
      };
    });

    /* 단계 추가 버튼 → 새 입력 카드 삽입 */
    document.querySelectorAll('[data-act="addStep"]').forEach(function (b) {
      b.onclick = function () { var cards = b.previousElementSibling; cards.insertAdjacentHTML('beforeend', stepCard(Number(b.dataset.jid), null)); wire(); };
    });
    document.querySelectorAll('[data-act="addEv"]').forEach(function (b) {
      b.onclick = function () { var cards = b.previousElementSibling; cards.insertAdjacentHTML('beforeend', evCard(Number(b.dataset.jid), null)); wire(); };
    });
    document.querySelectorAll('[data-act="cancelNew"]').forEach(function (b) {
      b.onclick = function () { b.closest('.step-card').remove(); };
    });

    document.querySelectorAll('.step-card').forEach(function (card) {
      card.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          var act = btn.dataset.act, jid = Number(card.dataset.jid);
          var sid = card.dataset.sid ? Number(card.dataset.sid) : 0;
          var eid = card.dataset.eid != null && card.dataset.eid !== '' ? Number(card.dataset.eid) : 0;
          if (act === 'saveStep') {
            var p = collectStep(card); p.action = 'saveStep'; p.journeyId = jid; if (sid) p.id = sid;
            api('POST', p).then(function (r) { if (r.ok) { toast('저장됐어요'); load(); } else toast('실패: ' + (r.data.detail || '')); });
          } else if (act === 'delStep') {
            if (!confirm('이 단계를 삭제할까요?')) return;
            api('POST', { action: 'deleteStep', id: sid }).then(function (r) { if (r.ok) { toast('삭제됨'); load(); } });
          } else if (act === 'testStep') {
            var to = prompt('테스트 메일을 받을 주소를 입력하세요'); if (!to) return;
            var tid = card.querySelector('.f-tpl').value; if (!tid) { toast('템플릿을 먼저 선택하세요'); return; }
            api('POST', { action: 'testSend', templateId: Number(tid), toEmail: to }).then(function (r) { toast(r.ok ? '테스트 발송함' : '발송 실패'); });
          } else if (act === 'saveEv') {
            var c = card.querySelector('.f-cad').value;
            var pe = { action: 'saveEvergreen', journeyId: jid, cadence: c, channel: card.querySelector('.f-ch').value, templateId: card.querySelector('.f-tpl').value || null, emailTemplateId: card.querySelector('.f-emailtpl').value || null, label: card.querySelector('.f-label').value, isActive: card.querySelector('.f-active').checked };
            if (eid) pe.id = eid;
            api('POST', pe).then(function (r) { if (r.ok) { toast('저장됐어요'); load(); } else toast('실패'); });
          } else if (act === 'delEv') {
            if (!confirm('이 영구 규칙을 삭제할까요?')) return;
            api('POST', { action: 'deleteEvergreen', id: eid }).then(function (r) { if (r.ok) { toast('삭제됨'); load(); } });
          }
        };
      });
    });

    document.querySelectorAll('[data-act="preview"]').forEach(function (btn) {
      btn.onclick = function () {
        api('POST', { action: 'preview' }).then(function (r) {
          if (!r.ok) { toast('미리보기 실패'); return; }
          var s = r.data.summary || {};
          alert('오늘 발송 미리보기 (실제 발송 안 함)\n\n활성 여정: ' + s.journeys + '\n단계 발송 대상: ' + (s.recipients || 0) + '명\n영구규칙 대상: ' + (s.evergreenRecipients || 0) + '명\n\n※ 켜진(ON) 여정만 집계됩니다.');
        });
      };
    });
  }

  document.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { curTab = t.dataset.tab; render(); }; });
  load();
})();
