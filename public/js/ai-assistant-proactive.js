/* ai-assistant-proactive.js — AI 비서 실시간 말풍선 (2026-07-01)
 *
 * 운영자가 어드민 화면에 접속해 있는 동안, 주요 이벤트(정기·일시 후원, SIREN 신고,
 * 유가족 지원, 회원가입 등)가 접수되면 AI 비서가 화면 우측 하단에 말풍선으로 먼저
 * 말을 걸어 해당 내용을 요약·안내한다.
 *
 * - 신규 백엔드 없음: 기존 /api/notifications/mine (내 알림 조회) 재사용
 * - 스키마 변경 없음
 * - 로그인 안 된 사용자/일반 사용자는 401 → 조용히 비활성
 * - 최초 로드 시 밀린 알림 폭탄 방지: 최근 10분 이내 것만 즉시 안내, 나머지는 기준선으로 흡수
 */
(function () {
  "use strict";

  // 관리자 토큰 쿠키가 있을 법한 페이지에서만 동작 (사용자 전용 페이지 제외)
  // /api/notifications/mine 자체가 admin/user 모두 응답하므로, 401이면 자동 무력화됨.

  var POLL_MS = 60000;                 // 60초 주기 폴링
  var FIRST_POP_WINDOW_MS = 10 * 60 * 1000; // 최초 로드 시 최근 10분 이내만 즉시 안내
  var SEEN_KEY = "siren_ai_proactive_seen";
  var SEEN_CAP = 300;

  // 말풍선을 띄울 "주요 이벤트" 판정: 카테고리 또는 심각도 기준
  var MAJOR_CATEGORIES = { donation: 1, support: 1, member: 1, billing: 1, milestone: 1 };
  function isMajor(n) {
    if (!n) return false;
    if (n.severity === "warning" || n.severity === "critical") return true;
    return !!MAJOR_CATEGORIES[n.category];
  }

  function loadSeen() {
    try {
      var raw = localStorage.getItem(SEEN_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveSeen(arr) {
    try {
      if (arr.length > SEEN_CAP) arr = arr.slice(arr.length - SEEN_CAP);
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
    } catch (e) { /* localStorage 불가 환경 무시 */ }
  }

  var seen = loadSeen();
  var seenSet = {};
  seen.forEach(function (id) { seenSet[id] = 1; });
  var firstRun = true;
  var container = null;
  var disabled = false;

  function ensureStyle() {
    if (document.getElementById("aiProactiveStyle")) return;
    var css = ""
      + ".ai-pro-wrap{position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:340px;pointer-events:none}"
      + ".ai-pro-card{pointer-events:auto;background:#fff;border:1px solid #e5e7eb;border-left:4px solid #7a1f2b;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.16);padding:12px 14px;animation:aiProIn .25s ease}"
      + ".ai-pro-card.sev-warning{border-left-color:#d97706}"
      + ".ai-pro-card.sev-critical{border-left-color:#dc2626}"
      + "@keyframes aiProIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}"
      + ".ai-pro-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}"
      + ".ai-pro-avatar{width:26px;height:26px;border-radius:50%;background:#7a1f2b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}"
      + ".ai-pro-name{font-weight:700;font-size:12.5px;color:#111}"
      + ".ai-pro-close{margin-left:auto;border:none;background:transparent;color:#9ca3af;font-size:16px;cursor:pointer;line-height:1;padding:2px 4px}"
      + ".ai-pro-title{font-weight:700;font-size:13.5px;color:#111;margin:2px 0 3px}"
      + ".ai-pro-msg{font-size:13px;color:#374151;line-height:1.5;white-space:pre-wrap}"
      + ".ai-pro-actions{display:flex;gap:8px;margin-top:10px}"
      + ".ai-pro-btn{flex:1;border:none;border-radius:8px;padding:7px 10px;font-size:12.5px;font-weight:600;cursor:pointer}"
      + ".ai-pro-btn.go{background:#7a1f2b;color:#fff}"
      + ".ai-pro-btn.dismiss{background:#f3f4f6;color:#374151}";
    var st = document.createElement("style");
    st.id = "aiProactiveStyle";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    ensureStyle();
    container = document.createElement("div");
    container.className = "ai-pro-wrap";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
    return container;
  }

  function markRead(id) {
    try {
      fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: id }),
      }).catch(function () {});
    } catch (e) { /* noop */ }
  }

  function popBubble(n) {
    var wrap = ensureContainer();
    var card = document.createElement("div");
    card.className = "ai-pro-card sev-" + (n.severity || "info");

    var head = document.createElement("div");
    head.className = "ai-pro-head";
    head.innerHTML = '<div class="ai-pro-avatar">🤖</div><div class="ai-pro-name">AI 비서</div>';
    var closeBtn = document.createElement("button");
    closeBtn.className = "ai-pro-close";
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    head.appendChild(closeBtn);
    card.appendChild(head);

    if (n.title) {
      var t = document.createElement("div");
      t.className = "ai-pro-title";
      t.textContent = n.title;
      card.appendChild(t);
    }
    var msg = document.createElement("div");
    msg.className = "ai-pro-msg";
    msg.textContent = n.message || "새 소식이 도착했어요.";
    card.appendChild(msg);

    var actions = document.createElement("div");
    actions.className = "ai-pro-actions";
    if (n.link) {
      var go = document.createElement("button");
      go.className = "ai-pro-btn go";
      go.type = "button";
      go.textContent = "확인하러 가기";
      go.onclick = function () {
        markRead(n.id);
        try { window.location.href = n.link; } catch (e) {}
      };
      actions.appendChild(go);
    }
    var dismiss = document.createElement("button");
    dismiss.className = "ai-pro-btn dismiss";
    dismiss.type = "button";
    dismiss.textContent = "나중에";
    dismiss.onclick = function () { card.remove(); };
    actions.appendChild(dismiss);
    card.appendChild(actions);

    closeBtn.onclick = function () { card.remove(); };

    wrap.appendChild(card);

    // 과다 누적 방지: 화면에 최대 4개까지만
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);

    // critical이 아니면 25초 후 자동 사라짐(이미 seen 처리라 재등장 안 함)
    if (n.severity !== "critical") {
      setTimeout(function () { if (card.parentNode) card.remove(); }, 25000);
    }
  }

  function processList(list) {
    var now = Date.now();
    var newlySeen = [];
    // 오래된 → 최신 순으로 처리해 말풍선 쌓임 순서를 자연스럽게
    var arr = list.slice().sort(function (a, b) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    arr.forEach(function (n) {
      if (!n || seenSet[n.id]) return;
      if (!isMajor(n)) { seenSet[n.id] = 1; newlySeen.push(n.id); return; }

      var created = new Date(n.createdAt).getTime();
      var recent = isFinite(created) ? (now - created) <= FIRST_POP_WINDOW_MS : true;

      // 최초 실행: 최근 10분 이내만 즉시 안내, 나머지는 기준선으로 흡수
      if (firstRun && !recent) {
        seenSet[n.id] = 1; newlySeen.push(n.id); return;
      }
      popBubble(n);
      seenSet[n.id] = 1; newlySeen.push(n.id);
    });
    if (newlySeen.length) {
      seen = seen.concat(newlySeen);
      saveSeen(seen);
    }
    firstRun = false;
  }

  function poll() {
    if (disabled) return;
    fetch("/api/notifications/mine?unreadOnly=1&limit=30", {
      credentials: "include",
      headers: { "Accept": "application/json" },
    })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) { disabled = true; return null; }
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (json) {
        if (!json) return;
        // 응답 키 다중 fallback
        var list = (json.data && json.data.list) || json.list || (json.data && json.data.data && json.data.data.list) || [];
        if (Array.isArray(list)) processList(list);
      })
      .catch(function () { /* 네트워크 오류 무시, 다음 주기 재시도 */ });
  }

  function start() {
    poll();
    setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") poll();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
