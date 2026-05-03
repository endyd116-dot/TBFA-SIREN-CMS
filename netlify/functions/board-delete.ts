// netlify/functions/board-delete.ts
// ★ Phase M-8: 게시글 삭제 (본인만 — 관리자는 별도 admin API)

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/board/delete" };

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

    const [post] = await db.select().from(boardPosts).where(eq(boardPosts.id, id)).limit(1);
    if (!post) return notFound("게시글을 찾을 수 없습니다");
    if ((post as any).memberId !== user.uid) return forbidden("본인 게시글만 삭제 가능합니다");

    await db.delete(boardPosts).where(eq(boardPosts.id, id));

    try {
      await logUserAction(req, user.uid, "user", "board_post_delete", {
        target: (post as any).postNo,
        success: true,
      });
    } catch (_) {}

    return ok({ id, postNo: (post as any).postNo }, "삭제되었습니다");
  } catch (e: any) {
    console.error("[board-delete]", e);
    return serverError("삭제 실패", e);
  }
};