/* =========================================================
   온라인 추모관 — BGM 멀티트랙 플레이어 (공통)
   - 우상단 고정 토글(/)
   - 음소거 상태로 시작 (브라우저 자동재생 정책) · 클릭 시 재생
   - localStorage('memorial_bgm_muted') 로 설정 기억
   - 트랙 순환(한 곡 끝나면 다음 곡)
   - 영상(히어로·개별) 재생 시 페이드아웃 → 종료 시 페이드인
   - 데이터 절약 모드면 자동 음소거
   - 트랙 목록은 /api/memorial-summary 의 bgmTracks (어드민 관리)
   ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'memorial_bgm_muted';
  var FADE_MS = 1100;
  var TARGET_VOLUME = 0.4;

  var tracks = [];
  var trackIndex = 0;
  var audio = null;
  var toggleBtn = null;
  var muted = true;      /* 음소거로 시작 */
  var ducked = false;    /* 영상 재생으로 페이드아웃된 상태 */
  var fadeTimer = null;

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

  function loadTrack(i) {
    if (!tracks.length) return;
    trackIndex = ((i % tracks.length) + tracks.length) % tracks.length;
    var t = tracks[trackIndex];
    if (audio && t && t.url) { audio.src = t.url; audio.load(); }
  }

  function play() {
    if (!audio || !tracks.length) return;
    if (!audio.src) loadTrack(0);
    audio.volume = ducked ? 0 : TARGET_VOLUME;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { /* 자동재생 차단 — 무시(다음 사용자 동작에서 재생) */ });
  }

  function applyState() {
    if (!toggleBtn) return;
    if (muted) {
      toggleBtn.textContent = '';
      toggleBtn.setAttribute('aria-label', '추모 음악 켜기');
      toggleBtn.classList.remove('on');
      if (audio) audio.pause();
    } else {
      toggleBtn.textContent = '';
      toggleBtn.setAttribute('aria-label', '추모 음악 끄기');
      toggleBtn.classList.add('on');
      play();
    }
  }

  function toggle() {
    muted = !muted;
    persistMuted(muted);
    applyState();
  }

  /* 영상 재생 시 호출 — BGM 페이드아웃(음소거 아닐 때만) */
  function duckForVideo() {
    ducked = true;
    if (!muted && audio && !audio.paused) fadeTo(0);
  }
  /* 영상 종료/일시정지 시 호출 — BGM 페이드인 */
  function unduckAfterVideo() {
    ducked = false;
    if (!muted && audio) {
      if (audio.paused) play();
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
      '@media(max-width:600px){.memorial-bgm-toggle{top:70px;right:12px;width:42px;height:42px;font-size:16px;}}';
    document.head.appendChild(st);
  }

  function buildUI() {
    injectStyle();

    audio = document.createElement('audio');
    audio.loop = false;
    audio.preload = 'none';
    audio.addEventListener('ended', function () {
      loadTrack(trackIndex + 1);
      if (!muted) play();
    });
    document.body.appendChild(audio);

    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = 'memorialBgmToggle';
    toggleBtn.className = 'memorial-bgm-toggle';
    toggleBtn.textContent = '';
    toggleBtn.style.display = 'none';   /* 트랙 확인 후 노출 */
    toggleBtn.addEventListener('click', toggle);
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
        var t = data.bgmTracks || (data.data && data.data.bgmTracks) || [];
        t = (Array.isArray(t) ? t : []).filter(function (x) { return x && x.url; });
        if (!t.length) { tracks = []; hideToggle(); return; }   /* 등록된 음원 없음 → 토글 숨김 */
        tracks = t;
        loadTrack(0);
        showToggle();
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

  window.MemorialBGM = {
    toggle: toggle,
    duckForVideo: duckForVideo,
    unduckAfterVideo: unduckAfterVideo,
    isMuted: function () { return muted; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
