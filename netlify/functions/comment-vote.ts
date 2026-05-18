// netlify/functions/comment-vote.ts
// 라운드 10 — 사건 댓글 투표 (토글)
//
// POST /api/comment-vote { commentId, voteType: "up"|"down" }
// 응답: { ok, action: "added"|"removed"|"changed", upCount, downCount }
//
// 내부 저장: voteType "up"→"like", "down"→"dislike" (기존 incidentComments.like_count/dislike_count + comment_votes.vote_type 호환)

import type { Context } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requireActiveUser } from "../../lib/auth";

export const config = { path: "/api/comment-vote" };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(step: string, err: any, status = 500) {
  return json({
    ok: false,
    error: "댓글 투표 처리 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }, status);
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }

  // 1) auth
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const memberId: number = _r.user.uid;

  // 2) validate
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSON 파싱 오류" }, 400); }

  const commentId = Number(body?.commentId);
  const voteTypeRaw = String(body?.voteType || "").toLowerCase();
  if (!Number.isFinite(commentId) || commentId <= 0) {
    return json({ ok: false, error: "commentId 필요" }, 400);
  }
  if (voteTypeRaw !== "up" && voteTypeRaw !== "down") {
    return json({ ok: false, error: "voteType은 up 또는 down" }, 400);
  }
  const stored = voteTypeRaw === "up" ? "like" : "dislike";

  // 3) toggle 로직
  let action: "added" | "removed" | "changed" = "added";
  try {
    const existRes: any = await db.execute(sql`
      SELECT id, vote_type FROM comment_votes
      WHERE comment_id = ${commentId} AND member_id = ${memberId}
      LIMIT 1
    `);
    const existRows = existRes?.rows ?? existRes;
    const prev = existRows?.[0];

    if (prev) {
      if (prev.vote_type === stored) {
        // 같은 투표 → DELETE (취소)
        await db.execute(sql`DELETE FROM comment_votes WHERE id = ${prev.id}`);
        if (stored === "like") {
          await db.execute(sql`UPDATE incident_comments SET like_count = GREATEST(COALESCE(like_count,0) - 1, 0) WHERE id = ${commentId}`);
        } else {
          await db.execute(sql`UPDATE incident_comments SET dislike_count = GREATEST(COALESCE(dislike_count,0) - 1, 0) WHERE id = ${commentId}`);
        }
        action = "removed";
      } else {
        // 다른 투표 → UPDATE (변경) + 카운트 swap
        await db.execute(sql`UPDATE comment_votes SET vote_type = ${stored} WHERE id = ${prev.id}`);
        if (stored === "like") {
          await db.execute(sql`
            UPDATE incident_comments
               SET like_count = COALESCE(like_count,0) + 1,
                   dislike_count = GREATEST(COALESCE(dislike_count,0) - 1, 0)
             WHERE id = ${commentId}
          `);
        } else {
          await db.execute(sql`
            UPDATE incident_comments
               SET dislike_count = COALESCE(dislike_count,0) + 1,
                   like_count = GREATEST(COALESCE(like_count,0) - 1, 0)
             WHERE id = ${commentId}
          `);
        }
        action = "changed";
      }
    } else {
      // 새 투표 → INSERT
      await db.execute(sql`
        INSERT INTO comment_votes (comment_id, member_id, vote_type, created_at)
        VALUES (${commentId}, ${memberId}, ${stored}, now())
      `);
      if (stored === "like") {
        await db.execute(sql`UPDATE incident_comments SET like_count = COALESCE(like_count,0) + 1 WHERE id = ${commentId}`);
      } else {
        await db.execute(sql`UPDATE incident_comments SET dislike_count = COALESCE(dislike_count,0) + 1 WHERE id = ${commentId}`);
      }
      action = "added";
    }
  } catch (err: any) {
    return jsonError("toggle", err);
  }

  // 4) count
  try {
    const countRes: any = await db.execute(sql`
      SELECT
        COALESCE(like_count, 0)    AS up_count,
        COALESCE(dislike_count, 0) AS down_count
      FROM incident_comments WHERE id = ${commentId} LIMIT 1
    `);
    const row = (countRes?.rows ?? countRes)?.[0] ?? {};
    return json({
      ok: true,
      action,
      upCount: Number(row.up_count || 0),
      downCount: Number(row.down_count || 0),
    });
  } catch (err: any) {
    return jsonError("count", err);
  }
};
