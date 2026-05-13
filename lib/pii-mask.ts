/**
 * AI 응답 개인정보 자동 마스킹
 *
 * 마스킹 대상 (어드민이 봐도 위험·민감):
 *   - 주민등록번호 (XXXXXX-XXXXXXX) → XXXXXX-*******
 *   - 카드번호 (4-4-4-4) → 4-****-****-4
 *   - 계좌번호 (10~16자리) → 4앞·4뒤만 노출
 *
 * 마스킹 제외 (어드민 업무에 필요):
 *   - 전화번호 (010-XXXX-XXXX)
 *   - 이메일 주소
 *
 * 환경변수:
 *   AI_PII_MASK_DISABLED=true 설정 시 마스킹 비활성 (테스트용)
 */

export interface MaskResult {
  masked: string;
  redactCount: number;
}

const DISABLED = process.env.AI_PII_MASK_DISABLED === "true";

export function maskPII(text: string): MaskResult {
  if (DISABLED || !text || typeof text !== "string") {
    return { masked: text || "", redactCount: 0 };
  }

  let masked = text;
  let count = 0;

  /* 1) 주민등록번호 — XXXXXX-XXXXXXX 또는 XXXXXXXXXXXXX (13자리 연속) */
  masked = masked.replace(/(\d{6})-?(\d)(\d{6})/g, (m, p1, p2) => {
    /* 첫 자리 (성별 코드) 1~4면 주민번호 가능성 높음 */
    if (!/^[1-4]$/.test(p2)) return m;
    count++;
    return `${p1}-${p2}******`;
  });

  /* 2) 카드번호 — 4-4-4-4 또는 16자리 연속 */
  masked = masked.replace(/\b(\d{4})[\s-]?\d{4}[\s-]?\d{4}[\s-]?(\d{4})\b/g, (m, p1, p2) => {
    count++;
    return `${p1}-****-****-${p2}`;
  });

  /* 3) 계좌번호 — 10~16자리 숫자 (전화번호 010-... 형식은 이미 제외).
        전화번호(010·011·02 등 + 하이픈)는 매칭 안 함. */
  masked = masked.replace(/\b\d{10,16}\b/g, (m) => {
    /* 전화번호 형태(01x로 시작 + 11자리 이내)는 제외 */
    if (/^01\d{9}$/.test(m)) return m;
    /* 카드번호(16자리)는 이미 처리됐을 것 — 안전망 */
    if (m.length === 16) return m;
    count++;
    return m.slice(0, 4) + "*".repeat(m.length - 8) + m.slice(-4);
  });

  return { masked, redactCount: count };
}

/** 어드민·진단용 — 마스킹 활성 여부 */
export function isMaskEnabled(): boolean {
  return !DISABLED;
}
