// netlify/functions/campaign-stats.ts
// S6-a — 랜딩(withwork)이 읽는 캠페인 실값. 공개 GET·개인정보 0.
//
// GET /api/campaign-stats?slug=<캠페인슬러그>
// → { ok:true, members, monthly, recent:[{name(마스킹), school?, note?, at}], bySchool:[{school,count}], updatedAt }
//
//  - members  : 이 캠페인에 후원(정기+일시)한 사람 수 — 회원은 중복 제거, 비회원은 건당 1명
//  - monthly  : 정기(월) 후원회원 수 (중복 제거)
//  - recent   : 최근 5명 — 「캠페인 페이지에 보여줘도 됩니다」에 동의한 후원만(S11)
//  - bySchool : 학교명/소속(S5·S12) 있는 회원 집계
//  응답 키 이름은 AutoMarketing과 계약된 그대로다 — 바꾸면 랜딩 실값이 조용히 0이 된다.
//  캐시 5분(AM도 5분 캐시로 읽는다).

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { campaigns } from "../../db/schema";
import { maskName } from "../../lib/lantern";

export const config = { path: "/api/campaign-stats" };

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: any, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, "Cache-Control": cache },
  });
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "GET") return json({ ok: false, error: "GET만 허용" }, 405);

  try {
    const url = new URL(req.url);
    const slugRaw = String(url.searchParams.get("slug") || "").trim();
    if (!slugRaw) return json({ ok: false, error: "slug가 필요합니다" }, 400);
    let slug = slugRaw;
    try { slug = decodeURIComponent(slugRaw); } catch { /* 그대로 */ }

    const [c] = await db
      .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title })
      .from(campaigns)
      .where(and(eq(campaigns.slug, slug), eq(campaigns.isPublished, true)))
      .limit(1);
    if (!c) return json({ ok: false, error: "캠페인을 찾을 수 없습니다" }, 404);

    /* 1) 인원 — 회원 중복 제거·비회원 건당 1명 */
    let members = 0;
    let monthly = 0;
    try {
      const res: any = await db.execute(sql`
        SELECT
          COUNT(DISTINCT COALESCE(member_id::text, 'g' || id::text))::int AS members,
          COUNT(DISTINCT COALESCE(member_id::text, 'g' || id::text))
            FILTER (WHERE type = 'regular')::int AS monthly
        FROM donations
        WHERE campaign_id = ${c.id} AND status = 'completed'
      `);
      const r = rowsOf(res)[0] || {};
      members = Number(r.members || 0);
      monthly = Number(r.monthly || 0);
    } catch (e) {
      console.warn("[campaign-stats] 인원 집계 실패:", (e as any)?.message);
    }

    /* 2) 최근 등불 — 공개 동의자만 (컬럼 미적용이면 빈 배열) */
    let recent: Array<{ name: string; school?: string; note?: string; at: string }> = [];
    try {
      const res: any = await db.execute(sql`
        SELECT d.donor_name AS name, d.donor_note AS note, d.is_anonymous AS anon,
               COALESCE(d.paid_at, d.created_at) AS at, m.school_name AS school
        FROM donations d
        LEFT JOIN members m ON m.id = d.member_id
        WHERE d.campaign_id = ${c.id} AND d.status = 'completed' AND d.public_consent = TRUE
        ORDER BY COALESCE(d.paid_at, d.created_at) DESC
        LIMIT 5
      `);
      recent = rowsOf(res).map((r: any) => {
        const item: any = {
          name: r.anon ? "익명" : maskName(r.name),
          at: new Date(r.at).toISOString(),
        };
        const school = String(r.school || "").trim();
        const note = String(r.note || "").trim();
        if (school) item.school = school;
        if (note) item.note = note.slice(0, 60);
        return item;
      });
    } catch (e) {
      console.warn("[campaign-stats] recent 집계 실패(컬럼 미적용 가능):", (e as any)?.message);
    }

    /* 3) 학교 단위 — 학교명 있는 회원만 */
    let bySchool: Array<{ school: string; count: number }> = [];
    try {
      const res: any = await db.execute(sql`
        SELECT m.school_name AS school, COUNT(DISTINCT d.member_id)::int AS count
        FROM donations d
        JOIN members m ON m.id = d.member_id
        WHERE d.campaign_id = ${c.id} AND d.status = 'completed'
          AND m.school_name IS NOT NULL AND btrim(m.school_name) <> ''
        GROUP BY m.school_name
        ORDER BY count DESC, school ASC
        LIMIT 50
      `);
      bySchool = rowsOf(res).map((r: any) => ({ school: String(r.school).trim(), count: Number(r.count || 0) }));
    } catch (e) {
      console.warn("[campaign-stats] bySchool 집계 실패(컬럼 미적용 가능):", (e as any)?.message);
    }

    return json(
      {
        ok: true,
        slug: c.slug,
        title: c.title,
        members,
        monthly,
        recent,
        bySchool,
        updatedAt: new Date().toISOString(),
      },
      200,
      "public, max-age=300, stale-while-revalidate=600",
    );
  } catch (err: any) {
    console.error("[campaign-stats]", err);
    return json({ ok: false, error: "집계 실패", detail: String(err?.message || err).slice(0, 300) }, 500);
  }
};
