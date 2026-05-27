// netlify/functions/board-update.ts
// ★ Phase M-8: 게시글 수정 (본인만)

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { boardPosts } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/board/update" };

const VALID_CATEGORIES = ["general", "share", "question", "info", "etc"];

// Q2-049: 저장형 XSS 표면 완화 — board-create.ts와 동일 경량 정화
// <script> 블록 / on*= 이벤트 핸들러 속성 / javascript: 스킴 제거
function sanitizeContentHtml(html: string): string {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript\s*:/gi, "");
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST" && req.method !== "PATCH") return methodNotAllowed();

  /* Q2-043: 인증 + 차단 사용자 차단 (requireActiveUser) */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const user = _r.user;

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
      // Q2-049: 저장 전 경량 정화 적용 (길이 검증은 정화 후 기준)
      const c = sanitizeContentHtml(String(body.contentHtml).trim());
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