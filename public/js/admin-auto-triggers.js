// public/js/admin-auto-triggers.js
// Phase 10 R4 — AI 자동 발송 트리거 목록·토글·삭제·이력

(function () {
  "use strict";

  const PAGE_SIZE = 50;

  const TYPE_LABEL = {
    churn_risk:     "이탈 위험",
    campaign_slump: "캠페인 부진",
    welcome:        "신규 환영",
    anniversary:    "후원 기념",
    birthday:       "생일",
    custom_filter:  "운영자 정의",
  };

  const CHANNEL_LABEL = {
    email: "이메일",
    sms:   "SMS",
    kakao: "카카오",
    inapp: "인앱",
  };

  let state = { page: 1, total: 0, rows: [] };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function formatLocalDateTime(iso) {
    if (!iso) return "-";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return String(iso); }
  }

  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.adminApi === "function") return await window.adminApi({ method, url, body });
      if (typeof window.api === "function")      return await window.api({ method, url, body });
      const opts = { method, credentials: "include", headers: { "Content-Type": "application/json" } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, data: { error: String(err) } };
    }
  }

  function showToast(msg, type = "") {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3500);
  }

  window.goEdit = function (id) {
    const url = id
      ? `/admin-auto-trigger-edit.html?id=${id}`
      : `/admin-auto-trigger-edit.html`;
    window.location.href = url;
  };

  async function loadList() {
    const type   = $("filterType").value;
    const active = $("filterActive").value;
    const offset = (state.page - 1) * PAGE_SIZE;

    let url = `/api/admin-auto-triggers-list?limit=${PAGE_SIZE}&offset=${offset}`;
    if (type)   url += `&triggerType=${encodeURIComponent(type)}`;
    if (active) url += `&isActive=${encodeURIComponent(active)}`;

    const res = await api({ url });
    const rows  = res.data?.rows  || res.data?.data?.rows  || [];
    const total = res.data?.total || res.data?.data?.total || 0;

    if (!res.ok) {
      showToast("목록 불러오기 실패: " + (res.data?.error || "오류"), "error");
      $("tableBody").innerHTML = `<tr><td colspan="9" class="empty">불러오기 실패</td></tr>`;
      return;
    }

    state.rows  = rows;
    state.total = total;
    renderTable();
    renderPagination();
  }

  function renderTable() {
    const tbody = $("tableBody");
    if (!state.rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty">등록된 트리거가 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.rows.map(r => `
      <tr>
        <td>${escapeHtml(r.id)}</td>
        <td><strong>${escapeHtml(r.name)}</strong>${r.description ? `<br><span style="color:#94a3b8;font-size:0.78rem">${escapeHtml(r.description).slice(0,40)}</span>` : ""}</td>
        <td><span class="trigger-type-label">${escapeHtml(TYPE_LABEL[r.triggerType] || r.triggerType)}</span></td>
        <td>${escapeHtml(CHANNEL_LABEL[r.channel] || r.channel)}</td>
        <td>${escapeHtml(r.cooldownDays)}일</td>
        <td>${escapeHtml(r.totalSent ?? 0)}명</td>
        <td style="font-size:0.78rem;color:#64748b">${formatLocalDateTime(r.lastRunAt)}</td>
        <td>
          <label class="toggle-wrap" title="${r.isActive ? "비활성화" : "활성화"}">
            <input type="checkbox" class="toggle-switch" ${r.isActive ? "checked" : ""}
              onchange="toggleTrigger(${r.id}, this.checked)" />
          </label>
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm" onclick="goEdit(${r.id})">편집</button>
          <button class="btn btn-sm" onclick="openHistory(${r.id}, '${escapeHtml(r.name)}')" style="margin-left:4px">이력</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTrigger(${r.id})" style="margin-left:4px">삭제</button>
        </td>
      </tr>
    `).join("");
  }

  function renderPagination() {
    const pages = Math.ceil(state.total / PAGE_SIZE) || 1;
    const el = $("pagination");
    el.innerHTML = `
      <button class="btn btn-sm" onclick="changePage(${state.page - 1})" ${state.page <= 1 ? "disabled" : ""}>← 이전</button>
      <span>${state.page} / ${pages} (총 ${state.total}건)</span>
      <button class="btn btn-sm" onclick="changePage(${state.page + 1})" ${state.page >= pages ? "disabled" : ""}>다음 →</button>
    `;
  }

  window.changePage = function (p) {
    const pages = Math.ceil(state.total / PAGE_SIZE) || 1;
    if (p < 1 || p > pages) return;
    state.page = p;
    loadList();
  };

  window.toggleTrigger = async function (id, isActive) {
    const res = await api({ method: "POST", url: `/api/admin-auto-trigger-toggle?id=${id}`, body: { isActive } });
    if (!res.ok) {
      showToast("토글 실패: " + (res.data?.error || "오류"), "error");
      loadList();
      return;
    }
    if (isActive) {
      showToast("트리거가 활성화되었습니다. 30분 안에 첫 평가가 시작됩니다.", "success");
    } else {
      showToast("트리거가 비활성화되었습니다. 진행 중인 발송은 영향 없음.", "success");
    }
  };

  window.deleteTrigger = async function (id) {
    if (!confirm("이 트리거를 삭제하시겠습니까? 실행 이력도 함께 삭제됩니다.")) return;
    const res = await api({ method: "POST", url: `/api/admin-auto-trigger-delete?id=${id}` });
    if (!res.ok) {
      showToast("삭제 실패: " + (res.data?.error || "오류"), "error");
      return;
    }
    showToast("트리거가 삭제되었습니다.", "success");
    loadList();
  };

  window.openHistory = async function (id, name) {
    $("historyModalTitle").textContent = `실행 이력 — ${name}`;
    $("historyContent").innerHTML = `<p style="color:#94a3b8;text-align:center">불러오는 중…</p>`;
    $("historyModal").classList.add("open");

    const res = await api({ url: `/api/admin-auto-trigger-runs?triggerId=${id}&limit=100` });
    const rows = res.data?.runs || res.data?.data?.runs || [];

    if (!res.ok || !rows.length) {
      $("historyContent").innerHTML = `<p style="text-align:center;color:#94a3b8">실행 이력이 없습니다.</p>`;
      return;
    }

    const STATUS_RUN = { sent: "발송됨", cooldown_skip: "쿨다운 스킵", condition_unmet: "조건 미충족" };

    $("historyContent").innerHTML = `
      <table class="tbl" style="border:none">
        <thead>
          <tr>
            <th>회원 ID</th>
            <th>회원명</th>
            <th>상태</th>
            <th>발송 작업</th>
            <th>평가 시각</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.memberId)}</td>
              <td>${escapeHtml(r.memberName || "-")}</td>
              <td>${escapeHtml(STATUS_RUN[r.status] || r.status)}</td>
              <td>${r.sendJobId ? `#${r.sendJobId}` : "-"}</td>
              <td style="font-size:0.78rem;color:#64748b">${formatLocalDateTime(r.ranAt)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  };

  window.closeHistoryModal = function () {
    $("historyModal").classList.remove("open");
  };

  $("historyModal").addEventListener("click", function (e) {
    if (e.target === this) closeHistoryModal();
  });

  $("filterType").addEventListener("change", () => { state.page = 1; loadList(); });
  $("filterActive").addEventListener("change", () => { state.page = 1; loadList(); });

  loadList();
})();
