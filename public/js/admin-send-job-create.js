// public/js/admin-send-job-create.js
// Phase 10 R3 — 새 발송 만들기 (즉시·예약 토글, 자동 preflight 미리보기)

(function () {
  "use strict";

  const CHANNEL_LABEL = {
    email: "이메일",
    sms:   "SMS",
    kakao: "카카오톡",
    inapp: "앱 알림",
  };

  let templates = [];
  let groups    = [];
  let preflightTimer = null;
  let lastPreflightKey = null;
  let submitting = false;

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

  /* ── 템플릿·그룹 셀렉트 채우기 ── */
  async function loadTemplates() {
    const params = new URLSearchParams();
    params.set("limit", "200");
    const res = await api({ method: "GET", url: "/api/admin-templates-list?" + params.toString() });
    if (!res.ok) {
      $("fTemplate").innerHTML = `<option value="">(불러오기 실패)</option>`;
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("템플릿 목록 조회 실패: " + detail, "error");
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const rows = payload.rows ?? res.data?.rows ?? [];
    templates = rows.filter(r => r.isActive !== false);
    if (!templates.length) {
      $("fTemplate").innerHTML = `<option value="">(활성 템플릿 없음)</option>`;
      return;
    }
    const opts = [`<option value="">선택</option>`].concat(
      templates.map(t => {
        const ch = CHANNEL_LABEL[t.channel] || t.channel || "-";
        return `<option value="${t.id}">${escapeHtml(t.name || "(이름 없음)")} (${escapeHtml(ch)})</option>`;
      })
    );
    $("fTemplate").innerHTML = opts.join("");
  }

  async function loadGroups() {
    const params = new URLSearchParams();
    params.set("limit", "200");
    const res = await api({ method: "GET", url: "/api/admin-recipient-groups-list?" + params.toString() });
    if (!res.ok) {
      $("fGroup").innerHTML = `<option value="">(불러오기 실패)</option>`;
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("수신자 그룹 조회 실패: " + detail, "error");
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const rows = payload.rows ?? res.data?.rows ?? [];
    groups = rows.filter(r => r.isActive !== false);
    if (!groups.length) {
      $("fGroup").innerHTML = `<option value="">(활성 그룹 없음)</option>`;
      return;
    }
    const opts = [`<option value="">선택</option>`].concat(
      groups.map(g => {
        const cnt = (typeof g.memberCount === "number") ? `${g.memberCount.toLocaleString()}명` : "-";
        return `<option value="${g.id}">${escapeHtml(g.name || "(이름 없음)")} (${escapeHtml(cnt)})</option>`;
      })
    );
    $("fGroup").innerHTML = opts.join("");
  }

  /* ── preflight 미리보기 ── */
  function schedulePreflight() {
    if (preflightTimer) clearTimeout(preflightTimer);
    preflightTimer = setTimeout(runPreflight, 350);
  }

  async function runPreflight() {
    const tplId = $("fTemplate").value;
    const grpId = $("fGroup").value;
    if (!tplId || !grpId) {
      $("previewBox").innerHTML = `<div class="preview-empty">템플릿과 그룹을 모두 선택하면 자동으로 미리보기가 표시됩니다.</div>`;
      lastPreflightKey = null;
      return;
    }
    const key = `${tplId}|${grpId}`;
    if (key === lastPreflightKey) return;
    lastPreflightKey = key;

    $("previewBox").innerHTML = `<div class="preview-empty"><span class="spinner"></span>미리보기를 불러오는 중…</div>`;

    const res = await api({
      method: "POST",
      url: "/api/admin-send-job-preflight",
      body: { templateId: Number(tplId), recipientGroupId: Number(grpId) },
    });

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      $("previewBox").innerHTML = `<div class="preview-empty" style="color:#b91c1c;">미리보기 실패: ${escapeHtml(detail)}</div>`;
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    const pf = payload.preflight ?? res.data?.preflight ?? null;
    if (!pf) {
      $("previewBox").innerHTML = `<div class="preview-empty">미리보기 데이터가 없습니다.</div>`;
      return;
    }
    renderPreflight(pf);
  }

  function renderPreflight(pf) {
    const channel = CHANNEL_LABEL[pf.channel] || pf.channel || "-";
    const cnt     = (typeof pf.estimatedRecipients === "number") ? pf.estimatedRecipients.toLocaleString() : "-";
    const sample  = pf.renderedSample;

    let sampleHtml = "";
    if (sample) {
      const subjPart = sample.subject
        ? `<div class="subject">${escapeHtml(sample.subject)}</div>`
        : "";
      sampleHtml = `
        <div class="preview-sample-title">
          샘플 1명 (그룹의 첫 회원${sample.memberName ? " — " + escapeHtml(sample.memberName) : ""}으로 변수 자동 치환):
        </div>
        <div class="preview-sample">
          ${subjPart}
          <div class="body">${escapeHtml(sample.body || "")}</div>
        </div>
      `;
    } else {
      sampleHtml = `<div class="preview-empty" style="text-align:left; padding:8px 0;">미리보기 샘플을 만들 수 없습니다 (그룹에 회원이 없을 수 있습니다).</div>`;
    }

    let warningsHtml = "";
    const warnings = Array.isArray(pf.warnings) ? pf.warnings : [];
    if (warnings.length) {
      warningsHtml = `
        <div class="preview-warnings">
          ⚠ 경고:
          <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
        </div>
      `;
    }

    $("previewBox").innerHTML = `
      <div class="preview-meta">
        <div><span class="label">채널</span> ${escapeHtml(channel)}</div>
        <div><span class="label">템플릿</span> ${escapeHtml(pf.templateName || "-")}</div>
        <div><span class="label">그룹</span> ${escapeHtml(pf.groupName || "-")}</div>
        <div><span class="label">대상</span> ${escapeHtml(cnt)}명</div>
      </div>
      ${sampleHtml}
      ${warningsHtml}
    `;
  }

  /* ── 등록 ── */
  function getScheduleType() {
    const checked = document.querySelector('input[name="scheduleType"]:checked');
    return checked ? checked.value : "now";
  }

  function toIsoLocal(dtLocalValue) {
    // datetime-local 값은 'YYYY-MM-DDTHH:MM' (로컬). Date(...) 파싱 시 로컬로 해석됨.
    if (!dtLocalValue) return null;
    const d = new Date(dtLocalValue);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function validateForm() {
    const name = $("fName").value.trim();
    if (!name)            return { ok: false, msg: "발송 이름을 입력해 주세요." };
    if (name.length > 200) return { ok: false, msg: "발송 이름은 200자 이하여야 합니다." };

    const tplId = $("fTemplate").value;
    if (!tplId) return { ok: false, msg: "템플릿을 선택해 주세요." };

    const grpId = $("fGroup").value;
    if (!grpId) return { ok: false, msg: "수신자 그룹을 선택해 주세요." };

    const sType = getScheduleType();
    let scheduledAt = null;
    if (sType === "scheduled") {
      const v = $("fScheduledAt").value;
      if (!v) return { ok: false, msg: "예약 시각을 입력해 주세요." };
      const d = new Date(v);
      if (isNaN(d.getTime())) return { ok: false, msg: "예약 시각 형식이 올바르지 않습니다." };
      const minFuture = Date.now() + 60 * 1000;
      if (d.getTime() < minFuture) {
        return { ok: false, msg: "예약 시각은 현재로부터 1분 이후여야 합니다." };
      }
      scheduledAt = d.toISOString();
    }

    return {
      ok: true,
      body: {
        name,
        templateId:       Number(tplId),
        recipientGroupId: Number(grpId),
        scheduleType:     sType,
        ...(scheduledAt ? { scheduledAt } : {}),
      },
    };
  }

  async function submit() {
    if (submitting) return;
    const v = validateForm();
    if (!v.ok) {
      showToast(v.msg, "error");
      return;
    }
    submitting = true;
    $("btnSubmit").disabled = true;
    $("btnSubmit").textContent = "등록 중…";

    const res = await api({
      method: "POST",
      url: "/api/admin-send-job-create",
      body: v.body,
    });

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("등록 실패: " + detail, "error");
      submitting = false;
      $("btnSubmit").disabled = false;
      $("btnSubmit").textContent = "등록";
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    const id = payload.id ?? res.data?.id;
    if (v.body.scheduleType === "now") {
      showToast("발송이 등록되었습니다. 곧 시작됩니다.");
    } else {
      const when = $("fScheduledAt").value.replace("T", " ");
      showToast(`${when}에 자동 발송됩니다.`);
    }

    setTimeout(() => {
      if (id) {
        window.location.href = "/admin-send-job-detail.html?id=" + encodeURIComponent(id);
      } else {
        window.location.href = "/admin-send-jobs.html";
      }
    }, 700);
  }

  function bindEvents() {
    document.querySelectorAll('input[name="scheduleType"]').forEach(el => {
      el.addEventListener("change", () => {
        const t = getScheduleType();
        $("scheduledRow").style.display = (t === "scheduled") ? "" : "none";
      });
    });
    $("fTemplate").addEventListener("change", schedulePreflight);
    $("fGroup").addEventListener("change", schedulePreflight);

    $("btnCancel").addEventListener("click", () => {
      window.location.href = "/admin-send-jobs.html";
    });
    $("btnSubmit").addEventListener("click", submit);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await Promise.all([loadTemplates(), loadGroups()]);
  });
})();
