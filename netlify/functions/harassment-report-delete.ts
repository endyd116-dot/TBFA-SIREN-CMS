// netlify/functions/harassment-report-delete.ts
// ★ Phase M-6: 본인 신고 삭제

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { harassmentReports } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/harassment-report-delete" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST" && req.method !== "DELETE") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    let id: number;
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      id = Number(url.searchParams.get("id"));
    } else {
      const body: any = await parseJson(req);
      id = Number(body?.id);
    }
    if (!Number.isFinite(id)) return badRequest("id 필요");

    const [row] = await db.select().from(harassmentReports)
      .where(and(eq(harassmentReports.id, id), eq(harassmentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("신고를 찾을 수 없습니다");

    if ((row as any).sirenReportRequested === true && (row as any).status === "reviewing") {
      return forbidden("정식 접수되어 검토 중인 신고는 삭제할 수 없습니다. 1:1 상담을 이용해주세요.");
    }

    await db.delete(harassmentReports).where(eq(harassmentReports.id, id));

    try {
      await logUserAction(req, user.uid, "user", "harassment_report_delete", {
        target: (row as any).reportNo,
        success: true,
      });
    } catch (_) {}

    return ok({ id, reportNo: (row as any).reportNo }, "신고가 삭제되었습니다");
  } catch (e: any) {
    console.error("[harassment-report-delete]", e);
    return serverError("삭제 실패", e);
  }
};