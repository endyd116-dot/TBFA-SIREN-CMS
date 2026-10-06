/* =========================================================
   온라인 추모관 v2 — 굿나잇, 굿모닝
   ---------------------------------------------------------
   한 화면이 밤에서 아침으로 흐른다.
     밤   : 먼저 떠나신 선생님을 기억한다 (별빛 · 추모 한마디)
     아침 : 남겨진 유가족의 오늘을 본다 (근황 · 징검다리 · 목소리)

   핵심 장치 — 같은 마음, 두 얼굴
     밤에 밝힌 별빛이 아침에는 들판의 '꽃'으로 다시 핀다.
     자리는 참여 번호에서 계산하므로 다시 와도 내 것은 늘 같은 곳에 있다.

   ★ 2026-10-07 정책국장 요청 반영
     · 아침의 응원 한마디·응원 목록·들판 숫자는 걷어냈다.
       (유가족에게 "이런 글이 왔어요"라고 보이는 것이 되려 실례일 수 있다)
       배경의 꽃은 밤의 별빛 수만큼 조용히 피는 장식으로만 남는다.
     · 유가족 근황은 누르면 이야기 전체가 열린다 (사진 포함).
     · 지원 프로그램 카드 대신, 협의회가 걸어온 길을 시간순으로 보여준다.
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
  /* 운영자가 쓴 글은 줄바꿈만 살린다 (글자 그대로 보여준다) */
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  /* ───────── 내 참여 기록 (이 브라우저에만 저장) ─────────
     서버에 따로 남기지 않는다. '내 별 찾기'에만 쓴다. */
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
  function isMine(id) { return MINE.tribute.indexOf(Number(id)) !== -1; }
  function rememberMine(id) {
    if (id != null && MINE.tribute.indexOf(Number(id)) === -1) MINE.tribute.push(Number(id));
    saveMine(MINE);
  }

  /* ───────── 남긴 뒤 가입 권유 ─────────
     로그인 벽을 세우는 대신, 마음을 남긴 다음에 권한다.
     이미 회원이거나 한 번 닫은 분에게는 다시 띄우지 않는다. */
  var JOIN_KEY = 'siren:memorial:joinAsked:v1';
  function alreadyMember() {
    try {
      return !!(window.Auth && window.Auth.user) ||
             document.body.classList.contains('is-logged-in');
    } catch (e) { return false; }
  }
  function inviteJoin(boxId, word) {
    if (alreadyMember()) return;
    try { if (localStorage.getItem(JOIN_KEY)) return; } catch (e) {}
    var box = $(boxId);
    if (!box) return;
    var extra = document.createElement('div');
    extra.className = 'mem2-mine';
    extra.style.marginTop = '10px';
    extra.innerHTML =
      '<span>회원이 되시면 ' + esc(word) + ' 관련 소식과 활동을 받아보실 수 있습니다.</span>' +
      '<button type="button" class="mem2-ghost" data-action="open-modal" data-target="signupModal">회원가입</button>' +
      '<button type="button" class="mem2-ghost" data-m2-join-close>괜찮아요</button>';
    box.parentNode.insertBefore(extra, box.nextSibling);
    var close = extra.querySelector('[data-m2-join-close]');
    if (close) close.addEventListener('click', function () {
      try { localStorage.setItem(JOIN_KEY, '1'); } catch (e) {}
      extra.parentNode && extra.parentNode.removeChild(extra);
    });
  }

  /* ───────── 상태 ───────── */
  var PAGE = 1;
  var COUNTS = { people: 0, candles: 0, messages: 0 };
  var CACHE = [];               /* 밤의 한마디 */
  var NOTES = [];               /* 유가족 근황 */
  var TL = [];                  /* 징검다리 */
  var SKY = null, FIELD = null;
  /* 남기는 것은 '별빛' 하나뿐이다. 저장되는 값은 예전과 같게 둔다. */
  var OFFER_TYPE = 'candle';

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
      /* ★ 2026-10-07: 아침의 근황·징검다리 구간 제목도 운영자가 고친다 */
      ['morning', 'notesTitle', 'm2NotesTitle'], ['morning', 'notesSub', 'm2NotesSub'],
      ['morning', 'timelineTitle', 'm2TlTitle'], ['morning', 'timelineSub', 'm2TlSub'],
      ['dawn', 'line', 'm2DawnLine'], ['dawn', 'sub', 'm2DawnSub']
    ];
    map.forEach(function (m) {
      var v = hall[m[0]] && hall[m[0]][m[1]];
      var el = $(m[2]);
      if (el && v) el.innerHTML = String(v).replace(/\n/g, '<br>');
    });
  }

  /* 별빛 하나 = 참여 한 번.
     밤에서 한마디를 남기면 헌화도 함께 생기므로 헌화 수가 곧 참여 수다.
     선생님 화면에서 보낸 편지도 별빛 하나로 함께 센다(서버가 헌화를 같이 만든다). */
  function totalHearts() { return COUNTS.candles || 0; }

  function paintCounts() {
    var t = totalHearts();
    /* ★ 숫자는 요약 API로 따로 온다. 하늘을 이미 그린 뒤 도착할 수 있으므로
       도착할 때마다 다시 그린다(안 그러면 별빛이 몇 개 안 뜬다). */
    refreshSky();
    var a = $('m2NightCount');
    if (a) a.textContent = num(t);
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
     4. 한마디 목록 (밤 — 선생님 추모)
     ========================================================= */
  function msgCard(m) {
    var mine = isMine(m.id);
    return '<article class="mem2-msg' + (mine ? ' mem2-msg-mine' : '') + '">' +
      '<div class="mem2-msg-head">' +
      '<span class="mem2-msg-name">' + esc(m.isAnonymous ? '익명' : (m.authorName || '익명')) + '</span>' +
      '<span class="mem2-msg-date">' + esc(fmtDate(m.createdAt)) + '</span>' +
      (mine ? '<span class="mem2-badge-mine">내가 남긴 마음</span>' : '') +
      '</div>' +
      '<p class="mem2-msg-body">' + esc(m.content || '') + '</p>' +
      '<button type="button" class="mem2-locate" data-m2-locate="' + esc(m.id) + '">이 마음의 별 보기 →</button>' +
      '</article>';
  }

  function loadMessages(append) {
    var listEl = $('m2NightMsgs'), emptyEl = $('m2NightMsgEmpty'), loadEl = $('m2NightMsgLoading');
    var moreWrap = $('m2NightMoreWrap');
    if (!append) { PAGE = 1; CACHE = []; }
    show(loadEl, true);

    return api('/api/memorial-messages?kind=tribute&page=' + PAGE).then(function (res) {
      show(loadEl, false);
      var msgs = unwrap(res, 'messages') || [];
      var pg = unwrap(res, 'pagination') || {};
      if (!res.ok) { show(emptyEl, CACHE.length === 0); return; }

      CACHE = append ? CACHE.concat(msgs) : msgs;
      if (listEl) listEl.innerHTML = CACHE.map(msgCard).join('');
      show(emptyEl, CACHE.length === 0);
      show(moreWrap, !!pg.hasMore);
      refreshSky();
    });
  }

  /* =========================================================
     5. 하늘 · 들판
     ========================================================= */
  /** 한마디들을 '마음' 목록으로 바꾸고, 한마디 없이 별빛만 밝힌 분들은 이름 없는 별로 채운다 */
  function buildHearts() {
    var named = CACHE.map(function (m) {
      return {
        id: 'm' + m.id,
        name: m.isAnonymous ? '익명' : (m.authorName || '익명'),
        text: m.content || '',
        mine: isMine(m.id)
      };
    });
    var cap = (window.MemorialSky && window.MemorialSky.MAX_DRAW) || 420;
    var total = totalHearts();
    var fillers = Math.max(0, Math.min(total, cap) - named.length);
    for (var i = 0; i < fillers; i++) {
      named.push({ id: 'o' + i, name: '', text: '', mine: false });
    }
    return { items: named, total: total };
  }

  function mountSky() {
    if (!window.MemorialSky) return;
    var c1 = $('m2NightSky'), c2 = $('m2MornField');
    var n = buildHearts();

    /* 배경으로 깔리므로 클릭을 받지 않는다(글자 선택·복사를 지키기 위해).
       대신 아래 목록의 '이 마음의 별 보기'로 찾아간다. */
    if (c1 && !SKY) {
      SKY = MemorialSky.mount(c1, { mode: 'star', backdrop: true, items: n.items, total: n.total });
    }
    /* 아침의 들판 — 밤과 같은 마음이 꽃으로 핀다 (장식·클릭 없음) */
    if (c2 && !FIELD) {
      FIELD = MemorialSky.mount(c2, { mode: 'flower', backdrop: true, items: n.items, total: n.total });
    }
  }

  function refreshSky() {
    if (!SKY && !FIELD) return;
    var n = buildHearts();
    if (SKY) SKY.setItems(n.items, n.total);
    if (FIELD) FIELD.setItems(n.items, n.total);
  }

  var tipTimer = null;
  function flashNote(text) {
    var el = $('m2Note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'm2Note';
      el.className = 'mem2-note-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = text;
    el.classList.add('on');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { el.classList.remove('on'); }, 5200);
  }

  function initFind() {
    var a = $('m2FindStar');
    if (a) a.addEventListener('click', function () {
      var box = $('m2NightMine');
      if (!SKY) return;
      var hit = SKY.focusMine();
      if (hit) {
        scrollToBackdrop(hit.y);
        flashNote('<b>찾았습니다</b>밝게 빛나는 것이 당신의 별입니다.' +
          (hit.text ? '<br><span style="opacity:.8">“' + esc(hit.text) + '”</span>' : ''));
        if (box) { box.innerHTML = '✨ 당신의 별이 잠시 밝아집니다.'; show(box, true); }
      } else if (MINE.offered > 0) {
        if (box) {
          box.innerHTML = '당신이 밝힌 별빛도 이 안에 함께 있습니다. ' +
            '한마디를 남기시면 다음부터는 바로 찾아드릴 수 있어요.';
          show(box, true);
        }
      } else {
        if (box) {
          box.innerHTML = '아직 남기신 마음이 없습니다. 위에서 한마디를 남겨보세요.';
          show(box, true);
        }
      }
    });

    /* 목록의 '이 마음의 별 보기' — 글을 읽다가 그 별로 찾아간다.
       배경은 클릭을 받지 않으므로(글자 복사를 지키려고) 이 방향으로 잇는다. */
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-m2-locate]');
      if (!btn || !SKY) return;
      var id = btn.getAttribute('data-m2-locate');
      var hit = SKY.focusId('m' + id);
      if (!hit) { flashNote('<b>아직 하늘에 뜨지 않았습니다</b>잠시 뒤 다시 시도해 주세요.'); return; }
      scrollToBackdrop(hit.y);
      flashNote('<b>' + esc(hit.name || '익명') + '</b>' + esc(hit.text || ''));
    });
  }

  /** 밤하늘에서 그 자리가 화면 가운데 오도록 스크롤한다 */
  function scrollToBackdrop(yInCanvas) {
    var host = $('hallNight');
    if (!host) return;
    var top = host.getBoundingClientRect().top + window.pageYOffset;
    var target = top + (yInCanvas || 0) - (window.innerHeight / 2);
    try { window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' }); }
    catch (e) { window.scrollTo(0, Math.max(0, target)); }
  }

  /* =========================================================
     6. 마음 남기기 (밤 — 헌화 + 선택 한마디)
     ========================================================= */
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
      body: { type: OFFER_TYPE, nickname: anon ? null : (nick || null) }
    }).then(function (res) {
      if (!res.ok) {
        if (btn) btn.disabled = false;
        toast((res.data && res.data.error) || '헌화하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      COUNTS.candles += 1;
      MINE.offered = (MINE.offered || 0) + 1;
      saveMine(MINE);
      /* 별빛은 이미 켜졌다 — 한마디 검토를 기다리지 말고 숫자·하늘을 바로 고친다.
         (검토가 몇 초 걸리는 동안 아무 일도 안 일어난 것처럼 보이던 문제) */
      paintCounts();

      /* ② 한마디가 있으면 방명록에도 남긴다 */
      if (!text) {
        finishNight(btn, '별빛을 밝혔습니다. 고맙습니다.');
        return;
      }
      toast('별빛을 밝혔습니다. 남기신 한마디를 확인하고 있습니다…');
      api('/api/memorial-messages', {
        method: 'POST',
        body: { authorName: anon ? '익명' : (nick || '익명'), content: text, isAnonymous: anon, kind: 'tribute' }
      }).then(function (r2) {
        if (!r2.ok) {
          finishNight(btn, '별빛은 밝혔습니다. 다만 한마디는 저장하지 못했습니다 — '
            + ((r2.data && r2.data.error) || '잠시 후 다시 시도해 주세요.'));
          return;
        }
        COUNTS.messages += 1;
        var newId = unwrap(r2, 'id') || (r2.data && r2.data.data && r2.data.data.message && r2.data.data.message.id);
        if (newId) rememberMine(newId);
        if (msgEl) msgEl.value = '';
        loadMessages(false);
        finishNight(btn, '별빛과 마음을 함께 남겼습니다. 고맙습니다.');
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
      box.innerHTML = '✦ 당신의 별빛이 밤하늘에 더해졌습니다. ' +
        '<button type="button" class="mem2-ghost" id="m2JumpStar">내 별 보러 가기</button>';
      show(box, true);
      var j = $('m2JumpStar');
      if (j) j.addEventListener('click', function () { var f = $('m2FindStar'); if (f) f.click(); });
      inviteJoin('m2NightMine', '이 선생님');
    }
  }

  /* =========================================================
     7. 겹쳐 뜨는 화면 (근황 · 징검다리)
     ========================================================= */
  function openBox(id) {
    var box = $(id);
    if (box) box.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeBoxes() {
    Array.prototype.forEach.call(document.querySelectorAll('.mem2-modal.on'), function (b) {
      b.classList.remove('on');
    });
    document.body.style.overflow = '';
  }
  function setBox(id, v) {
    var el = $(id);
    if (el) el.textContent = v || '';
  }
  function setBoxImg(id, url) {
    var el = $(id);
    if (!el) return;
    if (url) { el.src = url; show(el, true); }
    else { el.removeAttribute('src'); show(el, false); }
  }

  /* =========================================================
     8. 아침 — 유가족 근황 (누르면 이야기 전체)
     ========================================================= */
  var MOODS = { calm: '🌿 담담한 하루', hope: '🌤️ 희망', thanks: '💌 감사', daily: '☕ 일상' };

  /* 카드에는 앞머리만 — 전체는 눌러서 읽는다 */
  function excerpt(text, n) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function noteCard(n, i) {
    var img = n.photoUrl
      ? '<div class="mem2-note-img"><img src="' + esc(n.photoUrl) + '" alt="" loading="lazy"></div>'
      : '';
    return '<button type="button" class="mem2-note' + (n.photoUrl ? ' has-img' : '') + '" data-m2-note="' + i + '">' +
      img +
      '<div class="mem2-note-body">' +
      '<div class="mem2-note-mood" aria-hidden="true">' + (MOODS[n.mood] || MOODS.calm) + '</div>' +
      '<h3>' + esc(n.title || '') + '</h3>' +
      '<p>' + esc(excerpt(n.content, 110)) + '</p>' +
      '<div class="mem2-note-foot">' +
      (n.authorLabel ? '<span class="mem2-note-by">' + esc(n.authorLabel) + '</span>' : '<span></span>') +
      '<span class="mem2-note-open">이야기 읽기 →</span>' +
      '</div></div></button>';
  }

  function loadFamilyNotes() {
    var list = $('m2NoteList'), empty = $('m2NoteEmpty'), loading = $('m2NoteLoading');
    return api('/api/memorial-family-notes').then(function (res) {
      show(loading, false);
      NOTES = unwrap(res, 'notes') || unwrap(res, 'list') || [];
      if (!res.ok || !NOTES.length) { show(empty, true); return; }
      if (list) list.innerHTML = NOTES.map(noteCard).join('');
    });
  }

  function openNote(i) {
    var n = NOTES[i];
    if (!n) return;
    setBoxImg('m2NoteBoxImg', n.photoUrl);
    setBox('m2NoteBoxTag', MOODS[n.mood] || MOODS.calm);
    setBox('m2NoteBoxTitle', n.title || '');
    var t = $('m2NoteBoxText');
    if (t) t.innerHTML = nl2br(n.content || '');
    setBox('m2NoteBoxBy', n.authorLabel || '');
    openBox('m2NoteBox');
  }

  /* =========================================================
     9. 아침 — 온기의 징검다리 (협의회가 걸어온 길, 시간순)
     ========================================================= */
  function tlItem(x, i) {
    return '<li class="mem2-tl-item">' +
      '<button type="button" class="mem2-tl-btn" data-m2-tl="' + i + '">' +
      '<span class="mem2-tl-dot" aria-hidden="true"></span>' +
      '<div class="mem2-tl-head">' +
      (x.dateLabel ? '<span class="mem2-tl-date">' + esc(x.dateLabel) + '</span>' : '') +
      (x.category ? '<span class="mem2-tl-cat">' + esc(x.category) + '</span>' : '') +
      '</div>' +
      '<h3 class="mem2-tl-title">' + esc(x.title || '') + '</h3>' +
      (x.summary ? '<p class="mem2-tl-sum">' + esc(x.summary) + '</p>' : '') +
      ((x.detail || x.photoUrl || x.linkUrl) ? '<span class="mem2-tl-more">자세한 이야기 보기 +</span>' : '') +
      '</button></li>';
  }

  function loadTimeline() {
    var list = $('m2TlList'), block = $('m2TlBlock');
    return api('/api/memorial-timeline').then(function (res) {
      TL = unwrap(res, 'items') || [];
      if (!res.ok || !TL.length) return;      /* 기록이 없으면 구간째 보이지 않는다 */
      if (list) list.innerHTML = TL.map(tlItem).join('');
      show(block, true);
    });
  }

  function openTl(i) {
    var x = TL[i];
    if (!x) return;
    setBoxImg('m2TlBoxImg', x.photoUrl);
    setBox('m2TlBoxDate', x.dateLabel || '');
    var cat = $('m2TlBoxCat');
    if (cat) { cat.textContent = x.category || ''; show(cat, !!x.category); }
    setBox('m2TlBoxTitle', x.title || '');
    setBox('m2TlBoxSummary', x.summary || '');
    var d = $('m2TlBoxDetail');
    if (d) { d.innerHTML = nl2br(x.detail || ''); show(d, !!x.detail); }
    var lw = $('m2TlBoxLinkWrap'), l = $('m2TlBoxLink');
    if (lw && l) {
      if (x.linkUrl) { l.href = x.linkUrl; show(lw, true); }
      else show(lw, false);
    }
    openBox('m2TlBox');
  }

  /* =========================================================
     10. 아침 — 유가족의 목소리 (영상, 맨 아래)
     ========================================================= */
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
     11. 시작
     ========================================================= */
  function bind() {
    initSwitch();
    var a = $('m2NightSubmit'); if (a) a.addEventListener('click', submitNight);
    var c = $('m2NightMore'); if (c) c.addEventListener('click', function () { PAGE++; loadMessages(true); });

    /* 근황·징검다리 열기 / 닫기 */
    document.addEventListener('click', function (ev) {
      var n = ev.target.closest && ev.target.closest('[data-m2-note]');
      if (n) { openNote(Number(n.getAttribute('data-m2-note'))); return; }
      var t = ev.target.closest && ev.target.closest('[data-m2-tl]');
      if (t) { openTl(Number(t.getAttribute('data-m2-tl'))); return; }
      /* 겹쳐 뜬 화면은 바깥이나 닫기 단추를 눌렀을 때만 닫는다 */
      var box = ev.target.closest && ev.target.closest('.mem2-modal');
      if (box && (ev.target === box || (ev.target.id || '').indexOf('Close') > 0)) closeBoxes();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeBoxes();
    });
  }

  function start() {
    bind();
    /* 서로 기다릴 필요가 없는 조회는 한꺼번에 */
    loadSummary();
    loadTeachers();
    loadSpotlights();
    loadFamilyNotes();
    loadTimeline();
    loadStories();
    loadMessages(false)
      .then(function () { mountSky(); initFind(); })
      .catch(function () { mountSky(); initFind(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
