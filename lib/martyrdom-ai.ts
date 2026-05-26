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
  const fallback: ClassifyResult = { docType: "other", summary: "(분류 실패)", confidence: 0 };

  const systemPrompt = `당신은 교사 순직 인정 지원 시스템의 자료 분류 전문가입니다.
업로드된 자료를 다음 8대분류 중 하나로 판정하고, 한 줄 요약과 확신도를 반환합니다.

분류 목록:
${DOC_TYPE_LIST}

응답 형식 (JSON만):
{
  "docType": "<code>",
  "summary": "<자료 핵심 내용 한 줄, 50자 이내>",
  "confidence": <0~100 정수>
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
      maxOutputTokens: 512,
    });

    if (!result.ok || !result.text) return fallback;
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        docType: DOC_TYPE_KEYS.includes(parsed.docType) ? parsed.docType : "other",
        summary: String(parsed.summary || "").slice(0, 200),
        confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      };
    } catch { return fallback; }
  }

  /* ── 텍스트형: callGeminiJSON ── */
  if (!text || text.length < 5) {
    return { docType: "other", summary: "(텍스트 없음)", confidence: 0 };
  }

  const truncated = text.slice(0, 4000); // 분류용 입력 최대 4000자
  const userPrompt = `파일명: ${fileName || ""}\n\n자료 내용 (일부):\n${truncated}\n\nJSON만 응답하세요.`;

  const parsed = await callGeminiJSON<ClassifyResult>(
    `${systemPrompt}\n\n${userPrompt}`,
    {
      mode: "flash",
      featureKey: "martyrdom_ai",
      maxOutputTokens: 512,
    }
  );

  if (!parsed.ok || !parsed.data) return fallback;
  const d = parsed.data;
  return {
    docType: DOC_TYPE_KEYS.includes(d.docType) ? d.docType : "other",
    summary: String(d.summary || "").slice(0, 200),
    confidence: Math.min(100, Math.max(0, Number(d.confidence) || 0)),
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
