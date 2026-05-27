import type { Context } from "@netlify/functions";
import { db } from "../../db";
import { memorialMessages, memorialMessageLikes } from "../../db/schema";
import { authenticateUser, requireActiveUser } from "../../lib/auth";
import { moderateMemorialText } from "../../lib/memorial-moderation";
import { notifyAllOperators } from "../../lib/notify";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";

export const config = { path: "/api/memorial-messages" };

const PAGE_SIZE = 20;

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "추모 메시지 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const teacherIdRaw = url.searchParams.get("teacherId");
  const teacherId: number | null = teacherIdRaw ? Number(teacherIdRaw) : null;

  /* ───────────── GET: 공개 목록 ───────────── */
  if (method === "GET") {
    try {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const offset = (page - 1) * PAGE_SIZE;

      const scope = teacherId
        ? and(eq(memorialMessages.teacherId, teacherId), eq(memorialMessages.isHidden, false))
        : and(isNull(memorialMessages.teacherId), eq(memorialMessages.isHidden, false));

      const rows = await db
        .select({
          id:         memorialMessages.id,
          authorName: memorialMessages.authorName,
          content:    memorialMessages.content,
          likeCount:  memorialMessages.likeCount,
          createdAt:  memorialMessages.createdAt,
        })
        .from(memorialMessages)
        .where(scope)
        .orderBy(desc(memorialMessages.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset);

      /* 총 개수 */
      let total = 0;
      try {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(memorialMessages).where(scope);
        total = Number(n) || 0;
      } catch (err) { console.warn("[memorial-messages] total 실패", err); }

      /* 로그인 회원이면 공감 여부 표시 */
      const likedSet = new Set<number>();
      const user = authenticateUser(req);
      if (user && rows.length) {
        try {
          const ids = rows.map((r) => r.id);
          const likes = await db
            .select({ messageId: memorialMessageLikes.messageId })
            .from(memorialMessageLikes)
            .where(and(eq(memorialMessageLikes.memberId, user.uid), inArray(memorialMessageLikes.messageId, ids)));
          for (const l of likes) likedSet.add(l.messageId);
        } catch (err) { console.warn("[memorial-messages] liked 조회 실패", err); }
      }

      const messages = rows.map((r) => ({
        id:        r.id,
        authorName: r.authorName,
        content:   r.content,
        likeCount: r.likeCount,
        createdAt: r.createdAt,
        liked:     likedSet.has(r.id),
      }));

      return new Response(JSON.stringify({
        ok: true,
        data: { messages, pagination: { page, total, hasMore: page * PAGE_SIZE < total } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("select_messages", err);
    }
  }

  /* ───────────── POST: 작성·공감·신고 (회원만) ───────────── */
  if (method === "POST") {
    const guard = await requireActiveUser(req);
    if (!guard.ok) return (guard as { ok: false; res: Response }).res;
    const user = (guard as { ok: true; user: import("../../lib/auth").UserPayload }).user;
    const action = url.searchParams.get("action");
    const id = parseInt(url.searchParams.get("id") || "0", 10);

    /* 공감 토글 */
    if (action === "like") {
      if (!id) return new Response(JSON.stringify({ ok: false, error: "id가 필요합니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        /* ★ R41 Q2-047: 존재·미숨김 메시지에만 공감 허용 (삭제·숨김 글에 고아 좋아요 방지) */
        const [msg] = await db.select({ id: memorialMessages.id, isHidden: memorialMessages.isHidden })
          .from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        if (!msg || msg.isHidden) {
          return new Response(JSON.stringify({ ok: false, error: "대상 메시지를 찾을 수 없습니다" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const existing = await db
          .select({ id: memorialMessageLikes.id })
          .from(memorialMessageLikes)
          .where(and(eq(memorialMessageLikes.messageId, id), eq(memorialMessageLikes.memberId, user.uid)))
          .limit(1);

        let liked: boolean;
        if (existing.length) {
          await db.delete(memorialMessageLikes)
            .where(and(eq(memorialMessageLikes.messageId, id), eq(memorialMessageLikes.memberId, user.uid)));
          liked = false;
        } else {
          await db.insert(memorialMessageLikes).values({ messageId: id, memberId: user.uid });
          liked = true;
        }

        /* 실제 공감 수로 재동기화 (drift 방지) */
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
          .from(memorialMessageLikes).where(eq(memorialMessageLikes.messageId, id));
        const likeCount = Number(n) || 0;
        const setLike: any = { likeCount };
        await db.update(memorialMessages).set(setLike).where(eq(memorialMessages.id, id));

        return new Response(JSON.stringify({ ok: true, data: { likeCount, liked } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("like", err);
      }
    }

    /* 신고 */
    if (action === "report") {
      if (!id) return new Response(JSON.stringify({ ok: false, error: "id가 필요합니다" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        /* ★ R41 Q2-047: 존재하는 메시지에만 신고 누적 */
        const [msg] = await db.select({ id: memorialMessages.id })
          .from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        if (!msg) {
          return new Response(JSON.stringify({ ok: false, error: "대상 메시지를 찾을 수 없습니다" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const setReport: any = { reportCount: sql`${memorialMessages.reportCount} + 1` };
        await db.update(memorialMessages)
          .set(setReport)
          .where(eq(memorialMessages.id, id));
        return new Response(JSON.stringify({ ok: true, message: "신고가 접수되었습니다. 운영자가 확인합니다." }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return jsonError("report", err);
      }
    }

    /* 작성 */
    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const content = (body.content || "").toString().trim();
    const isAnonymous = !!body.isAnonymous;
    const bodyTeacherId: number | null = body.teacherId ? Number(body.teacherId) : null;

    if (!content) {
      return new Response(JSON.stringify({ ok: false, error: "추모 메시지를 입력해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (content.length > 1000) {
      return new Response(JSON.stringify({ ok: false, error: "메시지는 1000자 이내로 작성해 주세요" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    try {
      const authorName = isAnonymous ? "익명" : (user.name || "회원");

      /* ★ R41 Q2-013: 추모 글 AI 사전 검토 — 부적절 시 비공개 보류 + 운영자 통지. 실패 시 통과(fail-open) */
      const mod = await moderateMemorialText(content);

      const insertData: any = {
        teacherId: bodyTeacherId ?? undefined,
        memberId: user.uid,
        authorName,
        content,
        isAnonymous,
        isHidden: mod.flagged ? true : undefined,
      };
      const [row] = await db.insert(memorialMessages).values(insertData).returning();

      if (mod.flagged) {
        /* 부적절 보류 → 운영자·슈퍼어드민에게 검토 요청 통지 (fire-and-forget) */
        notifyAllOperators({
          category: "support",
          severity: "warning",
          title: "🛡️ 추모 메시지 자동 보류 — 검토 필요",
          message: `AI가 부적절로 판단해 비공개 처리했습니다. (사유: ${mod.reason || "검토 필요"})`,
          link: `/admin.html#memorial`,
          refTable: "memorial_messages",
          refId: row.id,
        }).catch(() => {});
      }

      return new Response(JSON.stringify({
        ok: true,
        data: { message: {
          id: row.id,
          authorName: row.authorName,
          content: row.content,
          likeCount: row.likeCount,
          createdAt: row.createdAt,
          liked: false,
          pendingReview: mod.flagged,
        } },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return jsonError("insert_message", err);
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
