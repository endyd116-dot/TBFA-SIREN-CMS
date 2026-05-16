// public/js/admin-template-edit.js
// Phase 10 R1 — 발송 템플릿 신규/수정 + 미리보기

(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ── 상태 ── */
  const params = new URLSearchParams(location.search);
  const editId = params.get("id");
  let isEdit = !!editId;

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

  /* ── 변수 정의 표 ── */
  function addVarRow(v = { key: "", label: "", sample: "" }) {
    const tbody = $("varTbody");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="var-key"    value="${escapeHtml(v.key)}"    placeholder="예) member_name" /></td>
      <td><input type="text" class="var-label"  value="${escapeHtml(v.label)}"  placeholder="예) 회원이름" /></td>
      <td><input type="text" class="var-sample" value="${escapeHtml(v.sample)}" placeholder="예) 홍길동" /></td>
      <td class="col-act"><button type="button" class="btn-icon" title="삭제">×</button></td>
    `;
    tr.querySelector(".btn-icon").addEventListener("click", () => tr.remove());
    tbody.appendChild(tr);
  }

  function readVariables() {
    const rows = $("varTbody").querySelectorAll("tr");
    const list = [];
    rows.forEach(tr => {
      const key    = tr.querySelector(".var-key").value.trim();
      const label  = tr.querySelector(".var-label").value.trim();
      const sample = tr.querySelector(".var-sample").value.trim();
      if (!key && !label && !sample) return;
      list.push({ key, label, sample });
    });
    return list;
  }

  /* ── 채널 동적 동작 ── */
  function getChannel() {
    const checked = document.querySelector('input[name="channel"]:checked');
    return checked ? checked.value : "";
  }

  function applyChannelUI() {
    const ch = getChannel();
    const subjectCard = $("subjectCard");
    const charCounter = $("charCounter");
    const kakaoNotice = $("kakaoNotice");
    const alimtalkCard = $("alimtalkCard"); /* ★ 2026-05-16 */

    // 제목 칸: 이메일·인앱만 노출
    if (ch === "email" || ch === "inapp") {
      subjectCard.style.display = "";
    } else {
      subjectCard.style.display = "none";
    }

    // SMS 글자수 카운터
    if (ch === "sms") {
      charCounter.style.display = "";
      updateCharCounter();
    } else {
      charCounter.style.display = "none";
    }

    // 카카오 안내 + 알리고 전용 입력 카드
    kakaoNotice.style.display = (ch === "kakao") ? "" : "none";
    if (alimtalkCard) alimtalkCard.style.display = (ch === "kakao") ? "" : "none";
  }

  function updateCharCounter() {
    const len = $("fBody").value.length;
    const el  = $("charCounter");
    const over = len > 2000;
    el.classList.toggle("over", over);
    el.textContent = `현재 ${len}자 / SMS 90자 / LMS 2000자`;
  }

  /* ── 변수 참조 검증 (클라이언트 사전 점검) ── */
  function findUsedKeys(text) {
    if (!text) return [];
    const set = new Set();
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) set.add(m[1]);
    return Array.from(set);
  }

  function findUndefinedKeys(template, vars) {
    const used    = findUsedKeys(template);
    const defined = new Set((vars || []).map(v => v.key));
    return used.filter(k => !defined.has(k));
  }

  /* ── 폼 → 페이로드 ── */
  function buildPayload() {
    const channel = getChannel();
    const name      = $("fName").value.trim();
    const category  = $("fCategory").value;
    const subject   = $("fSubject").value;
    const bodyTemplate = $("fBody").value;
    const variables = readVariables();
    const payload = {
      name, channel, category,
      subject: (channel === "email" || channel === "inapp") ? subject : null,
      bodyTemplate,
      variables,
    };
    /* ★ 2026-05-16: 카카오 채널이면 알리고 전용 필드 함께 페이로드에 포함 */
    if (channel === "kakao") {
      payload.alimtalkTemplateCode = ($("fAlimtalkTemplateCode")?.value || "").trim();
      payload.alimtalkReviewStatus = $("fAlimtalkReviewStatus")?.value || "";
      const btnText = ($("fAlimtalkButtonJson")?.value || "").trim();
      if (btnText) {
        try {
          payload.alimtalkButtonJson = JSON.parse(btnText);
        } catch (_) {
          /* 검증 단계에서 잡힘 */
          payload.alimtalkButtonJson = btnText;
        }
      } else {
        payload.alimtalkButtonJson = null;
      }
    }
    return payload;
  }

  function validate(payload) {
    if (!payload.name) return "템플릿 이름을 입력해 주세요.";
    if (!payload.channel) return "채널을 선택해 주세요.";
    if (!payload.bodyTemplate || !payload.bodyTemplate.trim()) return "본문을 입력해 주세요.";
    if ((payload.channel === "email" || payload.channel === "inapp")
        && (!payload.subject || !payload.subject.trim())) {
      return "이메일·인앱 채널은 제목을 입력해 주세요.";
    }
    // 변수 참조 검증
    const undef = [
      ...findUndefinedKeys(payload.bodyTemplate, payload.variables),
      ...findUndefinedKeys(payload.subject || "", payload.variables),
    ];
    if (undef.length) {
      const list = undef.map(k => "{{" + k + "}}").join(", ");
      return "본문에 정의되지 않은 변수가 있습니다: " + list;
    }
    /* ★ 2026-05-16: 카카오 채널 추가 검증 */
    if (payload.channel === "kakao") {
      if (!payload.alimtalkTemplateCode) {
        return "카카오 알림톡은 알리고 템플릿 코드(예: UH_7533)가 필요합니다.";
      }
      if (!/^[A-Za-z0-9_]{1,50}$/.test(payload.alimtalkTemplateCode)) {
        return "알리고 템플릿 코드는 영문·숫자·언더스코어만 가능합니다.";
      }
      if (!payload.alimtalkReviewStatus) {
        return "카카오 알림톡 심사 상태를 선택해 주세요.";
      }
      if (!["pending","approved","rejected"].includes(payload.alimtalkReviewStatus)) {
        return "심사 상태 값이 올바르지 않습니다.";
      }
      /* 버튼 JSON 검증 — 입력했다면 유효한 JSON이어야 */
      if (payload.alimtalkButtonJson && typeof payload.alimtalkButtonJson === "string") {
        return "버튼 JSON 형식이 올바르지 않습니다. JSON 객체로 입력해 주세요.";
      }
    }
    return null;
  }

  /* ── 저장 ── */
  async function save() {
    const payload = buildPayload();
    const err = validate(payload);
    if (err) { showToast(err, "error"); return; }

    const btn = $("btnSave");
    btn.disabled = true;
    btn.textContent = "저장 중…";

    const url = isEdit
      ? "/api/admin-template-update?id=" + encodeURIComponent(editId)
      : "/api/admin-template-create";
    const res = await api({ method: "POST", url, body: payload });

    btn.disabled = false;
    btn.textContent = "저장";

    if (res.ok) {
      showToast(isEdit ? "템플릿이 수정되었습니다." : "템플릿이 등록되었습니다.");
      setTimeout(() => { window.location.href = "/admin-templates.html"; }, 600);
    } else {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("저장 실패: " + detail, "error");
    }
  }

  /* ── 미리보기 ── */
  function openPreview() {
    const payload = buildPayload();
    if (!payload.bodyTemplate || !payload.bodyTemplate.trim()) {
      showToast("본문을 입력해 주세요.", "error");
      return;
    }

    // 변수 입력 폼 채우기
    const form = $("previewForm");
    form.innerHTML = "";
    if (!payload.variables.length) {
      form.innerHTML = `<p class="helper-text">정의된 변수가 없습니다. 본문 그대로 미리보기 합니다.</p>`;
    } else {
      payload.variables.forEach(v => {
        const wrap = document.createElement("div");
        wrap.innerHTML = `
          <label>${escapeHtml(v.label || v.key)} <span style="color:#94a3b8;">(${escapeHtml(v.key)})</span></label>
          <input type="text" data-pv-key="${escapeHtml(v.key)}" value="${escapeHtml(v.sample || "")}" />
        `;
        form.appendChild(wrap);
      });
    }

    $("previewResult").style.display   = "none";
    $("previewWarnings").style.display = "none";
    $("previewModal").classList.add("show");
  }

  async function runPreview() {
    const payload = buildPayload();
    const overrides = {};
    document.querySelectorAll("#previewForm input[data-pv-key]").forEach(inp => {
      overrides[inp.dataset.pvKey] = inp.value;
    });

    const btn = $("btnPreviewRun");
    btn.disabled = true;
    btn.textContent = "처리 중…";

    const res = await api({
      method: "POST",
      url: "/api/admin-template-preview",
      body: {
        channel:      payload.channel,
        subject:      payload.subject,
        bodyTemplate: payload.bodyTemplate,
        variables:    payload.variables,
        overrides,
      },
    });

    btn.disabled = false;
    btn.textContent = "치환 결과 보기";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("미리보기 실패: " + detail, "error");
      return;
    }

    const data = res.data?.data ?? res.data ?? {};
    const preview = data.preview ?? res.data?.preview ?? {};
    const warnings = data.warnings ?? res.data?.warnings ?? [];

    $("pvSubject").textContent = preview.subject || "(제목 없음)";
    $("pvBody").textContent    = preview.body || "";
    $("pvSubject").style.display = (payload.channel === "email" || payload.channel === "inapp") ? "" : "none";
    $("previewResult").style.display = "";

    if (Array.isArray(warnings) && warnings.length) {
      $("previewWarnings").innerHTML = `
        <strong>주의</strong>
        <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      `;
      $("previewWarnings").style.display = "";
    } else {
      $("previewWarnings").style.display = "none";
    }
  }

  function closePreview() {
    $("previewModal").classList.remove("show");
  }

  /* ── 수정 모드 데이터 로드 ── */
  async function loadExisting() {
    $("formArea").style.display    = "none";
    $("loadingArea").style.display = "";

    const res = await api({
      method: "GET",
      url: "/api/admin-template-detail?id=" + encodeURIComponent(editId),
    });

    $("loadingArea").style.display = "none";
    $("formArea").style.display    = "";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("템플릿 조회 실패: " + detail, "error");
      return;
    }

    const data = res.data?.data ?? res.data ?? {};
    const t = data.template ?? res.data?.template ?? null;
    if (!t) {
      showToast("템플릿 데이터를 찾을 수 없습니다.", "error");
      return;
    }

    $("pageTitle").textContent = `템플릿 수정 #${t.id}`;
    $("fName").value     = t.name || "";
    $("fCategory").value = t.category || "newsletter";

    const chRadio = document.querySelector(`input[name="channel"][value="${t.channel}"]`);
    if (chRadio) chRadio.checked = true;

    $("fSubject").value = t.subject || "";
    $("fBody").value    = t.bodyTemplate || "";

    $("varTbody").innerHTML = "";
    const vars = Array.isArray(t.variables) ? t.variables : [];
    if (vars.length === 0) {
      addVarRow();
    } else {
      vars.forEach(v => addVarRow(v));
    }

    /* ★ 2026-05-16: 카카오 전용 필드 복원 */
    if (t.channel === "kakao") {
      const codeEl = $("fAlimtalkTemplateCode");
      const reviewEl = $("fAlimtalkReviewStatus");
      const btnEl = $("fAlimtalkButtonJson");
      if (codeEl) codeEl.value = t.alimtalkTemplateCode || "";
      if (reviewEl) reviewEl.value = t.alimtalkReviewStatus || "";
      if (btnEl) {
        const v = t.alimtalkButtonJson;
        btnEl.value = v
          ? (typeof v === "string" ? v : JSON.stringify(v, null, 2))
          : "";
      }
    }

    applyChannelUI();
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    $("btnAddVar").addEventListener("click", () => addVarRow());

    document.querySelectorAll('input[name="channel"]').forEach(r =>
      r.addEventListener("change", applyChannelUI)
    );

    $("fBody").addEventListener("input", () => {
      if (getChannel() === "sms") updateCharCounter();
    });

    $("btnSave").addEventListener("click", save);
    $("btnCancel").addEventListener("click", () => {
      window.location.href = "/admin-templates.html";
    });

    $("btnPreview").addEventListener("click", openPreview);
    $("btnPreviewRun").addEventListener("click", runPreview);
    $("btnPreviewClose").addEventListener("click", closePreview);
    $("previewModal").addEventListener("click", (e) => {
      if (e.target === $("previewModal")) closePreview();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();

    if (isEdit) {
      loadExisting();
    } else {
      $("pageTitle").textContent = "템플릿 신규 작성";
      // 기본 채널: 이메일
      document.querySelector('input[name="channel"][value="email"]').checked = true;
      addVarRow(); // 빈 행 1개로 시작
      applyChannelUI();
    }
  });
})();
