// netlify/functions/admin-lantern-selftest.ts
// 「등불의 기적」 AM 서버 연동 자가 점검 — [W3-1] 가입 → [W3-2] 결제 의도(계좌 직접 입금) → [W3-3] 한마디 → 정리
//
// GET /api/admin-lantern-selftest            : 상태(시크릿 등록 여부)만 — 인증 불필요
// GET /api/admin-lantern-selftest?run=1      : 어드민 세션 또는 ?secret=(INTERNAL_TRIGGER_SECRET·LANTERN_MIGRATE_TOKEN) 로 실행
//     ?keep=1 이면 시험 회원·후원을 지우지 않는다(기본은 즉시 삭제)
//
// 시험 회원은 이메일 selftest-<무작위>@lantern.invalid · 휴대폰 010-9999-xxxx 로 만들고, 메일은 유효하지 않은 주소라 발송 실패로 끝난다.
// HTTP를 거치지 않고 같은 라이브러리 함수를 부르므로 시크릿 값이 필요 없다(AM이 부를 때와 같은 코드 경로).

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { LANTERN, LANTERN_NOTICES } from "../../lib/campaign-extras";
import { amUpsertMember, amCreateIntent, amSaveNote, amIntentSummary } from "../../lib/lantern-am";
import { resolveMemberHash } from "../../lib/lantern";

export const config = { path: "/api/admin-lantern-selftest" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function rowsOf(res: any): any[] { return (res?.rows ?? res ?? []) as any[]; }

export default async (req: Request) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);
  const url = new URL(req.url);
  const status = {
    amSecretSet: !!(process.env.SIREN_AM_POSTBACK_SECRET || "").trim(),
    portoneConfigured: !!((process.env.PORTONE_STORE_ID || "").trim() && (process.env.PORTONE_CHANNEL_KEY || "").trim()),
    endpoints: ["/api/lantern-member", "/api/lantern-payment-intent", "/api/lantern-member-note", "/api/lantern-pay-start", "/lantern-pay.html"],
    slug: LANTERN.slug,
  };
  if (url.searchParams.get("run") !== "1") return json({ ok: true, mode: "status", status });

  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  const once = process.env.LANTERN_MIGRATE_TOKEN || "";
  let authed = (expected !== "" && secret === expected) || (once !== "" && secret === once);
  if (!authed) {
    const guard: any = await requireAdmin(req);
    if (!guard.ok) return guard.res;
    authed = true;
  }

  const keep = url.searchParams.get("keep") === "1";
  const rand = crypto.randomBytes(3).toString("hex");
  const steps: any[] = [];
  let memberDbId: number | null = null;
  let donationId: number | null = null;
  try {
    /* [W3-1] 가입 */
    const m1 = await amUpsertMember({
      campaignSlug: LANTERN.slug,
      name: `자가점검${rand.slice(0, 2)}`,
      phone: `010-9999-${String(parseInt(rand, 16) % 10000).padStart(4, "0")}`,
      email: `selftest-${rand}@lantern.invalid`,
      school: "자가점검초등학교",
      consents: { bylaws: true, privacy: true, sms: false },
      consentText: { bylaws: LANTERN_NOTICES.CONSENT_BYLAWS, privacy: LANTERN_NOTICES.CONSENT_PRIVACY },
      consentAt: new Date().toISOString(),
      ip: "127.0.0.1", ua: "selftest",
      am_lp: LANTERN.landing.lp, am_anon: `selftest-${rand}`, gate: "1",
    });
    memberDbId = m1.id;
    steps.push({ step: "W3-1 lantern-member", ok: true, memberId: m1.memberId, status: m1.status });

    /* 같은 이메일로 다시 → existing */
    const m2 = await amUpsertMember({
      campaignSlug: LANTERN.slug, name: "자가점검", phone: "010-0000-0000", email: `selftest-${rand}@lantern.invalid`,
      consents: { bylaws: true, privacy: true, sms: false }, am_lp: LANTERN.landing.lp,
    });
    steps.push({ step: "W3-1 재호출(existing)", ok: m2.status === "existing" && m2.memberId === m1.memberId, status: m2.status });

    /* 해시 → id 역조회 */
    const resolved = await resolveMemberHash(m1.memberId);
    steps.push({ step: "memberId 해시 역조회", ok: resolved === m1.id });

    /* [W3-2] 결제 의도 — 계좌 직접 입금 */
    const it = await amCreateIntent({ memberId: m1.memberId, amount: 10000, monthly: false, method: "bank", am_lp: LANTERN.landing.lp, am_anon: `selftest-${rand}`, gate: "1" });
    donationId = it.donationId;
    steps.push({ step: "W3-2 lantern-payment-intent(bank)", ok: it.provider === "manual" && !!it.intentId, intentId: it.intentId, provider: it.provider, bankAccount: it.bankAccount });

    /* 결제 페이지 공개 요약 */
    const sum = await amIntentSummary(it.intentId);
    steps.push({ step: "GET ?intent= 요약", ok: sum.status === "pending_bank" && sum.maskedName.includes("○"), maskedName: sum.maskedName, returnUrl: sum.returnUrl });

    /* 정기 카드 의도(KICC) — 행만 만들고 결제창은 열지 않는다 */
    const it2 = await amCreateIntent({ memberId: m1.memberId, amount: 10000, monthly: true, method: "card", am_lp: LANTERN.landing.lp, gate: "2" });
    steps.push({ step: "W3-2 lantern-payment-intent(monthly card)", ok: (it2.provider === "kicc" && !!it2.redirectUrl) || it2.provider === "portone", provider: it2.provider, redirectUrl: it2.redirectUrl });

    /* [W3-3] 한마디 */
    const nt = await amSaveNote({ memberId: m1.memberId, donationId: it.donationId, note: "선생님, 이제 여기는 걱정 마세요.", publicConsent: true });
    const chk: any = await db.execute(sql`SELECT donor_note, public_consent, campaign_id, source_meta->>'intentId' AS intent FROM donations WHERE id = ${nt.donationId}`);
    const r = rowsOf(chk)[0] || {};
    steps.push({ step: "W3-3 lantern-member-note", ok: r.public_consent === true && String(r.donor_note || "").length > 0 && r.intent === it.intentId, saved: r });

    /* 정리 */
    if (!keep) {
      await db.execute(sql`DELETE FROM donations WHERE member_id = ${memberDbId}`);
      await db.execute(sql`DELETE FROM password_reset_tokens WHERE member_id = ${memberDbId}`);
      await db.execute(sql`DELETE FROM members WHERE id = ${memberDbId}`);
      steps.push({ step: "정리(회원·후원 삭제)", ok: true });
    }

    const allOk = steps.every((s) => s.ok);
    return json({ ok: allOk, mode: "run", status, steps, kept: keep ? { memberDbId, donationId } : null });
  } catch (e: any) {
    if (!keep && memberDbId) {
      try {
        await db.execute(sql`DELETE FROM donations WHERE member_id = ${memberDbId}`);
        await db.execute(sql`DELETE FROM password_reset_tokens WHERE member_id = ${memberDbId}`);
        await db.execute(sql`DELETE FROM members WHERE id = ${memberDbId}`);
      } catch { /* noop */ }
    }
    return json({ ok: false, mode: "run", status, steps, error: String(e?.message || e), step: e?.step, stack: String(e?.stack || "").slice(0, 600) }, 500);
  }
};
