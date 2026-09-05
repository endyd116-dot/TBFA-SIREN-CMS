// lib/lantern-am.ts
// AutoMarketing 랜딩 모달 ↔ SIREN 서버-서버 연동 핵심 (통보문 ⑧ · 2026-09-06)
//
//  [W3-1] amUpsertMember   — 후원회원 가입(쿠키 0) · 이메일→휴대폰 순 기존 판정 · 동의 증빙은 audit_logs
//  [W3-2] amCreateIntent   — 결제 의도: bank(입금 대기)·cms(효성)·card/easy/transfer(KICC 지금 · 포트원 준비되면 스위치)
//         amIntentSummary  — 결제 페이지용 공개 요약(개인정보 0)
//         amStartKiccPayment — 미리 채워진 결제 페이지에서 KICC 결제창 주소 발급
//  [W3-3] amSaveNote       — 「선생님께 한마디」·공개 동의
//  absorbLanternIntent     — 입금 확인·효성 명세 반영으로 «완료» 행이 생길 때 대기 중 의도를 이어 붙여 등불을 켠다
//
//  화면(랜딩 모달)은 AM이 갖고, 회원 명부·후원 원장·증서·해지·마이페이지는 전부 SIREN(사장님 결정 2026-09-06).

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { members, donations, donationPolicies, billingKeys, campaigns } from "../db/schema";
import { LANTERN, LANTERN_NOTICES, RECEIPT_NOTICE, getCampaignExtras, noticePay, type CampaignExtras } from "./campaign-extras";
import {
  findExistingSponsor, createSponsorMember, saveSponsorFields, normalizePhone, isValidEmail,
} from "./sponsor-member";
import {
  ensureMemberHash, resolveMemberHash, newIntentId, isIntentId, sanitizeAmMeta,
  saveDonationSourceMeta, afterLanternCompletion, readDonationLantern, findDonationByIntent,
  maskName, buildLandingReturnUrl,
} from "./lantern";
import { logAudit } from "./audit";
import { notifyAllOperators } from "./notify";
import { registerTrade, generateShopOrderNo } from "./kicc";
import { recalcCampaignStatsSafe } from "./campaign-stats";
import { generateTransactionId } from "../db";

const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");

export class AmError extends Error {
  status: number;
  step: string;
  constructor(status: number, message: string, step = "validate") {
    super(message);
    this.status = status;
    this.step = step;
  }
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

async function lanternCampaignId(extras: CampaignExtras): Promise<number> {
  const [c] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.slug, extras.slug)).limit(1);
  if (!c) throw new AmError(500, "캠페인이 아직 생성되지 않았습니다", "campaign");
  return c.id;
}

async function loadMemberByHash(memberIdHash: string) {
  const id = await resolveMemberHash(String(memberIdHash || ""));
  if (!id) throw new AmError(404, "회원을 찾을 수 없습니다(memberId)", "member");
  const [m] = await db.select({ id: members.id, name: members.name, email: members.email, phone: members.phone, status: members.status })
    .from(members).where(eq(members.id, id)).limit(1);
  if (!m || m.status === "withdrawn" || m.status === "suspended") throw new AmError(403, "이용할 수 없는 회원입니다", "member");
  return m;
}

/* ═══════════════════════════════════════════════════════
   [W3-1] 후원회원 가입
   ═══════════════════════════════════════════════════════ */
export interface AmMemberInput {
  campaignSlug?: string;
  name: string;
  phone: string;
  email: string;
  school?: string;
  consents?: { bylaws?: boolean; privacy?: boolean; sms?: boolean };
  consentText?: { bylaws?: string; privacy?: string };
  consentAt?: string;
  ip?: string;
  ua?: string;
  am_lp?: string;
  am_anon?: string;
  gate?: string;
}

export async function amUpsertMember(body: AmMemberInput): Promise<{ memberId: string; status: "new" | "existing"; id: number }> {
  const extras = getCampaignExtras(body.campaignSlug || LANTERN.slug) || LANTERN;
  const name = String(body.name || "").trim().slice(0, 50);
  const email = String(body.email || "").trim().toLowerCase();
  const phone = normalizePhone(String(body.phone || ""));
  const school = String(body.school || "").trim().slice(0, 150) || null;
  const consents = body.consents || {};

  if (name.length < 2) throw new AmError(400, "이름을 2자 이상 입력해 주세요");
  if (!email || !isValidEmail(email) || email.length > 100) throw new AmError(400, "올바른 이메일을 입력해 주세요");
  if (!phone) throw new AmError(400, "올바른 휴대폰 번호를 입력해 주세요 (예: 010-1234-5678)");
  if (consents.bylaws !== true) throw new AmError(400, "회칙(정관)에 따른 후원회원 가입 동의가 필요합니다");
  if (consents.privacy !== true) throw new AmError(400, "개인정보 수집·이용 동의가 필요합니다");

  const existing = await findExistingSponsor(email, phone);
  let id: number;
  let status: "new" | "existing";
  if (existing) {
    id = existing.row.id;
    status = "existing";
    await saveSponsorFields(id, school, true);   // 회원 정보 갱신 0 · 회칙 시각·학교명만 COALESCE
  } else {
    const created = await createSponsorMember({
      name, email, phone, schoolName: school, agreeSms: consents.sms === true,
      campaignTitle: extras.certificate.campaignLabel, source: "am_modal",
    });
    id = created.id;
    status = "new";
  }
  const memberId = await ensureMemberHash(id);

  /* 동의 증빙 — audit_logs (회원 id·문구 스냅샷·시각·ip·ua) */
  try {
    await logAudit({
      userId: id,
      userType: "user",
      userName: name,
      action: "sponsor_consent",
      target: `M-${id}`,
      detail: {
        source: "am_modal", status, campaignSlug: extras.slug,
        consents: { bylaws: true, privacy: true, sms: consents.sms === true },
        consentText: {
          bylaws: String(body.consentText?.bylaws || LANTERN_NOTICES.CONSENT_BYLAWS).slice(0, 1000),
          privacy: String(body.consentText?.privacy || LANTERN_NOTICES.CONSENT_PRIVACY).slice(0, 1000),
        },
        consentAt: String(body.consentAt || new Date().toISOString()).slice(0, 40),
        am_lp: String(body.am_lp || "").slice(0, 80) || undefined,
        am_anon: String(body.am_anon || "").slice(0, 120) || undefined,
        gate: String(body.gate || "").slice(0, 2) || undefined,
      },
      ipAddress: String(body.ip || "").slice(0, 45) || null,
      userAgent: String(body.ua || "").slice(0, 500) || null,
    } as any);
  } catch (e) {
    console.warn("[lantern-am] 동의 증빙 기록 실패:", (e as any)?.message);
  }

  return { memberId, status, id };
}

/* ═══════════════════════════════════════════════════════
   [W3-2] 결제 의도
   ═══════════════════════════════════════════════════════ */
export type AmPayMethod = "card" | "easy" | "transfer" | "cms" | "bank";
export interface AmIntentInput {
  memberId: string;
  amount: number;
  monthly: boolean;
  method: AmPayMethod;
  am_lp?: string;
  am_anon?: string;
  gate?: string;
}
export interface AmIntentResult {
  intentId: string;
  provider: "kicc" | "portone" | "hyosung" | "manual";
  redirectUrl?: string;
  payload?: any;
  donationId: number;
  bankAccount?: { bank: string; number: string; holder: string; guideText?: string };
}

function portoneConfigured(): boolean {
  return !!((process.env.PORTONE_STORE_ID || "").trim() && (process.env.PORTONE_CHANNEL_KEY || "").trim());
}

export async function amCreateIntent(body: AmIntentInput): Promise<AmIntentResult> {
  const extras = LANTERN;
  const m = await loadMemberByHash(body.memberId);
  const amount = Number(body.amount);
  const monthly = body.monthly === true;
  const method = String(body.method || "") as AmPayMethod;

  if (!Number.isInteger(amount) || amount < 1000 || amount > 100_000_000) throw new AmError(400, "금액은 1,000원 이상 1억원 이하의 정수여야 합니다");
  const allowed: AmPayMethod[] = monthly ? ["card", "easy", "cms"] : ["card", "easy", "transfer", "bank"];
  if (!allowed.includes(method)) throw new AmError(400, `${monthly ? "정기" : "일시"} 후원에서 고를 수 없는 방식입니다: ${method || "(없음)"}`);

  const campaignId = await lanternCampaignId(extras);
  const intentId = newIntentId();
  const meta = sanitizeAmMeta({ am_lp: body.am_lp || extras.landing.lp, am_anon: body.am_anon, gate: body.gate, intentId }) || { am_lp: extras.landing.lp, intentId };
  const extraMeta = { method, via: "am_modal", monthly };

  /* 정책(계좌·효성 주소) */
  let policy: any = null;
  try { [policy] = await db.select().from(donationPolicies).where(eq(donationPolicies.id, 1)).limit(1); } catch { /* 폴백 */ }
  const bankAccount = {
    bank: policy?.bankName || "우리은행",
    number: policy?.bankAccountNo || "1005-404-940572",
    holder: policy?.bankAccountHolder || "사단법인 교사유가족협의회",
    guideText: policy?.bankGuideText || "입금 확인까지 1~3일 이내 소요될 수 있습니다.",
  };
  const hyosungUrl = policy?.hyosungUrl || "https://ap.hyosungcmsplus.co.kr/external/shorten/20240709hAxVVDFECf";

  /* ① 계좌 직접 입금(일시) — 입금 대기 행 · 관리자 입금 확인 때 absorbLanternIntent → 등불 */
  if (method === "bank") {
    const [rec] = await db.insert(donations).values({
      memberId: m.id,
      donorName: m.name,
      donorPhone: m.phone,
      donorEmail: m.email,
      amount,
      type: "onetime",
      payMethod: "bank",
      status: "pending_bank",
      transactionId: generateTransactionId(),
      pgProvider: "manual",
      isAnonymous: false,
      receiptRequested: true,
      bankDepositorName: m.name,
      campaignId,
    } as any).returning({ id: donations.id });
    await saveDonationSourceMeta(rec.id, meta, extraMeta);
    try {
      await notifyAllOperators({
        category: "donation", severity: "info",
        title: "🕯️ 등불 캠페인 계좌 입금 예정",
        message: `${m.name}님이 ${amount.toLocaleString()}원 계좌 직접 입금을 예정했어요(랜딩 모달). 입금 확인 후 통과 처리하면 등불이 켜집니다.`,
        link: "/admin.html#donations", refTable: "donations", refId: rec.id,
      }, { category: "donation" });
    } catch { /* noop */ }
    return { intentId, provider: "manual", donationId: rec.id, bankAccount };
  }

  /* ② 계좌 자동이체(정기) — 효성 CMS+ 외부 등록 · 명세 반영 때 absorbLanternIntent → 등불 */
  if (method === "cms") {
    const [rec] = await db.insert(donations).values({
      memberId: m.id,
      donorName: m.name,
      donorPhone: m.phone,
      donorEmail: m.email,
      amount,
      type: "regular",
      payMethod: "cms",
      status: "pending_hyosung",
      transactionId: generateTransactionId(),
      pgProvider: "hyosung_cms",
      isAnonymous: false,
      receiptRequested: true,
      campaignId,
    } as any).returning({ id: donations.id });
    await saveDonationSourceMeta(rec.id, meta, extraMeta);
    try {
      await notifyAllOperators({
        category: "donation", severity: "info",
        title: "🕯️ 등불 캠페인 효성 CMS+ 신청 의향",
        message: `${m.name}님이 월 ${amount.toLocaleString()}원 계좌 자동이체(효성)를 신청했어요(랜딩 모달). 효성 명세 반영 때 등불이 켜집니다.`,
        link: "/admin.html#hyosung", refTable: "donations", refId: rec.id,
      }, { category: "donation" });
    } catch { /* noop */ }
    return { intentId, provider: "hyosung", donationId: rec.id, redirectUrl: hyosungUrl };
  }

  /* ③ 카드·간편결제·실시간 계좌이체 — 포트원 준비 전엔 KICC(회원·금액 미리 채운 결제 페이지) */
  if (monthly) {
    const [activeKey] = await db.select({ id: billingKeys.id, amount: billingKeys.amount })
      .from(billingKeys).where(and(eq(billingKeys.memberId, m.id), eq(billingKeys.isActive, true))).limit(1);
    if (activeKey) throw new AmError(409, `이미 활성화된 정기 후원이 있습니다(월 ${Number(activeKey.amount).toLocaleString()}원). 변경은 마이페이지에서 해지 후 다시 등록해 주세요.`, "billing_active");
  }

  if (portoneConfigured()) {
    /* 포트원 단계 — SDK v2 인자를 그대로 돌려준다(AM은 해석하지 않고 넘긴다). 웹훅(portone-webhook)이 완료를 확정한다 */
    const storeId = (process.env.PORTONE_STORE_ID || "").trim();
    const channelKey = (monthly ? (process.env.PORTONE_CHANNEL_KEY_BILLING || process.env.PORTONE_CHANNEL_KEY) : process.env.PORTONE_CHANNEL_KEY)!.trim();
    const [rec] = await db.insert(donations).values({
      memberId: m.id, donorName: m.name, donorPhone: m.phone, donorEmail: m.email, amount,
      type: monthly ? "regular" : "onetime",
      payMethod: method === "easy" ? "simplepay" : method === "transfer" ? "transfer" : "card",
      pgProvider: "portone", status: "pending", pgOrderNo: intentId, campaignId, isAnonymous: false,
    } as any).returning({ id: donations.id });
    await saveDonationSourceMeta(rec.id, meta, extraMeta);
    const customer = { customerId: body.memberId, fullName: m.name, phoneNumber: m.phone || undefined, email: m.email };
    const payMethod = method === "easy" ? "EASY_PAY" : method === "transfer" ? "TRANSFER" : "CARD";
    const payload = monthly
      ? { storeId, channelKey, billingKeyMethod: payMethod === "EASY_PAY" ? "EASY_PAY" : "CARD", issueId: intentId, issueName: `${extras.certificate.campaignLabel} 정기 후원`, customer, redirectUrl: `${SITE_URL}/lantern-pay.html?intent=${intentId}&portone=1` }
      : { storeId, channelKey, paymentId: intentId, orderName: `${extras.certificate.campaignLabel} 후원회원 회비`, totalAmount: amount, currency: "KRW", payMethod, customer, redirectUrl: `${SITE_URL}/lantern-pay.html?intent=${intentId}&portone=1` };
    return { intentId, provider: "portone", donationId: rec.id, payload };
  }

  if (monthly && method !== "card") throw new AmError(400, "정기 간편결제는 결제사 전환(포트원) 뒤에 열립니다. 지금은 카드 또는 계좌 자동이체를 선택해 주세요.", "method");
  const [rec] = await db.insert(donations).values({
    memberId: m.id, donorName: m.name, donorPhone: m.phone, donorEmail: m.email, amount,
    type: monthly ? "regular" : "onetime",
    payMethod: "card",
    pgProvider: "kicc", status: "pending", campaignId, isAnonymous: false,
  } as any).returning({ id: donations.id });
  await saveDonationSourceMeta(rec.id, meta, extraMeta);
  return { intentId, provider: "kicc", donationId: rec.id, redirectUrl: `${SITE_URL}/lantern-pay.html?intent=${intentId}` };
}

/* 결제 페이지용 공개 요약 — 개인정보 0(이름 마스킹) */
export async function amIntentSummary(intentId: string) {
  if (!isIntentId(intentId)) throw new AmError(400, "intent 형식이 올바르지 않습니다");
  const row = await findDonationByIntent(intentId);
  if (!row) throw new AmError(404, "결제 정보를 찾을 수 없습니다", "intent");
  const extras = getCampaignExtras(row.campaignSlug) || LANTERN;
  const meta = sanitizeAmMeta(row.sourceMeta);
  const provider = String((row as any).sourceMeta?.method === "cms" ? "hyosung" : (row as any).sourceMeta?.method === "bank" ? "manual" : "kicc");
  let pgProvider = "";
  try {
    const res: any = await db.execute(sql`SELECT pg_provider FROM donations WHERE id = ${row.id}`);
    pgProvider = String(rowsOf(res)[0]?.pg_provider || "");
  } catch { /* noop */ }
  return {
    intentId,
    donationId: row.id,
    status: row.status,
    provider: pgProvider || provider,
    amount: row.amount,
    monthly: row.type === "regular",
    method: String(row.sourceMeta?.method || ""),
    campaign: { slug: row.campaignSlug, title: row.campaignTitle },
    maskedName: maskName(row.donorName),
    notices: { NOTICE_PAY: noticePay(), NOTICE_DONE: LANTERN_NOTICES.NOTICE_DONE, RECEIPT: RECEIPT_NOTICE },
    returnUrl: buildLandingReturnUrl(extras, meta),
    completed: row.status === "completed",
  };
}

/* 미리 채워진 결제 페이지 → KICC 결제창 주소 */
export async function amStartKiccPayment(intentId: string): Promise<{ authPageUrl: string; pgOrderNo: string }> {
  if (!isIntentId(intentId)) throw new AmError(400, "intent 형식이 올바르지 않습니다");
  const row = await findDonationByIntent(intentId);
  if (!row) throw new AmError(404, "결제 정보를 찾을 수 없습니다", "intent");
  if (row.status === "completed") throw new AmError(409, "이미 결제가 완료된 건입니다", "completed");
  if (row.status !== "pending" && row.status !== "failed") throw new AmError(409, `결제창으로 이동할 수 없는 상태입니다(${row.status})`, "status");

  let pgOrderNo = "";
  for (let i = 0; i < 3; i++) {
    pgOrderNo = generateShopOrderNo(row.type === "regular" ? "SIREN-REG" : "SIREN");
    const [dup] = await db.select({ id: donations.id }).from(donations).where(eq(donations.pgOrderNo, pgOrderNo)).limit(1);
    if (!dup) break;
    if (i === 2) throw new AmError(500, "주문번호 생성 실패", "order_no");
  }
  await db.update(donations).set({ pgOrderNo, pgProvider: "kicc", payMethod: "card", status: "pending", updatedAt: new Date() } as any).where(eq(donations.id, row.id));

  const [m] = await db.select({ email: members.email, name: members.name }).from(members).where(eq(members.id, row.memberId || 0)).limit(1);
  const reg = await registerTrade({
    shopOrderNo: pgOrderNo,
    amount: row.amount,
    goodsName: row.type === "regular" ? "교사유가족협의회 정기 후원" : "교사유가족협의회 후원",
    returnUrl: `${SITE_URL}/api/${row.type === "regular" ? "billing-approve" : "donate-kicc-approve"}`,
    isBillingKey: row.type === "regular",
    customerName: m?.name || row.donorName,
    customerEmail: m?.email || undefined,
  });
  if (!reg.success || !reg.authPageUrl) {
    throw new AmError(502, reg.errorMessage || "결제 준비에 실패했습니다", "kicc_register");
  }
  return { authPageUrl: reg.authPageUrl, pgOrderNo };
}

/* ═══════════════════════════════════════════════════════
   [W3-3] 한마디·공개 동의
   ═══════════════════════════════════════════════════════ */
export async function amSaveNote(body: { memberId: string; donationId?: number; note?: string; publicConsent?: boolean }): Promise<{ donationId: number }> {
  const m = await loadMemberByHash(body.memberId);
  let donationId = Number(body.donationId || 0) || 0;
  if (donationId) {
    const row = await readDonationLantern(donationId);
    if (!row || row.memberId !== m.id) throw new AmError(403, "본인의 후원이 아닙니다", "donation");
  } else {
    const res: any = await db.execute(sql`
      SELECT id FROM donations WHERE member_id = ${m.id} AND campaign_id IS NOT NULL
      ORDER BY (status = 'completed') DESC, id DESC LIMIT 1
    `);
    donationId = Number(rowsOf(res)[0]?.id || 0);
    if (!donationId) throw new AmError(404, "한마디를 붙일 후원이 없습니다", "donation");
  }
  const note = body.note === undefined ? undefined
    : Array.from(String(body.note || "").replace(/[\r\n\t]+/g, " ").trim()).slice(0, 60).join("");
  const publicConsent = body.publicConsent === undefined ? undefined : body.publicConsent === true;
  if (note !== undefined && publicConsent !== undefined) {
    await db.execute(sql`UPDATE donations SET donor_note = ${note || null}, public_consent = ${publicConsent}, updated_at = NOW() WHERE id = ${donationId}`);
  } else if (note !== undefined) {
    await db.execute(sql`UPDATE donations SET donor_note = ${note || null}, updated_at = NOW() WHERE id = ${donationId}`);
  } else if (publicConsent !== undefined) {
    await db.execute(sql`UPDATE donations SET public_consent = ${publicConsent}, updated_at = NOW() WHERE id = ${donationId}`);
  }
  return { donationId };
}

/* ═══════════════════════════════════════════════════════
   입금 확인·효성 명세 반영 → 대기 중 의도를 «완료» 행에 이어 붙이고 등불을 켠다
   ═══════════════════════════════════════════════════════ */
export async function absorbLanternIntent(memberId: number | null | undefined, completedDonationId: number, kind: "bank" | "hyosung"): Promise<boolean> {
  if (!memberId || !completedDonationId) return false;
  try {
    const pendingStatus = kind === "bank" ? "pending_bank" : "pending_hyosung";
    const res: any = await db.execute(sql`
      SELECT id, campaign_id AS "campaignId", source_meta AS "sourceMeta"
      FROM donations
      WHERE member_id = ${memberId} AND status = ${pendingStatus} AND campaign_id IS NOT NULL
        AND source_meta IS NOT NULL AND (source_meta->>'absorbedBy') IS NULL
      ORDER BY id DESC LIMIT 1
    `);
    const intent = rowsOf(res)[0];
    if (!intent) return false;

    const done = await readDonationLantern(completedDonationId);
    if (!done || done.status !== "completed") return false;
    if (done.sourceMeta && done.sourceMeta.lanternNo) return false;   // 이미 등불 처리됨

    const copied = { ...(intent.sourceMeta || {}), absorbedFrom: Number(intent.id), absorbedAt: new Date().toISOString() };
    await db.execute(sql`
      UPDATE donations SET campaign_id = COALESCE(campaign_id, ${Number(intent.campaignId)}),
        source_meta = COALESCE(source_meta, '{}'::jsonb) || ${JSON.stringify(copied)}::jsonb, updated_at = NOW()
      WHERE id = ${completedDonationId}
    `);
    await db.execute(sql`
      UPDATE donations SET status = 'cancelled',
        source_meta = COALESCE(source_meta, '{}'::jsonb) || ${JSON.stringify({ absorbedBy: completedDonationId, absorbedAt: copied.absorbedAt })}::jsonb,
        memo = COALESCE(memo, '') || ${` [등불] ${kind === "bank" ? "입금 확인" : "효성 명세 반영"} #${completedDonationId}로 대체`},
        updated_at = NOW()
      WHERE id = ${Number(intent.id)}
    `);

    await afterLanternCompletion({
      donationId: completedDonationId,
      memberId,
      amount: done.amount,
      monthly: done.type === "regular",
      paidAt: done.paidAt || new Date(),
    });
    await recalcCampaignStatsSafe(Number(intent.campaignId));
    return true;
  } catch (e) {
    console.warn("[lantern-am] absorbLanternIntent 실패(무시):", (e as any)?.message);
    return false;
  }
}
