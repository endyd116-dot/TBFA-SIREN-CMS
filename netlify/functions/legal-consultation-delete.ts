// netlify/functions/legal-consultation-delete.ts
// DELETE /api/legal-consultation-delete — 법률 상담 신청 삭제 (본인만)

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

export const config = { path: "/api/legal-consultation-delete" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "DELETE") return methodNotAllowed();

  /* auth */
  const _r = await requireActiveUser(req);
  if (!_r.ok) return (_r as { ok: false; res: Response }).res;
  const auth = _r.user;

  try {
    const url = new URL(req.url);
    let id = Number(url.searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      const body: any = await parseJson(req).catch(() => null);
      id = Number(body?.id);
    }
    if (!Number.isFinite(id) || id <= 0) return badRequest("id 필요");

    /* select — WHERE id=? AND memberId=auth.uid */
    const [row]: any = await db
      .select()
      .from(legalConsultations)
      .where(and(eq(legalConsultations.id, id), eq(legalConsultations.memberId, auth.uid)))
      .limit(1);

    if (!row) return notFound("법률 상담 신청을 찾을 수 없습니다");

    await db.delete(legalConsultations).where(eq(legalConsultations.id, id));

    try {
      await logUserAction(req, auth.uid, "user", "legal_consultation_delete", {
        target: row.consultationNo || String(id),
        success: true,
      });
    } catch (_) {}

    return ok({ ok: true });
  } catch (err) {
    console.error("[legal-consultation-delete]", err);
    return serverError("삭제 처리 중 오류가 발생했습니다", err);
  }
};
