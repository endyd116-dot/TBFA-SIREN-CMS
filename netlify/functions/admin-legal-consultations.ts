// netlify/functions/admin-legal-consultations.ts
// ★ M-10: 법률 상담 관리자 목록 조회

import type { Context } from "@netlify/functions";
import { eq, and, desc, count, or, like, sql } from "drizzle-orm";
import { db } from "../../db";
import { legalConsultations, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import { ok, serverError, corsPreflight, methodNotAllowed } from "../../lib/response";

export const config = { path: "/api/admin/legal-consultations" };

const VALID_STATUSES = ["submitted", "ai_analyzed", "matching", "matched", "in_progress", "responded", "closed", "rejected"];
const VALID_URGENCIES = ["urgent", "high", "normal", "low"];
const VALID_CATEGORIES = ["school_dispute", "civil", "criminal", "family", "labor", "contract", "other"];

export default async (req: Request, _ctx: Context) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;

  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
    const status = url.searchParams.get("status") || "";
    const urgency = url.searchParams.get("urgency") || "";
    const category = url.searchParams.get("category") || "";
    const onlySiren = url.searchParams.get("onlySiren") === "1";
    const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

    const conds: any[] = [];
    if (VALID_STATUSES.includes(status)) conds.push(eq(legalConsultations.status, status as any));
    if (VALID_URGENCIES.includes(urgency)) conds.push(eq(legalConsultations.aiUrgency, urgency));
    if (VALID_CATEGORIES.includes(category)) conds.push(eq(legalConsultations.category, category as any));
    if (onlySiren) conds.push(eq(legalConsultations.sirenReportRequested, true));
    if (q) {
      conds.push(or(
        like(legalConsultations.title, `%${q}%`),
        like(legalConsultations.consultationNo, `%${q}%`),
      ));
    }
    const where = conds.length === 0 ? undefined : (conds.length === 1 ? conds[0] : and(...conds));

    const [{ total }]: any = await db.select({ total: count() }).from(legalConsultations).where(where as any);

    const list = await db.select({
      id: legalConsultations.id,
      consultationNo: legalConsultations.consultationNo,
      title: legalConsultations.title,
      category: legalConsultations.category,
      urgency: legalConsultations.urgency,
      isAnonymous: legalConsultations.isAnonymous,
      memberId: legalConsultations.memberId,
      aiUrgency: legalConsultations.aiUrgency,
      aiSummary: legalConsultations.aiSummary,
      aiLawyerSpecialty: legalConsultations.aiLawyerSpecialty,
      sirenReportRequested: legalConsultations.sirenReportRequested,
      assignedLawyerName: legalConsultations.assignedLawyerName,
      assignedAt: legalConsultations.assignedAt,
      status: legalConsultations.status,
      adminResponse: legalConsultations.adminResponse,
      respondedAt: legalConsultations.respondedAt,
      createdAt: legalConsultations.createdAt,
      memberName: members.name,
    })
      .from(legalConsultations)
      .leftJoin(members, eq(legalConsultations.memberId, members.id))
      .where(where as any)
      .orderBy(desc(legalConsultations.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const stats = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'submitted')::int  AS "submittedCount",
        COUNT(*) FILTER (WHERE status = 'matching')::int    AS "matchingCount",
        COUNT(*) FILTER (WHERE status = 'matched')::int     AS "matchedCount",
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgressCount",
        COUNT(*) FILTER (WHERE status = 'responded')::int   AS "respondedCount",
        COUNT(*) FILTER (WHERE siren_report_requested = TRUE)::int AS "sirenRequestedCount",
        COUNT(*) FILTER (WHERE ai_urgency = 'urgent')::int  AS "urgentCount"
      FROM legal_consultations
    `);
    const s: any = stats[0] || {};

    return ok({
      list,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
      stats: {
        submitted: s.submittedCount || 0,
        matching: s.matchingCount || 0,
        matched: s.matchedCount || 0,
        inProgress: s.inProgressCount || 0,
        responded: s.respondedCount || 0,
        sirenRequested: s.sirenRequestedCount || 0,
        urgent: s.urgentCount || 0,
      },
    });
  } catch (e: any) {
    console.error("[admin-legal-consultations]", e);
    return serverError("조회 실패", e);
  }
};