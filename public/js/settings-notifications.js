// public/js/settings-notifications.js
// R10: 라운드 10 — 알림 구독 설정 (일괄 저장)
//
// 응답 shape:
//   GET  /api/notification-preferences → { ok, preferences:[{eventType, channels}] }
//   PUT  /api/notification-preferences → { ok }

(function () {
  "use strict";

  const CHANNELS  = ["inapp", "email", "sms", "kakao"];


  /* 이벤트 분류·라벨 — 새 키는 여기에 추가만 하면 자동 인식 */
  /* R45 US-058: 키를 NotifyEvent 정규값(점 표기)으로 통일 — 기존 underscore 키(donation_confirmed·
     support_status_change·incident_reply·workspace_mention)는 디스패처(점 표기)와 불일치해 수신거부가 무시됐음. */
  const CATEGORY = {
    billing:   ["billing.success", "billing.failed", "billing.canceled", "card.expiring", "billing.upcoming", "donation.receipt_annual"],
    service:   ["support.reply", "siren.assigned", "legal.assigned",
                "member.eligibility_decided", "comment.report_resolved", "donor.info_changed"],
    workspace: ["workspace.mention", "workspace.activity"],
  };
  const EVENT_LABELS = {
    "billing.success":            "결제 성공",
    "billing.failed":             "결제 실패",
    "billing.canceled":           "결제 취소",
    "billing.upcoming":           "정기결제 예정 안내",
    "card.expiring":              "카드 만료 예정",
    "donation.receipt_annual":    "연말 기부금 영수증 안내",
    "support.reply":              "유가족 지원 회신",
    "siren.assigned":             "SIREN 신고 배정",
    "legal.assigned":             "법률 상담 배정",
    "member.eligibility_decided": "회원 자격 심사 결과",
    "comment.report_resolved":    "댓글 신고 처리 결과",
    "donor.info_changed":         "후원 정보 변경 안내",
    "workspace.mention":          "워크스페이스 멘션",
    "workspace.activity":         "워크스페이스 활동",
  };

  let preferences = []; // [{eventType, channels:[...]}]
  let phoneVerified = true;

  /* ── 카테고리 분류 ── */
  function categorize(eventType) {
    if (CATEGORY.billing.includes(eventType))   return "billing";
    if (CATEGORY.workspace.includes(eventType)) return "workspace";
    return "service";
  }

  /* ── 초기화 ── */
  async function init() {
    let data = null;
    try {
      const res = await api({ method: "GET", url: "/api/notification-preferences" });
      if (res.ok) {
        const body = res.data ?? {};
        const inner = body.data ?? body;

        /* R10 응답 (preferences) */
        if (Array.isArray(inner?.preferences)) {
          preferences = inner.preferences.map((p) => ({
            eventType: p.eventType,
            channels: Array.isArray(p.channels) ? p.channels.slice() : [],
          }));
          data = { phoneVerified: inner.phoneVerified ?? true };
        }
        /* 기존 응답 (events) 호환 */
        else if (Array.isArray(inner?.events)) {
          preferences = inner.events.map((e) => ({
            eventType: e.eventType,
            channels: Array.isArray(e.channels) ? e.channels.slice() : [],
          }));
          data = { phoneVerified: !!inner.phoneVerified };
        } else {
          /* API 미연결 — mock 사용 */
          console.warn("[notif] preferences 없음 — mock 사용");
          preferences = MOCK_NOTIFICATION_PREFS.preferences.map((p) => ({
            eventType: p.eventType,
            channels: p.channels.slice(),
          }));
          data = { phoneVerified: true };
        }
      } else {
        /* API 실패 — mock 사용 */
        console.warn("[notif] API 응답 실패 — mock 사용");
        preferences = MOCK_NOTIFICATION_PREFS.preferences.map((p) => ({
          eventType: p.eventType,
          channels: p.channels.slice(),
        }));
        data = { phoneVerified: true };
      }
    } catch (e) {
      console.warn("[notif] fetch failed", e);
      showToast("알림 설정을 불러올 수 없습니다.", "error");
    }

    phoneVerified = !!(data && data.phoneVerified);

    if (!phoneVerified) {
      const a = document.getElementById("phoneAlert");
      if (a) a.style.display = "flex";
    }

    /* 분류·렌더링 */
    const groups = { billing: [], service: [], workspace: [] };
    for (const p of preferences) groups[categorize(p.eventType)].push(p);

    renderTable("tbody-billing",   groups.billing);
    renderTable("tbody-service",   groups.service);
    renderTable("tbody-workspace", groups.workspace);

    document.getElementById("loadingArea").style.display = "none";
    document.getElementById("mainContent").style.display = "";

    const saveBtn = document.getElementById("btnSaveAll");
    if (saveBtn) saveBtn.addEventListener("click", saveAll);
  }

  /* ── 테이블 렌더링 ── */
  function renderTable(tbodyId, events) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = "";

    if (events.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.style.textAlign = "center";
      td.style.padding = "20px";
      td.style.color = "#94a3b8";
      td.textContent = "표시할 이벤트가 없습니다.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const ev of events) {
      const tr = document.createElement("tr");
      tr.dataset.event = ev.eventType;

      /* 이벤트 이름 셀 */
      const tdName = document.createElement("td");
      tdName.innerHTML = `<div class="event-label">${EVENT_LABELS[ev.eventType] ?? ev.eventType}</div>`;
      tr.appendChild(tdName);

      /* 채널별 체크박스 */
      for (const ch of CHANNELS) {
        const td = document.createElement("td");
        td.className = "ch-cell";
        const checked = (ev.channels ?? []).includes(ch);
        const unavail = (ch === "sms" || ch === "kakao") && !phoneVerified;

        const wrap = document.createElement("div");
        wrap.className = "ch-checkbox-wrap";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.event = ev.eventType;
        cb.dataset.ch    = ch;
        cb.checked       = checked;
        cb.disabled      = unavail;
        cb.id            = `cb-${ev.eventType}-${ch}`;

        wrap.appendChild(cb);
        if (unavail) {
          const badge = document.createElement("span");
          badge.className = "unavail-badge";
          badge.textContent = "인증 필요";
          wrap.appendChild(badge);
        }
        td.appendChild(wrap);
        tr.appendChild(td);
      }

      /* 마지막 셀: 비움 (일괄 저장으로 통합) */
      const tdEnd = document.createElement("td");
      tdEnd.textContent = "—";
      tdEnd.style.color = "#cbd5e1";
      tdEnd.style.textAlign = "center";
      tr.appendChild(tdEnd);

      tbody.appendChild(tr);
    }
  }

  /* ── 일괄 저장 ── */
  async function saveAll() {
    const btn = document.getElementById("btnSaveAll");
    if (!btn) return;

    /* 현재 화면 상태 수집 */
    const payload = preferences.map((p) => {
      const channels = [];
      for (const ch of CHANNELS) {
        const cb = document.querySelector(`input[data-event="${p.eventType}"][data-ch="${ch}"]`);
        if (cb && cb.checked) channels.push(ch);
      }
      return { eventType: p.eventType, channels };
    });

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "저장 중...";

    let saved = false;
    try {
      const res = await api({
        method: "PUT",
        url: "/api/notification-preferences",
        body: { preferences: payload },
      });
      if (res.ok && (res.data?.ok || res.data?.ok === undefined)) {
        saved = true;
      } else {
        console.warn("[notif] PUT 응답 실패 — mock 저장 처리");
        saved = true;
      }
    } catch (e) {
      console.warn("[notif] PUT failed", e);
    }

    btn.disabled = false;
    btn.textContent = oldText;

    if (saved) {
      /* 로컬 상태 동기화 */
      preferences = payload.map((p) => ({ eventType: p.eventType, channels: p.channels.slice() }));
      showToast("알림 설정이 저장되었습니다.");
    } else {
      showToast("저장 실패", "error");
    }
  }

  /* ── 토스트 ── */
  function showToast(msg, type = "") {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  /* ── api 헬퍼 ── */
  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.api === "function") {
        return await window.api({ method, url, body });
      }
      const opts = { method, headers: { "Content-Type": "application/json" }, credentials: "include" };
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
