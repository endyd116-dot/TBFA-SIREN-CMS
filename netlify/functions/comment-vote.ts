import type { Context } from "@netlify/functions";
import { eq, and, count } from "drizzle-orm";
import { db } from "../../db";
import { commentVotes } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { badRequest, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";

function jsonOk(data: object) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const user = auth.user;

  let commentId: number, voteType: string;
  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");
    commentId = Number(body.commentId);
    voteType = String(body.voteType || "");
  } catch (_) {
    return badRequest("잘못된 요청 형식입니다");
  }

  if (!commentId || !["up", "down"].includes(voteType)) {
    return badRequest("commentId와 voteType(up|down)은 필수입니다");
  }

  try {
    // 기존 투표 확인
    const [existing] = await db
      .select()
      .from(commentVotes)
      .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.memberId, user.uid)))
      .limit(1);

    let action: "added" | "removed";
    if (existing) {
      if ((existing as any).voteType === voteType) {
        // 같은 타입 → 취소(삭제)
        await db.delete(commentVotes).where(eq(commentVotes.id, (existing as any).id));
        action = "removed";
      } else {
        // 다른 타입 → 변경(업데이트)
        await db
          .update(commentVotes)
          .set({ voteType } as any)
          .where(eq(commentVotes.id, (existing as any).id));
        action = "added";
      }
    } else {
      // 신규 투표 — R41 Q2-023: (comment_id, member_id) 유니크 + onConflictDoNothing으로
      // 더블클릭·동시요청 시 중복 투표 방지(아래 카운트는 COUNT(*) 재집계라 정합 유지)
      await db
        .insert(commentVotes)
        .values({ commentId, memberId: user.uid, voteType } as any)
        .onConflictDoNothing({ target: [commentVotes.commentId, commentVotes.memberId] });
      action = "added";
    }

    // up/down 카운트 집계
    const [upRow] = await db
      .select({ cnt: count() })
      .from(commentVotes)
      .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.voteType as any, "up")));
    const [downRow] = await db
      .select({ cnt: count() })
      .from(commentVotes)
      .where(and(eq(commentVotes.commentId, commentId), eq(commentVotes.voteType as any, "down")));

    return jsonOk({
      ok: true,
      action,
      upCount: Number(upRow?.cnt ?? 0),
      downCount: Number(downRow?.cnt ?? 0),
    });
  } catch (err: any) {
    return serverError("투표 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/comment-vote" };
