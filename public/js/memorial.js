/* =========================================================
   온라인 추모관 — 통합 추모 본체 (memorial.html)
   카운터 · 헌화(촛불/국화) · 선생님 그리드 · 통합 방명록
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
  function toast(msg) {
    if (window.SIREN && typeof window.SIREN.toast === 'function') window.SIREN.toast(msg);
    else console.log('[추모관]', msg);
  }
  function isLoggedIn() {
    return !!(window.SIREN_AUTH && window.SIREN_AUTH.user);
  }
  function promptLogin(msg) {
    toast(msg || '로그인 후 이용하실 수 있습니다.');
    if (window.SIREN && typeof window.SIREN.openModal === 'function') {
      setTimeout(function () { window.SIREN.openModal('loginModal'); }, 300);
    }
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  /* ───────── ① 카운터 (count-up) ───────── */
  var _counterTargets = { people: 0, candles: 0, messages: 0 };
  var _countUpDone = false;

  function setCounterTargets(c) {
    _counterTargets.people = Number(c.people) || 0;
    /* 합산 표시: 촛불 카운트 칸에 촛불+국화 총합 (서버 candles 키가 이미 합산이면 그대로) */
    _counterTargets.candles = Number(c.candles) || 0;
    _counterTargets.messages = Number(c.messages) || 0;
  }
  function animateCount(el, target) {
    if (!el) return;
    var start = 0, dur = 1400, t0 = null;
    function frame(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * eased).toLocaleString('ko-KR');
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function runCountUp() {
    if (_countUpDone) return;
    _countUpDone = true;
    animateCount(document.getElementById('cntPeople'), _counterTargets.people);
    animateCount(document.getElementById('cntCandles'), _counterTargets.candles);
    animateCount(document.getElementById('cntMessages'), _counterTargets.messages);
  }
  function watchCounter() {
    var sec = document.getElementById('memCounterSection');
    if (!sec) return;
    if (!('IntersectionObserver' in window)) { runCountUp(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { runCountUp(); io.disconnect(); } });
    }, { threshold: 0.35 });
    io.observe(sec);
  }
  function bumpCandle(delta) {
    _counterTargets.candles += delta;
    var el = document.getElementById('cntCandles');
    if (el && _countUpDone) el.textContent = _counterTargets.candles.toLocaleString('ko-KR');
  }
  function bumpMessages(delta) {
    _counterTargets.messages += delta;
    var el = document.getElementById('cntMessages');
    if (el && _countUpDone) el.textContent = _counterTargets.messages.toLocaleString('ko-KR');
  }

  /* ───────── ② 히어로 영상 (YouTube IFrame API + BGM 페이드 연동) ───────── */
  var _heroPlayer = null;
  function setupHero(hero) {
    var copyEl = document.getElementById('memHeroCopy');
    if (copyEl && hero && hero.copy) copyEl.textContent = hero.copy;

    var yid = hero && hero.youtubeId;
    var wrap = document.getElementById('memHeroVideoWrap');
    if (!yid || !wrap) return;
    wrap.style.display = '';

    function plainIframe() {
      if (_heroPlayer) return;
      var mount = document.getElementById('memHeroPlayer');
      if (!mount) return;
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube.com/embed/' + encodeURIComponent(yid) + '?rel=0';
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      mount.parentNode.replaceChild(f, mount);
      _heroPlayer = 'plain';
    }
    function createPlayer() {
      try {
        _heroPlayer = new window.YT.Player('memHeroPlayer', {
          videoId: yid,
          playerVars: { rel: 0, playsinline: 1 },
          events: {
            onStateChange: function (ev) {
              var S = window.YT.PlayerState;
              if (ev.data === S.PLAYING) {
                if (window.MemorialBGM) window.MemorialBGM.duckForVideo();
              } else if (ev.data === S.ENDED || ev.data === S.PAUSED) {
                if (window.MemorialBGM) window.MemorialBGM.unduckAfterVideo();
              }
            }
          }
        });
      } catch (e) { plainIframe(); }
    }

    if (window.YT && window.YT.Player) { createPlayer(); return; }

    if (!document.getElementById('yt-iframe-api')) {
      var s = document.createElement('script');
      s.id = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') { try { prev(); } catch (e) {} }
      createPlayer();
    };
    /* API 미로드 폴백 */
    setTimeout(function () { if (!_heroPlayer) plainIframe(); }, 4000);
  }

  /* ───────── 요약(summary) 로드 ───────── */
  function loadSummary() {
    api('/api/memorial-summary').then(function (res) {
      var c = res.ok ? (unwrap(res, 'counters') || {}) : {};
      var hero = res.ok ? (unwrap(res, 'hero') || {}) : {};
      setCounterTargets(c);
      setupHero(hero);
      watchCounter();
    }).catch(function () {
      setCounterTargets({});
      watchCounter();
    });
  }

  /* ───────── ③ 헌화 ───────── */
  var _offerType = 'candle';
  function setupOffering() {
    var typesWrap = document.getElementById('memOfferTypes');
    var btn = document.getElementById('memOfferBtn');
    if (!typesWrap || !btn) return;

    typesWrap.addEventListener('click', function (e) {
      var card = e.target.closest('.mem-offer-type');
      if (!card) return;
      _offerType = card.dataset.type || 'candle';
      Array.prototype.forEach.call(typesWrap.querySelectorAll('.mem-offer-type'), function (el) {
        el.classList.toggle('sel', el === card);
      });
      btn.textContent = (_offerType === 'flower' ? '헌화하기' : '헌화하기');
    });

    btn.addEventListener('click', function () {
      var nick = (document.getElementById('memOfferNick').value || '').trim();
      btn.disabled = true;
      var emoji = _offerType === 'flower' ? '' : '';
      floatOffering(emoji);

      api('/api/memorial-offering', {
        method: 'POST',
        body: { type: _offerType, nickname: nick || null }
      }).then(function (res) {
        btn.disabled = false;
        if (res.ok) {
          /* ★ R41 Q2-014: 응답 total은 통합(teacher_id IS NULL) 범위만의 합계라,
             전체 합계 카운터를 덮어쓰면 숫자가 급감한다 → 1만 증가시킨다 */
          bumpCandle(1);
          toast('헌화해 주셔서 감사합니다.');
        } else {
          /* 백엔드 연결 전(mock) — 화면만 반영 */
          bumpCandle(1);
          toast('헌화해 주셔서 감사합니다.');
        }
      }).catch(function () {
        btn.disabled = false;
        bumpCandle(1);
        toast('헌화해 주셔서 감사합니다.');
      });
    });
  }
  function floatOffering(emoji) {
    var layer = document.getElementById('memFloatLayer');
    if (!layer) return;
    var n = document.createElement('div');
    n.className = 'mem-float';
    n.textContent = emoji;
    n.style.left = (8 + Math.random() * 84) + '%';
    layer.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 3600);
  }

  /* ───────── ④ 선생님 그리드 ───────── */
  function teacherCard(t) {
    var a = document.createElement('a');
    a.className = 'mem-card';
    a.href = '/memorial-teacher.html?id=' + encodeURIComponent(t.id);
    var photo = t.photoUrl
      ? '<img src="' + esc(t.photoUrl) + '" alt="' + esc(t.name) + '" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<div class="silhouette"></div>';
    a.innerHTML =
      '<div class="mem-card-photo">' + photo + '</div>' +
      '<div class="mem-card-body">' +
        '<h3 class="mem-card-name">' + esc(t.name) + '</h3>' +
        '<p class="mem-card-region">' + esc(t.schoolRegion || '') + '</p>' +
        '<p class="mem-card-tribute">' + esc(t.tributeLine || '') + '</p>' +
        '<div class="mem-card-meta"><span>' + (Number(t.candleCount) || 0) + '</span>' +
        '<span>' + (Number(t.messageCount) || 0) + '</span></div>' +
      '</div>';
    return a;
  }
  function renderTeachers(list) {
    var grid = document.getElementById('memTeacherGrid');
    var empty = document.getElementById('memTeacherEmpty');
    var loading = document.getElementById('memTeacherLoading');
    if (loading) loading.style.display = 'none';
    if (!list || !list.length) { if (empty) empty.style.display = ''; return; }
    grid.innerHTML = '';
    list.forEach(function (t) { grid.appendChild(teacherCard(t)); });
    grid.style.display = '';
  }
  function loadTeachers() {
    api('/api/memorial-teachers').then(function (res) {
      renderTeachers(res.ok ? (unwrap(res, 'teachers') || []) : []);
    }).catch(function () { renderTeachers([]); });
  }

  /* ───────── ⑤ 통합 방명록 ───────── */
  var _msgPage = 0;
  var _msgLoading = false;

  function msgEl(m) {
    var wrap = document.createElement('div');
    wrap.className = 'mem-msg';
    wrap.dataset.id = m.id;
    wrap.innerHTML =
      '<div class="mem-msg-head">' +
        '<span class="mem-msg-author">' + esc(m.authorName || '익명') + '</span>' +
        '<span class="mem-msg-date">' + fmtDate(m.createdAt) + '</span>' +
      '</div>' +
      '<div class="mem-msg-body">' + esc(m.content) + '</div>' +
      '<div class="mem-msg-actions">' +
        '<button type="button" class="act-like' + (m.liked ? ' liked' : '') + '">♡ <span class="lc">' + (Number(m.likeCount) || 0) + '</span></button>' +
        '<button type="button" class="act-report">신고</button>' +
      '</div>';
    wrap.querySelector('.act-like').addEventListener('click', function () { likeMsg(m.id, wrap); });
    wrap.querySelector('.act-report').addEventListener('click', function () { reportMsg(m.id); });
    return wrap;
  }
  function renderMessages(list, append) {
    var listEl = document.getElementById('memMsgList');
    var empty = document.getElementById('memMsgEmpty');
    var loading = document.getElementById('memMsgLoading');
    if (loading) loading.style.display = 'none';
    if (!append) listEl.innerHTML = '';
    if ((!list || !list.length) && !append && !listEl.children.length) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    (list || []).forEach(function (m) { listEl.appendChild(msgEl(m)); });
  }
  function loadMessages(append) {
    if (_msgLoading) return;
    _msgLoading = true;
    var nextPage = append ? _msgPage + 1 : 1;
    api('/api/memorial-messages?page=' + nextPage).then(function (res) {
      _msgLoading = false;
      if (!res.ok) {
        if (!append) renderMessages([], false);
        return;
      }
      _msgPage = nextPage;
      var list = unwrap(res, 'messages') || [];
      var pg = unwrap(res, 'pagination') || {};
      renderMessages(list, append);
      var moreWrap = document.getElementById('memMsgMoreWrap');
      if (moreWrap) moreWrap.style.display = pg.hasMore ? '' : 'none';
    }).catch(function () {
      _msgLoading = false;
      if (!append) renderMessages([], false);
    });
  }
  function likeMsg(id, wrap) {
    if (!isLoggedIn()) { promptLogin('공감은 로그인 후 가능합니다.'); return; }
    api('/api/memorial-messages?action=like&id=' + id, { method: 'POST' }).then(function (res) {
      if (!res.ok) { toast((res.data && res.data.error) || '처리 실패'); return; }
      var likeCount = unwrap(res, 'likeCount');
      var liked = unwrap(res, 'liked');
      var btn = wrap.querySelector('.act-like');
      if (typeof likeCount === 'number') wrap.querySelector('.lc').textContent = likeCount;
      if (btn) btn.classList.toggle('liked', !!liked);
    }).catch(function () { toast('처리 실패'); });
  }
  function reportMsg(id) {
    if (!confirm('이 글을 신고하시겠습니까? 운영자가 검토합니다.')) return;
    api('/api/memorial-messages?action=report&id=' + id, { method: 'POST' }).then(function (res) {
      toast(res.ok ? '신고가 접수되었습니다.' : ((res.data && res.data.error) || '신고 실패'));
    }).catch(function () { toast('신고 실패'); });
  }
  function setupMessageForm() {
    var btn = document.getElementById('memMsgSubmit');
    var more = document.getElementById('memMsgMore');
    if (more) more.addEventListener('click', function () { loadMessages(true); });
    if (!btn) return;
    btn.addEventListener('click', function () {
      var content = (document.getElementById('memMsgContent').value || '').trim();
      if (!content) { toast('내용을 입력해 주세요.'); return; }
      if (!isLoggedIn()) { promptLogin('추모 글 작성은 로그인 후 가능합니다.'); return; }
      var anon = document.getElementById('memMsgAnon').checked;
      btn.disabled = true;
      api('/api/memorial-messages', { method: 'POST', body: { content: content, isAnonymous: anon } })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok) {
            if (res.status === 401) { promptLogin('추모 글 작성은 로그인 후 가능합니다.'); return; }
            toast((res.data && res.data.error) || '작성 실패');
            return;
          }
          var msg = unwrap(res, 'message');
          document.getElementById('memMsgContent').value = '';
          document.getElementById('memMsgAnon').checked = false;
          var empty = document.getElementById('memMsgEmpty');
          if (empty) empty.style.display = 'none';
          if (msg) {
            var listEl = document.getElementById('memMsgList');
            listEl.insertBefore(msgEl(msg), listEl.firstChild);
          } else { loadMessages(false); }
          bumpMessages(1);
          toast('추모의 글이 등록되었습니다.');
        }).catch(function () { btn.disabled = false; toast('작성 실패'); });
    });
  }

  /* ───────── 초기화 ───────── */
  function init() {
    loadSummary();
    loadTeachers();
    loadMessages(false);
    setupOffering();
    setupMessageForm();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
