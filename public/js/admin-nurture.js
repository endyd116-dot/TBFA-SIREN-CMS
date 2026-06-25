/* 후원자 너처링 어드민 — 타임라인 편집 */
(function () {
  'use strict';
  var API = '/api/admin-nurture';
  var STATE = null;
  var CHANNELS = [['sms', '💬 문자'], ['kakao', '📨 알림톡(승인필요)'], ['email', '📧 메일'], ['inapp', '🔔 앱']];
  var CADENCES = [['monthly', '매월'], ['quarterly', '분기'], ['anniversary', '기념일'], ['yearend', '연말']];
  /* 탭 → 포함 세그먼트 */
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
  function tplOptions(sel) {
    var o = '<option value="">— 템플릿 선택 —</option>';
    tpls().forEach(function (t) { o += '<option value="' + t.id + '"' + (Number(sel) === Number(t.id) ? ' selected' : '') + '>' + esc(t.name) + ' (' + esc(t.channel) + ')</option>'; });
    return o;
  }
  function selOptions(list, sel) { return list.map(function (x) { return '<option value="' + x[0] + '"' + (sel === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join(''); }

  function render() {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === curTab); });
    var segs = TAB_SEG[curTab];
    var html = '';
    segs.forEach(function (seg) {
      var j = (STATE.journeys || []).find(function (x) { return x.segment === seg; });
      if (!j) return;
      html += journeyCard(j);
    });
    if (!html) html = '<div class="hint">이 세그먼트 여정이 없습니다. (migrate-nurture-schema 필요)</div>';
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
    if (!j.isActive) h += '<div class="off-note">⚠ 현재 OFF — 단계를 검토하고 테스트한 뒤 켜면 매일 자동 발송됩니다.</div>';

    h += '<div class="sec-title">타임라인 (D0~D365) <span class="hint">— 문자/카톡이 1차, 메일은 보조(있으면 추가 발송)</span></div>';
    h += '<table><thead><tr><th style="width:74px">시점(D+)</th><th style="width:130px">1차 채널</th><th>1차 템플릿</th><th>보조 메일(선택)</th><th style="width:120px">라벨</th><th style="width:46px">사용</th><th style="width:120px"></th></tr></thead><tbody>';
    steps.forEach(function (s) { h += stepRow(j.id, s); });
    h += stepRow(j.id, null); // 새 단계 입력 행
    h += '</tbody></table>';

    h += '<div class="sec-title">🔁 D365 이후 영구 규칙</div>';
    h += '<table><thead><tr><th style="width:110px">주기</th><th style="width:130px">1차 채널</th><th>1차 템플릿</th><th>보조 메일(선택)</th><th style="width:120px">라벨</th><th style="width:46px">사용</th><th style="width:120px"></th></tr></thead><tbody>';
    evs.forEach(function (e) { h += evRow(j.id, e); });
    h += evRow(j.id, null);
    h += '</tbody></table>';

    h += '<div class="foot"><button class="btn" data-act="preview">👁 오늘 발송 미리보기</button>';
    h += '<input type="email" placeholder="테스트 받을 이메일" class="testEmail" style="width:200px"> <button class="btn" data-act="test">✉ 테스트 발송</button>';
    h += '<span class="hint">테스트는 선택한 템플릿이 아니라 각 행의 [테스트] 버튼으로 보냅니다.</span></div>';
    h += '</div>';
    return h;
  }

  function stepRow(jid, s) {
    var id = s ? s.id : '';
    return '<tr data-sid="' + id + '" data-jid="' + jid + '" class="steprow">' +
      '<td>D+<input class="day f-day" type="number" min="0" max="365" value="' + (s ? s.dayOffset : '') + '"></td>' +
      '<td><select class="f-ch">' + selOptions(CHANNELS, s ? s.channel : 'sms') + '</select></td>' +
      '<td><select class="f-tpl">' + tplOptions(s ? s.templateId : '') + '</select></td>' +
      '<td><select class="f-emailtpl">' + tplOptions(s ? s.emailTemplateId : '') + '</select></td>' +
      '<td><input class="label f-label" value="' + esc(s ? s.label : '') + '" placeholder="단계 이름"></td>' +
      '<td><input type="checkbox" class="f-active"' + (!s || s.isActive ? ' checked' : '') + '></td>' +
      '<td><div class="row-actions"><button class="btn btn-sm" data-act="saveStep">' + (s ? '저장' : '추가') + '</button>' +
      (s ? '<button class="btn btn-sm" data-act="testStep">테스트</button><button class="btn btn-sm btn-del" data-act="delStep">삭제</button>' : '') +
      '</div></td></tr>';
  }

  function evRow(jid, e) {
    var id = e ? e.id : '';
    return '<tr data-eid="' + id + '" data-jid="' + jid + '" class="evrow">' +
      '<td><select class="f-cad">' + selOptions(CADENCES, e ? e.cadence : 'quarterly') + '</select></td>' +
      '<td><select class="f-ch">' + selOptions(CHANNELS, e ? e.channel : 'sms') + '</select></td>' +
      '<td><select class="f-tpl">' + tplOptions(e ? e.templateId : '') + '</select></td>' +
      '<td><select class="f-emailtpl">' + tplOptions(e ? e.emailTemplateId : '') + '</select></td>' +
      '<td><input class="label f-label" value="' + esc(e ? e.label : '') + '" placeholder="규칙 이름"></td>' +
      '<td><input type="checkbox" class="f-active"' + (!e || e.isActive ? ' checked' : '') + '></td>' +
      '<td><div class="row-actions"><button class="btn btn-sm" data-act="saveEv">' + (e ? '저장' : '추가') + '</button>' +
      (e ? '<button class="btn btn-sm btn-del" data-act="delEv">삭제</button>' : '') +
      '</div></td></tr>';
  }

  function wire() {
    document.querySelectorAll('[data-act="toggle"]').forEach(function (el) {
      el.onclick = function () {
        var card = el.closest('.jcard'); var jid = Number(card.dataset.jid);
        var j = STATE.journeys.find(function (x) { return Number(x.id) === jid; });
        var next = !j.isActive;
        if (next && !confirm('이 여정을 켜면 매일 자동으로 후원자에게 메시지가 발송됩니다.\n단계·템플릿을 검토하셨나요?')) return;
        api('POST', { action: 'toggleJourney', journeyId: jid, isActive: next }).then(function (r) { if (r.ok) { toast(next ? '발송 ON' : '발송 OFF'); load(); } else toast('실패'); });
      };
    });

    document.querySelectorAll('.steprow').forEach(function (tr) {
      tr.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          var act = btn.dataset.act, jid = Number(tr.dataset.jid), sid = tr.dataset.sid ? Number(tr.dataset.sid) : 0;
          if (act === 'saveStep') {
            var p = { action: 'saveStep', journeyId: jid, dayOffset: Number(tr.querySelector('.f-day').value), channel: tr.querySelector('.f-ch').value, templateId: tr.querySelector('.f-tpl').value || null, emailTemplateId: tr.querySelector('.f-emailtpl').value || null, label: tr.querySelector('.f-label').value, isActive: tr.querySelector('.f-active').checked };
            if (sid) p.id = sid;
            api('POST', p).then(function (r) { if (r.ok) { toast('저장됨'); load(); } else toast('실패: ' + (r.data.detail || '')); });
          } else if (act === 'delStep') {
            if (!confirm('이 단계를 삭제할까요?')) return;
            api('POST', { action: 'deleteStep', id: sid }).then(function (r) { if (r.ok) { toast('삭제됨'); load(); } });
          } else if (act === 'testStep') {
            var to = prompt('테스트 메일을 받을 주소를 입력하세요'); if (!to) return;
            var tid = tr.querySelector('.f-tpl').value; if (!tid) { toast('템플릿을 먼저 선택하세요'); return; }
            api('POST', { action: 'testSend', templateId: Number(tid), toEmail: to }).then(function (r) { toast(r.ok ? '테스트 발송함' : '발송 실패'); });
          }
        };
      });
    });

    document.querySelectorAll('.evrow').forEach(function (tr) {
      tr.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          var act = btn.dataset.act, jid = Number(tr.dataset.jid), eid = tr.dataset.eid ? Number(tr.dataset.eid) : 0;
          if (act === 'saveEv') {
            var p = { action: 'saveEvergreen', journeyId: jid, cadence: tr.querySelector('.f-cad').value, channel: tr.querySelector('.f-ch').value, templateId: tr.querySelector('.f-tpl').value || null, emailTemplateId: tr.querySelector('.f-emailtpl').value || null, label: tr.querySelector('.f-label').value, isActive: tr.querySelector('.f-active').checked };
            if (eid) p.id = eid;
            api('POST', p).then(function (r) { if (r.ok) { toast('저장됨'); load(); } else toast('실패'); });
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
