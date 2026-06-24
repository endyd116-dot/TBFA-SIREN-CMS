// public/js/admin-send-job-detail.js
// Phase 10 R3 — 발송 상세 + 5초 폴링·취소·수신자 필터

(function () {
  "use strict";

  const REC_PAGE_SIZE = 50;
  const POLL_INTERVAL = 5000;

  const STATUS_LABEL = {
    pending:    "대기",
    preparing:  "준비 중",
    processing: "진행 중",
    completed:  "완료",
    failed:     "실패",
    cancelled:  "취소됨",
  };

  const REC_STATUS_LABEL = {
    pending:   "대기",
    sending:   "발송 중",
    sent:      "성공",
    failed:    "실패",
    cancelled: "취소됨",
  };

  const CHANNEL_LABEL = {
    email: "이메일",
    sms:   "SMS",
    kakao: "카카오톡",
    inapp: "앱 알림",
  };

  let jobId = null;
  let pollTimer = null;
  let completedToasted = false;

  let recState = {
    filter: "",
    page:   1,
    total:  0,
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

  function isTerminal(status) {
    return status === "completed" || status === "failed" || status === "cancelled";
  }

  /* ── 작업 정보 + 진행률 ── */
  async function loadDetail() {
    const res = await api({
      method: "GET",
      url: "/api/admin-send-job-detail?id=" + encodeURIComponent(jobId),
    });
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("작업 조회 실패: " + detail, "error");
      $("infoBox").innerHTML = `<div class="empty-state" style="color:#b91c1c;">${escapeHtml(detail)}</div>`;
      return null;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const job = payload.job ?? res.data?.job ?? null;
    if (!job) {
      $("infoBox").innerHTML = `<div class="empty-state">작업을 찾을 수 없습니다.</div>`;
      return null;
    }
    renderInfo(job);
    renderProgress(job);
    return job;
  }

  function renderInfo(job) {
    $("pageTitle").textContent = `발송 상세 #${job.id}: ${job.name || ""}`;
    $("pageDesc").textContent  = "작업 정보, 실시간 진행률, 수신자별 결과를 확인합니다.";

    const channel = CHANNEL_LABEL[job.channel] || job.channel || "-";
    const sched   = (job.scheduleType === "now")
      ? "즉시"
      : (job.scheduledAt ? formatLocalDateTime(job.scheduledAt) : "-");
    const startedAt   = job.startedAt   ? formatLocalDateTime(job.startedAt)   : "-";
    const completedAt = job.completedAt ? formatLocalDateTime(job.completedAt) : "-";
    const createdAt   = job.createdAt   ? formatLocalDateTime(job.createdAt)   : "-";

    $("infoBox").innerHTML = `
      <div class="info-grid">
        <div class="label">템플릿</div>
        <div>${escapeHtml(job.templateName || "-")} <span style="color:#94a3b8;">/ 채널: ${escapeHtml(channel)}</span></div>

        <div class="label">수신자 그룹</div>
        <div>${escapeHtml(job.groupName || "-")}</div>

        <div class="label">발송 시각</div>
        <div>${escapeHtml(sched)}</div>

        <div class="label">시작 시각</div>
        <div>${escapeHtml(startedAt)}</div>

        <div class="label">완료 시각</div>
        <div>${escapeHtml(completedAt)}</div>

        <div class="label">등록 시각</div>
        <div>${escapeHtml(createdAt)}</div>
      </div>
    `;
  }

  function renderProgress(job) {
    const status  = String(job.status || "pending");
    const label   = STATUS_LABEL[status] || status;
    const total   = Number(job.totalRecipients || 0);
    const sent    = Number(job.successCount || 0);
    const failed  = Number(job.failureCount || 0);
    const stats   = job.recipientStats || {};
    const pending = (typeof stats.pending === "number")
      ? stats.pending
      : Math.max(0, total - sent - failed);

    const done = sent + failed;
    const pct  = total > 0 ? (done / total) * 100 : 0;

    const badge = $("statusBadge");
    badge.className = "badge badge-" + status;
    badge.textContent = label;

    const fill = $("progressFill");
    fill.style.width = `${pct.toFixed(1)}%`;
    fill.className = "progress-fill " + (
      status === "completed" ? "completed" :
      status === "failed"    ? "failed" :
      status === "cancelled" ? "cancelled" : ""
    );
    $("progressNum").textContent = `${pct.toFixed(1)}%`;

    $("statTotal").textContent  = total.toLocaleString();
    $("statSent").textContent   = sent.toLocaleString();
    $("statFailed").textContent = failed.toLocaleString();
    $("statPending").textContent = pending.toLocaleString();

    const pctOf = (n) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-";
    $("statSentPct").textContent    = pctOf(sent);
    $("statFailedPct").textContent  = pctOf(failed);
    $("statPendingPct").textContent = pctOf(pending);

    // AD-058: 정책상 발송 안 함(skipped) 표시 — 총계 = 성공+실패+대기+취소+발송안함
    const skipped = Number(stats.skipped || 0);
    const elSkip = $("statSkipped");
    if (elSkip) elSkip.textContent = skipped.toLocaleString();
    const elSkipPct = $("statSkippedPct");
    if (elSkipPct) elSkipPct.textContent = pctOf(skipped);

    if (job.lastError) {
      $("errorBox").style.display = "";
      $("errorBox").textContent = "최근 오류: " + job.lastError;
    } else {
      $("errorBox").style.display = "none";
    }

    // 취소 버튼: pending·processing만 노출
    const canCancel = (status === "pending" || status === "processing");
    $("btnCancel").style.display = canCancel ? "" : "none";

    // 재발송 버튼: 완료·실패 상태에서 실패자 있을 때
    const canRetry = isTerminal(status) && Number(job.failureCount || 0) > 0;
    $("btnRetryFailed").style.display = canRetry ? "" : "none";

    // 라이브 표시
    $("liveDot").style.display = (status === "processing") ? "" : "none";

    // 폴링 종료
    if (isTerminal(status)) {
      stopPolling();
      if (status === "completed" && !completedToasted) {
        completedToasted = true;
        showToast("발송이 완료되었습니다.");
      }
    }
  }

  /* ── 폴링 (가벼운 progress API) ── */
  async function pollProgress() {
    const res = await api({
      method: "GET",
      url: "/api/admin-send-job-progress?id=" + encodeURIComponent(jobId),
    });
    if (!res.ok) return; // 폴링 중에는 토스트 X (잡음 방지)
    const payload = res.data?.data ?? res.data ?? {};
    const p = payload.progress ?? res.data?.progress ?? null;
    if (!p) return;

    // 진행률 갱신만 — 정보 영역은 그대로
    const total   = Number(p.totalRecipients || 0);
    const sent    = Number(p.successCount || 0);
    const failed  = Number(p.failureCount || 0);
    const status  = String(p.status || "pending");
    const label   = STATUS_LABEL[status] || status;
    const done    = sent + failed;
    const pct     = total > 0 ? (done / total) * 100 : 0;
    const pending = Math.max(0, total - sent - failed);

    const badge = $("statusBadge");
    badge.className = "badge badge-" + status;
    badge.textContent = label;

    const fill = $("progressFill");
    fill.style.width = `${pct.toFixed(1)}%`;
    fill.className = "progress-fill " + (
      status === "completed" ? "completed" :
      status === "failed"    ? "failed" :
      status === "cancelled" ? "cancelled" : ""
    );
    $("progressNum").textContent = `${pct.toFixed(1)}%`;

    $("statTotal").textContent  = total.toLocaleString();
    $("statSent").textContent   = sent.toLocaleString();
    $("statFailed").textContent = failed.toLocaleString();
    $("statPending").textContent = pending.toLocaleString();
    const pctOf = (n) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "-";
    $("statSentPct").textContent    = pctOf(sent);
    $("statFailedPct").textContent  = pctOf(failed);
    $("statPendingPct").textContent = pctOf(pending);

    // AD-058: 정책상 발송 안 함(skipped) 표시 — 총계 = 성공+실패+대기+취소+발송안함
    const skipped = Number(stats.skipped || 0);
    const elSkip = $("statSkipped");
    if (elSkip) elSkip.textContent = skipped.toLocaleString();
    const elSkipPct = $("statSkippedPct");
    if (elSkipPct) elSkipPct.textContent = pctOf(skipped);

    if (p.lastError) {
      $("errorBox").style.display = "";
      $("errorBox").textContent = "최근 오류: " + p.lastError;
    } else {
      $("errorBox").style.display = "none";
    }

    const canCancel = (status === "pending" || status === "processing");
    $("btnCancel").style.display = canCancel ? "" : "none";
    $("liveDot").style.display = (status === "processing") ? "" : "none";

    if (isTerminal(status)) {
      stopPolling();
      // 종료 시 정보 영역도 한 번 다시 받아서 startedAt·completedAt 업데이트
      loadDetail();
      // 수신자 목록도 마지막 상태 반영
      loadRecipients();
      if (status === "completed" && !completedToasted) {
        completedToasted = true;
        showToast("발송이 완료되었습니다.");
      }
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollProgress, POLL_INTERVAL);
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* ── 수신자 목록 ── */
  async function loadRecipients() {
    const params = new URLSearchParams();
    params.set("id", String(jobId));
    if (recState.filter) params.set("status", recState.filter);
    params.set("limit",  String(REC_PAGE_SIZE));
    params.set("offset", String((recState.page - 1) * REC_PAGE_SIZE));

    const res = await api({
      method: "GET",
      url: "/api/admin-send-job-recipients?" + params.toString(),
    });
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      $("recBody").innerHTML = `<tr><td colspan="7" class="empty-state" style="color:#b91c1c;">${escapeHtml(detail)}</td></tr>`;
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const rows  = payload.recipients ?? res.data?.recipients ?? [];
    const total = payload.total ?? res.data?.total ?? rows.length;
    /* ★ 2026-05-17: 작업이 pending이면 백엔드가 그룹 미리보기 멤버를 반환하고
       isPreview=true 플래그를 함께 보냄. 화면에 '발송 대기 — 미리보기' 안내. */
    const isPreview = payload.isPreview ?? res.data?.isPreview ?? false;
    recState.total = total;
    renderRecipients(rows, isPreview);
  }

  function renderRecipients(rows, isPreview) {
    /* 미리보기 안내 배너 */
    const banner = isPreview
      ? `<div style="margin-bottom:10px;padding:9px 14px;background:#fff7ed;border-left:3px solid #ea580c;border-radius:6px;font-size:13px;color:#9a3412">⏳ 발송 대기 중 — 아래는 발송 예정 회원 미리보기입니다. cron이 실행되면 실제 수신자 스냅샷으로 갱신됩니다.</div>`
      : "";
    const bannerEl = document.getElementById("recPreviewBanner");
    if (bannerEl) bannerEl.innerHTML = banner;
    if (!rows.length) {
      $("recBody").innerHTML = `<tr><td colspan="7" class="empty-state">조건에 맞는 수신자가 없습니다.</td></tr>`;
    } else {
      $("recBody").innerHTML = rows.map(r => {
        const st = String(r.status || "pending");
        /* ★ 2026-05-16: 카카오 알림톡 정책 스킵은 cron이 status='sent'+error='[정책 스킵]...'
           으로 박음. 화면엔 '성공'이 아니라 '발송 안 함'으로 표시해야 오해 방지. */
        const err = String(r.error || "");
        const isPolicySkip = st === "sent" && err.startsWith("[정책 스킵]");
        const stLabel = isPolicySkip ? "발송 안 함" : (REC_STATUS_LABEL[st] || st);
        const badgeClass = isPolicySkip
          ? "cancelled"
          : (st === "sent" ? "completed" : st === "failed" ? "failed" : st === "cancelled" ? "cancelled" : "pending");
        const sentAt  = r.sentAt ? formatLocalDateTime(r.sentAt) : "-";
        const retryBtn = (st === "failed")
          ? `<button class="btn btn-sm" onclick="doRetryOne(${r.id})">재발송</button>`
          : "";
        return `
          <tr>
            <td class="col-id">#${r.memberId ?? "-"}</td>
            <td class="col-name">${escapeHtml(r.memberName || "-")}</td>
            <td class="col-mail">${escapeHtml(r.memberEmail || "-")}</td>
            <td class="col-stat"><span class="badge badge-${badgeClass}">${escapeHtml(stLabel)}</span></td>
            <td class="col-time">${escapeHtml(sentAt)}</td>
            <td class="col-err">${escapeHtml(err)}</td>
            <td>${retryBtn}</td>
          </tr>
        `;
      }).join("");
    }
    const totalPages = Math.max(1, Math.ceil(recState.total / REC_PAGE_SIZE));
    $("recPageInfo").textContent = `${recState.page} / ${totalPages}`;
    $("recTotal").textContent = recState.total.toLocaleString();
    $("recPrev").disabled = recState.page <= 1;
    $("recNext").disabled = recState.page >= totalPages;
  }

  /* ── 재발송 ── */
  async function doRetryFailed() {
    if (!confirm("실패한 수신자에게만 재발송하겠습니까?")) return;
    $("btnRetryFailed").disabled = true;
    const res = await api({ method: "POST", url: `/api/admin-send-job-retry-failed?id=${encodeURIComponent(jobId)}` });
    $("btnRetryFailed").disabled = false;
    if (!res.ok) {
      showToast("재발송 실패: " + (res.data?.error || res.data?.detail || "오류"), "error");
      return;
    }
    // AD-059: 서버 응답 키는 retriedCount — 기존 recipientsCreated만 읽어 항상 '?'였음
    const d = res.data?.data || res.data || {};
    const n = d.retriedCount ?? d.recipientsCreated ?? "?";
    showToast(`${n}명에게 재발송이 등록되었습니다.`);
  }

  async function doRetryOne(recipientId) {
    if (!confirm("이 수신자에게 개별 재발송하겠습니까?")) return;
    const res = await api({ method: "POST", url: `/api/admin-send-job-retry?id=${encodeURIComponent(jobId)}`, body: { recipientId } });
    if (!res.ok) {
      showToast("재발송 실패: " + (res.data?.error || res.data?.detail || "오류"), "error");
      return;
    }
    showToast("1명에게 재발송이 등록되었습니다.");
  }

  window.doRetryOne = doRetryOne;

  /* ── 취소 ── */
  async function doCancel() {
    if (!confirm("이 발송을 취소합니다. 이미 발송된 수신자는 제외됩니다. 계속할까요?")) return;
    $("btnCancel").disabled = true;
    const res = await api({
      method: "POST",
      url: "/api/admin-send-job-cancel?id=" + encodeURIComponent(jobId),
    });
    $("btnCancel").disabled = false;
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      // 완료된 작업 거부 분기
      if (res.status === 400 && /완료|이미/.test(String(detail))) {
        showToast("이미 완료된 발송은 취소할 수 없습니다.", "error");
      } else {
        showToast("취소 실패: " + detail, "error");
      }
      return;
    }
    showToast("발송이 취소되었습니다. 이미 발송된 수신자는 제외됩니다.");
    stopPolling();
    await loadDetail();
    await loadRecipients();
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    $("btnCancel").addEventListener("click", doCancel);
    $("btnRetryFailed").addEventListener("click", doRetryFailed);

    document.querySelectorAll(".filter-tabs button").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-tabs button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        recState.filter = btn.dataset.filter || "";
        recState.page = 1;
        loadRecipients();
      });
    });

    $("recPrev").addEventListener("click", () => {
      if (recState.page > 1) { recState.page--; loadRecipients(); }
    });
    $("recNext").addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(recState.total / REC_PAGE_SIZE));
      if (recState.page < totalPages) { recState.page++; loadRecipients(); }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    jobId = params.get("id");
    if (!jobId) {
      showToast("잘못된 접근입니다 (id 없음).", "error");
      $("infoBox").innerHTML = `<div class="empty-state">유효한 발송 작업 ID가 필요합니다.</div>`;
      return;
    }
    bindEvents();
    const job = await loadDetail();
    await loadRecipients();
    if (job && !isTerminal(String(job.status || ""))) {
      startPolling();
    }
  });

  window.addEventListener("beforeunload", stopPolling);
})();
