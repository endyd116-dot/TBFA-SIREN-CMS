import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialLetters } from "../../db/schema";
import { requireActiveUser, authenticateUser } from "../../lib/auth";
import { moderateMemorialText } from "../../lib/memorial-moderation";
import { notifyAllOperators } from "../../lib/notify";
import { eq, and, desc } from "drizzle-orm";

export const config = { path: "/api/memorial-letters" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
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
      return new Response(jsonKST({ ok: false, error: "teacherId 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const rows = await db
        .select({
          id:         memorialLetters.id,
          memberId:   memorialLetters.memberId,   /* US-028: isMine 판정용(응답엔 미포함) */
          authorName: memorialLetters.authorName,
          title:      memorialLetters.title,
          content:    memorialLetters.content,
          createdAt:  memorialLetters.createdAt,
        })
        .from(memorialLetters)
        .where(and(eq(memorialLetters.teacherId, teacherId), eq(memorialLetters.isHidden, false)))
        .orderBy(desc(memorialLetters.createdAt));

      /* US-028: 로그인 회원이 본인 편지를 식별하도록 isMine만 노출(memberId는 제외) */
      const viewer = authenticateUser(req);
      const letters = rows.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        title: r.title,
        content: r.content,
        createdAt: r.createdAt,
        isMine: !!(viewer && r.memberId === viewer.uid),
      }));

      return new Response(jsonKST({ ok: true, data: { letters } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_letters", err);
    }
  }

  /* ───────────── POST: 작성·삭제 (회원만) ───────────── */
  if (method === "POST") {
    const guard = await requireActiveUser(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;

    /* US-028: 본인 편지 삭제 (작성자 본인만) */
    if (url.searchParams.get("action") === "delete") {
      const lid = parseInt(url.searchParams.get("id") || "0", 10);
      if (!lid) return new Response(jsonKST({ ok: false, error: "id가 필요합니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        const [letter] = await db.select({ id: memorialLetters.id, memberId: memorialLetters.memberId })
          .from(memorialLetters).where(eq(memorialLetters.id, lid)).limit(1);
        if (!letter) {
          return new Response(jsonKST({ ok: false, error: "대상 편지를 찾을 수 없습니다" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        if (letter.memberId !== user.uid) {
          return new Response(jsonKST({ ok: false, error: "본인이 작성한 편지만 삭제할 수 있습니다" }), { status: 403, headers: { "Content-Type": "application/json" } });
        }
        await db.delete(memorialLetters).where(and(eq(memorialLetters.id, lid), eq(memorialLetters.memberId, user.uid)));
        return new Response(jsonKST({ ok: true, message: "편지가 삭제되었습니다." }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("delete_letter", err);
      }
    }

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const teacherId: number = body.teacherId ? Number(body.teacherId) : 0;
    const title = (body.title || "").toString().trim().slice(0, 150) || null;
    const content = (body.content || "").toString().trim();
    const isAnonymous = !!body.isAnonymous;

    if (!teacherId) {
      return new Response(jsonKST({ ok: false, error: "어느 선생님께 드리는 편지인지 지정해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (!content) {
      return new Response(jsonKST({ ok: false, error: "편지 내용을 입력해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      const authorName = isAnonymous ? "익명" : (user.name || "회원");

      /* R41 Q2-013: 추모 글 AI 사전 검토 — 부적절 시 비공개 보류 + 운영자 통지. 실패 시 통과(fail-open) */
      const mod = await moderateMemorialText(`${title || ""}\n${content}`);

      const insertData: any = {
        teacherId,
        memberId: user.uid,
        authorName,
        title: title ?? undefined,
        content,
        isAnonymous,
        isHidden: mod.flagged ? true : undefined,
      };
      const [row] = await db.insert(memorialLetters).values(insertData).returning();

      if (mod.flagged) {
        /* 부적절 보류 → 운영자·슈퍼어드민에게 검토 요청 통지 (fire-and-forget) */
        notifyAllOperators({
          category: "support",
          severity: "warning",
          title: "기억의 편지 자동 보류 — 검토 필요",
          message: `AI가 부적절로 판단해 비공개 처리했습니다. (사유: ${mod.reason || "검토 필요"})`,
          link: `/admin.html#memorial`,
          refTable: "memorial_letters",
          refId: row.id,
        }).catch(() => {});
      }

      return new Response(jsonKST({
        ok: true,
        data: { letter: {
          id: row.id,
          authorName: row.authorName,
          title: row.title,
          content: row.content,
          createdAt: row.createdAt,
          pendingReview: mod.flagged,
        } },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("insert_letter", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
