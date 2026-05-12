// public/js/admin-auto-trigger-edit.js
// Phase 10 R4 — AI 트리거 신규/수정 편집 화면

(function () {
  "use strict";

  const TYPE_COND_MAP = {
    churn_risk:     ["cChurnMinScore", "cChurnMaxScore", "cChurnMinDays"],
    campaign_slump: ["cSlumpThreshold"],
    welcome:        ["cWelcomeDays"],
    anniversary:    ["cAnnivMonths"],
    birthday:       [],
    custom_filter:  ["cCustomGroup"],
  };

  const CHANNEL_LABEL = { email: "이메일", sms: "SMS", kakao: "카카오", inapp: "인앱" };

  let editId = null;
  let templates = [];
  let groups    = [];

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
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

  /* ── 초기화 ── */
  async function init() {
    const params = new URLSearchParams(location.search);
    editId = params.get("id") ? Number(params.get("id")) : null;
    if (editId) $("pageTitle").textContent = `트리거 수정 #${editId}`;

    await Promise.all([loadTemplates(), loadGroups()]);
    setupTypeGrid();
    setupChannelChange();

    if (editId) await loadExisting();
  }

  async function loadTemplates() {
    /* admin-templates-list 정식 엔드포인트. 응답: { ok, rows, total } */
    const res = await api({ url: "/api/admin-templates-list?limit=200" });
    templates = res.data?.rows || res.data?.data?.rows
              || res.data?.templates || res.data?.data?.templates || [];
    /* 활성만 필터 (서버에 includeInactive 미전송 시 기본 활성만) */
    templates = templates.filter(t => t.isActive !== false);
    renderTemplateOptions();
  }

  async function loadGroups() {
    const res = await api({ url: "/api/admin-recipient-groups-list?isActive=true&limit=200" });
    groups = res.data?.groups || res.data?.data?.groups
           || res.data?.rows  || res.data?.data?.rows || [];

    const selGroup = $("fGroup");
    selGroup.innerHTML = `<option value="">기본 — 트리거 종류에 따라 자동 선택</option>` +
      groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${g.memberCount ?? "?"}명)</option>`).join("");

    const selCustom = $("cCustomGroup");
    selCustom.innerHTML = `<option value="">그룹 선택</option>` +
      groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${g.memberCount ?? "?"}명)</option>`).join("");
  }

  function renderTemplateOptions() {
    const channel = document.querySelector("input[name='channel']:checked")?.value || "email";
    const filtered = templates.filter(t => !t.channel || t.channel === channel);
    $("fTemplate").innerHTML =
      `<option value="">템플릿 선택</option>` +
      filtered.map(t => `<option value="${t.id}">[${escapeHtml(CHANNEL_LABEL[t.channel] || t.channel)}] ${escapeHtml(t.name)}</option>`).join("");
  }

  function setupChannelChange() {
    document.querySelectorAll("input[name='channel']").forEach(radio => {
      radio.addEventListener("change", renderTemplateOptions);
    });
  }

  function setupTypeGrid() {
    const options = document.querySelectorAll(".type-option");
    options.forEach(opt => {
      const radio = opt.querySelector("input[type='radio']");
      opt.addEventListener("click", () => {
        options.forEach(o => o.classList.remove("selected"));
        opt.classList.add("selected");
        radio.checked = true;
        updateCondPanel(radio.value);
      });
    });
  }

  function updateCondPanel(type) {
    document.querySelectorAll(".cond-panel").forEach(p => p.classList.remove("active"));
    const panel = $("cond_" + type);
    if (panel) panel.classList.add("active");
  }

  async function loadExisting() {
    const res = await api({ url: `/api/admin-auto-trigger-detail?id=${editId}` });
    const t = res.data?.trigger || res.data?.data?.trigger || res.data;
    if (!res.ok || !t) {
      showToast("트리거 불러오기 실패", "error");
      return;
    }

    $("fName").value    = t.name || "";
    $("fDesc").value    = t.description || "";
    $("fCooldown").value = t.cooldownDays ?? 30;
    $("fActive").checked = !!t.isActive;

    if (t.templateId)        $("fTemplate").value = t.templateId;
    if (t.recipientGroupId)  $("fGroup").value    = t.recipientGroupId;

    // 채널
    const chRadio = document.querySelector(`input[name='channel'][value='${t.channel}']`);
    if (chRadio) { chRadio.checked = true; renderTemplateOptions(); if (t.templateId) $("fTemplate").value = t.templateId; }

    // 종류
    const typeOpt = document.querySelector(`.type-option[data-type='${t.triggerType}']`);
    if (typeOpt) {
      document.querySelectorAll(".type-option").forEach(o => o.classList.remove("selected"));
      typeOpt.classList.add("selected");
      typeOpt.querySelector("input").checked = true;
      updateCondPanel(t.triggerType);
    }

    // 조건 값 채우기
    const c = t.conditions || {};
    if (t.triggerType === "churn_risk") {
      if (c.min_score !== undefined) $("cChurnMinScore").value = c.min_score;
      if (c.max_score !== undefined) $("cChurnMaxScore").value = c.max_score;
      if (c.min_days_inactive !== undefined) $("cChurnMinDays").value = c.min_days_inactive;
    } else if (t.triggerType === "campaign_slump") {
      if (c.threshold_percent !== undefined) $("cSlumpThreshold").value = c.threshold_percent;
    } else if (t.triggerType === "welcome") {
      if (c.days_after_signup !== undefined) $("cWelcomeDays").value = c.days_after_signup;
    } else if (t.triggerType === "anniversary") {
      if (c.every_months !== undefined) $("cAnnivMonths").value = c.every_months;
    } else if (t.triggerType === "custom_filter") {
      if (t.recipientGroupId) $("cCustomGroup").value = t.recipientGroupId;
    }
  }

  /* ── 조건 수집 ── */
  function collectConditions(type) {
    if (type === "churn_risk") {
      return {
        min_score:         Number($("cChurnMinScore").value),
        max_score:         Number($("cChurnMaxScore").value),
        min_days_inactive: Number($("cChurnMinDays").value),
      };
    }
    if (type === "campaign_slump") {
      return { threshold_percent: Number($("cSlumpThreshold").value) };
    }
    if (type === "welcome") {
      return { days_after_signup: Number($("cWelcomeDays").value) };
    }
    if (type === "anniversary") {
      return { every_months: Number($("cAnnivMonths").value) };
    }
    if (type === "birthday") return {};
    if (type === "custom_filter") {
      return {};
    }
    return {};
  }

  /* ── 미리보기 (preflight) ── */
  window.runPreflight = async function () {
    const templateId = Number($("fTemplate").value);
    const groupId    = $("cCustomGroup").value
      ? Number($("cCustomGroup").value)
      : ($("fGroup").value ? Number($("fGroup").value) : undefined);

    if (!templateId) { showToast("템플릿을 먼저 선택하세요.", "error"); return; }

    $("previewArea").innerHTML = `<p style="color:#94a3b8">미리보기 불러오는 중…</p>`;
    const body = { templateId };
    if (groupId) body.recipientGroupId = groupId;

    const res = await api({ method: "POST", url: "/api/admin-send-job-preflight", body });
    const pf = res.data?.preflight || res.data?.data?.preflight;

    if (!res.ok || !pf) {
      $("previewArea").innerHTML = `<p style="color:#b91c1c">미리보기 실패: ${escapeHtml(res.data?.error || "오류")}</p>`;
      return;
    }

    const warns = (pf.warnings || []).map(w => `<li>${escapeHtml(w)}</li>`).join("");

    $("previewArea").innerHTML = `
      <div class="preview-box">
        <div class="preview-title">후보 ${pf.estimatedRecipients ?? "-"}명 · 채널: ${escapeHtml(CHANNEL_LABEL[pf.channel] || pf.channel)}</div>
        ${warns ? `<ul style="color:#b45309;font-size:0.82rem;margin:6px 0;padding-left:18px">${warns}</ul>` : ""}
        ${pf.renderedSample ? `
          <div class="sample-card">
            <strong>${escapeHtml(pf.renderedSample.memberName || "샘플")}</strong>님 발송 샘플<br/>
            ${pf.renderedSample.subject ? `<em style="color:#475569">제목: ${escapeHtml(pf.renderedSample.subject)}</em><br/>` : ""}
            <div style="margin-top:6px;white-space:pre-wrap;font-size:0.82rem;color:#334155">${escapeHtml((pf.renderedSample.body || "").slice(0, 300))}</div>
          </div>` : ""}
      </div>
    `;
  };

  /* ── 저장 ── */
  window.saveTrigger = async function () {
    const name       = $("fName").value.trim();
    const desc       = $("fDesc").value.trim();
    const triggerType = document.querySelector("input[name='triggerType']:checked")?.value;
    const channel    = document.querySelector("input[name='channel']:checked")?.value;
    const templateId = Number($("fTemplate").value);
    const groupId    = $("fGroup").value ? Number($("fGroup").value) : null;
    const cooldown   = Number($("fCooldown").value);
    const isActive   = $("fActive").checked;

    // 기본 검증
    if (!name) { showToast("이름을 입력해 주세요.", "error"); return; }
    if (!triggerType) { showToast("트리거 종류를 선택해 주세요.", "error"); return; }
    if (!channel) { showToast("채널을 선택해 주세요.", "error"); return; }
    if (!templateId) { showToast("템플릿을 선택해 주세요.", "error"); return; }
    if (cooldown < 1 || cooldown > 365) { showToast("쿨다운은 1~365일 사이여야 합니다.", "error"); return; }

    // 종류별 조건 검증
    if (triggerType === "custom_filter" && !$("cCustomGroup").value) {
      showToast("운영자 정의 필터는 수신자 그룹을 선택해야 합니다.", "error"); return;
    }

    const conditions = collectConditions(triggerType);

    const body = {
      name, description: desc, triggerType, conditions, templateId,
      recipientGroupId: (triggerType === "custom_filter" && $("cCustomGroup").value)
        ? Number($("cCustomGroup").value)
        : (groupId || null),
      channel, cooldownDays: cooldown, isActive,
    };

    $("btnSave").disabled = true;
    const url    = editId ? `/api/admin-auto-trigger-update?id=${editId}` : "/api/admin-auto-trigger-create";
    const res    = await api({ method: "POST", url, body });
    $("btnSave").disabled = false;

    if (!res.ok) {
      showToast("저장 실패: " + (res.data?.error || "오류"), "error");
      return;
    }

    showToast(editId ? "트리거가 수정되었습니다." : "트리거가 등록되었습니다. 검토 후 활성화해 주세요.", "success");
    setTimeout(() => { window.location.href = "/admin-auto-triggers.html"; }, 1500);
  };

  init();
})();
