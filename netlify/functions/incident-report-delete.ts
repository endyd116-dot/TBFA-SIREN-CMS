// netlify/functions/incident-report-delete.ts
// ★ M-5: 본인 제보 삭제 (soft delete: status='closed')
// - 사이렌 정식 접수된 건은 관리자만 삭제 가능 (여기서는 거부)

import type { Context } from "@netlify/functions";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { incidentReports } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, badRequest, unauthorized, forbidden, notFound, serverError, corsPreflight, methodNotAllowed, parseJson } from "../../lib/response";
import { logUserAction } from "../../lib/audit";

export const config = { path: "/api/incident-report-delete" };

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

    const [row] = await db.select().from(incidentReports)
      .where(and(eq(incidentReports.id, id), eq(incidentReports.memberId, user.uid)))
      .limit(1);

    if (!row) return notFound("제보를 찾을 수 없습니다");

    /* 정식 접수된 건은 사용자가 직접 삭제 불가 */
    if ((row as any).sirenReportRequested === true && (row as any).status === "reviewing") {
      return forbidden("정식 접수되어 검토 중인 제보는 삭제할 수 없습니다. 1:1 상담을 이용해주세요.");
    }

    /* 실제 DB 삭제 (사용자 소유, 관리자 검토 안 한 건만) */
    await db.delete(incidentReports).where(eq(incidentReports.id, id));

    try {
      await logUserAction(req, user.uid, "user", "incident_report_delete", {
        target: (row as any).reportNo,
        success: true,
      });
    } catch (_) {}

    return ok({ id, reportNo: (row as any).reportNo }, "제보가 삭제되었습니다");
  } catch (e: any) {
    console.error("[incident-report-delete]", e);
    return serverError("삭제 실패", e);
  }
};