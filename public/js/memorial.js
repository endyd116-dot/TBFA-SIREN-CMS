/* =========================================================
   온라인 추모관 v2 — 굿나잇, 굿모닝
   ---------------------------------------------------------
   한 화면이 밤에서 아침으로 흐른다.
     밤   : 먼저 떠나신 선생님을 기억한다 (헌화 · 추모 한마디)
     아침 : 남겨진 유가족을 응원한다 (근황 · 목소리 · 응원 한마디)

   핵심 장치 — 같은 마음, 두 얼굴
     참여 하나가 밤에는 하늘의 '별', 아침에는 들판의 '꽃'으로 나타난다.
     자리는 참여 번호에서 계산하므로 다시 와도 내 것은 늘 같은 곳에 있다.
   ========================================================= */
(function () {
  'use strict';

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
  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  function toast(msg) {
    if (window.SIREN && window.SIREN.toast) window.SIREN.toast(msg);
    else if (window.toast) window.toast(msg);
    else console.log('[추모관]', msg);
  }
  function fmtDate(v) {
    if (!v) return '';
    try {
      if (window.fmtKSTDate) return window.fmtKSTDate(v);
      var d = new Date(v);
      return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    } catch (e) { return ''; }
  }
  function num(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  /* ───────── 내 참여 기록 (이 브라우저에만 저장) ─────────
     서버에 따로 남기지 않는다. '내 별·내 꽃 찾기'에만 쓴다. */
  var MINE_KEY = 'siren:memorial:mine:v2';
  function loadMine() {
    try {
      var raw = localStorage.getItem(MINE_KEY);
      var o = raw ? JSON.parse(raw) : null;
      return {
        tribute: (o && Array.isArray(o.tribute)) ? o.tribute : [],
        support: (o && Array.isArray(o.support)) ? o.support : [],
        offered: (o && o.offered) || 0
      };
    } catch (e) { return { tribute: [], support: [], offered: 0 }; }
  }
  function saveMine(m) {
    try { localStorage.setItem(MINE_KEY, JSON.stringify(m)); } catch (e) { /* 저장 막힘 — 무시 */ }
  }
  var MINE = loadMine();
  function isMine(kind, id) {
    var arr = kind === 'support' ? MINE.support : MINE.tribute;
    return arr.indexOf(Number(id)) !== -1;
  }
  function rememberMine(kind, id) {
    var arr = kind === 'support' ? MINE.support : MINE.tribute;
    if (id != null && arr.indexOf(Number(id)) === -1) arr.push(Number(id));
    saveMine(MINE);
  }

  /* ───────── 상태 ───────── */
  var PAGE = { tribute: 1, support: 1 };
  var COUNTS = { people: 0, candles: 0, messages: 0 };
  var CACHE = { tribute: [], support: [] };
  var SKY = null, FIELD = null;
  var offerType = 'candle';

  /* =========================================================
     1. 밤 ↔ 아침 전환
     ========================================================= */
  function initSwitch() {
    var sw = $('m2Switch');
    var bNight = $('m2GoNight'), bMorn = $('m2GoMorning');
    var night = $('hallNight'), morning = $('hallMorning');
    if (!sw || !night || !morning) return;

    function goto(el) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (e) { el.scrollIntoView(); }
    }
    if (bNight) bNight.addEventListener('click', function () { goto(night); });
    if (bMorn) bMorn.addEventListener('click', function () { goto(morning); });

    function setPhase(p) {
      if (sw.dataset.phase === p) return;
      sw.dataset.phase = p;
      if (bNight) bNight.setAttribute('aria-selected', p === 'night' ? 'true' : 'false');
      if (bMorn) bMorn.setAttribute('aria-selected', p === 'morning' ? 'true' : 'false');
    }

    /* 화면 중앙이 어느 관에 있는지로 판단한다 (스크롤마다 계산하지 않는다) */
    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          setPhase(e.target.id === 'hallMorning' ? 'morning' : 'night');
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      io.observe(night); io.observe(morning);
    }
  }

  /* =========================================================
     2. 요약 — 숫자 · 문구
     ========================================================= */
  function loadSummary() {
    return api('/api/memorial-summary').then(function (res) {
      if (!res.ok) return;
      var counters = unwrap(res, 'counters') || {};
      COUNTS.people = counters.people || 0;
      COUNTS.candles = counters.candles || 0;
      COUNTS.messages = counters.messages || 0;
      paintCounts();

      /* 운영자가 어드민에서 고친 문구가 있으면 덮어쓴다 */
      var hall = unwrap(res, 'hallCopy');
      applyHallCopy(hall);
    });
  }

  function applyHallCopy(hall) {
    if (!hall || typeof hall !== 'object') return;
    var map = [
      ['night', 'greet', 'm2NightGreet'], ['night', 'title', 'm2NightTitle'], ['night', 'sub', 'm2NightSub'],
      ['morning', 'greet', 'm2MornGreet'], ['morning', 'title', 'm2MornTitle'], ['morning', 'sub', 'm2MornSub'],
      ['dawn', 'line', 'm2DawnLine'], ['dawn', 'sub', 'm2DawnSub']
    ];
    map.forEach(function (m) {
      var v = hall[m[0]] && hall[m[0]][m[1]];
      var el = $(m[2]);
      if (el && v) el.innerHTML = String(v).replace(/\n/g, '<br>');
    });
  }

  /** 불빛 = 헌화 + 남겨진 한마디 (두 관에 같은 숫자가 나간다) */
  function totalHearts() { return (COUNTS.candles || 0) + (COUNTS.messages || 0); }

  function paintCounts() {
    var t = totalHearts();
    var a = $('m2NightCount'), b = $('m2MornCount'), same = $('m2SameLine');
    if (a) a.textContent = num(t);
    if (b) b.textContent = num(t);
    if (same) {
      same.textContent = t > 0
        ? '밤하늘을 밝힌 그 ' + num(t) + '개의 마음이, 아침에는 같은 수의 꽃으로 피어 있습니다.'
        : '';
    }
  }

  /* =========================================================
     3. 선생님 카드
     ========================================================= */
  function teacherCard(t) {
    var photo = t.photoUrl
      ? '<img src="' + esc(t.photoUrl) + '" alt="' + esc(t.name) + '" loading="lazy" width="92" height="92">'
      : '<span class="siren-icon-wrap m2-silhouette" data-icon="dove"></span>';
    var meta = [t.schoolRegion, t.deathDate ? fmtDate(t.deathDate) : ''].filter(Boolean).join(' · ');
    return '<a class="mem2-tcard" href="/memorial-teacher.html?id=' + encodeURIComponent(t.id) + '">' +
      '<div class="mem2-tportrait">' + photo + '</div>' +
      '<h3 class="mem2-tname">' + esc(t.name || '') + '</h3>' +
      (meta ? '<p class="mem2-tmeta">' + esc(meta) + '</p>' : '') +
      (t.tributeLine ? '<p class="mem2-tline">' + esc(t.tributeLine) + '</p>' : '') +
      '<span class="mem2-tenter">기억하러 들어가기 →</span>' +
      '</a>';
  }

  function loadTeachers() {
    var grid = $('memTeacherGrid'), empty = $('memTeacherEmpty'), loading = $('memTeacherLoading');
    /* 서버가 이미 채워 보냈으면 다시 그리지 않는다 (깜빡임 방지) */
    if (grid && grid.children.length > 0 && grid.style.display !== 'none') {
      show(loading, false);
      return Promise.resolve();
    }
    return api('/api/memorial-teachers').then(function (res) {
      show(loading, false);
      var list = unwrap(res, 'teachers') || unwrap(res, 'list') || [];
      if (!res.ok || !list.length) { show(empty, true); return; }
      if (grid) {
        grid.innerHTML = list.map(teacherCard).join('');
        show(grid, true);
      }
      if (window.Icons && Icons.hydrate) { try { Icons.hydrate(grid); } catch (e) {} }
    });
  }

  function loadSpotlights() {
    return api('/api/memorial-spotlights').then(function (res) {
      if (!res.ok) return;
      var list = unwrap(res, 'spotlights') || unwrap(res, 'list') || [];
      if (!list.length) return;
      var wrap = $('m2SpotList'), block = $('m2SpotlightBlock');
      if (!wrap) return;
      wrap.innerHTML = list.map(function (s) {
        var t = s.teacher || s;
        return teacherCard({
          id: t.id, name: t.name, photoUrl: t.photoUrl,
          schoolRegion: s.reasonLabel || t.schoolRegion,
          tributeLine: s.familyWord || t.tributeLine
        });
      }).join('');
      show(block, true);
      if (window.Icons && Icons.hydrate) { try { Icons.hydrate(wrap); } catch (e) {} }
    });
  }

  /* =========================================================
     4. 한마디 목록 (밤 = 추모 / 아침 = 응원)
     ========================================================= */
  var UI = {
    tribute: { list: 'm2NightMsgs', empty: 'm2NightMsgEmpty', loading: 'm2NightMsgLoading', moreWrap: 'm2NightMoreWrap', more: 'm2NightMore' },
    support: { list: 'm2MornMsgs', empty: 'm2MornMsgEmpty', loading: 'm2MornMsgLoading', moreWrap: 'm2MornMoreWrap', more: 'm2MornMore' }
  };

  function msgCard(m, kind) {
    var mine = isMine(kind, m.id);
    return '<article class="mem2-msg' + (mine ? ' mem2-msg-mine' : '') + '">' +
      '<div class="mem2-msg-head">' +
      '<span class="mem2-msg-name">' + esc(m.isAnonymous ? '익명' : (m.authorName || '익명')) + '</span>' +
      '<span class="mem2-msg-date">' + esc(fmtDate(m.createdAt)) + '</span>' +
      (mine ? '<span class="mem2-badge-mine">내가 남긴 마음</span>' : '') +
      '</div>' +
      '<p class="mem2-msg-body">' + esc(m.content || '') + '</p>' +
      '</article>';
  }

  function loadMessages(kind, append) {
    var ui = UI[kind];
    var listEl = $(ui.list), emptyEl = $(ui.empty), loadEl = $(ui.loading);
    var moreWrap = $(ui.moreWrap);
    if (!append) { PAGE[kind] = 1; CACHE[kind] = []; }
    show(loadEl, true);

    return api('/api/memorial-messages?kind=' + kind + '&page=' + PAGE[kind]).then(function (res) {
      show(loadEl, false);
      var msgs = unwrap(res, 'messages') || [];
      var pg = unwrap(res, 'pagination') || {};
      if (!res.ok) { show(emptyEl, CACHE[kind].length === 0); return; }

      CACHE[kind] = append ? CACHE[kind].concat(msgs) : msgs;
      if (listEl) {
        var html = CACHE[kind].map(function (m) { return msgCard(m, kind); }).join('');
        listEl.innerHTML = html;
      }
      show(emptyEl, CACHE[kind].length === 0);
      show(moreWrap, !!pg.hasMore);
      refreshSky();
    });
  }

  /* =========================================================
     5. 하늘 · 들판
     ========================================================= */
  /** 한마디들을 '마음' 목록으로 바꾸고, 헌화만 한 분들은 이름 없는 불빛으로 채운다 */
  function buildHearts(kind) {
    var named = (CACHE[kind] || []).map(function (m) {
      return {
        id: 'm' + m.id,
        name: m.isAnonymous ? '익명' : (m.authorName || '익명'),
        text: m.content || '',
        mine: isMine(kind, m.id)
      };
    });
    var cap = (window.MemorialSky && window.MemorialSky.MAX_DRAW) || 420;
    var total = totalHearts();
    var fillers = Math.max(0, Math.min(total, cap) - named.length);
    for (var i = 0; i < fillers; i++) {
      named.push({ id: 'o' + kind + i, name: '', text: '', mine: false });
    }
    return { items: named, total: total };
  }

  function mountSky() {
    if (!window.MemorialSky) return;
    var c1 = $('m2SkyCanvas'), c2 = $('m2FieldCanvas');
    var n = buildHearts('tribute'), s = buildHearts('support');

    if (c1 && !SKY) {
      SKY = MemorialSky.mount(c1, {
        mode: 'star', items: n.items, total: n.total,
        onPick: function (p) { showTip('m2SkyTip', p); }
      });
    }
    if (c2 && !FIELD) {
      FIELD = MemorialSky.mount(c2, {
        mode: 'flower', items: s.items, total: s.total,
        onPick: function (p) { showTip('m2FieldTip', p); }
      });
    }
  }

  function refreshSky() {
    if (SKY) { var n = buildHearts('tribute'); SKY.setItems(n.items, n.total); }
    if (FIELD) { var s = buildHearts('support'); FIELD.setItems(s.items, s.total); }
  }

  var tipTimer = null;
  function showTip(id, p) {
    var tip = $(id);
    if (!tip) return;
    if (!p.name && !p.text) {
      tip.innerHTML = '<b>이름을 남기지 않은 불빛</b>조용히 함께해 주신 마음입니다.';
    } else {
      tip.innerHTML = '<b>' + esc(p.name || '익명') + (p.mine ? ' · 내 마음' : '') + '</b>' +
        esc(p.text || '말없이 마음만 두고 가셨습니다.');
    }
    tip.style.left = Math.round(p.x) + 'px';
    tip.style.top = Math.round(p.y) + 'px';
    tip.classList.add('on');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { tip.classList.remove('on'); }, 4200);
  }

  function initFind() {
    function find(sky, tipId, mineBoxId, word) {
      return function () {
        if (!sky) return;
        var hit = sky.focusMine();
        var box = $(mineBoxId);
        if (hit) {
          showTip(tipId, { x: hit.x, y: hit.y, name: hit.name, text: hit.text, mine: true });
          if (box) {
            box.innerHTML = '✨ 찾았습니다 — 밝게 빛나는 것이 당신의 ' + word + '입니다.';
            show(box, true);
          }
        } else if (MINE.offered > 0) {
          if (box) {
            box.innerHTML = '당신이 밝힌 불빛도 이 안에 함께 있습니다. ' +
              '한마디를 남기시면 다음부터는 바로 찾아드릴 수 있어요.';
            show(box, true);
          }
        } else {
          if (box) {
            box.innerHTML = '아직 남기신 마음이 없습니다. 위에서 한마디를 남겨보세요.';
            show(box, true);
          }
        }
      };
    }
    var a = $('m2FindStar'), b = $('m2FindFlower');
    if (a) a.addEventListener('click', find(SKY, 'm2SkyTip', 'm2NightMine', '별'));
    if (b) b.addEventListener('click', find(FIELD, 'm2FieldTip', 'm2MornMine', '꽃'));
  }

  /* =========================================================
     6. 마음 남기기
     ========================================================= */
  function initOfferTypes() {
    var wrap = $('m2OfferTypes');
    if (!wrap) return;
    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.mem2-offer-type');
      if (!btn) return;
      offerType = btn.dataset.type || 'candle';
      Array.prototype.forEach.call(wrap.querySelectorAll('.mem2-offer-type'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  }

  /** 밤 — 헌화(+선택 한마디) */
  function submitNight() {
    var btn = $('m2NightSubmit');
    var nameEl = $('m2NightName'), msgEl = $('m2NightMsg'), anonEl = $('m2NightAnon');
    var nick = (nameEl && nameEl.value.trim()) || '';
    var text = (msgEl && msgEl.value.trim()) || '';
    var anon = !!(anonEl && anonEl.checked);
    if (btn) btn.disabled = true;

    /* ① 헌화 — 한마디가 없어도 이것만으로 참여가 된다 */
    api('/api/memorial-offering', {
      method: 'POST',
      body: { type: offerType, nickname: anon ? null : (nick || null) }
    }).then(function (res) {
      if (!res.ok) {
        if (btn) btn.disabled = false;
        toast((res.data && res.data.error) || '헌화하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      COUNTS.candles += 1;
      MINE.offered = (MINE.offered || 0) + 1;
      saveMine(MINE);

      /* ② 한마디가 있으면 방명록에도 남긴다 */
      if (!text) {
        finishNight(btn, '불빛을 밝혔습니다. 고맙습니다.');
        return;
      }
      api('/api/memorial-messages', {
        method: 'POST',
        body: { authorName: anon ? '익명' : (nick || '익명'), content: text, isAnonymous: anon, kind: 'tribute' }
      }).then(function (r2) {
        if (r2.ok) {
          COUNTS.messages += 1;
          var newId = unwrap(r2, 'id') || (r2.data && r2.data.data && r2.data.data.message && r2.data.data.message.id);
          if (newId) rememberMine('tribute', newId);
          if (msgEl) msgEl.value = '';
          loadMessages('tribute', false);
        }
        finishNight(btn, '불빛과 마음을 함께 남겼습니다. 고맙습니다.');
      });
    });
  }

  function finishNight(btn, msg) {
    if (btn) btn.disabled = false;
    paintCounts();
    refreshSky();
    toast(msg);
    var box = $('m2NightMine');
    if (box) {
      box.innerHTML = '🕯️ 당신의 불빛이 밤하늘에 더해졌습니다. ' +
        '<button type="button" class="mem2-ghost" id="m2JumpStar">내 별 보러 가기</button>';
      show(box, true);
      var j = $('m2JumpStar');
      if (j) j.addEventListener('click', function () { var f = $('m2FindStar'); if (f) f.click(); });
    }
  }

  /** 아침 — 유가족 응원 */
  function submitMorning() {
    var btn = $('m2MornSubmit');
    var nameEl = $('m2MornName'), msgEl = $('m2MornMsg'), anonEl = $('m2MornAnon');
    var nick = (nameEl && nameEl.value.trim()) || '';
    var text = (msgEl && msgEl.value.trim()) || '';
    var anon = !!(anonEl && anonEl.checked);

    if (!text) { toast('응원 한마디를 적어주세요.'); if (msgEl) msgEl.focus(); return; }
    if (btn) btn.disabled = true;

    api('/api/memorial-messages', {
      method: 'POST',
      body: { authorName: anon ? '익명' : (nick || '익명'), content: text, isAnonymous: anon, kind: 'support' }
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok) {
        toast((res.data && res.data.error) || '응원을 남기지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      COUNTS.messages += 1;
      var newId = unwrap(res, 'id') || (res.data && res.data.data && res.data.data.message && res.data.data.message.id);
      if (newId) rememberMine('support', newId);
      if (msgEl) msgEl.value = '';
      paintCounts();
      loadMessages('support', false);
      toast('꽃 한 송이를 놓았습니다. 고맙습니다.');

      var box = $('m2MornMine');
      if (box) {
        box.innerHTML = '🌸 당신의 꽃이 들판에 피었습니다. ' +
          '<button type="button" class="mem2-ghost" id="m2JumpFlower">내 꽃 보러 가기</button>';
        show(box, true);
        var j = $('m2JumpFlower');
        if (j) j.addEventListener('click', function () { var f = $('m2FindFlower'); if (f) f.click(); });
      }
    });
  }

  /* =========================================================
     7. 아침 — 유가족 근황 · 목소리
     ========================================================= */
  var MOODS = { calm: '🌿', hope: '🌤️', thanks: '💌', daily: '☕' };

  function loadFamilyNotes() {
    var list = $('m2NoteList'), empty = $('m2NoteEmpty'), loading = $('m2NoteLoading');
    return api('/api/memorial-family-notes').then(function (res) {
      show(loading, false);
      var notes = unwrap(res, 'notes') || unwrap(res, 'list') || [];
      if (!res.ok || !notes.length) { show(empty, true); return; }
      if (list) {
        list.innerHTML = notes.map(function (n) {
          return '<article class="mem2-note">' +
            '<div class="mem2-note-mood" aria-hidden="true">' + (MOODS[n.mood] || '🌿') + '</div>' +
            '<h3>' + esc(n.title || '') + '</h3>' +
            '<p>' + esc(n.content || '') + '</p>' +
            (n.authorLabel ? '<div class="mem2-note-by">' + esc(n.authorLabel) + '</div>' : '') +
            '</article>';
        }).join('');
      }
    });
  }

  function loadStories() {
    return api('/api/family-stories').then(function (res) {
      if (!res.ok) return;
      var stories = unwrap(res, 'stories') || [];
      if (!stories.length) return;
      var list = $('m2StoryList'), block = $('m2StoryBlock');
      if (!list) return;
      list.innerHTML = stories.slice(0, 3).map(function (s) {
        var thumb = s.thumbnailUrl
          ? '<img src="' + esc(s.thumbnailUrl) + '" alt="" loading="lazy">'
          : (s.youtubeId ? '<img src="https://i.ytimg.com/vi/' + esc(s.youtubeId) + '/hqdefault.jpg" alt="" loading="lazy">' : '');
        return '<a class="mem2-story" href="/family-story.html?id=' + encodeURIComponent(s.id) + '">' +
          '<div class="mem2-story-thumb">' + thumb +
          '<span class="mem2-story-play"><span class="siren-icon-wrap" data-icon="play"></span></span></div>' +
          '<div class="mem2-story-body">' +
          '<h3>' + esc(s.title || '') + '</h3>' +
          (s.summary || s.subtitle ? '<p>' + esc(s.summary || s.subtitle) + '</p>' : '') +
          '</div></a>';
      }).join('');
      show(block, true);
      if (window.Icons && Icons.hydrate) { try { Icons.hydrate(list); } catch (e) {} }
    });
  }

  /* =========================================================
     8. 시작
     ========================================================= */
  function bind() {
    initSwitch();
    initOfferTypes();
    var a = $('m2NightSubmit'); if (a) a.addEventListener('click', submitNight);
    var b = $('m2MornSubmit'); if (b) b.addEventListener('click', submitMorning);
    var c = $('m2NightMore'); if (c) c.addEventListener('click', function () { PAGE.tribute++; loadMessages('tribute', true); });
    var d = $('m2MornMore'); if (d) d.addEventListener('click', function () { PAGE.support++; loadMessages('support', true); });
  }

  function start() {
    bind();
    /* 서로 기다릴 필요가 없는 조회는 한꺼번에 */
    loadSummary();
    loadTeachers();
    loadSpotlights();
    loadFamilyNotes();
    loadStories();
    Promise.all([loadMessages('tribute', false), loadMessages('support', false)])
      .then(function () { mountSky(); initFind(); })
      .catch(function () { mountSky(); initFind(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
