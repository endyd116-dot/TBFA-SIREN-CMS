// user-post-subscribe.ts — 게시글/게시판 구독 토글
// POST /api/user-post-subscribe  body: { postId? | boardCategory? }
// DELETE /api/user-post-subscribe?postId=&boardCategory=
import { requireActiveUser } from "../../lib/auth";
import { db } from "../../db";
import { postSubscriptions } from "../../db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const config = { path: "/api/user-post-subscribe" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false, error: "구독 처리 실패", step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async (req: Request) => {
  let auth: any;
  try {
    auth = await requireActiveUser(req);
  } catch (err) {
    return jsonError("auth", err);
  }
  if (!auth.ok) return auth.res;

  const memberId = auth.user.uid as number;

  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch (err) {
      return jsonError("parse_body", err);
    }

    const postId: number | undefined = body.postId ? Number(body.postId) : undefined;
    const boardCategory: string | undefined = body.boardCategory || undefined;

    if (!postId && !boardCategory) {
      return new Response(JSON.stringify({ ok: false, error: "postId 또는 boardCategory 필요" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    if (postId && boardCategory) {
      return new Response(JSON.stringify({ ok: false, error: "postId와 boardCategory 동시 사용 불가" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // 이미 구독 중인지 확인
    let existing: any[];
    try {
      const cond = postId
        ? and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId))
        : and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.boardCategory, boardCategory!), isNull(postSubscriptions.postId));
      existing = await db.select({ id: postSubscriptions.id }).from(postSubscriptions).where(cond).limit(1);
    } catch (err) {
      return jsonError("select_existing", err);
    }

    if (existing.length > 0) {
      return new Response(JSON.stringify({ ok: true, subscribed: true, message: "이미 구독 중입니다." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      await db.insert(postSubscriptions).values({ memberId, postId, boardCategory } as any);
    } catch (err) {
      return jsonError("insert_sub", err);
    }

    return new Response(JSON.stringify({ ok: true, subscribed: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const postId = url.searchParams.get("postId") ? Number(url.searchParams.get("postId")) : undefined;
    const boardCategory = url.searchParams.get("boardCategory") || undefined;

    if (!postId && !boardCategory) {
      return new Response(JSON.stringify({ ok: false, error: "postId 또는 boardCategory 필요" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const cond = postId
        ? and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.postId, postId))
        : and(eq(postSubscriptions.memberId, memberId), eq(postSubscriptions.boardCategory, boardCategory!), isNull(postSubscriptions.postId));
      await db.delete(postSubscriptions).where(cond);
    } catch (err) {
      return jsonError("delete_sub", err);
    }

    return new Response(JSON.stringify({ ok: true, subscribed: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "허용되지 않는 메서드" }), {
    status: 405, headers: { "Content-Type": "application/json" },
  });
};
