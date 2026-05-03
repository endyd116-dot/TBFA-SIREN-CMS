// netlify/functions/admin-board-posts.ts
// ★ M-10: 자유게시판 관리자 목록 + 상세 + 숨김/메모/답변

import type { Context } from "@netlify/functions";
import { eq, and, desc, count, or, like, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts, boardComments, members, blobUploads } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { sendEmail, tplBoardResponseUser } from "../../lib/email";
import { createNotification } from "../../lib/notify";
import { logAdminAction } from "../../lib/audit";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/admin/board-posts" };

const VALID_CATEGORIES = ["general", "share", "question", "info", "etc"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* 상세 */
      if (id) {
        const postId = Number(id);
        if (!Number.isFinite(postId)) return badRequest("id 유효하지 않음");

        const [row] = await db.select({
          post: boardPosts,
          memberName: members.name,
          memberEmail: members.email,
        })
          .from(boardPosts)
          .leftJoin(members, eq(boardPosts.memberId, members.id))
          .where(eq(boardPosts.id, postId))
          .limit(1);

        if (!row) return notFound("게시글을 찾을 수 없습니다");

        const r: any = row.post;
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

        /* 댓글 (숨김 포함 — 관리자는 모두 볼 수 있음) */
        const comments = await db.select().from(boardComments)
          .where(eq(boardComments.postId, postId))
          .orderBy(boardComments.createdAt);

        return ok({
          post: {
            ...r,
            memberName: row.memberName,
            memberEmail: row.memberEmail,
            attachments,
          },
          comments,
        });
      }

      /* 목록 */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const category = url.searchParams.get("category") || "";
      const hidden = url.searchParams.get("hidden");
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [];
      if (VALID_CATEGORIES.includes(category)) conds.push(eq(boardPosts.category, category as any));
      if (hidden === "1") conds.push(eq(boardPosts.isHidden, true));
      else if (hidden === "0") conds.push(eq(boardPosts.isHidden, false));
      if (q) {
        conds.push(or(
          like(boardPosts.title, `%${q}%`),
          like(boardPosts.postNo, `%${q}%`),
          like(boardPosts.authorName, `%${q}%`),
        ));
      }
      const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

      const [{ total }]: any = await db.select({ total: count() }).from(boardPosts).where(where as any);

      const list = await db.select({
        id: boardPosts.id,
        postNo: boardPosts.postNo,
        title: boardPosts.title,
        category: boardPosts.category,
        authorName: boardPosts.authorName,
        memberId: boardPosts.memberId,
        isAnonymous: boardPosts.isAnonymous,
        isPinned: boardPosts.isPinned,
        isHidden: boardPosts.isHidden,
        views: boardPosts.views,
        commentCount: boardPosts.commentCount,
        adminMemo: boardPosts.adminMemo,
        createdAt: boardPosts.createdAt,
      })
        .from(boardPosts)
        .where(where as any)
        .orderBy(desc(boardPosts.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const stats = await db.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCount",
          COUNT(*) FILTER (WHERE is_hidden = TRUE)::int AS "hiddenCount",
          COUNT(*) FILTER (WHERE is_pinned = TRUE)::int AS "pinnedCount",
          (SELECT COUNT(*)::int FROM board_comments WHERE is_hidden = FALSE) AS "commentTotal"
        FROM board_posts
      `);
      const s: any = stats[0] || {};

      return ok({
        list,
        pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
        stats: {
          total: s.totalCount || 0,
          hidden: s.hiddenCount || 0,
          pinned: s.pinnedCount || 0,
          commentTotal: s.commentTotal || 0,
        },
      });
    }

    /* ===== PATCH: 숨김 토글 / 고정 / 메모 / 답변 ===== */
    if (req.method === "PATCH") {
      const body: any = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const id = Number(body.id);
      if (!Number.isFinite(id)) return badRequest("id 유효하지 않음");

      const [row] = await db.select().from(boardPosts).where(eq(boardPosts.id, id)).limit(1);
      if (!row) return notFound("게시글을 찾을 수 없습니다");

      const updateData: any = { updatedAt: new Date() };
      let actionType = "board_admin_update";
      let actionDetail: any = {};

      if (typeof body.isHidden === "boolean") {
        updateData.isHidden = body.isHidden;
        actionType = body.isHidden ? "board_admin_hide" : "board_admin_unhide";
        actionDetail.isHidden = body.isHidden;
      }
      if (typeof body.isPinned === "boolean") {
        updateData.isPinned = body.isPinned;
        actionDetail.isPinned = body.isPinned;
      }
      if (body.adminMemo !== undefined) {
        updateData.adminMemo = String(body.adminMemo).slice(0, 5000) || null;
        actionDetail.memoUpdated = true;
      }

      /* 관리자 답변(공식 입장)을 댓글로 추가하는 옵션 */
      const adminResponse = body.adminResponse !== undefined
        ? String(body.adminResponse).trim()
        : undefined;
      const sendMailFlag = body.sendEmail === true;
      const sendNotifyFlag = body.sendNotify !== false;

      let createdCommentId: number | null = null;

      if (adminResponse) {
        /* 관리자 답변을 댓글로 등록 */
        const [me] = await db.select({ name: members.name }).from(members)
          .where(eq(members.id, (admin as any).uid)).limit(1);

        const insertData: any = {
          postId: id,
          memberId: (admin as any).uid,
          authorName: `[운영진] ${(me as any)?.name || "관리자"}`,
          content: adminResponse.slice(0, 1000),
          isAnonymous: false,
        };
        const [c] = await db.insert(boardComments).values(insertData).returning();
        createdCommentId = (c as any).id;

        /* 댓글 카운트 +1 */
        await db.update(boardPosts)
          .set({ commentCount: sql`${boardPosts.commentCount} + 1` as any } as any)
          .where(eq(boardPosts.id, id));

        actionType = "board_admin_response";
        actionDetail.commentId = createdCommentId;
      }

      await db.update(boardPosts).set(updateData).where(eq(boardPosts.id, id));

      /* 메일 / 알림 (작성자 신원이 있고 답변 등록한 경우만) */
      let emailSent = false;
      if (adminResponse && (row as any).memberId) {
        const [member] = await db.select({ id: members.id, name: members.name, email: members.email })
          .from(members).where(eq(members.id, (row as any).memberId)).limit(1);

        if (member) {
          if (sendMailFlag && member.email) {
            try {
              const tpl = tplBoardResponseUser({
                applicantName: member.name,
                postNo: (row as any).postNo,
                title: (row as any).title,
                postId: id,
              });
              const result = await sendEmail({ to: member.email, subject: tpl.subject, html: tpl.html });
              emailSent = !!result.ok;
            } catch (e) {
              console.error("[admin-board-posts] 메일 실패:", e);
            }
          }

          if (sendNotifyFlag) {
            try {
              await createNotification({
                recipientId: member.id,
                recipientType: "user",
                category: "support",
                severity: "info",
                title: "💬 자유게시판 게시글에 운영진 답변이 등록되었습니다",
                message: (row as any).title,
                link: `/board-view.html?id=${id}`,
                refTable: "board_posts",
                refId: id,
              });
            } catch (e) {
              console.warn("[admin-board-posts] 알림 실패:", e);
            }
          }
        }
      }

      try {
        await logAdminAction(req, (admin as any).uid, (admin as any).name, actionType, {
          target: (row as any).postNo,
          detail: actionDetail,
        });
      } catch (_) {}

      return ok({
        id,
        postNo: (row as any).postNo,
        emailSent,
        commentId: createdCommentId,
      }, "처리되었습니다");
    }

    /* ===== DELETE: 댓글 강제 삭제 ===== */
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action");

      if (action === "comment") {
        const commentId = Number(url.searchParams.get("commentId"));
        if (!Number.isFinite(commentId)) return badRequest("commentId 필요");

        const [c] = await db.select().from(boardComments).where(eq(boardComments.id, commentId)).limit(1);
        if (!c) return notFound("댓글을 찾을 수 없습니다");

        const postId = (c as any).postId;
        await db.delete(boardComments).where(eq(boardComments.id, commentId));

        db.update(boardPosts)
          .set({ commentCount: sql`GREATEST(${boardPosts.commentCount} - 1, 0)` as any } as any)
          .where(eq(boardPosts.id, postId)).catch(() => {});

        try {
          await logAdminAction(req, (admin as any).uid, (admin as any).name, "board_admin_delete_comment", {
            target: `comment-${commentId}`,
          });
        } catch (_) {}

        return ok({ commentId }, "댓글이 삭제되었습니다");
      }

      return badRequest("action 파라미터 필요");
    }

    return methodNotAllowed();
  } catch (e: any) {
    console.error("[admin-board-posts]", e);
    return serverError("처리 실패", e);
  }
};