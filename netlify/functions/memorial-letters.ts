import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialLetters } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { eq, and, desc } from "drizzle-orm";

export const config = { path: "/api/memorial-letters" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "기억의 편지 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  /* ───────────── GET: 공개 목록 (teacherId 필수) ───────────── */
  if (method === "GET") {
    const teacherId = parseInt(url.searchParams.get("teacherId") || "0", 10);
    if (!teacherId) {
      return new Response(JSON.stringify({ ok: false, error: "teacherId 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const rows = await db
        .select({
          id:         memorialLetters.id,
          authorName: memorialLetters.authorName,
          title:      memorialLetters.title,
          content:    memorialLetters.content,
          createdAt:  memorialLetters.createdAt,
        })
        .from(memorialLetters)
        .where(and(eq(memorialLetters.teacherId, teacherId), eq(memorialLetters.isHidden, false)))
        .orderBy(desc(memorialLetters.createdAt));

      return new Response(JSON.stringify({ ok: true, data: { letters: rows } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_letters", err);
    }
  }

  /* ───────────── POST: 작성 (회원만) ───────────── */
  if (method === "POST") {
    const guard = await requireActiveUser(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const teacherId: number = body.teacherId ? Number(body.teacherId) : 0;
    const title = (body.title || "").toString().trim().slice(0, 150) || null;
    const content = (body.content || "").toString().trim();
    const isAnonymous = !!body.isAnonymous;

    if (!teacherId) {
      return new Response(JSON.stringify({ ok: false, error: "어느 선생님께 드리는 편지인지 지정해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!content) {
      return new Response(JSON.stringify({ ok: false, error: "편지 내용을 입력해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      const authorName = isAnonymous ? "익명" : (user.name || "회원");
      const insertData: any = {
        teacherId,
        memberId: user.uid,
        authorName,
        title: title ?? undefined,
        content,
        isAnonymous,
      };
      const [row] = await db.insert(memorialLetters).values(insertData).returning();

      return new Response(JSON.stringify({
        ok: true,
        data: { letter: {
          id: row.id,
          authorName: row.authorName,
          title: row.title,
          content: row.content,
          createdAt: row.createdAt,
        } },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("insert_letter", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
