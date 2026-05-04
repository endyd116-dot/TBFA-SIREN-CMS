// netlify/functions/admin-churn-risks.ts
// ★ Phase M-19-1: 후원자 이탈 위험 조회 (어드민)
//
// GET  /api/admin/churn-risks                     — 위험 회원 목록 + 통계
// GET  /api/admin/churn-risks?level=critical      — 등급별 필터
// GET  /api/admin/churn-risks?id=123              — 단건 상세
// POST /api/admin/churn-risks                     — 단건 재평가 (body: { memberId, useAI? })
//
// 권한: 모든 운영자 조회 가능 (super_admin / operator 모두)

import { eq, and, desc, sql, or, like, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { members, donations, billingKeys } from "../../db/schema";
import { requireAdmin } from "../../lib/admin-guard";
import {
  ok, badRequest, notFound, serverError,
  parseJson, corsPreflight, methodNotAllowed,
} from "../../lib/response";
import { evaluateAndPersist } from "../../lib/churn-predictor";
import { logAdminAction } from "../../lib/audit";

const VALID_LEVELS = ["critical", "warning", "stable"];

export default async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreflight();

  const guard: any = await requireAdmin(req);
  if (!guard.ok) return guard.res;
  const { admin } = guard.ctx;

  try {
    /* ===== GET ===== */
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");

      /* ── 단건 상세 ── */
      if (id) {
        const memberId = Number(id);
        if (!Number.isFinite(memberId)) return badRequest("유효하지 않은 ID");

        const [m] = await db
          .select({
            id: members.id,
            name: members.name,
            email: members.email,
            phone: members.phone,
            type: members.type,
            status: members.status,
            createdAt: members.createdAt,
            lastLoginAt: members.lastLoginAt,
            churnRiskScore: members.churnRiskScore,
            churnRiskLevel: members.churnRiskLevel,
            churnLastEvaluatedAt: members.churnLastEvaluatedAt,
            churnSignals: members.churnSignals,
            lastReengageEmailAt: members.lastReengageEmailAt,
            totalDonationAmount: members.totalDonationAmount,
          })
          .from(members)
          .where(eq(members.id, memberId))
          .limit(1);

        if (!m) return notFound("회원을 찾을 수 없습니다");

        /* 빌링키 */
        const [bk] = await db
          .select()
          .from(billingKeys)
          .where(eq(billingKeys.memberId, memberId))
          .orderBy(desc(billingKeys.createdAt))
          .limit(1);

        /* 최근 후원 5건 */
        const recentDonations = await db
          .select({
            id: donations.id,
            amount: donations.amount,
            type: donations.type,
            status: donations.status,
            createdAt: donations.createdAt,
          })
          .from(donations)
          .where(eq(donations.memberId, memberId))
          .orderBy(desc(donations.createdAt))
          .limit(5);

        return ok({
          member: m,
          billingKey: bk || null,
          recentDonations,
        });
      }

      /* ── 목록 조회 ── */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const level = url.searchParams.get("level") || "";
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [
        isNotNull(members.churnRiskLevel),
        eq(members.status, "active"),
      ];

      if (VALID_LEVELS.includes(level)) {
        conds.push(eq(members.churnRiskLevel, level));
      }

      if (q && q.length >= 2) {
        conds.push(
          or(
            like(members.name, `%${q}%`),
            like(members.email, `%${q}%`),
          )
        );
      }

      const where = conds.length === 1 ? conds[0] : and(...conds);

      /* 총 개수 */
      const [{ total }]: any = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(members)
        .where(where as any);

      /* 목록 */
      const list = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          phone: members.phone,
          type: members.type,
          createdAt: members.createdAt,
          lastLoginAt: members.lastLoginAt,
          churnRiskScore: members.churnRiskScore,
          churnRiskLevel: members.churnRiskLevel,
          churnLastEvaluatedAt: members.churnLastEvaluatedAt,
          churnSignals: members.churnSignals,
          lastReengageEmailAt: members.lastReengageEmailAt,
          totalDonationAmount: members.totalDonationAmount,
        })
        .from(members)
        .where(where as any)
        .orderBy(desc(members.churnRiskScore))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 통계 (전체 등급별 카운트) */
      const statsRows: any = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE churn_risk_level = 'critical')::int AS "criticalCount",
          COUNT(*) FILTER (WHERE churn_risk_level = 'warning')::int  AS "warningCount",
          COUNT(*) FILTER (WHERE churn_risk_level = 'stable')::int   AS "stableCount",
          COUNT(*) FILTER (WHERE churn_risk_level IS NOT NULL)::int  AS "evaluatedTotal",
          MAX(churn_last_evaluated_at)                               AS "lastEvaluatedAt"
        FROM members
        WHERE status = 'active'
      `);
      const s: any = (statsRows as any)?.rows?.[0] || (statsRows as any)?.[0] || {};

      return ok({
        list,
        pagination: {
          page,
          limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / limit),
        },
        stats: {
          critical: s.criticalCount || 0,
          warning: s.warningCount || 0,
          stable: s.stableCount || 0,
          evaluatedTotal: s.evaluatedTotal || 0,
          lastEvaluatedAt: s.lastEvaluatedAt || null,
        },
      });
    }

    /* ===== POST: 단건 재평가 ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const memberId = Number(body.memberId);
      if (!Number.isFinite(memberId)) return badRequest("memberId가 유효하지 않습니다");

      const useAI = body.useAI !== false; // 기본 true

      /* 회원 존재 확인 */
      const [m] = await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      if (!m) return notFound("회원을 찾을 수 없습니다");

      /* 평가 실행 */
      const result = await evaluateAndPersist(memberId, m.name || "회원", { useAI });

      /* 감사 로그 */
      await logAdminAction(req, admin.uid, admin.name, "churn_reevaluate", {
        target: `M-${memberId}`,
        detail: {
          name: m.name,
          score: result.score,
          level: result.level,
          signals: result.signals,
          useAI,
        },
      });

      return ok({
        evaluation: result,
      }, `${m.name}님의 이탈 위험도가 재평가되었습니다 (점수: ${result.score}, 등급: ${result.level})`);
    }

    return methodNotAllowed();
  } catch (err) {
    console.error("[admin-churn-risks]", err);
    return serverError("이탈 위험 조회 중 오류", err);
  }
};

export const config = { path: "/api/admin/churn-risks" };