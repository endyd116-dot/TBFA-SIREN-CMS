// public/js/admin-send-job-create.js
// 새 발송 만들기 — 편집 가능한 본문 + 다중 채널 + 수신자 목록

(function () {
  "use strict";

  const CHANNEL_LABEL = { email: "이메일", sms: "SMS", kakao: "카카오톡", inapp: "앱 알림" };
  const CHANNEL_ICONS = { email: "📧", sms: "📱", kakao: "💬", inapp: "🔔" };

  let templates = [];
  let groups    = [];
  let currentTemplate = null;     /* 선택한 템플릿 객체 (variables 포함) */
  let editorDirty = false;        /* 사용자가 본문을 수정했는지 */
  let submitting = false;

  /* 수신자 목록 페이지네이션 */
  const RCPT_PAGE_SIZE = 50;
  let rcptPage = 1;
  let rcptTotal = 0;
  let lastGroupId = null;

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

  /* ── 템플릿·그룹 셀렉트 채우기 ── */
  async function loadTemplates() {
    const res = await api({ method: "GET", url: "/api/admin-templates-list?limit=200" });
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
    const res = await api({ method: "GET", url: "/api/admin-recipient-groups-list?limit=200" });
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

  /* ── 템플릿 상세 + 본문 편집 영역 렌더 ── */
  async function loadTemplateDetail(tplId) {
    if (!tplId) {
      currentTemplate = null;
      $("editArea").innerHTML = `<div class="preview-empty">템플릿을 선택하면 제목과 본문이 여기에 표시됩니다.</div>`;
      return;
    }
    $("editArea").innerHTML = `<div class="preview-empty"><span class="spinner"></span>템플릿을 불러오는 중…</div>`;
    const res = await api({ method: "GET", url: "/api/admin-template-detail?id=" + encodeURIComponent(tplId) });
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      $("editArea").innerHTML = `<div class="preview-empty" style="color:#b91c1c;">템플릿 상세 불러오기 실패: ${escapeHtml(detail)}</div>`;
      currentTemplate = null;
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const tpl = payload.template ?? payload ?? null;
    if (!tpl) {
      $("editArea").innerHTML = `<div class="preview-empty">템플릿 데이터가 없습니다.</div>`;
      currentTemplate = null;
      return;
    }
    currentTemplate = tpl;
    editorDirty = false;
    renderEditArea();
    /* 템플릿의 기본 채널 자동 체크 (사용자가 이미 선택 안 한 경우만) */
    autoCheckTemplateChannel(tpl.channel);
  }

  function renderEditArea() {
    if (!currentTemplate) return;
    const t = currentTemplate;
    const hasSubject = t.channel === "email" || t.channel === "inapp";
    const vars = Array.isArray(t.variables) ? t.variables : [];
    const varHint = vars.length
      ? `<div class="form-hint">사용 가능 변수: ${vars.map(v => `<code>{{${escapeHtml(v.key)}}}</code>`).join(", ")}</div>`
      : `<div class="form-hint">정의된 변수 없음</div>`;

    let html = `
      <div class="edit-meta">
        <div><span class="label">템플릿</span> ${escapeHtml(t.name || "-")}</div>
        <div><span class="label">기본 채널</span> ${escapeHtml(CHANNEL_LABEL[t.channel] || t.channel)}</div>
        ${vars.length ? `<div><span class="label">변수</span> ${vars.length}개</div>` : ""}
      </div>
    `;

    if (hasSubject) {
      html += `
        <div class="form-row">
          <label class="form-label" for="fSubject">제목</label>
          <input class="form-input" type="text" id="fSubject" maxlength="200" value="${escapeHtml(t.subject || "")}">
        </div>
      `;
    }
    html += `
      <div class="form-row">
        <label class="form-label" for="fBody">본문</label>
        <textarea class="form-textarea" id="fBody">${escapeHtml(t.bodyTemplate || "")}</textarea>
        ${varHint}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px">
        <button class="btn btn-sm" id="btnResetEdit" type="button">↺ 템플릿 원본으로 되돌리기</button>
      </div>
    `;
    $("editArea").innerHTML = html;

    /* 변경 감지 */
    if (hasSubject) $("fSubject").addEventListener("input", () => { editorDirty = true; });
    $("fBody").addEventListener("input", () => { editorDirty = true; });
    $("btnResetEdit").addEventListener("click", () => {
      renderEditArea();   /* 다시 그리면 원본 값으로 복원 */
      editorDirty = false;
      showToast("템플릿 원본으로 되돌렸습니다.");
    });
  }

  /* ── 채널 다중 체크박스 ── */
  function autoCheckTemplateChannel(channel) {
    /* 사용자가 아직 아무것도 체크 안 했으면 템플릿 채널 자동 선택 */
    const checked = document.querySelectorAll('#channelGrid input[type="checkbox"]:checked').length;
    if (checked === 0 && channel) {
      const target = document.querySelector(`#channelGrid input[value="${channel}"]`);
      if (target) {
        target.checked = true;
        target.closest('.channel-item').classList.add('checked');
      }
    }
  }

  function bindChannelGrid() {
    document.querySelectorAll('#channelGrid .channel-item').forEach(item => {
      item.addEventListener('click', (e) => {
        /* label 클릭 → 자동으로 input 토글, 우리는 시각적 클래스만 동기화 */
        setTimeout(() => {
          const cb = item.querySelector('input');
          item.classList.toggle('checked', cb.checked);
        }, 0);
      });
    });
  }

  function getSelectedChannels() {
    return Array.from(document.querySelectorAll('#channelGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);
  }

  /* ── 수신자 목록 ── */
  async function loadRecipients(groupId, page) {
    if (!groupId) {
      $("rcptArea").innerHTML = `<div class="preview-empty">수신자 그룹을 선택하면 발송 대상 회원 목록이 표시됩니다.</div>`;
      lastGroupId = null;
      return;
    }
    if (groupId !== lastGroupId) { rcptPage = 1; rcptTotal = 0; }
    lastGroupId = groupId;
    const offset = (page - 1) * RCPT_PAGE_SIZE;

    $("rcptArea").innerHTML = `<div class="preview-empty"><span class="spinner"></span>회원 목록을 불러오는 중…</div>`;

    const res = await api({
      method: "GET",
      url: `/api/admin-recipient-group-members?id=${encodeURIComponent(groupId)}&limit=${RCPT_PAGE_SIZE}&offset=${offset}`,
    });

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      $("rcptArea").innerHTML = `<div class="preview-empty" style="color:#b91c1c;">회원 목록 불러오기 실패: ${escapeHtml(detail)}</div>`;
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    const members = payload.members ?? payload.rows ?? res.data?.members ?? [];
    rcptTotal = payload.total ?? members.length;

    renderRecipients(members);
  }

  function renderRecipients(members) {
    if (!members.length) {
      $("rcptArea").innerHTML = `
        <div class="rcpt-meta">
          <div>총 발송 대상: <span class="total">0명</span></div>
        </div>
        <div class="preview-empty" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">
          이 그룹에 해당하는 회원이 없습니다.
        </div>
      `;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rcptTotal / RCPT_PAGE_SIZE));

    const STATUS_LABEL = { active: "활성", inactive: "비활성", withdrawn: "탈퇴" };

    const rows = members.map(m => `
      <tr>
        <td class="col-id">#${m.id}</td>
        <td>${escapeHtml(m.name || "-")}</td>
        <td>${escapeHtml(m.email || "-")}</td>
        <td>${escapeHtml(m.phone || "-")}</td>
        <td>${escapeHtml(m.type || "-")}</td>
        <td class="col-status">${escapeHtml(STATUS_LABEL[m.status] || m.status || "-")}</td>
      </tr>
    `).join("");

    $("rcptArea").innerHTML = `
      <div class="rcpt-meta">
        <div>총 발송 대상: <span class="total">${rcptTotal.toLocaleString()}명</span></div>
        <div style="color:#94a3b8">· 페이지당 ${RCPT_PAGE_SIZE}명 표시</div>
      </div>
      <div class="rcpt-table-wrap">
        <table class="rcpt-table">
          <thead>
            <tr>
              <th>ID</th><th>이름</th><th>이메일</th><th>연락처</th><th>유형</th><th>상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="rcpt-paging">
        <button class="btn btn-sm" id="rcptPrev" ${rcptPage <= 1 ? "disabled" : ""}>‹ 이전</button>
        <span>${rcptPage} / ${totalPages}</span>
        <button class="btn btn-sm" id="rcptNext" ${rcptPage >= totalPages ? "disabled" : ""}>다음 ›</button>
      </div>
    `;

    $("rcptPrev")?.addEventListener("click", () => {
      if (rcptPage > 1) { rcptPage--; loadRecipients(lastGroupId, rcptPage); }
    });
    $("rcptNext")?.addEventListener("click", () => {
      if (rcptPage < totalPages) { rcptPage++; loadRecipients(lastGroupId, rcptPage); }
    });
  }

  /* ── 등록 ── */
  function getScheduleType() {
    const checked = document.querySelector('input[name="scheduleType"]:checked');
    return checked ? checked.value : "now";
  }

  function validateForm() {
    const name = $("fName").value.trim();
    if (!name)            return { ok: false, msg: "발송 이름을 입력해 주세요." };
    if (name.length > 200) return { ok: false, msg: "발송 이름은 200자 이하여야 합니다." };

    const tplId = $("fTemplate").value;
    if (!tplId) return { ok: false, msg: "템플릿을 선택해 주세요." };

    const channels = getSelectedChannels();
    if (!channels.length) return { ok: false, msg: "발송 채널을 1개 이상 선택해 주세요." };

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
      if (d.getTime() < minFuture) return { ok: false, msg: "예약 시각은 현재로부터 1분 이후여야 합니다." };
      scheduledAt = d.toISOString();
    }

    /* override — 사용자가 수정했고, 원본과 다르면 전송 */
    let subjectOverride = "";
    let bodyOverride = "";
    if (currentTemplate) {
      const subjEl = $("fSubject");
      const bodyEl = $("fBody");
      if (subjEl && subjEl.value.trim() !== String(currentTemplate.subject || "").trim()) {
        subjectOverride = subjEl.value;
      }
      if (bodyEl && bodyEl.value.trim() !== String(currentTemplate.bodyTemplate || "").trim()) {
        bodyOverride = bodyEl.value;
      }
    }

    return {
      ok: true,
      body: {
        name,
        templateId:       Number(tplId),
        recipientGroupId: Number(grpId),
        channels,
        scheduleType:     sType,
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(subjectOverride ? { subjectOverride } : {}),
        ...(bodyOverride ? { bodyOverride } : {}),
      },
    };
  }

  async function submit() {
    if (submitting) return;
    const v = validateForm();
    if (!v.ok) { showToast(v.msg, "error"); return; }

    submitting = true;
    $("btnSubmit").disabled = true;
    $("btnSubmit").textContent = "등록 중…";

    const res = await api({ method: "POST", url: "/api/admin-send-job-create", body: v.body });

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("등록 실패: " + detail, "error");
      console.error("[send-job-create]", res);
      submitting = false;
      $("btnSubmit").disabled = false;
      $("btnSubmit").textContent = "등록";
      return;
    }

    const payload = res.data?.data ?? res.data ?? {};
    const ids = payload.ids ?? res.data?.ids ?? [];
    const id  = payload.id  ?? res.data?.id ?? (ids[0] ?? null);
    const channels = v.body.channels;

    if (channels.length > 1) {
      showToast(`${channels.length}개 채널로 발송 작업이 등록되었습니다.`);
    } else if (v.body.scheduleType === "now") {
      showToast("발송이 등록되었습니다. 곧 시작됩니다.");
    } else {
      const when = $("fScheduledAt").value.replace("T", " ");
      showToast(`${when}에 자동 발송됩니다.`);
    }

    setTimeout(() => {
      if (id && channels.length === 1) {
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

    $("fTemplate").addEventListener("change", (e) => {
      loadTemplateDetail(e.target.value);
    });
    $("fGroup").addEventListener("change", (e) => {
      rcptPage = 1;
      loadRecipients(e.target.value, 1);
    });

    bindChannelGrid();

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
