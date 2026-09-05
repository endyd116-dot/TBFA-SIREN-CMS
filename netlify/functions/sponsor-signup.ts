// netlify/functions/sponsor-signup.ts
// S5 — «후원회원 가입» (결제 전 회칙(정관) 동의 절차 · 기부금품법 예외 요건)
//
// GET  /api/sponsor-signup
//   → { ok, loggedIn, member:{ id,name,phone,email,schoolName,bylawsAgreedAt } | null, needsBylaws }
//
// POST /api/sponsor-signup
//   body: { name, phone, email, schoolName?, agreeBylaws:true, agreePrivacy:true, agreeSms?, campaignSlug?, sourceMeta? }
//   - 로그인 상태: 회칙 동의 시각·학교명만 갱신 (needsBylaws 해소)
//   - 비로그인·신규: members INSERT(임시 비밀번호) → 로그인 쿠키 발급 → 환영 메일(비밀번호 설정 링크 7일)
//   - 비로그인·기존 이메일/연락처: 409 { existing:true, by:'email'|'phone' } → 화면이 로그인으로 안내
//
// 새 컬럼(school_name·bylaws_agreed_at)은 마이그 적용 전엔 없을 수 있어 raw SQL + try/catch.

import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "../../db";
import { members, passwordResetTokens } from "../../db/schema";
import { authenticateUser, signUserToken, buildCookie } from "../../lib/auth";
import { notifyAllOperators } from "../../lib/notify";
import { logUserAction } from "../../lib/audit";
import { sendEmail, baseLayout } from "../../lib/email";
import { getSignupSourceId } from "../../lib/member-classifier";
import { getCampaignExtras, RECEIPT_NOTICE } from "../../lib/campaign-extras";
import {
  ok, badRequest, conflict, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/sponsor-signup" };

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;
const SITE_URL = (process.env.SITE_URL || "https://tbfa.co.kr").replace(/\/+$/, "");
const ORG_NAME = process.env.ORG_NAME || "(사)교사유가족협의회";

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

function normalizePhone(phone: string): string | null {
  const cleaned = String(phone || "").replace(/[\s-]/g, "");
  if (!/^\d{10,11}$/.test(cleaned)) return null;
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** 회칙 동의·학교명 저장 — 컬럼이 아직 없으면 false */
async function saveSponsorFields(memberId: number, schoolName: string | null, agreedNow: boolean): Promise<boolean> {
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
    console.warn("[sponsor-signup] 회칙·학교명 저장 실패(컬럼 미적용 가능):", (e as any)?.message);
    return false;
  }
}

async function readSponsorFields(memberId: number): Promise<{ schoolName: string | null; bylawsAgreedAt: string | null }> {
  try {
    const res: any = await db.execute(sql`
      SELECT school_name AS "schoolName", bylaws_agreed_at AS "bylawsAgreedAt"
      FROM members WHERE id = ${memberId} LIMIT 1
    `);
    const r = rowsOf(res)[0] || {};
    return {
      schoolName: r.schoolName || null,
      bylawsAgreedAt: r.bylawsAgreedAt ? new Date(r.bylawsAgreedAt).toISOString() : null,
    };
  } catch {
    return { schoolName: null, bylawsAgreedAt: null };
  }
}

/** 환영 메일 — 비밀번호 설정 링크(7일) 포함 */
async function sendWelcomeMail(member: { id: number; email: string; name: string }, campaignTitle: string) {
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
    console.warn("[sponsor-signup] 비밀번호 설정 토큰 생성 실패:", (e as any)?.message);
  }

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#0f0f0f;">
      <strong>${esc(member.name)}</strong> 님, 후원회원이 되어 주셔서 감사합니다.
    </p>
    <p style="margin:0 0 20px;color:#525252;line-height:1.8;">
      「${esc(campaignTitle)}」 후원회원 가입이 완료되었습니다.<br />
      회칙에 따라 후원회원으로 등록되었으며, 후원 내역·정기 후원 해지는 마이페이지에서 언제든 확인하실 수 있습니다.
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

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  /* ───────── GET: 현재 상태 ───────── */
  if (req.method === "GET") {
    try {
      const auth = authenticateUser(req);
      if (!auth) return ok({ loggedIn: false, member: null, needsBylaws: true });
      const [user] = await db
        .select({ id: members.id, name: members.name, phone: members.phone, email: members.email, status: members.status })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);
      if (!user || user.status === "withdrawn" || user.status === "suspended") {
        return ok({ loggedIn: false, member: null, needsBylaws: true });
      }
      const extra = await readSponsorFields(user.id);
      return ok({
        loggedIn: true,
        member: {
          id: user.id, name: user.name, phone: user.phone || "", email: user.email,
          schoolName: extra.schoolName, bylawsAgreedAt: extra.bylawsAgreedAt,
        },
        needsBylaws: !extra.bylawsAgreedAt,
      });
    } catch (err: any) {
      console.error("[sponsor-signup GET]", err);
      return serverError("상태 조회 실패", err);
    }
  }

  if (req.method !== "POST") return methodNotAllowed();

  /* ───────── POST ───────── */
  try {
    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const agreeBylaws = body.agreeBylaws === true;
    const agreePrivacy = body.agreePrivacy === true;
    const schoolName = String(body.schoolName || "").trim().slice(0, 150) || null;
    const campaignSlug = String(body.campaignSlug || "").trim();
    const extras = getCampaignExtras(campaignSlug);
    const campaignTitle = extras ? extras.certificate.campaignLabel : "후원";

    if (!agreeBylaws) return badRequest("회칙(정관)에 동의해 주세요");

    /* 로그인 상태 → 동의·학교명만 갱신 */
    const auth = authenticateUser(req);
    if (auth) {
      const [user] = await db
        .select({ id: members.id, name: members.name, phone: members.phone, email: members.email, status: members.status })
        .from(members)
        .where(eq(members.id, auth.uid))
        .limit(1);
      if (user && user.status !== "withdrawn" && user.status !== "suspended") {
        const saved = await saveSponsorFields(user.id, schoolName, true);
        await logUserAction(req, user.id, user.name, "sponsor_bylaws_agree", {
          target: `M-${user.id}`,
          detail: { campaignSlug, schoolName, saved },
        });
        const extra = await readSponsorFields(user.id);
        return ok({
          mode: "agree",
          member: { id: user.id, name: user.name, phone: user.phone || "", email: user.email, schoolName: extra.schoolName },
          user: { id: user.id, name: user.name, phone: user.phone || "", email: user.email },
        }, "회칙 동의가 저장되었습니다");
      }
    }

    /* 비로그인 → 신규 가입 */
    if (!agreePrivacy) return badRequest("개인정보 수집·이용에 동의해 주세요");
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone || ""));

    if (!name || name.length < 2 || name.length > 50) return badRequest("이름을 2자 이상 입력해 주세요");
    if (!email || !isValidEmail(email) || email.length > 100) return badRequest("올바른 이메일을 입력해 주세요");
    if (!phone) return badRequest("올바른 연락처를 입력해 주세요 (예: 010-1234-5678)");

    /* 기존 회원 확인 — 화면이 로그인으로 안내 */
    const [byEmail] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
    if (byEmail) return conflict("이미 가입된 이메일입니다. 로그인 후 이어서 진행해 주세요.", { existing: true, by: "email" });
    const [byPhone] = await db.select({ id: members.id, email: members.email }).from(members).where(eq(members.phone, phone)).limit(1);
    if (byPhone) return conflict("이미 가입된 연락처입니다. 로그인 후 이어서 진행해 주세요.", { existing: true, by: "phone" });

    /* 임시 비밀번호(무작위) — 메일의 설정 링크로 정한다 */
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), BCRYPT_ROUNDS);
    const sourceId = (await getSignupSourceId("lantern_campaign" as any)) ?? (await getSignupSourceId("website"));

    const [created] = await db.insert(members).values({
      email,
      passwordHash,
      name,
      phone,
      type: "regular",
      status: "active",
      memberCategory: "sponsor",
      memberSubtype: null,
      signupSourceId: sourceId,
      agreeEmail: true,
      agreeSms: body.agreeSms === true,
      agreeMail: false,
      emailVerified: false,
      operatorActive: false,
      memo: `후원회원 가입 — ${campaignTitle}${schoolName ? ` · ${schoolName}` : ""}`,
    } as any).returning({ id: members.id, email: members.email, name: members.name, type: members.type, status: members.status });

    const saved = await saveSponsorFields(created.id, schoolName, true);

    /* 로그인 쿠키 */
    const token = signUserToken({ uid: created.id, email: created.email, name: created.name, type: created.type as any });
    const cookie = buildCookie("siren_token", token, { maxAge: 14 * 24 * 60 * 60 });

    /* 알림·메일·감사 (실패해도 가입은 성공) */
    try {
      await notifyAllOperators({
        category: "member",
        severity: "info",
        title: `🕯️ 후원회원 가입 — ${campaignTitle}`,
        message: `${created.name}님이 후원회원으로 가입했어요.${schoolName ? ` (${schoolName})` : ""}`,
        link: "/admin.html#members",
        refTable: "members",
        refId: created.id,
      }, { category: "all" });
    } catch (e) { console.warn("[sponsor-signup] 운영자 알림 실패:", e); }
    try { await sendWelcomeMail({ id: created.id, email: created.email, name: created.name }, campaignTitle); } catch {}
    await logUserAction(req, created.id, created.name, "sponsor_signup", {
      target: `M-${created.id}`,
      detail: { campaignSlug, schoolName, bylawsSaved: saved, source: sourceId ? "lantern_campaign" : null },
    });

    const user = { id: created.id, name: created.name, email: created.email, phone, type: created.type };
    const res = ok({ mode: "created", member: { ...user, schoolName }, user }, "후원회원 가입이 완료되었습니다");
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err: any) {
    console.error("[sponsor-signup POST]", err);
    return serverError("가입 처리 중 오류가 발생했습니다", err);
  }
};
