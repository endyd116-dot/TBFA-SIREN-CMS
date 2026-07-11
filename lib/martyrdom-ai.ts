/**
 * lib/martyrdom-ai.ts — 순직 인정 지원 AI 헬퍼
 *
 * exports:
 *   MARTYRDOM_DOC_TYPES  — 8대분류 code↔라벨 맵 (프론트와 공유)
 *   classifyDocument     — 8대분류 자동 판정 + 한줄요약 + 확신도
 *   extractCaseStructure — 사건 구조 JSON 추출 (§2.5 스키마)
 *
 * 의존: callGemini·callGeminiJSON (기존 gemini 래퍼)·searchRag (RAG 검색)
 */
import { callGemini, callGeminiJSON } from "./ai-gemini";
import { searchRag, RagHit, embedText } from "./ai-embedding";
import { db } from "../db";
import { sql } from "drizzle-orm";

/* =========================================================
   8대분류 마스터 (프론트·백 공유 — §1.5)
   ========================================================= */
export const MARTYRDOM_DOC_TYPES: Record<string, { label: string; description: string }> = {
  application:   { label: "신청·행정 서류",      description: "순직유족급여청구서·인사혁신처 제출·행정 결정문" },
  work_record:   { label: "근무·인사 기록",       description: "근무시간·초과근무·업무분장·복무/인사기록" },
  duty_stress:   { label: "직무 스트레스·괴롭힘", description: "악성 민원·학부모 항의·협박 메신저·고인 카톡 토로" },
  medical:       { label: "의학·심리 소견",       description: "심리부검·진단서·정신건강 진료기록·사망진단서" },
  investigation: { label: "수사·공적 조사",       description: "경찰·검찰·노동청·교육청 감사 기록" },
  statement:     { label: "진술·증언·유족 정리",  description: "진술서·탄원서·동료 증언·유족이 1차 정리한 사건 개요" },
  death_scene:   { label: "사망 정황·현장",       description: "사망 경위서·유서·현장 사진·CCTV" },
  other:         { label: "기타·참고",            description: "개인 일기·메모·언론 보도·분류 애매" },
};

/* =========================================================
   자료 자동 분류 (§1.5·§2.1)
   ========================================================= */
export interface ClassifyResult {
  docType: string;      // MARTYRDOM_DOC_TYPES 키
  summary: string;      // 한 줄 요약 (50자 내외)
  confidence: number;   // 0~100
  evidenceStrength: string; // 증거 강도 strong|medium|weak (§P2.0 #8 — 분류와 동시 1콜 판정)
}

const EVIDENCE_STRENGTH_KEYS = ["strong", "medium", "weak"];
function normEvidenceStrength(v: any): string {
  const s = String(v || "").toLowerCase();
  if (EVIDENCE_STRENGTH_KEYS.includes(s)) return s;
  if (s.includes("강")) return "strong";
  if (s.includes("약")) return "weak";
  return "medium";
}

const DOC_TYPE_KEYS = Object.keys(MARTYRDOM_DOC_TYPES);
const DOC_TYPE_LIST = DOC_TYPE_KEYS
  .map(k => `${k}: ${MARTYRDOM_DOC_TYPES[k].label} — ${MARTYRDOM_DOC_TYPES[k].description}`)
  .join("\n");

/**
 * 텍스트 또는 이미지를 8대분류로 자동 판정
 * - 텍스트형: text 파라미터 사용 (callGeminiJSON)
 * - 이미지형: imageBase64 + mimeType 사용 (callGemini Vision)
 */
export async function classifyDocument({
  text,
  imageBase64,
  mimeType,
  fileName,
}: {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
}): Promise<ClassifyResult> {
  const fallback: ClassifyResult = { docType: "other", summary: "(분류 실패)", confidence: 0, evidenceStrength: "medium" };

  const systemPrompt = `당신은 교사 순직 인정 지원 시스템의 자료 분류 전문가입니다.
업로드된 자료를 다음 8대분류 중 하나로 판정하고, 한 줄 요약·확신도·증거 강도를 반환합니다.

분류 목록:
${DOC_TYPE_LIST}

증거 강도(evidenceStrength) 판정 기준:
- "strong": 공문서·수사기록·진단서·심리부검 등 객관적·공적 증거력이 강한 자료
- "medium": 진술서·근무기록·이메일 등 보강이 필요하나 의미 있는 자료
- "weak": 개인 메모·일기·맥락 불명 캡처 등 단독 증거력이 약한 자료

응답 형식 (JSON만):
{
  "docType": "<code>",
  "summary": "<자료 핵심 내용 한 줄, 50자 이내>",
  "confidence": <0~100 정수>,
  "evidenceStrength": "strong|medium|weak"
}`;

  /* ── 이미지형: Gemini Vision ── */
  if (imageBase64 && mimeType) {
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const prompt = `${systemPrompt}

이 이미지/파일을 보고 8대분류 중 하나로 판정하세요.
파일명: ${fileName || ""}
JSON만 응답하세요.`;

    const result = await callGemini(prompt, {
      mode: "pro",
      featureKey: "martyrdom_ai",
      inlineFiles: [{ data: cleanBase64, mimeType }],
      maxOutputTokens: 1536, // 설명 섞여도 JSON 안 잘리게(512→1536)
      timeoutMs: 90000, // background Vision 분류 — 8초 기본은 짧음
      internalBulk: true, // 일괄 처리 자기차단(surge) 방지
    });

    if (!result.ok || !result.text) {
      return { docType: "other", summary: `(분류 실패: ${String(result.error || "응답 없음").slice(0, 80)})`, confidence: 0, evidenceStrength: "medium" };
    }
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        docType: DOC_TYPE_KEYS.includes(parsed.docType) ? parsed.docType : "other",
        summary: String(parsed.summary || "").slice(0, 200),
        confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
        evidenceStrength: normEvidenceStrength(parsed.evidenceStrength),
      };
    } catch { return fallback; }
  }

  /* ── 텍스트형: callGeminiJSON ── */
  if (!text || text.length < 5) {
    return { docType: "other", summary: "(텍스트 없음)", confidence: 0, evidenceStrength: "medium" };
  }

  const truncated = text.slice(0, 4000); // 분류용 입력 최대 4000자
  const userPrompt = `파일명: ${fileName || ""}\n\n자료 내용 (일부):\n${truncated}\n\nJSON만 응답하세요.`;

  const parsed = await callGeminiJSON<ClassifyResult>(
    `${systemPrompt}\n\n${userPrompt}`,
    {
      mode: "flash",
      featureKey: "martyrdom_ai",
      maxOutputTokens: 1536, // 설명 섞여도 JSON 안 잘리게(512→1536)
      timeoutMs: 30000, // background 텍스트 분류 — 8초 기본 상향
      internalBulk: true, // 일괄 처리 자기차단(surge) 방지
    }
  );

  if (!parsed.ok || !parsed.data) {
    return { docType: "other", summary: `(분류 실패: ${String(parsed.error || "응답 없음").slice(0, 80)})`, confidence: 0, evidenceStrength: "medium" };
  }
  const d = parsed.data;
  return {
    docType: DOC_TYPE_KEYS.includes(d.docType) ? d.docType : "other",
    summary: String(d.summary || "").slice(0, 200),
    confidence: Math.min(100, Math.max(0, Number(d.confidence) || 0)),
    evidenceStrength: normEvidenceStrength((d as any).evidenceStrength),
  };
}

/* =========================================================
   사건 구조 추출 (§2.5 ExtractionResult)
   ========================================================= */
export interface CausalLink {
  factor: string;
  link: string;
  evidence: string;
}
export interface TimelineEvent {
  date: string;
  event: string;
  source?: string;
}
export interface RecognitionPattern {
  outcome: "approved" | "rejected" | null;
  decisiveEvidence: string[];
  winningLogic: string;
  rejectionReason: string | null;
}
export interface ExtractionResult {
  deceased: { name: string; school: string; position: string; servicePeriod: string; deceasedAt: string };
  death: { cause: string; place: string; datetime: string };
  dutyRelevance: { overwork: string; harassment: string; stress: string; narrative: string };
  medicalCausation: { psychAutopsy: string; diagnosis: string; opinion: string };
  causalChain: CausalLink[];
  timeline: TimelineEvent[];
  evidenceHave: string[];
  evidenceMissing: string[];
  keyIssues: string[];
  caseType: string;
  confidence: number;
  recognitionPattern?: RecognitionPattern;
}

interface DocSummary {
  docType: string;
  summary: string;
  extractedText?: string;
  fileName: string;
}

/**
 * 사건 자료들 → 사건 구조 JSON 추출
 * 대용량 사건: within-case RAG(martyr_active·이 caseId)로 항목별 관련 대목 retrieve 후 추출
 */
export async function extractCaseStructure(
  caseId: number,
  docs: DocSummary[],
  caseKind?: string,
): Promise<ExtractionResult> {
  const empty: ExtractionResult = {
    deceased: { name: "", school: "", position: "", servicePeriod: "", deceasedAt: "" },
    death: { cause: "", place: "", datetime: "" },
    dutyRelevance: { overwork: "", harassment: "", stress: "", narrative: "" },
    medicalCausation: { psychAutopsy: "", diagnosis: "", opinion: "" },
    causalChain: [],
    timeline: [],
    evidenceHave: [],
    evidenceMissing: [],
    keyIssues: [],
    caseType: "unknown",
    confidence: 0,
  };

  /* 전체 텍스트 합산 */
  const allText = docs
    .filter(d => d.extractedText && d.extractedText.length > 10)
    .map(d => `[${MARTYRDOM_DOC_TYPES[d.docType]?.label || d.docType}] ${d.fileName}\n${d.extractedText!.slice(0, 3000)}`)
    .join("\n\n---\n\n");

  if (!allText) return { ...empty, confidence: 0 };

  /* 자료 총량이 많으면(30,000자+) RAG로 항목별 retrieve */
  let ragContext = "";
  if (allText.length > 30000) {
    const queries = [
      "고인 이름 학교 직위 사망일",
      "사망 원인 장소 경위",
      "초과근무 악성민원 직무 스트레스",
      "심리부검 진단서 의학 소견",
      "증거 자료 확보 부족",
    ];
    const hits: RagHit[] = [];
    for (const q of queries) {
      const r = await searchRag(q, 3, ["martyr_active"], caseId);
      hits.push(...r);
    }
    /* 중복 제거 */
    const seen = new Set<number>();
    const unique = hits.filter(h => { if (seen.has(h.id)) return false; seen.add(h.id); return true; });
    if (unique.length > 0) {
      ragContext = "\n\n[RAG 검색 — 관련 대목]\n" +
        unique.map(h => `출처: ${h.title || h.sourceRef}\n${h.content.slice(0, 600)}`).join("\n\n---\n");
    }
  }

  /* recognitionPattern(인정/불인정 패턴)은 과거 학습사례(reference)에서만 추출(§2.5).
     caseKind 미전달 시(레거시 호출) 기존 휴리스틱(신청서 보유)으로 폴백. */
  const isReference = caseKind ? caseKind === "reference" : docs.some(d => d.docType === "application");
  const recognitionPatternSection = isReference
    ? `
  "recognitionPattern": {
    "outcome": "approved 또는 rejected 또는 null",
    "decisiveEvidence": ["결정적 증거 목록"],
    "winningLogic": "인정된 핵심 논리",
    "rejectionReason": "불인정 이유 또는 null"
  },` : "";

  const systemPrompt = `당신은 교사 순직 인정 지원 전문가입니다. 업로드된 자료들을 분석해 사건 구조를 JSON으로 추출합니다.

규칙:
- 자료에서 명확히 드러난 사실만 기술 (추측 금지)
- 없는 정보는 빈 문자열 ""로
- evidenceMissing: 인정에 중요하지만 자료에 없는 항목
- caseType: "overwork(과로)"·"harassment(괴롭힘)"·"accident(사고)"·"disease(질병)"·"mixed(복합)" 중 1
- confidence: 0.0~1.0 (자료 충분도)
- 응답은 JSON만

JSON 스키마:
{
  "deceased": { "name":"", "school":"", "position":"", "servicePeriod":"", "deceasedAt":"" },
  "death": { "cause":"", "place":"", "datetime":"" },
  "dutyRelevance": { "overwork":"", "harassment":"", "stress":"", "narrative":"" },
  "medicalCausation": { "psychAutopsy":"", "diagnosis":"", "opinion":"" },
  "causalChain": [{ "factor":"", "link":"", "evidence":"" }],
  "timeline": [{ "date":"", "event":"", "source":"" }],
  "evidenceHave": [],
  "evidenceMissing": [],
  "keyIssues": [],
  "caseType": "",
  "confidence": 0.0${recognitionPatternSection}
}`;

  /* 입력 텍스트 최대 20,000자 */
  const inputText = (allText.slice(0, 20000) + ragContext).slice(0, 22000);

  const result = await callGeminiJSON<ExtractionResult>(
    `${systemPrompt}\n\n[자료]\n${inputText}`,
    {
      mode: "pro",
      featureKey: "martyrdom_ai",
      maxOutputTokens: 4096,
      timeoutMs: 120000, // background 사건 구조 추출(대용량 입력·4096 출력) — 8초 기본 상향
      internalBulk: true, // 일괄 처리 자기차단(surge) 방지
    }
  );

  if (!result.ok || !result.data) return { ...empty, confidence: 0 };

  const d = result.data;
  return {
    deceased: d.deceased || empty.deceased,
    death: d.death || empty.death,
    dutyRelevance: d.dutyRelevance || empty.dutyRelevance,
    medicalCausation: d.medicalCausation || empty.medicalCausation,
    causalChain: Array.isArray(d.causalChain) ? d.causalChain : [],
    timeline: Array.isArray(d.timeline) ? d.timeline : [],
    evidenceHave: Array.isArray(d.evidenceHave) ? d.evidenceHave : [],
    evidenceMissing: Array.isArray(d.evidenceMissing) ? d.evidenceMissing : [],
    keyIssues: Array.isArray(d.keyIssues) ? d.keyIssues : [],
    caseType: String(d.caseType || "unknown"),
    confidence: Math.min(1, Math.max(0, Number(d.confidence) || 0)),
    recognitionPattern: d.recognitionPattern,
  };
}

/* =========================================================
   P2 — 분석·요건·준비도·학습 (§P2.2 계약 키 고정)
   응답 JSON 키는 §P2.2 계약과 1:1(A mock 동일). 1글자도 변경 금지.
   모든 AI 호출: featureKey 'martyrdom_ai' · internalBulk true · timeoutMs 넉넉히 · 정량 % 금지.
   ========================================================= */

/* ── 공통 타입 (contentJson 계약) ── */
export interface RagSourceRef { title: string; sourceRef: string; snippet: string; }
export interface StrategyJson {
  possibleLogics: Array<{ title: string; reasoning: string; strength: string }>;   // strength: 강|중|약
  missingEvidence: string[];
  keyIssues: string[];
  causalChain: Array<{ factor: string; link: string; evidence: string }>;
  similarCases: Array<{ ref: string; outcome: string; match: string; diff: string }>;
  counterArguments: Array<{ argument: string; rebuttal: string; basis: string }>;   // ⑪
  conflicts: Array<{ severity: string; desc: string; sources: string[] }>;          // ⑨ severity: 치명|주의
  masterTimeline: Array<{ date: string; event: string; source: string; gap: boolean }>; // ⑩
  ragSources: RagSourceRef[];
}
export interface CriteriaCheckJson {
  items: Array<{ code: string; category: string; title: string; status: string; evidence: string; ragSources: RagSourceRef[] }>;
  metCount: number;
  totalCount: number;
}
export interface ReadinessJson {
  score: number;
  breakdown: { criteria: number; evidence: number; timeline: number; conflicts: number };
  max: { criteria: number; evidence: number; timeline: number; conflicts: number };
  gaps: Array<{ label: string; plus: number }>;
  aiNote: string;
  label: string;
}
export interface GoldenJson {
  items: Array<{ channel: string; label: string; guidance: string; volatility: string; priority: number; caseFit: string }>;
}
export interface GenResult<T> { contentJson: T; ragSources: RagSourceRef[]; modelUsed: string; }

const MODEL_PRO = () => process.env.GEMINI_MODEL_PRO || "gemini-3-flash";
function asArr(v: any): any[] { return Array.isArray(v) ? v : []; }
function s(v: any, max = 500): string { return String(v ?? "").slice(0, max); }
function ragToRefs(hits: RagHit[]): RagSourceRef[] {
  return hits.map(h => ({ title: h.title || h.sourceRef, sourceRef: h.sourceRef, snippet: (h.content || "").slice(0, 200) }));
}

/* 사건 추출 구조 로드 (raw SQL·schema 격리) */
async function loadExtraction(caseId: number): Promise<ExtractionResult | null> {
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT extraction_json AS "extractionJson" FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
    `));
    const row = (r?.rows ?? r ?? [])[0];
    if (!row || !row.extractionJson) return null;
    return typeof row.extractionJson === "string" ? JSON.parse(row.extractionJson) : row.extractionJson;
  } catch { return null; }
}

/* 최신 ai_outputs(type) contentJson 로드 */
async function loadLatestOutput(caseId: number, outputType: string): Promise<any | null> {
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT content_json AS "contentJson" FROM martyrdom_ai_outputs
      WHERE case_id = ${caseId} AND output_type = '${outputType}'
      ORDER BY version DESC LIMIT 1
    `));
    const row = (r?.rows ?? r ?? [])[0];
    if (!row || !row.contentJson) return null;
    return typeof row.contentJson === "string" ? JSON.parse(row.contentJson) : row.contentJson;
  } catch { return null; }
}

/* =========================================================
   analyzeStrategy — ③전략 + ⑨모순 + ⑩타임라인 + ⑪반론 (1콜 통합·§P2.2)
   RAG: martyr_case + martyr_law (진행사건 격리·active 미포함·§2.8)
   ========================================================= */
export async function analyzeStrategy(caseId: number, caseKind?: string): Promise<GenResult<StrategyJson>> {
  const ex = await loadExtraction(caseId);

  /* 다중 쿼리 RAG (과거 인정/불인정 사례 + 법령) */
  const queries: string[] = [
    "공무 수행 중 사망 상당인과관계 순직 인정 요건",
    "교사 악성민원 직무 스트레스 정신질환 순직 인정 사례",
    "과로 장시간근무 공무상 재해 인정",
  ];
  if (ex) {
    for (const k of asArr(ex.keyIssues).slice(0, 2)) queries.push(`${s(k, 100)} 순직 인정`);
    if (ex.caseType && ex.caseType !== "unknown") queries.push(`${ex.caseType} 교사 순직 인정 판례`);
  }

  const seen = new Set<number>();
  const hits: RagHit[] = [];
  for (const q of queries.slice(0, 6)) {
    const r = await searchRag(q, 4, ["martyr_case", "martyr_law"], caseId);
    for (const h of r) { if (!seen.has(h.id)) { seen.add(h.id); hits.push(h); } }
    if (hits.length >= 12) break;
  }
  const topHits = hits.slice(0, 10);
  const grounding = topHits.length
    ? topHits.map((h, i) => `[근거${i + 1}] ${h.title || h.sourceRef} (${h.sourceType})\n${(h.content || "").slice(0, 700)}`).join("\n\n")
    : "(검색된 과거 사례·법령 근거 없음 — 일반 지식으로 보강하되 단정 금지)";

  const systemPrompt = `당신은 교사 순직 인정 지원 전문가입니다. 사건 구조와 [근거 자료]를 읽고 인정 전략을 JSON으로 작성합니다.
원칙:
- 모든 논리는 가능한 한 [근거 자료](과거 인정/불인정 사례·법령)에 연결. 근거 없는 단정 금지.
- 정량 % 일치율·확률 숫자 출력 금지(검증 안 된 숫자는 오해를 부름). 정성 평가 + 근거 사례로만.
- conflicts: 자료 간 날짜·사실·인과 모순을 severity "치명"(심의에 치명적) 또는 "주의"로 표기. 없으면 빈 배열.
- masterTimeline: 사건 날짜를 시간순 병합. 자료가 비어있는 구간은 gap=true + event에 "(자료 공백 — 필요)" 표기.
- counterArguments: 공단·심의위 예상 반론(개인사유·기존질환 등)과 대비 논리.
- 한국어. JSON만.

JSON 스키마:
{
  "possibleLogics": [{ "title": "", "reasoning": "", "strength": "강|중|약" }],
  "missingEvidence": ["인정에 필요하나 부족한 자료"],
  "keyIssues": ["핵심 쟁점"],
  "causalChain": [{ "factor": "업무 요인", "link": "→ 의학·심리 영향", "evidence": "뒷받침 자료" }],
  "similarCases": [{ "ref": "유사 사례 제목", "outcome": "approved|rejected", "match": "일치 요소", "diff": "차이 요소" }],
  "counterArguments": [{ "argument": "예상 반론", "rebuttal": "대비 논리", "basis": "근거" }],
  "conflicts": [{ "severity": "치명|주의", "desc": "모순 내용", "sources": ["자료A", "자료B"] }],
  "masterTimeline": [{ "date": "YYYY-MM-DD 또는 기간", "event": "", "source": "", "gap": false }]
}`;

  const userPrompt = `[사건 구조]\n${ex ? JSON.stringify(ex).slice(0, 8000) : "(구조 추출 결과 없음)"}\n\n[근거 자료]\n${grounding.slice(0, 12000)}\n\nJSON만 응답하세요.`;

  const res = await callGeminiJSON<StrategyJson>(`${systemPrompt}\n\n${userPrompt}`, {
    mode: "pro", featureKey: "martyrdom_ai", maxOutputTokens: 4096, timeoutMs: 120000, internalBulk: true,
  });

  const refs = ragToRefs(topHits);
  const empty: StrategyJson = {
    possibleLogics: [], missingEvidence: [], keyIssues: [], causalChain: [],
    similarCases: [], counterArguments: [], conflicts: [], masterTimeline: [], ragSources: refs,
  };
  if (!res.ok || !res.data) return { contentJson: empty, ragSources: refs, modelUsed: MODEL_PRO() };

  const d: any = res.data;
  const contentJson: StrategyJson = {
    possibleLogics: asArr(d.possibleLogics).map((x: any) => ({ title: s(x.title, 200), reasoning: s(x.reasoning, 1500), strength: String(x.strength || "중").slice(0, 4) })),
    missingEvidence: asArr(d.missingEvidence).map((x: any) => s(x, 200)),
    keyIssues: asArr(d.keyIssues).map((x: any) => s(x, 200)),
    causalChain: asArr(d.causalChain).map((x: any) => ({ factor: s(x.factor, 300), link: s(x.link, 300), evidence: s(x.evidence, 300) })),
    similarCases: asArr(d.similarCases).map((x: any) => ({ ref: s(x.ref, 200), outcome: String(x.outcome || "").slice(0, 12), match: s(x.match, 300), diff: s(x.diff, 300) })),
    counterArguments: asArr(d.counterArguments).map((x: any) => ({ argument: s(x.argument, 400), rebuttal: s(x.rebuttal, 600), basis: s(x.basis, 300) })),
    conflicts: asArr(d.conflicts).map((x: any) => ({ severity: String(x.severity || "주의").slice(0, 4), desc: s(x.desc, 400), sources: asArr(x.sources).map((y: any) => s(y, 100)) })),
    masterTimeline: asArr(d.masterTimeline).map((x: any) => ({ date: s(x.date, 40), event: s(x.event, 300), source: s(x.source, 100), gap: Boolean(x.gap) })),
    ragSources: refs,
  };
  return { contentJson, ragSources: refs, modelUsed: res.modelUsed || MODEL_PRO() };
}

/* =========================================================
   checkCriteria — ② 인정요건 대조 (요건별 met|partial|unmet + 근거)
   ========================================================= */
export async function checkCriteria(caseId: number): Promise<GenResult<CriteriaCheckJson>> {
  /* 활성 요건 master */
  let criteria: any[] = [];
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT code, category, title, description, evidence_hint AS "evidenceHint", weight
      FROM martyrdom_criteria WHERE active = true ORDER BY sort_order ASC, id ASC
    `));
    criteria = r?.rows ?? r ?? [];
  } catch { criteria = []; }

  const ex = await loadExtraction(caseId);
  const totalCount = criteria.length;
  const refs: RagSourceRef[] = [];

  /* 법령 근거 (공통 1콜 검색) */
  try {
    const lawHits = await searchRag("교사 순직 인정 요건 공무수행성 인과관계 과로 스트레스", 5, ["martyr_law", "martyr_case"], caseId);
    refs.push(...ragToRefs(lawHits));
  } catch { /* 검색 실패 무시 */ }

  if (totalCount === 0) {
    return { contentJson: { items: [], metCount: 0, totalCount: 0 }, ragSources: refs, modelUsed: MODEL_PRO() };
  }

  const criteriaList = criteria.map((c: any) =>
    `- ${c.code} (${c.category}) ${c.title}: ${s(c.description, 200)}`).join("\n");

  const systemPrompt = `당신은 교사 순직 인정 요건 심사 보조 전문가입니다. 아래 인정 요건 각각에 대해 사건 자료가 충족하는지 판정합니다.
status 값:
- "met": 자료로 충분히 입증됨
- "partial": 일부 입증되나 보강 필요
- "unmet": 입증 자료 없음·미흡
원칙: 자료에 근거해 판정. evidence에 판정 근거를 1~2문장으로. 정량 % 금지. 한국어. JSON만.

응답 형식:
{ "items": [{ "code": "요건코드", "status": "met|partial|unmet", "evidence": "판정 근거" }] }
(요건 목록의 code를 모두 포함)`;

  const userPrompt = `[인정 요건 목록]\n${criteriaList}\n\n[사건 구조]\n${ex ? JSON.stringify(ex).slice(0, 8000) : "(구조 추출 없음)"}\n\n[법령·사례 근거]\n${refs.map(r => r.snippet).join("\n").slice(0, 4000)}\n\nJSON만 응답하세요.`;

  const res = await callGeminiJSON<{ items: any[] }>(`${systemPrompt}\n\n${userPrompt}`, {
    mode: "pro", featureKey: "martyrdom_ai", maxOutputTokens: 3072, timeoutMs: 90000, internalBulk: true,
  });

  const verdictByCode = new Map<string, { status: string; evidence: string }>();
  if (res.ok && res.data && Array.isArray(res.data.items)) {
    for (const it of res.data.items) {
      const code = String(it.code || "");
      const st = ["met", "partial", "unmet"].includes(String(it.status)) ? String(it.status) : "unmet";
      verdictByCode.set(code, { status: st, evidence: s(it.evidence, 600) });
    }
  }

  const items = criteria.map((c: any) => {
    const v = verdictByCode.get(String(c.code)) || { status: "unmet", evidence: "(판정 보류 — 자료 부족 또는 분석 실패)" };
    return { code: String(c.code), category: String(c.category || ""), title: String(c.title || ""), status: v.status, evidence: v.evidence, ragSources: [] as RagSourceRef[] };
  });
  const metCount = items.filter(i => i.status === "met").length;

  return { contentJson: { items, metCount, totalCount }, ragSources: refs, modelUsed: res.modelUsed || MODEL_PRO() };
}

/* =========================================================
   buildGoldenAdvice — ① 골든타임 맞춤 제언 (체크리스트 master + 사건 정황)
   ========================================================= */
export async function buildGoldenAdvice(caseId: number): Promise<GenResult<GoldenJson>> {
  let masterItems: any[] = [];
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT channel, label, guidance, volatility, sort_order AS "sortOrder"
      FROM martyrdom_golden_items WHERE active = true ORDER BY volatility DESC, sort_order ASC
    `));
    masterItems = r?.rows ?? r ?? [];
  } catch { masterItems = []; }

  const ex = await loadExtraction(caseId);

  /* 폴백: AI 실패 시 master를 휘발성 우선으로 그대로 정렬 */
  const fallbackItems = masterItems.map((m: any, i: number) => ({
    channel: String(m.channel || "offline"),
    label: String(m.label || ""),
    guidance: String(m.guidance || ""),
    volatility: Number(m.volatility || 3) >= 4 ? "high" : "low",
    priority: i + 1,
    caseFit: "",
  }));

  if (masterItems.length === 0) {
    return { contentJson: { items: [] }, ragSources: [], modelUsed: MODEL_PRO() };
  }

  const listStr = masterItems.map((m: any) =>
    `- [${m.channel}] ${m.label} (휘발성 ${m.volatility}): ${s(m.guidance, 150)}`).join("\n");

  const systemPrompt = `당신은 교사 순직 사건 초기 대응 전문가입니다. 아래 자료 확보 체크리스트를 이 사건 정황에 맞게 우선순위화하고 맞춤 사유를 답니다.
원칙:
- 휘발성 높은(online·삭제·잠금 위험) 항목을 우선(priority 1부터). volatility는 "high" 또는 "low".
- caseFit: 이 사건에서 왜 이 자료가 중요한지 1문장(사건 정황 반영).
- 체크리스트 항목만 사용(새 항목 창작 금지). 한국어. JSON만.

응답 형식:
{ "items": [{ "channel": "online|offline", "label": "", "guidance": "", "volatility": "high|low", "priority": 1, "caseFit": "" }] }`;

  const userPrompt = `[자료 확보 체크리스트]\n${listStr}\n\n[사건 정황]\n${ex ? JSON.stringify({ caseType: ex.caseType, dutyRelevance: ex.dutyRelevance, evidenceMissing: ex.evidenceMissing, keyIssues: ex.keyIssues }).slice(0, 3000) : "(구조 추출 없음)"}\n\nJSON만 응답하세요.`;

  const res = await callGeminiJSON<{ items: any[] }>(`${systemPrompt}\n\n${userPrompt}`, {
    mode: "flash", featureKey: "martyrdom_ai", maxOutputTokens: 2048, timeoutMs: 60000, internalBulk: true,
  });

  if (!res.ok || !res.data || !Array.isArray(res.data.items) || res.data.items.length === 0) {
    return { contentJson: { items: fallbackItems }, ragSources: [], modelUsed: MODEL_PRO() };
  }
  const items = res.data.items.map((x: any, i: number) => ({
    channel: String(x.channel || "offline").slice(0, 12),
    label: s(x.label, 200),
    guidance: s(x.guidance, 600),
    volatility: String(x.volatility || "low").toLowerCase() === "high" ? "high" : "low",
    priority: Number(x.priority) || i + 1,
    caseFit: s(x.caseFit, 400),
  }));
  return { contentJson: { items }, ragSources: [], modelUsed: res.modelUsed || MODEL_PRO() };
}

/* =========================================================
   computeReadiness — ⑫ 준비도 게이지 (규칙 % 계산·재현 가능 + AI 첨언 1콜)
   가중: 요건40·증거30·타임라인15·모순15. 숫자는 규칙으로만 산출(재현성).
   ========================================================= */
const READINESS_MAX = { criteria: 40, evidence: 30, timeline: 15, conflicts: 15 };

export async function computeReadiness(caseId: number): Promise<GenResult<ReadinessJson>> {
  const ex = await loadExtraction(caseId);
  const criteriaCheck = await loadLatestOutput(caseId, "criteria_check");
  const strategy = await loadLatestOutput(caseId, "strategy");

  const gaps: Array<{ label: string; plus: number }> = [];

  /* ── 요건 (40): criteria_check 가중 합산 ── */
  let criteriaScore = 0;
  if (criteriaCheck && Array.isArray(criteriaCheck.items) && criteriaCheck.items.length > 0) {
    /* 요건 master weight 로드 */
    const weightByCode = new Map<string, number>();
    try {
      const r: any = await db.execute(sql.raw(`SELECT code, weight FROM martyrdom_criteria WHERE active = true`));
      for (const row of (r?.rows ?? r ?? [])) weightByCode.set(String(row.code), Number(row.weight) || 1);
    } catch { /* weight 없으면 1 */ }
    let sumW = 0, sumF = 0;
    for (const it of criteriaCheck.items) {
      const w = weightByCode.get(String(it.code)) || 1;
      const f = it.status === "met" ? 1 : it.status === "partial" ? 0.5 : 0;
      sumW += w; sumF += w * f;
      if (it.status !== "met") {
        const plus = sumW > 0 ? Math.round((w * (it.status === "partial" ? 0.5 : 1) / (sumW || 1)) * READINESS_MAX.criteria) : 0;
        if (plus > 0) gaps.push({ label: `요건 보강: ${s(it.title, 60)}`, plus });
      }
    }
    criteriaScore = sumW > 0 ? Math.round((sumF / sumW) * READINESS_MAX.criteria) : 0;
  } else {
    gaps.push({ label: "요건 대조 먼저 실행([요건 대조])", plus: READINESS_MAX.criteria });
  }

  /* ── 증거 (30): evidenceHave / (have+missing) ── */
  let evidenceScore = 0;
  const have = ex ? asArr(ex.evidenceHave).length : 0;
  const missing = ex ? asArr(ex.evidenceMissing) : [];
  const denom = have + missing.length;
  if (denom > 0) {
    evidenceScore = Math.round((have / denom) * READINESS_MAX.evidence);
    const perItem = Math.max(1, Math.round(READINESS_MAX.evidence / denom));
    for (const m of missing.slice(0, 4)) gaps.push({ label: s(m, 60), plus: perItem });
  } else {
    gaps.push({ label: "자료 추출(사건 구조) 먼저 실행", plus: READINESS_MAX.evidence });
  }

  /* ── 타임라인 (15): masterTimeline 비공백 비율 또는 timeline 개수 ── */
  let timelineScore = 0;
  if (strategy && Array.isArray(strategy.masterTimeline) && strategy.masterTimeline.length > 0) {
    const total = strategy.masterTimeline.length;
    const nonGap = strategy.masterTimeline.filter((t: any) => !t.gap).length;
    timelineScore = Math.round((nonGap / total) * READINESS_MAX.timeline);
    const gapCount = total - nonGap;
    if (gapCount > 0) gaps.push({ label: `타임라인 공백 ${gapCount}구간 자료 보완`, plus: Math.round((gapCount / total) * READINESS_MAX.timeline) });
  } else if (ex && asArr(ex.timeline).length > 0) {
    const n = asArr(ex.timeline).length;
    timelineScore = Math.min(READINESS_MAX.timeline, Math.round((n / 6) * READINESS_MAX.timeline));
    if (timelineScore < READINESS_MAX.timeline) gaps.push({ label: "사건 연표 보강(주요 시점 추가)", plus: READINESS_MAX.timeline - timelineScore });
  } else {
    gaps.push({ label: "전략 분석으로 마스터 타임라인 생성", plus: READINESS_MAX.timeline });
  }

  /* ── 모순 (15): 전략의 conflicts 감점 ── */
  let conflictsScore = READINESS_MAX.conflicts;
  if (strategy && Array.isArray(strategy.conflicts) && strategy.conflicts.length > 0) {
    let penalty = 0;
    for (const c of strategy.conflicts) penalty += String(c.severity).includes("치명") ? 8 : 3;
    conflictsScore = Math.max(0, READINESS_MAX.conflicts - penalty);
    if (penalty > 0) gaps.push({ label: `자료 간 모순 ${strategy.conflicts.length}건 해소`, plus: Math.min(penalty, READINESS_MAX.conflicts) });
  }

  const score = Math.max(0, Math.min(100, criteriaScore + evidenceScore + timelineScore + conflictsScore));
  gaps.sort((a, b) => b.plus - a.plus);
  const topGaps = gaps.slice(0, 6);

  /* ── AI 첨언 (정성·숫자 금지·1콜·실패 시 폴백) ── */
  let aiNote = "";
  try {
    const weakest = [
      { k: "인정 요건 충족", v: criteriaScore / READINESS_MAX.criteria },
      { k: "핵심 증거 확보", v: evidenceScore / READINESS_MAX.evidence },
      { k: "타임라인 완결성", v: timelineScore / READINESS_MAX.timeline },
      { k: "자료 간 일관성", v: conflictsScore / READINESS_MAX.conflicts },
    ].sort((a, b) => a.v - b.v)[0];
    const noteRes = await callGemini(
      `교사 순직 인정 준비 상태를 운영자에게 1~3문장으로 정성 평가하세요. 가장 약한 영역은 "${weakest.k}"이고, 부족 항목은 ${topGaps.map(g => g.label).slice(0, 3).join(", ") || "없음"}입니다. 숫자·퍼센트·확률은 절대 쓰지 말고, 무엇을 보완하면 인정 논리가 강해지는지 조언만 하세요. 한국어로.`,
      { mode: "flash", featureKey: "martyrdom_ai", maxOutputTokens: 400, timeoutMs: 30000, internalBulk: true, temperature: 0.4 }
    );
    aiNote = noteRes.ok && noteRes.text ? noteRes.text.trim().slice(0, 800) : "";
  } catch { aiNote = ""; }
  if (!aiNote) {
    const weakLabel = topGaps[0]?.label || "추가 자료";
    aiNote = `현재 가장 보완이 필요한 부분은 "${weakLabel}"입니다. 이 자료를 확보하면 인정 논리가 더 탄탄해집니다. (전문가 검토 필수)`;
  }

  const contentJson: ReadinessJson = {
    score,
    breakdown: { criteria: criteriaScore, evidence: evidenceScore, timeline: timelineScore, conflicts: conflictsScore },
    max: { ...READINESS_MAX },
    gaps: topGaps,
    aiNote,
    label: "보고서 준비도 — 인정 확률 아님·내부 가늠용",
  };
  return { contentJson, ragSources: [], modelUsed: MODEL_PRO() };
}

/* =========================================================
   learnFromClosedCase — ⑥ 종결(closed+outcome) 학습 루프
   recognitionPattern 추출 → 사건 corpus를 martyr_case로 전환(색인) → reference 전환
   ========================================================= */
export async function learnFromClosedCase(caseId: number): Promise<{ ok: boolean; recognitionPattern?: RecognitionPattern; promoted: number; error?: string }> {
  try {
    /* 종결 자료 수집 */
    const docsRes: any = await db.execute(sql.raw(`
      SELECT doc_type AS "docType", doc_summary AS "docSummary", file_name AS "fileName", extracted_text AS "extractedText"
      FROM martyrdom_case_documents
      WHERE case_id = ${caseId} AND extract_status = 'done' AND extracted_text IS NOT NULL
      ORDER BY created_at ASC
    `));
    const docs = (docsRes?.rows ?? docsRes ?? []).map((d: any) => ({
      docType: String(d.docType || "other"),
      summary: String(d.docSummary || ""),
      fileName: String(d.fileName || ""),
      extractedText: d.extractedText ? String(d.extractedText) : undefined,
    }));

    /* reference 관점으로 재추출 → recognitionPattern 확보 */
    const extraction = await extractCaseStructure(caseId, docs, "reference");
    const recognitionPattern = extraction.recognitionPattern;

    /* 사건 extraction_json에 recognitionPattern 병합 + reference 전환 */
    const safeJson = JSON.stringify(extraction).replace(/'/g, "''");
    await db.execute(sql.raw(`
      UPDATE martyrdom_cases
      SET extraction_json = '${safeJson}'::jsonb,
          case_kind = 'reference',
          extracted_at = NOW(),
          updated_at = NOW()
      WHERE id = ${caseId}
    `));

    /* RAG corpus 전환: martyr_active → martyr_case (임베딩 재사용·진행 corpus에서 제거) */
    let promoted = 0;
    try {
      const upd: any = await db.execute(sql.raw(`
        UPDATE ai_rag_documents
        SET source_type = 'martyr_case', updated_at = NOW()
        WHERE source_type = 'martyr_active' AND case_id = ${caseId}
      `));
      promoted = Number(upd?.rowCount ?? upd?.count ?? 0) || 0;
    } catch (e: any) {
      console.warn("[learnFromClosedCase] corpus 전환 실패", e?.message);
    }

    /* 학습 산출물 기록 */
    if (recognitionPattern) {
      const safePattern = JSON.stringify(recognitionPattern).replace(/'/g, "''");
      const verRes: any = await db.execute(sql.raw(`
        SELECT COALESCE(MAX(version), 0) AS v FROM martyrdom_ai_outputs WHERE case_id = ${caseId} AND output_type = 'learning'
      `));
      const nextV = Number((verRes?.rows ?? verRes ?? [])[0]?.v || 0) + 1;
      await db.execute(sql.raw(`
        INSERT INTO martyrdom_ai_outputs (case_id, output_type, version, content_json, model_used, status, created_at)
        VALUES (${caseId}, 'learning', ${nextV}, '${safePattern}'::jsonb, '${MODEL_PRO().replace(/'/g, "''")}', 'draft', NOW())
      `));
    }

    return { ok: true, recognitionPattern, promoted };
  } catch (err: any) {
    return { ok: false, promoted: 0, error: String(err?.message || err).slice(0, 300) };
  }
}

/* =========================================================
   P3 — 서면 생성 (④유족급여신청서 초안·§P3.2 계약 키 고정)
   응답 JSON 키는 §P3.2 계약과 1:1(A mock 동일). 1글자도 변경 금지.
   draftOutline(목차) / draftSection(섹션 본문) / indexApprovedReport(인정 보고서 형식 모델 색인).
   모든 AI 호출: featureKey 'martyrdom_ai' · internalBulk · temperature 0.4 · 정량 % 금지.
   ========================================================= */

export interface OutlineSection { sectionKey: string; title: string; intent: string; order: number; }
export interface DraftOutlineJson { sections: OutlineSection[]; }
export interface DraftSectionResult { content: string; ragSources: RagSourceRef[]; }

/* 표준 유족급여신청서 목차 (AI 실패 시 폴백·§P3.5 mock과 동일 구조) */
const DEFAULT_OUTLINE: OutlineSection[] = [
  { sectionKey: "intro",      title: "신청 취지",            intent: "유족급여 청구 취지·근거 법령 개요", order: 1 },
  { sectionKey: "deceased",   title: "고인 및 직무 개요",    intent: "고인 인적사항·담당 업무·근무 환경", order: 2 },
  { sectionKey: "duty",       title: "공무상 과로·스트레스", intent: "업무량·시간외·민원 등 공무 관련성", order: 3 },
  { sectionKey: "medical",    title: "의학적 인과관계",      intent: "진단·심리부검·사인과 공무의 연결", order: 4 },
  { sectionKey: "criteria",   title: "인정 요건 충족",       intent: "공무원재해보상법 요건별 대조", order: 5 },
  { sectionKey: "conclusion", title: "결론 및 신청",         intent: "순직 인정·유족급여 지급 요청", order: 6 },
];

function safeKey(v: any, fallback: string): string {
  const k = String(v || "").trim().replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
  return k || fallback;
}

/* =========================================================
   draftOutline — 인정 보고서 형식 모델 + 사건 구조로 목차 제안 (§9.2)
   ========================================================= */
export async function draftOutline(caseId: number): Promise<GenResult<DraftOutlineJson>> {
  const ex = await loadExtraction(caseId);
  const strategy = await loadLatestOutput(caseId, "strategy");
  const criteria = await loadLatestOutput(caseId, "criteria_check");

  /* 인정 보고서 exemplar 구조 (형식 모델·martyr_case) */
  let exemplarHits: RagHit[] = [];
  try {
    exemplarHits = await searchRag(
      "유족급여신청서 순직유족급여청구서 인정 보고서 목차 구성 신청취지 결론",
      4, ["martyr_case"], caseId,
    );
  } catch { /* 검색 실패 무시 */ }
  const refs = ragToRefs(exemplarHits);
  const exemplarText = exemplarHits.length
    ? exemplarHits.map((h, i) => `[인정 보고서 모델${i + 1}] ${h.title || h.sourceRef}\n${(h.content || "").slice(0, 600)}`).join("\n\n")
    : "(인정 보고서 형식 모델 없음 — 표준 유족급여신청서 구성으로 작성)";

  const systemPrompt = `당신은 교사 순직 인정 유족급여신청서를 설계하는 전문가입니다. 이 사건에 맞는 신청서 목차(섹션 구성)를 제안합니다.
원칙:
- [인정 보고서 모델]의 형식·전개 순서를 참고하되, 이 사건 구조에 맞춰 섹션을 구성.
- 보통 6~9개 섹션 (신청 취지 → 고인·직무 → 공무 관련성 → 의학적 인과 → 인정 요건 → 예상 반론 대비 → 결론).
- 각 섹션에 intent(그 섹션에서 무엇을 입증·서술할지) 1~2문장.
- sectionKey는 영문 소문자·언더스코어(intro, deceased, duty, medical, criteria, counter, conclusion 등).
- 한국어. JSON만.

JSON 스키마:
{ "sections": [ { "sectionKey": "intro", "title": "신청 취지", "intent": "...", "order": 1 } ] }`;

  const userPrompt = `[사건 구조]\n${ex ? JSON.stringify(ex).slice(0, 6000) : "(구조 추출 없음)"}\n\n[전략 핵심]\n${strategy ? JSON.stringify({ possibleLogics: strategy.possibleLogics, keyIssues: strategy.keyIssues, counterArguments: strategy.counterArguments }).slice(0, 3000) : "(전략 없음)"}\n\n[인정 요건]\n${criteria && Array.isArray(criteria.items) ? criteria.items.map((c: any) => `- ${c.title} (${c.status})`).join("\n").slice(0, 2000) : "(요건 대조 없음)"}\n\n[인정 보고서 형식 모델]\n${exemplarText.slice(0, 5000)}\n\n위 사건에 맞는 신청서 목차를 JSON으로 제안하세요.`;

  const res = await callGeminiJSON<DraftOutlineJson>(`${systemPrompt}\n\n${userPrompt}`, {
    // 2026-05-28 Swain 요청: 초안 분량 2배 — 목차도 8192로 늘려 섹션 수·intent 풍부화 → 전체 초안 분량↑
    mode: "pro", featureKey: "martyrdom_ai", temperature: 0.4, maxOutputTokens: 8192, timeoutMs: 120000, internalBulk: true,
  });

  if (!res.ok || !res.data || !Array.isArray(res.data.sections) || res.data.sections.length === 0) {
    return { contentJson: { sections: DEFAULT_OUTLINE }, ragSources: refs, modelUsed: res.modelUsed || MODEL_PRO() };
  }
  const sections: OutlineSection[] = res.data.sections
    .map((x: any, i: number) => ({
      sectionKey: safeKey(x.sectionKey, `sec${i + 1}`),
      title: s(x.title, 200),
      intent: s(x.intent, 1000),
      order: Number(x.order) || i + 1,
    }))
    .filter((x: OutlineSection) => x.title)
    .sort((a: OutlineSection, b: OutlineSection) => a.order - b.order);

  return {
    contentJson: { sections: sections.length ? sections : DEFAULT_OUTLINE },
    ragSources: refs,
    modelUsed: res.modelUsed || MODEL_PRO(),
  };
}

/* =========================================================
   draftSection — 섹션 1개 본문 생성 (Swain 2026-05-29 출처 3분류 정책)
   ① 사실관계·정황·진술 → 본 사건 자료(martyr_active) + 사건 구조 + 전략·타임라인
   ② 분석 기법·전개 → martyr_case (다른 인정 사건 보고서 형식·전개 참고)
   ③ 통계·비교·법령 → martyr_law + martyr_case의 법령 인용 부분
   ========================================================= */
export async function draftSection(
  caseId: number,
  section: { sectionKey: string; title: string; intent?: string },
  priorTitles: string[] = [],
): Promise<GenResult<DraftSectionResult> & { ok: boolean; error?: string }> {
  const ex = await loadExtraction(caseId);
  const strategy = await loadLatestOutput(caseId, "strategy");
  const title = String(section.title || "").slice(0, 200);
  const intent = String(section.intent || "").slice(0, 1000);

  /* ① 본 사건 자료 원문 (martyr_active·case_id 격리·사실관계 1차 출처) — Swain 2026-05-29 추가 */
  let caseDocHits: RagHit[] = [];
  try {
    caseDocHits = await searchRag(`${title} ${intent} ${ex?.deceased?.name || ""} ${ex?.deceased?.school || ""}`.trim(), 6, ["martyr_active"], caseId);
  } catch { /* 무시 */ }
  /* ② 분석 기법·전개·법령 인용 참고 (martyr_case·다른 인정 사건 보고서) */
  let exemplarHits: RagHit[] = [];
  try {
    exemplarHits = await searchRag(`${title} ${intent} 순직 인정 유족급여신청서`, 3, ["martyr_case"], caseId);
  } catch { /* 무시 */ }
  /* ③ 법령 근거 (martyr_law) */
  let lawHits: RagHit[] = [];
  try {
    lawHits = await searchRag(`${title} ${intent} 공무원재해보상법 순직 인정 요건 상당인과관계`, 3, ["martyr_law"], caseId);
  } catch { /* 무시 */ }

  const refs: RagSourceRef[] = [...ragToRefs(caseDocHits), ...ragToRefs(exemplarHits), ...ragToRefs(lawHits)];
  const caseDocText = caseDocHits.length
    ? caseDocHits.map((h, i) => `[본 사건 자료${i + 1}] ${h.title || h.sourceRef}\n${(h.content || "").slice(0, 600)}`).join("\n\n")
    : "(본 사건 업로드 자료 없음 또는 추출 미완료 — 사건 구조·전략에서만 사실 인용)";
  const exemplarText = exemplarHits.length
    ? exemplarHits.map((h, i) => `[인정 보고서 모델${i + 1}] ${h.title || h.sourceRef}\n${(h.content || "").slice(0, 700)}`).join("\n\n")
    : "(형식 모델 없음 — 공식 신청서 문어체로 작성)";
  const lawText = lawHits.length
    ? lawHits.map((h, i) => `[법령${i + 1}] ${h.title || h.sourceRef}\n${(h.content || "").slice(0, 500)}`).join("\n\n")
    : "(검색된 법령 근거 없음 — 일반 지식 보강하되 단정 금지)";

  const systemPrompt = `당신은 교사 순직 인정 유족급여신청서를 작성하는 전문가입니다. 지정된 한 섹션의 본문만 작성합니다.

원칙 (절대 준수·출처 분리):
1) 사실·정황·진술·증거의 출처는 **본 사건 자료에만** 한정됩니다.
   - [본 사건 자료]: 본 사건 첨부 자료의 원문 청크
   - [사건 구조]: 본 사건 자료에서 추출한 구조화 데이터
   - [전략·타임라인·반론]: 본 사건 자료 기반 분석 결과
   → 이 세 가지에서만 사실을 인용하시오. 자료에 없는 사실은 창작하지 말고 "(확인 필요)"로 표기.

2) 분석 기법·전개 방식·서술 구조는 [인정 보고서 모델]에서 참고합니다.
   - 다른 인정 사건의 보고서가 어떤 순서로 사실을 배열하고 인과를 전개하는지, 어떤 증거를 강조하는지를 참고하시오.
   - **다른 사건의 사실(고인 이름·학교명·날짜·진단·진술 등)을 본 사건 본문에 인용하지 마시오.** 형식·전개·문체만 가져옵니다.

3) 통계·비교 분석·법령·인정 요건은 [법령 근거]·[인정 보고서 모델]의 법령 인용 부분에서 가져옵니다.
   - 공무원재해보상법 등 법령·판례·요건은 자유롭게 인용·해석하시오.
   - "다른 인정 사례에서 인정된 사유는 ...과 같다"식의 일반화·비교 분석은 [인정 보고서 모델]을 근거로 작성 가능.

기타:
- 정량 % 확률 숫자 금지.
- 한국어 공식 문어체. 섹션 제목·머리말·마크다운 없이 본문 단락만 출력(빈 줄로 단락 구분).`;

  const userPrompt = `[작성할 섹션]\n제목: ${title}\n의도: ${intent || "(미지정)"}\n\n[앞서 작성된 섹션 제목(중복 서술 방지)]\n${priorTitles.length ? priorTitles.join(", ") : "(없음)"}\n\n━━━ 본 사건 자료 (사실·정황의 1차 출처·이 영역에서만 사실 인용) ━━━\n\n[본 사건 자료 원문]\n${caseDocText.slice(0, 5000)}\n\n[사건 구조 — 본 사건 자료에서 추출]\n${ex ? JSON.stringify(ex).slice(0, 6000) : "(구조 추출 없음)"}\n\n[전략·마스터 타임라인·예상 반론 — 본 사건 자료 기반 분석]\n${strategy ? JSON.stringify({ possibleLogics: strategy.possibleLogics, masterTimeline: strategy.masterTimeline, counterArguments: strategy.counterArguments, causalChain: strategy.causalChain }).slice(0, 5000) : "(전략 없음)"}\n\n━━━ 분석 기법·법령 코퍼스 (형식·법령 인용만 참고·다른 사건 사실 인용 금지) ━━━\n\n[인정 보고서 모델 — 분석 기법·전개·법령 인용 참고]\n${exemplarText.slice(0, 4000)}\n\n[법령 근거]\n${lawText.slice(0, 3000)}\n\n위 섹션의 본문을 작성하세요.`;

  const res = await callGemini(`${systemPrompt}\n\n${userPrompt}`, {
    // 2026-05-28 Swain 요청: 초안 섹션 분량 2배 (4096 → 8192). Gemini 3-flash 출력 한도 내.
    //   사례 누적 시 RAG exemplar가 풍부해도 4096 토큰에서 잘리던 문제 해소.
    mode: "pro", featureKey: "martyrdom_ai", temperature: 0.4, maxOutputTokens: 8192, timeoutMs: 120000, internalBulk: true,
  });

  const ok = Boolean(res.ok && res.text && res.text.trim().length > 5);
  const content = ok
    ? res.text!.trim()
    : `(섹션 생성 실패: ${String(res.error || res.disabledReason || "AI 응답 없음").slice(0, 120)}) — [재생성]을 누르거나 직접 작성하세요.`;

  return {
    contentJson: { content, ragSources: refs },
    ragSources: refs,
    modelUsed: res.modelUsed || MODEL_PRO(),
    ok,
    error: ok ? undefined : String(res.error || res.disabledReason || "AI 응답 없음").slice(0, 300),
  };
}

/* =========================================================
   indexApprovedReport — 인정(approved) 사건의 application 문서를
   martyr_case·sourceRef "approved-report:{caseNo}"로 색인 = 형식 모델 exemplar (§9.2)
   ========================================================= */
const APPROVED_CHUNK_CHARS = 1500;
function chunkPlainText(text: string, sourceRef: string, title: string): Array<{ title: string; content: string; sourceRef: string }> {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Array<{ title: string; content: string; sourceRef: string }> = [];
  let buf = "";
  let idx = 0;
  const flush = () => {
    const content = buf.trim();
    if (content.length < 30) { buf = ""; return; }
    chunks.push({ title, content, sourceRef: `${sourceRef}#${idx++}` });
    buf = "";
  };
  for (const para of paragraphs) {
    if (buf.length + para.length > APPROVED_CHUNK_CHARS && buf.length > 0) flush();
    buf += (buf ? "\n\n" : "") + para;
  }
  flush();
  return chunks;
}

export async function indexApprovedReport(caseId: number): Promise<{ ok: boolean; indexed: number; error?: string }> {
  try {
    /* 사건 caseNo·outcome 확인 */
    const cr: any = await db.execute(sql.raw(`
      SELECT case_no AS "caseNo", outcome FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
    `));
    const caseRow = (cr?.rows ?? cr ?? [])[0];
    if (!caseRow) return { ok: false, indexed: 0, error: "사건 없음" };
    const caseNo = String(caseRow.caseNo || `case-${caseId}`);
    if (String(caseRow.outcome || "") !== "approved") {
      return { ok: true, indexed: 0 }; // 인정 사건만 형식 모델로 색인
    }

    /* application(신청·행정 서류) 문서 텍스트 수집 */
    const docsRes: any = await db.execute(sql.raw(`
      SELECT id, file_name AS "fileName", extracted_text AS "extractedText"
      FROM martyrdom_case_documents
      WHERE case_id = ${caseId} AND doc_type = 'application'
        AND extract_status = 'done' AND extracted_text IS NOT NULL
      ORDER BY created_at ASC
    `));
    const docs = (docsRes?.rows ?? docsRes ?? []).filter((d: any) => d.extractedText && String(d.extractedText).length > 50);
    if (docs.length === 0) return { ok: true, indexed: 0 }; // 신청서 문서 없으면 스킵

    const safeCaseNo = caseNo.replace(/[^a-z0-9_-]/gi, "_");
    const exemplarRef = `approved-report:${safeCaseNo}`;

    /* 기존 동일 exemplar 청크 삭제(멱등·재색인) */
    await db.execute(sql.raw(`
      DELETE FROM ai_rag_documents
      WHERE source_type = 'martyr_case' AND case_id = ${caseId}
        AND source_ref LIKE '${exemplarRef.replace(/'/g, "''")}#%'
    `));

    let indexed = 0;
    for (const d of docs) {
      const chunks = chunkPlainText(String(d.extractedText), `${exemplarRef}:doc${Number(d.id)}`, `인정 보고서 모델 — ${caseNo}`);
      for (const chunk of chunks) {
        try {
          const embedding = await embedText(chunk.content);
          const vecLiteral = `[${embedding.join(",")}]`;
          const safeContent = chunk.content.replace(/'/g, "''").slice(0, 4000);
          const safeTitle = chunk.title.replace(/'/g, "''").slice(0, 200);
          const safeChunkRef = chunk.sourceRef.replace(/'/g, "''").slice(0, 200);
          await db.execute(sql.raw(`
            INSERT INTO ai_rag_documents
              (source_type, source_ref, case_id, title, content, embedding, created_at)
            VALUES
              ('martyr_case', '${safeChunkRef}', ${caseId}, '${safeTitle}', '${safeContent}', '${vecLiteral}'::vector, NOW())
            ON CONFLICT (source_ref)
            DO UPDATE SET source_type = EXCLUDED.source_type, content = EXCLUDED.content, embedding = EXCLUDED.embedding,
                          case_id = EXCLUDED.case_id, title = EXCLUDED.title
          `));
          indexed++;
        } catch (embedErr: any) {
          console.warn(`[indexApprovedReport] 청크 임베딩 실패 ${chunk.sourceRef}: ${embedErr?.message}`);
        }
      }
    }
    return { ok: true, indexed };
  } catch (err: any) {
    return { ok: false, indexed: 0, error: String(err?.message || err).slice(0, 300) };
  }
}

/* =========================================================
   P4: buildFamilySummary — 유족 전달용 쉬운 요약 (⑧)
   ========================================================= */

export interface FamilySummaryResult {
  id: number;
  outputType: "family_summary";
  contentText: string;
  nextSteps: string[];
  status: "draft";
}

/**
 * 사건 진행 상황을 쉬운 말로 요약 + 다음 할 일 목록 생성.
 * ai_outputs(outputType='family_summary')에 저장 후 반환.
 */
export async function buildFamilySummary(caseId: number): Promise<FamilySummaryResult> {
  /* 사건 기본 정보 */
  const cr: any = await db.execute(sql.raw(`
    SELECT case_no AS "caseNo", title, status,
           deceased_name AS "deceasedName", case_kind AS "caseKind",
           (
             SELECT (ao.content_json->>'score')::int
             FROM martyrdom_ai_outputs ao
             WHERE ao.case_id = martyrdom_cases.id AND ao.output_type = 'readiness'
             ORDER BY ao.version DESC LIMIT 1
           ) AS "readinessScore"
    FROM martyrdom_cases WHERE id = ${caseId} LIMIT 1
  `));
  const c = (cr?.rows ?? cr ?? [])[0];
  if (!c) throw new Error(`사건 없음: caseId=${caseId}`);

  /* 최근 전략 산출물 로드 */
  const latestStrategy = await loadLatestOutputForFamily(caseId, "strategy");
  /* 최근 부족 증거 액션 */
  const actRes: any = await db.execute(sql.raw(`
    SELECT item FROM martyrdom_actions
    WHERE case_id = ${caseId} AND status != 'done'
    ORDER BY sort_order, created_at
    LIMIT 5
  `));
  const pendingActions = (actRes?.rows ?? actRes ?? []).map((r: any) => String(r.item || ""));

  /* 임박 기한 */
  const dlRes: any = await db.execute(sql.raw(`
    SELECT label, due_date AS "dueDate"
    FROM martyrdom_deadlines
    WHERE case_id = ${caseId} AND status = 'pending'
    ORDER BY due_date ASC LIMIT 3
  `));
  const deadlines = (dlRes?.rows ?? dlRes ?? []).map((r: any) =>
    `${r.label} (${String(r.dueDate || "").slice(0, 10)})`
  );

  const statusLabel: Record<string, string> = {
    intake: "초기 접수",
    collection: "자료 수집",
    analysis: "전략 분석",
    draft: "서면 초안 작성",
    hearing: "심의 진행",
    appeal: "이의신청",
    closed: "종결",
  };

  const prompt = `당신은 교사 유가족에게 순직 인정 절차를 쉬운 말로 설명하는 복지사입니다.

다음은 현재 사건 진행 상황입니다:
- 사건: ${c.deceasedName ? `${c.deceasedName} 선생님` : c.caseNo}
- 현재 단계: ${statusLabel[c.status] || c.status}
- 준비도: ${c.readinessScore !== null && c.readinessScore !== undefined ? `${Math.round(Number(c.readinessScore))}%` : "분석 전"}
${latestStrategy ? `- 전략 요약: ${latestStrategy}` : ""}
${pendingActions.length > 0 ? `- 아직 보완이 필요한 자료: ${pendingActions.join(", ")}` : ""}
${deadlines.length > 0 ? `- 중요 기한: ${deadlines.join(" / ")}` : ""}

다음 형식으로 JSON을 반환하세요. 법률 용어나 행정 용어는 **쉬운 말로 풀어서** 작성하세요:
{
  "contentText": "250자 내외의 현재 상황 설명 (유족이 이해할 수 있는 쉬운 표현)",
  "nextSteps": ["다음에 해야 할 일 1", "다음에 해야 할 일 2", "다음에 해야 할 일 3"]
}`;

  const fallbackContent = `${c.deceasedName ? `${c.deceasedName} 선생님` : "해당"} 사건은 현재 "${statusLabel[c.status] || c.status}" 단계로 진행 중입니다.${c.readinessScore !== null && c.readinessScore !== undefined ? ` 인정 준비도는 ${Math.round(Number(c.readinessScore))}%입니다.` : ""}`;
  const fallbackSteps = pendingActions.length > 0 ? pendingActions.slice(0, 3) : ["담당 간사에게 문의하세요"];

  let contentText = fallbackContent;
  let nextSteps = fallbackSteps;

  try {
    const result = await callGeminiJSON<{ contentText: string; nextSteps: string[] }>(prompt, {
      featureKey: "martyrdom_ai",
      timeoutMs: 30000,
    });
    if (result?.data?.contentText) contentText = String(result.data.contentText).slice(0, 500);
    if (Array.isArray(result?.data?.nextSteps)) {
      nextSteps = result.data.nextSteps.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 5);
    }
  } catch (aiErr: any) {
    console.warn(`[buildFamilySummary] AI 호출 실패 (폴백 사용): ${aiErr?.message}`);
  }

  /* ai_outputs에 저장(upsert) */
  const contentJson = JSON.stringify({ nextSteps }).replace(/'/g, "''");
  const safeContent = contentText.replace(/'/g, "''");
  const upsertRes: any = await db.execute(sql.raw(`
    INSERT INTO martyrdom_ai_outputs
      (case_id, output_type, content_text, content_json, status, created_at)
    VALUES
      (${caseId}, 'family_summary', '${safeContent}', '${contentJson}', 'draft', NOW())
    RETURNING id
  `));
  const saved = (upsertRes?.rows ?? upsertRes ?? [])[0];
  const id = Number(saved?.id || 0);

  return { id, outputType: "family_summary", contentText, nextSteps, status: "draft" };
}

async function loadLatestOutputForFamily(caseId: number, outputType: string): Promise<string | null> {
  try {
    const r: any = await db.execute(sql.raw(`
      SELECT content_json FROM martyrdom_ai_outputs
      WHERE case_id = ${caseId} AND output_type = '${outputType}' AND status = 'draft'
      ORDER BY created_at DESC LIMIT 1
    `));
    const row = (r?.rows ?? r ?? [])[0];
    if (!row?.content_json) return null;
    const j = typeof row.content_json === "string" ? JSON.parse(row.content_json) : row.content_json;
    /* strategy JSON에서 핵심 한줄 요약 추출 */
    const summary = j?.overallAssessment?.summary || j?.summary || j?.recommendation?.strategy;
    return summary ? String(summary).slice(0, 200) : null;
  } catch { return null; }
}

/* =========================================================
   P4: buildPublication — 연구 발간지 생성 (R·§9.4)
   ========================================================= */

export interface PublicationResult {
  title: string;
  contentHtml: string;
  contentJson: any;
  ragSources: RagSourceRef[];
  blendRatio: { self: number; ai: number };
  anonymized: boolean;
  reidRisk: "low" | "medium" | "high";
  modelUsed: string;
}

const PUB_TYPE_LABEL: Record<string, string> = {
  guide:      "교사 사망 시 순직 인정 종합 가이드",
  trend:      "순직 인정 최근 동향 보고서",
  case_study: "익명 순직 인정 사례 연구",
};

/**
 * 연구 발간지 본문 생성.
 * - 자체 조사(축적 사건·인정패턴·통계) + AI 동향분석(Gemini 지식 기반) 블렌드
 * - 비식별화 마스킹 + reidRisk 평가
 */
export async function buildPublication(
  pubType: string,
  caseIds: number[],
  blendRatio: { self: number; ai: number } = { self: 70, ai: 30 },
  maskLevel: "light" | "medium" | "full" = "medium",
): Promise<PublicationResult> {
  const typeLabel = PUB_TYPE_LABEL[pubType] || pubType;

  /* 자체 조사 데이터 수집 */
  const selfData = await collectSelfData(caseIds);

  /* RAG 검색 (법령·인정사례) */
  let ragSources: RagSourceRef[] = [];
  try {
    const { searchRag } = await import("./ai-embedding");
    const hits = await searchRag(`${typeLabel} 순직 인정 법령 기준 심의 패턴`, 8, ["martyr_case", "martyr_law"]);
    ragSources = hits.map((h: any) => ({
      title:     String(h.title || "").slice(0, 100),
      sourceRef: String(h.sourceRef || h.source_ref || "").slice(0, 100),
      snippet:   String(h.content || h.snippet || "").slice(0, 200),
    }));
  } catch (ragErr: any) {
    console.warn(`[buildPublication] RAG 검색 실패: ${ragErr?.message}`);
  }

  /* 비식별화 마스킹 */
  const maskedData = maskCaseData(selfData, maskLevel);

  /* reidRisk 평가 */
  const reidRisk = evaluateReidRisk(maskedData, maskLevel);

  /* AI 동향분석 섹션 (blendRatio.ai > 0 일 때만) */
  let aiSection = "";
  let modelUsed = "none";
  if (blendRatio.ai > 0) {
    try {
      const aiPrompt = buildPublicationPrompt(pubType, typeLabel, maskedData, ragSources, blendRatio);
      const aiResult = await callGemini(aiPrompt, {
        featureKey: "martyrdom_ai",
        timeoutMs: 120000,
        internalBulk: true,
      });
      // callGemini는 { ok, text } 반환 — .text 추출(이전 String(aiResult)는 "[object Object]" 버그)
      aiSection = (aiResult && aiResult.ok && aiResult.text) ? String(aiResult.text).trim() : "";
      aiSection = aiSection.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();   // 코드펜스 제거
      modelUsed = "gemini";
    } catch (aiErr: any) {
      console.warn(`[buildPublication] AI 생성 실패 (자체 데이터만 사용): ${aiErr?.message}`);
      aiSection = "";
    }
  }

  /* HTML 조합 */
  const contentHtml = buildPublicationHtml(pubType, typeLabel, maskedData, aiSection, blendRatio, ragSources);
  const contentJson = {
    pubType,
    blendRatio,
    maskLevel,
    sections: extractSections(contentHtml),
    selfDataSummary: maskedData.summary,
    ragSourceCount: ragSources.length,
  };

  const title = typeLabel;
  return {
    title,
    contentHtml,
    contentJson,
    ragSources,
    blendRatio,
    anonymized: true,
    reidRisk,
    modelUsed,
  };
}

/* 자체 조사 데이터 수집 */
interface SelfData {
  totalCases: number;
  approvedCount: number;
  rejectedCount: number;
  recognitionRate: number;
  byType: Array<{ type: string; total: number; approved: number }>;
  patterns: Array<{ caseNo: string; outcome: string; keyPattern: string; caseKind: string }>;
  summary: string;
}

async function collectSelfData(caseIds: number[]): Promise<SelfData> {
  const empty: SelfData = {
    totalCases: 0, approvedCount: 0, rejectedCount: 0,
    recognitionRate: 0, byType: [], patterns: [], summary: "데이터 없음",
  };
  try {
    /* 전체 통계 */
    const statRes: any = await db.execute(sql.raw(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN outcome = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected
      FROM martyrdom_cases WHERE status = 'closed'
    `));
    const st = (statRes?.rows ?? statRes ?? [])[0] || {};
    const total = Number(st.total || 0);
    const approved = Number(st.approved || 0);
    const rejected = Number(st.rejected || 0);

    /* 종류별 통계 — extraction_json->>'caseType' 기준 */
    const typeRes: any = await db.execute(sql.raw(`
      SELECT COALESCE(extraction_json->>'caseType', 'unknown') AS "caseType",
             COUNT(*) AS total,
             SUM(CASE WHEN outcome='approved' THEN 1 ELSE 0 END) AS approved
      FROM martyrdom_cases WHERE status = 'closed'
      GROUP BY COALESCE(extraction_json->>'caseType', 'unknown')
    `));
    const byType = (typeRes?.rows ?? typeRes ?? []).map((r: any) => ({
      type: String(r.caseType || "unknown"),
      total: Number(r.total || 0),
      approved: Number(r.approved || 0),
    }));

    /* 지정 사건 인정패턴 (비식별화 대상) */
    let patterns: SelfData["patterns"] = [];
    if (caseIds.length > 0) {
      const ids = caseIds.map(Number).filter(n => n > 0);
      const patRes: any = await db.execute(sql.raw(`
        SELECT c.case_no AS "caseNo", c.outcome, c.case_kind AS "caseKind",
               (ao.content_json->>'recognitionPattern') AS "keyPattern"
        FROM martyrdom_ai_outputs ao
        JOIN martyrdom_cases c ON c.id = ao.case_id
        WHERE ao.case_id = ANY(ARRAY[${ids.join(",")}]::int[])
          AND ao.output_type = 'strategy' AND ao.status = 'draft'
        ORDER BY ao.case_id, ao.created_at DESC
      `));
      const seen = new Set<string>();
      for (const r of (patRes?.rows ?? patRes ?? [])) {
        if (!seen.has(String(r.caseNo))) {
          seen.add(String(r.caseNo));
          patterns.push({
            caseNo:     String(r.caseNo || ""),
            outcome:    String(r.outcome || ""),
            caseKind:   String(r.caseKind || ""),
            keyPattern: String(r.keyPattern || "").slice(0, 300),
          });
        }
      }
    }

    const rate = total > 0 ? Math.round((approved / total) * 100) / 100 : 0;
    const summary = `총 ${total}건 지원 · 인정 ${approved}건 · 불인정 ${rejected}건 · 인정률 ${Math.round(rate * 100)}%`;
    return { totalCases: total, approvedCount: approved, rejectedCount: rejected, recognitionRate: rate, byType, patterns, summary };
  } catch (e: any) {
    console.warn(`[collectSelfData] 실패: ${e?.message}`);
    return empty;
  }
}

/* 비식별화 마스킹 */
function maskCaseData(data: SelfData, level: "light" | "medium" | "full"): SelfData {
  if (level === "light") return data;
  const patterns = data.patterns.map(p => {
    let caseNo = p.caseNo;
    let keyPattern = p.keyPattern;
    if (level === "medium") {
      caseNo = caseNo.replace(/[가-힣A-Za-z]{2,}/g, "○○").replace(/\d{4}/g, "20XX");
      keyPattern = keyPattern.replace(/[가-힣]{2,4}\s*(선생님|교사|씨)/g, "○○ 선생님");
    } else {
      caseNo = "익명 사례";
      keyPattern = keyPattern.replace(/[가-힣A-Za-z]{2,}/g, "○○");
    }
    return { ...p, caseNo, keyPattern };
  });
  return { ...data, patterns };
}

/* reidRisk 평가 */
function evaluateReidRisk(data: SelfData, level: "light" | "medium" | "full"): "low" | "medium" | "high" {
  if (level === "full") return "low";
  if (level === "medium") return data.totalCases >= 5 ? "low" : "medium";
  return data.totalCases >= 10 ? "medium" : "high";
}

/* AI 프롬프트 빌드 */
function buildPublicationPrompt(
  pubType: string,
  typeLabel: string,
  data: SelfData,
  ragSources: RagSourceRef[],
  blendRatio: { self: number; ai: number },
): string {
  const ragContext = ragSources.slice(0, 5)
    .map(r => `[${r.title}] ${r.snippet}`)
    .join("\n");

  const selfSection = `
자체 축적 데이터:
- ${data.summary}
- 유형별: ${data.byType.map(t => `${t.type}(${t.total}건·인정${t.approved}건)`).join(", ") || "데이터 없음"}
${data.patterns.length > 0 ? `- 주요 인정 패턴: ${data.patterns.filter(p => p.outcome === "approved").slice(0, 3).map(p => p.keyPattern).filter(Boolean).join(" / ")}` : ""}
`;

  const ragSection = ragContext ? `\n관련 법령·사례 근거:\n${ragContext}` : "";

  return `당신은 교사 순직 인정 지원 분야의 전문 연구원입니다.
다음 자료를 바탕으로 "${typeLabel}" 보고서의 **동향분석 섹션**을 작성하세요.
${selfSection}${ragSection}

요구사항:
- HTML 형식으로 반환 (제목은 <h2>, 문단은 <p>, 중요 사항은 <ul><li>)
- 1000자~2000자 분량
- 공무원재해보상법 기반 최근 심의 동향·인정 요건 트렌드 분석
- 구체적 수치나 날짜 주장 시 "추정" 또는 "일반적으로" 표현 사용
- AI·인공지능·Gemini 등 생성 도구나 작성 비율(%)을 본문에 절대 언급하지 말 것 — 외부 발간용 협회 연구 자료로 서술`;
}

/* R41 Q2-053: HTML 이스케이프 — 자체조사·RAG 텍스트를 본문에 raw 삽입하지 않도록 감쌈
   (AI 동향분석 섹션 aiSection은 의도적 HTML이므로 제외) */
function escHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* HTML 조합 */
function buildPublicationHtml(
  pubType: string,
  typeLabel: string,
  data: SelfData,
  aiSection: string,
  blendRatio: { self: number; ai: number },
  ragSources: RagSourceRef[],
): string {
  const selfHtml = `
<h2>자체 조사 결과</h2>
<p>${escHtml(data.summary)}</p>
${data.byType.length > 0 ? `<ul>${data.byType.map(t => `<li>${escHtml(t.type)}: 총 ${t.total}건 · 인정 ${t.approved}건 (인정률 ${t.total > 0 ? Math.round((t.approved / t.total) * 100) : 0}%)</li>`).join("")}</ul>` : ""}
${data.patterns.filter(p => p.outcome === "approved").length > 0 ? `
<h3>주요 인정 패턴 (익명 사례)</h3>
<ul>${data.patterns.filter(p => p.outcome === "approved").map(p => `<li>${escHtml(p.keyPattern || "상세 패턴 없음")}</li>`).join("")}</ul>` : ""}
`;

  const ragHtml = ragSources.length > 0 ? `
<h2>법령·판례 근거</h2>
<ul>${ragSources.slice(0, 5).map(r => `<li><strong>${escHtml(r.title)}</strong>: ${escHtml(r.snippet)}</li>`).join("")}</ul>` : "";

  const aiHtml = aiSection ? `
<h2>동향 분석</h2>
${aiSection}` : "";

  return `<article class="martyrdom-publication">
<h1>${typeLabel}</h1>
<p class="pub-meta">(사)교사유가족협의회 · 비식별화 처리 완료</p>
${selfHtml}${ragHtml}${aiHtml}
<hr>
<p class="disclaimer">본 보고서는 (사)교사유가족협의회의 내부 데이터를 바탕으로 작성된 초안입니다. 외부 발간 전 반드시 법률 전문가 검수를 받으시기 바랍니다.</p>
</article>`;
}

/* HTML에서 섹션 추출 (contentJson용) */
function extractSections(html: string): Array<{ title: string }> {
  const matches = html.matchAll(/<h[12][^>]*>(.*?)<\/h[12]>/gi);
  return Array.from(matches).map(m => ({ title: m[1].replace(/<[^>]+>/g, "").trim() }));
}
