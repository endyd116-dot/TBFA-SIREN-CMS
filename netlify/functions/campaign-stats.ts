// netlify/functions/campaign-stats.ts
// S6-a — 랜딩(withwork)이 읽는 캠페인 실값. 공개 GET·개인정보 0.
//
// GET /api/campaign-stats?slug=<캠페인슬러그>
// → { ok:true, slug, title,
//     members, monthly, recent:[{name(마스킹), school?, note?, at}], bySchool:[{school,count}],   (S6-a)
//     raisedKrw, goalKrw, donors:[{name, amountKrw, monthly, at}], raisedAsOf,                    (AM 요청 ⑬ · additive)
//     updatedAt }
//
//  집계는 lib/campaign-stats.ts computeCampaignPublicStats 한 곳 — 캠페인 페이지 서버 렌더도 같은 함수를 써서
//  랜딩 게이지와 캠페인 페이지 숫자가 항상 같다.
//  응답 키 이름은 AutoMarketing과 계약된 그대로다 — 바꾸면 랜딩 실값이 조용히 0이 된다.
//  캐시 5분(AM도 5분 캐시로 읽는다).

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { campaigns } from "../../db/schema";
import { computeCampaignPublicStats } from "../../lib/campaign-stats";

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
      .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title, goalAmount: campaigns.goalAmount })
      .from(campaigns)
      .where(and(eq(campaigns.slug, slug), eq(campaigns.isPublished, true)))
      .limit(1);
    if (!c) return json({ ok: false, error: "캠페인을 찾을 수 없습니다" }, 404);

    const s = await computeCampaignPublicStats({ id: c.id, goalAmount: c.goalAmount });

    return json(
      {
        ok: true,
        slug: c.slug,
        title: c.title,
        members: s.members,
        monthly: s.monthly,
        recent: s.recent,
        bySchool: s.bySchool,
        raisedKrw: s.raisedKrw,
        goalKrw: s.goalKrw,
        donors: s.donors,
        raisedAsOf: s.raisedAsOf,
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
