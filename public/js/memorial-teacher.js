/* =========================================================
   추모관 v2 — 선생님 개별 화면
   ---------------------------------------------------------
   구성 (위는 어스름한 밤, 내려갈수록 아침빛으로 밝아진다)
     첫 화면   : 기억하는 한 문장 · 얼굴 · 이름 · 두 해
     소개      : 운영자가 쓴 글
     자유 구간 : 운영자가 원하는 만큼 직접 만들어 넣는 자리
     어느 하루 : 생전의 사진 (폴라로이드 — 누르면 그날 이야기)
     기억의 편지: 도착한 편지 (봉투 — 누르면 편지지가 펼쳐진다)
     서신 작성 : 편지 한 통 (로그인 없이 · 질문 카드 · 30통 목표 · 출판 동의 · 초대 링크)
     한마디    : 예전에 남겨진 한마디가 있을 때만 보인다

   ★ 2026-10-07 정책국장 요청 반영
     · 별빛 한 줄 / 편지 한 통 두 갈래를 없애고 '나만의 서신 작성하기' 하나로.
     · 보낸 편지는 위 '기억의 편지'에 바로 봉투로 놓인다.
     · "편지 30통이 모이면 책이 됩니다" — 목표 문구와 진행바.
     · 제목 대신 질문 카드 하나를 고르면 그것이 편지의 주제가 된다.
     · 먼저 도착한 짧은 편지 2~3통을 카드로, 마지막은 작성 유도 카드.
     · 고인별 초대 링크(QR) — 유가족이 지인에게 편지를 청한다.

   화면 문구는 두 겹이다 — 모든 선생님 공통(추모관 설정) 위에
   이 선생님만의 문구(선생님 편집)가 덮인다.
   ========================================================= */
(function () {
  'use strict';

  /* ───────── 공통 ───────── */
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
    else console.log('[선생님]', msg);
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

  var PARAMS = new URLSearchParams(location.search);
  var TEACHER_ID = (function () {
    var m = PARAMS.get('id');
    return m ? Number(m) : 0;
  })();
  /* 초대 링크로 들어왔는지 — 들어오면 편지 자리로 바로 안내한다 */
  var INVITED = PARAMS.get('invite') === '1';

  var TEACHER_NAME = '';
  var PHOTOS = [];
  var MSG_PAGE = 1;
  var MSG_CACHE = [];

  /* ───────── 1. 선생님 정보 ───────── */
  function loadTeacher() {
    if (!TEACHER_ID) {
      var n = $('mtName');
      if (n) n.textContent = '잘못된 주소입니다';
      return Promise.resolve();
    }
    return api('/api/memorial-teacher?id=' + TEACHER_ID).then(function (res) {
      if (!res.ok) {
        var n = $('mtName');
        if (n) n.textContent = '공개된 추모 공간을 찾을 수 없습니다';
        return;
      }
      var t = unwrap(res, 'teacher') || {};
      var display = unwrap(res, 'display') || {};
      paintTeacher(t, display);
    });
  }

  function paintTeacher(t, display) {
    TEACHER_NAME = t.name || '';
    document.title = (t.name || '선생님') + '을 기억합니다 | 교사유가족협의회';

    var nameEl = $('mtName');
    if (nameEl) nameEl.textContent = t.name || '';

    var copy = t.pageCopy || {};

    if (t.photoUrl) {
      var p = $('mtPortrait');
      if (p) p.innerHTML = '<img src="' + esc(t.photoUrl) + '" alt="' + esc(t.name || '') + '">';
    }

    /* 첫 화면에 남기는 것은 얼굴·이름·한 문장뿐이다.
       학교·지역 같은 정보는 이름 아래 작게 한 줄로만 둔다. */
    var mEl = $('mtMeta');
    if (mEl) {
      mEl.innerHTML = t.schoolRegion ? '<span>' + esc(t.schoolRegion) + '</span>' : '';
    }

    /* 두 해만 남긴다 — 날짜까지 적으면 부고처럼 읽힌다 */
    var yEl = $('mtYears');
    if (yEl) {
      var years = [yearOf(t.birthDate), yearOf(t.deathDate)].filter(Boolean);
      if (years.length) { yEl.textContent = years.join(' — '); show(yEl, true); }
    }

    /* 생전에 남기신 말 한 문장을 화면 맨 위에 크게 건다 */
    if (t.tributeLine) {
      var q = $('mtQuote');
      if (q) { q.textContent = t.tributeLine; show(q, true); }
    }

    /* 화면 문구는 두 겹이다.
       ① 모든 선생님에게 공통으로 쓰는 문구(어드민 > 추모관 설정)
       ② 이 선생님께만 쓰는 문구(선생님 편집) — 있으면 ①을 덮는다 */
    var tc = display.teacherCopy || {};
    applyCopy(tc);
    applyCopy(copy);
    applyLetterSettings(tc, copy, t);

    /* 사진이 있으면 빈 자리를 말하는 문구는 걷어낸다 */
    if (t.photoUrl && !copy.portraitCaption) {
      var fc = $('mtFrameCap');
      if (fc) show(fc, false);
    }

    /* 소개 */
    if (t.bioHtml && String(t.bioHtml).trim()) {
      var b = $('mtBio');
      if (b) { b.innerHTML = t.bioHtml; fitAlign(b); }
      show($('mtBioSec'), true);
    }

    /* 운영자가 직접 늘린 구간 — 소개와 사진 사이에 놓인다 */
    renderSections(Array.isArray(t.sections) ? t.sections : []);

    /* 순간들 — 사진이 없어도 구간은 보여주고, 빈 자리로 참여를 권한다 */
    PHOTOS = Array.isArray(t.photos) ? t.photos : [];
    renderPhotos();
    show($('mtPhotoEmpty'), PHOTOS.length === 0);
    show($('mtPhotoSec'), true);

    /* 서신 작성 구간을 감추도록 설정했으면 숨긴다 (추모관 설정) */
    if (display.showTeacherOffering === false) show($('mtOfferSec'), false);

    /* 초대 링크로 들어온 분 — 이름을 넣어 반기고 편지 자리로 데려간다 */
    if (INVITED) {
      var bl = $('mtInviteBannerLine');
      if (bl) bl.textContent = (t.name ? t.name + '을 ' : '') + '기억하는 분이 당신을 초대했습니다.';
      show($('mtInviteBanner'), true);
      setTimeout(function () {
        var sec = $('mtOfferSec');
        if (sec && sec.style.display !== 'none') {
          try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { sec.scrollIntoView(); }
        }
      }, 600);
    }

    mountHeroSky(t.candleCount);
  }

  /* 문구 자리와 저장 이름을 짝지어 둔다 — 어드민 입력란도 같은 이름을 쓴다 */
  var COPY_MAP = [
    ['mtLeadLine', 'leadLine'],
    ['mtFrameCap', 'portraitCaption'],
    ['mtPhotoTag', 'photoTag'],
    ['mtPhotoTitle', 'photoTitle'],
    ['mtPhotoDesc', 'photoDesc'],
    ['mtPhotoEmptyLine', 'photoEmptyLine'],
    ['mtPhotoEmptySub', 'photoEmptySub'],
    ['mtLtTag', 'letterTag'],
    ['mtLetterTitle', 'letterTitle'],
    ['mtLtDesc', 'letterDesc'],
    ['mtOfferTag', 'offerTag'],
    ['mtOfferTitle', 'offerTitle'],
    ['mtOfferDesc', 'offerDesc'],
    ['mtGoalSub', 'letterGoalSub'],
    ['mtLtHint', 'letterHint'],
    ['mtInviteTitle', 'inviteTitle'],
    ['mtInviteDesc', 'inviteDesc'],
    ['mtNoteTag', 'noteTag'],
    ['mtNoteTitle', 'noteTitle']
  ];

  function applyCopy(c) {
    if (!c || typeof c !== 'object') return;
    COPY_MAP.forEach(function (pair) { setText(pair[0], c[pair[1]]); });
  }

  /* 짧은 글은 가운데가 예쁘지만, 여러 줄로 이어지는 글은 왼쪽이 훨씬 읽기 편하다.
     글자 수를 보고 정해준다. */
  var LONG_TEXT = 90;
  function fitAlign(el) {
    if (!el) return;
    var len = String(el.textContent || '').replace(/\s+/g, ' ').trim().length;
    if (len > LONG_TEXT) el.classList.add('is-long');
    else el.classList.remove('is-long');
  }

  function setText(id, v) {
    if (!v) return;
    var el = $(id);
    if (el) el.textContent = v;
  }

  /* '1994-03-02' 에서 해만 꺼낸다 */
  function yearOf(v) {
    if (!v) return '';
    var m = String(v).match(/(\d{4})/);
    return m ? m[1] : '';
  }

  /* ───────── 2. 선생님의 어느 하루 (폴라로이드) ───────── */
  function renderPhotos() {
    var wrap = $('mtPhotos');
    if (!wrap) return;
    wrap.innerHTML = PHOTOS.map(function (p, i) {
      var img = p.url
        ? '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || '') + '" loading="lazy">'
        : '<span class="siren-icon-wrap" data-icon="image" style="opacity:.3"></span>';
      return '<button type="button" class="mt2-pola" data-mt-photo="' + i + '">' +
        '<div class="mt2-pola-img">' + img + '</div>' +
        '<p class="mt2-pola-cap">' + esc(p.caption || '') + '</p>' +
        (p.takenLabel ? '<span class="mt2-pola-when">' + esc(p.takenLabel) + '</span>' : '') +
        '</button>';
    }).join('');
    if (window.Icons && Icons.hydrate) { try { Icons.hydrate(wrap); } catch (e) {} }
  }

  function openPhoto(i) {
    var p = PHOTOS[i];
    if (!p) return;
    var img = $('mtLbImg');
    if (img) {
      if (p.url) { img.src = p.url; img.alt = p.caption || ''; show(img, true); }
      else show(img, false);
    }
    var w = $('mtLbWhen');
    if (w) { w.textContent = p.takenLabel || ''; show(w, !!p.takenLabel); }
    var cap = $('mtLbCap');
    if (cap) cap.textContent = p.caption || '';
    var d = $('mtLbDetail');
    if (d) d.textContent = p.detail || '';
    openBox('mtLightbox');
  }

  /* 겹쳐 뜨는 화면은 사진·편지가 같은 방식으로 열리고 닫힌다 */
  function openBox(id) {
    var box = $(id);
    if (box) box.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeBoxes() {
    ['mtLightbox', 'mtLtBox'].forEach(function (id) {
      var b = $(id);
      if (b) b.classList.remove('on');
    });
    document.body.style.overflow = '';
  }

  /* ───────── 2-1. 운영자가 늘린 구간 ─────────
     정해진 칸으로는 다 담기지 않는 이야기를 운영자가 직접 만들어 넣는 자리다. */
  function renderSections(list) {
    var wrap = $('mtSections');
    if (!wrap) return;
    if (!list.length) { wrap.innerHTML = ''; return; }

    var html = list.map(function (x) {
      var img = x.imageUrl
        ? '<div class="mt2-free-img"><img src="' + esc(x.imageUrl) + '" alt="' + esc(x.title || '') + '" loading="lazy"></div>'
        : '';
      /* 운영자가 쓴 글은 줄바꿈만 살린다 (글자 그대로 보여준다) */
      var body = x.body
        ? '<div class="mt2-free-body">' + esc(x.body).replace(/\n/g, '<br>') + '</div>'
        : '';
      return '<section class="mt2-sec mt2-sec-free">' +
        '<div class="mt2-wrap">' +
        (x.title ? '<h2 class="mt2-h2 mt2-free-title">' + esc(x.title) + '</h2>' : '') +
        img + body +
        '</div></section>';
    }).join('');
    wrap.innerHTML = html;
    Array.prototype.forEach.call(wrap.querySelectorAll('.mt2-free-body'), fitAlign);
  }

  /* ───────── 3. 첫 화면 별 ───────── */
  function mountHeroSky(candles) {
    if (!window.MemorialSky) return;
    var c = $('mtHeroSky');
    if (!c) return;
    var n = Math.max(70, Math.min(260, Number(candles || 0) + 70));
    var deco = [];
    for (var i = 0; i < n; i++) deco.push({ id: 't' + TEACHER_ID + '-' + i });
    MemorialSky.mount(c, { mode: 'star', backdrop: true, items: deco, total: deco.length });
  }

  /* ───────── 4. 한마디 (예전에 남겨진 것이 있을 때만) ───────── */
  function msgCard(m) {
    return '<article class="mt2-note">' +
      '<div class="mt2-note-head">' +
      '<span class="mt2-note-name">' + esc(m.authorName || '익명') + '</span>' +
      '<span class="mt2-note-date">' + esc(fmtDate(m.createdAt)) + '</span>' +
      '</div>' +
      '<p class="mt2-note-body">' + esc(m.content || '') + '</p>' +
      '</article>';
  }

  function loadMessages(append) {
    if (!TEACHER_ID) return Promise.resolve();
    if (!append) { MSG_PAGE = 1; MSG_CACHE = []; }
    return api('/api/memorial-messages?teacherId=' + TEACHER_ID + '&page=' + MSG_PAGE).then(function (res) {
      show($('mtMsgLoading'), false);
      var msgs = unwrap(res, 'messages') || [];
      var pg = unwrap(res, 'pagination') || {};
      MSG_CACHE = append ? MSG_CACHE.concat(msgs) : msgs;
      var list = $('mtMsgs');
      if (list) list.innerHTML = MSG_CACHE.map(msgCard).join('');
      show($('mtMsgMoreWrap'), !!pg.hasMore);
      /* 새로 적는 길은 편지로 모였다 — 남겨진 한마디가 있을 때만 구간이 보인다 */
      show($('mtNoteSec'), MSG_CACHE.length > 0);
    });
  }

  /* ───────── 5. 기억의 편지 (도착한 봉투) ───────── */
  var LETTERS = [];
  var LT_SHOWN = 6;          /* 처음에는 여섯 통만 펼쳐 둔다 */
  var NEW_LETTER_ID = null;  /* 방금 보낸 편지 — 잠시 밝게 표시한다 */

  /* 봉투 겉면에는 앞머리만 살짝 비친다 — 열어봐야 다 읽힌다 */
  function peekOf(text, n) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    var max = n || 90;
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function envelopeCard(l, i) {
    var isNew = NEW_LETTER_ID != null && Number(l.id) === Number(NEW_LETTER_ID);
    return '<button type="button" class="mt2-env' + (isNew ? ' is-new' : '') + '" data-mt-letter="' + i + '" id="mtEnv' + esc(l.id) + '">' +
      '<h3 class="mt2-env-title">' + esc(l.title || '선생님께') + '</h3>' +
      '<p class="mt2-env-peek">' + esc(peekOf(l.content)) + '</p>' +
      '<div class="mt2-env-foot">' +
      '<span>' + esc(l.authorName || '익명') + (isNew ? ' · 방금 도착' : '') + '</span>' +
      '<span class="mt2-env-open">열어보기 →</span>' +
      '</div></button>';
  }

  function renderLetters() {
    var wrap = $('mtLetters');
    if (!wrap) return;
    wrap.innerHTML = LETTERS.slice(0, LT_SHOWN).map(envelopeCard).join('');
    show($('mtLtEmpty'), LETTERS.length === 0);
    show($('mtLtMoreWrap'), LETTERS.length > LT_SHOWN);
    renderSamples();
  }

  function loadLetters() {
    if (!TEACHER_ID) return Promise.resolve();
    return api('/api/memorial-letters?teacherId=' + TEACHER_ID).then(function (res) {
      show($('mtLtLoading'), false);
      LETTERS = unwrap(res, 'letters') || [];
      LT_SHOWN = 6;
      renderLetters();
    });
  }

  function openLetter(i) {
    var l = LETTERS[i];
    if (!l) return;
    setBox('mtLtBoxTo', (TEACHER_NAME || '선생님') + '께');
    setBox('mtLtBoxWhen', fmtDate(l.createdAt));
    setBox('mtLtBoxTitle', l.title || '선생님께');
    setBox('mtLtBoxBody', l.content || '');
    setBox('mtLtBoxFrom', (l.authorName || '익명') + ' 드림');
    openBox('mtLtBox');
  }
  function setBox(id, v) {
    var el = $(id);
    if (el) el.textContent = v || '';
  }

  /* ───────── 6. 나만의 서신 작성하기 ───────── */
  var DEFAULT_QUESTIONS = [
    '선생님은 당신에게 어떤 분으로 기억됩니까?',
    '선생님과 함께한 날 중 가장 선명한 하루는 언제였나요?',
    '선생님께 미처 전하지 못한 말이 있다면 무엇인가요?',
    '선생님이 남기신 말이나 가르침 중 지금도 따르는 것이 있나요?',
    '선생님이 계셨다면 지금 어떤 이야기를 나누고 싶으세요?',
    '선생님을 떠올리게 하는 물건·장소·노래가 있나요?'
  ];
  var DEFAULT_GOAL = 30;
  var DEFAULT_GOAL_LINE = '편지 {goal}통이 모이면 책이 됩니다';
  var DEFAULT_GOAL_DONE = '편지 {count}통이 모였습니다 — 책으로 엮을 준비를 합니다';

  var GOAL = DEFAULT_GOAL;
  var GOAL_LINE = DEFAULT_GOAL_LINE;
  var GOAL_DONE = DEFAULT_GOAL_DONE;
  var LETTER_COUNT = 0;
  var QUESTIONS = DEFAULT_QUESTIONS.slice();
  var Q_PICK = 0;

  /* 운영자가 줄마다 하나씩 적은 목록, 또는 배열을 받는다 */
  function parseList(v) {
    var arr = Array.isArray(v) ? v : String(v || '').split(/\r?\n/);
    arr = arr.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
    return arr.length ? arr.slice(0, 8) : null;
  }
  function pickNum(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  /* 공통 문구(tc) 위에 이 선생님의 문구(copy)가 덮인다 */
  function applyLetterSettings(tc, copy, t) {
    tc = tc || {}; copy = copy || {};
    GOAL = pickNum(copy.letterGoal) || pickNum(tc.letterGoal) || DEFAULT_GOAL;
    GOAL_LINE = copy.letterGoalLine || tc.letterGoalLine || DEFAULT_GOAL_LINE;
    GOAL_DONE = copy.letterGoalDone || tc.letterGoalDone || DEFAULT_GOAL_DONE;
    QUESTIONS = parseList(copy.letterQuestions) || parseList(tc.letterQuestions) || DEFAULT_QUESTIONS.slice();
    var ph = copy.letterPlaceholder || tc.letterPlaceholder;
    if (ph && $('mtLtBody')) $('mtLtBody').placeholder = ph;
    LETTER_COUNT = Number((t && t.letterCount) || 0);
    renderQuestions();
    paintGoal();
  }

  function renderQuestions() {
    var wrap = $('mtQCards');
    if (!wrap) return;
    if (Q_PICK >= QUESTIONS.length) Q_PICK = 0;
    wrap.innerHTML = QUESTIONS.map(function (q, i) {
      return '<button type="button" class="mt2-qcard" role="radio" data-mt-q="' + i + '" ' +
        'aria-checked="' + (i === Q_PICK ? 'true' : 'false') + '">' +
        '<span class="mt2-qcard-no">' + (i + 1) + '</span>' +
        '<span class="mt2-qcard-text">' + esc(q) + '</span>' +
        '</button>';
    }).join('');
  }

  function pickQuestion(i) {
    Q_PICK = i;
    var wrap = $('mtQCards');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.mt2-qcard'), function (b) {
      b.setAttribute('aria-checked', Number(b.getAttribute('data-mt-q')) === i ? 'true' : 'false');
    });
  }

  function paintGoal() {
    var goal = GOAL || DEFAULT_GOAL;
    var count = LETTER_COUNT;
    var pct = Math.max(0, Math.min(100, Math.round(count / goal * 100)));
    var line = $('mtGoalLine'), cnt = $('mtGoalCount'), bar = $('mtGoalBar'), fill = $('mtGoalFill');
    var done = count >= goal;
    if (line) {
      line.textContent = (done ? GOAL_DONE : GOAL_LINE)
        .replace(/\{goal\}/g, num(goal)).replace(/\{count\}/g, num(count));
    }
    if (cnt) cnt.textContent = num(count) + ' / ' + num(goal) + '통';
    if (bar) {
      bar.setAttribute('aria-valuemax', String(goal));
      bar.setAttribute('aria-valuenow', String(Math.min(count, goal)));
      bar.classList.toggle('is-done', done);
    }
    if (fill) fill.style.width = (count > 0 && pct < 3 ? 3 : pct) + '%';
  }

  /* 먼저 도착한 짧은 편지 2~3통 — 짧은 것부터 보여주어 "이 정도면 나도" 싶게 한다.
     마지막 카드는 늘 작성 유도 카드다. */
  function renderSamples() {
    var box = $('mtSamples'), grid = $('mtSampleGrid'), head = $('mtSamplesHead');
    if (!box || !grid) return;
    var pool = LETTERS.filter(function (l) { return l && l.content; });
    var sorted = pool.slice().sort(function (a, b) {
      return String(a.content).length - String(b.content).length;
    });
    var picks = sorted.filter(function (l) { return String(l.content).length <= 220; }).slice(0, 3);
    if (picks.length < 2) picks = pool.slice(0, 3);

    var cards = picks.map(function (l) {
      var idx = LETTERS.indexOf(l);
      return '<button type="button" class="mt2-sample" data-mt-letter="' + idx + '">' +
        (l.title ? '<span class="mt2-sample-q">' + esc(l.title) + '</span>' : '') +
        '<p class="mt2-sample-text">' + esc(peekOf(l.content, 80)) + '</p>' +
        '<span class="mt2-sample-by">' + esc(l.authorName || '익명') + '</span>' +
        '</button>';
    });
    cards.push(
      '<button type="button" class="mt2-sample mt2-sample-cta" id="mtSampleCta">' +
      '<b>당신의 기억도 놓아주세요</b>' +
      '<span>한 문장이면 충분합니다. 위 질문 하나를 골라 적어주세요.</span>' +
      '</button>'
    );
    grid.innerHTML = cards.join('');
    if (head) head.textContent = picks.length ? '먼저 도착한 편지들' : '첫 편지를 기다리고 있습니다';
    show(box, true);
  }

  function submitLetter() {
    var btn = $('mtLtSubmit');
    var body = ($('mtLtBody') && $('mtLtBody').value.trim()) || '';
    var nick = ($('mtLtName') && $('mtLtName').value.trim()) || '';
    var anon = !!($('mtLtAnon') && $('mtLtAnon').checked);
    var consent = !!($('mtLtConsent') && $('mtLtConsent').checked);
    if (!body) { toast('편지를 적어주세요. 한 문장이어도 충분합니다.'); if ($('mtLtBody')) $('mtLtBody').focus(); return; }
    if (btn) btn.disabled = true;
    toast('편지를 보내고 있습니다…');

    api('/api/memorial-letters', {
      method: 'POST',
      body: {
        teacherId: TEACHER_ID,
        title: QUESTIONS[Q_PICK] || null,
        content: body,
        authorName: anon ? null : (nick || null),
        isAnonymous: anon,
        publishConsent: consent,
        invited: INVITED
      }
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok) {
        if (res.status === 401) {
          toast('편지를 보내려면 로그인이 필요합니다.');
          if (window.SIREN && window.SIREN.openModal) window.SIREN.openModal('loginModal');
          return;
        }
        toast((res.data && res.data.error) || '편지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      var letter = unwrap(res, 'letter') || {};
      if ($('mtLtBody')) $('mtLtBody').value = '';
      if ($('mtLtConsent')) $('mtLtConsent').checked = false;

      if (letter.pendingReview) {
        toast('편지를 받았습니다. 자동 검토를 거친 뒤 봉투로 놓입니다. 고맙습니다.');
        return;
      }
      LETTER_COUNT += 1;
      paintGoal();
      NEW_LETTER_ID = letter.id || null;
      loadLetters().then(function () {
        var sec = $('mtLetterSec');
        var env = NEW_LETTER_ID != null ? $('mtEnv' + NEW_LETTER_ID) : null;
        var target = env || sec;
        if (target) {
          try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
        }
      });
      toast('편지가 도착했습니다. 위 ‘기억의 편지’에 봉투로 놓였습니다.');
    });
  }

  /* ───────── 7. 초대 링크 · QR ───────── */
  function inviteUrl() {
    return location.origin + '/memorial-teacher.html?id=' + encodeURIComponent(TEACHER_ID) + '&invite=1';
  }
  function copyInvite() {
    var url = inviteUrl();
    var done = function () { toast('초대 링크를 복사했습니다. 지인에게 붙여 넣어 보내주세요.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('아래 링크를 복사해 주세요', url); });
    } else {
      window.prompt('아래 링크를 복사해 주세요', url);
    }
  }
  function shareInvite() {
    if (!navigator.share) { copyInvite(); return; }
    navigator.share({
      title: (TEACHER_NAME || '선생님') + '께 편지 한 통',
      text: (TEACHER_NAME || '선생님') + '을 기억하는 편지를 남겨주세요. 한 문장이어도 충분합니다.',
      url: inviteUrl()
    }).catch(function () { /* 사용자가 취소 — 조용히 */ });
  }

  /* QR 그리기 — 누를 때만 작은 생성기를 불러온다 (외부 서비스 없이 브라우저에서 그린다) */
  var QR_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  function loadQrLib() {
    return new Promise(function (resolve, reject) {
      if (window.qrcode) { resolve(); return; }
      var s = document.createElement('script');
      s.src = QR_SRC; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('QR 생성기를 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
  }
  function makeQr() {
    var btn = $('mtInviteQr');
    if (btn) btn.disabled = true;
    loadQrLib().then(function () {
      var qr = window.qrcode(0, 'M');
      qr.addData(inviteUrl());
      qr.make();
      var dataUrl = qr.createDataURL(6, 12);
      var img = $('mtQrImg');
      if (img) img.innerHTML = '<img src="' + dataUrl + '" alt="초대 링크 QR 코드" width="220" height="220">';
      var dl = $('mtQrDown');
      if (dl) {
        dl.href = dataUrl;
        dl.download = (TEACHER_NAME ? TEACHER_NAME + '-' : '') + '초대장-QR.png';
      }
      show($('mtQrBox'), true);
      if (btn) { btn.disabled = false; btn.textContent = 'QR 다시 만들기'; }
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e && e.message ? e.message : 'QR 코드를 만들지 못했습니다.');
    });
  }

  /* ───────── 시작 ───────── */
  function bind() {
    var lb = $('mtLtSubmit'); if (lb) lb.addEventListener('click', submitLetter);
    var more = $('mtMsgMore'); if (more) more.addEventListener('click', function () { MSG_PAGE++; loadMessages(true); });
    var ltMore = $('mtLtMore');
    if (ltMore) ltMore.addEventListener('click', function () { LT_SHOWN += 6; renderLetters(); });

    var ic = $('mtInviteCopy'); if (ic) ic.addEventListener('click', copyInvite);
    var is = $('mtInviteShare');
    if (is) {
      if (navigator.share) show(is, true);
      is.addEventListener('click', shareInvite);
    }
    var iq = $('mtInviteQr'); if (iq) iq.addEventListener('click', makeQr);

    /* 질문 고르기 · 유도 카드 · 사진·편지 열기 · 닫기 */
    document.addEventListener('click', function (ev) {
      var q = ev.target.closest && ev.target.closest('[data-mt-q]');
      if (q) { pickQuestion(Number(q.getAttribute('data-mt-q'))); return; }
      var cta = ev.target.closest && ev.target.closest('#mtSampleCta');
      if (cta) {
        var ta = $('mtLtBody');
        if (ta) { try { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} ta.focus(); }
        return;
      }
      var close = ev.target.closest && ev.target.closest('#mtLightbox, #mtLtBox');
      var ph = ev.target.closest && ev.target.closest('[data-mt-photo]');
      if (ph) { openPhoto(Number(ph.getAttribute('data-mt-photo'))); return; }
      var lt = ev.target.closest && ev.target.closest('[data-mt-letter]');
      if (lt) { openLetter(Number(lt.getAttribute('data-mt-letter'))); return; }
      /* 겹쳐 뜬 화면은 바깥이나 닫기 단추를 눌렀을 때만 닫는다 */
      if (close && (ev.target === close || (ev.target.id || '').indexOf('Close') > 0)) closeBoxes();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeBoxes();
    });
  }

  function start() {
    bind();
    renderQuestions();
    paintGoal();
    loadTeacher();
    loadMessages(false);
    loadLetters();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
