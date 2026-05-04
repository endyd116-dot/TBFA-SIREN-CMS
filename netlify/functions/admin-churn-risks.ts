// netlify/functions/admin-churn-risks.ts
// ★ Phase M-19-1: 후원자 이탈 위험 조회 (어드민)
//
// GET  /api/admin/churn-risks                       — 위험 회원 목록 + 통계
// GET  /api/admin/churn-risks?level=critical        — 등급별 필터
// GET  /api/admin/churn-risks?id=123                — 단건 상세
// POST /api/admin/churn-risks                       — 단건 재평가 (body: { memberId, useAI? })
//
// 권한: 모든 운영자 조회 가능 (super_admin / operator)

import { eq, and, desc, sql, or, like } from "drizzle-orm";
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

const SIGNAL_LABEL_KO: Record<string, string> = {
  consecutive_fail: "정기 결제 연속 실패",
  long_inactive: "최근 35~60일간 결제 없음",
  very_long_inactive: "최근 60일 이상 결제 없음",
  no_recent_login: "90일간 로그인 없음",
  amount_decreasing: "후원 금액 감소 추세",
  billing_deactivated: "정기 결제 카드 비활성화",
  card_likely_expired: "카드 만료 가능성",
};

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

      /* ───── 단건 상세 ───── */
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
            regularMonthsCount: members.regularMonthsCount,
          })
          .from(members)
          .where(eq(members.id, memberId))
          .limit(1);

        if (!m) return notFound("회원을 찾을 수 없습니다");

        /* 빌링키 정보 */
        const [bk] = await db
          .select({
            id: billingKeys.id,
            isActive: billingKeys.isActive,
            amount: billingKeys.amount,
            cardCompany: billingKeys.cardCompany,
            cardNumberMasked: billingKeys.cardNumberMasked,
            consecutiveFailCount: billingKeys.consecutiveFailCount,
            lastFailureReason: billingKeys.lastFailureReason,
            lastChargedAt: billingKeys.lastChargedAt,
            nextChargeAt: billingKeys.nextChargeAt,
            deactivatedAt: billingKeys.deactivatedAt,
            deactivatedReason: billingKeys.deactivatedReason,
          })
          .from(billingKeys)
          .where(eq(billingKeys.memberId, memberId))
          .orderBy(desc(billingKeys.createdAt))
          .limit(1);

        /* 최근 후원 6건 (트렌드 분석용) */
        const recentDonations = await db
          .select({
            id: donations.id,
            amount: donations.amount,
            type: donations.type,
            status: donations.status,
            createdAt: donations.createdAt,
          })
          .from(donations)
          .where(and(eq(donations.memberId, memberId), eq(donations.status, "completed")))
          .orderBy(desc(donations.createdAt))
          .limit(6);

        /* 신호 라벨화 */
        const signalsRaw: any = (m as any).churnSignals || {};
        const signalCodes: string[] = Array.isArray(signalsRaw.codes) ? signalsRaw.codes : [];
        const signalsKo = signalCodes.map((c) => ({
          code: c,
          label: SIGNAL_LABEL_KO[c] || c,
        }));

        return ok({
          member: {
            id: m.id,
            name: m.name,
            email: m.email,
            phone: m.phone,
            type: m.type,
            status: m.status,
            createdAt: m.createdAt,
            lastLoginAt: m.lastLoginAt,
            totalDonationAmount: m.totalDonationAmount,
            regularMonthsCount: m.regularMonthsCount,
          },
          churn: {
            score: m.churnRiskScore || 0,
            level: m.churnRiskLevel,
            lastEvaluatedAt: m.churnLastEvaluatedAt,
            signals: signalsKo,
            aiSummary: signalsRaw.summary || null,
            aiSuggestion: signalsRaw.suggestion || null,
          },
          billing: bk || null,
          recentDonations,
          reengageEmail: {
            lastSentAt: m.lastReengageEmailAt,
            canSendNow: !m.lastReengageEmailAt
              || (Date.now() - new Date(m.lastReengageEmailAt).getTime()) > 7 * 24 * 60 * 60 * 1000,
          },
        });
      }

      /* ───── 목록 조회 ───── */
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 50)));
      const level = url.searchParams.get("level") || "";
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);

      const conds: any[] = [
        eq(members.status, "active"),
        sql`${members.churnRiskLevel} IS NOT NULL`,
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

      const where = and(...conds);

      /* 총 개수 */
      const totalRow: any = await db
        .select({ c: sql<number>`COUNT(*)::int` })
        .from(members)
        .where(where as any);
      const total = Number(totalRow[0]?.c ?? 0);

      /* 목록 */
      const list = await db
        .select({
          id: members.id,
          name: members.name,
          email: members.email,
          phone: members.phone,
          type: members.type,
          churnRiskScore: members.churnRiskScore,
          churnRiskLevel: members.churnRiskLevel,
          churnLastEvaluatedAt: members.churnLastEvaluatedAt,
          churnSignals: members.churnSignals,
          lastReengageEmailAt: members.lastReengageEmailAt,
          lastLoginAt: members.lastLoginAt,
          totalDonationAmount: members.totalDonationAmount,
        })
        .from(members)
        .where(where as any)
        .orderBy(desc(members.churnRiskScore))
        .limit(limit)
        .offset((page - 1) * limit);

      /* 신호 라벨화 (목록에서는 간략하게) */
      const listFormatted = list.map((row: any) => {
        const signalsRaw = row.churnSignals || {};
        const signalCodes: string[] = Array.isArray(signalsRaw.codes) ? signalsRaw.codes : [];
        return {
          ...row,
          signalCodes,
          signalCount: signalCodes.length,
          aiSummary: signalsRaw.summary || null,
          aiSuggestion: signalsRaw.suggestion || null,
        };
      });

      /* 통계 (전체 요약) */
      const statsRows: any = await db.execute(sql`
        SELECT 
          COUNT(*) FILTER (WHERE churn_risk_level = 'critical')::int AS "criticalCount",
          COUNT(*) FILTER (WHERE churn_risk_level = 'warning')::int  AS "warningCount",
          COUNT(*) FILTER (WHERE churn_risk_level = 'stable')::int   AS "stableCount",
          COUNT(*) FILTER (WHERE churn_risk_level IS NOT NULL)::int  AS "evaluatedCount",
          MAX(churn_last_evaluated_at) AS "lastEvaluatedAt"
        FROM members
        WHERE status = 'active'
      `);
      const s: any = statsRows.rows ? statsRows.rows[0] : statsRows[0] || {};

      return ok({
        list: listFormatted,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats: {
          critical: s.criticalCount || 0,
          warning: s.warningCount || 0,
          stable: s.stableCount || 0,
          evaluated: s.evaluatedCount || 0,
          lastEvaluatedAt: s.lastEvaluatedAt,
        },
      });
    }

    /* ===== POST: 단건 재평가 ===== */
    if (req.method === "POST") {
      const body = await parseJson(req);
      if (!body) return badRequest("요청 본문이 비어있습니다");

      const memberId = Number(body.memberId);
      if (!Number.isFinite(memberId) || memberId <= 0) {
        return badRequest("유효하지 않은 memberId");
      }

      const useAI = body.useAI !== false; // 기본 true

      /* 회원 존재 확인 */
      const [m] = await db
        .select({ id: members.id, name: members.name, status: members.status })
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      if (!m) return notFound("회원을 찾을 수 없습니다");
      if (m.status !== "active") {
        return badRequest("활성 상태인 회원만 평가할 수 있습니다");
      }

      /* 평가 실행 */
      const result = await evaluateAndPersist(m.id, m.name || "회원", { useAI });

      /* 감사 로그 */
      try {
        await logAdminAction(req, admin.uid, admin.name, "churn_reevaluate", {
          target: `M-${memberId}`,
          detail: {
            score: result.score,
            level: result.level,
            signalCount: result.signals.length,
            useAI,
          },
        });
      } catch (_) {}

      return ok({
        memberId: result.memberId,
        score: result.score,
        level: result.level,
        signals: result.signals.map((c) => ({ code: c, label: SIGNAL_LABEL_KO[c] || c })),
        aiSummary: result.aiSummary,
        aiSuggestion: result.aiSuggestion,
      }, "재평가가 완료되었습니다");
    }

    return methodNotAllowed();
  } catch (err: any) {
    console.error("[admin-churn-risks]", err);
    return serverError("이탈 위험 처리 중 오류", err?.message);
  }
};

export const config = { path: "/api/admin/churn-risks" };