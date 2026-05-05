// lib/churn-predictor.ts
// ★ Phase M-19-1: 후원자 이탈 예측 엔진
// - 룰 기반 점수 계산 (정확한 신호 감지)
// - AI 종합 분석 (Gemini 2.0/2.5 Flash, 모든 활성 정기 후원자)
// - cron 또는 어드민 수동 호출에서 사용

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { members, donations, billingKeys } from "../db/schema";
import { callGeminiJSON } from "./ai-gemini";

/* ───────── 신호 정의 ───────── */
export type ChurnSignal =
  | "consecutive_fail"       // 정기 결제 연속 실패
  | "long_inactive"          // 마지막 결제 35일 경과
  | "very_long_inactive"     // 마지막 결제 60일 경과 (가중치 ↑)
  | "no_recent_login"        // 90일간 로그인 없음
  | "amount_decreasing"      // 후원 금액 감소 추세
  | "billing_deactivated"    // 빌링키 비활성화
  | "card_likely_expired";   // (예측) 카드 만료 임박

export type ChurnLevel = "critical" | "warning" | "stable";

export interface ChurnEvaluation {
  memberId: number;
  score: number;              // 0~100
  level: ChurnLevel;
  signals: ChurnSignal[];
  aiSummary?: string;         // AI 한 줄 요약 (선택)
  aiSuggestion?: string;      // AI 권장 조치 (선택)
}

/* ───────── 신호 가중치 ───────── */
const SIGNAL_WEIGHTS: Record<ChurnSignal, number> = {
  consecutive_fail: 35,
  very_long_inactive: 30,
  long_inactive: 20,
  billing_deactivated: 25,
  no_recent_login: 15,
  amount_decreasing: 10,
  card_likely_expired: 10,
};

/**
 * 점수 → 위험도 등급
 */
function scoreToLevel(score: number): ChurnLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "warning";
  return "stable";
}

/**
 * 단일 회원의 룰 기반 신호 감지 + 점수 계산
 */
async function evaluateMemberRules(memberId: number): Promise<{
  score: number;
  signals: ChurnSignal[];
  context: any;
}> {
  const signals: ChurnSignal[] = [];
  const context: any = { memberId };

  /* 빌링키 정보 */
  const [bk] = await db
    .select()
    .from(billingKeys)
    .where(eq(billingKeys.memberId, memberId))
    .orderBy(sql`${billingKeys.createdAt} DESC`)
    .limit(1);

  if (bk) {
    context.billingKey = {
      isActive: bk.isActive,
      consecutiveFailCount: bk.consecutiveFailCount || 0,
      lastChargedAt: bk.lastChargedAt,
      amount: bk.amount,
    };

    /* 신호 1: 연속 실패 */
    if ((bk.consecutiveFailCount || 0) >= 1) {
      signals.push("consecutive_fail");
    }

    /* 신호 2: 빌링키 비활성화 */
    if (!bk.isActive) {
      signals.push("billing_deactivated");
    }

    /* 신호 3,4: 마지막 결제 경과 */
    if (bk.lastChargedAt) {
      const daysSince = Math.floor((Date.now() - new Date(bk.lastChargedAt).getTime()) / (24 * 60 * 60 * 1000));
      context.daysSinceLastCharge = daysSince;
      if (daysSince >= 60) {
        signals.push("very_long_inactive");
      } else if (daysSince >= 35) {
        signals.push("long_inactive");
      }
    }
  }

  /* 회원 정보 (로그인) */
  const [m] = await db
    .select({ lastLoginAt: members.lastLoginAt, createdAt: members.createdAt })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (m) {
    /* 신호 5: 90일간 로그인 없음 */
    if (m.lastLoginAt) {
      const loginDays = Math.floor((Date.now() - new Date(m.lastLoginAt).getTime()) / (24 * 60 * 60 * 1000));
      context.daysSinceLogin = loginDays;
      if (loginDays >= 90) {
        signals.push("no_recent_login");
      }
    } else {
      /* 한 번도 로그인 안 함 */
      const accountAge = m.createdAt
        ? Math.floor((Date.now() - new Date(m.createdAt).getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      if (accountAge > 30) {
        signals.push("no_recent_login");
        context.neverLoggedIn = true;
      }
    }
  }

  /* 신호 6: 후원 금액 감소 추세 (최근 6건 vs 그 이전 6건) */
  const recentDonations = await db
    .select({ amount: donations.amount, createdAt: donations.createdAt })
    .from(donations)
    .where(and(eq(donations.memberId, memberId), eq(donations.status, "completed")))
    .orderBy(sql`${donations.createdAt} DESC`)
    .limit(12);

  if (recentDonations.length >= 6) {
    const recent3 = recentDonations.slice(0, 3);
    const prev3 = recentDonations.slice(3, 6);
    const recentAvg = recent3.reduce((s, d) => s + (d.amount || 0), 0) / 3;
    const prevAvg = prev3.reduce((s, d) => s + (d.amount || 0), 0) / 3;
    if (prevAvg > 0 && recentAvg < prevAvg * 0.6) {
      /* 직전 3회 평균 대비 60% 미만으로 감소 */
      signals.push("amount_decreasing");
      context.amountTrend = { recentAvg, prevAvg };
    }
  }

  /* 점수 합산 (중복 신호 가중치 합) */
  let score = 0;
  for (const s of signals) score += SIGNAL_WEIGHTS[s] || 0;
  score = Math.min(100, score);

  return { score, signals, context };
}

/**
 * AI를 활용한 종합 분석 (간단 요약 + 권장 조치)
 * - 회원당 ~500 토큰 (저렴)
 * - 실패 시 폴백 메시지
 */
async function evaluateWithAI(
  signals: ChurnSignal[],
  context: any,
  memberName: string,
): Promise<{ summary?: string; suggestion?: string }> {
  if (signals.length === 0) return {};

  const signalDescMap: Record<ChurnSignal, string> = {
    consecutive_fail: "정기 결제 연속 실패",
    long_inactive: "최근 35~60일간 결제 없음",
    very_long_inactive: "최근 60일 이상 결제 없음",
    no_recent_login: "90일간 로그인 없음",
    amount_decreasing: "후원 금액 감소 추세",
    billing_deactivated: "정기 결제 카드 비활성화",
    card_likely_expired: "카드 만료 가능성",
  };

  const signalsText = signals.map(s => signalDescMap[s] || s).join(", ");

  const prompt = `당신은 NPO 후원자 관리 어시스턴트입니다.
다음 후원자의 이탈 위험 신호를 분석하여 JSON으로만 응답하세요. 코드블록은 사용하지 마세요.

# 후원자 정보
- 이름: ${memberName}
- 감지된 신호: ${signalsText}
- 컨텍스트: ${JSON.stringify(context).slice(0, 500)}

# 응답 형식 (JSON only)
{
  "summary": "한 줄 요약 (50자 이내, 후원자 입장에서 어떤 상황인지)",
  "suggestion": "운영자 권장 조치 (80자 이내, 구체적 액션)"
}

# 작성 원칙
- 따뜻하고 비난조 아닌 어조
- summary는 객관적, suggestion은 실행 가능한 액션
- "결제 실패" 같은 부정 표현보다 "지원 필요한 상황" 같은 중립 표현 선호`;

  try {
    const r = await callGeminiJSON(prompt, {
      temperature: 0.4,
      maxOutputTokens: 4000,
    });
    if (r.ok && r.data) {
      return {
        summary: String(r.data.summary || "").slice(0, 100),
        suggestion: String(r.data.suggestion || "").slice(0, 200),
      };
    }
  } catch (e) {
    console.warn("[churn-predictor] AI 분석 실패:", e);
  }

  /* 폴백: 룰 기반 메시지 */
  return {
    summary: `${signals.length}개 위험 신호 감지`,
    suggestion: signals.includes("consecutive_fail")
      ? "결제 카드 확인 안내 메일 발송 권장"
      : signals.includes("very_long_inactive")
      ? "재참여 유도 메일 발송 권장"
      : "관심 메시지 발송 검토",
  };
}

/**
 * 단일 회원 평가 + DB 업데이트
 */
export async function evaluateAndPersist(
  memberId: number,
  memberName: string,
  options?: { useAI?: boolean }
): Promise<ChurnEvaluation> {
  const { score, signals, context } = await evaluateMemberRules(memberId);
  const level = scoreToLevel(score);

  let aiResult: { summary?: string; suggestion?: string } = {};
  if (options?.useAI && signals.length > 0) {
    aiResult = await evaluateWithAI(signals, context, memberName);
  }

  /* DB 업데이트 (AI 결과는 churn_signals에 메타로 저장) */
  const signalsPayload: any = {
    codes: signals,
    summary: aiResult.summary || null,
    suggestion: aiResult.suggestion || null,
    evaluatedAt: new Date().toISOString(),
  };

  await db.update(members).set({
    churnRiskScore: score,
    churnRiskLevel: level,
    churnLastEvaluatedAt: new Date(),
    churnSignals: signalsPayload as any,
  } as any).where(eq(members.id, memberId));

  return {
    memberId,
    score,
    level,
    signals,
    aiSummary: aiResult.summary,
    aiSuggestion: aiResult.suggestion,
  };
}

/**
 * 활성 정기 후원자 전체에 대해 평가 (cron용)
 */
export async function evaluateAllActiveDonors(options?: {
  useAI?: boolean;
  limit?: number;
}): Promise<{
  total: number;
  evaluated: number;
  failed: number;
  byLevel: Record<ChurnLevel, number>;
}> {
  const useAI = options?.useAI ?? true;
  const limit = options?.limit ?? 1000;

  /* 활성 빌링키가 있는 회원 또는 최근 6개월 내 후원한 회원 */
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const targets: any = await db.execute(sql`
    SELECT DISTINCT m.id, m.name
      FROM members m
      LEFT JOIN billing_keys bk ON bk.member_id = m.id
     WHERE m.status = 'active'
       AND m.type IN ('regular', 'family', 'volunteer')
       AND (
         bk.id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM donations d
            WHERE d.member_id = m.id
              AND d.status = 'completed'
              AND d.created_at >= ${sixMonthsAgo}
         )
       )
     LIMIT ${limit}
  `);

  const rows = (targets as any).rows || (targets as any) || [];
  const stats = {
    total: rows.length,
    evaluated: 0,
    failed: 0,
    byLevel: { critical: 0, warning: 0, stable: 0 } as Record<ChurnLevel, number>,
  };

  for (const r of rows) {
    try {
      const result = await evaluateAndPersist(r.id, r.name || "회원", { useAI });
      stats.evaluated++;
      stats.byLevel[result.level]++;
      /* AI 호출 사이 200ms 대기 (rate limit 보호) */
      if (useAI) await new Promise((res) => setTimeout(res, 200));
    } catch (e) {
      console.error(`[churn-predictor] 회원 ${r.id} 평가 실패:`, e);
      stats.failed++;
    }
  }

  return stats;
}