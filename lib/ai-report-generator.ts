// lib/ai-report-generator.ts
// ★ Phase M-19-3: Gemini 심층 분석 기반 활동보고서 자동 생성
// - Q69(b) 심층: 인사말 + 핵심 성과 + 트렌드 분석 + 다음 분기 예측 + 총평
// - 출력: 약 3,000자 HTML
// - 비용: 회당 ~$0.02 (gemini-2.0-flash, 출력 ~3500 토큰)

import { callGemini } from "./ai-gemini";
import type { ReportData } from "./report-data-collector";

export interface GeneratedReport {
  title: string;
  greeting: string;       // 인사말 (HTML)
  highlights: string;     // 핵심 성과 (HTML)
  detailedAnalysis: string; // 상세 분석 (HTML)
  trendAnalysis: string;  // 트렌드 분석 (HTML)
  futureOutlook: string;  // 향후 계획 / 예측 (HTML)
  conclusion: string;     // 총평 (HTML)
  fullHtml: string;       // 전체 합본 HTML
  generatedAt: Date;
  aiModel: string;
}

/* ───────── 데이터 → 프롬프트용 텍스트 변환 ───────── */
function summarizeDataForPrompt(data: ReportData): string {
  const d = data.donations;
  const m = data.members;
  const s = data.support;
  const si = data.siren;
  const c = data.campaigns;

  const fmtKRW = (n: number) => "₩" + n.toLocaleString();

  const trendLines = d.monthlyTrend.map(t =>
    `  - ${t.month}: ${fmtKRW(t.amount)} (${t.count}건)`
  ).join("\n") || "  - (데이터 없음)";

  const sourceLines = m.bySourceTop5.map(s =>
    `  - ${s.label}: ${s.count}명`
  ).join("\n") || "  - (데이터 없음)";

  const topCampaignLines = c.topCampaigns.slice(0, 3).map(c =>
    `  - ${c.title} (${c.type}): ${fmtKRW(c.raisedAmount)}` +
    (c.goalAmount ? ` / 목표 ${fmtKRW(c.goalAmount)} (${c.progressPercent}%)` : '') +
    `, ${c.donorCount}명`
  ).join("\n") || "  - (데이터 없음)";

  return `
# 보고 기간
${data.period.label} (${formatDate(data.period.startDate)} ~ ${formatDate(data.period.endDate)})

# 1. 후원 현황
- 총 모금액: ${fmtKRW(d.totalAmount)}
- 후원 건수: ${d.totalCount}건 (정기 ${d.regularCount}건 / 일시 ${d.onetimeCount}건)
- 후원자 수: ${d.donorCount}명
- 평균 후원금: ${fmtKRW(d.avgAmount)} / 최고: ${fmtKRW(d.maxAmount)}
- 결제수단: 카드 ${fmtKRW(d.byPayMethod.card)} / CMS ${fmtKRW(d.byPayMethod.cms)} / 계좌이체 ${fmtKRW(d.byPayMethod.bank)}
- 직전 동일 기간 대비 성장률: ${d.growthRate !== null ? d.growthRate + "%" : "비교 불가"}
- 월별 추이:
${trendLines}

# 2. 회원 현황
- 신규 가입: ${m.newMembersCount}명 (탈퇴 ${m.withdrawnCount}명)
- 종료 시점 활성 회원: ${m.totalMembersAtEnd}명
- 분류별 신규: 후원 ${m.byCategory.sponsor} / 일반 ${m.byCategory.regular} / 유족 ${m.byCategory.family} / 기타 ${m.byCategory.etc}
- 회원 유지율: ${m.retentionRate !== null ? m.retentionRate + "%" : "—"}
- 가입경로 TOP 5:
${sourceLines}

# 3. 유가족 지원 사업
- 총 신청: ${s.totalCount}건 (긴급 ${s.urgentCount}건)
- 완료: ${s.byStatus.completed}건, 진행중: ${s.byStatus.in_progress}건, 검토: ${s.byStatus.reviewing}건
- 카테고리: 심리 ${s.byCategory.counseling} / 법률 ${s.byCategory.legal} / 장학 ${s.byCategory.scholarship} / 기타 ${s.byCategory.other}
- 평균 처리 기간: ${s.avgProcessingDays !== null ? s.avgProcessingDays + "일" : "—"}
- 완료율: ${s.completionRate !== null ? s.completionRate + "%" : "—"}

# 4. 사이렌 (교원 전용 4종)
- 사건 제보: 총 ${si.incident.total}건, 정식 접수 ${si.incident.sirenRequested}건, 답변 ${si.incident.responded}건, 위급 ${si.incident.criticalHigh}건
- 악성민원: 총 ${si.harassment.total}건, 정식 신고 ${si.harassment.sirenRequested}건, 답변 ${si.harassment.responded}건, 위급 ${si.harassment.criticalHigh}건
- 법률 상담: 총 ${si.legal.total}건, 매칭 신청 ${si.legal.sirenRequested}건, 매칭 완료 ${si.legal.matched}건, 긴급 ${si.legal.urgent}건
- 자유게시판: 게시글 ${si.board.totalPosts}건, 댓글 ${si.board.totalComments}건, 고정 ${si.board.pinnedCount}건

# 5. 캠페인
- 활성 캠페인: ${c.activeCampaigns}개, 종료: ${c.closedCampaigns}개
- 캠페인 누적 모금: ${fmtKRW(c.totalRaised)}
- 캠페인 후원자: ${c.totalDonors}명
- 모금액 TOP 3:
${topCampaignLines}
`;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/* ───────── 프롬프트 빌더 ───────── */
function buildReportPrompt(data: ReportData): string {
  const dataText = summarizeDataForPrompt(data);

  return `당신은 NPO "(사)교사유가족협의회"(SIREN)의 활동보고서 전문 작성자입니다.
다음 데이터를 바탕으로 ${data.period.label} 활동보고서를 한국어로 심층 작성하세요.
JSON으로만 응답하세요. 코드블록(\`\`\`)은 사용하지 마세요.

# 입력 데이터
${dataText}

# 응답 형식 (JSON only)
{
  "title": "${data.period.label} 활동보고서 — 따뜻한 동행과 회복의 기록",
  "greeting": "<p>인사말 본문 (HTML, 후원자/회원 분들께 감사 + 기간 활동 요약 — 200~300자, <p>/<strong> 사용)</p>",
  "highlights": "<ul><li><strong>핵심 성과 1</strong> 설명</li>...</ul> (가장 의미 있는 성과 4~6개를 간결한 리스트로, 숫자 강조)",
  "detailedAnalysis": "<h4>1. 후원 현황</h4><p>...</p><h4>2. 회원 동향</h4><p>...</p><h4>3. 지원 사업</h4><p>...</p><h4>4. 사이렌 운영</h4><p>...</p> (각 영역 구체 분석, 숫자 인용, 800~1200자)",
  "trendAnalysis": "<p>직전 기간 대비 변화, 월별 추이의 의미, 패턴 발견을 분석 (300~500자, 객관적 톤)</p>",
  "futureOutlook": "<p>현재 데이터에 기반한 다음 분기/반기의 예상 흐름과 협회의 계획을 제시 (300~500자, 신중한 어조로)</p>",
  "conclusion": "<p>전체를 마무리하는 진심 어린 감사 메시지 (200~300자, 따뜻한 어조)</p>"
}

# 작성 원칙 (★ 매우 중요)
1. **존엄과 진정성**: 교사 유가족의 존엄을 최우선으로. 자극적/선정적 표현 절대 금지.
2. **객관적 분석**: 숫자는 정확히 인용. 추측이나 미확인 사실 금지.
3. **따뜻한 어조**: 통계 보고서이지만 NPO의 진심이 묻어나도록.
4. **HTML 사용 가능**: <p>, <strong>, <ul>, <li>, <h4>, <br />, <em>
5. **구체적**: "많은 분들이 동참했습니다" 보다 "${data.donations.donorCount}명이 함께해 주셨습니다"
6. **트렌드는 신중히**: 단기 데이터로 과대 일반화하지 말 것. "관찰됩니다", "보입니다" 같은 표현 사용.
7. **유가족·교사 회복**이라는 본질을 잊지 말 것.
8. 데이터가 0이거나 적은 경우, 실망스러운 어조 대신 "초기 단계", "기반 마련"으로 표현.
9. 전체 분량은 약 2,500~3,500자.
`;
}

/* ───────── HTML 합본 빌더 ───────── */
function buildFullHtml(parts: Omit<GeneratedReport, "fullHtml" | "generatedAt" | "aiModel">): string {
  return `
<article class="activity-report">
  <header class="ar-header">
    <h1 class="ar-title">${parts.title}</h1>
    <p class="ar-meta">발행일: ${formatDate(new Date())}</p>
  </header>

  <section class="ar-section ar-greeting">
    <h2>📜 인사말</h2>
    ${parts.greeting}
  </section>

  <section class="ar-section ar-highlights">
    <h2>✨ 핵심 성과</h2>
    ${parts.highlights}
  </section>

  <section class="ar-section ar-detail">
    <h2>📊 상세 분석</h2>
    ${parts.detailedAnalysis}
  </section>

  <section class="ar-section ar-trend">
    <h2>📈 트렌드 분석</h2>
    ${parts.trendAnalysis}
  </section>

  <section class="ar-section ar-future">
    <h2>🎯 향후 계획</h2>
    ${parts.futureOutlook}
  </section>

  <section class="ar-section ar-conclusion">
    <h2>🙏 마치며</h2>
    ${parts.conclusion}
  </section>

  <footer class="ar-footer">
    <p>본 보고서는 (사)교사유가족협의회 운영 데이터를 기반으로 자동 생성되었습니다.</p>
    <p>발행일: ${formatDate(new Date())} · 보고 기간: ${formatDate(new Date())}</p>
  </footer>
</article>

<style>
.activity-report { max-width: 800px; margin: 0 auto; font-family: 'Noto Sans KR', sans-serif; line-height: 1.85; color: #2a2a2a; }
.ar-header { text-align: center; padding: 30px 0; border-bottom: 3px double #7a1f2b; margin-bottom: 32px; }
.ar-title { font-family: 'Noto Serif KR', serif; font-size: 26px; color: #3a0d14; margin-bottom: 8px; line-height: 1.4; }
.ar-meta { font-size: 13px; color: #888; }
.ar-section { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px dashed #e0d6d6; }
.ar-section h2 { font-family: 'Noto Serif KR', serif; font-size: 20px; color: #7a1f2b; margin-bottom: 16px; padding-left: 4px; border-left: 4px solid #7a1f2b; padding: 4px 0 4px 12px; }
.ar-section h4 { font-size: 15px; color: #3a0d14; margin: 16px 0 8px; font-weight: 700; }
.ar-section p { margin-bottom: 12px; font-size: 14.5px; }
.ar-section ul { padding-left: 20px; margin-bottom: 14px; }
.ar-section li { margin-bottom: 8px; font-size: 14.5px; }
.ar-section strong { color: #7a1f2b; font-weight: 700; }
.ar-footer { margin-top: 40px; padding: 18px; background: #fafaf8; border-radius: 8px; text-align: center; font-size: 12px; color: #888; }
.ar-footer p { margin: 4px 0; }
</style>
`;
}

/* ───────── 메인 함수 ───────── */
export async function generateActivityReport(data: ReportData): Promise<GeneratedReport> {
  const prompt = buildReportPrompt(data);
  const aiModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const r = await callGemini(prompt, {
    temperature: 0.7,
    maxOutputTokens: 8000,
  });

  if (!r.ok || !r.text) {
    throw new Error(`AI 보고서 생성 실패: ${r.error || "응답 없음"}`);
  }

  /* JSON 파싱 (Gemini가 종종 코드블록 감싸는 경우 처리) */
  let parsed: any = null;
  try {
    let text = r.text.trim();
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("[ai-report-generator] JSON 파싱 실패:", r.text?.slice(0, 300));
    throw new Error("AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.");
  }

  /* 필수 필드 검증 */
  const requiredFields = ["title", "greeting", "highlights", "detailedAnalysis", "trendAnalysis", "futureOutlook", "conclusion"];
  for (const f of requiredFields) {
    if (!parsed[f] || typeof parsed[f] !== "string") {
      throw new Error(`AI 응답에서 ${f} 필드가 누락되었거나 잘못되었습니다`);
    }
  }

  const parts = {
    title: String(parsed.title).slice(0, 300),
    greeting: String(parsed.greeting).slice(0, 5000),
    highlights: String(parsed.highlights).slice(0, 5000),
    detailedAnalysis: String(parsed.detailedAnalysis).slice(0, 8000),
    trendAnalysis: String(parsed.trendAnalysis).slice(0, 4000),
    futureOutlook: String(parsed.futureOutlook).slice(0, 4000),
    conclusion: String(parsed.conclusion).slice(0, 3000),
  };

  const fullHtml = buildFullHtml(parts);

  return {
    ...parts,
    fullHtml,
    generatedAt: new Date(),
    aiModel,
  };
}