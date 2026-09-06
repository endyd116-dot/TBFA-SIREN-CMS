// lib/campaign-extras.ts
// 캠페인별 확장 설정 — 「등불의 기적」(2026-09-06 · AutoMarketing 연동).
//
// ★ 2026-09-06 어드민 관리 전환(Swain: "하드코딩 말고 제주 캠페인처럼 관리"):
//   화면 문구(라벨·부제·대표 한 줄)·금액 사다리·단체 표기·회비 안내·증서 문구·FAQ 분류·회칙 링크·OG 제목/사진 같은 «내용»은
//   campaigns.extras(jsonb)에 저장되고 싸이렌 어드민 › 캠페인 관리 편집 창 «등불 테마·확장 설정»에서 고친다.
//   이 파일의 LANTERN 상수는 ① 등불 슬러그의 기본값(저장값 없을 때) ② 편집 창의 시드·자리표시
//   ③ 랜딩(withwork) 되돌아가기·postback 주소와 [W1] 계약 문구(env·코드 고정 — AM과의 계약)만 맡는다.
//   저장값 읽기 = resolveCampaignExtras(비동기·DB·60초 캐시) — 화면·API·결제 게이트가 쓴다.
//   getCampaignExtras(동기)는 코드 기본값만 돌려준다(연동 주소 등 시스템 값 용도).
//
// 슬러그는 캠페인 표(campaigns.slug)와 반드시 같아야 한다. 환경변수 LANTERN_CAMPAIGN_SLUG 로 바꿀 수 있다.
// 정본: docs/active/2026-09-22-lantern-campaign-handoff.md

import { sql } from "drizzle-orm";
import { db } from "../db";

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
  /* AM 회신 ⑨(2026-09-06 05:40): 명세서 문장은 포트원(사단법인 명의 PG) 전환 때만 켠다 — KICC 단계엔 0. 회비 문장은 항상 */
  NOTICE_PAY_STATEMENT: "카드 명세서에는 사단법인 교사유가족협의회로 표시됩니다.",
  NOTICE_PAY_FEE: "회비는 특별회비이며 현재 기부금영수증(세액공제)은 발급되지 않습니다.",
  NOTICE_DONE: "후원 내역·해지·증서는 교사유가족협의회 홈페이지 마이페이지에서 보실 수 있습니다.",
} as const;

/** 포트원(사단법인 명의) 채널이 켜져 있는가 — env 등록 순간 true */
export function portoneEnabled(): boolean {
  return !!((process.env.PORTONE_STORE_ID || "").trim() && (process.env.PORTONE_CHANNEL_KEY || "").trim());
}

/** 결제 단계 고지(NOTICE_PAY) — KICC 단계: 회비 문장만 · 포트원 단계: 명세서 문장 + 회비 문장 */
export function noticePay(): string {
  return portoneEnabled()
    ? `${LANTERN_NOTICES.NOTICE_PAY_STATEMENT} ${LANTERN_NOTICES.NOTICE_PAY_FEE}`
    : LANTERN_NOTICES.NOTICE_PAY_FEE;
}

const WITHWORK_BASE = (process.env.HAMKKE_MARKETING_URL || "https://withwork.tbfa.co.kr").replace(/\/+$/, "");
const SITE_BASE = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

export const LANTERN_SLUG = (process.env.LANTERN_CAMPAIGN_SLUG || "등불의-기적").trim();

/** 등불 슬러그의 코드 기본값 — 저장값(campaigns.extras)이 없을 때·편집 창 시드 */
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
  campaignUrl: `${SITE_BASE}/campaign.html?slug=${encodeURIComponent(LANTERN_SLUG)}`,
  memorialUrl: `${SITE_BASE}/memorial.html`,
};

const ALL: CampaignExtras[] = [LANTERN];

/** 슬러그로 «코드 기본값» 조회 (없으면 null) — 저장값은 보지 않는다(연동 주소 등 시스템 값 용도) */
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
    notices: { ...LANTERN_NOTICES, NOTICE_PAY: noticePay() },
  };
}

/* ────────────────────────────────────────────────────────────
   어드민 저장값 (campaigns.extras jsonb)
   ──────────────────────────────────────────────────────────── */

/** 어드민에서 고칠 수 있는 «내용» — 연동 주소·계약 문구(landing·postbackUrl·notices·receiptNotice)는 제외 */
export interface StoredExtras {
  theme?: "lantern" | "default";
  requireMembership?: boolean;
  eyebrow?: string;
  subtitle?: string;
  headline?: string;
  ladder?: Partial<CampaignExtras["ladder"]>;
  org?: Partial<CampaignExtras["org"]>;
  faqCategory?: string;
  feeNotice?: string;
  bylawsUrl?: string;
  certificate?: Partial<CampaignExtras["certificate"]>;
  ogTitle?: string;
  ogImageUrl?: string;
}

/** 슬러그별 코드 기본값 — 등불 슬러그는 LANTERN, 그 밖의 캠페인이 등불 테마를 켜면 같은 뼈대에 그 슬러그를 넣는다 */
export function defaultExtrasFor(slug: string | null | undefined): CampaignExtras {
  const s = String(slug || "").trim();
  const found = getCampaignExtras(s);
  if (found) return found;
  return {
    ...LANTERN,
    key: `lantern:${s}`,
    slug: s,
    campaignUrl: `${SITE_BASE}/campaign.html?slug=${encodeURIComponent(s)}`,
  };
}

function str(v: any, max: number): string {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function cleanSteps(v: any, fallback: AmountStep[]): AmountStep[] {
  if (!Array.isArray(v)) return fallback;
  const out: AmountStep[] = [];
  for (const s of v.slice(0, 6)) {
    const amount = Math.round(Number(s?.amount));
    if (!Number.isFinite(amount) || amount < 1000 || amount > 100_000_000) continue;
    out.push({ amount, impact: str(s?.impact, 80) });
  }
  return out.length ? out : fallback;
}

function cleanAmount(v: any): number | undefined {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1000 && n <= 100_000_000 ? n : undefined;
}

/** 어드민 입력 → 저장 가능한 모양(검증·길이 제한). theme 'default'면 {theme:'default'}만 저장. null → 저장값 없음 */
export function sanitizeExtrasInput(input: any): StoredExtras | null {
  if (input == null || typeof input !== "object") return null;
  if (input.theme !== "lantern") return { theme: "default" };
  const out: StoredExtras = { theme: "lantern", requireMembership: input.requireMembership !== false };

  const eyebrow = str(input.eyebrow, 200); if (eyebrow) out.eyebrow = eyebrow;
  const subtitle = str(input.subtitle, 300); if (subtitle) out.subtitle = subtitle;
  const headline = str(input.headline, 200); if (headline) out.headline = headline;
  const feeNotice = str(input.feeNotice, 300); if (feeNotice) out.feeNotice = feeNotice;

  if (input.ladder && typeof input.ladder === "object") {
    const L: any = {};
    const reg = cleanSteps(input.ladder.regular, []); if (reg.length) L.regular = reg;
    const one = cleanSteps(input.ladder.onetime, []); if (one.length) L.onetime = one;
    const rd = cleanAmount(input.ladder.regularDefault); if (rd) L.regularDefault = rd;
    const od = cleanAmount(input.ladder.onetimeDefault); if (od) L.onetimeDefault = od;
    const minNote = str(input.ladder.minNote, 100); if (minNote) L.minNote = minNote;
    const monthlyHint = str(input.ladder.monthlyHint, 100); if (monthlyHint) L.monthlyHint = monthlyHint;
    if (Object.keys(L).length) out.ladder = L;
  }

  if (input.org && typeof input.org === "object") {
    const O: any = {};
    const name = str(input.org.name, 100); if (name) O.name = name;
    const businessNo = str(input.org.businessNo, 20); if (businessNo) O.businessNo = businessNo;
    const representative = str(input.org.representative, 50); if (representative) O.representative = representative;
    if (Object.keys(O).length) out.org = O;
  }

  const faq = str(input.faqCategory, 40); if (faq && /^[a-z0-9_-]+$/i.test(faq)) out.faqCategory = faq;
  const bylaws = str(input.bylawsUrl, 300); if (bylaws && /^(https?:\/\/|\/)/.test(bylaws)) out.bylawsUrl = bylaws;

  if (input.certificate && typeof input.certificate === "object") {
    const C: any = {};
    const tagline = str(input.certificate.tagline, 60); if (tagline) C.tagline = tagline;
    const campaignLabel = str(input.certificate.campaignLabel, 60); if (campaignLabel) C.campaignLabel = campaignLabel;
    if (Object.keys(C).length) out.certificate = C;
  }

  const ogTitle = str(input.ogTitle, 120); if (ogTitle) out.ogTitle = ogTitle;
  const ogImageUrl = str(input.ogImageUrl, 500); if (ogImageUrl && /^https?:\/\//.test(ogImageUrl)) out.ogImageUrl = ogImageUrl;
  return out;
}

/** 저장값을 코드 기본값 위에 얹는다(순수). 저장값 없음 → 등불 슬러그만 기본값. theme 'default' → null(기본 캠페인 화면) */
export function mergeStoredExtras(slug: string, stored: StoredExtras | null | undefined): CampaignExtras | null {
  const isLanternSlug = !!getCampaignExtras(slug);
  if (!stored || typeof stored !== "object") return isLanternSlug ? getCampaignExtras(slug) : null;
  if (stored.theme !== "lantern") return null;
  const base = defaultExtrasFor(slug);
  const L: any = stored.ladder || {};
  return {
    ...base,
    requireMembership: stored.requireMembership !== false,
    eyebrow: stored.eyebrow || base.eyebrow,
    subtitle: stored.subtitle || base.subtitle,
    headline: stored.headline || base.headline,
    ladder: {
      regular: cleanSteps(L.regular, base.ladder.regular),
      onetime: cleanSteps(L.onetime, base.ladder.onetime),
      regularDefault: cleanAmount(L.regularDefault) || base.ladder.regularDefault,
      onetimeDefault: cleanAmount(L.onetimeDefault) || base.ladder.onetimeDefault,
      minNote: str(L.minNote, 100) || base.ladder.minNote,
      monthlyHint: str(L.monthlyHint, 100) || base.ladder.monthlyHint,
    },
    org: {
      name: str(stored.org?.name, 100) || base.org.name,
      businessNo: str(stored.org?.businessNo, 20) || base.org.businessNo,
      representative: str(stored.org?.representative, 50) || base.org.representative,
    },
    faqCategory: str(stored.faqCategory, 40) || base.faqCategory,
    feeNotice: str(stored.feeNotice, 300) || base.feeNotice,
    bylawsUrl: str(stored.bylawsUrl, 300) || base.bylawsUrl,
    certificate: {
      tagline: str(stored.certificate?.tagline, 60) || base.certificate.tagline,
      campaignLabel: str(stored.certificate?.campaignLabel, 60) || base.certificate.campaignLabel,
    },
    ogTitle: str(stored.ogTitle, 120) || base.ogTitle,
    ogImageUrl: str(stored.ogImageUrl, 500) || base.ogImageUrl,
  };
}

/* 저장값 캐시 — 함수 인스턴스 안에서 60초 */
const _cache = new Map<string, { at: number; slug: string; stored: StoredExtras | null }>();
const CACHE_TTL_MS = 60_000;

export function invalidateExtrasCache(): void {
  _cache.clear();
}

/** campaigns.extras 읽기 — extras 컬럼이 아직 없으면(마이그 전) 저장값 없음으로 조용히 처리 */
export async function readStoredExtras(ref: { id?: number | null; slug?: string | null }): Promise<{ slug: string; stored: StoredExtras | null } | null> {
  const id = ref.id ? Number(ref.id) : 0;
  let slug = String(ref.slug || "").trim();
  const key = id ? `id:${id}` : slug ? `slug:${slug}` : "";
  if (!key) return null;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { slug: hit.slug || slug, stored: hit.stored };

  let stored: StoredExtras | null = null;
  try {
    const r: any = id
      ? await db.execute(sql`SELECT slug, extras FROM campaigns WHERE id = ${id} LIMIT 1`)
      : await db.execute(sql`SELECT slug, extras FROM campaigns WHERE slug = ${slug} LIMIT 1`);
    const row = (r?.rows ?? r ?? [])[0];
    if (row) {
      slug = String(row.slug || slug);
      const raw = row.extras;
      if (raw && typeof raw === "object") stored = raw as StoredExtras;
      else if (typeof raw === "string") { try { stored = JSON.parse(raw); } catch { stored = null; } }
    }
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (!/extras/i.test(msg)) console.warn("[campaign-extras] 저장값 조회 실패:", msg);
    if (!slug && id) {
      try {
        const r2: any = await db.execute(sql`SELECT slug FROM campaigns WHERE id = ${id} LIMIT 1`);
        slug = String((r2?.rows ?? r2 ?? [])[0]?.slug || "");
      } catch { /* 그대로 */ }
    }
  }
  _cache.set(key, { at: Date.now(), slug, stored });
  return { slug, stored };
}

/**
 * 화면·API·결제 게이트가 쓰는 확장 설정 — 저장값(어드민) 우선, 없으면 등불 슬러그만 코드 기본값.
 * ref.extras 를 이미 들고 있으면(어드민 조회 등) DB를 다시 읽지 않는다.
 */
export async function resolveCampaignExtras(ref: { id?: number | null; slug?: string | null; extras?: any }): Promise<CampaignExtras | null> {
  if (ref.extras !== undefined && ref.slug) return mergeStoredExtras(String(ref.slug), ref.extras);
  const r = await readStoredExtras(ref);
  if (!r) return null;
  return mergeStoredExtras(r.slug, r.stored);
}
