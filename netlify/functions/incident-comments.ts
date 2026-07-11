// netlify/functions/incident-comments.ts
// B-2: 사건 댓글 CRUD + 좋아요/싫어요 + 신고

import type { Context } from "@netlify/functions";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db } from "../../db";
import { incidentComments, commentVotes, commentReports, members } from "../../db/schema";
import { authenticateUser, requireActiveUser } from "../../lib/auth";
import {
  ok, created, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";

export const config = { path: "/api/incident-comments" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const url = new URL(req.url);

  /* ===== GET — 댓글 목록 ===== */
  if (req.method === "GET") {
    const incidentId = Number(url.searchParams.get("incidentId"));
    if (!incidentId) return badRequest("incidentId 필요");

    const user = authenticateUser(req);
    const userId = user?.uid || null;
    const isAdmin = user?.type === "admin";

    try {
      const allComments: any = await db.execute(sql`
        SELECT 
          c.id, c.incident_id, c.member_id, c.parent_id,
          c.author_name, c.content, c.is_anonymous, c.is_private,
          c.like_count, c.dislike_count, c.is_hidden,
          c.created_at
        FROM incident_comments c
        WHERE c.incident_id = ${incidentId}
        ORDER BY c.created_at ASC
      `);
      const rows = Array.isArray(allComments) ? allComments : (allComments?.rows || []);

      /* 사용자별 투표 내역 조회 */
      let userVotes: Record<number, string> = {};
      if (userId) {
        const votes: any = await db.execute(sql`
          SELECT comment_id, vote_type FROM comment_votes WHERE member_id = ${userId}
        `);
        const vRows = Array.isArray(votes) ? votes : (votes?.rows || []);
        for (const v of vRows as any[]) {
          userVotes[v.comment_id] = v.vote_type;
        }
      }

      /* 비공개 댓글 필터링 + 숨김 처리 */
      const filtered = rows.filter((c: any) => {
        if (c.is_hidden && !isAdmin) return false;
        if (c.is_private) {
          if (!userId) return false;
          if (c.member_id !== userId && !isAdmin) return false;
        }
        return true;
      }).map((c: any) => ({
        id: c.id,
        incidentId: c.incident_id,
        parentId: c.parent_id,
        authorName: c.is_anonymous ? "익명" : c.author_name,
        content: c.content,
        isAnonymous: c.is_anonymous,
        isPrivate: c.is_private,
        isHidden: c.is_hidden,
        likeCount: c.like_count || 0,
        dislikeCount: c.dislike_count || 0,
        createdAt: c.created_at,
        isMine: userId ? c.member_id === userId : false,
        myVote: userVotes[c.id] || null,
      }));

      /* 트리 구조 변환 */
      const rootComments = filtered.filter((c: any) => !c.parentId);
      const replies = filtered.filter((c: any) => !!c.parentId);
      const tree = rootComments.map((root: any) => ({
        ...root,
        replies: replies.filter((r: any) => r.parentId === root.id),
      }));

      return ok({ comments: tree, total: filtered.length });
    } catch (e: any) {
      console.error("[incident-comments GET]", e);
      return serverError("댓글 조회 실패", e?.message);
    }
  }

  /* ===== POST — 댓글 작성 / 투표 / 신고 ===== */
  if (req.method === "POST") {
    /* R41 Q2-043: 차단(블랙) 사용자 쓰기 차단 — requireActiveUser 패턴 */
    const _r = await requireActiveUser(req);
    if (!_r.ok) return (_r as { ok: false; res: Response }).res;
    const user = _r.user;

    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const action = String(body.action || "create");

    /* ─── 댓글 작성 ─── */
    if (action === "create") {
      const incidentId = Number(body.incidentId);
      const parentId = body.parentId ? Number(body.parentId) : null;
      const content = String(body.content || "").trim().slice(0, 1000);
      const isAnonymous = !!body.isAnonymous;
      const isPrivate = !!body.isPrivate;

      if (!incidentId) return badRequest("incidentId 필요");
      if (!content || content.length < 2) return badRequest("댓글은 2자 이상");

      /* 회원 이름 조회 */
      const [me] = await db.select({ name: members.name }).from(members)
        .where(eq(members.id, user.uid)).limit(1);
      const authorName = isAnonymous ? "익명" : ((me as any)?.name || "회원");

      try {
        const [inserted] = await db.insert(incidentComments).values({
          incidentId,
          memberId: user.uid,
          parentId,
          authorName,
          content,
          isAnonymous,
          isPrivate,
        } as any).returning();

        return created({ comment: inserted }, "댓글이 등록되었습니다");
      } catch (e: any) {
        console.error("[incident-comments POST create]", e);
        return serverError("댓글 작성 실패", e?.message);
      }
    }

    /* ─── 좋아요/싫어요 ─── */
    if (action === "vote") {
      const commentId = Number(body.commentId);
      const voteType = String(body.voteType || "");

      if (!commentId) return badRequest("commentId 필요");
      if (voteType !== "like" && voteType !== "dislike") return badRequest("voteType: like 또는 dislike");

      try {
        /* 기존 투표 확인 */
        const existing: any = await db.execute(sql`
          SELECT id, vote_type FROM comment_votes 
          WHERE comment_id = ${commentId} AND member_id = ${user.uid}
        `);
        const existRows = Array.isArray(existing) ? existing : (existing?.rows || []);
        const prev = existRows[0];

        /* R41 Q2-003: 처리 후 갱신된 카운트를 응답에 포함 (프론트 즉시 반영) */
        const fetchCounts = async () => {
          const cRes: any = await db.execute(sql`SELECT like_count, dislike_count FROM incident_comments WHERE id = ${commentId}`);
          const cRows = Array.isArray(cRes) ? cRes : (cRes?.rows || []);
          const c0 = cRows[0] || {};
          return { likeCount: Number(c0.like_count || 0), dislikeCount: Number(c0.dislike_count || 0) };
        };

        if (prev) {
          if (prev.vote_type === voteType) {
            /* 같은 투표 → 취소 */
            await db.execute(sql`DELETE FROM comment_votes WHERE id = ${prev.id}`);
            const col = voteType === "like" ? sql`like_count` : sql`dislike_count`;
            await db.execute(sql`UPDATE incident_comments SET ${col} = GREATEST(${col} - 1, 0) WHERE id = ${commentId}`);
            return ok({ action: "cancelled", voteType, ...(await fetchCounts()) }, "투표가 취소되었습니다");
          } else {
            /* 다른 투표 → 변경 */
            await db.execute(sql`UPDATE comment_votes SET vote_type = ${voteType} WHERE id = ${prev.id}`);
            if (voteType === "like") {
              await db.execute(sql`UPDATE incident_comments SET like_count = like_count + 1, dislike_count = GREATEST(dislike_count - 1, 0) WHERE id = ${commentId}`);
            } else {
              await db.execute(sql`UPDATE incident_comments SET dislike_count = dislike_count + 1, like_count = GREATEST(like_count - 1, 0) WHERE id = ${commentId}`);
            }
            return ok({ action: "changed", voteType, ...(await fetchCounts()) }, "투표가 변경되었습니다");
          }
        } else {
          /* 새 투표 */
          await db.insert(commentVotes).values({
            commentId,
            memberId: user.uid,
            voteType,
          } as any);
          const col = voteType === "like" ? sql`like_count` : sql`dislike_count`;
          await db.execute(sql`UPDATE incident_comments SET ${col} = ${col} + 1 WHERE id = ${commentId}`);
          return ok({ action: "voted", voteType, ...(await fetchCounts()) }, voteType === "like" ? "공감했습니다" : "반대했습니다");
        }
      } catch (e: any) {
        console.error("[incident-comments POST vote]", e);
        return serverError("투표 실패", e?.message);
      }
    }

    /* ─── 신고 ─── */
    if (action === "report") {
      const commentId = body.commentId ? Number(body.commentId) : null;
      const incidentId = body.incidentId ? Number(body.incidentId) : null;
      const reportType = commentId ? "comment" : "incident";
      const reason = String(body.reason || "").trim().slice(0, 500);

      if (!commentId && !incidentId) return badRequest("commentId 또는 incidentId 필요");
      if (!reason || reason.length < 5) return badRequest("신고 사유를 5자 이상 입력해주세요");

      try {
        await db.insert(commentReports).values({
          commentId,
          incidentId,
          memberId: user.uid,
          reportType,
          reason,
        } as any);

        return created({ reported: true }, "신고가 접수되었습니다. 운영진이 검토 후 조치합니다.");
      } catch (e: any) {
        console.error("[incident-comments POST report]", e);
        return serverError("신고 실패", e?.message);
      }
    }

    return badRequest("유효하지 않은 action");
  }

  /* ===== DELETE — 댓글 삭제 (본인 또는 관리자) ===== */
  if (req.method === "DELETE") {
    const user = authenticateUser(req);
    if (!user) return unauthorized("로그인이 필요합니다");

    const commentId = Number(url.searchParams.get("id"));
    if (!commentId) return badRequest("id 필요");

    try {
      const existing: any = await db.execute(sql`
        SELECT id, member_id FROM incident_comments WHERE id = ${commentId}
      `);
      const rows = Array.isArray(existing) ? existing : (existing?.rows || []);
      const comment = rows[0];

      if (!comment) return notFound("댓글을 찾을 수 없습니다");

      const isOwner = comment.member_id === user.uid;
      const isAdmin = user.type === "admin";

      if (!isOwner && !isAdmin) {
        return forbidden("본인 댓글만 삭제할 수 있습니다");
      }

      await db.execute(sql`DELETE FROM incident_comments WHERE id = ${commentId}`);
      return ok({ deleted: true }, "댓글이 삭제되었습니다");
    } catch (e: any) {
      console.error("[incident-comments DELETE]", e);
      return serverError("삭제 실패", e?.message);
    }
  }

  return methodNotAllowed();
};