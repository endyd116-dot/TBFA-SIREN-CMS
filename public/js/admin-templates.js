// public/js/admin-templates.js
// Phase 10 R1 — 발송 템플릿 목록·삭제

(function () {
  "use strict";

  const PAGE_SIZE = 50;
  const CH_LABEL = {
    email: "이메일",
    sms:   "SMS",
    kakao: "카카오",
    inapp: "인앱",
  };
  const CAT_LABEL = {
    newsletter:   "뉴스레터",
    announcement: "일회성 공지",
    auto_trigger: "AI 트리거",
    campaign:     "캠페인",
    system:       "시스템",
  };

  let state = {
    page: 1,
    total: 0,
    rows: [],
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fmtDate(s) {
    if (!s) return "-";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("ko-KR");
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
    const ch  = $("fChannel").value;
    const cat = $("fCategory").value;
    const q   = $("fSearch").value.trim();
    const inc = $("fInactive").checked;
    if (ch)  params.set("channel", ch);
    if (cat) params.set("category", cat);
    if (q)   params.set("q", q);
    if (inc) params.set("includeInactive", "1");
    params.set("limit",  String(PAGE_SIZE));
    params.set("offset", String((state.page - 1) * PAGE_SIZE));
    return params.toString();
  }

  async function load() {
    $("loadingArea").style.display = "";
    $("tableArea").style.display   = "none";

    const res = await api({ method: "GET", url: "/api/admin-templates-list?" + buildQuery() });

    $("loadingArea").style.display = "none";
    $("tableArea").style.display   = "";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("템플릿 목록 조회 실패: " + detail, "error");
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
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">조건에 맞는 템플릿이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = state.rows.map(r => {
        const ch   = CH_LABEL[r.channel]   || r.channel || "-";
        const cat  = CAT_LABEL[r.category] || r.category || "-";
        const chCls = "badge badge-" + (r.channel || "inapp");
        const inactive = r.isActive === false;
        return `
          <tr class="${inactive ? "inactive" : ""}" data-id="${r.id}">
            <td class="col-id">#${r.id}</td>
            <td>
              ${escapeHtml(r.name || "(이름 없음)")}
              ${inactive ? `<span class="badge badge-off">비활성</span>` : ""}
            </td>
            <td><span class="${chCls}">${ch}</span></td>
            <td><span class="badge badge-cat">${cat}</span></td>
            <td class="col-date">${fmtDate(r.updatedAt)}</td>
            <td class="col-act">
              <button class="btn btn-sm" data-act="edit"  data-id="${r.id}">수정</button>
              <button class="btn btn-sm btn-danger" data-act="delete" data-id="${r.id}">삭제</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    // 페이지 정보
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    $("pageInfo").textContent = `${state.page} / ${totalPages}`;
    $("totalCount").textContent = state.total.toLocaleString();
    $("btnPrev").disabled = state.page <= 1;
    $("btnNext").disabled = state.page >= totalPages;
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    $("btnReload").addEventListener("click", () => { state.page = 1; load(); });
    $("fSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { state.page = 1; load(); }
    });
    [$("fChannel"), $("fCategory"), $("fInactive")].forEach(el =>
      el.addEventListener("change", () => { state.page = 1; load(); })
    );

    $("btnNew").addEventListener("click", () => {
      window.location.href = "/admin-template-edit.html";
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
        window.location.href = "/admin-template-edit.html?id=" + encodeURIComponent(id);
      } else if (act === "delete") {
        const row = state.rows.find(r => String(r.id) === String(id));
        const name = row?.name || ("#" + id);
        if (!confirm(`"${name}" 템플릿을 삭제(비활성)합니다. 계속할까요?`)) return;
        btn.disabled = true;
        const res = await api({
          method: "POST",
          url: "/api/admin-template-delete?id=" + encodeURIComponent(id),
        });
        btn.disabled = false;
        if (res.ok) {
          showToast("템플릿이 삭제되었습니다.");
          load();
        } else {
          const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
          showToast("삭제 실패: " + detail, "error");
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    load();
  });
})();
