// netlify/functions/board-comment-delete.ts
// ★ Phase M-8: 댓글 삭제 (본인만)

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts, boardComments } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { sql } from "drizzle-orm";

export const config = { path: "/api/board/comment-delete" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST" && req.method !== "DELETE") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    let id: number;
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      id = Number(url.searchParams.get("id"));
    } else {
      const body: any = await parseJson(req);
      id = Number(body?.id);
    }
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [comment] = await db.select().from(boardComments).where(eq(boardComments.id, id)).limit(1);
    if (!comment) return notFound("댓글을 찾을 수 없습니다");
    if ((comment as any).memberId !== user.uid) return forbidden("본인 댓글만 삭제 가능합니다");

    const postId = (comment as any).postId;

    await db.delete(boardComments).where(eq(boardComments.id, id));

    /* 댓글 수 감소 */
    const decPayload: any = { commentCount: sql`GREATEST(${boardPosts.commentCount} - 1, 0)` };
    db.update(boardPosts)
      .set(decPayload)
      .where(eq(boardPosts.id, postId))
      .catch(() => {});

    return ok({ id }, "댓글이 삭제되었습니다");
  } catch (e: any) {
    console.error("[board-comment-delete]", e);
    return serverError("댓글 삭제 실패", e);
  }
};