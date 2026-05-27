/* admin-martyrdom.js v4(P4) — 순직 인정 지원 시스템 (Deep-Relief AI v0) */

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

// ── P2 mock · 응답 키 §P2.2 계약 + B 실제 응답(2026-05-26 대조)과 1:1 ──────────
// B 백엔드 P2 머지·마이그레이션 완료 → 실 API 연결(false). 키 정합 확인 끝.
// P1 API(USE_MOCK=false)는 이미 라이브 — P2 신규 API만 이 토글을 따른다.
const USE_P2_MOCK = false;

const MOCK_STRATEGY = {
  possibleLogics: [
    { title: "지속적 악성민원으로 인한 직무 스트레스 → 적응장애 → 사망", reasoning: "3~5월 민원 폭주와 정신과 진료 시점이 일치, 직무관련성 인정 논리 성립", strength: "강" },
    { title: "과중한 업무부담(담임+행정) 누적 과로", reasoning: "근무기록상 초과근무 확인되나 직접 인과는 보강 필요", strength: "중" }
  ],
  missingEvidence: ["심리부검 자료", "2024년 3월 근무기록(공백)", "동료 진술서"],
  keyIssues: ["기존 질환 여부 반박", "민원과 사망 사이 시간적 인과 입증"],
  causalChain: [{ factor: "악성민원 반복", link: "→ 불면·불안·적응장애", evidence: "진료기록·동료 증언" }],
  similarCases: [{ ref: "○○초 교사 인정 사례(2023)", outcome: "approved", match: "악성민원+정신과 진료", diff: "유서 존재 여부" }],
  counterArguments: [{ argument: "개인적 성격·기존 우울증 기여", rebuttal: "초진이 민원 발생 후이며 이전 정신과력 없음", basis: "진료기록 초진일" }],
  conflicts: [{ severity: "주의", desc: "진술서상 사망일과 사망진단서 날짜 1일 차이", sources: ["동료진술서", "사망진단서"] }],
  masterTimeline: [
    { date: "2024-03-04", event: "담임 배정", source: "인사기록", gap: false },
    { date: "2024-03-18", event: "악성민원 시작", source: "통화기록", gap: false },
    { date: "2024-04", event: "(근무기록 공백 — 자료 필요)", source: "", gap: true },
    { date: "2024-06-11", event: "사망", source: "사망진단서", gap: false }
  ],
  ragSources: [{ title: "공무원 재해보상법 §5", sourceRef: "martyr_law#12", snippet: "공무수행과 상당인과관계…" }]
};
const MOCK_CRITERIA_CHECK = {
  items: [
    { code: "duty_performance", category: "공무수행성", title: "공무 수행 중 발생", status: "met", evidence: "담임·교육활동 중 스트레스", ragSources: [] },
    { code: "causation_medical", category: "인과관계", title: "공무-사망 상당인과관계", status: "partial", evidence: "진료기록 있으나 심리부검 부족", ragSources: [] },
    { code: "mental_causation", category: "인과관계", title: "정신질환 공무관련성", status: "unmet", evidence: "심리부검 자료 없음", ragSources: [] }
  ],
  metCount: 5, totalCount: 8
};
const MOCK_READINESS = {
  score: 78,
  breakdown: { criteria: 32, evidence: 24, timeline: 12, conflicts: 10 },
  max: { criteria: 40, evidence: 30, timeline: 15, conflicts: 15 },
  gaps: [{ label: "심리부검 자료", plus: 12 }, { label: "2024.3 근무기록 공백", plus: 6 }, { label: "동료 진술", plus: 4 }],
  aiNote: "전반적으로 직무 스트레스 입증은 탄탄하나, 심리부검 자료가 없어 의학적 인과관계 고리가 약합니다. 이 자료를 보완하면 인정 논리가 크게 강해집니다.",
  label: "보고서 준비도 — 인정 확률 아님·내부 가늠용"
};
const MOCK_GOLDEN = {
  items: [
    { channel: "online", label: "고인 SNS·메신저 보존", guidance: "계정 잠금 전 캡처·내보내기", volatility: "high", priority: 1, caseFit: "민원·업무 토로가 메신저에 집중" },
    { channel: "offline", label: "동료 진술 확보", guidance: "기억이 선명할 때 서면화", volatility: "low", priority: 2, caseFit: "목격 동료 다수" }
  ]
};
const MOCK_DEADLINES = [{ id: 1, label: "소멸시효(3년)", dueDate: "2027-06-11", kind: "statute_limit", status: "pending" }];
const MOCK_ACTIONS = [{ id: 1, item: "심리부검 자료 확보", status: "todo", source: "missing_evidence", dueDate: null }];

// 코퍼스 검색·요건 master·대시보드 mock (B 실제 응답 키와 1:1 — 2026-05-26 B 대조 반영)
const MOCK_CORPUS = { ok: true, query: "", hits: [
  { id: 1, sourceType: "martyr_case", sourceRef: "martyr_case#7", title: "○○초 교사 순직 인정 사례(2023)", snippet: "지속적 악성민원으로 인한 적응장애와 사망 사이 상당인과관계 인정…", score: 0.89 },
  { id: 2, sourceType: "martyr_law", sourceRef: "martyr_law#12", title: "공무원 재해보상법 §5(공무상 재해의 인정기준)", snippet: "공무수행과 사망 사이에 상당인과관계가 있는 경우 공무상 재해로 본다…", score: 0.83 }
] };
const MOCK_CRITERIA_MASTER = { ok: true, total: 2, criteria: [
  { id: 1, code: "duty_performance", category: "공무수행성", title: "공무(교육활동·부수업무) 수행 중 발생", description: "사망·질병이 공무 수행과 시간적·장소적으로 연결됨을 입증", evidenceHint: "근무기록·업무분장·복무기록", lawRef: "공무원 재해보상법 §4", weight: 3, sortOrder: 1, active: true },
  { id: 2, code: "causation_medical", category: "인과관계", title: "공무와 사망 사이 상당인과관계(의학)", description: "의학적 소견으로 공무-질병 인과 입증", evidenceHint: "진단서·의학소견·심리부검", lawRef: "공무원 재해보상법 §5", weight: 3, sortOrder: 2, active: true }
] };
const MOCK_DASHBOARD = { ok: true,
  cases: [
    { caseId: 1, caseNo: "MTR-20260526-0001", title: "○○초 △△ 선생님 사건", status: "collecting", caseKind: "active", readinessScore: 78, nextDeadlineAt: "2026-06-15", nextDeadlineLabel: "순직유족급여 청구 기한", dDay: 20, docCount: 3 },
    { caseId: 3, caseNo: "MTR-20260520-0002", title: "△△중 □□ 선생님 사건", status: "analyzing", caseKind: "active", readinessScore: 45, nextDeadlineAt: "2026-06-02", nextDeadlineLabel: "심의위 자료 제출", dDay: 7, docCount: 7 }
  ],
  storage: { usedGb: 14.2, limitGb: 20, overThreshold: false, bytes: 15246000000, gb: 14.2, alertGb: 20, over: false },
  summary: { activeCount: 2, urgentCount: 1, avgReadiness: 62 }
};

// ── P3 mock · 서면 생성 (B 머지 전 · 응답 키 §P3.2 계약과 1:1 · 키 1글자도 변경 금지) ──
// B 백엔드 P3 머지·마이그레이션 후 메인이 false로 전환. 그 전까지 프론트 단독 동작용.
const USE_P3_MOCK = false; // 2026-05-27 B 머지·마이그 완료 → 실 API 연결

const MOCK_DRAFT_OUTLINE = { sections: [
  { sectionKey:"intro",      title:"신청 취지",         intent:"유족급여 청구 취지·근거 법령 개요", order:1 },
  { sectionKey:"deceased",   title:"고인 및 직무 개요", intent:"고인 인적사항·담당 업무·근무 환경", order:2 },
  { sectionKey:"duty",       title:"공무상 과로·스트레스", intent:"업무량·시간외·민원 등 공무 관련성", order:3 },
  { sectionKey:"medical",    title:"의학적 인과관계",   intent:"진단·심리부검·사인과 공무의 연결", order:4 },
  { sectionKey:"criteria",   title:"인정 요건 충족",   intent:"공무원재해보상법 요건별 대조", order:5 },
  { sectionKey:"conclusion", title:"결론 및 신청",     intent:"순직 인정·유족급여 지급 요청", order:6 },
]};
const MOCK_DRAFT_SECTION = { id:101, sectionKey:"intro", title:"신청 취지",
  content:"본 신청은 고(故) ○○○ 교사의 사망이 공무로 인한 것임을 근거로 유족급여 지급을 청구하는 것입니다. 고인은 ○○초등학교에서 담임 및 학교 행정 업무를 동시에 수행하던 중 지속적인 악성 민원과 과중한 업무에 노출되었고, 이로 인한 직무 스트레스가 사망과 상당인과관계에 있음을 공무원 재해보상법 제4조·제5조에 근거하여 청구합니다. …",
  ragSources:[{title:"공무원재해보상법 제4조", sourceRef:"martyr_law", snippet:"공무로 인한 사망 …"},
    {title:"유사 인정 사례(2024)", sourceRef:"martyr_case", snippet:"과로·민원 스트레스 인정 …"}],
  status:"done", order:1, wordCount:320 };
const MOCK_REVIEWS = [{ id:5, assignedTo:12, assignedToName:"김간사", status:"pending", note:null,
  createdAt:"2026-05-26T01:00:00Z", decidedAt:null }];
const MOCK_REVIEWERS = [{ id:12, name:"김간사", role:"operator" }, { id:3, name:"이변호사", role:"super_admin" }];

// ── P4 mock · 유족 요약·통계·발간 (B 머지 전 · 응답 키 §P4.2 계약과 1:1 · 키 1글자도 변경 금지) ──
// B 백엔드 P4 머지·마이그레이션 후 메인이 false로 전환.
const USE_P4_MOCK = false; // 2026-05-27 B 머지·마이그 완료 → 실 API 연결

const MOCK_FAMILY_SUMMARY = { id:50, outputType:"family_summary",
  contentText:"○○ 선생님 사건은 현재 자료를 모아 전략을 분석하는 단계입니다. 쉽게 말씀드리면, 선생님이 많은 스트레스를 받으신 상황을 자료로 증명하는 과정을 진행 중입니다. 현재까지 수집된 자료들이 도움이 되고 있으며, 전문가가 검토할 예정입니다.",
  nextSteps:["병원 진료기록 보완","전문가 검토 대기"], status:"draft" };

const MOCK_STATS = { totals:{cases:12,approved:5,rejected:2,pending:5}, recognitionRate:0.71,
  byCaseType:[{type:"overwork",total:6,approved:4},{type:"harassment",total:4,approved:1},{type:"accident",total:2,approved:0}],
  byStatus:[{status:"analysis",count:4},{status:"hearing",count:3},{status:"collecting",count:3},{status:"closed",count:2}],
  trend:[{month:"2026-01",approved:0},{month:"2026-02",approved:1},{month:"2026-03",approved:1},{month:"2026-04",approved:2},{month:"2026-05",approved:1}],
  readinessDist:[{range:"0-40",count:2},{range:"41-60",count:3},{range:"61-80",count:4},{range:"81-100",count:3}] };

const MOCK_PUBLICATION = { id:9, pubType:"guide", title:"교사 사망 시 순직 인정까지",
  contentHtml:"<h1>교사 사망 시 순직 인정까지</h1><p>본 가이드는 교사 사망 사건 발생 시 순직 인정을 위해 필요한 단계별 절차와 준비 자료를 안내합니다.</p><h2>1. 신청 절차</h2><p>사망 인지 후 60일 이내에 유족급여 청구서를 제출해야 합니다…</p>",
  blendRatio:{self:70,ai:30}, anonymized:true, reidRisk:"low", status:"draft",
  ragSources:[{title:"인정 사례 종합",sourceRef:"martyr_case",snippet:"과로·민원 스트레스 인정 …"}] };

const MOCK_PUBLICATIONS = [{ id:9, pubType:"guide", title:"교사 사망 시 순직 인정까지", status:"draft", createdAt:"2026-05-27T00:00:00Z" }];

// ── P2 라벨 맵 ───────────────────────────────────────────────────────────────
const STRENGTH_CLASS = { "강": "str-strong", "중": "str-mid", "약": "str-weak" };
const CRITERIA_STATUS = {
  met:     { label: "충족",   cls: "cs-met" },
  partial: { label: "부분충족", cls: "cs-partial" },
  unmet:   { label: "미흡",   cls: "cs-unmet" },
};
const ACTION_STATUS = { todo: "할 일", doing: "진행 중", done: "완료" };
const ACTION_STATUS_NEXT = { todo: "doing", doing: "done", done: "todo" };
const DEADLINE_KIND = { statute_limit: "소멸시효", submission: "자료 제출", hearing: "심의", custom: "기타" };
const OUTPUT_TYPE_LABELS = { strategy: "전략 분석", criteria_check: "요건 대조", readiness: "준비도", golden: "골든타임 제언" };

// ── P3 라벨 맵 (서면·검토) ──────────────────────────────────────────────────
const DRAFT_SEC_STATUS = {
  pending:    { label: "대기",   cls: "dss-pending" },
  generating: { label: "생성 중", cls: "dss-gen" },
  done:       { label: "생성됨", cls: "dss-done" },
  edited:     { label: "편집됨", cls: "dss-edited" },
};
const REVIEW_STATUS = {
  pending:            { label: "검토 대기", cls: "rv-pending" },
  approved:           { label: "승인",     cls: "rv-approved" },
  changes_requested:  { label: "수정요청", cls: "rv-changes" },
};

// ─────────────────────────────────────────────────────────────────────────────

let currentKind = "active";   // "active" | "reference"
let currentCaseId = null;
let currentDetail = null;
let pollTimer = null;
let genPollTimer = null;       // 전략/요건 생성 결과 폴링
let draftPollTimer = null;     // 서면 섹션 생성 결과 폴링(P3)
let isSuperAdmin = false;      // /api/admin/me role === 'super_admin'
let isAdmin = false;           // role ∈ admin·super_admin — 발간 생성·검수·발간·삭제 권한(P4)
let isOperator = false;        // role ∈ operator 이상 — 발간·통계 조회 권한(P4)
let canPubWrite = false;       // 발간 쓰기 권한 — 권한 정책(martyrdom_publication) 서버 canWrite 반영(기본 isAdmin)
let myRole = null;             // /api/admin/me role 원본값
let myMemberId = null;         // /api/admin/me id — 검토 결정 권한 분기용(P3)
let outputCache = {};          // { strategy:{...}, criteria_check:{...}, readiness:{...}, golden:{...} } (현재 사건)
let caseDeadlines = [];        // 현재 사건 기한 목록(martyrdom_deadlines)
let caseActions = [];          // 현재 사건 부족증거 액션 목록(martyrdom_actions)
let caseDraft = null;          // 현재 사건 서면 초안 { outputId,status,outline,sections[],reviews[] } (P3)
let caseReviewers = [];        // 배정 가능 운영자 목록(members operatorActive) (P3)
let _mockDraft = null;         // USE_P3_MOCK 평행 모드 — 서면 상태를 메모리에 보관(목차→본문→검토 흐름 재현)
let familySummaryCache = null; // P4: 유족 요약 (현재 사건)
let statsData = null;          // P4: G5 통계 데이터
let statsCharts = {};          // P4: Chart 인스턴스 (사건 전환 시 destroy)
let pubList = [];              // P4: 연구 발간물 목록
let pubDetail = null;          // P4: 현재 선택된 발간물 상세
let pubPollTimer = null;       // P4: 발간 생성 폴링 타이머
let pubGenBusy = false;        // P4: 발간 생성 진행 중 플래그(연타 중복 draft 방지·Q2-052)

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

// ── P2 API 래퍼 (USE_P2_MOCK 토글 · 응답 키 §P2.2 계약 고정) ───────────────────
// 응답 envelope에서 contentJson·outputId를 안전하게 꺼냄(다중 fallback)
function pickContentJson(res) {
  return (res && (res.contentJson || (res.output && res.output.contentJson) ||
    (res.data && (res.data.contentJson || (res.data.output && res.data.output.contentJson))))) || null;
}
function pickOutputId(res) {
  return (res && (res.outputId || (res.output && res.output.id) || res.id ||
    (res.data && (res.data.outputId || (res.data.output && res.data.output.id))))) || null;
}

async function detectRole() {
  try {
    const r = await fetch("/api/admin/me", { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json().catch(() => ({}));
    const root = (d && (d.data || d)) || {};
    const me = (root && root.admin) || root;   // admin-me 응답: { data: { admin: { role, id, ... } } } — role이 admin 아래 중첩
    myRole       = (me && me.role) || null;
    isSuperAdmin = myRole === "super_admin";
    isAdmin      = myRole === "admin" || myRole === "super_admin";   // 발간 쓰기 권한(백엔드 requireRole admin과 정합)
    isOperator   = isAdmin || myRole === "operator";                 // 발간·통계 조회 권한
    myMemberId   = (me && (me.id || me.uid || me.memberId)) || null;  // 검토 결정 권한 분기용
  } catch (_) { /* 감지 실패 시 최소 권한으로 간주 */ }
}

// 전략/골든/요건 생성 디스패처 (type=strategy|golden|criteria → background / readiness 별도)
async function apiGenerate(caseId, type) {
  if (USE_P2_MOCK) {
    const map = { strategy: MOCK_STRATEGY, golden: MOCK_GOLDEN, criteria: MOCK_CRITERIA_CHECK };
    return { ok: true, status: "done", mock: true, contentJson: map[type] || {}, outputId: 900 };
  }
  return apiFetch("/api/admin-martyrdom-generate", { method: "POST", body: { caseId, type } });
}
async function apiReadiness(caseId) {
  if (USE_P2_MOCK) return { ok: true, contentJson: MOCK_READINESS, outputId: 901 };
  return apiFetch("/api/admin-martyrdom-readiness", { method: "POST", body: { caseId } });
}
async function apiOutputReview(outputId, status, reviewNote) {
  if (USE_P2_MOCK) return { ok: true, outputId, status, reviewNote };
  return apiFetch("/api/admin-martyrdom-output-review", { method: "PATCH", body: { outputId, status, reviewNote } });
}
// 기한 CRUD (martyrdom_deadlines)
async function apiDeadlines(caseId) {
  if (USE_P2_MOCK) return { ok: true, deadlines: MOCK_DEADLINES.map(d => ({ ...d, caseId })) };
  return apiFetch("/api/admin-martyrdom-deadlines?caseId=" + encodeURIComponent(caseId));
}
async function apiDeadlineSave(body) {
  if (USE_P2_MOCK) return { ok: true, id: body.id || Date.now() };
  return apiFetch("/api/admin-martyrdom-deadlines", { method: body.id ? "PATCH" : "POST", body });
}
async function apiDeadlineDelete(id) {
  if (USE_P2_MOCK) return { ok: true };
  return apiFetch("/api/admin-martyrdom-deadlines?id=" + encodeURIComponent(id), { method: "DELETE" });
}
// 부족증거 액션 CRUD (martyrdom_actions)
async function apiActions(caseId) {
  if (USE_P2_MOCK) return { ok: true, actions: MOCK_ACTIONS.map(a => ({ ...a, caseId })) };
  return apiFetch("/api/admin-martyrdom-actions?caseId=" + encodeURIComponent(caseId));
}
async function apiActionSave(body) {
  if (USE_P2_MOCK) return { ok: true, id: body.id || Date.now() };
  return apiFetch("/api/admin-martyrdom-actions", { method: body.id ? "PATCH" : "POST", body });
}
async function apiActionDelete(id) {
  if (USE_P2_MOCK) return { ok: true };
  return apiFetch("/api/admin-martyrdom-actions?id=" + encodeURIComponent(id), { method: "DELETE" });
}
// G3 대시보드
async function apiDashboard() {
  if (USE_P2_MOCK) return MOCK_DASHBOARD;
  return apiFetch("/api/admin-martyrdom-dashboard");
}
// 코퍼스 검색 (martyr_case + martyr_law)
async function apiCorpusSearch(query) {
  if (USE_P2_MOCK) return MOCK_CORPUS;
  return apiFetch("/api/admin-martyrdom-corpus-search", { method: "POST", body: { query } });
}
// 요건 master CRUD (GET 전체 · 쓰기 super_admin)
async function apiCriteriaList() {
  if (USE_P2_MOCK) return MOCK_CRITERIA_MASTER;
  return apiFetch("/api/admin-martyrdom-criteria");
}
async function apiCriteriaSave(body) {
  if (USE_P2_MOCK) return { ok: true, id: body.id || Date.now() };
  // 403도 토스트로 보여주려고 직접 fetch (apiFetch는 403 시 로그인 리다이렉트)
  const r = await fetch("/api/admin-martyrdom-criteria", {
    method: body.id ? "PATCH" : "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return r.ok ? data : { ok: false, status: r.status, error: data.error };
}
async function apiCriteriaDelete(id) {
  if (USE_P2_MOCK) return { ok: true };
  const r = await fetch("/api/admin-martyrdom-criteria?id=" + encodeURIComponent(id), { method: "DELETE", credentials: "include" });
  const data = await r.json().catch(() => ({}));
  return r.ok ? data : { ok: false, status: r.status, error: data.error };
}
async function apiCriteriaGenerate() {
  if (USE_P2_MOCK) return { ok: true, candidates: MOCK_CRITERIA_MASTER.items };
  return apiFetch("/api/admin-martyrdom-criteria-generate", { method: "POST", body: {} });
}

// ── P3 API 래퍼 (USE_P3_MOCK 토글 · 응답 키 §P3.2 계약 고정 · 1글자도 변경 금지) ───
function b64Mock(s) { return btoa(unescape(encodeURIComponent(String(s || "")))); } // mock 다운로드용 유효 base64

// 서면 로드: 목차 + 섹션 + 검토 이력 (화면 렌더용)
async function apiDraftLoad(caseId) {
  if (USE_P3_MOCK) {
    return { ok: true,
      outputId: (_mockDraft && _mockDraft.outputId) || null,
      status:   (_mockDraft && _mockDraft.status)   || "draft",
      outline:  (_mockDraft && _mockDraft.outline)  || { sections: [] },
      sections: (_mockDraft && _mockDraft.sections) || [],
      reviews:  (_mockDraft && _mockDraft.reviews)  || [] };
  }
  return apiFetch("/api/admin-martyrdom-draft?caseId=" + encodeURIComponent(caseId));
}
// 목차 제안 생성 (draft ai_outputs 행 INSERT/UPDATE)
async function apiDraftOutline(caseId) {
  if (USE_P3_MOCK) {
    _mockDraft = {
      outputId: 30, status: "draft",
      outline: JSON.parse(JSON.stringify(MOCK_DRAFT_OUTLINE)),
      sections: MOCK_DRAFT_OUTLINE.sections.map((s, i) => ({
        id: 100 + i, sectionKey: s.sectionKey, title: s.title, content: "",
        ragSources: [], status: "pending", order: s.order, wordCount: 0,
      })),
      reviews: [],
    };
    return { ok: true, outputId: 30, outputType: "draft", status: "draft", outline: _mockDraft.outline };
  }
  return apiFetch("/api/admin-martyrdom-draft-outline", { method: "POST", body: { caseId } });
}
// 목차 편집 저장 (제목·intent·순서·추가/삭제)
async function apiDraftOutlineSave(caseId, outputId, sections) {
  if (USE_P3_MOCK) {
    if (_mockDraft) {
      _mockDraft.outline = { sections: sections };
      const prev = _mockDraft.sections || [];
      _mockDraft.sections = sections.map((s, i) => {
        const ex = prev.find(x => x.sectionKey === s.sectionKey);
        return ex
          ? { ...ex, title: s.title, order: s.order }
          : { id: 300 + i, sectionKey: s.sectionKey, title: s.title, content: "", ragSources: [], status: "pending", order: s.order, wordCount: 0 };
      });
    }
    return { ok: true, outputId: outputId, status: "draft" };
  }
  return apiFetch("/api/admin-martyrdom-draft-outline", { method: "PATCH", body: { caseId, outputId, sections } });
}
// 본문 생성: sectionKey 있으면 1섹션 동기, 없으면 전 섹션 background 큐
async function apiDraftGenerate(caseId, sectionKey) {
  if (USE_P3_MOCK) {
    if (sectionKey) {
      const base = (_mockDraft && _mockDraft.sections.find(s => s.sectionKey === sectionKey)) || {};
      const sec = {
        id: base.id || 101, sectionKey: sectionKey, title: base.title || MOCK_DRAFT_SECTION.title,
        content: MOCK_DRAFT_SECTION.content, ragSources: MOCK_DRAFT_SECTION.ragSources,
        status: "done", order: base.order || 1, wordCount: MOCK_DRAFT_SECTION.wordCount,
      };
      if (_mockDraft) {
        const idx = _mockDraft.sections.findIndex(s => s.sectionKey === sectionKey);
        if (idx >= 0) _mockDraft.sections[idx] = sec;
      }
      return { ok: true, section: sec };
    }
    const total = (_mockDraft && _mockDraft.outline.sections.length) || 6;
    // 평행 mock: background 대신 즉시 전 섹션 채움(폴링이 done을 감지)
    if (_mockDraft) {
      _mockDraft.sections = _mockDraft.sections.map(s => ({
        ...s, content: MOCK_DRAFT_SECTION.content.replace("신청 취지", s.title),
        ragSources: MOCK_DRAFT_SECTION.ragSources, status: "done", wordCount: 320,
      }));
    }
    return { ok: true, queued: true, total: total, outputId: (_mockDraft && _mockDraft.outputId) || 30 };
  }
  return apiFetch("/api/admin-martyrdom-draft-generate", { method: "POST", body: sectionKey ? { caseId, sectionKey } : { caseId } });
}
// 섹션 본문 편집 저장 (status→edited·wordCount 갱신)
async function apiDraftSectionSave(sectionId, content) {
  if (USE_P3_MOCK) {
    if (_mockDraft) {
      const s = _mockDraft.sections.find(x => x.id === sectionId);
      if (s) { s.content = content; s.status = "edited"; s.wordCount = (content || "").length; }
    }
    return { ok: true, section: { id: sectionId, status: "edited", wordCount: (content || "").length } };
  }
  return apiFetch("/api/admin-martyrdom-draft-section", { method: "PATCH", body: { sectionId, content } });
}
// 배정 가능 검토자 목록
async function apiReviewers() {
  if (USE_P3_MOCK) return { ok: true, reviewers: MOCK_REVIEWERS };
  return apiFetch("/api/admin-martyrdom-reviewers");
}
// 검토자 배정
async function apiReviewAssign(caseId, outputId, assignedTo) {
  if (USE_P3_MOCK) {
    const who = MOCK_REVIEWERS.find(x => x.id === assignedTo) || {};
    const r = { id: (Date.now() % 100000), assignedTo: assignedTo, assignedToName: who.name || "검토자",
      status: "pending", note: null, createdAt: new Date().toISOString(), decidedAt: null };
    if (_mockDraft) _mockDraft.reviews.push(r);
    return { ok: true, reviewId: r.id, status: "pending", assignedTo: assignedTo };
  }
  return apiFetch("/api/admin-martyrdom-review", { method: "POST", body: { caseId, outputId, assignedTo } });
}
// 검토 결정 (승인/수정요청 · +draft status→reviewed)
async function apiReviewDecide(reviewId, status, note) {
  if (USE_P3_MOCK) {
    if (_mockDraft) {
      const r = _mockDraft.reviews.find(x => x.id === reviewId);
      if (r) { r.status = status; r.note = note || null; r.decidedAt = new Date().toISOString(); }
      if (status === "approved") _mockDraft.status = "reviewed";
    }
    return { ok: true, reviewId: reviewId, status: status };
  }
  const body = (note != null && note !== "") ? { reviewId, status, note } : { reviewId, status };
  return apiFetch("/api/admin-martyrdom-review", { method: "PATCH", body });
}
// 내보내기 (pdf|docx → base64)
async function apiDraftExport(caseId, outputId, format) {
  if (USE_P3_MOCK) {
    const pdf = format === "pdf";
    return { ok: true, fileName: "유족급여신청서_2026-001." + (pdf ? "pdf" : "docx"),
      mimeType: pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64: b64Mock("[mock] 유족급여신청서 초안 (" + format + ") — 실제 내보내기는 B 머지 후") };
  }
  return apiFetch("/api/admin-martyrdom-export", { method: "POST", body: { caseId, outputId, format } });
}
// 사건 패키지 zip
async function apiDraftPackage(caseId) {
  if (USE_P3_MOCK) {
    return { ok: true, fileName: "사건패키지_2026-001.zip",
      base64: b64Mock("[mock] 사건 패키지 zip — 실제 묶음은 B 머지 후") };
  }
  return apiFetch("/api/admin-martyrdom-package", { method: "POST", body: { caseId } });
}

// ── P4 API 래퍼 (USE_P4_MOCK 토글 · 응답 키 §P4.2 계약 고정 · 1글자도 변경 금지) ──────

// 유족 요약 생성 (쉬운 말 요약 + 다음 할 일)
async function apiP4FamilySummaryGenerate(caseId) {
  if (USE_P4_MOCK) return { ok: true, summary: JSON.parse(JSON.stringify(MOCK_FAMILY_SUMMARY)) };
  return apiFetch("/api/admin-martyrdom-family-summary", { method: "POST", body: { caseId } });
}
// 유족 요약 로드
async function apiP4FamilySummaryLoad(caseId) {
  if (USE_P4_MOCK) return { ok: true, summary: null }; // 초기 null — 생성 후 채워짐
  return apiFetch("/api/admin-martyrdom-family-summary?caseId=" + encodeURIComponent(caseId));
}
// G5 인정률·성과 통계
async function apiP4Stats() {
  if (USE_P4_MOCK) return { ok: true, ...MOCK_STATS };
  return apiFetch("/api/admin-martyrdom-stats");
}
// 발간물 생성 큐
async function apiP4PublicationGenerate(pubType, blendRatio, maskLevel) {
  if (USE_P4_MOCK) {
    pubDetail = JSON.parse(JSON.stringify(MOCK_PUBLICATION));
    pubDetail.pubType = pubType;
    pubDetail.blendRatio = blendRatio;
    return { ok: true, queued: true, id: 9, pubType: pubType, status: "draft" };
  }
  return apiFetch("/api/admin-martyrdom-publication", { method: "POST", body: { pubType, blendRatio, maskLevel } });
}
// 발간물 목록
async function apiP4PublicationList() {
  if (USE_P4_MOCK) return { ok: true, publications: JSON.parse(JSON.stringify(MOCK_PUBLICATIONS)) };
  return apiFetch("/api/admin-martyrdom-publication");
}
// 발간물 상세
async function apiP4PublicationGet(id) {
  if (USE_P4_MOCK) return { ok: true, publication: JSON.parse(JSON.stringify(pubDetail || MOCK_PUBLICATION)) };
  return apiFetch("/api/admin-martyrdom-publication?id=" + encodeURIComponent(id));
}
// 발간물 상태 갱신 (검수/발간/수정)
async function apiP4PublicationPatch(id, patch) {
  if (USE_P4_MOCK) {
    if (pubDetail && pubDetail.id === id) Object.assign(pubDetail, patch);
    const idx = pubList.findIndex(p => p.id === id);
    if (idx >= 0) Object.assign(pubList[idx], patch);
    return { ok: true, id: id, status: patch.status || (pubDetail && pubDetail.status) || "draft" };
  }
  return apiFetch("/api/admin-martyrdom-publication", { method: "PATCH", body: { id, ...patch } });
}
// 발간물 삭제
async function apiP4PublicationDelete(id) {
  if (USE_P4_MOCK) {
    pubList = pubList.filter(p => p.id !== id);
    if (pubDetail && pubDetail.id === id) pubDetail = null;
    return { ok: true };
  }
  return apiFetch("/api/admin-martyrdom-publication?id=" + encodeURIComponent(id), { method: "DELETE" });
}
// 발간물 내보내기 (html|pdf)
async function apiP4PublicationExport(id, format) {
  if (USE_P4_MOCK) {
    const pdf = format === "pdf";
    return { ok: true, fileName: "종합가이드." + (pdf ? "pdf" : "html"),
      mimeType: pdf ? "application/pdf" : "text/html",
      base64: b64Mock((pubDetail && pubDetail.contentHtml) || "[mock] 발간물 내보내기 (" + format + ")") };
  }
  return apiFetch("/api/admin-martyrdom-publication-export", { method: "POST", body: { id, format } });
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
  clearDraftPollTimer();
  clearPubPollTimer();
  outputCache = {}; caseDeadlines = []; caseActions = []; caseDraft = null;   // 이전 사건 데이터 잔상 방지
  _mockDraft = null;   // 평행 mock 서면 상태 초기화(사건 전환 시)
  familySummaryCache = null; statsData = null;  // P4 상태 초기화(사건 전환 시)
  destroyStatsCharts();  // Chart 인스턴스 해제(메모리 누수 방지)
  try {
    const d = await apiDetail(id);
    if (!d.ok) { toast("상세 불러오기 실패", "error"); return; }
    currentDetail = d;
    buildOutputCache(d);
    renderDetail(d);
    startPoll(id);
    loadCaseSubData(id);   // 기한·액션 비동기 로드(렌더 후 채움)
  } catch (e) {
    if (e.message !== "auth") toast("네트워크 오류", "error");
  }
}

// d.outputs[] → outputCache (type별 최신 version) — 전략/요건/준비도/골든
function buildOutputCache(d) {
  outputCache = {};
  const outs = (d && d.outputs) || [];
  ["strategy", "criteria_check", "readiness", "golden"].forEach(type => {
    const rows = outs.filter(o => o.outputType === type);
    if (!rows.length) return;
    rows.sort((a, b) => (b.version || 0) - (a.version || 0) || (b.id || 0) - (a.id || 0));
    setOutputCache(type, rows[0]);
  });
}
function setOutputCache(type, o) {
  if (!o) return;
  outputCache[type] = {
    id: o.id, status: o.status || "draft", version: o.version || 1,
    reviewNote: o.reviewNote || "",
    contentJson: o.contentJson || {},
    ragSources: (o.contentJson && o.contentJson.ragSources) || o.ragSources || [],
    processing: o.status === "processing",
  };
}
// 생성 응답(mock 또는 inline)을 outputCache에 반영
function cacheFromResponse(type, res) {
  const cj = pickContentJson(res);
  if (!cj) return false;
  outputCache[type] = {
    id: pickOutputId(res), status: "draft", version: (outputCache[type]?.version || 0) + 1,
    reviewNote: "", contentJson: cj, ragSources: cj.ragSources || [], processing: false,
  };
  return true;
}

async function loadCaseSubData(id) {
  try {
    const [dl, ac, dr, rv, fs] = await Promise.all([
      apiDeadlines(id), apiActions(id), apiDraftLoad(id), apiReviewers(), apiP4FamilySummaryLoad(id),
    ]);
    caseDeadlines = (dl && (dl.deadlines || (dl.data && dl.data.deadlines) || dl.items)) || [];
    caseActions   = (ac && (ac.actions   || (ac.data && ac.data.actions)   || ac.items)) || [];
    caseDraft     = normalizeDraft(dr);
    caseReviewers = (rv && (rv.reviewers || (rv.data && rv.data.reviewers))) || [];
    familySummaryCache = (fs && fs.ok && fs.summary) ? fs.summary : null;
  } catch (_) { caseDeadlines = []; caseActions = []; caseDraft = null; caseReviewers = []; familySummaryCache = null; }
  refreshDeadlinesPanel();
  refreshActionsPanel();
  refreshDraft();
}
// 서면 로드 응답을 caseDraft 형태로 정규화(envelope 다중 fallback)
function normalizeDraft(d) {
  if (!d || !d.ok) return null;
  const x = (d.data && d.data.outline) ? d.data : d;
  return {
    outputId: x.outputId || null,
    status:   x.status || "draft",
    outline:  x.outline || { sections: [] },
    sections: x.sections || [],
    reviews:  x.reviews || [],
  };
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
  <div class="detail-procedure-row" style="border-top:none;padding-top:4px">
    <span class="consent-info">🔏 유족 동의:
      ${c.consentObtainedAt ? `<strong style="color:#15803d">기록됨 (${fmtDate(c.consentObtainedAt)})</strong>` : `<span style="color:#b45309">미기록</span>`}
      ${c.consentNote ? ` · <span style="color:#64748b">${escapeHtml(String(c.consentNote).slice(0,40))}</span>` : ""}
    </span>
    <button class="btn-sm btn-secondary" onclick="openConsentModal()">동의 기록</button>
  </div>
</div>
<div class="tab-bar">
  <button class="tab-btn active" id="tab-golden"       onclick="switchTab('tab-golden')">① 골든타임</button>
  <button class="tab-btn"        id="tab-docs"         onclick="switchTab('tab-docs')">② 자료</button>
  <button class="tab-btn"        id="tab-analysis"     onclick="switchTab('tab-analysis')">③ 분석</button>
  <button class="tab-btn"        id="tab-draft"        onclick="switchTab('tab-draft')">④ 서면</button>
  <button class="tab-btn"        id="tab-deadlines"    onclick="switchTab('tab-deadlines')">⑤ 기한</button>
  <button class="tab-btn"        id="tab-stats"        onclick="switchTab('tab-stats')">📊 통계</button>
  <button class="tab-btn"        id="tab-publications" onclick="switchTab('tab-publications')">📚 발간</button>
</div>
<div id="tab-content">
  ${renderTabGolden()}
  ${renderTabDocs(d)}
  ${renderTabAnalysis()}
  ${renderTabDraft()}
  ${renderTabDeadlines()}
  ${renderTabStats()}
  ${renderTabPublications()}
</div>`;
  switchTab(currentTab);          // 직전 탭 유지(재렌더 시)
  refreshActionsPanel();          // 전역 caseActions로 채움(없으면 안내)
  refreshDeadlinesPanel();
}

// ── 탭 전환 ─────────────────────────────────────────────────────────────────
let currentTab = "tab-docs";
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.style.display = "none");
  const btn = document.getElementById(tabId);
  if (btn) btn.classList.add("active");
  const panel = document.getElementById(tabId + "-panel");
  if (panel) panel.style.display = "";
  // P4 지연 로드 (사건 전환·전역↔사건 이동 시 패널이 새로 그려지므로 캐시가 있어도 재렌더)
  if (tabId === "tab-stats") {
    if (statsData) { destroyStatsCharts(); renderStatsBody(statsData); }
    else loadStats();
  }
  if (tabId === "tab-publications") loadPublications();
}

// ── 공용 산출물 헬퍼 (검토 바·빈 안내·패널 갱신) ─────────────────────────────
function emptyHint(title, desc) {
  return `<div class="empty-hint"><div class="eh-title">${escapeHtml(title)}</div><div class="eh-desc">${escapeHtml(desc)}</div></div>`;
}
function genBanner() {
  /* 정량 % 일치율 금지·검토용 라벨(§P2.0 #10) */
  return `<div class="alert-banner expert-warning" style="margin-bottom:14px">⚠️ AI 생성 — 운영자 검토용입니다. 인정 확률·정량 수치가 아니며, 변호사·노무사 확인이 필요합니다.</div>`;
}
// 산출물 검토 바: [검토 완료]/[폐기] + 메모 (output-review)
function outputReviewBar(type) {
  const o = outputCache[type];
  if (!o || !o.id) return "";
  const label = OUTPUT_TYPE_LABELS[type] || type;
  const note = o.reviewNote ? ` <span class="rb-note">— ${escapeHtml(o.reviewNote)}</span>` : "";
  let state, btns;
  if (o.status === "reviewed") {
    state = `<span class="rb-state ok">✅ 검토 완료</span>`;
    btns  = `<button class="btn-sm btn-warn" onclick="reviewOutput('${type}','discarded')">폐기</button>`;
  } else if (o.status === "discarded") {
    state = `<span class="rb-state bad">🗑 폐기됨 (참고용)</span>`;
    btns  = `<button class="btn-sm" onclick="reviewOutput('${type}','reviewed')">검토 완료</button>`;
  } else {
    state = `<span class="rb-state">초안 — 검토 대기</span>`;
    btns  = `<button class="btn-sm" onclick="reviewOutput('${type}','reviewed')">검토 완료</button> <button class="btn-sm btn-warn" onclick="reviewOutput('${type}','discarded')">폐기</button>`;
  }
  return `<div class="review-bar"><span>📋 ${label} ${state}${note}</span><span class="rb-btns">${btns}</span></div>`;
}
async function reviewOutput(type, status) {
  const o = outputCache[type];
  if (!o || !o.id) { toast("검토할 산출물이 없습니다"); return; }
  const input = prompt(status === "reviewed" ? "검토 메모 (선택):" : "폐기 사유 (선택):", o.reviewNote || "");
  if (input === null) return; // 취소
  const note = input.trim();
  try {
    const d = await apiOutputReview(o.id, status, note);
    if (!d.ok) { toast(d.error || "검토 저장 실패", "error"); return; }
    o.status = status; o.reviewNote = note;
    toast(status === "reviewed" ? "검토 완료로 표시했습니다" : "폐기로 표시했습니다");
    rerenderForType(type);
  } catch (e) { if (e.message !== "auth") toast("검토 오류", "error"); }
}
// 패널 innerHTML 교체(표시 상태 유지)
function refreshPanel(panelId, html) {
  const old = document.getElementById(panelId);
  if (!old) return;
  const wasVisible = old.style.display !== "none";
  const tmp = document.createElement("div");
  tmp.innerHTML = String(html).trim();
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  fresh.style.display = wasVisible ? "" : "none";
  old.replaceWith(fresh);
}
function refreshGolden()    { refreshPanel("tab-golden-panel", renderTabGolden()); }
function refreshAnalysis()  { refreshPanel("tab-analysis-panel", renderTabAnalysis()); refreshActionsPanel(); }
function refreshDraft()     { refreshPanel("tab-draft-panel", renderTabDraft()); }
function refreshDeadlines()  { refreshPanel("tab-deadlines-panel", renderTabDeadlines()); refreshDeadlinesPanel(); }
function rerenderForType(type) {
  if (type === "golden") refreshGolden();
  else if (type === "readiness") refreshDraft();
  else refreshAnalysis();   // strategy · criteria_check
}
// 비동기 생성(background) 결과 폴링 — mock은 즉시 반환이라 미사용
function pollGenerated(type) {
  if (genPollTimer) { clearInterval(genPollTimer); genPollTimer = null; }
  let tries = 0;
  genPollTimer = setInterval(async () => {
    tries++;
    if (tries > 20 || !currentCaseId) { clearInterval(genPollTimer); genPollTimer = null; return; }
    try {
      const d = await apiDetail(currentCaseId);
      if (d && d.ok) {
        currentDetail = d; buildOutputCache(d);
        const o = outputCache[type];
        if (o && !o.processing) {
          clearInterval(genPollTimer); genPollTimer = null;
          rerenderForType(type);
          toast((OUTPUT_TYPE_LABELS[type] || "분석") + " 생성 완료");
        }
      }
    } catch (_) {}
  }, 4000);
}

// ── ① 골든타임 탭 ───────────────────────────────────────────────────────────
function renderTabGolden() {
  const cj = outputCache.golden && outputCache.golden.contentJson;
  const items = (cj && cj.items) || [];
  const sorted = items.slice().sort((a, b) => (a.priority || 99) - (b.priority || 99));
  return `<div class="tab-panel" id="tab-golden-panel" style="display:none">
  <div class="section-head">
    <div>
      <h3>⏱️ 골든타임 — 휘발성 자료 우선 확보</h3>
      <p class="section-sub">계정 잠금·삭제 전에 사라지는 자료(온라인·메신저·CCTV 등)를 우선순위로 안내합니다. <span class="vol-online">●</span> 빨강=휘발성 높음(즉시 확보), <span class="vol-offline">●</span> 회색=비교적 안정.</p>
    </div>
    <button class="btn" onclick="generateGolden()" id="goldenGenBtn">🔔 AI 맞춤 제언${items.length ? " 다시 생성" : " 생성"}</button>
  </div>
  ${outputReviewBar("golden")}
  <div id="goldenBody">
    ${items.length ? renderGoldenItems(sorted) : emptyHint("아직 제언이 없습니다", "[🔔 AI 맞춤 제언 생성]을 누르면 이 사건 정황에 맞춰 우선 확보할 자료를 휘발성 순으로 안내합니다.")}
  </div>
</div>`;
}
function renderGoldenItems(items) {
  return `<div class="golden-list">${items.map(it => {
    const online = it.channel === "online" || it.volatility === "high";
    return `<div class="golden-card ${online ? "g-online" : "g-offline"}">
      <div class="g-prio">${it.priority || "·"}</div>
      <div class="g-main">
        <div class="g-label">${escapeHtml(it.label)} <span class="vol-badge ${online ? "vol-online" : "vol-offline"}">${online ? "휘발성 높음" : "안정"}</span></div>
        ${it.guidance ? `<div class="g-guide">${escapeHtml(it.guidance)}</div>` : ""}
        ${it.caseFit ? `<div class="g-fit">📌 맞춤 사유: ${escapeHtml(it.caseFit)}</div>` : ""}
      </div>
    </div>`;
  }).join("")}</div>`;
}
async function generateGolden() {
  if (!currentCaseId) return;
  const btn = document.getElementById("goldenGenBtn");
  if (btn) { btn.disabled = true; btn.textContent = "생성 중…"; }
  try {
    const res = await apiGenerate(currentCaseId, "golden");
    if (!res.ok) { toast(res.error || "제언 생성 실패", "error"); return; }
    if (cacheFromResponse("golden", res)) { refreshGolden(); toast("골든타임 제언을 생성했습니다"); }
    else { toast("제언 생성 요청 — 잠시 후 표시됩니다"); pollGenerated("golden"); }
  } catch (e) { if (e.message !== "auth") toast("생성 오류", "error"); }
  finally { const b = document.getElementById("goldenGenBtn"); if (b) b.disabled = false; }
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

// onclick 인라인 인자용 문자열 escape
function jsStr(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/[\r\n]+/g, " ");
}

// ── ③ 분석 탭 (핵심) ─────────────────────────────────────────────────────────
function renderTabAnalysis() {
  const strat = outputCache.strategy;
  const crit  = outputCache.criteria_check;
  const hasAny = (strat && strat.id) || (crit && crit.id);
  return `<div class="tab-panel" id="tab-analysis-panel" style="display:none">
  ${hasAny ? genBanner() : ""}

  <!-- 전략 분석 (③+⑨+⑩+⑪) -->
  <div class="section-head">
    <div><h3>🔍 전략 분석</h3>
      <p class="section-sub">인정 가능 논리·부족 자료·쟁점·모순·타임라인·예상 반론을 통합 분석합니다. (자료 업로드 시 자동 생성)</p></div>
    <button class="btn" onclick="generateStrategy()" id="strategyGenBtn">전략 분석 ${strat && strat.id ? "다시 생성" : "생성"}</button>
  </div>
  ${outputReviewBar("strategy")}
  <div id="strategyBody">
    ${strat && strat.contentJson ? renderStrategy(strat.contentJson) : emptyHint("아직 전략 분석이 없습니다", "[전략 분석 생성]을 누르면 인정 가능 논리·부족 자료·모순·타임라인·예상 반론을 한 번에 분석합니다.")}
  </div>

  <!-- 요건 매트릭스 ② -->
  <div class="section-head" style="margin-top:26px">
    <div><h4>📋 인정 요건 대조</h4>
      <p class="section-sub">표준 인정 요건별로 충족/부분충족/미흡을 대조합니다.</p></div>
    <button class="btn-sm" onclick="checkCriteria()" id="criteriaGenBtn">요건 대조 ${crit && crit.id ? "다시" : ""}</button>
  </div>
  ${outputReviewBar("criteria_check")}
  <div id="criteriaBody">
    ${crit && crit.contentJson ? renderCriteriaMatrix(crit.contentJson) : emptyHint("요건 대조 결과가 없습니다", "[요건 대조]를 누르면 인정 요건별 충족 여부와 근거를 표시합니다.")}
  </div>

  <!-- 부족 증거 확보 액션 ③ -->
  <div class="section-head" style="margin-top:26px">
    <div><h4>🎯 부족 증거 확보 액션</h4>
      <p class="section-sub">부족 자료를 확보 작업으로 추적합니다. 상태 배지를 눌러 할 일→진행 중→완료로 전환.</p></div>
    <button class="btn-sm" onclick="openActionModal()">+ 액션 추가</button>
  </div>
  <div id="actionListBody" class="action-list">불러오는 중…</div>
</div>`;
}

function renderStrategy(cj) {
  cj = cj || {};
  const logics  = cj.possibleLogics  || [];
  const missing = cj.missingEvidence || cj.evidenceMissing || [];
  const issues  = cj.keyIssues       || [];
  const chain   = cj.causalChain     || [];
  const similar = cj.similarCases    || [];
  const conflicts = cj.conflicts     || [];
  const timeline  = cj.masterTimeline|| [];
  const counter   = cj.counterArguments || [];
  const rag       = cj.ragSources    || [];
  const out = [];

  if (logics.length) out.push(`<div class="an-block"><div class="an-h">⚖️ 인정 가능 논리</div>
    ${logics.map(l => `<div class="logic-card">
      <div class="lc-top"><span class="strength ${STRENGTH_CLASS[l.strength] || "str-mid"}">${escapeHtml(l.strength || "-")}</span> <strong>${escapeHtml(l.title)}</strong></div>
      ${l.reasoning ? `<div class="lc-reason">${escapeHtml(l.reasoning)}</div>` : ""}</div>`).join("")}</div>`);

  if (missing.length) out.push(`<div class="an-block"><div class="an-h">⚠️ 부족 자료 — 확보 액션으로</div>
    <div class="missing-list">${missing.map(m => `<div class="missing-row"><span class="ev-tag ev-missing">${escapeHtml(m)}</span>
      <button class="btn-sm" onclick="addActionFromEvidence('${jsStr(m)}')">+ 액션 추가</button></div>`).join("")}</div></div>`);

  if (issues.length) out.push(`<div class="an-block"><div class="an-h">🎯 핵심 쟁점</div>
    <div>${issues.map(i => `<span class="tag">${escapeHtml(i)}</span>`).join(" ")}</div></div>`);

  if (chain.length) out.push(renderCausalMap(chain, missing));

  if (similar.length) out.push(`<div class="an-block"><div class="an-h">📚 유사 사례 비교</div>
    ${similar.map(s => `<div class="sim-card"><span class="badge outcome-${s.outcome}">${OUTCOME_LABELS[s.outcome] || s.outcome || "-"}</span> <strong>${escapeHtml(s.ref)}</strong>
      ${s.match ? `<div class="sim-line">✔ 일치: ${escapeHtml(s.match)}</div>` : ""}${s.diff ? `<div class="sim-line">✖ 차이: ${escapeHtml(s.diff)}</div>` : ""}</div>`).join("")}</div>`);

  if (conflicts.length) out.push(`<div class="an-block"><div class="an-h">🚨 모순·불일치 탐지</div>
    ${conflicts.map(cf => {
      const fatal = cf.severity === "치명";
      return `<div class="conflict-card ${fatal ? "cf-fatal" : "cf-warn"}"><span class="sev-badge ${fatal ? "sev-fatal" : "sev-warn"}">${escapeHtml(cf.severity || "주의")}</span>
        <span class="cf-desc">${escapeHtml(cf.desc)}</span>
        ${(cf.sources || []).length ? `<div class="cf-src">출처: ${cf.sources.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join(" ")}</div>` : ""}</div>`;
    }).join("")}</div>`);

  if (timeline.length) out.push(`<div class="an-block"><div class="an-h">🗓 마스터 타임라인 <span class="an-sub">(회색=자료 공백)</span></div>
    <div class="timeline">${timeline.map(t => `<div class="tl-row ${t.gap ? "tl-gap" : ""}">
      <div class="tl-date">${escapeHtml(t.date || "")}</div><div class="tl-dot"></div>
      <div class="tl-body"><span class="tl-event">${escapeHtml(t.event)}</span>${t.source ? ` <span class="tl-src">(${escapeHtml(t.source)})</span>` : (t.gap ? ` <span class="tl-src">자료 필요</span>` : "")}</div>
    </div>`).join("")}</div></div>`);

  if (counter.length) out.push(`<div class="an-block"><div class="an-h">🛡 예상 반론 & 대비 논리</div>
    ${counter.map(c => `<div class="counter-card"><div class="cc-arg">❓ ${escapeHtml(c.argument)}</div>
      <div class="cc-reb">↳ 대비: ${escapeHtml(c.rebuttal)}</div>${c.basis ? `<div class="cc-basis">근거: ${escapeHtml(c.basis)}</div>` : ""}</div>`).join("")}</div>`);

  if (rag.length) out.push(renderRagSources(rag));

  return out.join("") || emptyHint("분석 결과가 비어 있습니다", "자료를 더 업로드한 뒤 다시 생성해보세요.");
}

function renderRagSources(rag) {
  return `<details class="rag-box"><summary>📎 근거 자료 ${rag.length}건 펼치기 (인용·환각 방지)</summary>
    <div class="rag-list">${rag.map(r => `<div class="rag-item">
      <div class="rag-title">${escapeHtml(r.title || r.sourceRef || "근거")}</div>
      ${r.sourceRef ? `<div class="rag-ref">${escapeHtml(r.sourceRef)}</div>` : ""}
      ${r.snippet ? `<div class="rag-snip">"${escapeHtml(r.snippet)}"</div>` : ""}</div>`).join("")}</div></details>`;
}

// 인과관계 논리맵 (④ 시각화) — 요인 노드 → 화살표(근거) → 결과 노드.
// 근거 있으면 초록·없거나 부족자료(evidenceMissing)와 매칭되면 빨강. 순수 HTML/CSS/SVG.
function renderCausalMap(chain, missing) {
  if (!chain || !chain.length) return "";
  const miss = (missing || []).map(m => String(m || ""));
  const isWeak = (ev) => {
    if (!ev) return true;
    const s = String(ev);
    return miss.some(m => m && (s.indexOf(m) >= 0 || m.indexOf(s) >= 0));
  };
  const rows = chain.map(c => {
    const weak = isWeak(c.evidence);
    const ncls = "cm-node " + (weak ? "bad" : "good");
    const effect = String(c.link || "").replace(/^\s*→\s*/, "") || "—";
    return `<div class="cm-row">
      <div class="${ncls}">${escapeHtml(c.factor || "-")}</div>
      <div class="cm-arrow">
        <svg width="64" height="22" viewBox="0 0 64 22" aria-hidden="true">
          <line x1="2" y1="11" x2="52" y2="11" stroke="${weak ? "#dc2626" : "#16a34a"}" stroke-width="2"></line>
          <polygon points="52,5 62,11 52,17" fill="${weak ? "#dc2626" : "#16a34a"}"></polygon>
        </svg>
        <div class="cm-ev ${weak ? "bad" : "good"}">${c.evidence ? "근거: " + escapeHtml(c.evidence) : "근거 없음 (보완 필요)"}</div>
      </div>
      <div class="${ncls}">${escapeHtml(effect)}</div>
    </div>`;
  }).join("");
  return `<div class="an-block"><div class="an-h">🔗 인과관계 논리맵 <span class="an-sub">(초록=근거 있음 · 빨강=근거 부족)</span></div>
    <div class="causal-map">${rows}</div></div>`;
}

function renderCriteriaMatrix(cj) {
  cj = cj || {};
  const items = cj.items || [];
  if (!items.length) return emptyHint("요건 대조 결과가 없습니다", "[요건 대조]를 누르면 인정 요건별 충족 여부를 표시합니다.");
  const met   = cj.metCount   != null ? cj.metCount   : items.filter(i => i.status === "met").length;
  const total = cj.totalCount != null ? cj.totalCount : items.length;
  return `<div class="crit-summary">충족 <strong>${met}</strong> / ${total} 요건</div>
    <div class="crit-list">${items.map(it => {
      const st = CRITERIA_STATUS[it.status] || { label: it.status || "-", cls: "cs-unmet" };
      const rag = it.ragSources || [];
      return `<div class="crit-row">
        <div class="crit-status ${st.cls}">${st.label}</div>
        <div class="crit-main">
          <div class="crit-title">${escapeHtml(it.title)}${it.category ? ` <span class="crit-cat">${escapeHtml(it.category)}</span>` : ""}</div>
          ${it.evidence ? `<div class="crit-ev">${escapeHtml(it.evidence)}</div>` : ""}
          ${rag.length ? renderRagSources(rag) : ""}
        </div></div>`;
    }).join("")}</div>`;
}

async function generateStrategy() {
  if (!currentCaseId) return;
  const btn = document.getElementById("strategyGenBtn");
  if (btn) { btn.disabled = true; btn.textContent = "분석 중…"; }
  try {
    const res = await apiGenerate(currentCaseId, "strategy");
    if (!res.ok) { toast(res.error || "전략 분석 실패", "error"); return; }
    if (cacheFromResponse("strategy", res)) { refreshAnalysis(); toast("전략 분석을 생성했습니다"); }
    else { toast("전략 분석 요청 — 잠시 후 표시됩니다"); pollGenerated("strategy"); }
  } catch (e) { if (e.message !== "auth") toast("분석 오류", "error"); }
  finally { const b = document.getElementById("strategyGenBtn"); if (b) b.disabled = false; }
}
async function checkCriteria() {
  if (!currentCaseId) return;
  const btn = document.getElementById("criteriaGenBtn");
  if (btn) { btn.disabled = true; btn.textContent = "대조 중…"; }
  try {
    const res = await apiGenerate(currentCaseId, "criteria");
    if (!res.ok) { toast(res.error || "요건 대조 실패", "error"); return; }
    if (cacheFromResponse("criteria_check", res)) { refreshAnalysis(); toast("요건 대조를 완료했습니다"); }
    else { toast("요건 대조 요청 — 잠시 후 표시됩니다"); pollGenerated("criteria_check"); }
  } catch (e) { if (e.message !== "auth") toast("대조 오류", "error"); }
  finally { const b = document.getElementById("criteriaGenBtn"); if (b) b.disabled = false; }
}

// ── 부족증거 액션 패널 (martyrdom_actions) ──────────────────────────────────
function refreshActionsPanel() {
  const body = document.getElementById("actionListBody");
  if (!body) return;
  if (!caseActions.length) {
    body.innerHTML = `<div class="empty-hint"><div class="eh-desc">아직 확보 액션이 없습니다. 위 [+ 액션 추가] 또는 부족 자료 옆 [+ 액션 추가]로 등록하세요.</div></div>`;
    return;
  }
  body.innerHTML = caseActions.map(a => {
    const st = a.status || "todo";
    return `<div class="action-row">
      <button class="ast-toggle ast-${st}" onclick="toggleAction(${a.id})" title="상태 전환">${ACTION_STATUS[st] || st}</button>
      <div class="action-main">
        <div class="action-item">${escapeHtml(a.item)}</div>
        <div class="action-meta">${a.source === "missing_evidence" ? '<span class="tag">AI 부족자료</span>' : '<span class="tag">수동</span>'}${a.dueDate ? ` · 기한 ${fmtDate(a.dueDate)}` : ""}${a.detail ? ` · ${escapeHtml(a.detail)}` : ""}</div>
      </div>
      <div class="action-actions">
        <button class="btn-sm btn-secondary" onclick="openActionModal(${a.id})">수정</button>
        <button class="btn-sm btn-danger" onclick="deleteAction(${a.id})">삭제</button>
      </div></div>`;
  }).join("");
}
async function toggleAction(id) {
  const a = caseActions.find(x => x.id === id);
  if (!a) return;
  const next = ACTION_STATUS_NEXT[a.status || "todo"] || "todo";
  try {
    const d = await apiActionSave({ id, status: next });
    if (!d.ok) { toast(d.error || "상태 변경 실패", "error"); return; }
    a.status = next; refreshActionsPanel();
  } catch (e) { if (e.message !== "auth") toast("상태 오류", "error"); }
}
async function addActionFromEvidence(item) {
  if (!currentCaseId || !item) return;
  try {
    const d = await apiActionSave({ caseId: currentCaseId, item, source: "missing_evidence", status: "todo" });
    if (!d.ok) { toast(d.error || "액션 추가 실패", "error"); return; }
    caseActions.push({ id: d.id || Date.now(), caseId: currentCaseId, item, source: "missing_evidence", status: "todo", dueDate: null });
    toast("확보 액션에 추가했습니다");
    refreshActionsPanel();
  } catch (e) { if (e.message !== "auth") toast("추가 오류", "error"); }
}
async function deleteAction(id) {
  if (!confirm("이 액션을 삭제할까요?")) return;
  try {
    const d = await apiActionDelete(id);
    if (!d.ok) { toast(d.error || "삭제 실패", "error"); return; }
    caseActions = caseActions.filter(a => a.id !== id);
    toast("액션을 삭제했습니다");
    refreshActionsPanel();
  } catch (e) { if (e.message !== "auth") toast("삭제 오류", "error"); }
}

// ── ④ 서면 탭 (준비도 게이지 ⑫ + 서면 초안 P3) ──────────────────────────────
function renderTabDraft() {
  const r = outputCache.readiness;
  return `<div class="tab-panel" id="tab-draft-panel" style="display:none">
  <div class="section-head">
    <div><h3>📊 보고서 준비도</h3>
      <p class="section-sub">최종 서면 생성 전, 지금 얼마나 채워졌고 무엇을 보완하면 강해지는지 가늠합니다.</p></div>
    <button class="btn" onclick="computeReadiness()" id="readinessBtn">준비도 ${r && r.id ? "다시 계산" : "계산"}</button>
  </div>
  ${outputReviewBar("readiness")}
  <div id="readinessBody">
    ${r && r.contentJson ? renderReadiness(r.contentJson) : emptyHint("아직 준비도가 계산되지 않았습니다", "[준비도 계산]을 누르면 요건·증거·타임라인·모순을 합산한 완성도 %와 보완 항목을 보여줍니다.")}
  </div>

  ${renderDraftSection()}
  ${renderFamilySummarySection()}
</div>`;
}

// ── ④ 서면 초안 (P3) — 1단계 목차 → 2단계 본문 → 3단계 합본·검토·내보내기 ──────
function renderDraftSection() {
  const dr = caseDraft;
  const hasOutline  = !!(dr && dr.outline && (dr.outline.sections || []).length);
  const sections    = (dr && dr.sections) || [];
  const hasSections = sections.some(s => s.content || s.status === "done" || s.status === "edited");
  const readyScore  = (outputCache.readiness && outputCache.readiness.contentJson && outputCache.readiness.contentJson.score);
  const gaps        = (outputCache.readiness && outputCache.readiness.contentJson && outputCache.readiness.contentJson.gaps) || [];
  const weak = (typeof readyScore === "number" && readyScore < 60);
  const weakGaps = gaps.slice(0, 3).map(g => escapeHtml(g.label)).join(" · ");

  return `<div class="section-head" style="margin-top:26px">
    <div><h4>📄 유족급여신청서 초안</h4>
      <p class="section-sub">인정 받은 과거 사례를 형식 모델로, 목차를 확정한 뒤 섹션별로 본문을 생성합니다.</p></div>
  </div>
  <div class="alert-banner expert-warning">⚠️ 전문가 검토용 초안 — 변호사·노무사 확인 필수</div>
  ${weak ? `<div class="weak-banner">⚠️ 준비도 ${readyScore}% — 아직 약한 보고서입니다. ${weakGaps ? `<strong>${weakGaps}</strong> 보완을 권장`: "부족 자료 보완을 권장"}합니다. 그래도 초안 생성은 가능합니다.</div>` : ""}

  <!-- 1단계 목차 -->
  <div class="draft-stage">
    <div class="ds-head"><span class="ds-step">1단계</span> 목차
      <button class="btn-sm" onclick="genDraftOutline()" id="draftOutlineBtn">${hasOutline ? "목차 다시 제안" : "목차 제안 생성"}</button>
    </div>
    <div id="draftOutlineBody">
      ${hasOutline ? renderDraftOutline(dr.outline.sections) : emptyHint("아직 목차가 없습니다", "[목차 제안 생성]을 누르면 사건 구조·전략·인정 사례 형식을 토대로 섹션 목차를 제안합니다.")}
    </div>
  </div>

  <!-- 2단계 본문 -->
  <div class="draft-stage">
    <div class="ds-head"><span class="ds-step">2단계</span> 본문
      <button class="btn-sm" onclick="genDraftBody()" id="draftBodyBtn" ${hasOutline ? "" : "disabled"}>${hasSections ? "본문 다시 생성" : "본문 생성 시작"}</button>
    </div>
    <div id="draftSectionsBody">
      ${hasOutline
        ? (hasSections ? renderDraftSections(sections) : emptyHint("아직 본문이 없습니다", "[본문 생성 시작]을 누르면 섹션을 순서대로 생성합니다. 각 섹션은 근거(인용)와 함께 표시됩니다."))
        : `<div class="ds-locked">먼저 1단계에서 목차를 만들어 주세요.</div>`}
    </div>
  </div>

  <!-- 3단계 합본·검토·내보내기 -->
  <div class="draft-stage">
    <div class="ds-head"><span class="ds-step">3단계</span> 합본 · 검토 · 내보내기</div>
    <div class="export-btns">
      <button class="btn-sm btn-secondary" onclick="previewAssembled()" ${hasSections ? "" : "disabled"}>🔎 합본 미리보기</button>
      <button class="btn-sm" onclick="exportDraft('pdf')"  ${hasSections ? "" : "disabled"}>📄 PDF</button>
      <button class="btn-sm" onclick="exportDraft('docx')" ${hasSections ? "" : "disabled"}>📝 Word</button>
      <button class="btn-sm btn-secondary" onclick="exportPackage()">📦 사건 패키지 zip</button>
    </div>
    ${renderReviewBlock()}
  </div>`;
}

// 1단계 목차 — 편집 가능 목록(제목·intent·순서·추가/삭제) + 저장
function renderDraftOutline(sections) {
  const rows = sections.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((s, i, arr) => {
    return `<div class="outline-row" data-key="${escapeHtml(s.sectionKey)}">
      <div class="ol-no">${i + 1}</div>
      <div class="ol-fields">
        <input class="ol-title" type="text" value="${escapeHtml(s.title)}" placeholder="섹션 제목"
          onchange="updateOutlineField('${jsStr(s.sectionKey)}','title',this.value)">
        <input class="ol-intent" type="text" value="${escapeHtml(s.intent || "")}" placeholder="이 섹션에서 다룰 내용(생성 지시)"
          onchange="updateOutlineField('${jsStr(s.sectionKey)}','intent',this.value)">
      </div>
      <div class="ol-btns">
        <button class="btn-xs" onclick="moveOutline('${jsStr(s.sectionKey)}',-1)" ${i === 0 ? "disabled" : ""} title="위로">↑</button>
        <button class="btn-xs" onclick="moveOutline('${jsStr(s.sectionKey)}',1)" ${i === arr.length - 1 ? "disabled" : ""} title="아래로">↓</button>
        <button class="btn-xs btn-danger" onclick="removeOutline('${jsStr(s.sectionKey)}')" title="삭제">✕</button>
      </div>
    </div>`;
  }).join("");
  return `<div class="outline-list">${rows}</div>
    <div class="outline-foot">
      <button class="btn-sm btn-secondary" onclick="addOutlineRow()">+ 섹션 추가</button>
      <button class="btn-sm" onclick="saveDraftOutline()">목차 저장</button>
    </div>`;
}

// 2단계 본문 — 섹션별 편집 textarea + 재생성 + 근거 펼치기
function renderDraftSections(sections) {
  const sorted = sections.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  return `<div class="draft-sections">${sorted.map((s, i) => {
    const st = DRAFT_SEC_STATUS[s.status] || { label: s.status || "-", cls: "dss-pending" };
    const rag = s.ragSources || [];
    const editable = (s.status === "done" || s.status === "edited") && typeof s.id === "number";
    return `<div class="draft-sec">
      <div class="dsec-head">
        <span class="dsec-no">${i + 1}.</span>
        <span class="dsec-title">${escapeHtml(s.title)}</span>
        <span class="dsec-status ${st.cls}">${st.label}</span>
        <span class="dsec-wc">${s.wordCount ? s.wordCount + "자" : ""}</span>
        <button class="btn-xs" onclick="regenSection('${jsStr(s.sectionKey)}')" title="이 섹션만 다시 생성">재생성</button>
      </div>
      <textarea class="dsec-body" rows="6" ${editable ? "" : "disabled"}
        placeholder="${editable ? "" : "아직 생성되지 않았습니다 — [재생성] 또는 상단 [본문 생성]을 누르세요"}"
        ${editable ? `onchange="saveSection(${s.id}, this.value)"` : ""}>${escapeHtml(s.content || "")}</textarea>
      ${rag.length ? renderRagSources(rag) : ""}
    </div>`;
  }).join("")}</div>`;
}

// 전문가 검토 블록 — 배정 드롭다운 + 검토 이력 + (배정자) 결정 버튼
function renderReviewBlock() {
  const dr = caseDraft;
  const canAssign = !!(dr && dr.outputId);
  const reviews = (dr && dr.reviews) || [];
  const opts = caseReviewers.map(r => `<option value="${r.id}">${escapeHtml(r.name)}${r.role === "super_admin" ? " (전문가)" : ""}</option>`).join("");
  const rows = reviews.map(rv => {
    const st = REVIEW_STATUS[rv.status] || { label: rv.status || "-", cls: "rv-pending" };
    const mine = (myMemberId != null && rv.assignedTo === myMemberId) || isSuperAdmin;
    const canDecide = mine && rv.status === "pending";
    return `<div class="rv-row">
      <span class="rv-badge ${st.cls}">${st.label}</span>
      <span class="rv-who">${escapeHtml(rv.assignedToName || ("검토자 #" + rv.assignedTo))}</span>
      <span class="rv-date">${rv.decidedAt ? "결정 " + fmtDate(rv.decidedAt) : "배정 " + fmtDate(rv.createdAt)}</span>
      ${rv.note ? `<span class="rv-note">— ${escapeHtml(rv.note)}</span>` : ""}
      ${canDecide ? `<span class="rv-acts">
        <button class="btn-xs" onclick="decideReview(${rv.id},'approved')">승인</button>
        <button class="btn-xs btn-warn" onclick="decideReview(${rv.id},'changes_requested')">수정요청</button>
      </span>` : ""}
    </div>`;
  }).join("");
  return `<div class="review-assign">
    <div class="rva-head">🧑‍⚖️ 전문가 검토
      ${dr && dr.status === "reviewed" ? `<span class="rv-badge rv-approved">검토 완료</span>` : ""}
    </div>
    <div class="rva-row">
      <select id="reviewerSelect" ${canAssign && caseReviewers.length ? "" : "disabled"}>
        <option value="">검토자 선택…</option>${opts}
      </select>
      <button class="btn-sm" onclick="assignReviewer()" ${canAssign && caseReviewers.length ? "" : "disabled"}>배정</button>
    </div>
    ${!canAssign ? `<div class="rva-hint">목차·본문을 먼저 생성하면 검토자를 배정할 수 있습니다.</div>` : ""}
    <div class="rv-list">${rows || `<div class="rva-hint">아직 배정된 검토가 없습니다.</div>`}</div>
  </div>`;
}
// ── ⑧ 유족 전달용 쉬운 요약 (P4) ──────────────────────────────────────────────
function renderFamilySummarySection() {
  const fs = familySummaryCache;
  const hasContent = !!(fs && fs.contentText);
  return `<div class="draft-stage" style="margin-top:14px">
    <div class="ds-head"><span class="ds-step">⑧ 유족 전달용 요약</span>
      <button class="btn-sm" onclick="generateFamilySummary()" id="familySummaryBtn">
        ${hasContent ? "다시 생성" : "요약 생성"}
      </button>
    </div>
    <p class="section-sub" style="margin:0 0 10px">쉬운 말로 현재 진행 상황과 다음 할 일을 정리해 유족에게 전달하는 요약입니다.</p>
    <div id="familySummaryBody">
      ${hasContent ? renderFamilySummaryCard(fs) : emptyHint("아직 요약이 없습니다", "[요약 생성]을 누르면 전문 용어 없이 현재 진행 상황과 다음 할 일을 요약합니다.")}
    </div>
  </div>`;
}
function renderFamilySummaryCard(fs) {
  if (!fs || !fs.contentText) return "";
  const steps = fs.nextSteps || [];
  return `<div class="family-summary-card">
    <div class="fsc-status">
      <span class="rv-badge ${fs.status === "reviewed" ? "rv-approved" : "rv-pending"}">${fs.status === "reviewed" ? "검토 완료" : "초안"}</span>
      <span class="fsc-hint">⚠️ 운영자가 내용을 확인 후 전달하세요</span>
    </div>
    <div class="fsc-content">${escapeHtml(fs.contentText)}</div>
    ${steps.length ? `<div class="fsc-steps"><strong>다음 할 일:</strong><ul>${steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>` : ""}
    <div class="fsc-actions">
      <button class="btn-sm btn-secondary" onclick="copyFamilySummary()">📋 복사</button>
      <button class="btn-sm btn-secondary" onclick="exportFamilySummaryPdf()">📄 PDF 저장</button>
    </div>
  </div>`;
}

function renderReadiness(cj) {
  cj = cj || {};
  const score = cj.score != null ? cj.score : 0;
  const bd = cj.breakdown || {};
  const mx = cj.max || {};
  const gaps = cj.gaps || [];
  const segs = [
    { key: "criteria",  label: "요건",     color: "#2563eb" },
    { key: "evidence",  label: "증거",     color: "#0891b2" },
    { key: "timeline",  label: "타임라인", color: "#7c3aed" },
    { key: "conflicts", label: "모순 없음", color: "#059669" },
  ];
  const maxTotal = segs.reduce((s, x) => s + (mx[x.key] || 0), 0) || 100;
  return `<div class="readiness-wrap">
    <div class="rd-score-row">
      <div class="rd-score">${score}<span class="rd-pct">%</span></div>
      <div class="rd-bar-wrap">
        <div class="rd-bar">${segs.map(s => {
          const w = (bd[s.key] || 0) / maxTotal * 100;
          return `<div class="rd-seg" style="width:${w}%;background:${s.color}" title="${s.label} ${bd[s.key] || 0}/${mx[s.key] || 0}"></div>`;
        }).join("")}</div>
        <div class="rd-legend">${segs.map(s => `<span class="rd-leg"><i style="background:${s.color}"></i>${s.label} ${bd[s.key] || 0}/${mx[s.key] || 0}</span>`).join("")}</div>
      </div>
    </div>
    <div class="rd-label">${escapeHtml(cj.label || "보고서 준비도 — 인정 확률 아님·내부 가늠용")}</div>
    ${gaps.length ? `<div class="rd-gaps"><div class="an-h">➕ 채우면 올라가는 항목</div>
      ${gaps.map(g => `<div class="gap-row"><span class="gap-plus">+${g.plus}%</span> <span class="gap-label">${escapeHtml(g.label)}</span>
        <button class="btn-sm" onclick="addActionFromEvidence('${jsStr(g.label)}')">+ 액션</button></div>`).join("")}</div>` : ""}
    ${cj.aiNote ? `<div class="rd-note"><strong>💬 AI 첨언</strong><div>${escapeHtml(cj.aiNote)}</div></div>` : ""}
  </div>`;
}
async function computeReadiness() {
  if (!currentCaseId) return;
  const btn = document.getElementById("readinessBtn");
  if (btn) { btn.disabled = true; btn.textContent = "계산 중…"; }
  try {
    const res = await apiReadiness(currentCaseId);
    if (!res.ok) { toast(res.error || "준비도 계산 실패", "error"); return; }
    if (cacheFromResponse("readiness", res)) { refreshDraft(); toast("준비도를 계산했습니다"); }
    else { toast("준비도 계산 요청 — 잠시 후 표시됩니다"); pollGenerated("readiness"); }
  } catch (e) { if (e.message !== "auth") toast("계산 오류", "error"); }
  finally { const b = document.getElementById("readinessBtn"); if (b) b.disabled = false; }
}

// ── ④ 서면 핸들러 (P3) ──────────────────────────────────────────────────────
// 서면 상태 재로드(GET) — 목차 편집 in-memory 외 모든 변경 후 호출(canonical)
async function reloadDraft() {
  if (!currentCaseId) return;
  try {
    const dr = await apiDraftLoad(currentCaseId);
    caseDraft = normalizeDraft(dr);
  } catch (_) { /* 유지 */ }
  refreshDraft();
}

// 1단계 — 목차 제안 생성
async function genDraftOutline() {
  if (!currentCaseId) return;
  const btn = document.getElementById("draftOutlineBtn");
  if (btn) { btn.disabled = true; btn.textContent = "제안 중…"; }
  try {
    const res = await apiDraftOutline(currentCaseId);
    if (!res.ok) { toast(res.error || "목차 제안 실패", "error"); return; }
    await reloadDraft();
    toast("목차를 제안했습니다 — 필요하면 수정 후 저장하세요");
  } catch (e) { if (e.message !== "auth") toast("목차 오류", "error"); }
  finally { const b = document.getElementById("draftOutlineBtn"); if (b) b.disabled = false; }
}
// 목차 편집 — 제목·intent (onchange 시 in-memory 반영, 재렌더 불필요)
function updateOutlineField(key, field, value) {
  if (!caseDraft || !caseDraft.outline) return;
  const s = (caseDraft.outline.sections || []).find(x => x.sectionKey === key);
  if (s) s[field] = value;
}
// 순서 이동 (위/아래)
function moveOutline(key, dir) {
  if (!caseDraft || !caseDraft.outline) return;
  const arr = (caseDraft.outline.sections || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const i = arr.findIndex(x => x.sectionKey === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  const t = arr[i].order; arr[i].order = arr[j].order; arr[j].order = t;
  caseDraft.outline.sections = arr;
  refreshDraft();
}
// 섹션 삭제
function removeOutline(key) {
  if (!caseDraft || !caseDraft.outline) return;
  caseDraft.outline.sections = (caseDraft.outline.sections || []).filter(x => x.sectionKey !== key);
  refreshDraft();
}
// 섹션 추가
function addOutlineRow() {
  if (!caseDraft) caseDraft = { outputId: null, status: "draft", outline: { sections: [] }, sections: [], reviews: [] };
  if (!caseDraft.outline) caseDraft.outline = { sections: [] };
  const arr = caseDraft.outline.sections || [];
  const maxOrder = arr.reduce((m, s) => Math.max(m, s.order || 0), 0);
  arr.push({ sectionKey: "custom_" + Date.now().toString(36), title: "새 섹션", intent: "", order: maxOrder + 1 });
  caseDraft.outline.sections = arr;
  refreshDraft();
}
// 목차 저장(PATCH) — order 1..N 정규화 후 전송
async function saveDraftOutline() {
  if (!caseDraft || !caseDraft.outline) return;
  const arr = (caseDraft.outline.sections || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((s, i) => ({ ...s, order: i + 1 }));
  caseDraft.outline.sections = arr;
  if (!arr.length) { toast("섹션이 하나도 없습니다", "error"); return; }
  try {
    const res = await apiDraftOutlineSave(currentCaseId, caseDraft.outputId, arr);
    if (!res.ok) { toast(res.error || "목차 저장 실패", "error"); return; }
    toast("목차를 저장했습니다");
    await reloadDraft();
  } catch (e) { if (e.message !== "auth") toast("저장 오류", "error"); }
}

// 2단계 — 전 섹션 본문 생성(background 큐) + 진행 오버레이·폴링
async function genDraftBody() {
  if (!currentCaseId || !caseDraft || !caseDraft.outputId) { toast("먼저 목차를 생성하세요"); return; }
  const total = (caseDraft.outline.sections || []).length || 0;
  const btn = document.getElementById("draftBodyBtn");
  if (btn) { btn.disabled = true; btn.textContent = "생성 시작…"; }
  try {
    const res = await apiDraftGenerate(currentCaseId);   // sectionKey 없음 → 전 섹션 큐
    if (!res.ok) { toast(res.error || "본문 생성 실패", "error"); if (btn) btn.disabled = false; return; }
    const t = res.total || total || 0;
    openBulkProgress("📝 본문 생성", t || 1);
    pollDraftSections(t);
  } catch (e) {
    if (e.message !== "auth") toast("생성 오류", "error");
    if (btn) btn.disabled = false;
  }
}
// 섹션 생성 결과 폴링(4초) — done 개수로 진행률·완료 감지
function pollDraftSections(total) {
  clearDraftPollTimer();
  let tries = 0;
  draftPollTimer = setInterval(async () => {
    tries++;
    if (_bulkCancel) { clearDraftPollTimer(); finishBulkProgress("취소됨", "cancel"); reloadDraft(); return; }
    if (tries > 40 || !currentCaseId) {
      clearDraftPollTimer();
      finishBulkProgress("생성이 길어집니다 — 잠시 후 다시 확인하세요", "cancel");
      reloadDraft();
      return;
    }
    try {
      const dr = await apiDraftLoad(currentCaseId);
      const nd = normalizeDraft(dr);
      const secs = (nd && nd.sections) || [];
      const cap = total || secs.length || 1;
      const done = secs.filter(s => s.status === "done" || s.status === "edited").length;
      const cur = secs.find(s => s.status === "generating");
      updateBulkProgress(done, cap, cur ? ("생성 중 — " + cur.title) : (done >= cap ? "마무리 중…" : "생성 중…"), 0);
      if (cap > 0 && done >= cap) {
        clearDraftPollTimer();
        caseDraft = nd;
        finishBulkProgress("완료 — " + done + "개 섹션 생성", "done");
        refreshDraft();
        toast("본문 초안을 생성했습니다");
      }
    } catch (_) { /* 일시 오류 무시·계속 */ }
  }, 4000);
}
// 단일 섹션 재생성(동기)
async function regenSection(sectionKey) {
  if (!currentCaseId) return;
  toast("섹션 재생성 중…");
  try {
    const res = await apiDraftGenerate(currentCaseId, sectionKey);
    if (!res.ok) { toast(res.error || "재생성 실패", "error"); return; }
    const sec = res.section || (res.data && res.data.section);
    if (sec && caseDraft) {
      const idx = caseDraft.sections.findIndex(s => s.sectionKey === sectionKey);
      if (idx >= 0) caseDraft.sections[idx] = { ...caseDraft.sections[idx], ...sec };
      else caseDraft.sections.push(sec);
      refreshDraft();
      toast("섹션을 다시 생성했습니다");
    } else {
      // 동기 응답이 아니면(큐) 재로드로 반영
      await reloadDraft();
    }
  } catch (e) { if (e.message !== "auth") toast("재생성 오류", "error"); }
}
// 섹션 본문 편집 저장(PATCH)
async function saveSection(sectionId, content) {
  if (typeof sectionId !== "number") return;   // 생성 전 임시 행 보호
  try {
    const res = await apiDraftSectionSave(sectionId, content);
    if (!res.ok) { toast(res.error || "섹션 저장 실패", "error"); return; }
    if (caseDraft) {
      const s = caseDraft.sections.find(x => x.id === sectionId);
      if (s) { s.content = content; s.status = "edited"; s.wordCount = (content || "").length; }
    }
    toast("섹션을 저장했습니다");
  } catch (e) { if (e.message !== "auth") toast("저장 오류", "error"); }
}

// 3단계 — 합본 미리보기 모달
function previewAssembled() {
  if (!caseDraft || !(caseDraft.sections || []).length) { toast("먼저 본문을 생성하세요"); return; }
  const secs = caseDraft.sections.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const inner = secs.map((s, i) => `<h3 class="ap-h">${i + 1}. ${escapeHtml(s.title)}</h3>
    <div class="ap-body">${escapeHtml(s.content || "(미생성)").replace(/\n/g, "<br>")}</div>
    ${(s.ragSources || []).length ? `<div class="ap-rag">근거: ${s.ragSources.map(r => escapeHtml(r.title || r.sourceRef || "")).join(" · ")}</div>` : ""}`).join("");
  let el = document.getElementById("assembledOverlay");
  if (!el) { el = document.createElement("div"); el.id = "assembledOverlay"; el.className = "modal-overlay"; document.body.appendChild(el); }
  el.innerHTML = `<div class="modal-box ap-box">
    <div class="ap-title">📄 합본 미리보기 <button class="btn-xs" onclick="closeAssembled()">닫기</button></div>
    <div class="ap-warn">⚠️ 전문가 검토용 초안 — 변호사·노무사 확인 필수</div>
    <div class="ap-scroll">${inner}</div>
    <div class="ap-foot"><button class="btn-sm" onclick="exportDraft('pdf')">📄 PDF</button> <button class="btn-sm" onclick="exportDraft('docx')">📝 Word</button></div>
  </div>`;
  el.style.display = "flex";
}
function closeAssembled() { const el = document.getElementById("assembledOverlay"); if (el) el.style.display = "none"; }

// base64 → Blob 다운로드(PDF·Word·zip 공용)
function downloadBase64(fileName, mimeType, base64) {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName || "download";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return true;
  } catch (e) { toast("다운로드 변환 실패", "error"); return false; }
}
// 내보내기 — PDF·Word
async function exportDraft(format) {
  if (!currentCaseId || !caseDraft || !caseDraft.outputId) { toast("먼저 본문을 생성하세요"); return; }
  toast((format === "pdf" ? "PDF" : "Word") + " 생성 중…");
  try {
    const res = await apiDraftExport(currentCaseId, caseDraft.outputId, format);
    if (!res.ok) { toast(res.error || "내보내기 실패", "error"); return; }
    const fileName = res.fileName || (res.data && res.data.fileName) || ("유족급여신청서." + (format === "pdf" ? "pdf" : "docx"));
    const mimeType = res.mimeType || (res.data && res.data.mimeType);
    const base64 = res.base64 || (res.data && res.data.base64);
    if (!base64) { toast("내보내기 데이터가 비어 있습니다", "error"); return; }
    if (downloadBase64(fileName, mimeType, base64)) toast(fileName + " 다운로드");
  } catch (e) { if (e.message !== "auth") toast("내보내기 오류", "error"); }
}
// 사건 패키지 zip
async function exportPackage() {
  if (!currentCaseId) return;
  toast("사건 패키지 생성 중…");
  try {
    const res = await apiDraftPackage(currentCaseId);
    if (!res.ok) { toast(res.error || "패키지 생성 실패", "error"); return; }
    if (res.queued) { toast("패키지 생성 요청 — 잠시 후 다시 시도하세요"); return; }
    const fileName = res.fileName || (res.data && res.data.fileName) || "사건패키지.zip";
    const base64 = res.base64 || (res.data && res.data.base64);
    if (!base64) { toast("패키지 데이터가 비어 있습니다", "error"); return; }
    if (downloadBase64(fileName, "application/zip", base64)) toast(fileName + " 다운로드");
  } catch (e) { if (e.message !== "auth") toast("패키지 오류", "error"); }
}

// 전문가 검토 — 배정
async function assignReviewer() {
  if (!caseDraft || !caseDraft.outputId) { toast("먼저 목차·본문을 생성하세요"); return; }
  const sel = document.getElementById("reviewerSelect");
  const assignedTo = sel ? Number(sel.value) : 0;
  if (!assignedTo) { toast("검토자를 선택하세요"); return; }
  try {
    const res = await apiReviewAssign(currentCaseId, caseDraft.outputId, assignedTo);
    if (!res.ok) { toast(res.error || "배정 실패", "error"); return; }
    toast("검토자를 배정했습니다");
    await reloadDraft();
  } catch (e) { if (e.message !== "auth") toast("배정 오류", "error"); }
}
// 전문가 검토 — 결정(승인·수정요청)
async function decideReview(reviewId, status) {
  const note = prompt(status === "approved" ? "검토 메모 (선택):" : "수정요청 사유:", "");
  if (note === null) return;   // 취소
  try {
    const res = await apiReviewDecide(reviewId, status, note.trim());
    if (!res.ok) { toast(res.error || "검토 저장 실패", "error"); return; }
    toast(status === "approved" ? "승인했습니다" : "수정요청을 보냈습니다");
    await reloadDraft();
  } catch (e) { if (e.message !== "auth") toast("검토 오류", "error"); }
}

// ── ⑤ 기한 탭 (martyrdom_deadlines · CRUD) ──────────────────────────────────
function renderTabDeadlines() {
  return `<div class="tab-panel" id="tab-deadlines-panel" style="display:none">
  <div class="section-head">
    <div><h3>🗓 절차·기한 관리</h3>
      <p class="section-sub">소멸시효·자료 제출·심의 등 기한을 D-day로 추적합니다.</p></div>
    <button class="btn" onclick="openDeadlineItemModal()">+ 기한 추가</button>
  </div>
  <div id="deadlineListBody" class="deadline-list">불러오는 중…</div>
</div>`;
}
// ── P4: G5 통계 탭 ─────────────────────────────────────────────────────────
function renderTabStats() {
  return `<div class="tab-panel" id="tab-stats-panel" style="display:none">
  <div class="section-head">
    <div><h3>📊 인정률·성과 통계</h3>
      <p class="section-sub">전체 사건의 인정률·유형별·월별 추이를 집계합니다.</p></div>
    <button class="btn" onclick="loadStats(true)">새로고침</button>
  </div>
  <div id="statsBody"><div class="list-loading">불러오는 중…</div></div>
</div>`;
}

// ── P4: 연구 발간 탭 (조회 operator+ · 생성·검수·발간·삭제 admin+) ──────────
function renderTabPublications() {
  return `<div class="tab-panel" id="tab-publications-panel" style="display:none">
  <div class="section-head">
    <div><h3>📚 연구 발간</h3>
      <p class="section-sub">축적된 사건·통계·인정 패턴을 종합해 외부 발간용 연구 자료를 생성합니다.</p></div>
  </div>
  <div class="alert-banner expert-warning">⚠️ 외부 발간 전 운영자(책임자) 검수·승인 필수. 실명·식별정보 자동 경량 마스킹 적용.</div>

  <!-- 새 발간물 생성 (발간 쓰기 권한자) — 권한 정책 반영(loadPublications에서 표시 토글) -->
  <div class="draft-stage" id="pubCreateStage" style="display:${isAdmin ? '' : 'none'}">
    <div class="ds-head"><span class="ds-step">새 발간물 생성</span></div>
    <div class="pub-form">
      <div class="pub-form-row">
        <label>발간 유형</label>
        <select id="pubTypeSelect">
          <option value="guide">종합 가이드 — 단계별 절차·준비 자료 안내</option>
          <option value="trend">순직 인정 동향 보고서 — 인정률·요인·정책 시사점</option>
          <option value="case_study">익명 사례 연구 — 인정 논리·교훈 분석</option>
        </select>
      </div>
      <div class="pub-form-row">
        <label>혼합 비율 <span id="blendLabel" class="blend-label">자체 70 : AI 30</span></label>
        <div class="blend-row">
          <span class="blend-edge">자체</span>
          <input type="range" id="blendSlider" min="0" max="100" value="70" step="10"
            oninput="updateBlendLabel(this.value)" class="blend-slider">
          <span class="blend-edge">AI</span>
        </div>
        <p class="section-sub">자체 = 축적 사건·통계·인정패턴 / AI = Gemini 동향분석(일반 지식 기반·실시간 웹검색 아님)</p>
      </div>
      <div class="pub-form-row">
        <label>마스킹 수준</label>
        <select id="maskLevelSelect">
          <option value="light">경량 — 고인·유족 실명 부분가림(○○ 선생님 수준·학교명·지명 유지)</option>
          <option value="strong">강 — 식별 가능 정보 전체 일반화</option>
        </select>
      </div>
      <div class="pub-form-row">
        <button class="btn" onclick="generatePublication()" id="pubGenBtn">발간물 생성</button>
      </div>
    </div>
  </div>
  <div class="empty-hint" id="pubReadonlyHint" style="display:${isAdmin ? 'none' : ''}"><div class="eh-desc">📖 조회 전용입니다. 발간물 생성·검수·발간·삭제는 발간 권한이 필요합니다. 아래 목록과 미리보기는 열람·PDF/HTML 내보내기가 가능합니다.</div></div>

  <!-- 발간물 목록 -->
  <div class="draft-stage">
    <div class="ds-head"><span class="ds-step">발간물 목록</span>
      <button class="btn-sm btn-secondary" onclick="loadPublications()" style="margin-left:auto">목록 새로고침</button>
    </div>
    <div id="pubListBody"><div class="list-loading">불러오는 중…</div></div>
  </div>

  <!-- 발간물 상세 미리보기 -->
  <div id="pubDetailSection" style="display:none">
    <div class="draft-stage">
      <div class="ds-head"><span class="ds-step">발간물 미리보기</span>
        <button class="btn-sm btn-secondary" onclick="closePubDetail()" style="margin-left:auto">닫기</button>
      </div>
      <div id="pubDetailBody"></div>
    </div>
  </div>
</div>`;
}

function refreshDeadlinesPanel() {
  const body = document.getElementById("deadlineListBody");
  if (!body) return;
  if (!caseDeadlines.length) {
    body.innerHTML = `<div class="empty-hint"><div class="eh-desc">등록된 기한이 없습니다. [+ 기한 추가]로 소멸시효·제출 기한 등을 등록하세요.</div></div>`;
    return;
  }
  const sorted = caseDeadlines.slice().sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
  body.innerHTML = sorted.map(d => {
    const done = d.status === "done";
    const ds = dday(d.dueDate);
    const diff = d.dueDate ? Math.ceil((new Date(d.dueDate) - Date.now()) / 86400000) : null;
    const urgent = !done && diff != null && diff <= 7;
    const overdue = !done && diff != null && diff < 0;
    return `<div class="deadline-row ${done ? "dl-done" : ""}">
      <div class="dl-dday ${overdue ? "dl-over" : (urgent ? "dl-urgent" : "")}">${done ? "완료" : (ds || "-")}</div>
      <div class="dl-main">
        <div class="dl-label">${escapeHtml(d.label)} <span class="tag">${DEADLINE_KIND[d.kind] || d.kind || "기타"}</span></div>
        <div class="dl-meta">${fmtDate(d.dueDate)}${d.note ? ` · ${escapeHtml(d.note)}` : ""}</div>
      </div>
      <div class="dl-actions">
        <button class="btn-sm ${done ? "btn-secondary" : ""}" onclick="toggleDeadline(${d.id})">${done ? "되돌리기" : "완료"}</button>
        <button class="btn-sm btn-secondary" onclick="openDeadlineItemModal(${d.id})">수정</button>
        <button class="btn-sm btn-danger" onclick="deleteDeadlineItem(${d.id})">삭제</button>
      </div></div>`;
  }).join("");
}
async function toggleDeadline(id) {
  const d = caseDeadlines.find(x => x.id === id);
  if (!d) return;
  const next = d.status === "done" ? "pending" : "done";
  try {
    const res = await apiDeadlineSave({ id, status: next });
    if (!res.ok) { toast(res.error || "상태 변경 실패", "error"); return; }
    d.status = next; refreshDeadlinesPanel();
  } catch (e) { if (e.message !== "auth") toast("상태 오류", "error"); }
}
async function deleteDeadlineItem(id) {
  if (!confirm("이 기한을 삭제할까요?")) return;
  try {
    const res = await apiDeadlineDelete(id);
    if (!res.ok) { toast(res.error || "삭제 실패", "error"); return; }
    caseDeadlines = caseDeadlines.filter(x => x.id !== id);
    toast("기한을 삭제했습니다");
    refreshDeadlinesPanel();
  } catch (e) { if (e.message !== "auth") toast("삭제 오류", "error"); }
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
  document.getElementById("viewerTitle").textContent = doc.fileName;

  const isMedia = doc.extractMethod === "gemini_audio" || doc.extractMethod === "gemini_video";

  /* ── 1. 원본 영역 ── */
  let originalHtml = "";
  if (doc.blobUrl && doc.blobUrl !== "#") {
    const isPdf   = doc.mimeType === "application/pdf";
    const isImage = doc.mimeType?.startsWith("image/");
    if (isPdf) {
      originalHtml = `<iframe src="${escapeHtml(doc.blobUrl)}" style="width:100%;height:56vh;border:none"></iframe>`;
    } else if (isImage) {
      originalHtml = `<img src="${escapeHtml(doc.blobUrl)}" style="max-width:100%;max-height:56vh;object-fit:contain">`;
    } else {
      originalHtml = `<a href="${escapeHtml(doc.blobUrl)}" target="_blank">파일 다운로드</a>`;
    }
  } else if (isMedia) {
    const ko = doc.extractMethod === "gemini_audio" ? "음성" : "영상";
    originalHtml = `<div style="color:#64748b;margin-bottom:4px;line-height:1.6">🎙 원본 ${ko}은 전사(텍스트 변환) 후 저장공간 절약을 위해 삭제되었습니다. 아래 전사 전문으로 분류·분석이 이루어집니다.</div>`;
  } else {
    originalHtml = `<div style="color:#94a3b8;margin-bottom:4px">원본 미리보기가 없습니다 — 아래 추출 텍스트를 확인하세요.</div>`;
  }

  /* ── 2. 추출/전사 텍스트 영역 (on-demand 로드) ── */
  const textLabel = isMedia ? "전사 전문" : "추출 텍스트";
  content.innerHTML = `<div style="padding:8px 4px;text-align:left">
    ${originalHtml}
    <div style="margin-top:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-weight:600">📄 ${textLabel}</span>
        <button class="btn-xs btn-secondary" onclick="copyDocText()" id="docTextCopyBtn" style="display:none">복사</button>
      </div>
      ${doc.docSummary ? `<div style="color:#475569;font-size:12px;margin-bottom:8px">한 줄 요약: ${escapeHtml(doc.docSummary)}</div>` : ""}
      <div id="docTextBody" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap;max-height:48vh;overflow:auto;line-height:1.6;font-size:13px;color:#334155">불러오는 중…</div>
    </div>
  </div>`;
  modal.style.display = "flex";

  const body = document.getElementById("docTextBody");
  const copyBtn = document.getElementById("docTextCopyBtn");
  if (USE_MOCK || (typeof USE_P4_MOCK !== "undefined" && USE_P4_MOCK)) {
    if (body) body.textContent = doc.docSummary || "(mock — 추출 텍스트 없음)";
    return;
  }
  try {
    const d = await apiFetch("/api/admin-martyrdom-doc-text?id=" + encodeURIComponent(docId));
    if (!body) return;
    if (d.ok && d.extractedText && d.extractedText.trim()) {
      body.textContent = d.extractedText;
      if (copyBtn) copyBtn.style.display = "";
    } else if (d.ok && d.extractError) {
      body.innerHTML = `<span style="color:#dc2626">추출 실패: ${escapeHtml(d.extractError)}</span>`;
    } else {
      const st = d.extractStatus || doc.extractStatus;
      body.textContent = (st === "processing" || st === "pending") ? "추출 처리 중입니다… 잠시 후 다시 열어주세요." : (doc.docSummary || "추출 텍스트가 없습니다.");
    }
  } catch (e) {
    if (body) body.textContent = doc.docSummary || "추출 텍스트를 불러오지 못했습니다.";
  }
}
function copyDocText() {
  const body = document.getElementById("docTextBody");
  if (!body) return;
  navigator.clipboard?.writeText(body.textContent || "").then(
    () => toast("추출 텍스트를 복사했습니다"),
    () => toast("복사 실패", "error")
  );
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
  if (genPollTimer) { clearInterval(genPollTimer); genPollTimer = null; }
}
function clearDraftPollTimer() {
  if (draftPollTimer) { clearInterval(draftPollTimer); draftPollTimer = null; }
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

// ── 동의 기록 모달 (라 — 유족 동의 최소 기록) ───────────────────────────────
function openConsentModal() {
  if (!currentDetail) return;
  const c = currentDetail.case;
  document.getElementById("cs_note").value = c.consentNote || "";
  document.getElementById("cs_date").value = c.consentObtainedAt ? String(c.consentObtainedAt).slice(0, 10) : "";
  document.getElementById("consentModal").style.display = "flex";
}
function closeConsentModal() { document.getElementById("consentModal").style.display = "none"; }
async function submitConsent() {
  if (!currentCaseId) return;
  const consentNote = document.getElementById("cs_note").value.trim();
  const consentObtainedAt = document.getElementById("cs_date").value || null;
  try {
    const d = await apiPatchCase(currentCaseId, { consentNote, consentObtainedAt });
    if (!d.ok) { toast(d.error || "저장 실패", "error"); return; }
    toast("동의 기록을 저장했습니다");
    closeConsentModal();
    if (currentDetail && currentDetail.case) {
      currentDetail.case.consentNote = consentNote;
      currentDetail.case.consentObtainedAt = consentObtainedAt;
      renderDetail(currentDetail);   // 헤더 표시 갱신(현재 탭 유지)
    }
  } catch (e) { if (e.message !== "auth") toast("저장 오류", "error"); }
}

// ── 확보 액션 추가/수정 모달 ─────────────────────────────────────────────────
let editingActionId = null;
function openActionModal(id) {
  editingActionId = id || null;
  const a = id ? caseActions.find(x => x.id === id) : null;
  document.getElementById("ac_item").value   = a ? (a.item || "") : "";
  document.getElementById("ac_detail").value = a ? (a.detail || "") : "";
  document.getElementById("ac_status").value = a ? (a.status || "todo") : "todo";
  document.getElementById("ac_due").value    = a && a.dueDate ? String(a.dueDate).slice(0, 10) : "";
  document.getElementById("actionModalTitle").textContent = id ? "액션 수정" : "확보 액션 추가";
  document.getElementById("actionModal").style.display = "flex";
}
function closeActionModal() { document.getElementById("actionModal").style.display = "none"; editingActionId = null; }
async function submitAction() {
  const item = document.getElementById("ac_item").value.trim();
  if (!item) { toast("내용을 입력해주세요", "error"); return; }
  const body = {
    item,
    detail: document.getElementById("ac_detail").value.trim(),
    status: document.getElementById("ac_status").value,
    dueDate: document.getElementById("ac_due").value || null,
  };
  const eid = editingActionId;
  if (eid) body.id = eid; else { body.caseId = currentCaseId; body.source = "manual"; }
  try {
    const d = await apiActionSave(body);
    if (!d.ok) { toast(d.error || "저장 실패", "error"); return; }
    if (eid) { const a = caseActions.find(x => x.id === eid); if (a) Object.assign(a, body); }
    else caseActions.push({ id: d.id || Date.now(), caseId: currentCaseId, source: "manual", ...body });
    toast("저장했습니다");
    closeActionModal();
    refreshActionsPanel();
  } catch (e) { if (e.message !== "auth") toast("저장 오류", "error"); }
}

// ── 기한 추가/수정 모달 (martyrdom_deadlines) ───────────────────────────────
let editingDeadlineId = null;
function openDeadlineItemModal(id) {
  editingDeadlineId = id || null;
  const d = id ? caseDeadlines.find(x => x.id === id) : null;
  document.getElementById("di_label").value = d ? (d.label || "") : "";
  document.getElementById("di_kind").value  = d ? (d.kind || "custom") : "custom";
  document.getElementById("di_due").value   = d && d.dueDate ? String(d.dueDate).slice(0, 10) : "";
  document.getElementById("di_note").value  = d ? (d.note || "") : "";
  document.getElementById("deadlineItemModalTitle").textContent = id ? "기한 수정" : "기한 추가";
  document.getElementById("deadlineItemModal").style.display = "flex";
}
function closeDeadlineItemModal() { document.getElementById("deadlineItemModal").style.display = "none"; editingDeadlineId = null; }
async function submitDeadlineItem() {
  const label = document.getElementById("di_label").value.trim();
  const dueDate = document.getElementById("di_due").value;
  if (!label) { toast("기한 설명을 입력해주세요", "error"); return; }
  if (!dueDate) { toast("기한일을 선택해주세요", "error"); return; }
  const body = { label, kind: document.getElementById("di_kind").value, dueDate, note: document.getElementById("di_note").value.trim() };
  const eid = editingDeadlineId;
  if (eid) body.id = eid; else body.caseId = currentCaseId;
  try {
    const res = await apiDeadlineSave(body);
    if (!res.ok) { toast(res.error || "저장 실패", "error"); return; }
    if (eid) { const d = caseDeadlines.find(x => x.id === eid); if (d) Object.assign(d, body); }
    else caseDeadlines.push({ id: res.id || Date.now(), caseId: currentCaseId, status: "pending", ...body });
    toast("기한을 저장했습니다");
    closeDeadlineItemModal();
    refreshDeadlinesPanel();
  } catch (e) { if (e.message !== "auth") toast("저장 오류", "error"); }
}

// ── G3 다중 사건 대시보드 ────────────────────────────────────────────────────
async function showDashboard() {
  currentCaseId = null; currentDetail = null;
  clearPollTimer();
  document.querySelectorAll(".case-item").forEach(el => el.classList.remove("active"));
  const pane = document.getElementById("detailPane");
  pane.innerHTML = '<div class="list-loading">현황 불러오는 중…</div>';
  try {
    const d = await apiDashboard();
    if (!d || !d.ok) { pane.innerHTML = '<div class="empty-detail"><div class="empty-icon">📊</div><div>현황을 불러오지 못했습니다</div></div>'; return; }
    renderDashboard(d, pane);
  } catch (e) {
    if (e.message !== "auth") pane.innerHTML = '<div class="empty-detail"><div class="empty-icon">📊</div><div>현황을 불러오지 못했습니다</div></div>';
  }
}
function renderDashboard(d, pane) {
  const cases   = d.cases   || (d.data && d.data.cases)   || [];
  const storage = d.storage || (d.data && d.data.storage) || {};
  const summary = d.summary || (d.data && d.data.summary) || {};
  const overGb = !!storage.overThreshold;
  const sorted = cases.slice().sort((a, b) => {
    const da = a.nextDeadlineAt ? new Date(a.nextDeadlineAt).getTime() : Infinity;
    const db = b.nextDeadlineAt ? new Date(b.nextDeadlineAt).getTime() : Infinity;
    return da - db;
  });
  pane.innerHTML = `<div class="dash-wrap">
    <div class="dash-head"><h2>📊 순직 인정 지원 — 현황</h2>
      <div class="dash-head-actions">
        <button class="btn-sm" onclick="showGlobalStats()">📊 통계</button>
        <button class="btn-sm" onclick="showGlobalPublications()">📚 발간</button>
        <button class="btn-sm btn-secondary" onclick="showDashboard()">새로고침</button>
      </div></div>
    <div class="dash-cards">
      <div class="dash-kpi"><div class="kpi-num">${summary.activeCount != null ? summary.activeCount : cases.length}</div><div class="kpi-lbl">진행 사건</div></div>
      <div class="dash-kpi ${summary.urgentCount ? "kpi-warn" : ""}"><div class="kpi-num">${summary.urgentCount || 0}</div><div class="kpi-lbl">기한 임박</div></div>
      <div class="dash-kpi"><div class="kpi-num">${summary.avgReadiness != null ? summary.avgReadiness + "%" : "-"}</div><div class="kpi-lbl">평균 준비도</div></div>
      <div class="dash-kpi ${overGb ? "kpi-danger" : ""}"><div class="kpi-num">${storage.usedGb != null ? storage.usedGb : "-"}<small>/${storage.limitGb || "-"}GB</small></div><div class="kpi-lbl">저장 용량${overGb ? " ⚠️" : ""}</div></div>
    </div>
    ${overGb ? `<div class="error-banner">⚠️ 저장 용량이 임계치를 초과했습니다. 백업 후 오래된 자료를 정리하세요.</div>` : ""}
    <table class="dash-table"><thead><tr><th>사건</th><th>상태</th><th>준비도</th><th>다음 기한</th><th>자료</th></tr></thead>
    <tbody>${sorted.map(c => {
      const cid = c.caseId != null ? c.caseId : c.id;
      const diff = c.nextDeadlineAt ? Math.ceil((new Date(c.nextDeadlineAt) - Date.now()) / 86400000) : null;
      const urgent = diff != null && diff <= 7;
      return `<tr onclick="selectCase(${cid})" style="cursor:pointer">
        <td><strong>${escapeHtml(c.title || c.caseNo || "")}</strong><div class="dash-cn">${escapeHtml(c.caseNo || "")}</div></td>
        <td><span class="badge status-badge">${STATUS_LABELS[c.status] || c.status || "-"}</span></td>
        <td>${c.readinessScore != null ? `<span class="dash-rd">${c.readinessScore}%</span>` : "-"}</td>
        <td>${c.nextDeadlineAt ? `${fmtDate(c.nextDeadlineAt)} <span class="dday-badge ${urgent ? "dl-urgent" : ""}">${dday(c.nextDeadlineAt)}</span>` : "-"}${c.nextDeadlineLabel ? `<div class="dash-cn">${escapeHtml(c.nextDeadlineLabel)}</div>` : ""}</td>
        <td>${c.docCount != null ? c.docCount : "-"}</td></tr>`;
    }).join("") || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">진행 사건이 없습니다</td></tr>'}</tbody></table>
  </div>`;
}

// ── P4: 전역 통계·발간 진입 (사건 선택 없이 — 여러 사건 종합 기능) ───────────
function clearGlobalView() {
  currentCaseId = null; currentDetail = null;
  clearPollTimer();
  document.querySelectorAll(".case-item").forEach(el => el.classList.remove("active"));
}
function showGlobalStats() {
  clearGlobalView();
  destroyStatsCharts();
  statsData = null;
  const pane = document.getElementById("detailPane");
  if (!pane) return;
  pane.innerHTML = `<div class="global-view">
    <div class="global-view-head">
      <h2>📊 인정률·성과 통계 — 전체 사건</h2>
      <button class="btn-sm btn-secondary" onclick="showDashboard()">← 현황</button>
    </div>
    ${renderTabStats()}
  </div>`;
  const panel = document.getElementById("tab-stats-panel");
  if (panel) panel.style.display = "";
  loadStats(true);
}
function showGlobalPublications() {
  clearGlobalView();
  clearPubPollTimer();
  pubDetail = null;
  const pane = document.getElementById("detailPane");
  if (!pane) return;
  pane.innerHTML = `<div class="global-view">
    <div class="global-view-head">
      <h2>📚 연구 발간 — 전체 사건 종합</h2>
      <button class="btn-sm btn-secondary" onclick="showDashboard()">← 현황</button>
    </div>
    ${renderTabPublications()}
  </div>`;
  const panel = document.getElementById("tab-publications-panel");
  if (panel) panel.style.display = "";
  loadPublications();
}

// ── 코퍼스 검색 (과거사례 + 법령) ───────────────────────────────────────────
function openCorpusModal() {
  document.getElementById("corpusModal").style.display = "flex";
  const inp = document.getElementById("corpusQuery"); if (inp) inp.focus();
}
function closeCorpusModal() { document.getElementById("corpusModal").style.display = "none"; }
function corpusKey(e) { if (e && e.key === "Enter") runCorpusSearch(); }
async function runCorpusSearch() {
  const q = document.getElementById("corpusQuery").value.trim();
  if (!q) { toast("검색어를 입력해주세요", "error"); return; }
  const res = document.getElementById("corpusResults");
  res.innerHTML = '<div class="list-loading">검색 중…</div>';
  try {
    const d = await apiCorpusSearch(q);
    const hits = (d && (d.hits || (d.data && d.data.hits) || d.results)) || [];
    if (!hits.length) { res.innerHTML = '<div class="empty-hint"><div class="eh-desc">결과가 없습니다.</div></div>'; return; }
    res.innerHTML = hits.map(r => `<div class="corpus-item">
      <div class="corpus-top"><strong>${escapeHtml(r.title || r.sourceRef || "")}</strong>
        <span class="corpus-type ${r.sourceType === "martyr_law" ? "ct-law" : "ct-case"}">${r.sourceType === "martyr_law" ? "법령" : (r.sourceType === "martyr_case" ? "사례" : (r.sourceType || ""))}</span></div>
      ${r.snippet ? `<div class="corpus-snip">${escapeHtml(r.snippet)}</div>` : ""}
      ${r.sourceRef ? `<div class="corpus-ref">${escapeHtml(r.sourceRef)}</div>` : ""}</div>`).join("");
  } catch (e) {
    if (e.message !== "auth") res.innerHTML = '<div class="empty-hint"><div class="eh-desc">검색 오류</div></div>';
  }
}

// ── 요건 master 관리 (조회 전체 · 편집 super_admin) ──────────────────────────
let _criteriaCache = [];
let editingCriteriaId = null;
function openCriteriaMaster() {
  document.getElementById("criteriaMasterModal").style.display = "flex";
  hideCriteriaForm();
  loadCriteriaMaster();
}
function closeCriteriaMaster() { document.getElementById("criteriaMasterModal").style.display = "none"; }
async function loadCriteriaMaster() {
  const body = document.getElementById("criteriaMasterList");
  body.innerHTML = '<div class="list-loading">불러오는 중…</div>';
  try {
    const d = await apiCriteriaList();
    _criteriaCache = (d && (d.criteria || (d.data && d.data.criteria) || d.items)) || [];
    renderCriteriaMasterList();
  } catch (e) {
    if (e.message !== "auth") body.innerHTML = '<div class="empty-hint"><div class="eh-desc">불러오기 오류</div></div>';
  }
}
function renderCriteriaMasterList() {
  const items = _criteriaCache;
  const canEdit = isSuperAdmin;
  const toolbar = document.getElementById("criteriaMasterTools");
  if (toolbar) {
    toolbar.innerHTML = canEdit
      ? `<button class="btn-sm" onclick="showCriteriaForm()">+ 요건 추가</button>
         <button class="btn-sm btn-secondary" onclick="generateCriteria()">⚙️ 법령에서 후보 생성</button>`
      : `<span class="cm-readonly">보기 전용 — 요건 편집은 슈퍼어드민만 가능합니다.</span>`;
  }
  const body = document.getElementById("criteriaMasterList");
  body.innerHTML = items.length ? items.map(it => `<div class="cm-row">
    <div class="cm-main">
      <div class="cm-title">${escapeHtml(it.title)}${it.category ? ` <span class="crit-cat">${escapeHtml(it.category)}</span>` : ""} <span class="tag">가중치 ${it.weight != null ? it.weight : "-"}</span>${it.active === false ? ' <span class="tag" style="color:#991b1b">비활성</span>' : ""}</div>
      <div class="cm-code">${escapeHtml(it.code || "")}${it.lawRef ? ` · ${escapeHtml(it.lawRef)}` : ""}</div>
      ${it.description ? `<div class="cm-desc">${escapeHtml(it.description)}</div>` : ""}
    </div>
    ${canEdit ? `<div class="cm-actions"><button class="btn-sm btn-secondary" onclick="editCriteria(${it.id})">수정</button><button class="btn-sm btn-danger" onclick="deleteCriteria(${it.id})">삭제</button></div>` : ""}
  </div>`).join("") : '<div class="empty-hint"><div class="eh-desc">요건이 없습니다.</div></div>';
}
function showCriteriaForm(id) {
  editingCriteriaId = id || null;
  const it = id ? _criteriaCache.find(x => x.id === id) : null;
  document.getElementById("cm_code").value     = it ? (it.code || "") : "";
  document.getElementById("cm_category").value = it ? (it.category || "") : "";
  document.getElementById("cm_title").value    = it ? (it.title || "") : "";
  document.getElementById("cm_weight").value   = it ? (it.weight != null ? it.weight : 1) : 1;
  document.getElementById("cm_lawref").value   = it ? (it.lawRef || "") : "";
  document.getElementById("cm_desc").value     = it ? (it.description || "") : "";
  document.getElementById("criteriaFormTitle").textContent = id ? "요건 수정" : "요건 추가";
  document.getElementById("criteriaForm").style.display = "block";
}
function hideCriteriaForm() {
  const f = document.getElementById("criteriaForm");
  if (f) f.style.display = "none";
  editingCriteriaId = null;
}
function editCriteria(id) { showCriteriaForm(id); }
async function submitCriteria() {
  const code = document.getElementById("cm_code").value.trim();
  const title = document.getElementById("cm_title").value.trim();
  if (!code || !title) { toast("코드·제목은 필수입니다", "error"); return; }
  const body = {
    code, title,
    category: document.getElementById("cm_category").value.trim(),
    weight: parseInt(document.getElementById("cm_weight").value, 10) || 1,
    lawRef: document.getElementById("cm_lawref").value.trim(),
    description: document.getElementById("cm_desc").value.trim(),
  };
  if (editingCriteriaId) body.id = editingCriteriaId;
  try {
    const d = await apiCriteriaSave(body);
    if (!d.ok) { toast(d.status === 403 ? "슈퍼어드민만 편집할 수 있습니다" : (d.error || "저장 실패"), "error"); return; }
    toast("요건을 저장했습니다");
    hideCriteriaForm();
    loadCriteriaMaster();
  } catch (e) { if (e.message !== "auth") toast("저장 오류", "error"); }
}
async function deleteCriteria(id) {
  if (!confirm("이 요건을 삭제할까요?")) return;
  try {
    const d = await apiCriteriaDelete(id);
    if (!d.ok) { toast(d.status === 403 ? "슈퍼어드민만 삭제할 수 있습니다" : (d.error || "삭제 실패"), "error"); return; }
    toast("요건을 삭제했습니다");
    loadCriteriaMaster();
  } catch (e) { if (e.message !== "auth") toast("삭제 오류", "error"); }
}
async function generateCriteria() {
  toast("법령에서 요건 후보를 분석 중…");
  try {
    const d = await apiCriteriaGenerate();
    if (!d.ok) { toast(d.status === 403 ? "슈퍼어드민 전용" : (d.error || "분석 실패"), "error"); return; }
    const n = ((d.candidates || (d.data && d.data.candidates)) || []).length;
    toast(`법령 파싱 완료 — 후보 ${n}건 (검토 후 반영)`);
    loadCriteriaMaster();
  } catch (e) { if (e.message !== "auth") toast("분석 오류", "error"); }
}

// ── P4: 유족 요약 핸들러 ─────────────────────────────────────────────────────
async function generateFamilySummary() {
  if (!currentCaseId) return;
  const btn = document.getElementById("familySummaryBtn");
  if (btn) { btn.textContent = "생성 중…"; btn.disabled = true; }
  try {
    const d = await apiP4FamilySummaryGenerate(currentCaseId);
    if (!d.ok) { toast(d.error || "요약 생성 실패", "error"); return; }
    familySummaryCache = (d.summary || d.data && d.data.summary) || null;
    toast("유족 전달용 요약을 생성했습니다");
    refreshDraft();
  } catch (e) {
    if (e.message !== "auth") toast("생성 오류", "error");
  } finally {
    const b = document.getElementById("familySummaryBtn");
    if (b) { b.textContent = familySummaryCache ? "다시 생성" : "요약 생성"; b.disabled = false; }
  }
}
function copyFamilySummary() {
  const fs = familySummaryCache;
  if (!fs) return;
  const steps = (fs.nextSteps || []).map((s, i) => (i + 1) + ". " + s).join("\n");
  const text = fs.contentText + (steps ? "\n\n다음 할 일:\n" + steps : "");
  navigator.clipboard && navigator.clipboard.writeText(text).then(() => toast("클립보드에 복사했습니다")).catch(() => toast("복사 실패", "error"));
}
function exportFamilySummaryPdf() {
  const fs = familySummaryCache;
  if (!fs) return;
  const steps = (fs.nextSteps || []).map(s => "<li>" + escapeHtml(s) + "</li>").join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>유족 전달 요약</title>
<style>body{font-family:sans-serif;padding:40px;max-width:600px;margin:auto;line-height:1.8}h1{font-size:20px}p{white-space:pre-wrap}ul{padding-left:20px}</style>
</head><body><h1>진행 상황 안내</h1><p>${escapeHtml(fs.contentText)}</p>${steps ? "<h2>다음 할 일</h2><ul>" + steps + "</ul>" : ""}</body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "유족전달요약.html"; a.click();
  URL.revokeObjectURL(url);
}

// ── P4: 통계 핸들러 ──────────────────────────────────────────────────────────
async function loadStats(force) {
  if (statsData && !force) return;
  const body = document.getElementById("statsBody");
  if (body) body.innerHTML = '<div class="list-loading">집계 중…</div>';
  destroyStatsCharts();
  try {
    const d = await apiP4Stats();
    if (!d.ok) { if (body) body.innerHTML = '<div class="empty-hint"><div class="eh-desc">통계 불러오기 실패</div></div>'; return; }
    statsData = d;
    renderStatsBody(d);
  } catch (e) {
    if (e.message !== "auth") { const b2 = document.getElementById("statsBody"); if (b2) b2.innerHTML = '<div class="empty-hint"><div class="eh-desc">네트워크 오류</div></div>'; }
  }
}
function destroyStatsCharts() {
  Object.values(statsCharts).forEach(c => { try { c.destroy(); } catch (_) {} });
  statsCharts = {};
}
function renderStatsBody(d) {
  const body = document.getElementById("statsBody");
  if (!body) return;
  const tot = d.totals || {};
  const rate = d.recognitionRate != null ? Math.round(d.recognitionRate * 100) : 0;
  const byCaseType = d.byCaseType || [];
  const trend = d.trend || [];
  const readinessDist = d.readinessDist || [];
  const byStatus = d.byStatus || [];

  const typeLabels = { overwork: "과로", harassment: "괴롭힘", accident: "사고/질병", other: "기타" };
  const statusLabels = { intake: "접수", collecting: "수집", analyzing: "분석", drafting: "서면", submitted: "청구", closed: "종결", analysis: "분석", hearing: "심의" };

  body.innerHTML = `
  <div class="stats-summary-row">
    <div class="stats-kpi"><div class="kpi-val">${tot.cases || 0}</div><div class="kpi-label">전체 사건</div></div>
    <div class="stats-kpi"><div class="kpi-val kpi-green">${tot.approved || 0}</div><div class="kpi-label">인정</div></div>
    <div class="stats-kpi"><div class="kpi-val kpi-red">${tot.rejected || 0}</div><div class="kpi-label">불인정</div></div>
    <div class="stats-kpi"><div class="kpi-val">${tot.pending || 0}</div><div class="kpi-label">진행 중</div></div>
    <div class="stats-kpi"><div class="kpi-val kpi-blue">${rate}%</div><div class="kpi-label" title="종결 사건 대비 인정 비율">인정률(종결)</div></div>
  </div>
  <div class="stats-grid">
    <div class="stats-card"><div class="sc-title">인정률 (도넛)</div><canvas id="chartDonut" height="200"></canvas></div>
    <div class="stats-card"><div class="sc-title">유형별 인정 현황 (막대)</div><canvas id="chartBar" height="200"></canvas></div>
    <div class="stats-card"><div class="sc-title">월별 인정 추이 (선)</div><canvas id="chartLine" height="200"></canvas></div>
    <div class="stats-card"><div class="sc-title">준비도 분포</div><canvas id="chartReadiness" height="200"></canvas></div>
  </div>`;

  if (!window.Chart) return;
  // 도넛: 인정/불인정/진행 중
  statsCharts.donut = new Chart(document.getElementById("chartDonut"), {
    type: "doughnut",
    data: { labels: ["인정", "불인정", "진행 중"],
      datasets: [{ data: [tot.approved || 0, tot.rejected || 0, tot.pending || 0],
        backgroundColor: ["#22c55e", "#ef4444", "#94a3b8"] }] },
    options: { plugins: { legend: { position: "bottom" } }, cutout: "65%" },
  });
  // 막대: 유형별 전체/인정
  statsCharts.bar = new Chart(document.getElementById("chartBar"), {
    type: "bar",
    data: { labels: byCaseType.map(x => typeLabels[x.type] || x.type),
      datasets: [
        { label: "전체", data: byCaseType.map(x => x.total), backgroundColor: "#93c5fd" },
        { label: "인정", data: byCaseType.map(x => x.approved), backgroundColor: "#22c55e" },
      ] },
    options: { plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
  // 선: 월별 인정 추이
  statsCharts.line = new Chart(document.getElementById("chartLine"), {
    type: "line",
    data: { labels: trend.map(x => x.month),
      datasets: [{ label: "인정 건수", data: trend.map(x => x.approved),
        borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.1)", tension: 0.3, fill: true }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
  // 준비도 분포 막대 (readinessDist 또는 byStatus fallback)
  const distData = readinessDist.length ? readinessDist : byStatus.map(x => ({ range: statusLabels[x.status] || x.status, count: x.count }));
  statsCharts.readiness = new Chart(document.getElementById("chartReadiness"), {
    type: "bar",
    data: { labels: distData.map(x => x.range),
      datasets: [{ label: "건수", data: distData.map(x => x.count), backgroundColor: "#7c3aed" }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
}

// ── P4: 발간 핸들러 ──────────────────────────────────────────────────────────
function clearPubPollTimer() {
  if (pubPollTimer) { clearInterval(pubPollTimer); pubPollTimer = null; }
}
function updateBlendLabel(val) {
  const el = document.getElementById("blendLabel");
  if (el) el.textContent = "자체 " + val + " : AI " + (100 - val);
}
async function generatePublication() {
  const typeEl = document.getElementById("pubTypeSelect");
  const maskEl = document.getElementById("maskLevelSelect");
  const sliderEl = document.getElementById("blendSlider");
  if (!typeEl) return;
  const pubType = typeEl.value;
  const maskLevel = maskEl ? maskEl.value : "light";
  const selfRatio = sliderEl ? parseInt(sliderEl.value, 10) : 70;
  const blendRatio = { self: selfRatio, ai: 100 - selfRatio };

  // ★ R41 Q2-052: 연타로 인한 중복 draft 생성 방지 — 진행 중이면 무시
  if (pubGenBusy) return;
  pubGenBusy = true;
  const btn = document.getElementById("pubGenBtn");
  if (btn) { btn.textContent = "생성 중…"; btn.disabled = true; }
  let pollingStarted = false;   // 폴링으로 넘어가면 폴링 종료 시점까지 버튼 유지
  try {
    const d = await apiP4PublicationGenerate(pubType, blendRatio, maskLevel);
    if (!d.ok) { toast(d.error || "생성 요청 실패", "error"); return; }
    const pubId = d.id || (d.data && d.data.id);
    if (d.queued && pubId) {
      // 시크릿 미설정 등 백그라운드 생성 불가 가시화
      const bg = d.bgStatus != null ? d.bgStatus : (d.data && d.data.bgStatus);
      if (bg === "secret_missing") {
        toast("발간물 초안만 생성됨 — 본문 자동 생성이 비활성화되어 있습니다(관리자 설정 필요)", "warning");
        loadPublications();
        return;   // 폴링 불필요 — finally에서 버튼 복구
      }
      toast("발간물 생성 요청 — 완료되면 목록에 표시됩니다");
      pollingStarted = true;
      pollPublicationGenerated(pubId);   // 버튼 복구는 폴링 종료(finishPubGen)에서
    } else {
      toast("발간물을 생성했습니다");
      loadPublications();
    }
  } catch (e) {
    if (e.message !== "auth") toast("생성 오류", "error");
  } finally {
    // 폴링이 시작되지 않은 경우에만 즉시 복구. 폴링 중이면 finishPubGen()이 복구.
    if (!pollingStarted) finishPubGen();
  }
}
// 발간 생성 버튼·진행 플래그 복구 (즉시 종료·폴링 완료·폴링 타임아웃 공통)
function finishPubGen() {
  pubGenBusy = false;
  const b = document.getElementById("pubGenBtn");
  if (b) { b.textContent = "발간물 생성"; b.disabled = false; }
}
function pollPublicationGenerated(pubId) {
  clearPubPollTimer();
  let tries = 0;
  pubPollTimer = setInterval(async () => {
    tries++;
    if (tries > 30) { clearPubPollTimer(); finishPubGen(); toast("생성이 지연되고 있습니다 — 잠시 후 목록을 확인하세요", "warning"); return; }
    try {
      const d = await apiP4PublicationGet(pubId);
      if (d.ok && d.publication && d.publication.contentHtml) {
        clearPubPollTimer();
        finishPubGen();   // 폴링 완료 시 버튼 복구
        pubDetail = d.publication;
        loadPublications();
        showPublicationDetail(pubId);
        toast("발간물 생성 완료");
      }
    } catch (_) {}
  }, 4000);
}
async function loadPublications() {
  const body = document.getElementById("pubListBody");
  if (!body) return;
  try {
    const d = await apiP4PublicationList();
    if (!d.ok) { body.innerHTML = '<div class="empty-hint"><div class="eh-desc">목록 불러오기 실패</div></div>'; return; }
    pubList = (d.publications || d.data && d.data.publications) || [];
    canPubWrite = (typeof d.canWrite === "boolean") ? d.canWrite : isAdmin;   // 서버 권한 정책 반영(없으면 isAdmin 폴백)
    applyPubWriteVisibility();
    renderPubList();
  } catch (e) {
    if (e.message !== "auth") { const b2 = document.getElementById("pubListBody"); if (b2) b2.innerHTML = '<div class="empty-hint"><div class="eh-desc">네트워크 오류</div></div>'; }
  }
}
// 발간 쓰기 권한에 따라 생성 폼/조회 전용 안내 표시 토글 (권한 정책 반영)
function applyPubWriteVisibility() {
  const stage = document.getElementById("pubCreateStage");
  const hint  = document.getElementById("pubReadonlyHint");
  if (stage) stage.style.display = canPubWrite ? "" : "none";
  if (hint)  hint.style.display  = canPubWrite ? "none" : "";
}
const PUB_TYPE_LABELS = { guide: "종합 가이드", trend: "동향 보고서", case_study: "사례 연구" };
const PUB_STATUS_LABELS = { draft: "초안", reviewed: "검수 완료", published: "발간됨" };
const PUB_STATUS_CLS = { draft: "rv-pending", reviewed: "rv-changes", published: "rv-approved" };
function renderPubList() {
  const body = document.getElementById("pubListBody");
  if (!body) return;
  if (!pubList.length) { body.innerHTML = '<div class="empty-hint"><div class="eh-desc">발간물이 없습니다. 위 폼에서 생성하세요.</div></div>'; return; }
  body.innerHTML = pubList.map(p => {
    const st = PUB_STATUS_LABELS[p.status] || p.status;
    const cls = PUB_STATUS_CLS[p.status] || "rv-pending";
    return `<div class="pub-item">
      <div class="pi-main">
        <div class="pi-title">${escapeHtml(p.title || "제목 생성 중…")}</div>
        <div class="pi-meta">${PUB_TYPE_LABELS[p.pubType] || p.pubType || "–"} · ${fmtDate(p.createdAt)}</div>
      </div>
      <div class="pi-right">
        <span class="rv-badge ${cls}">${st}</span>
        <button class="btn-xs" onclick="showPublicationDetail(${p.id})">상세</button>
        ${canPubWrite ? `<button class="btn-xs btn-danger" onclick="deletePublication(${p.id})">삭제</button>` : ""}
      </div>
    </div>`;
  }).join("");
}
async function showPublicationDetail(id) {
  const d = await apiP4PublicationGet(id);
  if (!d.ok || !d.publication) { toast("상세 불러오기 실패", "error"); return; }
  pubDetail = d.publication;
  const sec = document.getElementById("pubDetailSection");
  const body = document.getElementById("pubDetailBody");
  if (!sec || !body) return;
  sec.style.display = "";
  const p = d.publication;
  const reidCls = { low: "rv-approved", medium: "rv-changes", high: "rv-pending" }[p.reidRisk] || "rv-pending";
  const reidLabel = { low: "재식별 위험 낮음", medium: "위험 보통", high: "⚠️ 위험 높음" }[p.reidRisk] || p.reidRisk;
  body.innerHTML = `
    <div class="pub-detail-meta">
      <span class="rv-badge ${PUB_STATUS_CLS[p.status] || "rv-pending"}">${PUB_STATUS_LABELS[p.status] || p.status}</span>
      <span class="rv-badge ${reidCls}">${reidLabel}</span>
      ${p.blendRatio ? `<span class="blend-tag">자체 ${p.blendRatio.self}:AI ${p.blendRatio.ai}</span>` : ""}
      ${p.anonymized ? `<span class="blend-tag">비식별화 적용</span>` : ""}
    </div>
    <div class="pub-preview">${p.contentHtml || "<p>(본문 생성 중…)</p>"}</div>
    ${renderPubActions(p)}`;
  sec.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderPubActions(p) {
  const canReview  = canPubWrite && p.status === "draft";      // 검수: 발간 쓰기 권한자
  const canPublish = canPubWrite && p.status === "reviewed";   // 발간 확정: 발간 쓰기 권한자
  return `<div class="pub-actions">
    ${canReview  ? `<button class="btn-sm" onclick="reviewPublication(${p.id})">✅ 검수 완료</button>` : ""}
    ${canPublish ? `<button class="btn-sm" onclick="publishPublication(${p.id})">📢 발간 확정</button>` : ""}
    <button class="btn-sm btn-secondary" onclick="exportPublication(${p.id},'pdf')">📄 PDF</button>
    <button class="btn-sm btn-secondary" onclick="exportPublication(${p.id},'html')">🌐 HTML</button>
  </div>`;
}
async function reviewPublication(id) {
  try {
    const d = await apiP4PublicationPatch(id, { status: "reviewed" });
    if (!d.ok) { toast(d.error || "검수 실패", "error"); return; }
    toast("검수 완료로 변경했습니다");
    showPublicationDetail(id);
    renderPubList();
  } catch (e) { if (e.message !== "auth") toast("오류", "error"); }
}
async function publishPublication(id) {
  if (!confirm("발간을 확정하면 외부 배포 준비 상태가 됩니다. 내용을 최종 확인하셨나요?")) return;
  try {
    const d = await apiP4PublicationPatch(id, { status: "published" });
    if (!d.ok) { toast(d.error || "발간 실패", "error"); return; }
    toast("발간 확정했습니다");
    showPublicationDetail(id);
    renderPubList();
  } catch (e) { if (e.message !== "auth") toast("오류", "error"); }
}
async function exportPublication(id, format) {
  try {
    const d = await apiP4PublicationExport(id, format);
    if (!d.ok) { toast(d.error || "내보내기 실패", "error"); return; }
    const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: d.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = d.fileName || ("발간물." + format); a.click();
    URL.revokeObjectURL(url);
    toast("다운로드 시작");
  } catch (e) { if (e.message !== "auth") toast("내보내기 오류", "error"); }
}
async function deletePublication(id) {
  if (!confirm("이 발간물을 삭제할까요?")) return;
  try {
    const d = await apiP4PublicationDelete(id);
    if (!d.ok) { toast(d.error || "삭제 실패", "error"); return; }
    toast("발간물을 삭제했습니다");
    if (pubDetail && pubDetail.id === id) closePubDetail();
    loadPublications();
  } catch (e) { if (e.message !== "auth") toast("삭제 오류", "error"); }
}
function closePubDetail() {
  const sec = document.getElementById("pubDetailSection");
  if (sec) sec.style.display = "none";
  pubDetail = null;
}

// ── 종류 토글 (지원대상 / 과거사례) ────────────────────────────────────────
function setKindToggle(kind) {
  currentKind = kind;
  document.querySelectorAll(".kind-btn").forEach(b => b.classList.toggle("active", b.dataset.kind === kind));
}

// ── 초기화 ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await detectRole();   // 권한(super_admin·admin·operator) 확정 후 첫 렌더 — 발간 탭·버튼 노출 정합(레이스 방지)
  loadCases();
  showDashboard();      // 랜딩: G3 현황 대시보드
});
