// netlify/functions/memorial-timeline.ts
// ★ 2026-10-07 정책국장 요청 — 아침관 '우리가 함께 놓은 온기의 징검다리' (공개 조회)
//
// 교사유가족협의회가 유가족 곁에서 해온 일·하고 있는 일·앞으로 할 일을 시간순으로 내보낸다.
// 운영자가 어드민(추모관 관리 > 온기의 징검다리)에서 등록한 공개분만 나간다.
// 표가 아직 없으면(마이그 전) 빈 목록으로 조용히 응답한다.

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { jsonKST } from "../../lib/kst";
import { rowsOf, timelineTableReady, TIMELINE_SELECT_COLS, shapeTimeline } from "../../lib/memorial-timeline";

export const config = { path: "/api/memorial-timeline" };

const LIMIT = 60;

export default async function handler(req: Request, _ctx: Context) {
  if (req.method.toUpperCase() !== "GET") {
    return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const headers = {
    "Content-Type": "application/json",
    /* 자주 바뀌지 않는다 — 전송망이 5분 보관, 그 뒤엔 옛 것이라도 즉시 응답 */
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=86400",
  };

  if (!(await timelineTableReady())) {
    return new Response(jsonKST({ ok: true, data: { items: [], ready: false } }), { status: 200, headers });
  }

  try {
    const rows = rowsOf(await db.execute(sql`
      SELECT ${TIMELINE_SELECT_COLS}
        FROM memorial_timeline
       WHERE is_public = TRUE
       ORDER BY sort_order ASC, event_date ASC NULLS LAST, id ASC
       LIMIT ${LIMIT}
    `));
    /* 공개 응답에는 화면이 쓰는 값만 */
    const items = rows.map(shapeTimeline).map((x) => ({
      id: x.id, eventDate: x.eventDate, dateLabel: x.dateLabel, category: x.category,
      title: x.title, summary: x.summary, detail: x.detail, photoUrl: x.photoUrl, linkUrl: x.linkUrl,
    }));
    return new Response(jsonKST({ ok: true, data: { items, ready: true } }), { status: 200, headers });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "징검다리 조회 실패",
      step: "select_timeline",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
