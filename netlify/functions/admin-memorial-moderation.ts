import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { requireAdmin } from "../../lib/admin-guard";
import { db } from "../../db";
import { memorialMessages, memorialLetters } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { createNotification } from "../../lib/notify";

export const config = { path: "/api/admin-memorial-moderation" };

function jsonError(step: string, err: any) {
  return new Response(jsonKST({
    ok: false,
    error: "모더레이션 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return (guard as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const type = url.searchParams.get("type") === "letter" ? "letter" : "message";
  /* R41 Q2-013: sort=recent → 최신순(미검토 탭). 기본은 신고순 */
  const sortRecent = url.searchParams.get("sort") === "recent";

  /* ── GET: 신고순(기본) 또는 최신순(미검토) 목록 ── */
  if (method === "GET") {
    try {
      if (type === "letter") {
        const order = sortRecent
          ? [desc(memorialLetters.createdAt)]
          : [desc(memorialLetters.reportCount), desc(memorialLetters.createdAt)];
        const items = await db
          .select({
            id:          memorialLetters.id,
            teacherId:   memorialLetters.teacherId,
            authorName:  memorialLetters.authorName,
            title:       memorialLetters.title,
            content:     memorialLetters.content,
            reportCount: memorialLetters.reportCount,
            isHidden:    memorialLetters.isHidden,
            createdAt:   memorialLetters.createdAt,
          })
          .from(memorialLetters)
          .orderBy(...order)
          .limit(500);
        return new Response(jsonKST({ ok: true, data: { items } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      const order = sortRecent
        ? [desc(memorialMessages.createdAt)]
        : [desc(memorialMessages.reportCount), desc(memorialMessages.createdAt)];
      const items = await db
        .select({
          id:          memorialMessages.id,
          teacherId:   memorialMessages.teacherId,
          authorName:  memorialMessages.authorName,
          content:     memorialMessages.content,
          likeCount:   memorialMessages.likeCount,
          reportCount: memorialMessages.reportCount,
          isHidden:    memorialMessages.isHidden,
          createdAt:   memorialMessages.createdAt,
        })
        .from(memorialMessages)
        .orderBy(...order)
        .limit(500);
      return new Response(jsonKST({ ok: true, data: { items } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("select_moderation", err);
    }
  }

  /* ── PATCH: 숨김 토글 ── */
  if (method === "PATCH") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const isHidden = !!body.isHidden;

    const setHidden: any = { isHidden };
    try {
      // AD-046: 숨김 시 작성 회원에게 통지하기 위해 작성자 회원 id 확보
      let authorMemberId: number | null = null;
      if (type === "letter") {
        const [row] = await db.select({ memberId: memorialLetters.memberId }).from(memorialLetters).where(eq(memorialLetters.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.update(memorialLetters).set(setHidden).where(eq(memorialLetters.id, id));
      } else {
        const [row] = await db.select({ memberId: memorialMessages.memberId }).from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.update(memorialMessages).set(setHidden).where(eq(memorialMessages.id, id));
      }
      /* AD-046: 숨김 처리 시 작성 회원에게 통지 (회원 글에 한함·best-effort) */
      if (isHidden && authorMemberId) {
        try {
          await createNotification({
            recipientId: authorMemberId,
            recipientType: "user",
            category: "support",
            severity: "warning",
            title: "추모 게시글이 비공개 처리되었습니다",
            message: "작성하신 추모 글이 운영 정책에 따라 비공개 처리되었습니다. 문의가 있으시면 협의회로 연락 주세요.",
            link: "/memorial.html",
            refTable: type === "letter" ? "memorial_letters" : "memorial_messages",
            refId: id,
          });
        } catch (e) { console.warn("[admin-memorial-moderation] 숨김 통지 실패:", (e as any)?.message); }
      }
      return new Response(jsonKST({ ok: true, message: isHidden ? "숨김 처리했습니다" : "다시 공개했습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("update_moderation", err);
    }
  }

  /* ── DELETE ── */
  if (method === "DELETE") {
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return new Response(jsonKST({ ok: false, error: "id 파라미터가 필요합니다" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    try {
      // AD-046: 삭제 전 작성자 회원 id 확보 후 통지
      let authorMemberId: number | null = null;
      if (type === "letter") {
        const [row] = await db.select({ memberId: memorialLetters.memberId }).from(memorialLetters).where(eq(memorialLetters.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.delete(memorialLetters).where(eq(memorialLetters.id, id));
      } else {
        const [row] = await db.select({ memberId: memorialMessages.memberId }).from(memorialMessages).where(eq(memorialMessages.id, id)).limit(1);
        authorMemberId = (row as any)?.memberId ?? null;
        await db.delete(memorialMessages).where(eq(memorialMessages.id, id));
      }
      if (authorMemberId) {
        try {
          await createNotification({
            recipientId: authorMemberId,
            recipientType: "user",
            category: "support",
            severity: "warning",
            title: "추모 게시글이 삭제되었습니다",
            message: "작성하신 추모 글이 운영 정책에 따라 삭제되었습니다. 문의가 있으시면 협의회로 연락 주세요.",
            link: "/memorial.html",
            refTable: type === "letter" ? "memorial_letters" : "memorial_messages",
            refId: id,
          });
        } catch (e) { console.warn("[admin-memorial-moderation] 삭제 통지 실패:", (e as any)?.message); }
      }
      return new Response(jsonKST({ ok: true, message: "삭제되었습니다" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return jsonError("delete_moderation", err);
    }
  }

  return new Response(jsonKST({ ok: false, error: "지원하지 않는 메서드입니다" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
}
