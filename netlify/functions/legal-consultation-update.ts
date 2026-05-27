// netlify/functions/legal-consultation-update.ts
// PATCH /api/legal-consultation-update — 법률 상담 신청 수정 (본인, submitted 상태만)

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/legal-consultation-update" };

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
    /* ★ P1-6 fix: 프론트가 본문을 content 키로 보냄 → contentHtml 우선, content 폴백(미반영 데이터손실 해소) */
    const _content = body.contentHtml !== undefined ? body.contentHtml : body.content;
    const contentHtml = _content !== undefined ? String(_content).trim() : undefined;
    const category = body.category !== undefined ? String(body.category).trim() : undefined;
    const partyInfo = body.partyInfo !== undefined
      ? (body.partyInfo === null ? null : String(body.partyInfo).trim().slice(0, 200))
      : undefined;

    if (title !== undefined && !title) return badRequest("제목은 비워둘 수 없습니다");
    if (contentHtml !== undefined && contentHtml.length < 10) return badRequest("내용을 10자 이상 입력해주세요");

    /* select — WHERE id=? AND memberId=auth.uid */
    const [row]: any = await db
      .select()
      .from(legalConsultations)
      .where(and(eq(legalConsultations.id, id), eq(legalConsultations.memberId, auth.uid)))
      .limit(1);

    if (!row) return notFound("법률 상담 신청을 찾을 수 없습니다");

    /* check_status — ★ R41 Q2-004: 운영자 검토 전(submitted·ai_analyzed)까지 본인 수정 허용 */
    if (row.status !== "submitted" && row.status !== "ai_analyzed") {
      return new Response(
        JSON.stringify({ ok: false, error: "이미 처리 중인 항목은 수정할 수 없습니다." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const updateData: any = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (contentHtml !== undefined) updateData.contentHtml = contentHtml;
    if (category !== undefined && category) updateData.category = category;
    if (partyInfo !== undefined) updateData.partyInfo = partyInfo;

    const [updated]: any = await db
      .update(legalConsultations)
      .set(updateData)
      .where(eq(legalConsultations.id, id))
      .returning({ id: legalConsultations.id });

    try {
      await logUserAction(req, auth.uid, "user", "legal_consultation_update", {
        target: String(id),
        success: true,
      });
    } catch (_) {}

    return ok({ ok: true, id: updated.id });
  } catch (err) {
    console.error("[legal-consultation-update]", err);
    return serverError("수정 처리 중 오류가 발생했습니다", err);
  }
};
