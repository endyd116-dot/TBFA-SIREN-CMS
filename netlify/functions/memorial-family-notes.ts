// netlify/functions/memorial-family-notes.ts
// ★ 2026-08-28 추모관 v2 — 아침관 '우린 요즘 이렇게 지냅니다' (공개 조회)
//
// 유가족이 전해온 짧은 근황을 내보낸다. 운영자가 어드민에서 등록한 것만 나간다.
// 유가족 신원 보호를 위해 실명이 아니라 표기용 이름(authorLabel)만 담는다.

import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialFamilyNotes } from "../../db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { jsonKST } from "../../lib/kst";

export const config = { path: "/api/memorial-family-notes" };

const LIMIT = 12;

export default async function handler(req: Request, _ctx: Context) {
  if (req.method.toUpperCase() !== "GET") {
    return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rows = await db
      .select({
        id:          memorialFamilyNotes.id,
        title:       memorialFamilyNotes.title,
        content:     memorialFamilyNotes.content,
        authorLabel: memorialFamilyNotes.authorLabel,
        mood:        memorialFamilyNotes.mood,
        publishedAt: memorialFamilyNotes.publishedAt,
      })
      .from(memorialFamilyNotes)
      .where(eq(memorialFamilyNotes.isPublic, true))
      .orderBy(asc(memorialFamilyNotes.sortOrder), desc(memorialFamilyNotes.publishedAt))
      .limit(LIMIT);

    return new Response(jsonKST({ ok: true, data: { notes: rows } }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        /* 자주 바뀌지 않는다 — 전송망이 5분 보관, 그 뒤엔 옛 것이라도 즉시 응답 */
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (err: any) {
    return new Response(jsonKST({
      ok: false,
      error: "근황 조회 실패",
      step: "select_family_notes",
      detail: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").slice(0, 1000),
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
