// netlify/functions/support-update.ts
// PATCH /api/support-update — 유가족 지원 신청 수정 (본인, submitted 상태만)

import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { supportRequests } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/support-update" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "PATCH") return methodNotAllowed();

  /* auth */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const auth = _r.user;

  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");

    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) return badRequest("id 필요");

    /* validate */
    const title = body.title !== undefined ? String(body.title).trim().slice(0, 200) : undefined;
    const content = body.content !== undefined ? String(body.content).trim() : undefined;
    const category = body.category !== undefined ? String(body.category) : undefined;

    if (title !== undefined && !title) return badRequest("제목은 비워둘 수 없습니다");
    if (content !== undefined && content.length < 1) return badRequest("내용을 입력해주세요");

    /* select — WHERE id=? AND memberId=auth.uid */
    const [row]: any = await db
      .select()
      .from(supportRequests)
      .where(and(eq(supportRequests.id, id), eq(supportRequests.memberId, auth.uid)))
      .limit(1);

    if (!row) return notFound("신청을 찾을 수 없습니다");

    /* check_status */
    if (row.status !== "submitted") {
      return new Response(
        jsonKST({ ok: false, error: "이미 처리 중인 항목은 수정할 수 없습니다." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const updateData: any = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (category !== undefined) updateData.category = category;

    const [updated]: any = await db
      .update(supportRequests)
      .set(updateData)
      .where(eq(supportRequests.id, id))
      .returning({ id: supportRequests.id });

    try {
      await logUserAction(req, auth.uid, "user", "support_update", {
        target: String(id),
        success: true,
      });
    } catch (_) {}

    return ok({ ok: true, id: updated.id });
  } catch (err) {
    console.error("[support-update]", err);
    return serverError("수정 처리 중 오류가 발생했습니다", err);
  }
};
