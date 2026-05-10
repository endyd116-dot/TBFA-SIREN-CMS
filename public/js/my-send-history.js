// public/js/my-send-history.js
// Phase 10 R4 — 사용자 마이페이지: 받은 메시지 이력

(function () {
  "use strict";

  const PAGE_SIZE = 30;

  const CHANNEL_LABEL = { email: "이메일", sms: "SMS", kakao: "카카오", inapp: "인앱" };
  const STATUS_LABEL  = { sent: "수신됨", failed: "실패", pending: "대기", cancelled: "취소" };

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

  async function api({ url }) {
    try {
      if (typeof window.userApi === "function") return await window.userApi({ url });
      if (typeof window.api === "function")     return await window.api({ url });
      const r = await fetch(url, { credentials: "include" });
      if (r.status === 401) { window.location.href = "/login.html"; return { ok: false, data: {} }; }
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

  function setupFilters() {
    $("filterChannel").addEventListener("change", () => { state.page = 1; loadList(); });
    $("filterFrom").addEventListener("change",    () => { state.page = 1; loadList(); });
    $("filterTo").addEventListener("change",      () => { state.page = 1; loadList(); });
  }

  async function loadList() {
    const channel = $("filterChannel").value;
    const from    = $("filterFrom").value;
    const to      = $("filterTo").value;
    const offset  = (state.page - 1) * PAGE_SIZE;

    let url = `/api/user-my-send-history?limit=${PAGE_SIZE}&offset=${offset}`;
    if (channel) url += `&channel=${encodeURIComponent(channel)}`;
    if (from)    url += `&from=${encodeURIComponent(from)}`;
    if (to)      url += `&to=${encodeURIComponent(to)}`;

    const res = await api({ url });
    const rows  = res.data?.history  || res.data?.data?.history  || res.data?.rows  || res.data?.data?.rows || [];
    const total = res.data?.total    || res.data?.data?.total    || 0;

    if (!res.ok) {
      showToast("이력 불러오기 실패: " + (res.data?.error || "오류"), "error");
      $("msgList").innerHTML = `<div class="empty">불러오기 실패</div>`;
      return;
    }

    state.rows  = rows;
    state.total = total;
    renderList();
    renderPagination();
  }

  function renderList() {
    const list = $("msgList");
    if (!state.rows.length) {
      list.innerHTML = `<div class="empty">받은 메시지가 없습니다.</div>`;
      return;
    }

    list.innerHTML = state.rows.map(r => {
      const chBadge = `<span class="badge badge-${r.channel}">${escapeHtml(CHANNEL_LABEL[r.channel] || r.channel)}</span>`;
      const stBadge = r.status === "sent"
        ? `<span class="badge badge-sent">${STATUS_LABEL.sent}</span>`
        : `<span class="badge badge-failed">${STATUS_LABEL[r.status] || r.status}</span>`;
      const preview = (r.renderedBody || "").replace(/<[^>]*>/g, "").slice(0, 80);

      return `
        <div class="msg-card" onclick="openBodyModal(${r.id})">
          <div class="msg-card-header">
            <div class="msg-card-title">${escapeHtml(r.jobName || "협회 메시지")}</div>
            <div class="msg-card-meta">
              ${chBadge} ${stBadge}
              <span>${formatLocalDateTime(r.sentAt)}</span>
            </div>
          </div>
          ${r.renderedSubject ? `<div style="font-size:0.85rem;font-weight:500;margin-bottom:4px;color:#334155">${escapeHtml(r.renderedSubject)}</div>` : ""}
          <div class="msg-card-preview">${escapeHtml(preview)}</div>
        </div>
      `;
    }).join("");
  }

  function renderPagination() {
    const pages = Math.ceil(state.total / PAGE_SIZE) || 1;
    $("pagination").innerHTML = `
      <button class="btn btn-sm" onclick="changePage(${state.page - 1})" ${state.page <= 1 ? "disabled" : ""}>← 이전</button>
      <span>${state.page} / ${pages}</span>
      <button class="btn btn-sm" onclick="changePage(${state.page + 1})" ${state.page >= pages ? "disabled" : ""}>다음 →</button>
    `;
  }

  window.changePage = function (p) {
    const pages = Math.ceil(state.total / PAGE_SIZE) || 1;
    if (p < 1 || p > pages) return;
    state.page = p;
    loadList();
  };

  window.openBodyModal = function (recipientId) {
    const row = state.rows.find(r => r.id === recipientId);
    if (!row) return;

    const chLabel = CHANNEL_LABEL[row.channel] || row.channel;
    $("modalMeta").textContent   = `${chLabel} · ${formatLocalDateTime(row.sentAt)}`;
    $("modalSubject").textContent = row.renderedSubject || "";
    // 사용자에게는 평문만 표시 (HTML 렌더링 X — 보안)
    const bodyText = (row.renderedBody || "(내용 없음)").replace(/<[^>]*>/g, "").trim();
    $("modalBody").textContent   = bodyText;
    $("bodyModal").classList.add("open");
  };

  window.closeModal = function () { $("bodyModal").classList.remove("open"); };

  $("bodyModal").addEventListener("click", function (e) {
    if (e.target === this) closeModal();
  });

  setupFilters();
  loadList();
})();
