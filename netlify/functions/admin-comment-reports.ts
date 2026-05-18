import type { Context } from "@netlify/functions";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { commentReports, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

function jsonOk(data: object) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await requireAdmin(req);
  if (!auth.ok) return (auth as { ok: false; res: Response }).res;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    // 신고 목록 조회 (신고자 이름 포함)
    let reports: any[] = [];
    let total = 0;

    try {
      const rows = await db
        .select({
          id: commentReports.id,
          reportType: commentReports.reportType,
          commentId: commentReports.commentId,
          incidentId: commentReports.incidentId,
          reason: commentReports.reason,
          status: commentReports.status,
          createdAt: commentReports.createdAt,
          reporterName: members.name,
        })
        .from(commentReports)
        .leftJoin(members, eq(commentReports.memberId, members.id))
        .where(status ? eq(commentReports.status as any, status) : undefined)
        .orderBy(desc(commentReports.createdAt))
        .limit(limit)
        .offset(offset);

      reports = rows.map((r) => ({
        id: r.id,
        reportType: r.reportType,
        commentId: r.commentId ?? null,
        incidentId: r.incidentId ?? null,
        reason: r.reason,
        status: r.status,
        reporterName: r.reporterName ?? "알 수 없음",
        createdAt: r.createdAt,
      }));
    } catch (err) {
      console.warn("[admin-comment-reports] 목록 조회 실패:", err);
    }

    try {
      const countRow = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(commentReports)
        .where(status ? eq(commentReports.status as any, status) : undefined);
      total = Number(countRow[0]?.cnt ?? 0);
    } catch (err) {
      console.warn("[admin-comment-reports] 카운트 조회 실패:", err);
    }

    return jsonOk({ ok: true, reports, total });
  } catch (err: any) {
    return serverError("신고 목록 조회 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/admin-comment-reports" };

