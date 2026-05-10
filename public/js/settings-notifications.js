// public/js/settings-notifications.js
// Phase 9-B — 사용자 알림 수신 설정 화면

(function () {
  "use strict";

  const CHANNELS = ["inapp", "email", "sms", "kakao"];
  const CH_LABEL  = { inapp: "인앱", email: "이메일", sms: "SMS", kakao: "알림톡" };

  /* 이벤트 분류 */
  const BILLING_EVENTS    = ["billing.success","billing.failed","billing.canceled","card.expiring"];
  const WORKSPACE_EVENTS  = ["workspace.activity"];
  const SERVICE_EVENTS    = [
    "support.reply","siren.assigned","member.eligibility_decided","admin.daily_briefing",
  ];

  const EVENT_LABELS = {
    "billing.success":            "결제 성공",
    "billing.failed":             "결제 실패",
    "billing.canceled":           "결제 취소",
    "card.expiring":              "카드 만료 예정",
    "workspace.activity":         "워크스페이스 활동",
    "admin.daily_briefing":       "어드민 일일 브리핑",
    "support.reply":              "지원 회신",
    "siren.assigned":             "SIREN 할당",
    "member.eligibility_decided": "회원 자격 결정",
  };

  let eventsData = []; // 서버에서 받은 이벤트 설정 배열
  let phoneVerified = false;

  /* ── 초기화 ── */
  async function init() {
    const res = await api({ method: "GET", url: "/api/notification-preferences" });
    if (!res.ok) {
      showToast("알림 설정을 불러오지 못했습니다.", "error");
      return;
    }
    const data = res.data?.data ?? res.data;
    eventsData = data?.events ?? [];
    phoneVerified = !!data?.phoneVerified;

    if (!phoneVerified) {
      document.getElementById("phoneAlert").style.display = "flex";
    }

    renderTable("tbody-billing",   eventsData.filter(e => BILLING_EVENTS.includes(e.eventType)));
    renderTable("tbody-service",   eventsData.filter(e => SERVICE_EVENTS.includes(e.eventType)));
    renderTable("tbody-workspace", eventsData.filter(e => WORKSPACE_EVENTS.includes(e.eventType)));

    document.getElementById("loadingArea").style.display = "none";
    document.getElementById("mainContent").style.display = "";
  }

  /* ── 테이블 렌더링 ── */
  function renderTable(tbodyId, events) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = "";

    for (const ev of events) {
      const tr = document.createElement("tr");
      tr.dataset.event = ev.eventType;

      /* 이벤트 이름 셀 */
      const tdName = document.createElement("td");
      tdName.innerHTML = `<div class="event-label">${EVENT_LABELS[ev.eventType] ?? ev.eventType}</div>
        ${ev.hasCustom ? '<div class="event-cat">맞춤 설정됨</div>' : '<div class="event-cat">기본값 사용 중</div>'}`;
      tr.appendChild(tdName);

      /* 채널별 체크박스 */
      for (const ch of CHANNELS) {
        const td = document.createElement("td");
        td.className = "ch-cell";
        const forced  = (ev.forcedChannels ?? []).includes(ch);
        const checked = (ev.channels ?? []).includes(ch);
        const unavail = (ch === "sms" || ch === "kakao") && !phoneVerified;

        const wrap = document.createElement("div");
        wrap.className = "ch-checkbox-wrap";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.event = ev.eventType;
        cb.dataset.ch    = ch;
        cb.checked       = checked;
        cb.disabled      = forced || unavail;
        cb.id            = `cb-${ev.eventType}-${ch}`;

        const badge = document.createElement("span");
        if (forced) {
          badge.className = "forced-badge";
          badge.textContent = "필수";
        } else if (unavail) {
          badge.className = "unavail-badge";
          badge.textContent = "인증 필요";
        }

        wrap.appendChild(cb);
        if (forced || unavail) wrap.appendChild(badge);
        td.appendChild(wrap);
        tr.appendChild(td);
      }

      /* 저장 버튼 셀 */
      const tdBtn = document.createElement("td");
      tdBtn.style.textAlign = "center";
      const btn = document.createElement("button");
      btn.className = "save-btn";
      btn.textContent = "저장";
      btn.dataset.event = ev.eventType;
      btn.style.padding = "6px 14px";
      btn.style.fontSize = "0.8rem";
      btn.addEventListener("click", () => saveRow(ev.eventType, btn));
      tdBtn.appendChild(btn);

      if (ev.hasCustom) {
        const resetA = document.createElement("span");
        resetA.className = "reset-link";
        resetA.textContent = "초기화";
        resetA.title = "기본값으로 되돌립니다";
        resetA.addEventListener("click", () => resetRow(ev.eventType));
        tdBtn.appendChild(document.createElement("br"));
        tdBtn.appendChild(resetA);
      }

      tr.appendChild(tdBtn);
      tbody.appendChild(tr);
    }
  }

  /* ── 행 저장 ── */
  async function saveRow(eventType, btn) {
    const checkboxes = document.querySelectorAll(`input[data-event="${eventType}"][data-ch]`);
    const channels = [];
    checkboxes.forEach(cb => { if (cb.checked) channels.push(cb.dataset.ch); });

    btn.disabled = true;
    btn.textContent = "저장 중…";

    const res = await api({
      method: "PATCH",
      url: "/api/notification-preferences",
      body: { event_type: eventType, channels },
    });

    btn.disabled = false;

    if (res.ok) {
      const saved = res.data?.data ?? res.data;
      showToast(`${EVENT_LABELS[eventType] ?? eventType} 설정이 저장되었습니다.`);
      btn.textContent = "저장";
      // 반환된 channels로 체크박스 동기화 (강제 채널 복원 반영)
      if (Array.isArray(saved?.channels)) {
        checkboxes.forEach(cb => {
          cb.checked = saved.channels.includes(cb.dataset.ch);
        });
      }
      // "맞춤 설정됨" 표시 갱신
      const tr = btn.closest("tr");
      if (tr) {
        const catDiv = tr.querySelector(".event-cat");
        if (catDiv) catDiv.textContent = "맞춤 설정됨";
      }
    } else {
      showToast(`저장 실패: ${res.data?.error ?? "오류 발생"}`, "error");
      btn.textContent = "저장";
    }
  }

  /* ── 행 초기화 (기본값으로 복귀) ── */
  async function resetRow(eventType) {
    if (!confirm(`"${EVENT_LABELS[eventType] ?? eventType}" 설정을 기본값으로 초기화할까요?`)) return;

    const res = await api({
      method: "DELETE",
      url: "/api/notification-preferences",
      body: { event_type: eventType },
    });

    if (res.ok) {
      showToast("기본값으로 초기화되었습니다.");
      await init(); // 전체 재렌더링
    } else {
      showToast("초기화 실패", "error");
    }
  }

  /* ── 토스트 ── */
  function showToast(msg, type = "") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  /* ── api 헬퍼 (common.js의 api()를 사용하되 없으면 fallback) ── */
  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.api === "function") {
        return await window.api({ method, url, body });
      }
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
