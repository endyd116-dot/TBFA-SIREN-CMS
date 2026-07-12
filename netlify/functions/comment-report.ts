import type { Context } from "@netlify/functions";
import { jsonKST } from "../../lib/kst";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { commentReports } from "../../db/schema";
import { requireActiveUser } from "../../lib/auth";
import { badRequest, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";

function jsonOk(data: object) {
  return new Response(jsonKST(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  const auth = await requireActiveUser(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;
  const user = auth.user;

  let commentId: number | null, incidentId: number | null, reportType: string, reason: string;
  try {
    const body: any = await parseJson(req);
    if (!body) return badRequest("요청 본문이 비어있습니다");
    commentId = body.commentId ? Number(body.commentId) : null;
    incidentId = body.incidentId ? Number(body.incidentId) : null;
    reportType = String(body.reportType || "comment");
    reason = String(body.reason || "").trim();
  } catch (_) {
    return badRequest("잘못된 요청 형식입니다");
  }

  if (!["comment", "incident"].includes(reportType)) {
    return badRequest("reportType은 comment 또는 incident 이어야 합니다");
  }
  if (!reason) return badRequest("신고 사유는 필수입니다");
  if (!commentId && !incidentId) return badRequest("commentId 또는 incidentId 중 하나는 필수입니다");

  try {
    // 중복 신고 체크 (동일 commentId+memberId)
    if (commentId) {
      const [dup] = await db
        .select({ id: commentReports.id })
        .from(commentReports)
        .where(and(eq(commentReports.commentId, commentId), eq(commentReports.memberId, user.uid)))
        .limit(1);
      if (dup) {
        return new Response(jsonKST({ ok: false, error: "이미 신고한 항목입니다." }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const [inserted] = await db
      .insert(commentReports)
      .values({
        commentId: commentId ?? undefined,
        incidentId: incidentId ?? undefined,
        memberId: user.uid,
        reportType,
        reason,
        status: "pending",
      } as any)
      .returning({ id: commentReports.id });

    return jsonOk({ ok: true, reportId: (inserted as any).id });
  } catch (err: any) {
    return serverError("신고 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/comment-report" };
