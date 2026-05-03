// netlify/functions/board-create.ts
// ★ Phase M-8: 게시글 작성 (로그인 필수)

import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts, members } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import {
  created, badRequest, unauthorized, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/board/create" };

const VALID_CATEGORIES = ["general", "share", "question", "info", "etc"];

function genPostNo(): string {
  const y = new Date().getFullYear();
  const r = String(Math.floor(Math.random() * 9000) + 1000);
  return `B-${y}-${r}`;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "general";
    const title = String(body.title || "").trim().slice(0, 200);
    const contentHtml = String(body.contentHtml || "").trim();
    const isAnonymous = !!body.isAnonymous;
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((x: any) => Number.isFinite(Number(x))).map(Number)
      : [];

    if (!title) return badRequest("제목은 필수입니다");
    if (!contentHtml || contentHtml.length < 5) return badRequest("내용을 5자 이상 입력해주세요");
    if (contentHtml.length > 100000) return badRequest("내용이 너무 깁니다");

    const [me] = await db.select().from(members).where(eq(members.id, user.uid)).limit(1);
    const authorName = isAnonymous ? "익명" : (me as any)?.name || "회원";

    const insertData: any = {
      postNo: genPostNo(),
      memberId: user.uid,
      authorName,
      category,
      title,
      contentHtml,
      attachmentIds: attachmentIds.length ? JSON.stringify(attachmentIds) : null,
      isAnonymous,
    };

    const [record] = await db.insert(boardPosts).values(insertData).returning();

    try {
      await logUserAction(req, user.uid, (me as any)?.name || "unknown", "board_post_create", {
        target: (record as any).postNo,
        detail: { category, isAnonymous },
        success: true,
      });
    } catch (_) {}

    return created({
      postId: (record as any).id,
      postNo: (record as any).postNo,
    }, "게시글이 등록되었습니다");
  } catch (e: any) {
    console.error("[board-create]", e);
    return serverError("작성 실패", e);
  }
};