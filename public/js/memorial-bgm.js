/* =========================================================
   온라인 추모관 — BGM 멀티트랙 플레이어 (공통)
   - 우상단 고정 토글(소리 아이콘 · «추모 음악 켜기/끄기»)
   - 음소거 상태로 시작 (브라우저 자동재생 정책) · 클릭 시 재생
   - localStorage('memorial_bgm_muted') 로 설정 기억
   - 트랙 순환(한 곡 끝나면 다음 곡) — 음원 파일과 유튜브가 섞여 있어도 순서대로
   - 영상(히어로·개별) 재생 시 음원은 페이드아웃 → 종료 시 페이드인 / 유튜브는 멈춤 → 재개
   - 데이터 절약 모드면 자동 음소거
   - 트랙 목록은 /api/memorial-summary 의 bgmTracks (어드민 관리)

   ★ 2026-11-12 유튜브 주소 재생 (YouTube IFrame Player API)
   - 유튜브 정책상 플레이어를 숨기거나 소리만 재생하지 않는다.
     음악을 켜면 오른쪽 아래에 «보이는 작은 재생 창»(200px 이상 · 곡 제목 한 줄 · 닫기 = 끄기)을 띄우고,
     끄면 멈추고 감춘다. 창이 닫힌 채 재생이 시작되면 즉시 멈춘다(안전장치).
   - 끼워넣기 금지(오류 101·150)·없는 영상 등 재생할 수 없는 트랙은 건너뛰고, 전부 안 되면 단추를 숨긴다.
   - 유튜브 스크립트는 유튜브 트랙이 있을 때만, 단추를 누르려는 순간(또는 «켜짐»이 저장돼 있으면 한가할 때) 불러온다.
   - 처음 들어왔을 때 «켜짐»이 저장돼 있어도 유튜브는 사용자가 누르기 전에는 소리를 내지 않는다.
   - 트랙 주소 판별 규칙은 lib/memorial-bgm.ts · public/js/admin-memorial.js 와 같다(바꾸면 세 곳 함께).
   ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'memorial_bgm_muted';
  var FADE_MS = 1100;
  var TARGET_VOLUME = 0.4;
  var YT_API_SRC = 'https://www.youtube.com/iframe_api';
  var YT_API_TIMEOUT_MS = 20000;    /* 재생을 눌렀는데 유튜브 스크립트가 이 시간 안에 준비되지 않으면 유튜브 트랙을 건너뛴다 */
  var YT_READY_TIMEOUT_MS = 20000;  /* 재생 창이 이 시간 안에 준비되지 않으면(유튜브 차단 등) 유튜브 트랙을 건너뛴다 */
  var YT_HINT_MS = 4000;            /* 재생을 요청하고 이 시간이 지나도 시작되지 않으면(자동재생 차단) 안내를 보인다 */

  var tracks = [];       /* [{ title, url, kind: 'audio'|'youtube', videoId, bad }] */
  var trackIndex = 0;
  var audio = null;
  var toggleBtn = null;
  var muted = true;      /* 음소거로 시작 */
  var ducked = false;    /* 영상 재생으로 줄여 둔(멈춘) 상태 */
  var fadeTimer = null;

  /* 음원 파일 */
  var audioSrcIndex = -1;    /* <audio>에 지금 걸린 트랙 번호 */
  var audioPlayedOk = false; /* 지금 걸린 주소로 재생이 한 번이라도 시작됐는지 */
  var audioRetryAt = 0;      /* 재생 중 끊김(임시 주소 만료 등)으로 다시 부른 시각 */

  /* 유튜브 */
  var ytApiState = 'idle';   /* idle | loading | ready | failed */
  var ytApiTimer = null;
  var ytPlayer = null;
  var ytReady = false;
  var ytReadyTimer = null;
  var ytVideoId = null;      /* 재생 창에 지금 걸린 영상 번호 */
  var ytPausedByDuck = false;
  var ytHintTimer = null;
  var ytBox = null, ytTitleEl = null, ytFrame = null, ytHintEl = null;

  /* ── 트랙 주소 판별 (lib/memorial-bgm.ts 와 같은 규칙) ── */
  var YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var YT_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];
  var AUDIO_EXT = { mp3: 1, m4a: 1, mp4: 1, aac: 1, ogg: 1, oga: 1, wav: 1 };

  function fileExtOf(name) {
    var m = /\.([a-z0-9]{1,8})$/i.exec(String(name || '').trim());
    return m ? m[1].toLowerCase() : '';
  }

  /* 유튜브 주소 → 영상 번호(11자). list= 같은 다른 매개변수는 무시한다 */
  function parseYouTubeId(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s) && /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(s)) {
      s = 'https://' + s;
    }
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    var host = u.hostname.toLowerCase().replace(/^www\./, '');
    var id = '';
    if (host === 'youtu.be') {
      id = u.pathname.split('/')[1] || '';
    } else if (YT_HOSTS.indexOf(host) >= 0) {
      if (/^\/watch\/?$/.test(u.pathname)) id = u.searchParams.get('v') || '';
      else {
        var m = /^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/.exec(u.pathname);
        if (m) id = m[1];
      }
    }
    return YT_ID_RE.test(id) ? id : null;
  }

  /* 'audio'(음원 파일) | 'youtube' | 'invalid'(재생할 수 없는 주소) | 'empty' */
  function classifyUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return 'empty';
    if (s.length > 2000) return 'invalid';
    if (parseYouTubeId(s)) return 'youtube';
    var isRootPath = /^\/(?!\/)/.test(s);
    var isAbsolute = /^https?:\/\//i.test(s);
    if (!isRootPath && !isAbsolute) return 'invalid';
    var u;
    try { u = new URL(s, 'https://tbfa.co.kr'); } catch (e) { return 'invalid'; }
    var host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (isAbsolute && (host === 'youtu.be' || YT_HOSTS.indexOf(host) >= 0)) return 'invalid';
    if (u.pathname === '/api/blob-image' && /^\d+$/.test(u.searchParams.get('id') || '')) return 'audio';
    if (AUDIO_EXT[fileExtOf(u.pathname)]) return 'audio';
    return 'invalid';
  }

  function toTracks(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      if (!x || !x.url) return;
      var url = String(x.url).trim();
      var kind = classifyUrl(url);
      if (kind !== 'audio' && kind !== 'youtube') return;   /* 재생할 수 없는 주소는 처음부터 뺀다 */
      out.push({
        title: String(x.title || '').trim() || '추모 음악',
        url: url,
        kind: kind,
        videoId: kind === 'youtube' ? parseYouTubeId(url) : null,
        bad: false
      });
    });
    return out;
  }

  /* ── 설정 기억 ── */
  function savedMuted() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === null) return true;     /* 기본 음소거 */
      return v === '1';
    } catch (e) { return true; }
  }
  function persistMuted(m) {
    try { localStorage.setItem(STORAGE_KEY, m ? '1' : '0'); } catch (e) {}
  }

  function dataSaverOn() {
    try {
      var c = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
      return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
    } catch (e) { return false; }
  }

  /* ── 트랙 순서 ── */
  function current() { return tracks[trackIndex] || null; }
  function playableCount() {
    var n = 0;
    for (var i = 0; i < tracks.length; i++) if (!tracks[i].bad) n++;
    return n;
  }
  function hasYouTube() {
    for (var i = 0; i < tracks.length; i++) if (tracks[i].kind === 'youtube' && !tracks[i].bad) return true;
    return false;
  }
  /* from 다음부터 한 바퀴 돌며 재생할 수 있는 트랙 번호 (트랙이 하나면 자기 자신 = 반복) */
  function nextPlayable(from) {
    var n = tracks.length;
    for (var step = 1; step <= n; step++) {
      var i = (((from + step) % n) + n) % n;
      if (!tracks[i].bad) return i;
    }
    return -1;
  }

  function startCurrent() {
    if (muted) return;
    var t = current();
    if (!t || t.bad) {
      var i = nextPlayable(trackIndex);
      if (i < 0) { noPlayable(); return; }
      trackIndex = i;
      t = current();
    }
    if (t.kind === 'youtube') { stopAudio(); playYouTube(t); }
    else { stopYouTube(); playAudio(t); }
  }

  function advance() {
    var i = nextPlayable(trackIndex);
    if (i < 0) { noPlayable(); return; }
    trackIndex = i;
    if (!muted) startCurrent();
  }

  /* 재생할 수 없는 트랙 → 건너뛰기. 하나도 남지 않으면 단추를 숨긴다 */
  function markBad(idx) {
    var t = tracks[idx];
    if (!t || t.bad) return;
    t.bad = true;
    if (!playableCount()) { noPlayable(); return; }
    if (idx === trackIndex) advance();
  }

  function failAllYouTube() {
    var cur = current();
    var wasYouTube = !!(cur && cur.kind === 'youtube');
    for (var i = 0; i < tracks.length; i++) if (tracks[i].kind === 'youtube') tracks[i].bad = true;
    if (!playableCount()) { noPlayable(); return; }
    if (wasYouTube) { stopYouTube(); advance(); }
  }

  function noPlayable() {
    stopAudio();
    stopYouTube();
    hideToggle();
  }

  /* ── 음원 파일 (<audio>) ── */
  function clearFade() { if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; } }

  function fadeTo(target, onDone) {
    if (!audio) return;
    clearFade();
    var steps = Math.max(1, Math.round(FADE_MS / 50));
    var step = (target - audio.volume) / steps;
    fadeTimer = setInterval(function () {
      if (!audio) { clearFade(); return; }
      var v = audio.volume + step;
      var reached = (step >= 0 && v >= target) || (step <= 0 && v <= target);
      if (reached || step === 0) {
        audio.volume = Math.max(0, Math.min(1, target));
        clearFade();
        if (onDone) onDone();
        return;
      }
      audio.volume = Math.max(0, Math.min(1, v));
    }, 50);
  }

  function stopAudio() {
    clearFade();
    if (audio && !audio.paused) audio.pause();
  }

  function playAudio(t) {
    if (!audio || !t) return;
    if (audioSrcIndex !== trackIndex) {
      audioSrcIndex = trackIndex;
      audioPlayedOk = false;
      audioRetryAt = 0;
      audio.src = t.url;
    }
    clearFade();
    audio.volume = ducked ? 0 : TARGET_VOLUME;
    var p;
    try { p = audio.play(); } catch (e) { p = null; }
    if (p && p.catch) p.catch(function (err) {
      /* 자동재생 차단 → 단추를 «켜기»로 되돌린다(저장된 설정은 그대로 · 다음에 누르면 재생).
         주소 오류 등은 'error' 이벤트에서 건너뛴다. */
      if (err && err.name === 'NotAllowedError') setMuted(true, false);
    });
  }

  function onAudioError() {
    var idx = audioSrcIndex;
    var t = tracks[idx];
    if (!audio || !t || t.kind !== 'audio' || !audio.getAttribute('src')) return;
    var code = audio.error ? audio.error.code : 0;
    /* 재생되던 곡이 중간에 끊김(올린 파일의 임시 주소 만료 등 네트워크 오류) → 한 번 다시 불러 그 자리부터 잇는다 */
    if (audioPlayedOk && code === 2 && (Date.now() - audioRetryAt) > 60000) {
      audioRetryAt = Date.now();
      audioPlayedOk = false;
      var pos = audio.currentTime || 0;
      var seekBack = function () {
        audio.removeEventListener('loadedmetadata', seekBack);
        try { if (pos > 0) audio.currentTime = pos; } catch (e) {}
      };
      audio.addEventListener('loadedmetadata', seekBack);
      audio.src = t.url;
      if (!muted && idx === trackIndex && current() && current().kind === 'audio') playAudio(t);
      return;
    }
    markBad(idx);
  }

  /* ── 유튜브 작은 재생 창 ── */
  function buildYtBox() {
    if (ytBox) return;
    ytBox = document.createElement('div');
    ytBox.id = 'memorialBgmYt';
    ytBox.className = 'memorial-bgm-yt';
    ytBox.setAttribute('role', 'region');
    ytBox.setAttribute('aria-label', '추모 음악 재생 창');

    var head = document.createElement('div');
    head.className = 'memorial-bgm-yt-head';
    ytTitleEl = document.createElement('span');
    ytTitleEl.className = 'memorial-bgm-yt-title';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'memorial-bgm-yt-close';
    close.setAttribute('aria-label', '추모 음악 끄기');
    close.title = '추모 음악 끄기';
    close.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" aria-hidden="true" focusable="false"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    close.addEventListener('click', function () { setMuted(true, true); });   /* 닫기 = 끄기 */
    head.appendChild(ytTitleEl);
    head.appendChild(close);

    ytFrame = document.createElement('div');
    ytFrame.className = 'memorial-bgm-yt-frame';
    var loading = document.createElement('span');
    loading.className = 'memorial-bgm-yt-loading';
    loading.textContent = '재생 창을 불러오는 중…';
    ytFrame.appendChild(loading);

    ytHintEl = document.createElement('div');
    ytHintEl.className = 'memorial-bgm-yt-hint';
    ytHintEl.textContent = '소리가 나지 않으면 재생 창 가운데의 재생 단추를 눌러 주세요.';

    ytBox.appendChild(head);
    ytBox.appendChild(ytFrame);
    ytBox.appendChild(ytHintEl);
    document.body.appendChild(ytBox);
  }

  function boxOpen() { return !!(ytBox && ytBox.classList.contains('open')); }

  /* 아래쪽에 뜨는 «앱으로 설치하기» 안내(pwa.js · 맨 위 층)가 재생 창을 가리면 유튜브 정책 위반이 되므로,
     둘이 겹칠 때는 재생 창을 안내 위로 올린다(안내의 설치·닫기 단추도 가리지 않게). */
  var ytLayoutObserver = null;
  function positionYtBox() {
    if (!ytBox) return;
    var lift = 0;
    try {
      var b = document.getElementById('siren-pwa-banner');
      if (b && boxOpen() && /pwa-bottom/.test(b.className)) {
        var r = b.getBoundingClientRect();
        var boxLeft = window.innerWidth - ytBox.offsetWidth - 18;
        if (r.height > 0 && r.right > boxLeft) lift = Math.max(0, Math.round(window.innerHeight - r.top)) + 10;
      }
    } catch (e) { lift = 0; }
    ytBox.style.bottom = lift ? lift + 'px' : '';
  }
  function relayoutYtBox() {
    positionYtBox();
    setTimeout(positionYtBox, 400);   /* 안내가 아래에서 올라오는 움직임(0.3초)이 끝난 뒤 한 번 더 */
  }
  function watchLayout(on) {
    if (on) {
      if (!ytLayoutObserver && window.MutationObserver) {
        ytLayoutObserver = new MutationObserver(relayoutYtBox);
        ytLayoutObserver.observe(document.body, { childList: true });
        window.addEventListener('resize', positionYtBox);
      }
      relayoutYtBox();
    } else {
      if (ytLayoutObserver) {
        ytLayoutObserver.disconnect();
        ytLayoutObserver = null;
        window.removeEventListener('resize', positionYtBox);
      }
      if (ytBox) ytBox.style.bottom = '';
    }
  }

  function showYtBox(t) {
    buildYtBox();
    var title = (t && t.title) || '추모 음악';
    ytTitleEl.textContent = title;
    ytTitleEl.title = title;
    ytBox.classList.add('open');
    document.body.classList.add('memorial-bgm-yt-open');
    watchLayout(true);
  }

  function hideYtBox() {
    hideHint();
    if (!ytBox) return;
    ytBox.classList.remove('open');
    document.body.classList.remove('memorial-bgm-yt-open');
    watchLayout(false);
  }

  function showHint() { if (ytHintEl) ytHintEl.classList.add('on'); }
  function hideHint() {
    if (ytHintTimer) { clearTimeout(ytHintTimer); ytHintTimer = null; }
    if (ytHintEl) ytHintEl.classList.remove('on');
  }
  function armHint() {
    hideHint();
    ytHintTimer = setTimeout(function () {
      ytHintTimer = null;
      var st = ytState();
      if (!muted && !ducked && boxOpen() && st !== 1 && st !== 3) showHint();
    }, YT_HINT_MS);
  }

  function ytState() {
    try { return (ytPlayer && ytReady && ytPlayer.getPlayerState) ? ytPlayer.getPlayerState() : null; }
    catch (e) { return null; }
  }

  function ytApiAvailable() { return !!(window.YT && typeof window.YT.Player === 'function'); }

  /* 유튜브 스크립트 불러오기 — 유튜브 트랙이 있을 때만, 한 번만 */
  function loadYtApi() {
    if (ytApiState !== 'idle' || !hasYouTube()) return;
    if (ytApiAvailable()) { ytApiState = 'ready'; return; }
    ytApiState = 'loading';
    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') { try { prev(); } catch (e) {} }
      onYtApiReady();
    };
    var s = document.createElement('script');
    s.src = YT_API_SRC;
    s.async = true;
    s.onerror = function () { onYtApiFailed(); };
    (document.head || document.body).appendChild(s);
  }

  function idleLoadYtApi() {
    var run = function () { loadYtApi(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 3000);
  }

  function onYtApiReady() {
    if (ytApiState === 'ready' || ytApiState === 'failed') return;
    if (ytApiTimer) { clearTimeout(ytApiTimer); ytApiTimer = null; }
    ytApiState = 'ready';
    var t = current();
    if (!muted && t && t.kind === 'youtube' && !t.bad && boxOpen()) ensureYtPlaying(t);
  }

  function onYtApiFailed() {
    if (ytApiState === 'ready' || ytApiState === 'failed') return;
    if (ytApiTimer) { clearTimeout(ytApiTimer); ytApiTimer = null; }
    ytApiState = 'failed';
    failAllYouTube();   /* 유튜브에 닿지 못함(차단·네트워크) → 유튜브 트랙 모두 건너뛰기 */
  }

  function playYouTube(t) {
    showYtBox(t);       /* 유튜브 정책 — 보이는 재생 창과 함께만 재생한다 */
    if (ytApiState === 'failed') { failAllYouTube(); return; }
    if (ytApiState === 'idle') loadYtApi();
    if (ytApiState !== 'ready') {
      if (!ytApiTimer) {
        ytApiTimer = setTimeout(function () {
          ytApiTimer = null;
          if (ytApiState === 'loading') onYtApiFailed();
        }, YT_API_TIMEOUT_MS);
      }
      return;           /* 준비되면 onYtApiReady 가 이어서 재생 */
    }
    ensureYtPlaying(t);
  }

  function ensureYtPlaying(t) {
    if (!ytPlayer) { createYtPlayer(t); return; }   /* 준비되면 onYtReady 가 재생 */
    if (!ytReady) return;
    try {
      if (ytVideoId !== t.videoId || ytState() === 0) {
        ytVideoId = t.videoId;
        if (ducked) { ytPausedByDuck = true; ytPlayer.cueVideoById(t.videoId); }
        else ytPlayer.loadVideoById(t.videoId);
      } else if (ducked) {
        ytPausedByDuck = true;
      } else {
        ytPlayer.playVideo();
      }
    } catch (e) { /* 재생 창 오류는 onError 로 들어온다 */ }
    if (!ducked) armHint();
  }

  function createYtPlayer(t) {
    buildYtBox();
    var old = document.getElementById('memorialBgmYtPlayer');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var host = document.createElement('div');
    host.id = 'memorialBgmYtPlayer';
    ytFrame.appendChild(host);
    ytVideoId = t.videoId;
    ytReady = false;
    try {
      ytPlayer = new window.YT.Player(host, {
        width: 320,
        height: 200,
        videoId: t.videoId,
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, iv_load_policy: 3, origin: window.location.origin },
        events: { onReady: onYtReady, onStateChange: onYtStateChange, onError: onYtError }
      });
    } catch (e) {
      ytPlayer = null;
      failAllYouTube();
      return;
    }
    if (ytReadyTimer) clearTimeout(ytReadyTimer);
    ytReadyTimer = setTimeout(function () {
      ytReadyTimer = null;
      if (ytReady) return;
      /* 재생 창이 뜨지 않음(유튜브 차단 등) → 유튜브 트랙 모두 건너뛰기 */
      try { if (ytPlayer && ytPlayer.destroy) ytPlayer.destroy(); } catch (e) {}
      ytPlayer = null;
      ytVideoId = null;
      failAllYouTube();
    }, YT_READY_TIMEOUT_MS);
  }

  function onYtReady() {
    ytReady = true;
    if (ytReadyTimer) { clearTimeout(ytReadyTimer); ytReadyTimer = null; }
    try { ytPlayer.setVolume(Math.round(TARGET_VOLUME * 100)); } catch (e) {}
    var t = current();
    if (muted || !t || t.kind !== 'youtube' || t.bad || !boxOpen()) return;
    try {
      if (ytVideoId !== t.videoId) {
        ytVideoId = t.videoId;
        if (ducked) ytPlayer.cueVideoById(t.videoId);
        else ytPlayer.loadVideoById(t.videoId);
      } else if (!ducked) {
        ytPlayer.playVideo();
      }
    } catch (e) {}
    if (ducked) ytPausedByDuck = true;
    else armHint();
  }

  /* 상태: -1 시작 전 · 0 끝남 · 1 재생 중 · 2 멈춤 · 3 불러오는 중 · 5 대기 */
  function onYtStateChange(e) {
    var st = (e && typeof e.data === 'number') ? e.data : ytState();
    var t = current();
    if (st === 1 || st === 3) {
      if (muted || !boxOpen() || !t || t.kind !== 'youtube') {
        /* 안전장치 — 창을 닫았는데(끔) 소리만 나는 일이 없게 즉시 멈춘다 */
        try { ytPlayer.pauseVideo(); } catch (err) {}
        return;
      }
      hideHint();
      if (st === 1) ytPausedByDuck = false;
      return;
    }
    if (st === 0 && !muted && t && t.kind === 'youtube') advance();   /* 끝남 → 다음 곡 */
  }

  /* 2 잘못된 영상 번호 · 5 재생기 오류 · 100 없는(비공개) 영상 · 101·150 끼워넣기 금지 · 153 재생 창 설정 오류 */
  function onYtError() {
    hideHint();
    var t = current();
    if (t && t.kind === 'youtube') markBad(trackIndex);
  }

  function stopYouTube() {
    ytPausedByDuck = false;
    if (ytPlayer && ytReady) { try { ytPlayer.pauseVideo(); } catch (e) {} }
    hideYtBox();
  }

  /* ── 토글 단추 ── */
  /* ★ 2026-11-12: 이모지 정리 때 단추 글자가 비워져 «빈 검은 동그라미»로 보였다(무엇인지·눌러지는지 모름).
     아이콘 묶음(icons.js)과 같은 모양의 소리 아이콘을 단추 안에 직접 그린다 — 아이콘 스크립트 순서와 무관하게 보이도록. */
  var ICON_SOUND_OFF = '<path d="M11 4.7 6.3 8.6H2v6.8h4.3l4.7 3.9z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>';
  var ICON_SOUND_ON = '<path d="M11 4.7 6.3 8.6H2v6.8h4.3l4.7 3.9z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 6.6a9 9 0 0 1 0 10.8"/>';
  function setIcon(inner, label) {
    toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.title = label;
  }

  function applyIcon() {
    if (!toggleBtn) return;
    if (muted) {
      setIcon(ICON_SOUND_OFF, '추모 음악 켜기');
      toggleBtn.classList.remove('on');
    } else {
      setIcon(ICON_SOUND_ON, '추모 음악 끄기');
      toggleBtn.classList.add('on');
    }
  }

  function applyState() {
    if (!toggleBtn) return;
    applyIcon();
    if (muted) { stopAudio(); stopYouTube(); }
    else startCurrent();
  }

  /* persist=false 는 자동재생 차단처럼 사용자가 고른 게 아닌 경우(저장된 설정은 그대로) */
  function setMuted(m, persist) {
    muted = !!m;
    if (persist) persistMuted(muted);
    applyState();
  }

  /* 단추를 누른 그 동작 안에서 재생을 시작한다(브라우저 자동재생 제한) */
  function toggle() { setMuted(!muted, true); }

  /* 영상 재생 시 호출 — 음원은 페이드아웃, 유튜브는 멈춤 (음소거 아닐 때만) */
  function duckForVideo() {
    ducked = true;
    var t = current();
    if (muted || !t) return;
    if (t.kind === 'youtube') {
      hideHint();
      var st = ytState();
      if (st === 1 || st === 3) {
        ytPausedByDuck = true;
        try { ytPlayer.pauseVideo(); } catch (e) {}
      }
    } else if (audio && !audio.paused) {
      fadeTo(0);
    }
  }
  /* 영상 종료/일시정지 시 호출 — 음원은 페이드인, 유튜브는 재개 */
  function unduckAfterVideo() {
    ducked = false;
    var t = current();
    if (muted || !t) return;
    if (t.kind === 'youtube') {
      if (ytPausedByDuck && boxOpen() && ytPlayer && ytReady) {
        ytPausedByDuck = false;
        try { ytPlayer.playVideo(); } catch (e) {}
        armHint();
      }
    } else if (audio) {
      if (audio.paused) playAudio(t);
      else fadeTo(TARGET_VOLUME);
    }
  }

  function injectStyle() {
    if (document.getElementById('memorialBgmStyle')) return;
    var st = document.createElement('style');
    st.id = 'memorialBgmStyle';
    st.textContent =
      '.memorial-bgm-toggle{position:fixed;top:84px;right:18px;z-index:9000;' +
      'width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,0.28);' +
      'background:rgba(20,20,40,0.72);color:#fff;font-size:18px;line-height:1;cursor:pointer;' +
      'box-shadow:0 4px 14px rgba(0,0,0,0.28);transition:transform .15s,background .15s;' +
      'display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}' +
      '.memorial-bgm-toggle:hover{transform:scale(1.08);}' +
      '.memorial-bgm-toggle.on{background:rgba(176,118,42,0.88);border-color:rgba(255,210,150,0.5);}' +
      '@media(max-width:600px){.memorial-bgm-toggle{top:70px;right:12px;width:42px;height:42px;font-size:16px;}}' +
      /* 유튜브 작은 재생 창 — 유튜브 정책: 재생 화면 가로·세로 200px 이상, 가리거나 숨기지 않는다 */
      /* 창 너비는 재생 화면 + 여백으로 고정 — 긴 곡 제목이 창을 넓히지 않고 말줄임 되도록 */
      '.memorial-bgm-yt{position:fixed;right:18px;bottom:18px;z-index:8990;display:none;box-sizing:border-box;width:334px;' +
      'padding:6px;border-radius:14px;background:rgba(20,20,40,0.92);border:1px solid rgba(255,255,255,0.22);' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.35);color:#fff;font-family:inherit;' +
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}' +
      '.memorial-bgm-yt.open{display:block;}' +
      '.memorial-bgm-yt-head{display:flex;align-items:center;gap:8px;padding:0 0 6px 6px;}' +
      '.memorial-bgm-yt-title{flex:1 1 auto;min-width:0;font-size:12.5px;font-weight:600;line-height:1.4;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.memorial-bgm-yt-close{flex:none;width:28px;height:28px;padding:0;border:0;border-radius:50%;' +
      'background:rgba(255,255,255,0.14);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
      '.memorial-bgm-yt-close:hover{background:rgba(255,255,255,0.26);}' +
      '.memorial-bgm-yt-frame{position:relative;width:320px;height:200px;background:#000;}' +
      '.memorial-bgm-yt-frame iframe{position:relative;display:block;width:320px;height:200px;border:0;}' +
      '.memorial-bgm-yt-loading{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;' +
      'justify-content:center;font-size:12px;color:rgba(255,255,255,0.6);}' +
      '.memorial-bgm-yt-hint{display:none;max-width:320px;padding:6px 4px 0;font-size:11.5px;line-height:1.5;color:rgba(255,255,255,0.88);}' +
      '.memorial-bgm-yt-hint.on{display:block;}' +
      /* 휴대폰·낮은 화면 — 화면을 덜 가리도록 유튜브가 허용하는 가장 작은 크기(200×200) */
      '@media(max-width:600px),(max-height:480px){.memorial-bgm-yt{width:214px;}' +
      '.memorial-bgm-yt-frame,.memorial-bgm-yt-frame iframe{width:200px;height:200px;}' +
      '.memorial-bgm-yt-hint{max-width:200px;}}' +
      '@media(max-width:600px){.memorial-bgm-yt{right:12px;bottom:calc(12px + env(safe-area-inset-bottom, 0px));}}' +
      /* 재생 창이 떠 있으면 아래쪽 가운데 알림 쪽지를 창 위로 올린다 */
      '@media(max-width:1240px){body.memorial-bgm-yt-open .mem2-note-toast{bottom:266px;}}' +
      '@media(max-width:600px){body.memorial-bgm-yt-open .mem2-note-toast{bottom:calc(270px + env(safe-area-inset-bottom, 0px));}}';
    document.head.appendChild(st);
  }

  function buildUI() {
    injectStyle();

    audio = document.createElement('audio');
    audio.loop = false;
    audio.preload = 'none';
    audio.addEventListener('ended', function () {
      var t = current();
      if (t && t.kind === 'audio' && audioSrcIndex === trackIndex) advance();
    });
    audio.addEventListener('playing', function () { audioPlayedOk = true; });
    audio.addEventListener('error', onAudioError);
    document.body.appendChild(audio);

    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = 'memorialBgmToggle';
    toggleBtn.className = 'memorial-bgm-toggle';
    toggleBtn.textContent = '';
    toggleBtn.style.display = 'none';   /* 트랙 확인 후 노출 */
    toggleBtn.addEventListener('click', toggle);
    /* 누르려는 순간 유튜브 스크립트를 미리 불러 둔다(유튜브 트랙이 있을 때만) */
    ['pointerenter', 'pointerdown', 'touchstart', 'focus'].forEach(function (ev) {
      toggleBtn.addEventListener(ev, loadYtApi, { passive: true });
    });
    document.body.appendChild(toggleBtn);
  }

  function showToggle() { if (toggleBtn) toggleBtn.style.display = ''; }
  function hideToggle() { if (toggleBtn) toggleBtn.style.display = 'none'; }

  function loadTracks() {
    fetch('/api/memorial-summary', { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var data = (j && j.data) || j || {};
        var raw = data.bgmTracks || (data.data && data.data.bgmTracks) || [];
        tracks = toTracks(raw);
        trackIndex = 0;
        if (!tracks.length) { hideToggle(); return; }   /* 재생할 수 있는 음원 없음 → 토글 숨김 */
        showToggle();
        if (!muted && tracks[0].kind === 'youtube') {
          /* 유튜브는 사용자가 누르기 전에는 소리를 내지 않는다 — 저장된 «켜짐»은 그대로 두고 단추만 «켜기»로.
             곧 누를 가능성이 높으니 유튜브 스크립트는 한가할 때 미리 불러 둔다. */
          muted = true;
          idleLoadYtApi();
        }
        applyState();
      })
      .catch(function () {
        /* 요약 조회 실패 → 음원 없음과 동일하게 토글 숨김 */
        tracks = [];
        hideToggle();
      });
  }

  function init() {
    muted = savedMuted();
    if (dataSaverOn()) muted = true;
    buildUI();
    loadTracks();
  }

  function info() {
    var t = current();
    return {
      muted: muted,
      ducked: ducked,
      trackIndex: trackIndex,
      kind: t ? t.kind : null,
      title: t ? t.title : null,
      total: tracks.length,
      playable: playableCount(),
      badUrls: tracks.filter(function (x) { return x.bad; }).map(function (x) { return x.url; }),
      ytApi: ytApiState,
      ytReady: ytReady,
      ytState: ytState(),
      ytVideoId: ytVideoId,
      ytOpen: boxOpen(),
      audioPaused: audio ? audio.paused : true,
      audioSrc: audio ? audio.getAttribute('src') : null
    };
  }

  window.MemorialBGM = {
    toggle: toggle,
    duckForVideo: duckForVideo,
    unduckAfterVideo: unduckAfterVideo,
    isMuted: function () { return muted; },
    parseYouTubeId: parseYouTubeId,
    classifyUrl: classifyUrl,
    info: info
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
