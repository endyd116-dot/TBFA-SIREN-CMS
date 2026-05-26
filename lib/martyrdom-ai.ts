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
import { searchRag, RagHit } from "./ai-embedding";
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
      maxOutputTokens: 1536, // ★ 설명 섞여도 JSON 안 잘리게(512→1536)
      timeoutMs: 90000, // ★ background Vision 분류 — 8초 기본은 짧음
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
      maxOutputTokens: 1536, // ★ 설명 섞여도 JSON 안 잘리게(512→1536)
      timeoutMs: 30000, // ★ background 텍스트 분류 — 8초 기본 상향
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
      timeoutMs: 120000, // ★ background 사건 구조 추출(대용량 입력·4096 출력) — 8초 기본 상향
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
   ⚠️ 응답 JSON 키는 §P2.2 계약과 1:1(A mock 동일). 1글자도 변경 금지.
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
