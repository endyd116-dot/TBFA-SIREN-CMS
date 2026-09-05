// lib/campaign-extras.ts
// 캠페인별 확장 설정 — 「등불의 기적」(2026-09-06 · AutoMarketing 연동) 단일 출처.
//
// 캠페인 본문·제목·요약·대표 사진은 어드민(캠페인 관리)이 관리한다.
// 여기에는 화면 뼈대에 해당하는 설정만 둔다: 테마·금액 사다리·영향 문구·단체 표기·FAQ 분류·
// 랜딩(withwork) 되돌아가기·postback 주소. 정본: docs/active/2026-09-22-lantern-campaign-handoff.md
//
// 슬러그는 캠페인 표(campaigns.slug)와 반드시 같아야 한다. 환경변수 LANTERN_CAMPAIGN_SLUG 로 바꿀 수 있다.

export interface AmountStep {
  amount: number;
  impact: string;
}

export interface CampaignExtras {
  key: string;
  slug: string;
  theme: "lantern";
  /** S5 — 결제 전에 «후원회원 가입»을 먼저 받는다 */
  requireMembership: boolean;
  /** 제목 위 작은 라벨 */
  eyebrow: string;
  /** 부제 */
  subtitle: string;
  /** 대표 한 줄 */
  headline: string;
  /** S2 — 정기·일시 사다리 */
  ladder: {
    regular: AmountStep[];
    onetime: AmountStep[];
    regularDefault: number;
    onetimeDefault: number;
    minNote: string;
    monthlyHint: string;
  };
  /** S4 — 단체 표기 */
  org: { name: string; businessNo: string; representative: string };
  /** S7 — faqs.category */
  faqCategory: string;
  /** S3 — 기부금영수증 안내(랜딩과 같은 글자) */
  receiptNotice: string;
  /** S10 */
  ogTitle: string;
  ogImageUrl: string;
  /** S6-b — 랜딩 되돌아가기 */
  landing: { base: string; lp: string };
  /** S6-b — 서버 postback */
  postbackUrl: string;
  /** S8 — 증서 문구 */
  certificate: { tagline: string; campaignLabel: string };
  /** S5 — 회칙(정관) 링크 */
  bylawsUrl: string;
  /** 회비 안내 한 줄 */
  feeNotice: string;
  /** AM 완료 화면 버튼 ①·② (통보문 ⑧ join.campaignUrl·join.memorialUrl) */
  campaignUrl: string;
  memorialUrl: string;
}

/* S3 — 랜딩과 같은 글자 */
export const RECEIPT_NOTICE =
  "저희는 사단법인으로, 아직 기부금영수증(세액공제) 발급이 되지 않습니다. 지정되는 날, 이 자리에서 바로 알려드리겠습니다.";

/* [W1] 필수 고지 6문장 — AM 통보문 ⑧ 계약과 글자 그대로(AM 모달·SIREN 모달 동일). 바꾸면 AM에 먼저 회신. */
export const LANTERN_NOTICES = {
  NOTICE_ORG: "이 가입은 사단법인 교사유가족협의회(381-82-00754)의 후원회원 가입입니다. 함께워크(withwork)는 화면만 제공하고, 회원 정보와 후원 내역은 교사유가족협의회 홈페이지(tbfa.co.kr)에 등록·보관됩니다.",
  CONSENT_BYLAWS: "사단법인 교사유가족협의회 회칙(정관)에 따라 후원회원으로 가입하는 데 동의합니다.",
  CONSENT_PRIVACY: "개인정보 수집·이용 동의 — 수집 항목: 이름·연락처·이메일·학교명(선택) / 목적: 후원회원 관리·회비 청구·소식 발송 / 보관: 교사유가족협의회 회원 명부(탈퇴 시까지) / 처리 위탁: 함께워크(화면 제공)·결제대행사(결제)",
  CONSENT_SMS: "협의회 소식·분기 «등불 보고»를 문자·카카오톡으로 받겠습니다.",
  NOTICE_PAY: "카드 명세서에는 사단법인 교사유가족협의회로 표시됩니다. 회비는 특별회비이며 현재 기부금영수증(세액공제)은 발급되지 않습니다.",
  NOTICE_DONE: "후원 내역·해지·증서는 교사유가족협의회 홈페이지 마이페이지에서 보실 수 있습니다.",
} as const;

const WITHWORK_BASE = (process.env.HAMKKE_MARKETING_URL || "https://withwork.tbfa.co.kr").replace(/\/+$/, "");

export const LANTERN_SLUG = (process.env.LANTERN_CAMPAIGN_SLUG || "등불의-기적").trim();

export const LANTERN: CampaignExtras = {
  key: "lantern",
  slug: LANTERN_SLUG,
  theme: "lantern",
  requireMembership: true,
  eyebrow: "교사유가족협의회 후원회원 캠페인",
  subtitle: "아이들의 미래를 밝히신 그 숭고한 등불 — 교사유가족협의회 후원회원 캠페인",
  headline: "그 여름의 질문을 3년째 붙들고 있는 가족들이 있습니다",
  ladder: {
    regular: [
      { amount: 10000, impact: "유가족 첫날 안내 전화와 서류 길잡이" },
      { amount: 30000, impact: "순직 준비 서류 상담 1시간" },
      { amount: 50000, impact: "순직심의 자료 정리 반나절" },
      { amount: 100000, impact: "법률·노무 전문가 소견 한 장의 비용 일부" },
    ],
    onetime: [
      { amount: 10000, impact: "사망 직후 첫날 안내 전화 한 통" },
      { amount: 30000, impact: "순직 준비 서류 상담 1시간" },
      { amount: 50000, impact: "서류 상담 반나절" },
      { amount: 100000, impact: "전문가 소견 한 장의 비용 일부" },
    ],
    regularDefault: 10000,
    onetimeDefault: 30000,
    minNote: "최소 1,000원부터 가능합니다",
    monthlyHint: "월 1만 원 = 하루 330원",
  },
  org: { name: "사단법인 교사유가족협의회", businessNo: "381-82-00754", representative: "박두용" },
  faqCategory: "lantern",
  receiptNotice: RECEIPT_NOTICE,
  ogTitle: "등불의 기적 — 교사유가족협의회",
  ogImageUrl: `${WITHWORK_BASE}/img/am-landing/120/1787677318802_1crfbnad.jpg`,
  landing: { base: WITHWORK_BASE, lp: "tbfa-lantern-v2" },
  postbackUrl: (process.env.WITHWORK_LIT_RETURN_URL || `${WITHWORK_BASE}/api/lit-return`).trim(),
  certificate: { tagline: "함께 지키는 사람", campaignLabel: "등불의 기적" },
  bylawsUrl: process.env.LANTERN_BYLAWS_URL || "/resources.html",
  feeNotice: "이 캠페인은 후원회원 모집 캠페인입니다. 모인 후원은 회칙에 따른 특별회비로 순직자 예우와 유가족 지원에 쓰입니다.",
  campaignUrl: `${(process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "")}/campaign.html?slug=${encodeURIComponent(LANTERN_SLUG)}`,
  memorialUrl: `${(process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "")}/memorial.html`,
};

const ALL: CampaignExtras[] = [LANTERN];

/** 슬러그로 확장 설정 조회 (없으면 null) */
export function getCampaignExtras(slug: string | null | undefined): CampaignExtras | null {
  const s = String(slug || "").trim();
  if (!s) return null;
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* 그대로 */ }
  return ALL.find((x) => x.slug === s || x.slug === decoded) || null;
}

/** 캠페인 id → 확장 설정 (campaigns 표 조회는 호출 측이 slug를 넘긴다) */
export function getCampaignExtrasByKey(key: string): CampaignExtras | null {
  return ALL.find((x) => x.key === key) || null;
}

/** 화면(브라우저)으로 내보내는 공개 부분 — postback 주소는 뺀다 */
export function toPublicExtras(x: CampaignExtras | null) {
  if (!x) return null;
  return {
    key: x.key,
    slug: x.slug,
    theme: x.theme,
    requireMembership: x.requireMembership,
    eyebrow: x.eyebrow,
    subtitle: x.subtitle,
    headline: x.headline,
    ladder: x.ladder,
    org: x.org,
    faqCategory: x.faqCategory,
    receiptNotice: x.receiptNotice,
    landing: x.landing,
    certificate: x.certificate,
    bylawsUrl: x.bylawsUrl,
    feeNotice: x.feeNotice,
    campaignUrl: x.campaignUrl,
    memorialUrl: x.memorialUrl,
    notices: LANTERN_NOTICES,
  };
}
