// netlify/functions/sponsor-signup.ts
// S5 — «후원회원 가입» (SIREN 후원 창 · 결제 전 회칙(정관) 동의 절차 · 기부금품법 예외 요건)
//
// GET  /api/sponsor-signup
//   → { ok, loggedIn, member:{ id,name,phone,email,schoolName,bylawsAgreedAt } | null, needsBylaws }
//
// POST /api/sponsor-signup
//   body: { name, phone, email, schoolName?, agreeBylaws:true, agreePrivacy:true, agreeSms?, campaignSlug? }
//   - 로그인 상태: 회칙 동의 시각·학교명만 갱신 (needsBylaws 해소)
//   - 비로그인·신규: 회원 생성(임시 비밀번호·7일 «비밀번호 설정하기» 메일) → 로그인 쿠키 발급
//   - 비로그인·기존 이메일/연락처: 409 { existing:true, by:'email'|'phone' } → 화면이 로그인으로 안내
//
// 생성 규칙은 lib/sponsor-member.ts 가 단일 출처 — AutoMarketing 서버 호출(lantern-member)과 같은 규칙.

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { authenticateUser, signUserToken, buildCookie } from "../../lib/auth";
import { logUserAction } from "../../lib/audit";
import { getCampaignExtras, LANTERN_NOTICES } from "../../lib/campaign-extras";
import {
  findExistingSponsor, createSponsorMember, saveSponsorFields, readSponsorFields, normalizePhone, isValidEmail,
} from "../../lib/sponsor-member";
import { ensureMemberHash } from "../../lib/lantern";
import {
  ok, badRequest, conflict, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/sponsor-signup" };

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
          detail: { campaignSlug, schoolName, saved, consentText: { bylaws: LANTERN_NOTICES.CONSENT_BYLAWS }, source: "siren_modal" },
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

    /* 기존 회원 확인 — 화면이 로그인으로 안내 (이메일 → 휴대폰 순) */
    const existing = await findExistingSponsor(email, phone);
    if (existing) {
      return conflict(
        existing.by === "email" ? "이미 가입된 이메일입니다. 로그인 후 이어서 진행해 주세요." : "이미 가입된 연락처입니다. 로그인 후 이어서 진행해 주세요.",
        { existing: true, by: existing.by },
      );
    }

    const created = await createSponsorMember({
      name, email, phone, schoolName, agreeSms: body.agreeSms === true, campaignTitle, source: "siren_modal",
    });
    await ensureMemberHash(created.id);

    /* 로그인 쿠키 */
    const token = signUserToken({ uid: created.id, email: created.email, name: created.name, type: created.type as any });
    const cookie = buildCookie("siren_token", token, { maxAge: 14 * 24 * 60 * 60 });

    await logUserAction(req, created.id, created.name, "sponsor_signup", {
      target: `M-${created.id}`,
      detail: {
        campaignSlug, schoolName, source: "siren_modal",
        consents: { bylaws: true, privacy: true, sms: body.agreeSms === true },
        consentText: { bylaws: LANTERN_NOTICES.CONSENT_BYLAWS, privacy: LANTERN_NOTICES.CONSENT_PRIVACY },
        consentAt: new Date().toISOString(),
      },
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
