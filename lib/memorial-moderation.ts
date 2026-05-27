// lib/memorial-moderation.ts
// ★ R41 Q2-013: 추모 메시지·편지 작성 시 AI 사전 검토
// - callGeminiJSON(featureKey)가 5층 안전장치(토글·기능예산·전체예산·급증·사용량기록)를 내장 처리
// - fail-open: 기능 꺼짐·예산초과·오류·미응답이면 flagged=false (정상 글을 절대 막지 않음)
// - 부적절 판정 시 호출부가 isHidden=true로 보류 + 운영자/슈퍼어드민 통지

import { callGeminiJSON } from "./ai-gemini";

export interface MemorialModerationResult {
  flagged: boolean;   // true면 부적절 → 작성부에서 isHidden 처리 + 통지
  reason: string;     // 부적절 사유 (운영자 통지용, 40자 내외)
}

/**
 * 추모 공간 콘텐츠(메시지·편지 본문) 부적절 여부 AI 판정.
 * 어떤 경우에도 throw 하지 않으며, 불확실하면 통과(flagged=false)시킨다.
 */
export async function moderateMemorialText(text: string): Promise<MemorialModerationResult> {
  const t = String(text || "").trim().slice(0, 2000);
  if (t.length < 2) return { flagged: false, reason: "" };

  const prompt = `당신은 순직 교사 추모 공간의 콘텐츠 검토자입니다. 아래 글이 추모 공간 게시에 부적절한지 판단하세요.

[부적절 기준] 욕설·인신공격·혐오 표현 / 광고·홍보·스팸 / 고인 또는 유가족 모욕·조롱 / 정치 선동·분란 조장 / 음란·폭력적 표현.
[정상] 추모·애도·위로·회상·감사·응원 등은 모두 정상입니다. 애매하면 정상(false)으로 판단하세요.

JSON으로만 응답하세요(코드블록 금지):
[글]
${t}

응답 형식:
{ "inappropriate": true | false, "reason": "부적절할 때만 사유를 40자 이내로" }`;

  try {
    const result = await callGeminiJSON<{ inappropriate?: boolean; reason?: string }>(prompt, {
      temperature: 0.1,
      maxOutputTokens: 200,
      featureKey: "memorial_moderation",
    });
    // fail-open: 차단·예산초과·오류·빈 응답이면 통과시켜 정상 글을 막지 않음
    if (!result.ok || !result.data) return { flagged: false, reason: "" };
    return {
      flagged: result.data.inappropriate === true,
      reason: String(result.data.reason || "").slice(0, 100),
    };
  } catch {
    return { flagged: false, reason: "" };
  }
}
