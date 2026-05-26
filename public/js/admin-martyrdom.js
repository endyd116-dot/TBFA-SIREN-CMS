/* admin-martyrdom.js v1 — 순직 인정 지원 시스템 (Deep-Relief AI v0) */

// ── 8대분류 라벨 맵 (B lib/martyrdom-ai.ts MARTYRDOM_DOC_TYPES와 1:1) ──────
const MARTYRDOM_DOC_TYPES = {
  application:  "신청·행정 서류",
  work_record:  "근무·인사 기록",
  duty_stress:  "직무 스트레스·괴롭힘",
  medical:      "의학·심리 소견",
  investigation:"수사·공적 조사",
  statement:    "진술·증언·유족 정리",
  death_scene:  "사망 정황·현장",
  other:        "기타·참고",
};

const DOC_TYPE_COLORS = {
  application:  "#2563eb",
  work_record:  "#0891b2",
  duty_stress:  "#dc2626",
  medical:      "#7c3aed",
  investigation:"#b45309",
  statement:    "#059669",
  death_scene:  "#64748b",
  other:        "#94a3b8",
};

// ── 상태·결과 라벨 ──────────────────────────────────────────────────────────
const STATUS_LABELS = {
  intake:     "접수",
  collecting: "수집 중",
  analyzing:  "분석 중",
  drafting:   "서면 작성",
  submitted:  "청구 완료",
  closed:     "종결",
};
const OUTCOME_LABELS = { approved: "인정", rejected: "불인정" };
const PROCEDURE_LABELS = { apply: "신청", review: "심의", decided: "결정", reappeal: "재심" };
const EXTRACT_STATUS_LABELS = {
  queued:     "대기(재처리 필요)",
  pending:    "대기",
  processing: "처리 중",
  done:       "완료",
  failed:     "실패",
};

// ── mock (B 머지 전 · 키명 1글자도 변경 금지) ────────────────────────────────
// B 백엔드 머지 완료(2026-05-26) → 실 API 연결
const USE_MOCK = false;

const MOCK_CASES = { ok:true, total:2, cases:[
  { id:1, caseNo:"MTR-20260526-0001", caseKind:"active", title:"○○초 △△ 선생님 사건",
    deceasedName:"△△△", schoolName:"○○초", deceasedAt:"2026-05-01", status:"collecting",
    outcome:null, docCount:3, hasExtraction:true, assignedAdminName:"김간사", createdAt:"2026-05-26T01:00:00Z" },
  { id:2, caseNo:"MTR-20250110-0007", caseKind:"reference", title:"□□초 인정 사례",
    deceasedName:"□□□", schoolName:"□□초", deceasedAt:"2024-12-20", status:"closed",
    outcome:"approved", docCount:5, hasExtraction:true, assignedAdminName:"이전문", createdAt:"2025-01-10T00:00:00Z" } ]};

const MOCK_DETAIL = { ok:true,
  case:{ id:1, caseNo:"MTR-20260526-0001", caseKind:"active", title:"○○초 △△ 선생님 사건",
    deceasedName:"△△△", schoolName:"○○초", position:"교사", deceasedAt:"2026-05-01",
    occurredSummary:"과중 업무·악성 민원 정황", status:"collecting", outcome:null,
    procedureStage:"apply", nextDeadlineAt:"2026-06-15", nextDeadlineLabel:"순직유족급여 청구 기한",
    extractionJson:{ deceased:{name:"△△△",school:"○○초",position:"교사"},
      death:{cause:"과로 추정",place:"자택",datetime:"2026-05-01"},
      dutyRelevance:{overwork:"주 60시간",harassment:"학부모 민원 다수",stress:"",narrative:"..."},
      timeline:[{date:"2026-04-10",event:"민원 폭주"}], evidenceHave:["근무기록","진단서"],
      evidenceMissing:["메신저 대화","CCTV"], keyIssues:["공무상 과로 인과관계"], confidence:0.62 },
    extractedAt:"2026-05-26T02:00:00Z", assignedAdminId:7 },
  documents:[ { id:10, fileName:"순직신청서.pdf", docType:"application", docTypeAuto:"application",
    docSummary:"순직유족급여청구서 — 고인 인적사항·청구 요지", classifyConfidence:92,
    mimeType:"application/pdf", extractStatus:"done", extractMethod:"native_pdf", indexedToRag:false, blobUrl:"#", createdAt:"..." },
    { id:11, fileName:"민원기록.png", docType:"duty_stress", docTypeAuto:"duty_stress",
    docSummary:"학부모 악성 민원 메시지 캡처", classifyConfidence:88,
    mimeType:"image/png", extractStatus:"done", extractMethod:"gemini_ocr", indexedToRag:false, blobUrl:"#", createdAt:"..." },
    { id:12, fileName:"개인메모.pdf", docType:"other", docTypeAuto:"other",
    docSummary:"유족 개인 정리 메모", classifyConfidence:58,
    mimeType:"application/pdf", extractStatus:"processing", extractMethod:null, indexedToRag:false, blobUrl:"#", createdAt:"..." } ],
  outputs:[ { id:50, outputType:"extraction", version:1, status:"draft", contentJson:{}, ragSources:[],
    modelUsed:"gemini-3-flash", createdAt:"..." } ] };

// ─────────────────────────────────────────────────────────────────────────────

let currentKind = "active";   // "active" | "reference"
let currentCaseId = null;
let currentDetail = null;
let pollTimer = null;

// ── 공통 유틸 ──────────────────────────────────────────────────────────────
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast show " + type;
  setTimeout(() => el.classList.remove("show"), 2800);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"]/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );
}

function fmtDate(d) {
  if (!d) return "-";
  return String(d).slice(0, 10);
}

function dday(dateStr) {
  if (!dateStr) return "";
  const diff = Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
  if (diff === 0) return "D-day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
    ...(opts.body && typeof opts.body !== "string"
      ? { body: JSON.stringify(opts.body) }
      : {}),
  });
  if (r.status === 401 || r.status === 403) {
    window.location.href = "/admin.html";
    throw new Error("auth");
  }
  return r.json();
}

// mock / 실 API 분기
async function apiCases(kind) {
  if (USE_MOCK) return { ...MOCK_CASES, cases: MOCK_CASES.cases.filter(c => c.caseKind === kind) };
  return apiFetch(`/api/admin-martyrdom-cases?kind=${kind}`);
}
async function apiDetail(id) {
  if (USE_MOCK) return MOCK_DETAIL;
  return apiFetch(`/api/admin-martyrdom-case-detail?id=${id}`);
}
async function apiCreateCase(body) {
  if (USE_MOCK) return { ok: true, case: { id: 99, caseNo: "MTR-MOCK-9999", ...body } };
  return apiFetch("/api/admin-martyrdom-cases", { method: "POST", body });
}
async function apiPatchCase(id, body) {
  if (USE_MOCK) return { ok: true };
  return apiFetch("/api/admin-martyrdom-cases", { method: "PATCH", body: { id, ...body } });
}
async function apiDocUpload(body) {
  if (USE_MOCK) return { ok: true, uploadUrl: "#mock-upload", blobKey: "mock-key", docId: Date.now(), expiresIn: 600 };
  return apiFetch("/api/admin-martyrdom-doc-upload", { method: "POST", body });
}
async function apiDocRegister(docId) {
  if (USE_MOCK) return { ok: true, docId, extractQueued: true };
  return apiFetch("/api/admin-martyrdom-doc-register", { method: "POST", body: { docId } });
}
async function apiReclassify(docId, payload) {
  if (USE_MOCK) return { ok: true, docId };
  return apiFetch("/api/admin-martyrdom-doc-reclassify", { method: "PATCH", body: { docId, ...payload } });
}
async function apiReanalyze(caseId) {
  if (USE_MOCK) return { ok: true, analyzeQueued: true };
  return apiFetch("/api/admin-martyrdom-reanalyze", { method: "POST", body: { caseId } });
}
async function apiDocDelete(docId) {
  if (USE_MOCK) return { ok: true, docId };
  return apiFetch("/api/admin-martyrdom-doc-delete?docId=" + encodeURIComponent(docId), { method: "DELETE" });
}
async function apiDocDeleteAll(caseId) {
  if (USE_MOCK) return { ok: true, deleted: 0 };
  return apiFetch("/api/admin-martyrdom-doc-delete?caseId=" + encodeURIComponent(caseId) + "&all=1", { method: "DELETE" });
}

// ── 사건 목록 ───────────────────────────────────────────────────────────────
async function loadCases() {
  const list = document.getElementById("caseList");
  list.innerHTML = '<div class="list-loading">불러오는 중…</div>';
  try {
    const d = await apiCases(currentKind);
    if (!d.ok) { toast("목록 불러오기 실패", "error"); list.innerHTML = ""; return; }
    renderCaseList(d.cases || []);
  } catch (e) {
    if (e.message !== "auth") { toast("네트워크 오류", "error"); list.innerHTML = ""; }
  }
}

function renderCaseList(cases) {
  const list = document.getElementById("caseList");
  if (!cases.length) {
    list.innerHTML = '<div class="list-empty">사건이 없습니다</div>';
    return;
  }
  list.innerHTML = cases.map(c => {
    const active = c.id === currentCaseId ? " active" : "";
    const outcome = c.outcome ? `<span class="badge outcome-${c.outcome}">${OUTCOME_LABELS[c.outcome] || c.outcome}</span>` : "";
    return `<div class="case-item${active}" onclick="selectCase(${c.id})">
      <div class="case-item-title">${escapeHtml(c.title)}${outcome}</div>
      <div class="case-item-meta">
        <span class="badge status-badge">${STATUS_LABELS[c.status] || c.status}</span>
        <span>자료 ${c.docCount}건</span>
        ${c.assignedAdminName ? `<span>${escapeHtml(c.assignedAdminName)}</span>` : ""}
      </div>
    </div>`;
  }).join("");
}

async function selectCase(id) {
  currentCaseId = id;
  // 목록 active 갱신
  document.querySelectorAll(".case-item").forEach(el => {
    el.classList.toggle("active", el.onclick?.toString().includes(`(${id})`));
  });
  await loadDetail(id);
  switchTab("tab-docs"); // 기본 탭: ②자료
}

// ── 사건 상세 ───────────────────────────────────────────────────────────────
async function loadDetail(id) {
  const pane = document.getElementById("detailPane");
  pane.innerHTML = '<div class="list-loading">불러오는 중…</div>';
  clearPollTimer();
  try {
    const d = await apiDetail(id);
    if (!d.ok) { toast("상세 불러오기 실패", "error"); return; }
    currentDetail = d;
    renderDetail(d);
    startPoll(id);
  } catch (e) {
    if (e.message !== "auth") toast("네트워크 오류", "error");
  }
}

function renderDetail(d) {
  const c = d.case;
  const pane = document.getElementById("detailPane");
  const ddayStr = c.nextDeadlineAt ? `<span class="dday-badge">${dday(c.nextDeadlineAt)}</span>` : "";
  pane.innerHTML = `
<div class="detail-header">
  <div class="detail-title">
    <span class="case-no">${escapeHtml(c.caseNo)}</span>
    <span class="case-title">${escapeHtml(c.title)}</span>
    <button class="btn-sm btn-secondary" onclick="openEditCaseModal()" style="margin-left:auto">✏️ 수정</button>
    <button class="btn-sm btn-warn" onclick="deleteCase()">🗑 삭제</button>
  </div>
  <div class="detail-meta-row">
    <label>작업 상태
      <select id="selStatus" onchange="patchCase('status',this.value)">
        ${Object.entries(STATUS_LABELS).map(([v,l])=>`<option value="${v}"${c.status===v?" selected":""}>${l}</option>`).join("")}
      </select>
    </label>
    <label>결과
      <select id="selOutcome" onchange="patchCase('outcome',this.value||null)">
        <option value="">진행 중</option>
        <option value="approved"${c.outcome==="approved"?" selected":""}>인정</option>
        <option value="rejected"${c.outcome==="rejected"?" selected":""}>불인정</option>
      </select>
    </label>
  </div>
  <div class="detail-procedure-row">
    <label>행정 절차 단계
      <select id="selProcedure" onchange="patchCase('procedureStage',this.value)">
        <option value="">-</option>
        ${Object.entries(PROCEDURE_LABELS).map(([v,l])=>`<option value="${v}"${c.procedureStage===v?" selected":""}>${l}</option>`).join("")}
      </select>
    </label>
    <span class="deadline-info">
      ${c.nextDeadlineLabel ? `<strong>${escapeHtml(c.nextDeadlineLabel)}</strong>` : "기한 없음"}
      ${c.nextDeadlineAt ? `<span class="deadline-date">${fmtDate(c.nextDeadlineAt)}</span>${ddayStr}` : ""}
    </span>
    <button class="btn-sm btn-secondary" onclick="openDeadlineModal()">기한 편집</button>
  </div>
</div>
<div class="tab-bar">
  <button class="tab-btn active" id="tab-golden"   onclick="switchTab('tab-golden')">① 골든타임</button>
  <button class="tab-btn"        id="tab-docs"     onclick="switchTab('tab-docs')">② 자료</button>
  <button class="tab-btn"        id="tab-analysis" onclick="switchTab('tab-analysis')">③ 분석</button>
  <button class="tab-btn"        id="tab-draft"    onclick="switchTab('tab-draft')">④ 서면</button>
</div>
<div id="tab-content">
  ${renderTabGolden()}
  ${renderTabDocs(d)}
  ${renderTabAnalysis()}
  ${renderTabDraft()}
</div>`;
}

// ── 탭 전환 ─────────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.style.display = "none");
  const btn = document.getElementById(tabId);
  if (btn) btn.classList.add("active");
  const panel = document.getElementById(tabId + "-panel");
  if (panel) panel.style.display = "";
}

// ── ① 골든타임 탭 (P2 placeholder) ─────────────────────────────────────────
function renderTabGolden() {
  return `<div class="tab-panel" id="tab-golden-panel" style="display:none">
  <div class="placeholder-box">
    <div class="placeholder-icon">⏱️</div>
    <div class="placeholder-title">① 골든타임 자료 제언</div>
    <div class="placeholder-desc">P2에서 구현됩니다. 휘발성 높은 자료(메신저·CCTV 등)의 우선 확보 체크리스트와 AI 맞춤 제언을 제공합니다.</div>
  </div>
</div>`;
}

// ── ② 자료 탭 ───────────────────────────────────────────────────────────────
function renderTabDocs(d) {
  const docs = d.documents || [];
  const extraction = d.case.extractionJson;
  const pendingCount = docs.filter(x => x.extractStatus === "processing" || x.extractStatus === "pending").length;
  const failedCount  = docs.filter(x => x.extractStatus === "failed").length;
  const notDoneCount = docs.filter(x => x.extractStatus !== "done").length;

  return `<div class="tab-panel" id="tab-docs-panel" style="display:none">
  <!-- 진행 표시 -->
  ${pendingCount > 0 ? `<div class="progress-banner">⏳ ${pendingCount}건 처리 중 — 자동으로 갱신됩니다</div>` : ""}
  ${failedCount  > 0 ? `<div class="error-banner">❌ ${failedCount}건 추출 실패 — 아래 행에서 재시도하거나 텍스트를 직접 입력해주세요</div>` : ""}
  ${docs.length > 0 ? `<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    ${notDoneCount > 0 ? `<button class="btn-sm btn-warn" onclick="batchRetryDocs()">⟳ 미완료 ${notDoneCount}건 전체 재시도</button>` : ""}
    <button class="btn-sm btn-danger" onclick="deleteAllDocs()">🗑 전체 삭제 (${docs.length}건 · 처음부터)</button>
    <small style="color:#94a3b8">완료 자료도 행에서 [재처리]·[삭제] 가능</small>
  </div>` : ""}

  <!-- 업로드 영역 -->
  <div class="upload-area">
    <label class="upload-label" for="fileInput">
      <span class="upload-icon">⬆</span>
      <span class="upload-text">아무 자료나 업로드<br><small>PDF·이미지·워드·텍스트 등 · 여러 파일 동시 선택 가능 · AI가 자동 분류합니다</small></span>
      <input id="fileInput" type="file" multiple style="display:none" onchange="handleFileSelect(event)">
    </label>
  </div>

  <!-- 자료 목록 -->
  <div class="doc-table-wrap">
    <table class="doc-table">
      <thead>
        <tr>
          <th>파일명</th>
          <th>분류</th>
          <th>AI 한줄 요약</th>
          <th>확신도</th>
          <th>상태</th>
          <th>작업</th>
        </tr>
      </thead>
      <tbody id="docTableBody">
        ${docs.map(doc => renderDocRow(doc)).join("") || '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px">자료가 없습니다</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- 사건 구조 자동 추출 결과 -->
  <div class="extraction-section">
    <div class="extraction-header">
      <h3>사건 구조 자동 추출 결과</h3>
      <button class="btn-sm btn-secondary" onclick="reanalyze()">🔄 재추출</button>
    </div>
    ${extraction ? renderExtraction(extraction) : '<div class="no-extraction">자료를 업로드하면 자동으로 사건 구조를 추출합니다</div>'}
  </div>
</div>`;
}

function renderDocRow(doc) {
  /* ★ 2026-05-26: 유효 분류 = 수기수정(docType) 우선, 없으면 AI 자동판정(docTypeAuto).
     기존엔 docType(수기·보통 NULL)만 봐서 자동분류가 성공해도 드롭다운이 첫 옵션
     '신청·행정 서류'로 잘못 보였음. 둘 다 없으면 '미분류'. */
  const effectiveType = doc.docType || doc.docTypeAuto || "";
  const hasType = !!(effectiveType && MARTYRDOM_DOC_TYPES[effectiveType]);
  const typeColor = DOC_TYPE_COLORS[effectiveType] || "#94a3b8";
  const conf = doc.classifyConfidence || 0;
  const confBadge = conf < 70 ? `<span class="conf-badge conf-low">확인 필요(${conf}%)</span>` : `<span class="conf-badge">${conf}%</span>`;
  const statusLabel = EXTRACT_STATUS_LABELS[doc.extractStatus] || doc.extractStatus;
  const statusClass = `extract-${doc.extractStatus}`;

  const actions = [];
  actions.push(`<button class="btn-sm" onclick="viewDoc(${doc.id})">보기</button>`);
  /* 재처리: 완료 자료도 다시 추출·분류 가능(Swain 2026-05-26 — 한번 완료된 것도 다시).
     진행 중(processing/pending)만 제외해 중복 트리거 방지. */
  if (doc.extractStatus !== "processing" && doc.extractStatus !== "pending") {
    const label = doc.extractStatus === "done" ? "재처리" : "재시도";
    actions.push(`<button class="btn-sm btn-warn" onclick="retryDoc(${doc.id})">${label}</button>`);
    actions.push(`<button class="btn-sm btn-secondary" onclick="openManualTextModal(${doc.id})">텍스트 직접 입력</button>`);
  }
  /* 개별 삭제 — R2 원본·RAG 색인·행 제거(CRUD) */
  actions.push(`<button class="btn-sm btn-danger" onclick="deleteDoc(${doc.id})">삭제</button>`);

  // 분류 드롭다운 — 미분류면 ' 미분류' placeholder 선택(첫 옵션 오표시 방지)
  const typeDropdown = `<select class="type-select" onchange="reclassifyDoc(${doc.id}, this.value)" style="border-color:${typeColor}">
    <option value=""${hasType ? "" : " selected"} disabled hidden>미분류</option>
    ${Object.entries(MARTYRDOM_DOC_TYPES).map(([v,l])=>`<option value="${v}"${effectiveType===v?" selected":""}>${l}</option>`).join("")}
  </select>`;

  /* ★ 2026-05-26: 실패/문제 자료는 요약칸에 실제 사유(extractError)를 빨강으로 노출 —
     기존엔 '-'만 보여 왜 실패했는지(엑셀 미지원·AI 한도·타임아웃 등) 알 수 없었음. */
  const summaryCell = (doc.extractError && doc.extractStatus !== "done")
    ? `<span style="color:#c5293a;font-size:11.5px" title="${escapeHtml(doc.extractError)}">⚠ ${escapeHtml(String(doc.extractError).slice(0, 80))}</span>`
    : escapeHtml(doc.docSummary || "-");

  return `<tr id="doc-row-${doc.id}">
    <td class="doc-filename" title="${escapeHtml(doc.fileName)}">${escapeHtml(doc.fileName)}</td>
    <td>${typeDropdown}</td>
    <td class="doc-summary">${summaryCell}</td>
    <td>${confBadge}</td>
    <td><span class="extract-badge ${statusClass}" title="${escapeHtml(doc.extractError || statusLabel)}">${statusLabel}</span></td>
    <td class="doc-actions">${actions.join(" ")}</td>
  </tr>`;
}

function renderExtraction(ex) {
  const missing = ex.evidenceMissing || [];
  const have    = ex.evidenceHave || [];
  const conf    = ex.confidence != null ? Math.round(ex.confidence * 100) : null;

  return `<div class="extraction-grid">
    <div class="ex-card">
      <div class="ex-label">고인</div>
      <div>${escapeHtml(ex.deceased?.name || "-")} · ${escapeHtml(ex.deceased?.school || "")} · ${escapeHtml(ex.deceased?.position || "")}</div>
    </div>
    <div class="ex-card">
      <div class="ex-label">사망</div>
      <div>${escapeHtml(ex.death?.cause || "-")} / ${escapeHtml(ex.death?.place || "")} / ${fmtDate(ex.death?.datetime)}</div>
    </div>
    <div class="ex-card">
      <div class="ex-label">직무 관련성</div>
      <div>
        ${ex.dutyRelevance?.overwork ? `<span class="tag">초과근무: ${escapeHtml(ex.dutyRelevance.overwork)}</span>` : ""}
        ${ex.dutyRelevance?.harassment ? `<span class="tag">괴롭힘: ${escapeHtml(ex.dutyRelevance.harassment)}</span>` : ""}
      </div>
    </div>
    <div class="ex-card">
      <div class="ex-label">확보 증거</div>
      <div class="evidence-list have">${have.map(e => `<span class="ev-tag ev-have">${escapeHtml(e)}</span>`).join("")}</div>
    </div>
    ${missing.length ? `<div class="ex-card ex-missing">
      <div class="ex-label">⚠️ 부족 증거 (다음 확보 대상)</div>
      <div class="evidence-list missing">${missing.map(e => `<span class="ev-tag ev-missing">${escapeHtml(e)}</span>`).join("")}</div>
    </div>` : ""}
    ${ex.keyIssues?.length ? `<div class="ex-card">
      <div class="ex-label">핵심 쟁점</div>
      <div>${ex.keyIssues.map(i => `<span class="tag">${escapeHtml(i)}</span>`).join(" ")}</div>
    </div>` : ""}
    ${conf != null ? `<div class="ex-card">
      <div class="ex-label">AI 신뢰도</div>
      <div><span class="${conf < 60 ? "conf-badge conf-low" : "conf-badge"}">${conf}%</span></div>
    </div>` : ""}
  </div>`;
}

// ── ③ 분석 탭 (P2 placeholder) ──────────────────────────────────────────────
function renderTabAnalysis() {
  return `<div class="tab-panel" id="tab-analysis-panel" style="display:none">
  <div class="placeholder-box">
    <div class="placeholder-icon">🔍</div>
    <div class="placeholder-title">③ 전략 분석</div>
    <div class="placeholder-desc">P2에서 구현됩니다. 인정 가능 논리·부족 자료·핵심 쟁점·예상 반론·타임라인을 AI가 자동으로 분석합니다.</div>
  </div>
</div>`;
}

// ── ④ 서면 탭 (P3 placeholder) ──────────────────────────────────────────────
function renderTabDraft() {
  return `<div class="tab-panel" id="tab-draft-panel" style="display:none">
  <div class="alert-banner expert-warning">⚠️ 전문가 검토용 초안 — 변호사·노무사 확인 필수</div>
  <div class="placeholder-box">
    <div class="placeholder-icon">📄</div>
    <div class="placeholder-title">④ 청구서·의견서 초안</div>
    <div class="placeholder-desc">P3에서 구현됩니다. 인정 받은 과거 사례를 모델로 삼아 유족급여신청서(순직신청서) 초안을 자동 생성합니다.</div>
  </div>
</div>`;
}

// ── PATCH 사건 필드 ─────────────────────────────────────────────────────────
async function patchCase(field, value) {
  if (!currentCaseId) return;
  try {
    const d = await apiPatchCase(currentCaseId, { [field]: value });
    if (!d.ok) { toast("저장 실패: " + (d.error || ""), "error"); return; }
    toast("저장했습니다");
  } catch (e) {
    if (e.message !== "auth") toast("저장 오류", "error");
  }
}

// ── 새 사건 모달 ─────────────────────────────────────────────────────────────
let editingCaseId = null;  // null = 새 사건 / 값 = 수정 중

function openNewCaseModal() {
  editingCaseId = null;
  document.getElementById("newCaseForm").reset();
  const t = document.getElementById("newCaseModalTitle"); if (t) t.textContent = "새 사건 등록";
  document.getElementById("newCaseModal").style.display = "flex";
}
function openEditCaseModal() {
  if (!currentDetail) return;
  const c = currentDetail.case;
  editingCaseId = c.id;
  document.getElementById("nc_title").value        = c.title || "";
  document.getElementById("nc_deceasedName").value = c.deceasedName || "";
  document.getElementById("nc_schoolName").value   = c.schoolName || "";
  document.getElementById("nc_deceasedAt").value   = c.deceasedAt ? String(c.deceasedAt).slice(0,10) : "";
  document.getElementById("nc_caseKind").value     = c.caseKind || "active";
  const t = document.getElementById("newCaseModalTitle"); if (t) t.textContent = "사건 정보 수정";
  document.getElementById("newCaseModal").style.display = "flex";
}
function closeNewCaseModal() {
  document.getElementById("newCaseModal").style.display = "none";
  document.getElementById("newCaseForm").reset();
  editingCaseId = null;
}

async function submitNewCase() {
  const title        = document.getElementById("nc_title").value.trim();
  const deceasedName = document.getElementById("nc_deceasedName").value.trim();
  const schoolName   = document.getElementById("nc_schoolName").value.trim();
  const deceasedAt   = document.getElementById("nc_deceasedAt").value;
  const caseKind     = document.getElementById("nc_caseKind").value;
  if (!title) { toast("사건 제목을 입력해주세요", "error"); return; }
  const eid = editingCaseId;  // 닫기 전에 캡처(close가 editingCaseId 초기화)
  try {
    if (eid) {
      /* 수정 (CRUD·PATCH) */
      const d = await apiPatchCase(eid, { title, deceasedName, schoolName, deceasedAt, caseKind });
      if (!d.ok) { toast("수정 실패: " + (d.error || ""), "error"); return; }
      toast("사건 정보를 수정했습니다");
      closeNewCaseModal();
      await loadCases();
      await loadDetail(eid);
      return;
    }
    /* 생성 */
    const d = await apiCreateCase({ title, deceasedName, schoolName, deceasedAt, caseKind });
    if (!d.ok) { toast("생성 실패: " + (d.error || ""), "error"); return; }
    toast("사건이 생성되었습니다");
    closeNewCaseModal();
    currentKind = caseKind;
    setKindToggle(caseKind);
    await loadCases();
    // 서버 응답은 최상위 id·caseNo 반환(§2.3) — mock의 d.case.id 도 폴백 지원
    const newId = d.id || d.case?.id;
    if (newId) selectCase(newId);
  } catch (e) {
    if (e.message !== "auth") toast(eid ? "수정 오류" : "생성 오류", "error");
  }
}

/* 사건 삭제 (CRUD·super_admin 전용·자료·분석 함께 삭제) */
async function deleteCase() {
  if (!currentCaseId) return;
  if (!confirm("이 사건과 모든 자료·AI 분석이 삭제됩니다. 되돌릴 수 없습니다. 삭제할까요?")) return;
  try {
    /* 권한 거절(403)도 토스트로 보여주려고 직접 fetch (apiFetch는 403이면 로그인으로 리다이렉트) */
    const r = await fetch(`/api/admin-martyrdom-cases?id=${currentCaseId}`, { method: "DELETE", credentials: "include" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast(data.error || (r.status === 403 ? "삭제 권한이 없습니다 (슈퍼어드민 전용)" : "삭제 실패"), "error");
      return;
    }
    toast("사건을 삭제했습니다");
    currentCaseId = null; currentDetail = null;
    const pane = document.getElementById("detailPane");
    if (pane) pane.innerHTML = '<div class="empty-detail"><div class="empty-icon">🕊️</div><div>왼쪽에서 사건을 선택하거나 새 사건을 등록하세요</div></div>';
    await loadCases();
  } catch (e) {
    toast("삭제 오류", "error");
  }
}

// ── 기한 편집 모달 ──────────────────────────────────────────────────────────
function openDeadlineModal() {
  if (!currentDetail) return;
  const c = currentDetail.case;
  document.getElementById("dl_stage").value = c.procedureStage || "";
  document.getElementById("dl_date").value  = c.nextDeadlineAt ? c.nextDeadlineAt.slice(0, 10) : "";
  document.getElementById("dl_label").value = c.nextDeadlineLabel || "";
  document.getElementById("deadlineModal").style.display = "flex";
}
function closeDeadlineModal() {
  document.getElementById("deadlineModal").style.display = "none";
}
async function submitDeadline() {
  const procedureStage    = document.getElementById("dl_stage").value;
  const nextDeadlineAt    = document.getElementById("dl_date").value;
  const nextDeadlineLabel = document.getElementById("dl_label").value.trim();
  try {
    const d = await apiPatchCase(currentCaseId, { procedureStage, nextDeadlineAt, nextDeadlineLabel });
    if (!d.ok) { toast("저장 실패", "error"); return; }
    toast("기한을 저장했습니다");
    closeDeadlineModal();
    await loadDetail(currentCaseId);
    switchTab("tab-docs");
  } catch (e) {
    if (e.message !== "auth") toast("저장 오류", "error");
  }
}

// ── 분류 수정 ───────────────────────────────────────────────────────────────
async function reclassifyDoc(docId, docType) {
  try {
    const d = await apiReclassify(docId, { docType });
    if (!d.ok) { toast("분류 저장 실패", "error"); return; }
    toast("분류를 변경했습니다");
  } catch (e) {
    if (e.message !== "auth") toast("분류 오류", "error");
  }
}

// ── 파일 업로드 흐름 ─────────────────────────────────────────────────────────
// ── 일괄 진행 오버레이 (업로드·전체삭제 공통) ───────────────────────────────
let _bulkCancel = false;
let _bulkXhr = null;

function openBulkProgress(title, total, accent) {
  _bulkCancel = false;
  let el = document.getElementById("bulkProgressOverlay");
  if (!el) { el = document.createElement("div"); el.id = "bulkProgressOverlay"; el.className = "modal-overlay"; document.body.appendChild(el); }
  const cls = accent === "danger" ? "danger" : "";
  el.innerHTML =
    '<div class="modal-box">' +
      '<div class="bp-title">' + title + '</div>' +
      '<div class="bp-count"><b id="bpCur">0</b> / ' + total + '건</div>' +
      '<div class="bp-file" id="bpFile">준비 중…</div>' +
      '<div class="bp-bar"><div class="bp-bar-fill ' + cls + '" id="bpFill" style="width:0%"></div></div>' +
      '<div class="bp-pct"><b id="bpPct">0</b>% 진행 · <span id="bpRemain">' + total + '</span>건 남음</div>' +
      '<div class="bp-actions"><button class="btn-sm btn-danger" id="bpCancel">취소</button></div>' +
    '</div>';
  el.style.display = "flex";
  el.querySelector("#bpCancel").onclick = () => {
    _bulkCancel = true;
    if (_bulkXhr) { try { _bulkXhr.abort(); } catch (_) {} }
    const b = el.querySelector("#bpCancel");
    if (b) { b.textContent = "취소 중… (현재 항목까지)"; b.disabled = true; }
  };
}
function updateBulkProgress(done, total, fileLabel, fileFrac) {
  const el = document.getElementById("bulkProgressOverlay");
  if (!el) return;
  const pct = total ? Math.min(100, Math.round(((done + (fileFrac || 0)) / total) * 100)) : 0;
  const set = (id, v) => { const n = el.querySelector("#" + id); if (n) n.textContent = v; };
  set("bpCur", Math.min(done + (fileFrac ? 1 : 0), total));
  if (fileLabel != null) set("bpFile", fileLabel);
  set("bpPct", pct);
  set("bpRemain", Math.max(0, total - done));
  const fill = el.querySelector("#bpFill"); if (fill) fill.style.width = pct + "%";
}
function finishBulkProgress(msg, state) {
  const el = document.getElementById("bulkProgressOverlay");
  if (!el) return;
  const fill = el.querySelector("#bpFill");
  if (fill) { fill.style.width = "100%"; fill.className = "bp-bar-fill " + (state === "cancel" ? "cancel" : "done"); }
  const file = el.querySelector("#bpFile"); if (file) file.textContent = msg;
  const actions = el.querySelector(".bp-actions");
  if (actions) actions.innerHTML = '<button class="btn-sm" id="bpClose">닫기</button>';
  const close = el.querySelector("#bpClose"); if (close) close.onclick = () => { el.style.display = "none"; };
  setTimeout(() => { const e2 = document.getElementById("bulkProgressOverlay"); if (e2) e2.style.display = "none"; }, 2800);
}

/* R2 직접 업로드 — XHR로 바이트 진행률 + 취소(abort) 지원 */
function putToR2(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    _bulkXhr = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total); };
    xhr.onload = () => { _bulkXhr = null; (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error("R2 " + xhr.status)); };
    xhr.onerror = () => { _bulkXhr = null; reject(new Error("network")); };
    xhr.onabort = () => { _bulkXhr = null; reject(new Error("aborted")); };
    xhr.send(file);
  });
}

async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length || !currentCaseId) return;
  e.target.value = "";

  openBulkProgress("📤 자료 업로드", files.length);
  let ok = 0, fail = 0, done = 0;
  for (let i = 0; i < files.length; i++) {
    if (_bulkCancel) break;
    const file = files[i];
    const label = `(${i + 1}/${files.length}) ${file.name}`;
    updateBulkProgress(done, files.length, label, 0.001);
    const r = await uploadSingleFile(file, (frac) => updateBulkProgress(done, files.length, label, frac));
    done++;
    if (r) ok++; else fail++;
    updateBulkProgress(done, files.length, label, 0);
  }
  const cancelled = _bulkCancel;
  finishBulkProgress(
    cancelled ? `취소됨 — ${ok}건 완료, ${files.length - done}건 중단` : `완료 — ${ok}건 업로드${fail ? `, ${fail}건 실패` : ""} · AI 분류 중`,
    cancelled ? "cancel" : "done"
  );
  await loadDetail(currentCaseId);
  switchTab("tab-docs");
}

/* 한 파일 업로드(presign→R2 PUT→완료통지). 진행률 콜백·성공 여부 반환. */
async function uploadSingleFile(file, onProgress) {
  try {
    const meta = await apiDocUpload({
      caseId: currentCaseId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!meta.ok) return false;

    if (!USE_MOCK && meta.uploadUrl !== "#mock-upload") {
      await putToR2(meta.uploadUrl, file, file.type || "application/octet-stream", onProgress);
    } else if (onProgress) { onProgress(1); }

    const reg = await apiDocRegister(meta.docId);
    return !!reg.ok;
  } catch (e) {
    /* auth는 apiFetch가 로그인 유도 처리 — 여기선 실패로만 집계 */
    return false;
  }
}

// ── 재시도 ──────────────────────────────────────────────────────────────────
async function retryDoc(docId) {
  try {
    const d = await apiDocRegister(docId);
    if (!d.ok) { toast("재시도 실패", "error"); return; }
    toast("재시도 요청을 보냈습니다");
    startPoll(currentCaseId);
  } catch (e) {
    if (e.message !== "auth") toast("재시도 오류", "error");
  }
}

/* 일괄 재시도 — 미완료(대기·처리중·실패) 자료 전체 재처리 (Swain 2026-05-26·91건 대응) */
async function batchRetryDocs() {
  if (!currentDetail) return;
  const targets = (currentDetail.documents || []).filter(x => x.extractStatus !== "done");
  if (!targets.length) { toast("재시도할 자료가 없습니다"); return; }
  if (!confirm(`미완료 ${targets.length}건을 전체 재시도합니다. 백그라운드에서 순차 처리됩니다. 시작할까요?`)) return;
  toast(`${targets.length}건 재시도 요청 중…`);
  let ok = 0;
  for (const d of targets) {
    try { const r = await apiDocRegister(d.id); if (r.ok) ok++; } catch (e) { /* 개별 실패 무시 */ }
    await new Promise(res => setTimeout(res, 250));  /* 백그라운드 폭주 완화 */
  }
  toast(`${ok}/${targets.length}건 재시도 요청 완료 — 자동 갱신됩니다`);
  startPoll(currentCaseId);
}

/* 개별 자료 삭제 (R2 원본·RAG 색인·행 제거) */
async function deleteDoc(docId) {
  const doc = (currentDetail?.documents || []).find(d => d.id === docId);
  const name = doc ? doc.fileName : "이 자료";
  if (!confirm(`'${name}'을(를) 삭제합니다. 원본 파일·AI 색인도 함께 삭제되며 되돌릴 수 없습니다. 계속할까요?`)) return;
  try {
    const d = await apiDocDelete(docId);
    if (!d.ok) { toast(d.error || "삭제 실패", "error"); return; }
    toast("자료를 삭제했습니다");
    if (currentCaseId) loadDetail(currentCaseId);
  } catch (e) {
    if (e.message !== "auth") toast("삭제 오류", "error");
  }
}

/* 사건의 모든 자료 삭제 — 처음부터 다시 (Swain 2026-05-26) */
async function deleteAllDocs() {
  if (!currentDetail || !currentCaseId) return;
  const docs = (currentDetail.documents || []).slice();
  if (!docs.length) { toast("삭제할 자료가 없습니다"); return; }
  if (!confirm(`이 사건의 자료 ${docs.length}건을 모두 삭제합니다.\n원본 파일·AI 색인까지 전부 제거되며 되돌릴 수 없습니다.\n계속할까요?`)) return;

  /* 파일별 진행 표시(서버 일괄 1콜은 진행이 안 보여 헷갈림 → 한 건씩 + 진행률·취소) */
  openBulkProgress("🗑 자료 전체 삭제", docs.length, "danger");
  let ok = 0, done = 0;
  for (let i = 0; i < docs.length; i++) {
    if (_bulkCancel) break;
    const d = docs[i];
    updateBulkProgress(done, docs.length, `(${i + 1}/${docs.length}) ${d.fileName}`, 0.5);
    try { const r = await apiDocDelete(d.id); if (r && r.ok) ok++; } catch (e) { /* 개별 실패 무시 */ }
    done++;
    updateBulkProgress(done, docs.length, `(${i + 1}/${docs.length}) ${d.fileName}`, 0);
  }
  const cancelled = _bulkCancel;
  finishBulkProgress(
    cancelled ? `취소됨 — ${ok}건 삭제, ${docs.length - done}건 남김` : `${ok}건 삭제 완료 — 처음부터 다시 업로드할 수 있습니다`,
    cancelled ? "cancel" : "done"
  );
  loadDetail(currentCaseId);
}

// ── 텍스트 직접 입력 모달 ────────────────────────────────────────────────────
let manualDocId = null;
function openManualTextModal(docId) {
  manualDocId = docId;
  document.getElementById("manualText").value = "";
  document.getElementById("manualTextModal").style.display = "flex";
}
function closeManualTextModal() {
  document.getElementById("manualTextModal").style.display = "none";
  manualDocId = null;
}
async function submitManualText() {
  const text = document.getElementById("manualText").value.trim();
  if (!text) { toast("내용을 입력해주세요", "error"); return; }
  try {
    const d = await apiReclassify(manualDocId, { extractedText: text });
    if (!d.ok) { toast("저장 실패", "error"); return; }
    toast("텍스트를 저장했습니다 — AI 분류 중");
    closeManualTextModal();
    startPoll(currentCaseId);
  } catch (e) {
    if (e.message !== "auth") toast("저장 오류", "error");
  }
}

// ── 자료 원문 뷰어 (G6) ─────────────────────────────────────────────────────
async function viewDoc(docId) {
  const doc = (currentDetail?.documents || []).find(d => d.id === docId);
  if (!doc) return;
  const modal = document.getElementById("viewerModal");
  const content = document.getElementById("viewerContent");

  if (doc.blobUrl && doc.blobUrl !== "#") {
    const isPdf   = doc.mimeType === "application/pdf";
    const isImage = doc.mimeType?.startsWith("image/");
    if (isPdf) {
      content.innerHTML = `<iframe src="${escapeHtml(doc.blobUrl)}" style="width:100%;height:70vh;border:none"></iframe>`;
    } else if (isImage) {
      content.innerHTML = `<img src="${escapeHtml(doc.blobUrl)}" style="max-width:100%;max-height:70vh;object-fit:contain">`;
    } else {
      content.innerHTML = `<a href="${escapeHtml(doc.blobUrl)}" target="_blank">파일 다운로드</a>`;
    }
  } else {
    content.innerHTML = `<div style="padding:24px;color:#64748b;text-align:center">${USE_MOCK ? "(mock — 실 URL 없음)" : "파일 URL을 불러오는 중…"}</div>`;
  }
  document.getElementById("viewerTitle").textContent = doc.fileName;
  modal.style.display = "flex";
}
function closeViewer() {
  document.getElementById("viewerModal").style.display = "none";
  document.getElementById("viewerContent").innerHTML = "";
}

// ── 재추출 요청 ─────────────────────────────────────────────────────────────
async function reanalyze() {
  if (!currentCaseId) return;
  try {
    const d = await apiReanalyze(currentCaseId);
    if (!d.ok) { toast("재추출 실패", "error"); return; }
    toast("사건 구조 재추출을 요청했습니다");
    startPoll(currentCaseId);
  } catch (e) {
    if (e.message !== "auth") toast("오류", "error");
  }
}

// ── extractStatus 폴링 ───────────────────────────────────────────────────────
function clearPollTimer() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPoll(caseId) {
  clearPollTimer();
  // processing/pending 행이 있는 동안 5초마다 갱신
  pollTimer = setInterval(async () => {
    const docs = currentDetail?.documents || [];
    const hasPending = docs.some(d => d.extractStatus === "pending" || d.extractStatus === "processing");
    if (!hasPending) { clearPollTimer(); return; }
    try {
      const d = await apiDetail(caseId);
      if (!d.ok) return;
      currentDetail = d;
      // 자료 목록만 갱신
      const tbody = document.getElementById("docTableBody");
      if (tbody) tbody.innerHTML = (d.documents || []).map(doc => renderDocRow(doc)).join("") || '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:24px">자료가 없습니다</td></tr>';
      // 추출 결과 갱신
      const exSec = document.querySelector(".extraction-section");
      if (exSec && d.case.extractionJson) {
        const bodyEl = exSec.querySelector(".no-extraction,.extraction-grid");
        if (bodyEl) bodyEl.outerHTML = renderExtraction(d.case.extractionJson);
      }
      // 진행/에러 배너 갱신
      const pendingCount = (d.documents || []).filter(x => x.extractStatus === "processing" || x.extractStatus === "pending").length;
      const failedCount  = (d.documents || []).filter(x => x.extractStatus === "failed").length;
      const progBanner = document.querySelector(".progress-banner");
      const errBanner  = document.querySelector(".error-banner");
      if (progBanner) progBanner.style.display = pendingCount > 0 ? "" : "none";
      if (errBanner)  errBanner.style.display  = failedCount  > 0 ? "" : "none";
    } catch (_) {}
  }, 5000);
}

// ── 종류 토글 (지원대상 / 과거사례) ────────────────────────────────────────
function setKindToggle(kind) {
  currentKind = kind;
  document.querySelectorAll(".kind-btn").forEach(b => b.classList.toggle("active", b.dataset.kind === kind));
}

// ── 초기화 ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadCases();
});
