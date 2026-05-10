// public/js/admin-recipient-groups.js
// Phase 10 R2 — 수신자 그룹 목록·삭제·회원 보기

(function () {
  "use strict";

  const PAGE_SIZE = 50;
  const MM_PAGE_SIZE = 50;

  let state = {
    page: 1,
    total: 0,
    rows: [],
  };

  let mmState = {
    groupId: null,
    groupName: "",
    page: 1,
    total: 0,
    members: [],
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ── api 헬퍼 ── */
  async function api({ method = "GET", url, body }) {
    try {
      if (typeof window.adminApi === "function") return await window.adminApi({ method, url, body });
      if (typeof window.api === "function")      return await window.api({ method, url, body });
      const opts = {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };
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

  function buildQuery() {
    const params = new URLSearchParams();
    const q   = $("fSearch").value.trim();
    const inc = $("fInactive").checked;
    if (q)   params.set("q", q);
    if (inc) params.set("includeInactive", "1");
    params.set("limit",  String(PAGE_SIZE));
    params.set("offset", String((state.page - 1) * PAGE_SIZE));
    return params.toString();
  }

  async function load() {
    $("loadingArea").style.display = "";
    $("tableArea").style.display   = "none";

    const res = await api({ method: "GET", url: "/api/admin-recipient-groups-list?" + buildQuery() });

    $("loadingArea").style.display = "none";
    $("tableArea").style.display   = "";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("그룹 목록 조회 실패: " + detail, "error");
      state.rows  = [];
      state.total = 0;
      renderTable();
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    state.rows  = payload.rows  ?? res.data?.rows  ?? [];
    state.total = payload.total ?? res.data?.total ?? state.rows.length;
    renderTable();
  }

  function renderTable() {
    const tbody = $("tblBody");
    if (!state.rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">조건에 맞는 그룹이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = state.rows.map(r => {
        const inactive = r.isActive === false;
        const cnt = (typeof r.memberCount === "number") ? r.memberCount.toLocaleString() : "-";
        return `
          <tr class="${inactive ? "inactive" : ""}" data-id="${r.id}">
            <td class="col-id">#${r.id}</td>
            <td class="col-name">
              ${escapeHtml(r.name || "(이름 없음)")}
              ${inactive ? `<span class="badge badge-off">비활성</span>` : ""}
            </td>
            <td class="col-sum">${escapeHtml(r.criteriaSummary || "-")}</td>
            <td class="col-count">
              ${cnt}
              <button class="btn-link" data-act="members" data-id="${r.id}" data-name="${escapeHtml(r.name || "")}">회원 보기</button>
            </td>
            <td class="col-act">
              <button class="btn btn-sm" data-act="edit"  data-id="${r.id}">수정</button>
              <button class="btn btn-sm btn-danger" data-act="delete" data-id="${r.id}">삭제</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    $("pageInfo").textContent = `${state.page} / ${totalPages}`;
    $("totalCount").textContent = state.total.toLocaleString();
    $("btnPrev").disabled = state.page <= 1;
    $("btnNext").disabled = state.page >= totalPages;
  }

  /* ── 회원 보기 모달 ── */
  function openMembersModal(groupId, groupName) {
    mmState = { groupId, groupName, page: 1, total: 0, members: [] };
    $("mmTitle").textContent = `회원 목록 — ${groupName || "#" + groupId}`;
    $("membersModal").classList.add("show");
    loadMembers();
  }
  function closeMembersModal() {
    $("membersModal").classList.remove("show");
    mmState.groupId = null;
  }
  async function loadMembers() {
    $("mmBody").innerHTML = "불러오는 중…";
    const params = new URLSearchParams();
    params.set("id", String(mmState.groupId));
    params.set("limit",  String(MM_PAGE_SIZE));
    params.set("offset", String((mmState.page - 1) * MM_PAGE_SIZE));
    const res = await api({ method: "GET", url: "/api/admin-recipient-group-members?" + params.toString() });
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("회원 목록 조회 실패: " + detail, "error");
      $("mmBody").innerHTML = `<div class="empty-state">${escapeHtml(detail)}</div>`;
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    mmState.members = payload.members ?? res.data?.members ?? [];
    mmState.total   = payload.total   ?? res.data?.total   ?? mmState.members.length;
    renderMembersModal();
  }
  function renderMembersModal() {
    if (!mmState.members.length) {
      $("mmBody").innerHTML = `<div class="empty-state">현재 시점에 해당 회원이 없습니다.</div>`;
    } else {
      const rows = mmState.members.map(m => `
        <tr>
          <td>#${m.id}</td>
          <td>${escapeHtml(m.name || "-")}</td>
          <td>${escapeHtml(m.email || "-")}</td>
          <td>${escapeHtml(m.type || "-")}</td>
          <td>${escapeHtml(m.status || "-")}</td>
        </tr>
      `).join("");
      $("mmBody").innerHTML = `
        <table class="member-list">
          <thead>
            <tr>
              <th style="width:60px;">ID</th>
              <th>이름</th>
              <th>이메일</th>
              <th style="width:80px;">유형</th>
              <th style="width:80px;">상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }
    const totalPages = Math.max(1, Math.ceil(mmState.total / MM_PAGE_SIZE));
    $("mmPageInfo").textContent = `${mmState.page} / ${totalPages}`;
    $("mmTotal").textContent = mmState.total.toLocaleString();
    $("mmPrev").disabled = mmState.page <= 1;
    $("mmNext").disabled = mmState.page >= totalPages;
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    $("btnReload").addEventListener("click", () => { state.page = 1; load(); });
    $("fSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { state.page = 1; load(); }
    });
    $("fInactive").addEventListener("change", () => { state.page = 1; load(); });

    $("btnNew").addEventListener("click", () => {
      window.location.href = "/admin-recipient-group-edit.html";
    });

    $("btnPrev").addEventListener("click", () => {
      if (state.page > 1) { state.page--; load(); }
    });
    $("btnNext").addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
      if (state.page < totalPages) { state.page++; load(); }
    });

    $("tblBody").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === "edit") {
        window.location.href = "/admin-recipient-group-edit.html?id=" + encodeURIComponent(id);
      } else if (act === "delete") {
        const row = state.rows.find(r => String(r.id) === String(id));
        const name = row?.name || ("#" + id);
        if (!confirm(`"${name}" 그룹을 삭제(비활성)합니다. 계속할까요?`)) return;
        btn.disabled = true;
        const res = await api({
          method: "POST",
          url: "/api/admin-recipient-group-delete?id=" + encodeURIComponent(id),
        });
        btn.disabled = false;
        if (res.ok) {
          showToast("수신자 그룹이 삭제되었습니다.");
          load();
        } else {
          const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
          showToast("삭제 실패: " + detail, "error");
        }
      } else if (act === "members") {
        openMembersModal(id, btn.dataset.name || "");
      }
    });

    /* 모달 */
    $("mmClose").addEventListener("click", closeMembersModal);
    $("membersModal").addEventListener("click", (e) => {
      if (e.target === $("membersModal")) closeMembersModal();
    });
    $("mmPrev").addEventListener("click", () => {
      if (mmState.page > 1) { mmState.page--; loadMembers(); }
    });
    $("mmNext").addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(mmState.total / MM_PAGE_SIZE));
      if (mmState.page < totalPages) { mmState.page++; loadMembers(); }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    load();
  });
})();
