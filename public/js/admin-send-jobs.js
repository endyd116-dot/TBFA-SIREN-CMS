// public/js/admin-send-jobs.js
// Phase 10 R3 — 발송 작업 목록·필터·새 발송 진입

(function () {
  "use strict";

  const PAGE_SIZE = 50;

  const STATUS_LABEL = {
    pending:    "대기",
    processing: "진행 중",
    completed:  "완료",
    failed:     "실패",
    cancelled:  "취소됨",
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

  function fmtScheduleTime(row) {
    if (row.scheduleType === "now") return "즉시";
    if (!row.scheduledAt) return "-";
    return formatLocalDateTime(row.scheduledAt);
  }

  function formatLocalDateTime(iso) {
    if (!iso) return "-";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const yyyy = d.getFullYear();
      const mm   = String(d.getMonth() + 1).padStart(2, "0");
      const dd   = String(d.getDate()).padStart(2, "0");
      const hh   = String(d.getHours()).padStart(2, "0");
      const mi   = String(d.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch {
      return String(iso);
    }
  }

  function progressPercent(row) {
    const total = Number(row.totalRecipients || 0);
    if (total <= 0) return 0;
    const done = Number(row.successCount || 0) + Number(row.failureCount || 0);
    const p = (done / total) * 100;
    return Math.min(100, Math.max(0, p));
  }

  function buildQuery() {
    const params = new URLSearchParams();
    const s    = $("fStatus").value;
    const from = $("fFrom").value;
    const to   = $("fTo").value;
    const q    = $("fSearch").value.trim();
    if (s)    params.set("status", s);
    if (from) params.set("from", from);
    if (to)   params.set("to", to);
    if (q)    params.set("q", q);
    params.set("limit",  String(PAGE_SIZE));
    params.set("offset", String((state.page - 1) * PAGE_SIZE));
    return params.toString();
  }

  async function load() {
    $("loadingArea").style.display = "";
    $("tableArea").style.display   = "none";

    const res = await api({ method: "GET", url: "/api/admin-send-jobs-list?" + buildQuery() });

    $("loadingArea").style.display = "none";
    $("tableArea").style.display   = "";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("발송 작업 조회 실패: " + detail, "error");
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
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">조건에 맞는 발송 작업이 없습니다.</td></tr>`;
    } else {
      tbody.innerHTML = state.rows.map(r => {
        const status = String(r.status || "pending");
        const successCnt = Number(r.successCount || 0);
        const failureCnt = Number(r.failureCount || 0);
        const total  = Number(r.totalRecipients || 0);
        const done   = successCnt + failureCnt;
        const pct    = progressPercent(r);

        /* ★ 2026-05-16: status='completed' 인데 실제로는 전부/일부 실패면 표시 라벨 분기 */
        let effLabel = STATUS_LABEL[status] || status;
        let effBadgeStyle = "";
        let effFillCls = (status === "completed") ? "completed"
                      : (status === "failed")    ? "failed"
                      : (status === "cancelled") ? "cancelled"
                      : "";
        if (status === "completed" && total > 0) {
          if (failureCnt > 0 && successCnt === 0) {
            effLabel = "실패";
            effBadgeStyle = "background:#fde7e9;color:#c0392b;border:1px solid #f5b8bd";
            effFillCls = "failed";
          } else if (failureCnt > 0 && successCnt > 0) {
            effLabel = "일부 실패";
            effBadgeStyle = "background:#fff3e0;color:#c47a00;border:1px solid #f5d8a8";
          }
        }

        const numLine = total > 0
          ? `${done.toLocaleString()} / ${total.toLocaleString()} (${pct.toFixed(1)}%)`
          : (status === "pending" ? "대기 중" : "-");
        /* 실패/취소 시 [재시도] 버튼, 일부 실패 시 [실패만 재발송] 버튼 */
        let actionBtn = "";
        if (status === "failed" || status === "cancelled") {
          actionBtn = `<button class="btn btn-sm" data-act="restart" data-id="${r.id}" title="작업 전체를 다시 시작 (대기열로 되돌림)">🔄 재시도</button>`;
        } else if (status === "completed" && failureCnt > 0) {
          actionBtn = `<button class="btn btn-sm" data-act="retry-failed" data-id="${r.id}" title="실패 수신자만 다시 발송">🔄 실패만 재발송</button>`;
        }
        return `
          <tr data-id="${r.id}">
            <td class="col-id">#${r.id}</td>
            <td class="col-name">${escapeHtml(r.name || "(이름 없음)")}</td>
            <td class="col-tpl">${escapeHtml(r.templateName || "-")}</td>
            <td class="col-grp">${escapeHtml(r.groupName || "-")}</td>
            <td class="col-time">${escapeHtml(fmtScheduleTime(r))}</td>
            <td class="col-status">
              <span class="badge badge-${status}" style="${effBadgeStyle}">${escapeHtml(effLabel)}</span>
            </td>
            <td class="col-progress">
              <div class="progress-num">${numLine}</div>
              <div class="progress-bar">
                <div class="progress-fill ${effFillCls}" style="width:${pct}%;"></div>
              </div>
            </td>
            <td class="col-action" style="white-space:nowrap">${actionBtn}</td>
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

  function bindEvents() {
    $("btnReload").addEventListener("click", () => { state.page = 1; load(); });
    $("fStatus").addEventListener("change", () => { state.page = 1; load(); });
    $("fFrom").addEventListener("change", () => { state.page = 1; load(); });
    $("fTo").addEventListener("change", () => { state.page = 1; load(); });
    $("fSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { state.page = 1; load(); }
    });

    $("btnNew").addEventListener("click", () => {
      window.location.href = "/admin-send-job-create.html";
    });

    $("btnPrev").addEventListener("click", () => {
      if (state.page > 1) { state.page--; load(); }
    });
    $("btnNext").addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
      if (state.page < totalPages) { state.page++; load(); }
    });

    $("tblBody").addEventListener("click", async (e) => {
      /* 액션 버튼 클릭이면 row navigation 차단 */
      const actBtn = e.target.closest("button[data-act]");
      if (actBtn) {
        e.stopPropagation();
        const id = actBtn.dataset.id;
        const act = actBtn.dataset.act;
        if (act === "restart") {
          if (!confirm("이 작업을 다시 시작하시겠습니까? 기존 수신자 기록이 초기화됩니다.")) return;
          actBtn.disabled = true; actBtn.textContent = "재시도 중…";
          try {
            const res = await api({ method: "POST", url: "/api/admin-send-job-restart?id=" + encodeURIComponent(id) });
            if (!res.ok) {
              const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
              showToast("재시도 실패: " + detail, "error");
              actBtn.disabled = false; actBtn.textContent = "🔄 재시도";
              return;
            }
            showToast(res.data?.message || "재시도 대기열에 등록되었습니다 (1분 내 자동 시작)");
            setTimeout(() => load(), 800);
          } catch (err) {
            showToast("재시도 실패: " + (err.message || err), "error");
            actBtn.disabled = false; actBtn.textContent = "🔄 재시도";
          }
        } else if (act === "retry-failed") {
          if (!confirm("실패한 수신자에게만 다시 발송하시겠습니까?")) return;
          actBtn.disabled = true; actBtn.textContent = "재시도 중…";
          try {
            const res = await api({ method: "POST", url: "/api/admin-send-job-retry-failed", body: { jobId: Number(id) } });
            if (!res.ok) {
              const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
              showToast("재시도 실패: " + detail, "error");
              actBtn.disabled = false; actBtn.textContent = "🔄 실패만 재발송";
              return;
            }
            showToast("재시도 요청 완료");
            setTimeout(() => load(), 800);
          } catch (err) {
            showToast("재시도 실패: " + (err.message || err), "error");
            actBtn.disabled = false; actBtn.textContent = "🔄 실패만 재발송";
          }
        }
        return;
      }
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const id = tr.dataset.id;
      window.location.href = "/admin-send-job-detail.html?id=" + encodeURIComponent(id);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    load();
  });
})();
