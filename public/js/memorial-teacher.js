/* =========================================================
   온라인 추모관 — 개별 선생님 페이지 (memorial-teacher.html)
   프로필 · 약력 · 타임라인 · 개별 헌화 · 추모 메시지 · 기억의 편지 · 공유
   ========================================================= */
(function () {
  'use strict';

  /* ───────── B 머지 전 mock (설계서 §5.1) ───────── */
  var MOCK_TEACHER = {
    id: 1, name: '故 ○○○ 선생님', photoUrl: null, schoolRegion: '서울 ○○초',
    birthDate: null, deathDate: null, tributeLine: '아이들을 사랑한 선생님',
    bioHtml: '<p>약력은 유가족 협조하에 작성됩니다.</p>',
    timeline: [{ date: '2023-00-00', title: '추모', desc: '기억합니다' }],
    candleCount: 128, messageCount: 34, letterCount: 5
  };
  var MOCK_MESSAGES = [
    { id: 1, authorName: '시민', content: '잊지 않겠습니다.', likeCount: 12, createdAt: '2026-05-24T00:00:00Z', liked: false }
  ];
  var MOCK_LETTERS = [
    { id: 1, authorName: '동료 교사', title: '선생님께', content: '함께한 시간을 잊지 않겠습니다.\n편히 쉬세요.', createdAt: '2026-05-24T00:00:00Z' }
  ];

  /* ───────── 공통 헬퍼 ───────── */
  function api(path, options) {
    options = options || {};
    var opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (options.body) opts.body = JSON.stringify(options.body);
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok && data.ok !== false, data: data };
      });
    }).catch(function () {
      return { status: 0, ok: false, data: { error: '네트워크 오류가 발생했습니다' } };
    });
  }
  function unwrap(res, key) {
    var d = res && res.data;
    if (!d) return undefined;
    if (d.data && d.data[key] !== undefined) return d.data[key];
    if (d[key] !== undefined) return d[key];
    return undefined;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    if (window.SIREN && typeof window.SIREN.toast === 'function') window.SIREN.toast(msg);
    else console.log('[추모관]', msg);
  }
  function isLoggedIn() { return !!(window.SIREN_AUTH && window.SIREN_AUTH.user); }
  function promptLogin(msg) {
    toast(msg || '로그인 후 이용하실 수 있습니다.');
    if (window.SIREN && typeof window.SIREN.openModal === 'function') {
      setTimeout(function () { window.SIREN.openModal('loginModal'); }, 300);
    }
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }
  function getTeacherId() {
    var params = new URLSearchParams(window.location.search);
    return parseInt(params.get('id'), 10) || 0;
  }

  var _teacherId = getTeacherId();
  var _offerType = 'candle';
  var _offerTotal = 0;

  /* ───────── 프로필/약력/타임라인 ───────── */
  function renderTeacher(t) {
    if (!t) {
      document.getElementById('mtLoading').style.display = 'none';
      document.getElementById('mtNotFound').style.display = '';
      return;
    }
    document.title = (t.name || '선생님') + ' | 온라인 추모관';

    /* 사진 */
    if (t.photoUrl) {
      var ph = document.getElementById('mtPhoto');
      ph.innerHTML = '<img src="' + esc(t.photoUrl) + '" alt="' + esc(t.name) + '" onerror="this.parentNode.innerHTML=\'<div class=&quot;silhouette&quot;>👤</div>\'">';
    }
    document.getElementById('mtName').textContent = t.name || '';
    document.getElementById('mtRegion').textContent = t.schoolRegion || '';

    var dates = '';
    if (t.birthDate || t.deathDate) {
      dates = (t.birthDate ? fmtDate(t.birthDate) : '') + ' ~ ' + (t.deathDate ? fmtDate(t.deathDate) : '');
    }
    document.getElementById('mtDates').textContent = dates;
    document.getElementById('mtTribute').textContent = t.tributeLine || '';

    /* 약력 (관리자 작성 HTML) */
    if (t.bioHtml) {
      document.getElementById('mtBio').innerHTML = t.bioHtml;
      document.getElementById('mtBioSection').style.display = '';
    }

    /* 타임라인 */
    var tl = Array.isArray(t.timeline) ? t.timeline : [];
    if (tl.length) {
      var html = tl.map(function (e) {
        return '<div class="mt-tl-item">' +
          (e.date ? '<div class="mt-tl-date">' + esc(e.date) + '</div>' : '') +
          (e.title ? '<div class="mt-tl-title">' + esc(e.title) + '</div>' : '') +
          (e.desc ? '<div class="mt-tl-desc">' + esc(e.desc) + '</div>' : '') +
          '</div>';
      }).join('');
      document.getElementById('mtTimeline').innerHTML = html;
      document.getElementById('mtTimelineSection').style.display = '';
    }

    /* 헌화 총합 */
    _offerTotal = (Number(t.candleCount) || 0) + (Number(t.flowerCount) || 0);
    /* candleCount가 이미 합산이면 그대로 사용 (서버 키 호환) */
    if (t.flowerCount === undefined) _offerTotal = Number(t.candleCount) || 0;
    document.getElementById('mtOfferTotal').textContent = _offerTotal.toLocaleString('ko-KR');

    document.getElementById('mtLoading').style.display = 'none';
    document.getElementById('mtContent').style.display = '';
  }

  function loadTeacher() {
    if (!_teacherId) { renderTeacher(null); return; }
    api('/api/memorial-teacher?id=' + _teacherId).then(function (res) {
      if (res.ok) {
        renderTeacher(unwrap(res, 'teacher') || null);          /* 백엔드 정상 — 없으면 not found */
      } else if (res.data && res.data.ok === false) {
        renderTeacher(null);                                    /* 실제 백엔드의 '없음' 응답 */
      } else {
        renderTeacher(MOCK_TEACHER);                            /* 백엔드 미연결(mock 단계) */
      }
    }).catch(function () { renderTeacher(MOCK_TEACHER); });
  }

  /* ───────── 개별 헌화 ───────── */
  function setupOffering() {
    var typesWrap = document.getElementById('mtOfferTypes');
    var btn = document.getElementById('mtOfferBtn');
    if (!typesWrap || !btn) return;
    typesWrap.addEventListener('click', function (e) {
      var card = e.target.closest('.mt-offer-type');
      if (!card) return;
      _offerType = card.dataset.type || 'candle';
      Array.prototype.forEach.call(typesWrap.querySelectorAll('.mt-offer-type'), function (el) {
        el.classList.toggle('sel', el === card);
      });
      btn.textContent = (_offerType === 'flower' ? '🏵️ 헌화하기' : '🕯️ 헌화하기');
    });
    btn.addEventListener('click', function () {
      var nick = (document.getElementById('mtOfferNick').value || '').trim();
      btn.disabled = true;
      floatOffering(_offerType === 'flower' ? '🏵️' : '🕯️');
      api('/api/memorial-offering', { method: 'POST', body: { teacherId: _teacherId, type: _offerType, nickname: nick || null } })
        .then(function (res) {
          btn.disabled = false;
          var total = unwrap(res, 'total');
          if (res.ok && typeof total === 'number') _offerTotal = total;
          else _offerTotal += 1;
          document.getElementById('mtOfferTotal').textContent = _offerTotal.toLocaleString('ko-KR');
          toast('헌화해 주셔서 감사합니다.');
        }).catch(function () {
          btn.disabled = false;
          _offerTotal += 1;
          document.getElementById('mtOfferTotal').textContent = _offerTotal.toLocaleString('ko-KR');
          toast('헌화해 주셔서 감사합니다.');
        });
    });
  }
  function floatOffering(emoji) {
    var layer = document.getElementById('mtFloatLayer');
    if (!layer) return;
    var n = document.createElement('div');
    n.className = 'mt-float';
    n.textContent = emoji;
    n.style.left = (8 + Math.random() * 84) + '%';
    layer.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 3600);
  }

  /* ───────── 추모 메시지 ───────── */
  function msgEl(m) {
    var wrap = document.createElement('div');
    wrap.className = 'mt-msg';
    wrap.innerHTML =
      '<div class="mt-msg-head"><span class="mt-msg-author">' + esc(m.authorName || '익명') + '</span>' +
      '<span class="mt-msg-date">' + fmtDate(m.createdAt) + '</span></div>' +
      '<div class="mt-msg-body">' + esc(m.content) + '</div>' +
      '<div class="mt-msg-actions">' +
        '<button type="button" class="act-like' + (m.liked ? ' liked' : '') + '">♡ <span class="lc">' + (Number(m.likeCount) || 0) + '</span></button>' +
        '<button type="button" class="act-report">🚩 신고</button>' +
      '</div>';
    wrap.querySelector('.act-like').addEventListener('click', function () { likeMsg(m.id, wrap); });
    wrap.querySelector('.act-report').addEventListener('click', function () { reportMsg(m.id); });
    return wrap;
  }
  function renderMessages(list) {
    var listEl = document.getElementById('mtMsgList');
    var empty = document.getElementById('mtMsgEmpty');
    listEl.innerHTML = '';
    if (!list || !list.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    list.forEach(function (m) { listEl.appendChild(msgEl(m)); });
  }
  function loadMessages() {
    api('/api/memorial-messages?teacherId=' + _teacherId).then(function (res) {
      var list = res.ok ? (unwrap(res, 'messages') || []) : MOCK_MESSAGES;
      renderMessages(list);
    }).catch(function () { renderMessages(MOCK_MESSAGES); });
  }
  function likeMsg(id, wrap) {
    if (!isLoggedIn()) { promptLogin('공감은 로그인 후 가능합니다.'); return; }
    api('/api/memorial-messages?action=like&id=' + id, { method: 'POST' }).then(function (res) {
      if (!res.ok) { toast((res.data && res.data.error) || '처리 실패'); return; }
      var likeCount = unwrap(res, 'likeCount');
      var liked = unwrap(res, 'liked');
      if (typeof likeCount === 'number') wrap.querySelector('.lc').textContent = likeCount;
      wrap.querySelector('.act-like').classList.toggle('liked', !!liked);
    }).catch(function () { toast('처리 실패'); });
  }
  function reportMsg(id) {
    if (!confirm('이 글을 신고하시겠습니까? 운영자가 검토합니다.')) return;
    api('/api/memorial-messages?action=report&id=' + id, { method: 'POST' }).then(function (res) {
      toast(res.ok ? '신고가 접수되었습니다.' : ((res.data && res.data.error) || '신고 실패'));
    }).catch(function () { toast('신고 실패'); });
  }
  function setupMessageForm() {
    var btn = document.getElementById('mtMsgSubmit');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var content = (document.getElementById('mtMsgContent').value || '').trim();
      if (!content) { toast('내용을 입력해 주세요.'); return; }
      if (!isLoggedIn()) { promptLogin('메시지 작성은 로그인 후 가능합니다.'); return; }
      var anon = document.getElementById('mtMsgAnon').checked;
      btn.disabled = true;
      api('/api/memorial-messages', { method: 'POST', body: { teacherId: _teacherId, content: content, isAnonymous: anon } })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) {
            if (res.status === 401) { promptLogin('메시지 작성은 로그인 후 가능합니다.'); return; }
            toast((res.data && res.data.error) || '작성 실패');
            return;
          }
          document.getElementById('mtMsgContent').value = '';
          document.getElementById('mtMsgAnon').checked = false;
          var msg = unwrap(res, 'message');
          var listEl = document.getElementById('mtMsgList');
          var empty = document.getElementById('mtMsgEmpty');
          if (empty) empty.style.display = 'none';
          if (msg) listEl.insertBefore(msgEl(msg), listEl.firstChild);
          else loadMessages();
          toast('추모의 글이 등록되었습니다.');
        }).catch(function () { btn.disabled = false; toast('작성 실패'); });
    });
  }

  /* ───────── 기억의 편지 ───────── */
  function letterEl(l) {
    var wrap = document.createElement('div');
    wrap.className = 'mt-letter';
    wrap.innerHTML =
      (l.title ? '<h3 class="mt-letter-title">' + esc(l.title) + '</h3>' : '') +
      '<div class="mt-letter-meta">' + esc(l.authorName || '익명') + ' · ' + fmtDate(l.createdAt) + '</div>' +
      '<div class="mt-letter-body">' + esc(l.content) + '</div>' +
      '<button type="button" class="mt-letter-toggle" style="display:none">더 보기 ▾</button>';
    var body = wrap.querySelector('.mt-letter-body');
    var toggle = wrap.querySelector('.mt-letter-toggle');
    /* 긴 글일 때만 더보기 노출 */
    setTimeout(function () {
      if (body.scrollHeight > body.clientHeight + 4) toggle.style.display = '';
    }, 0);
    toggle.addEventListener('click', function () {
      var open = body.classList.toggle('open');
      toggle.textContent = open ? '접기 ▴' : '더 보기 ▾';
    });
    return wrap;
  }
  function renderLetters(list) {
    var listEl = document.getElementById('mtLetterList');
    var empty = document.getElementById('mtLetterEmpty');
    listEl.innerHTML = '';
    if (!list || !list.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    list.forEach(function (l) { listEl.appendChild(letterEl(l)); });
  }
  function loadLetters() {
    api('/api/memorial-letters?teacherId=' + _teacherId).then(function (res) {
      var list = res.ok ? (unwrap(res, 'letters') || []) : MOCK_LETTERS;
      renderLetters(list);
    }).catch(function () { renderLetters(MOCK_LETTERS); });
  }
  function setupLetterForm() {
    var btn = document.getElementById('mtLetterSubmit');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var content = (document.getElementById('mtLetterContent').value || '').trim();
      var title = (document.getElementById('mtLetterTitle').value || '').trim();
      if (!content) { toast('편지 내용을 입력해 주세요.'); return; }
      if (!isLoggedIn()) { promptLogin('편지 작성은 로그인 후 가능합니다.'); return; }
      var anon = document.getElementById('mtLetterAnon').checked;
      btn.disabled = true;
      api('/api/memorial-letters', { method: 'POST', body: { teacherId: _teacherId, title: title || null, content: content, isAnonymous: anon } })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) {
            if (res.status === 401) { promptLogin('편지 작성은 로그인 후 가능합니다.'); return; }
            toast((res.data && res.data.error) || '작성 실패');
            return;
          }
          document.getElementById('mtLetterContent').value = '';
          document.getElementById('mtLetterTitle').value = '';
          document.getElementById('mtLetterAnon').checked = false;
          var letter = unwrap(res, 'letter');
          var listEl = document.getElementById('mtLetterList');
          var empty = document.getElementById('mtLetterEmpty');
          if (empty) empty.style.display = 'none';
          if (letter) listEl.insertBefore(letterEl(letter), listEl.firstChild);
          else loadLetters();
          toast('편지가 등록되었습니다.');
        }).catch(function () { btn.disabled = false; toast('작성 실패'); });
    });
  }

  /* ───────── 공유 ───────── */
  function setupShare() {
    var btn = document.getElementById('mtShareBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var url = window.location.href;
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast('링크가 복사되었습니다.'); }
        catch (e) { toast('복사에 실패했습니다. 주소창을 이용해 주세요.'); }
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('링크가 복사되었습니다.'); }, fallback);
      } else { fallback(); }
    });
  }

  /* ───────── 초기화 ───────── */
  function init() {
    loadTeacher();
    loadMessages();
    loadLetters();
    setupOffering();
    setupMessageForm();
    setupLetterForm();
    setupShare();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
