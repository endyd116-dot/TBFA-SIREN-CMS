// netlify/functions/harassment-report-update.ts
// PATCH /api/harassment-report-update — 악성민원 신고 수정 (본인, submitted 상태만)

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import {
  ok, badRequest, forbidden, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/harassment-report-update" };

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
    /* P1-6 fix: 프론트가 본문을 content 키로 보냄 → contentHtml 우선, content 폴백(미반영 데이터손실 해소) */
    const _content = body.contentHtml !== undefined ? body.contentHtml : body.content;
    const contentHtml = _content !== undefined ? String(_content).trim() : undefined;
    const category = body.category !== undefined ? String(body.category).trim() : undefined;
    /* R41 Q2-011: 클라가 보내는 발생빈도(frequency)·발생일(occurredAt) 반영 */
    const VALID_FREQUENCIES = ["once", "recurring", "ongoing"];
    const frequency = body.frequency !== undefined ? String(body.frequency).trim() : undefined;
    let occurredAt: Date | undefined;
    if (body.occurredAt !== undefined && body.occurredAt !== null && body.occurredAt !== "") {
      const d = new Date(body.occurredAt);
      if (!isNaN(d.getTime())) occurredAt = d;
    }

    if (title !== undefined && !title) return badRequest("제목은 비워둘 수 없습니다");
    if (contentHtml !== undefined && contentHtml.length < 10) return badRequest("내용을 10자 이상 입력해주세요");
    if (frequency !== undefined && frequency && !VALID_FREQUENCIES.includes(frequency)) return badRequest("발생 빈도 값이 올바르지 않습니다");

    /* select — WHERE id=? AND memberId=auth.uid */
    const [row]: any = await db
      .select()
      .from(harassmentReports)
      .where(and(eq(harassmentReports.id, id), eq(harassmentReports.memberId, auth.uid)))
      .limit(1);

    if (!row) return notFound("신고를 찾을 수 없습니다");

    /* check_status — R41 Q2-004: 운영자 검토 전(submitted·ai_analyzed)까지 본인 수정 허용 */
    if (row.status !== "submitted" && row.status !== "ai_analyzed" && row.status !== "rejected") {
      return new Response(
        JSON.stringify({ ok: false, error: "이미 처리 중인 항목은 수정할 수 없습니다." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const updateData: any = { updatedAt: new Date() };
    /* 2026-06-27: 반려된 신고를 본인이 수정하면 재제출(접수 상태로 복귀) */
    if (row.status === "rejected") updateData.status = "submitted";
    if (title !== undefined) updateData.title = title;
    if (contentHtml !== undefined) updateData.contentHtml = contentHtml;
    if (category !== undefined && category) updateData.category = category;
    /* R41 Q2-011: 발생빈도·발생일 반영 */
    if (frequency !== undefined && frequency) updateData.frequency = frequency;
    if (occurredAt !== undefined) updateData.occurredAt = occurredAt;

    const [updated]: any = await db
      .update(harassmentReports)
      .set(updateData)
      .where(eq(harassmentReports.id, id))
      .returning({ id: harassmentReports.id });

    try {
      await logUserAction(req, auth.uid, "user", "harassment_report_update", {
        target: String(id),
        success: true,
      });
    } catch (_) {}

    return ok({ ok: true, id: updated.id });
  } catch (err) {
    console.error("[harassment-report-update]", err);
    return serverError("수정 처리 중 오류가 발생했습니다", err);
  }
};
