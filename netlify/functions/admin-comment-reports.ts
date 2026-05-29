import type { Context } from "@netlify/functions";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { commentReports, members, incidentComments, incidents } from "../../db/schema";
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

      /* OP-072: 신고 대상 본문을 함께 제공 — 운영자가 맥락 없이 판단하지 않도록.
         (drizzle 다중 leftJoin 회피 — separate query + Map 매칭) */
      const commentIds = Array.from(new Set(rows.map((r) => r.commentId).filter(Boolean))) as number[];
      const commentMap = new Map<number, any>();
      if (commentIds.length) {
        try {
          const crows = await db
            .select({
              id: incidentComments.id,
              content: incidentComments.content,
              authorName: incidentComments.authorName,
              isHidden: incidentComments.isHidden,
              isAnonymous: incidentComments.isAnonymous,
              createdAt: incidentComments.createdAt,
              incidentId: incidentComments.incidentId,
            })
            .from(incidentComments)
            .where(inArray(incidentComments.id, commentIds));
          crows.forEach((c) => commentMap.set(c.id, c));
        } catch (err) {
          console.warn("[admin-comment-reports] 대상 댓글 조회 실패:", err);
        }
      }

      const incidentIds = Array.from(
        new Set([
          ...rows.map((r) => r.incidentId).filter(Boolean),
          ...Array.from(commentMap.values()).map((c) => c.incidentId).filter(Boolean),
        ])
      ) as number[];
      const incidentMap = new Map<number, any>();
      if (incidentIds.length) {
        try {
          const irows = await db
            .select({
              id: incidents.id,
              title: incidents.title,
              slug: incidents.slug,
              status: incidents.status,
            })
            .from(incidents)
            .where(inArray(incidents.id, incidentIds));
          irows.forEach((i) => incidentMap.set(i.id, i));
        } catch (err) {
          console.warn("[admin-comment-reports] 대상 사건 조회 실패:", err);
        }
      }

      reports = rows.map((r) => {
        const c = r.commentId ? commentMap.get(r.commentId) : null;
        const inc = r.incidentId
          ? incidentMap.get(r.incidentId)
          : (c?.incidentId ? incidentMap.get(c.incidentId) : null);
        const target = r.reportType === "incident"
          ? { kind: "incident", incidentTitle: inc?.title ?? null, incidentSlug: inc?.slug ?? null, incidentStatus: inc?.status ?? null }
          : {
              kind: "comment",
              content: c?.content ?? null,
              authorName: c?.isAnonymous ? "익명" : (c?.authorName ?? null),
              isHidden: c?.isHidden ?? null,
              commentCreatedAt: c?.createdAt ?? null,
              incidentTitle: inc?.title ?? null,
              incidentSlug: inc?.slug ?? null,
            };
        return {
          id: r.id,
          reportType: r.reportType,
          commentId: r.commentId ?? null,
          incidentId: r.incidentId ?? null,
          reason: r.reason,
          status: r.status,
          reporterName: r.reporterName ?? "알 수 없음",
          createdAt: r.createdAt,
          target,
        };
      });
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

