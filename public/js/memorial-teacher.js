/* =========================================================
   추모관 v2 — 선생님 개별 화면
   ---------------------------------------------------------
   구성
     첫 화면 : 사진 · 이름 · 한 줄 · 숫자 세 개
     소개    : 운영자가 쓴 글
     순간들  : 생전의 사진 (누르면 그날 이야기)
     발자취  : 기록
     마음    : 헌화 + 한마디 (로그인 없이도 됨)
     편지    : 긴 글 (로그인 필요 — 성격이 다르다)
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

  var TEACHER_ID = (function () {
    var m = new URLSearchParams(location.search).get('id');
    return m ? Number(m) : 0;
  })();

  var PHOTOS = [];
  var MSG_PAGE = 1;
  var MSG_CACHE = [];
  var offerType = 'candle';

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
    applyCopy(display.teacherCopy || {});
    applyCopy(copy);

    /* 사진이 있으면 빈 자리를 말하는 문구는 걷어낸다 */
    if (t.photoUrl && !copy.portraitCaption) {
      var fc = $('mtFrameCap');
      if (fc) show(fc, false);
    }

    /* 소개 */
    if (t.bioHtml && String(t.bioHtml).trim()) {
      var b = $('mtBio');
      if (b) b.innerHTML = t.bioHtml;
      show($('mtBioSec'), true);
    }


    /* 순간들 */
    PHOTOS = Array.isArray(t.photos) ? t.photos : [];
    if (PHOTOS.length) {
      renderPhotos();
      show($('mtPhotoSec'), true);
    }

    /* 개별 헌화를 감추도록 설정했으면 그 구간을 숨긴다 */
    if (display.showTeacherOffering === false) show($('mtOfferSec'), false);

    mountHeroSky(t.candleCount);
  }

  /* 문구 자리와 저장 이름을 짝지어 둔다 — 어드민 입력란도 같은 이름을 쓴다 */
  var COPY_MAP = [
    ['mtLeadLine', 'leadLine'],
    ['mtFrameCap', 'portraitCaption'],
    ['mtPhotoTag', 'photoTag'],
    ['mtPhotoTitle', 'photoTitle'],
    ['mtPhotoDesc', 'photoDesc'],
    ['mtLtTag', 'letterTag'],
    ['mtLetterTitle', 'letterTitle'],
    ['mtLtDesc', 'letterDesc'],
    ['mtWriteTag', 'writeTag'],
    ['mtWriteTitle', 'writeTitle'],
    ['mtWriteDesc', 'writeDesc'],
    ['mtOfferTag', 'offerTag'],
    ['mtOfferTitle', 'offerTitle'],
    ['mtOfferDesc', 'offerDesc'],
    ['mtNoteTag', 'noteTag'],
    ['mtNoteTitle', 'noteTitle']
  ];

  function applyCopy(c) {
    if (!c || typeof c !== 'object') return;
    COPY_MAP.forEach(function (pair) { setText(pair[0], c[pair[1]]); });
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

  /* ───────── 5. 한마디 ───────── */
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
    show($('mtMsgLoading'), true);
    return api('/api/memorial-messages?teacherId=' + TEACHER_ID + '&page=' + MSG_PAGE).then(function (res) {
      show($('mtMsgLoading'), false);
      var msgs = unwrap(res, 'messages') || [];
      var pg = unwrap(res, 'pagination') || {};
      MSG_CACHE = append ? MSG_CACHE.concat(msgs) : msgs;
      var list = $('mtMsgs');
      if (list) list.innerHTML = MSG_CACHE.map(msgCard).join('');
      show($('mtMsgEmpty'), MSG_CACHE.length === 0);
      show($('mtMsgMoreWrap'), !!pg.hasMore);
    });
  }

  function submitOffer() {
    var btn = $('mtOfferBtn');
    var nick = ($('mtName2') && $('mtName2').value.trim()) || '';
    var text = ($('mtMsgText') && $('mtMsgText').value.trim()) || '';
    var anon = !!($('mtAnon') && $('mtAnon').checked);
    if (btn) btn.disabled = true;

    api('/api/memorial-offering', {
      method: 'POST',
      body: { type: offerType, teacherId: TEACHER_ID, nickname: anon ? null : (nick || null) }
    }).then(function (res) {
      if (!res.ok) {
        if (btn) btn.disabled = false;
        toast((res.data && res.data.error) || '헌화하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      if (!text) { if (btn) btn.disabled = false; toast('불빛을 밝혔습니다. 고맙습니다.'); return; }

      api('/api/memorial-messages', {
        method: 'POST',
        body: {
          teacherId: TEACHER_ID,
          authorName: anon ? '익명' : (nick || '익명'),
          content: text, isAnonymous: anon
        }
      }).then(function (r2) {
        if (btn) btn.disabled = false;
        if (!r2.ok) {
          toast('불빛은 밝혔습니다. 다만 한마디는 저장하지 못했습니다 — ' +
            ((r2.data && r2.data.error) || '잠시 후 다시 시도해 주세요.'));
          return;
        }
        if ($('mtMsgText')) $('mtMsgText').value = '';
        loadMessages(false);
        toast('불빛과 마음을 함께 남겼습니다. 고맙습니다.');
      });
    });
  }

  /* ───────── 4. 기억의 편지 ───────── */
  var LETTERS = [];
  var LT_SHOWN = 6;          /* 처음에는 여섯 통만 펼쳐 둔다 */

  /* 봉투 겉면에는 앞머리만 살짝 비친다 — 열어봐야 다 읽힌다 */
  function peekOf(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 90 ? t.slice(0, 90) + '…' : t;
  }

  function envelopeCard(l, i) {
    return '<button type="button" class="mt2-env" data-mt-letter="' + i + '">' +
      '<h3 class="mt2-env-title">' + esc(l.title || '제목 없는 편지') + '</h3>' +
      '<p class="mt2-env-peek">' + esc(peekOf(l.content)) + '</p>' +
      '<div class="mt2-env-foot">' +
      '<span>' + esc(l.authorName || '익명') + '</span>' +
      '<span class="mt2-env-open">열어보기 →</span>' +
      '</div></button>';
  }

  function renderLetters() {
    var wrap = $('mtLetters');
    if (!wrap) return;
    wrap.innerHTML = LETTERS.slice(0, LT_SHOWN).map(envelopeCard).join('');
    show($('mtLtEmpty'), LETTERS.length === 0);
    show($('mtLtMoreWrap'), LETTERS.length > LT_SHOWN);
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
    setBox('mtLtBoxTo', '선생님께');
    setBox('mtLtBoxWhen', fmtDate(l.createdAt));
    setBox('mtLtBoxTitle', l.title || '제목 없는 편지');
    setBox('mtLtBoxBody', l.content || '');
    setBox('mtLtBoxFrom', (l.authorName || '익명') + ' 드림');
    openBox('mtLtBox');
  }
  function setBox(id, v) {
    var el = $(id);
    if (el) el.textContent = v || '';
  }

  function submitLetter() {
    var btn = $('mtLtSubmit');
    var title = ($('mtLtTitle') && $('mtLtTitle').value.trim()) || '';
    var body = ($('mtLtBody') && $('mtLtBody').value.trim()) || '';
    var anon = !!($('mtLtAnon') && $('mtLtAnon').checked);
    if (!body) { toast('편지 내용을 적어주세요.'); if ($('mtLtBody')) $('mtLtBody').focus(); return; }
    if (btn) btn.disabled = true;

    api('/api/memorial-letters', {
      method: 'POST',
      body: { teacherId: TEACHER_ID, title: title || null, content: body, isAnonymous: anon }
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok) {
        if (res.status === 401) {
          toast('편지는 로그인 후 보내실 수 있습니다.');
          if (window.SIREN && window.SIREN.openModal) window.SIREN.openModal('loginModal');
          return;
        }
        toast((res.data && res.data.error) || '편지를 보내지 못했습니다.');
        return;
      }
      if ($('mtLtTitle')) $('mtLtTitle').value = '';
      if ($('mtLtBody')) $('mtLtBody').value = '';
      loadLetters();
      toast('편지가 도착했습니다. 고맙습니다.');
    });
  }

  /* ───────── 시작 ───────── */
  function bind() {
    var types = $('mtOfferTypes');
    if (types) types.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.mt2-offer');
      if (!b) return;
      offerType = b.dataset.type || 'candle';
      Array.prototype.forEach.call(types.querySelectorAll('.mt2-offer'), function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
    });

    var ob = $('mtOfferBtn'); if (ob) ob.addEventListener('click', submitOffer);
    var lb = $('mtLtSubmit'); if (lb) lb.addEventListener('click', submitLetter);
    var more = $('mtMsgMore'); if (more) more.addEventListener('click', function () { MSG_PAGE++; loadMessages(true); });
    var ltMore = $('mtLtMore');
    if (ltMore) ltMore.addEventListener('click', function () { LT_SHOWN += 6; renderLetters(); });

    /* 사진·편지 열기 · 닫기 */
    document.addEventListener('click', function (ev) {
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
    loadTeacher();
    loadMessages(false);
    loadLetters();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
