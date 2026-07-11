/**
 * GET /api/support/mine            — 본인의 지원 신청 목록
 * GET /api/support/mine?id=N       — 본인의 지원 신청 단건 상세
 *
 * v11 (2026-05) 묶음 B-3:
 *   - ?id=N 분기 추가 (마이페이지 신청 내역 → 상세 모달용)
 *   - list 응답에 content / priority / priorityReason 등 카드 표시용 필드 보강
 *   - adminNote/answeredAt → adminResponse/respondedAt 별칭 추가 (클라이언트 호환)
 */
import { eq, desc, inArray, and } from "drizzle-orm";
import { db, supportRequests, expertMatches } from "../../db";
import { authenticateUser } from "../../lib/auth";
import {
  ok, badRequest, unauthorized, notFound, forbidden, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  try {
    const auth = authenticateUser(req);
    if (!auth) return unauthorized("로그인이 필요합니다");

    const url = new URL(req.url);
    const idStr = url.searchParams.get("id");

    /* =========================================================
       단건 상세 (?id=N)
       ========================================================= */
    if (idStr) {
      const id = Number(idStr);
      if (!Number.isFinite(id) || id <= 0) {
        return badRequest("id가 올바르지 않습니다");
      }

      const rows: any = await db
        .select()
        .from(supportRequests)
        .where(eq(supportRequests.id, id))
        .limit(1);

      const row: any = Array.isArray(rows) ? rows[0] : null;
      if (!row) return notFound("신청을 찾을 수 없습니다");

      if (Number(row.memberId) !== Number(auth.uid)) {
        return forbidden("본인의 신청만 조회할 수 있습니다");
      }

      /* attachments — JSON 문자열로 저장된 경우 파싱, 배열이면 그대로 */
      let attachments: any[] = [];
      const rawAttach = row.attachments;
      if (Array.isArray(rawAttach)) {
        attachments = rawAttach;
      } else if (typeof rawAttach === "string" && rawAttach.length > 0) {
        try {
          const parsed = JSON.parse(rawAttach);
          if (Array.isArray(parsed)) attachments = parsed;
        } catch { /* 무시 */ }
      }

      /* 클라이언트 renderDetailHtml과 호환되는 별칭 부여 */
      const request = {
        ...row,
        attachments,
        adminResponse: row.adminNote || "",
        respondedAt: row.answeredAt || null,
      };

      return ok({ request });
    }

    /* =========================================================
       목록
       ========================================================= */
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

    const list: any = await db
      .select({
        id: supportRequests.id,
        requestNo: supportRequests.requestNo,
        category: supportRequests.category,
        title: supportRequests.title,
        content: supportRequests.content,
        status: supportRequests.status,
        priority: supportRequests.priority,
        priorityReason: supportRequests.priorityReason,
        assignedExpertName: supportRequests.assignedExpertName,
        adminNote: supportRequests.adminNote,
        supplementNote: supportRequests.supplementNote,
        answeredAt: supportRequests.answeredAt,
        createdAt: supportRequests.createdAt,
        completedAt: supportRequests.completedAt,
      })
      .from(supportRequests)
      .where(eq(supportRequests.memberId, auth.uid))
      .orderBy(desc(supportRequests.createdAt))
      .limit(limit);

    /* expert_matches 별도 조회 — chatRoomId 포함 */
    const ids = (Array.isArray(list) ? list : []).map((r: any) => Number(r.id)).filter(Boolean);
    const matchMap = new Map<number, { chatRoomId: number | null; expertMatchStatus: string }>();
    if (ids.length > 0) {
      try {
        const matchRows = await db
          .select({
            sourceId: expertMatches.sourceId,
            chatRoomId: expertMatches.chatRoomId,
            status: expertMatches.status,
          })
          .from(expertMatches)
          .where(
            and(
              inArray(expertMatches.sourceId, ids),
              eq(expertMatches.sourceDomain, "support"),
              eq(expertMatches.userId, auth.uid),
            ),
          );
        for (const m of matchRows) {
          if (m.sourceId != null && !["closed", "rejected"].includes(m.status)) {
            matchMap.set(m.sourceId, { chatRoomId: m.chatRoomId ?? null, expertMatchStatus: m.status });
          }
        }
      } catch (e) {
        console.warn("[support-mine] expert_matches 조회 실패:", e);
      }
    }

    /* 카드 표시용 별칭 부여 + chatRoomId 주입 */
    const enriched = (Array.isArray(list) ? list : []).map((r: any) => ({
      ...r,
      adminResponse: r.adminNote || "",
      respondedAt: r.answeredAt || null,
      chatRoomId: matchMap.get(r.id)?.chatRoomId ?? null,
      expertMatchStatus: matchMap.get(r.id)?.expertMatchStatus ?? null,
    }));

    return ok({ list: enriched });
  } catch (err) {
    console.error("[support-mine]", err);
    return serverError("신청 조회 중 오류가 발생했습니다", err);
  }
};

export const config = { path: "/api/support/mine" };