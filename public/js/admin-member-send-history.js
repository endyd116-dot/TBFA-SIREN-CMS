// public/js/admin-member-send-history.js
// Phase 10 R4 — 어드민: 회원별 발송 이력

(function () {
  "use strict";

  const PAGE_SIZE = 50;

  const CHANNEL_LABEL = { email: "이메일", sms: "SMS", kakao: "카카오", inapp: "인앱" };
  const STATUS_LABEL  = { sent: "성공", failed: "실패", pending: "대기", sending: "발송 중", cancelled: "취소" };

  let memberId = null;
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

  async function init() {
    const params = new URLSearchParams(location.search);
    memberId = params.get("memberId") ? Number(params.get("memberId")) : null;

    if (!memberId) {
      $("tableBody").innerHTML = `<tr><td colspan="8" class="empty">memberId 파라미터가 필요합니다.</td></tr>`;
      return;
    }

    $("pageTitle").textContent = `회원 발송 이력 #${memberId}`;

    // 뒤로가기 링크: referer가 있으면 회원 상세로
    const ref = document.referrer;
    if (ref && ref.includes("admin-member")) {
      const bl = $("backLink");
      bl.href = ref;
      bl.onclick = null;
      bl.textContent = "← 회원 상세로";
    }

    // 회원 정보 표시
    const mRes = await api({ url: `/api/admin-member-detail?id=${memberId}` });
    const m = mRes.data?.member || mRes.data?.data?.member || mRes.data;
    if (m && m.name) {
      $("memberInfo").style.display = "flex";
      $("memberInfo").innerHTML = `
        <span style="font-size:1.5rem"></span>
        <div>
          <strong>${escapeHtml(m.name)}</strong> (#${memberId})
          ${m.email ? `<span style="color:#64748b;margin-left:8px">${escapeHtml(m.email)}</span>` : ""}
        </div>
      `;
    }

    setupFilters();
    loadList();
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

    let url = `/api/admin-member-send-history?memberId=${memberId}&limit=${PAGE_SIZE}&offset=${offset}`;
    if (channel) url += `&channel=${encodeURIComponent(channel)}`;
    if (from)    url += `&from=${encodeURIComponent(from)}`;
    if (to)      url += `&to=${encodeURIComponent(to)}`;

    const res = await api({ url });
    const rows  = res.data?.history  || res.data?.data?.history  || res.data?.rows  || res.data?.data?.rows || [];
    const total = res.data?.total    || res.data?.data?.total    || 0;

    if (!res.ok) {
      showToast("이력 불러오기 실패: " + (res.data?.error || "오류"), "error");
      $("tableBody").innerHTML = `<tr><td colspan="8" class="empty">불러오기 실패</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="8" class="empty">발송 이력이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.rows.map(r => {
      const badgeClass = r.status === "sent" ? "badge-sent" : r.status === "failed" ? "badge-failed" : "badge-pending";
      const opened  = r.openCount  > 0 ? `<span class="track-icon" title="열람 ${r.openCount}회"></span>` : `<span style="color:#cbd5e1">—</span>`;
      const clicked = r.clickCount > 0 ? `<span class="track-icon" title="클릭 ${r.clickCount}회"></span>` : `<span style="color:#cbd5e1">—</span>`;
      return `
        <tr onclick="openBodyModal(${r.id})">
          <td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml(r.jobName || "-")}</td>
          <td>${escapeHtml(CHANNEL_LABEL[r.channel] || r.channel)}</td>
          <td style="font-size:0.8rem;color:#475569">${formatLocalDateTime(r.sentAt)}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(STATUS_LABEL[r.status] || r.status)}</span></td>
          <td>${opened}</td>
          <td>${clicked}</td>
          <td style="font-size:0.78rem;color:#b91c1c;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${escapeHtml(r.error || "")}
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderPagination() {
    const pages = Math.ceil(state.total / PAGE_SIZE) || 1;
    $("pagination").innerHTML = `
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

  window.openBodyModal = function (recipientId) {
    const row = state.rows.find(r => r.id === recipientId);
    if (!row) return;

    $("modalTitle").textContent  = `발송 본문 — ${CHANNEL_LABEL[row.channel] || row.channel}`;
    $("modalSubject").textContent = row.renderedSubject ? `제목: ${row.renderedSubject}` : "";
    $("modalBody").textContent   = row.renderedBody || "(본문 없음)";
    $("bodyModal").classList.add("open");
  };

  window.closeModal = function () { $("bodyModal").classList.remove("open"); };

  $("bodyModal").addEventListener("click", function (e) {
    if (e.target === this) closeModal();
  });

  init();
})();
