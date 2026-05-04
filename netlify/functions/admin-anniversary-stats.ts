// netlify/functions/admin-anniversary-stats.ts
// ★ Phase M-19-7: 기념일 축하 메일 통계 + 발송 로그 조회
//
// GET /api/admin/anniversary-stats              — 통계 대시보드
// GET /api/admin/anniversary-stats?logs=1       — 발송 로그 목록 (페이지네이션)
// GET /api/admin/anniversary-stats?candidates=1 — 오늘의 예정 대상자
//
// 권한: super_admin 또는 'all' 카테고리 담당자

import { eq, sql, desc } from "drizzle-orm";
import { db } from "../../db";
import { anniversaryEmailsLog, members } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, forbidden, serverError,
  corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { getAllAnniversaryCandidates } from "../../lib/anniversary-checker";

function canView(adminMember: any): boolean {
  if (!adminMember) return false;
  if (adminMember.role === "super_admin") return true;
  const cats: string[] = Array.isArray(adminMember.assignedCategories)
    ? adminMember.assignedCategories
    : [];
  return cats.includes("all");
}

const TYPE_LABELS: Record<string, string> = {
  signup_1month: "가입 1개월",
  signup_1year: "가입 1주년",
  first_donation_1year: "첫 후원 1주년",
  donation_milestone: "후원 마일스톤",
  regular_donation_6months: "정기 6개월",
  regular_donation_1year: "정기 1년",
};

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "GET") return methodNotAllowed();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { member: adminMember } = guard.ctx;

  if (!canView(adminMember)) {
    return forbidden("기념일 통계 조회 권한이 없습니다");
  }

  try {
    const url = new URL(req.url);

    /* 발송 로그 목록 */
    if (url.searchParams.get("logs") === "1") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));

      const totalRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(anniversaryEmailsLog);
      const total = Number(totalRow[0]?.c ?? 0);

      const logs = await db
        .select({
          id: anniversaryEmailsLog.id,
          memberId: anniversaryEmailsLog.memberId,
          anniversaryType: anniversaryEmailsLog.anniversaryType,
          anniversaryDate: anniversaryEmailsLog.anniversaryDate,
          milestoneAmount: anniversaryEmailsLog.milestoneAmount,
          emailSentAt: anniversaryEmailsLog.emailSentAt,
          emailStatus: anniversaryEmailsLog.emailStatus,
          recipientEmail: anniversaryEmailsLog.recipientEmail,
          errorMessage: anniversaryEmailsLog.errorMessage,
          metadata: anniversaryEmailsLog.metadata,
          memberName: members.name,
        })
        .from(anniversaryEmailsLog)
        .leftJoin(members, eq(anniversaryEmailsLog.memberId, members.id))
        .orderBy(desc(anniversaryEmailsLog.emailSentAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return ok({
        list: logs.map((l: any) => ({
          ...l,
          typeLabel: TYPE_LABELS[l.anniversaryType] || l.anniversaryType,
        })),
        pagination: {
          page, limit, total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    /* 오늘의 예정 대상자 (테스트/미리보기) */
    if (url.searchParams.get("candidates") === "1") {
      try {
        const candidates = await getAllAnniversaryCandidates();
        return ok({
          candidates: candidates.map((c) => ({
            ...c,
            typeLabel: TYPE_LABELS[c.type] || c.type,
          })),
          count: candidates.length,
        });
      } catch (e: any) {
        return serverError("대상자 조회 실패", e?.message);
      }
    }

    /* 통계 대시보드 (기본) */
    const overallRow: any = await db.execute(sql`
      SELECT
        COUNT(*)::int AS "totalSent",
        COUNT(*) FILTER (WHERE email_status = 'sent')::int AS "successCount",
        COUNT(*) FILTER (WHERE email_status = 'failed')::int AS "failedCount"
      FROM anniversary_emails_log
    `);
    const overall: any = (overallRow.rows || overallRow || [{}])[0];

    const recent7Row: any = await db.execute(sql`
      SELECT COUNT(*)::int AS "sent7d"
      FROM anniversary_emails_log
      WHERE email_sent_at >= NOW() - INTERVAL '7 days'
        AND email_status = 'sent'
    `);
    const recent7: any = (recent7Row.rows || recent7Row || [{}])[0];

    const byTypeRow: any = await db.execute(sql`
      SELECT anniversary_type AS "type", COUNT(*)::int AS "count"
      FROM anniversary_emails_log
      WHERE email_status = 'sent'
      GROUP BY anniversary_type
      ORDER BY count DESC
    `);
    const byType = (byTypeRow.rows || byTypeRow || []).map((r: any) => ({
      type: r.type,
      typeLabel: TYPE_LABELS[r.type] || r.type,
      count: Number(r.count || 0),
    }));

    const recentSent = await db
      .select({
        id: anniversaryEmailsLog.id,
        memberId: anniversaryEmailsLog.memberId,
        anniversaryType: anniversaryEmailsLog.anniversaryType,
        emailSentAt: anniversaryEmailsLog.emailSentAt,
        emailStatus: anniversaryEmailsLog.emailStatus,
        recipientEmail: anniversaryEmailsLog.recipientEmail,
        memberName: members.name,
      })
      .from(anniversaryEmailsLog)
      .leftJoin(members, eq(anniversaryEmailsLog.memberId, members.id))
      .orderBy(desc(anniversaryEmailsLog.emailSentAt))
      .limit(5);

    return ok({
      stats: {
        totalSent: Number(overall?.totalSent || 0),
        successCount: Number(overall?.successCount || 0),
        failedCount: Number(overall?.failedCount || 0),
        sent7d: Number(recent7?.sent7d || 0),
        byType,
      },
      recentSent: recentSent.map((r: any) => ({
        ...r,
        typeLabel: TYPE_LABELS[r.anniversaryType] || r.anniversaryType,
      })),
    });
  } catch (err: any) {
    console.error("[admin-anniversary-stats]", err);
    return serverError("통계 조회 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/anniversary-stats" };