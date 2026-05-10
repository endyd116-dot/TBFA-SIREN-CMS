import type { Context } from "@netlify/functions";
import { db } from "../../db";
import {
  incidentReports,
  harassmentReports,
  legalConsultations,
  boardPosts,
  anonymousRevealLogs,
} from "../../db/schema";
import { desc, sql, and, eq, gte } from "drizzle-orm";
import { requireAdmin } from "../../lib/admin-guard";
import { ok } from "../../lib/response";

export const config = { path: "/api/admin-siren-unified" };

function jsonError(step: string, err: any) {
  return new Response(JSON.stringify({
    ok: false,
    error: "사이렌 통합 조회 실패",
    step,
    detail: String(err?.message || err).slice(0, 500),
    stack: String(err?.stack || "").slice(0, 1000),
  }), { status: 500, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const auth: any = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const period    = url.searchParams.get("period") || "30d";
  const limitParam = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  let fromDate: Date | null = null;
  if (period !== "all") {
    const days = parseInt(period) || 30;
    fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  // ── 사건 신고 목록 ───────────────────────────────────────
  let incidents: any[] = [];
  try {
    const rows = await db
      .select({
        id:         incidentReports.id,
        reportNo:   incidentReports.reportNo,
        title:      incidentReports.title,
        status:     incidentReports.status,
        aiSeverity: incidentReports.aiSeverity,
        isAnonymous: incidentReports.isAnonymous,
        memberId:   incidentReports.memberId,
        createdAt:  incidentReports.createdAt,
      })
      .from(incidentReports)
      .where(fromDate ? gte(incidentReports.createdAt, fromDate) : undefined)
      .orderBy(desc(incidentReports.createdAt))
      .limit(limitParam);
    incidents = rows;
  } catch (err) {
    console.warn("[admin-siren-unified] incidentReports 조회 실패:", (err as any)?.message);
  }

  // ── 괴롭힘 신고 목록 ─────────────────────────────────────
  let harassment: any[] = [];
  try {
    const rows = await db
      .select({
        id:         harassmentReports.id,
        reportNo:   harassmentReports.reportNo,
        title:      harassmentReports.title,
        category:   harassmentReports.category,
        status:     harassmentReports.status,
        aiSeverity: harassmentReports.aiSeverity,
        isAnonymous: harassmentReports.isAnonymous,
        memberId:   harassmentReports.memberId,
        createdAt:  harassmentReports.createdAt,
      })
      .from(harassmentReports)
      .where(fromDate ? gte(harassmentReports.createdAt, fromDate) : undefined)
      .orderBy(desc(harassmentReports.createdAt))
      .limit(limitParam);
    harassment = rows;
  } catch (err) {
    console.warn("[admin-siren-unified] harassmentReports 조회 실패:", (err as any)?.message);
  }

  // ── 법률 상담 목록 ───────────────────────────────────────
  let legal: any[] = [];
  try {
    const rows = await db
      .select({
        id:              legalConsultations.id,
        consultationNo:  legalConsultations.consultationNo,
        title:           legalConsultations.title,
        category:        legalConsultations.category,
        status:          legalConsultations.status,
        aiUrgency:       legalConsultations.aiUrgency,
        isAnonymous:     legalConsultations.isAnonymous,
        memberId:        legalConsultations.memberId,
        assignedLawyerId: legalConsultations.assignedLawyerId,
        createdAt:       legalConsultations.createdAt,
      })
      .from(legalConsultations)
      .where(fromDate ? gte(legalConsultations.createdAt, fromDate) : undefined)
      .orderBy(desc(legalConsultations.createdAt))
      .limit(limitParam);
    legal = rows;
  } catch (err) {
    console.warn("[admin-siren-unified] legalConsultations 조회 실패:", (err as any)?.message);
  }

  // ── 게시글 목록 (신고 접수된 게시글 포함) ────────────────
  let board: any[] = [];
  try {
    const rows = await db
      .select({
        id:         boardPosts.id,
        postNo:     boardPosts.postNo,
        title:      boardPosts.title,
        category:   boardPosts.category,
        authorName: boardPosts.authorName,
        memberId:   boardPosts.memberId,
        views:      boardPosts.views,
        createdAt:  boardPosts.createdAt,
      })
      .from(boardPosts)
      .where(fromDate ? gte(boardPosts.createdAt, fromDate) : undefined)
      .orderBy(desc(boardPosts.createdAt))
      .limit(limitParam);
    board = rows;
  } catch (err) {
    console.warn("[admin-siren-unified] boardPosts 조회 실패:", (err as any)?.message);
  }

  // ── 익명 신원 열람 이력 ──────────────────────────────────
  let anonRevealCases: any[] = [];
  try {
    const rows = await db
      .select({
        id:          anonymousRevealLogs.id,
        reportType:  anonymousRevealLogs.reportType,
        reportId:    anonymousRevealLogs.reportId,
        revealLevel: anonymousRevealLogs.revealLevel,
        revealedBy:  anonymousRevealLogs.revealedBy,
        reason:      anonymousRevealLogs.reason,
        createdAt:   anonymousRevealLogs.createdAt,
      })
      .from(anonymousRevealLogs)
      .where(fromDate ? gte(anonymousRevealLogs.createdAt, fromDate) : undefined)
      .orderBy(desc(anonymousRevealLogs.createdAt))
      .limit(100);
    anonRevealCases = rows;
  } catch (err) {
    console.warn("[admin-siren-unified] anonymousRevealLogs 조회 실패:", (err as any)?.message);
  }

  return ok({
    incidents,
    harassment,
    legal,
    board,
    anonRevealCases,
  });
}
