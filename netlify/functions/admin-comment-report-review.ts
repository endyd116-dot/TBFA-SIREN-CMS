import { jsonKST } from "../../lib/kst";
import type { Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { commentReports, incidentComments, incidents } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { canAccess } from "../../lib/role-permission-check";
import { badRequest, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";

function jsonOk(data: object) {
  return new Response(jsonKST(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "PATCH") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  // R45 §4-6: 댓글·게시판 신고 중재는 운영자 허용(comment_moderation·권한정책 토글)
  if (!(await canAccess((auth as any).ctx.member.role ?? "", "comment_moderation"))) {
    return new Response(jsonKST({ ok: false, error: "댓글 중재 권한이 없습니다", step: "auth_role" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

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
        .select({
          commentId: commentReports.commentId,
          incidentId: commentReports.incidentId,
          reportType: commentReports.reportType,
        })
        .from(commentReports)
        .where(eq(commentReports.id, reportId))
        .limit(1);

      const cid = (report as any)?.commentId;
      const iid = (report as any)?.incidentId;
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
      } else if (iid) {
        /* OP-076: 사건(게시판) 자체 신고 — 댓글이 아니라 사건 본문 후속 조치.
           기존엔 commentId 없으면 아무 동작 안 함(신고가 '기록'만 됨).
           hide/delete 모두 사건을 공개 목록에서 숨김(status='hidden')으로 처리.
           하드 삭제는 사건관리(admin-incidents-crud)에서만 — 여기선 비가역 삭제 금지. */
        await db
          .update(incidents)
          .set({ status: "hidden", updatedAt: new Date() } as any)
          .where(eq(incidents.id, iid));
      }
    }

    return jsonOk({ ok: true });
  } catch (err: any) {
    return serverError("신고 검토 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/admin-comment-report-review" };
