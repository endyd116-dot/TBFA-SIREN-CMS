// netlify/functions/legal-consultations-mine.ts
// Phase M-7: 본인 법률 상담 목록

import type { Context } from "@netlify/functions";
import { eq, desc, inArray, and } from "drizzle-orm";
import { db, expertMatches } from "../../db";
import { legalConsultations } from "../../db/schema";
import { authenticateUser } from "../../lib/auth";
import { ok, unauthorized, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/legal-consultations/mine" };

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const user = authenticateUser(req);
  if (!user) return unauthorized("로그인이 필요합니다");

  try {
    const list = await db.select({
      id: legalConsultations.id,
      consultationNo: legalConsultations.consultationNo,
      title: legalConsultations.title,
      category: legalConsultations.category,
      urgency: legalConsultations.urgency,
      isAnonymous: legalConsultations.isAnonymous,
      aiUrgency: legalConsultations.aiUrgency,
      aiSummary: legalConsultations.aiSummary,
      aiLawyerSpecialty: legalConsultations.aiLawyerSpecialty,
      sirenReportRequested: legalConsultations.sirenReportRequested,
      assignedLawyerName: legalConsultations.assignedLawyerName,
      status: legalConsultations.status,
      adminResponse: legalConsultations.adminResponse,
      respondedAt: legalConsultations.respondedAt,
      createdAt: legalConsultations.createdAt,
    })
      .from(legalConsultations)
      .where(eq(legalConsultations.memberId, user.uid))
      .orderBy(desc(legalConsultations.createdAt));

    /* expert_matches 별도 조회 — chatRoomId 포함 */
    const ids = list.map((r) => r.id).filter(Boolean);
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
              eq(expertMatches.sourceDomain, "legal"),
              eq(expertMatches.userId, user.uid),
            ),
          );
        for (const m of matchRows) {
          if (m.sourceId != null && !["closed", "rejected"].includes(m.status)) {
            matchMap.set(m.sourceId, { chatRoomId: m.chatRoomId ?? null, expertMatchStatus: m.status });
          }
        }
      } catch (e) {
        console.warn("[legal-consultations-mine] expert_matches 조회 실패:", e);
      }
    }

    const enriched = list.map((r) => ({
      ...r,
      chatRoomId: matchMap.get(r.id)?.chatRoomId ?? null,
      expertMatchStatus: matchMap.get(r.id)?.expertMatchStatus ?? null,
    }));

    return ok({ list: enriched });
  } catch (e: any) {
    console.error("[legal-consultations-mine]", e);
    return serverError("조회 실패", e);
  }
};