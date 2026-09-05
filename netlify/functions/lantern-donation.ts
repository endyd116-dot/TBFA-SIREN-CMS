// netlify/functions/lantern-donation.ts
// S8·S11 — 내 등불(디지털 후원 증서) + 「선생님께 한마디」·공개 동의
//
// GET  /api/lantern-donation?donationId=N   (로그인 · 본인 후원만)
//   → { ok, data:{ donationId, lanternNo, name, maskedName, amount, monthly, at, note, publicConsent,
//                  campaign:{slug,title}, certificate:{tagline,campaignLabel}, receiptNotice, returnUrl } }
// GET  /api/lantern-donation?mine=1         → 내 등불 목록(등불 캠페인 후원만)
// POST /api/lantern-donation { donationId, note?, publicConsent? }
//   → 한마디(60자)·공개 동의 저장 (본인·완료된 후원만)
//
// 새 컬럼(donor_note·public_consent·source_meta)은 마이그 적용 전엔 없을 수 있어 raw SQL + try/catch.

import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { logUserAction } from "../../lib/audit";
import { getCampaignExtras } from "../../lib/campaign-extras";
import {
  readDonationLantern, computeLanternNo, maskName, sanitizeAmMeta, buildLandingReturnUrl,
} from "../../lib/lantern";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/lantern-donation" };

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

async function currentMember(req: Request): Promise<{ id: number; name: string } | null> {
  const auth = authenticateUser(req);
  if (!auth) return null;
  const [u] = await db
    .select({ id: members.id, name: members.name, status: members.status })
    .from(members)
    .where(eq(members.id, auth.uid))
    .limit(1);
  if (!u || u.status === "withdrawn" || u.status === "suspended") return null;
  return { id: u.id, name: u.name };
}

async function buildCard(donationId: number, memberId: number) {
  const row = await readDonationLantern(donationId);
  if (!row) return { error: notFound("후원 내역을 찾을 수 없습니다") };
  if (row.memberId !== memberId) return { error: forbidden("본인의 후원만 볼 수 있습니다") };
  const extras = getCampaignExtras(row.campaignSlug);
  if (!extras || !row.campaignId) return { error: badRequest("등불 캠페인 후원이 아닙니다") };
  if (row.status !== "completed") return { error: badRequest("아직 결제가 완료되지 않은 후원입니다") };

  const lanternNo = Number(row.sourceMeta?.lanternNo) || (await computeLanternNo(row.campaignId, row.id));
  const meta = sanitizeAmMeta(row.sourceMeta);
  return {
    data: {
      donationId: row.id,
      lanternNo,
      name: row.donorName,
      maskedName: maskName(row.donorName),
      amount: row.amount,
      monthly: row.type === "regular",
      at: row.paidAt ? row.paidAt.toISOString() : null,
      note: row.donorNote || "",
      publicConsent: !!row.publicConsent,
      campaign: { slug: row.campaignSlug, title: row.campaignTitle },
      certificate: extras.certificate,
      receiptNotice: extras.receiptNotice,
      returnUrl: buildLandingReturnUrl(extras, meta),
      landingBase: extras.landing.base,
      landingLp: extras.landing.lp,
    },
  };
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  try {
    const me = await currentMember(req);
    if (!me) return unauthorized("로그인이 필요합니다");

    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("mine") === "1") {
        /* 내 등불 목록 — 등불 캠페인(확장 설정 있는 캠페인)의 완료 후원만 */
        let list: any[] = [];
        try {
          const res: any = await db.execute(sql`
            SELECT d.id, d.amount, d.type::text AS type, COALESCE(d.paid_at, d.created_at) AS at,
                   d.donor_note AS note, COALESCE(d.public_consent, FALSE) AS "publicConsent",
                   d.source_meta AS "sourceMeta", c.slug AS "campaignSlug", c.title AS "campaignTitle"
            FROM donations d
            JOIN campaigns c ON c.id = d.campaign_id
            WHERE d.member_id = ${me.id} AND d.status = 'completed'
            ORDER BY COALESCE(d.paid_at, d.created_at) DESC
            LIMIT 20
          `);
          list = rowsOf(res)
            .filter((r: any) => !!getCampaignExtras(r.campaignSlug))
            .map((r: any) => ({
              donationId: Number(r.id),
              amount: Number(r.amount || 0),
              monthly: r.type === "regular",
              at: r.at ? new Date(r.at).toISOString() : null,
              note: r.note || "",
              publicConsent: !!r.publicConsent,
              lanternNo: Number(r.sourceMeta?.lanternNo) || null,
              campaign: { slug: r.campaignSlug, title: r.campaignTitle },
            }));
        } catch (e) {
          console.warn("[lantern-donation] 목록 조회 실패(컬럼 미적용 가능):", (e as any)?.message);
        }
        return ok({ list });
      }

      const donationId = Number(url.searchParams.get("donationId") || 0);
      if (!Number.isInteger(donationId) || donationId < 1) return badRequest("donationId가 필요합니다");
      const card = await buildCard(donationId, me.id);
      if ((card as any).error) return (card as any).error;
      return ok((card as any).data);
    }

    if (req.method !== "POST") return methodNotAllowed();

    const body = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");
    const donationId = Number(body.donationId || 0);
    if (!Number.isInteger(donationId) || donationId < 1) return badRequest("donationId가 필요합니다");

    const row = await readDonationLantern(donationId);
    if (!row) return notFound("후원 내역을 찾을 수 없습니다");
    if (row.memberId !== me.id) return forbidden("본인의 후원만 수정할 수 있습니다");
    if (!getCampaignExtras(row.campaignSlug)) return badRequest("등불 캠페인 후원이 아닙니다");
    if (row.status !== "completed") return badRequest("아직 결제가 완료되지 않은 후원입니다");

    const note = body.note === undefined ? undefined
      : Array.from(String(body.note || "").replace(/[\r\n\t]+/g, " ").trim()).slice(0, 60).join("");
    const publicConsent = body.publicConsent === undefined ? undefined : body.publicConsent === true;

    try {
      if (note !== undefined && publicConsent !== undefined) {
        await db.execute(sql`UPDATE donations SET donor_note = ${note || null}, public_consent = ${publicConsent}, updated_at = NOW() WHERE id = ${donationId}`);
      } else if (note !== undefined) {
        await db.execute(sql`UPDATE donations SET donor_note = ${note || null}, updated_at = NOW() WHERE id = ${donationId}`);
      } else if (publicConsent !== undefined) {
        await db.execute(sql`UPDATE donations SET public_consent = ${publicConsent}, updated_at = NOW() WHERE id = ${donationId}`);
      }
    } catch (e) {
      console.error("[lantern-donation] 저장 실패:", (e as any)?.message);
      return serverError("저장에 실패했습니다 (잠시 후 다시 시도해 주세요)", e, "update_note");
    }

    await logUserAction(req, me.id, me.name, "lantern_note_save", {
      target: `D-${donationId}`,
      detail: { hasNote: !!note, publicConsent },
    });

    const card = await buildCard(donationId, me.id);
    if ((card as any).error) return (card as any).error;
    return ok((card as any).data, "저장되었습니다");
  } catch (err: any) {
    console.error("[lantern-donation]", err);
    return serverError("처리 중 오류가 발생했습니다", err);
  }
};
