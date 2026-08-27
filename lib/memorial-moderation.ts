// lib/memorial-moderation.ts
// R41 Q2-013: 추모 메시지·편지 작성 시 AI 사전 검토
// - callGeminiJSON(featureKey)가 5층 안전장치(토글·기능예산·전체예산·급증·사용량기록)를 내장 처리
// - fail-open: 기능 꺼짐·예산초과·오류·미응답이면 flagged=false (정상 글을 절대 막지 않음)
// - 부적절 판정 시 호출부가 isHidden=true로 보류 + 운영자/슈퍼어드민 통지

import { callGeminiJSON } from "./ai-gemini";

export interface MemorialModerationResult {
  flagged: boolean;   // true면 부적절 → 작성부에서 isHidden 처리 + 통지
  reason: string;     // 부적절 사유 (운영자 통지용, 40자 내외)
  /** ★ 2026-08-28: AI가 실제로 판단했는지.
   *  false면 '괜찮다'가 아니라 '못 봤다'는 뜻이다(기능 꺼짐·예산 초과·오류·빈 응답).
   *  로그인한 회원 글은 종전대로 통과시키지만, 익명 글은 호출부에서 보류시킨다. */
  checked: boolean;
  /** 못 본 이유 — 예산이 바닥난 경우를 가려내 운영자에게 알리기 위한 값.
   *  budget: 기능·월 예산 소진 / disabled: 운영자가 기능을 끔 / surge: 급증 보호 / error: 그 외 */
  skipReason?: "budget" | "disabled" | "surge" | "error";
}

/** 검토 등급 — 비회원 글은 관문이 이것 하나뿐이라 좋은 모델로 본다. */
export interface MemorialModerationOptions {
  /** true면 HIGH 체인(생각 기능 켜짐). 로그인하지 않은 분의 글에 쓴다. */
  thorough?: boolean;
}

/**
 * 추모 공간 콘텐츠(메시지·편지 본문) 부적절 여부 AI 판정.
 * 어떤 경우에도 throw 하지 않으며, 불확실하면 통과(flagged=false)시킨다.
 */
export async function moderateMemorialText(
  text: string,
  options: MemorialModerationOptions = {},
): Promise<MemorialModerationResult> {
  const t = String(text || "").trim().slice(0, 2000);
  if (t.length < 2) return { flagged: false, reason: "", checked: true };

  /* ★ 2026-08-28: 비회원 글은 신원이라는 억지력이 없어 이 검토가 유일한 관문이다.
     노골적인 욕설보다 '비꼬는 말·은근한 조롱'이 어려운데, 하필 그게 약한 모델의 약점이다.
     그래서 비회원 글만 HIGH 체인(생각 기능 켜짐)으로 본다. 회원 글은 종전대로 LOW. */
  const thorough = !!options.thorough;

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
      /* HIGH 체인은 생각까지 하므로 넉넉히 준다(부족하면 답이 잘린다) */
      maxOutputTokens: thorough ? 2048 : 200,
      featureKey: "memorial_moderation",
      mode: thorough ? "pro" : "flash",
    });

    /* 못 본 경우 — '괜찮다'가 아니라 '판단 못 함'으로 알린다.
       왜 못 봤는지도 함께 넘긴다(예산 소진이면 운영자에게 알려야 한다). */
    if (!result.ok || !result.data) {
      const why = (result as any).disabledReason as string | undefined;
      const skipReason: MemorialModerationResult["skipReason"] =
        why === "feature_budget_exceeded" || why === "monthly_budget_exceeded" ? "budget"
        : why === "disabled" ? "disabled"
        : why === "surge_cooldown" ? "surge"
        : "error";
      return { flagged: false, reason: "", checked: false, skipReason };
    }
    return {
      flagged: result.data.inappropriate === true,
      reason: String(result.data.reason || "").slice(0, 100),
      checked: true,
    };
  } catch {
    return { flagged: false, reason: "", checked: false, skipReason: "error" };
  }
}
