/**
 * 라운드 9 — 폼 응답 삭제 (관리자 전용)
 * DELETE /api/admin-form-submission-delete  (requireAdmin)
 *
 * 요청: { submissionId }  (body or ?submissionId=)
 * 응답: { ok }
 */
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db, formSubmissions } from "../../db";
import { requireAdmin } from "../../lib/admin-guard";
import { logAudit } from "../../lib/audit";

export const config = { path: "/api/admin-form-submission-delete" };
const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

function jsonError(status: number, step: string, error: string, detail?: any) {
  return new Response(
    JSON.stringify({ ok: false, error, step, detail: detail ? String(detail).slice(0, 500) : undefined }),
    { status, headers: JSON_HEADER }
  );
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== "DELETE") return jsonError(405, "method", "DELETE만 허용");

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as any).res;
  const adminMember = auth.ctx.member as any;

  /* submissionId — body 우선, 없으면 query string */
  let submissionId = 0;
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body: any = await req.json().catch(() => null);
      if (body?.submissionId) submissionId = Number(body.submissionId);
    }
  } catch (_) { /* ignore */ }
  if (!submissionId) {
    const url = new URL(req.url);
    submissionId = Number(url.searchParams.get("submissionId") || 0);
  }
  if (!Number.isFinite(submissionId) || submissionId <= 0) return jsonError(400, "validate", "submissionId 필수");

  try {
    const [row]: any = await db
      .select({ id: formSubmissions.id, formId: formSubmissions.formId })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, submissionId))
      .limit(1);
    if (!row) return jsonError(404, "select", "응답을 찾을 수 없습니다");

    await db.delete(formSubmissions).where(eq(formSubmissions.id, submissionId));

    await logAudit({
      userId: adminMember.id,
      userType: "admin",
      userName: adminMember.name,
      action: "form_submission_delete",
      target: `submission:${submissionId}`,
      detail: { formId: row.formId },
      req,
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADER });
  } catch (err: any) {
    console.error("[admin-form-submission-delete]", err);
    return jsonError(500, "delete", "응답 삭제 실패", err?.message);
  }
};
