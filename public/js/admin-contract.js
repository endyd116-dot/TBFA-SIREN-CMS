/* admin-contract.js — 근로계약 관리 (이사장 전용) */
(function () {
  "use strict";

  async function api(url, opts) {
    opts = opts || {};
    const o = { method: opts.method || "GET", credentials: "include", headers: { "Content-Type": "application/json" } };
    if (opts.body) o.body = JSON.stringify(opts.body);
    const r = await fetch(url, o);
    let data; try { data = await r.json(); } catch (_) { data = {}; }
    return { ok: r.ok, status: r.status, data };
  }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let _t;
  function toast(msg, err) {
    const el = $("toast"); el.textContent = msg; el.className = "toast show" + (err ? " err" : "");
    clearTimeout(_t); _t = setTimeout(() => (el.className = "toast"), 2600);
  }
  const STATUS_LABEL = { draft: "작성중", sent: "서명 대기", completed: "완료", rejected: "반려", voided: "무효" };
  const badge = (s) => `<span class="badge b-${s}">${STATUS_LABEL[s] || s}</span>`;
  const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d).toLocaleDateString("ko-KR"); } catch (_) { return "—"; } };
  const fmtDT = (d) => { if (!d) return "—"; try { return new Date(d).toLocaleString("ko-KR"); } catch (_) { return "—"; } };

  let ENTITIES = [], MEMBERS = [];

  /* ── 탭 ── */
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("panel-" + t.dataset.tab).classList.add("active");
    if (t.dataset.tab === "entities") loadEntities();
    if (t.dataset.tab === "templates") loadTemplatesForSelected();
  }));

  /* 모달 닫기 공통 */
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => {
    b.closest(".modal").classList.remove("open");
  }));
  document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("open"); }));

  /* ═══ 계약 목록 ═══ */
  async function loadContracts() {
    const status = $("filterStatus").value;
    const r = await api("/api/admin-contracts" + (status ? "?status=" + status : ""));
    const tb = $("contractList");
    if (!r.ok) { tb.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">${esc(r.data && r.data.error || "불러오기 실패")}</td></tr>`; return; }
    const items = (r.data.data && r.data.data.items) || [];
    if (!items.length) { tb.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">계약이 없습니다. [새 계약 작성]으로 시작하세요.</td></tr>`; return; }
    tb.innerHTML = items.map((c) => `
      <tr>
        <td>${c.id}</td>
        <td>${esc(c.ent_name)}</td>
        <td>${esc(c.m_name || "직원#" + c.member_id)}</td>
        <td>${badge(c.status)}</td>
        <td>${fmtDate(c.created_at)}</td>
        <td><button class="btn btn-default btn-sm" data-detail="${c.id}">상세</button></td>
      </tr>`).join("");
    tb.querySelectorAll("[data-detail]").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.detail)));
  }
  $("filterStatus").addEventListener("change", loadContracts);

  /* ═══ 계약 상세 ═══ */
  async function openDetail(id) {
    const r = await api("/api/admin-contracts?id=" + id);
    if (!r.ok) { toast(r.data && r.data.error || "조회 실패", true); return; }
    const c = r.data.data;
    const evs = (c.events || []).map((e) => `<div class="ev">${fmtDT(e.created_at)} · <b>${esc(e.actor)}</b> ${esc(e.action)}${e.signed_name ? " · " + esc(e.signed_name) : ""}${e.ip ? " · " + esc(e.ip) : ""}</div>`).join("") || '<div class="muted">기록 없음</div>';
    const atts = (c.attachments || []).map((a) => `<div class="ev">📎 ${esc(a.label || a.file_name || a.kind)} <a href="/api/blob-image?id=${a.blob_id}" target="_blank" style="margin-left:6px">열기</a></div>`).join("") || '<div class="muted">첨부 없음</div>';

    const actions = [];
    if (c.status === "draft") actions.push(`<button class="btn btn-primary btn-sm" data-act="send" data-id="${c.id}">발송(회사 도장 날인)</button>`);
    if (c.status === "completed") actions.push(`<button class="btn btn-default btn-sm" data-act="reissue" data-id="${c.id}">정정 재발행</button>`);
    if (c.status !== "voided") actions.push(`<button class="btn btn-danger btn-sm" data-act="void" data-id="${c.id}">무효</button>`);
    const pdfBtn = (c.status !== "draft")
      ? `<a class="btn btn-default btn-sm" href="/api/admin-contract-pdf?id=${c.id}" target="_blank">PDF 보기</a>`
      : `<a class="btn btn-default btn-sm" href="/api/admin-contract-pdf?id=${c.id}&draft=1" target="_blank">미리보기</a>`;

    $("detailBody").innerHTML = `
      <div class="mhead"><strong>계약 #${c.id} · ${esc(c.memberName)} ${badge(c.status)}</strong><button class="x" data-close>&times;</button></div>
      <div class="grid2" style="margin-bottom:12px">
        <div><span class="muted">사업자</span><br>${esc(c.entityName)} (${esc(c.entityRepresentative || "")})</div>
        <div><span class="muted">직원</span><br>${esc(c.memberName)} ${c.residentNoMask ? "· 주민번호 " + esc(c.residentNoMask) : ""}</div>
        <div><span class="muted">발송</span><br>${fmtDT(c.sentAt)}</div>
        <div><span class="muted">직원 서명</span><br>${fmtDT(c.employeeSignedAt)} ${c.employeeSigType ? "(" + esc(c.employeeSigType) + ")" : ""}</div>
      </div>
      ${c.rejectedReason ? `<div class="card" style="background:#fef3c7">반려 사유: ${esc(c.rejectedReason)} (${fmtDT(c.rejectedAt)})</div>` : ""}
      ${c.voidedReason ? `<div class="card" style="background:#fee2e2">무효 사유: ${esc(c.voidedReason)} (${fmtDT(c.voidedAt)})</div>` : ""}
      <div class="row" style="margin-bottom:12px">${pdfBtn}${actions.join("")}</div>
      <div style="font-weight:600;margin:10px 0 4px">계약서 본문</div>
      <div class="doc-preview">${esc(c.bodySnapshot || "")}</div>
      <div class="grid2" style="margin-top:14px">
        <div><div style="font-weight:600;margin-bottom:4px">진행 기록</div>${evs}</div>
        <div><div style="font-weight:600;margin-bottom:4px">부속 서류(신분증·통장 등)</div>${atts}</div>
      </div>`;
    $("detailModal").classList.add("open");
    $("detailBody").querySelector("[data-close]").addEventListener("click", () => $("detailModal").classList.remove("open"));
    $("detailBody").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => contractAction(b.dataset.act, b.dataset.id)));
  }

  async function contractAction(act, id) {
    if (act === "void") {
      const reason = prompt("무효 사유를 입력하세요 (5자 이상)");
      if (!reason || reason.trim().length < 5) { toast("사유가 필요합니다", true); return; }
      const r = await api("/api/admin-contracts", { method: "POST", body: { action: "void", id, reason } });
      toast(r.ok ? "무효 처리했습니다" : (r.data.error || "실패"), !r.ok);
    } else if (act === "send") {
      if (!confirm("이 계약을 직원에게 발송할까요? 회사 도장이 자동으로 찍힙니다.")) return;
      const r = await api("/api/admin-contracts", { method: "POST", body: { action: "send", id } });
      toast(r.ok ? "발송했습니다" : (r.data.error || "실패"), !r.ok);
    } else if (act === "reissue") {
      if (!confirm("정정 재발행하면 직원이 다시 서명해야 합니다. 진행할까요?")) return;
      const r = await api("/api/admin-contracts", { method: "POST", body: { action: "reissue", id } });
      toast(r.ok ? "재발행했습니다" : (r.data.error || "실패"), !r.ok);
    }
    $("detailModal").classList.remove("open");
    loadContracts();
  }

  /* ═══ 새 계약 ═══ */
  async function ensureRefs() {
    if (!ENTITIES.length) {
      const e = await api("/api/admin-contract-entities");
      ENTITIES = (e.data.data && e.data.data.items) || [];
    }
    if (!MEMBERS.length) {
      const m = await api("/api/admin-contracts?members=1");
      MEMBERS = (m.data.data && m.data.data.members) || [];
    }
  }
  $("btnNew").addEventListener("click", async () => {
    await ensureRefs();
    const actE = ENTITIES.filter((x) => x.is_active);
    $("cEntity").innerHTML = actE.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
    $("cMember").innerHTML = MEMBERS.map((x) => `<option value="${x.id}">${esc(x.name)}${x.position ? " (" + esc(x.position) + ")" : ""}</option>`).join("");
    ["성명", "생년월일", "주소", "연락처", "주민번호", "계약시작일", "연봉", "월지급액", "지급일", "근무장소", "담당업무"].forEach((k) => { const el = $("f_" + k); if (el) el.value = ""; });
    $("f_수습개월").value = "3"; $("f_근무시작시각").value = "09:00"; $("f_근무종료시각").value = "18:00";
    $("createModal").classList.add("open");
  });

  function collectFields() {
    const keys = ["성명", "생년월일", "주소", "연락처", "계약시작일", "연봉", "월지급액", "지급일", "근무장소", "담당업무", "근무시작시각", "근무종료시각", "수습개월"];
    const f = {};
    keys.forEach((k) => { const v = $("f_" + k).value.trim(); if (v) f[k] = v; });
    return f;
  }
  async function createContract(thenSend) {
    const entityId = $("cEntity").value, memberId = $("cMember").value;
    if (!entityId || !memberId) { toast("사업자와 직원을 선택하세요", true); return; }
    const body = { action: "create", entityId: Number(entityId), memberId: Number(memberId), fields: collectFields() };
    const r = await api("/api/admin-contracts", { method: "POST", body });
    if (!r.ok) { toast(r.data.error || "생성 실패", true); return; }
    const newId = r.data.data.id;
    if (thenSend) {
      const s = await api("/api/admin-contracts", { method: "POST", body: { action: "send", id: newId } });
      toast(s.ok ? "생성 후 발송했습니다" : (s.data.error || "발송 실패"), !s.ok);
    } else {
      toast("초안을 저장했습니다");
    }
    $("createModal").classList.remove("open");
    loadContracts();
  }
  $("btnCreatePreview").addEventListener("click", () => createContract(false));
  $("btnCreateSend").addEventListener("click", () => createContract(true));

  /* ═══ 사업자 ═══ */
  async function loadEntities() {
    const r = await api("/api/admin-contract-entities");
    ENTITIES = (r.data.data && r.data.data.items) || [];
    const tb = $("entityList");
    if (!ENTITIES.length) { tb.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">사업자가 없습니다</td></tr>`; return; }
    tb.innerHTML = ENTITIES.map((e) => `
      <tr>
        <td>${esc(e.name)}</td>
        <td>${e.entity_type === "corporation" ? "법인·단체" : "개인사업자"}</td>
        <td>${esc(e.representative || "—")}</td>
        <td>${esc(e.biz_no || "—")}</td>
        <td>${e.has_seal ? "✔" : "—"}</td>
        <td>${e.is_active ? "사용" : "비활성"}</td>
        <td><button class="btn btn-default btn-sm" data-edit="${e.id}">편집</button> <button class="btn btn-danger btn-sm" data-del="${e.id}">삭제</button></td>
      </tr>`).join("");
    tb.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEntity(b.dataset.edit)));
    tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delEntity(b.dataset.del)));
  }
  function openEntity(id) {
    const e = id ? ENTITIES.find((x) => String(x.id) === String(id)) : null;
    $("entTitle").textContent = e ? "사업자 편집" : "사업자 추가";
    $("entId").value = e ? e.id : "";
    $("entName").value = e ? e.name : "";
    $("entType").value = e ? e.entity_type : "individual";
    $("entRep").value = e ? (e.representative || "") : "";
    $("entBizNo").value = e ? (e.biz_no || "") : "";
    $("entAddress").value = e ? (e.address || "") : "";
    $("entPhone").value = e ? (e.phone || "") : "";
    $("entSealFile").value = "";
    const prev = $("entSealPreview"), none = $("entSealNone");
    if (e && e.has_seal) { prev.src = "/api/admin-contract-seal?entityId=" + e.id + "&_=" + Date.now(); prev.style.display = "inline-block"; none.style.display = "none"; }
    else { prev.style.display = "none"; none.style.display = "inline"; }
    $("entityModal").classList.add("open");
  }
  $("btnNewEntity").addEventListener("click", () => openEntity(null));
  $("btnSaveEntity").addEventListener("click", async () => {
    const id = $("entId").value;
    const body = {
      action: id ? "update" : "create", id: id ? Number(id) : undefined,
      name: $("entName").value.trim(), entityType: $("entType").value, representative: $("entRep").value.trim(),
      bizNo: $("entBizNo").value.trim(), address: $("entAddress").value.trim(), phone: $("entPhone").value.trim(),
    };
    if (!body.name) { toast("상호를 입력하세요", true); return; }
    const r = await api("/api/admin-contract-entities", { method: "POST", body });
    if (!r.ok) { toast(r.data.error || "저장 실패", true); return; }
    const savedId = id ? Number(id) : r.data.data.id;
    /* 도장 파일이 선택됐으면 업로드 */
    const file = $("entSealFile").files[0];
    if (file) {
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
      const sr = await api("/api/admin-contract-entities", { method: "POST", body: { action: "setSeal", id: savedId, sealPng: dataUrl } });
      if (!sr.ok) { toast("사업자는 저장됐으나 도장 업로드 실패: " + (sr.data.error || ""), true); }
    }
    toast("저장했습니다");
    $("entityModal").classList.remove("open");
    ENTITIES = []; loadEntities();
  });
  async function delEntity(id) {
    if (!confirm("이 사업자를 삭제할까요? (계약이 있으면 비활성화됩니다)")) return;
    const r = await api("/api/admin-contract-entities", { method: "POST", body: { action: "delete", id: Number(id) } });
    toast(r.ok ? (r.data.message || "처리됨") : (r.data.error || "실패"), !r.ok);
    ENTITIES = []; loadEntities();
  }

  /* ═══ 양식 ═══ */
  async function fillTplEntitySelect() {
    if (!ENTITIES.length) { const r = await api("/api/admin-contract-entities"); ENTITIES = (r.data.data && r.data.data.items) || []; }
    $("tplEntity").innerHTML = ENTITIES.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
  }
  async function loadTemplatesForSelected() {
    await fillTplEntitySelect();
    loadTemplates();
  }
  async function loadTemplates() {
    const entityId = $("tplEntity").value;
    if (!entityId) return;
    const r = await api("/api/admin-contract-templates?entityId=" + entityId);
    const tb = $("tplList");
    const items = (r.data.data && r.data.data.items) || [];
    if (!items.length) { tb.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">양식이 없습니다. [새 양식]으로 등록하세요.</td></tr>`; return; }
    tb.innerHTML = items.map((t) => `
      <tr>
        <td>${esc(t.title)}</td><td>v${t.version}</td><td>${t.is_active ? "사용" : "비활성"}</td><td>${fmtDate(t.updated_at)}</td>
        <td><button class="btn btn-default btn-sm" data-tpledit="${t.id}">편집</button></td>
      </tr>`).join("");
    tb.querySelectorAll("[data-tpledit]").forEach((b) => b.addEventListener("click", () => openTpl(b.dataset.tpledit)));
  }
  $("btnReloadTpl").addEventListener("click", loadTemplates);
  $("tplEntity").addEventListener("change", loadTemplates);
  async function openTpl(id) {
    const r = await api("/api/admin-contract-templates?id=" + id);
    if (!r.ok) { toast("불러오기 실패", true); return; }
    const t = r.data.data;
    $("tplModalTitle").textContent = "양식 편집 · " + esc(t.title);
    $("tplId").value = t.id; $("tplEntityId").value = t.entity_id;
    $("tplTitle").value = t.title; $("tplBody").value = t.body;
    $("tplModal").classList.add("open");
  }
  $("btnNewTpl").addEventListener("click", () => {
    const entityId = $("tplEntity").value;
    if (!entityId) { toast("사업자를 먼저 선택하세요", true); return; }
    $("tplModalTitle").textContent = "새 양식";
    $("tplId").value = ""; $("tplEntityId").value = entityId;
    $("tplTitle").value = "정규직 근로계약서"; $("tplBody").value = "";
    $("tplModal").classList.add("open");
  });
  $("btnSaveTpl").addEventListener("click", async () => {
    const id = $("tplId").value;
    const body = id
      ? { action: "update", id: Number(id), title: $("tplTitle").value, body: $("tplBody").value }
      : { action: "create", entityId: Number($("tplEntityId").value), title: $("tplTitle").value, body: $("tplBody").value };
    const r = await api("/api/admin-contract-templates", { method: "POST", body });
    if (!r.ok) { toast(r.data.error || "저장 실패", true); return; }
    toast("저장했습니다"); $("tplModal").classList.remove("open"); loadTemplates();
  });

  /* 초기 로드 */
  loadContracts();
})();
