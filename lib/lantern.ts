// lib/lantern.ts
// 「등불의 기적」 — 랜딩(withwork) 연동 공용 헬퍼 (S6-b·S8·S11)
//
//  - 랜딩이 넘긴 am_lp / am_anon / gate 를 검증해 후원(pending) 행의 source_meta(jsonb)에 보관
//  - 결제 완료 시 ① 등불 번호 계산 ② withwork 서버 postback(3회 재시도·멱등 memberId+at)
//    ③ 랜딩 되돌아가기 주소(?lit=1&am_anon&gate) 생성
//
//  새 컬럼(source_meta·donor_note·public_consent·members.school_name·bylaws_agreed_at)은
//  마이그레이션(migrate-lantern-campaign) 적용 전까지 schema.ts에 넣지 않는다(§9.1.1).
//  그래서 여기서는 raw SQL로만 읽고 쓰며, 컬럼이 아직 없으면 조용히 건너뛴다.

import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getCampaignExtras, type CampaignExtras } from "./campaign-extras";

export interface AmMeta {
  am_lp: string;
  am_anon?: string;
  gate?: string;
  /** 통보문 ⑧ — AM 모달 결제 의도 id(32 hex). 되돌아가기 `&intent=` · postback `intentId` 로 그대로 돌려준다 */
  intentId?: string;
}

/* ───────── AM 서버-서버 인증 (x-am-secret = SIREN_AM_POSTBACK_SECRET 같은 값) ───────── */
export function checkAmSecret(req: Request): boolean {
  const expected = (process.env.SIREN_AM_POSTBACK_SECRET || "").trim();
  const given = String(req.headers.get("x-am-secret") || "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 결제 의도 id — 무작위 32 hex (URL·postback에 그대로 실린다·추측 불가) */
export function newIntentId(): string {
  return crypto.randomBytes(16).toString("hex");
}
export function isIntentId(v: any): v is string {
  return typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
}

/** 회원 해시 보장 — members.am_member_hash 에 저장(없으면 계산해 채움) */
export async function ensureMemberHash(memberId: number): Promise<string> {
  const h = memberHash(memberId, 0);
  try {
    await db.execute(sql`UPDATE members SET am_member_hash = ${h} WHERE id = ${memberId} AND (am_member_hash IS NULL OR am_member_hash <> ${h})`);
  } catch (e) {
    console.warn("[lantern] ensureMemberHash 저장 실패(컬럼 미적용 가능):", (e as any)?.message);
  }
  return h;
}

/** 회원 해시 → members.id (저장된 해시 우선 · 없으면 전체 id를 계산해 대조 — 회원 수가 작아 비용 무시) */
export async function resolveMemberHash(hash: string): Promise<number | null> {
  const h = String(hash || "").trim();
  if (!/^[a-f0-9]{24}$/.test(h)) return null;
  try {
    const res: any = await db.execute(sql`SELECT id FROM members WHERE am_member_hash = ${h} LIMIT 1`);
    const r = rowsOf(res)[0];
    if (r?.id) return Number(r.id);
  } catch { /* 컬럼 미적용이면 아래 대조로 */ }
  try {
    const res: any = await db.execute(sql`SELECT id FROM members WHERE status NOT IN ('withdrawn','suspended')`);
    for (const r of rowsOf(res)) {
      const id = Number(r.id);
      if (memberHash(id, 0) === h) {
        await ensureMemberHash(id);
        return id;
      }
    }
  } catch (e) {
    console.warn("[lantern] resolveMemberHash 대조 실패:", (e as any)?.message);
  }
  return null;
}

/** 결제 의도 id → 후원 행 (source_meta.intentId) */
export async function findDonationByIntent(intentId: string): Promise<DonationLanternRow | null> {
  if (!isIntentId(intentId)) return null;
  try {
    const res: any = await db.execute(sql`
      SELECT id FROM donations WHERE source_meta->>'intentId' = ${intentId} ORDER BY id DESC LIMIT 1
    `);
    const r = rowsOf(res)[0];
    if (!r?.id) return null;
    return readDonationLantern(Number(r.id));
  } catch (e) {
    console.warn("[lantern] findDonationByIntent 실패:", (e as any)?.message);
    return null;
  }
}

export interface LanternCompletion {
  extras: CampaignExtras;
  meta: AmMeta | null;
  lanternNo: number;
  returnUrl: string | null;
  postback: { ok: boolean; attempts: number; status?: number; skipped?: string } | null;
}

/* ───────── 공통 ───────── */
function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

/** 랜딩 파라미터 검증 — 형식이 어긋나면 버린다(오픈 리다이렉트·주입 방지) */
export function sanitizeAmMeta(input: any): AmMeta | null {
  if (!input || typeof input !== "object") return null;
  const lp = String(input.am_lp || input.amLp || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(lp)) return null;
  const out: AmMeta = { am_lp: lp };
  const anon = String(input.am_anon || input.amAnon || "").trim();
  if (anon && /^[a-zA-Z0-9_.:-]{1,120}$/.test(anon)) out.am_anon = anon;
  const gate = String(input.gate || "").trim();
  if (/^[1-3]$/.test(gate)) out.gate = gate;
  const intentId = String(input.intentId || input.intent || "").trim();
  if (/^[a-f0-9]{32}$/.test(intentId)) out.intentId = intentId;
  return out;
}

/** 랜딩 되돌아가기 주소 — S6-b: lit=1 + am_anon·gate 그대로 (+ 통보문 ⑧ intent) */
export function buildLandingReturnUrl(extras: CampaignExtras, meta: AmMeta | null): string | null {
  if (!meta) return null;
  const u = new URL(`${extras.landing.base}/lp/${encodeURIComponent(meta.am_lp)}`);
  u.searchParams.set("lit", "1");
  if (meta.am_anon) u.searchParams.set("am_anon", meta.am_anon);
  if (meta.gate) u.searchParams.set("gate", meta.gate);
  if (meta.intentId) u.searchParams.set("intent", meta.intentId);
  return u.toString();
}

/** 이름 마스킹 — 김○○ (첫 글자만, 나머지는 ○ 두 개 이상) */
export function maskName(name: string | null | undefined): string {
  const s = String(name || "").trim();
  if (!s) return "익명";
  const first = Array.from(s)[0];
  const rest = Math.max(2, Array.from(s).length - 1);
  return first + "○".repeat(rest);
}

/** 회원 식별 해시 — AM postback용(원본 id 노출 없이 멱등 키로 쓰인다). 시크릿 회전과 무관하게 안정 */
export function memberHash(memberId: number | null, donationId: number): string {
  const seed = memberId ? `tbfa-lantern-member:${memberId}` : `tbfa-lantern-guest:${donationId}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

/* ───────── 후원 행의 등불 정보 읽기/쓰기 (raw SQL) ───────── */
export interface DonationLanternRow {
  id: number;
  memberId: number | null;
  campaignId: number | null;
  campaignSlug: string | null;
  campaignTitle: string | null;
  donorName: string;
  amount: number;
  type: string;
  status: string;
  paidAt: Date | null;
  sourceMeta: any;
  donorNote: string | null;
  publicConsent: boolean;
}

export async function readDonationLantern(donationId: number): Promise<DonationLanternRow | null> {
  try {
    const res: any = await db.execute(sql`
      SELECT d.id, d.member_id AS "memberId", d.campaign_id AS "campaignId",
             c.slug AS "campaignSlug", c.title AS "campaignTitle",
             d.donor_name AS "donorName", d.amount, d.type::text AS type, d.status::text AS status,
             COALESCE(d.paid_at, d.created_at) AS "paidAt",
             d.source_meta AS "sourceMeta", d.donor_note AS "donorNote",
             COALESCE(d.public_consent, FALSE) AS "publicConsent"
      FROM donations d
      LEFT JOIN campaigns c ON c.id = d.campaign_id
      WHERE d.id = ${donationId}
      LIMIT 1
    `);
    const r = rowsOf(res)[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      memberId: r.memberId == null ? null : Number(r.memberId),
      campaignId: r.campaignId == null ? null : Number(r.campaignId),
      campaignSlug: r.campaignSlug || null,
      campaignTitle: r.campaignTitle || null,
      donorName: String(r.donorName || ""),
      amount: Number(r.amount || 0),
      type: String(r.type || ""),
      status: String(r.status || ""),
      paidAt: r.paidAt ? new Date(r.paidAt) : null,
      sourceMeta: r.sourceMeta || null,
      donorNote: r.donorNote || null,
      publicConsent: !!r.publicConsent,
    };
  } catch (e) {
    console.warn("[lantern] readDonationLantern 실패(컬럼 미적용 가능):", (e as any)?.message);
    return null;
  }
}

/** 랜딩 파라미터를 후원 행에 보관 — 컬럼이 없으면 조용히 건너뛴다 */
export async function saveDonationSourceMeta(donationId: number, meta: AmMeta | null, extra?: Record<string, any>): Promise<boolean> {
  if (!meta && !extra) return false;
  const payload = { ...(meta || {}), ...(extra || {}), savedAt: new Date().toISOString() };
  try {
    await db.execute(sql`
      UPDATE donations
      SET source_meta = COALESCE(source_meta, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb
      WHERE id = ${donationId}
    `);
    return true;
  } catch (e) {
    console.warn("[lantern] saveDonationSourceMeta 실패(컬럼 미적용 가능):", (e as any)?.message);
    return false;
  }
}

/** 등불 번호 — 이 캠페인에서 완료된 후원자(회원 중복 제거) 가운데 몇 번째인가 */
export async function computeLanternNo(campaignId: number, donationId: number): Promise<number> {
  try {
    const res: any = await db.execute(sql`
      WITH mine AS (
        SELECT COALESCE(paid_at, created_at) AS at, member_id, id
        FROM donations WHERE id = ${donationId}
      ),
      donors AS (
        SELECT COALESCE(member_id::text, 'g' || id::text) AS donor_key,
               MIN(COALESCE(paid_at, created_at)) AS first_at
        FROM donations
        WHERE campaign_id = ${campaignId} AND status = 'completed'
        GROUP BY 1
      )
      SELECT COUNT(*)::int AS n
      FROM donors, mine
      WHERE donors.first_at <= mine.at
    `);
    const n = Number(rowsOf(res)[0]?.n || 0);
    return n > 0 ? n : 1;
  } catch (e) {
    console.warn("[lantern] computeLanternNo 실패:", (e as any)?.message);
    return 1;
  }
}

/* ───────── withwork postback (S6-b) ───────── */
export interface PostbackPayload {
  slug: string;            // 랜딩 슬러그(am_lp)
  am_anon?: string;
  gate?: string;
  amount: number;
  monthly: boolean;
  memberId: string;        // 해시
  at: string;              // ISO
  intentId?: string;       // 통보문 ⑧ — AM 모달 결제 의도 id(additive)
}

export async function postbackLitReturn(extras: CampaignExtras, payload: PostbackPayload): Promise<{ ok: boolean; attempts: number; status?: number; skipped?: string }> {
  const secret = (process.env.SIREN_AM_POSTBACK_SECRET || "").trim();
  if (!secret) return { ok: false, attempts: 0, skipped: "SIREN_AM_POSTBACK_SECRET 미설정" };
  if (!extras.postbackUrl) return { ok: false, attempts: 0, skipped: "postbackUrl 없음" };

  const body = JSON.stringify(payload);
  const delays = [0, 600, 1800];
  let lastStatus: number | undefined;
  for (let i = 0; i < 3; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(extras.postbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-siren-secret": secret,
          "x-idempotency-key": `${payload.memberId}:${payload.at}`,
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;
      if (res.ok) return { ok: true, attempts: i + 1, status: res.status };
      /* 4xx는 재시도해도 같다(인증·형식). 5xx·네트워크만 재시도 */
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, attempts: i + 1, status: res.status };
      }
    } catch (e) {
      console.warn(`[lantern] postback ${i + 1}회 실패:`, (e as any)?.message);
    }
  }
  return { ok: false, attempts: 3, status: lastStatus };
}

/* ───────── 결제 완료 후 한 번에 처리 ───────── */
/**
 * approve 핸들러(일시·정기)가 완료 확정 직후 호출한다.
 * 등불 캠페인이 아니면 null. 실패해도 throw 하지 않는다(결제 완료가 우선).
 */
export async function afterLanternCompletion(opts: {
  donationId: number;
  memberId: number | null;
  amount: number;
  monthly: boolean;
  paidAt: Date;
}): Promise<LanternCompletion | null> {
  try {
    const row = await readDonationLantern(opts.donationId);
    if (!row || !row.campaignId) return null;
    const extras = getCampaignExtras(row.campaignSlug);
    if (!extras) return null;

    const meta = sanitizeAmMeta(row.sourceMeta);
    const lanternNo = await computeLanternNo(row.campaignId, row.id);
    const returnUrl = buildLandingReturnUrl(extras, meta);

    let postback: LanternCompletion["postback"] = null;
    if (meta) {
      /* 이미 보낸 적 있으면(중복 복귀) 다시 보내지 않는다 */
      const already = row.sourceMeta && row.sourceMeta.postback && row.sourceMeta.postback.ok === true;
      if (already) {
        postback = { ok: true, attempts: 0, skipped: "이미 전송됨" };
      } else {
        postback = await postbackLitReturn(extras, {
          slug: meta.am_lp,
          am_anon: meta.am_anon,
          gate: meta.gate,
          amount: opts.amount,
          monthly: opts.monthly,
          memberId: memberHash(opts.memberId, opts.donationId),
          at: opts.paidAt.toISOString(),
          intentId: meta.intentId,
        });
      }
    }

    await saveDonationSourceMeta(opts.donationId, null, {
      lanternNo,
      completedAt: opts.paidAt.toISOString(),
      postback: postback ? { ...postback, at: new Date().toISOString() } : undefined,
    });

    return { extras, meta, lanternNo, returnUrl, postback };
  } catch (e) {
    console.warn("[lantern] afterLanternCompletion 예외(무시):", (e as any)?.message);
    return null;
  }
}

/** 완료 화면 주소에 붙일 랜딩 파라미터 문자열 (&am_lp=…&am_anon=…&gate=…&lantern=1) */
export function lanternRedirectParams(c: LanternCompletion | null): string {
  if (!c) return "";
  const p = new URLSearchParams();
  p.set("lantern", "1");
  if (c.meta) {
    p.set("am_lp", c.meta.am_lp);
    if (c.meta.am_anon) p.set("am_anon", c.meta.am_anon);
    if (c.meta.gate) p.set("gate", c.meta.gate);
    if (c.meta.intentId) p.set("intent", c.meta.intentId);
  }
  return "&" + p.toString();
}
