// public/js/admin-recipient-group-edit.js
// Phase 10 R2 — 수신자 그룹 편집 (필터 빌더 + 수동 명단 + 미리보기)

(function () {
  "use strict";

  /* ── 필터 화이트리스트 (설계서 §2.4 그대로) ── */
  // type: 값 입력 칸 형태
  //   selectOne: 단일 셀렉트
  //   selectMulti: 다중 셀렉트 (in/notIn)
  //   number: 숫자 입력
  //   bool: true/false 셀렉트
  //   intIds: 정수 또는 정수 배열 (텍스트 — 콤마)
  /* CMS 도메인 기준 — 정기/예비/잠재 후원자 + 효성/토스/수기 채널 + 회원 상태/유형 */
  const FIELDS = {
    donorType: {
      label: "후원자 분류",
      ops: ["eq", "in"],
      valueType: "selectMulti",
      options: [
        { value: "regular",  label: "🔁 정기 후원자" },
        { value: "prospect", label: "💡 예비 후원자 (일시·중단)" },
        { value: "none",     label: "🌱 미평가 (일반 회원)" },
      ],
    },
    donorChannels: {
      label: "후원 채널",
      ops: ["eq", "in"],
      valueType: "selectMulti",
      options: [
        { value: "hyosung", label: "효성 CMS+" },
        { value: "toss",    label: "토스 빌링" },
        { value: "manual",  label: "수기 등록" },
      ],
    },
    type: {
      label: "회원 유형",
      ops: ["eq", "in"],
      valueType: "selectMulti",
      options: [
        { value: "regular",   label: "일반 회원" },
        { value: "family",    label: "유가족" },
        { value: "volunteer", label: "자원봉사자" },
      ],
    },
    status: {
      label: "회원 상태",
      ops: ["eq", "in"],
      valueType: "selectMulti",
      options: [
        { value: "active",    label: "활성" },
        { value: "suspended", label: "정지" },
        { value: "withdrawn", label: "탈퇴" },
        { value: "pending",   label: "대기" },
      ],
    },
    hasActiveRegularDonation: {
      label: "활성 정기 후원 보유 여부",
      ops: ["eq"],
      valueType: "bool",
    },
    hadOneTimeDonationDays: {
      label: "최근 일시 후원 (N일 이내)",
      ops: ["lte", "gte"],
      valueType: "number",
      placeholder: "예: 90",
    },
    campaignId: {
      label: "참여 캠페인 ID",
      ops: ["eq", "in"],
      valueType: "intIds",
      placeholder: "정수 (콤마 구분: 1,2,3)",
    },
    donationStatus: {
      label: "후원 상태",
      ops: ["eq", "in"],
      valueType: "selectMulti",
      options: [
        { value: "completed", label: "완료" },
        { value: "active",    label: "활성" },
        { value: "pending",   label: "대기" },
        { value: "failed",    label: "실패" },
        { value: "cancelled", label: "취소" },
      ],
    },
    blacklisted: {
      label: "블랙리스트",
      ops: ["eq"],
      valueType: "bool",
    },
  };

  const OP_LABEL = {
    eq:    "같음",
    ne:    "다름",
    in:    "포함",
    notIn: "미포함",
    lte:   "이내",
    gte:   "이상",
  };

  /* ── 상태 ── */
  let groupId = null;
  let isEdit = false;
  let originalIsActive = true;

  let filterRows = []; // [{field, op, value, values}]
  let manualMembers = []; // [{id, name, email}]

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

  /* ── 방식 토글 ── */
  function getCType() {
    return document.querySelector('input[name="ctype"]:checked')?.value || "filter";
  }
  function applyCTypeUI() {
    const t = getCType();
    $("filterCard").style.display = (t === "filter") ? "" : "none";
    $("manualCard").style.display = (t === "manual") ? "" : "none";
  }
  function getLogic() {
    return document.querySelector('input[name="logic"]:checked')?.value || "and";
  }

  /* ── 필터 빌더 렌더 ── */
  function fieldOptionsHtml(selected) {
    const opts = Object.entries(FIELDS).map(([k, def]) =>
      `<option value="${k}" ${k === selected ? "selected" : ""}>${escapeHtml(def.label)}</option>`
    ).join("");
    return `<option value="">— 필드 선택 —</option>` + opts;
  }
  function opOptionsHtml(field, selected) {
    const def = FIELDS[field];
    if (!def) return `<option value="">—</option>`;
    return def.ops.map(op =>
      `<option value="${op}" ${op === selected ? "selected" : ""}>${OP_LABEL[op] || op}</option>`
    ).join("");
  }
  function valueInputHtml(field, op, row) {
    const def = FIELDS[field];
    if (!def) return `<input type="text" disabled placeholder="필드를 먼저 선택하세요" />`;
    const vt = def.valueType;
    if (vt === "selectMulti") {
      // op=eq → 단일, op=in/notIn → 다중
      if (op === "eq" || op === "ne") {
        const opts = def.options.map(o =>
          `<option value="${o.value}" ${row.value === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`
        ).join("");
        return `<select data-role="value">${opts}</select>`;
      } else {
        // 다중: select multiple
        const opts = def.options.map(o =>
          `<option value="${o.value}" ${(row.values || []).includes(o.value) ? "selected" : ""}>${escapeHtml(o.label)}</option>`
        ).join("");
        return `<select data-role="values" multiple size="${Math.min(5, def.options.length)}">${opts}</select>`;
      }
    }
    if (vt === "bool") {
      const v = row.value === false ? "false" : (row.value === true ? "true" : "true");
      return `<select data-role="value">
        <option value="true"  ${v === "true" ? "selected" : ""}>예 (true)</option>
        <option value="false" ${v === "false" ? "selected" : ""}>아니오 (false)</option>
      </select>`;
    }
    if (vt === "number") {
      const v = (row.value ?? "");
      return `<input type="number" data-role="value" placeholder="${escapeHtml(def.placeholder || "")}" value="${escapeHtml(v)}" />`;
    }
    if (vt === "intIds") {
      // op=eq → 단일 정수, op=in/notIn → 콤마 구분 정수 배열
      if (op === "eq" || op === "ne") {
        const v = (row.value ?? "");
        return `<input type="number" data-role="value" placeholder="${escapeHtml(def.placeholder || "")}" value="${escapeHtml(v)}" />`;
      } else {
        const v = (row.values || []).join(",");
        return `<input type="text" data-role="values" placeholder="${escapeHtml(def.placeholder || "")}" value="${escapeHtml(v)}" />`;
      }
    }
    if (vt === "text") {
      if (op === "eq" || op === "ne") {
        const v = (row.value ?? "");
        return `<input type="text" data-role="value" placeholder="${escapeHtml(def.placeholder || "")}" value="${escapeHtml(v)}" />`;
      } else {
        const v = (row.values || []).join(",");
        return `<input type="text" data-role="values" placeholder="${escapeHtml(def.placeholder || "")}" value="${escapeHtml(v)}" />`;
      }
    }
    return `<input type="text" data-role="value" />`;
  }

  function renderFilterRows() {
    const tbody = $("filterRows");
    if (!filterRows.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="padding:14px;color:#94a3b8;font-size:0.85rem;">조건이 없습니다. [+ 조건 추가]를 눌러 시작하세요.</td></tr>`;
      return;
    }
    tbody.innerHTML = filterRows.map((row, idx) => {
      const fieldSel = `<select data-idx="${idx}" data-role="field">${fieldOptionsHtml(row.field)}</select>`;
      const opSel    = row.field
        ? `<select data-idx="${idx}" data-role="op">${opOptionsHtml(row.field, row.op)}</select>`
        : `<select disabled><option>—</option></select>`;
      const valHtml  = valueInputHtml(row.field, row.op, row);
      // wrap value html with idx
      const valWrap  = valHtml.replace(/data-role="(value|values)"/, `data-idx="${idx}" data-role="$1"`);
      return `
        <tr data-idx="${idx}">
          <td class="col-field">${fieldSel}</td>
          <td class="col-op">${opSel}</td>
          <td class="col-val">${valWrap}</td>
          <td class="col-x"><button class="btn btn-sm btn-danger" data-act="remove" data-idx="${idx}">×</button></td>
        </tr>
      `;
    }).join("");
  }

  function addFilterRow() {
    filterRows.push({ field: "", op: "", value: "", values: [] });
    renderFilterRows();
  }
  function removeFilterRow(idx) {
    filterRows.splice(idx, 1);
    renderFilterRows();
  }

  function onFilterRowChange(e) {
    const idxAttr = e.target.dataset.idx;
    if (idxAttr === undefined) return;
    const idx = Number(idxAttr);
    const role = e.target.dataset.role;
    const row = filterRows[idx];
    if (!row) return;

    if (role === "field") {
      row.field = e.target.value;
      // 첫 op로 자동 설정
      const def = FIELDS[row.field];
      row.op = def?.ops?.[0] || "";
      /* selectMulti면 첫 옵션을 row.value에 자동 세팅 (사용자가 값 안 만져도 유효한 값 보장) */
      if (def?.valueType === "selectMulti" && Array.isArray(def.options) && def.options.length > 0) {
        row.value  = def.options[0].value;
        row.values = [def.options[0].value];
      } else if (def?.valueType === "bool") {
        row.value = true;
        row.values = [];
      } else {
        row.value = "";
        row.values = [];
      }
      renderFilterRows();
    } else if (role === "op") {
      row.op = e.target.value;
      const def2 = FIELDS[row.field];
      /* op 변경 후에도 selectMulti는 첫 옵션 유지 */
      if (def2?.valueType === "selectMulti" && Array.isArray(def2.options) && def2.options.length > 0) {
        row.value  = def2.options[0].value;
        row.values = [def2.options[0].value];
      } else if (def2?.valueType === "bool") {
        row.value = true;
        row.values = [];
      } else {
        row.value = "";
        row.values = [];
      }
      renderFilterRows();
    } else if (role === "value") {
      row.value = e.target.value;
    } else if (role === "values") {
      if (e.target.tagName === "SELECT") {
        row.values = Array.from(e.target.selectedOptions).map(o => o.value);
      } else {
        // text: comma-split
        row.values = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
      }
    }
  }

  /* ── 수동 명단 ── */
  function renderMemberChips() {
    const wrap = $("memberChips");
    $("memberCount").textContent = manualMembers.length;
    if (!manualMembers.length) {
      wrap.innerHTML = `<span class="empty-chips">검색 결과를 클릭해 회원을 추가하세요.</span>`;
      return;
    }
    wrap.innerHTML = manualMembers.map(m => `
      <span class="member-chip" data-id="${m.id}">
        ${escapeHtml(m.name || "(이름 없음)")}
        <span style="color:#64748b;font-size:0.74rem;">#${m.id}</span>
        <button data-act="chip-remove" data-id="${m.id}" title="삭제">×</button>
      </span>
    `).join("");
  }

  async function searchMembers() {
    const q = $("memberSearchInput").value.trim();
    if (!q) {
      showToast("이름·이메일·전화번호 일부를 입력하세요", "error");
      return;
    }
    /* 통합회원 전체에서 부분 일치 검색 — 최대 50명까지 표시 */
    const url = "/api/admin-members-search?" + new URLSearchParams({ q, limit: "50" }).toString();
    const res = await api({ method: "GET", url });
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("회원 검색 실패: " + detail, "error");
      $("searchResults").style.display = "none";
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const rows = payload.members ?? payload.rows ?? res.data?.members ?? res.data?.rows ?? [];

    if (!rows.length) {
      $("searchResults").style.display = "";
      $("searchResults").innerHTML = `<div class="search-result-item" style="cursor:default;color:#94a3b8;">검색 결과 없음</div>`;
      return;
    }
    const top = rows.slice(0, 50);
    /* 이미 추가된 회원 ID 표시용 */
    const addedSet = new Set(manualMembers.map(x => Number(x.id)));

    $("searchResults").style.display = "";
    $("searchResults").innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-size:0.82rem">
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" id="searchSelectAll" /> 전체 선택
        </label>
        <button class="btn btn-sm" id="btnSearchAddSelected" style="margin-left:auto">＋ 선택 항목 일괄 추가</button>
        <span style="color:#94a3b8">총 ${top.length}명${rows.length > top.length ? " (50명 표시)" : ""}</span>
      </div>
      <div style="max-height:340px;overflow-y:auto">
        ${top.map(m => {
          const already = addedSet.has(Number(m.id));
          return `
            <div class="search-result-item" style="display:flex;align-items:center;gap:8px;${already?'opacity:.55':''}">
              <input type="checkbox" class="search-cb" data-id="${m.id}"
                     data-name="${escapeHtml(m.name || "")}"
                     data-email="${escapeHtml(m.email || "")}"
                     ${already ? "disabled" : ""}>
              <div style="flex:1">
                <b>${escapeHtml(m.name || "(이름 없음)")}</b>
                <span class="meta" style="margin-left:6px">#${m.id}</span>
                ${already ? '<span class="meta" style="margin-left:8px;color:#1e40af">이미 추가됨</span>' : ""}
              </div>
              <div class="meta" style="font-size:0.82rem">${escapeHtml(m.email || "")}</div>
              <div class="meta" style="font-size:0.82rem">${escapeHtml(m.phone || "")}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    /* 전체 선택 토글 */
    $("searchSelectAll")?.addEventListener("change", e => {
      $("searchResults").querySelectorAll(".search-cb:not(:disabled)").forEach(cb => { cb.checked = e.target.checked; });
    });
    /* 일괄 추가 */
    $("btnSearchAddSelected")?.addEventListener("click", () => {
      const checks = $("searchResults").querySelectorAll(".search-cb:checked");
      let added = 0;
      checks.forEach(cb => {
        const id = Number(cb.dataset.id);
        if (manualMembers.some(x => Number(x.id) === id)) return;
        if (manualMembers.length >= 1000) return;
        manualMembers.push({ id, name: cb.dataset.name || "", email: cb.dataset.email || "" });
        added++;
      });
      if (added > 0) {
        renderMemberChips();
        showToast(`${added}명 추가됨 (총 ${manualMembers.length}명)`);
        $("searchResults").style.display = "none";
        $("memberSearchInput").value = "";
      } else {
        showToast("선택된 항목이 없거나 이미 모두 추가되어 있습니다");
      }
    });
  }

  function addMember(id, name, email) {
    if (manualMembers.some(m => String(m.id) === String(id))) return; // dedup
    manualMembers.push({ id: Number(id), name, email });
    renderMemberChips();
  }
  function removeMember(id) {
    manualMembers = manualMembers.filter(m => String(m.id) !== String(id));
    renderMemberChips();
  }

  /* ── criteria 직렬화 ── */
  function buildFilterClause(row) {
    const def = FIELDS[row.field];
    if (!def) return null;
    const op = row.op;
    const vt = def.valueType;
    const clause = { field: row.field, op };

    if (vt === "selectMulti") {
      if (op === "eq" || op === "ne") clause.value = row.value;
      else clause.values = row.values || [];
    } else if (vt === "bool") {
      clause.value = (row.value === "true" || row.value === true);
    } else if (vt === "number") {
      const n = Number(row.value);
      clause.value = isFinite(n) ? n : row.value;
    } else if (vt === "intIds") {
      if (op === "eq" || op === "ne") {
        const n = Number(row.value);
        clause.value = isFinite(n) ? n : row.value;
      } else {
        clause.values = (row.values || []).map(v => {
          const n = Number(v);
          return isFinite(n) ? n : v;
        });
      }
    } else if (vt === "text") {
      if (op === "eq" || op === "ne") clause.value = row.value;
      else clause.values = row.values || [];
    }
    return clause;
  }

  function buildCriteria() {
    const t = getCType();
    if (t === "filter") {
      const filters = filterRows
        .filter(r => r.field && r.op)
        .map(buildFilterClause)
        .filter(Boolean);
      return {
        type: "filter",
        logic: getLogic(),
        filters,
      };
    } else {
      return {
        type: "manual",
        memberIds: manualMembers.map(m => Number(m.id)),
      };
    }
  }

  /* ── criteria → UI 복원 ── */
  function loadCriteria(crit) {
    if (!crit || typeof crit !== "object") return;
    const t = crit.type === "manual" ? "manual" : "filter";
    document.querySelectorAll('input[name="ctype"]').forEach(r => {
      r.checked = (r.value === t);
    });
    applyCTypeUI();

    if (t === "filter") {
      const logic = (crit.logic === "or") ? "or" : "and";
      document.querySelectorAll('input[name="logic"]').forEach(r => {
        r.checked = (r.value === logic);
      });
      filterRows = (Array.isArray(crit.filters) ? crit.filters : []).map(f => {
        const def = FIELDS[f.field];
        const out = { field: f.field || "", op: f.op || (def?.ops?.[0] || ""), value: "", values: [] };
        if (Array.isArray(f.values)) {
          out.values = f.values.map(String);
        } else if (f.value !== undefined && f.value !== null) {
          out.value = (typeof f.value === "boolean") ? String(f.value) : String(f.value);
        }
        return out;
      });
      renderFilterRows();
    } else {
      manualMembers = []; // 상세 응답에 sampleMembers는 있지만 전체 명단은 없음 — id만 보존
      const ids = Array.isArray(crit.memberIds) ? crit.memberIds : [];
      manualMembers = ids.map(id => ({ id: Number(id), name: "#" + id, email: "" }));
      renderMemberChips();
      // 상세 조회 후 회원 이름 보강
      if (ids.length) hydrateManualNames(ids);
    }
  }

  // 수동 명단 ID → 이름 보강 (검색 API q=빈으로는 안 가능 — 상세 응답의 sampleMembers + 추가 검색 hit 필요)
  // 1차 단순 처리: sampleMembers가 detail 응답에 있으면 해당 5명만 이름 채움
  function hydrateManualFromSamples(samples) {
    if (!Array.isArray(samples) || !samples.length) return;
    const map = new Map(samples.map(s => [String(s.id), s]));
    manualMembers = manualMembers.map(m => {
      const s = map.get(String(m.id));
      return s ? { id: m.id, name: s.name || m.name, email: s.email || m.email } : m;
    });
    renderMemberChips();
  }
  // 추가 보강 (옵션) — 큰 명단이면 N개 회원 이름 일괄 조회 API 부재로 일단 sampleMembers만 활용
  async function hydrateManualNames(/* ids */) {
    /* 상세 응답에 포함된 sampleMembers로만 보강. 추가 일괄 조회는 R3에서 검토. */
  }

  /* ── 검증 ── */
  function validateForm() {
    const name = $("fName").value.trim();
    if (!name) { showToast("그룹 이름을 입력해 주세요.", "error"); return null; }

    const t = getCType();
    if (t === "filter") {
      const validRows = filterRows.filter(r => r.field && r.op);
      if (!validRows.length) {
        showToast("최소 1개 이상의 조건을 추가해 주세요.", "error");
        return null;
      }
      // 각 행 값 점검
      for (const row of validRows) {
        const def = FIELDS[row.field];
        if (!def) {
          showToast("조건 값이 올바르지 않습니다.", "error");
          return null;
        }
        if (!def.ops.includes(row.op)) {
          showToast("조건 값이 올바르지 않습니다.", "error");
          return null;
        }
      }
    } else {
      if (!manualMembers.length) {
        showToast("최소 1명 이상의 회원을 추가해 주세요.", "error");
        return null;
      }
      if (manualMembers.length > 1000) {
        showToast("수동 명단은 최대 1000명까지 가능합니다.", "error");
        return null;
      }
    }

    return {
      name,
      description: $("fDescription").value.trim() || null,
      criteria: buildCriteria(),
    };
  }

  /* ── 저장 ── */
  async function save() {
    const payload = validateForm();
    if (!payload) return;

    $("btnSave").disabled = true;
    const url = isEdit
      ? "/api/admin-recipient-group-update?id=" + encodeURIComponent(groupId)
      : "/api/admin-recipient-group-create";
    const res = await api({ method: "POST", url, body: payload });
    $("btnSave").disabled = false;

    if (res.ok) {
      showToast(isEdit ? "수신자 그룹이 수정되었습니다." : "수신자 그룹이 등록되었습니다.");
      setTimeout(() => { window.location.href = "/admin-recipient-groups.html"; }, 600);
    } else {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("저장 실패: " + detail, "error");
    }
  }

  /* ── 미리보기 ── */
  async function preview() {
    const payload = validateForm();
    if (!payload) return;

    $("previewModal").classList.add("show");
    $("pmLoading").style.display = "";
    $("pmContent").style.display = "none";

    const res = await api({
      method: "POST",
      url: "/api/admin-recipient-group-preview",
      body: { criteria: payload.criteria },
    });

    $("pmLoading").style.display = "none";
    $("pmContent").style.display = "";

    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      $("pmContent").innerHTML = `<div class="preview-warn">미리보기 실패: ${escapeHtml(detail)}</div>`;
      showToast("미리보기 실패: " + detail, "error");
      return;
    }

    const payload2 = res.data?.data ?? res.data ?? {};
    const pv = payload2.preview ?? res.data?.preview ?? {};
    const warnings = payload2.warnings ?? res.data?.warnings ?? [];

    $("pmSummary").textContent = pv.criteriaSummary || "(요약 없음)";
    $("pmCount").textContent = (typeof pv.memberCount === "number")
      ? `${pv.memberCount.toLocaleString()}명`
      : "-";

    const warnArea = $("pmWarnArea");
    if (Array.isArray(warnings) && warnings.length) {
      warnArea.innerHTML = warnings.map(w => `<div class="preview-warn">⚠ ${escapeHtml(w)}</div>`).join("");
    } else if (pv.memberCount === 0) {
      warnArea.innerHTML = `<div class="preview-warn">⚠ 조건에 맞는 회원이 0명입니다. 조건을 다시 확인해 주세요.</div>`;
    } else {
      warnArea.innerHTML = "";
    }

    const samples = Array.isArray(pv.sampleMembers) ? pv.sampleMembers : [];
    if (!samples.length) {
      $("pmSamples").innerHTML = `<li style="color:#94a3b8;">샘플 없음</li>`;
    } else {
      $("pmSamples").innerHTML = samples.map(m => `
        <li>
          <b>${escapeHtml(m.name || "(이름 없음)")}</b>
          <span class="meta">#${m.id}</span>
          <span class="meta">${escapeHtml(m.email || "")}</span>
        </li>
      `).join("");
    }
  }

  /* ── 삭제 ── */
  async function deleteGroup() {
    if (!confirm("이 그룹을 삭제(비활성)합니다. 계속할까요?")) return;
    $("btnDelete").disabled = true;
    const res = await api({
      method: "POST",
      url: "/api/admin-recipient-group-delete?id=" + encodeURIComponent(groupId),
    });
    $("btnDelete").disabled = false;
    if (res.ok) {
      showToast("수신자 그룹이 삭제되었습니다.");
      setTimeout(() => { window.location.href = "/admin-recipient-groups.html"; }, 600);
    } else {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("삭제 실패: " + detail, "error");
    }
  }

  /* ── 상세 로드 (수정 모드) ── */
  async function loadDetail(id) {
    const res = await api({
      method: "GET",
      url: "/api/admin-recipient-group-detail?id=" + encodeURIComponent(id),
    });
    if (!res.ok) {
      const detail = res.data?.error || res.data?.detail || ("HTTP " + res.status);
      showToast("그룹 조회 실패: " + detail, "error");
      return;
    }
    const payload = res.data?.data ?? res.data ?? {};
    const g = payload.group ?? res.data?.group ?? null;
    if (!g) {
      showToast("그룹 정보를 찾을 수 없습니다.", "error");
      return;
    }
    $("pageTitle").textContent = `수신자 그룹 수정 #${g.id}`;
    $("fName").value = g.name || "";
    $("fDescription").value = g.description || "";
    originalIsActive = g.isActive !== false;
    loadCriteria(g.criteria);
    if (Array.isArray(g.sampleMembers)) hydrateManualFromSamples(g.sampleMembers);
    $("btnDelete").style.display = originalIsActive ? "" : "none";
  }

  /* ── 이벤트 ── */
  function bindEvents() {
    document.querySelectorAll('input[name="ctype"]').forEach(r => {
      r.addEventListener("change", applyCTypeUI);
    });

    $("btnAddFilter").addEventListener("click", addFilterRow);
    $("filterRows").addEventListener("change", onFilterRowChange);
    $("filterRows").addEventListener("input", onFilterRowChange);
    $("filterRows").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='remove']");
      if (!btn) return;
      removeFilterRow(Number(btn.dataset.idx));
    });

    $("btnMemberSearch").addEventListener("click", searchMembers);
    $("memberSearchInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); searchMembers(); }
    });
    $("searchResults").addEventListener("click", (e) => {
      const item = e.target.closest("[data-act='add-member']");
      if (!item) return;
      addMember(item.dataset.id, item.dataset.name, item.dataset.email);
      // 검색 결과 닫기
      $("searchResults").style.display = "none";
      $("memberSearchInput").value = "";
    });
    $("memberChips").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act='chip-remove']");
      if (!btn) return;
      removeMember(btn.dataset.id);
    });

    $("btnPreview").addEventListener("click", preview);
    $("btnSave").addEventListener("click", save);
    $("btnCancel").addEventListener("click", () => {
      window.location.href = "/admin-recipient-groups.html";
    });
    $("btnDelete").addEventListener("click", deleteGroup);

    /* 미리보기 모달 */
    $("pmClose").addEventListener("click", () => $("previewModal").classList.remove("show"));
    $("pmCloseBtn").addEventListener("click", () => $("previewModal").classList.remove("show"));
    $("previewModal").addEventListener("click", (e) => {
      if (e.target === $("previewModal")) $("previewModal").classList.remove("show");
    });
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      groupId = id;
      isEdit = true;
    } else {
      // 신규: 빈 필터 1행으로 시작
      addFilterRow();
    }

    applyCTypeUI();
    bindEvents();

    if (isEdit) loadDetail(groupId);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
