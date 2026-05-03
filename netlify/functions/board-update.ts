// netlify/functions/board-update.ts
// ★ Phase M-8: 게시글 수정 (본인만)

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/board/update" };

const VALID_CATEGORIES = ["general", "share", "question", "info", "etc"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST" && req.method !== "PATCH") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const id = Number(body.id);
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [post] = await db.select().from(boardPosts).where(eq(boardPosts.id, id)).limit(1);
    if (!post) return notFound("게시글을 찾을 수 없습니다");
    if ((post as any).memberId !== user.uid) return forbidden("본인 게시글만 수정 가능합니다");
    if ((post as any).isHidden) return forbidden("숨김 처리된 게시글은 수정할 수 없습니다");

    const updateData: any = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const t = String(body.title).trim().slice(0, 200);
      if (!t) return badRequest("제목은 비울 수 없습니다");
      updateData.title = t;
    }
    if (body.contentHtml !== undefined) {
      const c = String(body.contentHtml).trim();
      if (c.length < 5) return badRequest("내용을 5자 이상 입력해주세요");
      if (c.length > 100000) return badRequest("내용이 너무 깁니다");
      updateData.contentHtml = c;
    }
    if (body.category !== undefined && VALID_CATEGORIES.includes(body.category)) {
      updateData.category = body.category;
    }
    if (body.isAnonymous !== undefined) {
      updateData.isAnonymous = !!body.isAnonymous;
    }
    if (Array.isArray(body.attachmentIds)) {
      const ids = body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number);
      updateData.attachmentIds = ids.length ? JSON.stringify(ids) : null;
    }

    await db.update(boardPosts).set(updateData).where(eq(boardPosts.id, id));

    try {
      await logUserAction(req, user.uid, "user", "board_post_update", {
        target: (post as any).postNo,
        success: true,
      });
    } catch (_) {}

    return ok({ id, postNo: (post as any).postNo }, "수정되었습니다");
  } catch (e: any) {
    console.error("[board-update]", e);
    return serverError("수정 실패", e);
  }
};