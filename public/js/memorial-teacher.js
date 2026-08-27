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

    if (t.photoUrl) {
      var p = $('mtPortrait');
      if (p) p.innerHTML = '<img src="' + esc(t.photoUrl) + '" alt="' + esc(t.name || '') + '" width="132" height="132">';
    }

    var meta = [];
    if (t.schoolRegion) meta.push(esc(t.schoolRegion));
    var span = [t.birthDate ? fmtDate(t.birthDate) : '', t.deathDate ? fmtDate(t.deathDate) : ''].filter(Boolean);
    if (span.length) meta.push(esc(span.join(' — ')));
    var mEl = $('mtMeta');
    if (mEl) mEl.innerHTML = meta.map(function (x) { return '<span>' + x + '</span>'; }).join('');

    if (t.tributeLine) {
      var tr = $('mtTribute');
      if (tr) { tr.textContent = t.tributeLine; show(tr, true); }
    }

    /* 숫자 */
    var c = $('mtCandle'), m2 = $('mtMsg'), l = $('mtLetter');
    if (c) c.textContent = num(t.candleCount);
    if (m2) m2.textContent = num(t.messageCount);
    if (l) l.textContent = num(t.letterCount);
    show($('mtStats'), true);

    /* 소개 */
    if (t.bioHtml && String(t.bioHtml).trim()) {
      var b = $('mtBio');
      if (b) b.innerHTML = t.bioHtml;
      show($('mtBioSec'), true);
    }
    /* 운영자가 정한 제목이 있으면 그것을 쓴다 */
    var copy = t.pageCopy || {};
    setText('mtBioTitle', copy.bioTitle || display.bioLabel);
    setText('mtPhotoTitle', copy.photoTitle);
    setText('mtPhotoDesc', copy.photoDesc);
    setText('mtTimelineTitle', copy.timelineTitle || display.timelineLabel);
    setText('mtLetterTitle', copy.letterTitle);

    /* 순간들 */
    PHOTOS = Array.isArray(t.photos) ? t.photos : [];
    if (PHOTOS.length) {
      renderPhotos();
      show($('mtPhotoSec'), true);
    }

    /* 발자취 */
    if (Array.isArray(t.timeline) && t.timeline.length) {
      renderTimeline(t.timeline);
      show($('mtTimelineSec'), true);
    }

    /* 개별 헌화를 감추도록 설정했으면 그 구간을 숨긴다 */
    if (display.showTeacherOffering === false) show($('mtOfferSec'), false);

    mountHeroSky(t.candleCount);
  }

  function setText(id, v) {
    if (!v) return;
    var el = $(id);
    if (el) el.textContent = v;
  }

  /* ───────── 2. 생전의 순간 ───────── */
  function renderPhotos() {
    var wrap = $('mtPhotos');
    if (!wrap) return;
    wrap.innerHTML = PHOTOS.map(function (p, i) {
      var img = p.url
        ? '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || '') + '" loading="lazy">'
        : '<span class="siren-icon-wrap" data-icon="image" style="opacity:.35"></span>';
      return '<button type="button" class="mt2-photo" data-mt-photo="' + i + '">' +
        '<div class="mt2-photo-img">' + img + '</div>' +
        '<div class="mt2-photo-body">' +
        (p.takenLabel ? '<span class="mt2-photo-when">' + esc(p.takenLabel) + '</span>' : '') +
        '<p class="mt2-photo-cap">' + esc(p.caption || '') + '</p>' +
        (p.detail ? '<span class="mt2-photo-more">이야기 보기 →</span>' : '') +
        '</div></button>';
    }).join('');
    if (window.Icons && Icons.hydrate) { try { Icons.hydrate(wrap); } catch (e) {} }
  }

  function openPhoto(i) {
    var p = PHOTOS[i];
    if (!p) return;
    var box = $('mtLightbox');
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
    if (box) box.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closePhoto() {
    var box = $('mtLightbox');
    if (box) box.classList.remove('on');
    document.body.style.overflow = '';
  }

  /* ───────── 3. 발자취 ───────── */
  function renderTimeline(list) {
    var wrap = $('mtTimeline');
    if (!wrap) return;
    wrap.innerHTML = list.map(function (x) {
      return '<div class="mt2-tl-item">' +
        (x.date ? '<span class="mt2-tl-date">' + esc(x.date) + '</span>' : '') +
        (x.title ? '<h3 class="mt2-tl-title">' + esc(x.title) + '</h3>' : '') +
        (x.desc ? '<p class="mt2-tl-desc">' + esc(x.desc) + '</p>' : '') +
        '</div>';
    }).join('');
  }

  /* ───────── 4. 첫 화면 별 ───────── */
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
    return '<article class="mem2-msg">' +
      '<div class="mem2-msg-head">' +
      '<span class="mem2-msg-name">' + esc(m.authorName || '익명') + '</span>' +
      '<span class="mem2-msg-date">' + esc(fmtDate(m.createdAt)) + '</span>' +
      '</div>' +
      '<p class="mem2-msg-body">' + esc(m.content || '') + '</p>' +
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
      bumpStat('mtCandle');
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
        bumpStat('mtMsg');
        if ($('mtMsgText')) $('mtMsgText').value = '';
        loadMessages(false);
        toast('불빛과 마음을 함께 남겼습니다. 고맙습니다.');
      });
    });
  }

  function bumpStat(id) {
    var el = $(id);
    if (!el) return;
    var v = Number(String(el.textContent).replace(/[^0-9]/g, '')) || 0;
    el.textContent = num(v + 1);
  }

  /* ───────── 6. 편지 ───────── */
  function letterCard(l) {
    return '<article class="mt2-letter">' +
      (l.title ? '<h3 class="mt2-letter-title">' + esc(l.title) + '</h3>' : '') +
      '<p class="mt2-letter-body">' + esc(l.content || '') + '</p>' +
      '<div class="mt2-letter-by">' +
      '<span>' + esc(l.authorName || '익명') + '</span>' +
      '<span>' + esc(fmtDate(l.createdAt)) + '</span>' +
      '</div></article>';
  }

  function loadLetters() {
    if (!TEACHER_ID) return Promise.resolve();
    return api('/api/memorial-letters?teacherId=' + TEACHER_ID).then(function (res) {
      show($('mtLtLoading'), false);
      var letters = unwrap(res, 'letters') || [];
      var wrap = $('mtLetters');
      if (wrap) wrap.innerHTML = letters.map(letterCard).join('');
      show($('mtLtEmpty'), letters.length === 0);
    });
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
      bumpStat('mtLetter');
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

    /* 사진 열기·닫기 */
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-mt-photo]');
      if (btn) { openPhoto(Number(btn.getAttribute('data-mt-photo'))); return; }
      if (ev.target.id === 'mtLightbox' || ev.target.id === 'mtLbClose') closePhoto();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closePhoto();
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
