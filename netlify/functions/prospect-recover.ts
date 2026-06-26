/**
 * prospect-recover — 1회용: 완료 일시후원 게스트(회원 미연결)를 예비후원자로 백필 + 검증.
 * GET                 → 진단(대상·읽기만)  /  GET ?secret=..&run=1 → 등록 실행 후 결과 검증. 호출 후 삭제.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ensureProspectFromDonation } from "../../lib/prospect-from-donation";

export const config = { path: "/api/prospect-recover" };
const H = { "Content-Type": "application/json; charset=utf-8" };
function out(o: object, s = 200) { return new Response(JSON.stringify(o, null, 2), { status: s, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }

async function targetsQ() {
  return rows(await db.execute(sql`
    SELECT id, donor_name AS "donorName", donor_email AS "donorEmail", donor_phone AS "donorPhone",
           pay_method AS "payMethod", is_anonymous AS "isAnonymous"
      FROM donations
     WHERE type = 'onetime' AND status = 'completed' AND member_id IS NULL
       AND COALESCE(donor_name,'') <> '' AND (COALESCE(donor_phone,'') <> '' OR COALESCE(donor_email,'') <> '')
     ORDER BY created_at DESC`));
}

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (url.searchParams.get("run") !== "1") { const t = await targetsQ(); return out({ ok: true, mode: "diagnostic", targetCount: t.length, targets: t }); }
  if (!process.env.INTERNAL_TRIGGER_SECRET || url.searchParams.get("secret") !== process.env.INTERNAL_TRIGGER_SECRET) return out({ ok: false, error: "시크릿 불일치" }, 403);

  const before = await targetsQ();
  for (const t of before) {
    try { await ensureProspectFromDonation({ donationId: Number(t.id), memberId: null, donorName: t.donorName, donorEmail: t.donorEmail, donorPhone: t.donorPhone, entryPath: "onetime_donation_backfill" }); } catch (_) {}
  }
  /* 검증: 처리 후 회원 연결·이름 확인 */
  const after = rows(await db.execute(sql`
    SELECT d.id AS "donationId", d.donor_name AS "donationName", d.member_id AS "memberId", m.name AS "memberName", m.donor_type AS "donorType", m.prospect_subtype AS "subtype"
      FROM donations d LEFT JOIN members m ON m.id = d.member_id
     WHERE d.id = ANY(${sql.raw(`ARRAY[${before.map((x: any) => Number(x.id)).filter(Number.isFinite).join(",") || "0"}]::int[]`)})`));
  const remaining = await targetsQ();
  return out({ ok: true, processed: before.length, linkedAfter: after, stillUnlinked: remaining.length });
};
