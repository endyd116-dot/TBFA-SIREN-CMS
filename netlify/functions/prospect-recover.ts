/**
 * prospect-recover — 1회용: 완료된 일시후원 게스트(회원 미연결)를 예비후원자로 등록(백필 보정).
 *
 * 배경: '일시후원→예비후원자 자동등록'은 2026-06-26 추가. 그 전 완료분(예: 06/21 카드 김민정·류수옥)은
 *   회원이 안 만들어져(member_id NULL) 예비후원자 목록에 안 뜸. 기존 검증된 ensureProspectFromDonation 재실행.
 *
 * GET                 → 진단(대상 목록·인증 불필요·읽기만)
 * GET ?secret=..&run=1 → 등록 실행
 * 호출 후 삭제.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { ensureProspectFromDonation } from "../../lib/prospect-from-donation";

export const config = { path: "/api/prospect-recover" };
const H = { "Content-Type": "application/json; charset=utf-8" };
function out(o: object, s = 200) { return new Response(JSON.stringify(o, null, 2), { status: s, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";

  /* 대상: 완료된 일시(onetime) 후원 중 회원 미연결 + 이름·연락처 있음 */
  const targets = rows(await db.execute(sql`
    SELECT id, donor_name AS "donorName", donor_email AS "donorEmail", donor_phone AS "donorPhone",
           pay_method AS "payMethod", is_anonymous AS "isAnonymous", created_at AS "createdAt"
      FROM donations
     WHERE type = 'onetime' AND status = 'completed' AND member_id IS NULL
       AND COALESCE(donor_name,'') <> ''
       AND (COALESCE(donor_phone,'') <> '' OR COALESCE(donor_email,'') <> '')
     ORDER BY created_at DESC`));

  if (!run) return out({ ok: true, mode: "diagnostic", targetCount: targets.length, targets, hint: "?secret=..&run=1" });

  if (!process.env.INTERNAL_TRIGGER_SECRET || url.searchParams.get("secret") !== process.env.INTERNAL_TRIGGER_SECRET) return out({ ok: false, error: "시크릿 불일치" }, 403);

  const done: any[] = [];
  for (const t of targets) {
    try {
      await ensureProspectFromDonation({
        donationId: Number(t.id), memberId: null,
        donorName: t.donorName, donorEmail: t.donorEmail, donorPhone: t.donorPhone,
        entryPath: "onetime_donation_backfill",
      });
      done.push({ id: t.id, name: t.donorName });
    } catch (e: any) { done.push({ id: t.id, name: t.donorName, error: String(e?.message || e).slice(0, 120) }); }
  }
  return out({ ok: true, registered: done.length, done });
};
