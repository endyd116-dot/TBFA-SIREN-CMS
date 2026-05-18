import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { commentReports, incidentComments } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { badRequest, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";

function jsonOk(data: object) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "PATCH") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  let reportId: number, status: string, action: string;
  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");
    reportId = Number(body.reportId);
    status = String(body.status || "");
    action = String(body.action || "none");
  } catch (_) {
    return badRequest("잘못된 요청 형식입니다");
  }

  if (!reportId) return badRequest("reportId는 필수입니다");
  if (!["approved", "dismissed", "pending"].includes(status)) {
    return badRequest("status는 approved | dismissed | pending 이어야 합니다");
  }
  if (!["none", "hide_comment", "delete_comment"].includes(action)) {
    return badRequest("action은 none | hide_comment | delete_comment 이어야 합니다");
  }

  try {
    // 신고 상태 업데이트
    await db
      .update(commentReports)
      .set({
        status,
        reviewedBy: auth.ctx.admin.uid,
        reviewedAt: new Date(),
      } as any)
      .where(eq(commentReports.id, reportId));

    // action에 따른 댓글 처리
    if (action === "hide_comment" || action === "delete_comment") {
      const [report] = await db
        .select({ commentId: commentReports.commentId })
        .from(commentReports)
        .where(eq(commentReports.id, reportId))
        .limit(1);

      const cid = (report as any)?.commentId;
      if (cid) {
        if (action === "hide_comment") {
          await db
            .update(incidentComments)
            .set({
              isHidden: true,
              hiddenBy: auth.ctx.admin.uid,
              hiddenAt: new Date(),
            } as any)
            .where(eq(incidentComments.id, cid));
        } else {
          await db.delete(incidentComments).where(eq(incidentComments.id, cid));
        }
      }
    }

    return jsonOk({ ok: true });
  } catch (err: any) {
    return serverError("신고 검토 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/admin-comment-report-review" };
