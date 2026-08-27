/* =========================================================
   SIREN 추모관 — 마음의 두 얼굴 (별 ↔ 꽃)
   ---------------------------------------------------------
   같은 참여 하나가 밤에는 하늘의 '별'로, 아침에는 들판의 '꽃'으로 나타난다.
   자리(좌표)는 참여 번호에서 계산하므로 언제 다시 와도 내 별·내 꽃은 같은 곳에 있다.

   쓰는 법
     var sky = MemorialSky.mount(캔버스, { mode:'star', items:[...], total:1284 });
     sky.setItems(새목록);      // 새 참여가 들어왔을 때
     sky.focusMine();           // '내 별 찾기' — 내 것을 밝게 비춘다
     sky.destroy();

   무겁지 않게 지키는 것 세 가지
     · 화면에 안 보이면 그리기를 멈춘다 (배터리·발열)
     · 참여가 아무리 많아도 그리는 개수는 상한선까지만 (나머지는 숫자로 안내)
     · '동작 줄이기'를 켠 분에게는 움직이지 않고 한 번만 그린다
   ========================================================= */
(function (global) {
  'use strict';

  var MAX_DRAW = 1400;         /* 실제로 그리는 최대 개수 (도장 방식이라 여유 있다) */
  var MIN_DRAW = 90;           /* 참여가 적어도 하늘이 허전하지 않게 채우는 최소치 */
  var DPR_CAP = 2;             /* 고해상도 화면에서도 2배까지만 (그 이상은 낭비) */

  /* 참여 번호 → 늘 같은 값 (같은 사람은 늘 같은 자리) */
  function seedOf(v) {
    var s = String(v == null ? '' : v);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  /* 씨앗에서 0~1 난수를 순서대로 뽑는다 */
  function rngFrom(seed) {
    var x = seed || 1;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;  x >>>= 0;
      return x / 4294967296;
    };
  }

  function prefersReducedMotion() {
    try {
      return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function Sky(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = (opts && opts.mode) === 'flower' ? 'flower' : 'star';
    /* 배경으로 깔릴 때는 글자를 방해하지 않도록 한 톤 낮춘다 */
    this.asBackdrop = !!(opts && opts.backdrop);
    this.items = [];
    this.total = 0;
    this.nodes = [];
    this.w = 0; this.h = 0; this.dpr = 1;
    this.t = 0;
    this.raf = null;
    this.visible = false;
    this.still = prefersReducedMotion();
    this.hoverIdx = -1;
    this.focusIdx = -1;
    this.focusUntil = 0;
    this.onPick = (opts && opts.onPick) || null;

    this._resize = this._resize.bind(this);
    this._move = this._move.bind(this);
    this._leave = this._leave.bind(this);
    this._click = this._click.bind(this);

    this.setItems((opts && opts.items) || [], (opts && opts.total) || 0);
    this._resize();
    this._bind();
  }

  Sky.prototype._bind = function () {
    global.addEventListener('resize', this._resize);
    this.canvas.addEventListener('mousemove', this._move);
    this.canvas.addEventListener('mouseleave', this._leave);
    this.canvas.addEventListener('click', this._click);

    var self = this;
    if (global.IntersectionObserver) {
      this.io = new IntersectionObserver(function (entries) {
        var vis = entries.some(function (e) { return e.isIntersecting; });
        self.visible = vis;
        if (vis) self._start(); else self._stop();
      }, { rootMargin: '80px' });
      this.io.observe(this.canvas);
    } else {
      this.visible = true;
      this._start();
    }

    /* 다른 탭으로 넘어가면 멈춘다 */
    this._vis = function () {
      if (document.hidden) self._stop();
      else if (self.visible) self._start();
    };
    document.addEventListener('visibilitychange', this._vis);
  };

  /** 참여 목록 갱신 — 자리는 번호에서 계산하므로 순서가 바뀌어도 흔들리지 않는다 */
  Sky.prototype.setItems = function (items, total) {
    var list = Array.isArray(items) ? items : [];
    this.total = Math.max(total || 0, list.length);
    this.items = list.slice(0, MAX_DRAW);
    this._layout();
    if (!this.raf) this._draw();
  };

  Sky.prototype._layout = function () {
    var self = this;

    function place(key, mine, name, text, id, deco) {
      var r = rngFrom(seedOf(key));
      var x = r();
      var y = r();
      /* 밤: 하늘 전체에 고루 / 아침: 아래쪽 들판에 모이게 */
      if (self.mode === 'flower') y = 0.42 + Math.pow(y, 0.75) * 0.56;
      else y = Math.pow(y, 1.25) * 0.92 + 0.03;
      return {
        id: id,
        name: name || '익명',
        text: text || '',
        mine: !!mine,
        deco: !!deco,                  /* 참여가 아니라 배경을 채우는 것 */
        x: 0.04 + x * 0.92,
        y: y,
        s: 0.55 + r() * 0.75,          /* 크기 */
        p: r() * Math.PI * 2,          /* 반짝임·흔들림 시작 위상 */
        hue: r(),                      /* 꽃 색 고르기 */
      };
    }

    var nodes = this.items.map(function (it, i) {
      return place(it.id != null ? it.id : ('n' + i), it.mine, it.name, it.text, it.id, false);
    });

    /* 참여가 아직 적어도 하늘·들판이 휑하지 않도록 배경을 채운다.
       이 별과 꽃은 누구의 참여도 아니므로 흐리게 두고, 눌러도 잡히지 않는다.
       참여가 늘면 그만큼 배경이 줄어 결국 전부 '누군가의 마음'이 된다. */
    if (nodes.length < MIN_DRAW) {
      var need = MIN_DRAW - nodes.length;
      for (var k = 0; k < need; k++) {
        nodes.push(place(this.mode + '-bg-' + k, false, '', '', null, true));
      }
    }

    this.nodes = nodes;
  };

  Sky.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = Math.min(global.devicePixelRatio || 1, DPR_CAP);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._draw();
  };

  Sky.prototype._start = function () {
    if (this.raf || this.still || document.hidden) { this._draw(); return; }
    var self = this;
    this.raf = requestAnimationFrame(function loop(ts) {
      self.t = ts / 1000;
      self._draw();
      self.raf = requestAnimationFrame(loop);
    });
  };

  Sky.prototype._stop = function () {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  };

  /* ---------- 그리기 ---------- */

  Sky.prototype._draw = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalAlpha = this.asBackdrop ? 0.72 : 1;
    var now = this.t;
    var focusOn = this.focusIdx >= 0 && (this.still || Date.now() < this.focusUntil);

    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var px = n.x * this.w;
      var py = n.y * this.h;
      var hot = (i === this.hoverIdx) || (focusOn && i === this.focusIdx);
      if (this.mode === 'flower') this._flower(ctx, n, px, py, now, hot);
      else this._star(ctx, n, px, py, now, hot);
    }
    ctx.globalAlpha = 1;
  };

  /* ── 별 도장 ──────────────────────────────────────────────
     예전에는 별 하나마다 매번 번짐(그라데이션)을 새로 만들었다.
     400개면 1초에 24,000번을 다시 만드는 셈이라, 개수를 늘릴 수 없었다.
     이제 별 그림을 딱 두 번(보통·내 별)만 만들어 두고 도장 찍듯 붙인다.
     화면이 커져 별이 많아져도 부담이 거의 늘지 않는다. */
  var STAR_SPRITE = { normal: null, mine: null, size: 0 };

  function buildStarSprite(warm) {
    var R = 32;                       /* 도장 한 장의 반지름 */
    var cv = document.createElement('canvas');
    cv.width = cv.height = R * 2;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.10, 'rgba(' + warm + ',0.95)');
    g.addColorStop(0.35, 'rgba(' + warm + ',0.28)');
    g.addColorStop(1.00, 'rgba(' + warm + ',0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(R, R, R, 0, Math.PI * 2);
    c.fill();
    return cv;
  }

  function starSprites() {
    if (!STAR_SPRITE.normal) {
      try {
        STAR_SPRITE.normal = buildStarSprite('255,247,232');
        STAR_SPRITE.mine = buildStarSprite('232,168,85');
        STAR_SPRITE.size = 64;
      } catch (e) { /* 만들 수 없으면 아래에서 원으로 그린다 */ }
    }
    return STAR_SPRITE;
  }

  Sky.prototype._star = function (ctx, n, px, py, now, hot) {
    var tw = this.still ? 0.85 : 0.62 + 0.38 * Math.sin(now * 1.1 + n.p);
    var alpha = n.mine ? 0.95 : (0.42 + 0.45 * tw);
    if (n.deco) alpha *= 0.38;         /* 배경을 채우는 별은 뒤로 물린다 */
    /* 화면이 넓을수록 별도 조금 크게 — 배경 전체로 퍼져도 허전하지 않게 */
    var scale = 1 + Math.min(0.5, this.w / 2600);
    var draw = (n.mine ? 13 : 7) * n.s * scale * (hot ? 1.9 : 1);

    var sp = starSprites();
    var img = n.mine ? sp.mine : sp.normal;
    if (img) {
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(img, px - draw, py - draw, draw * 2, draw * 2);
      ctx.globalAlpha = 1;
    } else {
      /* 도장을 못 만든 환경 — 단순한 점으로라도 보이게 한다 */
      ctx.fillStyle = 'rgba(255,252,245,' + alpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1, draw * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }

    /* 내 별 · 짚은 별 — 둘레에 얇은 테로 알려준다 */
    if (n.mine || hot) {
      ctx.strokeStyle = 'rgba(232,168,85,' + (hot ? 0.85 : 0.4) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, draw * (hot ? 0.9 : 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  var PETAL_COLORS = [
    [246, 213, 220],   /* 연분홍 */
    [252, 236, 205],   /* 살구빛 */
    [255, 250, 244],   /* 흰빛 */
    [226, 234, 219],   /* 연둣빛 */
  ];

  Sky.prototype._flower = function (ctx, n, px, py, now, hot) {
    var sway = this.still ? 0 : Math.sin(now * 0.8 + n.p) * (2.2 * n.s);
    var size = (n.mine ? 6.2 : 4.0) * n.s * (hot ? 1.5 : 1);
    var cx = px + sway;
    var cy = py;

    /* 줄기 */
    ctx.strokeStyle = 'rgba(120,146,118,' + (n.mine ? 0.75 : 0.4) + ')';
    ctx.lineWidth = Math.max(0.8, size * 0.16);
    ctx.beginPath();
    ctx.moveTo(px, py + size * 3.4);
    ctx.quadraticCurveTo(px + sway * 0.4, py + size * 1.5, cx, cy);
    ctx.stroke();

    /* 꽃잎 5장 */
    var c = n.mine ? [232, 168, 85] : PETAL_COLORS[Math.floor(n.hue * PETAL_COLORS.length) % PETAL_COLORS.length];
    var a = (n.mine ? 0.95 : 0.72) * (n.deco ? 0.42 : 1);
    ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    for (var k = 0; k < 5; k++) {
      var ang = n.p + k * (Math.PI * 2 / 5);
      var ox = cx + Math.cos(ang) * size * 0.62;
      var oy = cy + Math.sin(ang) * size * 0.62;
      ctx.beginPath();
      ctx.ellipse(ox, oy, size * 0.52, size * 0.36, ang, 0, Math.PI * 2);
      ctx.fill();
    }
    /* 꽃술 */
    ctx.fillStyle = n.mine ? 'rgba(255,246,230,0.98)' : 'rgba(245,206,120,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.3, 0, Math.PI * 2);
    ctx.fill();

    if (n.mine || hot) {
      ctx.strokeStyle = 'rgba(214,142,58,' + (hot ? 0.8 : 0.4) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, size * (hot ? 2.6 : 2.0), 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  /* ---------- 손길 ---------- */

  Sky.prototype._hitTest = function (mx, my) {
    var best = -1, bestD = 22 * 22;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      if (n.deco) continue;            /* 배경을 채우는 것은 잡히지 않는다 */
      var dx = mx - n.x * this.w;
      var dy = my - n.y * this.h;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  Sky.prototype._move = function (ev) {
    var rect = this.canvas.getBoundingClientRect();
    var idx = this._hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
    if (idx !== this.hoverIdx) {
      this.hoverIdx = idx;
      this.canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
      if (!this.raf) this._draw();
    }
  };

  Sky.prototype._leave = function () {
    this.hoverIdx = -1;
    this.canvas.style.cursor = 'default';
    if (!this.raf) this._draw();
  };

  Sky.prototype._click = function (ev) {
    var rect = this.canvas.getBoundingClientRect();
    var idx = this._hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
    if (idx < 0 || !this.onPick) return;
    var n = this.nodes[idx];
    this.onPick({
      name: n.name, text: n.text, mine: n.mine,
      x: n.x * this.w, y: n.y * this.h,
    });
  };

  /** 특정 마음 하나를 잠시 밝힌다 (목록에서 '이 마음의 별 보기') */
  Sky.prototype.focusId = function (id) {
    var idx = -1;
    for (var i = 0; i < this.nodes.length; i++) {
      if (String(this.nodes[i].id) === String(id)) { idx = i; break; }
    }
    if (idx < 0) return null;
    this.focusIdx = idx;
    this.focusUntil = Date.now() + 5000;
    this._start();
    var n = this.nodes[idx];
    return { x: n.x * this.w, y: n.y * this.h, name: n.name, text: n.text };
  };

  /** '내 별 찾기' — 내 것을 잠시 밝힌다. 없으면 false */
  Sky.prototype.focusMine = function () {
    var idx = -1;
    for (var i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].mine) { idx = i; break; }
    }
    if (idx < 0) return null;
    this.focusIdx = idx;
    this.focusUntil = Date.now() + 4200;
    this._start();
    var n = this.nodes[idx];
    return { x: n.x * this.w, y: n.y * this.h, name: n.name, text: n.text };
  };

  Sky.prototype.destroy = function () {
    this._stop();
    global.removeEventListener('resize', this._resize);
    this.canvas.removeEventListener('mousemove', this._move);
    this.canvas.removeEventListener('mouseleave', this._leave);
    this.canvas.removeEventListener('click', this._click);
    document.removeEventListener('visibilitychange', this._vis);
    if (this.io) this.io.disconnect();
  };

  global.MemorialSky = {
    MAX_DRAW: MAX_DRAW,
    mount: function (canvas, opts) {
      if (!canvas || !canvas.getContext) return null;
      try { return new Sky(canvas, opts || {}); }
      catch (e) { console.warn('[추모관] 하늘 그리기 준비 실패', e); return null; }
    },
  };
})(window);
