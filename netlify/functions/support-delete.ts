/**
 * POST /api/support-delete
 * 본인의 유가족 지원 신청 삭제
 *
 * ★ v11 (2026-05) 묶음 B-3:
 *   - 마이페이지 → 신청 내역 → 유가족 지원 탭에서 본인 신청 삭제
 *   - 진행 중 상태(reviewing/matching/matched/in_progress)는 차단
 *
 * Body: { id: number }
 */
import { eq } from "drizzle-orm";
import { db, supportRequests } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, notFound, forbidden, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

const BLOCKED_STATUSES = ["reviewing", "matching", "matched", "in_progress"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return methodNotAllowed();

  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    const body: any = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return badRequest("id가 올바르지 않습니다");
    }

    const rows: any = await db
      .select({
        id: supportRequests.id,
        memberId: supportRequests.memberId,
        status: supportRequests.status,
        requestNo: supportRequests.requestNo,
      })
      .from(supportRequests)
      .where(eq(supportRequests.id, id))
      .limit(1);

    const row: any = Array.isArray(rows) ? rows[0] : null;
    if (!row) return notFound("신청을 찾을 수 없습니다");

    if (Number(row.memberId) !== Number(auth.uid)) {
      return forbidden("본인의 신청만 삭제할 수 있습니다");
    }

    if (BLOCKED_STATUSES.includes(String(row.status))) {
      return badRequest(
        "진행 중인 신청은 삭제할 수 없습니다. 운영자에게 문의해 주세요.",
      );
    }

    await db.delete(supportRequests).where(eq(supportRequests.id, id));

    return ok(
      { id, requestNo: row.requestNo },
      "신청이 삭제되었습니다",
    );
  } catch (err) {
    console.error("[support-delete]", err);
    return serverError("삭제 처리 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support-delete" };