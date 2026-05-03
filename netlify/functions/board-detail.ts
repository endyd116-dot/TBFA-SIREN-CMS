// netlify/functions/board-detail.ts
// ★ Phase M-8: 게시글 상세 + 조회수 증가 + 댓글 목록 포함

import type { Context } from "@netlify/functions";
import { eq, and, asc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts, boardComments, blobUploads } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, badRequest, notFound, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";
import { sql } from "drizzle-orm";

export const config = { path: "/api/board/detail" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [post] = await db.select().from(boardPosts)
      .where(and(eq(boardPosts.id, id), eq(boardPosts.isHidden, false)))
      .limit(1);

    if (!post) return notFound("게시글을 찾을 수 없습니다");

    /* 조회수 +1 (자기 글이면 안 올림) */
    const user = authenticateUser(req);
    const isOwner = user && (post as any).memberId === user.uid;
    if (!isOwner) {
      const viewsPayload: any = { views: sql`${boardPosts.views} + 1` };
      db.update(boardPosts)
        .set(viewsPayload)
        .where(eq(boardPosts.id, id))
        .catch(() => {});
    }

    /* 첨부파일 */
    const r: any = post;
    let attachments: any[] = [];
    if (r.attachmentIds) {
      try {
        const ids = JSON.parse(r.attachmentIds);
        if (Array.isArray(ids) && ids.length) {
          const files = await db.select().from(blobUploads).where(inArray(blobUploads.id, ids));
          attachments = files.map((f: any) => ({
            id: f.id, originalName: f.originalName, mimeType: f.mimeType,
            sizeBytes: f.sizeBytes, url: `/api/blob-image?id=${f.id}`,
          }));
        }
      } catch (_) {}
    }

    /* 댓글 목록 (부적절 댓글 제외) */
    const comments = await db.select().from(boardComments)
      .where(and(eq(boardComments.postId, id), eq(boardComments.isHidden, false)))
      .orderBy(asc(boardComments.createdAt));

    return ok({
      post: {
        id: r.id, postNo: r.postNo, category: r.category,
        title: r.title, contentHtml: r.contentHtml,
        authorName: r.authorName, memberId: r.memberId,
        isAnonymous: r.isAnonymous, isPinned: r.isPinned,
        views: r.views + (isOwner ? 0 : 1),
        likeCount: r.likeCount, commentCount: r.commentCount,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        attachments,
        isOwner: !!isOwner,
      },
      comments: comments.map((c: any) => ({
        id: c.id, content: c.content, authorName: c.authorName,
        memberId: c.memberId, isAnonymous: c.isAnonymous,
        parentId: c.parentId, createdAt: c.createdAt,
        isOwner: user && c.memberId === user.uid,
      })),
    });
  } catch (e: any) {
    console.error("[board-detail]", e);
    return serverError("상세 조회 실패", e);
  }
};