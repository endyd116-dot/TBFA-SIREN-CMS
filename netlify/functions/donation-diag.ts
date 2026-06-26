/**
 * donation-diag — 1회용 읽기전용 진단: 최근 결제 상태 + 예비후원자 이름 확인.
 * GET ?secret=<INTERNAL_TRIGGER_SECRET>  (읽기만·변경 없음)
 * 확인 후 삭제.
 */
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const config = { path: "/api/donation-diag" };
const H = { "Content-Type": "application/json; charset=utf-8" };
function out(o: object, s = 200) { return new Response(JSON.stringify(o, null, 2), { status: s, headers: H }); }
function rows(r: any): any[] { return (r?.rows ?? r ?? []) as any[]; }

export default async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  if (!process.env.INTERNAL_TRIGGER_SECRET || url.searchParams.get("secret") !== process.env.INTERNAL_TRIGGER_SECRET) return out({ ok: false, error: "시크릿 불일치" }, 403);
  try {
    /* 최근 12일 결제 — 상태·이름·결제수단별 */
    const donations = rows(await db.execute(sql`
      SELECT id, created_at AS "createdAt", donor_name AS "donorName", member_id AS "memberId",
             pay_method AS "payMethod", pg_provider AS "pgProvider", status, amount, type,
             is_anonymous AS "isAnonymous", LEFT(COALESCE(failure_reason,''), 80) AS "failureReason"
        FROM donations
       WHERE created_at >= NOW() - INTERVAL '12 days'
       ORDER BY created_at DESC LIMIT 60`));

    /* 결제수단×상태 집계 */
    const summary = rows(await db.execute(sql`
      SELECT pay_method AS "payMethod", pg_provider AS "pgProvider", status, COUNT(*)::int AS cnt
        FROM donations WHERE created_at >= NOW() - INTERVAL '12 days'
       GROUP BY pay_method, pg_provider, status ORDER BY pay_method, status`));

    /* 예비후원자(prospect) 회원 — 이름 비어있는지 확인 */
    const prospects = rows(await db.execute(sql`
      SELECT id, name, phone, email, prospect_subtype AS "subtype", prospect_entry_path AS "entryPath",
             created_at AS "createdAt",
             (SELECT COUNT(*) FROM donations d WHERE d.member_id = m.id)::int AS "donationCount"
        FROM members m
       WHERE donor_type = 'prospect'
       ORDER BY created_at DESC LIMIT 40`));

    /* 카드 후원이 만든 예비후원자(연결) 이름 확인 */
    const cardProspects = rows(await db.execute(sql`
      SELECT d.id AS "donationId", d.donor_name AS "donationName", d.status, d.is_anonymous AS "isAnonymous",
             m.id AS "memberId", m.name AS "memberName", m.donor_type AS "donorType", m.prospect_subtype AS "subtype"
        FROM donations d LEFT JOIN members m ON m.id = d.member_id
       WHERE d.pay_method = 'card' AND d.created_at >= NOW() - INTERVAL '20 days'
       ORDER BY d.created_at DESC LIMIT 30`));

    return out({ ok: true, donations, summary, prospects, cardProspects });
  } catch (e: any) {
    return out({ ok: false, error: String(e?.message || e).slice(0, 400), stack: String(e?.stack || "").slice(0, 500) }, 500);
  }
};
