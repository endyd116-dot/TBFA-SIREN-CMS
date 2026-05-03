// netlify/functions/board-comment-create.ts
// ★ Phase M-8: 댓글 작성 (로그인 필수)

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts, boardComments, members } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  created, badRequest, unauthorized, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { sql } from "drizzle-orm";

export const config = { path: "/api/board/comment-create" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const postId = Number(body.postId);
    const content = String(body.content || "").trim().slice(0, 1000);
    const isAnonymous = !!body.isAnonymous;
    const parentId = Number.isFinite(Number(body.parentId)) ? Number(body.parentId) : null;

    if (!Number.isFinite(postId)) return badRequest("postId 필요");
    if (!content || content.length < 1) return badRequest("댓글 내용을 입력해주세요");

    const [post] = await db.select().from(boardPosts).where(eq(boardPosts.id, postId)).limit(1);
    if (!post) return notFound("게시글을 찾을 수 없습니다");
    if ((post as any).isHidden) return badRequest("숨김 처리된 게시글에는 댓글을 작성할 수 없습니다");

    const [me] = await db.select().from(members).where(eq(members.id, user.uid)).limit(1);
    const authorName = isAnonymous ? "익명" : (me as any)?.name || "회원";

    const insertData: any = {
      postId,
      memberId: user.uid,
      authorName,
      content,
      parentId,
      isAnonymous,
    };

    const [record] = await db.insert(boardComments).values(insertData).returning();

    /* 댓글 수 증가 */
    const incPayload: any = { commentCount: sql`${boardPosts.commentCount} + 1` };
    db.update(boardPosts)
      .set(incPayload)
      .where(eq(boardPosts.id, postId))
      .catch(() => {});
      
    return created({
      id: (record as any).id,
      content: (record as any).content,
      authorName: (record as any).authorName,
      isAnonymous: (record as any).isAnonymous,
      parentId: (record as any).parentId,
      createdAt: (record as any).createdAt,
      isOwner: true,
    }, "댓글이 등록되었습니다");
  } catch (e: any) {
    console.error("[board-comment-create]", e);
    return serverError("댓글 작성 실패", e);
  }
};