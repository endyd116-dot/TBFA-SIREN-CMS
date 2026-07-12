import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialSettings } from "../../db/schema";
import { sql, desc } from "drizzle-orm";

export const config = { path: "/api/memorial-summary" };

const DEFAULT_HERO_ID = "l97eBPM_d9E";
const DEFAULT_HERO_COPY = "우리는 당신들을 기억합니다";

/* 보조 COUNT — 실패해도 0으로 계속 (메인 응답 보호) */
async function safeCount(q: any): Promise<number> {
  try {
    const r: any = await db.execute(q);
    const rows = r?.rows ?? r ?? [];
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    console.warn("[memorial-summary] count 실패", err);
    return 0;
  }
}

export default async function handler(_req: Request, _ctx: Context) {
  try {
    /* 카운터 — 각 독립 try/catch (하나 실패해도 나머지 표시) */
    const people = await safeCount(
      sql`SELECT COUNT(DISTINCT COALESCE(member_id::text, nickname, ip_hash)) AS n FROM memorial_offerings`
    );
    const candles = await safeCount(sql`SELECT COUNT(*)::int AS n FROM memorial_offerings`);
    const messages = await safeCount(sql`SELECT COUNT(*)::int AS n FROM memorial_messages WHERE is_hidden = FALSE`);

    /* 히어로 + BGM — 설정 1행 (없으면 기본값) */
    let heroYoutubeId = DEFAULT_HERO_ID;
    let heroCopy = DEFAULT_HERO_COPY;
    let bgmTracks: any[] = [];
    try {
      const [s] = await db
        .select()
        .from(memorialSettings)
        .orderBy(desc(memorialSettings.id))
        .limit(1);
      if (s) {
        if (s.heroYoutubeId) heroYoutubeId = s.heroYoutubeId;
        if (s.heroCopy) heroCopy = s.heroCopy;
        if (Array.isArray(s.bgmTracks)) bgmTracks = s.bgmTracks as any[];
      }
    } catch (err) {
      console.warn("[memorial-summary] settings 조회 실패", err);
    }

    return new Response(jsonKST({
      ok: true,
      data: {
        counters: { people, candles, messages },
        hero: { youtubeId: heroYoutubeId, copy: heroCopy },
        bgmTracks,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "추모관 요약 조회 실패",
      step: "summary",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
