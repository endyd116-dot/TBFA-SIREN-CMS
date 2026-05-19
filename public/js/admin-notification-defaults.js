// public/js/admin-notification-defaults.js
// Phase 9-B — 어드민 알림 기본 정책 관리 화면

(function () {
  "use strict";

  const CHANNELS    = ["inapp", "email", "sms", "kakao"];
  const CH_LABELS   = { inapp: "인앱", email: "이메일", sms: "SMS", kakao: "알림톡" };
  let eventsData    = [];
  let customCounts  = {};

  /* ── 탭 전환 ── */
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("tab-policy").style.display  = tab === "policy"  ? "" : "none";
      document.getElementById("tab-history").style.display = tab === "history" ? "" : "none";
      if (tab === "history") loadHistory();
    });
  });

  /* ── 초기화 ── */
  async function init() {
    const res = await api({ method: "GET", url: "/api/admin-notification-defaults" });
    if (!res.ok) {
      showToast("기본 정책을 불러오지 못했습니다.", "error");
      return;
    }
    const data = res.data?.data ?? res.data;
    eventsData   = data?.events ?? [];
    customCounts = data?.customCounts ?? {};

    renderKpi();
    renderPolicyTable();

    document.getElementById("loadingArea").style.display  = "none";
    document.getElementById("kpiGrid").style.display      = "";
    document.getElementById("policyContent").style.display = "";
  }

  /* ── KPI 카드 ── */
  function renderKpi() {
    const total = eventsData.length;
    const totalCustom = Object.values(customCounts).reduce((a, b) => a + b, 0);
    const forcedCount = eventsData.filter(e => e.forcedChannels.length > 0).length;

    document.getElementById("kpiGrid").innerHTML = `
      <div class="kpi-card"><div class="kpi-val">${total}</div><div class="kpi-lbl">전체 이벤트 유형</div></div>
      <div class="kpi-card"><div class="kpi-val">${forcedCount}</div><div class="kpi-lbl">필수 채널 이벤트</div></div>
      <div class="kpi-card"><div class="kpi-val">${totalCustom.toLocaleString()}</div><div class="kpi-lbl">사용자 커스텀 설정 수</div></div>
    `;
  }

  /* ── 정책 테이블 렌더링 ── */
  function renderPolicyTable() {
    const tbody = document.getElementById("policyTbody");
    tbody.innerHTML = "";

    for (const ev of eventsData) {
      const tr = document.createElement("tr");
      tr.dataset.event = ev.eventType;

      const customCnt = customCounts[ev.eventType] ?? 0;
      const updatedStr = ev.updatedAt
        ? new Date(ev.updatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })
        : "미설정";

      /* 이벤트명 셀 */
      const tdName = document.createElement("td");
      tdName.innerHTML = `
        <div class="event-name">${ev.label}</div>
        <div class="event-meta">최종 수정: ${updatedStr}
          ${customCnt > 0 ? `· 커스텀 ${customCnt}명` : ""}
        </div>
      `;
      tr.appendChild(tdName);

      /* 채널 체크박스 */
      for (const ch of CHANNELS) {
        const td = document.createElement("td");
        td.className = "ch-cell";
        const forced  = (ev.forcedChannels ?? []).includes(ch);
        const checked = (ev.defaultChannels ?? []).includes(ch);

        const wrap = document.createElement("div");
        wrap.className = "ch-check-wrap";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked  = checked;
        cb.disabled = forced;
        cb.dataset.event = ev.eventType;
        cb.dataset.ch    = ch;

        wrap.appendChild(cb);
        if (forced) {
          const lbl = document.createElement("span");
          lbl.className = "forced-label";
          lbl.textContent = "필수";
          wrap.appendChild(lbl);
        }
        td.appendChild(wrap);
        tr.appendChild(td);
      }

      /* 수정 버튼 셀 */
      const tdBtn = document.createElement("td");
      tdBtn.className = "action-cell";
      const btn = document.createElement("button");
      btn.className = "btn-save";
      btn.textContent = "수정";
      btn.dataset.event = ev.eventType;
      btn.addEventListener("click", () => saveRow(ev.eventType, btn));
      tdBtn.appendChild(btn);
      tr.appendChild(tdBtn);

      tbody.appendChild(tr);
    }
  }

  /* ── 행 저장 ── */
  async function saveRow(eventType, btn) {
    const checkboxes = document.querySelectorAll(
      `input[data-event="${eventType}"][data-ch]`
    );
    const channels = [];
    checkboxes.forEach(cb => { if (cb.checked) channels.push(cb.dataset.ch); });

    btn.disabled = true;
    btn.textContent = "저장 중…";

    const res = await api({
      method: "PATCH",
      url: "/api/admin-notification-defaults",
      body: { event_type: eventType, default_channels: channels },
    });

    btn.disabled = false;
    btn.textContent = "수정";

    if (res.ok) {
      const saved = res.data?.data ?? res.data;
      showToast(`"${eventType}" 기본 정책이 수정되었습니다.`);
      // 반환된 채널로 체크박스 동기화
      if (Array.isArray(saved?.default_channels)) {
        checkboxes.forEach(cb => {
          cb.checked = saved.default_channels.includes(cb.dataset.ch);
        });
      }
      // 최종수정 갱신
      const tr = btn.closest("tr");
      if (tr) {
        const meta = tr.querySelector(".event-meta");
        if (meta) {
          const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
          const customCnt = customCounts[eventType] ?? 0;
          meta.textContent = `최종 수정: ${today}${customCnt > 0 ? " · 커스텀 " + customCnt + "명" : ""}`;
        }
      }
    } else {
      showToast(`저장 실패: ${res.data?.error ?? "오류"}`, "error");
    }
  }

  /* ── 변경 이력 조회 ── */
  async function loadHistory() {
    const container = document.getElementById("historyContent");
    container.innerHTML = "<p style='color:#94a3b8;text-align:center;padding:32px;'>불러오는 중…</p>";

    const res = await api({ method: "GET", url: "/api/admin-notification-defaults?history=1" });
    if (!res.ok) {
      container.innerHTML = "<p style='color:#ef4444;text-align:center;padding:32px;'>이력 조회 실패</p>";
      return;
    }
    const history = (res.data?.data ?? res.data)?.history ?? [];

    if (history.length === 0) {
      container.innerHTML = "<p class='history-empty'>변경 이력이 없습니다.</p>";
      return;
    }

    const rows = history.map(r => {
      const changes = r.changes ?? {};
      const before = Array.isArray(changes.before) ? changes.before.join(", ") : "-";
      const after  = Array.isArray(changes.after)  ? changes.after.join(", ")  : "-";
      return `<tr>
        <td>${new Date(r.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
        <td>${r.target_id ?? "-"}</td>
        <td>${r.admin_name ?? "-"}</td>
        <td><span style="color:#64748b;">${before}</span> → <strong>${after}</strong></td>
      </tr>`;
    }).join("");

    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="history-table">
          <thead><tr>
            <th>변경일시</th><th>이벤트</th><th>변경자</th><th>변경 내용</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /* ── 토스트 ── */
  function showToast(msg, type = "") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  /* ── api 헬퍼 ── */
  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.adminApi === "function") return await window.adminApi({ method, url, body });
      if (typeof window.api === "function")      return await window.api({ method, url, body });
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
