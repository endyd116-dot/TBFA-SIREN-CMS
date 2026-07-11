/* 후원자 너처링 어드민 — 카드형 + 문구 직접편집(CRUD) + 사진(MMS) + 미리보기 (2026-06-26) */
(function () {
  'use strict';
  var API = '/api/admin-nurture';
  var STATE = null;
  var CHANNELS = [['sms', '문자'], ['kakao', '알림톡(승인필요)'], ['email', '메일'], ['inapp', '앱']];
  var CADENCES = [['monthly', '매월'], ['quarterly', '분기'], ['anniversary', '기념일'], ['yearend', '연말']];
  var TAB_SEG = { regular: ['regular'], prospect: ['prospect_onetime', 'prospect_cancelled'], potential: ['potential'] };
  var curTab = 'regular';

  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(window._t); window._t = setTimeout(function () { t.classList.remove('show'); }, 2400); }
  function api(method, body) {
    return fetch(API, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { if (r.status === 401 || r.status === 403) { location.href = '/admin.html'; throw new Error('auth'); } return r.json().then(function (d) { return { ok: r.ok && d.ok !== false, data: d }; }); });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function attr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

  function load() {
    fetch(API, { credentials: 'include' }).then(function (r) { if (r.status === 401 || r.status === 403) { location.href = '/admin.html'; throw new Error('auth'); } return r.json(); })
      .then(function (d) { STATE = d.data; render(); })
      .catch(function (e) { if (e.message !== 'auth') document.getElementById('content').innerHTML = '<div class="hint">불러오기 실패</div>'; });
  }

  function tpls() { return (STATE.templates || []); }
  function tplById(id) { for (var i = 0; i < tpls().length; i++) { if (Number(tpls()[i].id) === Number(id)) return tpls()[i]; } return null; }
  function bodyOf(id) { var t = tplById(id); return t ? String(t.body || '') : ''; }
  function subjectOf(id) { var t = tplById(id); return t ? String(t.subject || '') : ''; }
  function imgOf(id) { var t = tplById(id); return (t && t.images && t.images[0] && t.images[0].url) ? String(t.images[0].url) : ''; }
  function tplOptions(sel, ch) {
    var o = '<option value="">— 보조 메일 없음 —</option>';
    tpls().forEach(function (t) { if (ch && t.channel !== ch) return; o += '<option value="' + t.id + '"' + (Number(sel) === Number(t.id) ? ' selected' : '') + '>' + esc(t.name) + '</option>'; });
    return o;
  }
  function selOptions(list, sel) { return list.map(function (x) { return '<option value="' + x[0] + '"' + (sel === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join(''); }

  function previewText(txt) {
    if (!txt) return '<span class="pv-empty">메시지를 입력하면 미리보기가 여기 표시됩니다.</span>';
    return esc(String(txt).replace(/\{\{\s*([^}]+)\s*\}\}/g, function (_, k) { return /이름|name/.test(k) ? '김후원' : ''; }));
  }

  function render() {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === curTab); });
    if (curTab === 'analytics') { renderAnalytics(); return; }
    var html = '';
    TAB_SEG[curTab].forEach(function (seg) { var j = (STATE.journeys || []).find(function (x) { return x.segment === seg; }); if (j) html += journeyCard(j); });
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
    if (!j.isActive) h += '<div class="off-note">현재 OFF — 단계를 검토·테스트한 뒤 켜면 매일 자동 발송됩니다.</div>';
    h += '<div class="sec-title">타임라인 (D0~D365) <span class="hint">문자/카톡이 1차, 메일은 보조 · 사진 넣으면 자동 MMS</span></div>';
    h += '<div class="cards">'; steps.forEach(function (s) { h += stepCard(j.id, s); }); h += '</div>';
    h += '<button class="btn add-step" data-act="addStep" data-jid="' + j.id + '">＋ 단계 추가</button>';
    h += '<div class="sec-title">D365 이후 영구 규칙</div>';
    h += '<div class="cards">'; evs.forEach(function (e) { h += evCard(j.id, e); }); h += '</div>';
    h += '<button class="btn add-ev" data-act="addEv" data-jid="' + j.id + '">＋ 영구 규칙 추가</button>';
    h += '<div class="foot"><button class="btn btn-p" data-act="preview">오늘 발송 미리보기</button></div>';
    h += '</div>';
    return h;
  }

  /* 메시지 편집 + 사진 + 미리보기 공통 본문 */
  function bodyBlock(tplId, ch) {
    var body = bodyOf(tplId), img = imgOf(tplId), subj = subjectOf(tplId);
    var h = '<div class="sc-grid"><div class="sc-f"><label>1차 채널</label><select class="f-ch">' + selOptions(CHANNELS, ch) + '</select></div>';
    h += '<div class="sc-f sc-grow f-subwrap" style="' + (ch === 'email' ? '' : 'display:none') + '"><label>메일 제목</label><input class="f-subject" value="' + attr(subj) + '" placeholder="메일 제목"></div></div>';
    h += '<label class="sc-flabel">메시지 내용 <span class="hint">받는 분 이름은 {{이름}}</span></label>';
    h += '<textarea class="f-body" rows="4" placeholder="여기에 보낼 문구를 직접 작성하세요. 예) {{이름}}님, 함께해 주셔서 감사합니다.">' + esc(body) + '</textarea>';
    h += '<div class="sc-preview" data-prev>' + previewText(body) + '</div>';
    h += '<div class="sc-img" data-img="' + attr(img) + '">';
    h += '<div class="sc-thumb">' + (img ? '<img src="' + attr(img) + '">' : '<span class="hint">사진 없음</span>') + '</div>';
    h += '<label class="btn btn-sm">사진 첨부<input type="file" accept="image/*" class="f-file" hidden></label>';
    h += img ? '<button class="btn btn-sm btn-del" data-act="imgDel">사진 제거</button>' : '';
    h += '<span class="img-status hint"></span></div>';
    return h;
  }

  function stepCard(jid, s) {
    var ch = s ? s.channel : 'sms';
    var h = '<div class="step-card' + (s ? '' : ' new') + '" data-sid="' + (s ? s.id : '') + '" data-jid="' + jid + '" data-tplid="' + (s ? (s.templateId || '') : '') + '">';
    h += '<div class="sc-top"><span class="sc-day">D+<input class="f-day" type="number" min="0" max="365" value="' + (s ? s.dayOffset : '') + '"></span>';
    h += '<input class="f-label sc-label" value="' + attr(s ? s.label : '') + '" placeholder="단계 이름 (예: 환영 인사)">';
    h += '<label class="sc-active"><input type="checkbox" class="f-active"' + (!s || s.isActive ? ' checked' : '') + '> 사용</label></div>';
    h += bodyBlock(s ? s.templateId : '', ch);
    h += '<div class="sc-grid"><div class="sc-f sc-grow"><label>보조 메일(선택)</label><select class="f-emailtpl">' + tplOptions(s ? s.emailTemplateId : '', 'email') + '</select></div></div>';
    h += '<div class="sc-actions"><button class="btn btn-sm btn-p" data-act="saveStep">' + (s ? '저장' : '추가') + '</button>';
    h += s ? '<button class="btn btn-sm" data-act="testStep">테스트</button><button class="btn btn-sm btn-del" data-act="delStep">삭제</button>' : '<button class="btn btn-sm" data-act="cancelNew">취소</button>';
    h += '</div></div>';
    return h;
  }

  function evCard(jid, e) {
    var ch = e ? e.channel : 'sms';
    var h = '<div class="step-card' + (e ? '' : ' new') + '" data-eid="' + (e ? e.id : '') + '" data-jid="' + jid + '" data-tplid="' + (e ? (e.templateId || '') : '') + '">';
    h += '<div class="sc-top"><span class="sc-day"><select class="f-cad">' + selOptions(CADENCES, e ? e.cadence : 'quarterly') + '</select></span>';
    h += '<input class="f-label sc-label" value="' + attr(e ? e.label : '') + '" placeholder="규칙 이름 (예: 분기 소식)">';
    h += '<label class="sc-active"><input type="checkbox" class="f-active"' + (!e || e.isActive ? ' checked' : '') + '> 사용</label></div>';
    h += bodyBlock(e ? e.templateId : '', ch);
    h += '<div class="sc-grid"><div class="sc-f sc-grow"><label>보조 메일(선택)</label><select class="f-emailtpl">' + tplOptions(e ? e.emailTemplateId : '', 'email') + '</select></div></div>';
    h += '<div class="sc-actions"><button class="btn btn-sm btn-p" data-act="saveEv">' + (e ? '저장' : '추가') + '</button>';
    h += e ? '<button class="btn btn-sm btn-del" data-act="delEv">삭제</button>' : '<button class="btn btn-sm" data-act="cancelNew">취소</button>';
    h += '</div></div>';
    return h;
  }

  function uploadImage(card, file) {
    var st = card.querySelector('.img-status'); var imgWrap = card.querySelector('.sc-img');
    if (file.size > 5 * 1024 * 1024) { st.textContent = '5MB 이하만'; return; }
    st.textContent = '업로드 중…';
    var fd = new FormData(); fd.append('file', file); fd.append('context', 'template_image'); fd.append('isPublic', 'true');
    fetch('/api/blob-upload', { method: 'POST', credentials: 'include', body: fd })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (raw) {
        var p = raw && raw.data ? raw.data : (raw || {});
        var u = p.url || raw.url || '';
        if (!u) { st.textContent = '업로드 실패'; return; }
        var abs = u.indexOf('http') === 0 ? u : (location.origin + u);
        imgWrap.dataset.img = abs;
        card.querySelector('.sc-thumb').innerHTML = '<img src="' + attr(abs) + '">';
        st.textContent = '첨부됨 (저장 눌러 반영)';
      }).catch(function () { st.textContent = '업로드 오류'; });
  }

  function collect(card) {
    var ch = card.querySelector('.f-ch').value;
    return {
      channel: ch,
      bodyText: card.querySelector('.f-body').value,
      subject: card.querySelector('.f-subject') ? card.querySelector('.f-subject').value : '',
      imageUrl: card.querySelector('.sc-img').dataset.img || '',
      emailTemplateId: card.querySelector('.f-emailtpl').value || null,
      label: card.querySelector('.f-label').value,
      isActive: card.querySelector('.f-active').checked
    };
  }

  function wire() {
    document.querySelectorAll('[data-act="toggle"]').forEach(function (el) {
      el.onclick = function () {
        var card = el.closest('.jcard'); var jid = Number(card.dataset.jid);
        var j = STATE.journeys.find(function (x) { return Number(x.id) === jid; }); var next = !j.isActive;
        if (next && !confirm('이 여정을 켜면 매일 자동으로 후원자에게 메시지가 발송됩니다.\n단계·문구를 검토하셨나요?')) return;
        api('POST', { action: 'toggleJourney', journeyId: jid, isActive: next }).then(function (r) { if (r.ok) { toast(next ? '발송 ON' : '발송 OFF'); load(); } else toast('실패'); });
      };
    });

    document.querySelectorAll('.step-card').forEach(function (card) {
      var ta = card.querySelector('.f-body'); var pv = card.querySelector('[data-prev]');
      if (ta && pv) ta.oninput = function () { pv.innerHTML = previewText(ta.value); };
      var chSel = card.querySelector('.f-ch'); var subWrap = card.querySelector('.f-subwrap');
      if (chSel && subWrap) chSel.onchange = function () { subWrap.style.display = chSel.value === 'email' ? '' : 'none'; };
      var file = card.querySelector('.f-file');
      if (file) file.onchange = function () { if (file.files[0]) uploadImage(card, file.files[0]); };

      card.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          var act = btn.dataset.act, jid = Number(card.dataset.jid);
          var sid = card.dataset.sid ? Number(card.dataset.sid) : 0;
          var eid = card.dataset.eid ? Number(card.dataset.eid) : 0;
          var tplid = card.dataset.tplid ? Number(card.dataset.tplid) : null;
          if (act === 'imgDel') { card.querySelector('.sc-img').dataset.img = ''; card.querySelector('.sc-thumb').innerHTML = '<span class="hint">사진 없음</span>'; card.querySelector('.img-status').textContent = '제거됨 (저장 눌러 반영)'; btn.remove(); return; }
          if (act === 'cancelNew') { card.remove(); return; }
          if (act === 'saveStep') {
            var p = collect(card); p.action = 'saveStep'; p.journeyId = jid; p.dayOffset = Number(card.querySelector('.f-day').value); p.templateId = tplid; if (sid) p.id = sid;
            if (!p.bodyText.trim() && !p.imageUrl) { toast('메시지 내용을 입력하세요'); return; }
            api('POST', p).then(function (r) { if (r.ok) { toast('저장됐어요'); load(); } else toast('실패: ' + (r.data.detail || r.data.error || '')); });
          } else if (act === 'delStep') {
            if (!confirm('이 단계를 삭제할까요?')) return;
            api('POST', { action: 'deleteStep', id: sid }).then(function (r) { if (r.ok) { toast('삭제됨'); load(); } });
          } else if (act === 'testStep') {
            var to = prompt('테스트 메일을 받을 주소를 입력하세요'); if (!to) return;
            if (!tplid) { toast('먼저 저장하면 테스트할 수 있어요'); return; }
            api('POST', { action: 'testSend', templateId: tplid, toEmail: to }).then(function (r) { toast(r.ok ? '테스트 발송함' : '발송 실패'); });
          } else if (act === 'saveEv') {
            var pe = collect(card); pe.action = 'saveEvergreen'; pe.journeyId = jid; pe.cadence = card.querySelector('.f-cad').value; pe.templateId = tplid; if (eid) pe.id = eid;
            if (!pe.bodyText.trim() && !pe.imageUrl) { toast('메시지 내용을 입력하세요'); return; }
            api('POST', pe).then(function (r) { if (r.ok) { toast('저장됐어요'); load(); } else toast('실패: ' + (r.data.detail || r.data.error || '')); });
          } else if (act === 'delEv') {
            if (!confirm('이 영구 규칙을 삭제할까요?')) return;
            api('POST', { action: 'deleteEvergreen', id: eid }).then(function (r) { if (r.ok) { toast('삭제됨'); load(); } });
          }
        };
      });
    });

    document.querySelectorAll('[data-act="addStep"]').forEach(function (b) { b.onclick = function () { b.previousElementSibling.insertAdjacentHTML('beforeend', stepCard(Number(b.dataset.jid), null)); wire(); }; });
    document.querySelectorAll('[data-act="addEv"]').forEach(function (b) { b.onclick = function () { b.previousElementSibling.insertAdjacentHTML('beforeend', evCard(Number(b.dataset.jid), null)); wire(); }; });

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

  function renderAnalytics() {
    var box = document.getElementById('content');
    box.innerHTML = '<div class="hint">성과 불러오는 중…</div>';
    var SEGNAME = { regular: '정기', prospect_onetime: '예비-일시', prospect_cancelled: '예비-이탈', potential: '잠재' };
    api('POST', { action: 'analytics' }).then(function (r) {
      if (!r.ok) { box.innerHTML = '<div class="hint">성과 불러오기 실패</div>'; return; }
      var d = r.data.data || {}; var fm = {}, sm = {}, ch = {}; var rec = d.recent || {};
      (d.funnel || []).forEach(function (f) { fm[f.journeyId] = f; });
      (d.sentByJourney || []).forEach(function (s) { sm[s.journeyId] = s.sent; });
      (d.channelTotals || []).forEach(function (c) { ch[c.channel] = c.cnt; });
      var h = '<div class="jcard"><div class="jname">전체 발송</div>';
      h += '<div class="kpi" style="font-size:14px;margin-top:6px">최근 7일 <b>' + (rec.d7 || 0) + '</b>건 · 30일 <b>' + (rec.d30 || 0) + '</b>건 · 누적 <b>' + (rec.total || 0) + '</b>건</div>';
      h += '<div class="kpi" style="margin-top:8px">채널: 문자 <b>' + (ch.sms || 0) + '</b> · 카톡 <b>' + (ch.kakao || 0) + '</b> · 메일 <b>' + (ch.email || 0) + '</b> · 앱 <b>' + (ch.inapp || 0) + '</b></div>';
      var et = d.emailTracking || {}; var or = et.sent ? Math.round((et.opens || 0) * 1000 / et.sent) / 10 : 0; var cr = et.sent ? Math.round((et.clicks || 0) * 1000 / et.sent) / 10 : 0;
      h += '<div class="kpi" style="margin-top:6px">보조 메일 추적: 발송 <b>' + (et.sent || 0) + '</b> · 오픈 <b>' + (et.opens || 0) + '</b> (' + or + '%) · 클릭 <b>' + (et.clicks || 0) + '</b> (' + cr + '%)</div></div>';
      (d.journeys || []).forEach(function (j) {
        var f = fm[j.id] || {}; var sent = sm[j.id] || 0; var conv = f.converted || 0; var denom = conv + (f.active || 0) + (f.exited || 0); var rate = denom ? Math.round(conv * 1000 / denom) / 10 : 0;
        h += '<div class="jcard"><div class="jhead"><div class="jname">' + esc(SEGNAME[j.segment] || j.segment) + ' — ' + esc(j.name) + '</div>';
        h += '<div class="kpi">' + (j.isActive ? '<span style="color:#1a8b46">발송 ON</span>' : '<span style="color:#c47a00">OFF</span>') + '</div></div>';
        h += '<div class="kpi" style="font-size:13.5px;margin-top:6px">등록 <b>' + (f.enrolled || 0) + '</b> · 활성 <b>' + (f.active || 0) + '</b> · 전환 <b>' + conv + '</b> · 이탈 <b>' + (f.exited || 0) + '</b> · 발송 <b>' + sent + '</b>건</div>';
        h += '<div class="kpi" style="margin-top:4px">전환율 <b style="color:#7a1f2b">' + rate + '%</b></div></div>';
      });
      box.innerHTML = h;
    }).catch(function () { box.innerHTML = '<div class="hint">성과 불러오기 실패</div>'; });
  }

  document.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { curTab = t.dataset.tab; render(); }; });
  load();
})();
