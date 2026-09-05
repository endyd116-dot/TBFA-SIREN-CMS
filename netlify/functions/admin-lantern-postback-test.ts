// netlify/functions/admin-lantern-postback-test.ts
// 「등불의 기적」 랜딩 연동 진단 — withwork postback(POST /api/lit-return) 시험 발송 (2026-09-06)
//
// GET /api/admin-lantern-postback-test            : 상태만 (시크릿 등록 여부·postback 주소) — 인증 불필요
// GET /api/admin-lantern-postback-test?run=1      : 어드민 세션 또는 ?secret= 로 시험 postback 1건 발송
//     ?gate=1|2|3 · ?amount=1000 · ?monthly=1 (선택)
//
// AM 합의: 시험 건은 memberId 를 `test-` 로 시작해 보내면 AM이 확인 뒤 그 행을 지운다.
// 실결제 없이 «SIREN 서버 → AM 서버» 배관(시크릿·주소·응답)을 확인하는 운영자 도구. 시크릿 값은 응답에 싣지 않는다.

import crypto from "crypto";
import { requireAdmin } from "../../lib/admin-guard";
import { LANTERN } from "../../lib/campaign-extras";
import { postbackLitReturn } from "../../lib/lantern";

export const config = { path: "/api/admin-lantern-postback-test" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async (req: Request) => {
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);
  const url = new URL(req.url);
  const secretSet = !!(process.env.SIREN_AM_POSTBACK_SECRET || "").trim();
  const status = { secretSet, postbackUrl: LANTERN.postbackUrl, landing: LANTERN.landing };

  if (url.searchParams.get("run") !== "1") return json({ ok: true, mode: "status", status });

  /* 인증 — 어드민 세션 또는 ?secret=(INTERNAL_TRIGGER_SECRET / 1회용 LANTERN_MIGRATE_TOKEN) */
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.INTERNAL_TRIGGER_SECRET || "";
  const once = process.env.LANTERN_MIGRATE_TOKEN || "";
  let authed = (expected !== "" && secret === expected) || (once !== "" && secret === once);
  if (!authed) {
    const guard: any = await requireAdmin(req);
    if (!guard.ok) return guard.res;
    authed = true;
  }

  const gateRaw = String(url.searchParams.get("gate") || "").trim();
  const amount = Math.max(1000, Number(url.searchParams.get("amount") || 1000) || 1000);
  const monthly = url.searchParams.get("monthly") === "1";
  const payload = {
    slug: LANTERN.landing.lp,
    am_anon: `test-anon-${crypto.randomBytes(4).toString("hex")}`,
    gate: /^[1-3]$/.test(gateRaw) ? gateRaw : undefined,
    amount,
    monthly,
    memberId: `test-${crypto.randomBytes(8).toString("hex")}`,
    at: new Date().toISOString(),
  };

  const result = await postbackLitReturn(LANTERN, payload);
  return json({ ok: result.ok, mode: "run", status, sent: payload, result });
};
