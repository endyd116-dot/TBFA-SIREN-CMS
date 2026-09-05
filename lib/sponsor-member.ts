// lib/sponsor-member.ts
// «후원회원 가입» 공용 — SIREN 후원 창(sponsor-signup)과 AutoMarketing 서버 호출(lantern-member)이 같은 규칙으로 회원을 만든다.
//  - 판정: 이메일 → 정규화 휴대폰 완전일치 순 (existing이면 회원 정보 갱신 0 · 회칙 시각·학교명만 COALESCE)
//  - 신규: members INSERT(member_category sponsor · 임시 비밀번호 · signup_source lantern_campaign) + 회칙 동의 시각·학교명 +
//          7일 «비밀번호 설정하기» 메일 + 운영자 알림. 쿠키 발급은 호출 측(sponsor-signup)만.
//  - 새 컬럼(school_name·bylaws_agreed_at·am_member_hash)은 schema.ts에 정의됨(2026-09-06 적용 완료).

import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "../db";
import { members, passwordResetTokens } from "../db/schema";
import { notifyAllOperators } from "./notify";
import { sendEmail, baseLayout } from "./email";
import { getSignupSourceId } from "./member-classifier";
import { RECEIPT_NOTICE } from "./campaign-extras";

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;
const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");
const ORG_NAME = process.env.ORG_NAME || "사단법인 교사유가족협의회";

export interface SponsorMemberRow {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  type: string;
  status: string;
}

export function normalizePhone(phone: string): string | null {
  const cleaned = String(phone || "").replace(/[\s-]/g, "");
  if (!/^\d{10,11}$/.test(cleaned)) return null;
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** 이메일 → 정규화 휴대폰 순으로 기존 회원 찾기 (탈퇴·정지 회원은 제외) */
export async function findExistingSponsor(email: string, phone: string | null): Promise<{ row: SponsorMemberRow; by: "email" | "phone" } | null> {
  const em = String(email || "").trim().toLowerCase();
  if (em) {
    const [r] = await db.select({ id: members.id, email: members.email, name: members.name, phone: members.phone, type: members.type, status: members.status })
      .from(members).where(eq(members.email, em)).limit(1);
    if (r && r.status !== "withdrawn" && r.status !== "suspended") return { row: r as any, by: "email" };
  }
  if (phone) {
    const [r] = await db.select({ id: members.id, email: members.email, name: members.name, phone: members.phone, type: members.type, status: members.status })
      .from(members).where(eq(members.phone, phone)).limit(1);
    if (r && r.status !== "withdrawn" && r.status !== "suspended") return { row: r as any, by: "phone" };
  }
  return null;
}

/** 회칙 동의 시각·학교명 저장 — 이미 있으면 유지(COALESCE) */
export async function saveSponsorFields(memberId: number, schoolName: string | null, agreedNow: boolean): Promise<boolean> {
  try {
    if (agreedNow) {
      await db.execute(sql`
        UPDATE members
        SET school_name = COALESCE(NULLIF(${schoolName}, ''), school_name),
            bylaws_agreed_at = COALESCE(bylaws_agreed_at, NOW()),
            updated_at = NOW()
        WHERE id = ${memberId}
      `);
    } else {
      await db.execute(sql`
        UPDATE members
        SET school_name = COALESCE(NULLIF(${schoolName}, ''), school_name), updated_at = NOW()
        WHERE id = ${memberId}
      `);
    }
    return true;
  } catch (e) {
    console.warn("[sponsor-member] 회칙·학교명 저장 실패:", (e as any)?.message);
    return false;
  }
}

export async function readSponsorFields(memberId: number): Promise<{ schoolName: string | null; bylawsAgreedAt: string | null }> {
  try {
    const res: any = await db.execute(sql`
      SELECT school_name AS "schoolName", bylaws_agreed_at AS "bylawsAgreedAt"
      FROM members WHERE id = ${memberId} LIMIT 1
    `);
    const r = ((res?.rows ?? res ?? []) as any[])[0] || {};
    return {
      schoolName: r.schoolName || null,
      bylawsAgreedAt: r.bylawsAgreedAt ? new Date(r.bylawsAgreedAt).toISOString() : null,
    };
  } catch {
    return { schoolName: null, bylawsAgreedAt: null };
  }
}

/** 환영 메일 — «비밀번호 설정하기» 링크(7일) 포함 */
export async function sendSponsorWelcomeMail(member: { id: number; email: string; name: string }, campaignTitle: string): Promise<void> {
  let setPwUrl = `${SITE_URL}/password-reset.html`;
  try {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await db.insert(passwordResetTokens).values({
      memberId: member.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } as any);
    setPwUrl = `${SITE_URL}/password-reset.html?token=${encodeURIComponent(rawToken)}`;
  } catch (e) {
    console.warn("[sponsor-member] 비밀번호 설정 토큰 생성 실패:", (e as any)?.message);
  }

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      <strong>${esc(member.name)}</strong> 님, 후원회원이 되어 주셔서 감사합니다.
    </p>
    <p style="margin:0 0 20px;color:#525252;line-height:1.8;">
      「${esc(campaignTitle)}」 후원회원 가입이 완료되었습니다.<br />
      회칙에 따라 후원회원으로 등록되었으며, 후원 내역·정기 후원 해지·등불 증서는 마이페이지에서 언제든 확인하실 수 있습니다.
    </p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef9f5;border:1px solid #f0e0d4;border-radius:8px;font-size:13px;color:#525252;line-height:1.8;">
      <strong style="color:#0f0f0f;">마이페이지 비밀번호 설정</strong><br />
      가입 때 비밀번호를 따로 받지 않았습니다. 아래 버튼으로 비밀번호를 정하시면 다음부터 이메일로 로그인하실 수 있습니다.
      (링크는 7일간 유효합니다)
      <div style="margin-top:12px;">
        <a href="${setPwUrl}" target="_blank"
           style="display:inline-block;padding:10px 18px;background:#0f0f0f;color:#ffffff;text-decoration:none;border-radius:5px;font-size:13px;font-weight:600;">
          비밀번호 설정하기 →
        </a>
      </div>
    </div>
    <div style="margin:20px 0 0;padding:14px 16px;background:#f5f4f2;border-radius:6px;font-size:12.5px;color:#525252;line-height:1.7;">
      ${esc(RECEIPT_NOTICE)}
    </div>
  `;
  await sendEmail({
    to: member.email,
    subject: `[${ORG_NAME}] 후원회원 가입을 환영합니다`,
    html: baseLayout({
      title: "후원회원이 되어 주셔서 감사합니다",
      bodyHtml,
      ctaText: "마이페이지 바로가기",
      ctaUrl: `${SITE_URL}/mypage.html`,
    }),
  }).catch(() => {});
}

export interface CreateSponsorInput {
  name: string;
  email: string;          // 소문자 정규화된 값
  phone: string;          // 010-0000-0000 정규화된 값
  schoolName?: string | null;
  agreeSms?: boolean;
  campaignTitle: string;  // 메모·알림·메일 제목용
  source: "siren_modal" | "am_modal";
}

/** 신규 후원회원 생성 — 호출 측이 중복(findExistingSponsor)을 먼저 확인했다고 가정 */
export async function createSponsorMember(input: CreateSponsorInput): Promise<SponsorMemberRow> {
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), BCRYPT_ROUNDS);
  const sourceId = (await getSignupSourceId("lantern_campaign" as any)) ?? (await getSignupSourceId("website"));
  const schoolName = String(input.schoolName || "").trim().slice(0, 150) || null;

  const [created] = await db.insert(members).values({
    email: input.email,
    passwordHash,
    name: input.name,
    phone: input.phone,
    type: "regular",
    status: "active",
    memberCategory: "sponsor",
    memberSubtype: null,
    signupSourceId: sourceId,
    agreeEmail: true,
    agreeSms: input.agreeSms === true,
    agreeMail: false,
    emailVerified: false,
    operatorActive: false,
    memo: `후원회원 가입 — ${input.campaignTitle}${schoolName ? ` · ${schoolName}` : ""}${input.source === "am_modal" ? " · 랜딩 모달" : ""}`,
  } as any).returning({ id: members.id, email: members.email, name: members.name, phone: members.phone, type: members.type, status: members.status });

  await saveSponsorFields(created.id, schoolName, true);

  try {
    await notifyAllOperators({
      category: "member",
      severity: "info",
      title: `🕯️ 후원회원 가입 — ${input.campaignTitle}`,
      message: `${created.name}님이 후원회원으로 가입했어요.${schoolName ? ` (${schoolName})` : ""}${input.source === "am_modal" ? " — 랜딩 모달" : ""}`,
      link: "/admin.html#members",
      refTable: "members",
      refId: created.id,
    }, { category: "all" });
  } catch (e) { console.warn("[sponsor-member] 운영자 알림 실패:", e); }

  try { await sendSponsorWelcomeMail({ id: created.id, email: created.email, name: created.name }, input.campaignTitle); } catch {}

  return created as any;
}
